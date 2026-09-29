import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// FASE 7 (decision 2026-09-29): a request-born work is paid in two halves of its accepted budget
// through Mercado Pago: the deposit before it starts and the balance when the provider finishes;
// only the approved balance completes the work. Amounts, commission and seller come from the
// server; the redirect never confirms; only verified notifications move money state.
const SENA_SETUP = `${SERVICE_SETUP}
  const { InMemoryTrabajoOutboxStore: Outbox } = await import('./apps/api/src/tus/work/index.ts')
  const { accionesTrabajo } = await import('./apps/api/src/tus/work/resumen.ts')
  // 'on' | 'global_off' (platform switch off: previous behaviour) | 'no_account' (provider not linked).
  let mode = 'on'
  const politica = {
    reglaComision: async () => ({ politicaId: 'pol-1', rateBps: 1000, ruleVersion: 'test-10', pspFeeBearer: 'provider' }),
    disponibilidad: async () => (mode === 'on' ? { available: true, reason: null } : { available: false, reason: mode === 'global_off' ? 'PAYMENTS_DISABLED' : 'PROVIDER_ACCOUNT_NOT_CONNECTED' }),
  }
  const closingOutbox = new Outbox()
  const store = new AlmacenFinanzasServicioEnMemoria()
  const fin = new ServicioFinanzasServicios(
    new TransaccionFinanzasServicioEnMemoria(store, new IdentidadServicioEnMemoria(workStore, marketplace), {
      completarPorPagoFinal: (input) => work.completarPorPagoFinal({ work: workStore, outbox: closingOutbox }, input),
    }),
    clock, proveedorPagos, undefined, politica
  )
  const { pagosTrabajo } = await import('./apps/api/src/tus/composition/index.ts')
  work.conPagos(pagosTrabajo(fin))
  let seq = 0
  async function requestWork(id, total) {
    const { work: created } = await work.crearDesdeSolicitudEnTransaccion({ ...customer, solicitudId: 'sol-' + id, prestadorTenantId: provider.tenantId, prestadorId: 'provider-1', createdAt: '2026-09-23T09:00:00.000Z' })
    await acceptBudget(created.trabajoId, total)
    return created.trabajoId
  }
  const current = async (id) => (await work.getWork(provider, id)).work
  const step = async (op, id) => { const w = await current(id); seq += 1; return work[op]({ ...provider, trabajoId: id, expectedVersion: w.version, idempotencyKey: op + '-' + id + '-' + seq, requestHash: 'h' + seq, createdAt: '2026-09-23T10:0' + (seq % 10) + ':00.000Z' }) }
  let eventSeq = 0
  async function notify(paymentId, status, amount, overrides = {}) {
    eventSeq += 1
    const raw = JSON.stringify({ id: overrides.eventId ?? 'evt-' + eventSeq, data: { id: 'fake-mp-' + paymentId, external_reference: paymentId, status, currency_id: overrides.currency ?? 'ARS', transaction_amount: amount, date_last_updated: new Date(Date.parse('2026-09-23T11:00:00.000Z') + eventSeq * 1000).toISOString(), ...(overrides.data ?? {}) } })
    return fin.ingerirEventoProveedor({ rawBody: raw, signature: overrides.signature ?? proveedorPagos.firmar(raw), receivedAt: '2026-09-23T11:00:00.000Z' })
  }
`

test('FASE7 deposit before start, balance after finish, approved balance completes the work; amounts and commission from the server', () => {
  const result = runTypeScriptScenario(`${SENA_SETUP}
    const id = await requestWork('a', '10001')
    const previewSena = await fin.consultarVistaPreviaPago({ ...customer, trabajoId: id })
    const providerPreview = await codeOf(() => fin.consultarVistaPreviaPago({ ...provider, trabajoId: id }))
    const strangerCheckout = await codeOf(() => fin.iniciarCheckout({ ...stranger, trabajoId: id, idempotencyKey: 'k-x' }))
    const startBlocked = await codeOf(() => step('startWork', id))
    const stateBefore = await fin.estadoPagosTrabajo(await current(id))
    const checkout = await fin.iniciarCheckout({ ...customer, trabajoId: id, idempotencyKey: 'k-sena' })
    const replay = await fin.iniciarCheckout({ ...customer, trabajoId: id, idempotencyKey: 'k-sena' })
    const otherKey = await fin.iniciarCheckout({ ...customer, trabajoId: id, idempotencyKey: 'k-sena-2' })
    const senaCall = proveedorPagos.checkouts.at(-1)
    const invalid = await notify(checkout.payment.paymentId, 'approved', '50.01', { signature: 'sha256=forged' })
    const approved = await notify(checkout.payment.paymentId, 'approved', '50.01', { eventId: 'evt-sena' })
    const duplicate = await notify(checkout.payment.paymentId, 'approved', '50.01', { eventId: 'evt-sena' })
    const otherAmount = await notify(checkout.payment.paymentId, 'approved', '60.00')
    const workAfterSena = await current(id)
    const balanceTooEarly = await codeOf(() => fin.iniciarCheckout({ ...customer, trabajoId: id, idempotencyKey: 'k-early' }))
    const started = (await step('startWork', id)).work
    const previewNotFinished = await fin.consultarVistaPreviaPago({ ...customer, trabajoId: id })
    const finished = (await step('completeWork', id)).work
    const finishTwice = await codeOf(() => step('completeWork', id))
    const summaryActions = accionesTrabajo(finished, 'cliente', null, ['tus:checkout'], Date.now(), { required: true, online: true, unavailableReason: null, currency: 'ARS', totalMinor: '10001', deposit: { amountMinor: '5001', status: 'paid' }, balance: { amountMinor: '5000', status: 'not_created' } })
    const previewSaldo = await fin.consultarVistaPreviaPago({ ...customer, trabajoId: id })
    const balance = await fin.iniciarCheckout({ ...customer, trabajoId: id, idempotencyKey: 'k-saldo' })
    const saldoCall = proveedorPagos.checkouts.at(-1)
    const stillInProgress = (await current(id)).status
    const balanceApproved = await notify(balance.payment.paymentId, 'approved', '50.00', { eventId: 'evt-saldo' })
    const completed = await current(id)
    const balanceDuplicate = await notify(balance.payment.paymentId, 'approved', '50.00', { eventId: 'evt-saldo' })
    const detail = await work.getWork(customer, id)
    const previewPaid = await fin.consultarVistaPreviaPago({ ...customer, trabajoId: id })
    const stateAfter = await fin.estadoPagosTrabajo(completed)
    const financeView = await fin.consultarFinanzasTrabajo({ ...provider, trabajoId: id })
    const closingEvents = closingOutbox.list(customer.tenantId).map((record) => record.eventType)
    console.log(JSON.stringify({ previewSena, providerPreview, strangerCheckout, startBlocked, stateBefore: { required: stateBefore.required, online: stateBefore.online, deposit: [String(stateBefore.deposit.amountMinor), stateBefore.deposit.status], balance: [String(stateBefore.balance.amountMinor), stateBefore.balance.status] }, checkout: { status: checkout.status, part: checkout.obligation.part, amount: checkout.payment.amountMinor, url: checkout.checkoutUrl }, replay: [replay.status, replay.payment.paymentId === checkout.payment.paymentId], otherKey: [otherKey.status, otherKey.payment.paymentId === checkout.payment.paymentId], senaCall: { amount: String(senaCall.amountMinor), commission: String(senaCall.commissionMinor), title: senaCall.title, returnPath: senaCall.returnPath }, invalid, approved: [approved.status, approved.result, approved.obligation?.status], duplicate: duplicate.status, otherAmount: [otherAmount.result, otherAmount.reason], workAfterSena: workAfterSena.status, balanceTooEarly, started: started.status, previewNotFinished: [previewNotFinished.payable, previewNotFinished.notPayableReason, previewNotFinished.part], finished: [finished.status, Boolean(finished.finishedAt)], finishTwice, summaryActions, previewSaldo: [previewSaldo.payable, previewSaldo.part, previewSaldo.amountMinor], saldoCall: { amount: String(saldoCall.amountMinor), commission: String(saldoCall.commissionMinor), title: saldoCall.title }, stillInProgress, balanceApproved: [balanceApproved.result, balanceApproved.obligation?.part], completed: [completed.status, Boolean(completed.finishedAt)], balanceDuplicate: balanceDuplicate.status, transitions: detail.transitions.map((t) => t.reason), previewPaid: [previewPaid.payable, previewPaid.notPayableReason], stateAfter: [stateAfter?.deposit.status, stateAfter?.balance.status], parts: financeView.parts.map((p) => [p.obligation.part, p.obligation.amountMinor, p.obligation.status, p.obligation.publicacionId]), closingEvents }))
  `)
  assert.equal(result.previewSena.part, 'sena')
  assert.equal(result.previewSena.payable, true)
  assert.equal(result.previewSena.amountMinor, '5001')
  assert.equal(result.providerPreview, 'FORBIDDEN')
  assert.ok(['FORBIDDEN', 'NOT_FOUND'].includes(result.strangerCheckout))
  assert.equal(result.startBlocked, 'DEPOSIT_REQUIRED')
  assert.deepEqual(result.stateBefore, { required: true, online: true, deposit: ['5001', 'not_created'], balance: ['5000', 'not_created'] })
  assert.equal(result.checkout.part, 'sena')
  assert.equal(result.checkout.amount, '5001')
  // Same key replays; another key reuses the pending intent: one checkout per part.
  assert.deepEqual(result.replay, ['existing', true])
  assert.deepEqual(result.otherKey, ['existing', true])
  assert.deepEqual(result.senaCall, { amount: '5001', commission: '500', title: 'Seña (50%) del trabajo TUS', returnPath: '/trabajos/trabajo-solicitud-sol-a?pago=retorno' })
  assert.deepEqual(result.closingEvents, ['tus.work.completed'])
  assert.equal(result.invalid.status, 'invalid')
  assert.deepEqual(result.approved, ['recorded', 'applied', 'paid'])
  assert.equal(result.duplicate, 'duplicate')
  assert.deepEqual(result.otherAmount, ['quarantined', 'amount_mismatch'])
  // The deposit alone never changes the work state.
  assert.equal(result.workAfterSena, 'accepted')
  assert.equal(result.balanceTooEarly, 'WORK_NOT_FINISHED')
  assert.equal(result.started, 'in_progress')
  assert.deepEqual(result.previewNotFinished, [false, 'WORK_NOT_FINISHED', 'saldo'])
  // Online payments: finishing waits for the balance instead of completing.
  assert.deepEqual(result.finished, ['in_progress', true])
  assert.equal(result.finishTwice, 'ALREADY_FINISHED')
  assert.equal(result.summaryActions.canPayBalance, true)
  assert.equal(result.summaryActions.canPayDeposit, false)
  assert.equal(result.summaryActions.canComplete, false)
  assert.deepEqual(result.previewSaldo, [true, 'saldo', '5000'])
  assert.deepEqual(result.saldoCall, { amount: '5000', commission: '500', title: 'Saldo (50%) del trabajo TUS' })
  assert.equal(result.stillInProgress, 'in_progress')
  assert.deepEqual(result.balanceApproved, ['applied', 'saldo'])
  assert.deepEqual(result.completed, ['completed', true])
  assert.equal(result.balanceDuplicate, 'duplicate')
  assert.equal(result.transitions.filter((reason) => reason === 'work.completed_after_final_payment').length, 1)
  assert.deepEqual(result.previewPaid, [false, 'ALREADY_PAID'])
  assert.deepEqual(result.stateAfter, ['paid', 'paid'])
  assert.deepEqual(result.parts, [['sena', '5001', 'paid', null], ['saldo', '5000', 'paid', null]])
})

test('FASE7 nothing is payable for cancelled works, without an accepted budget or twice; offline payments gate nothing', () => {
  const result = runTypeScriptScenario(`${SENA_SETUP}
    const { work: noBudget } = await work.crearDesdeSolicitudEnTransaccion({ ...customer, solicitudId: 'sol-nb', prestadorTenantId: provider.tenantId, prestadorId: 'provider-1', createdAt: '2026-09-23T09:00:00.000Z' })
    const withoutBudget = await fin.consultarVistaPreviaPago({ ...customer, trabajoId: noBudget.trabajoId })
    const withoutBudgetCheckout = await codeOf(() => fin.iniciarCheckout({ ...customer, trabajoId: noBudget.trabajoId, idempotencyKey: 'k-nb' }))
    const cancelledId = await requestWork('c', '20000')
    await step('cancelWork', cancelledId)
    const cancelled = await fin.consultarVistaPreviaPago({ ...customer, trabajoId: cancelledId })
    const cancelledCheckout = await codeOf(() => fin.iniciarCheckout({ ...customer, trabajoId: cancelledId, idempotencyKey: 'k-c' }))
    mode = 'global_off'
    const offId = await requestWork('off', '30000')
    const offPreview = await fin.consultarVistaPreviaPago({ ...customer, trabajoId: offId })
    const offCheckout = await codeOf(() => fin.iniciarCheckout({ ...customer, trabajoId: offId, idempotencyKey: 'k-off' }))
    const offStart = (await step('startWork', offId)).work.status
    const offComplete = (await step('completeWork', offId)).work.status
    const splits = ['1', '2', '3', '99999', '100000'].map((total) => { const t = BigInt(total); const sena = (t + 1n) / 2n; return [String(sena), String(t - sena), String(sena + (t - sena)) === total] })
    const mkWork = await payableWork('mk', '150000')
    const marketplacePreview = await fin.consultarVistaPreviaPago({ ...customer, trabajoId: mkWork.work.trabajoId })
    console.log(JSON.stringify({ withoutBudget: [withoutBudget.payable, withoutBudget.notPayableReason], withoutBudgetCheckout, cancelled: [cancelled.payable, cancelled.notPayableReason], cancelledCheckout, offPreview: [offPreview.payable, offPreview.paymentAvailable, offPreview.unavailableReason], offCheckout, offStart, offComplete, splits, marketplacePreview: [marketplacePreview.part, marketplacePreview.amountMinor] }))
  `)
  assert.deepEqual(result.withoutBudget, [false, 'BUDGET_REQUIRED'])
  assert.equal(result.withoutBudgetCheckout, 'BUDGET_REQUIRED')
  assert.deepEqual(result.cancelled, [false, 'WORK_CANCELLED'])
  assert.equal(result.cancelledCheckout, 'WORK_CANCELLED')
  assert.deepEqual(result.offPreview, [true, false, 'PAYMENTS_DISABLED'])
  assert.equal(result.offCheckout, 'PAYMENTS_DISABLED')
  // Without online payments the flow is the previous one: start and complete directly.
  assert.equal(result.offStart, 'in_progress')
  assert.equal(result.offComplete, 'completed')
  for (const [, , sums] of result.splits) assert.equal(sums, true)
  assert.deepEqual(result.splits[0].slice(0, 2), ['1', '0'])
  assert.deepEqual(result.splits[3].slice(0, 2), ['50000', '49999'])
  // Marketplace works keep a single 'total' charge after completion (W09-02 unchanged).
  assert.deepEqual(result.marketplacePreview, ['total', '150000'])
})

test('FASE7 migration: deposit/balance obligations are additive, pinned to the work and one per part', () => {
  const sql = readFileSync(join(root, 'apps/api/prisma/migrations/20261012100000_tus_pago_sena_saldo/migration.sql'), 'utf8')
  assert.match(sql, /ADD COLUMN "tramo" text NOT NULL DEFAULT 'total'/u)
  assert.match(sql, /CHECK \("tramo" IN \('total', 'sena', 'saldo'\)\)/u)
  assert.match(sql, /uq_obligaciones_pago_tenant_trabajo_tramo[^;]+\("tenant_id", "trabajo_id", "tramo"\)/u)
  assert.match(sql, /fk_obligaciones_pago_trabajo_prestador/u)
  assert.match(sql, /ADD COLUMN "terminado_en" timestamp\(3\)/u)
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM|^\s*UPDATE /imu)
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  assert.match(schema, /tramo\s+String\s+@default\("total"\) @map\("tramo"\)/u)
  assert.match(schema, /terminadoEn\s+DateTime\? @map\("terminado_en"\)/u)
})

test('FASE7 provider without Mercado Pago blocks the start (never free); global switch off keeps compatibility; commission frozen per checkout; adversarial notifications change nothing', () => {
  const result = runTypeScriptScenario(`${SENA_SETUP}
    let rate = 1000
    politica.reglaComision = async () => ({ politicaId: 'pol-' + rate, rateBps: rate, ruleVersion: 'r-' + rate, pspFeeBearer: 'provider' })
    mode = 'no_account'
    const na = await requestWork('na', '100000')
    const naStart = await codeOf(() => step('startWork', na))
    const naState = await fin.estadoPagosTrabajo(await current(na))
    const naActions = accionesTrabajo(await current(na), 'prestador', null, ['tus:marketplace:write'], Date.now(), { required: naState.required, online: naState.online, unavailableReason: naState.unavailableReason, currency: 'ARS', totalMinor: '100000', deposit: { amountMinor: '50000', status: 'not_created' }, balance: { amountMinor: '50000', status: 'not_created' } })
    const naCheckout = await codeOf(() => fin.iniciarCheckout({ ...customer, trabajoId: na, idempotencyKey: 'k-na' }))
    mode = 'global_off'
    const offState = await fin.estadoPagosTrabajo(await current(na))
    const offStart = (await step('startWork', na)).work.status
    mode = 'on'
    const id = await requestWork('fz', '100000')
    const sena = await fin.iniciarCheckout({ ...customer, trabajoId: id, idempotencyKey: 'k-fz' })
    rate = 1500
    const feeMismatch = await notify(sena.payment.paymentId, 'approved', '500.00', { data: { marketplace_fee: '75.00' } })
    const usd = await notify(sena.payment.paymentId, 'approved', '500.00', { currency: 'USD' })
    const unknown = await notify('pago-inexistente', 'approved', '500.00')
    const stillPending = (await fin.estadoPagosTrabajo(await current(id))).deposit.status
    const ok = await notify(sena.payment.paymentId, 'approved', '500.00', { data: { marketplace_fee: '50.00' } })
    const senaCommission = (await fin.consultarFinanzasTrabajo({ ...provider, trabajoId: id })).commission
    await step('startWork', id)
    await step('completeWork', id)
    await fin.iniciarCheckout({ ...customer, trabajoId: id, idempotencyKey: 'k-fz-2' })
    const saldoCommission = String(proveedorPagos.checkouts.at(-1).commissionMinor)
    const tooSmall = await codeOf(async () => { const { work: w } = await work.crearDesdeSolicitudEnTransaccion({ ...customer, solicitudId: 'sol-min', prestadorTenantId: provider.tenantId, prestadorId: 'provider-1', createdAt: '2026-09-23T09:00:00.000Z' }); await acceptBudget(w.trabajoId, '1') })
    const minId = await requestWork('min2', '2')
    const minState = await fin.estadoPagosTrabajo(await current(minId))
    // HTTP: the browser cannot send an amount or a tenant; another client cannot open the checkout.
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { InMemoryTusCommitmentStore, InMemoryTusCompensationStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction, InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('customer-token', { sessionId: 's-c', subjectId: customer.actorId, tenantId: customer.tenantId, roles: ['customer'], permissions: ['tus:checkout', 'tus:marketplace:read'] })
    sessions.add('stranger-token', { sessionId: 's-s', subjectId: stranger.actorId, tenantId: stranger.tenantId, roles: ['customer'], permissions: ['tus:checkout', 'tus:marketplace:read'] })
    const commitments = new InMemoryTusCommitmentStore(); const compensations = new InMemoryTusCompensationStore(); const audits = new AlmacenReferenciasAuditoriaEnMemoria(); const idempotency = new InMemoryTusIdempotencyStore(); const outbox = new InMemoryTusOutboxStore()
    const application = new TusApplicationService({ commitments, compensations, audits, idempotency, outbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, outbox, compensations }), serviceFinance: fin })
    const httpId = await requestWork('http', '40000')
    const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const post = async (token, body, key) => { const r = await fetch(base + '/tus/v1/work/' + httpId + '/checkout', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'c', 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) } }
    let http
    try {
      http = { amount: await post('customer-token', { amountMinor: '1' }, 'h1'), tenant: await post('customer-token', { tenantId: stranger.tenantId }, 'h2'), stranger: await post('stranger-token', {}, 'h3'), ok: await post('customer-token', {}, 'h4') }
    } finally { server.close() }
    console.log(JSON.stringify({ naStart, naState: [naState.required, naState.online, naState.unavailableReason], naCanStart: naActions.canStart, naCheckout, offState: [offState.required, offState.online], offStart, feeMismatch: [feeMismatch.result, feeMismatch.reason], usd: [usd.result, usd.reason], unknown: unknown.status, stillPending, ok: ok.result, senaCommission: [senaCommission.rateBps, senaCommission.commissionMinor], saldoCommission, tooSmall, minState: [String(minState.deposit.amountMinor), String(minState.balance.amountMinor)], http: { amount: [http.amount.status, http.amount.body?.code], tenant: http.tenant.status, stranger: http.stranger.status, ok: [http.ok.status, http.ok.body?.payment?.amountMinor] } }))
  `)
  assert.equal(result.naStart, 'PROVIDER_PAYMENT_ACCOUNT_REQUIRED')
  assert.deepEqual(result.naState, [true, false, 'PROVIDER_ACCOUNT_NOT_CONNECTED'])
  assert.equal(result.naCanStart, false)
  assert.equal(result.naCheckout, 'PROVIDER_ACCOUNT_NOT_CONNECTED')
  // Platform switch off: compatibility, nothing gated.
  assert.deepEqual(result.offState, [false, false])
  assert.equal(result.offStart, 'in_progress')
  assert.deepEqual(result.feeMismatch, ['quarantined', 'marketplace_fee_mismatch'])
  assert.deepEqual(result.usd, ['quarantined', 'currency_mismatch'])
  assert.equal(result.unknown, 'unmatched')
  assert.equal(result.stillPending, 'pending_payment')
  assert.equal(result.ok, 'applied')
  // The deposit keeps the 10% frozen at its checkout even though the policy moved to 15%.
  assert.deepEqual(result.senaCommission, [1000, '5000'])
  assert.equal(result.saldoCommission, '7500')
  assert.equal(result.tooSmall, 'BUDGET_TOO_SMALL')
  assert.deepEqual(result.minState, ['1', '1'])
  assert.deepEqual(result.http.amount, [400, 'CLIENT_AUTHORITY_FIELDS'])
  assert.equal(result.http.tenant, 403)
  assert.ok([403, 404].includes(result.http.stranger))
  assert.deepEqual(result.http.ok, [201, '20000'])
})
