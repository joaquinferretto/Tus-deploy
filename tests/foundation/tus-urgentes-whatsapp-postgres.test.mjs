import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'
import { ASISTENTE_TURNOS } from './fixtures/turnos-whatsapp-pg.mjs'

// SERVICIO-URGENTE-01 through WhatsApp, on a DISPOSABLE PostgreSQL 16 (TUS_PAYMENTS_PG_URL). The
// acceptance conversation, end to end:
//
//   a client writes it needs a service urgently, with its address and zone -> TUS reads the
//   service, the address, the zone and what happened -> the request is created and offered at once
//   to every provider that takes urgent requests -> each one gets the notice with "Puedo asistir" /
//   "No puedo" -> the first that taps is assigned, ONE work is born, the client and the others are
//   told -> a later tap is refused -> the assigned provider writes it cannot go after all: the
//   client is told, the others are offered it again and the next one gets the same work.
//
// REAL: the WhatsApp assistant (ingest, worker, orchestrator, notifier), the urgent service and its
// store, the work service, PostgreSQL. STAND-INS at the edge: Meta (FakeWhatsappProvider: what
// would be sent is recorded, nothing leaves) and the directory (the visible profiles of that
// service). No model: the backend reads the message. So this proves the code, NOT a delivery by
// Meta.
const url = process.env.TUS_PAYMENTS_PG_URL
const skip = !url && 'TUS_PAYMENTS_PG_URL not set (disposable PostgreSQL 16 only)'

const SETUP = turnosPagosSetup(url)
// Inside the scenario's own block: the assistant fixture declares names of its own.
const URGENTES = `
  ${ASISTENTE_TURNOS}
  const { crearServicioUrgentes } = await import('./apps/api/src/tus/urgentes/composicion.ts')
  const { TEXTOS_URGENTE } = await import('./apps/api/src/tus/urgentes/modelo.ts')
  const { NotificadorUrgentesWhatsapp, idRespuestaUrgente, PLANTILLA_SERVICIO_URGENTE } = await import('./apps/api/src/tus/asistente/avisos-urgentes.ts')
  // Stand-in of the directory: the visible profiles of that service; every provider of this
  // scenario lists the zones the requests are in (the coverage rule has its own tests).
  const candidatos = { aptosParaUrgencia: async ({ oficio: o, zona }) => (await prisma.perfilPublicoPrestador.findMany({ where: { visible: true, oficio: o, id: { startsWith: run } } })).map((p) => ({ tenantId: p.tenantId, prestadorId: p.prestadorId, perfilId: p.id, nombrePublico: p.nombrePublico, cobertura: 'zonas' })) }
  const urgentes = crearServicioUrgentes({ prisma, cuentas: auth.store, candidatos, trabajos: work, notificador: modulo.avisosUrgentes, env: {}, now: () => reloj })
  compartidos.urgentes = urgentes
  // A provider with its account, its WhatsApp linked (window open) and urgent requests on.
  async function prestadorWa(tag, nombre) {
    const p = await prestador(tag, nombre, [['Reparación', 30000]])
    const cuenta = await cuentaDe(p, 'cuenta-' + tag)
    const wa = await vincular(cuenta)
    await urgentes.guardarPreferencia(p.tenantId, true)
    return { ...p, nombre, cuenta, wa, actor: { tenantId: p.tenantId, cuentaId: cuenta.id } }
  }
  async function clienteWa(tag) {
    const cuenta = await cliente(tag)
    await prisma.account.update({ where: { id: cuenta.id }, data: { emailVerifiedAt: new Date() } })
    return { cuenta, wa: await vincular(cuenta) }
  }
  const tocar = (decision, id) => ({ type: 'interactive', body: { interactive: { type: 'button_reply', button_reply: { id: idRespuestaUrgente(decision, id), title: decision === 'asistir' ? 'Puedo asistir' : 'No puedo' } } } })
  const urgenteDe = async (cuentaId) => prisma.solicitudServicio.findFirst({ where: { cuentaId, difusionUrgente: true }, orderBy: { creadaEn: 'desc' } })
  const trabajosDe = (id) => prisma.trabajo.findMany({ where: { solicitudId: id } })
  const ofertas = async (id) => Object.fromEntries((await prisma.ofertaUrgente.findMany({ where: { solicitudId: id } })).map((o) => [o.prestadorTenantId, o.estado]))
  const textos = (waId, desde) => enviadosA(waId, desde).map((m) => m.text ?? m.type)
`

test('URGENTE WhatsApp PostgreSQL: the acceptance conversation — the client writes one message, every provider that takes urgent requests gets the notice with the address and two buttons, the first tap wins, the second is told it was taken, and the assigned provider can say in its own words that it cannot go', { skip }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      ${URGENTES}
      const gabi = await prestadorWa('g', 'Gabriela Lopez ' + run)
      const flor = await prestadorWa('f', 'Flor Perez ' + run)
      const juan = await prestadorWa('j', 'Juan Diaz ' + run)
      const joaquin = await clienteWa('joaquin')


      // 1. One message with the service, the address, the zone and what happened.
      let marca = fakeWa.sent.length
      const respuesta = await decir(joaquin.wa, 'Necesito un plomero urgente, estoy en Av. 3 de Abril 1850, Barrio Sur. Se me rompió un caño y se inunda la cocina.')
      const solicitud = await urgenteDe(joaquin.cuenta.id)
      const id = solicitud.id
      out.creada = { respuesta, categoria: solicitud.categoria === oficio.id, direccion: solicitud.direccion, zona: solicitud.zona, motivo: solicitud.descripcion, origen: solicitud.origen, urgencia: solicitud.urgencia, difusion: solicitud.difusionUrgente }
      // 2. The three providers are told at once, with the address, the zone and two buttons.
      const aviso = enviadosA(gabi.wa, marca)
      out.aviso = { cantidad: [enviadosA(gabi.wa, marca).length, enviadosA(flor.wa, marca).length, enviadosA(juan.wa, marca).length], tipo: aviso[0].type, texto: aviso[0].text, botones: aviso[0].buttons.map((b) => b.title), ids: aviso[0].buttons.map((b) => b.id.replace(id, '<id>')) }
      out.avisoMeta = cuerpoMensajeMeta(gabi.wa, aviso[0]).interactive.action.buttons.map((b) => b.reply.title)
      out.ofertas = await ofertas(id)
      // What Admin reads of those notices: one per provider, with the status Meta reported.
      const entregas = await modulo.soporte.entregasPorCorrelacion(['urgente-oferta:' + id + ':1'])
      out.entregas = [entregas.length, [...new Set(entregas.map((e) => e.status))], entregas.map((e) => e.cuentaId).sort().join() === [gabi.cuenta.id, flor.cuenta.id, juan.cuenta.id].sort().join(), entregas.every((e) => /^\\*{4}\\d{4}$/u.test(e.waIdMasked))]

      // 3. Gabriela taps first.
      marca = fakeWa.sent.length
      out.gabriela = await decir(gabi.wa, '', tocar('asistir', id))
      const tomada = await prisma.solicitudServicio.findUnique({ where: { id } })
      out.tomada = [tomada.prestadorTenantId === gabi.tenantId, tomada.estadoAsignacion, (await trabajosDe(id)).length, (await trabajosDe(id))[0].prestadorTenantId === gabi.tenantId]
      out.alCliente = textos(joaquin.wa, marca)
      out.aLosOtros = [textos(flor.wa, marca), textos(juan.wa, marca)]
      // 4. Flor taps two seconds later.
      out.flor = await decir(flor.wa, '', tocar('asistir', id))
      out.florSinTrabajo = await prisma.trabajo.count({ where: { prestadorTenantId: flor.tenantId } })
      // The same tap of Gabriela again (Meta repeats a webhook with the same id; and a new tap).
      const repetido = 'wamid.urg-' + run
      await decir(gabi.wa, '', tocar('asistir', id), repetido)
      out.webhookRepetido = [(await decir(gabi.wa, '', tocar('asistir', id), repetido)).length, (await trabajosDe(id)).length, await prisma.auditEvent.count({ where: { eventType: 'urgentes.solicitud_tomada', metadata: { path: ['solicitudId'], equals: id } } })]
      // A number that is not a provider's cannot answer.
      out.noPrestador = await decir(joaquin.wa, '', tocar('asistir', id))

      // 5. A minute later Gabriela writes, in her own words, that she cannot go.
      marca = fakeWa.sent.length
      out.renuncia = await decir(gabi.wa, 'Al final no puedo ir, se me rompió la camioneta')
      const reabierta = await prisma.solicitudServicio.findUnique({ where: { id } })
      out.reabierta = [reabierta.estadoAsignacion, reabierta.reaperturasUrgente, (await trabajosDe(id))[0].estado]
      const ofertaGabi = await prisma.ofertaUrgente.findFirst({ where: { solicitudId: id, prestadorTenantId: gabi.tenantId } })
      out.ofertaGabi = [ofertaGabi.estado, ofertaGabi.aceptadaEn !== null, ofertaGabi.renunciaEn !== null, ofertaGabi.canalRenuncia, ofertaGabi.motivoRenuncia]
      out.clienteRenuncia = textos(joaquin.wa, marca)
      out.reofrecida = { flor: enviadosA(flor.wa, marca).map((m) => m.type), juan: enviadosA(juan.wa, marca).map((m) => m.type), gabi: enviadosA(gabi.wa, marca).filter((m) => m.type === 'buttons').length }
      // 6. Flor takes it now: the same work is hers.
      marca = fakeWa.sent.length
      out.florGana = await decir(flor.wa, '', tocar('asistir', id))
      const trabajos = await trabajosDe(id)
      out.final = [trabajos.length, trabajos[0].prestadorTenantId === flor.tenantId, trabajos[0].estado, await ofertas(id)]
      out.clienteFinal = textos(joaquin.wa, marca)
      // Gabriela cannot take back what she gave back; "no puedo ir" again changes nothing.
      out.gabiVuelve = await decir(gabi.wa, '', tocar('asistir', id))
      out.transiciones = (await prisma.transicionTrabajo.findMany({ where: { trabajoId: trabajos[0].trabajoId }, orderBy: { version: 'asc' } })).map((t) => t.motivo)
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.creada.respuesta.length, 1)
  assert.match(r.creada.respuesta[0], /^Listo\. Envié tu pedido urgente de Plomería a 3 prestadores\. El primero que acepte queda asignado y te aviso enseguida\. Si nadie responde en 15 minutos, te lo digo\.$/u)
  assert.deepEqual({ ...r.creada, respuesta: undefined }, { respuesta: undefined, categoria: true, direccion: 'Av. 3 de Abril 1850', zona: 'Barrio Sur', motivo: 'Se me rompió un caño y se inunda la cocina', origen: 'whatsapp', urgencia: 'urgente', difusion: true }, 'the backend read the service, the address, the zone and what happened')
  assert.deepEqual(r.aviso.cantidad, [1, 1, 1], 'the three are told at once')
  assert.equal(r.aviso.tipo, 'buttons')
  assert.equal(r.aviso.texto, 'Hola, Cliente J. necesita un servicio urgente de Plomería.\nDirección: Av. 3 de Abril 1850\nBarrio/Zona: Barrio Sur\nMotivo: Se me rompió un caño y se inunda la cocina\n¿Podés asistir ahora?')
  assert.deepEqual(r.aviso.botones, ['Puedo asistir', 'No puedo'])
  assert.deepEqual(r.aviso.ids, ['urgente:asistir:<id>', 'urgente:nopuedo:<id>'], 'a button says which request and which answer, never who answers')
  assert.deepEqual(r.avisoMeta, ['Puedo asistir', 'No puedo'])
  assert.deepEqual(Object.values(r.ofertas), ['notificada', 'notificada', 'notificada'])
  assert.deepEqual(r.entregas, [3, ['sent'], true, true], 'Admin reads each notice with its status and a masked number')
  assert.equal(r.gabriela.length, 1)
  assert.match(r.gabriela[0], /^¡Listo! La solicitud urgente de Plomería es tuya\. Cliente: Cliente J\.\. Dirección: Av\. 3 de Abril 1850 \(Barrio Sur\)\./u)
  assert.deepEqual(r.tomada, [true, 'aceptada', 1, true], 'Gabriela wins atomically and ONE work is born')
  assert.equal(r.alCliente.length, 1)
  assert.match(r.alCliente[0], /^Gabriela Lopez \S+ aceptó tu solicitud urgente de Plomería/u)
  for (const otros of r.aLosOtros) assert.deepEqual(otros, ['La solicitud urgente de Plomería en Av. 3 de Abril 1850, Barrio Sur ya fue tomada por otro prestador. Gracias por responder.'], 'the others stop seeing it as available')
  assert.deepEqual(r.flor, ['Esta solicitud ya fue tomada por otro prestador.'])
  assert.equal(r.florSinTrabajo, 0, 'Flor is never associated to the work')
  assert.deepEqual(r.webhookRepetido, [0, 1, 1], 'a webhook delivered twice answers once and creates nothing again')
  assert.deepEqual(r.noPrestador, ['Para responder servicios urgentes este número tiene que estar vinculado a tu cuenta de prestador en TUS.'])
  assert.deepEqual(r.renuncia, ['Listo, registré que finalmente no podés asistir. Le avisamos al cliente y se la ofrecemos a otros prestadores.'], 'no exact phrase is needed')
  assert.deepEqual(r.reabierta, ['cancelada', 1, 'cancelled'])
  assert.deepEqual(r.ofertaGabi, ['renuncio', true, true, 'whatsapp', 'Al final no puedo ir, se me rompió la camioneta'])
  assert.equal(r.clienteRenuncia.length, 1)
  assert.match(r.clienteRenuncia[0], /^Gabriela Lopez \S+ finalmente no puede asistir\. Estamos buscando otro prestador disponible\.$/u)
  assert.deepEqual(r.reofrecida, { flor: ['buttons'], juan: ['buttons'], gabi: 0 }, 'offered again to the others, never to who gave it back')
  assert.match(r.florGana[0], /^¡Listo! La solicitud urgente de Plomería es tuya\./u)
  assert.deepEqual(r.final.slice(0, 3), [1, true, 'requested'], 'still one work, now of Flor')
  assert.deepEqual(Object.values(r.final[3]).sort(), ['acepto', 'cerrada_por_otro', 'renuncio'])
  assert.match(r.clienteFinal[0], /^Flor Perez \S+ aceptó tu solicitud urgente de Plomería/u)
  assert.deepEqual(r.gabiVuelve, ['Ya nos avisaste que no podías asistir a esta solicitud; se la ofrecimos a otros prestadores.'])
  assert.deepEqual(r.transiciones, ['work.created_from_request', 'work.released_by_provider', 'work.reassigned_from_request'])
})

test('URGENTE WhatsApp PostgreSQL: only what is missing is asked (service, address and zone, what happened); "No puedo" from every provider closes it and tells the client; outside the 24 hour window only the approved template is sent, with its five parameters in order and its two buttons', { skip }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      ${URGENTES}
      const gabi = await prestadorWa('g', 'Gabriela Lopez ' + run)
      const flor = await prestadorWa('f', 'Flor Perez ' + run)
      const ana = await clienteWa('ana')
      const repos0 = waStore.repositorios()
      // Urgency and service, no address: the conversation stays urgent and asks ONLY the address.
      const consultasAntes = await prisma.reserva.count()
      out.paso1 = await decir(ana.wa, 'Necesito un plomero urgente ahora')
      out.sinCrear = (await urgenteDe(ana.cuenta.id)) === null
      const borrador = (await repos0.conversaciones.activaDeContacto((await repos0.contactos.buscarPorWaId(ana.wa)).contactId)).state.urgent
      out.contexto = [borrador.profession === oficio.id, borrador.address, borrador.zone]
      let marca = fakeWa.sent.length
      out.paso2 = await decir(ana.wa, 'San Martín 1234, barrio Centro')
      const solicitud = await urgenteDe(ana.cuenta.id)
      out.creada = [solicitud.categoria === oficio.id, solicitud.urgencia, solicitud.difusionUrgente, solicitud.direccion, solicitud.zona, solicitud.descripcion, enviadosA(gabi.wa, marca).length, enviadosA(flor.wa, marca).length]
      out.sinTurnos = (await prisma.reserva.count()) === consultasAntes
      // Both say no.
      out.no1 = await decir(gabi.wa, '', tocar('nopuedo', solicitud.id))
      marca = fakeWa.sent.length
      out.no2 = await decir(flor.wa, '', tocar('nopuedo', solicitud.id))
      const cerrada = await prisma.solicitudServicio.findUnique({ where: { id: solicitud.id } })
      out.cerrada = [cerrada.estado, cerrada.cierreUrgente, textos(ana.wa, marca), (await trabajosDe(solicitud.id)).length]
      out.tarde = await decir(gabi.wa, '', tocar('asistir', solicitud.id))

      // Somebody who is not identified: nothing is sent until it is.
      contactos += 1
      const anonimo = '5491155911' + String(Date.now()).slice(-4) + contactos
      await decir(anonimo, 'hola')
      marca = fakeWa.sent.length
      out.anonimo = await decir(anonimo, 'Necesito un plomero urgente en San Martín 450, Centro. Pierde agua el termotanque.')
      out.anonimoSinSolicitud = await prisma.solicitudServicio.count({ where: { direccion: 'San Martín 450' } })
      out.nadieAvisado = enviadosA(gabi.wa, marca).length + enviadosA(flor.wa, marca).length
      // "listo" without having linked: still nobody to send it for.
      out.listoSinVincular = await decir(anonimo, 'listo')
      // The WhatsApp gets linked to an account (as Mi perfil does): the request is recovered whole.
      const nueva = await cliente('recien')
      await prisma.account.update({ where: { id: nueva.id }, data: { emailVerifiedAt: new Date() } })
      cuentas.set(nueva.id, nueva)
      const contactoAnonimo = await repos0.contactos.buscarPorWaId(anonimo)
      await waTx.ejecutar((x) => x.contactos.actualizar({ ...contactoAnonimo, linkedAccountId: nueva.id, linkedTenantId: nueva.tenantId, linkedAt: new Date().toISOString(), version: contactoAnonimo.version + 1 }, contactoAnonimo.version))
      // Any other message does not send an address to providers: it asks first.
      out.trasVincular = await decir(anonimo, 'hola, ya estoy')
      out.todaviaNo = await prisma.solicitudServicio.count({ where: { direccion: 'San Martín 450' } })
      marca = fakeWa.sent.length
      out.confirmado = await decir(anonimo, 'sí')
      const recuperada = await prisma.solicitudServicio.findFirst({ where: { direccion: 'San Martín 450' } })
      out.recuperada = [recuperada.cuentaId === nueva.id, recuperada.categoria === oficio.id, recuperada.zona, recuperada.descripcion, enviadosA(gabi.wa, marca).length + enviadosA(flor.wa, marca).length]
      // A request that is waiting is dropped when the person asks for something else in so many words.
      contactos += 1
      const otro = await clienteWa('otro' + contactos)
      await decir(otro.wa, 'Necesito un plomero urgente')
      await decir(otro.wa, 'mejor quiero reservar un turno para mañana')
      out.cambioDeIntencion = [(await repos0.conversaciones.activaDeContacto((await repos0.contactos.buscarPorWaId(otro.wa)).contactId)).state.urgent ?? null, (await urgenteDe(otro.cuenta.id)) === null]

      // Outside the 24 hour window: the template, or nothing.
      const plantillaMeta = (aprobadas) => new NotificadorUrgentesWhatsapp(waTx, fakeWa, () => reloj, undefined, new WhatsappTemplateService(new Set(aprobadas)))
      const repos = waStore.repositorios()
      const convGabi = await repos.conversaciones.activaDeContacto((await repos.contactos.buscarPorWaId(gabi.wa)).contactId)
      await waTx.ejecutar((x) => x.conversaciones.actualizar({ ...convGabi, lastInboundAt: new Date(reloj - 30 * 3600000).toISOString(), version: convGabi.version + 1 }, convGabi.version))
      const oferta = { solicitudId: 'solicitud-de-prueba-1', ronda: 1, cuentaId: gabi.cuenta.id, cliente: 'Joaquín F.', servicio: 'Electricista', direccion: 'Av. 3 de Abril 1850', zona: 'Barrio Sur', motivo: 'Se cortó toda la luz y está saltando la térmica' }
      marca = fakeWa.sent.length
      out.sinPlantilla = [await plantillaMeta([]).ofrecer(oferta), fakeWa.sent.length - marca]
      const conPlantilla = await plantillaMeta([PLANTILLA_SERVICIO_URGENTE]).ofrecer({ ...oferta, solicitudId: 'solicitud-de-prueba-2' })
      const enviado = enviadosA(gabi.wa, marca)[0]
      const meta = cuerpoMensajeMeta(gabi.wa, enviado).template
      out.plantilla = { resultado: conPlantilla, tipo: enviado.type, nombre: meta.name, idioma: meta.language.code, parametros: meta.components.find((c) => c.type === 'body').parameters.map((p) => p.text), botones: meta.components.filter((c) => c.type === 'button').map((c) => [c.sub_type, c.index, c.parameters[0].payload]) }
      const definida = (await import('./apps/api/src/tus/asistente/plantillas.ts')).PLANTILLAS_WHATSAPP.find((p) => p.name === PLANTILLA_SERVICIO_URGENTE)
      out.definicion = [definida.category, definida.language, definida.parameters, definida.buttons, definida.body]
      // No WhatsApp linked at all.
      const sinWa = await cliente('sinwa')
      out.sinWhatsapp = await modulo.avisosUrgentes.ofrecer({ ...oferta, cuentaId: sinWa.id, solicitudId: 'solicitud-de-prueba-3' })
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.paso1, ['Claro. ¿En qué dirección necesitás el servicio? Indicame calle, altura y barrio si lo sabés.'], '"plomero urgente ahora": the urgent context is kept and only the address is asked, never turnos')
  assert.equal(r.sinCrear, true, 'nothing is created while the address is missing')
  assert.deepEqual(r.contexto, [true, null, null], 'the service stays plumbing and the request stays urgent')
  assert.match(r.paso2[0], /^Listo\. Envié tu pedido urgente de Plomería a 2 prestadores\./u)
  assert.deepEqual(r.creada, [true, 'urgente', true, 'San Martín 1234', 'Centro', 'Pedido urgente de Plomería', 1, 1], 'with the address and the zone it is created and offered; what happened is optional')
  assert.equal(r.sinTurnos, true)
  assert.deepEqual(r.no1, ['Listo, registré que no podés asistir. Gracias por responder.'])
  assert.deepEqual(r.no2, ['Listo, registré que no podés asistir. Gracias por responder.'])
  assert.deepEqual(r.cerrada, ['cerrada', 'todos_rechazaron', ['Ningún prestador pudo tomar tu solicitud urgente de Plomería. Podés pedirme los prestadores de Plomería y elegir uno.'], 0], 'everybody said no: closed, the client told, no work')
  assert.deepEqual(r.tarde, ['Esta solicitud urgente ya no está disponible.'])
  assert.match(r.anonimo[0], /^Tengo todo para tu pedido urgente de Plomería\. Para enviarlo necesito saber quién sos/u)
  assert.equal(r.anonimoSinSolicitud, 0, 'an address is never sent to providers for somebody TUS cannot identify')
  assert.equal(r.nadieAvisado, 0)
  assert.match(r.listoSinVincular[0], /^Tengo todo para tu pedido urgente de Plomería\. Para enviarlo necesito saber quién sos/u)
  assert.deepEqual(r.trasVincular, ['Ya te identifiqué. Tengo tu pedido urgente de Plomería en San Martín 450, Centro. ¿Lo envío a los prestadores?'], 'after linking, the request is recovered: service, address and reason are not asked again')
  assert.equal(r.todaviaNo, 0, 'and it only leaves when the person says so')
  assert.match(r.confirmado[0], /^Listo\. Envié tu pedido urgente de Plomería a 2 prestadores\./u)
  assert.deepEqual(r.recuperada, [true, true, 'Centro', 'Pierde agua el termotanque', 2])
  assert.deepEqual(r.cambioDeIntencion, [null, true], 'asking for a turno in so many words leaves the urgent request')
  assert.deepEqual(r.sinPlantilla, [{ enviada: false, motivo: 'requiere_plantilla' }, 0], 'outside the window and without the approved template nothing is written (never free text)')
  assert.deepEqual(r.plantilla, {
    resultado: { enviada: true },
    tipo: 'template',
    nombre: 'servicio_urgente_disponible',
    idioma: 'es_AR',
    parametros: ['Joaquín F.', 'Electricista', 'Av. 3 de Abril 1850', 'Barrio Sur', 'Se cortó toda la luz y está saltando la térmica'],
    botones: [['quick_reply', '0', 'urgente:asistir:solicitud-de-prueba-2'], ['quick_reply', '1', 'urgente:nopuedo:solicitud-de-prueba-2']],
  }, 'the template travels with 1 client, 2 service, 3 address, 4 zone, 5 reason, and its two quick replies')
  assert.deepEqual(r.definicion, ['UTILITY', 'es_AR', ['cliente', 'servicio', 'direccion', 'zona', 'motivo'], ['Puedo asistir', 'No puedo'], 'Hola, {{1}} necesita un servicio urgente de {{2}}.\nDirección: {{3}}\nBarrio/Zona: {{4}}\nMotivo: {{5}}\n¿Podés asistir ahora?'])
  assert.deepEqual(r.sinWhatsapp, { enviada: false, motivo: 'sin_whatsapp' })
})
