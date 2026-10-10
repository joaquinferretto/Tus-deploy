import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// FASE 6: the provider links their own Mercado Pago account from the new experience
// (/prestador/pagos). OAuth itself (PKCE, single-use state, encrypted tokens) is WEB-09D/E.
test('FASE6 HTTP: OAuth callback returns to /prestador/pagos; linking needs the provider session; no token leaves the API', () => {
  const result = runTypeScriptScenario(`
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { InMemoryTusCommitmentStore, InMemoryTusCompensationStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction, InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { AlmacenCuentasCobroEnMemoria } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
    const { AlmacenConfiguracionPagosEnMemoria } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    const { crearModuloPagosServicio } = await import('./apps/api/src/tus/finance/servicios/composicion-pagos.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const env = { TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'sandbox', MERCADO_PAGO_CLIENT_ID: 'app-id', MERCADO_PAGO_CLIENT_SECRET: 'fictitious-client-secret', MERCADO_PAGO_WEBHOOK_SECRET: 'webhook-secret-value', MERCADO_PAGO_OAUTH_REDIRECT_URI: 'https://api.example.test/tus/v1/integrations/mercado-pago/oauth/callback', TUS_PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64'), TUS_WEB_BASE_URL: 'https://web.example.test', MERCADO_PAGO_NOTIFICATION_URL: 'https://api.example.test/tus/v1/integrations/mercado-pago/webhooks' }
    const oauth = { intercambiarCodigo: async () => ({ accessToken: 'fictitious-mp-access-token', refreshToken: 'TG-refresh', publicKey: null, userId: '987654321', scopes: ['offline_access', 'read', 'write'], liveMode: false, expiresInSeconds: 15552000 }), renovarToken: async () => { throw new Error('unused') } }
    const cuentas = new AlmacenCuentasCobroEnMemoria()
    const payments = crearModuloPagosServicio({ env, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas, oauth, identidadVerificada: async () => true })
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('provider-token', { sessionId: 's-p', subjectId: 'provider-user', tenantId: 'provider-tenant', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'] })
    sessions.add('customer-token', { sessionId: 's-c', subjectId: 'customer-user', tenantId: 'customer-tenant', roles: ['customer'], permissions: ['tus:checkout', 'tus:marketplace:read'] })
    const commitments = new InMemoryTusCommitmentStore(); const compensations = new InMemoryTusCompensationStore(); const audits = new AlmacenReferenciasAuditoriaEnMemoria(); const idempotency = new InMemoryTusIdempotencyStore(); const outbox = new InMemoryTusOutboxStore()
    const application = new TusApplicationService({ commitments, compensations, audits, idempotency, outbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, outbox, compensations }), servicePayments: payments })
    const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const call = async (method, path, token, body) => { const r = await fetch(base + path, { method, redirect: 'manual', headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-correlation-id': 'corr', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const text = await r.text(); return { status: r.status, text, location: r.headers.get('location'), cache: r.headers.get('cache-control') } }
    try {
      const customerConnect = await call('POST', '/tus/v1/provider/payment-account/mercado-pago/connect', 'customer-token', {})
      const anonymousStatus = await call('GET', '/tus/v1/provider/payment-account')
      const spoofed = await call('POST', '/tus/v1/provider/payment-account/mercado-pago/connect', 'provider-token', { tenantId: 'customer-tenant' })
      const started = await call('POST', '/tus/v1/provider/payment-account/mercado-pago/connect', 'provider-token', {})
      const state = new URL(JSON.parse(started.text).authorizationUrl).searchParams.get('state')
      const forged = await call('GET', '/tus/v1/integrations/mercado-pago/oauth/callback?code=TG-x&state=' + 'y'.repeat(43))
      const ok = await call('GET', '/tus/v1/integrations/mercado-pago/oauth/callback?code=TG-x&state=' + state)
      const replay = await call('GET', '/tus/v1/integrations/mercado-pago/oauth/callback?code=TG-x&state=' + state)
      const status = await call('GET', '/tus/v1/provider/payment-account', 'provider-token')
      const customerStatus = await call('GET', '/tus/v1/provider/payment-account', 'customer-token')
      console.log(JSON.stringify({ customerConnect: customerConnect.status, anonymousStatus: anonymousStatus.status, spoofed: spoofed.status, started: started.status, forged, ok, replay, status, customerStatus: customerStatus.status }))
    } finally { server.close() }
  `)
  assert.equal(result.customerConnect, 403)
  // MP-OAUTH-AUTORIZACION-01: no session is 401 (sign in), not a 403 that looks like a refusal of the policy.
  assert.equal(result.anonymousStatus, 401)
  assert.equal(result.spoofed, 403)
  assert.equal(result.started, 201)
  assert.equal(result.forged.status, 303)
  assert.equal(result.forged.location, 'https://web.example.test/prestador/pagos?mercadoPago=error&reason=INVALID_STATE')
  assert.equal(result.ok.status, 303)
  assert.equal(result.ok.location, 'https://web.example.test/prestador/pagos?mercadoPago=connected')
  assert.equal(result.ok.cache, 'no-store')
  assert.match(result.replay.location, /mercadoPago=error&reason=INVALID_STATE$/u)
  assert.equal(result.status.status, 200)
  const account = JSON.parse(result.status.text)
  assert.equal(account.status, 'connected')
  assert.equal(account.connectAvailable, true)
  assert.doesNotMatch(result.status.text, /fictitious-mp-access-token|APP_USR|TG-refresh|accessToken|refreshToken|access_token|secret/iu)
  assert.equal(result.customerStatus, 403)
})

test('FASE6 Web: /prestador/pagos shows only safe data (masked account), never asks for tokens and is linked from the provider nav', () => {
  const result = runTypeScriptScenario(`
    const { maskAccountId } = await import('./apps/web/src/features/provider/payment-account-mask.ts')
    console.log(JSON.stringify({ long: maskAccountId('987654321'), short: maskAccountId('12'), none: maskAccountId(null) }))
  `)
  assert.deepEqual(result, { long: '•••• 4321', short: '••••', none: null })
  const read = (path) => readFileSync(join(root, path), 'utf8')
  const panel = read('apps/web/src/features/provider/provider-payments.tsx')
  // PAGOS-MP-VINCULADO-01: one step ("Vincular Mercado Pago"), three states, and no technical id
  // on screen (not even the masked account).
  assert.match(panel, /'Vincular Mercado Pago para retirar tus ganancias'/u)
  assert.match(panel, /Tus clientes te pagan por TUS aunque no tengas Mercado Pago vinculado/u)
  assert.match(panel, /'Volver a vincular Mercado Pago'/u)
  assert.match(panel, /Desvincular/u)
  assert.match(panel, /data-mercado-pago=\{connected \? 'vinculado' : account\.status === 'expired' \|\| account\.status === 'error' \? 'requiere_reconexion' : 'no_vinculado'\}/u)
  assert.doesNotMatch(panel, /externalAccountId|verificación de identidad/u)
  assert.match(read('apps/web/src/components/prestador/cuenta-cobro.tsx'), /connected: 'Mercado Pago vinculado'/u)
  assert.match(panel, /isMercadoPagoAuthorizationUrl\(authorizationUrl\)/u)
  // The browser never handles credentials: no inputs for tokens, secrets or CBU.
  assert.doesNotMatch(panel, /<input|accessToken|refreshToken|clientSecret|CBU"/u)
  assert.match(read('apps/web/src/app/prestador/pagos/page.tsx'), /<ProviderPayments \/>/u)
  // The provider navigation is ONE component (it used to be written by hand on every page).
  for (const page of ['apps/web/src/app/prestador/solicitudes/page.tsx', 'apps/web/src/app/prestador/perfil-publico/page.tsx'])
    assert.ok(read(page).includes('<ProviderNav />'), page)
  assert.ok(read('apps/web/src/features/provider/provider-nav.tsx').includes("{ href: '/prestador/pagos', label: 'Pagos' }"))
})
