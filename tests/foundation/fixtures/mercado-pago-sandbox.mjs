// WEB-09E: offline stand-in for the Mercado Pago HTTP API (OAuth, preferences, payments and
// refunds). It is injected as `fetch` into the REAL adapters, so request shapes, headers,
// signatures and money conversion are exercised exactly as in sandbox.
export const MERCADO_PAGO_SANDBOX_SETUP = `
  const { crearModuloPagosServicio } = await import('./apps/api/src/tus/finance/servicios/composicion-pagos.ts')
  const { AlmacenConfiguracionPagosEnMemoria } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
  const { AlmacenCuentasCobroEnMemoria } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
  const { firmarManifiestoMercadoPago } = await import('./apps/api/src/tus/finance/servicios/mercado-pago.ts')
  const plain = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
  let nowMs = Date.parse('2026-09-23T10:00:00.000Z')
  const mpClock = () => nowMs
  const WEBHOOK_SECRET = 'sandbox-webhook-secret'
  const mpEnv = { TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'sandbox', MERCADO_PAGO_CLIENT_ID: 'app-123', MERCADO_PAGO_CLIENT_SECRET: 'client-secret-value', MERCADO_PAGO_WEBHOOK_SECRET: WEBHOOK_SECRET, MERCADO_PAGO_OAUTH_REDIRECT_URI: 'https://api.tus.test/tus/v1/integrations/mercado-pago/oauth/callback', MERCADO_PAGO_NOTIFICATION_URL: 'https://api.tus.test/tus/v1/integrations/mercado-pago/webhooks', TUS_PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 3).toString('base64'), TUS_WEB_BASE_URL: 'https://web.tus.test', TUS_PLATFORM_ADMIN_TENANT_ID: 'platform-tenant' }
  // ---- fake Mercado Pago API ----
  const mp = { requests: [], preferences: [], payments: new Map(), sellers: new Map(), refunds: [], tokenSeq: 0, refreshFails: new Set() }
  function issueTokens(userId) { mp.tokenSeq += 1; const token = 'APP_USR-token-' + userId + '-' + mp.tokenSeq; mp.sellers.set(token, userId); return { access_token: token, refresh_token: 'TG-refresh-' + userId + '-' + mp.tokenSeq, public_key: 'APP_USR-public-' + userId, user_id: Number(userId), scope: 'offline_access read write', live_mode: false, expires_in: 15552000 } }
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  async function mpFetch(url, init) {
    const path = new URL(url).pathname
    const body = init.body ? JSON.parse(init.body) : undefined
    mp.requests.push({ method: init.method, path, headers: { ...init.headers }, body })
    if (path === '/oauth/token') {
      if (body.grant_type === 'refresh_token') {
        if (mp.refreshFails.has(body.refresh_token)) return reply(400, { error: 'invalid_grant', message: 'client-secret-value must never leak' })
        const userId = body.refresh_token.split('-')[2]
        return reply(200, issueTokens(userId))
      }
      return reply(200, issueTokens(body.code.replace('TG-code-', '')))
    }
    const seller = mp.sellers.get(String(init.headers.authorization ?? '').replace('Bearer ', ''))
    if (!seller) return reply(401, { message: 'invalid token' })
    if (path === '/checkout/preferences' && init.method === 'POST') {
      const id = 'pref-' + (mp.preferences.length + 1)
      mp.preferences.push({ id, seller, body, idempotencyKey: init.headers['X-Idempotency-Key'] })
      return reply(201, { id, init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=' + id, sandbox_init_point: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=' + id })
    }
    const refundMatch = path.match(/^\\/v1\\/payments\\/([^/]+)\\/refunds$/)
    if (refundMatch) {
      const payment = mp.payments.get(refundMatch[1])
      mp.refunds.push({ paymentId: refundMatch[1], seller, body: init.body ?? null, idempotencyKey: init.headers['X-Idempotency-Key'] })
      if (!payment || String(payment.collector_id) !== seller) return reply(404, { message: 'payment not found' })
      if (payment.sellerBalance === 'empty') return reply(400, { message: 'Insufficient balance in seller account', cause: [{ code: 'insufficient_funds' }] })
      return reply(201, { id: 900000 + mp.refunds.length, payment_id: Number(refundMatch[1]), status: 'approved' })
    }
    const paymentMatch = path.match(/^\\/v1\\/payments\\/([^/]+)$/)
    if (paymentMatch) {
      const payment = mp.payments.get(paymentMatch[1])
      if (!payment || String(payment.collector_id) !== seller) return reply(404, { message: 'payment not found' })
      const { sellerBalance, ...visible } = payment
      return reply(200, visible)
    }
    return reply(404, { message: 'not found' })
  }
  // ---- composition with the real adapters ----
  const paymentsConfig = new AlmacenConfiguracionPagosEnMemoria()
  const accountsStore = new AlmacenCuentasCobroEnMemoria()
  // The OAuth client also talks to the fake API.
  const { ClienteOAuthMercadoPagoHttp } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
  const paymentsWithOauth = crearModuloPagosServicio({ env: mpEnv, configuracion: paymentsConfig, cuentas: accountsStore, now: mpClock, mercadoPago: { fetch: mpFetch }, oauth: new ClienteOAuthMercadoPagoHttp({ clientId: 'app-123', clientSecret: 'client-secret-value', testToken: true, fetch: mpFetch }) })
  const mpFinance = new ServicioFinanzasServicios(new TransaccionFinanzasServicioEnMemoria(financeStore, new IdentidadServicioEnMemoria(workStore, marketplace)), mpClock, paymentsWithOauth.proveedor, undefined, paymentsWithOauth.politica)
  const admin = { actorId: 'platform-admin', correlationId: 'corr-admin' }
  await paymentsWithOauth.configuracion.registrarConfiguracion(admin, { paymentsEnabled: true, reason: 'sandbox', expectedVersion: 0 })
  async function connectSeller(tenantId, userId) {
    const started = await paymentsWithOauth.cuentas.iniciarConexion({ tenantId, actorId: 'seller-user', correlationId: 'corr-connect' })
    const state = new URL(started.authorizationUrl).searchParams.get('state')
    return paymentsWithOauth.cuentas.completarConexion({ code: 'TG-code-' + userId, state, correlationId: 'corr-callback' })
  }
  function mpPayment(id, preference, overrides = {}) {
    const payment = { id: Number(id), status: 'approved', status_detail: 'accredited', transaction_amount: preference.body.items[0].unit_price, currency_id: 'ARS', external_reference: preference.body.external_reference, collector_id: Number(preference.seller), marketplace_fee: preference.body.marketplace_fee, date_created: '2026-09-23T10:05:00.000Z', date_last_updated: '2026-09-23T10:06:00.000Z', fee_details: [{ type: 'mercadopago_fee', amount: 3000, fee_payer: 'collector' }, { type: 'application_fee', amount: preference.body.marketplace_fee, fee_payer: 'collector' }], ...overrides }
    mp.payments.set(String(id), payment)
    return payment
  }
  let notificationSeq = 0
  function notification(paymentId, options = {}) {
    notificationSeq += 1
    const body = { id: options.notificationId ?? 'notif-' + notificationSeq, type: options.type ?? 'payment', action: 'payment.updated', data: { id: options.bodyDataId ?? String(paymentId) }, user_id: options.userId ?? '777' }
    const rawBody = JSON.stringify(body)
    const requestId = 'req-' + notificationSeq
    const ts = options.ts ?? nowMs
    const signature = options.signature ?? firmarManifiestoMercadoPago({ secret: options.secret ?? WEBHOOK_SECRET, dataId: String(paymentId), requestId: options.signedRequestId ?? requestId, ts })
    return { rawBody, signature, requestId, dataId: String(paymentId), receivedAt: new Date(nowMs).toISOString() }
  }
`
