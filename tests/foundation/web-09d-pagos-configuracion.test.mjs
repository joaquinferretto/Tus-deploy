import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { reviewMigrationChain } from '../../scripts/tus-migration-repair-lib.mjs'

// WEB-09D: payment preview, configurable commission, provider payment accounts and gates.
const PAYMENTS_SETUP = `
  const { validarVistaPreviaPagoServicio } = await import('./packages/contracts/src/tus.ts')
  const { AlmacenConfiguracionPagosEnMemoria, PoliticaCobroPersistida, ServicioConfiguracionPagos, leerEstadoOperativoPagos } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
  const { calcularDesgloseCobro } = await import('./apps/api/src/tus/finance/servicios/liquidacion.ts')
  const plain = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
  const writes = () => financeStore.state.obligaciones.size + financeStore.state.intenciones.size + financeStore.state.auditoria.length + financeStore.state.outbox.length + financeStore.state.idempotencia.size
  const readyEnv = { TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'sandbox', MERCADO_PAGO_CLIENT_ID: 'app-id', MERCADO_PAGO_CLIENT_SECRET: 'client-secret-value', MERCADO_PAGO_WEBHOOK_SECRET: 'webhook-secret-value', MERCADO_PAGO_OAUTH_REDIRECT_URI: 'https://api.example.test/tus/v1/integrations/mercado-pago/oauth/callback', TUS_PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64'), TUS_WEB_BASE_URL: 'https://web.example.test' }
  function financeWith(politica) {
    return new ServicioFinanzasServicios(new TransaccionFinanzasServicioEnMemoria(financeStore, new IdentidadServicioEnMemoria(workStore, marketplace)), clock, proveedorPagos, undefined, politica)
  }
  function providerEvent(id, payment, amount, feeAmount) {
    const rawBody = JSON.stringify({ id, type: 'payment', data: { id: 'fake-mp-' + payment.paymentId, external_reference: payment.paymentId, status: 'approved', transaction_amount: amount, currency_id: 'ARS', date_last_updated: '2026-09-23T10:10:00.000Z', ...(feeAmount ? { fee_amount: feeAmount } : {}) } })
    return { rawBody, signature: proveedorPagos.firmar(rawBody), receivedAt: '2026-09-23T10:30:00.000Z' }
  }
`

test('WEB-09D preview: completed work with accepted budget is payable for its budget, never the listing price, with zero writes', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${PAYMENTS_SETUP}
    const done = await payableWork('preview', '1234567', { priceMode: 'precio_desde', priceMinor: 150000n })
    const before = writes()
    const first = await finance.consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })
    const second = await finance.consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })
    const after = writes()
    validarVistaPreviaPagoServicio(first)
    const providerCode = await codeOf(() => finance.consultarVistaPreviaPago({ ...provider, trabajoId: done.work.trabajoId }))
    const strangerCode = await codeOf(() => finance.consultarVistaPreviaPago({ ...stranger, trabajoId: done.work.trabajoId }))
    const unknownCode = await codeOf(() => finance.consultarVistaPreviaPago({ ...customer, trabajoId: 'trabajo-missing' }))
    console.log(JSON.stringify({ first, same: JSON.stringify(first) === JSON.stringify(second), before, after, providerCode, strangerCode, unknownCode, listingMinor: done.publication.priceMinor.toString() }))
  `)

  assert.equal(result.first.payable, true)
  assert.equal(result.first.paymentAvailable, true)
  assert.equal(result.first.unavailableReason, null)
  assert.equal(result.first.workStatus, 'completed')
  assert.equal(result.first.amountMinor, '1234567')
  assert.equal(result.first.currency, 'ARS')
  assert.notEqual(result.first.amountMinor, result.listingMinor)
  assert.equal(result.first.budget.totalMinor, '1234567')
  assert.equal(result.first.budget.version, 1)
  assert.match(result.first.amountMinor, /^\d+$/u)
  assert.equal(result.first.serviceName, 'Service listing-preview')
  assert.equal(result.first.paymentStatus, 'not_started')
  assert.equal(result.first.obligation, null)
  assert.equal(result.same, true)
  assert.equal(result.before, 0)
  assert.equal(result.after, 0)
  assert.equal(result.providerCode, 'FORBIDDEN')
  assert.equal(result.strangerCode, 'NOT_FOUND')
  assert.equal(result.unknownCode, 'NOT_FOUND')
})

test('WEB-09D preview explains why a work is not payable: not completed, no budget, draft budget, hourly or fixed listing, cancelled', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${PAYMENTS_SETUP}
    const preview = async (trabajoId) => { const value = await finance.consultarVistaPreviaPago({ ...customer, trabajoId }); validarVistaPreviaPagoServicio(value); return [value.payable, value.notPayableReason, value.amountMinor, value.paymentAvailable, value.budget?.totalMinor ?? null] }
    const accepted = await serviceWork('accepted-only', { priceMode: 'requires_budget', bookingMode: 'requiere_presupuesto' })
    await acceptBudget(accepted.work.trabajoId, '50000')
    const draft = await serviceWork('draft', { priceMode: 'requires_budget', bookingMode: 'requiere_presupuesto' })
    const diagnosis = await work.createDiagnosis({ ...provider, trabajoId: draft.work.trabajoId, descripcionOriginal: 'd', idempotencyKey: 'dd', requestHash: 'hdd', createdAt: '2026-09-23T09:31:00.000Z' })
    await work.confirmDiagnosis({ ...provider, trabajoId: draft.work.trabajoId, diagnosticoId: diagnosis.diagnosis.diagnosticoId, expectedVersion: 1, idempotencyKey: 'dc', requestHash: 'hdc', createdAt: '2026-09-23T09:32:00.000Z' })
    await work.createBudget({ ...provider, trabajoId: draft.work.trabajoId, currency: 'ARS', scope: 's', totalMinor: '70000', lines: [{ lineId: 'l', description: 'x', quantity: 1, unitAmountMinor: '70000', totalAmountMinor: '70000' }], idempotencyKey: 'db', requestHash: 'hdb', createdAt: '2026-09-23T09:33:00.000Z' })
    const fixed = await serviceWork('fixed-done', { priceMode: 'fixed' })
    await finishWork(fixed.work.trabajoId)
    const hourly = await serviceWork('hourly', { priceMode: 'por_hora' })
    let hourlyFinished = true
    try { await finishWork(hourly.work.trabajoId) } catch { hourlyFinished = false }
    const cancelled = await serviceWork('cancel-me', { priceMode: 'fixed' })
    await work.cancelWork({ ...provider, trabajoId: cancelled.work.trabajoId, expectedVersion: 1, idempotencyKey: 'cancel-me', requestHash: 'h-cancel-me', createdAt: '2026-09-23T09:40:00.000Z' })
    const cancelledReason = (await finance.consultarVistaPreviaPago({ ...customer, trabajoId: cancelled.work.trabajoId })).notPayableReason
    console.log(JSON.stringify({ acceptedOnly: await preview(accepted.work.trabajoId), draft: await preview(draft.work.trabajoId), fixed: await preview(fixed.work.trabajoId), hourly: await preview(hourly.work.trabajoId), hourlyFinished, cancelledReason, writes: writes() }))
  `)

  assert.deepEqual(result.acceptedOnly, [false, 'WORK_NOT_COMPLETED', null, false, '50000'])
  assert.deepEqual(result.draft, [false, 'WORK_NOT_COMPLETED', null, false, null])
  assert.deepEqual(result.fixed, [false, 'BUDGET_REQUIRED', null, false, null])
  assert.deepEqual(result.hourly, [
    false,
    result.hourlyFinished ? 'BUDGET_REQUIRED' : 'WORK_NOT_COMPLETED',
    null,
    false,
    null,
  ])
  assert.equal(result.cancelledReason, 'WORK_CANCELLED')
  assert.equal(result.writes, 0)
})

test('WEB-09D provider disabled: preview still works, payment is unavailable and creating an intent writes nothing', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${PAYMENTS_SETUP}
    const done = await payableWork('disabled', '990000')
    const config = new AlmacenConfiguracionPagosEnMemoria()
    const off = financeWith(new PoliticaCobroPersistida(config, () => leerEstadoOperativoPagos({}, false), async () => false))
    const preview = await off.consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })
    const intentCode = await codeOf(() => off.crearIntencionPago({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'pay-off' }))
    const obligationCode = await codeOf(() => off.prepararObligacion({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'prep-off' }))
    const admin = new ServicioConfiguracionPagos(config, () => leerEstadoOperativoPagos(readyEnv, false), clock)
    await admin.registrarConfiguracion({ actorId: 'admin', correlationId: 'c' }, { paymentsEnabled: true, reason: 'launch', expectedVersion: 0 })
    const stillOff = await off.consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })
    const noAdapter = financeWith(new PoliticaCobroPersistida(config, () => leerEstadoOperativoPagos(readyEnv, false), async () => true))
    const adapterReason = (await noAdapter.consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })).unavailableReason
    const ready = () => leerEstadoOperativoPagos(readyEnv, true)
    const undecided = (await financeWith(new PoliticaCobroPersistida(config, ready, async () => true)).consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })).unavailableReason
    await admin.registrarPolitica({ actorId: 'admin', correlationId: 'c' }, { scope: 'global', rateBps: 1000, pspFeeBearer: 'provider', reason: 'launch', expectedVersion: 0 })
    const notLinked = (await financeWith(new PoliticaCobroPersistida(config, ready, async () => false)).consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })).unavailableReason
    const linked = await financeWith(new PoliticaCobroPersistida(config, ready, async () => true)).consultarVistaPreviaPago({ ...customer, trabajoId: done.work.trabajoId })
    console.log(JSON.stringify({ preview, intentCode, obligationCode, stillOff: stillOff.unavailableReason, adapterReason, undecided, notLinked, linked: [linked.paymentAvailable, linked.unavailableReason], writes: writes() }))
  `)

  assert.equal(result.preview.payable, true)
  assert.equal(result.preview.amountMinor, '990000')
  assert.equal(result.preview.paymentAvailable, false)
  assert.equal(result.preview.unavailableReason, 'PAYMENTS_DISABLED')
  assert.equal(result.intentCode, 'PAYMENTS_DISABLED')
  assert.equal(result.obligationCode, 'PAYMENTS_DISABLED')
  assert.equal(result.stillOff, 'PROVIDER_NOT_CONFIGURED')
  assert.equal(result.adapterReason, 'PROVIDER_NOT_CONFIGURED')
  assert.equal(result.undecided, 'PSP_FEE_POLICY_UNDECIDED')
  assert.equal(result.notLinked, 'PROVIDER_ACCOUNT_NOT_CONNECTED')
  assert.deepEqual(result.linked, [true, null])
  assert.equal(result.writes, 0)
})

test('WEB-09D commission is configurable, bounded, scoped and frozen in each snapshot', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${PAYMENTS_SETUP}
    const config = new AlmacenConfiguracionPagosEnMemoria()
    const admin = new ServicioConfiguracionPagos(config, () => leerEstadoOperativoPagos(readyEnv, true), clock)
    const ctx = { actorId: 'admin', correlationId: 'c' }
    const invalid = []
    for (const rateBps of [-1, 3001, 12.5, '1000', null]) invalid.push(await codeOf(() => admin.registrarPolitica(ctx, { scope: 'global', rateBps, pspFeeBearer: 'provider', reason: 'r', expectedVersion: 0 })))
    const badBearer = await codeOf(() => admin.registrarPolitica(ctx, { scope: 'global', rateBps: 1000, pspFeeBearer: 'customer', reason: 'r', expectedVersion: 0 }))
    const noReason = await codeOf(() => admin.registrarPolitica(ctx, { scope: 'global', rateBps: 1000, expectedVersion: 0 }))
    const scopedWithoutRef = await codeOf(() => admin.registrarPolitica(ctx, { scope: 'prestador', rateBps: 1000, reason: 'r', expectedVersion: 0 }))
    const v1 = await admin.registrarPolitica(ctx, { scope: 'global', rateBps: 1000, pspFeeBearer: 'provider', reason: 'launch 10%', expectedVersion: 0 })
    const stale = await codeOf(() => admin.registrarPolitica(ctx, { scope: 'global', rateBps: 1100, pspFeeBearer: 'provider', reason: 'stale', expectedVersion: 0 }))
    await admin.registrarConfiguracion(ctx, { paymentsEnabled: true, reason: 'launch', expectedVersion: 0 })
    const paying = financeWith(new PoliticaCobroPersistida(config, () => leerEstadoOperativoPagos(readyEnv, true), async () => true))
    async function pay(id, totalMinor, amount, fee) {
      const done = await payableWork(id, totalMinor)
      const created = await paying.crearIntencionPago({ ...customer, trabajoId: done.work.trabajoId, idempotencyKey: 'pay-' + id })
      const dispatched = await paying.despacharIntencionPago({ tenantId: customer.tenantId, paymentId: created.payment.paymentId, correlationId: 'd-' + id })
      await paying.ingerirEventoProveedor(providerEvent('evt-' + id, dispatched.payment, amount, fee))
      return financeStore.state.comisiones.get(customer.tenantId + ':' + created.obligation.obligacionId) ?? [...financeStore.state.comisiones.values()].find((snapshot) => snapshot.obligacionId === created.obligation.obligacionId)
    }
    const first = plain(await pay('first', '10000000', '100000.00', '5000.00'))
    await admin.registrarPolitica(ctx, { scope: 'global', rateBps: 1200, pspFeeBearer: 'provider', reason: 'raise to 12%', expectedVersion: 1 })
    const second = plain(await pay('second', '10000000', '100000.00', '5000.00'))
    const firstAgain = plain([...financeStore.state.comisiones.values()].find((snapshot) => snapshot.obligacionId === first.obligacionId))
    await admin.registrarPolitica(ctx, { scope: 'prestador', scopeRef: 'provider-1', rateBps: 500, pspFeeBearer: 'platform', reason: 'partner', expectedVersion: 0 })
    const partner = plain(await pay('partner', '10000000', '100000.00', '5000.00'))
    const breakdowns = {
      undetermined: plain(calcularDesgloseCobro({ grossMinor: 10000000n, rateBps: 1000, pspFeeBearer: 'undetermined', pspFeeMinor: 500000n })),
      platform: plain(calcularDesgloseCobro({ grossMinor: 10000000n, rateBps: 1000, pspFeeBearer: 'platform', pspFeeMinor: 500000n })),
      unknownFee: plain(calcularDesgloseCobro({ grossMinor: 10000000n, rateBps: 1000, pspFeeBearer: 'provider', pspFeeMinor: null })),
      huge: plain(calcularDesgloseCobro({ grossMinor: 9007199254740993n, rateBps: 3000, pspFeeBearer: 'platform', pspFeeMinor: null })),
      negative: await codeOf(async () => calcularDesgloseCobro({ grossMinor: 1000n, rateBps: 3000, pspFeeBearer: 'provider', pspFeeMinor: 900n })),
      negativeGross: await codeOf(async () => calcularDesgloseCobro({ grossMinor: -1n, rateBps: 1000, pspFeeBearer: 'provider', pspFeeMinor: null })),
    }
    console.log(JSON.stringify({ invalid, badBearer, noReason, scopedWithoutRef, v1, stale, first, second, firstAgain, partner, breakdowns, policies: (await admin.listarPoliticas()).map((policy) => policy.scope + ':' + policy.version + ':' + policy.rateBps) }))
  `)

  assert.deepEqual(result.invalid, [
    'INVALID_COMMISSION',
    'INVALID_COMMISSION',
    'INVALID_COMMISSION',
    'INVALID_COMMISSION',
    'INVALID_COMMISSION',
  ])
  assert.equal(result.badBearer, 'INVALID')
  assert.equal(result.noReason, 'INVALID')
  assert.equal(result.scopedWithoutRef, 'INVALID')
  assert.equal(result.v1.rateBps, 1000)
  assert.equal(result.v1.version, 1)
  assert.equal(result.stale, 'VERSION_CONFLICT')
  // $100.000 paid, 10% TUS = $10.000, PSP fee $5.000 borne by the provider -> net $85.000.
  assert.equal(result.first.grossMinor, '10000000')
  assert.equal(result.first.rateBps, 1000)
  assert.equal(result.first.commissionMinor, '1000000')
  assert.equal(result.first.netMinor, '9000000')
  assert.equal(result.first.pspFeeMinor, '500000')
  assert.equal(result.first.pspFeeBearer, 'provider')
  assert.equal(result.first.providerNetMinor, '8500000')
  assert.equal(result.first.politicaId, result.v1.politicaId)
  assert.equal(result.second.rateBps, 1200)
  assert.equal(result.second.commissionMinor, '1200000')
  assert.deepEqual(result.firstAgain, result.first)
  assert.equal(result.partner.rateBps, 500)
  assert.equal(result.partner.pspFeeBearer, 'platform')
  assert.equal(result.partner.providerNetMinor, '9500000')
  assert.equal(result.breakdowns.undetermined.providerNetMinor, null)
  assert.equal(result.breakdowns.platform.providerNetMinor, '9000000')
  assert.equal(result.breakdowns.unknownFee.providerNetMinor, null)
  assert.equal(result.breakdowns.huge.commissionMinor, '2702159776422298')
  assert.equal(result.breakdowns.negative, 'NEGATIVE_NET')
  assert.equal(result.breakdowns.negativeGross, 'INVALID_AMOUNT')
  assert.deepEqual(result.policies, ['global:1:1000', 'global:2:1200', 'prestador:1:500'])
})

test('WEB-09D provider account linking uses single-use state, PKCE S256 and encrypted tokens that never leave the server', () => {
  const result = runTypeScriptScenario(`
    const { createHash } = await import('node:crypto')
    const { AlmacenCuentasCobroEnMemoria, BovedaCredencialesAesGcm, ServicioCuentasCobro, ClienteOAuthMercadoPagoHttp } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
    let now = Date.parse('2026-09-24T10:00:00.000Z')
    const store = new AlmacenCuentasCobroEnMemoria()
    const boveda = new BovedaCredencialesAesGcm(Buffer.alloc(32, 9).toString('base64'))
    const exchanges = []
    const oauth = { intercambiarCodigo: async (input) => { exchanges.push(input); return { accessToken: 'APP_USR-seller-access-token', refreshToken: 'TG-refresh-token', publicKey: 'APP_USR-public', userId: '123456789', scopes: ['offline_access', 'read', 'write'], liveMode: false, expiresInSeconds: 15552000 } } }
    const config = { clientId: 'app-id', redirectUri: 'https://api.example.test/tus/v1/integrations/mercado-pago/oauth/callback', webBaseUrl: 'https://web.example.test/' }
    const service = new ServicioCuentasCobro(store, config, boveda, oauth, () => now)
    const ctx = { tenantId: 'provider-tenant', actorId: 'provider-user', correlationId: 'corr' }
    const initial = await service.estadoCuenta(ctx)
    const started = await service.iniciarConexion(ctx)
    const url = new URL(started.authorizationUrl)
    const state = url.searchParams.get('state')
    const forged = await service.completarConexion({ code: 'TG-code', state: 'x'.repeat(43), correlationId: 'cb' })
    const malformed = await service.completarConexion({ code: 'TG-code', state: '../../etc', correlationId: 'cb' })
    const connected = await service.completarConexion({ code: 'TG-code', state, correlationId: 'cb' })
    const replayed = await service.completarConexion({ code: 'TG-code', state, correlationId: 'cb' })
    const account = await service.estadoCuenta(ctx)
    const credential = store.credenciales.get('provider-tenant')
    const decrypted = JSON.parse(boveda.descifrar(credential.ciphertext, 'payment-account:provider-tenant'))
    let crossTenant = 'none'
    try { boveda.descifrar(credential.ciphertext, 'payment-account:other-tenant') } catch (error) { crossTenant = error.code }
    const challengeMatches = createHash('sha256').update(exchanges[0].codeVerifier).digest('base64url') === url.searchParams.get('code_challenge')
    const expiredStart = await service.iniciarConexion(ctx)
    now += 11 * 60_000
    const expired = await service.completarConexion({ code: 'TG-code', state: new URL(expiredStart.authorizationUrl).searchParams.get('state'), correlationId: 'cb' })
    const disconnected = await service.desconectar(ctx)
    const unconfigured = new ServicioCuentasCobro(new AlmacenCuentasCobroEnMemoria(), null, null, null, () => now)
    let unconfiguredCode = 'none'
    try { await unconfigured.iniciarConexion(ctx) } catch (error) { unconfiguredCode = error.code }
    const unconfiguredCallback = await unconfigured.completarConexion({ code: 'c', state, correlationId: 'cb' })
    let badKey = 'none'
    try { new BovedaCredencialesAesGcm(Buffer.alloc(16).toString('base64')) } catch (error) { badKey = error.message }
    const failing = new ClienteOAuthMercadoPagoHttp({ clientId: 'id', clientSecret: 'client-secret-value', testToken: true, fetch: async () => ({ ok: false, status: 400, json: async () => ({ message: 'client-secret-value leaked' }) }) })
    let failingError = null
    try { await failing.intercambiarCodigo({ code: 'c', codeVerifier: 'v', redirectUri: 'r' }) } catch (error) { failingError = { code: error.code, message: error.message } }
    let sentBody = null
    const okClient = new ClienteOAuthMercadoPagoHttp({ clientId: 'id', clientSecret: 'secret', testToken: true, fetch: async (_url, init) => { sentBody = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ access_token: 'a', user_id: 42, scope: 'read write', live_mode: false, expires_in: 100 }) } } })
    const okToken = await okClient.intercambiarCodigo({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })
    console.log(JSON.stringify({ initial, params: Object.fromEntries(url.searchParams), stateLength: state.length, forged, malformed, connected, replayed, account, accountText: JSON.stringify(account), ciphertextHasToken: credential.ciphertext.includes('seller-access-token'), decrypted, crossTenant, challengeMatches, storedStateIsDigest: [...store.estados.keys()].every((key) => /^[0-9a-f]{64}$/.test(key)) && !store.estados.has(state), expired, disconnected, credentialAfterDisconnect: store.credenciales.has('provider-tenant'), unconfiguredCode, unconfiguredCallback, badKey, failingError, sentBody, okToken }))
  `)

  assert.equal(result.initial.status, 'not_connected')
  assert.equal(result.initial.connectAvailable, true)
  assert.equal(result.params.client_id, 'app-id')
  assert.equal(result.params.response_type, 'code')
  assert.equal(result.params.platform_id, 'mp')
  assert.equal(result.params.code_challenge_method, 'S256')
  assert.equal(
    result.params.redirect_uri,
    'https://api.example.test/tus/v1/integrations/mercado-pago/oauth/callback'
  )
  assert.ok(result.stateLength >= 43)
  assert.equal(result.storedStateIsDigest, true)
  assert.equal(result.forged.status, 'error')
  assert.equal(result.forged.reason, 'INVALID_STATE')
  assert.equal(result.malformed.reason, 'INVALID_STATE')
  assert.equal(result.connected.status, 'connected')
  assert.equal(
    result.connected.redirectUrl,
    'https://web.example.test/tus/prestador?mercadoPago=connected'
  )
  assert.equal(result.replayed.reason, 'INVALID_STATE')
  assert.equal(result.account.status, 'connected')
  assert.equal(result.account.externalAccountId, '123456789')
  assert.deepEqual(result.account.scopes, ['offline_access', 'read', 'write'])
  assert.doesNotMatch(result.accountText, /token|APP_USR|TG-/u)
  assert.equal(result.ciphertextHasToken, false)
  assert.equal(result.decrypted.accessToken, 'APP_USR-seller-access-token')
  assert.equal(result.crossTenant, 'CREDENTIAL_UNREADABLE')
  assert.equal(result.challengeMatches, true)
  assert.equal(result.expired.reason, 'INVALID_STATE')
  assert.equal(result.disconnected.status, 'revoked')
  assert.equal(result.credentialAfterDisconnect, false)
  assert.equal(result.unconfiguredCode, 'PROVIDER_NOT_CONFIGURED')
  assert.deepEqual(result.unconfiguredCallback, {
    status: 'error',
    reason: 'PROVIDER_NOT_CONFIGURED',
    redirectUrl: '',
  })
  assert.match(result.badKey, /32 bytes/u)
  assert.equal(result.failingError.code, 'PROVIDER_OAUTH_FAILED')
  assert.doesNotMatch(result.failingError.message, /client-secret-value/u)
  assert.equal(result.sentBody.grant_type, 'authorization_code')
  assert.equal(result.sentBody.code_verifier, 'v')
  assert.equal(result.sentBody.test_token, 'true')
  assert.equal(result.okToken.userId, '42')
})

test('WEB-09D HTTP: preview is customer-only, the Web cannot send money, admin and linking fail closed without configuration', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${PAYMENTS_SETUP}
    const done = await payableWork('http', '445566')
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { InMemoryTusCommitmentStore, InMemoryTusCompensationStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction, InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { AlmacenCuentasCobroEnMemoria } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
    const { crearModuloPagosServicio } = await import('./apps/api/src/tus/finance/servicios/composicion-pagos.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const secretEnv = { ...readyEnv, TUS_MERCADOPAGO_ENABLED: 'false', TUS_PLATFORM_ADMIN_TENANT_ID: 'platform-tenant' }
    const payments = crearModuloPagosServicio({ env: secretEnv, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas: new AlmacenCuentasCobroEnMemoria(), now: clock })
    const offFinance = financeWith(payments.politica)
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('customer-token', { sessionId: 's-c', subjectId: customer.actorId, tenantId: customer.tenantId, roles: ['customer'], permissions: ['tus:checkout', 'tus:work:read'] })
    sessions.add('provider-token', { sessionId: 's-p', subjectId: provider.actorId, tenantId: provider.tenantId, roles: ['merchant'], permissions: ['tus:work:read', 'tus:work:write', 'tus:marketplace:write'] })
    sessions.add('stranger-token', { sessionId: 's-s', subjectId: stranger.actorId, tenantId: stranger.tenantId, roles: ['customer'], permissions: ['tus:checkout', 'tus:work:read'] })
    sessions.add('admin-token', { sessionId: 's-a', subjectId: 'platform-admin', tenantId: 'platform-tenant', roles: ['admin'], permissions: ['tus:payments:admin'] })
    sessions.add('fake-admin-token', { sessionId: 's-f', subjectId: 'tenant-admin', tenantId: provider.tenantId, roles: ['admin'], permissions: ['tus:payments:admin', 'tus:*'] })
    const build = (servicePayments) => {
      const commitments = new InMemoryTusCommitmentStore(); const compensations = new InMemoryTusCompensationStore(); const audits = new AlmacenReferenciasAuditoriaEnMemoria(); const idempotency = new InMemoryTusIdempotencyStore(); const outbox = new InMemoryTusOutboxStore()
      return new TusApplicationService({ commitments, compensations, audits, idempotency, outbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, outbox, compensations }), serviceFinance: offFinance, servicePayments })
    }
    const server = createApp({ tusRouter: createTusHttpRouter({ application: build(payments), sessions }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const call = async (method, path, token, body, key) => { const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-correlation-id': 'corr-http', 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const text = await response.text(); let parsed = null; try { parsed = JSON.parse(text) } catch {} return { status: response.status, body: parsed, text, location: response.headers.get('location') } }
    const path = '/tus/v1/work/' + done.work.trabajoId
    const preview = await call('GET', path + '/payment-preview?amountMinor=1&currency=USD', 'customer-token')
    const alias = await call('GET', '/tus/v1/trabajos/' + done.work.trabajoId + '/pago/vista-previa', 'customer-token')
    const providerPreview = await call('GET', path + '/payment-preview', 'provider-token')
    const strangerPreview = await call('GET', path + '/payment-preview', 'stranger-token')
    const anonymous = await call('GET', path + '/payment-preview')
    const withMoney = await call('POST', path + '/payment-intents', 'customer-token', { amountMinor: '1' }, 'k-money')
    const intent = await call('POST', path + '/payment-intents', 'customer-token', {}, 'k-1')
    const account = await call('GET', '/tus/v1/provider/payment-account', 'provider-token')
    const customerAccount = await call('GET', '/tus/v1/provider/payment-account', 'customer-token')
    const connect = await call('POST', '/tus/v1/provider/payment-account/mercado-pago/connect', 'provider-token', {})
    const callback = await call('GET', '/tus/v1/integrations/mercado-pago/oauth/callback?code=x&state=' + 'a'.repeat(43))
    const status = await call('GET', '/tus/v1/admin/payments/status', 'admin-token')
    const fakeAdmin = await call('GET', '/tus/v1/admin/payments/status', 'fake-admin-token')
    const customerAdmin = await call('POST', '/tus/v1/admin/payments/commission-policies', 'customer-token', { scope: 'global', rateBps: 0, reason: 'x', expectedVersion: 0 })
    const policy = await call('POST', '/tus/v1/admin/payments/commission-policies', 'admin-token', { scope: 'global', rateBps: 1000, pspFeeBearer: 'provider', reason: 'launch', expectedVersion: 0 })
    const invalidPolicy = await call('POST', '/tus/v1/admin/payments/commission-policies', 'admin-token', { scope: 'global', rateBps: 9000, reason: 'too much', expectedVersion: 1 })
    const configuration = await call('POST', '/tus/v1/admin/payments/configuration', 'admin-token', { paymentsEnabled: true, reason: 'enable product', expectedVersion: 0 })
    const afterEnable = await call('GET', path + '/payment-preview', 'customer-token')
    await new Promise((resolve) => server.close(resolve))
    const noAdminPayments = crearModuloPagosServicio({ env: {}, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas: new AlmacenCuentasCobroEnMemoria(), now: clock })
    const server2 = createApp({ tusRouter: createTusHttpRouter({ application: build(noAdminPayments), sessions }), tusRoutesEnabled: true }).listen(0)
    const base2 = 'http://127.0.0.1:' + server2.address().port
    const lockedAdmin = (await fetch(base2 + '/tus/v1/admin/payments/status', { headers: { authorization: 'Bearer admin-token', 'x-correlation-id': 'c' } })).status
    await new Promise((resolve) => server2.close(resolve))
    console.log(JSON.stringify({ preview, alias: alias.status, providerPreview: providerPreview.status, strangerPreview, anonymous: anonymous.status, withMoney: withMoney.body, intent, account: account.body, customerAccount: customerAccount.status, connect, callback: callback.status, status, fakeAdmin: fakeAdmin.status, customerAdmin: customerAdmin.status, policy, invalidPolicy: invalidPolicy.body, configuration: configuration.status, afterEnable: afterEnable.body.unavailableReason, lockedAdmin, writes: writes() }))
  `)

  assert.equal(result.preview.status, 200)
  assert.equal(result.preview.body.amountMinor, '445566')
  assert.equal(result.preview.body.currency, 'ARS')
  assert.equal(result.preview.body.paymentAvailable, false)
  assert.equal(result.preview.body.unavailableReason, 'PAYMENTS_DISABLED')
  assert.equal(result.alias, 200)
  assert.equal(result.providerPreview, 403)
  assert.equal(result.strangerPreview.status, 404)
  assert.equal(result.anonymous, 403)
  assert.equal(result.withMoney.code, 'CLIENT_AUTHORITY_FIELDS')
  assert.equal(result.intent.status, 503)
  assert.equal(result.intent.body.code, 'PAYMENTS_DISABLED')
  assert.equal(result.account.status, 'not_connected')
  assert.equal(result.account.connectAvailable, false)
  assert.equal(result.customerAccount, 403)
  assert.equal(result.connect.status, 503)
  assert.equal(result.connect.body.code, 'PROVIDER_NOT_CONFIGURED')
  assert.equal(result.callback, 503)
  assert.equal(result.status.status, 200)
  assert.ok(result.status.body.blockers.includes('TUS_MERCADOPAGO_ENABLED_FALSE'))
  assert.ok(result.status.body.blockers.includes('REAL_PAYMENT_ADAPTER_NOT_IMPLEMENTED'))
  assert.ok(result.status.body.blockers.includes('PSP_FEE_POLICY_UNDECIDED'))
  assert.equal(result.status.body.operational.clientSecretConfigured, true)
  assert.doesNotMatch(result.status.text, /client-secret-value|webhook-secret-value|app-id/u)
  assert.equal(result.fakeAdmin, 403)
  assert.equal(result.customerAdmin, 403)
  assert.equal(result.policy.status, 201)
  assert.equal(result.policy.body.rateBps, 1000)
  assert.equal(result.invalidPolicy.code, 'INVALID_COMMISSION')
  assert.equal(result.configuration, 201)
  assert.equal(result.afterEnable, 'PROVIDER_NOT_CONFIGURED')
  assert.equal(result.lockedAdmin, 403)
  assert.equal(result.writes, 0)
})

test('WEB-09D Prisma adapters: append-only versions, atomic single-use OAuth state and optimistic account versions', () => {
  const result = runTypeScriptScenario(`
    const { ConfiguracionPagosPrisma, CuentasCobroPrisma } = await import('./apps/api/src/tus/adapters/prisma-configuracion-pagos.ts')
    const same = (left, right) => left instanceof Date && right instanceof Date ? left.getTime() === right.getTime() : left === right
    const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => value && typeof value === 'object' && !(value instanceof Date) && 'gt' in value ? row[key] > value.gt : same(row[key], value) || (value === null && row[key] == null))
    const uniques = { politicaComisionServicio: [['claveAlcance', 'version']], configuracionPagosServicio: [['version']], cuentaCobroPrestador: [['prestadorTenantId', 'proveedor']], credencialCuentaCobro: [['prestadorTenantId', 'proveedor']], estadoOAuthCobro: [['huellaEstado']] }
    const tables = {}
    const client = {}
    for (const name of Object.keys(uniques)) {
      const rows = tables[name] = []
      client[name] = {
        findMany: async (args = {}) => rows.filter((row) => matches(row, args.where)),
        findFirst: async (args = {}) => { const found = rows.filter((row) => matches(row, args.where)); if (args.orderBy?.version === 'desc') found.sort((a, b) => b.version - a.version); return found[0] ?? null },
        create: async ({ data }) => { if (uniques[name].some((keys) => rows.some((row) => keys.every((key) => row[key] === data[key])))) throw Object.assign(new Error('unique'), { code: 'P2002' }); rows.push({ ...data }); return data },
        updateMany: async ({ where, data }) => { const found = rows.filter((row) => matches(row, where)); found.forEach((row) => Object.assign(row, data)); return { count: found.length } },
        deleteMany: async ({ where }) => { const before = rows.length; for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1); return { count: before - rows.length } },
      }
    }
    const config = new ConfiguracionPagosPrisma(client)
    const policy = { politicaId: 'p1', scope: 'prestador', scopeRef: 'provider-1', version: 1, rateBps: 800, ruleVersion: 'prestador:provider-1:v1:800bps', pspFeeBearer: 'provider', reason: 'r', actorId: 'a', correlationId: 'c', createdAt: '2026-09-24T10:00:00.000Z' }
    await config.agregarPolitica(policy)
    let duplicate = 'none'
    try { await config.agregarPolitica({ ...policy, politicaId: 'p2' }) } catch (error) { duplicate = error.code }
    const policies = await config.listarPoliticas()
    await config.agregarConfiguracion({ configuracionId: 'c1', version: 1, paymentsEnabled: false, provider: 'mercado-pago', currency: 'ARS', reason: 'r', actorId: 'a', correlationId: 'c', createdAt: '2026-09-24T10:00:00.000Z' })
    await config.agregarConfiguracion({ configuracionId: 'c2', version: 2, paymentsEnabled: true, provider: 'mercado-pago', currency: 'ARS', reason: 'r', actorId: 'a', correlationId: 'c', createdAt: '2026-09-24T10:01:00.000Z' })
    const latest = await config.ultimaConfiguracion()
    const accounts = new CuentasCobroPrisma(client)
    const account = { prestadorTenantId: 'provider-tenant', provider: 'mercado-pago', status: 'connected', externalAccountId: '1', liveMode: false, scopes: ['read', 'write'], connectedAt: '2026-09-24T10:00:00.000Z', expiresAt: null, version: 1, actorId: 'a', correlationId: 'c', createdAt: '2026-09-24T10:00:00.000Z', updatedAt: '2026-09-24T10:00:00.000Z' }
    const created = await accounts.guardarCuenta(account, null)
    const createdTwice = await accounts.guardarCuenta(account, null)
    const staleUpdate = await accounts.guardarCuenta({ ...account, version: 3, status: 'revoked' }, 2)
    const update = await accounts.guardarCuenta({ ...account, version: 2, status: 'revoked' }, 1)
    const stored = await accounts.buscarCuenta('provider-tenant')
    await accounts.guardarCredencial({ prestadorTenantId: 'provider-tenant', ciphertext: 'v1.a.b.c', keyVersion: 'v1', updatedAt: '2026-09-24T10:00:00.000Z' })
    await accounts.guardarCredencial({ prestadorTenantId: 'provider-tenant', ciphertext: 'v1.d.e.f', keyVersion: 'v1', updatedAt: '2026-09-24T10:02:00.000Z' })
    const credentials = tables.credencialCuentaCobro.map((row) => row.credencialCifrada)
    const digest = 'a'.repeat(64)
    await accounts.crearEstado({ stateDigest: digest, prestadorTenantId: 'provider-tenant', actorId: 'a', verifierCiphertext: 'v1.x.y.z', expiresAt: '2026-09-24T10:10:00.000Z', consumedAt: null, createdAt: '2026-09-24T10:00:00.000Z' })
    const [first, second] = await Promise.all([accounts.consumirEstado(digest, '2026-09-24T10:05:00.000Z'), accounts.consumirEstado(digest, '2026-09-24T10:05:00.000Z')])
    await accounts.crearEstado({ stateDigest: 'b'.repeat(64), prestadorTenantId: 'provider-tenant', actorId: 'a', verifierCiphertext: 'v1.x.y.z', expiresAt: '2026-09-24T10:10:00.000Z', consumedAt: null, createdAt: '2026-09-24T10:00:00.000Z' })
    const expired = await accounts.consumirEstado('b'.repeat(64), '2026-09-24T10:11:00.000Z')
    console.log(JSON.stringify({ duplicate, policies, latest, created, createdTwice, staleUpdate, update, stored, credentials, consumed: [first?.prestadorTenantId ?? null, second], expired, clave: tables.politicaComisionServicio[0].claveAlcance }))
  `)

  assert.equal(result.duplicate, 'VERSION_CONFLICT')
  assert.equal(result.policies.length, 1)
  assert.equal(result.policies[0].rateBps, 800)
  assert.equal(result.clave, 'prestador:provider-1')
  assert.equal(result.latest.version, 2)
  assert.equal(result.latest.paymentsEnabled, true)
  assert.equal(result.created, true)
  assert.equal(result.createdTwice, false)
  assert.equal(result.staleUpdate, false)
  assert.equal(result.update, true)
  assert.equal(result.stored.status, 'revoked')
  assert.deepEqual(result.stored.scopes, ['read', 'write'])
  assert.deepEqual(result.credentials, ['v1.d.e.f'])
  assert.deepEqual(result.consumed, ['provider-tenant', null])
  assert.equal(result.expired, null)
})

test('WEB-09D migration is additive, forward-only, append-only for policies and accepted by the migration gate', async () => {
  const migration = readFileSync(
    join(
      root,
      'apps/api/prisma/migrations/20260925100000_tus_service_payment_configuration/migration.sql'
    ),
    'utf8'
  )
  const executable = migration.replace(/--.*$/gmu, '')
  assert.doesNotMatch(
    executable,
    /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+public\b|\bCASCADE\b/iu
  )
  assert.match(migration, /"tasa_puntos_base" >= 0 AND "tasa_puntos_base" <= 3000/u)
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\."politicas_comision_servicio"/u)
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\."configuraciones_pagos_servicio"/u)
  assert.match(
    migration,
    /"ck_estados_oauth_cobro_huella" CHECK \("huella_estado" ~ '\^\[0-9a-f\]\{64\}\$'\)/u
  )
  assert.doesNotMatch(executable, /access_token|client_secret|refresh_token/iu)
  const review = await reviewMigrationChain({
    names: [
      '20260917100000_tus_work_budget',
      '20260923100000_tus_service_finance_identity',
      '20260923110000_tus_service_payment_intents',
      '20260923120000_tus_service_settlement_reconciliation',
      '20260924100000_tus_finance_subject_hardening',
      '20260924130000_tus_work_reservation_unique',
      '20260925100000_tus_service_payment_configuration',
    ],
  })
  assert.equal(review.accepted, true)
  const own = review.reviews.at(-1)
  assert.deepEqual(own.blocking, [])
  assert.equal(
    own.statements.filter((statement) => statement.classification === 'append_only_guard').length,
    4
  )
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  for (const table of [
    'politicas_comision_servicio',
    'configuraciones_pagos_servicio',
    'cuentas_cobro_prestador',
    'credenciales_cuenta_cobro',
    'estados_oauth_cobro',
  ])
    assert.match(schema, new RegExp(`@@map\\("${table}"\\)`, 'u'))
})
