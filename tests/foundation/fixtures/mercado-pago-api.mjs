// TUS-GANANCIAS-01: offline stand-in for the Mercado Pago HTTP API used by the REAL adapters
// (OAuth, Checkout Pro preferences, payments, refunds and Payouts "money-out"). It is injected as
// `fetch`, so request shapes, headers, signatures, idempotency and money conversion are exercised
// exactly as against Mercado Pago. Payouts follows the documented contract:
//   POST /v1/payouts (202, X-Idempotency-Key required, X-test-token in sandbox, X-enforce-signature
//   + X-signature = Ed25519 signature of the body in production)
//   GET  /v1/payouts/{payout_id}/transactions/{transaction_id}
// `mp.idRun` (empty by default) prefixes the ids the stand-in generates, so a test against a
// persistent database can run again without colliding with the unique ids of a previous run.
export const MERCADO_PAGO_API_SETUP = `
  const { firmarManifiestoMercadoPago } = await import('./apps/api/src/tus/finance/servicios/mercado-pago.ts')
  const nodeCrypto = await import('node:crypto')
  const mp = { requests: [], preferences: [], payments: new Map(), sellers: new Map(), refunds: [], tokenSeq: 0, payouts: new Map(), payoutsByKey: new Map(), payoutSeq: 0, payoutRejectEmails: new Set(), payoutsDown: 0, payoutPublicKey: null, idRun: '' }
  const WEBHOOK_SECRET = 'api-webhook-secret'
  function issueTokens(userId) { mp.tokenSeq += 1; const token = 'seller-token-' + userId + '-' + mp.tokenSeq; mp.sellers.set(token, userId); return { access_token: token, refresh_token: 'seller-refresh-' + userId + '-' + mp.tokenSeq, public_key: 'seller-public-' + userId, user_id: Number(userId), scope: 'offline_access read write', live_mode: false, expires_in: 15552000 } }
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  async function mpFetch(url, init) {
    const path = new URL(url).pathname
    const body = init.body ? JSON.parse(init.body) : undefined
    mp.requests.push({ method: init.method, path, headers: { ...init.headers }, body, raw: init.body ?? null })
    if (path === '/oauth/token') return reply(200, issueTokens(body.code.replace('TG-code-', '')))
    const seller = mp.sellers.get(String(init.headers.authorization ?? '').replace('Bearer ', ''))
    if (!seller) return reply(401, { message: 'invalid token' })
    if (path === '/checkout/preferences' && init.method === 'POST') {
      const id = 'pref-' + mp.idRun + (mp.preferences.length + 1)
      mp.preferences.push({ id, seller, body, idempotencyKey: init.headers['X-Idempotency-Key'] })
      return reply(201, { id, init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=' + id, sandbox_init_point: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=' + id })
    }
    const refundMatch = path.match(/^\\/v1\\/payments\\/([^/]+)\\/refunds$/)
    if (refundMatch) {
      const payment = mp.payments.get(refundMatch[1])
      mp.refunds.push({ paymentId: refundMatch[1], seller, idempotencyKey: init.headers['X-Idempotency-Key'] })
      if (!payment || String(payment.collector_id) !== seller) return reply(404, { message: 'payment not found' })
      return reply(201, { id: 900000 + mp.refunds.length, payment_id: Number(refundMatch[1]), status: 'approved' })
    }
    // Payments of one account found by external reference (TUS payment query): only that
    // account's own payments are visible to its token, like Mercado Pago.
    if (path === '/v1/payments/search' && init.method === 'GET') {
      const reference = new URL(url).searchParams.get('external_reference')
      const results = [...mp.payments.values()].filter((payment) => payment.external_reference === reference && String(payment.collector_id) === seller)
      return reply(200, { paging: { total: results.length, limit: 10, offset: 0 }, results })
    }
    const paymentMatch = path.match(/^\\/v1\\/payments\\/([^/]+)$/)
    if (paymentMatch) {
      const payment = mp.payments.get(paymentMatch[1])
      if (!payment || String(payment.collector_id) !== seller) return reply(404, { message: 'payment not found' })
      return reply(200, payment)
    }
    // ---- Payouts ----
    if (path === '/v1/payouts' && init.method === 'POST') {
      const key = init.headers['x-idempotency-key']
      if (!key) return reply(400, { error: 'idempotency_key_required' })
      if (mp.payoutPublicKey) {
        if (init.headers['x-enforce-signature'] !== 'true' || !init.headers['x-signature']) return reply(400, { error: 'invalid_signature' })
        const ok = nodeCrypto.verify(null, Buffer.from(init.body, 'utf8'), mp.payoutPublicKey, Buffer.from(init.headers['x-signature'], 'base64'))
        if (!ok) return reply(400, { error: 'invalid_signature' })
      }
      if (mp.payoutsDown > 0) { mp.payoutsDown -= 1; if (mp.payoutsByKey.has(key)) return reply(503, { error: 'bad_gateway' }); const created = crearPayout(seller, body, key); mp.payoutsByKey.set(key, created); return reply(502, { error: 'bad_gateway' }) }
      if (mp.payoutsByKey.has(key)) return reply(202, mp.payoutsByKey.get(key).response)
      if (mp.payoutRejectEmails.has(body.transactions[0].account.email)) return reply(400, { error: 'invalid_destination', message: 'account not found' })
      const created = crearPayout(seller, body, key)
      mp.payoutsByKey.set(key, created)
      return reply(202, created.response)
    }
    const payoutTx = path.match(/^\\/v1\\/payouts\\/([^/]+)\\/transactions\\/([^/]+)$/)
    if (payoutTx && init.method === 'GET') {
      const payout = mp.payouts.get(payoutTx[1])
      if (!payout || payout.seller !== seller || payout.transactionId !== payoutTx[2]) return reply(404, { error: 'not_found' })
      return reply(200, { id: payout.transactionId, status: payout.status, ...(payout.statusDetail ? { status_detail: payout.statusDetail } : {}), amount: payout.amount, external_reference: payout.externalReference, account: payout.account })
    }
    return reply(404, { message: 'not found' })
  }
  function crearPayout(seller, body, key) {
    mp.payoutSeq += 1
    const id = 'POP' + mp.idRun + String(mp.payoutSeq).padStart(8, '0')
    const transactionId = 'TOP' + mp.idRun + String(mp.payoutSeq).padStart(8, '0')
    const payout = { id, transactionId, seller, status: 'created', statusDetail: null, amount: body.transactions[0].amount, account: body.transactions[0].account, externalReference: body.external_reference, notificationUrl: body.config?.notification_url ?? null, idempotencyKey: key }
    mp.payouts.set(id, payout)
    return { payout, response: { id, external_reference: body.external_reference, idempotency_key: key, status: 'created', transactions: [{ id: transactionId, amount: body.transactions[0].amount, external_reference: body.transactions[0].external_reference }] } }
  }
  // Mercado Pago processes a transfer (what its notification would announce).
  const procesarPayout = (payoutId, status, statusDetail = null) => { const payout = mp.payouts.get(payoutId); payout.status = status; payout.statusDetail = statusDetail; return { id: payout.transactionId, status: status === 'success' ? 'approved' : status, payout: { id: payout.id, notification_url: payout.notificationUrl } } }
  function mpPayment(id, preference, overrides = {}) {
    const payment = { id: Number(id), status: 'approved', status_detail: 'accredited', transaction_amount: preference.body.items[0].unit_price, currency_id: 'ARS', external_reference: preference.body.external_reference, collector_id: Number(preference.seller), ...(preference.body.marketplace_fee !== undefined ? { marketplace_fee: preference.body.marketplace_fee } : {}), date_created: new Date().toISOString(), date_last_updated: new Date(Date.now() + Number(id) % 1000).toISOString(), fee_details: [], ...overrides }
    mp.payments.set(String(id), payment)
    return payment
  }
  let notificationSeq = 0
  function notification(paymentId, options = {}) {
    notificationSeq += 1
    const body = { id: options.notificationId ?? 'notif-' + notificationSeq + '-' + Date.now(), type: 'payment', action: 'payment.updated', data: { id: String(paymentId) }, user_id: options.userId }
    const rawBody = JSON.stringify(body)
    const requestId = 'req-' + notificationSeq + '-' + Date.now()
    const ts = Date.now()
    const signature = options.signature ?? firmarManifiestoMercadoPago({ secret: options.secret ?? WEBHOOK_SECRET, dataId: String(paymentId), requestId, ts })
    return { rawBody, signature, requestId, dataId: String(paymentId), receivedAt: new Date().toISOString() }
  }
`
