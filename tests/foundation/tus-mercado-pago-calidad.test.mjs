import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// MP-CALIDAD-01. What TUS sends to Mercado Pago when it creates a Checkout Pro preference, with a
// fake transport (nothing leaves this machine). The fields the integration-quality measurement of
// Mercado Pago looks at and TUS controls; see docs/MERCADO_PAGO_CALIDAD_100.md.
test('MP calidad: the preference carries the item (id, title, description, quantity, currency, exact price), the external reference, the notification URL, the three back URLs and auto return; the buyer, the category and the statement descriptor only when TUS has them; collected by TUS there is no marketplace fee; a failing buyer lookup never stops a checkout', () => {
  const r = runTypeScriptScenario(`
    const { ProveedorPagosMercadoPago } = await import('./apps/api/src/tus/finance/servicios/mercado-pago.ts')
    const enviados = []
    const fetchFalso = async (url, init) => { enviados.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null }); return { ok: true, status: 201, json: async () => ({ id: 'pref-1', init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1', sandbox_init_point: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1' }), text: async () => '' } }
    const base = { environment: 'production', webhookSecret: 'fictitious-webhook-secret', notificationUrl: 'https://api.tusservicios.shop/tus/v1/integrations/mercado-pago/webhooks', webBaseUrl: 'https://tusservicios.shop/', plataforma: { accessToken: 'fictitious-platform-token', userId: '555' }, fetch: fetchFalso }
    const cuentas = { tokenVigente: async () => { throw new Error('unused') } }
    const pedido = { paymentId: 'pago-abc', idempotencyKey: 'pago-abc', amountMinor: 1500000n, currency: 'ARS', prestadorTenantId: 'prestador', commissionMinor: 150000n, collectionMode: 'plataforma', title: 'Seña (50%) del turno TUS', description: 'Pago de un turno reservado en TUS', clienteTenantId: 'cliente', trabajoId: 'trabajo-1', returnPath: '/mis-turnos?pago=retorno' }
    const crear = async (config, extra = {}) => { enviados.length = 0; const res = await new ProveedorPagosMercadoPago({ ...base, ...config }, cuentas).crearPago({ ...pedido, ...extra }); return { res, enviado: enviados[0] } }
    const out = {}
    const completo = await crear({ categoriaItem: ' services ', descripcionResumen: 'TUS SERVICIOS DE CORRIENTES CAPITAL', comprador: async (tenant) => (tenant === 'cliente' ? { email: ' ana@example.com ', nombre: 'Ana María', apellido: 'Gómez' } : null) })
    out.completo = completo.enviado.body
    out.transporte = [completo.enviado.url, completo.enviado.method, completo.enviado.headers['X-Idempotency-Key'], completo.enviado.headers.authorization === 'Bearer fictitious-platform-token', completo.res.checkoutUrl.startsWith('https://www.mercadopago.com.ar/')]
    out.minimo = (await crear({})).enviado.body
    out.compradorParcial = (await crear({ comprador: async () => ({ email: 'no-es-un-email', nombre: '  ', apellido: 'Gómez' }) })).enviado.body.payer
    out.compradorFalla = (await crear({ comprador: async () => { throw new Error('base caída') } })).enviado.body.payer ?? null
    out.sinCliente = (await crear({ comprador: async () => ({ email: 'ana@example.com' }) }, { clienteTenantId: undefined })).enviado.body.payer ?? null
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.completo, {
    items: [{ id: 'pago-abc', title: 'Seña (50%) del turno TUS', description: 'Pago de un turno reservado en TUS', category_id: 'services', quantity: 1, currency_id: 'ARS', unit_price: 15000 }],
    external_reference: 'pago-abc',
    payer: { email: 'ana@example.com', name: 'Ana María', surname: 'Gómez' },
    statement_descriptor: 'TUS SERVICIOS DE CORRI',
    notification_url: 'https://api.tusservicios.shop/tus/v1/integrations/mercado-pago/webhooks',
    back_urls: { success: 'https://tusservicios.shop/mis-turnos?pago=retorno', pending: 'https://tusservicios.shop/mis-turnos?pago=retorno', failure: 'https://tusservicios.shop/mis-turnos?pago=retorno' },
    auto_return: 'approved',
    metadata: { tus_payment_id: 'pago-abc' },
  }, 'everything TUS controls, and no marketplace_fee when TUS collects')
  assert.deepEqual(r.transporte, ['https://api.mercadopago.com/checkout/preferences', 'POST', 'pago-abc', true, true], 'one idempotent request with the account of TUS')
  assert.deepEqual(Object.keys(r.minimo).sort(), ['auto_return', 'back_urls', 'external_reference', 'items', 'metadata', 'notification_url'], 'nothing configured: no buyer, no category, no descriptor are made up')
  assert.deepEqual(r.minimo.items[0], { id: 'pago-abc', title: 'Seña (50%) del turno TUS', description: 'Pago de un turno reservado en TUS', quantity: 1, currency_id: 'ARS', unit_price: 15000 })
  assert.deepEqual(r.compradorParcial, { surname: 'Gómez' }, 'only what is really there: an invalid email and a blank name are left out')
  assert.equal(r.compradorFalla, null, 'a failing lookup does not stop the checkout')
  assert.equal(r.sinCliente, null)
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const ejemplo = read('.env.example')
  assert.match(ejemplo, /^MERCADO_PAGO_ITEM_CATEGORY_ID=$/mu)
  assert.match(ejemplo, /^MERCADO_PAGO_STATEMENT_DESCRIPTOR=$/mu)
  const composicion = read('apps/api/src/tus/composition/index.ts')
  assert.match(composicion, /const usuario = cuentas\.length === 1 \? cuentas\[0\]!\.user : null/u, 'the buyer only when the tenant of the client has exactly one account')
  // The webhook is verified and the payment re-read: unchanged by this.
  const proveedor = read('apps/api/src/tus/finance/servicios/mercado-pago.ts')
  assert.match(proveedor, /verificarFirmaMercadoPago\(\{/u)
  assert.doesNotMatch(proveedor, /console\.(log|info|debug)\(/u, 'nothing of a request is printed')
  assert.ok(read('docs/MERCADO_PAGO_CALIDAD_100.md').includes('payment ID'))
})
