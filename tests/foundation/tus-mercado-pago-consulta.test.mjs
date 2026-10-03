import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// The payment query (GET /v1/payments/search) of the REAL Mercado Pago adapter against a fake
// HTTP API. It is read-only: one GET per page with the collecting account's token, found by
// TUS's own external reference. What it returns only FEEDS the financial state machine, which is
// what validates amount, currency and status; nothing here confirms a payment.

test('Mercado Pago payment query: read-only search by TUS reference with the collecting account, paged and bounded; payments of another reference or collector are left out; empty, rate limit, auth, timeout and provider errors never produce a payment', () => {
  const r = runTypeScriptScenario(`
    const { ProveedorPagosMercadoPago } = await import('./apps/api/src/tus/finance/servicios/mercado-pago.ts')
    const { ErrorFinanzasServicio } = await import('./apps/api/src/tus/finance/servicios/modelo.ts')
    const vivo = setInterval(() => {}, 1000)
    const VENDEDOR = '111', PLATAFORMA = '999', REF = 'pay-intent-1'
    const pedidos = []
    let responder = () => ({ status: 200, body: { paging: { total: 0 }, results: [] } })
    const fetchFalso = async (url, init) => {
      const u = new URL(url)
      pedidos.push({ method: init.method, path: u.pathname, ref: u.searchParams.get('external_reference'), limit: u.searchParams.get('limit'), offset: u.searchParams.get('offset'), sort: u.searchParams.get('sort') + ':' + u.searchParams.get('criteria'), token: init.headers.authorization, body: init.body ?? null })
      const salida = await responder(u, init)
      return { ok: salida.status >= 200 && salida.status < 300, status: salida.status, json: async () => { if (salida.roto) throw new Error('not json'); return salida.body } }
    }
    const cuentas = { tokenVigente: async (tenant) => { if (tenant === 'sin-cuenta') throw new Error('no account'); return { accessToken: 'seller-token', externalAccountId: VENDEDOR } }, cuentaPorExterna: async () => null }
    const nuevo = (extra = {}) => new ProveedorPagosMercadoPago({ environment: 'sandbox', webhookSecret: 'fictitious-secret', notificationUrl: 'https://api.example.test/hook', webBaseUrl: 'https://example.test', fetch: fetchFalso, timeoutMs: 120, plataforma: { accessToken: 'platform-token', userId: PLATAFORMA }, ...extra }, cuentas)
    const mp = nuevo()
    const pago = (id, extra = {}) => ({ id, external_reference: REF, collector_id: Number(VENDEDOR), status: 'approved', status_detail: 'accredited', currency_id: 'ARS', transaction_amount: 15000, date_created: '2026-09-25T12:00:00.000Z', date_last_updated: '2026-09-25T12:0' + (id % 10) + ':00.000Z', ...extra })
    const errores = []
    const consultar = async (entrada = {}, proveedor = mp) => {
      try { const eventos = await proveedor.consultarPagos({ paymentId: REF, collectionMode: 'split', prestadorTenantId: 'prov', ...entrada }); return eventos.map((e) => ({ id: e.providerReference, ref: e.paymentId, status: e.status, monto: e.amountMinor.toString(), moneda: e.currency, cobrador: e.collectorId, modo: e.collectedBy.mode })) }
      catch (e) { errores.push(String(e.message) + ' ' + String(e.stack)); return e instanceof ErrorFinanzasServicio ? e.status + ':' + e.code + ':' + e.message : 'otro:' + e.message }
    }
    const out = {}

    // 1) empty answer.
    out.vacio = await consultar()
    out.pedido = pedidos[0]

    // 2) own payments, plus entries that are not of this intent or this collector.
    responder = () => ({ status: 200, body: { paging: { total: 6 }, results: [
      pago(1, { status: 'rejected', status_detail: 'cc_rejected_other_reason' }),
      pago(2),
      pago(3, { external_reference: 'pay-intent-OTHER' }),
      pago(4, { collector_id: 222 }),
      pago(5, { external_reference: null }),
      'garbage', null, [],
      pago(2),
    ] } })
    out.filtrado = await consultar()

    // 3) platform collection uses TUS's token and expects TUS as collector.
    let desde = pedidos.length
    responder = () => ({ status: 200, body: { paging: { total: 2 }, results: [pago(7, { collector_id: Number(PLATAFORMA) }), pago(8)] } })
    out.plataforma = await consultar({ collectionMode: 'plataforma' })
    out.tokenPlataforma = pedidos.slice(desde).map((p) => p.token)
    out.plataformaSinConfigurar = await consultar({ collectionMode: 'plataforma' }, nuevo({ plataforma: null }))

    // 4) pagination: 70 payments in pages of 30, the approved one is the last.
    desde = pedidos.length
    const muchos = Array.from({ length: 70 }, (_v, i) => pago(100 + i, { status: i === 69 ? 'approved' : 'rejected', status_detail: 'x' }))
    responder = (u) => { const offset = Number(u.searchParams.get('offset')); const limit = Number(u.searchParams.get('limit')); return { status: 200, body: { paging: { total: muchos.length, limit, offset }, results: muchos.slice(offset, offset + limit) } } }
    const paginado = await consultar()
    out.paginado = { total: paginado.length, aprobados: paginado.filter((p) => p.status === 'approved').map((p) => p.id), offsets: pedidos.slice(desde).map((p) => p.offset) }
    // ... and it is bounded even if the provider claims an endless list.
    desde = pedidos.length
    responder = (u) => { const offset = Number(u.searchParams.get('offset')); return { status: 200, body: { paging: { total: 1000000 }, results: Array.from({ length: 30 }, (_v, i) => pago(10000 + offset + i, { status: 'rejected' })) } } }
    const sinFin = await consultar()
    out.acotado = { total: sinFin.length, pedidos: pedidos.length - desde }

    // 5) malformed answers.
    responder = () => ({ status: 200, body: { results: 'nope' } }); out.resultadosInvalidos = await consultar()
    responder = () => ({ status: 200, roto: true }); out.cuerpoRoto = await consultar()
    responder = () => ({ status: 200, body: { paging: { total: 1 }, results: [pago(9, { currency_id: 'XXX' })] } }); out.monedaDesconocida = await consultar()
    responder = () => ({ status: 200, body: { paging: { total: 1 }, results: [pago(9, { date_created: 'nope', date_last_updated: 'nope' })] } }); out.fechaInvalida = await consultar()
    responder = () => ({ status: 200, body: { paging: { total: 1 }, results: [pago(9, { status: 'something_new' })] } }); out.estadoDesconocido = await consultar()

    // 6) provider failures.
    out.http = {}
    for (const status of [400, 401, 403, 404, 429, 500, 503]) { responder = () => ({ status, body: { message: 'x seller-token' } }); out.http[status] = await consultar() }
    responder = () => { throw new Error('ECONNRESET seller-token') }; out.red = await consultar()
    responder = (_u, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
    const antes = Date.now(); out.colgado = await consultar(); out.colgadoAcotado = Date.now() - antes < 3000
    desde = pedidos.length
    out.sinCuenta = await consultar({ prestadorTenantId: 'sin-cuenta' }); out.pedidosSinCuenta = pedidos.length - desde

    out.soloLectura = pedidos.every((p) => p.method === 'GET' && p.path === '/v1/payments/search' && p.body === null && p.ref === REF)
    out.secretoEnErrores = errores.some((texto) => texto.includes('seller-token') || texto.includes('platform-token'))
    clearInterval(vivo)
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.vacio, [])
  assert.deepEqual(r.pedido, { method: 'GET', path: '/v1/payments/search', ref: 'pay-intent-1', limit: '30', offset: '0', sort: 'date_created:asc', token: 'Bearer seller-token', body: null })
  assert.deepEqual(r.filtrado, [
    { id: '1', ref: 'pay-intent-1', status: 'rejected', monto: '1500000', moneda: 'ARS', cobrador: '111', modo: 'split' },
    { id: '2', ref: 'pay-intent-1', status: 'approved', monto: '1500000', moneda: 'ARS', cobrador: '111', modo: 'split' },
  ], 'another reference, another collector, garbage and a repeated payment are left out')
  assert.deepEqual(r.plataforma.map((p) => [p.id, p.cobrador, p.modo]), [['7', '999', 'plataforma']], 'a payment collected by a seller is not a platform payment')
  assert.deepEqual(r.tokenPlataforma, ['Bearer platform-token'])
  assert.match(r.plataformaSinConfigurar, /^503:PROVIDER_UNAVAILABLE:/u)
  assert.deepEqual(r.paginado, { total: 70, aprobados: ['169'], offsets: ['0', '30', '60'] })
  assert.deepEqual(r.acotado, { total: 120, pedidos: 4 })
  assert.deepEqual(r.resultadosInvalidos, [])
  assert.match(r.cuerpoRoto, /^503:PROVIDER_UNAVAILABLE:/u)
  assert.equal(typeof r.monedaDesconocida, 'string', 'an unknown currency is an error, not a payment')
  assert.match(r.fechaInvalida, /^400:INVALID_EVENT:/u)
  assert.deepEqual(r.estadoDesconocido.map((p) => p.status), ['unknown'])
  assert.deepEqual(r.http, {
    400: '503:PROVIDER_UNAVAILABLE:PROVIDER_REJECTED',
    401: '503:PROVIDER_UNAVAILABLE:PROVIDER_ACCOUNT_NOT_CONNECTED',
    403: '503:PROVIDER_UNAVAILABLE:PROVIDER_ACCOUNT_NOT_CONNECTED',
    404: '503:PROVIDER_UNAVAILABLE:PROVIDER_REJECTED',
    429: '503:PROVIDER_UNAVAILABLE:PROVIDER_REJECTED',
    500: '503:PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE',
    503: '503:PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE',
  })
  assert.equal(r.red, '503:PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE')
  assert.deepEqual([r.colgado, r.colgadoAcotado], ['503:PROVIDER_UNAVAILABLE:PROVIDER_TIMEOUT', true])
  assert.deepEqual([r.sinCuenta, r.pedidosSinCuenta], ['503:PROVIDER_UNAVAILABLE:PROVIDER_ACCOUNT_NOT_CONNECTED', 0])
  assert.equal(r.soloLectura, true, 'the query only issues GET /v1/payments/search for its own reference')
  assert.equal(r.secretoEnErrores, false)
})
