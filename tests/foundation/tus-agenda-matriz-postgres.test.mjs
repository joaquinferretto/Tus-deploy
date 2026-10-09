import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// AGENDA-MATRIZ-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). The agenda engine is the one that already existed: these tests are
// about what was added on top of it (the turno behind each occupied time of the provider's own
// agenda, the origin of a turno, linking a manual turno to an existing client).
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'
const root = join(import.meta.dirname, '../..')

test('AGENDA matriz PostgreSQL: a manual turno occupies the agenda like one of TUS and they never overlap (also at the same moment); the provider reads which turno is behind each time (pending, waiting for payment, confirmed, finished, manual) and the public agenda never does; a cancelled turno frees its time; a manual turno is linked to an existing client only by a whole verified phone or email the provider chose, otherwise it is a contact with no account; every turno says its origin; the times to reschedule are the same agenda', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${turnosPagosSetup(url)}
    const out = {}
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { crearRouterTurnos } = await import('./apps/api/src/tus/calendar/turnos-http.ts')
    const c2 = await import('./packages/contracts/src/tus-turnos.ts')
    const codigo = async (op) => { try { await op(); return 'ok' } catch (e) { return e?.code ?? String(e) } }
    try {
      const p = await prestador('mat', 'Matriz ' + run, [['Masaje', 30000]])
      const otro = await prestador('mat2', 'Otro ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const beto = await cliente('beto')
      const caro = await cliente('caro')
      await turnos.guardarReprogramacionPrestador(p.tenantId, true)
      let pagos = 700000 + Math.floor(Math.random() * 200000) * 10
      const pagar = async (t) => { pagos += 1; mpPayment(String(pagos), t.preferencia); await ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-m-' + pagos })) }
      const viernes = c.sumarDias(lunes, 4)
      const semana = c.lunesDe(viernes)
      const manual = (hora, extra = {}, tenant = p.tenantId) => turnos.crearTurnoManual({ prestadorTenantId: tenant, oficioId: oficio.id, inicio: a(4, hora), clienteNombre: 'Doña Rosa', clienteTelefono: '3794 111222', ...extra })
      const franja = async (hora, propia = true) => { const agenda = await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: semana, ...(propia ? { incluirNoVisible: true, conTurnos: true } : {}) }); return agenda.dias.find((d) => d.fecha === viernes).franjas.find((f) => f.hora === hora) }
      const ver = (f) => [f.estado, f.turno ? [f.turno.estado, f.turno.origen, f.turno.cliente] : null]

      // ---- 1. A manual turno occupies the agenda; a turno of TUS cannot take that time, nor the other way.
      const m = await manual('10:00')
      const filaM = await prisma.reserva.findUnique({ where: { id: m.id } })
      out.manual = [m.estado, m.origen, m.esInvitado, filaM.clienteId, filaM.origen, filaM.clienteTenantId, ver(await franja('10:00')), ver(await franja('10:00', false))]
      out.noSeSuperponen = [
        await codigo(() => turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(4, '10:00'), tarifaId: p.tarifas['Masaje'], clienteId: ana.id, clienteTenantId: ana.tenantId })),
        await codigo(() => manual('10:00')),
      ]
      const pendiente = await turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(4, '11:00'), tarifaId: p.tarifas['Masaje'], clienteId: ana.id, clienteTenantId: ana.tenantId })
      out.manualSobreTus = await codigo(() => manual('11:00'))
      // At the same moment: the provider loads a manual turno and a client requests that very time.
      const carrera = await Promise.all([codigo(() => manual('16:00')), codigo(() => turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(4, '16:00'), tarifaId: p.tarifas['Masaje'], clienteId: beto.id, clienteTenantId: beto.tenantId }))])
      out.carrera = [carrera.slice().sort(), await prisma.reserva.count({ where: { tenantId: p.tenantId, fechaInicio: new Date(a(4, '16:00')), estado: { in: ['pending', 'confirmed'] } } })]
      // Another provider's agenda is another agenda.
      out.otraAgenda = await codigo(() => manual('10:00', {}, otro.tenantId))

      // ---- 2. The provider reads each state; the public agenda only says "occupied".
      const aceptado = await turnoConCheckout(p, ana, 4, '12:00', 'Masaje')
      const confirmado = await turnoConCheckout(p, ana, 4, '13:00', 'Masaje')
      await pagar(confirmado)
      const finalizado = await turnoConCheckout(p, beto, 4, '14:00', 'Masaje')
      await pagar(finalizado)
      await prisma.reserva.update({ where: { id: finalizado.pedido.id }, data: { estado: 'completed' } })
      const cancelado = await turnoConCheckout(p, beto, 4, '15:00', 'Masaje')
      await turnos.cancelarTurnoCliente({ clienteId: beto.id, reservaId: cancelado.pedido.id })
      out.estados = { pendiente: ver(await franja('11:00')), esperandoPago: ver(await franja('12:00')), confirmado: ver(await franja('13:00')), finalizado: ver(await franja('14:00')), cancelado: ver(await franja('15:00')), libre: ver(await franja('17:00')) }
      const publica = await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: semana })
      out.publicaSinTurnos = [publica.dias.flatMap((d) => d.franjas).some((f) => f.turno !== undefined), publica.dias.find((d) => d.fecha === viernes).franjas.filter((f) => ['10:00', '11:00', '12:00', '13:00'].includes(f.hora)).map((f) => f.estado)]
      // The availability itself is what it always was: the labels changed nothing.
      const sinEtiquetas = await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: semana, incluirNoVisible: true })
      const conEtiquetas = await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: semana, incluirNoVisible: true, conTurnos: true })
      out.mismaDisponibilidad = JSON.stringify(sinEtiquetas.dias.map((d) => d.franjas.map((f) => [f.inicio, f.estado]))) === JSON.stringify(conEtiquetas.dias.map((d) => d.franjas.map((f) => [f.inicio, f.estado])))

      // ---- 3. An existing client: only by a WHOLE verified phone or email, chosen by the provider.
      await prisma.user.update({ where: { id: (await prisma.account.findUnique({ where: { id: ana.id } })).userId }, data: { phoneNumber: '+5493794551234', phoneVerifiedAt: new Date() } })
      for (const cuenta of [ana, beto, caro]) await prisma.account.update({ where: { id: cuenta.id }, data: { emailVerifiedAt: new Date() } })
      const buscar = async (dato) => { try { return (await turnos.buscarClienteParaTurno({ prestadorTenantId: p.tenantId, ...dato })).map((x) => [x.cuentaId === ana.id ? 'ana' : x.cuentaId === caro.id ? 'caro' : x.cuentaId === beto.id ? 'beto' : '?', x.nombre, x.por]) } catch (e) { return e?.code ?? String(e) } }
      const emailDe = async (cuenta) => (await prisma.user.findUnique({ where: { id: (await prisma.account.findUnique({ where: { id: cuenta.id } })).userId } })).email
      out.busqueda = {
        porCelular: await buscar({ telefono: '3794 551234' }),
        conOtroFormato: await buscar({ telefono: '+54 9 379 455-1234' }),
        celularParcial: await buscar({ telefono: '379455' }),
        porNombre: await buscar({}),
        emailParcial: await buscar({ email: run + '-caro' }),
        porEmail: await buscar({ email: await emailDe(caro) }),
        variasCoincidencias: (await buscar({ telefono: '3794 551234', email: await emailDe(caro) })).map((x) => x[0]).sort(),
        nadie: await buscar({ telefono: '3794 000111' }),
      }
      const cuentasAntes = await prisma.account.count()
      const vinculado = await manual('17:00', { clienteCuentaId: ana.id })
      const filaV = await prisma.reserva.findUnique({ where: { id: vinculado.id } })
      const deAna = (await turnos.turnosCliente(ana.id)).find((x) => x.id === vinculado.id)
      out.vinculado = [filaV.clienteId === ana.id, filaV.esInvitado, filaV.origen, filaV.clienteTenantId, filaV.estado, deAna ? [deAna.origen, deAna.estado, deAna.sena ?? null, deAna.pago ?? null] : null, await prisma.trabajo.count({ where: { reservaId: filaV.reservaId } }), ver(await franja('17:00'))[1]?.slice(0, 2)]
      out.vinculoInvalido = [await codigo(() => manual('18:00', { clienteCuentaId: 'cuenta-que-no-existe' })), await prisma.reserva.count({ where: { tenantId: p.tenantId, fechaInicio: new Date(a(4, '18:00')) } })]
      // A guest: no account is created for it.
      out.invitado = [filaM.esInvitado, filaM.clienteNombre, await prisma.account.count() === cuentasAntes, (await turnos.turnosCliente(ana.id)).some((x) => x.id === m.id)]
      // Linking is revalidated on save, not trusted from a previous search or a name.
      await prisma.account.update({ where: { id: caro.id }, data: { status: 'suspended' } })
      out.suspendida = [await buscar({ email: await emailDe(caro) }), await codigo(() => turnos.crearTurnoManual({ prestadorTenantId: p.tenantId, oficioId: oficio.id, inicio: a(3, '12:00'), clienteNombre: 'Nombre inventado', clienteCuentaId: caro.id }))]
      const emailBeto = await emailDe(beto)
      out.noPrestador = await codigo(() => turnos.buscarClienteParaTurno({ prestadorTenantId: ana.tenantId, email: emailBeto }))
      // Past/off-grid appointments remain visible even when the weekly rules no longer cover
      // their starts. This adds display records without introducing extra bookable slots.
      const fuera = await manual('07:15', { duracionMinutos: 30 })
      const vieja = new Date(Date.now() - 2 * 3600_000)
      const finalizadoHoy = await prisma.reserva.create({ data: { ...filaM, id: run + '-pasada', reservaId: run + '-pasada', fechaInicio: vieja, fechaFin: new Date(vieja.getTime() + 30 * 60_000), estado: 'completed' } })
      const hoyPropia = await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: c.lunesDe(hoy), incluirNoVisible: true, conTurnos: true })
      const hoyPublica = await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: c.lunesDe(hoy) })
      const semanaPropia = await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: semana, incluirNoVisible: true, conTurnos: true })
      out.historico = [hoyPropia.dias.flatMap((d) => d.turnos ?? []).some((f) => f.turno?.id === finalizadoHoy.id && f.turno.estado === 'completed'), semanaPropia.dias.flatMap((d) => d.turnos ?? []).some((f) => f.turno?.id === fuera.id && f.hora === '07:15'), hoyPublica.dias.some((d) => d.turnos !== undefined), JSON.stringify(hoyPropia.dias.map((d) => d.franjas.map((f) => [f.inicio, f.estado]))) === JSON.stringify(hoyPublica.dias.map((d) => d.franjas.map((f) => [f.inicio, f.estado])))]

      // ---- 4. The origin of every turno, also of the rows from before the column.
      await prisma.reserva.update({ where: { id: m.id }, data: { origen: null } })
      await prisma.reserva.update({ where: { id: pendiente.id }, data: { origen: null } })
      const delPrestador = await turnos.turnosPrestador({ prestadorTenantId: p.tenantId }).then((x) => (Array.isArray(x) ? x : x.items ?? x.turnos)).catch(() => null)
      const origenes = delPrestador ? Object.fromEntries(delPrestador.filter((x) => [m.id, pendiente.id, vinculado.id, confirmado.pedido.id].includes(x.id)).map((x) => [x.id === m.id ? 'manualAntiguo' : x.id === pendiente.id ? 'tusAntiguo' : x.id === vinculado.id ? 'manualVinculado' : 'tus', x.origen])) : null
      out.origenes = [origenes, ver(await franja('10:00'))[1]?.[1], (await prisma.reserva.findUnique({ where: { id: confirmado.pedido.id } })).origen]

      // ---- 5. Rescheduling reads the same agenda, asked by its week (a Monday that may be past).
      const horarios = await turnos.horariosParaReprogramar({ clienteId: ana.id, reservaId: confirmado.pedido.id, desde: semana })
      const delViernes = horarios.dias.find((d) => d.fecha === viernes).franjas
      out.reprogramar = [await codigo(() => turnos.horariosParaReprogramar({ clienteId: ana.id, reservaId: confirmado.pedido.id, desde: c.lunesDe(hoy) })), delViernes.filter((f) => f.estado === 'disponible').map((f) => f.hora), delViernes.some((f) => f.turno !== undefined)]

      // ---- 6. HTTP: who sees what.
      const app = express()
      app.use(express.json())
      const sesiones = { 'tok-p': { subjectId: 'u-' + p.tenantId, sessionId: 's', tenantId: p.tenantId, roles: ['owner'], permissions: [], correlationId: 'c' }, 'tok-ana': { subjectId: ana.id, sessionId: 's', tenantId: ana.tenantId, roles: ['owner'], permissions: [], correlationId: 'c' } }
      app.use(crearRouterTurnos({ servicio: turnos, sessions: { resolve: async (token) => sesiones[token] ?? null } }))
      const servidor = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)) })
      const call = async (method, path, token, body) => { const response = await fetch('http://127.0.0.1:' + servidor.address().port + path, { method, headers: { 'content-type': 'application/json', 'x-correlation-id': 'c', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json().catch(() => null) } }
      const propia = await call('GET', '/tus/v1/prestador/turnos/agenda?oficioId=' + oficio.id + '&desde=' + semana, 'tok-p')
      const publicaHttp = await call('GET', '/tus/v1/public/prestadores/' + p.perfilId + '/turnos/agenda?oficioId=' + oficio.id + '&desde=' + semana)
      const busquedaHttp = await call('GET', '/tus/v1/prestador/turnos/clientes?telefono=' + encodeURIComponent('3794 551234'), 'tok-p')
      const altaHttp = await call('POST', '/tus/v1/prestador/turnos/manual', 'tok-p', { oficioId: oficio.id, inicio: a(3, '10:00'), clienteNombre: 'Ana por teléfono', clienteCuentaId: ana.id })
      out.http = [
        propia.status, propia.body.dias.flatMap((d) => d.franjas).filter((f) => f.turno).length > 0,
        publicaHttp.status, JSON.stringify(publicaHttp.body).includes('"turno"'), JSON.stringify(publicaHttp.body).includes('Doña Rosa'),
        (await call('GET', '/tus/v1/prestador/turnos/clientes?telefono=3794551234')).status, busquedaHttp.status, busquedaHttp.body.items.map((x) => Object.keys(x).sort().join(',')),
        altaHttp.status, altaHttp.body.origen, (await call('POST', '/tus/v1/prestador/turnos/manual', 'tok-p', { oficioId: oficio.id, inicio: a(3, '11:00'), clienteNombre: 'X Y', clienteCuentaId: { id: ana.id } })).status,
      ]
      await new Promise((resolve) => servidor.close(resolve))
      out.ocupado = c2.CODIGO_HORARIO_OCUPADO
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  const OCUPADO = r.ocupado
  assert.deepEqual(r.manual.slice(0, 6), ['confirmed', 'manual', true, 'manual', 'manual', null], 'a manual turno: confirmed, of origin MANUAL, a contact with no account, with no payment of TUS')
  assert.deepEqual(r.manual[6], ['ocupado', ['confirmed', 'manual', 'Doña Rosa']], 'its provider reads which turno occupies the time')
  assert.deepEqual(r.manual[7], ['ocupado', null], 'the public agenda only says the time is taken')
  assert.deepEqual(r.noSeSuperponen, [OCUPADO, OCUPADO], 'a turno of TUS and a manual one never share a time')
  assert.equal(r.manualSobreTus, OCUPADO, 'a manual turno cannot be loaded over a pending request either')
  assert.deepEqual(r.carrera, [[OCUPADO, 'ok'], 1], 'at the same moment: one of the two gets the time')
  assert.equal(r.otraAgenda, 'ok', 'the same time of another provider is another agenda')
  assert.deepEqual(r.estados.pendiente, ['ocupado', ['pending', 'tus', 'Cliente ana']])
  assert.deepEqual(r.estados.esperandoPago, ['ocupado', ['awaiting_payment', 'tus', 'Cliente ana']])
  assert.deepEqual(r.estados.confirmado, ['ocupado', ['confirmed', 'tus', 'Cliente ana']])
  assert.deepEqual(r.estados.finalizado.slice(1), [['completed', 'tus', 'Cliente beto']], 'a finished turno is still read on the agenda')
  assert.deepEqual(r.estados.cancelado, ['disponible', null], 'a cancelled turno frees its time')
  assert.equal(r.estados.libre[1], null)
  assert.deepEqual(r.publicaSinTurnos, [false, ['ocupado', 'ocupado', 'ocupado', 'ocupado']])
  assert.equal(r.mismaDisponibilidad, true, 'labelling the turnos changes nothing of the availability')
  assert.deepEqual(r.busqueda.porCelular, [['ana', 'Cliente a.'.replace('a.', 'A.'), 'telefono']], 'found by the whole verified phone, with a short name')
  assert.deepEqual(r.busqueda.conOtroFormato, r.busqueda.porCelular)
  assert.equal(r.busqueda.celularParcial, 'INVALID_PARAMS', 'never by a part of a phone')
  assert.equal(r.busqueda.porNombre, 'INVALID_PARAMS', 'never without a whole phone or email (there is no search by name)')
  assert.equal(r.busqueda.emailParcial, 'INVALID_PARAMS')
  assert.deepEqual(r.busqueda.porEmail.map((x) => [x[0], x[2]]), [['caro', 'email']])
  assert.deepEqual(r.busqueda.variasCoincidencias, ['ana', 'caro'], 'several matches are all returned: the provider chooses')
  assert.deepEqual(r.busqueda.nadie, [])
  assert.deepEqual(r.vinculado.slice(0, 5), [true, false, 'manual', null, 'confirmed'], 'linked to the client the provider chose: still a manual turno, with no payment of TUS')
  assert.deepEqual(r.vinculado[5], ['manual', 'confirmed', null, null], 'the client reads it in "Mis turnos", with nothing to pay')
  assert.equal(r.vinculado[6], 0, 'no order of work and no obligation is created for it')
  assert.deepEqual(r.vinculado[7], ['confirmed', 'manual'])
  assert.deepEqual(r.vinculoInvalido, ['CLIENT_NOT_FOUND', 0], 'an account that does not exist links nothing and creates nothing')
  assert.deepEqual(r.invitado, [true, 'Doña Rosa', true, false], 'a guest stays a contact of the provider: no account is created')
  assert.deepEqual(r.suspendida, [[], 'CLIENT_NOT_FOUND'], 'a suspended account is neither returned nor linked from a stale search')
  assert.equal(r.noPrestador, 'FORBIDDEN', 'a regular client cannot use the provider customer search')
  assert.deepEqual(r.historico, [true, true, false, true], 'actual past/off-grid appointments are visible only to their provider without changing availability')
  assert.deepEqual(r.origenes[0], { manualAntiguo: 'manual', tusAntiguo: 'tus', manualVinculado: 'manual', tus: 'tus' }, 'every turno says its origin, also the rows from before the column')
  assert.deepEqual(r.origenes.slice(1), ['manual', 'tus'])
  assert.equal(r.reprogramar[0], 'ok', 'the week of the agenda may start on a Monday that already passed')
  assert.deepEqual(r.reprogramar.slice(1), [['09:00', '18:00'].filter((h) => r.reprogramar[1].includes(h)).concat(r.reprogramar[1].filter((h) => !['09:00', '18:00'].includes(h))).sort(), false])
  assert.ok(r.reprogramar[1].length > 0 && !r.reprogramar[1].some((h) => ['10:00', '11:00', '12:00', '13:00', '14:00', '16:00', '17:00'].includes(h)), `only free times can be chosen to reschedule (${r.reprogramar[1]})`)
  assert.deepEqual(r.http, [200, true, 200, false, false, 401, 200, ['cuentaId,nombre,por'], 201, 'manual', 400], 'the provider reads its turnos; the public agenda leaks none; the search needs a session and returns only a short name')
})

test('AGENDA matriz Web: one agenda component for booking, for the provider and for rescheduling; a free time of the provider opens the manual turno there and an occupied one opens its detail; the public booking never renders a turno; narrow screens show one day at a time', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const agenda = read('apps/web/src/features/turnos/agenda-semanal.tsx')
  const css = read('apps/web/src/features/turnos/agenda.module.css')
  const disponibilidad = read('apps/web/src/features/provider/provider-availability.tsx')
  const panel = read('apps/web/src/features/provider/provider-turnos.tsx')
  const mios = read('apps/web/src/features/turnos/mis-turnos-page.tsx')
  const reserva = read('apps/web/src/features/directory/turno-booking.tsx')
  const servicio = read('apps/api/src/tus/calendar/turnos-service.ts')
  const migracion = read('apps/api/prisma/migrations/20261117100000_tus_turnos_origen/migration.sql')
  // One component, three origins; it never builds a time by itself.
  assert.match(agenda, /\{ tipo: 'publica'; [^}]+\} \| \{ tipo: 'propia'; oficioId: string \} \| \{ tipo: 'reprogramacion'; turnoId: string \}/u)
  assert.match(agenda, /turnosApi\.horariosReprogramacion\(turnoId, desde\)/u)
  assert.equal([mios, disponibilidad, reserva].filter((fuente) => /<AgendaSemanal[ \n]/u.test(fuente)).length, 3, 'booking, the provider and rescheduling render the same agenda')
  assert.doesNotMatch(mios, /data-horario-nuevo|Semana siguiente/u, 'the list of times of the first version is gone')
  assert.match(mios, /<AgendaSemanal onSeleccion=\{\(franja\) => setMoviendo\(\{ \.\.\.moviendo, elegido: franja\?\.inicio \?\? null \}\)\} origen=\{\{ tipo: 'reprogramacion', turnoId: turno\.id \}\}/u)
  assert.match(mios, /textoConfirmacionReprogramacion\([\s\S]{0,300}data-resumen-reprogramacion[\s\S]{0,500}data-confirmar-cambio/u, 'choosing a time shows the confirmation before anything moves')
  // The provider: free -> manual turno there; occupied -> its detail.
  assert.match(disponibilidad, /onSeleccion=\{\(franja\) => \{ if \(franja\) onLibre\?\.\(franja, oficioId\) \}\} onTurno=\{onTurno\}/u)
  assert.match(panel, /<ProviderAvailability onLibre=\{abrirManualEn\} onTurno=\{\(turno, franja\) => setDetalle\(\{ turno, franja \}\)\}/u)
  assert.match(panel, /function abrirManualEn\(franja: FranjaAgenda, oficioId: string\) \{\s*setManualOficio\(oficioId\)\s*setManualInicio\(horaLocal\(franja\.inicio\)\)[\s\S]{0,200}setModalManual\(true\)/u)
  assert.match(panel, /data-turno-detalle=\{detalle\.turno\.id\}/u)
  assert.match(agenda, /data-estado-turno=\{item\.turno\.estado\} data-origen-turno=\{item\.turno\.origen\} data-turno=\{item\.turno\.id\} onClick=\{\(\) => onTurno\(item\.turno!, item\)\}/u)
  for (const estado of ['pending', 'awaiting_payment', 'confirmed', 'completed']) assert.match(css, new RegExp(`\\[data-estado-turno='${estado}'\\]`, 'u'), `the state ${estado} has its own look`)
  assert.match(agenda, /pending: 'Pendiente', awaiting_payment: 'Esperando pago', confirmed: 'Confirmado', completed: 'Finalizado'/u)
  // Linking a client: the provider chooses; "do not link" is always there.
  assert.match(panel, /turnosApi\.buscarClienteTurno\(\{ telefono: manualTelefono\.trim\(\), email: manualEmail\.trim\(\) \}\)/u)
  assert.match(panel, /\.\.\.\(vinculo \? \{ clienteCuentaId: vinculo\.cuentaId \} : \{\}\)/u)
  assert.match(panel, /Hay más de un cliente con ese dato\. Elegí cuál es:/u)
  assert.match(panel, /No vincular \(solo el contacto que cargo acá\)/u)
  // Narrow screens: one day at a time (tabs + the times of that day), the wide grid hidden.
  assert.match(css, /@media \(max-width: 640px\)/u)
  assert.match(agenda, /className=\{styles\.dayTabs\}/u)
  // The engine was only decorated: the labels are read after the availability is computed.
  assert.match(servicio, /const dias = input\.conTurnos \? await this\.conTurnosDeLaSemana\(calendario\.id, calculados\) : calculados/u)
  assert.doesNotMatch(/private async conTurnosDeLaSemana\([\s\S]*?\n  \}\n/u.exec(servicio)[0], /agendaDelDia|estado: 'disponible'/u, 'display records never generate available times')
  assert.doesNotMatch(migracion, /\bDROP\b|\bDELETE FROM\b|\bUPDATE public\b|\bINSERT INTO\b/u)
  assert.match(migracion, /ADD COLUMN "origen" text;/u)
})
