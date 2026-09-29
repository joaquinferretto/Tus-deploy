import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// FASE 8: safe cancellation lifecycle of request-born works. Before the start the client or the
// provider cancels with a reason; once started only the provider cancels (the client asks); a
// paid deposit makes it a platform-support case that never touches the money.
const SETUP = `${SERVICE_SETUP}
  const { InMemoryTrabajoOutboxStore: Outbox } = await import('./apps/api/src/tus/work/index.ts')
  const { pagosTrabajo } = await import('./apps/api/src/tus/composition/index.ts')
  let mode = 'off'
  const politica = {
    reglaComision: async () => ({ politicaId: null, rateBps: 1000, ruleVersion: 't', pspFeeBearer: 'provider' }),
    disponibilidad: async () => (mode === 'on' ? { available: true, reason: null } : { available: false, reason: 'PAYMENTS_DISABLED' }),
  }
  const fin = new ServicioFinanzasServicios(new TransaccionFinanzasServicioEnMemoria(new AlmacenFinanzasServicioEnMemoria(), new IdentidadServicioEnMemoria(workStore, marketplace), { completarPorPagoFinal: (i) => work.completarPorPagoFinal({ work: workStore, outbox: new Outbox() }, i) }), clock, proveedorPagos, undefined, politica)
  work.conPagos(pagosTrabajo(fin))
  let seq = 0
  async function requestWork(id, total = '10000') {
    const { work: created } = await work.crearDesdeSolicitudEnTransaccion({ ...customer, solicitudId: 'sol-' + id, prestadorTenantId: provider.tenantId, prestadorId: 'provider-1', createdAt: '2026-09-23T09:00:00.000Z' })
    if (total) await acceptBudget(created.trabajoId, total)
    return created.trabajoId
  }
  const current = async (id) => (await work.getWork(provider, id)).work
  const act = async (who, op, id, reason, version) => { const w = await current(id); seq += 1; return work[op]({ ...who, trabajoId: id, expectedVersion: version ?? w.version, idempotencyKey: op + '-' + seq, requestHash: 'h' + seq, createdAt: '2026-09-23T10:00:' + String(seq % 60).padStart(2, '0') + '.000Z', ...(reason === undefined ? {} : { reason }) }) }
  const notify = (paymentId, amount, eventId) => { const raw = JSON.stringify({ id: eventId, data: { id: 'fake-mp-' + paymentId, external_reference: paymentId, status: 'approved', currency_id: 'ARS', transaction_amount: amount, date_last_updated: '2026-09-23T11:00:0' + (++seq % 10) + '.000Z' } }); return fin.ingerirEventoProveedor({ rawBody: raw, signature: proveedorPagos.firmar(raw), receivedAt: '2026-09-23T11:00:00.000Z' }) }
`

test('FASE8 before the start: client or provider cancel with a mandatory reason; role, reason and previous state are recorded', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const a = await requestWork('a', null)
    const noReason = await codeOf(() => act(customer, 'cancelWork', a, '  '))
    const stranger1 = await codeOf(() => act(stranger, 'cancelWork', a, 'no'))
    const byClient = (await act(customer, 'cancelWork', a, 'Encontré otra solución')).work
    const again = await codeOf(() => act(provider, 'cancelWork', a, 'otra vez'))
    const detail = await work.getWork(customer, a)
    const b = await requestWork('b')
    const byProvider = (await act(provider, 'cancelWork', b, 'No llego a la fecha')).work
    const tooLong = await codeOf(async () => { const c = await requestWork('c'); await act(customer, 'cancelWork', c, 'x'.repeat(501)) })
    const audits = [...workStore.audits.values()].filter((item) => item.trabajoId === a && item.action === 'work.cancelled')
    console.log(JSON.stringify({ noReason, stranger1, byClient: [byClient.status, byClient.cancelledByRole, byClient.cancellationReason], again, transitions: detail.transitions.map((t) => [t.previousStatus, t.status, t.reason, t.actorId]), byProvider: [byProvider.status, byProvider.cancelledByRole], tooLong, audit: audits.map((item) => [item.actorId, item.metadata.role, item.metadata.reason, item.metadata.previousStatus]) }))
  `)
  assert.equal(result.noReason, 'REASON_REQUIRED')
  assert.equal(result.stranger1, 'NOT_FOUND')
  assert.deepEqual(result.byClient, ['cancelled', 'cliente', 'Encontré otra solución'])
  assert.equal(result.again, 'INVALID_STATE')
  // The customer view of transitions hides actor ids; the actor is checked on the audit below.
  assert.deepEqual(result.transitions.at(-1).slice(0, 3), ['requested', 'cancelled', 'work.cancelled'])
  assert.deepEqual(result.byProvider, ['cancelled', 'prestador'])
  assert.equal(result.tooLong, 'INVALID')
  assert.deepEqual(result.audit, [['customer-user', 'cliente', 'Encontré otra solución', 'requested']])
})

test('FASE8 started work: the client cannot cancel (only request it); the provider can while nothing was paid', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const id = await requestWork('s')
    await act(provider, 'startWork', id)
    const clientCancel = await codeOf(() => act(customer, 'cancelWork', id, 'Ya no lo necesito'))
    const requestNoReason = await codeOf(() => act(customer, 'solicitarCancelacion', id, ''))
    const providerRequest = await codeOf(() => act(provider, 'solicitarCancelacion', id, 'no'))
    const requested = (await act(customer, 'solicitarCancelacion', id, 'Ya no lo necesito')).work
    const twice = await codeOf(() => act(customer, 'solicitarCancelacion', id, 'otra'))
    const stillInProgress = (await current(id)).status
    const byProvider = (await act(provider, 'cancelWork', id, 'Acordado con el Cliente')).work
    console.log(JSON.stringify({ clientCancel, requestNoReason, providerRequest, requested: [requested.status, requested.cancellationRequestReason, Boolean(requested.cancellationRequestedAt)], twice, stillInProgress, byProvider: [byProvider.status, byProvider.cancelledByRole, byProvider.cancellationRequestReason] }))
  `)
  assert.equal(result.clientCancel, 'CLIENT_CANCEL_NOT_ALLOWED')
  assert.equal(result.requestNoReason, 'REASON_REQUIRED')
  assert.equal(result.providerRequest, 'FORBIDDEN')
  assert.deepEqual(result.requested, ['in_progress', 'Ya no lo necesito', true])
  assert.equal(result.twice, 'ALREADY_REQUESTED')
  assert.equal(result.stillInProgress, 'in_progress')
  assert.deepEqual(result.byProvider, ['cancelled', 'prestador', 'Ya no lo necesito'])
})

test('FASE8 paid deposit: nobody cancels from the app; support cancels without touching the payment; a late payment never revives a cancelled work', () => {
  const result = runTypeScriptScenario(`${SETUP}
    mode = 'on'
    const id = await requestWork('p', '20000')
    const checkout = await fin.iniciarCheckout({ ...customer, trabajoId: id, idempotencyKey: 'k-p' })
    await notify(checkout.payment.paymentId, '100.00', 'evt-p')
    const clientCancel = await codeOf(() => act(customer, 'cancelWork', id, 'Me arrepentí'))
    const providerCancel = await codeOf(() => act(provider, 'cancelWork', id, 'No puedo'))
    const w = await current(id)
    const supportNoReason = await codeOf(() => work.cancelarComoSoporte({ actorId: 'admin-1', correlationId: 'c', trabajoId: id, expectedVersion: w.version, reason: '', idempotencyKey: 'sup-0', requestHash: 'h', createdAt: '2026-09-23T12:00:00.000Z' }))
    const support = (await work.cancelarComoSoporte({ actorId: 'admin-1', correlationId: 'c', trabajoId: id, expectedVersion: w.version, reason: 'Reclamo por soporte #12', idempotencyKey: 'sup-1', requestHash: 'h', createdAt: '2026-09-23T12:00:00.000Z' })).work
    const supportReplay = (await work.cancelarComoSoporte({ actorId: 'admin-1', correlationId: 'c', trabajoId: id, expectedVersion: w.version, reason: 'Reclamo por soporte #12', idempotencyKey: 'sup-1', requestHash: 'h', createdAt: '2026-09-23T12:00:00.000Z' })).status
    const payments = await fin.estadoPagosTrabajo(await current(id))
    const preview = await fin.consultarVistaPreviaPago({ ...customer, trabajoId: id })
    // A deposit approved after a cancellation is booked (money moved) but the work stays cancelled.
    const late = await requestWork('late', '20000')
    const lateCheckout = await fin.iniciarCheckout({ ...customer, trabajoId: late, idempotencyKey: 'k-late' })
    await act(customer, 'cancelWork', late, 'Cambié de idea')
    const lateEvent = await notify(lateCheckout.payment.paymentId, '100.00', 'evt-late')
    const lateWork = await current(late)
    console.log(JSON.stringify({ clientCancel, providerCancel, supportNoReason, support: [support.status, support.cancelledByRole, support.cancellationReason], supportReplay, deposit: payments?.deposit.status ?? (await fin.consultarFinanzasTrabajo({ ...customer, trabajoId: id })).parts.map((p) => p.obligation.status).join(), preview: [preview.payable, preview.notPayableReason], refunds: proveedorPagos.reembolsos.length, lateEvent: [lateEvent.result, lateEvent.obligation?.status], lateWork: lateWork.status }))
  `)
  assert.equal(result.clientCancel, 'PAYMENT_REQUIRES_SUPPORT')
  assert.equal(result.providerCancel, 'PAYMENT_REQUIRES_SUPPORT')
  assert.equal(result.supportNoReason, 'REASON_REQUIRED')
  assert.deepEqual(result.support, ['cancelled', 'admin', 'Reclamo por soporte #12'])
  assert.equal(result.supportReplay, 'replay')
  // The payment stays paid: no refund was requested by cancelling.
  assert.equal(result.deposit, 'paid')
  assert.deepEqual(result.preview, [false, 'WORK_CANCELLED'])
  assert.equal(result.refunds, 0)
  assert.deepEqual(result.lateEvent, ['applied', 'paid'])
  assert.equal(result.lateWork, 'cancelled')
})

test('FASE8 concurrency: parallel cancellations and cancel vs start leave one consistent outcome; marketplace keeps its rule', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const outcome = async (promises) => (await Promise.allSettled(promises)).map((r) => r.status === 'fulfilled' ? 'ok' : r.reason.code).sort()
    const a = await requestWork('ca')
    const va = (await current(a)).version
    const both = await outcome([act(customer, 'cancelWork', a, 'cliente', va), act(provider, 'cancelWork', a, 'prestador', va)])
    const aFinal = await current(a)
    const b = await requestWork('cb')
    const vb = (await current(b)).version
    const race = await outcome([act(provider, 'startWork', b, undefined, vb), act(customer, 'cancelWork', b, 'me voy', vb)])
    const bFinal = await current(b)
    const transitionsB = (await work.getWork(provider, b)).transitions.filter((t) => ['in_progress', 'cancelled'].includes(t.status)).length
    const mk = await serviceWork('mk')
    const mkCustomer = await codeOf(() => act(customer, 'cancelWork', mk.work.trabajoId, 'no'))
    const mkProvider = (await act(provider, 'cancelWork', mk.work.trabajoId)).work.status
    console.log(JSON.stringify({ both, aFinal: [aFinal.status, aFinal.cancelledByRole], race, bFinal: bFinal.status, transitionsB, mkCustomer, mkProvider }))
  `)
  assert.equal(result.both.filter((r) => r === 'ok').length, 1)
  assert.ok(result.both.every((r) => ['ok', 'VERSION_CONFLICT', 'INVALID_STATE'].includes(r)))
  assert.equal(result.aFinal[0], 'cancelled')
  assert.equal(result.race.filter((r) => r === 'ok').length, 1)
  assert.ok(['in_progress', 'cancelled'].includes(result.bFinal))
  assert.equal(result.transitionsB, 1)
  assert.equal(result.mkCustomer, 'FORBIDDEN')
  assert.equal(result.mkProvider, 'cancelled')
})

test('FASE8 HTTP: the client cancels its request-born work with a reason; support cancel needs the MFA admin permission', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { InMemoryTusCommitmentStore, InMemoryTusCompensationStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction, InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { crearRouterAdminTrabajos } = await import('./apps/api/src/tus/admin/trabajos.ts')
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('customer-token', { sessionId: 's-c', subjectId: customer.actorId, tenantId: customer.tenantId, roles: ['customer'], permissions: ['tus:checkout', 'tus:marketplace:read'] })
    sessions.add('admin-token', { sessionId: 's-a', subjectId: 'admin-1', tenantId: 'platform', roles: ['admin'], permissions: ['tus:payments:admin'] })
    const commitments = new InMemoryTusCommitmentStore(); const compensations = new InMemoryTusCompensationStore(); const audits = new AlmacenReferenciasAuditoriaEnMemoria(); const idempotency = new InMemoryTusIdempotencyStore(); const outbox = new InMemoryTusOutboxStore()
    const application = new TusApplicationService({ commitments, compensations, audits, idempotency, outbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, outbox, compensations }), work, serviceFinance: fin })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }), tusRoutesEnabled: true })
    const admin = express(); admin.use(express.json()); admin.use(crearRouterAdminTrabajos({ sessions, trabajos: work }))
    const server = app.listen(0); const adminServer = admin.listen(0)
    const call = async (srv, path, token, body, key) => { const r = await fetch('http://127.0.0.1:' + srv.address().port + path, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'c', 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) } }
    try {
      const id = await requestWork('http')
      const v = (await current(id)).version
      const noReason = await call(server, '/tus/v1/work/' + id + '/cancel', 'customer-token', { requestHash: 'h', expectedVersion: v }, 'k1')
      const ok = await call(server, '/tus/v1/work/' + id + '/cancel', 'customer-token', { requestHash: 'h', expectedVersion: v, reason: 'Ya lo resolví' }, 'k2')
      const id2 = await requestWork('http2')
      const v2 = (await current(id2)).version
      const nonAdmin = await call(adminServer, '/tus/v1/admin/trabajos/' + id2 + '/cancelar', 'customer-token', { expectedVersion: v2, reason: 'x' }, 'a1')
      const adminOk = await call(adminServer, '/tus/v1/admin/trabajos/' + id2 + '/cancelar', 'admin-token', { expectedVersion: v2, reason: 'Soporte' }, 'a2')
      const missing = await call(adminServer, '/tus/v1/admin/trabajos/no-existe/cancelar', 'admin-token', { expectedVersion: 1, reason: 'Soporte' }, 'a3')
      console.log(JSON.stringify({ noReason: [noReason.status, noReason.body?.code ?? noReason.body?.error?.code], ok: [ok.status, ok.body?.work?.status, ok.body?.work?.cancelledByRole], nonAdmin: nonAdmin.status, adminOk: [adminOk.status, adminOk.body?.work?.status], missing: missing.status }))
    } finally { server.close(); adminServer.close() }
  `)
  assert.equal(result.noReason[0], 400)
  assert.deepEqual(result.ok, [200, 'cancelled', 'cliente'])
  assert.equal(result.nonAdmin, 403)
  assert.deepEqual(result.adminOk, [200, 'cancelled'])
  assert.equal(result.missing, 404)
})

test('FASE8 migration: cancellation columns are additive and constrained', () => {
  const sql = readFileSync(join(root, 'apps/api/prisma/migrations/20261013100000_tus_trabajo_cancelacion/migration.sql'), 'utf8')
  assert.match(sql, /ADD COLUMN "cancelado_por_rol" text/u)
  assert.match(sql, /"cancelado_por_rol" IN \('cliente', 'prestador', 'admin'\) AND "estado" = 'cancelled'/u)
  assert.match(sql, /ck_trabajos_cancelacion_solicitada/u)
  assert.doesNotMatch(sql, /DROP |DELETE FROM|^\s*UPDATE /imu)
})
