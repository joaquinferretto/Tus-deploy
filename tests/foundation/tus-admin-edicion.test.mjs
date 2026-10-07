import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

// The administration can see and change every business attribute of an account and of a
// provider (name, email, status, email verification, services, coverage, visibility, approval,
// location), through safe operations: never a hash, token, MFA secret, tenant or internal id, and
// never a way to grant platform admin authority (the server allowlist).
const read = (file) => readFileSync(join(root, file), 'utf8')

const HTTP = `
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
  const { crearServicioSolicitudes } = await import('./apps/api/src/tus/solicitudes/composicion.ts')
  const { crearAltaPrestadorAdmin, crearEdicionPrestadorAdmin } = await import('./apps/api/src/tus/directorio/admin.ts')
  const { crearRouterAdmin } = await import('./apps/api/src/tus/admin/http.ts')
  const { CuentasAdminEnMemoria, ActividadAdminEnMemoria } = await import('./apps/api/src/tus/admin/fuentes.ts')
  const { establecerCatalogo } = await import('./apps/api/src/tus/catalogo/vigente.ts')
  const { SEMILLA_CATALOGO } = await import('./apps/api/src/tus/catalogo/semilla.ts')
  establecerCatalogo(SEMILLA_CATALOGO)
  const identityStore = new InMemoryIdentityStore()
  const auth = { ...createAuthService({ store: identityStore, platformAdminEmails: ['admin@example.com'] }), store: identityStore }
  const directorio = crearServicioDirectorio({ application: tusApp })
  const solicitudes = crearServicioSolicitudes({ cuentas: identityStore, destinos: directorio })
  const PASSWORD = 'una frase larga y segura 2026'
  async function cuenta(email, displayName) {
    const created = await auth.service.register({ email, password: PASSWORD, displayName })
    await auth.service.verifyEmail({ token: auth.email.messages.filter((m) => m.email === email && m.kind === 'verification').at(-1).token })
    return created.account
  }
  const adminAccount = await cuenta('admin@example.com', 'Admin TUS')
  const admin = { subjectId: adminAccount.id, tenantId: adminAccount.tenantId, sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin', 'tus:identity:admin'], correlationId: 'c' }
  const sessions = { resolve: async (token) => token === 'admin' ? admin : token === 'client' ? { ...admin, subjectId: 'x', permissions: ['tus:marketplace:write'] } : null }
  const app = express(); app.use(express.json())
  app.use(crearRouterAdmin({
    sessions, directorio, solicitudes,
    cuentas: new CuentasAdminEnMemoria(identityStore),
    actividad: new ActividadAdminEnMemoria(() => auth.audit.events),
    adminEmails: () => ['admin@example.com'],
    crearUsuario: (input) => auth.service.createAccountAsAdmin(input),
    actualizarUsuario: (input) => auth.service.updateAccountAsAdmin(input),
    leerUsuario: (id) => auth.service.getAccountAsAdmin(id),
    accionUsuario: (input) => auth.service.adminAccountAction(input),
    prestadorAdmin: crearEdicionPrestadorAdmin({ application: tusApp, directorio }),
  }))
  const alta = crearAltaPrestadorAdmin({ accounts: identityStore, application: tusApp, directorio })
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const call = async (method, path, body, token = 'admin') => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method, headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'c', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null, text }
  }
  const activas = (accountId) => [...identityStore.sessions.values()].filter((s) => s.accountId === accountId && s.revokedAt === null).length
`

test('ADMIN USUARIO: detail without secrets; name, email (normalized, unique, re-verification, sessions closed), status and verification editable; audited', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${HTTP}
    try {
      const carla = await cuenta('carla@example.com', 'Carla Gómez')
      await cuenta('diego@example.com', 'Diego Pérez')
      await auth.service.signIn({ email: 'carla@example.com', password: PASSWORD })
      const sesionesAntes = activas(carla.id)
      const detalle = await call('GET', '/tus/v1/admin/usuarios/' + carla.id)
      const forbidden = {}
      for (const body of [{ passwordHash: 'x' }, { roles: ['owner'] }, { role: 'admin' }, { tenantId: 't' }, { mfa: {} }, { id: 'otro' }, { emailVerifiedAt: 1 }, { refreshToken: 'r' }])
        forbidden[Object.keys(body)[0]] = (await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, body)).status
      const duplicado = await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, { email: 'DIEGO@example.com' })
      const invalido = await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, { email: 'no-es-email' })
      const cambio = await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, { email: '  Carla.Nueva@Example.com ', displayName: 'Carla G.' })
      const despues = await call('GET', '/tus/v1/admin/usuarios/' + carla.id)
      const verificar = await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, { emailVerified: true })
      const verificada = await call('GET', '/tus/v1/admin/usuarios/' + carla.id)
      const verificarMal = await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, { emailVerified: 'si' })
      const suspender = await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, { status: 'suspended', reason: 'pedido del titular' })
      const reactivar = await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, { status: 'active' })
      const noExiste = await call('GET', '/tus/v1/admin/usuarios/no-existe')
      const cliente = await call('GET', '/tus/v1/admin/usuarios/' + carla.id, null, 'client')
      const eventos = auth.audit.events.filter((e) => e.kind.startsWith('account.admin_'))
      console.log(JSON.stringify({
        detalle: detalle.body, detalleTexto: detalle.text, forbidden, duplicado: [duplicado.status, duplicado.body.error.code], invalido: invalido.status,
        cambio: cambio.status, despues: despues.body, sesionesAntes, sesionesDespues: activas(carla.id),
        verificar: verificar.status, verificada: verificada.body.verificado, verificarMal: verificarMal.status,
        suspender: suspender.status, reactivar: reactivar.status, estado: (await call('GET', '/tus/v1/admin/usuarios/' + carla.id)).body.estado,
        noExiste: noExiste.status, cliente: cliente.status,
        eventos: eventos.map((e) => e.kind), auditoria: JSON.stringify(eventos),
      }))
    } finally { server.close() }
  `)
  assert.equal(r.detalle.email, 'carla@example.com')
  assert.equal(r.detalle.verificado, true)
  assert.equal(r.detalle.conContrasena, true)
  assert.deepEqual(r.detalle.roles, ['cliente'])
  assert.equal(r.detalle.administradorPlataforma, false)
  assert.doesNotMatch(r.detalleTexto, /hash|scrypt|token|secret|mfa|tenantId/i)
  for (const [key, status] of Object.entries(r.forbidden)) assert.equal(status, 422, key)
  assert.deepEqual(r.duplicado, [409, 'EMAIL_ALREADY_REGISTERED'])
  assert.equal(r.invalido, 422)
  assert.equal(r.cambio, 200)
  assert.equal(r.despues.email, 'carla.nueva@example.com')
  assert.equal(r.despues.nombre, 'Carla G.')
  // A new email must be confirmed again, and every session of the old identity ends.
  assert.equal(r.despues.verificado, false)
  assert.ok(r.sesionesAntes >= 1)
  assert.equal(r.sesionesDespues, 0)
  assert.equal(r.verificar, 200)
  assert.equal(r.verificada, true)
  assert.equal(r.verificarMal, 422)
  assert.equal(r.suspender, 200)
  assert.equal(r.reactivar, 200)
  assert.equal(r.estado, 'active')
  assert.equal(r.noExiste, 404)
  assert.equal(r.cliente, 403)
  assert.ok(r.eventos.includes('account.admin_updated'))
  assert.ok(r.eventos.includes('account.admin_suspended'))
  assert.ok(r.eventos.includes('account.admin_reactivated'))
  // The audit never carries the email or the name.
  assert.doesNotMatch(r.auditoria, /carla\.nueva@example\.com|carla@example\.com|Carla G\./)
  assert.match(r.auditoria, /emailChanged/)
})

test('ADMIN USUARIO: no privilege escalation - admin emails and the admin own identity are not editable; safe actions close sessions and send recovery', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${HTTP}
    try {
      const eva = await cuenta('eva@example.com', 'Eva Ruiz')
      await auth.service.signIn({ email: 'eva@example.com', password: PASSWORD })
      const aAdmin = await call('PATCH', '/tus/v1/admin/usuarios/' + eva.id, { email: 'Admin@Example.com' })
      const propioEmail = await call('PATCH', '/tus/v1/admin/usuarios/' + adminAccount.id, { email: 'otro-admin@example.com' })
      const propioVerif = await call('PATCH', '/tus/v1/admin/usuarios/' + adminAccount.id, { emailVerified: false })
      const propioSuspender = await call('PATCH', '/tus/v1/admin/usuarios/' + adminAccount.id, { status: 'suspended' })
      const adminDetalle = await call('GET', '/tus/v1/admin/usuarios/' + adminAccount.id)
      const recuperacionesAntes = auth.email.messages.filter((m) => m.kind === 'recovery').length
      const reset = await call('POST', '/tus/v1/admin/usuarios/' + eva.id + '/acciones', { action: 'password_reset' })
      const recuperaciones = auth.email.messages.filter((m) => m.kind === 'recovery' && m.email === 'eva@example.com').length - recuperacionesAntes
      await auth.service.signIn({ email: 'eva@example.com', password: PASSWORD })
      const antesRevocar = activas(eva.id)
      const revocar = await call('POST', '/tus/v1/admin/usuarios/' + eva.id + '/acciones', { action: 'revoke_sessions' })
      const accionMala = await call('POST', '/tus/v1/admin/usuarios/' + eva.id + '/acciones', { action: 'delete_account' })
      const accionPropia = await call('POST', '/tus/v1/admin/usuarios/' + adminAccount.id + '/acciones', { action: 'revoke_sessions' })
      const eventos = auth.audit.events.filter((e) => e.kind === 'account.admin_updated').map((e) => e.metadata?.action ?? e.details?.action ?? JSON.stringify(e))
      console.log(JSON.stringify({
        aAdmin: aAdmin.status, propioEmail: propioEmail.status, propioVerif: propioVerif.status, propioSuspender: propioSuspender.status,
        adminDetalle: [adminDetalle.body.roles, adminDetalle.body.administradorPlataforma, adminDetalle.body.email],
        reset: [reset.status, reset.text], recuperaciones, antesRevocar, despuesRevocar: activas(eva.id), revocar: revocar.status,
        accionMala: accionMala.status, accionPropia: accionPropia.status, evaSigueEva: (await call('GET', '/tus/v1/admin/usuarios/' + eva.id)).body.email, eventos: JSON.stringify(eventos),
      }))
    } finally { server.close() }
  `)
  assert.equal(r.aAdmin, 403)
  assert.equal(r.propioEmail, 403)
  assert.equal(r.propioVerif, 403)
  assert.equal(r.propioSuspender, 403)
  assert.deepEqual(r.adminDetalle, [['admin', 'cliente'], true, 'admin@example.com'])
  assert.equal(r.reset[0], 200)
  // The admin never receives the recovery token: only the owner's mailbox does.
  assert.doesNotMatch(r.reset[1], /token/i)
  assert.equal(r.recuperaciones, 1)
  assert.ok(r.antesRevocar >= 1)
  assert.equal(r.despuesRevocar, 0)
  assert.equal(r.revocar, 200)
  assert.equal(r.accionMala, 422)
  assert.equal(r.accionPropia, 403)
  assert.equal(r.evaSigueEva, 'eva@example.com')
  assert.match(r.eventos, /password_reset_requested/)
  assert.match(r.eventos, /sessions_revoked/)
})

test('ADMIN PRESTADOR: every business field editable (data, services by category, coverage, visibility, approval), authority fields refused, audited', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${HTTP}
    try {
      await cuenta('diego@example.com', 'Diego Pérez')
      const creado = await alta(admin, { email: 'diego@example.com', displayName: 'Diego Plomero', profession: 'plomeria', zone: 'Centro' })
      const id = creado.profile.id
      const base = await call('GET', '/tus/v1/admin/prestadores/' + id)
      const editar = await call('PUT', '/tus/v1/admin/prestadores/' + id, { displayName: 'Diego Servicios', professions: ['electricidad', 'plomeria', 'pintura'], zone: 'Centro', serviceZones: ['Centro', 'Camba Cuá'], serviceMode: 'mixto', coverageRadiusKm: 12, description: 'Trabajos prolijos', yearsOfExperience: 9, visible: true })
      const parcial = await call('PUT', '/tus/v1/admin/prestadores/' + id, { description: 'Solo cambia la descripción' })
      const autoridad = {}
      for (const body of [{ tenantId: 'x' }, { prestadorId: 'x' }, { id: 'x' }, { merchantId: 'x' }, { latitud: 1 }])
        autoridad[Object.keys(body)[0]] = (await call('PUT', '/tus/v1/admin/prestadores/' + id, body)).status
      const invalido = await call('PUT', '/tus/v1/admin/prestadores/' + id, { displayName: 'x', professions: ['no-existe'] })
      const estadoMalo = await call('PUT', '/tus/v1/admin/prestadores/' + id, { providerStatus: 'superadmin' })
      const enDirectorioAntes = (await directorio.listar({})).items.some((w) => w.id === id)
      const suspender = await call('PUT', '/tus/v1/admin/prestadores/' + id, { providerStatus: 'suspended' })
      const enDirectorioSuspendido = (await directorio.listar({})).items.some((w) => w.id === id)
      const aprobar = await call('PUT', '/tus/v1/admin/prestadores/' + id, { providerStatus: 'approved' })
      const enDirectorioAprobado = (await directorio.listar({ oficio: 'pintura' })).items.some((w) => w.id === id)
      const noExiste = await call('GET', '/tus/v1/admin/prestadores/no-existe')
      const cliente = await call('PUT', '/tus/v1/admin/prestadores/' + id, { description: 'hack' }, 'client')
      const tenantId = (await directorio.perfilParaAdmin(id)).tenantId
      const auditoria = (await tusApp.marketplace.store.audit.list(tenantId)).map((a) => a.action)
      console.log(JSON.stringify({ base: base.body, editar: editar.body, parcial: parcial.body.perfil, autoridad, invalido: [invalido.status, invalido.body.error.fields], estadoMalo: estadoMalo.status, enDirectorioAntes, suspender: [suspender.status, suspender.body.prestador], enDirectorioSuspendido, aprobar: aprobar.status, enDirectorioAprobado, noExiste: noExiste.status, cliente: cliente.status, auditoria }))
    } finally { server.close() }
  `)
  assert.equal(r.base.cuenta.email, 'diego@example.com')
  assert.deepEqual(r.base.perfil.professions, ['plomeria'])
  assert.deepEqual(r.base.prestador, { estado: 'approved', aprobado: true })
  assert.ok('ubicacion' in r.base)
  const perfil = r.editar.perfil
  assert.equal(perfil.displayName, 'Diego Servicios')
  assert.deepEqual(perfil.professions, ['electricidad', 'plomeria', 'pintura'])
  assert.equal(perfil.profession, 'electricidad')
  assert.deepEqual(perfil.serviceZones, ['Centro', 'Camba Cuá'])
  assert.equal(perfil.serviceMode, 'mixto')
  assert.equal(perfil.coverageRadiusKm, 12)
  assert.equal(perfil.yearsOfExperience, 9)
  // A partial edit keeps every other stored value.
  assert.equal(r.parcial.description, 'Solo cambia la descripción')
  assert.deepEqual(r.parcial.professions, ['electricidad', 'plomeria', 'pintura'])
  assert.equal(r.parcial.coverageRadiusKm, 12)
  for (const [key, status] of Object.entries(r.autoridad)) assert.equal(status, 422, key)
  assert.equal(r.invalido[0], 422)
  assert.ok(r.invalido[1].includes('displayName'))
  assert.equal(r.estadoMalo, 422)
  assert.equal(r.enDirectorioAntes, true)
  assert.deepEqual(r.suspender, [200, { estado: 'suspended', aprobado: false }])
  assert.equal(r.enDirectorioSuspendido, false)
  assert.equal(r.aprobar, 200)
  assert.equal(r.enDirectorioAprobado, true)
  assert.equal(r.noExiste, 404)
  assert.equal(r.cliente, 403)
  assert.ok(r.auditoria.includes('provider.profile.admin_updated'))
  assert.ok(r.auditoria.includes('provider.admin_suspended'))
  assert.ok(r.auditoria.includes('provider.admin_approved'))
})

test('ADMIN WEB: user and provider detail pages, linked from the lists; category detail lists its services and moves them', () => {
  const usuario = read('apps/web/src/components/admin/admin-usuario-detalle.tsx')
  const prestador = read('apps/web/src/components/admin/admin-prestador-detalle.tsx')
  const catalogo = read('apps/web/src/components/admin/admin-catalogo.tsx')
  assert.match(read('apps/web/src/app/tus/admin/usuarios/[id]/page.tsx'), /AdminUsuarioDetallePage/)
  assert.match(read('apps/web/src/app/tus/admin/prestadores/[id]/page.tsx'), /AdminPrestadorDetallePage/)
  assert.match(read('apps/web/src/components/admin/admin-usuarios.tsx'), /\/tus\/admin\/usuarios\/\$\{encodeURIComponent\(item\.id\)\}/)
  assert.match(read('apps/web/src/components/admin/admin-prestadores-lista.tsx'), /\/tus\/admin\/prestadores\/\$\{encodeURIComponent\(item\.id\)\}/)
  // Safe actions instead of secrets; never a password field in the detail.
  assert.match(usuario, /Cerrar todas las sesiones/)
  assert.match(usuario, /Forzar cambio de contraseña/)
  assert.doesNotMatch(usuario, /type="password"/)
  // Provider sections: data, services (picker by category), coverage, state, account and location.
  for (const text of ['Perfil profesional', 'Servicios', 'Cobertura', 'Aprobación del prestador', 'Cuenta', 'Ubicación en el mapa']) assert.ok(prestador.includes(text), text)
  assert.match(prestador, /<ServicePicker/)
  assert.match(prestador, /<LocationEditor/)
  assert.match(catalogo, /function ServiciosDeCategoria/)
  assert.match(catalogo, /Mover a/)
})
