import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const output = execFileSync(
    process.execPath,
    [tsxCli, '--eval', `(async () => {\n${source}\n})()`],
    {
      cwd: root,
      encoding: 'utf8',
    }
  )
  return JSON.parse(output.trim())
}

test('WEB-08B records a tenant-scoped budget workflow with replay, locking, audit, and outbox facts', () => {
  const result = runTypeScriptScenario(`
    const { TUS_CONTRACT_VERSION } = await import('./packages/contracts/src/tus.ts')
    const { InMemoryTrabajoStore, InMemoryTrabajoIdempotencyStore, InMemoryTrabajoOutboxStore, InMemoryTrabajoTransaction, ServicioTrabajo, TrabajoError } = await import('./apps/api/src/tus/work/index.ts')
    const store = new InMemoryTrabajoStore()
    const outbox = new InMemoryTrabajoOutboxStore()
    const work = new ServicioTrabajo(new InMemoryTrabajoTransaction({ work: store, idempotency: new InMemoryTrabajoIdempotencyStore(), outbox }), () => Date.parse('2026-09-17T10:00:00.000Z'))
    const provider = { tenantId: 'provider-tenant', actorId: 'provider-user', correlationId: 'corr-provider' }
    const customer = { tenantId: 'customer-tenant', actorId: 'customer-user', correlationId: 'corr-customer' }
    const publication = { contractVersion: TUS_CONTRACT_VERSION, listingId: 'listing-1', tenantId: provider.tenantId, merchantId: 'provider-1', kind: 'service', name: 'Repair estimate', description: 'Quote first', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, priceMinor: 100000n, priceSnapshot: { currency: 'ARS', minor: 100000n }, availabilityVersion: 1, published: true, policyVersion: 'policy-1', stock: null, durationMinutes: null, capacity: 1, workingHours: [], bookingMode: 'requiere_presupuesto', priceMode: 'requires_budget', createdAt: '2026-09-17T10:00:00.000Z', updatedAt: '2026-09-17T10:00:00.000Z' }
    const commitment = { contractVersion: TUS_CONTRACT_VERSION, commitmentId: 'commitment-1', cartId: 'cart-1', tenantId: customer.tenantId, merchantId: 'provider-1', context: 'service', amount: 1000, currency: 'ARS', status: 'pending', lineIds: ['line-1'], version: 1, createdAt: '2026-09-17T10:00:00.000Z', listingId: publication.listingId, quantity: 1, availabilityVersion: 1, policyVersion: 'policy-1', priceSnapshot: { currency: 'ARS', minor: 100000n } }
    const accepted = await work.acceptCommitment({ ...provider, commitment, publication, idempotencyKey: 'accept-1', requestHash: 'hash-accept-1', createdAt: '2026-09-17T10:00:00.000Z' })
     const replay = await work.acceptCommitment({ ...provider, commitment, publication, idempotencyKey: 'accept-1', requestHash: 'hash-accept-1', createdAt: '2026-09-17T10:00:00.000Z' })
     let customerDiagnosisCode = ''
     try { await work.createDiagnosis({ ...customer, trabajoId: accepted.work.trabajoId, descripcionOriginal: 'forbidden diagnosis', idempotencyKey: 'diagnosis-customer', requestHash: 'hash-diagnosis-customer', createdAt: '2026-09-17T10:00:00.000Z' }) } catch (error) { customerDiagnosisCode = error instanceof TrabajoError ? error.code : 'unknown' }
     const diagnosis = await work.createDiagnosis({ ...provider, trabajoId: accepted.work.trabajoId, descripcionOriginal: 'Motor does not start', idempotencyKey: 'diagnosis-1', requestHash: 'hash-diagnosis-1', createdAt: '2026-09-17T10:01:00.000Z' })
     const confirmedDiagnosis = await work.confirmDiagnosis({ ...provider, trabajoId: accepted.work.trabajoId, diagnosticoId: diagnosis.diagnosis.diagnosticoId, expectedVersion: 1, idempotencyKey: 'confirm-1', requestHash: 'hash-confirm-1', createdAt: '2026-09-17T10:02:00.000Z' })
     let customerBudgetCode = ''
     try { await work.createBudget({ ...customer, trabajoId: accepted.work.trabajoId, currency: 'ARS', scope: 'forbidden budget', totalMinor: '1', lines: [{ lineId: 'budget-line-customer', description: 'Forbidden', quantity: 1, unitAmountMinor: '1', totalAmountMinor: '1' }], idempotencyKey: 'budget-customer', requestHash: 'hash-budget-customer', createdAt: '2026-09-17T10:02:30.000Z' }) } catch (error) { customerBudgetCode = error instanceof TrabajoError ? error.code : 'unknown' }
     const budget = await work.createBudget({ ...provider, trabajoId: accepted.work.trabajoId, currency: 'ARS', scope: 'Replace starter', totalMinor: '500000', lines: [{ lineId: 'budget-line-1', description: 'Starter motor', quantity: 1, unitAmountMinor: '500000', totalAmountMinor: '500000' }], idempotencyKey: 'budget-1', requestHash: 'hash-budget-1', createdAt: '2026-09-17T10:03:00.000Z' })
     let providerDecisionCode = ''
     try { await work.decideBudget({ ...provider, trabajoId: accepted.work.trabajoId, presupuestoId: budget.budget.presupuestoId, presupuestoVersion: budget.budget.version, decision: 'accepted', idempotencyKey: 'decision-provider', requestHash: 'hash-decision-provider', createdAt: '2026-09-17T10:03:30.000Z' }) } catch (error) { providerDecisionCode = error instanceof TrabajoError ? error.code : 'unknown' }
     const decision = await work.decideBudget({ ...customer, trabajoId: accepted.work.trabajoId, presupuestoId: budget.budget.presupuestoId, presupuestoVersion: budget.budget.version, decision: 'accepted', idempotencyKey: 'decision-1', requestHash: 'hash-decision-1', createdAt: '2026-09-17T10:04:00.000Z' })
    const decisionReplay = await work.decideBudget({ ...customer, trabajoId: accepted.work.trabajoId, presupuestoId: budget.budget.presupuestoId, presupuestoVersion: budget.budget.version, decision: 'accepted', idempotencyKey: 'decision-1', requestHash: 'hash-decision-1', createdAt: '2026-09-17T10:04:00.000Z' })
    let staleCode = ''
    try { await work.startWork({ ...provider, trabajoId: accepted.work.trabajoId, expectedVersion: decision.work.version - 1, idempotencyKey: 'start-stale', requestHash: 'hash-start-stale', createdAt: '2026-09-17T10:05:00.000Z' }) } catch (error) { staleCode = error instanceof TrabajoError ? error.code : 'unknown' }
     const started = await work.startWork({ ...provider, trabajoId: accepted.work.trabajoId, expectedVersion: decision.work.version, idempotencyKey: 'start-1', requestHash: 'hash-start-1', createdAt: '2026-09-17T10:05:00.000Z' })
     let customerCancelCode = ''
     try { await work.cancelWork({ ...customer, trabajoId: accepted.work.trabajoId, expectedVersion: started.work.version, idempotencyKey: 'cancel-customer', requestHash: 'hash-cancel-customer', createdAt: '2026-09-17T10:05:30.000Z' }) } catch (error) { customerCancelCode = error instanceof TrabajoError ? error.code : 'unknown' }
     let customerCompleteCode = ''
     try { await work.completeWork({ ...customer, trabajoId: accepted.work.trabajoId, expectedVersion: started.work.version, idempotencyKey: 'complete-customer', requestHash: 'hash-complete-customer', createdAt: '2026-09-17T10:05:45.000Z' }) } catch (error) { customerCompleteCode = error instanceof TrabajoError ? error.code : 'unknown' }
     let customerEvidenceCode = ''
     try { await work.recordEvidence({ ...customer, trabajoId: accepted.work.trabajoId, evidenceId: 'evidence-customer', phase: 'execution', reference: 'forbidden://evidence', metadata: {}, occurredAt: '2026-09-17T10:05:45.000Z', idempotencyKey: 'evidence-customer', requestHash: 'hash-evidence-customer', createdAt: '2026-09-17T10:05:45.000Z' }) } catch (error) { customerEvidenceCode = error instanceof TrabajoError ? error.code : 'unknown' }
    const cancellable = await work.acceptCommitment({ ...provider, commitment: { ...commitment, commitmentId: 'commitment-cancel', cartId: 'cart-cancel' }, publication, idempotencyKey: 'accept-cancel', requestHash: 'hash-accept-cancel', createdAt: '2026-09-17T10:05:30.000Z' })
    const cancelled = await work.cancelWork({ ...provider, trabajoId: cancellable.work.trabajoId, expectedVersion: cancellable.work.version, idempotencyKey: 'cancel-provider', requestHash: 'hash-cancel-provider', createdAt: '2026-09-17T10:05:31.000Z' })
    const cancelledReplay = await work.cancelWork({ ...provider, trabajoId: cancellable.work.trabajoId, expectedVersion: cancellable.work.version, idempotencyKey: 'cancel-provider', requestHash: 'hash-cancel-provider', createdAt: '2026-09-17T10:05:31.000Z' })
    let terminalCancelCode = ''
    try { await work.cancelWork({ ...provider, trabajoId: cancellable.work.trabajoId, expectedVersion: cancelled.work.version, idempotencyKey: 'cancel-terminal', requestHash: 'hash-cancel-terminal', createdAt: '2026-09-17T10:05:32.000Z' }) } catch (error) { terminalCancelCode = error instanceof TrabajoError ? error.code : 'unknown' }
    const completed = await work.completeWork({ ...provider, trabajoId: accepted.work.trabajoId, expectedVersion: started.work.version, idempotencyKey: 'complete-1', requestHash: 'hash-complete-1', createdAt: '2026-09-17T10:06:00.000Z' })
    const evidence = await work.recordEvidence({ ...provider, trabajoId: accepted.work.trabajoId, evidenceId: 'evidence-1', phase: 'completion', reference: 'storage://proof-1', metadata: { signed: true }, occurredAt: '2026-09-17T10:06:00.000Z', idempotencyKey: 'evidence-1', requestHash: 'hash-evidence-1', createdAt: '2026-09-17T10:06:00.000Z' })
    const detail = await work.getWork(customer, accepted.work.trabajoId)
    const snapshot = store.snapshot()
     console.log(JSON.stringify({ accepted, replay: replay.status, customerDiagnosisCode, diagnosis: confirmedDiagnosis.diagnosis.status, customerBudgetCode, budget: budget.budget, providerDecisionCode, decision, decisionReplay: decisionReplay.status, staleCode, customerCancelCode, customerCompleteCode, customerEvidenceCode, cancelled, cancelledReplay: cancelledReplay.status, terminalCancelCode, started: started.work, completed: completed.work, evidence, detail, auditActions: [...snapshot.audits.values()].map((audit) => audit.action), outbox: outbox.list(customer.tenantId).map((event) => event.eventType) }))
  `)

  assert.equal(result.accepted.work.budgetRequired, true)
  assert.equal(result.replay, 'replay')
  assert.equal(result.customerDiagnosisCode, 'FORBIDDEN')
  assert.equal(result.diagnosis, 'confirmed')
  assert.equal(result.customerBudgetCode, 'FORBIDDEN')
  assert.equal(result.budget.version, 1)
  assert.equal(result.providerDecisionCode, 'FORBIDDEN')
  assert.equal(result.decision.work.status, 'accepted')
  assert.equal(result.decision.work.version, 4)
  assert.equal(result.decision.work.acceptedBudgetVersion, 1)
  assert.equal(result.decisionReplay, 'replay')
  assert.equal(result.staleCode, 'VERSION_CONFLICT')
  assert.equal(result.customerCancelCode, 'FORBIDDEN')
  assert.equal(result.customerCompleteCode, 'FORBIDDEN')
  assert.equal(result.customerEvidenceCode, 'FORBIDDEN')
  assert.equal(result.cancelled.work.status, 'cancelled')
  assert.equal(result.cancelledReplay, 'replay')
  assert.equal(result.terminalCancelCode, 'INVALID_STATE')
  assert.equal(result.completed.status, 'completed')
  assert.deepEqual(
    result.detail.transitions.map(({ version, status }) => ({ version, status })),
    [
      { version: 1, status: 'requested' },
      { version: 2, status: 'in_diagnosis' },
      { version: 3, status: 'budget_pending' },
      { version: 4, status: 'accepted' },
      { version: 5, status: 'in_progress' },
      { version: 6, status: 'completed' },
    ]
  )
  assert.equal(result.detail.evidence.length, 1)
  assert.ok(result.auditActions.includes('budget.accepted'))
  assert.ok(result.outbox.includes('tus.work.budget_decided'))
  assert.ok(result.outbox.includes('tus.work.completed'))
})

test('WEB-08B persists the marketplace provider tenant separately from the customer tenant', () => {
  const result = runTypeScriptScenario(`
    const { PrismaMarketplaceStore } = await import('./apps/api/src/tus/adapters/prisma-marketplace.ts')
    const writes = []
    const store = new PrismaMarketplaceStore({
      publicacion: { findUnique: async () => ({ tenantId: 'provider-tenant' }) },
      compromisoMercadoServicios: { createMany: async ({ data }) => (writes.push(...data), { count: data.length }) },
    })
    await store.commitments.saveMany([{ contractVersion: '1.0.0', commitmentId: 'commitment-1', cartId: 'cart-1', tenantId: 'customer-tenant', merchantId: 'provider-1', context: 'service', amount: 1000, currency: 'ARS', status: 'pending', lineIds: ['line-1'], version: 1, createdAt: '2026-09-17T10:00:00.000Z', listingId: 'listing-1', quantity: 1, availabilityVersion: 1, policyVersion: 'policy-1', priceSnapshot: { currency: 'ARS', minor: 100000n } }])
    console.log(JSON.stringify(writes.map(({ tenantId, prestadorTenantId, publicacionId, prestadorId }) => ({ tenantId, prestadorTenantId, publicacionId, prestadorId }))))
  `)

  assert.deepEqual(result, [
    {
      tenantId: 'customer-tenant',
      prestadorTenantId: 'provider-tenant',
      publicacionId: 'listing-1',
      prestadorId: 'provider-1',
    },
  ])
})

test('WEB-08B protects budget versioning, server-time expiry, and tenant-scoped idempotency', () => {
  const result = runTypeScriptScenario(`
    const { TUS_CONTRACT_VERSION } = await import('./packages/contracts/src/tus.ts')
    const { InMemoryTrabajoStore, InMemoryTrabajoIdempotencyStore, InMemoryTrabajoOutboxStore, InMemoryTrabajoTransaction, ServicioTrabajo, TrabajoError } = await import('./apps/api/src/tus/work/index.ts')
    const { PrismaTrabajoIdempotencyStore, PrismaTrabajoTransaction } = await import('./apps/api/src/tus/adapters/prisma-work.ts')
    let clock = Date.parse('2026-09-17T10:00:00.000Z')
    const idempotency = new InMemoryTrabajoIdempotencyStore()
    const work = new ServicioTrabajo(new InMemoryTrabajoTransaction({ work: new InMemoryTrabajoStore(), idempotency, outbox: new InMemoryTrabajoOutboxStore() }), () => clock)
    const provider = { tenantId: 'provider-tenant', actorId: 'provider-user', correlationId: 'corr-provider' }
    const customer = { tenantId: 'customer-tenant', actorId: 'customer-user', correlationId: 'corr-customer' }
    const publication = { contractVersion: TUS_CONTRACT_VERSION, listingId: 'listing-1', tenantId: provider.tenantId, merchantId: 'provider-1', kind: 'service', name: 'Repair estimate', description: 'Quote first', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, priceMinor: 100000n, priceSnapshot: { currency: 'ARS', minor: 100000n }, availabilityVersion: 1, published: true, policyVersion: 'policy-1', stock: null, durationMinutes: null, capacity: 1, workingHours: [], bookingMode: 'requiere_presupuesto', priceMode: 'requires_budget', createdAt: '2026-09-17T10:00:00.000Z', updatedAt: '2026-09-17T10:00:00.000Z' }
    const commitment = (commitmentId) => ({ contractVersion: TUS_CONTRACT_VERSION, commitmentId, cartId: 'cart-' + commitmentId, tenantId: customer.tenantId, merchantId: 'provider-1', context: 'service', amount: 1000, currency: 'ARS', status: 'pending', lineIds: ['line-1'], version: 1, createdAt: '2026-09-17T10:00:00.000Z', listingId: publication.listingId, quantity: 1, availabilityVersion: 1, policyVersion: 'policy-1', priceSnapshot: { currency: 'ARS', minor: 100000n } })
    const issueBudget = (trabajoId, key, validUntil) => work.createBudget({ ...provider, trabajoId, currency: 'ARS', scope: 'Replace starter', totalMinor: '500000', lines: [{ lineId: 'budget-line-' + key, description: 'Starter motor', quantity: 1, unitAmountMinor: '500000', totalAmountMinor: '500000' }], ...(validUntil ? { validUntil } : {}), idempotencyKey: key, requestHash: 'hash-' + key, createdAt: '2026-09-17T10:00:00.000Z' })

    const accepted = await work.acceptCommitment({ ...provider, commitment: commitment('commitment-1'), publication, idempotencyKey: 'accept-1', requestHash: 'hash-accept-1', createdAt: '2026-09-17T10:00:00.000Z' })
    const first = await issueBudget(accepted.work.trabajoId, 'budget-1')
    const second = await issueBudget(accepted.work.trabajoId, 'budget-2')
    let supersededCode = ''
    try { await work.decideBudget({ ...customer, trabajoId: accepted.work.trabajoId, presupuestoId: first.budget.presupuestoId, presupuestoVersion: first.budget.version, decision: 'accepted', idempotencyKey: 'decision-1', requestHash: 'hash-decision-1', createdAt: '2026-09-17T10:00:00.000Z' }) } catch (error) { supersededCode = error instanceof TrabajoError ? error.code : 'unknown' }
    await work.decideBudget({ ...customer, trabajoId: accepted.work.trabajoId, presupuestoId: second.budget.presupuestoId, presupuestoVersion: second.budget.version, decision: 'accepted', idempotencyKey: 'decision-2', requestHash: 'hash-decision-2', createdAt: '2026-09-17T10:00:00.000Z' })
    let acceptedCode = ''
    try { await work.decideBudget({ ...customer, trabajoId: accepted.work.trabajoId, presupuestoId: first.budget.presupuestoId, presupuestoVersion: first.budget.version, decision: 'rejected', reason: 'Too late', idempotencyKey: 'decision-3', requestHash: 'hash-decision-3', createdAt: '2026-09-17T10:00:00.000Z' }) } catch (error) { acceptedCode = error instanceof TrabajoError ? error.code : 'unknown' }

    const expiring = await work.acceptCommitment({ ...provider, commitment: commitment('commitment-2'), publication, idempotencyKey: 'accept-2', requestHash: 'hash-accept-2', createdAt: '2026-09-17T10:00:00.000Z' })
    const expiringBudget = await issueBudget(expiring.work.trabajoId, 'budget-expiring', '2026-09-17T10:01:00.000Z')
    clock = Date.parse('2026-09-17T10:02:00.000Z')
    let expiredCode = ''
    try { await work.decideBudget({ ...customer, trabajoId: expiring.work.trabajoId, presupuestoId: expiringBudget.budget.presupuestoId, presupuestoVersion: expiringBudget.budget.version, decision: 'accepted', idempotencyKey: 'decision-expiring', requestHash: 'hash-decision-expiring', createdAt: '2026-09-17T09:00:00.000Z' }) } catch (error) { expiredCode = error instanceof TrabajoError ? error.code : 'unknown' }

    const memoryFirst = await idempotency.claim({ tenantId: 'customer-tenant', key: 'shared-key', requestHash: 'hash-a', now: clock, expiresAt: clock + 1_000 })
    const memorySecond = await idempotency.claim({ tenantId: 'provider-tenant', key: 'shared-key', requestHash: 'hash-b', now: clock, expiresAt: clock + 1_000 })
    const records = new Map()
    const prismaIdempotency = new PrismaTrabajoIdempotencyStore({ idempotencyRecord: { findUnique: async ({ where }) => records.get(where.tenantId_key.tenantId + ':' + where.tenantId_key.key) ?? null, create: async ({ data }) => { records.set(data.tenantId + ':' + data.key, { ...data, expiresAt: new Date(data.expiresAt) }); return data } } })
    const prismaFirst = await prismaIdempotency.claim({ tenantId: 'customer-tenant', key: 'shared-key', requestHash: 'hash-a', now: clock, expiresAt: clock + 1_000 })
    const prismaSecond = await prismaIdempotency.claim({ tenantId: 'provider-tenant', key: 'shared-key', requestHash: 'hash-b', now: clock, expiresAt: clock + 1_000 })
    const racingIdempotency = new PrismaTrabajoIdempotencyStore({ idempotencyRecord: { findUnique: async () => null, create: async () => { const error = new Error('duplicate key'); error.code = 'P2002'; throw error } } })
    const raced = await racingIdempotency.claim({ tenantId: 'customer-tenant', key: 'racing-key', requestHash: 'hash-race', now: clock, expiresAt: clock + 1_000 })
    let attempts = 0
    const transaction = new PrismaTrabajoTransaction({ $transaction: async (operation) => { attempts += 1; if (attempts < 3) { const error = new Error('serialization'); error.code = 'P2034'; throw error } return operation({}) } })
    await transaction.run(async () => undefined)
    console.log(JSON.stringify({ supersededCode, acceptedCode, expiredCode, memory: [memoryFirst.status, memorySecond.status], prisma: [prismaFirst.status, prismaSecond.status], raced: raced.status, attempts }))
  `)

  assert.equal(result.supersededCode, 'SUPERSEDED_BUDGET')
  assert.equal(result.acceptedCode, 'INVALID_STATE')
  assert.equal(result.expiredCode, 'EXPIRED')
  assert.deepEqual(result.memory, ['claimed', 'claimed'])
  assert.deepEqual(result.prisma, ['claimed', 'claimed'])
  assert.equal(result.raced, 'in_progress')
  assert.equal(result.attempts, 3)
})

test('WEB-08B rejects an unrelated reservation before creating work', () => {
  const result = runTypeScriptScenario(`
    const { TUS_CONTRACT_VERSION } = await import('./packages/contracts/src/tus.ts')
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { TrabajoError } = await import('./apps/api/src/tus/work/index.ts')
    const commitment = { contractVersion: TUS_CONTRACT_VERSION, commitmentId: 'commitment-1', cartId: 'cart-1', tenantId: 'customer-tenant', merchantId: 'provider-1', context: 'service', amount: 1000, currency: 'ARS', status: 'pending', lineIds: ['line-1'], version: 1, createdAt: '2026-09-17T10:00:00.000Z', listingId: 'listing-1', quantity: 1, availabilityVersion: 1, policyVersion: 'policy-1', priceSnapshot: { currency: 'ARS', minor: 100000n } }
    const publication = { contractVersion: TUS_CONTRACT_VERSION, listingId: 'listing-1', tenantId: 'provider-tenant', merchantId: 'provider-1', kind: 'service', name: 'Repair estimate', description: 'Quote first', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, priceMinor: 100000n, priceSnapshot: { currency: 'ARS', minor: 100000n }, availabilityVersion: 1, published: true, policyVersion: 'policy-1', stock: null, durationMinutes: 60, capacity: 1, workingHours: [], bookingMode: 'auto', priceMode: 'fixed', createdAt: '2026-09-17T10:00:00.000Z', updatedAt: '2026-09-17T10:00:00.000Z' }
    const application = new TusApplicationService({
      commitments: {}, compensations: {}, audits: {}, idempotency: {}, outbox: {},
      transaction: { run: async () => undefined },
      marketplace: { store: { commitments: { find: async () => commitment }, listings: { find: async () => publication } } },
      calendar: { findBookingForProvider: async () => ({ tenantId: 'other-customer-tenant', ownerTenantId: 'provider-tenant', listingId: 'listing-1', status: 'confirmed' }) },
      work: { acceptCommitment: async () => ({ status: 'executed' }) },
    })
    let code = ''
    try { await application.acceptServiceCommitment({ tenantId: 'provider-tenant', subjectId: 'provider-user', correlationId: 'corr-provider', roles: ['merchant'], permissions: ['tus:work:write'] }, { commitmentId: commitment.commitmentId, reservationId: 'reservation-1', idempotencyKey: 'accept-1', requestHash: 'hash-accept-1', createdAt: '2026-09-17T10:00:00.000Z' }) } catch (error) { code = error instanceof TrabajoError ? error.code : 'unknown' }
    console.log(JSON.stringify({ code }))
  `)

  assert.equal(result.code, 'INVALID_RESERVATION_LINK')
})

test('WEB-08B accepts a confirmed reservation with persisted customer ownership', () => {
  const result = runTypeScriptScenario(`
    const { TUS_CONTRACT_VERSION } = await import('./packages/contracts/src/tus.ts')
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { ServiceCalendarService } = await import('./apps/api/src/tus/calendar/bookings.ts')
    const { PrismaServiceCalendarStore } = await import('./apps/api/src/tus/adapters/prisma-calendar.ts')
    const rows = new Map()
    const calendarStore = new PrismaServiceCalendarStore({ reserva: { upsert: async ({ create }) => (rows.set(create.id, create), create), findUnique: async ({ where }) => rows.get(where.id) ?? null } })
    await calendarStore.bookings.save({ contractVersion: TUS_CONTRACT_VERSION, bookingId: 'reservation-1', tenantId: 'customer-tenant', ownerTenantId: 'provider-tenant', calendarId: 'calendar-1', listingId: 'listing-1', customerId: 'customer-user', startsAt: '2026-09-17T10:00:00.000Z', endsAt: '2026-09-17T11:00:00.000Z', status: 'confirmed', version: 1, policyVersion: 'calendar-policy-1', createdAt: '2026-09-17T09:00:00.000Z', updatedAt: '2026-09-17T09:00:00.000Z' })
    const commitment = { contractVersion: TUS_CONTRACT_VERSION, commitmentId: 'commitment-1', cartId: 'cart-1', tenantId: 'customer-tenant', merchantId: 'provider-1', context: 'service', amount: 1000, currency: 'ARS', status: 'pending', lineIds: ['line-1'], version: 1, createdAt: '2026-09-17T10:00:00.000Z', listingId: 'listing-1', quantity: 1, availabilityVersion: 1, policyVersion: 'policy-1', priceSnapshot: { currency: 'ARS', minor: 100000n } }
    const publication = { contractVersion: TUS_CONTRACT_VERSION, listingId: 'listing-1', tenantId: 'provider-tenant', merchantId: 'provider-1', kind: 'service', name: 'Repair estimate', description: 'Quote first', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, priceMinor: 100000n, priceSnapshot: { currency: 'ARS', minor: 100000n }, availabilityVersion: 1, published: true, policyVersion: 'policy-1', stock: null, durationMinutes: 60, capacity: 1, workingHours: [], bookingMode: 'auto', priceMode: 'fixed', createdAt: '2026-09-17T10:00:00.000Z', updatedAt: '2026-09-17T10:00:00.000Z' }
    let workInput
    const application = new TusApplicationService({
      commitments: {}, compensations: {}, audits: {}, idempotency: {}, outbox: {},
      transaction: { run: async () => undefined },
      marketplace: { store: { commitments: { find: async () => commitment }, listings: { find: async () => publication } } },
      calendar: new ServiceCalendarService(calendarStore),
      work: { acceptCommitment: async (input) => (workInput = input, { status: 'executed' }) },
    })
    await application.acceptServiceCommitment({ tenantId: 'provider-tenant', subjectId: 'provider-user', correlationId: 'corr-provider', roles: ['merchant'], permissions: ['tus:work:write'] }, { commitmentId: commitment.commitmentId, reservationId: 'reservation-1', idempotencyKey: 'accept-1', requestHash: 'hash-accept-1', createdAt: '2026-09-17T10:00:00.000Z' })
    console.log(JSON.stringify({ customerTenantId: rows.get('reservation-1').clienteTenantId, reservationId: workInput.reservationId }))
  `)

  assert.equal(result.customerTenantId, 'customer-tenant')
  assert.equal(result.reservationId, 'reservation-1')
})

test('WEB-08B exposes the Spanish work aliases without creating an automatic budget booking', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = await import('./apps/api/src/tus/composition/index.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { createApp } = await import('./apps/api/src/server.ts')
    const application = createTusApplication()
    const provider = { sessionId: 'provider-session', subjectId: 'provider-user', tenantId: 'provider-tenant', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read', 'tus:work:write', 'tus:work:read'], correlationId: 'corr-provider' }
    const customer = { sessionId: 'customer-session', subjectId: 'customer-user', tenantId: 'customer-tenant', roles: ['customer'], permissions: ['tus:checkout', 'tus:work:accept', 'tus:work:read'], correlationId: 'corr-customer' }
    const foreign = { sessionId: 'foreign-session', subjectId: 'foreign-user', tenantId: 'foreign-tenant', roles: ['customer'], permissions: ['tus:work:read'], correlationId: 'corr-foreign' }
    await application.marketplace.onboard(provider, { merchantId: 'provider-1', cohort: 'repairs-trades', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1' })
    const listing = await application.marketplace.createListing(provider, { merchantId: 'provider-1', kind: 'service', name: 'Estimate', description: 'Quote before repair', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, bookingMode: 'requiere_presupuesto', priceMode: 'requires_budget', capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '12:00' }] })
    await application.marketplace.publishListing(provider, listing.listingId)
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('provider-token', provider)
    sessions.add('customer-token', customer)
    sessions.add('foreign-token', foreign)
    const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const send = async (token, path, body, key) => {
      const response = await fetch(base + path, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'idempotency-key': key, 'x-correlation-id': 'corr-http-' + key }, body: JSON.stringify(body) })
      return { status: response.status, body: await response.json() }
    }
    try {
      const checkout = await send('customer-token', '/tus/v1/marketplace/checkout', { cartId: 'cart-1', requestHash: 'checkout-hash', createdAt: '2026-09-17T11:00:00.000Z', lines: [{ lineId: 'line-1', listingId: listing.listingId, context: 'service', quantity: 1, availabilityVersion: 1, price: 1000 }] }, 'checkout-1')
      const commitmentId = checkout.body.commitments[0].commitmentId
      const accepted = await send('provider-token', '/tus/v1/trabajos/compromisos/' + commitmentId + '/aceptar', { requestHash: 'accept-hash', createdAt: '2026-09-17T11:01:00.000Z' }, 'accept-1')
      const workId = accepted.body.work.trabajoId
      const diagnosis = await send('provider-token', '/tus/v1/trabajos/' + workId + '/diagnostico', { description: 'Inspect motor', requestHash: 'diagnosis-hash', createdAt: '2026-09-17T11:02:00.000Z' }, 'diagnosis-1')
      const budget = await send('provider-token', '/tus/v1/trabajos/' + workId + '/presupuestos', { currency: 'ARS', scope: 'Repair motor', totalMinor: '500000', lines: [{ lineId: 'line-1', description: 'Starter motor', quantity: 1, unitAmountMinor: '500000', totalAmountMinor: '500000' }], requestHash: 'budget-hash', createdAt: '2026-09-17T11:03:00.000Z' }, 'budget-1')
      const decision = await send('customer-token', '/tus/v1/trabajos/' + workId + '/presupuestos/1/aceptar', { budgetId: budget.body.budget.presupuestoId, requestHash: 'decision-hash', createdAt: '2026-09-17T11:04:00.000Z' }, 'decision-1')
       const started = await send('provider-token', '/tus/v1/trabajos/' + workId + '/iniciar', { expectedVersion: decision.body.work.version, requestHash: 'start-hash', createdAt: '2026-09-17T11:05:00.000Z' }, 'start-1')
       const completed = await send('provider-token', '/tus/v1/trabajos/' + workId + '/completar', { expectedVersion: started.body.work.version, requestHash: 'complete-hash', createdAt: '2026-09-17T11:06:00.000Z' }, 'complete-1')
       const list = async (token) => { const response = await fetch(base + '/tus/v1/work', { headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'corr-list-' + token } }); return { status: response.status, body: await response.json() } }
       const providerList = await list('provider-token')
       const customerList = await list('customer-token')
       const foreignList = await list('foreign-token')
       const foreignResponse = await fetch(base + '/tus/v1/trabajos/' + workId, { headers: { authorization: 'Bearer foreign-token', 'x-correlation-id': 'corr-http-foreign' } })
       const foreignBody = await foreignResponse.json()
       console.log(JSON.stringify({ checkout, accepted, diagnosis, budget, decision, started, completed, providerList, customerList, foreignList, foreign: { status: foreignResponse.status, body: foreignBody } }))
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  `)

  assert.equal(result.checkout.status, 201)
  assert.equal(result.checkout.body.commitments[0].slotStart, undefined)
  assert.equal(result.accepted.status, 201)
  assert.equal(result.accepted.body.work.status, 'requested')
  assert.equal(result.diagnosis.status, 201)
  assert.equal(result.budget.status, 201)
  assert.equal(result.decision.status, 201)
  assert.equal(result.decision.body.work.status, 'accepted')
  assert.equal(result.started.body.work.status, 'in_progress')
  assert.equal(result.completed.body.work.status, 'completed')
  assert.equal(result.providerList.status, 200)
  assert.equal(result.providerList.body.works.length, 1)
  assert.equal(result.customerList.status, 200)
  assert.equal(result.customerList.body.works.length, 1)
  assert.equal(result.foreignList.status, 200)
  assert.equal(result.foreignList.body.works.length, 0)
  assert.equal(result.foreign.status, 404)
  assert.equal(result.foreign.body.code, 'NOT_FOUND')
})
