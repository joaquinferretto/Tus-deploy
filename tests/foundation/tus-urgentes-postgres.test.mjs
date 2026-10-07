import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// SERVICIO-URGENTE-01 on a DISPOSABLE PostgreSQL 16 (TUS_PAYMENTS_PG_URL, every migration applied,
// never a shared or production database). An urgent request is offered at once to every
// compatible provider and the FIRST that accepts is assigned:
//
//   one request (a row of solicitudes_servicio) -> its candidates (ofertas_urgentes) -> the
//   conditional UPDATE that decides the winner -> the ONE work of the request, in the same
//   transaction -> the others closed -> the assigned provider may give it back while nothing
//   happened on the work -> the same request is offered again -> the same work moves on.
//
// REAL here: the urgent service and its store, the work service (create, release, reassign),
// the accounts, PostgreSQL's constraints and its row locks. STAND-INS: the notifier (what would
// be sent is recorded; the WhatsApp notifier has its own test) and the directory (the visible
// profiles of that service, read from the same tables).
const url = process.env.TUS_PAYMENTS_PG_URL
const skip = !url && 'TUS_PAYMENTS_PG_URL not set (disposable PostgreSQL 16 only)'

const SETUP = `${turnosPagosSetup(url)}
  const { crearServicioUrgentes } = await import('./apps/api/src/tus/urgentes/composicion.ts')
  const { TEXTOS_URGENTE } = await import('./apps/api/src/tus/urgentes/modelo.ts')
  const { zonasCorrientes } = await import('./apps/api/src/tus/solicitudes/modelo.ts')
  const ZONA = zonasCorrientes()[0].nombre
  const OTRA_ZONA = zonasCorrientes()[1].nombre
  // The directory's rule, read from the same tables: visible profiles of that service that cover
  // the zone (or declare no coverage).
  const candidatos = { aptosParaUrgencia: async ({ oficio: o, zona }) => (await prisma.perfilPublicoPrestador.findMany({ where: { visible: true, oficio: o, id: { startsWith: run } } }))
    .filter((p) => p.zonasCobertura.length === 0 || [p.zona, ...p.zonasCobertura].includes(zona))
    .map((p) => ({ tenantId: p.tenantId, prestadorId: p.prestadorId, perfilId: p.id, nombrePublico: p.nombrePublico })) }
  const avisos = []
  const sinWhatsapp = new Set()
  const notificador = {
    ofrecer: async (aviso) => { if (sinWhatsapp.has(aviso.cuentaId)) return { enviada: false, motivo: 'sin_whatsapp' }; avisos.push({ tipo: 'oferta', ...aviso }); return { enviada: true } },
    cerradaPorOtro: async (aviso) => { avisos.push({ tipo: 'cerrada', ...aviso }) },
    alCliente: async (aviso) => { avisos.push({ tipo: 'cliente', cuentaId: aviso.cuentaId, evento: aviso.evento.tipo, prestador: aviso.evento.prestador ?? null, solicitudId: aviso.solicitudId }) },
  }
  let reloj = Date.now()
  const urgentes = crearServicioUrgentes({ prisma, cuentas: auth.store, candidatos, trabajos: work, notificador, env: {}, now: () => reloj })
  // A provider with its account linked (prestadores.cuenta_id) that opted in to urgent requests.
  async function prestadorUrgente(tag, nombre, opciones = {}) {
    const p = await prestador(tag, nombre, [['Reparación', 30000]])
    let cuenta = null
    if (opciones.cuenta !== false) {
      cuenta = await cliente('cuenta-' + tag)
      await prisma.account.update({ where: { id: cuenta.id }, data: { tenantId: p.tenantId } })
      await prisma.prestador.updateMany({ where: { tenantId: p.tenantId }, data: { cuentaId: cuenta.id } })
    }
    if (opciones.acepta !== false) await urgentes.guardarPreferencia(p.tenantId, true)
    if (opciones.cobertura) await prisma.perfilPublicoPrestador.updateMany({ where: { tenantId: p.tenantId }, data: { zona: opciones.cobertura[0], zonasCobertura: opciones.cobertura } })
    return { ...p, nombre, cuentaId: cuenta?.id ?? null, actor: { tenantId: p.tenantId, cuentaId: cuenta?.id ?? 'sin-cuenta' } }
  }
  async function clienteVerificado(tag) {
    const cuenta = await cliente(tag)
    await prisma.account.update({ where: { id: cuenta.id }, data: { emailVerifiedAt: new Date() } })
    return cuenta
  }
  const pedir = (cuenta, extra = {}) => urgentes.crear(cuenta.id, { category: oficio.id, description: 'Se me cortó toda la luz y está saltando la térmica', address: 'Av. 3 de Abril 1850', zone: ZONA, ...extra }, { origen: 'whatsapp' })
  const fila = (id) => prisma.solicitudServicio.findUnique({ where: { id } })
  const ofertas = async (id) => Object.fromEntries((await prisma.ofertaUrgente.findMany({ where: { solicitudId: id } })).map((o) => [o.prestadorTenantId, o]))
  const trabajosDe = (id) => prisma.trabajo.findMany({ where: { solicitudId: id } })
  const auditoria = async (id, evento) => (await prisma.auditEvent.findMany({ where: { eventType: evento, metadata: { path: ['solicitudId'], equals: id } } })).length
  const desde = (n) => avisos.slice(n)
  const resumen = (o) => o ? o.estado : null
`

test('URGENTE PostgreSQL: three providers are offered the request at once, the first that accepts is assigned, ONE work is born, the others are closed and told, the client is told; a provider that was not offered it, or arrives second, is refused', { skip }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const A = await prestadorUrgente('a', 'Flor Perez ' + run)
      const B = await prestadorUrgente('b', 'Gabriela Lopez ' + run)
      const C = await prestadorUrgente('c', 'Juan Diaz ' + run)
      const noAcepta = await prestadorUrgente('d', 'No Urgencias ' + run, { acepta: false })
      const sinCuenta = await prestadorUrgente('e', 'Sin Cuenta ' + run, { cuenta: false })
      const sinWa = await prestadorUrgente('f', 'Sin WhatsApp ' + run)
      sinWhatsapp.add(sinWa.cuentaId)
      const otraZona = await prestadorUrgente('g', 'Otra Zona ' + run, { cobertura: [OTRA_ZONA] })
      const ana = await clienteVerificado('ana')

      // An account that is not verified cannot ask for one.
      out.sinVerificar = (await pedir(await cliente('nadie'))).code
      out.invalida = await urgentes.crear(ana.id, { category: oficio.id, description: 'x', address: 'a', zone: 'No existe' })

      const creada = await pedir(ana)
      const id = creada.solicitud.id
      out.creada = { ok: creada.ok, estado: creada.solicitud.status, candidatos: creada.solicitud.candidates, notificados: creada.solicitud.notified, direccion: creada.solicitud.address, zona: creada.solicitud.zone === ZONA, mensaje: creada.mensaje }
      const guardada = await fila(id)
      out.fila = [guardada.urgencia, guardada.difusionUrgente, guardada.direccion, guardada.visibilidad, guardada.prestadorId, guardada.estadoAsignacion, guardada.origen, guardada.titulo, Math.round((guardada.expiraEn - guardada.creadaEn) / 60000)]
      let o = await ofertas(id)
      out.ofertas = { A: resumen(o[A.tenantId]), B: resumen(o[B.tenantId]), C: resumen(o[C.tenantId]), noAcepta: resumen(o[noAcepta.tenantId]), sinCuenta: [resumen(o[sinCuenta.tenantId]), o[sinCuenta.tenantId]?.motivoNoEnviada], sinWa: [resumen(o[sinWa.tenantId]), o[sinWa.tenantId]?.motivoNoEnviada], otraZona: resumen(o[otraZona.tenantId]) }
      const primeros = avisos.filter((x) => x.tipo === 'oferta')
      out.avisos = { cantidad: primeros.length, aQuien: primeros.map((x) => x.cuentaId).sort().join() === [A.cuentaId, B.cuentaId, C.cuentaId].sort().join(), uno: { cliente: primeros[0].cliente, servicio: primeros[0].servicio === oficio.nombre, direccion: primeros[0].direccion, zona: primeros[0].zona === ZONA, motivo: primeros[0].motivo, ronda: primeros[0].ronda } }
      // One open urgent request per account.
      out.otraAbierta = (await pedir(ana)).code
      out.sinTrabajoAntes = (await trabajosDe(id)).length

      // B is first.
      let marca = avisos.length
      const gana = await urgentes.asistir(B.actor, id, 'whatsapp')
      out.gana = { estado: gana.estado, trabajo: Boolean(gana.trabajoId), mensaje: gana.mensaje.includes('Av. 3 de Abril 1850') && gana.mensaje.includes('es tuya') }
      const tomada = await fila(id)
      out.tomada = [tomada.visibilidad, tomada.prestadorTenantId === B.tenantId, tomada.estadoAsignacion, tomada.estado, tomada.respondidaEn !== null]
      const trabajos = await trabajosDe(id)
      out.trabajo = [trabajos.length, trabajos[0].prestadorTenantId === B.tenantId, trabajos[0].estado, trabajos[0].tenantId === ana.tenantId, trabajos[0].trabajoId === gana.trabajoId]
      o = await ofertas(id)
      out.despues = { A: resumen(o[A.tenantId]), B: [resumen(o[B.tenantId]), o[B.tenantId].canalRespuesta, o[B.tenantId].aceptadaEn !== null], C: resumen(o[C.tenantId]), sinWa: resumen(o[sinWa.tenantId]) }
      const tras = desde(marca)
      out.avisosToma = { cliente: tras.filter((x) => x.tipo === 'cliente').map((x) => [x.evento, x.prestador === B.nombre, x.cuentaId === ana.id]), cerradas: tras.filter((x) => x.tipo === 'cerrada').map((x) => x.cuentaId).sort().join() === [A.cuentaId, C.cuentaId].sort().join(), aB: tras.filter((x) => x.cuentaId === B.cuentaId).length }
      out.auditoria = await auditoria(id, 'urgentes.solicitud_tomada')

      // Flor taps two seconds later; so does somebody the request was never offered to.
      marca = avisos.length
      const tarde = await urgentes.asistir(A.actor, id, 'whatsapp')
      out.tarde = [tarde.estado, tarde.mensaje === TEXTOS_URGENTE.yaTomada, tarde.trabajoId]
      out.ajeno = (await urgentes.asistir(noAcepta.actor, id, 'whatsapp')).estado
      out.elCliente = (await urgentes.asistir({ tenantId: ana.tenantId, cuentaId: ana.id }, id, 'web')).estado
      out.inexistente = (await urgentes.asistir(A.actor, 'no-existe', 'web')).estado
      // The same acceptance again (a webhook delivered twice): the same answer, nothing repeated.
      const otraVez = await urgentes.asistir(B.actor, id, 'whatsapp')
      out.idempotente = [otraVez.estado, otraVez.trabajoId === gana.trabajoId, (await trabajosDe(id)).length, await auditoria(id, 'urgentes.solicitud_tomada'), desde(marca).length]
      // Flor never became part of the work.
      out.florSinTrabajo = await prisma.trabajo.count({ where: { prestadorTenantId: A.tenantId } })
      out.noPuedeTarde = (await urgentes.noPuede(C.actor, id, 'whatsapp')).estado
      // What each one sees.
      out.vistaCliente = (await urgentes.mias(ana.id)).map((s) => [s.status, s.provider?.name === B.nombre, Boolean(s.workId)])
      out.vistaB = (await urgentes.ofertas(B.tenantId)).map((v) => [v.offer, v.assigned, v.open, v.address, Boolean(v.workId)])
      out.vistaA = (await urgentes.ofertas(A.tenantId)).map((v) => [v.offer, v.assigned, v.open, v.workId])
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.sinVerificar, 'ACCOUNT_NOT_ALLOWED')
  assert.deepEqual([r.invalida.ok, r.invalida.code, r.invalida.fields], [false, 'INVALID_REQUEST', ['description', 'address', 'zone']])
  assert.deepEqual({ ...r.creada, mensaje: undefined }, { ok: true, estado: 'pendiente', candidatos: 5, notificados: 3, direccion: 'Av. 3 de Abril 1850', zona: true, mensaje: undefined })
  assert.match(r.creada.mensaje, /^Listo\. Envié tu pedido urgente de .+ a 3 prestadores\. El primero que acepte queda asignado/u)
  assert.deepEqual(r.fila.slice(0, 7), ['urgente', true, 'Av. 3 de Abril 1850', 'publica', null, null, 'whatsapp'], 'one row of solicitudes_servicio, nobody assigned yet')
  assert.match(r.fila[7], /^Servicio urgente de /u)
  assert.equal(r.fila[8], 15, 'it waits 15 minutes to be taken')
  assert.deepEqual(r.ofertas, { A: 'notificada', B: 'notificada', C: 'notificada', noAcepta: null, sinCuenta: ['no_enviada', 'sin_cuenta'], sinWa: ['no_enviada', 'sin_whatsapp'], otraZona: null }, 'who opted out or covers another zone is not a candidate; who cannot be written to is recorded with the reason')
  assert.deepEqual(r.avisos, { cantidad: 3, aQuien: true, uno: { cliente: 'Cliente A.', servicio: true, direccion: 'Av. 3 de Abril 1850', zona: true, motivo: 'Se me cortó toda la luz y está saltando la térmica', ronda: 1 } }, 'the three are told at once, with the address and the zone')
  assert.equal(r.otraAbierta, 'URGENT_ALREADY_OPEN')
  assert.equal(r.sinTrabajoAntes, 0, 'no work exists before somebody accepts')
  assert.deepEqual(r.gana, { estado: 'asignado', trabajo: true, mensaje: true })
  assert.deepEqual(r.tomada, ['dirigida', true, 'aceptada', 'abierta', true])
  assert.deepEqual(r.trabajo, [1, true, 'requested', true, true], 'ONE work, of the winner, born through the normal flow (requested, budget required)')
  assert.deepEqual(r.despues, { A: 'cerrada_por_otro', B: ['acepto', 'whatsapp', true], C: 'cerrada_por_otro', sinWa: 'cerrada_por_otro' })
  assert.deepEqual(r.avisosToma, { cliente: [['tomada', true, true]], cerradas: true, aB: 0 }, 'the client is told who accepted; the other two that were notified are told it was taken')
  assert.equal(r.auditoria, 1)
  assert.deepEqual(r.tarde, ['ya_tomada', true, null], 'Flor gets "Esta solicitud ya fue tomada por otro prestador."')
  assert.equal(r.ajeno, 'no_candidato', 'a provider the request was not offered to cannot take it')
  assert.equal(r.elCliente, 'no_candidato')
  assert.equal(r.inexistente, 'no_candidato')
  assert.deepEqual(r.idempotente, ['asignado', true, 1, 1, 0], 'the same acceptance twice: same winner, one work, one audit line, no notice repeated')
  assert.equal(r.florSinTrabajo, 0, 'Flor is never associated to the work')
  assert.equal(r.noPuedeTarde, 'ya_tomada')
  assert.deepEqual(r.vistaCliente, [['tomada', true, true]])
  assert.deepEqual(r.vistaB, [['acepto', true, false, 'Av. 3 de Abril 1850', true]])
  assert.deepEqual(r.vistaA, [['cerrada_por_otro', false, false, null]])
})

test('URGENTE PostgreSQL carrera: two (and three) providers accept at the same time — exactly one winner, one work, one transition; the losers are told it was taken', { skip }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = { rondas: [] }
    try {
      const A = await prestadorUrgente('a', 'Flor ' + run)
      const B = await prestadorUrgente('b', 'Gabriela ' + run)
      const C = await prestadorUrgente('c', 'Juan ' + run)
      for (let i = 0; i < 6; i += 1) {
        const quien = await clienteVerificado('cli' + i)
        const id = (await pedir(quien)).solicitud.id
        const actores = i % 2 === 0 ? [A, B] : [A, B, C]
        const respuestas = await Promise.all(actores.map((p) => urgentes.asistir(p.actor, id, 'whatsapp')))
        const trabajos = await trabajosDe(id)
        const o = await ofertas(id)
        const f = await fila(id)
        out.rondas.push({
          estados: respuestas.map((x) => x.estado).sort(),
          perdedores: respuestas.filter((x) => x.estado !== 'asignado').every((x) => x.mensaje === TEXTOS_URGENTE.yaTomada && x.trabajoId === null),
          trabajos: trabajos.length,
          transiciones: await prisma.transicionTrabajo.count({ where: { trabajoId: trabajos[0]?.trabajoId ?? 'x' } }),
          ganadores: Object.values(o).filter((x) => x.estado === 'acepto').length,
          coherente: trabajos[0]?.prestadorTenantId === f.prestadorTenantId && o[f.prestadorTenantId]?.estado === 'acepto',
          tomas: await auditoria(id, 'urgentes.solicitud_tomada'),
          avisosCliente: avisos.filter((x) => x.tipo === 'cliente' && x.solicitudId === id && x.evento === 'tomada').length,
        })
      }
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.rondas.length, 6)
  for (const [i, ronda] of r.rondas.entries()) {
    assert.deepEqual(ronda.estados, i % 2 === 0 ? ['asignado', 'ya_tomada'] : ['asignado', 'ya_tomada', 'ya_tomada'], `round ${i}: exactly one winner`)
    assert.deepEqual({ ...ronda, estados: undefined }, { estados: undefined, perdedores: true, trabajos: 1, transiciones: 1, ganadores: 1, coherente: true, tomas: 1, avisosCliente: 1 }, `round ${i}`)
  }
})

test('URGENTE PostgreSQL cierres: nobody to offer it to, everybody says no, and nobody answers in time each close the request, tell the client and can never be taken afterwards', { skip }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // Nobody of that service takes urgent requests yet.
      const ana = await clienteVerificado('ana')
      const vacia = await pedir(ana)
      out.sinCandidatos = [vacia.ok, vacia.solicitud.status, vacia.solicitud.candidates, vacia.mensaje === TEXTOS_URGENTE.clienteSinCandidatos({ servicio: oficio.nombre, zona: ZONA })]
      const cerrada = await fila(vacia.solicitud.id)
      out.filaSinCandidatos = [cerrada.estado, cerrada.cierreUrgente]
      // The only provider cannot be written to: the same, and the reason stays on its offer.
      const sinWa = await prestadorUrgente('s', 'Sin WhatsApp ' + run)
      sinWhatsapp.add(sinWa.cuentaId)
      const sola = await pedir(await clienteVerificado('beto'))
      out.sinWhatsapp = [sola.solicitud.status, sola.solicitud.candidates, sola.solicitud.notified, (await ofertas(sola.solicitud.id))[sinWa.tenantId].motivoNoEnviada]

      const A = await prestadorUrgente('a', 'Flor ' + run)
      const B = await prestadorUrgente('b', 'Gabriela ' + run)
      // Everybody says no.
      const caro = await clienteVerificado('caro')
      const idNo = (await pedir(caro)).solicitud.id
      let marca = avisos.length
      out.primerNo = (await urgentes.noPuede(A.actor, idNo, 'whatsapp')).estado
      out.sigueAbierta = [(await fila(idNo)).estado, desde(marca).length]
      out.repetido = (await urgentes.noPuede(A.actor, idNo, 'whatsapp')).estado
      out.segundoNo = (await urgentes.noPuede(B.actor, idNo, 'web')).estado
      const todos = await fila(idNo)
      out.todosRechazaron = [todos.estado, todos.cierreUrgente, desde(marca).filter((x) => x.tipo === 'cliente').map((x) => [x.evento, x.cuentaId === caro.id]), (await trabajosDe(idNo)).length]
      out.aceptarCerrada = (await urgentes.asistir(A.actor, idNo, 'whatsapp')).estado
      const oNo = await ofertas(idNo)
      out.ofertasNo = [oNo[A.tenantId].estado, oNo[A.tenantId].canalRespuesta, oNo[B.tenantId].estado, oNo[B.tenantId].canalRespuesta]

      // Nobody answers in time.
      const dani = await clienteVerificado('dani')
      const idVence = (await pedir(dani)).solicitud.id
      out.antesDeVencer = await urgentes.procesarVencidas()
      reloj += 16 * 60000
      // Past its time and not swept yet: it cannot be taken any more.
      const tarde = await urgentes.asistir(A.actor, idVence, 'whatsapp')
      out.tarde = [tarde.estado, tarde.mensaje === TEXTOS_URGENTE.vencida, (await trabajosDe(idVence)).length]
      marca = avisos.length
      out.barrido = await urgentes.procesarVencidas()
      const vencida = await fila(idVence)
      out.vencida = [vencida.estado, vencida.cierreUrgente, vencida.prestadorId, desde(marca).filter((x) => x.tipo === 'cliente').map((x) => [x.evento, x.cuentaId === dani.id]), Object.values(await ofertas(idVence)).map((x) => x.estado).sort()]
      out.otraVez = await urgentes.procesarVencidas()
      out.despuesDelBarrido = (await urgentes.asistir(B.actor, idVence, 'web')).estado
      // A request somebody took is never expired by the sweep.
      const eva = await clienteVerificado('eva')
      const idTomada = (await pedir(eva)).solicitud.id
      await urgentes.asistir(A.actor, idTomada, 'whatsapp')
      reloj += 30 * 60000
      out.tomadaNoVence = [await urgentes.procesarVencidas(), (await fila(idTomada)).estadoAsignacion, (await fila(idTomada)).cierreUrgente]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.sinCandidatos, [true, 'sin_candidatos', 0, true], 'no compatible provider: closed at once, and the client is told why')
  assert.deepEqual(r.filaSinCandidatos, ['cerrada', 'sin_candidatos'])
  assert.deepEqual(r.sinWhatsapp, ['sin_candidatos', 1, 0, 'sin_whatsapp'], 'a candidate TUS cannot write to is recorded, and the request does not wait for nobody')
  assert.equal(r.primerNo, 'no_puede')
  assert.deepEqual(r.sigueAbierta, ['abierta', 0], 'one "no puedo" does not close the request while others can still answer')
  assert.equal(r.repetido, 'ya_respondida')
  assert.equal(r.segundoNo, 'no_puede')
  assert.deepEqual(r.todosRechazaron, ['cerrada', 'todos_rechazaron', [['todos_rechazaron', true]], 0], 'everybody said no: closed, the client told once, no work')
  assert.equal(r.aceptarCerrada, 'no_disponible')
  assert.deepEqual(r.ofertasNo, ['no_puede', 'whatsapp', 'no_puede', 'web'])
  assert.equal(r.antesDeVencer, 0)
  assert.deepEqual(r.tarde, ['vencida', true, 0], 'accepting after the time is refused, even before the sweep ran')
  assert.equal(r.barrido, 1)
  assert.deepEqual(r.vencida, ['cerrada', 'vencida', null, [['vencida', true]], ['vencida', 'vencida', 'vencida']], 'closed, the client told, and no offer left to take')
  assert.equal(r.otraVez, 0, 'the sweep closes it once')
  assert.equal(r.despuesDelBarrido, 'vencida')
  assert.deepEqual(r.tomadaNoVence, [0, 'aceptada', null])
})

test('URGENTE PostgreSQL renuncia: the assigned provider says it cannot go — its acceptance and its resignation stay recorded, the client is told, the SAME request is offered again to the others (never to it), the next that accepts gets the SAME work, and the history reads A -> gave it back -> B', { skip }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const A = await prestadorUrgente('a', 'Gabriela Lopez ' + run)
      const B = await prestadorUrgente('b', 'Flor Perez ' + run)
      const C = await prestadorUrgente('c', 'Juan Diaz ' + run)
      const D = await prestadorUrgente('d', 'Dijo Que No ' + run)
      const ana = await clienteVerificado('ana')
      const id = (await pedir(ana)).solicitud.id
      await urgentes.noPuede(D.actor, id, 'whatsapp')
      const gana = await urgentes.asistir(A.actor, id, 'whatsapp')
      out.aGana = [gana.estado, (await trabajosDe(id)).length, (await fila(id)).prestadorTenantId === A.tenantId]
      const trabajoId = gana.trabajoId
      const expiraAntes = (await fila(id)).expiraEn.getTime()

      // A minute later: "al final no puedo ir".
      reloj += 60000
      let marca = avisos.length
      // A provider that became valid meanwhile joins the new round.
      const E = await prestadorUrgente('e', 'Nueva ' + run)
      const renuncia = await urgentes.noPuede(A.actor, id, 'whatsapp', { motivo: 'Se me rompió la camioneta' })
      out.renuncia = [renuncia.estado, renuncia.mensaje === TEXTOS_URGENTE.renunciaRegistrada]
      let o = await ofertas(id)
      out.ofertaA = [o[A.tenantId].estado, o[A.tenantId].aceptadaEn !== null, o[A.tenantId].renunciaEn !== null, o[A.tenantId].renunciaEn > o[A.tenantId].aceptadaEn, o[A.tenantId].canalRenuncia, o[A.tenantId].motivoRenuncia]
      const reabierta = await fila(id)
      out.reabierta = [reabierta.estado, reabierta.estadoAsignacion, reabierta.reaperturasUrgente, reabierta.cierreUrgente, Math.round((reabierta.expiraEn.getTime() - reloj) / 60000), reabierta.expiraEn.getTime() > expiraAntes]
      out.vistaReabierta = (await urgentes.mias(ana.id)).map((s) => [s.status, s.provider, s.workId, s.reopenings])
      let trabajos = await trabajosDe(id)
      out.trabajoLiberado = [trabajos.length, trabajos[0].trabajoId === trabajoId, trabajos[0].estado, trabajos[0].canceladoPorRol, trabajos[0].motivoCancelacion]
      const tras = desde(marca)
      out.avisosRenuncia = {
        cliente: tras.filter((x) => x.tipo === 'cliente').map((x) => [x.evento, x.prestador === A.nombre, x.cuentaId === ana.id]),
        ofertas: tras.filter((x) => x.tipo === 'oferta').map((x) => x.cuentaId).sort().join() === [B.cuentaId, C.cuentaId, E.cuentaId].sort().join(),
        ronda: [...new Set(tras.filter((x) => x.tipo === 'oferta').map((x) => x.ronda))],
        aQuienRenuncio: tras.filter((x) => x.cuentaId === A.cuentaId).length,
        aQuienDijoNo: tras.filter((x) => x.cuentaId === D.cuentaId).length,
      }
      out.ofertasReabierta = { B: [o[B.tenantId].estado, o[B.tenantId].ronda], C: [o[C.tenantId].estado, o[C.tenantId].ronda], D: o[D.tenantId].estado, E: [o[E.tenantId].estado, o[E.tenantId].ronda] }
      // The same notice again (a duplicated webhook): nothing is reopened twice.
      marca = avisos.length
      const repetida = await urgentes.noPuede(A.actor, id, 'whatsapp', { motivo: 'otra vez' })
      out.repetida = [repetida.estado, (await fila(id)).reaperturasUrgente, desde(marca).length, await auditoria(id, 'urgentes.asignacion_renunciada')]
      // Who gave it back can never win it again.
      out.aVuelve = [(await urgentes.asistir(A.actor, id, 'whatsapp')).estado, (await fila(id)).estadoAsignacion]

      // B takes it.
      marca = avisos.length
      const bGana = await urgentes.asistir(B.actor, id, 'web')
      out.bGana = [bGana.estado, bGana.trabajoId === trabajoId]
      const final = await fila(id)
      out.final = [final.prestadorTenantId === B.tenantId, final.estadoAsignacion, final.visibilidad, final.estado]
      trabajos = await trabajosDe(id)
      out.trabajoFinal = [trabajos.length, trabajos[0].trabajoId === trabajoId, trabajos[0].prestadorTenantId === B.tenantId, trabajos[0].estado, trabajos[0].canceladoPorRol, trabajos[0].motivoCancelacion]
      out.unSoloTrabajoEnTotal = await prisma.trabajo.count({ where: { solicitudId: id } })
      o = await ofertas(id)
      out.ofertasFinal = { A: o[A.tenantId].estado, B: [o[B.tenantId].estado, o[B.tenantId].canalRespuesta], C: o[C.tenantId].estado, D: o[D.tenantId].estado, E: o[E.tenantId].estado, activas: Object.values(o).filter((x) => x.estado === 'acepto').length }
      out.avisosB = { cliente: desde(marca).filter((x) => x.tipo === 'cliente').map((x) => [x.evento, x.prestador === B.nombre]), cerradas: desde(marca).filter((x) => x.tipo === 'cerrada').map((x) => x.cuentaId).sort().join() === [C.cuentaId, E.cuentaId].sort().join() }
      // The history: one file for the whole urgency.
      out.transiciones = (await prisma.transicionTrabajo.findMany({ where: { trabajoId }, orderBy: { version: 'asc' } })).map((t) => [t.estadoAnterior, t.estadoNuevo, t.motivo])
      out.historial = [await auditoria(id, 'urgentes.solicitud_tomada'), await auditoria(id, 'urgentes.asignacion_renunciada')]
      out.auditoriaTrabajo = (await prisma.auditoriaTrabajo.findMany({ where: { trabajoId }, orderBy: { fechaCreacion: 'asc' } })).map((x) => x.accion)
      out.aNoVeElTrabajo = [(await urgentes.asistir(A.actor, id, 'whatsapp')).estado, await prisma.trabajo.count({ where: { prestadorTenantId: A.tenantId } })]
      out.cTarde = (await urgentes.asistir(C.actor, id, 'whatsapp')).estado
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.aGana, ['asignado', 1, true])
  assert.deepEqual(r.renuncia, ['renuncia', true], '"no puedo" from the ASSIGNED provider is giving the assignment back, not a rejection')
  assert.deepEqual(r.ofertaA, ['renuncio', true, true, true, 'whatsapp', 'Se me rompió la camioneta'], 'the acceptance stays recorded, and after it the resignation with its time, channel and words')
  assert.deepEqual(r.reabierta, ['abierta', 'cancelada', 1, null, 15, true], 'the same request is open again, with a new 15 minute window')
  assert.deepEqual(r.vistaReabierta, [['pendiente', null, null, 1]], 'for the client it is searching again')
  assert.deepEqual(r.trabajoLiberado, [1, true, 'cancelled', 'prestador', 'Se me rompió la camioneta'], 'the work is released (never deleted) with the reason')
  assert.deepEqual(r.avisosRenuncia, { cliente: [['renuncia', true, true]], ofertas: true, ronda: [2], aQuienRenuncio: 0, aQuienDijoNo: 0 }, 'the client is told; the others are offered it again (a new provider too); never who gave it back nor who had said no')
  assert.deepEqual(r.ofertasReabierta, { B: ['notificada', 2], C: ['notificada', 2], D: 'no_puede', E: ['notificada', 2] })
  assert.deepEqual(r.repetida, ['ya_renuncio', 1, 0, 1], 'the same resignation twice reopens nothing again')
  assert.deepEqual(r.aVuelve, ['ya_renuncio', 'cancelada'], 'A cannot win the request it gave back')
  assert.deepEqual(r.bGana, ['asignado', true], 'B is assigned and gets the SAME work')
  assert.deepEqual(r.final, [true, 'aceptada', 'dirigida', 'abierta'])
  assert.deepEqual(r.trabajoFinal, [1, true, true, 'requested', null, null], 'still exactly one work for the request, now of B, requested again')
  assert.equal(r.unSoloTrabajoEnTotal, 1)
  assert.deepEqual(r.ofertasFinal, { A: 'renuncio', B: ['acepto', 'web'], C: 'cerrada_por_otro', D: 'no_puede', E: 'cerrada_por_otro', activas: 1 }, 'never two active assignments')
  assert.deepEqual(r.avisosB, { cliente: [['tomada', true]], cerradas: true })
  assert.deepEqual(r.transiciones, [[null, 'requested', 'work.created_from_request'], ['requested', 'cancelled', 'work.released_by_provider'], ['cancelled', 'requested', 'work.reassigned_from_request']], 'A accepted -> A gave it back -> B accepted, on one work')
  assert.deepEqual(r.historial, [2, 1])
  assert.deepEqual(r.auditoriaTrabajo, ['work.created_from_request', 'work.released_by_provider', 'work.reassigned_from_request'])
  assert.deepEqual(r.aNoVeElTrabajo, ['ya_renuncio', 0])
  assert.equal(r.cTarde, 'ya_tomada')
})

test('URGENTE PostgreSQL renuncia en carrera y con avances: after the assigned provider gives the request back, two providers accepting at once leave exactly one winner and one work; a work that already moved on is never swapped', { skip }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = { rondas: [] }
    try {
      const A = await prestadorUrgente('a', 'Gabriela ' + run)
      const B = await prestadorUrgente('b', 'Flor ' + run)
      const C = await prestadorUrgente('c', 'Juan ' + run)
      for (let i = 0; i < 4; i += 1) {
        const quien = await clienteVerificado('cli' + i)
        const id = (await pedir(quien)).solicitud.id
        await urgentes.asistir(A.actor, id, 'whatsapp')
        // The resignation and the two acceptances arrive together. An acceptance that runs before
        // the resignation commits is refused (the request was still A's): it may simply try again.
        const [renuncia, b, c] = await Promise.all([urgentes.renunciar(A.actor, id, 'whatsapp', { motivo: 'no llego' }), urgentes.asistir(B.actor, id, 'whatsapp'), urgentes.asistir(C.actor, id, 'whatsapp')])
        let ganadores = [b, c].filter((x) => x.estado === 'asignado').length
        if (ganadores === 0) {
          const [b2, c2] = await Promise.all([urgentes.asistir(B.actor, id, 'whatsapp'), urgentes.asistir(C.actor, id, 'whatsapp')])
          ganadores = [b2, c2].filter((x) => x.estado === 'asignado').length
        }
        const trabajos = await trabajosDe(id)
        const o = await ofertas(id)
        const f = await fila(id)
        out.rondas.push({ renuncia: renuncia.estado, ganadores, trabajos: trabajos.length, deQuien: [B.tenantId, C.tenantId].includes(trabajos[0].prestadorTenantId) && trabajos[0].prestadorTenantId === f.prestadorTenantId, estado: trabajos[0].estado, activas: Object.values(o).filter((x) => x.estado === 'acepto').length, A: o[A.tenantId].estado, asignacion: f.estadoAsignacion })
      }
      // Something already happened on the work: giving it back is a cancellation, not a swap.
      const ana = await clienteVerificado('ana')
      const id = (await pedir(ana)).solicitud.id
      const gana = await urgentes.asistir(A.actor, id, 'whatsapp')
      await prisma.trabajo.updateMany({ where: { trabajoId: gana.trabajoId }, data: { estado: 'in_diagnosis' } })
      const marca = avisos.length
      const conAvances = await urgentes.renunciar(A.actor, id, 'whatsapp', { motivo: 'no llego' })
      const f = await fila(id)
      out.conAvances = [conAvances.estado, conAvances.mensaje === TEXTOS_URGENTE.renunciaConAvances, f.estadoAsignacion, f.prestadorTenantId === A.tenantId, f.reaperturasUrgente, (await ofertas(id))[A.tenantId].estado, (await trabajosDe(id))[0].estado, desde(marca).length]
      // Only the assigned provider can give it back.
      out.noAsignado = (await urgentes.renunciar(B.actor, id, 'whatsapp')).estado
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  for (const [i, ronda] of r.rondas.entries())
    assert.deepEqual(ronda, { renuncia: 'renuncia', ganadores: 1, trabajos: 1, deQuien: true, estado: 'requested', activas: 1, A: 'renuncio', asignacion: 'aceptada' }, `round ${i}: exactly one of B / C wins, on one work`)
  assert.deepEqual(r.conAvances, ['con_avances', true, 'aceptada', true, 0, 'acepto', 'in_diagnosis', 0], 'with progress on the work nothing is reopened: the cancellation flow of the work applies')
  assert.equal(r.noAsignado, 'no_asignado')
})

test('URGENTE HTTP PostgreSQL: the routes take who acts from the session only — a body cannot name an account or a winner, another provider cannot answer for the assigned one, the preference is the provider\'s own, and the administration list needs the admin permission', { skip }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { crearRouterUrgentes } = await import('./apps/api/src/tus/urgentes/http.ts')
    const out = {}
    let servidor
    try {
      const A = await prestadorUrgente('a', 'Gabriela Lopez ' + run)
      const B = await prestadorUrgente('b', 'Flor Perez ' + run)
      const nuevo = await prestadorUrgente('n', 'Recién Llegado ' + run, { acepta: false })
      const ana = await clienteVerificado('ana')
      const sesiones = new Map([
        ['t-ana', { tenantId: ana.tenantId, subjectId: ana.id, permissions: [] }],
        ['t-a', { tenantId: A.tenantId, subjectId: A.cuentaId, permissions: [] }],
        ['t-b', { tenantId: B.tenantId, subjectId: B.cuentaId, permissions: [] }],
        ['t-n', { tenantId: nuevo.tenantId, subjectId: nuevo.cuentaId, permissions: [] }],
        ['t-admin', { tenantId: 'platform', subjectId: 'admin-1', permissions: ['tus:providers:admin'] }],
      ])
      const sessions = { resolve: async (token, correlationId) => (sesiones.has(token) ? { ...sesiones.get(token), sessionId: 's', roles: [], correlationId } : null) }
      const app = express()
      app.use(express.json())
      app.use(crearRouterUrgentes({ servicio: urgentes, sessions, admin: { nombres: async (ids) => new Map((await prisma.perfilPublicoPrestador.findMany({ where: { tenantId: { in: [...ids] } } })).map((p) => [p.tenantId, { id: p.id, nombrePublico: p.nombrePublico }])) } }))
      servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
      const base = 'http://127.0.0.1:' + servidor.address().port
      const llamar = async (token, method, path, body) => {
        const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token, 'x-correlation-id': 'corr-http' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
        return { status: res.status, body: await res.json().catch(() => null), cache: res.headers.get('cache-control') }
      }
      const pedido = { category: oficio.id, description: 'Se cortó toda la luz de la casa', address: 'Av. 3 de Abril 1850', zone: ZONA }

      out.sinSesion = (await llamar(null, 'POST', '/tus/v1/urgentes', pedido)).status
      out.autoridad = (await llamar('t-ana', 'POST', '/tus/v1/urgentes', { ...pedido, prestadorId: A.prestadorId })).status
      out.invalida = await llamar('t-ana', 'POST', '/tus/v1/urgentes', { ...pedido, address: 'x' })
      const creada = await llamar('t-ana', 'POST', '/tus/v1/urgentes', pedido)
      const id = creada.body.id
      out.creada = [creada.status, creada.body.status, creada.body.notified, creada.body.address, typeof creada.body.message, creada.cache]
      const repetida = await llamar('t-ana', 'POST', '/tus/v1/urgentes', pedido)
      out.repetida = [repetida.status, repetida.body.code]
      out.mias = (await llamar('t-ana', 'GET', '/tus/v1/urgentes/mias')).body.items.map((x) => [x.id === id, x.status])

      // The provider side: its own offers, with the address.
      const ofertasA = await llamar('t-a', 'GET', '/tus/v1/prestador/urgentes')
      out.ofertasA = ofertasA.body.items.map((x) => [x.id === id, x.offer, x.open, x.address, x.zone === ZONA, x.client])
      out.ofertasDeOtro = (await llamar('t-n', 'GET', '/tus/v1/prestador/urgentes')).body.items.length
      out.clienteNoVeOfertas = (await llamar('t-ana', 'GET', '/tus/v1/prestador/urgentes')).body.items.length
      // The preference is the provider's own.
      out.preferencia = [(await llamar('t-n', 'GET', '/tus/v1/prestador/urgentes/preferencia')).body, (await llamar('t-n', 'PUT', '/tus/v1/prestador/urgentes/preferencia', { acceptsUrgent: 'si' })).status, (await llamar('t-n', 'PUT', '/tus/v1/prestador/urgentes/preferencia', { acceptsUrgent: true })).body, (await llamar('t-ana', 'GET', '/tus/v1/prestador/urgentes/preferencia')).status]
      // Somebody the request was not offered to.
      out.ajeno = await llamar('t-n', 'POST', '/tus/v1/prestador/urgentes/' + id + '/asistir', {})
      const gana = await llamar('t-a', 'POST', '/tus/v1/prestador/urgentes/' + id + '/asistir', {})
      out.gana = [gana.status, gana.body.status, typeof gana.body.workId]
      const pierde = await llamar('t-b', 'POST', '/tus/v1/prestador/urgentes/' + id + '/asistir', {})
      out.pierde = [pierde.status, pierde.body.status, pierde.body.message, pierde.body.workId]
      // B cannot give back what belongs to A; A can, from the Web, with a reason.
      out.bNoRenuncia = (await llamar('t-b', 'POST', '/tus/v1/prestador/urgentes/' + id + '/no-puedo', { reason: 'no es mío' })).body.status
      const renuncia = await llamar('t-a', 'POST', '/tus/v1/prestador/urgentes/' + id + '/no-puedo', { reason: 'Me surgió otra urgencia' })
      out.renuncia = [renuncia.status, renuncia.body.status]
      const oferta = await prisma.ofertaUrgente.findFirst({ where: { solicitudId: id, prestadorTenantId: A.tenantId } })
      out.ofertaA = [oferta.estado, oferta.canalRenuncia, oferta.motivoRenuncia]

      // Administration.
      out.adminSinPermiso = [(await llamar('t-a', 'GET', '/tus/v1/admin/urgentes')).status, (await llamar(null, 'GET', '/tus/v1/admin/urgentes')).status]
      const admin = await llamar('t-admin', 'GET', '/tus/v1/admin/urgentes?page=1&pageSize=10')
      const fila = admin.body.items.find((x) => x.id === id)
      out.admin = { status: admin.status, total: admin.body.total >= 1 && admin.body.page === 1 && admin.body.pageSize === 10, estado: fila.status, cliente: fila.client, direccion: fila.address, zona: fila.zone === ZONA, origen: fila.origin, reaperturas: fila.reopenings, conteos: fila.counts, candidatos: fila.candidates.map((c) => [c.provider.name.split(' ').slice(0, 2).join(' '), c.status, c.round, Boolean(c.notifiedAt), Boolean(c.acceptedAt), Boolean(c.resignedAt), c.resignationReason]).sort() }
    } finally { await new Promise((resolve) => (servidor ? servidor.close(resolve) : resolve())); await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.sinSesion, 401)
  assert.equal(r.autoridad, 403, 'a body cannot say who the provider is')
  assert.deepEqual([r.invalida.status, r.invalida.body.code, r.invalida.body.fields], [422, 'INVALID_REQUEST', ['address']])
  assert.deepEqual(r.creada, [201, 'pendiente', 2, 'Av. 3 de Abril 1850', 'string', 'no-store'])
  assert.deepEqual(r.repetida, [409, 'URGENT_ALREADY_OPEN'])
  assert.deepEqual(r.mias, [[true, 'pendiente']])
  assert.deepEqual(r.ofertasA, [[true, 'notificada', true, 'Av. 3 de Abril 1850', true, 'Cliente A.']], 'the provider sees the address and the zone from the first moment')
  assert.equal(r.ofertasDeOtro, 0)
  assert.equal(r.clienteNoVeOfertas, 0)
  assert.deepEqual(r.preferencia, [{ acceptsUrgent: false }, 422, { acceptsUrgent: true }, 409], 'off by default; only the provider turns it on')
  assert.deepEqual([r.ajeno.status, r.ajeno.body.status], [404, 'no_candidato'])
  assert.deepEqual(r.gana, [200, 'asignado', 'string'])
  assert.deepEqual(r.pierde, [409, 'ya_tomada', 'Esta solicitud ya fue tomada por otro prestador.', null])
  assert.equal(r.bNoRenuncia, 'ya_tomada', 'only the assigned provider can give the request back')
  assert.deepEqual(r.renuncia, [200, 'renuncia'])
  assert.deepEqual(r.ofertaA, ['renuncio', 'web', 'Me surgió otra urgencia'])
  assert.deepEqual(r.adminSinPermiso, [403, 401])
  assert.deepEqual(r.admin, {
    status: 200,
    total: true,
    estado: 'pendiente',
    cliente: 'Cliente A.',
    direccion: 'Av. 3 de Abril 1850',
    zona: true,
    origen: 'web_publica',
    reaperturas: 1,
    conteos: { candidates: 3, notified: 3, rejected: 0, resigned: 1, unanswered: 2, deliveryFailed: 0 },
    // The provider that turned urgent requests on meanwhile joined the second round.
    candidatos: [['Flor Perez', 'notificada', 2, true, false, false, null], ['Gabriela Lopez', 'renuncio', 1, true, true, true, 'Me surgió otra urgencia'], ['Recién Llegado', 'notificada', 2, true, false, false, null]],
  }, 'Admin reads the request, its candidates, who took it and who gave it back')
})
