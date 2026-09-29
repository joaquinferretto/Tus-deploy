import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

const SETUP = `
  const { InMemoryTrabajoStore, InMemoryTrabajoIdempotencyStore, InMemoryTrabajoOutboxStore, InMemoryTrabajoTransaction, ServicioTrabajo, identificadorTrabajoSolicitud } = await import('./apps/api/src/tus/work/index.ts')
  const store = new InMemoryTrabajoStore()
  const outbox = new InMemoryTrabajoOutboxStore()
  const work = new ServicioTrabajo(new InMemoryTrabajoTransaction({ work: store, idempotency: new InMemoryTrabajoIdempotencyStore(), outbox }), () => Date.parse('2026-09-28T10:00:00.000Z'))
  const client = { tenantId: 't-cli', actorId: 'a-cli', correlationId: 'corr-cli' }
  const provider = { tenantId: 't-prov', actorId: 'a-prov', correlationId: 'corr-prov' }
  const stranger = { tenantId: 't-otro', actorId: 'a-otro', correlationId: 'corr-otro' }
  const at = (m) => '2026-09-28T10:' + String(m).padStart(2, '0') + ':00.000Z'
  const create = (overrides = {}) => work.crearDesdeSolicitudEnTransaccion({ ...client, solicitudId: 's-1', prestadorTenantId: 't-prov', prestadorId: 'm-prov', createdAt: at(0), ...overrides })
  const code = async (fn) => { try { await fn(); return 'none' } catch (error) { return error?.code ?? String(error) } }
`

test('a request-born work starts requested, requires a budget and belongs to exactly the two parties', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const first = await create()
    const again = await create({ correlationId: 'retry' })
    const otherProvider = await code(() => create({ prestadorTenantId: 't-prov2', prestadorId: 'm-prov2' }))
    const selfWork = await code(() => create({ solicitudId: 's-self', prestadorTenantId: 't-cli', prestadorId: 'm-self' }))
    const clientView = await work.getWork(client, first.work.trabajoId)
    const providerView = await work.getWork(provider, first.work.trabajoId)
    const strangerView = await code(() => work.getWork(stranger, first.work.trabajoId))
    const transitions = clientView.transitions.map((item) => item.reason)
    console.log(JSON.stringify({
      created: first.created, again: again.created, sameId: again.work.trabajoId === first.work.trabajoId,
      id: first.work.trabajoId, expectedId: identificadorTrabajoSolicitud('s-1'),
      shape: { origin: first.work.origin, solicitudId: first.work.solicitudId, commitmentId: first.work.commitmentId, publicacionId: first.work.publicacionId, status: first.work.status, budgetRequired: first.work.budgetRequired, tenantId: first.work.tenantId, prestadorTenantId: first.work.prestadorTenantId },
      otherProvider, selfWork, clientViewer: clientView.viewer, providerViewer: providerView.viewer, strangerView, transitions,
      listed: { client: (await work.listWorks(client)).length, provider: (await work.listWorks(provider)).length, stranger: (await work.listWorks(stranger)).length },
    }))
  `)
  assert.equal(result.created, true)
  assert.equal(result.again, false, 'a retry returns the existing work')
  assert.equal(result.sameId, true)
  assert.equal(result.id, result.expectedId)
  assert.deepEqual(result.shape, { origin: 'solicitud', solicitudId: 's-1', commitmentId: null, publicacionId: null, status: 'requested', budgetRequired: true, tenantId: 't-cli', prestadorTenantId: 't-prov' })
  assert.equal(result.otherProvider, 'CONFLICT', 'a second provider can never get a work for the same request')
  assert.equal(result.selfWork, 'SELF_WORK')
  assert.notEqual(result.strangerView, 'none', 'a third tenant cannot read the work')
  assert.deepEqual(result.transitions, ['work.created_from_request'])
  assert.deepEqual(result.listed, { client: 1, provider: 1, stranger: 0 })
})

test('request-born work follows the existing budget state machine and cannot start without an accepted budget', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const { work: created } = await create()
    const id = created.trabajoId
    const startEarly = await code(() => work.startWork({ ...provider, trabajoId: id, expectedVersion: 1, idempotencyKey: 'start-early', requestHash: 'h', createdAt: at(1) }))
    const clientBudget = await code(() => work.createBudget({ ...client, trabajoId: id, currency: 'ARS', scope: 'arreglo', totalMinor: '250000', lines: [{ lineId: 'l1', description: 'mano de obra', quantity: 1, unitAmountMinor: '250000', totalAmountMinor: '250000' }], idempotencyKey: 'b-cli', requestHash: 'h', createdAt: at(2) }))
    const budget = await work.createBudget({ ...provider, trabajoId: id, currency: 'ARS', scope: 'arreglo', totalMinor: '250000', lines: [{ lineId: 'l1', description: 'mano de obra', quantity: 1, unitAmountMinor: '250000', totalAmountMinor: '250000' }], idempotencyKey: 'b-prov', requestHash: 'h', createdAt: at(3) })
    const afterBudget = (await work.getWork(client, id)).work.status
    const providerAccepts = await code(() => work.decideBudget({ ...provider, trabajoId: id, presupuestoId: budget.budget.presupuestoId, presupuestoVersion: budget.budget.version, decision: 'accepted', idempotencyKey: 'd-prov', requestHash: 'h', createdAt: at(4) }))
    const decided = await work.decideBudget({ ...client, trabajoId: id, presupuestoId: budget.budget.presupuestoId, presupuestoVersion: budget.budget.version, decision: 'accepted', idempotencyKey: 'd-cli', requestHash: 'h', createdAt: at(5) })
    const accepted = decided.work
    const started = await work.startWork({ ...provider, trabajoId: id, expectedVersion: accepted.version, idempotencyKey: 'start', requestHash: 'h', createdAt: at(6) })
    const completed = await work.completeWork({ ...provider, trabajoId: id, expectedVersion: started.work.version, idempotencyKey: 'complete', requestHash: 'h', createdAt: at(7) })
    const afterTerminal = await code(() => work.cancelWork({ ...provider, trabajoId: id, expectedVersion: completed.work.version, idempotencyKey: 'cancel', requestHash: 'h', createdAt: at(8) }))
    console.log(JSON.stringify({ startEarly, clientBudget, afterBudget, providerAccepts, accepted: { status: accepted.status, budget: accepted.acceptedBudgetId === budget.budget.presupuestoId }, started: started.work.status, completed: completed.work.status, afterTerminal }))
  `)
  assert.equal(result.startEarly, 'BUDGET_REQUIRED')
  assert.equal(result.clientBudget, 'FORBIDDEN', 'only the provider quotes')
  assert.equal(result.afterBudget, 'budget_pending')
  assert.equal(result.providerAccepts, 'FORBIDDEN', 'only the client accepts the budget')
  assert.deepEqual(result.accepted, { status: 'accepted', budget: true })
  assert.equal(result.started, 'in_progress')
  assert.equal(result.completed, 'completed')
  assert.equal(result.afterTerminal, 'INVALID_STATE', 'completed is terminal')
})

test('marketplace works keep working next to request-born works (per-origin uniqueness in memory)', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await create()
    const second = await create({ solicitudId: 's-2' })
    const byRequest = await store.findBySolicitud({ solicitudId: 's-2' })
    const missing = await store.findBySolicitud({ solicitudId: 's-404' })
    console.log(JSON.stringify({ second: second.created, found: byRequest?.trabajoId ?? null, missing }))
  `)
  assert.equal(result.second, true)
  assert.equal(result.found, 'trabajo-solicitud-s-2')
  assert.equal(result.missing, null)
})
