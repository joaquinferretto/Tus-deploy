import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const output = execFileSync(
    process.execPath,
    [tsxCli, '--eval', `(async () => {\n${FIXTURES}\n${source}\n})()`],
    { cwd: root, encoding: 'utf8' }
  )
  return JSON.parse(output.trim().split('\n').at(-1))
}

const FIXTURES = `
  const { TUS_CONTRACT_VERSION } = await import('./packages/contracts/src/tus.ts')
  const workModule = await import('./apps/api/src/tus/work/index.ts')
  const { InMemoryTrabajoStore, InMemoryTrabajoIdempotencyStore, InMemoryTrabajoOutboxStore, InMemoryTrabajoTransaction, ReservasTrabajoEnMemoria, ServicioTrabajo, TrabajoError } = workModule
  const provider = { tenantId: 'provider-tenant', actorId: 'provider-user', correlationId: 'corr-provider' }
  const customer = { tenantId: 'customer-tenant', actorId: 'customer-user', correlationId: 'corr-customer' }
  const at = '2026-09-24T10:00:00.000Z'
  const publication = { contractVersion: TUS_CONTRACT_VERSION, listingId: 'listing-1', tenantId: provider.tenantId, merchantId: 'provider-1', kind: 'service', name: 'Repair', description: 'Quote first', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, priceMinor: 100000n, priceSnapshot: { currency: 'ARS', minor: 100000n }, availabilityVersion: 1, published: true, policyVersion: 'policy-1', stock: null, durationMinutes: null, capacity: 1, workingHours: [], bookingMode: 'requiere_presupuesto', priceMode: 'requires_budget', createdAt: at, updatedAt: at }
  const commitment = (commitmentId, tenantId = customer.tenantId) => ({ contractVersion: TUS_CONTRACT_VERSION, commitmentId, cartId: 'cart-' + commitmentId, tenantId, merchantId: 'provider-1', context: 'service', amount: 1000, currency: 'ARS', status: 'pending', lineIds: ['line-1'], version: 1, createdAt: at, listingId: publication.listingId, quantity: 1, availabilityVersion: 1, policyVersion: 'policy-1', priceSnapshot: { currency: 'ARS', minor: 100000n } })
  const bookings = new Map()
  const booking = (bookingId, overrides = {}) => bookings.set(bookingId, { bookingId, tenantId: customer.tenantId, ownerTenantId: provider.tenantId, listingId: publication.listingId, status: 'confirmed', ...overrides })
  const build = (storeOverride) => {
    const store = storeOverride ?? new InMemoryTrabajoStore()
    const idempotency = new InMemoryTrabajoIdempotencyStore()
    const outbox = new InMemoryTrabajoOutboxStore()
    const reservations = new ReservasTrabajoEnMemoria(async (ownerTenantId, id) => { const found = bookings.get(id); return found && found.ownerTenantId === ownerTenantId ? found : null })
    return { store, idempotency, outbox, work: new ServicioTrabajo(new InMemoryTrabajoTransaction({ work: store, idempotency, outbox, reservations }), () => Date.parse(at)) }
  }
  const codeOf = async (promise) => { try { await promise; return 'ok' } catch (error) { return error instanceof TrabajoError ? error.code : 'unknown:' + error.message } }
  const accept = (work, commitmentId, key, extra = {}) => work.acceptCommitment({ ...provider, commitment: commitment(commitmentId), publication, idempotencyKey: key, requestHash: 'client-' + key, createdAt: at, ...extra })
`

test('WEB-08F projects the work file per audience and hides it from foreign tenants', () => {
  const result = runTypeScriptScenario(`
    const { work } = build()
    const accepted = await accept(work, 'commitment-1', 'accept-1')
    const trabajoId = accepted.work.trabajoId
    const confirmed = await work.createDiagnosis({ ...provider, trabajoId, descripcionOriginal: 'Confirmed finding', idempotencyKey: 'dx-1', requestHash: 'h', createdAt: at })
    await work.confirmDiagnosis({ ...provider, trabajoId, diagnosticoId: confirmed.diagnosis.diagnosticoId, expectedVersion: 1, idempotencyKey: 'dx-1-confirm', requestHash: 'h', createdAt: at })
    await work.createDiagnosis({ ...provider, trabajoId, descripcionOriginal: 'Internal draft note', idempotencyKey: 'dx-2', requestHash: 'h', createdAt: at })
    await work.createBudget({ ...provider, trabajoId, currency: 'ARS', scope: 'Repair', totalMinor: '5000', lines: [{ lineId: 'l1', description: 'Part', quantity: 1, unitAmountMinor: '5000', totalAmountMinor: '5000' }], idempotencyKey: 'budget-1', requestHash: 'h', createdAt: at })
    await work.recordEvidence({ ...provider, trabajoId, evidenceId: 'ev-1', phase: 'diagnosis', reference: 'storage://ev-1', metadata: { kind: 'photo' }, occurredAt: at, idempotencyKey: 'ev-1', requestHash: 'h', createdAt: at })
    const customerView = await work.getWork(customer, trabajoId)
    const providerView = await work.getWork(provider, trabajoId)
    const foreignCode = await codeOf(work.getWork({ tenantId: 'foreign-tenant', actorId: 'x', correlationId: 'c' }, trabajoId))
    const otherProviderCode = await codeOf(work.getWork({ tenantId: 'other-provider-tenant', actorId: 'x', correlationId: 'c' }, trabajoId))
    const foreignList = await work.listWorks({ tenantId: 'foreign-tenant', actorId: 'x', correlationId: 'c' })
    console.log(JSON.stringify({
      customer: { viewer: customerView.viewer, diagnoses: customerView.diagnoses.map((d) => d.status), budgets: customerView.budgets.length, evidence: customerView.evidence.length, transitionKeys: Object.keys(customerView.transitions[0]).sort(), budgetKeys: Object.keys(customerView.budgets[0]) },
      provider: { viewer: providerView.viewer, diagnoses: providerView.diagnoses.map((d) => d.status), transitionKeys: Object.keys(providerView.transitions[0]).sort() },
      foreignCode, otherProviderCode, foreignList: foreignList.length,
    }))
  `)

  assert.equal(result.customer.viewer, 'customer')
  assert.deepEqual(result.customer.diagnoses, ['confirmed'])
  assert.equal(result.customer.budgets, 1)
  assert.equal(result.customer.evidence, 1)
  assert.equal(result.customer.budgetKeys.includes('recordId'), false)
  assert.equal(result.customer.budgetKeys.includes('correlationId'), false)
  for (const keys of [result.customer.transitionKeys, result.provider.transitionKeys]) {
    assert.equal(keys.includes('actorId'), false)
    assert.equal(keys.includes('correlationId'), false)
  }
  assert.equal(result.provider.viewer, 'provider')
  assert.deepEqual(result.provider.diagnoses, ['confirmed', 'draft'])
  assert.equal(result.foreignCode, 'NOT_FOUND')
  assert.equal(result.otherProviderCode, 'NOT_FOUND')
  assert.equal(result.foreignList, 0)
})

test('WEB-08F applies the projection over HTTP with tenant scope from the session', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = await import('./apps/api/src/tus/composition/index.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { createApp } = await import('./apps/api/src/server.ts')
    const application = createTusApplication()
    const providerSession = { sessionId: 'p', subjectId: 'provider-user', tenantId: 'provider-tenant', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read', 'tus:work:write', 'tus:work:read'], correlationId: 'corr-p' }
    const customerSession = { sessionId: 'c', subjectId: 'customer-user', tenantId: 'customer-tenant', roles: ['customer'], permissions: ['tus:checkout', 'tus:work:accept', 'tus:work:read'], correlationId: 'corr-c' }
    const foreignSession = { sessionId: 'f', subjectId: 'foreign-user', tenantId: 'foreign-tenant', roles: ['customer'], permissions: ['tus:work:read'], correlationId: 'corr-f' }
    await application.marketplace.onboard(providerSession, { merchantId: 'provider-1', cohort: 'repairs-trades', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1' })
    const listing = await application.marketplace.createListing(providerSession, { merchantId: 'provider-1', kind: 'service', name: 'Estimate', description: 'Quote', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, bookingMode: 'requiere_presupuesto', priceMode: 'requires_budget', capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '12:00' }] })
    await application.marketplace.publishListing(providerSession, listing.listingId)
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('provider-token', providerSession)
    sessions.add('customer-token', customerSession)
    sessions.add('foreign-token', foreignSession)
    const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const call = async (token, method, path, body, key) => {
      const response = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-correlation-id': 'corr-' + (key ?? path), ...(key ? { 'idempotency-key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      return { status: response.status, body: await response.json() }
    }
    try {
      const lines = [{ lineId: 'line-1', listingId: listing.listingId, context: 'service', quantity: 1, availabilityVersion: 1, price: 1000 }]
      const checkout = await call('customer-token', 'POST', '/tus/v1/marketplace/checkout', { cartId: 'cart-1', requestHash: 'checkout-hash', lines }, 'checkout-1')
      const duplicateCart = await call('customer-token', 'POST', '/tus/v1/marketplace/checkout', { cartId: 'cart-1', requestHash: 'checkout-hash-2', lines }, 'checkout-2')
      const checkoutReplay = await call('customer-token', 'POST', '/tus/v1/marketplace/checkout', { cartId: 'cart-1', requestHash: 'checkout-hash', lines }, 'checkout-1')
      const commitmentId = checkout.body.commitments[0].commitmentId
      const accepted = await call('provider-token', 'POST', '/tus/v1/work/commitments/' + commitmentId + '/accept', { requestHash: 'accept-hash' }, 'accept-1')
      const acceptedAgain = await call('provider-token', 'POST', '/tus/v1/work/commitments/' + commitmentId + '/accept', { requestHash: 'another-client-hash' }, 'accept-2')
      const workId = accepted.body.work.trabajoId
      await call('provider-token', 'POST', '/tus/v1/work/' + workId + '/diagnosis', { description: 'Draft only', requestHash: 'dx' }, 'dx-1')
      const customerView = await call('customer-token', 'GET', '/tus/v1/work/' + workId)
      const providerView = await call('provider-token', 'GET', '/tus/v1/work/' + workId)
      const foreignView = await call('foreign-token', 'GET', '/tus/v1/work/' + workId)
      const spoofed = await fetch(base + '/tus/v1/work/' + workId, { headers: { authorization: 'Bearer foreign-token', 'x-tenant-id': 'customer-tenant', 'x-correlation-id': 'corr-spoof' } })
      console.log(JSON.stringify({
        checkout: checkout.status, duplicateCart: { status: duplicateCart.status, code: duplicateCart.body.code, ids: duplicateCart.body.details?.commitmentIds }, checkoutReplay: checkoutReplay.status, commitmentId,
        accepted: accepted.status, acceptedAgain: { status: acceptedAgain.status, replay: acceptedAgain.body.status, workId: acceptedAgain.body.work?.trabajoId }, workId,
        customer: { status: customerView.status, viewer: customerView.body.viewer, diagnoses: customerView.body.diagnoses.length, actorInTransitions: customerView.body.transitions.some((t) => 'actorId' in t) },
        provider: { viewer: providerView.body.viewer, diagnoses: providerView.body.diagnoses.length },
        foreign: foreignView.status, spoofed: spoofed.status,
      }))
    } finally { server.close() }
  `)

  assert.equal(result.checkout, 201)
  assert.equal(result.duplicateCart.status, 409)
  assert.equal(result.duplicateCart.code, 'CART_ALREADY_CHECKED_OUT')
  assert.deepEqual(result.duplicateCart.ids, [result.commitmentId])
  assert.equal(result.checkoutReplay, 200)
  assert.equal(result.accepted, 201)
  assert.deepEqual(result.acceptedAgain, { status: 200, replay: 'replay', workId: result.workId })
  assert.deepEqual(result.customer, {
    status: 200,
    viewer: 'customer',
    diagnoses: 0,
    actorInTransitions: false,
  })
  assert.deepEqual(result.provider, { viewer: 'provider', diagnoses: 1 })
  assert.equal(result.foreign, 404)
  assert.equal(result.spoofed, 403)
})

test('WEB-08G derives the idempotency fingerprint on the server and deduplicates work creation', () => {
  const result = runTypeScriptScenario(`
    const { store, work } = build()
    const first = await accept(work, 'commitment-1', 'accept-1')
    // Same key and payload, different client hash: the server fingerprint decides, so it is a replay.
    const sameRequest = await work.acceptCommitment({ ...provider, commitment: commitment('commitment-1'), publication, idempotencyKey: 'accept-1', requestHash: 'client-hash-changed', createdAt: '2026-09-24T11:00:00.000Z' })
    // Same key and client hash, different payload: conflict instead of a stale replay.
    const reusedKey = await codeOf(work.acceptCommitment({ ...provider, commitment: commitment('commitment-2'), publication, idempotencyKey: 'accept-1', requestHash: 'client-accept-1', createdAt: at }))
    // Same key reused for another operation on the same tenant: conflict.
    const crossOperation = await codeOf(work.createDiagnosis({ ...provider, trabajoId: first.work.trabajoId, descripcionOriginal: 'x', idempotencyKey: 'accept-1', requestHash: 'client-accept-1', createdAt: at }))
    // New key for an already accepted commitment: existing work, marked as replay, no new facts.
    const otherKey = await accept(work, 'commitment-1', 'accept-other')
    // Concurrent retries with distinct keys: exactly one execution.
    const concurrent = await Promise.all(['c-1', 'c-2', 'c-3', 'c-4', 'c-5'].map((key) => accept(work, 'commitment-3', key)))
    const snapshot = store.snapshot()
    const transitionsFor = (trabajoId) => [...snapshot.transitions.values()].filter((t) => t.trabajoId === trabajoId).length
    // Same evidence and budget decision retried with a new key: replay of the existing record.
    await work.recordEvidence({ ...provider, trabajoId: first.work.trabajoId, evidenceId: 'ev-1', phase: 'request', reference: 'storage://1', metadata: {}, occurredAt: at, idempotencyKey: 'ev-a', requestHash: 'h', createdAt: at })
    const evidenceRetry = await work.recordEvidence({ ...provider, trabajoId: first.work.trabajoId, evidenceId: 'ev-1', phase: 'request', reference: 'storage://1', metadata: {}, occurredAt: at, idempotencyKey: 'ev-b', requestHash: 'h', createdAt: at })
    const { fingerprintRequest } = workModule
    console.log(JSON.stringify({
      first: first.status, sameRequest: sameRequest.status, reusedKey, crossOperation, otherKey: { status: otherKey.status, same: otherKey.work.trabajoId === first.work.trabajoId },
      works: snapshot.works.size, firstTransitions: transitionsFor(first.work.trabajoId),
      concurrent: concurrent.map((r) => r.status).sort(), concurrentIds: new Set(concurrent.map((r) => r.work.trabajoId)).size, concurrentTransitions: transitionsFor(concurrent[0].work.trabajoId),
      evidenceRetry: evidenceRetry.status,
      stableHash: fingerprintRequest({ operation: 'x', payload: { b: 1, a: [2n, { d: undefined, c: 3 }] } }) === fingerprintRequest({ operation: 'x', payload: { a: [2n, { c: 3 }], b: 1 } }),
    }))
  `)

  assert.equal(result.first, 'executed')
  assert.equal(result.sameRequest, 'replay')
  assert.equal(result.reusedKey, 'CONFLICT')
  assert.equal(result.crossOperation, 'CONFLICT')
  assert.deepEqual(result.otherKey, { status: 'replay', same: true })
  assert.equal(result.works, 2)
  assert.equal(result.firstTransitions, 1)
  assert.deepEqual(result.concurrent, ['executed', 'replay', 'replay', 'replay', 'replay'])
  assert.equal(result.concurrentIds, 1)
  assert.equal(result.concurrentTransitions, 1)
  assert.equal(result.evidenceRetry, 'replay')
  assert.equal(result.stableHash, true)
})

test('WEB-08G/H links a reservation to at most one work and validates it inside the transaction', () => {
  const result = runTypeScriptScenario(`
    const { store, work } = build()
    booking('reservation-1')
    booking('reservation-cancelled', { status: 'cancelled' })
    booking('reservation-foreign-customer', { tenantId: 'other-customer' })
    booking('reservation-other-listing', { listingId: 'listing-2' })
    booking('reservation-other-provider', { ownerTenantId: 'other-provider-tenant' })
    const linked = await accept(work, 'commitment-1', 'accept-1', { reservationId: 'reservation-1' })
    const secondWork = await codeOf(accept(work, 'commitment-2', 'accept-2', { reservationId: 'reservation-1' }))
    const swapReservation = await codeOf(accept(work, 'commitment-1', 'accept-3', { reservationId: 'reservation-cancelled' }))
    const invalid = {}
    for (const id of ['reservation-cancelled', 'reservation-foreign-customer', 'reservation-other-listing', 'reservation-other-provider', 'reservation-missing'])
      invalid[id] = await codeOf(accept(work, 'commitment-' + id, 'accept-' + id, { reservationId: id }))
    // The reservation changes between an earlier read and the transaction: the in-transaction check wins.
    booking('reservation-late')
    bookings.get('reservation-late').status = 'cancelled'
    const late = await codeOf(accept(work, 'commitment-late', 'accept-late', { reservationId: 'reservation-late' }))
    const retryAfterFailure = await codeOf(accept(work, 'commitment-2', 'accept-2', { reservationId: 'reservation-1' }))
    console.log(JSON.stringify({ linked: linked.work.reservaId, secondWork, swapReservation, invalid, late, retryAfterFailure, works: [...store.snapshot().works.values()].map((w) => w.commitmentId) }))
  `)

  assert.equal(result.linked, 'reservation-1')
  assert.equal(result.secondWork, 'RESERVATION_ALREADY_LINKED')
  assert.equal(result.swapReservation, 'INVALID_RESERVATION_LINK')
  for (const code of Object.values(result.invalid)) assert.equal(code, 'INVALID_RESERVATION_LINK')
  assert.equal(result.late, 'INVALID_RESERVATION_LINK')
  assert.equal(result.retryAfterFailure, 'RESERVATION_ALREADY_LINKED')
  assert.deepEqual(result.works, ['commitment-1'])
})

test('WEB-08H rolls back work, reservation link and idempotency claim on an intermediate failure', () => {
  const result = runTypeScriptScenario(`
    class FailingStore extends InMemoryTrabajoStore {
      failNext = true
      async appendTransition(transition) {
        if (this.failNext) { this.failNext = false; throw new Error('simulated failure after work insert') }
        return super.appendTransition(transition)
      }
    }
    const { store, idempotency, outbox, work } = build(new FailingStore())
    booking('reservation-1')
    let failure = ''
    try { await accept(work, 'commitment-1', 'accept-1', { reservationId: 'reservation-1' }) } catch (error) { failure = error.message }
    const afterFailure = { works: store.snapshot().works.size, audits: store.snapshot().audits.size, idempotency: idempotency.snapshot().size, outbox: outbox.list(customer.tenantId).length }
    const retried = await accept(work, 'commitment-1', 'accept-1', { reservationId: 'reservation-1' })
    console.log(JSON.stringify({ failure, afterFailure, retried: { status: retried.status, reservaId: retried.work.reservaId }, works: store.snapshot().works.size, outbox: outbox.list(customer.tenantId).length }))
  `)

  assert.equal(result.failure, 'simulated failure after work insert')
  assert.deepEqual(result.afterFailure, { works: 0, audits: 0, idempotency: 0, outbox: 0 })
  assert.deepEqual(result.retried, { status: 'executed', reservaId: 'reservation-1' })
  assert.equal(result.works, 1)
  assert.equal(result.outbox, 1)
})

test('WEB-08H Prisma adapter locks the reservation with the transaction client and retries unique races', () => {
  const result = runTypeScriptScenario(`
    const { PrismaTrabajoReservaStore, PrismaTrabajoTransaction } = await import('./apps/api/src/tus/adapters/prisma-work.ts')
    const calls = []
    const reservas = new PrismaTrabajoReservaStore({ reserva: { updateMany: async (input) => (calls.push(input), { count: input.where.reservaId === 'reservation-1' ? 1 : 0 }) } })
    const locked = await reservas.lockForWork({ ownerTenantId: 'provider-tenant', reservationId: 'reservation-1', customerTenantId: 'customer-tenant', listingId: 'listing-1' })
    const refused = await reservas.lockForWork({ ownerTenantId: 'provider-tenant', reservationId: 'reservation-2', customerTenantId: 'customer-tenant', listingId: 'listing-1' })
    const txClient = { reserva: { updateMany: async () => ({ count: 1 }) }, marker: 'tx' }
    let attempts = 0
    let usedTxClient = false
    const transaction = new PrismaTrabajoTransaction({ $transaction: async (operation, options) => {
      attempts += 1
      if (options?.isolationLevel !== 'Serializable') throw new Error('isolation')
      if (attempts === 1) { const error = new Error('unique'); error.code = 'P2002'; throw error }
      return operation(txClient)
    } })
    await transaction.run(async (repositories) => {
      usedTxClient = await repositories.reservations.lockForWork({ ownerTenantId: 'p', reservationId: 'r', customerTenantId: 'c', listingId: 'l' })
    })
    let exhausted = ''
    const failing = new PrismaTrabajoTransaction({ $transaction: async () => { const error = new Error('unique'); error.code = 'P2002'; throw error } })
    try { await failing.run(async () => undefined) } catch (error) { exhausted = error.code }
    console.log(JSON.stringify({ locked, refused, where: calls[0].where, data: calls[0].data, attempts, usedTxClient, exhausted }))
  `)

  assert.equal(result.locked, true)
  assert.equal(result.refused, false)
  assert.deepEqual(result.where, {
    tenantId: 'provider-tenant',
    reservaId: 'reservation-1',
    clienteTenantId: 'customer-tenant',
    publicacionId: 'listing-1',
    estado: 'confirmed',
  })
  assert.deepEqual(result.data, { estado: 'confirmed' })
  assert.equal(result.attempts, 2)
  assert.equal(result.usedTxClient, true)
  assert.equal(result.exhausted, 'CONCURRENT_MODIFICATION')
})
