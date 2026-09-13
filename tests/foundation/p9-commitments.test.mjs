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

test('WU2 commits product and service aggregates atomically and replays the original result', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const application = createTusApplication({ now: () => 1000 })
    const command = {
      tenantId: 'customer-a', actorId: 'customer-a', correlationId: 'corr-1',
      idempotencyKey: 'checkout-1', cartId: 'cart-1', createdAt: new Date(1000).toISOString(),
      requestHash: 'hash-1', recordId: 'record-1', expiresAt: 5000,
      lines: [
        { lineId: 'product-line', context: 'product', merchantId: 'merchant-a', amount: 1200, currency: 'ARS' },
        { lineId: 'service-line', context: 'service', merchantId: 'merchant-a', amount: 2400, currency: 'ARS' },
      ],
    }
    const first = await application.checkout(command)
    const replay = await application.checkout(command)
    const conflict = await application.checkout({ ...command, requestHash: 'hash-2' })
    let missingIdempotencyError = ''
    try {
      await application.checkout({ ...command, idempotencyKey: undefined })
    } catch (error) {
      missingIdempotencyError = error.message
    }
    console.log(JSON.stringify({ first, replay, conflict, missingIdempotencyError, outbox: application.outbox.list('customer-a'), audits: application['dependencies'].audits.list('customer-a') }))
  `)

  assert.equal(result.first.status, 'executed')
  assert.deepEqual(result.first.commitments.map(({ context, status }) => [context, status]), [['product', 'pending'], ['service', 'pending']])
  assert.equal(result.replay.status, 'replay')
  assert.equal(result.replay.commitments[0].commitmentId, result.first.commitments[0].commitmentId)
  assert.equal(result.conflict.status, 'conflict')
  assert.equal(result.missingIdempotencyError, 'idempotency key and request fingerprint are required')
  assert.equal(result.outbox.length, 1)
  assert.equal(result.audits.length, 2)
})

test('WU2 rolls back every durable commitment side effect when an outbox write fails', () => {
  const result = runTypeScriptScenario(`
    const { TusApplicationService } = (await import('./apps/api/src/tus/application/tus-application-service.ts')).default
    const { InMemoryTusCommitmentStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusCompensationStore, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const commitments = new InMemoryTusCommitmentStore()
    const audits = new AlmacenReferenciasAuditoriaEnMemoria()
    const idempotency = new InMemoryTusIdempotencyStore()
    const outbox = new InMemoryTusOutboxStore()
    const failingOutbox = outbox
    failingOutbox.append = async () => { throw new Error('outbox unavailable') }
    const compensations = new InMemoryTusCompensationStore()
    const application = new TusApplicationService({ commitments, audits, idempotency, compensations, outbox: failingOutbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, compensations, outbox: failingOutbox }) })
    try {
      await application.checkout({ tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a', idempotencyKey: 'atomic-1', cartId: 'cart-atomic', createdAt: new Date(1000).toISOString(), requestHash: 'hash-a', recordId: 'record-a', expiresAt: 5000, lines: [{ lineId: 'line-a', context: 'product', merchantId: 'merchant-a', amount: 100, currency: 'ARS' }] })
    } catch (error) {
      console.log(JSON.stringify({ error: error.message, commitment: await commitments.find('cart-atomic-product'), audits: audits.list('tenant-a'), idempotency: await idempotency.claim({ tenantId: 'tenant-a', key: 'atomic-1', requestHash: 'hash-a', now: 1000, expiresAt: 5000 }), outbox: outbox.list('tenant-a') }))
    }
  `)

  assert.equal(result.error, 'outbox unavailable')
  assert.equal(result.commitment, null)
  assert.deepEqual(result.audits, [])
  assert.equal(result.idempotency.status, 'claimed')
  assert.deepEqual(result.outbox, [])
})

test('WU2 persists lifecycle transitions, version conflicts, compensation, and outbox recovery across service reconstruction', () => {
  const result = runTypeScriptScenario(`
    const { TusApplicationService } = (await import('./apps/api/src/tus/application/tus-application-service.ts')).default
    const { InMemoryTusCommitmentStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusCompensationStore, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const commitments = new InMemoryTusCommitmentStore()
    const audits = new AlmacenReferenciasAuditoriaEnMemoria()
    const idempotency = new InMemoryTusIdempotencyStore()
    const outbox = new InMemoryTusOutboxStore()
    const compensations = new InMemoryTusCompensationStore()
    const dependencies = { commitments, audits, idempotency, compensations, outbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, compensations, outbox }), now: () => 1000 }
    const first = new TusApplicationService(dependencies)
    const created = await first.checkout({ tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a', idempotencyKey: 'create-1', cartId: 'cart-life', createdAt: new Date(1000).toISOString(), requestHash: 'create-hash', recordId: 'record-life', expiresAt: 5000, lines: [{ lineId: 'line-a', context: 'product', merchantId: 'merchant-a', amount: 100, currency: 'ARS' }] })
    const commitmentId = created.commitments[0].commitmentId
    const confirmed = await first.transitionCommitment({ tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-confirm', commitmentId, toStatus: 'confirmed', expectedVersion: 1, idempotencyKey: 'transition-1', requestHash: 'transition-hash', reason: 'merchant accepted', createdAt: new Date(1100).toISOString() })
    const replay = await first.transitionCommitment({ tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-confirm', commitmentId, toStatus: 'confirmed', expectedVersion: 1, idempotencyKey: 'transition-1', requestHash: 'transition-hash', reason: 'merchant accepted', createdAt: new Date(1100).toISOString() })
    let conflict = 'none'
    try { await first.transitionCommitment({ tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-stale', commitmentId, toStatus: 'fulfilled', expectedVersion: 1, idempotencyKey: 'transition-2', requestHash: 'transition-2-hash', reason: 'stale worker', createdAt: new Date(1200).toISOString() }) } catch (error) { conflict = error.code }
    const restarted = new TusApplicationService(dependencies)
    const compensated = await restarted.compensateCommitment({ tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-comp', commitmentId, expectedVersion: 2, idempotencyKey: 'comp-1', requestHash: 'comp-hash', amount: 100, reason: 'merchant cancellation', createdAt: new Date(1300).toISOString() })
    const claimed = await outbox.claim('tenant-a', 'worker-1', 1400, 100)
    const recovered = await outbox.recover(1600)
    console.log(JSON.stringify({ confirmed, replay, conflict, compensated, persisted: await restarted.getCommitment({ tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-read' }, commitmentId), claimed, recovered, events: outbox.list('tenant-a').map(({ eventType, status, attempts }) => ({ eventType, status, attempts })) }))
  `)

  assert.equal(result.confirmed.commitment.status, 'confirmed')
  assert.equal(result.replay.status, 'replay')
  assert.equal(result.conflict, 'VERSION_CONFLICT')
  assert.equal(result.compensated.commitment.status, 'compensated')
  assert.equal(result.compensated.compensation.amount, 100)
  assert.equal(result.persisted.commitment.status, 'compensated')
  assert.equal(result.claimed.status, 'processing')
  assert.equal(result.recovered, 1)
  assert.ok(result.events.some(({ eventType }) => eventType === 'tus.commitment.compensated'))
})

test('WU2 proves authenticated lifecycle HTTP authority and preserves tenant isolation', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('token-a', { sessionId: 'session-a', subjectId: 'actor-a', tenantId: 'tenant-a', roles: ['customer'], permissions: ['tus:checkout', 'tus:read', 'tus:commitments:write'] })
    sessions.add('token-b', { sessionId: 'session-b', subjectId: 'actor-b', tenantId: 'tenant-b', roles: ['customer'], permissions: ['tus:checkout', 'tus:read', 'tus:commitments:write'] })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const headers = (token, correlation, key) => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-correlation-id': correlation, 'idempotency-key': key })
    const checkoutResponse = await fetch(base + '/tus/checkout', { method: 'POST', headers: headers('token-a', 'corr-a', 'http-create'), body: JSON.stringify({ cartId: 'http-cart', requestHash: 'http-hash', lines: [{ lineId: 'http-line', context: 'service', merchantId: 'merchant-a', amount: 200, currency: 'ARS' }] }) })
    const checkout = await checkoutResponse.json()
    const commitmentId = checkout.commitments[0].commitmentId
    const transitionResponse = await fetch(base + '/tus/commitments/' + commitmentId + '/transition', { method: 'POST', headers: headers('token-a', 'corr-transition', 'http-transition'), body: JSON.stringify({ toStatus: 'confirmed', expectedVersion: 1, requestHash: 'http-transition-hash', reason: 'accepted' }) })
    const transition = await transitionResponse.json()
    const foreignResponse = await fetch(base + '/tus/commitments/' + commitmentId, { headers: { authorization: 'Bearer token-b', 'x-correlation-id': 'corr-b' } })
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    console.log(JSON.stringify({ checkoutStatus: checkoutResponse.status, transitionStatus: transitionResponse.status, transition, foreignStatus: foreignResponse.status }))
  `)

  assert.equal(result.checkoutStatus, 201)
  assert.equal(result.transitionStatus, 200)
  assert.equal(result.transition.commitment.status, 'confirmed')
  assert.equal(result.foreignStatus, 403)
})

test('WU2 adds additive durable commitment, transition, and compensation schema with a rollback-safe migration', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260827090400_tus_commitments/migration.sql'), 'utf8')

  assert.match(schema, /model TusCommitment[\s\S]*?version\s+Int/)
  assert.match(schema, /model TusCommitmentCompensation[\s\S]*?commitmentId\s+String/)
  assert.match(schema, /model TusCommitmentTransition[\s\S]*?fromStatus\s+String/)
  assert.match(schema, /model TusAuditReference[\s\S]*?metadata\s+Json\?/)
  assert.match(migration, /ALTER TABLE "TusCommitment"[\s\S]*ADD COLUMN IF NOT EXISTS "version" INTEGER/)
  assert.match(migration, /ALTER TABLE "TusAuditReference"[\s\S]*ADD COLUMN IF NOT EXISTS "metadata" JSONB/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "TusCommitmentCompensation"/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "TusCommitmentTransition"/)
  assert.match(migration, /preserve.*audit.*outbox/i)
})
