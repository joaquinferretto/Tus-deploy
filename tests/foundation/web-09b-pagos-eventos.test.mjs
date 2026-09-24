import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Signed provider notifications built from the fake provider payload shape (major-unit amount).
const EVENT_HELPERS = `
  function providerEvent(id, payment, status, amount, date, overrides = {}) {
    const rawBody = JSON.stringify({ id, type: 'payment', data: { id: payment.providerReference ?? 'fake-mp-' + payment.paymentId, external_reference: payment.paymentId, status, transaction_amount: amount, currency_id: 'ARS', date_last_updated: date, ...overrides } })
    return { rawBody, signature: proveedorPagos.firmar(rawBody), receivedAt: '2026-09-23T10:30:00.000Z' }
  }
`

test('WEB-09B creates a tenant-scoped, idempotent payment intent with audit and outbox and no provider call', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}
    const fixed = await payableWork('fixed', '300000')
    const created = await finance.crearIntencionPago({ ...customer, trabajoId: fixed.work.trabajoId, idempotencyKey: 'pay-1' })
    const replay = await finance.crearIntencionPago({ ...customer, trabajoId: fixed.work.trabajoId, idempotencyKey: 'pay-1' })
    const otherKey = await finance.crearIntencionPago({ ...customer, trabajoId: fixed.work.trabajoId, idempotencyKey: 'pay-2' })
    const conflict = await codeOf(() => finance.crearIntencionPago({ ...customer, actorId: 'customer-user-2', trabajoId: fixed.work.trabajoId, idempotencyKey: 'pay-1' }))
    const providerCode = await codeOf(() => finance.crearIntencionPago({ ...provider, trabajoId: fixed.work.trabajoId, idempotencyKey: 'pay-provider' }))
    const strangerCode = await codeOf(() => finance.crearIntencionPago({ ...stranger, trabajoId: fixed.work.trabajoId, idempotencyKey: 'pay-stranger' }))
    const providerView = await finance.consultarFinanzasTrabajo({ ...provider, trabajoId: fixed.work.trabajoId })
    const strangerView = await codeOf(() => finance.consultarFinanzasTrabajo({ ...stranger, trabajoId: fixed.work.trabajoId }))
    const { validarIntencionPagoServicio } = await import('./packages/contracts/src/tus.ts')
    validarIntencionPagoServicio(created.payment)
    console.log(JSON.stringify({ created, replay: replay.status, replaySame: JSON.stringify(replay.payment) === JSON.stringify(created.payment), otherKey: { status: otherKey.status, paymentId: otherKey.payment.paymentId }, conflict, providerCode, strangerCode, providerView, strangerView, providerCalls: proveedorPagos.llamadas.length, intents: financeStore.state.intenciones.size, outbox: financeStore.state.outbox.map((event) => event.eventType), audits: financeStore.state.auditoria.map((audit) => audit.action + ':' + audit.origin) }))
  `)

  assert.equal(result.created.status, 'executed')
  assert.equal(result.created.payment.amountMinor, '300000')
  assert.equal(result.created.payment.currency, 'ARS')
  assert.equal(result.created.payment.providerStatus, 'pending')
  assert.equal(result.created.payment.dispatchStatus, 'pending_dispatch')
  assert.equal(result.created.payment.providerReference, null)
  assert.equal(result.created.payment.attempt, 1)
  assert.equal(result.created.obligation.status, 'pending_payment')
  assert.equal(result.replay, 'replay')
  assert.equal(result.replaySame, true)
  assert.deepEqual(result.otherKey, {
    status: 'existing',
    paymentId: result.created.payment.paymentId,
  })
  assert.equal(result.conflict, 'IDEMPOTENCY_CONFLICT')
  assert.equal(result.providerCode, 'FORBIDDEN')
  assert.equal(result.strangerCode, 'NOT_FOUND')
  assert.equal(result.providerView.viewer, 'provider')
  assert.equal(result.providerView.payments.length, 1)
  assert.equal(result.strangerView, 'NOT_FOUND')
  assert.equal(result.providerCalls, 0)
  assert.equal(result.intents, 1)
  assert.deepEqual(result.outbox, ['tus.payment.intent_created'])
  assert.deepEqual(result.audits, [
    'obligation.created:customer',
    'payment.intent_created:customer',
  ])
})

test('WEB-09B dispatches outside the transaction with a stable provider key and safe retries', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}
    const fixed = await payableWork('dispatch')
    const created = await finance.crearIntencionPago({ ...customer, trabajoId: fixed.work.trabajoId, idempotencyKey: 'pay-d' })
    proveedorPagos.fallarProximas('PROVIDER_TIMEOUT')
    const failed = await finance.despacharIntencionPago({ tenantId: customer.tenantId, paymentId: created.payment.paymentId, correlationId: 'dispatch-1' })
    const retried = await finance.despacharIntencionPago({ tenantId: customer.tenantId, paymentId: created.payment.paymentId, correlationId: 'dispatch-2' })
    const again = await finance.despacharIntencionPago({ tenantId: customer.tenantId, paymentId: created.payment.paymentId, correlationId: 'dispatch-3' })
    const crossTenant = await codeOf(() => finance.despacharIntencionPago({ tenantId: stranger.tenantId, paymentId: created.payment.paymentId, correlationId: 'dispatch-x' }))
    const { ServicioFinanzasServicios: Servicio } = await import('./apps/api/src/tus/finance/servicios/servicio.ts')
    const unavailableStore = new AlmacenFinanzasServicioEnMemoria()
    const unavailable = new Servicio(new TransaccionFinanzasServicioEnMemoria(unavailableStore, new IdentidadServicioEnMemoria(workStore, marketplace)), clock)
    const other = await payableWork('unavailable')
    // WEB-09D: without an enabled provider no obligation or intent is recorded ("no pending eterno").
    const heldCode = await codeOf(() => unavailable.crearIntencionPago({ ...customer, trabajoId: other.work.trabajoId, idempotencyKey: 'pay-u' }))
    const heldWrites = unavailableStore.state.intenciones.size + unavailableStore.state.obligaciones.size + unavailableStore.state.auditoria.length + unavailableStore.state.outbox.length
    console.log(JSON.stringify({ failed, retried, again: again.status, crossTenant, calls: proveedorPagos.llamadas, paymentId: created.payment.paymentId, heldCode, heldWrites, outbox: financeStore.state.outbox.map((event) => event.eventType) }))
  `)

  assert.equal(result.failed.status, 'dispatch_failed')
  assert.equal(result.failed.reason, 'PROVIDER_TIMEOUT')
  assert.equal(result.failed.payment.providerStatus, 'pending')
  assert.equal(result.retried.status, 'dispatched')
  assert.equal(result.retried.payment.providerReference, `fake-mp-${result.paymentId}`)
  assert.equal(result.again, 'already_dispatched')
  assert.equal(result.crossTenant, 'NOT_FOUND')
  assert.deepEqual(result.calls, [result.paymentId, result.paymentId])
  assert.equal(result.heldCode, 'PROVIDER_NOT_CONFIGURED')
  assert.equal(result.heldWrites, 0)
  assert.deepEqual(result.outbox, ['tus.payment.intent_created', 'tus.payment.intent_dispatched'])
})

test('WEB-09B ingests verified provider events once, in order, with explicit mapping', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${EVENT_HELPERS}
    const fixed = await payableWork('events')
    const created = await finance.crearIntencionPago({ ...customer, trabajoId: fixed.work.trabajoId, idempotencyKey: 'pay-e' })
    const dispatched = await finance.despacharIntencionPago({ tenantId: customer.tenantId, paymentId: created.payment.paymentId, correlationId: 'd' })
    const payment = dispatched.payment
    const invalidSignature = await finance.ingerirEventoProveedor({ ...providerEvent('evt-0', payment, 'approved', '1500.00', '2026-09-23T10:05:00.000Z'), signature: 'sha256=forged' })
    const unmatched = await finance.ingerirEventoProveedor(providerEvent('evt-u', { paymentId: 'pago-unknown', providerReference: 'fake-mp-unknown' }, 'approved', '1500.00', '2026-09-23T10:05:00.000Z'))
    const amountMismatch = await finance.ingerirEventoProveedor(providerEvent('evt-amount', payment, 'approved', '1499.99', '2026-09-23T10:05:00.000Z'))
    const currencyMismatch = await finance.ingerirEventoProveedor(providerEvent('evt-currency', payment, 'approved', '1500.00', '2026-09-23T10:05:00.000Z', { currency_id: 'USD' }))
    const unknownStatus = await finance.ingerirEventoProveedor(providerEvent('evt-unknown', payment, 'authorized_by_magic', '1500.00', '2026-09-23T10:05:00.000Z'))
    const approved = await finance.ingerirEventoProveedor(providerEvent('evt-approved', payment, 'approved', '1500.00', '2026-09-23T10:10:00.000Z'))
    const duplicate = await finance.ingerirEventoProveedor(providerEvent('evt-approved', payment, 'approved', '1500.00', '2026-09-23T10:10:00.000Z'))
    const stale = await finance.ingerirEventoProveedor(providerEvent('evt-old-pending', payment, 'pending', '1500.00', '2026-09-23T10:01:00.000Z'))
    const invalidTransition = await finance.ingerirEventoProveedor(providerEvent('evt-rejected-late', payment, 'rejected', '1500.00', '2026-09-23T10:20:00.000Z'))
    const afterPaid = await codeOf(() => finance.crearIntencionPago({ ...customer, trabajoId: fixed.work.trabajoId, idempotencyKey: 'pay-after' }))
    const view = await finance.consultarFinanzasTrabajo({ ...customer, trabajoId: fixed.work.trabajoId })
    console.log(JSON.stringify({ invalidSignature, unmatched, amountMismatch: [amountMismatch.result, amountMismatch.reason, amountMismatch.payment.providerStatus], currencyMismatch: [currencyMismatch.result, currencyMismatch.reason], unknownStatus: [unknownStatus.result, unknownStatus.payment.providerStatus], approved: [approved.result, approved.payment.providerStatus, approved.obligation.status, approved.obligation.version], duplicate, stale: [stale.result, stale.payment.providerStatus], invalidTransition: [invalidTransition.result, invalidTransition.payment.providerStatus], afterPaid, view, inbox: [...financeStore.state.inbox.values()].map((event) => event.eventId + ':' + event.result), rawPreserved: [...financeStore.state.inbox.values()].every((event) => event.rawBody.startsWith('{') && event.signature.startsWith('sha256=')), outbox: financeStore.state.outbox.map((event) => event.eventType), statusChanges: financeStore.state.outbox.filter((event) => event.eventType === 'tus.payment.status_changed').length }))
  `)

  assert.deepEqual(result.invalidSignature, { status: 'invalid', reason: 'INVALID_SIGNATURE' })
  assert.deepEqual(result.unmatched, { status: 'unmatched', reason: 'payment_not_found' })
  assert.deepEqual(result.amountMismatch, ['quarantined', 'amount_mismatch', 'pending'])
  assert.deepEqual(result.currencyMismatch, ['quarantined', 'currency_mismatch'])
  assert.deepEqual(result.unknownStatus, ['ignored_unknown_status', 'pending'])
  assert.deepEqual(result.approved, ['applied', 'approved', 'paid', 2])
  assert.deepEqual(result.duplicate, {
    status: 'duplicate',
    eventId: 'evt-approved',
    result: 'applied',
  })
  assert.deepEqual(result.stale, ['stale', 'approved'])
  assert.deepEqual(result.invalidTransition, ['rejected_transition', 'approved'])
  assert.equal(result.afterPaid, 'OBLIGATION_NOT_PAYABLE')
  assert.equal(result.view.obligation.status, 'paid')
  assert.equal(result.view.payments[0].providerStatus, 'approved')
  assert.deepEqual(result.inbox, [
    'evt-amount:quarantined',
    'evt-currency:quarantined',
    'evt-unknown:ignored_unknown_status',
    'evt-approved:applied',
    'evt-old-pending:stale',
    'evt-rejected-late:rejected_transition',
  ])
  assert.equal(result.rawPreserved, true)
  assert.equal(result.statusChanges, 1)
})

test('WEB-09B rolls back every effect when a write fails and recovers the provider crash window', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${EVENT_HELPERS}
    const fixed = await payableWork('rollback')
    const created = await finance.crearIntencionPago({ ...customer, trabajoId: fixed.work.trabajoId, idempotencyKey: 'pay-r' })
    const plain = (value) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)
    const before = plain([...financeStore.state.intenciones.values()])
    financeStore.inyectarFalla('outbox')
    const failure = await codeOf(() => finance.ingerirEventoProveedor(providerEvent('evt-r', created.payment, 'approved', '1500.00', '2026-09-23T10:10:00.000Z')))
    const unchanged = plain([...financeStore.state.intenciones.values()]) === before
    const obligationAfterFailure = [...financeStore.state.obligaciones.values()][0].status
    const inboxAfterFailure = financeStore.state.inbox.size
    // Event arrives before the dispatch result was stored: the verified reference is adopted.
    const recovered = await finance.ingerirEventoProveedor(providerEvent('evt-r', created.payment, 'approved', '1500.00', '2026-09-23T10:10:00.000Z'))
    const dispatchAfterEvent = await finance.despacharIntencionPago({ tenantId: customer.tenantId, paymentId: created.payment.paymentId, correlationId: 'late-dispatch' })
    const creationFailureWork = await payableWork('rollback-create')
    financeStore.inyectarFalla('auditoria')
    const creationFailure = await codeOf(() => finance.crearIntencionPago({ ...customer, trabajoId: creationFailureWork.work.trabajoId, idempotencyKey: 'pay-rc' }))
    const noPartialObligation = [...financeStore.state.obligaciones.values()].every((obligation) => obligation.trabajoId !== creationFailureWork.work.trabajoId)
    const retryCreation = await finance.crearIntencionPago({ ...customer, trabajoId: creationFailureWork.work.trabajoId, idempotencyKey: 'pay-rc' })
    console.log(JSON.stringify({ failure, unchanged, obligationAfterFailure, inboxAfterFailure, recovered: [recovered.result, recovered.payment.providerReference, recovered.obligation.status], dispatchAfterEvent: dispatchAfterEvent.status, creationFailure, noPartialObligation, retryCreation: retryCreation.status }))
  `)

  assert.match(result.failure, /injected outbox failure/u)
  assert.equal(result.unchanged, true)
  assert.equal(result.obligationAfterFailure, 'pending_payment')
  assert.equal(result.inboxAfterFailure, 0)
  assert.deepEqual(result.recovered.slice(0, 1), ['applied'])
  assert.match(result.recovered[1], /^fake-mp-pago-/u)
  assert.equal(result.recovered[2], 'paid')
  assert.equal(result.dispatchAfterEvent, 'not_dispatchable')
  assert.match(result.creationFailure, /injected auditoria failure/u)
  assert.equal(result.noPartialObligation, true)
  assert.equal(result.retryCreation, 'executed')
})

test('WEB-09B HTTP routes derive authority from the session and reject client-supplied money', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}
    const fixed = await payableWork('http')
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { InMemoryTusCommitmentStore, InMemoryTusCompensationStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction, InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const commitments = new InMemoryTusCommitmentStore(); const compensations = new InMemoryTusCompensationStore(); const audits = new AlmacenReferenciasAuditoriaEnMemoria(); const idempotency = new InMemoryTusIdempotencyStore(); const outbox = new InMemoryTusOutboxStore()
    const application = new TusApplicationService({ commitments, compensations, audits, idempotency, outbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, outbox, compensations }), serviceFinance: finance })
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('customer-token', { sessionId: 's-c', subjectId: customer.actorId, tenantId: customer.tenantId, roles: ['customer'], permissions: ['tus:checkout', 'tus:work:read'] })
    sessions.add('provider-token', { sessionId: 's-p', subjectId: provider.actorId, tenantId: provider.tenantId, roles: ['provider'], permissions: ['tus:work:read', 'tus:work:write'] })
    sessions.add('stranger-token', { sessionId: 's-s', subjectId: stranger.actorId, tenantId: stranger.tenantId, roles: ['customer'], permissions: ['tus:checkout', 'tus:work:read'] })
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }), tusRoutesEnabled: true })
    const server = app.listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const call = async (method, path, token, body, key) => { const response = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'corr-http', 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() } }
    const path = '/tus/v1/work/' + fixed.work.trabajoId
    const withMoney = await call('POST', path + '/payment-intents', 'customer-token', { amountMinor: '1', currency: 'USD' }, 'http-1')
    const withoutKey = await call('POST', path + '/payment-intents', 'customer-token', {})
    const spoofed = await call('POST', path + '/payment-intents', 'customer-token', { tenantId: provider.tenantId }, 'http-spoof')
    const providerCreate = await call('POST', path + '/payment-intents', 'provider-token', {}, 'http-p')
    const created = await call('POST', path + '/payment-intents', 'customer-token', {}, 'http-1')
    const replay = await call('POST', '/tus/v1/trabajos/' + fixed.work.trabajoId + '/pagos', 'customer-token', {}, 'http-1')
    const customerView = await call('GET', path + '/finance', 'customer-token')
    const providerView = await call('GET', '/tus/v1/trabajos/' + fixed.work.trabajoId + '/finanzas', 'provider-token')
    const strangerView = await call('GET', path + '/finance', 'stranger-token')
    await new Promise((resolve) => server.close(resolve))
    console.log(JSON.stringify({ withMoney, withoutKey: withoutKey.status, spoofed: spoofed.status, providerCreate: providerCreate.status, created: { status: created.status, amount: created.body.payment.amountMinor, result: created.body.status }, replay: { status: replay.status, result: replay.body.status }, customerView: { status: customerView.status, viewer: customerView.body.viewer, payments: customerView.body.payments.length }, providerView: { status: providerView.status, viewer: providerView.body.viewer }, strangerView }))
  `)

  assert.equal(result.withMoney.status, 400)
  assert.equal(result.withMoney.body.code, 'CLIENT_AUTHORITY_FIELDS')
  assert.equal(result.withoutKey, 400)
  assert.equal(result.spoofed, 403)
  assert.equal(result.providerCreate, 403)
  assert.deepEqual(result.created, { status: 201, amount: '150000', result: 'executed' })
  assert.deepEqual(result.replay, { status: 200, result: 'replay' })
  assert.deepEqual(result.customerView, { status: 200, viewer: 'customer', payments: 1 })
  assert.deepEqual(result.providerView, { status: 200, viewer: 'provider' })
  assert.equal(result.strangerView.status, 404)
  assert.equal(result.strangerView.body.code, 'NOT_FOUND')
})

test('WEB-09B migration keeps the inbox, intents and audit additive and forward-only', () => {
  const migration = readFileSync(
    join(
      root,
      'apps/api/prisma/migrations/20260923110000_tus_service_payment_intents/migration.sql'
    ),
    'utf8'
  )
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|CASCADE|UPDATE\s+public)\b/iu)
  assert.match(migration, /CREATE UNIQUE INDEX "uq_intenciones_pago_tenant_obligacion_intento"/u)
  assert.match(migration, /CREATE TABLE public\."auditoria_finanzas_servicio"/u)
  assert.match(
    migration,
    /ALTER TABLE public\."eventos_webhook_pago" ADD COLUMN "obligacion_id" text;/u
  )
})

test('WEB-09B Prisma adapters persist service intents in the shared table, the inbox and the shared outbox', () => {
  const result = runTypeScriptScenario(`
    const { TransaccionFinanzasServicioPrisma } = await import('./apps/api/src/tus/adapters/prisma-finanzas-servicios.ts')
    const { ServicioFinanzasServicios } = await import('./apps/api/src/tus/finance/servicios/servicio.ts')
    const { ProveedorPagosServicioDeterminista } = await import('./apps/api/src/tus/finance/servicios/pagos.ts')
    const same = (left, right) => left === right || (typeof left === 'bigint' || typeof right === 'bigint' ? String(left) === String(right) : false)
    const matches = (row, where) => Object.entries(where).every(([key, value]) => key === 'OR' ? value.some((option) => matches(row, option)) : value && typeof value === 'object' && 'not' in value ? row[key] !== value.not && row[key] !== undefined : same(row[key], value))
    const delegate = (rows) => ({
      findFirst: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }) => rows.filter((row) => matches(row, where)),
      create: async ({ data }) => { if (data.id && rows.some((row) => row.id === data.id)) throw Object.assign(new Error('unique'), { code: 'P2002' }); rows.push({ ...data }); return data },
      updateMany: async ({ where, data }) => { const found = rows.filter((row) => matches(row, where)); found.forEach((row) => Object.assign(row, data)); return { count: found.length } },
    })
    const tables = {
      trabajo: [{ versionContrato: '1.0.0', trabajoId: 'trabajo-1', tenantId: 'customer', prestadorTenantId: 'provider', compromisoId: 'commitment-1', prestadorId: 'p-1', publicacionId: 'listing-1', reservaId: null, clienteId: 'customer', estado: 'completed', version: 4, requierePresupuesto: true, presupuestoAceptadoId: 'budget-1', presupuestoAceptadoVersion: 1, fechaCreacion: new Date('2026-09-23T09:00:00.000Z'), fechaActualizacion: new Date('2026-09-23T09:00:00.000Z') }],
      compromisoMercadoServicios: [{ tenantId: 'customer', compromisoId: 'commitment-1', prestadorTenantId: 'provider', prestadorId: 'p-1', publicacionId: 'listing-1', contexto: 'service', estado: 'confirmed', monto: 250000n, moneda: 'ARS' }],
      publicacion: [{ tenantId: 'provider', id: 'listing-1', prestadorId: 'p-1', tipo: 'service', modalidadPrecio: 'fixed' }],
      presupuesto: [{ tenantId: 'customer', prestadorTenantId: 'provider', trabajoId: 'trabajo-1', presupuestoId: 'budget-1', version: 1, estado: 'accepted', moneda: 'ARS', montoTotal: 250000n }], obligacionPagoServicio: [], idempotenciaFinanciera: [], intencionPago: [{ pagoId: 'legacy', tenantId: 'customer', compromisoId: 'legacy-commitment', obligacionId: null, referenciaProveedor: 'fake-mp-legacy', proveedor: 'mercado-pago' }], eventoWebhookPago: [], outboxEvent: [], auditoriaFinanzasServicio: [], instantaneaComision: [], movimientoContable: [], liquidacionServicio: [], conciliacionServicio: [],
    }
    const client = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, delegate(rows)]))
    client.$transaction = async (callback) => callback(client)
    const provider = new ProveedorPagosServicioDeterminista('prisma-secret')
    const finance = new ServicioFinanzasServicios(new TransaccionFinanzasServicioPrisma(client), () => Date.parse('2026-09-23T10:00:00.000Z'), provider)
    const created = await finance.crearIntencionPago({ tenantId: 'customer', actorId: 'u', correlationId: 'c', trabajoId: 'trabajo-1', idempotencyKey: 'k-1' })
    await finance.despacharIntencionPago({ tenantId: 'customer', paymentId: created.payment.paymentId, correlationId: 'd' })
    const rawBody = JSON.stringify({ id: 'evt-1', data: { id: 'fake-mp-' + created.payment.paymentId, external_reference: created.payment.paymentId, status: 'approved', transaction_amount: '2500.00', currency_id: 'ARS', date_last_updated: '2026-09-23T10:05:00.000Z' } })
    const approved = await finance.ingerirEventoProveedor({ rawBody, signature: provider.firmar(rawBody), receivedAt: '2026-09-23T10:06:00.000Z' })
    const duplicate = await finance.ingerirEventoProveedor({ rawBody, signature: provider.firmar(rawBody), receivedAt: '2026-09-23T10:07:00.000Z' })
    const serviceRow = tables.intencionPago.find((row) => row.obligacionId)
    const inboxRow = tables.eventoWebhookPago[0]
    const view = await finance.consultarFinanzasTrabajo({ tenantId: 'provider', actorId: 'p', correlationId: 'c', trabajoId: 'trabajo-1' })
    console.log(JSON.stringify({ approved: approved.result, duplicate: duplicate.status, compromisoId: serviceRow.compromisoId, obligacionId: serviceRow.obligacionId, intento: serviceRow.intento, clave: serviceRow.claveIdempotencia, monto: typeof serviceRow.monto, estadoProveedor: serviceRow.estadoProveedor, inbox: { raw: inboxRow.datosEvento.rawBody === rawBody, estado: inboxRow.estado, monto: String(inboxRow.monto), firma: inboxRow.firma.startsWith('sha256=') }, outbox: tables.outboxEvent.map((row) => row.aggregateType + ':' + row.eventType), audits: tables.auditoriaFinanzasServicio.length, obligation: tables.obligacionPagoServicio[0].estado, legacyUntouched: tables.intencionPago[0].estadoProveedor === undefined, viewPayments: view.payments.map((payment) => payment.providerStatus) }))
  `)

  assert.equal(result.approved, 'applied')
  assert.equal(result.duplicate, 'duplicate')
  assert.equal(result.compromisoId, null)
  assert.equal(result.obligacionId, 'obligacion-trabajo-1')
  assert.equal(result.intento, 1)
  assert.equal(result.clave, 'servicio:k-1')
  assert.equal(result.monto, 'bigint')
  assert.equal(result.estadoProveedor, 'approved')
  assert.deepEqual(result.inbox, { raw: true, estado: 'applied', monto: '250000', firma: true })
  assert.deepEqual(result.outbox, [
    'intencion_pago_servicio:tus.payment.intent_created',
    'intencion_pago_servicio:tus.payment.intent_dispatched',
    'liquidacion_servicio:tus.service_settlement.held',
    'intencion_pago_servicio:tus.payment.status_changed',
  ])
  assert.equal(result.obligation, 'paid')
  assert.equal(result.legacyUntouched, true)
  assert.deepEqual(result.viewPayments, ['approved'])
  assert.ok(result.audits >= 4)
})
