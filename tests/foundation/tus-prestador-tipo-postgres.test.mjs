import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// PRESTADOR-TIPO-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL): the real admin router and the real operation over Prisma, on a
// provider that has services, a paid and closed turno, earnings, a linked Mercado Pago (offline
// stand-in), an identity record and a review. Changing how it is presented (persona física <->
// empresa) must touch nothing but its type and its public name.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

test('TIPO de prestador PostgreSQL: persona física -> empresa keeps the public name or takes the trade name given; empresa -> persona física takes the first and last name of the holder of the account (refused when it has none); the holder is never rewritten; the same account, provider, services, turnos, earnings, Mercado Pago, identity and reviews; only the administration can; audited', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${turnosPagosSetup(url)}
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { crearRouterAdmin } = await import('./apps/api/src/tus/admin/http.ts')
    const { crearTipoPrestadorAdmin } = await import('./apps/api/src/tus/directorio/tipo-prestador.ts')
    const out = {}
    let server = null
    try {
      // ---- A provider with a history, whose account belongs to Joaquin Daniel Ferretto.
      const p = await prestador('tipo', 'Joaquin Daniel Ferretto', [['Masaje', 30000]])
      const titular = await cliente('titular')
      await prisma.account.update({ where: { id: titular.id }, data: { tenantId: p.tenantId } })
      await prisma.prestador.updateMany({ where: { tenantId: p.tenantId }, data: { cuentaId: titular.id } })
      const usuario = (await prisma.account.findUnique({ where: { id: titular.id } })).userId
      await prisma.user.update({ where: { id: usuario }, data: { firstName: 'Joaquin Daniel', lastName: 'Ferretto' } })
      const ana = await cliente('ana')
      const t = await turnoConCheckout(p, ana, 0, '10:00', 'Masaje')
      // Deposit, service, closing confirmed by the client, balance: a completed, fully paid work.
      let pagos = 7000000 + Math.floor(Math.random() * 900000) * 10
      const aprobar = async (preferencia) => { pagos += 1; mpPayment(String(pagos), preferencia); return ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-tipo-' + pagos })) }
      await aprobar(t.preferencia)
      adelantar(9 * 24 * 3600_000)
      await cierre.finalizar(p.ctx, t.trabajoId, { evidence: 'Servicio prestado completo en el turno acordado.' })
      await cierre.confirmar({ tenantId: ana.tenantId, actorId: ana.id, correlationId: 'c-cli' }, t.trabajoId)
      let checkout = null
      for (let i = 0; !checkout; i += 1) { try { checkout = await turnos.pagarTurno({ clienteId: ana.id, reservaId: t.pedido.id, correlationId: 'c', tramo: 'saldo' }) } catch (e) { if (e?.code !== 'IN_PROGRESS' || i >= 40) throw e; await new Promise((resolve) => setTimeout(resolve, 250)) } }
      const obligacion = await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: t.trabajoId, tramo: 'saldo' } })
      const intencion = await prisma.intencionPago.findFirst({ where: { obligacionId: obligacion.obligacionId }, orderBy: { fechaCreacion: 'desc' } })
      await aprobar(mp.preferences.find((item) => item.body.external_reference === intencion.pagoId))
      await conectarMercadoPago(p, '9933' + String(Math.floor(Math.random() * 90000) + 10000))
      await prisma.verificacionIdentidad.create({ data: { id: run + '-ver', tenantId: p.tenantId, usuarioId: titular.id, proveedorId: 'manual', numeroDocumento: '30' + String(Math.floor(Math.random() * 900000) + 100000), metodoVerificacion: 'manual', estado: 'verified', fechaCreacion: new Date(), verificadaEn: new Date(), fechaActualizacion: new Date() } })
      // The work of a turno stays 'accepted' in this wiring; a review needs a completed work, so the
      // work is put in progress here and completed by the real operation of the final payment.
      await prisma.trabajo.updateMany({ where: { trabajoId: t.trabajoId }, data: { estado: 'in_progress' } })
      const eco = await fin.estadoEconomico({ tenantId: ana.tenantId, trabajoId: t.trabajoId })
      const paso = await work.completarPorPagoFinal({ work: new PrismaTrabajoStore(prisma), outbox: new PrismaTrabajoOutboxStore(prisma) }, { tenantId: ana.tenantId, trabajoId: t.trabajoId, paymentId: 'pago-final-' + run, correlationId: 'c', createdAt: new Date().toISOString() }).catch((e) => 'error ' + (e?.code ?? e?.message))
      const trabajo = await prisma.trabajo.findFirst({ where: { trabajoId: t.trabajoId } })
      if (trabajo.estado !== 'completed') throw new Error('trabajo ' + trabajo.estado + ' / ' + paso + ' / pagado ' + eco.fullyPaid + ' / ' + trabajo.tenantId + ' ' + ana.tenantId)
      await prisma.calificacionTrabajo.create({ data: { id: run + '-cal', tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId, prestadorTenantId: trabajo.prestadorTenantId, prestadorId: trabajo.prestadorId, autorCuentaId: ana.id, puntuacion: 5, comentario: 'Excelente', fechaCreacion: new Date() } })

      // ---- The real admin router, with the administration, another provider and a client.
      const sesiones = {
        admin: { subjectId: 'admin-' + run, tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin', 'tus:identity:admin'], correlationId: 'c-admin' },
        otro: { subjectId: ana.id, tenantId: ana.tenantId, sessionId: 's2', roles: ['owner'], permissions: ['tus:marketplace:write'], correlationId: 'c-otro' },
        titular: { subjectId: titular.id, tenantId: p.tenantId, sessionId: 's3', roles: ['owner'], permissions: ['tus:marketplace:write'], correlationId: 'c-titular' },
      }
      const tipoPrestador = crearTipoPrestadorAdmin(prisma)
      const leer = async (id) => { const perfil = await prisma.perfilPublicoPrestador.findUnique({ where: { id } }); return perfil ? { perfil: { id: perfil.id, displayName: perfil.nombrePublico, providerType: perfil.tipoPrestador }, tenantId: perfil.tenantId, prestador: null } : null }
      const app = express(); app.use(express.json())
      app.use(crearRouterAdmin({ sessions: { resolve: async (token) => sesiones[token] ?? null }, directorio: { ubicacionDePerfil: async () => null }, solicitudes: {}, cuentas: {}, actividad: {}, adminEmails: () => [], prestadorAdmin: { leer, guardar: async () => ({ status: 200 }) }, tipoPrestador }))
      server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
      const cambiar = async (cuerpo, token = 'admin', id = p.perfilId) => {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/tus/v1/admin/prestadores/' + id + '/tipo', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'c', 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
        const body = await response.json().catch(() => null)
        return response.ok ? [response.status, body.tipoPrestador, body.perfil.displayName, body.cambio, body.titular?.nombreCompleto] : [response.status, body?.error?.code]
      }
      // Everything that must NOT change: every column of every row (the profile aside).
      const texto = (filas) => JSON.stringify(filas, (_clave, valor) => (typeof valor === 'bigint' ? valor.toString() : valor))
      const historia = async () => ({
        cuenta: await prisma.account.findMany({ where: { id: titular.id } }),
        usuario: await prisma.user.findMany({ where: { id: usuario } }),
        prestador: await prisma.prestador.findMany({ where: { tenantId: p.tenantId } }),
        servicios: await prisma.perfilServicio.findMany({ where: { perfilId: p.perfilId }, orderBy: { oficioId: 'asc' } }),
        tarifas: await prisma.tarifaServicioPrestador.findMany({ where: { perfilId: p.perfilId }, orderBy: { id: 'asc' } }),
        calendarios: await prisma.calendario.findMany({ where: { tenantId: p.tenantId }, orderBy: { id: 'asc' } }),
        reservas: await prisma.reserva.findMany({ where: { tenantId: p.tenantId }, orderBy: { id: 'asc' } }),
        trabajos: await prisma.trabajo.findMany({ where: { prestadorTenantId: p.tenantId }, orderBy: { trabajoId: 'asc' } }),
        obligaciones: await prisma.obligacionPagoServicio.findMany({ where: { trabajoId: t.trabajoId }, orderBy: { obligacionId: 'asc' } }),
        liquidaciones: await prisma.liquidacionServicio.findMany({ where: { trabajoId: t.trabajoId }, orderBy: { obligacionId: 'asc' } }),
        movimientos: await prisma.movimientoGananciaPrestador.findMany({ where: { prestadorTenantId: p.tenantId }, orderBy: { movimientoId: 'asc' } }),
        mercadoPago: await prisma.cuentaCobroPrestador.findMany({ where: { prestadorTenantId: p.tenantId } }),
        credencialMercadoPago: await prisma.credencialCuentaCobro.findMany({ where: { prestadorTenantId: p.tenantId } }),
        identidad: await prisma.verificacionIdentidad.findMany({ where: { tenantId: p.tenantId } }),
        opiniones: await prisma.calificacionTrabajo.findMany({ where: { prestadorTenantId: p.tenantId } }),
      })
      const perfilSinTipo = async () => { const { tipoPrestador: _t, nombrePublico: _n, fechaActualizacion: _f, ...resto } = await prisma.perfilPublicoPrestador.findUnique({ where: { id: p.perfilId } }); return resto }
      const antes = await historia()
      const perfilAntes = await perfilSinTipo()
      const saldoAntes = await saldo(p)
      out.hayHistoria = Object.fromEntries(Object.entries(antes).map(([clave, filas]) => [clave, filas.length]))
      const fila = () => prisma.perfilPublicoPrestador.findUnique({ where: { id: p.perfilId } })
      out.inicial = [(await fila()).tipoPrestador, (await fila()).nombrePublico]

      // ---- Who can.
      out.permisos = [await cambiar({ tipo: 'empresa' }, 'nadie'), await cambiar({ tipo: 'empresa' }, 'otro'), await cambiar({ tipo: 'empresa' }, 'titular'), (await fila()).tipoPrestador]
      // ---- What is refused.
      out.invalidos = [await cambiar({ tipo: 'sociedad' }), await cambiar({}), await cambiar({ tipo: 'empresa', nombrePublico: 'A' }), await cambiar({ tipo: 'empresa', nombrePublico: 'Llamame al 3794123456' }), await cambiar({ tipo: 'empresa', tenantId: 'otro' }), await cambiar({ tipo: 'empresa' }, 'admin', 'perfil-inexistente'), (await fila()).tipoPrestador]
      // ---- 1. Persona física -> Empresa, keeping the name.
      out.aEmpresaSinNombre = await cambiar({ tipo: 'empresa' })
      out.aEmpresaVacio = await cambiar({ tipo: 'empresa', nombrePublico: '   ' })
      // ---- 2. ... and with a trade name: the holder is not rewritten.
      out.aEmpresaConNombre = await cambiar({ tipo: 'empresa', nombrePublico: '  Ferretto   Servicios ', motivo: 'Factura como empresa' })
      const u1 = await prisma.user.findUnique({ where: { id: usuario } })
      out.titularIntacto = [u1.firstName, u1.lastName, u1.displayName === antes.usuario[0].displayName]
      // ---- 3. Empresa -> Persona física: the name of the holder; a typed name is ignored.
      out.aPersona = await cambiar({ tipo: 'persona_fisica', nombrePublico: 'Nombre Tipeado', motivo: 'Vuelve a trabajar a su nombre' })
      out.sinCambio = await cambiar({ tipo: 'persona_fisica' })
      // ---- 9. Round trip again, on the same provider.
      out.idaYVuelta = [await cambiar({ tipo: 'empresa', nombrePublico: 'Ferretto Servicios' }), await cambiar({ tipo: 'persona_fisica' })]
      // ---- 5. Nothing else changed, column by column.
      const despues = await historia()
      out.identico = Object.fromEntries(Object.keys(antes).map((clave) => [clave, texto(antes[clave]) === texto(despues[clave])]))
      out.perfilIgual = texto(await perfilSinTipo()) === texto(perfilAntes)
      out.saldoIgual = JSON.stringify(await saldo(p)) === JSON.stringify(saldoAntes)
      out.unSoloPerfil = [await prisma.perfilPublicoPrestador.count({ where: { tenantId: p.tenantId } }), await prisma.prestador.count({ where: { tenantId: p.tenantId } }), (await fila()).id === p.perfilId, (await fila()).prestadorId === p.prestadorId]
      // ---- 4. Empresa -> Persona física when the holder has no first and last name.
      await cambiar({ tipo: 'empresa', nombrePublico: 'Ferretto Servicios' })
      await prisma.user.update({ where: { id: usuario }, data: { lastName: null } })
      out.sinApellido = [await cambiar({ tipo: 'persona_fisica' }), (await fila()).tipoPrestador, (await fila()).nombrePublico]
      await prisma.user.update({ where: { id: usuario }, data: { firstName: 'Maximiliano Sebastian Alejandro Fernando', lastName: 'Fernandez Rodriguez de la Fuente y Gonzalez' } })
      out.nombreLargo = await cambiar({ tipo: 'persona_fisica' })
      await prisma.prestador.updateMany({ where: { tenantId: p.tenantId }, data: { cuentaId: null } })
      out.sinCuenta = await cambiar({ tipo: 'persona_fisica' })
      // ---- 8. The audit.
      const eventos = await prisma.auditEvent.findMany({ where: { tenantId: p.tenantId, eventType: { startsWith: 'provider.' } }, orderBy: { occurredAt: 'asc' } })
      out.auditoria = eventos.map((e) => [e.eventType, e.actorId === sesiones.admin.subjectId, e.metadata.perfilId === p.perfilId, e.metadata.prestadorId === p.prestadorId, e.metadata.previousType, e.metadata.newType, e.metadata.previousPublicName, e.metadata.newPublicName, e.metadata.reason ?? null, e.metadata.holderAccountId === titular.id, e.occurredAt instanceof Date])
      out.restriccion = await sqlError('UPDATE public."perfiles_publicos_prestador" SET "tipo_prestador" = $1 WHERE "id" = $2', ['sociedad', p.perfilId])
    } finally { if (server) await new Promise((resolve) => server.close(resolve)); await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.ok(Object.values(r.hayHistoria).every((n) => n >= 1), `there is something of everything to compare (${JSON.stringify(r.hayHistoria)})`)
  assert.deepEqual(r.inicial, ['persona_fisica', 'Joaquin Daniel Ferretto'], 'an existing provider is a person until the administration says otherwise')
  assert.deepEqual(r.permisos, [[401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [403, 'FORBIDDEN'], 'persona_fisica'], 'no session, another user and the provider itself: none of them changes the type')
  assert.deepEqual(r.invalidos, [[422, 'INVALID_TYPE'], [422, 'INVALID_TYPE'], [422, 'INVALID_PUBLIC_NAME'], [422, 'INVALID_PUBLIC_NAME'], [422, 'INVALID_CHANGE'], [404, 'NOT_FOUND'], 'persona_fisica'])
  assert.deepEqual(r.aEmpresaSinNombre, [200, 'empresa', 'Joaquin Daniel Ferretto', true, 'Joaquin Daniel Ferretto'], 'to Empresa with no name given: the public name it had')
  assert.deepEqual(r.aEmpresaVacio, [200, 'empresa', 'Joaquin Daniel Ferretto', false, 'Joaquin Daniel Ferretto'], 'an empty name is "no name given"; nothing to change')
  assert.deepEqual(r.aEmpresaConNombre, [200, 'empresa', 'Ferretto Servicios', true, 'Joaquin Daniel Ferretto'], 'a trade name becomes the public name')
  assert.deepEqual(r.titularIntacto, ['Joaquin Daniel', 'Ferretto', true], 'the holder of the account is never rewritten')
  assert.deepEqual(r.aPersona, [200, 'persona_fisica', 'Joaquin Daniel Ferretto', true, 'Joaquin Daniel Ferretto'], 'to Persona física: the first and last name of the holder (a typed name is ignored)')
  assert.deepEqual(r.sinCambio, [200, 'persona_fisica', 'Joaquin Daniel Ferretto', false, 'Joaquin Daniel Ferretto'])
  assert.deepEqual(r.idaYVuelta, [[200, 'empresa', 'Ferretto Servicios', true, 'Joaquin Daniel Ferretto'], [200, 'persona_fisica', 'Joaquin Daniel Ferretto', true, 'Joaquin Daniel Ferretto']])
  assert.ok(Object.values(r.identico).every(Boolean), `no other row changed (${JSON.stringify(r.identico)})`)
  assert.equal(r.perfilIgual, true, 'of the profile only its type, its public name and its update date changed')
  assert.equal(r.saldoIgual, true, 'the same balance')
  assert.deepEqual(r.unSoloPerfil, [1, 1, true, true], 'the same profile and the same provider: nothing recreated')
  assert.deepEqual(r.sinApellido, [[409, 'HOLDER_NAME_REQUIRED'], 'empresa', 'Ferretto Servicios'], 'with no first and last name on the account the change is refused; nothing is made up')
  assert.deepEqual(r.nombreLargo, [409, 'HOLDER_NAME_TOO_LONG'])
  assert.deepEqual(r.sinCuenta, [409, 'HOLDER_NAME_REQUIRED'], 'a provider with no linked account has no holder to take the name from')
  assert.deepEqual(r.auditoria, [
    ['provider.type_changed', true, true, true, 'persona_fisica', 'empresa', 'Joaquin Daniel Ferretto', 'Joaquin Daniel Ferretto', null, true, true],
    ['provider.public_name_changed', true, true, true, 'empresa', 'empresa', 'Joaquin Daniel Ferretto', 'Ferretto Servicios', 'Factura como empresa', true, true],
    ['provider.type_changed', true, true, true, 'empresa', 'persona_fisica', 'Ferretto Servicios', 'Joaquin Daniel Ferretto', 'Vuelve a trabajar a su nombre', true, true],
    ['provider.type_changed', true, true, true, 'persona_fisica', 'empresa', 'Joaquin Daniel Ferretto', 'Ferretto Servicios', null, true, true],
    ['provider.type_changed', true, true, true, 'empresa', 'persona_fisica', 'Ferretto Servicios', 'Joaquin Daniel Ferretto', null, true, true],
    ['provider.type_changed', true, true, true, 'persona_fisica', 'empresa', 'Joaquin Daniel Ferretto', 'Ferretto Servicios', null, true, true],
  ], 'every change with who, the provider, the type and the public name before and after; a request that changes nothing is not an event')
  assert.equal(r.restriccion, 'ck_perfiles_publicos_prestador_tipo')
})

test('TIPO de prestador, cableado, migración y pantalla: the route is of the platform administration and takes a closed body; the operation writes only the type and the public name of the profile; the type is no gate anywhere; the migration is additive; the screen shows holder, type and public name apart, previews the name and asks before changing', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const http = read('apps/api/src/tus/admin/http.ts')
  const ruta = /router\.post\('\/tus\/v1\/admin\/prestadores\/:id\/tipo'[\s\S]*?\n  \}\)\)/u.exec(http)[0]
  assert.match(ruta, /const context = await guard\(request, response\)/u)
  assert.match(ruta, /key !== 'tipo' && key !== 'nombrePublico' && key !== 'motivo'/u)
  const operacion = read('apps/api/src/tus/directorio/tipo-prestador.ts')
  const codigo = operacion.replace(/^\s*\/\/.*$/gmu, '')
  assert.deepEqual([...codigo.matchAll(/tx\.(\w+)\.(update|create|delete|upsert|updateMany|deleteMany)\(/gu)].map((m) => m[1] + '.' + m[2]).sort(), ['auditEvent.create', 'perfilPublicoPrestador.update'], 'it writes the profile and its audit, nothing else')
  assert.match(codigo, /data: \{ tipoPrestador: tipo, nombrePublico, fechaActualizacion: ahora \}/u)
  assert.match(codigo, /if \(!actor\.permissions\.includes\('tus:providers:admin'\)\) return \{ ok: false, status: 403, code: 'FORBIDDEN' \}/u)
  // The type decides nothing about working, charging or withdrawing.
  for (const archivo of ['apps/api/src/tus/finance/servicios/configuracion.ts', 'apps/api/src/tus/finance/servicios/ganancias.ts', 'apps/api/src/tus/finance/servicios/cuentas-cobro.ts', 'apps/api/src/tus/calendar/turnos-service.ts', 'apps/api/src/tus/catalog/index.ts', 'apps/api/src/tus/application/tus-application-service.ts'])
    assert.doesNotMatch(read(archivo), /tipoPrestador|tipo_prestador|persona_fisica/u, archivo)
  const sql = read('apps/api/prisma/migrations/20261121100000_tus_prestador_tipo/migration.sql').replace(/^--.*$/gmu, '')
  assert.match(sql, /ADD COLUMN "tipo_prestador" text NOT NULL DEFAULT 'persona_fisica'/u)
  assert.match(sql, /CHECK \("tipo_prestador" IN \('persona_fisica', 'empresa'\)\)/u)
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE|TRUNCATE/iu)
  const pantalla = read('apps/web/src/components/admin/admin-prestador-detalle.tsx')
  for (const texto of ['Titular de la cuenta', 'Nombre público del prestador', 'El nombre público pasará a:', 'Podés cambiarlo por el nombre comercial de la empresa', 'Sus servicios, turnos e historial no se modificarán.', "El prestador pasará a Persona física y su nombre público será ${titular}.", 'El prestador pasará a Empresa.']) assert.ok(pantalla.includes(texto), texto)
  assert.match(pantalla, /if \(tipo === actual\) return void enviar\(\)\n    pedir\(\{/u, 'a change of type is confirmed first')
  assert.match(pantalla, /disabled=\{guardando \|\| sinCambios \|\| \(tipo === 'persona_fisica' && !titular\)\}/u)
})
