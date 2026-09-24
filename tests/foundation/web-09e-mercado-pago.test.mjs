import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { MERCADO_PAGO_SANDBOX_SETUP } from './fixtures/mercado-pago-sandbox.mjs'
import { reviewMigrationChain } from '../../scripts/tus-migration-repair-lib.mjs'

const SETUP = `${SERVICE_SETUP}${MERCADO_PAGO_SANDBOX_SETUP}`

test('WEB-09E checkout: seller OAuth required, exact budget amount, integer marketplace fee, one checkout per click', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const done = await payableWork('checkout', '5000000', { priceMode: 'precio_desde', priceMinor: 100n })
    const withoutOauth = (await mpFinance.consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })).unavailableReason
    const withoutOauthCode = await codeOf(() => mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'no-oauth' }))
    const connected = await connectSeller(provider.tenantId, '777')
    const preview = await mpFinance.consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })
    const first = await mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'click-1' })
    const sameKey = await mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'click-1' })
    const otherKey = await mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'click-2' })
    const preference = mp.preferences[0]
    const preferenceRequest = mp.requests.find((request) => request.path === '/checkout/preferences')
    const providerCode = await codeOf(() => mpFinance.iniciarCheckout({ ...provider, trabajoId: done.work.trabajoId, idempotencyKey: 'provider-click' }))
    const strangerCode = await codeOf(() => mpFinance.iniciarCheckout({ ...stranger, trabajoId: done.work.trabajoId, idempotencyKey: 'stranger-click' }))
    const intent = [...financeStore.state.intenciones.values()][0]
    console.log(JSON.stringify({ withoutOauth, withoutOauthCode, connected: connected.status, preview: [preview.paymentAvailable, preview.amountMinor], first: { status: first.status, url: first.checkoutUrl, payment: first.payment.paymentId }, sameKey: [sameKey.status, sameKey.checkoutUrl], otherKey: [otherKey.status, otherKey.checkoutUrl], preferences: mp.preferences.length, body: preference.body, idempotencyKey: preference.idempotencyKey, authorization: preferenceRequest.headers.authorization.startsWith('Bearer APP_USR-token-777-'), providerCode, strangerCode, frozen: plain(intent.commission), intentsText: JSON.stringify(plain([...financeStore.state.intenciones.values()])) }))
  `)

  assert.equal(result.withoutOauth, 'PROVIDER_ACCOUNT_NOT_CONNECTED')
  assert.equal(result.withoutOauthCode, 'PROVIDER_ACCOUNT_NOT_CONNECTED')
  assert.equal(result.connected, 'connected')
  assert.deepEqual(result.preview, [true, '5000000'])
  assert.equal(result.first.status, 'created')
  assert.match(result.first.url, /^https:\/\/sandbox\.mercadopago\.com\.ar\//u)
  assert.deepEqual(result.sameKey, ['existing', result.first.url])
  assert.deepEqual(result.otherKey, ['existing', result.first.url])
  assert.equal(result.preferences, 1)
  // Customer pays exactly the accepted budget ($50.000); TUS 10% = $5.000 as marketplace_fee.
  assert.equal(result.body.items.length, 1)
  assert.equal(result.body.items[0].quantity, 1)
  assert.equal(result.body.items[0].unit_price, 50000)
  assert.equal(result.body.items[0].currency_id, 'ARS')
  assert.equal(result.body.marketplace_fee, 5000)
  assert.equal(result.body.external_reference, result.first.payment)
  assert.equal(
    result.body.notification_url,
    'https://api.tus.test/tus/v1/integrations/mercado-pago/webhooks'
  )
  assert.equal(
    result.body.back_urls.success,
    `https://web.tus.test/tus/compromisos?pago=retorno&trabajo=${encodeURIComponent(result.first.payment.replace(/^pago-obligacion-/u, '').replace(/-1$/u, ''))}`
  )
  assert.equal(result.idempotencyKey, result.first.payment)
  assert.equal(result.authorization, true)
  assert.equal(result.providerCode, 'FORBIDDEN')
  assert.equal(result.strangerCode, 'NOT_FOUND')
  assert.deepEqual(result.frozen, {
    rateBps: 1000,
    ruleVersion: 'mvp-10-percent-v1',
    politicaId: null,
    commissionMinor: '500000',
  })
  assert.doesNotMatch(result.intentsText, /APP_USR|TG-refresh/u)
})

test('WEB-09E concurrent clicks create a single checkout; not completed or unbudgeted work is never payable', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await connectSeller(provider.tenantId, '777')
    const done = await payableWork('race', '5000000')
    const race = await Promise.allSettled([
      mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'race-a' }),
      mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'race-b' }),
    ])
    const retry = await mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'race-c' })
    const accepted = await serviceWork('not-done', { priceMode: 'requires_budget', bookingMode: 'requiere_presupuesto' })
    await acceptBudget(accepted.work.trabajoId, '5000000')
    const notCompleted = await codeOf(() => mpFinance.iniciarCheckout({ ...customer, trabajoId: accepted.work.trabajoId, idempotencyKey: 'nd' }))
    const fixed = await serviceWork('no-budget', { priceMode: 'fixed' })
    await finishWork(fixed.work.trabajoId)
    const noBudget = await codeOf(() => mpFinance.iniciarCheckout({ ...customer, trabajoId: fixed.work.trabajoId, idempotencyKey: 'nb' }))
    console.log(JSON.stringify({ race: race.map((item) => item.status === 'fulfilled' ? 'ok' : item.reason.code), retry: retry.status, preferences: mp.preferences.length, intents: financeStore.state.intenciones.size, notCompleted, noBudget }))
  `)

  assert.equal(result.preferences, 1)
  assert.equal(result.intents, 1)
  assert.ok(result.race.includes('ok'))
  assert.ok(result.race.every((item) => item === 'ok' || item === 'IN_PROGRESS'))
  assert.equal(result.retry, 'existing')
  assert.equal(result.notCompleted, 'WORK_NOT_COMPLETED')
  assert.equal(result.noBudget, 'BUDGET_REQUIRED')
})

test('WEB-09E seller token is renewed before use and a failed renewal fails closed', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await connectSeller(provider.tenantId, '777')
    const done = await payableWork('refresh', '5000000')
    // 180 days later the token is inside the renewal window: it is renewed before the call.
    nowMs += 175 * 24 * 60 * 60 * 1000
    const before = await accountsStore.buscarCuenta(provider.tenantId)
    const checkout = await mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'refresh-1' })
    const refreshCalls = mp.requests.filter((request) => request.path === '/oauth/token' && request.body.grant_type === 'refresh_token')
    const after = await accountsStore.buscarCuenta(provider.tenantId)
    const usedToken = mp.requests.find((request) => request.path === '/checkout/preferences').headers.authorization
    // Second seller whose refresh token is revoked and whose token already expired.
    const otherProvider = { tenantId: 'provider-tenant-2', actorId: 'p2', correlationId: 'c2' }
    await connectSeller(otherProvider.tenantId, '888')
    const credential = JSON.parse((await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')).BovedaCredencialesAesGcm.prototype.descifrar.call(new (await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')).BovedaCredencialesAesGcm(mpEnv.TUS_PAYMENT_CREDENTIALS_KEY), accountsStore.credenciales.get(otherProvider.tenantId).ciphertext, 'payment-account:' + otherProvider.tenantId))
    mp.refreshFails.add(credential.refreshToken)
    nowMs += 181 * 24 * 60 * 60 * 1000
    let refreshError = 'none'
    try { await paymentsWithOauth.cuentas.tokenVigente(otherProvider.tenantId) } catch (error) { refreshError = error.code }
    const expired = await paymentsWithOauth.cuentas.estadoCuenta({ tenantId: otherProvider.tenantId })
    const stillAvailable = await paymentsWithOauth.politica.disponibilidad({ prestadorTenantId: otherProvider.tenantId, prestadorId: 'x', categoria: null })
    console.log(JSON.stringify({ checkout: checkout.status, refreshCalls: refreshCalls.length, refreshBody: refreshCalls[0]?.body ?? null, versions: [before.version, after.version], expiresMoved: Date.parse(after.expiresAt) > Date.parse(before.expiresAt), usedToken, refreshError, expired: expired.status, stillAvailable, secretOutsideOauth: JSON.stringify(mp.requests.filter((request) => request.path !== '/oauth/token')).includes('client-secret-value') }))
  `)

  assert.equal(result.checkout, 'created')
  assert.equal(result.refreshCalls, 1)
  assert.equal(result.refreshBody.grant_type, 'refresh_token')
  assert.deepEqual(result.versions, [1, 2])
  assert.equal(result.expiresMoved, true)
  assert.match(result.usedToken, /^Bearer APP_USR-token-777-2$/u)
  assert.equal(result.refreshError, 'PROVIDER_ACCOUNT_NOT_CONNECTED')
  assert.equal(result.expired, 'expired')
  assert.deepEqual(result.stillAvailable, {
    available: false,
    reason: 'PROVIDER_ACCOUNT_NOT_CONNECTED',
  })
  // The client secret travels only to /oauth/token (never to payment APIs).
  assert.equal(result.secretOutsideOauth, false)
})

test('WEB-09E webhook: signature with ms timestamp, server-side lookup, approval with real fee and exact net', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await connectSeller(provider.tenantId, '777')
    const done = await payableWork('webhook', '5000000')
    const checkout = await mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'wh-1' })
    const pendingPreview = await mpFinance.consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })
    const preference = mp.preferences[0]
    mpPayment('1001', preference)
    const snapshotWrites = () => financeStore.state.comisiones.size + financeStore.state.ledger.size + financeStore.state.inbox.size
    const before = snapshotWrites()
    const badSignature = await mpFinance.ingerirEventoProveedor(notification('1001', { secret: 'other-secret' }))
    const secondsTs = await mpFinance.ingerirEventoProveedor(notification('1001', { ts: Math.floor(nowMs / 1000) }))
    const expired = await mpFinance.ingerirEventoProveedor(notification('1001', { ts: nowMs - 6 * 60 * 1000 }))
    const wrongRequest = await mpFinance.ingerirEventoProveedor(notification('1001', { signedRequestId: 'another-request' }))
    const tampered = await mpFinance.ingerirEventoProveedor(notification('1001', { bodyDataId: '9999' }))
    const otherTopic = await mpFinance.ingerirEventoProveedor(notification('1001', { type: 'merchant_order' }))
    const unknownSeller = await mpFinance.ingerirEventoProveedor(notification('1001', { userId: '555' }))
    const afterRejected = snapshotWrites()
    const approvedEvent = notification('1001', { notificationId: 'notif-approved' })
    const approved = await mpFinance.ingerirEventoProveedor(approvedEvent)
    const duplicate = await mpFinance.ingerirEventoProveedor(approvedEvent)
    const snapshot = plain([...financeStore.state.comisiones.values()][0])
    const confirmed = await mpFinance.consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })
    const providerView = await mpFinance.consultarFinanzasTrabajo({ ...provider, trabajoId: done.work.trabajoId })
    const customerView = await mpFinance.consultarFinanzasTrabajo({ ...customer, trabajoId: done.work.trabajoId })
    // Older notification arriving late: stale, no change.
    mp.payments.set('1001', { ...mp.payments.get('1001'), status: 'pending', status_detail: 'pending_contingency', date_last_updated: '2026-09-23T10:01:00.000Z' })
    const outOfOrder = await mpFinance.ingerirEventoProveedor(notification('1001'))
    console.log(JSON.stringify({ pendingPreview: [pendingPreview.paymentStatus, pendingPreview.obligation?.status ?? null, pendingPreview.paymentReference ?? null], before, afterRejected, badSignature, secondsTs, expired, wrongRequest, tampered, otherTopic, unknownSeller, approved: [approved.result, approved.obligation.status, approved.payment.providerReference], duplicate, snapshot, confirmed: [confirmed.paymentStatus, confirmed.paymentReference, confirmed.notPayableReason], providerCommission: providerView.commission, customerCommission: customerView.commission ?? null, outOfOrder: [outOfOrder.result, outOfOrder.reason], lookups: mp.requests.filter((request) => request.path === '/v1/payments/1001').length, checkoutUrl: checkout.checkoutUrl }))
  `)

  // Redirect/checkout alone never approves: still pending without a verified notification.
  assert.deepEqual(result.pendingPreview, ['pending', 'pending_payment', null])
  assert.equal(result.badSignature.reason, 'INVALID_SIGNATURE')
  assert.equal(result.secondsTs.reason, 'EXPIRED_SIGNATURE')
  assert.equal(result.expired.reason, 'EXPIRED_SIGNATURE')
  assert.equal(result.wrongRequest.reason, 'INVALID_SIGNATURE')
  assert.equal(result.tampered.reason, 'INVALID_EVENT')
  assert.equal(result.otherTopic.reason, 'UNSUPPORTED_TOPIC')
  assert.equal(result.unknownSeller.reason, 'UNKNOWN_COLLECTOR')
  assert.equal(result.afterRejected, result.before)
  assert.deepEqual(result.approved, ['applied', 'paid', '1001'])
  assert.deepEqual(result.duplicate, {
    status: 'duplicate',
    eventId: 'mp-notification-notif-approved',
    result: 'applied',
  })
  // $50.000 - Mercado Pago $3.000 - TUS $5.000 = $42.000 for the provider.
  assert.equal(result.snapshot.grossMinor, '5000000')
  assert.equal(result.snapshot.rateBps, 1000)
  assert.equal(result.snapshot.commissionMinor, '500000')
  assert.equal(result.snapshot.pspFeeMinor, '300000')
  assert.equal(result.snapshot.pspFeeBearer, 'provider')
  assert.equal(result.snapshot.providerNetMinor, '4200000')
  assert.equal(result.snapshot.providerReference, '1001')
  assert.deepEqual(result.confirmed, ['approved', '1001', 'ALREADY_PAID'])
  assert.deepEqual(result.providerCommission, {
    rateBps: 1000,
    ruleVersion: 'mvp-10-percent-v1',
    grossMinor: '5000000',
    commissionMinor: '500000',
    pspFeeMinor: '300000',
    providerNetMinor: '4200000',
    currency: 'ARS',
  })
  assert.equal(result.customerCommission, null)
  assert.deepEqual(result.outOfOrder, ['stale', 'older_than_last_applied_event'])
})

test('WEB-09E rejected and pending attempts never close the checkout; a later approval on the same checkout is booked', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await connectSeller(provider.tenantId, '777')
    const done = await payableWork('attempts', '5000000')
    await mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'att-1' })
    const preference = mp.preferences[0]
    mpPayment('2001', preference, { status: 'in_process', status_detail: 'pending_contingency', fee_details: [] })
    const pending = await mpFinance.ingerirEventoProveedor(notification('2001'))
    nowMs += 1000
    mpPayment('2002', preference, { status: 'rejected', status_detail: 'cc_rejected_insufficient_amount', fee_details: [], date_last_updated: '2026-09-23T10:07:00.000Z' })
    const rejected = await mpFinance.ingerirEventoProveedor(notification('2002'))
    const afterRejected = await mpFinance.consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })
    mpPayment('2003', preference, { date_last_updated: '2026-09-23T10:08:00.000Z', fee_details: [{ type: 'application_fee', amount: 5000 }] })
    const approved = await mpFinance.ingerirEventoProveedor(notification('2003'))
    const feeLater = plain([...financeStore.state.comisiones.values()][0])
    // Mercado Pago reports the fee on a later update: the snapshot is completed once.
    mp.payments.set('2003', { ...mp.payments.get('2003'), date_last_updated: '2026-09-23T10:09:00.000Z', fee_details: [{ type: 'mercadopago_fee', amount: 2999.99 }, { type: 'application_fee', amount: 5000 }] })
    const feeUpdate = await mpFinance.ingerirEventoProveedor(notification('2003'))
    const completed = plain([...financeStore.state.comisiones.values()][0])
    mp.payments.set('2003', { ...mp.payments.get('2003'), date_last_updated: '2026-09-23T10:10:00.000Z', fee_details: [{ type: 'mercadopago_fee', amount: 1 }] })
    await mpFinance.ingerirEventoProveedor(notification('2003'))
    const notRewritten = plain([...financeStore.state.comisiones.values()][0]).pspFeeMinor
    // A second approved payment on the same checkout is a double charge: quarantined.
    mpPayment('2004', preference, { date_last_updated: '2026-09-23T10:11:00.000Z' })
    const duplicateCharge = await mpFinance.ingerirEventoProveedor(notification('2004'))
    console.log(JSON.stringify({ pending: [pending.result, pending.reason, pending.payment.providerStatus], rejected: [rejected.result, rejected.reason, rejected.payment.providerStatus, rejected.payment.providerError], afterRejected: [afterRejected.paymentStatus, afterRejected.lastAttemptFailed, afterRejected.paymentAvailable], approved: [approved.result, approved.obligation.status], feeLater: [feeLater.pspFeeMinor, feeLater.providerNetMinor], feeUpdate: [feeUpdate.result], completed: [completed.pspFeeMinor, completed.providerNetMinor], notRewritten, duplicateCharge: [duplicateCharge.result, duplicateCharge.reason], ledger: financeStore.state.ledger.size }))
  `)

  assert.deepEqual(result.pending, ['no_op', 'same_status', 'pending'])
  assert.deepEqual(result.rejected, [
    'no_op',
    'hosted_checkout_attempt_rejected',
    'pending',
    'PAYMENT_REJECTED',
  ])
  assert.deepEqual(result.afterRejected, ['pending', true, true])
  assert.deepEqual(result.approved, ['applied', 'paid'])
  assert.deepEqual(result.feeLater, [null, null])
  assert.deepEqual(result.feeUpdate, ['no_op'])
  assert.deepEqual(result.completed, ['299999', '4200001'])
  assert.equal(result.notRewritten, '299999')
  assert.deepEqual(result.duplicateCharge, ['quarantined', 'provider_reference_mismatch'])
  assert.equal(result.ledger, 3)
})

test('WEB-09E commission is frozen when the checkout is created and a mismatching marketplace fee is quarantined', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await connectSeller(provider.tenantId, '777')
    const done = await payableWork('frozen', '5000000')
    await mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'fr-1' })
    await paymentsWithOauth.configuracion.registrarPolitica(admin, { scope: 'global', rateBps: 1200, pspFeeBearer: 'provider', reason: 'raise', expectedVersion: 0 })
    mpPayment('3001', mp.preferences[0])
    const approved = await mpFinance.ingerirEventoProveedor(notification('3001'))
    const snapshot = plain([...financeStore.state.comisiones.values()][0])
    const next = await payableWork('frozen-next', '5000000')
    await mpFinance.iniciarCheckout({ ...customer, trabajoId: next.work.trabajoId, idempotencyKey: 'fr-2' })
    const secondFee = mp.preferences[1].body.marketplace_fee
    mpPayment('3002', mp.preferences[1], { marketplace_fee: 1, fee_details: [] })
    const mismatch = await mpFinance.ingerirEventoProveedor(notification('3002'))
    console.log(JSON.stringify({ approved: approved.result, snapshot: [snapshot.rateBps, snapshot.commissionMinor, snapshot.ruleVersion], firstFee: mp.preferences[0].body.marketplace_fee, secondFee, mismatch: [mismatch.result, mismatch.reason, mismatch.obligation.status] }))
  `)

  assert.equal(result.approved, 'applied')
  assert.deepEqual(result.snapshot, [1000, '500000', 'mvp-10-percent-v1'])
  assert.equal(result.firstFee, 5000)
  assert.equal(result.secondFee, 6000)
  assert.deepEqual(result.mismatch, ['quarantined', 'marketplace_fee_mismatch', 'pending_payment'])
})

test('WEB-09E refunds: total refund through the seller, idempotent, and a seller without balance goes to review', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await connectSeller(provider.tenantId, '777')
    async function paid(id, paymentNumber) {
      const done = await payableWork(id, '5000000')
      const checkout = await mpFinance.iniciarCheckout({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'pay-' + id })
      const preference = mp.preferences.find((item) => item.body.external_reference === checkout.payment.paymentId)
      mpPayment(paymentNumber, preference)
      await mpFinance.ingerirEventoProveedor(notification(paymentNumber))
      return checkout.payment.paymentId
    }
    const paymentA = await paid('refund-ok', '4001')
    const refund = await mpFinance.solicitarReembolso({ tenantId: customer.tenantId, paymentId: paymentA, actorId: 'platform-admin', correlationId: 'r1', idempotencyKey: 'refund-a', reason: 'service not delivered' })
    const replay = await mpFinance.solicitarReembolso({ tenantId: customer.tenantId, paymentId: paymentA, actorId: 'platform-admin', correlationId: 'r1', idempotencyKey: 'refund-a', reason: 'service not delivered' })
    const otherKey = await mpFinance.solicitarReembolso({ tenantId: customer.tenantId, paymentId: paymentA, actorId: 'platform-admin', correlationId: 'r2', idempotencyKey: 'refund-b', reason: 'again' })
    const refundCalls = mp.refunds.filter((item) => item.paymentId === '4001')
    const beforeWebhook = [...financeStore.state.obligaciones.values()].find((item) => item.obligacionId === 'obligacion-' + paymentA.split('-obligacion-')[0])
    mp.payments.set('4001', { ...mp.payments.get('4001'), status: 'refunded', status_detail: 'refunded', date_last_updated: '2026-09-23T11:00:00.000Z' })
    const refunded = await mpFinance.ingerirEventoProveedor(notification('4001'))
    const paymentB = await paid('refund-empty', '4002')
    mp.payments.set('4002', { ...mp.payments.get('4002'), sellerBalance: 'empty' })
    const noBalance = await mpFinance.solicitarReembolso({ tenantId: customer.tenantId, paymentId: paymentB, actorId: 'platform-admin', correlationId: 'r3', idempotencyKey: 'refund-c', reason: 'dispute' })
    const obligationB = [...financeStore.state.obligaciones.values()].find((item) => paymentB.startsWith('pago-' + item.obligacionId))
    const pendingPayment = await payableWork('refund-pending', '5000000')
    const notApproved = await codeOf(async () => { const checkout = await mpFinance.iniciarCheckout({ ...customer, trabajoId: pendingPayment.work.trabajoId, idempotencyKey: 'rp' }); return mpFinance.solicitarReembolso({ tenantId: customer.tenantId, paymentId: checkout.payment.paymentId, actorId: 'a', correlationId: 'c', idempotencyKey: 'rp-refund', reason: 'x' }) })
    console.log(JSON.stringify({ refund: [refund.status, refund.refund.status, refund.refund.providerRefundId !== null, refund.refund.amountMinor], replay: replay.status, otherKey: [otherKey.status, otherKey.refund.reembolsoId === refund.refund.reembolsoId], refundCalls: refundCalls.map((item) => [item.body, item.idempotencyKey]), refunded: [refunded.result, refunded.obligation.status], ledgerTypes: [...financeStore.state.ledger.values()].map((entry) => entry.entryType), noBalance: [noBalance.status, noBalance.refund.status, noBalance.refund.providerError], obligationB: obligationB.status, settlementB: [...financeStore.state.liquidaciones.values()].find((item) => item.obligacionId === obligationB.obligacionId).status, notApproved }))
  `)

  assert.deepEqual(result.refund, ['submitted', 'submitted', true, '5000000'])
  assert.equal(result.replay, 'replay')
  assert.deepEqual(result.otherKey, ['existing', true])
  // Total refund: empty body, server-side idempotency key; exactly one call to Mercado Pago.
  assert.equal(result.refundCalls.length, 1)
  assert.equal(result.refundCalls[0][0], null)
  assert.match(result.refundCalls[0][1], /^reembolso-pago-obligacion-.+-1-1$/u)
  assert.deepEqual(result.refunded, ['applied', 'refunded'])
  assert.ok(result.ledgerTypes.includes('refund_compensation'))
  assert.deepEqual(result.noBalance, [
    'requires_review',
    'requires_review',
    'INSUFFICIENT_SELLER_FUNDS',
  ])
  assert.equal(result.obligationB, 'paid')
  assert.equal(result.settlementB, 'held')
  assert.equal(result.notApproved, 'NOT_REFUNDABLE')
})

test('WEB-09E HTTP: checkout route, public webhook with raw body and signature, admin refund', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await connectSeller(provider.tenantId, '777')
    const done = await payableWork('http', '5000000')
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { InMemoryTusCommitmentStore, InMemoryTusCompensationStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction, InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('customer-token', { sessionId: 's-c', subjectId: customer.actorId, tenantId: customer.tenantId, roles: ['customer'], permissions: ['tus:checkout', 'tus:work:read'] })
    sessions.add('admin-token', { sessionId: 's-a', subjectId: 'platform-admin', tenantId: 'platform-tenant', roles: ['admin'], permissions: ['tus:payments:admin'] })
    const commitments = new InMemoryTusCommitmentStore(); const compensations = new InMemoryTusCompensationStore(); const audits = new AlmacenReferenciasAuditoriaEnMemoria(); const idempotency = new InMemoryTusIdempotencyStore(); const outbox = new InMemoryTusOutboxStore()
    const application = new TusApplicationService({ commitments, compensations, audits, idempotency, outbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, outbox, compensations }), serviceFinance: mpFinance, servicePayments: paymentsWithOauth })
    const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions, now: mpClock }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const call = async (method, path, token, body, headers = {}) => { const response = await fetch(base + path, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-correlation-id': 'corr-http', 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }); return { status: response.status, body: await response.json().catch(() => null) } }
    const path = '/tus/v1/work/' + done.work.trabajoId
    const withMoney = await call('POST', path + '/checkout', 'customer-token', { amountMinor: '1', marketplaceFee: 0 }, { 'idempotency-key': 'h-0' })
    const withoutKey = await call('POST', path + '/checkout', 'customer-token', {})
    const checkout = await call('POST', path + '/checkout', 'customer-token', {}, { 'idempotency-key': 'h-1' })
    mpPayment('5001', mp.preferences[0])
    const signed = notification('5001')
    const webhookPath = '/tus/v1/integrations/mercado-pago/webhooks?data.id=' + signed.dataId + '&type=payment'
    const forged = await call('POST', webhookPath, null, signed.rawBody, { 'x-signature': signed.signature.replace(/v1=./u, 'v1=0'), 'x-request-id': signed.requestId })
    const webhook = await call('POST', webhookPath, null, signed.rawBody, { 'x-signature': signed.signature, 'x-request-id': signed.requestId })
    const again = await call('POST', webhookPath, null, signed.rawBody, { 'x-signature': signed.signature, 'x-request-id': signed.requestId })
    const preview = await call('GET', path + '/payment-preview', 'customer-token')
    const refund = await call('POST', '/tus/v1/admin/payments/refunds', 'admin-token', { tenantId: customer.tenantId, paymentId: checkout.body.payment.paymentId, reason: 'test refund' }, { 'idempotency-key': 'admin-refund-1' })
    const customerRefund = await call('POST', '/tus/v1/admin/payments/refunds', 'customer-token', { tenantId: customer.tenantId, paymentId: checkout.body.payment.paymentId, reason: 'x' }, { 'idempotency-key': 'customer-refund' })
    await new Promise((resolve) => server.close(resolve))
    const inbox = [...financeStore.state.inbox.values()][0]
    console.log(JSON.stringify({ withMoney: [withMoney.status, withMoney.body.code], withoutKey: withoutKey.status, checkout: [checkout.status, checkout.body.checkoutUrl.startsWith('https://sandbox.mercadopago.com.ar/'), JSON.stringify(checkout.body).includes('APP_USR')], forged: [forged.status, forged.body.code], webhook: [webhook.status, webhook.body.status, webhook.body.result], again: [again.status, again.body.status], preview: [preview.body.paymentStatus, preview.body.paymentReference], refund: [refund.status, refund.body.refund.status], customerRefund: customerRefund.status, rawStored: inbox.rawBody === signed.rawBody }))
  `)

  assert.deepEqual(result.withMoney, [400, 'CLIENT_AUTHORITY_FIELDS'])
  assert.equal(result.withoutKey, 400)
  assert.deepEqual(result.checkout, [201, true, false])
  assert.deepEqual(result.forged, [401, 'INVALID_SIGNATURE'])
  assert.deepEqual(result.webhook, [200, 'recorded', 'applied'])
  assert.deepEqual(result.again, [200, 'duplicate'])
  assert.deepEqual(result.preview, ['approved', '5001'])
  assert.deepEqual(result.refund, [201, 'submitted'])
  assert.equal(result.customerRefund, 403)
  assert.equal(result.rawStored, true)
})

test('WEB-09E runtime without full configuration keeps the unavailable provider; production needs readiness evidence', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const partial = crearModuloPagosServicio({ env: { ...mpEnv, MERCADO_PAGO_NOTIFICATION_URL: '' }, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas: new AlmacenCuentasCobroEnMemoria(), now: mpClock })
    const unset = crearModuloPagosServicio({ env: { ...mpEnv, MERCADO_PAGO_ENVIRONMENT: '' }, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas: new AlmacenCuentasCobroEnMemoria(), now: mpClock })
    const productionStore = new AlmacenConfiguracionPagosEnMemoria()
    const productionAccounts = new AlmacenCuentasCobroEnMemoria()
    const production = crearModuloPagosServicio({ env: { ...mpEnv, MERCADO_PAGO_ENVIRONMENT: 'production' }, configuracion: productionStore, cuentas: productionAccounts, now: mpClock, mercadoPago: { fetch: mpFetch } })
    await production.configuracion.registrarConfiguracion(admin, { paymentsEnabled: true, reason: 'x', expectedVersion: 0 })
    const productionReason = await production.politica.disponibilidad({ prestadorTenantId: provider.tenantId, prestadorId: 'provider-1', categoria: null })
    const productionStatus = await production.configuracion.estado()
    console.log(JSON.stringify({ partial: partial.proveedor.source, unset: unset.proveedor.source, production: [production.proveedor.source, production.proveedor.environment], productionReason, blockers: productionStatus.blockers }))
  `)

  assert.equal(result.partial, 'held-no-provider')
  assert.equal(result.unset, 'held-no-provider')
  assert.deepEqual(result.production, ['authorized', 'production'])
  assert.deepEqual(result.productionReason, {
    available: false,
    reason: 'PRODUCTION_NOT_AUTHORIZED',
  })
  assert.ok(result.blockers.includes('PRODUCTION_READINESS_NOT_AUTHORIZED'))
})

test('WEB-09E migration is additive, forward-only and accepted by the migration gate', async () => {
  const migration = readFileSync(
    join(
      root,
      'apps/api/prisma/migrations/20260926100000_tus_service_payment_checkout/migration.sql'
    ),
    'utf8'
  )
  const executable = migration.replace(/--.*$/gmu, '')
  assert.doesNotMatch(
    executable,
    /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+public\b|\bCASCADE\b/iu
  )
  assert.match(executable, /"comision_marketplace" <= "monto"/u)
  assert.match(
    executable,
    /"ck_reembolsos_servicio_estado" CHECK \("estado" IN \('requested', 'submitted', 'requires_review', 'failed'\)\)/u
  )
  assert.match(
    executable,
    /REFERENCES public\."intenciones_pago"\("tenant_id", "pago_id", "obligacion_id"\) ON DELETE RESTRICT/u
  )
  const review = await reviewMigrationChain({
    names: [
      '20260917100000_tus_work_budget',
      '20260923100000_tus_service_finance_identity',
      '20260923110000_tus_service_payment_intents',
      '20260923120000_tus_service_settlement_reconciliation',
      '20260924100000_tus_finance_subject_hardening',
      '20260924130000_tus_work_reservation_unique',
      '20260925100000_tus_service_payment_configuration',
      '20260926100000_tus_service_payment_checkout',
    ],
  })
  assert.equal(review.accepted, true)
  assert.deepEqual(review.reviews.at(-1).blocking, [])
})
