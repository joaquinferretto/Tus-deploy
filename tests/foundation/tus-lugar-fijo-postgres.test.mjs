import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// LUGAR-FIJO-01. The place where a provider attends: a name that may be published and an address
// that is private. On a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL): the real directory service over Prisma and the real turnos service.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

test('LUGAR FIJO PostgreSQL: attending at a place asks for its address (going to homes does not); the directory and the search give the name of the place and never its address; the owner and the administration read it; the client of a CONFIRMED turno gets it, and nobody else: not another client, not a pending, unpaid, rejected or cancelled turno, not another provider; profiles and turnos from before are untouched', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${turnosPagosSetup(url)}
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const { crearEdicionPrestadorAdmin } = await import('./apps/api/src/tus/directorio/admin.ts')
    const out = {}
    try {
      const DIRECCION = 'Av. 3 de Abril 1250'
      const COMO_LLEGAR = 'Primer piso, timbre 2. Entrada por calle Mendoza.'
      const p = await prestador('lugar', 'Consultorio Del Centro', [['Masaje', 30000]])
      const otro = await prestador('otro', 'Otro Prestador', [['Masaje', 30000]])
      const viejo = await prestador('viejo', 'Taller De Antes', [['Masaje', 30000]])
      const merchants = new Map([[p.tenantId, p.prestadorId], [otro.tenantId, otro.prestadorId], [viejo.tenantId, viejo.prestadorId]])
      const application = { marketplace: { store: { merchant: { find: async (t) => (merchants.has(t) ? { merchantId: merchants.get(t), status: 'approved' } : null), save: async () => {} }, listings: { forTenant: async () => [] }, audit: { append: async () => {} } } }, identity: { identidadVerificada: async () => false } }
      const directorio = crearServicioDirectorio({ application, prisma })
      const ctx = (tenantId) => ({ tenantId, subjectId: 'actor-' + tenantId, sessionId: 's', roles: ['owner'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
      const base = { profession: oficio.id, zone: 'Centro', displayName: 'Consultorio Del Centro' }
      const guardar = async (cuerpo, tenant = p.tenantId) => { const x = await directorio.guardarPerfil(ctx(tenant), { ...base, ...cuerpo }); return x.ok ? 'ok' : [x.code, x.fields ?? null] }
      const fila = async (perfilId = p.perfilId) => { const f = await prisma.perfilPublicoPrestador.findUnique({ where: { id: perfilId } }); return [f.modalidadAtencion, f.lugarNombre, f.lugarDireccion, f.lugarDescripcion, f.radioCoberturaKm] }
      const antesOtro = JSON.stringify(await prisma.perfilPublicoPrestador.findUnique({ where: { id: otro.perfilId } }))
      out.tarifaIntacta = [(await prisma.tarifaServicioPrestador.count({ where: { perfilId: p.perfilId } }))]

      // ---- 1. At a place with no address: refused. 4. Going to homes: nothing is asked.
      out.sinDireccion = [await guardar({ serviceMode: 'local' }), await guardar({ serviceMode: 'local', placeAddress: '   ' }), await guardar({ serviceMode: 'local', placeAddress: 123 }), await guardar({ serviceMode: 'mixto', placeName: 'Consultorio' }), await guardar({ serviceMode: 'local', placeAddress: 'Ab 1' }), await guardar({ serviceMode: 'local', placeAddress: DIRECCION, placeName: 'X' }), await guardar({ serviceMode: 'local', placeAddress: DIRECCION, placeDescription: 'x'.repeat(241) }), await guardar({ serviceMode: 'local', placeAddress: DIRECCION, placeName: 'Llamame 3794123456' })]
      out.domicilio = [await guardar({ serviceMode: 'domicilio' }), await fila()]
      // ---- 2. At a place, with its address.
      out.local = [await guardar({ serviceMode: 'local', placeName: '  Consultorio   Ferretto ', placeAddress: ' ' + DIRECCION + ' ', placeDescription: COMO_LLEGAR }), await fila()]
      // ---- 3. Both: the place and the coverage.
      out.mixto = [await guardar({ serviceMode: 'mixto', placeName: 'Consultorio Ferretto', placeAddress: DIRECCION, placeDescription: COMO_LLEGAR, serviceZones: ['Centro'], coverageRadiusKm: 5 }), await fila()]
      // (a request that does not name the place keeps it; a blank name is "no name")
      out.conserva = [await guardar({ serviceMode: 'mixto', coverageRadiusKm: 5 }), (await fila())[2], await guardar({ serviceMode: 'mixto', placeName: '', placeAddress: DIRECCION, placeDescription: '' }), await fila(), await guardar({ serviceMode: 'local', placeName: 'Consultorio Ferretto', placeAddress: DIRECCION, placeDescription: COMO_LLEGAR })]

      // ---- 5 / 6. What anybody reads: the name of the place, never the address nor the note.
      const publico = JSON.stringify(await directorio.perfil(p.perfilId))
      const listado = JSON.stringify(await directorio.listar({ mapa: true }))
      const busqueda = JSON.stringify(await directorio.listar({ q: 'Consultorio' })) + JSON.stringify(await directorio.buscarCandidatos({ oficio: oficio.id, zona: 'Centro' }))
      const fuga = (texto) => [texto.includes(DIRECCION), texto.includes('3 de Abril'), texto.includes('timbre'), texto.includes('ownPlace'), texto.includes('lugarDireccion')]
      out.publico = [JSON.parse(publico).place, fuga(publico), listado.includes('Consultorio Ferretto'), fuga(listado), fuga(busqueda)]
      // ---- 7. The owner. 13. Another provider reads its own, never this one.
      out.propietario = [(await directorio.miPerfil(ctx(p.tenantId))).ownPlace, (await directorio.miPerfil(ctx(otro.tenantId))).ownPlace, fuga(JSON.stringify(await directorio.miPerfil(ctx(otro.tenantId)))).slice(0, 3)]
      // ---- 8. The administration.
      const adminCtx = { subjectId: 'admin', tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin'], correlationId: 'c' }
      const admin = crearEdicionPrestadorAdmin({ application, directorio })
      const leido = await admin.leer(p.perfilId)
      const sinPermiso = await admin.guardar({ ...adminCtx, permissions: ['tus:marketplace:write'] }, p.perfilId, { placeAddress: 'Otra 123' })
      out.admin = [leido.perfil.placeName, leido.perfil.placeAddress, leido.perfil.placeDescription, sinPermiso.status]

      // ---- 9..12. Turnos: who gets the address.
      let pagos = 6000000 + Math.floor(Math.random() * 900000) * 10
      const pagar = async (t) => { pagos += 1; mpPayment(String(pagos), t.preferencia); await ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-lugar-' + pagos })) }
      const ana = await cliente('ana'); const beto = await cliente('beto'); const caro = await cliente('caro'); const dani = await cliente('dani'); const eva = await cliente('eva'); const fede = await cliente('fede')
      const deAna = await turnoConCheckout(p, ana, 0, '10:00', 'Masaje'); await pagar(deAna)
      const deDani = await turnoConCheckout(p, dani, 0, '11:00', 'Masaje')
      const deCaro = await turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(0, '12:00'), tarifaId: p.tarifas.Masaje, clienteId: caro.id, clienteTenantId: caro.tenantId })
      const deFede = await turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(0, '13:00'), tarifaId: p.tarifas.Masaje, clienteId: fede.id, clienteTenantId: fede.tenantId })
      await turnos.rechazarSolicitud({ prestadorTenantId: p.tenantId, reservaId: deFede.id })
      const deEva = await turnoConCheckout(p, eva, 0, '14:00', 'Masaje'); await pagar(deEva)
      const evaAntes = (await turnos.turnosCliente(eva.id)).map((t) => [t.estado, t.lugarAtencion?.direccion ?? null])
      await turnos.cancelarTurnoCliente({ clienteId: eva.id, reservaId: deEva.pedido.id, confirmaPerdida: true })
      const de = async (cuenta) => (await turnos.turnosCliente(cuenta.id)).map((t) => [t.estado, t.lugarAtencion ?? null])
      out.turnos = { ana: await de(ana), beto: await de(beto), caro: await de(caro), dani: await de(dani), evaAntes, eva: (await de(eva)).map((x) => [x[0].startsWith('cancelled'), x[1]]), fede: await de(fede) }
      // What the provider side and the answers to the request carry: no address at all.
      out.otrasLecturas = [fuga(JSON.stringify(deCaro)), fuga(JSON.stringify(deAna.pedido)), fuga(JSON.stringify(await turnos.turnosCliente(beto.id)))]
      // Going back to homes only: the place stays stored, and stops being given.
      out.vuelveADomicilio = [await guardar({ serviceMode: 'domicilio' }), (await fila())[2], JSON.parse(JSON.stringify(await directorio.perfil(p.perfilId))).place, (await de(ana))[0][1], await guardar({ serviceMode: 'local' }), (await de(ana))[0][1]?.direccion]

      // ---- 14. From before the column: a profile nobody edited, and one that attended at a place.
      out.otroIgual = JSON.stringify(await prisma.perfilPublicoPrestador.findUnique({ where: { id: otro.perfilId } })) === antesOtro
      await prisma.perfilPublicoPrestador.update({ where: { id: viejo.perfilId }, data: { modalidadAtencion: 'local' } })
      const gina = await cliente('gina')
      const deGina = await turnoConCheckout(viejo, gina, 0, '10:00', 'Masaje'); await pagar(deGina)
      const adminEdita = await admin.guardar(adminCtx, viejo.perfilId, { description: 'Atiende en su taller.' })
      out.historico = [(await directorio.perfil(viejo.perfilId)).place, await de(gina), adminEdita.status, await guardar({ displayName: 'Taller De Antes', serviceMode: 'local' }, viejo.tenantId), await guardar({ displayName: 'Taller De Antes', serviceMode: 'local', placeAddress: 'Mendoza 800' }, viejo.tenantId), (await de(gina))[0][1]]
      out.tarifaIntacta.push(await prisma.tarifaServicioPrestador.count({ where: { perfilId: p.perfilId } }), await prisma.reserva.count({ where: { tenantId: p.tenantId } }))
      out.restriccion = [await sqlError('UPDATE public."perfiles_publicos_prestador" SET "lugar_direccion" = $1 WHERE "id" = $2', ['abc', p.perfilId]), await sqlError('UPDATE public."perfiles_publicos_prestador" SET "lugar_descripcion" = $1 WHERE "id" = $2', ['x'.repeat(241), p.perfilId])]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  const DIRECCION = 'Av. 3 de Abril 1250'
  const COMO_LLEGAR = 'Primer piso, timbre 2. Entrada por calle Mendoza.'
  const LUGAR = { nombre: 'Consultorio Ferretto', direccion: DIRECCION, descripcion: COMO_LLEGAR }
  const NADA = [false, false, false, false, false]
  assert.deepEqual(r.sinDireccion, [['INVALID_PROFILE', ['placeAddress']], ['INVALID_PROFILE', ['placeAddress']], ['INVALID_PROFILE', ['placeAddress']], ['INVALID_PROFILE', ['placeAddress']], ['INVALID_PROFILE', ['placeAddress']], ['INVALID_PROFILE', ['placeName']], ['INVALID_PROFILE', ['placeDescription']], ['INVALID_PROFILE', ['placeName']]], 'at a place (or both): the address is required and real; the name and the note have their limits')
  assert.deepEqual(r.domicilio, ['ok', ['domicilio', null, null, null, null]], 'going to homes asks for no place')
  assert.deepEqual(r.local, ['ok', ['local', 'Consultorio Ferretto', DIRECCION, COMO_LLEGAR, null]])
  assert.deepEqual(r.mixto, ['ok', ['mixto', 'Consultorio Ferretto', DIRECCION, COMO_LLEGAR, 5]], 'both: the place and the coverage')
  assert.deepEqual(r.conserva, ['ok', DIRECCION, 'ok', ['mixto', null, DIRECCION, null, null], 'ok'], 'not naming the place keeps it; an empty name or note clears only that')
  assert.deepEqual(r.publico, [{ name: 'Consultorio Ferretto' }, NADA, true, NADA, NADA], 'the public profile, the directory and the search: the name of the place, never its address nor how to get in')
  assert.deepEqual(r.propietario, [LUGAR, null, [false, false, false]], 'the owner reads its place; another provider reads only its own')
  assert.deepEqual(r.admin, ['Consultorio Ferretto', DIRECCION, COMO_LLEGAR, 403])
  assert.deepEqual(r.turnos.ana, [['confirmed', LUGAR]], 'the client of a confirmed turno knows where to go')
  assert.deepEqual(r.turnos.beto, [], 'another client has nothing')
  assert.deepEqual(r.turnos.caro, [['pending', null]], 'a request waiting for the provider: no address')
  assert.deepEqual(r.turnos.dani, [['awaiting_payment', null]], 'accepted and not paid: no address')
  assert.deepEqual(r.turnos.evaAntes, [['confirmed', DIRECCION]])
  assert.deepEqual(r.turnos.eva, [[true, null]], 'cancelled: no address any more')
  assert.deepEqual(r.turnos.fede, [['rejected', null]])
  assert.deepEqual(r.otrasLecturas, [NADA, NADA, NADA])
  assert.deepEqual(r.vuelveADomicilio, ['ok', DIRECCION, null, null, 'ok', DIRECCION], 'going to homes only: the place stays stored but is given to nobody; back at a place it is the same one')
  assert.equal(r.otroIgual, true, 'a profile nobody edited is byte for byte what it was')
  assert.deepEqual(r.historico, [null, [['confirmed', null]], 200, ['INVALID_PROFILE', ['placeAddress']], 'ok', { nombre: null, direccion: 'Mendoza 800', descripcion: null }], 'a profile from before that attends at a place: it keeps working with no address, the administration edits it, and its own next save asks for the address')
  assert.deepEqual(r.tarifaIntacta.slice(0, 2), [1, 1], 'saving the profile keeps its services and prices')
  assert.deepEqual(r.restriccion, ['ck_perfiles_publicos_prestador_lugar', 'ck_perfiles_publicos_prestador_lugar'])
})

test('LUGAR FIJO, entrada, migración y pantallas: no arbitrary address field is accepted; the address leaves the API through three readings only; the migration is additive; the provider sees the fields only when it attends at a place and the client finds "Lugar de atención" on its confirmed turno', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const http = read('apps/api/src/tus/directorio/http.ts')
  for (const campo of ["'address'", "'direccion'", "'street'", "'houseNumber'", "'latitude'", "'documentAddress'"]) assert.ok(http.includes(campo), `${campo} is still refused on the provider's own save`)
  // The private address is read in exactly these places (and written by the store).
  const lectores = []
  for (const archivo of ['apps/api/src/tus/directorio/servicio.ts', 'apps/api/src/tus/directorio/admin.ts', 'apps/api/src/tus/directorio/modelo.ts', 'apps/api/src/tus/directorio/http.ts', 'apps/api/src/tus/calendar/turnos-service.ts', 'apps/api/src/tus/calendar/turnos-http.ts', 'apps/api/src/tus/solicitudes/servicio.ts', 'apps/api/src/tus/urgentes/servicio.ts', 'apps/api/src/tus/asistente/dominio.ts'])
    if (/lugarDireccion|lugarPrivadoDe\(/u.test(read(archivo).replace(/^\s*\/\/.*$/gmu, ''))) lectores.push(archivo.split('/').slice(-2).join('/'))
  assert.deepEqual(lectores, ['directorio/servicio.ts', 'directorio/admin.ts', 'directorio/modelo.ts', 'calendar/turnos-service.ts'])
  const turnos = read('apps/api/src/tus/calendar/turnos-service.ts')
  assert.equal([...turnos.matchAll(/lugarPrivadoDe\(/gu)].length, 1, 'one reading in the turnos: the turnos of the client itself')
  assert.match(turnos, /\.\.\.\(perfil && row\.estado === 'confirmed' \? \{ lugarAtencion: lugarPrivadoDe\(perfil\) \} : \{\}\),/u)
  assert.match(turnos, /async turnosCliente\(clienteId: string\)[\s\S]{0,200}where: \{ clienteId, esInvitado: false \}/u, 'found by the account of the session, never by an id in the request')
  const modelo = read('apps/api/src/tus/directorio/modelo.ts')
  assert.match(modelo, /place: perfil\.modalidadAtencion !== 'domicilio' && perfil\.lugarNombre \? \{ name: perfil\.lugarNombre \} : null,/u, 'the public projection carries the name only')
  const sql = read('apps/api/prisma/migrations/20261123100000_tus_prestador_lugar_fijo/migration.sql').replace(/^--.*$/gmu, '')
  assert.equal([...sql.matchAll(/ADD COLUMN "lugar_(nombre|direccion|descripcion)" text;/gu)].length, 3)
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE|TRUNCATE|NOT NULL|DEFAULT/iu, 'three nullable columns: no existing profile is touched')
  const perfil = read('apps/web/src/features/provider/provider-public-profile.tsx')
  assert.match(perfil, /\{values\.serviceMode !== 'domicilio' \? \(\n\s+<fieldset className=\{authStyles\.field\} data-lugar-fijo>/u, 'the fields of the place only when it attends at a place')
  for (const texto of ['Lugar donde atendés', 'Nombre del lugar (opcional)', 'Dirección', 'Cómo llegar (opcional)', 'solo las ve el cliente cuando su turno está confirmado']) assert.ok(perfil.includes(texto), texto)
  assert.match(perfil, /\.\.\.\(values\.serviceMode !== 'domicilio' \? \{ placeName:/u)
  const mis = read('apps/web/src/features/turnos/mis-turnos-page.tsx')
  assert.match(mis, /\{turno\.lugarAtencion \? \(\n\s+<span data-lugar-atencion/u)
  assert.ok(mis.includes('Lugar de atención'))
  for (const archivo of ['apps/web/src/features/directory/worker-card.tsx', 'apps/web/src/features/directory/worker-profile.tsx', 'apps/web/src/features/directory/worker-directory.tsx']) assert.doesNotMatch(read(archivo), /direccion|placeAddress|ownPlace|lugarAtencion/u, archivo)
})
