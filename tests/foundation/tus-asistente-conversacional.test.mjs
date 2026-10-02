import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-CONV-01. The assistant is a conversation, not a form: a message that already says
// what is needed goes straight to a REAL availability search; only what is missing is asked, and
// the zone is never required. Same orchestrator for the Web and WhatsApp, with and without the
// model. Recording domain port (what the backend was really asked), in-memory stores, no Groq.
//
// Clock of the fixture: Friday 2026-09-25, 09:00 in Argentina. "mañana" is Saturday 26.

const SETUP = (conModelo) => `${SERVICE_SETUP}${WHATSAPP_SETUP}
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { crearRouterAsistenteWeb } = await import('./apps/api/src/tus/asistente/http-web.ts')
  const { PROMPT_ENRUTADOR } = await import('./apps/api/src/tus/asistente/herramientas.ts')
  const { MENSAJES } = await import('./apps/api/src/tus/asistente/modelo.ts')
  const { catalogoVigente, establecerCatalogo } = await import('./apps/api/src/tus/catalogo/vigente.ts')
  const catalogo = catalogoVigente()
  establecerCatalogo({ ...catalogo, oficios: [...catalogo.oficios, { id: 'masaje', categoriaId: null, nombre: 'Masaje', profesion: 'Masajista', slug: 'masaje', descripcion: null, icono: 'herramienta', activo: true, orden: 20, sinonimos: ['masaje', 'masajes', 'masajista', 'contractura'] }] })

  // The agenda the fake domain answers from: local times each provider has free every day.
  const ANA = { id: 'perfil-ana', name: 'Ana Gómez', area: 'Centro', verified: true, jobs: 12, turnos: true, horas: ['10:00', '17:00', '17:30', '18:00', '19:00'], tarifas: [] }
  const BETO = { id: 'perfil-beto', name: 'Beto Ruiz', area: 'San Benito', verified: false, jobs: 3, turnos: true, horas: ['10:00', '18:00'], tarifas: [] }
  let AGENDA = [ANA, BETO]
  let fallaDominio = false
  const dom = { consultas: [], reservas: [], buscar: [] }
  const iso = (dia, hora) => new Date(dia + 'T' + hora + ':00.000-03:00').toISOString()
  const cabe = (hora, t) => !t || (t.kind === 'exact' ? hora === t.from : t.kind === 'from' ? hora >= t.from : t.kind === 'until' ? hora < t.to : hora >= t.from && hora < t.to)
  const dominio = {
    esPrestador: async () => false,
    buscarServicios: async () => [],
    servicio: async () => null,
    solicitudes: async () => [],
    trabajos: async () => [],
    buscarPrestadores: async (filter) => { dom.buscar.push(filter); return { profession: filter.profession, providers: [] } },
    buscarDisponibilidad: async (consulta) => {
      dom.consultas.push(consulta)
      if (fallaDominio) throw new Error('database down')
      const dias = [consulta.day, ...(consulta.dayTo ? [consulta.dayTo] : [])]
      const providers = AGENDA.filter((p) => !consulta.zone || p.area === consulta.zone).map((p) => {
        const libres = p.turnos ? dias.flatMap((d) => p.horas.map((h) => [h, iso(d, h)])) : []
        const matches = libres.filter(([h]) => cabe(h, consulta.time)).map(([, i]) => i)
        return { providerId: p.id, name: p.name, profession: 'Masajista', area: p.area, verified: p.verified, completedJobs: p.jobs, takesAppointments: p.turnos, durationMinutes: p.turnos ? 60 : null, tariffs: p.tarifas, matches, nearby: matches.length === 0 && consulta.time ? libres.slice(0, 3).map(([, i]) => i) : [] }
      })
      const outcome = providers.length === 0 ? 'no_providers' : providers.some((p) => p.matches.length) ? 'matches' : providers.some((p) => p.nearby.length) ? 'nearby' : providers.some((p) => p.takesAppointments) ? 'no_availability' : 'no_appointments'
      return { profession: consulta.profession, outcome, zoneRelaxed: false, providers }
    },
    reservarTurno: async (context, input) => { dom.reservas.push({ subjectId: context?.subjectId ?? null, providerId: input.providerId, oficioId: input.oficioId, inicio: input.inicio }); return { id: 'res-1', prestadorNombre: 'x', inicio: input.inicio, fin: input.inicio, precioFinal: 15000 } },
  }
  const modulo = crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: accountResolver, domain: dominio, knowledgeIndex, whatsapp: fakeWa, chat: ${conModelo ? 'chat' : 'null'}, embeddings, transcriptor: null, now: waClock, metric: (name, fields) => metrics.push({ name, ...fields }) })
  const sesiones = { resolve: async (token, correlationId) => token === 'tok-cliente' ? { subjectId: 'customer-user', sessionId: 'sesion-1', tenantId: 'customer-tenant', roles: ['owner'], permissions: ['tus:read'], correlationId } : null }
  const app = express()
  app.use(express.json())
  app.use(crearRouterAsistenteWeb({ servicio: modulo.asistenteWeb, sessions: sesiones, limitePorIp: (_request, _response, next) => next() }))
  const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = 'http://127.0.0.1:' + servidor.address().port
  let visitantes = 0
  const nuevoVisitante = () => 'visitante-conv-' + String(visitantes += 1).padStart(10, '0')
  async function enviar(body, { token, visitante } = {}) {
    const response = await fetch(base + '/tus/v1/asistente/mensajes', { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-conv', accept: 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ ...body, ...(visitante ? { visitorId: visitante } : {}) }) })
    const json = await response.json()
    // Each test conversation sends few messages; the per-conversation rate window moves on.
    waAdvance(6000)
    return { status: response.status, degraded: json.degraded, mensajes: (json.messages ?? []).map((m) => ({ text: m.text, kind: m.attachment?.kind ?? null, attachment: m.attachment ?? null, actions: m.actions ?? null, fallback: m.fallback ?? false })), actividad: (json.activity ?? []).map((a) => [a.type, a.tool ?? a.intent ?? '', a.phase ?? ''].filter(Boolean).join(':')) }
  }
  const decir = async (text, opciones) => (await enviar({ text }, opciones)).mensajes[0]
  const esRuteo = (input) => input.messages[0].content === PROMPT_ENRUTADOR
  const sistema = (call) => call.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\\n')
  // WhatsApp through the real path: webhook payload -> intake -> queue -> worker -> orchestrator.
  const cola = modulo.crearWorker({ owner: 'conv' })
  async function whatsapp(waId, text) {
    await modulo.ingreso.procesar(parsearWebhookMeta(inbound(waId, text), PHONE_ID), 'corr-wa-conv')
    for (let i = 0; i < 5; i += 1) if ((await cola.procesarSiguiente()).outcome === 'idle') break
    waAdvance(6000)
    return lastSent().message
  }
  const cerrar = () => new Promise((resolve) => servidor.close(resolve))
  const PRINCIPAL = 'quiero una masajista para mañana a las 18 no me importa la zona voy yo'
`

test('ASISTENTE conversacional (Web, sin modelo): the acceptance message goes from text to a REAL availability search with no question and no button; "el segundo" books for the session account', () => {
  const r = runTypeScriptScenario(`${SETUP(false)}
    const out = {}
    try {
      const v = nuevoVisitante()
      const respuesta = await enviar({ text: PRINCIPAL }, { visitante: v })
      out.principal = [respuesta.status, respuesta.degraded, respuesta.mensajes.length, respuesta.mensajes[0].text, respuesta.mensajes[0].kind, respuesta.mensajes[0].fallback]
      out.actividad = respuesta.actividad
      out.consulta = [...dom.consultas]
      out.tarjetas = respuesta.mensajes[0].attachment.providers.map((p) => [p.name, p.area, p.exact, p.starts.map((s) => s === iso('2026-09-26', '18:00'))])
      // A visitor chooses: nothing is booked without an account; the way in is offered.
      const anonimo = await decir('el segundo', { visitante: v })
      out.anonimo = [anonimo.kind, anonimo.actions, dom.reservas.length]
      // Signed in: the same message, then "el segundo" in free text (no button needed).
      const sesion = { token: 'tok-cliente' }
      await decir(PRINCIPAL, sesion)
      const tarjeta = await decir('el segundo', sesion)
      out.tarjeta = [tarjeta.text, tarjeta.actions.map((a) => a.label), dom.reservas.length]
      const listo = await enviar({ replyId: tarjeta.actions[0].id }, sesion)
      out.listo = listo.mensajes[0].text
      out.reserva = [dom.reservas.length, dom.reservas[0], dom.reservas[0].inicio === iso('2026-09-26', '18:00')]
      out.busquedasViejas = dom.buscar.length
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.principal, [200, false, 1, 'Encontré 2 profesionales de Masaje con turno mañana a las 18:00:\n1. Ana Gómez — Centro: 18:00\n2. Beto Ruiz — San Benito: 18:00\n¿Con cuál querés solicitar el turno?', 'appointments', false], 'one reply, with real results, not a fallback')
  assert.deepEqual(r.actividad, ['routing:buscar', 'tool:find_appointments:start', 'tool:find_appointments:end'], 'message -> search, nothing in between')
  assert.deepEqual(r.consulta, [{ profession: 'masaje', day: '2026-09-26', dayTo: null, time: { kind: 'exact', from: '18:00', to: null }, zone: null }], 'trade, day and exact time from the message; no zone because it does not matter')
  assert.deepEqual(r.tarjetas, [['Ana Gómez', 'Centro', true, [true]], ['Beto Ruiz', 'San Benito', true, [true]]])
  assert.deepEqual(r.anonimo, ['sign_in', null, 0])
  assert.equal(r.tarjeta[0], 'Voy a enviar tu solicitud de turno:\nPrestador: Beto Ruiz\nHorario: sábado, 26 de septiembre, 18:00 hs\nEl turno queda pendiente hasta que el prestador confirme.\n¿Querés solicitar ese turno?')
  assert.deepEqual(r.tarjeta.slice(1), [['Solicitar turno', 'Cancelar'], 0], 'nothing is booked before the explicit confirmation')
  assert.equal(r.listo, 'Listo, envié tu solicitud de turno para el sábado, 26 de septiembre a las 18:00 hs. Queda pendiente hasta que el prestador la confirme; podés ver el estado en "Mis turnos".')
  assert.doesNotMatch(r.listo, /confirmad[oa]|reservad[oa]/iu, 'a request is never announced as a confirmed reservation')
  assert.deepEqual(r.reserva, [1, { subjectId: 'customer-user', providerId: 'perfil-beto', oficioId: 'masaje', inicio: '2026-09-26T21:00:00.000Z' }, true])
  assert.equal(r.busquedasViejas, 0)
})

test('ASISTENTE conversacional: facts accumulate between messages; only what is missing is asked, once; the zone is never asked', () => {
  const r = runTypeScriptScenario(`${SETUP(false)}
    const out = {}
    try {
      // "quiero un electricista" -> "mañana a las 18" -> "no me importa la zona"
      const v = nuevoVisitante()
      const pasos = []
      for (const texto of ['quiero un electricista', 'mañana a las 18', 'no me importa la zona']) { const m = await decir(texto, { visitante: v }); pasos.push([m.text.split('\\n')[0], m.kind, dom.consultas.length]) }
      out.pasos = pasos
      out.consultas = [...dom.consultas]
      // "Quiero una masajista." -> "¿Para cuándo?" -> "Mañana a las 18, no me importa la zona."
      const w = nuevoVisitante()
      out.masaje = [(await decir('Quiero una masajista.', { visitante: w })).text, (await decir('Mañana a las 18, no me importa la zona.', { visitante: w })).text.split('\\n')[0], dom.consultas.at(-1)]
      // The day first, the trade after.
      const z = nuevoVisitante()
      out.alReves = [(await decir('mañana a las 18', { visitante: z })).text, (await decir('una masajista', { visitante: z })).text.split('\\n')[0], dom.consultas.at(-1)]
      // No reply ever asks for the zone, the neighbourhood or the trade again.
      out.textos = [...pasos.map((p) => p[0]), ...out.masaje.slice(0, 2), ...out.alReves.slice(0, 2)]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  const consulta = (profession) => ({ profession, day: '2026-09-26', dayTo: null, time: { kind: 'exact', from: '18:00', to: null }, zone: null })
  assert.deepEqual(r.pasos, [
    ['¿Para cuándo necesitás Electricidad?', null, 0],
    ['Encontré 2 profesionales de Electricidad con turno mañana a las 18:00:', 'appointments', 1],
    ['Encontré 2 profesionales de Electricidad con turno mañana a las 18:00:', 'appointments', 2],
  ])
  assert.deepEqual(r.consultas, [consulta('electricidad'), consulta('electricidad')], 'the search did not wait for a zone, and "no me importa la zona" kept everything else')
  assert.deepEqual(r.masaje, ['¿Para cuándo necesitás Masaje?', 'Encontré 2 profesionales de Masaje con turno mañana a las 18:00:', consulta('masaje')])
  assert.deepEqual(r.alReves, ['¿Qué servicio necesitás?', 'Encontré 2 profesionales de Masaje con turno mañana a las 18:00:', consulta('masaje')])
  for (const texto of r.textos) assert.doesNotMatch(texto, /barrio|zona|d[oó]nde/iu, `the zone was asked: ${texto}`)
})

test('ASISTENTE conversacional: each natural phrase reaches the backend as the exact query it means (zone, urgency, lower bound, part of the day, typos)', () => {
  const r = runTypeScriptScenario(`${SETUP(false)}
    const out = {}
    try {
      const casos = {
        centro: 'necesito un electricista mañana a las 10 en Centro',
        urgente: 'busco un plomero urgente ahora',
        despues: 'quiero alguien que arregle el aire mañana después de las 17',
        sabadoTarde: 'necesito una masajista el sábado a la tarde, cualquier barrio',
        finde: 'necesito una masajista este fin de semana a la mañana',
        errata: 'kiero una masagista pa mañana tipo 6 de la tarde, cualkier barrio',
        meDaIgual: 'Necesito un electricista mañana a las 10, me da igual dónde, puedo ir yo.',
      }
      for (const [nombre, texto] of Object.entries(casos)) { const m = await decir(texto, { visitante: nuevoVisitante() }); out[nombre] = [dom.consultas.at(-1), m.text] }
      out.total = dom.consultas.length
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.centro[0], { profession: 'electricidad', day: '2026-09-26', dayTo: null, time: { kind: 'exact', from: '10:00', to: null }, zone: 'Centro' })
  assert.equal(r.centro[1], 'Encontré 1 profesional de Electricidad con turno mañana a las 10:00:\n1. Ana Gómez — Centro: 10:00\n¿Con cuál querés solicitar el turno?')
  assert.deepEqual(r.urgente[0], { profession: 'plomeria', day: '2026-09-25', dayTo: null, time: { kind: 'from', from: '09:00', to: null }, zone: null }, '"ahora": today, from the current time of the server')
  assert.deepEqual(r.despues[0], { profession: 'aire', day: '2026-09-26', dayTo: null, time: { kind: 'from', from: '17:00', to: null }, zone: null })
  assert.equal(r.despues[1], 'Encontré 2 profesionales de Aire acondicionado con turno mañana desde las 17:00:\n1. Ana Gómez — Centro: 17:00, 17:30, 18:00, 19:00\n2. Beto Ruiz — San Benito: 18:00\nDecime con quién y a qué hora y te preparo la solicitud.')
  assert.deepEqual(r.sabadoTarde[0], { profession: 'masaje', day: '2026-09-26', dayTo: null, time: { kind: 'between', from: '13:00', to: '20:00' }, zone: null })
  assert.deepEqual(r.finde[0], { profession: 'masaje', day: '2026-09-26', dayTo: '2026-09-27', time: { kind: 'between', from: '06:00', to: '12:00' }, zone: null })
  assert.match(r.finde[1], /1\. Ana Gómez — Centro: sáb 10:00, dom 10:00/u, 'two days: every time says its day')
  assert.deepEqual(r.errata[0], { profession: 'masaje', day: '2026-09-26', dayTo: null, time: { kind: 'exact', from: '18:00', to: null }, zone: null })
  assert.deepEqual(r.meDaIgual[0], { profession: 'electricidad', day: '2026-09-26', dayTo: null, time: { kind: 'exact', from: '10:00', to: null }, zone: null })
  assert.equal(r.total, 7, 'one search per message, none repeated')
})

test('ASISTENTE conversacional: the reply says what really happened (no exact time, no free turnos, no turnos online, nobody, several durations, search failed) and free text chooses provider and time', () => {
  const r = runTypeScriptScenario(`${SETUP(false)}
    const out = {}
    try {
      const pedir = async (texto) => { const m = await decir(texto, { visitante: nuevoVisitante() }); return [m.text, m.kind] }
      out.cercanos = await pedir('quiero una masajista mañana a las 16')
      AGENDA = [{ ...ANA, horas: [] }]
      out.sinTurnos = await pedir('quiero una masajista mañana a las 16')
      AGENDA = [{ ...ANA, turnos: false }, { ...BETO, turnos: false }]
      out.porSolicitud = await pedir('quiero una masajista mañana a las 16')
      AGENDA = []
      out.nadie = await pedir('quiero una masajista mañana a las 16')
      out.nadieEnZona = await pedir('quiero una masajista mañana a las 16 en Centro')
      AGENDA = [{ ...ANA, tarifas: [{ id: 't30', name: '30', durationMinutes: 30, price: 1 }, { id: 't60', name: '60', durationMinutes: 60, price: 2 }, { id: 't90', name: '90', durationMinutes: 90, price: 3 }] }]
      out.duraciones = (await pedir('quiero una masajista mañana a las 18'))[0]
      AGENDA = [ANA, BETO]
      fallaDominio = true
      out.falla = await pedir('quiero una masajista mañana a las 18')
      fallaDominio = false
      // Several times for the same provider: only the time is asked; a time alone answers it.
      const sesion = { token: 'tok-cliente' }
      out.variasHoras = (await decir('quiero una masajista mañana a la tarde', sesion)).text
      out.conAna = (await decir('con Ana', sesion)).text
      out.horaQueNoTiene = (await decir('a las 16', sesion)).text
      const tarjeta = await decir('a las 17:30', sesion)
      out.tarjeta = [tarjeta.text.split('\\n').slice(1, 3), tarjeta.actions?.map((a) => a.label) ?? null]
      out.sinReservaAun = dom.reservas.length
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.cercanos, ['No encontré turnos de Masaje mañana a las 16:00. Lo más cercano mañana:\n1. Ana Gómez — Centro: 10:00, 17:00, 17:30\n2. Beto Ruiz — San Benito: 10:00, 18:00\n¿Te sirve alguno?', 'appointments'], 'no exact time: the closest real times, not "no encontré"')
  assert.deepEqual(r.sinTurnos, ['Hay 1 profesional de Masaje, pero sin turnos libres mañana. ¿Querés que busque otro día?', null])
  assert.deepEqual(r.porSolicitud, ['Encontré 2 profesionales de Masaje. No toman turnos online: se coordina enviándoles una solicitud.\n1. Ana Gómez — Centro\n2. Beto Ruiz — San Benito\n¿A cuál querés enviársela?', 'providers'])
  assert.deepEqual(r.nadie, ['Todavía no hay profesionales de Masaje publicados en TUS.', null])
  assert.deepEqual(r.nadieEnZona, ['Todavía no hay profesionales de Masaje publicados en TUS que atiendan en Centro.', null])
  assert.match(r.duraciones, /\nLos horarios son para turnos de 60 min; Ana Gómez también ofrece 30 y 90 min\.\n/u, 'the durations come from the tarifas of the service')
  assert.deepEqual(r.falla, ['No pude consultar la disponibilidad en este momento. Probá de nuevo en unos minutos.', null], 'a failed search is said, never replaced by a guess')
  assert.match(r.variasHoras, /1\. Ana Gómez — Centro: 17:00, 17:30, 18:00, 19:00\n2\. Beto Ruiz — San Benito: 18:00\nDecime con quién y a qué hora/u)
  assert.equal(r.conAna, '¿A qué hora con Ana Gómez? Tiene: 17:00, 17:30, 18:00, 19:00.')
  assert.equal(r.horaQueNoTiene, 'Ana Gómez no tiene turno a esa hora. Tiene: 17:00, 17:30, 18:00, 19:00. ¿Cuál preferís?')
  assert.deepEqual(r.tarjeta, [['Prestador: Ana Gómez', 'Horario: sábado, 26 de septiembre, 17:30 hs'], ['Solicitar turno', 'Cancelar']])
  assert.equal(r.sinReservaAun, 0)
})

test('ASISTENTE conversacional (Web, con modelo): the backend searches from the message, the model only writes; what is known is in its context and it is asked for nothing twice; its own understanding (find_appointments) is resolved with the server calendar', () => {
  const r = runTypeScriptScenario(`${SETUP(true)}
    const out = {}
    try {
      // 1. Complete message: no routing call, no tool round. One call to phrase the real result.
      script = (input) => { if (esRuteo(input)) throw new Error('routing must not be called'); return { content: 'Mañana a las 18 tenés lugar con Ana Gómez y con Beto Ruiz. ¿Con cuál seguimos?' } }
      const completa = await enviar({ text: PRINCIPAL }, { visitante: nuevoVisitante() })
      const llamada1 = chat.calls.at(-1)
      out.completa = [completa.mensajes[0].text, completa.mensajes[0].kind, completa.degraded, chat.calls.length, llamada1.tools, /El backend YA buscó la disponibilidad real/u.test(sistema(llamada1)), /"horariosQueCoinciden":\\["18:00"\\]/u.test(sistema(llamada1)), dom.consultas.length]
      // 2. The model is down: the same real result is still answered, as plain text.
      script = () => { throw new Error('model down') }
      const caida = await enviar({ text: PRINCIPAL }, { visitante: nuevoVisitante() })
      out.caida = [caida.mensajes[0].text.split('\\n')[0], caida.mensajes[0].kind, caida.degraded, dom.consultas.length]
      // 3. Only the trade: the model asks the one missing thing, knowing what is known.
      chat.calls.length = 0
      const v = nuevoVisitante()
      script = (input) => { if (esRuteo(input)) throw new Error('routing must not be called'); return { content: '¿Para cuándo la necesitás?' } }
      const pregunta = await decir('quiero una masajista', { visitante: v })
      const llamada3 = chat.calls.at(-1)
      out.pregunta = [pregunta.text, /Necesidad conocida[^\\n]*"oficio":"masaje"/u.test(sistema(llamada3)), /falta SOLO: para qué día\\. La zona no hace falta/u.test(sistema(llamada3)), llamada3.tools.includes('find_appointments'), dom.consultas.length]
      script = () => ({ content: 'Listo: mañana a las 18 hay dos opciones.' })
      const sigue = await decir('mañana a las 18, me da igual la zona', { visitante: v })
      out.sigue = [sigue.text, sigue.kind, dom.consultas.at(-1)]
      // 4. Language the fixed rules do not cover: the model understands it and asks the backend,
      //    which resolves "este finde" with its own calendar.
      const w = nuevoVisitante()
      script = (input) => esRuteo(input) ? { content: JSON.stringify({ intent: 'buscar' }) } : input.tools.includes('find_appointments') && !input.messages.some((m) => m.role === 'tool')
        ? { toolCalls: [llamada('find_appointments', { profession: 'aire', when: 'este finde', zone: null, anyZone: true })] }
        : { content: 'El sábado y el domingo hay turnos con Ana y con Beto.' }
      const finde = await decir('el equipo del living tira aire caliente, ¿alguien puede verlo el finde? voy a donde sea', { visitante: w })
      out.finde = [finde.text, finde.kind, dom.consultas.at(-1)]
      //    The model understood and the backend searched, but the model then fails (rate limit):
      //    the real result is answered anyway, rendered by the backend.
      script = (input) => { if (esRuteo(input)) return { content: JSON.stringify({ intent: 'buscar' }) }; if (input.messages.some((m) => m.role === 'tool')) throw new Error('rate limit'); return { toolCalls: [llamada('find_appointments', { profession: 'aire', when: 'este finde', zone: null, anyZone: true })] } }
      const cortado = await enviar({ text: 'el equipo del living tira aire caliente, ¿alguien puede verlo el finde? voy a donde sea' }, { visitante: nuevoVisitante() })
      out.cortado = [cortado.mensajes[0].text.split('\\n')[0], cortado.mensajes[0].kind, cortado.degraded]
      // 5. The model understands nothing useful yet: the tool tells it what is missing.
      const u = nuevoVisitante()
      script = (input) => esRuteo(input) ? { content: JSON.stringify({ intent: 'buscar' }) } : !input.messages.some((m) => m.role === 'tool')
        ? { toolCalls: [llamada('find_appointments', { profession: null, when: null, zone: null, anyZone: null })] }
        : { content: '¿Qué servicio necesitás?' }
      const antes = dom.consultas.length
      const vacio = await decir('me podrás dar una mano con algo de casa', { visitante: u })
      const herramienta = chat.calls.at(-1).messages.find((m) => m.role === 'tool')
      out.vacio = [vacio.text, JSON.parse(herramienta.content).missing, dom.consultas.length - antes]
      // 6. A model that answers a search from its own head is not passed on.
      script = (input) => esRuteo(input) ? { content: JSON.stringify({ intent: 'buscar' }) } : { content: 'Te recomiendo a Carlos Inventado, está libre mañana a las 15 y cobra $5000.' }
      const inventado = await decir('quiero un electricista', { visitante: nuevoVisitante() })
      out.inventado = [/Carlos Inventado/u.test(inventado.text), inventado.kind]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.completa, ['Mañana a las 18 tenés lugar con Ana Gómez y con Beto Ruiz. ¿Con cuál seguimos?', 'appointments', false, 1, [], true, true, 1], 'the text is the model\'s; the search and the cards are the backend\'s')
  assert.deepEqual(r.caida, ['Encontré 2 profesionales de Masaje con turno mañana a las 18:00:', 'appointments', false, 2], 'without the model the person still gets the real result')
  assert.deepEqual(r.pregunta, ['¿Para cuándo la necesitás?', true, true, true, 2])
  assert.deepEqual(r.sigue, ['Listo: mañana a las 18 hay dos opciones.', 'appointments', { profession: 'masaje', day: '2026-09-26', dayTo: null, time: { kind: 'exact', from: '18:00', to: null }, zone: null }])
  assert.deepEqual(r.finde, ['El sábado y el domingo hay turnos con Ana y con Beto.', 'appointments', { profession: 'aire', day: '2026-09-26', dayTo: '2026-09-27', time: null, zone: null }], 'the weekend was resolved by the server, not by the model')
  assert.deepEqual(r.cortado, ['Encontré 2 profesionales de Aire acondicionado con turno mañana y el domingo 27/9:', 'appointments', false], 'a model that fails after the real search does not turn the result into an error')
  assert.deepEqual(r.vacio, ['¿Qué servicio necesitás?', ['profession', 'day'], 0], 'nothing is searched until there is something to search')
  assert.deepEqual(r.inventado, [false, null])
})

test('ASISTENTE conversacional (WhatsApp): the same free-text message gives the same search as the Web, without the old step-by-step flow; choosing needs the linked account; facts accumulate', () => {
  const r = runTypeScriptScenario(`${SETUP(true)}
    const out = {}
    try {
      // The model must not be needed at all for a complete message.
      script = () => { throw new Error('the model must not be called') }
      const web = await enviar({ text: PRINCIPAL }, { visitante: nuevoVisitante() })
      const consultaWeb = dom.consultas.at(-1)
      chat.calls.length = 0
      const mensaje = await whatsapp('5491155551001', PRINCIPAL)
      out.whatsapp = [mensaje.type, mensaje.text, chat.calls.length]
      out.mismaConsulta = JSON.stringify(dom.consultas.at(-1)) === JSON.stringify(consultaWeb)
      out.consulta = dom.consultas.at(-1)
      out.estado = (await conversationOf('5491155551001')).state.need
      // Not linked: choosing asks to link the account (nothing is booked).
      const sinCuenta = await whatsapp('5491155551001', 'el segundo')
      out.sinCuenta = [sinCuenta.type, dom.reservas.length]
      // Linked: "el segundo" prepares the booking; "sí" confirms it.
      await whatsapp('5491155551002', PRINCIPAL)
      await linkContact('5491155551002', 'customer-user')
      const tarjeta = await whatsapp('5491155551002', 'el segundo')
      out.tarjeta = [tarjeta.type, tarjeta.text.split('\\n').slice(0, 3)]
      const listo = await whatsapp('5491155551002', 'sí')
      out.listo = [listo.text, dom.reservas.at(-1)]
      // Step by step, still without forms: trade -> day and time -> "no me importa la zona".
      script = (input) => ({ toolCalls: [llamada('find_appointments', { profession: 'electricidad', when: null, zone: null, anyZone: null })] })
      const pasos = []
      for (const texto of ['quiero un electricista', 'mañana a las 18', 'no me importa la zona']) { const m = await whatsapp('5491155551003', texto); pasos.push(m.text.split('\\n')[0]) }
      out.pasos = pasos
      out.estadoFinal = (await conversationOf('5491155551003')).state.need
      out.consultaFinal = dom.consultas.at(-1)
      // Another area of TUS is not swallowed by the search.
      script = () => ({ content: 'no debería responder el modelo' })
      const privado = await whatsapp('5491155551004', 'quiero ver mis trabajos de plomería')
      out.privado = privado.type
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.whatsapp, ['text', 'Encontré 2 profesionales de Masaje con turno mañana a las 18:00:\n1. Ana Gómez — Centro: 18:00\n2. Beto Ruiz — San Benito: 18:00\n¿Con cuál querés solicitar el turno?', 0], 'rendered by the backend from the real result, with no model call')
  assert.equal(r.mismaConsulta, true, 'WhatsApp and the Web ask the backend for exactly the same search')
  assert.deepEqual(r.consulta, { profession: 'masaje', day: '2026-09-26', dayTo: null, time: { kind: 'exact', from: '18:00', to: null }, zone: null })
  assert.deepEqual([r.estado.profession, r.estado.day, r.estado.time, r.estado.zone, r.estado.anyZone, r.estado.clientTravels], ['masaje', '2026-09-26', { kind: 'exact', from: '18:00', to: null }, null, true, true], 'the whole message is kept in the conversation state')
  assert.deepEqual(r.sinCuenta, ['cta_url', 0])
  assert.deepEqual(r.tarjeta, ['buttons', ['Voy a enviar tu solicitud de turno:', 'Prestador: Beto Ruiz', 'Horario: sábado, 26 de septiembre, 18:00 hs']])
  assert.equal(r.listo[0], 'Listo, envié tu solicitud de turno para el sábado, 26 de septiembre a las 18:00 hs. Queda pendiente hasta que el prestador la confirme; podés ver el estado en "Mis turnos".', 'WhatsApp: a pending request, the same words as the Web')
  assert.doesNotMatch(r.listo[0], /confirmad[oa]|reservad[oa]/iu)
  assert.deepEqual(r.listo[1], { subjectId: 'customer-user', providerId: 'perfil-beto', oficioId: 'masaje', inicio: '2026-09-26T21:00:00.000Z' })
  assert.deepEqual(r.pasos, ['¿Para cuándo necesitás Electricidad?', 'Encontré 2 profesionales de Electricidad con turno mañana a las 18:00:', 'Encontré 2 profesionales de Electricidad con turno mañana a las 18:00:'])
  assert.deepEqual([r.estadoFinal.profession, r.estadoFinal.day, r.estadoFinal.time.from, r.estadoFinal.anyZone], ['electricidad', '2026-09-26', '18:00', true])
  assert.deepEqual(r.consultaFinal, { profession: 'electricidad', day: '2026-09-26', dayTo: null, time: { kind: 'exact', from: '18:00', to: null }, zone: null })
  assert.equal(r.privado, 'cta_url', '"mis trabajos de plomería" is a private area: the link is offered, no search')
})

test('ASISTENTE conversacional multi-turn: "Necesito un electricista" -> "Para mañana" -> "A la tarde" -> "El segundo" keeps the context on the Web and on WhatsApp (same state, same searches)', () => {
  const r = runTypeScriptScenario(`${SETUP(false)}
    const out = {}
    const TURNOS = ['Necesito un electricista', 'Para mañana', 'A la tarde', 'El segundo']
    try {
      const v = nuevoVisitante()
      const web = []
      for (const texto of TURNOS) { const m = await decir(texto, { visitante: v }); web.push([m.text.split('\\n')[0], m.kind]) }
      out.web = web
      out.consultasWeb = [...dom.consultas]
      dom.consultas.length = 0
      const wa = []
      for (const texto of TURNOS) { const m = await whatsapp('5491155552001', texto); wa.push([m.text.split('\\n')[0], m.type]) }
      out.whatsapp = wa
      out.consultasWhatsapp = [...dom.consultas]
      out.estado = (await conversationOf('5491155552001')).state.need
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.web, [
    ['¿Para cuándo necesitás Electricidad?', null],
    ['Encontré 2 profesionales de Electricidad con turno mañana:', 'appointments'],
    ['Encontré 2 profesionales de Electricidad con turno mañana a la tarde:', 'appointments'],
    ['Para continuar con eso necesitás iniciar sesión en TUS.', 'sign_in'],
  ])
  assert.deepEqual(r.consultasWeb, [
    { profession: 'electricidad', day: '2026-09-26', dayTo: null, time: null, zone: null },
    { profession: 'electricidad', day: '2026-09-26', dayTo: null, time: { kind: 'between', from: '13:00', to: '20:00' }, zone: null },
  ], 'the trade of turn 1 and the day of turn 2 are still there on turn 3')
  assert.deepEqual(r.whatsapp.slice(0, 3).map((t) => t[0]), r.web.slice(0, 3).map((t) => t[0]), 'WhatsApp answers the same thing')
  assert.equal(r.whatsapp[3][1], 'cta_url', '"El segundo" refers to the second professional shown: booking needs the linked account')
  assert.deepEqual(r.consultasWhatsapp, r.consultasWeb, 'both channels asked the backend for the same searches')
  assert.deepEqual([r.estado.profession, r.estado.day, r.estado.time], ['electricidad', '2026-09-26', { kind: 'between', from: '13:00', to: '20:00' }])
})
