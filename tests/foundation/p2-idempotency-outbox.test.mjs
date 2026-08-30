import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

const request = {
  tenantId: 'tenant-a',
  key: 'order-123',
  requestHash: 'hash-a',
  recordId: 'idem-1',
  now: 100,
  expiresAt: 1_000,
}

const event = {
  id: 'event-1',
  tenantId: 'tenant-a',
  aggregateType: 'order',
  aggregateId: 'order-123',
  eventType: 'order.accepted',
  payload: { orderId: 'order-123' },
  createdAt: 100,
  availableAt: 100,
}

test('P2.9 claims tenant-scoped keys atomically and returns deterministic replay/conflict outcomes', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryIdempotencyStore } = (await import('./apps/api/src/platform/idempotency/adapters/in-memory.ts')).default
    const store = new InMemoryIdempotencyStore()
    const first = await store.claim(${JSON.stringify(request)})
    await store.complete({ ...${JSON.stringify(request)}, response: { accepted: true } })
    const replay = await store.claim(${JSON.stringify(request)})
    const conflict = await store.claim({ ...${JSON.stringify(request)}, requestHash: 'hash-b' })
    const otherTenant = await store.claim({ ...${JSON.stringify(request)}, tenantId: 'tenant-b', recordId: 'idem-b' })
    console.log(JSON.stringify({ first, replay, conflict, otherTenant }))
  `)

  assert.equal(result.first.status, 'claimed')
  assert.equal(result.replay.status, 'replay')
  assert.deepEqual(result.replay.response, { accepted: true })
  assert.equal(result.conflict.status, 'conflict')
  assert.equal(result.otherTenant.status, 'claimed')
})

test('P2.9 serializes claim races and preserves tenant isolation', async () => {
  const result = runTypeScriptScenario(`
    const { InMemoryIdempotencyStore } = (await import('./apps/api/src/platform/idempotency/adapters/in-memory.ts')).default
    const store = new InMemoryIdempotencyStore()
    const [first, second] = await Promise.all([
      store.claim(${JSON.stringify(request)}),
      store.claim({ ...${JSON.stringify(request)}, recordId: 'idem-2' }),
    ])
    const denied = await store.find('tenant-b', ${JSON.stringify(request.key)})
    console.log(JSON.stringify({ statuses: [first.status, second.status].sort(), denied }))
  `)

  assert.deepEqual(result.statuses, ['claimed', 'in_progress'])
  assert.equal(result.denied, null)
})

test('P2.9 commits idempotency result and outbox append as one recoverable transaction', async () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryPlatform } = (await import('./apps/api/src/platform/composition.ts')).default
    const { IdempotentActionService } = (await import('./apps/api/src/platform/idempotency/application/idempotent-action-service.ts')).default
    const platform = createInMemoryPlatform()
    const service = new IdempotentActionService(platform)
    let executions = 0
    const input = { request: ${JSON.stringify(request)}, event: ${JSON.stringify(event)} }
    const first = await service.execute(input, async () => ({ executions: ++executions, accepted: true }))
    const replay = await service.execute(input, async () => ({ executions: ++executions, accepted: true }))
    let rolledBack = false
    try {
      await platform.transaction(async (transaction) => {
        await transaction.idempotency.claim({ ...${JSON.stringify(request)}, key: 'rollback-key', recordId: 'idem-rollback' })
        await transaction.outbox.append({ ...${JSON.stringify(event)}, id: 'event-rollback' })
        throw new Error('rollback')
      })
    } catch {
      rolledBack = true
    }
    const afterRollback = await platform.idempotency.claim({ ...${JSON.stringify(request)}, key: 'rollback-key', recordId: 'idem-rollback' })
    console.log(JSON.stringify({ first, replay, executions, events: platform.outbox.list('tenant-a'), rolledBack, afterRollback }))
  `)

  assert.deepEqual(result.first.response, { executions: 1, accepted: true })
  assert.equal(result.replay.status, 'replay')
  assert.equal(result.executions, 1)
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].status, 'pending')
  assert.equal(result.rolledBack, true)
  assert.equal(result.afterRollback.status, 'claimed')
})

test('P2.9 claims, publishes, and recovers outbox records without cross-tenant access', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryOutboxStore } = (await import('./apps/api/src/platform/outbox/adapters/in-memory.ts')).default
    const store = new InMemoryOutboxStore()
    const appended = await store.append(${JSON.stringify(event)})
    const [first, race] = await Promise.all([
      store.claim({ tenantId: 'tenant-a', eventId: appended.id, claimId: 'claim-a', now: 100, leaseMs: 10 }),
      store.claim({ tenantId: 'tenant-a', eventId: appended.id, claimId: 'claim-b', now: 100, leaseMs: 10 }),
    ])
    const published = await store.publish({ tenantId: 'tenant-a', eventId: appended.id, claimId: 'claim-a', now: 101 })
    const replayPublish = await store.publish({ tenantId: 'tenant-a', eventId: appended.id, claimId: 'claim-a', now: 102 })
    const forbidden = await store.claim({ tenantId: 'tenant-b', eventId: appended.id, claimId: 'claim-b', now: 100, leaseMs: 10 })
    const recovered = await store.recover({ tenantId: 'tenant-a', now: 200 })
    console.log(JSON.stringify({ first, race, published, replayPublish, forbidden, recovered, record: await store.find('tenant-a', appended.id) }))
  `)

  assert.equal(result.first.status, 'claimed')
  assert.equal(result.race.status, 'in_progress')
  assert.equal(result.published.status, 'published')
  assert.equal(result.replayPublish.status, 'already_published')
  assert.equal(result.forbidden.status, 'forbidden')
  assert.equal(result.recovered, 0)
  assert.equal(result.record.status, 'published')
})

test('P2.9 takes over an expired outbox claim and exposes recovery state', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryOutboxStore } = (await import('./apps/api/src/platform/outbox/adapters/in-memory.ts')).default
    const store = new InMemoryOutboxStore()
    await store.append(${JSON.stringify(event)})
    const claimed = await store.claim({ tenantId: 'tenant-a', eventId: 'event-1', claimId: 'claim-a', now: 100, leaseMs: 10 })
    const recovered = await store.recover({ tenantId: 'tenant-a', now: 111 })
    const reclaimed = await store.claim({ tenantId: 'tenant-a', eventId: 'event-1', claimId: 'claim-b', now: 112, leaseMs: 10 })
    console.log(JSON.stringify({ claimed, recovered, reclaimed }))
  `)

  assert.equal(result.claimed.status, 'claimed')
  assert.equal(result.recovered, 1)
  assert.equal(result.reclaimed.status, 'claimed')
  assert.equal(result.reclaimed.record.attempts, 2)
})

test('P2.9 SQL adapters emit parameterized tenant-scoped atomic commands', () => {
  const result = runTypeScriptScenario(`
    const { PostgresIdempotencyAdapter } = (await import('./apps/api/src/platform/idempotency/adapters/postgres.ts')).default
    const { PostgresOutboxAdapter } = (await import('./apps/api/src/platform/outbox/adapters/postgres.ts')).default
    const calls = []
    const executor = { query: async (command) => { calls.push(command); return { rows: [command.operation === 'idempotency-claim' ? { id: 'idem-1', tenantId: 'tenant-a', key: 'order-123', requestHash: 'hash-a', status: 'pending', response: null, createdAt: 100, expiresAt: 1000 } : { id: 'event-1', tenantId: 'tenant-a', aggregateType: 'order', aggregateId: 'order-123', eventType: 'order.accepted', payload: { orderId: 'order-123' }, status: 'pending', attempts: 0, availableAt: 100, lastError: null, createdAt: 100, publishedAt: null }], rowCount: 1 } } }
    const idempotency = new PostgresIdempotencyAdapter(executor)
    const outbox = new PostgresOutboxAdapter(executor)
    await idempotency.claim(${JSON.stringify(request)})
    await outbox.append(${JSON.stringify(event)})
    const claimSql = calls.find(({ operation }) => operation === 'idempotency-claim').text
    console.log(JSON.stringify({ operations: calls.map(({ operation }) => operation), scoped: calls.every(({ parameters }) => parameters[0] === 'tenant-a'), interpolated: calls.some(({ text }) => text.includes('tenant-a') || text.includes('order-123')), atomicClaim: claimSql.includes('ON CONFLICT') && claimSql.includes('DO NOTHING') && claimSql.includes('taken_over') && claimSql.includes('claimed') }))
  `)

  assert.deepEqual(result.operations, ['idempotency-claim', 'outbox-append'])
  assert.equal(result.scoped, true)
  assert.equal(result.interpolated, false)
  assert.equal(result.atomicClaim, true)
})

test('P2.9 keeps PostgreSQL outbox claim leases in the Prisma source of truth and migrations', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(
    join(root, 'apps/api/prisma/migrations/20260824110000_p2_outbox_claim_lease/migration.sql'),
    'utf8'
  )

  assert.match(schema, /model OutboxEvent[\s\S]*?claimId\s+String\?/)
  assert.match(schema, /model OutboxEvent[\s\S]*?claimUntil\s+DateTime\?/)
  assert.match(schema, /@@index\(\[status, availableAt, claimUntil\]\)/)
  assert.match(schema, /@@index\(\[tenantId, status, claimUntil\]\)/)
  assert.match(migration, /ADD COLUMN "claimId" TEXT;/)
  assert.match(migration, /ADD COLUMN "claimUntil" TIMESTAMP\(3\);/)
  assert.match(migration, /OutboxEvent_status_availableAt_claimUntil_idx/)
  assert.match(migration, /OutboxEvent_tenantId_status_claimUntil_idx/)
})

test('P2.9 PostgreSQL idempotency claims safely take over only expired matching pending rows', () => {
  const result = runTypeScriptScenario(`
    const { buildIdempotencyClaimCommand } = (await import('./apps/api/src/platform/idempotency/sql.ts')).default
    const { PostgresIdempotencyAdapter } = (await import('./apps/api/src/platform/idempotency/adapters/postgres.ts')).default
    const calls = []
    const executor = { query: async (command) => {
      calls.push(command)
      return { rows: [{ id: 'idem-1', tenantId: 'tenant-a', key: 'order-123', requestHash: 'hash-a', status: 'pending', response: null, createdAt: 200, expiresAt: 1200, claimed: true }], rowCount: 1 }
    } }
    const adapter = new PostgresIdempotencyAdapter(executor)
    const claimed = await adapter.claim({ ...${JSON.stringify(request)}, now: 200, expiresAt: 1200 })
    const sql = buildIdempotencyClaimCommand({ ...${JSON.stringify(request)}, now: 200, expiresAt: 1200 }).text
    console.log(JSON.stringify({ claimed, sql, parameters: calls[0].parameters }))
  `)

  assert.equal(result.claimed.status, 'claimed')
  assert.match(result.sql, /ON CONFLICT \("tenantId", "key"\) DO NOTHING/)
  assert.match(result.sql, /status.*pending[\s\S]*expiresAt.*<= \$5/)
  assert.match(result.sql, /requestHash.*= \$4/)
  assert.match(result.sql, /UNION ALL/)
  assert.doesNotMatch(result.sql, /xmax/)
  assert.equal(result.parameters[0], 'tenant-a')
})

test('P2.9 fences the expired claimant so an old worker cannot complete a takeover', async () => {
  const result = runTypeScriptScenario(`
    const { InMemoryIdempotencyStore } = (await import('./apps/api/src/platform/idempotency/adapters/in-memory.ts')).default
    const { buildIdempotencyCompleteCommand } = (await import('./apps/api/src/platform/idempotency/sql.ts')).default
    const store = new InMemoryIdempotencyStore()
    await store.claim(${JSON.stringify(request)})
    const takeover = await store.claim({ ...${JSON.stringify(request)}, recordId: 'idem-2', now: 1001, expiresAt: 2000 })
    let staleCompletion = null
    try { await store.complete({ ...${JSON.stringify(request)}, response: { worker: 'old' } }) } catch (error) { staleCompletion = error.message }
    const current = await store.complete({ ...${JSON.stringify(request)}, recordId: 'idem-2', now: 1001, expiresAt: 2000, response: { worker: 'new' } })
    const sql = buildIdempotencyCompleteCommand({ ...${JSON.stringify(request)}, recordId: 'idem-2', response: { worker: 'new' } }).text
    console.log(JSON.stringify({ takeover, staleCompletion, current, sql }))
  `)

  assert.equal(result.takeover.status, 'claimed')
  assert.match(result.staleCompletion, /does not belong/)
  assert.equal(result.current.response.worker, 'new')
  assert.match(result.sql, /"id"\s*=\s*\$3/)
})

test('P2.9 composes PostgreSQL adapters inside one transaction-scoped executor with rollback evidence', async () => {
  const result = runTypeScriptScenario(`
    const { PostgresTransactionalPlatform } = (await import('./apps/api/src/platform/composition.ts')).default
    const committed = []
    let rollbacks = 0
    const executor = { transaction: async (operation) => {
      const pending = []
      const transaction = { query: async (command) => {
        pending.push(command.operation)
        if (command.operation === 'idempotency-claim') return { rows: [{ id: 'idem-1', tenantId: 'tenant-a', key: 'order-123', requestHash: 'hash-a', status: 'pending', response: null, createdAt: 100, expiresAt: 1000, claimed: true }], rowCount: 1 }
        if (command.operation === 'outbox-append') return { rows: [{ id: 'event-1', tenantId: 'tenant-a', aggregateType: 'order', aggregateId: 'order-123', eventType: 'order.accepted', payload: { orderId: 'order-123' }, status: 'pending', attempts: 0, availableAt: 100, lastError: null, createdAt: 100, publishedAt: null, claimId: null, claimUntil: null }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      } }
      try {
        const value = await operation(transaction)
        committed.push(...pending)
        return value
      } catch (error) {
        rollbacks += 1
        throw error
      }
    } }
    const platform = new PostgresTransactionalPlatform(executor)
    const request = ${JSON.stringify(request)}
    const event = ${JSON.stringify(event)}
    const result = await platform.transaction(async (transaction) => {
      await transaction.idempotency.claim(request)
      await transaction.outbox.append(event)
      return 'committed'
    })
    try {
      await platform.transaction(async (transaction) => {
        await transaction.idempotency.claim({ ...request, key: 'rollback-key' })
        await transaction.outbox.append({ ...event, id: 'event-rollback' })
        throw new Error('rollback')
      })
    } catch {}
    console.log(JSON.stringify({ result, committed, rollbacks }))
  `)

  assert.equal(result.result, 'committed')
  assert.deepEqual(result.committed, ['idempotency-claim', 'outbox-append'])
  assert.equal(result.rollbacks, 1)
})

test('P2.9 activation gates prevent live claims until explicitly enabled', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryIdempotencyStore } = (await import('./apps/api/src/platform/idempotency/adapters/in-memory.ts')).default
    const { ActivationGatedIdempotencyAdapter } = (await import('./apps/api/src/platform/idempotency/adapters/activation-gated.ts')).default
    const gated = new ActivationGatedIdempotencyAdapter(new InMemoryIdempotencyStore())
    let disabled = null
    try { await gated.claim(${JSON.stringify(request)}) } catch (error) { disabled = error.code }
    gated.activate()
    const enabled = await gated.claim(${JSON.stringify(request)})
    console.log(JSON.stringify({ disabled, enabled }))
  `)

  assert.equal(result.disabled, 'PROVIDER_UNAVAILABLE')
  assert.equal(result.enabled.status, 'claimed')
})
