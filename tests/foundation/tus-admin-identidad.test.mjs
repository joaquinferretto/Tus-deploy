import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ADMIN-IDENTIDAD-01. An authorized administrator loads or corrects the identity of an account
// (first name, last name, document) and manages its phone from the account sheet. The backend is
// the authority: the same validation runs in the API whatever the form sent, the actor is the
// session, nothing but the identity fields can be written and every change is audited.
const read = (file) => readFileSync(join(root, file), 'utf8')

const HTTP = `
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { AlmacenTelefonosEnMemoria } = await import('./apps/api/src/auth-security/phone/almacenes.ts')
  const { crearServicioTelefono } = await import('./apps/api/src/auth-security/phone/composicion.ts')
  const { crearRouterAdmin } = await import('./apps/api/src/tus/admin/http.ts')
  const { crearIdentidadUsuarioAdmin } = await import('./apps/api/src/tus/admin/identidad.ts')
  const { CuentasAdminEnMemoria } = await import('./apps/api/src/tus/admin/fuentes.ts')
  const { AlmacenPerfilEnMemoria } = await import('./apps/api/src/tus/perfil/almacen.ts')
  const { ServicioPerfil } = await import('./apps/api/src/tus/perfil/servicio.ts')
  const { AlmacenAsistenteEnMemoria } = await import('./apps/api/src/tus/asistente/memoria.ts')
  const idStore = new InMemoryIdentityStore()
  const auth = { ...createAuthService({ store: idStore }), store: idStore }
  const waStore = new AlmacenAsistenteEnMemoria()
  const almacenTel = new AlmacenTelefonosEnMemoria(idStore, waStore.enlaceTelefonos())
  const tel = crearServicioTelefono({ auth, telefonos: almacenTel, env: { TUS_WHATSAPP_PUBLIC_NUMBER: '5493794000000' } })
  const almacenPerfil = new AlmacenPerfilEnMemoria({ paises: [{ id: 'ar', nombre: 'Argentina', codigoIso: 'AR' }], provincias: [{ id: 'ar-w', paisId: 'ar', nombre: 'Corrientes' }], localidades: [{ id: 'corrientes-capital', provinciaId: 'ar-w', nombre: 'Corrientes Capital', latitud: -27.46, longitud: -58.83 }] })
  const perfiles = new ServicioPerfil(almacenPerfil)
  const PASSWORD = 'una frase larga y segura 2026'
  // One person: an account in the identity store and its (empty) personal profile.
  async function persona(email, extra = {}) {
    const id = (await auth.service.registerAccount({ email, password: PASSWORD, displayName: 'Persona ' + email })).created.account.id
    almacenPerfil.perfiles.set(id, { accountId: id, email, emailVerified: false, displayName: 'Persona ' + email, firstName: null, lastName: null, documentType: null, documentNumber: null, localidadId: null, addressStreet: null, addressNumber: null, addressUnit: null, postalCode: null, profileComplete: false, profileUpdatedAt: null, phoneNumber: null, phonePending: null, ...extra })
    return id
  }
  const ADMIN = { subjectId: 'admin-1', tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin', 'tus:identity:admin'], correlationId: 'c' }
  const sesiones = { resolve: async (token) => token === 'admin' ? ADMIN : token === 'cliente' ? { ...ADMIN, subjectId: 'x', permissions: ['tus:marketplace:write'] } : token === 'prestador' ? { ...ADMIN, subjectId: 'y', permissions: ['tus:marketplace:write', 'tus:providers:write'] } : token === 'admin-sin-identidad' ? { ...ADMIN, subjectId: 'z', permissions: ['tus:providers:admin'] } : null }
  const app = express(); app.use(express.json())
  app.use(crearRouterAdmin({
    sessions: sesiones, directorio: { tenantsConPerfil: async () => [], perfilDeTenantAdmin: async () => null }, solicitudes: {}, cuentas: new CuentasAdminEnMemoria(idStore), adminEmails: () => [],
    leerUsuario: (id) => auth.service.getAccountAsAdmin(id), actualizarUsuario: (input) => auth.service.updateAccountAsAdmin(input), perfilUsuario: (id) => perfiles.perfilAdmin(id), telefonoAdmin: tel,
    identidadUsuario: crearIdentidadUsuarioAdmin({ perfiles, auditar: (input) => auth.service.recordAdminIdentityChange(input) }),
  }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const call = async (method, path, body, token) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method, headers: { 'content-type': 'application/json', 'x-correlation-id': 'c', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null, text }
  }
  const identidad = (id, body, token = 'admin') => call('PUT', '/tus/v1/admin/usuarios/' + id + '/identidad', body, token)
  const telefono = (id, body, token = 'admin') => call('POST', '/tus/v1/admin/usuarios/' + id + '/telefono', body, token)
  const eventos = (kind) => auth.audit.events.filter((e) => e.kind === kind)
  const LUCIANA = { nombre: 'Luciana', apellido: 'Pereira', tipoDocumento: 'DNI', numeroDocumento: '40123456' }
`

test('IDENTIDAD validación: names take Unicode letters, accents, ñ, inner spaces, apostrophe and hyphen — never a digit; the document follows the rule of its own type', () => {
  const r = runTypeScriptScenario(`
    const { validarIdentidadPersonal: v } = await import('./packages/contracts/src/tus-perfil.ts')
    const con = (cambios) => v({ nombre: 'Luciana', apellido: 'Pereira', tipoDocumento: 'DNI', numeroDocumento: '40123456', ...cambios })
    const nombre = (valor) => { const x = con({ nombre: valor }); return x.ok ? x.valor.nombre : Object.keys(x.errores).join() }
    const documento = (tipo, numero) => { const x = con({ tipoDocumento: tipo, numeroDocumento: numero }); return x.ok ? x.valor.numeroDocumento : Object.keys(x.errores).join() }
    console.log(JSON.stringify({
      validos: ['José', 'María José', 'Muñoz', "O'Connor", 'Pérez-Gómez', '  Ana    María  ', 'Ñandú', 'Zoë', 'D. Ángel'].map(nombre),
      invalidos: ['Juan3', '1234', '', '   ', 'A', 'x'.repeat(61), 'Ana_María', '<b>Ana</b>', 'Ana@', 'Ana;DROP', 12345, null, undefined].map(nombre),
      apellido: Object.keys(con({ apellido: 'Pereira 2' }).errores ?? {}),
      dni: [documento('DNI', '40123456'), documento('DNI', '40.123.456'), documento('DNI', ' 7123456 '), documento('DNI', '4012345A'), documento('DNI', '123'), documento('DNI', '012345678'), documento('DNI', '401234567'), documento('DNI', ''), documento('DNI', '40-123-456')],
      otros: [documento('LC', '123456'), documento('LE', '12345'), documento('PASAPORTE', 'aab 123456'), documento('PASAPORTE', 'AB-12'), documento('PASAPORTE', 'ÑÑ123456'), documento('CUIT', '20401234567'), documento('', '40123456'), documento(null, '40123456')],
      conjunto: [Object.keys(v({ nombre: 'Luciana' }).errores).sort(), Object.keys(v({}).errores).sort(), Object.keys(v({ nombre: 'Luciana', apellido: 'Pereira' }).errores).sort()],
      normalizada: con({ nombre: '  maría   josé ', apellido: " o'connor " }).valor,
    }))
  `)
  assert.deepEqual(r.validos, ['José', 'María José', 'Muñoz', "O'Connor", 'Pérez-Gómez', 'Ana María', 'Ñandú', 'Zoë', 'D. Ángel'], 'outer and repeated spaces are normalized; nothing else is touched')
  assert.deepEqual(r.invalidos, Array(13).fill('nombre'), 'digits, symbols, markup, empty, one letter, too long and non-strings are rejected')
  assert.deepEqual(r.apellido, ['apellido'])
  assert.deepEqual(r.dni, ['40123456', '40123456', '7123456', 'numeroDocumento', 'numeroDocumento', 'numeroDocumento', 'numeroDocumento', 'numeroDocumento', 'numeroDocumento'], 'DNI: digits only (dots and spaces removed), 7 or 8, no leading zero')
  assert.deepEqual(r.otros, ['123456', 'numeroDocumento', 'AAB123456', 'numeroDocumento', 'numeroDocumento', 'tipoDocumento', 'tipoDocumento', 'tipoDocumento'], 'a passport may carry letters; a type that does not exist is rejected, not invented')
  assert.deepEqual(r.conjunto, [['apellido', 'tipoDocumento'], ['apellido', 'nombre', 'tipoDocumento'], ['tipoDocumento']], 'the identity is one set: a name without its document is not saved')
  assert.deepEqual(r.normalizada, { nombre: 'maría josé', apellido: "o'connor", tipoDocumento: 'DNI', numeroDocumento: '40123456' })
})

test('IDENTIDAD HTTP admin: an administrator completes and corrects the identity; the API validates whatever the form sent, keeps the document unique, recomputes "perfil completo", audits with masked values and touches nothing else', () => {
  const r = runTypeScriptScenario(`${HTTP}
    try {
      const out = {}
      const L = await persona('luciana@example.com')
      const otra = await persona('otra@example.com', { firstName: 'Otra', lastName: 'Persona', documentType: 'DNI', documentNumber: '30111222' })
      const conResidencia = await persona('residente@example.com', { localidadId: 'corrientes-capital', addressStreet: 'Junín', addressNumber: '1234', postalCode: '3400' })
      await tel.fijarPendientePorAdmin('admin-1', L, '379 455-2001')
      const telefonoAntes = JSON.stringify(await almacenTel.estado(L))
      const cuentaAntes = await auth.service.getAccountAsAdmin(L).then((c) => [c.email, c.status, c.emailVerifiedAt])

      // ---- permissions and a body that is not an authority
      out.permisos = [(await identidad(L, LUCIANA, null)).status, (await identidad(L, LUCIANA, 'cliente')).status, (await identidad(L, LUCIANA, 'prestador')).status, (await identidad(L, LUCIANA, 'admin-sin-identidad')).status]
      out.cuerpo = [
        await identidad(L, { ...LUCIANA, adminId: 'otro-admin' }), await identidad(L, { ...LUCIANA, accountId: otra }), await identidad(L, { ...LUCIANA, role: 'admin' }),
        await identidad(L, { ...LUCIANA, phoneVerifiedAt: '2020-01-01' }), await identidad(L, { ...LUCIANA, emailVerifiedAt: 1 }), await identidad(L, { ...LUCIANA, tenantId: 't' }), await identidad(L, { ...LUCIANA, profileComplete: true }),
      ].map((x) => [x.status, x.body.error.code])
      out.propia = (await identidad('admin-1', LUCIANA)).status
      out.inexistente = (await identidad('cuenta-que-no-existe', LUCIANA)).status
      out.intacta = [(await perfiles.perfilAdmin(L)).nombre, eventos('account.admin_identity_updated').length]

      // ---- validation by the API itself
      const invalida = async (cambios) => { const x = await identidad(L, { ...LUCIANA, ...cambios }); return [x.status, x.body.error.code, x.body.error.fields] }
      out.invalidas = {
        nombreConNumero: await invalida({ nombre: 'Luciana2' }), apellidoVacio: await invalida({ apellido: '   ' }), dniConLetra: await invalida({ numeroDocumento: '4012345A' }),
        dniCorto: await invalida({ numeroDocumento: '123' }), tipoInexistente: await invalida({ tipoDocumento: 'CUIT' }), todoVacio: await invalida({ nombre: '', apellido: '', tipoDocumento: '', numeroDocumento: '' }),
        soloNombre: await identidad(L, { nombre: 'Luciana' }).then((x) => [x.status, x.body.error.fields]), largo: await invalida({ nombre: 'x'.repeat(200) }),
      }

      // ---- A/C. complete an empty identity
      const completa = await identidad(L, { ...LUCIANA, nombre: '  Luciana  ', numeroDocumento: '40.123.456' })
      out.completar = [completa.status, completa.body.perfil.nombre, completa.body.perfil.apellido, completa.body.perfil.documento, completa.body.perfil.perfilCompleto]
      out.guardado = await almacenPerfil.perfil(L).then((p) => [p.firstName, p.lastName, p.documentType, p.documentNumber, p.displayName, p.profileComplete])
      out.detalle = (await call('GET', '/tus/v1/admin/usuarios/' + L, null, 'admin')).body.perfil.documento
      // "Perfil completo" is every required field: the residence was already there.
      const residente = await identidad(conResidencia, { nombre: 'Renata', apellido: 'Sosa', tipoDocumento: 'DNI', numeroDocumento: '35222333' })
      out.completoConResidencia = [residente.body.perfil.perfilCompleto, (await almacenPerfil.perfil(conResidencia)).localidadId]

      // ---- B. correct a name; the same values again; change the document (needs a reason)
      out.nombre = await identidad(L, { ...LUCIANA, nombre: 'María José', apellido: "O'Connor" }).then((x) => [x.status, x.body.perfil.nombre, x.body.perfil.apellido])
      const eventosAntes = eventos('account.admin_identity_updated').length
      out.sinCambios = [(await identidad(L, { ...LUCIANA, nombre: 'María José', apellido: "O'Connor" })).status, eventos('account.admin_identity_updated').length === eventosAntes]
      out.sinMotivo = await identidad(L, { ...LUCIANA, nombre: 'María José', apellido: "O'Connor", numeroDocumento: '40999888' }).then((x) => [x.status, x.body.error.code])
      out.motivoCorto = await identidad(L, { ...LUCIANA, nombre: 'María José', apellido: "O'Connor", numeroDocumento: '40999888', motivo: ' a ' }).then((x) => x.body.error.code)
      out.conMotivo = await identidad(L, { ...LUCIANA, nombre: 'María José', apellido: "O'Connor", numeroDocumento: '40999888', motivo: 'Error de carga del titular' }).then((x) => [x.status, x.body.perfil.documento.numero])
      out.pasaporte = await identidad(L, { nombre: 'María José', apellido: "O'Connor", tipoDocumento: 'PASAPORTE', numeroDocumento: 'aab123456', motivo: 'Documento extranjero' }).then((x) => [x.status, x.body.perfil.documento])

      // ---- D. a document of another account: a safe conflict
      const duplicado = await identidad(L, { nombre: 'María José', apellido: "O'Connor", tipoDocumento: 'DNI', numeroDocumento: '30.111.222', motivo: 'Prueba de duplicado' })
      out.duplicado = [duplicado.status, duplicado.body.error.code, /otra@example|Otra|Persona|30111222/u.test(duplicado.text), (await almacenPerfil.perfil(L)).documentNumber]

      // ---- nothing else of the account changed
      out.noTocado = [JSON.stringify(await almacenTel.estado(L)) === telefonoAntes, JSON.stringify(await auth.service.getAccountAsAdmin(L).then((c) => [c.email, c.status, c.emailVerifiedAt])) === JSON.stringify(cuentaAntes), await almacenTel.waIdVinculado(L)]

      // ---- audit
      const auditoria = eventos('account.admin_identity_updated')
      out.auditoria = auditoria.map((e) => [e.actorId, e.metadata.targetAccountId === L ? 'L' : e.metadata.targetAccountId === conResidencia ? 'R' : '?', e.metadata.changedFields, e.metadata.documentBefore ?? null, e.metadata.documentAfter, e.metadata.reason ?? null, e.outcome])
      out.sinDocumentoCompleto = !/40123456|40999888|AAB123456|35222333/u.test(JSON.stringify(auditoria))
      out.completitud = auditoria.slice(0, 2).map((e) => [e.metadata.profileCompleteBefore, e.metadata.profileCompleteAfter])

      // ---- the email of the sheet: changing it never keeps the verification of the old one
      await auth.service.updateAccountAsAdmin({ actorId: 'admin-1', accountId: otra, emailVerified: true })
      const antesEmail = (await auth.service.getAccountAsAdmin(otra)).emailVerifiedAt
      const cambioEmail = await call('PATCH', '/tus/v1/admin/usuarios/' + otra, { email: 'nuevo-email@example.com' }, 'admin')
      const despuesEmail = await auth.service.getAccountAsAdmin(otra)
      out.email = [antesEmail !== null, cambioEmail.status, despuesEmail.email, despuesEmail.emailVerifiedAt]
      console.log(JSON.stringify(out))
    } finally { server.close() }
  `)
  assert.deepEqual(r.permisos, [401, 403, 403, 403], 'no session: 401; a client, a provider or an administrator without the identity permission: 403')
  assert.deepEqual(r.cuerpo, Array(7).fill([422, 'INVALID_CHANGE']), 'only the identity fields are accepted: no actor, account, role, verification date, tenant or flag from the body')
  assert.equal(r.propia, 403, 'an administrator does not edit its own account from the sheet')
  assert.equal(r.inexistente, 404)
  assert.deepEqual(r.intacta, [null, 0], 'none of those requests changed or audited anything')
  assert.deepEqual(r.invalidas.nombreConNumero, [422, 'INVALID_IDENTITY', ['nombre']])
  assert.deepEqual(r.invalidas.apellidoVacio, [422, 'INVALID_IDENTITY', ['apellido']])
  assert.deepEqual(r.invalidas.dniConLetra, [422, 'INVALID_IDENTITY', ['numeroDocumento']], 'a DNI with a letter is refused by the API, whatever the form allowed')
  assert.deepEqual(r.invalidas.dniCorto, [422, 'INVALID_IDENTITY', ['numeroDocumento']])
  assert.deepEqual(r.invalidas.tipoInexistente, [422, 'INVALID_IDENTITY', ['tipoDocumento']])
  assert.deepEqual(r.invalidas.todoVacio, [422, 'INVALID_IDENTITY', ['nombre', 'apellido', 'tipoDocumento']])
  assert.deepEqual(r.invalidas.soloNombre, [422, ['apellido', 'tipoDocumento']], 'a partial identity is not saved')
  assert.deepEqual(r.invalidas.largo, [422, 'INVALID_IDENTITY', ['nombre']])

  assert.deepEqual(r.completar, [200, 'Luciana', 'Pereira', { tipo: 'DNI', numero: '40123456' }, false], 'saved and normalized; four fields alone do not complete a profile that still lacks its residence')
  assert.deepEqual(r.guardado, ['Luciana', 'Pereira', 'DNI', '40123456', 'Luciana Pereira', false], 'these are the real identity data of the account from now on')
  assert.deepEqual(r.detalle, { tipo: 'DNI', numero: '40123456' }, 'the sheet reads what was saved')
  assert.deepEqual(r.completoConResidencia, [true, 'corrientes-capital'], 'with the residence already loaded the profile becomes complete; the residence is untouched')
  assert.deepEqual(r.nombre, [200, 'María José', "O'Connor"])
  assert.deepEqual(r.sinCambios, [200, true], 'saving the same values is not an event')
  assert.deepEqual(r.sinMotivo, [422, 'REASON_REQUIRED'], 'changing a document that was already loaded needs a reason')
  assert.equal(r.motivoCorto, 'REASON_REQUIRED')
  assert.deepEqual(r.conMotivo, [200, '40999888'])
  assert.deepEqual(r.pasaporte, [200, { tipo: 'PASAPORTE', numero: 'AAB123456' }], 'a passport keeps its letters')
  assert.deepEqual(r.duplicado, [409, 'DOCUMENT_ALREADY_REGISTERED', false, 'AAB123456'], 'a document of another account: a conflict that reveals nothing about that account, and nothing is saved')
  assert.deepEqual(r.noTocado, [true, true, null], 'the phone, its verification, the email, the status and WhatsApp are untouched')

  assert.deepEqual(r.auditoria, [
    ['admin-1', 'L', 'firstName,lastName,documentType,documentNumber', null, '*****456', null, 'success'],
    ['admin-1', 'R', 'firstName,lastName,documentType,documentNumber', null, '*****333', null, 'success'],
    ['admin-1', 'L', 'firstName,lastName', '*****456', '*****456', null, 'success'],
    ['admin-1', 'L', 'documentNumber', '*****456', '*****888', 'Error de carga del titular', 'success'],
    ['admin-1', 'L', 'documentType,documentNumber', '*****888', '******456', 'Documento extranjero', 'success'],
  ], 'the administrator of the session, the target, the fields, masked documents and the reason')
  assert.equal(r.sinDocumentoCompleto, true, 'no full document number in the audit')
  assert.deepEqual(r.completitud, [[false, false], [false, true]])
  assert.deepEqual(r.email, [true, 200, 'nuevo-email@example.com', null], 'a new email is never born verified by the verification of the old one')
})

test('TELÉFONO HTTP admin: loading a number checks format and conflicts and never verifies; changing a verified number is explicit — the new one is pending until verified, and only then replaces the old one and its WhatsApp link', () => {
  const r = runTypeScriptScenario(`${HTTP}
    try {
      const out = {}
      const P = await persona('p@example.com'); const Q = await persona('q@example.com')
      const estado = async (id) => { const e = await almacenTel.estado(id); return [e.phoneNumber, e.phonePending, e.phoneVerifiedAt !== null] }
      out.permisos = [(await telefono(P, { accion: 'pendiente', telefono: '379 455-3001' }, null)).status, (await telefono(P, { accion: 'pendiente', telefono: '379 455-3001' }, 'cliente')).status, (await telefono(P, { accion: 'pendiente', telefono: '379 455-3001' }, 'prestador')).status]
      out.invalido = await telefono(P, { accion: 'pendiente', telefono: 'abc' }).then((x) => [x.status, x.body.error.code])
      out.cargar = [(await telefono(P, { accion: 'pendiente', telefono: '379 455-3001' })).status, await estado(P), await almacenTel.waIdVinculado(P)]
      const verificada = await telefono(P, { accion: 'verificar' })
      out.verificar = [verificada.status, verificada.body.telefono.verificado, verificada.body.telefono.whatsappVinculado, await estado(P)]
      // Conflicts when loading: the number of another account, and the account's own verified number.
      out.ajeno = await telefono(Q, { accion: 'pendiente', telefono: '379 455-3001' }).then((x) => [x.status, x.body.error.code, /p@example/u.test(x.text)])
      out.propio = await telefono(P, { accion: 'pendiente', telefono: '+54 9 379 455-3001' }).then((x) => [x.status, x.body.error.code])
      out.sinEfecto = [await estado(Q), await estado(P)]
      // The person links the WhatsApp of the verified number.
      const desafio = await tel.iniciarVinculo(P)
      await tel.verificarDesdeWhatsapp({ waId: '5493794553001', texto: desafio.message, wamid: 'wamid-cambio-1' })
      out.vinculado = await almacenTel.waIdVinculado(P)
      // D. Change: the new number is loaded as pending — the verified one is still the identity phone.
      out.nuevoPendiente = [(await telefono(P, { accion: 'pendiente', telefono: '379 455-3002' })).status, await estado(P), await almacenTel.waIdVinculado(P)]
      const detalle = (await call('GET', '/tus/v1/admin/usuarios/' + P, null, 'admin')).body.telefono
      out.detalle = [detalle.verificado, detalle.numero, detalle.pendiente, detalle.whatsappVinculado]
      // Only verifying the new one replaces it; the WhatsApp of the number given up is unlinked.
      const cambio = await telefono(P, { accion: 'verificar' })
      out.cambio = [cambio.status, cambio.body.telefono, await estado(P), await almacenTel.waIdVinculado(P)]
      out.auditoria = eventos('phone.verified_by_admin').map((e) => [e.actorId, e.metadata.before, e.metadata.after, e.metadata.phone, e.metadata.previous ?? null])
      // Removing it afterwards and again: idempotent.
      const quitada = await telefono(P, { accion: 'desverificar' })
      out.quitar = [quitada.status, await estado(P), (await telefono(P, { accion: 'desverificar' })).status, eventos('phone.unverified_by_admin').length]
      console.log(JSON.stringify(out))
    } finally { server.close() }
  `)
  assert.deepEqual(r.permisos, [401, 403, 403])
  assert.deepEqual(r.invalido, [422, 'INVALID_PHONE'])
  assert.deepEqual(r.cargar, [200, [null, '+5493794553001', false], null], 'normalized, pending, not verified, WhatsApp not linked')
  assert.deepEqual(r.verificar, [200, true, false, ['+5493794553001', null, true]])
  assert.deepEqual(r.ajeno, [409, 'PHONE_IN_USE', false], 'the verified number of another account is not loaded, and that account is not named')
  assert.deepEqual(r.propio, [422, 'ALREADY_VERIFIED'])
  assert.deepEqual(r.sinEfecto, [[null, null, false], ['+5493794553001', null, true]])
  assert.equal(r.vinculado, '5493794553001')
  assert.deepEqual(r.nuevoPendiente, [200, ['+5493794553001', '+5493794553002', true], '5493794553001'], 'a verified phone is never replaced silently: the new one waits as pending')
  assert.deepEqual(r.detalle, [true, '+549379•••3001', '+549379•••3002', true], 'the sheet shows both: the verified number and the one waiting')
  assert.deepEqual(r.cambio, [200, { verificado: true, numero: '+549379•••3002', verificadoEn: r.cambio[1].verificadoEn, pendiente: null, whatsappVinculado: false }, ['+5493794553002', null, true], null], 'the new number is the identity phone; the WhatsApp of the old one is no longer linked')
  assert.deepEqual(r.auditoria, [['admin-1', 'pending', 'verified', '+549379•••3001', null], ['admin-1', 'verified_other', 'verified', '+549379•••3002', '+549379•••3001']])
  assert.deepEqual(r.quitar, [200, [null, '+5493794553002', false], 200, 1])
})

test('IDENTIDAD Web: the identity card is read-only until "Editar identidad"; it validates with the function of the API, shows the errors of the API next to each field and never uses a browser dialog', () => {
  const ficha = read('apps/web/src/components/admin/admin-usuario-detalle.tsx')
  assert.match(ficha, /import \{ ETIQUETA_TIPO_DOCUMENTO, TIPOS_DOCUMENTO, formatearDocumento, validarIdentidadPersonal, type ErroresIdentidad \} from '@factory\/contracts'/u, 'the same validation and the same list of document types as the API')
  assert.match(ficha, /\{identidad === null \? \([\s\S]{0,1400}Editar identidad\s*<\/button>[\s\S]{0,200}\) : \(\s*<form className=\{styles\.formGrid\} noValidate onSubmit=\{guardarIdentidad\}>/u, 'read-only, then a form')
  for (const texto of ['Guardar cambios', 'Cancelar', 'Número de documento', 'Tipo de documento', 'Motivo del cambio de documento']) assert.ok(ficha.includes(texto), texto)
  assert.match(ficha, /titulo: '¿Cambiar el documento de esta cuenta\?'[\s\S]{0,260}confirmar: 'Cambiar documento'/u, 'changing an existing document asks for confirmation in the administrative dialog')
  assert.match(ficha, /cause\.code === 'DOCUMENT_ALREADY_REGISTERED'\) setErroresIdentidad\(\{ numeroDocumento: 'Ese documento ya está asociado a otra cuenta\.' \}\)/u)
  assert.match(ficha, /cause\.code === 'INVALID_IDENTITY'/u, 'field errors of the API are shown on their fields')
  assert.match(ficha, /await adminApi\.identidadUsuario\(cuenta\.id, [\s\S]{0,120}\)\s+await cargar\(\)\s+setIdentidad\(null\)/u, 'after saving the sheet is read again from the API, without a page reload')
  assert.doesNotMatch(ficha, /window\.confirm|\bconfirm\(|alert\(|window\.location\.reload/u)
  // A phone error is told as a phone error (never the "nombre de 2 a 120 caracteres" message).
  assert.match(ficha, /cause\.code === 'INVALID_ACTION' \|\| cause\.code === 'INVALID_CHANGE'\)\) return 'La operación no fue aceptada por el servidor\./u)
  assert.match(ficha, /cause\.code === 'ALREADY_VERIFIED'\) return 'Ese número ya es el teléfono verificado de esta cuenta\.'/u)
  assert.match(ficha, /\{cuenta\.telefono\.whatsappVinculado \? 'Vinculado' : 'No vinculado'\}/u)
  const api = read('apps/web/src/lib/tus-admin-api.ts')
  assert.match(api, /identidadUsuario: \(id: string, body: \{ nombre: string; apellido: string; tipoDocumento: string; numeroDocumento: string; motivo\?: string \}\) =>\s+call<\{ perfil: PerfilUsuarioAdminDTO \}>\(`\/tus\/v1\/admin\/usuarios\/\$\{encodeURIComponent\(id\)\}\/identidad`, body, 'PUT'\)/u, 'the contract of the Web is the route of the API')
  const servidor = read('apps/api/src/server.ts')
  assert.match(servidor, /identidadUsuario: crearIdentidadUsuarioAdmin\(\{ perfiles, auditar: \(input\) => auth\.service\.recordAdminIdentityChange\(input\) \}\)/u, 'the real server wires the same operation the tests exercise')
})

test('ADMIN contacto HTTP: a closed list of actions — save + verify, link, the three at once, unlink, remove — for the administration only; the body carries a number or nothing; conflicts are a 409 that says nothing of the other account; every action is audited with the administrator and a masked number', () => {
  const r = runTypeScriptScenario(`${HTTP}
    const out = {}
    try {
      const P = await persona('p-contacto@example.com'); const Q = await persona('q-contacto@example.com')
      const vista = (x) => [x.status, x.body?.telefono ? [x.body.telefono.verificado, x.body.telefono.pendiente !== null, x.body.telefono.whatsappVinculado] : (x.body?.error?.code ?? null)]
      // Only the administration.
      out.permisos = [(await telefono(P, { accion: 'guardar_verificar_vincular', telefono: '379 455-4001' }, null)).status, (await telefono(P, { accion: 'guardar_verificar_vincular', telefono: '379 455-4001' }, 'cliente')).status, (await telefono(P, { accion: 'vincular_whatsapp' }, 'prestador')).status, (await almacenTel.estado(P)).phoneNumber]
      // Input.
      out.entrada = [
        await telefono(P, { accion: 'guardar_verificar', telefono: 'abc' }), await telefono(P, { accion: 'guardar_verificar' }), await telefono(P, { accion: 'inventada' }), await telefono(P, {}),
        await telefono(P, { accion: 'vincular_whatsapp', telefono: '379 455-4001' }), await telefono(P, { accion: 'guardar_verificar_vincular', telefono: '379 455-4001', verifiedAt: '2020-01-01T00:00:00.000Z' }),
        await telefono(P, { accion: 'guardar_verificar_vincular', telefono: '379 455-4001', waId: '5491100000000' }), await telefono(P, { accion: 'verificar', adminId: 'otro-admin' }), await telefono(P, { accion: 'quitar', accountId: Q }),
        await telefono(P, { accion: 'vincular_whatsapp' }), await telefono('no-existe', { accion: 'guardar_verificar', telefono: '379 455-4001' }),
      ].map((x) => [x.status, x.body?.error?.code ?? null])
      out.sinCambios = [(await almacenTel.estado(P)).phoneNumber, (await almacenTel.estado(P)).phonePending, await almacenTel.waIdVinculado(P)]
      // The flow of the card.
      out.guardarVerificar = vista(await telefono(P, { accion: 'guardar_verificar', telefono: '379 455-4001' }))
      out.vincular = [vista(await telefono(P, { accion: 'vincular_whatsapp' })), await almacenTel.waIdVinculado(P)]
      out.repetir = vista(await telefono(P, { accion: 'vincular_whatsapp' }))
      out.desvincular = [vista(await telefono(P, { accion: 'desvincular_whatsapp' })), await almacenTel.waIdVinculado(P), (await almacenTel.estado(P)).phoneNumber !== null]
      out.todoJunto = [vista(await telefono(P, { accion: 'guardar_verificar_vincular', telefono: '379 455-4002' })), await almacenTel.waIdVinculado(P)]
      // Another account: its phone and its WhatsApp are not available, and nothing of it is told.
      const ajeno = await telefono(Q, { accion: 'guardar_verificar_vincular', telefono: '+54 9 379 455-4002' })
      out.ajeno = [ajeno.status, ajeno.body.error.code, /p-contacto|Persona/u.test(ajeno.text), (await almacenTel.estado(Q)).phoneNumber]
      out.pendienteYVincular = [(await telefono(Q, { accion: 'pendiente', telefono: '379 455-4003' })).status, vista(await telefono(Q, { accion: 'verificar_vincular' })), await almacenTel.waIdVinculado(Q)]
      out.quitar = [vista(await telefono(P, { accion: 'quitar' })), await almacenTel.waIdVinculado(P), (await almacenTel.estado(P)).phoneNumber, vista(await telefono(P, { accion: 'quitar' }))]
      // The account is the same one, with everything else it had.
      out.cuenta = [(await auth.service.getAccountAsAdmin(P)).email, (await call('GET', '/tus/v1/admin/usuarios/' + P, null, 'admin')).body.usuario?.telefono?.whatsappVinculado ?? (await call('GET', '/tus/v1/admin/usuarios/' + P, null, 'admin')).status]
      const kinds = ['phone.assigned_by_admin', 'phone.verified_by_admin', 'phone.removed_by_admin', 'whatsapp.linked_by_admin', 'whatsapp.unlinked_by_admin']
      const registrados = kinds.map((kind) => eventos(kind))
      out.auditoria = [registrados.map((lista) => lista.length > 0), registrados.flat().every((e) => e.actorId === 'admin-1'), /3794554001|3794554002|3794554003/u.test(JSON.stringify(registrados)), registrados.flat().every((e) => typeof (e.metadata?.target ?? e.target) === 'string' || JSON.stringify(e).includes(P) || JSON.stringify(e).includes(Q))]
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.permisos, [401, 403, 403, null], 'no session, a client or a provider: refused, nothing changes')
  assert.deepEqual(r.entrada, [[422, 'INVALID_PHONE'], [422, 'INVALID_PHONE'], [422, 'INVALID_ACTION'], [422, 'INVALID_ACTION'], [422, 'INVALID_CHANGE'], [422, 'INVALID_CHANGE'], [422, 'INVALID_CHANGE'], [422, 'INVALID_CHANGE'], [422, 'INVALID_CHANGE'], [422, 'PHONE_NOT_VERIFIED'], [404, 'NOT_FOUND']], 'a closed body: a number only where the action takes one; never a date, a wa_id, an actor or an account')
  assert.deepEqual(r.sinCambios, [null, null, null])
  assert.deepEqual(r.guardarVerificar, [200, [true, false, false]])
  assert.deepEqual(r.vincular, [[200, [true, false, true]], '5493794554001'], 'the WhatsApp of the account is the contact of its verified number')
  assert.deepEqual(r.repetir, [200, [true, false, true]], 'idempotent')
  assert.deepEqual(r.desvincular, [[200, [true, false, false]], null, true], 'unlinked; the phone stays verified')
  assert.deepEqual(r.todoJunto, [[200, [true, false, true]], '5493794554002'], 'a new number, verified and linked in one action; the previous one is no longer the account\'s')
  assert.deepEqual(r.ajeno, [409, 'PHONE_IN_USE', false, null])
  assert.deepEqual(r.pendienteYVincular, [200, [200, [true, false, true]], '5493794554003'])
  assert.deepEqual(r.quitar, [[200, [false, false, false]], null, null, [200, [false, false, false]]], 'the number leaves the account, with its WhatsApp; repeating it changes nothing')
  assert.equal(r.cuenta[0], 'p-contacto@example.com', 'the account is untouched')
  assert.deepEqual(r.auditoria.slice(0, 3), [[true, true, true, true, true], true, false], 'every action is audited with the administrator, never a whole number')
})
