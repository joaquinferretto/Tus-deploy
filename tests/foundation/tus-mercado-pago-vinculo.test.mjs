import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// PAGOS-MP-VINCULADO-01 (owner's decision). To charge in TUS a provider needs ONLY its Mercado Pago
// account linked through OAuth: no identity verification of TUS's own (KYC/KYB), whoever owns that
// account (a person, a monotributista, a company). The link is by the ids TUS stores, never by a
// name. Mercado Pago is a stand-in here (the OAuth port): this proves the code, not a real link.
test('Mercado Pago vinculado: not linked a provider cannot charge; the official OAuth (single-use state, PKCE) links it with nothing else asked; a bad or reused callback links nothing; tokens are stored encrypted and never returned; reconnection, unlink and linking another account afterwards; every change is audited without secrets', () => {
  const r = runTypeScriptScenario(`
    const { AlmacenCuentasCobroEnMemoria, BovedaCredencialesAesGcm, ServicioCuentasCobro, vinculoMercadoPago } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
    const { AlmacenConfiguracionPagosEnMemoria, PoliticaCobroPersistida, ServicioConfiguracionPagos, leerEstadoOperativoPagos } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    let now = Date.parse('2026-10-09T10:00:00.000Z')
    const store = new AlmacenCuentasCobroEnMemoria()
    const boveda = new BovedaCredencialesAesGcm(Buffer.alloc(32, 7).toString('base64'))
    const cuentasMp = { 'code-juan': '111222333', 'code-empresa': '444555666', 'code-otra': '777888999' }
    let renovar = 'ok'
    const oauth = {
      intercambiarCodigo: async (input) => { const userId = cuentasMp[input.code]; if (!userId) throw Object.assign(new Error('rejected'), { code: 'PROVIDER_OAUTH_FAILED' }); return { accessToken: 'APP_USR-token-' + userId, refreshToken: 'TG-refresh-' + userId, publicKey: 'APP_USR-public', userId, scopes: ['offline_access', 'read', 'write'], liveMode: true, expiresInSeconds: 3600 } },
      renovarToken: async () => { if (renovar !== 'ok') throw new Error('refresh rejected'); return { accessToken: 'APP_USR-renovado', refreshToken: 'TG-renovado', publicKey: null, userId: '111222333', scopes: [], liveMode: true, expiresInSeconds: 3600 } },
    }
    const auditoria = []
    const config = { clientId: 'app-id', redirectUri: 'https://api.example.test/tus/v1/integrations/mercado-pago/oauth/callback', webBaseUrl: 'https://web.example.test' }
    const cuentas = new ServicioCuentasCobro(store, config, boveda, oauth, () => now, async (evento) => { auditoria.push(evento) })
    const juan = { tenantId: 'tenant-juan', actorId: 'cuenta-juan', correlationId: 'c-juan' }
    const empresa = { tenantId: 'tenant-empresa', actorId: 'cuenta-empresa', correlationId: 'c-empresa' }
    // The real policy, with what used to be the identity check answering "not verified".
    const listo = () => leerEstadoOperativoPagos({ TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'production', MERCADO_PAGO_CLIENT_ID: 'a', MERCADO_PAGO_CLIENT_SECRET: 'b', MERCADO_PAGO_WEBHOOK_SECRET: 'c', MERCADO_PAGO_OAUTH_REDIRECT_URI: 'https://api.example.test/cb', TUS_PAYMENT_CREDENTIALS_KEY: 'k', TUS_WEB_BASE_URL: 'https://web.example.test', MERCADO_PAGO_NOTIFICATION_URL: 'https://api.example.test/n' }, true)
    const pagos = new AlmacenConfiguracionPagosEnMemoria()
    const admin = new ServicioConfiguracionPagos(pagos, listo, () => now)
    await admin.registrarConfiguracion({ actorId: 'admin', correlationId: 'c' }, { paymentsEnabled: true, reason: 'x', expectedVersion: 0 })
    await admin.registrarPolitica({ actorId: 'admin', correlationId: 'c' }, { scope: 'global', rateBps: 1000, pspFeeBearer: 'provider', reason: 'x', expectedVersion: 0 })
    const politica = new PoliticaCobroPersistida(pagos, listo, (tenantId) => cuentas.cuentaConectada(tenantId), async () => false, async () => false, () => true)
    const cobra = async (quien, anticipado = true) => { const x = await politica.disponibilidad({ prestadorTenantId: quien.tenantId, prestadorId: 'p', categoria: null, anticipado }); return x.available ? x.mode : x.reason }
    const vinculo = async (quien) => vinculoMercadoPago((await cuentas.estadoCuenta(quien)).status)
    const estadoDe = (url) => new URL(url).searchParams.get('state')
    const vincular = async (quien, code) => { const inicio = await cuentas.iniciarConexion(quien); return cuentas.completarConexion({ code, state: estadoDe(inicio.authorizationUrl), correlationId: 'cb' }) }
    const out = {}

    // 1. Not linked: no charge. Whoever the provider is.
    out.sinVincular = [await vinculo(juan), await cobra(juan), await cobra(juan, false), await cobra(empresa)]
    // 2. The official OAuth: nothing else is asked of the provider.
    const inicio = await cuentas.iniciarConexion(juan)
    const url = new URL(inicio.authorizationUrl)
    out.autorizacion = [url.origin + url.pathname, url.searchParams.get('client_id'), url.searchParams.get('response_type'), url.searchParams.get('code_challenge_method'), url.searchParams.get('redirect_uri') === config.redirectUri, (url.searchParams.get('state') ?? '').length >= 20, /secret|token/iu.test(inicio.authorizationUrl)]
    // 3. Callbacks that link nothing: malformed, a state TUS never issued, no code, a code Mercado Pago refuses.
    const rechazo = async (input) => { const x = await cuentas.completarConexion({ correlationId: 'cb', ...input }); return [x.status, x.reason] }
    out.callbacksInvalidos = [
      await rechazo({ code: 'code-juan', state: 'corto' }),
      await rechazo({ code: 'code-juan', state: 'x'.repeat(43) }),
      await rechazo({ code: '', state: estadoDe(inicio.authorizationUrl) }),
      await rechazo({ code: 'code-inventado', state: estadoDe((await cuentas.iniciarConexion(juan)).authorizationUrl) }),
      await vinculo(juan), await cobra(juan),
    ]
    // 4. The right callback links it. The state is single-use.
    const ok = await cuentas.completarConexion({ code: 'code-juan', state: estadoDe(inicio.authorizationUrl), correlationId: 'cb' })
    out.vinculado = [ok.status, ok.redirectUrl, await vinculo(juan), await cobra(juan), await cobra(juan, false), (await rechazo({ code: 'code-juan', state: estadoDe(inicio.authorizationUrl) }))[1]]
    const fila = store.cuentas.get('tenant-juan')
    out.guardado = [fila.prestadorTenantId, fila.externalAccountId, fila.status, Boolean(fila.connectedAt), Boolean(fila.expiresAt), fila.actorId]
    // 5. Tokens: encrypted at rest, bound to the tenant, never in what the Web reads.
    const credencial = store.credenciales.get('tenant-juan')
    const paraLaWeb = JSON.stringify(await cuentas.estadoCuenta(juan))
    out.tokens = [/APP_USR|TG-refresh/u.test(JSON.stringify(credencial)), credencial.ciphertext.startsWith('v1.'), JSON.parse(boveda.descifrar(credencial.ciphertext, 'payment-account:tenant-juan')).accessToken, (() => { try { boveda.descifrar(credencial.ciphertext, 'payment-account:tenant-empresa'); return 'legible' } catch (e) { return e.code } })(), /APP_USR|TG-refresh|accessToken|refreshToken|ciphertext/u.test(paraLaWeb), /APP_USR|TG-refresh/u.test(JSON.stringify([...store.estados.values()]))]
    // 6. One Mercado Pago account, one provider (by its id): a second provider is refused.
    out.cuentaDeOtro = [(await vincular(empresa, 'code-juan')).reason, await vinculo(empresa)]
    // A company (its own Mercado Pago account) links exactly the same way.
    out.empresa = [(await vincular(empresa, 'code-empresa')).status, await vinculo(empresa), await cobra(empresa)]
    // 7. The authorization ran out and cannot be renewed: reconnection is required, and it works.
    now += 2 * 3600_000
    renovar = 'falla'
    const vencida = await cuentas.tokenVigente('tenant-juan').then(() => 'none', (e) => e.code)
    out.requiereReconexion = [vencida, await vinculo(juan), await cobra(juan)]
    out.reconectado = [(await vincular(juan, 'code-juan')).status, await vinculo(juan), await cobra(juan)]
    // 8. Unlink: nothing is charged any more, the tokens are gone; ANOTHER account links afterwards.
    await cuentas.desconectar(juan)
    out.desvinculado = [await vinculo(juan), await cobra(juan), store.credenciales.has('tenant-juan')]
    out.otraCuenta = [(await vincular(juan, 'code-otra')).status, await vinculo(juan), store.cuentas.get('tenant-juan').externalAccountId, await cobra(juan)]
    // The account that was freed can be linked by somebody else.
    await cuentas.desconectar(empresa)
    out.cuentaLiberada = (await vincular(empresa, 'code-juan')).status
    // 9. The audit.
    out.auditoria = auditoria.map((e) => [e.action, e.prestadorTenantId, e.actorId, e.previousStatus, e.status, e.externalAccount])
    out.auditoriaSinSecretos = /APP_USR|TG-|111222333|444555666|777888999/u.test(JSON.stringify(auditoria))
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.sinVincular, ['no_vinculado', 'PROVIDER_ACCOUNT_NOT_CONNECTED', 'PROVIDER_ACCOUNT_NOT_CONNECTED', 'PROVIDER_ACCOUNT_NOT_CONNECTED'], 'not linked: no charge, also with the account of TUS configured')
  assert.deepEqual(r.autorizacion, ['https://auth.mercadopago.com/authorization', 'app-id', 'code', 'S256', true, true, false], 'the official authorization page, with state and PKCE and no secret')
  assert.deepEqual(r.callbacksInvalidos, [['error', 'INVALID_STATE'], ['error', 'INVALID_STATE'], ['error', 'INVALID_STATE'], ['error', 'PROVIDER_OAUTH_FAILED'], 'no_vinculado', 'PROVIDER_ACCOUNT_NOT_CONNECTED'], 'a malformed, unknown or code-less callback, or a code Mercado Pago refuses, links nothing')
  assert.deepEqual(r.vinculado, ['connected', 'https://web.example.test/prestador/pagos?mercadoPago=connected', 'vinculado', 'plataforma', 'split', 'INVALID_STATE'], 'linked with nothing else asked (the identity check answered "not verified"); the state cannot be replayed')
  assert.deepEqual(r.guardado, ['tenant-juan', '111222333', 'connected', true, true, 'cuenta-juan'], 'the link: provider of TUS, collector of Mercado Pago, state, dates and who made it')
  assert.deepEqual(r.tokens, [false, true, 'APP_USR-token-111222333', 'CREDENTIAL_UNREADABLE', false, false], 'tokens encrypted at rest and bound to their tenant; nothing of them reaches the Web')
  assert.deepEqual(r.cuentaDeOtro, ['ACCOUNT_ALREADY_LINKED', 'no_vinculado'])
  assert.deepEqual(r.empresa, ['connected', 'vinculado', 'plataforma'], 'a company links and charges exactly the same way')
  assert.deepEqual(r.requiereReconexion, ['PROVIDER_ACCOUNT_NOT_CONNECTED', 'requiere_reconexion', 'PROVIDER_ACCOUNT_NOT_CONNECTED'])
  assert.deepEqual(r.reconectado, ['connected', 'vinculado', 'plataforma'])
  assert.deepEqual(r.desvinculado, ['no_vinculado', 'PROVIDER_ACCOUNT_NOT_CONNECTED', false])
  assert.deepEqual(r.otraCuenta, ['connected', 'vinculado', '777888999', 'plataforma'], 'after unlinking, another Mercado Pago account can be linked')
  assert.equal(r.cuentaLiberada, 'connected')
  assert.deepEqual(r.auditoria, [
    ['payment_account.connected', 'tenant-juan', 'cuenta-juan', 'not_connected', 'connected', '******333'],
    ['payment_account.connected', 'tenant-empresa', 'cuenta-empresa', 'not_connected', 'connected', '******666'],
    ['payment_account.reconnected', 'tenant-juan', 'cuenta-juan', 'expired', 'connected', '******333'],
    ['payment_account.disconnected', 'tenant-juan', 'cuenta-juan', 'connected', 'revoked', '******333'],
    ['payment_account.reconnected', 'tenant-juan', 'cuenta-juan', 'revoked', 'connected', '******999'],
    ['payment_account.disconnected', 'tenant-empresa', 'cuenta-empresa', 'connected', 'revoked', '******666'],
    ['payment_account.reconnected', 'tenant-empresa', 'cuenta-empresa', 'revoked', 'connected', '******333'],
  ])
  assert.equal(r.auditoriaSinSecretos, false, 'never a token nor a whole account id in the audit')
})

test('Mercado Pago vinculado, reglas y pantallas: nothing that decides a charge reads an identity verification, a holder type or a name; the routes take no Mercado Pago id from the browser; the provider sees one step and three states; the administration sees Nombre público, Cuenta and Mercado Pago', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const politica = read('apps/api/src/tus/finance/servicios/configuracion.ts')
  const gate = politica.slice(politica.indexOf('async disponibilidad(input'), politica.indexOf('async listoParaLanzamientoPublico'))
  assert.match(gate, /const vinculada = await this\.cuentaConectada\(input\.prestadorTenantId\)\n    if \(!vinculada\) return \{ available: false, reason: 'PROVIDER_ACCOUNT_NOT_CONNECTED' \}/u)
  assert.doesNotMatch(gate, /identidad|kyc|kyb|nombre|holder|titular/iu, 'no identity, holder type or name decides a charge')
  const cuentas = read('apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
  assert.doesNotMatch(cuentas, /identidadVerificada|PROVIDER_IDENTITY_NOT_VERIFIED|nombrePublico|displayName/u)
  assert.doesNotMatch(read('apps/api/src/tus/finance/servicios/ganancias.ts'), /this\.identidadVerificada|'IDENTITY_NOT_VERIFIED'|PROVIDER_IDENTITY_NOT_VERIFIED/u, 'a payout asks for the linked account, not for an identity verification')
  assert.doesNotMatch(read('apps/api/src/tus/finance/servicios/composicion-pagos.ts'), /identidadVerificada/u)
  // The routes: the provider is the session; the callback has only Mercado Pago's code and state.
  const router = read('apps/api/src/tus/http/router.ts')
  const conectar = /'\/tus\/v1\/prestador\/cuenta-cobro\/mercado-pago\/conectar',[\s\S]*?\n  \)/u.exec(router)[0]
  assert.match(conectar, /iniciarConexion\(\{\s*tenantId: context\.tenantId,\s*actorId: context\.subjectId,\s*correlationId: context\.correlationId,\s*\}\)/u)
  assert.doesNotMatch(conectar, /request\.body\[|externalAccountId|user_id/u, 'no Mercado Pago id is taken from the browser')
  const callback = /'\/tus\/v1\/integrations\/mercado-pago\/oauth\/callback'[\s\S]*?response\.redirect\(303, result\.redirectUrl\)/u.exec(router)[0]
  assert.match(callback, /code: readQueryString\(request\.query\['code'\]\),\s*state: readQueryString\(request\.query\['state'\]\),/u)
  assert.doesNotMatch(callback, /user_id|tenantId|accessToken/u)
  // The provider's panel.
  const panel = read('apps/web/src/features/provider/provider-payments.tsx')
  assert.match(panel, /account\.status === 'not_connected' \? 'Vincular Mercado Pago' : 'Volver a vincular Mercado Pago'/u)
  assert.match(panel, />\s*Desvincular\s*</u)
  assert.doesNotMatch(panel, /externalAccountId|<input|accessToken|refreshToken|clientSecret|identidad/u, 'no token, no technical id and nothing to copy by hand')
  assert.match(read('apps/web/src/components/prestador/cuenta-cobro.tsx'), /connected: 'Mercado Pago vinculado'/u)
  // The administration.
  const lista = read('apps/web/src/components/admin/admin-prestadores-lista.tsx')
  assert.match(lista, /<th>Nombre público<\/th><th>Cuenta<\/th>/u)
  assert.match(lista, /<th>Mercado Pago<\/th>/u)
  assert.match(lista, /data-mercado-pago=\{vinculoMercadoPago\(item\.mercadoPago\)\.estado\}/u)
  const adminApi = read('apps/web/src/lib/tus-admin-api.ts')
  for (const texto of ["'Vinculado'", "'Requiere reconexión'", "'No vinculado'", 'Falta vincular Mercado Pago']) assert.ok(adminApi.includes(texto), texto)
  assert.doesNotMatch(adminApi, /Falta identidad|Falta KYC|Falta KYB/u)
})
