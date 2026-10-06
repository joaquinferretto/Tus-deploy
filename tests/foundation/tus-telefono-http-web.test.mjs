import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
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
  const { AlmacenAsistenteEnMemoria } = await import('./apps/api/src/tus/asistente/memoria.ts')
  const waStore = new AlmacenAsistenteEnMemoria()
  const almacenTel = new AlmacenTelefonosEnMemoria(idStore, waStore.enlaceTelefonos())
  const tel = crearServicioTelefono({ auth, telefonos: almacenTel, env: { TUS_WHATSAPP_PUBLIC_NUMBER: '5493794000000' } })
  const sessions = new DurableIdentitySessionResolver(idStore)
  const adminCtx = { subjectId: 'admin-1', tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin', 'tus:identity:admin'], correlationId: 'c' }
  const adminSessions = { resolve: async (token) => token === 'admin' ? adminCtx : token === 'client' ? { ...adminCtx, subjectId: 'x', permissions: ['tus:marketplace:write'] } : token === 'provider' ? { ...adminCtx, subjectId: 'y', roles: ['owner'], permissions: ['tus:marketplace:write', 'tus:providers:write'] } : null }
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

test('PHONE HTTP whatsapp-link: needs a session, only for the verified number of the session account, creates a challenge, ignores the body, is limited, and the WhatsApp message links it', () => {
  const r = runTypeScriptScenario(`${HTTP}
    try {
      const out = {}
      const registrar = async (email, phone) => {
        const alta = await auth.service.registerAccount({ email, password: PASSWORD, displayName: 'Persona ' + email })
        const id = alta.created.account.id
        idStore.accounts.get(id).emailVerifiedAt = Date.now()
        if (phone) await almacenTel.fijarVerificado(id, phone, Date.now())
        const sesion = await auth.service.signIn({ email, password: PASSWORD })
        return { id, token: sesion.ok ? sesion.session.accessToken : null, signIn: sesion.ok }
      }
      const a = await registrar('enlace-a@example.com', '+5493794123456')
      const b = await registrar('enlace-b@example.com', null)
      out.signIn = [a.signIn, b.signIn]
      // 1. No session / bad token.
      out.sinSesion = [(await call('POST', '/auth/phone/whatsapp-link')).status, (await call('POST', '/auth/phone/whatsapp-link', {}, 'token-falso')).status]
      // 2. Phone not verified.
      const sinTel = await call('POST', '/auth/phone/whatsapp-link', {}, b.token)
      out.sinTelefono = [sinTel.status, sinTel.body.error.code]
      // 3. Verified phone: challenge for ITS number; the body is ignored (cannot pick another number or account).
      out.estadoAntes = (await call('GET', '/auth/phone', null, a.token)).body.phone.whatsappLinked
      const ok = await call('POST', '/auth/phone/whatsapp-link', { phone: '3794999999', accountId: b.id, purpose: 'recuperar_contrasena', waId: '5493794999999' }, a.token)
      const desafio = ok.body.challenge
      out.ok = [ok.status, Object.keys(desafio).sort(), desafio.purpose, desafio.phoneMasked, desafio.whatsappUrl.startsWith('https://wa.me/5493794000000?text=VERIFICAR%20TUS%20') && desafio.whatsappUrl.length === 'https://wa.me/5493794000000?text=VERIFICAR%20TUS%20'.length + 8, desafio.pollSecret === undefined]
      const fila = await almacenTel.desafio(desafio.challengeId)
      out.fila = [fila.accountId === a.id, fila.phone, fila.purpose, fila.pollSecretHash]
      out.pendienteIntacto = (await almacenTel.estado(a.id)).phonePending
      // Another account's challenge is not readable.
      out.ajeno = (await call('GET', '/auth/phone/challenges/' + desafio.challengeId, null, b.token)).status
      out.propio = (await call('GET', '/auth/phone/challenges/' + desafio.challengeId, null, a.token)).body.status
      // 4. The signed WhatsApp message from THAT number links it.
      out.otroNumero = (await tel.verificarDesdeWhatsapp({ waId: '5493794999999', texto: desafio.message, wamid: 'wamid.otro' })).resultado
      const hecho = await tel.verificarDesdeWhatsapp({ waId: '5493794123456', texto: desafio.message, wamid: 'wamid.ok' })
      out.hecho = hecho.resultado
      out.despues = [(await call('GET', '/auth/phone', null, a.token)).body.phone.whatsappLinked, (await waStore.repositorios().contactos.buscarPorWaId('5493794123456')).linkedAccountId === a.id]
      // 5. Already linked: 409, no new challenge.
      const otra = await call('POST', '/auth/phone/whatsapp-link', {}, a.token)
      out.yaVinculado = [otra.status, otra.body.error.code]
      // 6. Logout-equivalent: a revoked session cannot create challenges.
      await auth.service.signOut({ accessToken: a.token })
      out.trasLogout = [(await call('POST', '/auth/phone/whatsapp-link', {}, a.token)).status, (await call('GET', '/auth/phone', null, a.token)).status]
      // 7. Rate limit (5 / 15 min per account).
      const c = await registrar('enlace-c@example.com', '+5493794222222')
      const codigos = []
      for (let i = 0; i < 7; i += 1) codigos.push((await call('POST', '/auth/phone/whatsapp-link', {}, c.token)).status)
      out.limite = codigos
      console.log(JSON.stringify(out))
    } finally { server.close() }
  `)
  assert.deepEqual(r.signIn, [true, true])
  assert.deepEqual(r.sinSesion, [401, 401])
  assert.deepEqual(r.sinTelefono, [409, 'PHONE_NOT_VERIFIED'])
  assert.equal(r.estadoAntes, false)
  assert.deepEqual(r.ok, [201, ['challengeId', 'code', 'expiresAt', 'message', 'phoneMasked', 'purpose', 'whatsappUrl'], 'verificar_telefono', '+549379•••3456', true, true])
  assert.deepEqual(r.fila, [true, '+5493794123456', 'verificar_telefono', null], 'the number and the account come from the session, never from the body; no poll secret')
  assert.equal(r.pendienteIntacto, null)
  assert.equal(r.ajeno, 404)
  assert.equal(r.propio, 'pending')
  assert.equal(r.otroNumero, 'invalido', 'a message from another number links nothing')
  assert.equal(r.hecho, 'vinculado')
  assert.deepEqual(r.despues, [true, true])
  assert.deepEqual(r.yaVinculado, [409, 'ALREADY_LINKED'])
  assert.deepEqual(r.trasLogout, [401, 401], 'a signed-out session cannot create challenges')
  assert.deepEqual(r.limite.slice(0, 5), [201, 201, 201, 201, 201])
  assert.equal(r.limite[5], 429)
})

test('PHONE HTTP admin: masked phone state, filters, pending edition, free a number; the verification state is never written from a body', () => {
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
  assert.deepEqual(r.detalle, { verificado: true, numero: '+549379•••1111', verificadoEn: '2026-09-30T10:00:00.000Z', pendiente: null, whatsappVinculado: false })
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

test('PHONE HTTP admin verification: an authorized administrator marks the PENDING phone as verified and removes that verification — explicit operations, actor from the session, idempotent, audited, and removing it revokes what depended on it (challenges, the WhatsApp of THAT number) and nothing else', () => {
  const r = runTypeScriptScenario(`${HTTP}
    try {
      const out = {}
      const nueva = async (email) => (await auth.service.registerAccount({ email, password: PASSWORD, displayName: 'Persona ' + email })).created.account.id
      const accion = (id, nombre, token = 'admin', extra = {}) => call('POST', '/tus/v1/admin/usuarios/' + id + '/telefono', { accion: nombre, ...extra }, token)
      const estado = async (id) => { const e = await almacenTel.estado(id); return [e.phoneNumber, e.phonePending, e.phoneVerifiedAt] }
      const eventos = () => auth.audit.events.filter((e) => e.kind === 'phone.verified_by_admin' || e.kind === 'phone.unverified_by_admin')
      const vincular = async (id, waId) => { const desafio = await tel.iniciarVinculo(id); await tel.verificarDesdeWhatsapp({ waId, texto: desafio.message, wamid: 'wamid-' + waId }); return almacenTel.waIdVinculado(id) }

      // ---- permissions: the actor is the session; a body never grants anything
      const P = await nueva('p@example.com')
      await tel.fijarPendientePorAdmin('admin-1', P, '379 455-0001')
      out.permisos = [(await accion(P, 'verificar', null)).status, (await accion(P, 'verificar', 'client')).status, (await accion(P, 'verificar', 'provider')).status, (await accion(P, 'desverificar', 'client')).status, (await accion(P, 'desverificar', null)).status]
      out.cuerpo = [
        (await accion(P, 'verificar', 'admin', { phoneVerifiedAt: '2020-01-01T00:00:00Z' })).status,
        (await accion(P, 'verificar', 'admin', { adminId: 'otro-admin' })).status,
        (await accion(P, 'verificar', 'client', { role: 'admin', permissions: ['tus:identity:admin'] })).status,
        (await call('PATCH', '/tus/v1/admin/usuarios/' + P, { phoneVerifiedAt: 1 }, 'admin')).status,
        (await call('PATCH', '/tus/v1/admin/usuarios/' + P, { phoneVerified: true }, 'admin')).status,
      ]
      out.intacto = await estado(P)
      out.sinEventos = eventos().length

      // ---- A. verify the pending phone
      const antes = Date.now()
      const verificada = await accion(P, 'verificar')
      out.verificar = [verificada.status, verificada.body]
      const tras = await almacenTel.estado(P)
      out.estadoVerificado = [tras.phoneNumber, tras.phonePending, tras.phoneVerifiedAt >= antes && tras.phoneVerifiedAt <= Date.now()]
      out.noVincula = await almacenTel.waIdVinculado(P)
      out.detalle = (await call('GET', '/tus/v1/admin/usuarios/' + P, null, 'admin')).body.telefono
      out.cuentaIntacta = await auth.service.getAccountAsAdmin(P).then((c) => [c.email, c.displayName, c.status])
      // ---- F. again: same state, no second event
      const repetida = await accion(P, 'verificar')
      out.repetir = [repetida.status, repetida.body.telefono.verificado, (await almacenTel.estado(P)).phoneVerifiedAt === tras.phoneVerifiedAt, eventos().length]

      // ---- E. no phone, unknown account, a number that is already somebody else's
      const S = await nueva('s@example.com')
      const sinTelefono = await accion(S, 'verificar')
      out.sinTelefono = [sinTelefono.status, sinTelefono.body.error.code, await estado(S)]
      out.inexistente = [(await accion('cuenta-que-no-existe', 'verificar')).status, (await accion('cuenta-que-no-existe', 'desverificar')).status]
      const C = await nueva('c@example.com')
      await almacenTel.fijarPendiente(C, '+5493794550001')
      const conflicto = await accion(C, 'verificar')
      out.conflicto = [conflicto.status, conflicto.body.error.code, conflicto.text.includes('p@example.com') || conflicto.text.includes(P), (await estado(C))[0]]

      // ---- the WhatsApp of P and of another account are really linked (by their own challenges)
      const O = await nueva('o@example.com')
      await almacenTel.fijarVerificado(O, '+5493794550002', Date.now())
      out.vinculos = [await vincular(P, '5493794550001'), await vincular(O, '5493794550002')]
      out.numeroAntes = await tel.estadoNumero('5493794550001')
      // A challenge still waiting (P is changing to another number).
      const cambio = await tel.iniciar(P, { telefono: '379 455-0009' })
      out.desafioVivo = [cambio.ok, almacenTel.desafios.get(cambio.challengeId).invalidatedAt]

      // ---- G/I/J/K. remove the verification
      const quitada = await accion(P, 'desverificar')
      out.quitar = [quitada.status, quitada.body]
      out.estadoQuitado = await estado(P)
      out.desafioInvalidado = [almacenTel.desafios.get(cambio.challengeId).invalidatedAt !== null, almacenTel.desafios.get(cambio.challengeId).invalidationReason]
      await tel.verificarDesdeWhatsapp({ waId: '5493794550009', texto: cambio.message, wamid: 'wamid-tarde' })
      out.codigoViejoNoVerifica = (await estado(P))[0]
      out.vinculosDespues = [await almacenTel.waIdVinculado(P), await almacenTel.waIdVinculado(O)]
      out.otraIntacta = await estado(O).then((e) => [e[0], e[2] !== null])
      out.numeroDespues = await tel.estadoNumero('5493794550001')
      out.propio = await tel.estadoCuenta(P)
      out.sesion = (await auth.service.getAccountAsAdmin(P)).status
      // ---- H. again: same state, no second event
      const repetidaQuitar = await accion(P, 'desverificar')
      out.repetirQuitar = [repetidaQuitar.status, repetidaQuitar.body.telefono.verificado, eventos().length]

      // ---- the plain case: no other number waiting — the SAME number stays, as pending
      const Q = await nueva('q@example.com')
      await almacenTel.fijarVerificado(Q, '+5493794550003', Date.now())
      const simple = await accion(Q, 'desverificar')
      out.simple = [simple.body.telefono, await estado(Q)]
      const deNuevo = await accion(Q, 'verificar')
      out.idaYVuelta = [deNuevo.body.telefono.verificado, deNuevo.body.telefono.numero, (await estado(Q))[0]]

      // ---- M/N. audit: who, on whom, what changed; masked numbers only
      out.auditoria = eventos().map((e) => [e.kind, e.actorId, e.metadata.target === P ? 'P' : e.metadata.target === Q ? 'Q' : '?', e.metadata.before, e.metadata.after, e.metadata.phone, typeof e.correlationId === 'string' && e.correlationId.length > 8, e.outcome])
      out.revocacion = eventos().find((e) => e.kind === 'phone.unverified_by_admin').metadata
      out.sinNumerosCompletos = !JSON.stringify(eventos()).includes('3794550') && ![verificada.text, quitada.text, simple.text].some((texto) => texto.includes('3794550') || texto.includes('accountId') || texto.includes('tenantId'))
      console.log(JSON.stringify(out))
    } finally { server.close() }
  `)
  assert.deepEqual(r.permisos, [401, 403, 403, 403, 401], 'no session: 401; a client or a provider: 403')
  assert.deepEqual(r.cuerpo, [422, 422, 403, 422, 422], 'the state is never written from a body, here or in the generic account update; a role in the body grants nothing')
  assert.deepEqual(r.intacto, [null, '+5493794550001', null], 'nothing changed by any of those requests')
  assert.equal(r.sinEventos, 0)

  assert.deepEqual(r.verificar, [200, { done: true, telefono: { verificado: true, numero: '+549379•••0001', verificadoEn: r.verificar[1].telefono.verificadoEn, pendiente: null, whatsappVinculado: false } }])
  assert.match(r.verificar[1].telefono.verificadoEn, /^\d{4}-\d{2}-\d{2}T/u)
  assert.deepEqual(r.estadoVerificado, ['+5493794550001', null, true], 'the canonical field: the pending number becomes the verified identity phone, with the clock of the backend')
  assert.equal(r.noVincula, null, 'verifying is not linking: WhatsApp stays unlinked')
  assert.deepEqual(r.detalle, r.verificar[1].telefono, 'the sheet reads the same state')
  assert.deepEqual(r.cuentaIntacta, ['p@example.com', 'Persona p@example.com', 'active'], 'email, name and status untouched')
  assert.deepEqual(r.repetir, [200, true, true, 1], 'idempotent: the same date, one event')

  assert.deepEqual(r.sinTelefono, [422, 'NO_PHONE', [null, null, null]], 'an account without a phone cannot be marked as verified')
  assert.deepEqual(r.inexistente, [404, 404])
  assert.deepEqual(r.conflicto, [409, 'PHONE_IN_USE', false, null], 'a number that is the verified phone of another account: a safe conflict that names nobody')

  assert.deepEqual(r.vinculos, ['5493794550001', '5493794550002'])
  assert.deepEqual(r.desafioVivo, [true, null])
  assert.deepEqual(r.quitar, [200, { done: true, telefono: { verificado: false, numero: null, verificadoEn: null, pendiente: '+549379•••0009', whatsappVinculado: false } }], 'the answer is the updated state')
  assert.deepEqual(r.estadoQuitado, [null, '+5493794550009', null], 'phoneVerifiedAt is null; the number that was already waiting stays as the pending one')
  assert.deepEqual(r.desafioInvalidado, [true, 'reemplazado'], 'the challenge that was waiting is cancelled')
  assert.equal(r.codigoViejoNoVerifica, null, 'its old code verifies nothing afterwards')
  assert.deepEqual(r.vinculosDespues, [null, '5493794550002'], 'the WhatsApp of that number is unlinked from that account; the other account keeps its own')
  assert.deepEqual(r.otraIntacta, ['+5493794550002', true])
  assert.notDeepEqual(r.numeroDespues, r.numeroAntes, 'the assistant reads the new state at once')
  assert.deepEqual([r.propio.verified, r.propio.whatsappLinked], [false, false], 'the owner sees it as not verified and not linked')
  assert.equal(r.sesion, 'active', 'the account and its Web sessions are untouched')
  assert.deepEqual(r.repetirQuitar, [200, false, 2], 'idempotent: still pending, no second event')

  assert.deepEqual(r.simple, [{ verificado: false, numero: null, verificadoEn: null, pendiente: '+549379•••0003', whatsappVinculado: false }, [null, '+5493794550003', null]], 'the number itself is kept: it goes back to pending')
  assert.deepEqual(r.idaYVuelta, [true, '+549379•••0003', '+5493794550003'], 'pending -> verified -> pending -> verified')

  assert.deepEqual(r.auditoria, [
    ['phone.verified_by_admin', 'admin-1', 'P', 'pending', 'verified', '+549379•••0001', true, 'success'],
    ['phone.unverified_by_admin', 'admin-1', 'P', 'verified', 'pending', '+549379•••0001', true, 'success'],
    ['phone.unverified_by_admin', 'admin-1', 'Q', 'verified', 'pending', '+549379•••0003', true, 'success'],
    ['phone.verified_by_admin', 'admin-1', 'Q', 'pending', 'verified', '+549379•••0003', true, 'success'],
  ], 'the administrator of the SESSION, the target, the state before and after')
  assert.deepEqual([r.revocacion.challengesInvalidated, r.revocacion.whatsappUnlinked], [1, 1], 'what the revocation took with it is recorded')
  assert.equal(r.sinNumerosCompletos, true, 'no full number, account id or tenant id in the audit or in the answers')

  // The panel: one action at a time, the administrative dialog (never the browser's), no state sent.
  const ficha = read('apps/web/src/components/admin/admin-usuario-detalle.tsx')
  assert.match(ficha, /titulo: '¿Marcar este teléfono como verificado\?'[\s\S]{0,260}confirmar: 'Verificar teléfono'/u)
  assert.match(ficha, /titulo: '¿Quitar la verificación de este teléfono\?'[\s\S]{0,420}confirmar: 'Quitar verificación'/u)
  // One state, and only the actions of that state: verify (pending), remove the verification
  // (verified, not linked), unlink (linked). Never two contradictory buttons at once.
  const rama = (desde, hasta) => ficha.slice(ficha.indexOf(desde), ficha.indexOf(hasta))
  assert.ok(ficha.includes("const estado = tel.verificado ? (tel.whatsappVinculado ? 'vinculado' : 'verificado') : tel.pendiente ? 'pendiente' : 'sin_telefono'"), 'the card derives ONE state from what the API answered')
  const pendiente = rama("{estado === 'pendiente' ? (", ") : estado === 'verificado' ? (")
  const verificado = rama(") : estado === 'verificado' ? (", ") : estado === 'vinculado' ? (")
  const vinculado = rama(") : estado === 'vinculado' ? (", '<p className={styles.muted}>Esta cuenta todavía no tiene un teléfono cargado.</p>')
  assert.ok(pendiente.includes('data-contacto="verificar"') && !pendiente.includes('desverificar') && !pendiente.includes('desvincular_whatsapp'), 'pending: verify, never remove a verification that does not exist')
  assert.ok(verificado.includes('data-contacto="vincular_whatsapp"') && verificado.includes('data-contacto="desverificar"') && !verificado.includes('data-contacto="verificar"') && !verificado.includes('desvincular_whatsapp'), 'verified: link or remove the verification')
  assert.ok(vinculado.includes('data-contacto="desvincular_whatsapp"') && !vinculado.includes('data-contacto="vincular_whatsapp"') && !vinculado.includes('desverificar'), 'linked: unlink, never both buttons at once')
  assert.doesNotMatch(ficha, /window\.confirm|[^.\w]alert\(/u, 'the administrative dialog, never the browser\'s')
  assert.doesNotMatch(ficha, /window\.confirm|\bconfirm\(|alert\(/u)
  assert.match(read('apps/web/src/lib/tus-admin-api.ts'), /verificacionTelefonoUsuario: \(id: string, accion: 'verificar' \| 'desverificar'\) => call<\{ done: true; telefono: AdminTelefono \}>\(`\/tus\/v1\/admin\/usuarios\/\$\{encodeURIComponent\(id\)\}\/telefono`, \{ accion \}\)/u, 'the request only names the action')
  // Not a flow for the public: the Help Center never tells a client to ask for it.
  for (const nombre of readdirSync(join(root, 'docs/conocimiento'))) assert.doesNotMatch(read(join('docs/conocimiento', nombre)), /marc(?:ar|a|ue) (?:el |tu )?tel[eé]fono como verificado|verificaci[oó]n administrativa/iu, nombre)
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
  // Mi perfil: three different states, one primary action each; changing the number is separate.
  assert.match(perfil, /Verificar mi número/u)
  assert.match(perfil, /Para usar TUS desde WhatsApp, primero verificá tu número de celular\./u)
  assert.match(perfil, /Vincular este WhatsApp/u)
  assert.match(perfil, /✓ Número verificado/u)
  assert.match(perfil, /Tu número ya está verificado\. Para continuar usando TUS desde WhatsApp falta vincular este WhatsApp con tu cuenta\./u)
  assert.match(perfil, /Al tocar el botón vamos a abrir WhatsApp con un mensaje de verificación listo para enviar\./u)
  assert.match(perfil, /✓ Vinculado a TUS/u)
  assert.match(perfil, /Este WhatsApp está listo para usar TUS\./u)
  assert.match(perfil, /Abrir TUS en WhatsApp/u)
  assert.match(perfil, /Cambiar número de celular/u)
  assert.match(perfil, /phoneApi\.vincular\(\)/u)
  assert.match(perfil, /accion/u)
  // The linking step never shows the "Nuevo número" form: it only appears after "Cambiar número de celular".
  assert.match(perfil, /cambiando \? 'Nuevo número'/u)
  assert.doesNotMatch(perfil, /Verificar nuevo número con WhatsApp/u)
  const cliente = read('apps/web/src/lib/tus-phone-client.ts')
  assert.match(cliente, /\/auth\/phone\/whatsapp-link/u)
  assert.match(cliente, /whatsappLinked: boolean/u)
  // Signed-out people keep ONLY the fixed action through sign-in (no value copied from the URL).
  const pagina = read('apps/web/src/features/profile/profile-page.tsx')
  assert.match(pagina, /accion=vincular-whatsapp/u)
  assert.doesNotMatch(pagina, /returnTo=\$\{[^}]*get\('accion'\)/u)
  assert.match(css, /\.secondaryButton[\s\S]*?min-height: 44px/u)
  assert.match(css, /focus-visible/u)
  const admin = read('apps/web/src/components/admin/admin-usuarios.tsx')
  assert.match(admin, /Teléfono verificado/u)
  assert.match(admin, /Sin teléfono/u)
  const detalle = read('apps/web/src/components/admin/admin-usuario-detalle.tsx')
  assert.match(detalle, /Guardar como pendiente/u)
  assert.match(detalle, /Guardar, verificar y vincular WhatsApp/u)
  assert.doesNotMatch(detalle, /Marcar (teléfono|número) como verificado/u)
})
