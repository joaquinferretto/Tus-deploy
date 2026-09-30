import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// HTTP surface of the phone identity (auth + admin) and the Web flows around it.
const read = (file) => readFileSync(join(root, file), 'utf8')

const HTTP = `
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
  const { createAuthRouter } = await import('./apps/api/src/auth-security/http/auth-router.ts')
  const { AlmacenTelefonosEnMemoria } = await import('./apps/api/src/auth-security/phone/almacenes.ts')
  const { crearServicioTelefono } = await import('./apps/api/src/auth-security/phone/composicion.ts')
  const { crearRouterTelefono } = await import('./apps/api/src/auth-security/phone/http.ts')
  const { crearRouterAdmin } = await import('./apps/api/src/tus/admin/http.ts')
  const { CuentasAdminEnMemoria } = await import('./apps/api/src/tus/admin/fuentes.ts')
  const idStore = new InMemoryIdentityStore()
  const auth = { ...createAuthService({ store: idStore }), store: idStore }
  const almacenTel = new AlmacenTelefonosEnMemoria(idStore)
  const tel = crearServicioTelefono({ auth, telefonos: almacenTel, env: { TUS_WHATSAPP_PUBLIC_NUMBER: '5493794000000' } })
  const sessions = new DurableIdentitySessionResolver(idStore)
  const adminCtx = { subjectId: 'admin-1', tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin', 'tus:identity:admin'], correlationId: 'c' }
  const adminSessions = { resolve: async (token) => token === 'admin' ? adminCtx : token === 'client' ? { ...adminCtx, subjectId: 'x', permissions: ['tus:marketplace:write'] } : null }
  const directorio = { tenantsConPerfil: async () => [], perfilDeTenantAdmin: async () => null }
  const app = express(); app.set('trust proxy', false); app.use(express.json())
  app.use(createAuthRouter({ service: auth.service, sessions, phones: tel }))
  app.use(crearRouterTelefono({ servicio: tel, sessions, auth: auth.service }))
  app.use(crearRouterAdmin({ sessions: adminSessions, directorio, solicitudes: {}, cuentas: new CuentasAdminEnMemoria(idStore), adminEmails: () => [], leerUsuario: (id) => auth.service.getAccountAsAdmin(id), actualizarUsuario: (input) => auth.service.updateAccountAsAdmin(input), telefonoAdmin: tel }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const call = async (method, path, body, token) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method, headers: { 'content-type': 'application/json', 'x-correlation-id': 'c', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null, text }
  }
  const PASSWORD = 'una frase larga y segura 2026'
`

test('PHONE HTTP auth: public config, sign-up with phone (same shape for a registered email), invalid phone, session-only endpoints, recovery, pending restart', () => {
  const r = runTypeScriptScenario(`${HTTP}
    try {
      const out = {}
      out.config = (await call('GET', '/auth/phone/config')).body
      const alta = await call('POST', '/auth/register', { email: 'nueva@example.com', password: PASSWORD, displayName: 'Nueva Persona', phone: '379 412-3456' })
      const repetida = await call('POST', '/auth/register', { email: 'nueva@example.com', password: PASSWORD, displayName: 'Otra', phone: '379 412-3457' })
      out.alta = [alta.status, alta.body.status, Object.keys(alta.body.phoneVerification).sort()]
      out.mismaForma = JSON.stringify(Object.keys(repetida.body.phoneVerification).sort()) === JSON.stringify(Object.keys(alta.body.phoneVerification).sort()) && repetida.status === alta.status
      out.url = alta.body.phoneVerification.whatsappUrl.replace(/[A-Z0-9]{8}$/u, 'CODE')
      out.sinCodigoEnUrl = !alta.body.phoneVerification.whatsappUrl.includes('+')
      out.invalido = [(await call('POST', '/auth/register', { email: 'x@example.com', password: PASSWORD, displayName: 'X', phone: 'abc' })).status, idStore.accounts.size]
      out.sinTelefono = (await call('POST', '/auth/register', { email: 'solo-email@example.com', password: PASSWORD, displayName: 'Solo Email' })).body
      out.estadoPublico = (await call('POST', '/auth/phone/challenges/' + alta.body.phoneVerification.challengeId + '/status', { pollSecret: alta.body.phoneVerification.pollSecret })).body
      out.sinSesion = [(await call('GET', '/auth/phone')).status, (await call('POST', '/auth/phone/challenges', { phone: '3794123456' })).status]
      out.recuperar = [(await call('POST', '/auth/recovery/whatsapp', { phone: '379 499-9999' })).status, (await call('POST', '/auth/recovery/whatsapp', { phone: '1' })).status]
      out.pendienteMal = (await call('POST', '/auth/phone/pending', { identifier: 'nueva@example.com', password: 'mala', phone: '3794123456' })).status
      out.pendienteOk = (await call('POST', '/auth/phone/pending', { identifier: 'nueva@example.com', password: PASSWORD, phone: '3794123456' })).status
      console.log(JSON.stringify(out))
    } finally { server.close() }
  `)
  assert.deepEqual(r.config, { whatsappNumber: '+5493794000000' })
  assert.deepEqual(r.alta, [201, 'pending_verification', ['challengeId', 'code', 'expiresAt', 'message', 'phoneMasked', 'pollSecret', 'purpose', 'whatsappUrl']])
  assert.equal(r.mismaForma, true, 'a registered email is indistinguishable')
  assert.equal(r.url, 'https://wa.me/5493794000000?text=VERIFICAR%20TUS%20CODE')
  assert.equal(r.sinCodigoEnUrl, true)
  assert.deepEqual(r.invalido, [422, 1], 'an invalid phone creates no account')
  assert.deepEqual(r.sinTelefono, { status: 'pending_verification' }, 'email-only sign-up keeps working')
  assert.deepEqual(r.estadoPublico, { status: 'pending', purpose: null, phoneMasked: null })
  assert.deepEqual(r.sinSesion, [401, 401])
  assert.deepEqual(r.recuperar, [201, 422])
  assert.equal(r.pendienteMal, 401)
  assert.equal(r.pendienteOk, 201)
})

test('PHONE HTTP admin: masked phone state, filters, pending-only edition, free a number, never "verified" from the panel', () => {
  const r = runTypeScriptScenario(`${HTTP}
    try {
      const out = {}
      const a = await auth.service.registerAccount({ email: 'a@example.com', password: PASSWORD, displayName: 'Ana Admin' })
      const b = await auth.service.registerAccount({ email: 'b@example.com', password: PASSWORD, displayName: 'Beto' })
      await auth.service.registerAccount({ email: 'c@example.com', password: PASSWORD, displayName: 'Carla' })
      await almacenTel.fijarVerificado(a.created.account.id, '+5493794111111', Date.parse('2026-09-30T10:00:00Z'))
      await tel.fijarPendientePorAdmin('admin-1', b.created.account.id, '379 422-2222')
      const lista = async (telefono) => (await call('GET', '/tus/v1/admin/usuarios?telefono=' + telefono, null, 'admin')).body.items.map((i) => i.email)
      out.filtros = { verificado: await lista('verificado'), pendiente: await lista('pendiente'), sin: await lista('sin') }
      const detalle = await call('GET', '/tus/v1/admin/usuarios/' + a.created.account.id, null, 'admin')
      out.detalle = detalle.body.telefono
      out.sinNumeroCompleto = !detalle.text.includes('5493794111111')
      out.pendiente = (await call('POST', '/tus/v1/admin/usuarios/' + a.created.account.id + '/telefono', { accion: 'pendiente', telefono: '379 433-3333' }, 'admin')).status
      out.despuesPendiente = (await almacenTel.estado(a.created.account.id))
      out.malo = (await call('POST', '/tus/v1/admin/usuarios/' + a.created.account.id + '/telefono', { accion: 'pendiente', telefono: 'xx' }, 'admin')).body.error
      out.verificar = (await call('POST', '/tus/v1/admin/usuarios/' + a.created.account.id + '/telefono', { accion: 'verificar', telefono: '379 433-3333' }, 'admin')).status
      out.patchVerificar = (await call('PATCH', '/tus/v1/admin/usuarios/' + a.created.account.id, { phoneVerifiedAt: 1 }, 'admin')).status
      out.quitar = (await call('POST', '/tus/v1/admin/usuarios/' + a.created.account.id + '/telefono', { accion: 'quitar' }, 'admin')).status
      out.despuesQuitar = (await almacenTel.estado(a.created.account.id)).phoneNumber
      out.cliente = (await call('POST', '/tus/v1/admin/usuarios/' + a.created.account.id + '/telefono', { accion: 'quitar' }, 'client')).status
      console.log(JSON.stringify(out))
    } finally { server.close() }
  `)
  assert.deepEqual(r.filtros, { verificado: ['a@example.com'], pendiente: ['b@example.com'], sin: ['c@example.com'] })
  assert.deepEqual(r.detalle, { verificado: true, numero: '+549379•••1111', verificadoEn: '2026-09-30T10:00:00.000Z', pendiente: null })
  assert.equal(r.sinNumeroCompleto, true)
  assert.equal(r.pendiente, 200)
  assert.deepEqual([r.despuesPendiente.phoneNumber, r.despuesPendiente.phonePending], ['+5493794111111', '+5493794333333'], 'a pending number never replaces the verified identity')
  assert.equal(r.malo.code, 'INVALID_PHONE')
  assert.equal(r.verificar, 422)
  assert.equal(r.patchVerificar, 422)
  assert.equal(r.quitar, 200)
  assert.equal(r.despuesQuitar, null)
  assert.equal(r.cliente, 403)
})

test('PHONE Web: phone-first sign-up, one verification component (WhatsApp button, aria-live, bounded polling, new code), phone sign-in, WhatsApp recovery, profile and admin', () => {
  const componente = read('apps/web/src/features/auth/whatsapp-verification.tsx')
  const registro = read('apps/web/src/features/auth/register-form.tsx')
  const login = read('apps/web/src/features/auth/login-form.tsx')
  const flujos = read('apps/web/src/features/auth/phone-flows.tsx')
  const perfil = read('apps/web/src/features/profile/phone-section.tsx')
  const css = read('apps/web/src/features/auth/auth.module.css')
  // Main path: one button that opens WhatsApp with the message written; no six-digit inputs.
  assert.match(componente, /Verificar con WhatsApp/u)
  assert.match(componente, /href=\{actual\.whatsappUrl\}/u)
  assert.match(componente, /aria-live="polite"/u)
  assert.match(componente, /Esperando verificación…/u)
  assert.match(componente, /✓ Número verificado/u)
  assert.match(componente, /También te enviamos la confirmación por WhatsApp\./u)
  assert.match(componente, /Generar un código nuevo/u)
  // Bounded wait: the polling stops at the code expiry (never an endless loop).
  assert.match(componente, /Date\.parse\(actual\.expiresAt\)/u)
  assert.match(componente, /setFase\('vencido'\)/u)
  assert.doesNotMatch(componente, /maxLength=\{1\}|inputMode="numeric"/u)
  // The official number is never hardcoded in the Web: it comes from the API (wa.me link).
  for (const file of [componente, registro, flujos, perfil]) assert.doesNotMatch(file, /wa\.me\/\d|549379400/u)
  assert.match(registro, /Celular con WhatsApp/u)
  assert.match(registro, /<VerificacionWhatsapp/u)
  assert.match(registro, /Prefiero verificar por email/u)
  assert.match(login, /Correo o celular/u)
  assert.match(login, /\/verificar-telefono/u)
  assert.match(flujos, /Recuperar por WhatsApp/u)
  assert.match(flujos, /restablecer-contrasena\?token=/u)
  assert.match(perfil, /Verificar nuevo número con WhatsApp/u)
  assert.match(css, /\.secondaryButton[\s\S]*?min-height: 44px/u)
  assert.match(css, /focus-visible/u)
  const admin = read('apps/web/src/components/admin/admin-usuarios.tsx')
  assert.match(admin, /Teléfono verificado/u)
  assert.match(admin, /Sin teléfono/u)
  const detalle = read('apps/web/src/components/admin/admin-usuario-detalle.tsx')
  assert.match(detalle, /Cargar como pendiente/u)
  assert.doesNotMatch(detalle, /Marcar (teléfono|número) como verificado/u)
})
