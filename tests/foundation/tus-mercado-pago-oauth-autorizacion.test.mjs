import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// MP-OAUTH-AUTORIZACION-01. Who may link a Mercado Pago account, through the real HTTP router and
// the real payment account service (OAuth with a fake token endpoint; no account is linked for
// real). A signed-in provider links ITS OWN account and nothing else is asked of it; every refusal
// has its own answer.
test('MP OAUTH autorización HTTP: the owner of a provider starts OAuth (PKCE S256, the exact redirect URI, a single-use state) with no verified identity and no linked account; it can link again; another tenant, a client with no provider and a session with no permission cannot; no session is 401, not 403; payments off is 503; two requests at once leave two independent states and no account', () => {
  const r = runTypeScriptScenario(`
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { InMemoryTusCommitmentStore, InMemoryTusCompensationStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction, InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { AlmacenCuentasCobroEnMemoria } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
    const { AlmacenConfiguracionPagosEnMemoria } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    const { crearModuloPagosServicio } = await import('./apps/api/src/tus/finance/servicios/composicion-pagos.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const REDIRECT = 'https://api.tusservicios.shop/tus/v1/integrations/mercado-pago/oauth/callback'
    const env = { TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'sandbox', MERCADO_PAGO_CLIENT_ID: 'app-id', MERCADO_PAGO_CLIENT_SECRET: 'fictitious-client-secret', MERCADO_PAGO_WEBHOOK_SECRET: 'webhook-secret-value', MERCADO_PAGO_OAUTH_REDIRECT_URI: REDIRECT, TUS_PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64'), TUS_WEB_BASE_URL: 'https://web.example.test', MERCADO_PAGO_NOTIFICATION_URL: 'https://api.example.test/tus/v1/integrations/mercado-pago/webhooks' }
    const intercambios = []
    const oauth = { intercambiarCodigo: async (input) => { intercambios.push(Object.keys(input).sort().join(',')); return { accessToken: 'fictitious-mp-access-token', refreshToken: 'TG-refresh', publicKey: null, userId: '987654321', scopes: ['offline_access', 'read', 'write'], liveMode: false, expiresInSeconds: 15552000 } }, renovarToken: async () => { throw new Error('unused') } }
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('provider-token', { sessionId: 's-p', subjectId: 'provider-user', tenantId: 'provider-tenant', roles: ['owner'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'] })
    sessions.add('other-provider-token', { sessionId: 's-o', subjectId: 'other-user', tenantId: 'other-tenant', roles: ['owner'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'] })
    // A client: the owner of its own tenant (as every account), with no provider in it.
    sessions.add('client-token', { sessionId: 's-c', subjectId: 'client-user', tenantId: 'client-tenant', roles: ['owner'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'] })
    sessions.add('member-token', { sessionId: 's-m', subjectId: 'member-user', tenantId: 'provider-tenant', roles: ['member'], permissions: ['tus:checkout', 'tus:marketplace:read'] })
    const prestadores = new Set(['provider-tenant', 'other-tenant'])
    const levantar = (conPagos, identidadVerificada) => {
      const cuentas = new AlmacenCuentasCobroEnMemoria()
      const payments = crearModuloPagosServicio({ env, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas, oauth, identidadVerificada: async () => identidadVerificada })
      const commitments = new InMemoryTusCommitmentStore(); const compensations = new InMemoryTusCompensationStore(); const audits = new AlmacenReferenciasAuditoriaEnMemoria(); const idempotency = new InMemoryTusIdempotencyStore(); const outbox = new InMemoryTusOutboxStore()
      const real = new TusApplicationService({ commitments, compensations, audits, idempotency, outbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, outbox, compensations }), ...(conPagos ? { servicePayments: payments } : {}) })
      // The marketplace says which tenants have a provider (the merchant row), as in production.
      const application = new Proxy(real, { get: (target, key) => (key === 'marketplace' ? { store: { merchant: { find: async (tenantId) => (prestadores.has(tenantId) ? { merchantId: 'm-' + tenantId, status: 'approved' } : null) } } } : Reflect.get(target, key)) })
      const denegados = []
      const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions, onAuthorizationDenied: async (evento) => { denegados.push([evento.action, evento.reason, evento.tenantId]) } }), tusRoutesEnabled: true }).listen(0)
      const base = 'http://127.0.0.1:' + server.address().port
      const call = async (method, path, token, body, extra = {}) => { const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-correlation-id': 'corr', 'content-type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) }); const text = await res.text(); let json = null; try { json = JSON.parse(text) } catch {} return { status: res.status, code: json?.code ?? null, json, text, location: res.headers.get('location'), cache: res.headers.get('cache-control') } }
      return { server, call, denegados, cuentas }
    }
    const CONNECT = '/tus/v1/provider/payment-account/mercado-pago/connect'
    const out = {}
    // ---- A provider with NO verified identity, no linked account, no earnings.
    const a = levantar(true, false)
    try {
      const antes = await a.call('GET', '/tus/v1/provider/payment-account', 'provider-token')
      const uno = await a.call('POST', CONNECT, 'provider-token', {})
      const url = new URL(uno.json.authorizationUrl)
      out.propietario = [antes.status, antes.json.status, antes.json.connectAvailable, uno.status, uno.cache, url.origin + url.pathname, url.searchParams.get('redirect_uri'), url.searchParams.get('code_challenge_method'), /^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get('code_challenge')), /^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get('state')), url.searchParams.get('response_type'), url.searchParams.get('client_id'), /secret|verifier|token/iu.test(uno.text)]
      out.aliasEnEspanol = (await a.call('POST', '/tus/v1/prestador/cuenta-cobro/mercado-pago/conectar', 'provider-token', {})).status
      // ---- Two requests at once: two independent states, nothing linked, nothing corrupted.
      const dos = await Promise.all([a.call('POST', CONNECT, 'provider-token', {}), a.call('POST', CONNECT, 'provider-token', {})])
      const estados = dos.map((x) => new URL(x.json.authorizationUrl).searchParams.get('state'))
      out.concurrentes = [dos.map((x) => x.status), estados[0] !== estados[1], (await a.call('GET', '/tus/v1/provider/payment-account', 'provider-token')).json.status]
      // ---- Who cannot.
      out.sinSesion = [await a.call('GET', '/tus/v1/provider/payment-account'), await a.call('POST', CONNECT, null, {}), await a.call('POST', '/tus/v1/provider/payment-account/disconnect', null, {}), await a.call('POST', CONNECT, 'token-que-no-existe', {})].map((x) => [x.status, x.code])
      out.otros = [
        await a.call('POST', CONNECT, 'client-token', {}),
        await a.call('POST', CONNECT, 'member-token', {}),
        await a.call('POST', CONNECT, 'other-provider-token', { tenantId: 'provider-tenant' }),
        await a.call('POST', CONNECT, 'other-provider-token', {}, { 'x-tenant-id': 'provider-tenant' }),
        await a.call('POST', '/tus/v1/provider/payment-account/disconnect', 'other-provider-token', { tenantId: 'provider-tenant' }),
        await a.call('GET', '/tus/v1/provider/payment-account', 'client-token'),
      ].map((x) => [x.status, x.code])
      out.denegados = a.denegados
      // ---- The callback links THAT provider; the state is single-use; then it can link again.
      const state = url.searchParams.get('state')
      const vuelta = await a.call('GET', '/tus/v1/integrations/mercado-pago/oauth/callback?code=TG-x&state=' + state)
      const repetido = await a.call('GET', '/tus/v1/integrations/mercado-pago/oauth/callback?code=TG-x&state=' + state)
      const propia = await a.call('GET', '/tus/v1/provider/payment-account', 'provider-token')
      const ajena = await a.call('GET', '/tus/v1/provider/payment-account', 'other-provider-token')
      out.vinculada = [vuelta.location, /reason=INVALID_STATE$/u.test(repetido.location), propia.json.status, ajena.json.status, intercambios[0], /fictitious-mp-access-token|TG-refresh|access_token|refreshToken/iu.test(propia.text)]
      const otraVez = await a.call('POST', CONNECT, 'provider-token', {})
      out.reconecta = [otraVez.status, (await a.call('GET', '/tus/v1/provider/payment-account', 'provider-token')).json.status]
      // The other provider unlinks nothing of this one; the owner does.
      const ajenoDesvincula = await a.call('POST', '/tus/v1/provider/payment-account/disconnect', 'other-provider-token', {})
      out.desvincular = [ajenoDesvincula.status, (await a.call('GET', '/tus/v1/provider/payment-account', 'provider-token')).json.status, (await a.call('POST', '/tus/v1/provider/payment-account/disconnect', 'provider-token', {})).json.status]
    } finally { a.server.close() }
    // ---- Payments not composed: unavailable, not "forbidden".
    const b = levantar(false, false)
    try { out.sinPagos = [await b.call('POST', CONNECT, 'provider-token', {}), await b.call('GET', '/tus/v1/provider/payment-account', 'provider-token')].map((x) => [x.status, x.code]) } finally { b.server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.propietario, [200, 'not_connected', true, 201, 'no-store', 'https://auth.mercadopago.com/authorization', 'https://api.tusservicios.shop/tus/v1/integrations/mercado-pago/oauth/callback', 'S256', true, true, 'code', 'app-id', false], 'the owner starts OAuth with PKCE and the exact redirect URI; identity not verified and no account linked do not block it')
  assert.equal(r.aliasEnEspanol, 201)
  assert.deepEqual(r.concurrentes, [[201, 201], true, 'not_connected'], 'two requests at once: two independent single-use states and still nothing linked')
  assert.deepEqual(r.sinSesion, [[401, 'UNAUTHORIZED'], [401, 'UNAUTHORIZED'], [401, 'UNAUTHORIZED'], [401, 'UNAUTHORIZED']], 'no session is "sign in", never a refusal of the policy')
  assert.deepEqual(r.otros, [[403, 'PROVIDER_REQUIRED'], [403, 'FORBIDDEN'], [403, 'FORBIDDEN'], [403, 'FORBIDDEN'], [403, 'FORBIDDEN'], [403, 'PROVIDER_REQUIRED']], 'a client with no provider, a session with no permission, and a provider naming the tenant of another (body or header)')
  assert.deepEqual(r.denegados, [['tus.payment_account.connect', 'spoofed_authority', 'other-tenant'], ['tus.payment_account.connect', 'spoofed_authority', 'other-tenant'], ['tus.payment_account.disconnect', 'spoofed_authority', 'other-tenant']], 'an attempt on the account of another provider is recorded')
  assert.deepEqual(r.vinculada, ['https://web.example.test/prestador/pagos?mercadoPago=connected', true, 'connected', 'not_connected', 'code,codeVerifier,redirectUri', false], 'the callback links that provider only; the state works once; the verifier goes to the exchange; no token leaves the API')
  assert.deepEqual(r.reconecta, [201, 'connected'], 'a linked provider can start the link again; nothing changes until Mercado Pago answers')
  assert.deepEqual(r.desvincular, [200, 'connected', 'revoked'], 'another provider unlinks only its own (nothing); the owner unlinks its account')
  assert.deepEqual(r.sinPagos, [[503, 'PAYMENTS_UNAVAILABLE'], [503, 'PAYMENTS_UNAVAILABLE']])
})

test('MP OAUTH autorización, código: the route asks for the session, its own tenant, the permission and a provider, and nothing of identity, readiness or earnings; the Web starts ONE attempt per action and says what each refusal means', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const router = read('apps/api/src/tus/http/router.ts')
  const guarda = /const cuentaDeCobroDe = async[\s\S]*?\n  \}\n/u.exec(router)[0]
  assert.doesNotMatch(guarda, /identidad|identity|readiness|habilitacion|guard\.|earnings|ganancias|mfa/iu, 'no gate of identity, readiness, earnings or MFA to link the own account')
  assert.deepEqual([...guarda.matchAll(/sendError\(response, (\d+), '(\w+)'/gu)].map((m) => m[1] + ' ' + m[2]), ['401 UNAUTHORIZED', '403 FORBIDDEN', '403 FORBIDDEN', '503 PAYMENTS_UNAVAILABLE', '403 PROVIDER_REQUIRED'])
  assert.equal([...router.matchAll(/await cuentaDeCobroDe\(request, response, /gu)].length, 3, 'status, connect and disconnect share the one guard')
  assert.match(router, /tenantId: context\.tenantId,\n\s+actorId: context\.subjectId,\n\s+correlationId: context\.correlationId,\n\s+\}\)\n\s+\)\n\s+\} catch \(error\) \{\n\s+sendServiceFinanceError/u, 'the tenant linked is the one of the session')
  const servicio = read('apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
  const iniciar = /async iniciarConexion\([\s\S]*?\n  \}\n/u.exec(servicio)[0]
  assert.match(iniciar, /code_challenge_method', 'S256'/u)
  assert.match(iniciar, /redirect_uri', config\.redirectUri/u)
  assert.doesNotMatch(iniciar, /identidadVerificada|console\.|logger\./u)
  const web = read('apps/web/src/features/provider/provider-payments.tsx')
  assert.match(web, /let conexionEnCurso: Promise<string \| null> \| null = null/u)
  assert.match(web, /if \(conexionEnCurso\) return conexionEnCurso\n/u, 'a second click, or the other panel, joins the attempt in course: one POST')
  assert.equal([...web.matchAll(/\.connectPaymentAccount\(/gu)].length, 1)
  assert.doesNotMatch(web, /useEffect\([^)]*startMercadoPagoConnection/u, 'never started by an effect')
  for (const codigo of ['UNAUTHORIZED', 'FORBIDDEN', 'PROVIDER_REQUIRED', 'PROVIDER_SUSPENDED', 'PAYMENTS_UNAVAILABLE']) assert.match(web, new RegExp(`\\n  ${codigo}: '`, 'u'), codigo)
  assert.match(web, /busy \? 'Conectando…'/u)
  assert.doesNotMatch(web, /error\.message|client_secret|access_token/u, 'no internal error text reaches the person')
})
