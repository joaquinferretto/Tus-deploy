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
      // ---- The name of a person: EVERY first and last name of its holder, capitalized. It follows
      //      the holder when the account changes its name, and comes back after being a business.
      await prisma.user.update({ where: { id: usuario }, data: { firstName: '  florencia   MARIA ', lastName: 'fernandez  GOMEZ' } })
      out.regla = await tipoPrestador.reglaNombre(p.tenantId)
      out.sigueAlTitular = [await tipoPrestador.sincronizarTitular(titular.id), (await fila()).nombrePublico, await tipoPrestador.sincronizarTitular(titular.id), await tipoPrestador.sincronizarTitular(ana.id), (await tipoPrestador.estado(p.perfilId)).titular.nombreCompleto]
      out.recupera = [await cambiar({ tipo: 'empresa', nombrePublico: 'Flor Servicios' }), await tipoPrestador.reglaNombre(p.tenantId), await tipoPrestador.sincronizarTitular(titular.id), await cambiar({ tipo: 'persona_fisica', nombrePublico: 'Nombre Comercial' }), (await fila()).id === p.perfilId]
      await prisma.user.update({ where: { id: usuario }, data: { firstName: 'Joaquin Daniel', lastName: 'Ferretto' } })
      await tipoPrestador.sincronizarTitular(titular.id)
      // A provider with no profile yet: a person when its holder has a name to derive, else free.
      const nuevoTenant = run + '-tenant-nuevo'
      await prisma.tusTenant.create({ data: { id: nuevoTenant, slug: nuevoTenant, name: 'Nuevo', status: 'active', createdAt: new Date(), updatedAt: new Date() } })
      const nuevo = await cliente('nuevo')
      const usuarioNuevo = (await prisma.account.findUnique({ where: { id: nuevo.id } })).userId
      await prisma.account.update({ where: { id: nuevo.id }, data: { tenantId: nuevoTenant } })
      await prisma.user.update({ where: { id: usuarioNuevo }, data: { firstName: null, lastName: null } })
      await prisma.prestador.create({ data: { id: run + '-p-nuevo', tenantId: nuevoTenant, prestadorId: run + '-prestador-nuevo', cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', cuentaId: nuevo.id, fechaCreacion: new Date(), fechaActualizacion: new Date() } })
      out.reglaSinPerfil = [await tipoPrestador.reglaNombre(nuevoTenant)]
      await prisma.user.update({ where: { id: usuarioNuevo }, data: { firstName: 'ana', lastName: "o'connor-díaz" } })
      out.reglaSinPerfil.push(await tipoPrestador.reglaNombre(nuevoTenant), await tipoPrestador.reglaNombre(run + '-tenant-que-no-existe'))

      // ---- The migration, on profiles that existed before it: its two UPDATE, word for word,
      //      limited to the tenants of this scenario.
      const { nombrePublicoPersonaFisica } = await import('./packages/contracts/src/tus-directorio.ts')
      const sentencias = (await import('node:fs')).readFileSync('./apps/api/prisma/migrations/20261121100000_tus_prestador_tipo/migration.sql', 'utf8').split(String.fromCharCode(10)).filter((linea) => !linea.startsWith('--')).join(' ').split(';').map((x) => x.trim()).filter(Boolean)
      const previo = async (tag, publico, titularDe) => {
        const m = await prestador('m' + tag, publico, [['Masaje', 30000]])
        if (titularDe) {
          const cuenta = await cliente('m' + tag)
          const u = (await prisma.account.findUnique({ where: { id: cuenta.id } })).userId
          await prisma.user.update({ where: { id: u }, data: { firstName: titularDe[0], lastName: titularDe[1] } })
          if (titularDe[2] !== 'otro-tenant') await prisma.account.update({ where: { id: cuenta.id }, data: { tenantId: m.tenantId } })
          await prisma.prestador.updateMany({ where: { tenantId: m.tenantId }, data: { cuentaId: cuenta.id } })
        }
        return m
      }
      const previos = [
        await previo('1', 'florencia  FERNANDEZ', ['Florencia', 'fernandez']),
        await previo('2', "maría josé  O'CONNOR-díaz", [' maría  josé', "o'connor-díaz "]),
        await previo('3', 'Plomería Rápida', ['Carlos', 'Mendez']),
        await previo('4', 'veronica rodriguez', null),
        await previo('5', 'Ana Gomez', ['Ana', null]),
        await previo('6', 'Luis Paz', ['Luis', 'Paz', 'otro-tenant']),
      ]
      out.sentencias = [sentencias.length, sentencias.slice(2).every((x) => x.startsWith('UPDATE public."perfiles_publicos_prestador" AS perfil'))]
      for (const sentencia of sentencias.slice(2)) await db.query(sentencia + ' AND perfil."tenant_id" = ANY($1)', [previos.map((m) => m.tenantId)])
      out.migrados = []
      for (const m of previos) { const x = await prisma.perfilPublicoPrestador.findUnique({ where: { id: m.perfilId } }); out.migrados.push([x.tipoPrestador, x.nombrePublico]) }
      // What the application writes for those two the next time they are saved.
      out.comoElHelper = [await tipoPrestador.reglaNombre(previos[0].tenantId), await tipoPrestador.reglaNombre(previos[1].tenantId), nombrePublicoPersonaFisica(' maría  josé', "o'connor-díaz ")]

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
      out.auditoria = eventos.map((e) => [e.eventType, e.actorId === sesiones.admin.subjectId ? 'admin' : e.actorId === titular.id ? 'titular' : e.actorId, e.metadata.previousType, e.metadata.newType, e.metadata.previousPublicName, e.metadata.newPublicName, e.metadata.reason ?? null, e.metadata.perfilId === p.perfilId && e.metadata.prestadorId === p.prestadorId && e.metadata.holderAccountId === titular.id && e.occurredAt instanceof Date])
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
  assert.deepEqual(r.regla, { tipo: 'persona_fisica', nombre: 'Florencia Maria Fernandez Gomez' }, 'every first name and every last name, capitalized, spaces collapsed')
  assert.deepEqual(r.sigueAlTitular, [true, 'Florencia Maria Fernandez Gomez', false, false, 'Florencia Maria Fernandez Gomez'], 'the provider follows its holder when the account changes its name; once; an account that is behind no provider changes nothing')
  assert.deepEqual(r.recupera, [[200, 'empresa', 'Flor Servicios', true, 'Florencia Maria Fernandez Gomez'], { tipo: 'empresa', nombre: null }, false, [200, 'persona_fisica', 'Florencia Maria Fernandez Gomez', true, 'Florencia Maria Fernandez Gomez'], true], 'a business keeps its trade name whatever its holder is called; back to a person it recovers the full name of the holder (the trade name sent is ignored), on the same profile')
  assert.deepEqual(r.reglaSinPerfil, [{ tipo: 'empresa', nombre: null }, { tipo: 'persona_fisica', nombre: "Ana O'Connor-Díaz" }, { tipo: 'empresa', nombre: null }], 'a new provider is a person only when there is a name to derive')
  assert.deepEqual(r.sentencias, [3, true])
  assert.deepEqual(r.migrados, [
    ['persona_fisica', 'florencia  FERNANDEZ'],
    ['persona_fisica', "maría josé  O'CONNOR-díaz"],
    ['empresa', 'Plomería Rápida'],
    ['empresa', 'veronica rodriguez'],
    ['empresa', 'Ana Gomez'],
    ['empresa', 'Luis Paz'],
  ], 'the migration: a person only when the public name already is the full name of its one, active, own-tenant holder (ignoring case and spaces); every other profile is a business; no public name is written by the migration')
  assert.deepEqual(r.comoElHelper, [{ tipo: 'persona_fisica', nombre: 'Florencia Fernandez' }, { tipo: 'persona_fisica', nombre: "María José O'Connor-Díaz" }, "María José O'Connor-Díaz"], 'their capitalization is the one of the helper the next time they are saved')
  const A = 'Joaquin Daniel Ferretto', F = 'Florencia Maria Fernandez Gomez'
  assert.deepEqual(r.auditoria, [
    ['provider.type_changed', 'admin', 'persona_fisica', 'empresa', A, A, null, true],
    ['provider.public_name_changed', 'admin', 'empresa', 'empresa', A, 'Ferretto Servicios', 'Factura como empresa', true],
    ['provider.type_changed', 'admin', 'empresa', 'persona_fisica', 'Ferretto Servicios', A, 'Vuelve a trabajar a su nombre', true],
    ['provider.type_changed', 'admin', 'persona_fisica', 'empresa', A, 'Ferretto Servicios', null, true],
    ['provider.type_changed', 'admin', 'empresa', 'persona_fisica', 'Ferretto Servicios', A, null, true],
    ['provider.public_name_changed', 'titular', 'persona_fisica', 'persona_fisica', A, F, 'holder_name_changed', true],
    ['provider.type_changed', 'admin', 'persona_fisica', 'empresa', F, 'Flor Servicios', null, true],
    ['provider.type_changed', 'admin', 'empresa', 'persona_fisica', 'Flor Servicios', F, null, true],
    ['provider.public_name_changed', 'titular', 'persona_fisica', 'persona_fisica', F, A, 'holder_name_changed', true],
    ['provider.type_changed', 'admin', 'persona_fisica', 'empresa', A, 'Ferretto Servicios', null, true],
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
  assert.deepEqual([...codigo.matchAll(/tx\.(\w+)\.(update|create|delete|upsert|updateMany|deleteMany)\(/gu)].map((m) => m[1] + '.' + m[2]).sort(), ['auditEvent.create', 'perfilPublicoPrestador.update', 'perfilPublicoPrestador.update'], 'it writes the profile (its type and its public name) and its audit, nothing else')
  assert.match(codigo, /data: \{ tipoPrestador: tipo, nombrePublico, fechaActualizacion: ahora \}/u)
  assert.match(codigo, /if \(!actor\.permissions\.includes\('tus:providers:admin'\)\) return \{ ok: false, status: 403, code: 'FORBIDDEN' \}/u)
  // The type decides nothing about working, charging or withdrawing.
  for (const archivo of ['apps/api/src/tus/finance/servicios/configuracion.ts', 'apps/api/src/tus/finance/servicios/ganancias.ts', 'apps/api/src/tus/finance/servicios/cuentas-cobro.ts', 'apps/api/src/tus/calendar/turnos-service.ts', 'apps/api/src/tus/catalog/index.ts', 'apps/api/src/tus/application/tus-application-service.ts'])
    assert.doesNotMatch(read(archivo), /tipoPrestador|tipo_prestador|persona_fisica/u, archivo)
  const sql = read('apps/api/prisma/migrations/20261121100000_tus_prestador_tipo/migration.sql').replace(/^--.*$/gmu, '')
  assert.match(sql, /ADD COLUMN "tipo_prestador" text NOT NULL DEFAULT 'persona_fisica'/u)
  assert.match(sql, /CHECK \("tipo_prestador" IN \('persona_fisica', 'empresa'\)\)/u)
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE/iu)
  // It classifies the profiles that exist: only the new column is written, no public name.
  assert.deepEqual([...sql.matchAll(/UPDATE (\S+) AS perfil\s+SET ("\w+")/gu)].map((m) => m[1] + ' ' + m[2]), ['public."perfiles_publicos_prestador" "tipo_prestador"'])
  const pantalla = read('apps/web/src/components/admin/admin-prestador-detalle.tsx')
  for (const texto of ['Titular de la cuenta', 'Nombre público del prestador', 'El nombre público pasará a:', 'Podés cambiarlo por el nombre comercial de la empresa', 'Sus servicios, turnos e historial no se modificarán.', "El prestador pasará a Persona física y su nombre público será ${titular}.", 'El prestador pasará a Empresa.']) assert.ok(pantalla.includes(texto), texto)
  assert.match(pantalla, /if \(tipo === actual\) return void enviar\(\)\n    pedir\(\{/u, 'a change of type is confirmed first')
  assert.match(pantalla, /disabled=\{guardando \|\| sinCambios \|\| \(tipo === 'persona_fisica' && !titular\)\}/u)
  // A person has no field for its public name: neither in the old form of the Admin nor in the
  // form of the provider.
  assert.match(pantalla, /detalle\.tipoPrestador === 'persona_fisica' \? \(\n\s+<div data-nombre-derivado>[\s\S]*?En personas físicas se usa el nombre completo del titular de la cuenta\.[\s\S]*?\) : \(\n\s+<label>Nombre público<input/u)
  const propio = read('apps/web/src/features/provider/provider-public-profile.tsx')
  assert.match(propio, /\{derivedName \? \(\n\s+<div className=\{authStyles\.field\} data-nombre-derivado>[\s\S]*?\) : \(\n\s+<TextField\n\s+error=\{error\('displayName'\)\}/u)
  // The one helper: nobody else capitalizes a name.
  const helper = read('packages/contracts/src/tus-directorio.ts')
  assert.match(helper, /export function capitalizarNombrePropio/u)
  assert.match(operacion, /nombreCompleto: nombrePublicoPersonaFisica\(nombre, apellido\)/u)
  for (const archivo of ['apps/api/src/tus/directorio/tipo-prestador.ts', 'apps/api/src/tus/directorio/servicio.ts', 'apps/web/src/components/admin/admin-prestador-detalle.tsx', 'apps/web/src/features/provider/provider-public-profile.tsx'])
    assert.doesNotMatch(read(archivo), /toUpperCase\(\)|toLocaleUpperCase\(/u, archivo)
  // Two people with the same name are told apart by their profile (photo, services, area, rating),
  // never by a number in the name nor by private data.
  const tarjeta = read('apps/web/src/features/directory/worker-card.tsx')
  for (const dato of ['<Avatar initials={worker.initials} photoUrl={worker.photoUrl}', 'servicesLabel(worker)', 'worker.publicArea', 'ratingLabel(worker.rating)']) assert.ok(tarjeta.includes(dato), dato)
  assert.doesNotMatch(tarjeta, /documento|dni|email|phone|telefono/iu)
  // ALOJAMIENTOS-ADMIN-01: the screen is in the menu of the Admin, as every other module.
  const menu = read('apps/web/src/components/admin/admin-layout.tsx')
  assert.match(menu, /\{ href: '\/tus\/admin\/alojamientos', label: 'Alojamientos' \},/u)
  assert.match(menu, /\{NAV\.map\(\(item\) => \(\n\s+<Link aria-current=\{current\(item\.href\)\} href=\{item\.href as Route\}/u)
})

test('NOMBRE PÚBLICO de una persona física: the helper (every name and last name, capitalized, spaces collapsed, hyphens and apostrophes kept); a person cannot type its public name in any form, the API refuses another name whoever sends it; a business can; a new provider registered by the administration with another name is a business', () => {
  const r = runTypeScriptScenario(`
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const { capitalizarNombrePropio, nombrePublicoPersonaFisica } = await import('./packages/contracts/src/tus-directorio.ts')
    const out = {}
    out.helper = [
      nombrePublicoPersonaFisica('florencia', 'fernandez'),
      nombrePublicoPersonaFisica('florencia maria', 'fernandez gomez'),
      nombrePublicoPersonaFisica('joaquin daniel', 'ferretto'),
      nombrePublicoPersonaFisica('MARIA FLORENCIA', 'FERNANDEZ'),
      nombrePublicoPersonaFisica('  maria   florencia ', ' fernandez   gomez  '),
      nombrePublicoPersonaFisica('JOSÉ maría', "o'CONNOR"),
      nombrePublicoPersonaFisica('ana', 'garcia-lopez'),
      nombrePublicoPersonaFisica('Florencia', ''), nombrePublicoPersonaFisica(null, 'Fernandez'), nombrePublicoPersonaFisica('   ', 'Fernandez'),
      capitalizarNombrePropio('ñandú  ÁLVAREZ'),
    ]
    const merchants = new Map()
    const application = { marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null }, listings: { forTenant: async () => [] } } }, identity: { identidadVerificada: async () => false } }
    const reglas = new Map()
    let seq = 0
    const directorio = crearServicioDirectorio({ application, contarCompletados: async () => 0, newId: () => 'id-' + (++seq), reglaNombre: async (t) => reglas.get(t) })
    const ctx = (tenantId) => ({ tenantId, subjectId: 'actor-' + tenantId, sessionId: 's', roles: ['merchant'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
    const guardar = async (t, nombre, opciones) => { merchants.set(t, { merchantId: 'm-' + t, status: 'approved' }); const x = await directorio.guardarPerfil(ctx(t), { ...(nombre === undefined ? {} : { displayName: nombre }), profession: 'plomeria', zone: 'Centro' }, opciones); return x.ok ? x.perfil.displayName : x.code }
    const F = 'Florencia Maria Fernandez Gomez'
    // A person: the name is the one of its holder, sent or not; another one is refused.
    reglas.set('pf', { tipo: 'persona_fisica', nombre: F })
    out.persona = [await guardar('pf', undefined), await guardar('pf', F), await guardar('pf', ' florencia maria   FERNANDEZ gomez '), await guardar('pf', 'Flor Plomería'), await guardar('pf', 'Flor Plomería', { nombreLibreAlCrear: true }), (await directorio.miPerfil(ctx('pf'))).displayName, await directorio.reglaNombrePublico('pf')]
    const idPf = (await directorio.miPerfil(ctx('pf'))).id
    const admin = await directorio.guardarPerfilAdmin(idPf, { displayName: 'Nombre Puesto Por Admin', profession: 'plomeria', zone: 'Centro' })
    out.personaPorAdmin = [admin.ok ? admin.perfil.displayName : admin.code, (await directorio.miPerfil(ctx('pf'))).displayName]
    // A business: a free name, and it can change it.
    reglas.set('em', { tipo: 'empresa', nombre: null })
    out.empresa = [await guardar('em', 'Plomería Rápida'), await guardar('em', 'Otra Marca'), await guardar('em', 'A'), await directorio.reglaNombrePublico('em')]
    // A NEW provider whose holder has a name: its own form cannot type another one; the
    // administration registering it with another name makes it a business.
    reglas.set('nuevo', { tipo: 'persona_fisica', nombre: 'Carlos Mendez' })
    out.nuevo = [await guardar('nuevo', 'Marca Nueva'), await directorio.miPerfil(ctx('nuevo')), await guardar('nuevo', 'Marca Nueva', { nombreLibreAlCrear: true }), (await directorio.reglaNombrePublico('nuevo')).type]
    // A person whose holder lost its name keeps the stored one; still not typed.
    reglas.set('sn', { tipo: 'persona_fisica', nombre: 'Ana Gomez' })
    await guardar('sn', undefined)
    reglas.set('sn', { tipo: 'persona_fisica', nombre: null })
    out.sinNombre = [await guardar('sn', 'Ana Gomez'), await guardar('sn', undefined), await guardar('sn', 'Otro Nombre'), await directorio.reglaNombrePublico('sn')]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.helper, ['Florencia Fernandez', 'Florencia Maria Fernandez Gomez', 'Joaquin Daniel Ferretto', 'Maria Florencia Fernandez', 'Maria Florencia Fernandez Gomez', "José María O'Connor", 'Ana Garcia-Lopez', null, null, null, 'Ñandú Álvarez'])
  const F = 'Florencia Maria Fernandez Gomez'
  assert.deepEqual(r.persona, [F, F, F, 'PUBLIC_NAME_DERIVED', 'PUBLIC_NAME_DERIVED', F, { type: 'persona_fisica', derived: F }], 'a person: the derived name is saved; another name is refused, also with the option of the registration (it only applies to a new profile)')
  assert.deepEqual(r.personaPorAdmin, ['PUBLIC_NAME_DERIVED', F], 'the old form of the Admin cannot rename a person either')
  assert.deepEqual(r.empresa, ['Plomería Rápida', 'Otra Marca', 'INVALID_PROFILE', { type: 'empresa', derived: null }], 'a business types its trade name, validated as any public name')
  assert.deepEqual(r.nuevo, ['PUBLIC_NAME_DERIVED', null, 'Marca Nueva', 'empresa'], 'a new provider: refused in its own form; registered by the administration with another name it is a business')
  assert.deepEqual(r.sinNombre, ['Ana Gomez', 'Ana Gomez', 'PUBLIC_NAME_DERIVED', { type: 'persona_fisica', derived: 'Ana Gomez' }])
})
