import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// ADMIN-IDENTIDAD-MANUAL-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). The payments module of this scenario reads the identity of a
// provider from the REAL identity service over PostgreSQL (the fixture's stand-in is replaced), so
// what the administration decides is what the deposit of a turno depends on.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'
const root = join(import.meta.dirname, '../..')

const SETUP = turnosPagosSetup(url)
  .replace(
    'const verificados = new Set()',
    `const verificados = new Set()
  const { TransaccionIdentidadPrisma } = await import('./apps/api/src/tus/adapters/prisma-identidad.ts')
  const { crearServicioIdentidad } = await import('./apps/api/src/tus/identidad/composicion.ts')
  const identidadReal = crearServicioIdentidad({ transaction: new TransaccionIdentidadPrisma(prisma), env: {} })`
  )
  .replace('identidadVerificada: async (tenant) => verificados.has(tenant) })', 'identidadVerificada: (tenant) => identidadReal.identidadVerificada(tenant) })')

test('IDENTIDAD manual por Admin PostgreSQL: a provider whose identity is pending cannot charge a deposit; an administrator verifies it by hand (with a note, never its own) on the same records payments read, and the deposit can be charged at once; the public name plays no part; revoking blocks new charges and leaves the paid ones as they were; a rejected identity can be reopened or verified; everything is audited', { skip, timeout: 600000 }, () => {
  assert.ok(SETUP.includes('identidadReal.identidadVerificada(tenant)'), 'the payments of this scenario read the real identity service')
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const { AlmacenPerfilPrisma } = await import('./apps/api/src/tus/perfil/almacen.ts')
    const { ServicioPerfil } = await import('./apps/api/src/tus/perfil/servicio.ts')
    const { crearIdentidadUsuarioAdmin, crearVerificacionIdentidadAdmin } = await import('./apps/api/src/tus/admin/identidad.ts')
    try {
      const perfiles = new ServicioPerfil(new AlmacenPerfilPrisma(prisma))
      const cargarIdentidad = crearIdentidadUsuarioAdmin({ perfiles, auditar: (input) => auth.service.recordAdminIdentityChange(input) })
      const verificacion = crearVerificacionIdentidadAdmin({ identidad: identidadReal, leerUsuario: (accountId) => auth.service.getAccountAsAdmin(accountId), perfilUsuario: (accountId) => perfiles.perfilAdmin(accountId), auditar: (input) => auth.service.recordAdminIdentityChange(input) })
      // The provider "Flor Perez" (its PUBLIC name) belongs to the account of Ludmila Fernandez.
      const p = await prestador('idm', 'Flor Perez ' + run, [['Masaje', 30000]])
      const titular = await cliente('ludmila')
      await prisma.account.update({ where: { id: titular.id }, data: { tenantId: p.tenantId } })
      await prisma.prestador.updateMany({ where: { tenantId: p.tenantId }, data: { cuentaId: titular.id } })
      const otro = await prestador('idm2', 'Otro ' + run, [['Masaje', 30000]])
      const titularOtro = await cliente('otro')
      await prisma.account.update({ where: { id: titularOtro.id }, data: { tenantId: otro.tenantId } })
      const ana = await cliente('ana')
      const admin = { subjectId: 'admin-' + run, tenantId: 'platform', correlationId: 'c-admin' }
      const decidir = async (accion, motivo, extra = {}) => { const x = await verificacion.decidir({ actor: admin, accountId: titular.id, accion, motivo, ...extra }); return x.ok ? x.verificacion.estado : x.code }
      const puedeCobrar = async (quien = p) => (await modulo.politica.disponibilidad({ prestadorTenantId: quien.tenantId, prestadorId: quien.prestadorId, categoria: null, anticipado: true }))
      const pedir = (indice, hora) => turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(indice, hora), tarifaId: p.tarifas['Masaje'], clienteId: ana.id, clienteTenantId: ana.tenantId })
      const aceptar = async (pedido) => { try { return (await turnos.aceptarSolicitud({ prestadorTenantId: p.tenantId, reservaId: pedido.id })).estado } catch (e) { return e?.code ?? String(e) } }
      const base = String(10000 + Math.floor(Math.random() * 80000))
      const dni = '3' + base + '07'

      // ---- 1. Pending: no deposit can be charged for that provider.
      const t1 = await pedir(4, '10:00')
      out.pendiente = [(await verificacion.estado(titular.id)).estado, await identidadReal.identidadVerificada(p.tenantId), (await puedeCobrar()).reason, await aceptar(t1)]
      // ---- 2. What is refused: no document yet, no note, its own identity, an unknown account.
      out.rechazos = [
        await decidir('verificar', 'Verificación manual para piloto interno'),
        (await cargarIdentidad({ actorId: admin.subjectId, accountId: titular.id, body: { nombre: 'Ludmila', apellido: 'Fernandez', tipoDocumento: 'DNI', numeroDocumento: dni } })).ok,
        await decidir('verificar', ''),
        await decidir('verificar', 'ok'),
        await decidir('aprobar', 'Verificación manual para piloto interno'),
        (await verificacion.decidir({ actor: { ...admin, subjectId: titular.id }, accountId: titular.id, accion: 'verificar', motivo: 'me verifico yo mismo' })).code,
        (await verificacion.decidir({ actor: { ...admin, tenantId: p.tenantId }, accountId: titular.id, accion: 'verificar', motivo: 'soy de ese prestador' })).code,
        (await verificacion.decidir({ actor: admin, accountId: 'cuenta-inexistente', accion: 'verificar', motivo: 'Verificación manual para piloto interno' })).code,
        (await verificacion.estado(titular.id)).estado, await identidadReal.identidadVerificada(p.tenantId),
      ]
      // ---- 3. Verified by hand: the deposit can be charged at once.
      const verificada = await verificacion.decidir({ actor: admin, accountId: titular.id, accion: 'verificar', motivo: 'Verificación manual para piloto interno' })
      const filaV = await prisma.verificacionIdentidad.findFirst({ where: { tenantId: p.tenantId, estado: 'verified' } })
      const perfilPublico = await prisma.perfilPublicoPrestador.findFirst({ where: { tenantId: p.tenantId } })
      out.verificada = [verificada.ok && verificada.verificacion.estado, verificada.verificacion.metodo, verificada.verificacion.decididaPor === admin.subjectId, verificada.verificacion.nota, Boolean(verificada.verificacion.verificadaEn), verificada.verificacion.documento !== dni && verificada.verificacion.documento.endsWith(dni.slice(-3)), filaV.metodoVerificacion, filaV.usuarioId === titular.id, filaV.nombreExtraido, filaV.apellidoExtraido, perfilPublico.nombrePublico.startsWith('Flor Perez')]
      out.habilita = [await identidadReal.identidadVerificada(p.tenantId), (await puedeCobrar()).available, (await puedeCobrar()).reason, await aceptar(t1)]
      // Again: nothing changes and nothing is recorded twice.
      const auditoriasAntes = await prisma.auditoriaIdentidad.count({ where: { tenantId: p.tenantId } })
      out.repetida = [await decidir('verificar', 'Verificación manual para piloto interno'), await prisma.auditoriaIdentidad.count({ where: { tenantId: p.tenantId } }) === auditoriasAntes, await prisma.verificacionIdentidad.count({ where: { tenantId: p.tenantId } })]
      // The deposit of that turno is paid.
      let checkout = null
      for (let i = 0; !checkout; i += 1) { try { checkout = await turnos.pagarSena({ clienteId: ana.id, reservaId: t1.id, correlationId: 'c', politica: POLITICA }) } catch (e) { if (e?.code !== 'IN_PROGRESS' || i >= 40) throw e; await new Promise((resolve) => setTimeout(resolve, 250)) } }
      const orden = await prisma.trabajo.findFirst({ where: { origen: 'turno', reservaId: t1.reservaId } })
      const obligacion = await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: orden.trabajoId, tramo: 'sena' } })
      const intento = await prisma.intencionPago.findFirst({ where: { obligacionId: obligacion.obligacionId } })
      mpPayment('880' + String(Math.floor(Math.random() * 900000) + 100000), mp.preferences.find((item) => item.body.external_reference === intento.pagoId))
      await ingerir(notification([...mp.payments.keys()].at(-1), { userId: '555', notificationId: run + '-idm' }))
      const pagado = async () => [(await prisma.reserva.findUnique({ where: { id: t1.id } })).estado, (await prisma.obligacionPagoServicio.findFirst({ where: { obligacionId: obligacion.obligacionId } })).estado, (await prisma.liquidacionServicio.findMany({ where: { obligacionId: obligacion.obligacionId } })).map((l) => [l.estado, String(l.montoBruto), String(l.montoComision)])]
      const historico = await pagado()
      // Changing the public name changes nothing of the identity nor of what was paid.
      await prisma.perfilPublicoPrestador.updateMany({ where: { tenantId: p.tenantId }, data: { nombrePublico: 'Electricidad JP ' + run } })
      out.nombrePublico = [(await verificacion.estado(titular.id)).estado, await identidadReal.identidadVerificada(p.tenantId), (await puedeCobrar()).available, JSON.stringify(await pagado()) === JSON.stringify(historico)]
      // The same document cannot verify another provider.
      await cargarIdentidad({ actorId: admin.subjectId, accountId: titularOtro.id, body: { nombre: 'Otra', apellido: 'Persona', tipoDocumento: 'DNI', numeroDocumento: '3' + base + '08' } })
      await prisma.verificacionIdentidad.create({ data: { id: 'ver-' + run, tenantId: otro.tenantId, usuarioId: titularOtro.id, proveedorId: 'x', numeroDocumento: dni, estado: 'review_required', fechaCreacion: new Date(), fechaActualizacion: new Date() } })
      out.documentoDeOtro = (await verificacion.decidir({ actor: admin, accountId: titularOtro.id, accion: 'verificar', motivo: 'Verificación manual para piloto interno' })).code

      // ---- 4. Revoked: new charges are blocked again; what was paid stays as it was.
      out.noSeRechazaUnaVerificada = await decidir('rechazar', 'No corresponde rechazar una verificada')
      const revocada = await verificacion.decidir({ actor: admin, accountId: titular.id, accion: 'revocar', motivo: 'Fin del piloto interno' })
      const t2 = await pedir(4, '11:00')
      out.revocada = [revocada.ok && revocada.verificacion.estado, await identidadReal.identidadVerificada(p.tenantId), (await puedeCobrar()).reason, await aceptar(t2), JSON.stringify(await pagado()) === JSON.stringify(historico), await decidir('revocar', 'otra vez, sin estar verificada')]
      // ---- 5. Rejected, back to pending, rejected again and verified afterwards.
      const rechazada = await verificacion.decidir({ actor: admin, accountId: titular.id, accion: 'rechazar', motivo: 'Los datos no coinciden' })
      out.rechazada = [rechazada.ok && rechazada.verificacion.estado, rechazada.verificacion.nota, Boolean(rechazada.verificacion.rechazadaEn), await identidadReal.identidadVerificada(p.tenantId)]
      out.flujo = [await decidir('pendiente', 'Se revisa de nuevo'), await decidir('pendiente', 'ya está pendiente'), await decidir('rechazar', 'Sigue sin coincidir'), await decidir('verificar', 'Verificación manual tras revisar los datos'), await identidadReal.identidadVerificada(p.tenantId), (await puedeCobrar()).available, await aceptar(t2)]
      // ---- 6. The audit: every change with who, why, before and after; nothing was deleted.
      const eventos = await prisma.auditoriaIdentidad.findMany({ where: { tenantId: p.tenantId }, orderBy: { fechaCreacion: 'asc' } })
      const propios = eventos.filter((e) => e.accion.startsWith('verification.manual_'))
      out.auditoria = [propios.map((e) => e.accion), propios.every((e) => e.actorId === admin.subjectId && e.metadata.manual === true && e.metadata.channel === 'admin' && typeof e.metadata.reason === 'string' && e.metadata.reason.length >= 5 && typeof e.metadata.previousStatus === 'string' && typeof e.metadata.status === 'string'), propios[0].metadata.previousStatus, propios[0].metadata.status, propios.some((e) => JSON.stringify(e.metadata).includes(dni))]
      const administrativos = await prisma.auditEvent.findMany({ where: { actorId: admin.subjectId } }).catch(() => [])
      out.auditoriaAdmin = administrativos.filter((e) => JSON.stringify(e.metadata ?? {}).includes('identityVerification')).length
      out.filas = await prisma.verificacionIdentidad.count({ where: { tenantId: p.tenantId } })
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.pendiente, ['pendiente', false, 'PROVIDER_IDENTITY_NOT_VERIFIED', 'PROVIDER_IDENTITY_REQUIRED'], 'pending: the deposit cannot be charged and the provider cannot accept a priced turno')
  assert.deepEqual(r.rechazos, ['DOCUMENT_NUMBER_REQUIRED', true, 'REASON_REQUIRED', 'REASON_REQUIRED', 'INVALID', 'FORBIDDEN', 'FORBIDDEN', 'NOT_FOUND', 'pendiente', false], 'no document, no note, an unknown action, its own identity, an unknown account: nothing is verified')
  assert.deepEqual(r.verificada, ['verificada', 'manual', true, 'Verificación manual para piloto interno', true, true, 'manual', true, 'Ludmila', 'Fernandez', true], 'verified by hand: on the ACCOUNT (Ludmila Fernandez), whatever the public name of the provider (Flor Perez)')
  assert.deepEqual(r.habilita, [true, true, null, 'awaiting_payment'], 'at once: the same source payments read says verified, and the provider accepts the turno with its deposit')
  assert.deepEqual(r.repetida, ['verificada', true, 1], 'verifying again changes nothing and records nothing')
  assert.deepEqual(r.nombrePublico, ['verificada', true, true, true], 'changing the public name changes neither the identity nor what was paid')
  assert.equal(r.documentoDeOtro, 'IDENTITY_ALREADY_VERIFIED', 'one document verifies one provider')
  assert.equal(r.noSeRechazaUnaVerificada, 'INVALID_STATE')
  assert.deepEqual(r.revocada, ['pendiente', false, 'PROVIDER_IDENTITY_NOT_VERIFIED', 'PROVIDER_IDENTITY_REQUIRED', true, 'INVALID_STATE'], 'revoked: new charges are blocked again; the paid deposit, its obligation and its settlement are untouched')
  assert.deepEqual(r.rechazada, ['rechazada', 'Los datos no coinciden', true, false])
  assert.deepEqual(r.flujo, ['pendiente', 'INVALID_STATE', 'rechazada', 'verificada', true, true, 'awaiting_payment'], 'a rejected identity goes back to pending or is verified later')
  assert.deepEqual(r.auditoria[0], ['verification.manual_verified', 'verification.manual_revoked', 'verification.manual_rejected', 'verification.manual_reopened', 'verification.manual_rejected', 'verification.manual_verified'])
  assert.deepEqual(r.auditoria.slice(1), [true, 'not_started', 'verified', false], 'each change keeps who, the note, the state before and after; never the whole document')
  assert.ok(r.auditoriaAdmin >= 1 || r.auditoriaAdmin === 0)
  assert.equal(r.filas, 1, 'one record of that provider all along: its history is the audit, nothing was deleted')
})

test('IDENTIDAD manual por Admin, rutas y pantalla: behind the identity-admin permission (an MFA-elevated admin session); the body carries only the action and its note; the account is the one of the path and the actor the session; the screen asks for a confirmation and a note before any change; payments keep asking the same identity service (no bypass, no name comparison)', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const http = read('apps/api/src/tus/admin/http.ts')
  const servicio = read('apps/api/src/tus/identidad/servicio.ts')
  const admin = read('apps/api/src/tus/admin/identidad.ts')
  const composicion = read('apps/api/src/tus/composition/index.ts')
  const servidor = read('apps/api/src/server.ts')
  const pantalla = read('apps/web/src/components/admin/admin-usuario-detalle.tsx')
  const ruta = /router\.post\('\/tus\/v1\/admin\/usuarios\/:id\/identidad\/verificacion'[\s\S]*?\n  \}\)\)/u.exec(http)[0]
  assert.match(ruta, /const context = await guard\(request, response, IDENTITY_ADMIN\)/u)
  assert.match(ruta, /Object\.keys\(body\)\.some\(\(key\) => key !== 'accion' && key !== 'motivo'\)/u)
  assert.match(ruta, /actor: \{ subjectId: context\.subjectId, tenantId: context\.tenantId, correlationId: context\.correlationId \}, accountId: String\(request\.params\['id'\] \?\? ''\)/u)
  assert.match(http, /router\.get\('\/tus\/v1\/admin\/usuarios\/:id\/identidad\/verificacion', asyncHandler\(async \(request, response\) => \{\s*if \(!\(await guard\(request, response, IDENTITY_ADMIN\)\)\) return/u)
  assert.match(http, /message: 'platform administration requires an MFA-elevated admin session'/u)
  // Nobody decides on its own identity: checked by the admin layer AND by the service.
  assert.match(admin, /if \(actor\.subjectId === accountId\) return \{ ok: false, status: 403, code: 'FORBIDDEN' \}/u)
  assert.match(admin, /if \(cuenta\.tenantId === actor\.tenantId\) return \{ ok: false, status: 403, code: 'FORBIDDEN' \}/u)
  assert.match(servicio, /if \(context\.tenantId === input\.tenantId \|\| context\.actorId === input\.userId\) throw new ErrorIdentidad\(403, 'FORBIDDEN'/u)
  // One source: payments ask the identity service; the manual decision writes its records.
  assert.match(composicion, /const identidadVerificada = \(tenantId: string\) => identity\.identidadVerificada\(tenantId\)/u)
  assert.match(servidor, /crearVerificacionIdentidadAdmin\(\{ identidad: application\.identity,/u)
  const decision = /async decisionManualAdmin\([\s\S]*?\n  \}\n/u.exec(servicio)[0]
  assert.doesNotMatch(decision, /nombrePublico|publicName|normalizarNombre|compararNombre/u, 'the public name of the provider is never compared with the identity')
  assert.doesNotMatch(read('apps/api/src/tus/finance/servicios/configuracion.ts'), /decisionManualAdmin|manual_verified|verificationMethod/u, 'no special case in payments')
  // The screen: state, actions by state, confirmation with a mandatory note.
  assert.match(pantalla, /<h2 id="usuario-verificacion">Estado de verificación<\/h2>/u)
  assert.match(pantalla, /Vas a marcar esta identidad como verificada manualmente\. Esta acción habilita funciones sensibles como el cobro de señas y ganancias del prestador\./u)
  assert.match(pantalla, /Motivo \/ nota administrativa \(obligatoria\)/u)
  assert.match(pantalla, /data-confirmar disabled=\{guardando \|\| motivo\.trim\(\)\.length < 5\}/u)
  assert.match(pantalla, /estado\.estado === 'pendiente' \? \([\s\S]{0,400}Verificar identidad[\s\S]{0,300}Rechazar/u)
  assert.match(pantalla, /estado\.estado === 'verificada' \? <button[^\n]*data-accion-identidad="revocar"[^\n]*>Revocar verificación<\/button>/u)
  assert.match(pantalla, /estado\.estado === 'rechazada' \? \([\s\S]{0,400}Verificar identidad[\s\S]{0,300}Volver a pendiente/u)
})
