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

function requestBody(overrides = {}) {
  return {
    cartId: 'cart-http-1',
    requestHash: 'hash-http-1',
    lines: [
      { lineId: 'product-1', context: 'product', merchantId: 'merchant-a', amount: 1200, currency: 'ARS' },
      { lineId: 'service-1', context: 'service', merchantId: 'merchant-a', amount: 1800, currency: 'ARS' },
    ],
    ...overrides,
  }
}

test('WU2 rejects tenant and actor spoofing when the bearer session is not authorized', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('token-a', { sessionId: 'session-a', subjectId: 'actor-a', tenantId: 'tenant-a', roles: ['staff'], permissions: ['tus:checkout', 'tus:read'] })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const address = server.address()
    const response = await fetch('http://127.0.0.1:' + address.port + '/tus/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-a',
        'content-type': 'application/json',
        'idempotency-key': 'idem-spoof',
        'x-tenant-id': 'tenant-b',
        'x-actor-id': 'actor-b',
        'x-correlation-id': 'corr-spoof',
      },
      body: JSON.stringify(${JSON.stringify(requestBody({ tenantId: 'tenant-b', actorId: 'actor-b' }))}),
    })
    const body = await response.json()
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ status: response.status, body, outbox: application.outbox.list('tenant-b') }))
  `)

  assert.equal(result.status, 403)
  assert.equal(result.body.code, 'FORBIDDEN')
  assert.deepEqual(result.outbox, [])
})

test('WU2 executes durable mixed checkout with session-derived tenant context and replays safely', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('token-a', { sessionId: 'session-a', subjectId: 'actor-a', tenantId: 'tenant-a', roles: ['merchant-admin'], permissions: ['tus:checkout', 'tus:read'] })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const address = server.address()
    const send = () => fetch('http://127.0.0.1:' + address.port + '/tus/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-a',
        'content-type': 'application/json',
        'idempotency-key': 'idem-mixed',
        'x-correlation-id': 'corr-mixed',
      },
      body: JSON.stringify(${JSON.stringify(requestBody())}),
    })
    const firstResponse = await send()
    const first = await firstResponse.json()
    const replayResponse = await send()
    const replay = await replayResponse.json()
    const conflictResponse = await fetch('http://127.0.0.1:' + address.port + '/tus/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-a',
        'content-type': 'application/json',
        'idempotency-key': 'idem-mixed',
        'x-correlation-id': 'corr-mixed',
      },
      body: JSON.stringify(${JSON.stringify(requestBody({ requestHash: 'hash-conflict' }))}),
    })
    const conflict = await conflictResponse.json()
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ firstStatus: firstResponse.status, first, replayStatus: replayResponse.status, replay, conflictStatus: conflictResponse.status, conflict, outbox: application.outbox.list('tenant-a') }))
  `)

  assert.equal(result.firstStatus, 201, JSON.stringify(result))
  assert.deepEqual(result.first.commitments.map(({ context }) => context), ['product', 'service'])
  assert.ok(result.first.commitments.every(({ tenantId }) => tenantId === 'tenant-a'))
  assert.equal(result.replayStatus, 200)
  assert.equal(result.replay.status, 'replay')
  assert.deepEqual(result.replay.commitments, result.first.commitments)
  assert.equal(result.conflictStatus, 409)
  assert.equal(result.conflict.code, 'CONFLICT')
  assert.equal(result.outbox.length, 1)
})

test('WU2 rolls back commitments, audit references, outbox, and idempotency when the transaction fails', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryTusCommitmentStore, InMemoryTusAuditStore, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const commitments = new InMemoryTusCommitmentStore()
    const audits = new InMemoryTusAuditStore()
    const idempotency = new InMemoryTusIdempotencyStore()
    const outbox = new InMemoryTusOutboxStore()
    const transaction = new InMemoryTusTransaction({ commitments, audits, idempotency, outbox })
    let rolledBack = false
    try {
      await transaction.run(async (repositories) => {
        await repositories.idempotency.claim({ tenantId: 'tenant-a', key: 'idem-failure', requestHash: 'hash-failure', now: 100, expiresAt: 1000 })
        await repositories.commitments.saveMany([{ contractVersion: '1.0.0', commitmentId: 'commitment-failure', cartId: 'cart-failure', tenantId: 'tenant-a', merchantId: 'merchant-a', context: 'product', amount: 100, currency: 'ARS', status: 'pending', lineIds: ['line-failure'], createdAt: '2026-01-01T00:00:00.000Z' }])
        await repositories.audits.append([{ referenceId: 'audit-failure', tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-failure', commitmentId: 'commitment-failure', referenceType: 'commitment.created', createdAt: '2026-01-01T00:00:00.000Z' }])
        await repositories.outbox.append({ eventId: 'outbox-failure', tenantId: 'tenant-a', eventType: 'tus.checkout.created', aggregateId: 'cart-failure', payload: { commitmentIds: ['commitment-failure'], auditReferenceIds: ['audit-failure'] }, createdAt: 100 })
        throw new Error('simulated persistence failure')
      })
    } catch {
      rolledBack = true
    }
    const claim = await idempotency.claim({ tenantId: 'tenant-a', key: 'idem-failure', requestHash: 'hash-failure', now: 100, expiresAt: 1000 })
    console.log(JSON.stringify({ rolledBack, claim, commitment: await commitments.find('commitment-failure'), audits: audits.list('tenant-a'), outbox: outbox.list('tenant-a') }))
  `)

  assert.equal(result.rolledBack, true)
  assert.equal(result.claim.status, 'claimed')
  assert.equal(result.commitment, null)
  assert.deepEqual(result.audits, [])
  assert.deepEqual(result.outbox, [])
})

test('WU2 denies cross-tenant commitment reads without exposing the other tenant record', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const created = await application.checkout({ tenantId: 'tenant-b', actorId: 'actor-b', correlationId: 'corr-b', idempotencyKey: 'idem-b', cartId: 'cart-b', createdAt: '2026-01-01T00:00:00.000Z', requestHash: 'hash-b', expiresAt: 2000, lines: [{ lineId: 'line-b', context: 'product', merchantId: 'merchant-b', amount: 100, currency: 'ARS' }] })
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('token-a', { sessionId: 'session-a', subjectId: 'actor-a', tenantId: 'tenant-a', roles: ['staff'], permissions: ['tus:read'] })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const address = server.address()
    const response = await fetch('http://127.0.0.1:' + address.port + '/tus/commitments/' + created.commitments[0].commitmentId, { headers: { authorization: 'Bearer token-a', 'x-tenant-id': 'tenant-b' } })
    const body = await response.json()
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ status: response.status, body }))
  `)

  assert.equal(result.status, 403)
  assert.equal(result.body.code, 'FORBIDDEN')
  assert.equal(result.body.commitment, undefined)
})

test('WU2 keeps durable TUS records in PostgreSQL source-of-truth schema with tenant indexes', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260826100000_tus_commerce_api/migration.sql'), 'utf8')

  assert.match(schema, /model TusCommitment[\s\S]*?tenantId\s+String/)
  assert.match(schema, /model TusCommitment[\s\S]*?@@index\(\[tenantId, createdAt\]\)/)
  assert.match(schema, /model TusAuditReference[\s\S]*?tenantId\s+String/)
  assert.match(migration, /CREATE TABLE "TusCommitment"/)
  assert.match(migration, /CREATE INDEX "TusCommitment_tenantId_createdAt_idx"/)
  assert.match(migration, /CREATE TABLE "TusAuditReference"/)
})
