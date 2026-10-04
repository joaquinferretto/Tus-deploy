import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

// TURNOS-SENA-01 in the assistant: a conversation goes from a free-text message to a REAL request
// of turno (pending), on the Web and on WhatsApp, with the model or without it.
//
//   message -> real search -> professional and time in free text -> which service (real prices)
//   -> who the client is (Web: the session; WhatsApp: full name + document, looked up by the
//   backend) -> card with price and deposit -> "sí" -> pending request.
//
// The backend decides who the client is, which services exist and what they cost; the deposit is
// computed by the backend; no internal id is ever written in a reply.
//
// Real orchestrator, tools, confirmations, memory and HTTP router; scripted model; the domain
// port is a fake with a known agenda, catalogue of services and accounts. No network.
//
// Clock of the fixture: Friday 2026-09-25, 09:00 in Argentina. "mañana" is Saturday 26.

const SETUP = (conModelo) => `${SERVICE_SETUP}${WHATSAPP_SETUP}
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { crearRouterAsistenteWeb } = await import('./apps/api/src/tus/asistente/http-web.ts')
  const { NotificadorTurnosWhatsapp } = await import('./apps/api/src/tus/asistente/avisos-turnos.ts')
  const { senaDePrecio } = await import('./apps/api/src/tus/calendar/turnos-sena.ts')
  // The fixture clock is authoritative for both channels; real wall time must not make its
  // chosen slot appear past when this test is run later.
  Date.now = waClock
  const { catalogoVigente, establecerCatalogo } = await import('./apps/api/src/tus/catalogo/vigente.ts')
  const catalogo = catalogoVigente()
  establecerCatalogo({ ...catalogo, oficios: [...catalogo.oficios, { id: 'masaje', categoriaId: null, nombre: 'Masaje', profesion: 'Masajista', slug: 'masaje', descripcion: null, icono: 'herramienta', activo: true, orden: 20, sinonimos: ['masaje', 'masajes', 'masajista', 'contractura'] }] })

  // What each professional offers: variants with their prices in pesos (the "database").
  const VARIANTES = [{ id: 't-base', name: 'Masaje base', durationMinutes: 60, price: 20000 }, { id: 't-espalda', name: 'Espalda completa', durationMinutes: 60, price: 25000 }, { id: 't-cuerpo', name: 'Cuerpo completo', durationMinutes: 60, price: 30000 }]
  const BONGIO = { id: 'perfil-bongio', name: 'Bongio', area: 'Camba Cuá', verified: true, jobs: 4, turnos: true, horas: ['17:00', '18:00'], tarifas: VARIANTES, base: null }
  const ANA = { id: 'perfil-ana', name: 'Ana Gómez', area: 'Centro', verified: true, jobs: 12, turnos: true, horas: ['18:00'], tarifas: [{ id: 't-unica', name: 'Masaje descontracturante', durationMinutes: 60, price: 18000 }], base: null }
  const BETO = { id: 'perfil-beto', name: 'Beto Ruiz', area: 'San Benito', verified: false, jobs: 3, turnos: true, horas: ['18:00'], tarifas: [], base: 15001 }
  const CARO = { id: 'perfil-caro', name: 'Caro Sosa', area: 'Centro', verified: false, jobs: 0, turnos: true, horas: ['18:00'], tarifas: [], base: null }
  let AGENDA = [BONGIO, ANA, BETO, CARO]
  const dom = { consultas: [], reservas: [], pagos: [], pendientes: new Map() }
  const iso = (dia, hora) => new Date(dia + 'T' + hora + ':00.000-03:00').toISOString()
  const cabe = (hora, t) => !t || (t.kind === 'exact' ? hora === t.from : t.kind === 'from' ? hora >= t.from : t.kind === 'until' ? hora < t.to : hora >= t.from && hora < t.to)
  const dominio = {
    esPrestador: async () => false,
    buscarServicios: async () => [],
    servicio: async () => null,
    solicitudes: async () => [],
    trabajos: async () => [],
    buscarPrestadores: async (filter) => ({ profession: filter.profession, providers: [] }),
    buscarDisponibilidad: async (consulta) => {
      dom.consultas.push(consulta)
      const providers = AGENDA.map((p) => {
        const libres = p.horas.map((h) => [h, iso(consulta.day, h)])
        const matches = libres.filter(([h]) => cabe(h, consulta.time)).map(([, i]) => i)
        return { providerId: p.id, name: p.name, profession: 'Masajista', area: p.area, verified: p.verified, completedJobs: p.jobs, takesAppointments: p.turnos, durationMinutes: 60, tariffs: p.tarifas, matches, nearby: matches.length === 0 && consulta.time ? libres.slice(0, 3).map(([, i]) => i) : [] }
      })
      return { profession: consulta.profession, outcome: providers.some((p) => p.matches.length) ? 'matches' : 'nearby', zoneRelaxed: false, providers }
    },
    // Services, variants, prices and the deposit (the backend's one rule): never the model's.
    servicioDeTurno: async (providerId) => {
      const p = AGENDA.find((item) => item.id === providerId)
      if (!p) return null
      const sena = (precio) => (precio ? senaDePrecio(precio) : null)
      return { serviceName: 'Masaje', options: p.tarifas.length ? p.tarifas.map((t) => ({ tariffId: t.id, name: t.name, durationMinutes: t.durationMinutes, price: t.price, deposit: sena(t.price) })) : [{ tariffId: null, name: 'Masaje', durationMinutes: 60, price: p.base, deposit: sena(p.base) }] }
    },
    nombrePrestador: async (providerId) => AGENDA.find((item) => item.id === providerId)?.name ?? null,
    reservarTurno: async (context, input) => {
      if (!context) throw Object.assign(new Error('login'), { code: 'LOGIN_REQUIRED' })
      const p = AGENDA.find((item) => item.id === input.providerId)
      const tarifa = input.tarifaId ? p.tarifas.find((t) => t.id === input.tarifaId) : p.tarifas[0]
      if (input.tarifaId && !tarifa) throw Object.assign(new Error('tarifa'), { code: 'INVALID_PARAMS' })
      const precio = tarifa?.price ?? p.base ?? 0
      dom.reservas.push({ subjectId: context.subjectId, tenantId: context.tenantId, providerId: input.providerId, oficioId: input.oficioId, inicio: input.inicio, tarifaId: input.tarifaId ?? null, precio })
      return { id: 'res-' + dom.reservas.length, prestadorNombre: p.name, inicio: input.inicio, fin: input.inicio, precioFinal: precio, estado: 'pending', sena: precio ? { monto: senaDePrecio(precio), estado: 'not_due' } : null }
    },
    senasPendientes: async (context) => dom.pendientes.get(context.subjectId) ?? [],
    pagarSena: async (context, ref) => { dom.pagos.push([context.subjectId, ref]); const sena = (dom.pendientes.get(context.subjectId) ?? []).find((s) => s.ref === ref); if (!sena) throw Object.assign(new Error('x'), { code: 'NOT_FOUND' }); return { url: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-' + sena.amount, amount: sena.amount } },
    misTurnos: async () => [],
  }

  // The people TUS knows by their document (what "User" holds: normalized document, names).
  const personas = new Map([
    ['12345678', { accountId: 'customer-user', tenantId: customer.tenantId, firstName: 'Juan Ignacio', lastName: 'Mumbach', displayName: 'Juan Ignacio Mumbach' }],
    ['30111222', { accountId: 'other-user', tenantId: stranger.tenantId, firstName: 'María', lastName: 'de la Fuente', displayName: 'María de la Fuente' }],
  ])
  const busquedasDeDocumento = []
  const identidades = { buscarPorDocumento: async (tipo, numero) => { busquedasDeDocumento.push([tipo, numero]); return personas.get(numero) ?? null } }
  const cuentas = { ...accountResolver, contextoDeCuenta: async (accountId, correlationId) => { const cuenta = accounts.get(accountId); return cuenta ? accountResolver.contexto(accountId, cuenta.tenantId, correlationId) : null } }

  const modulo = crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: cuentas, domain: dominio, knowledgeIndex, whatsapp: fakeWa, chat: ${conModelo ? 'chat' : 'null'}, embeddings, transcriptor: null, now: waClock, identidades, metric: (name, fields) => metrics.push({ name, ...fields }) })
  const sesiones = { resolve: async (token, correlationId) => token === 'tok-cliente' ? { subjectId: 'customer-user', sessionId: 'sesion-1', tenantId: customer.tenantId, roles: ['owner'], permissions: ['tus:read'], correlationId } : null }
  const app = express()
  app.use(express.json())
  app.use(crearRouterAsistenteWeb({ servicio: modulo.asistenteWeb, sessions: sesiones, limitePorIp: (_request, _response, next) => next() }))
  const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = 'http://127.0.0.1:' + servidor.address().port
  let visitantes = 0
  const nuevoVisitante = () => 'visitante-sena-' + String(visitantes += 1).padStart(10, '0')
  async function enviar(body, { token, visitante } = {}) {
    const response = await fetch(base + '/tus/v1/asistente/mensajes', { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-sena', accept: 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ ...body, ...(visitante ? { visitorId: visitante } : {}) }) })
    const json = await response.json()
    waAdvance(6000)
    return { status: response.status, code: json.code ?? null, mensajes: (json.messages ?? []).map((m) => ({ text: m.text, attachment: m.attachment ?? null, actions: m.actions ?? null })) }
  }
  const decir = async (text, opciones) => (await enviar({ text }, opciones)).mensajes[0]
  const cola = modulo.crearWorker({ owner: 'sena' })
  async function whatsappTodos(waId, text) {
    const antes = fakeWa.sent.length
    await modulo.ingreso.procesar(parsearWebhookMeta(inbound(waId, text), PHONE_ID), 'corr-wa-sena')
    for (let i = 0; i < 5; i += 1) if ((await cola.procesarSiguiente()).outcome === 'idle') break
    waAdvance(6000)
    return fakeWa.sent.slice(antes).map((item) => item.message)
  }
  const whatsapp = async (waId, text) => (await whatsappTodos(waId, text)).at(-1)
  const cerrar = () => new Promise((resolve) => servidor.close(resolve))
  const PRINCIPAL = 'quiero una masajista para mañana a las 18 no me importa la zona voy yo'
  const INICIO = iso('2026-09-26', '18:00')
  // Every identifier of the fixture that must never be read by a person.
  const INTERNOS = ['perfil-bongio', 'perfil-ana', 'perfil-beto', 'perfil-caro', 't-base', 't-espalda', 't-cuerpo', 't-unica', 'customer-user', 'other-user', customer.tenantId, stranger.tenantId, 'res-1', 'res-2']
  const conInternos = (textos) => textos.filter((texto) => INTERNOS.some((id) => String(texto).includes(id)))
  // A conversation of WhatsApp taken up to the question about the client.
  let numeros = 0
  async function hastaIdentidad(servicio = 'espalda completa') {
    const waId = '54911555600' + String(numeros += 1).padStart(2, '0')
    await whatsapp(waId, PRINCIPAL)
    await whatsapp(waId, 'la primera')
    const pregunta = await whatsapp(waId, servicio)
    return { waId, pregunta }
  }
`

const LISTA_SERVICIOS = '¿Qué servicio querés con Bongio?\n1. Masaje base — $20.000 (60 min)\n2. Espalda completa — $25.000 (60 min)\n3. Cuerpo completo — $30.000 (60 min)\nDecime el número o el nombre.'
// What was chosen is said back once (professional, real day and time), then its real price.
const PIDE_IDENTIDAD = 'Perfecto: Bongio, mañana sábado 26 a las 18:00.\nEl servicio cuesta $25.000 y la seña es de $12.500.\nPara registrar la solicitud necesito tu nombre completo y DNI.'
const TARJETA = (lineas) => ['Vas a solicitar:', ...lineas, 'La solicitud queda pendiente hasta que el prestador la acepte. El turno se confirma después del pago de la seña.', '¿Querés solicitar este turno?'].join('\n')
const TARJETA_ESPALDA = TARJETA(['Prestador: Bongio', 'Servicio: Espalda completa', 'Fecha: sábado 26 de septiembre', 'Horario: 18:00', 'Precio: $25.000', 'Seña: $12.500 (se abona cuando el prestador acepte)'])
const NO_ENCONTRADA = 'No encontré una cuenta de TUS registrada con esos datos. Necesitás registrarte en TUS para poder solicitar el turno. Cuando termines, escribime de nuevo tu nombre completo y DNI y seguimos desde acá.'
const LISTO = 'Solicitud enviada para el sábado, 26 de septiembre a las 18:00 hs. Queda pendiente hasta que el prestador la acepte; podés ver el estado en "Mis turnos". La seña es de $12.500 y se abona recién cuando el prestador acepte.'
const RETORNO = '/trabajadores/perfil-bongio?turno=1&oficio=masaje&inicio=2026-09-26T21%3A00%3A00.000Z&tarifa=t-espalda'

test('ASISTENTE solicitud (WhatsApp, la conversación completa): message -> real search -> "la primera" -> service with its real price -> name + document looked up by the backend -> card with price and deposit -> "sí" -> a PENDING request for the right account; the model is never needed and no internal id is ever written', () => {
  const r = runTypeScriptScenario(`${SETUP(true)}
    const out = {}
    try {
      script = () => { throw new Error('the model must not be needed') }
      const waId = '5491155560001'
      const dichos = []
      const turno = async (texto) => { const m = await whatsappTodos(waId, texto); dichos.push(...m.map((x) => x.text)); return m.at(-1) }
      out.busqueda = (await turno(PRINCIPAL)).text
      const servicio = await turno('la primera')
      out.servicio = [servicio.type, servicio.text]
      const identidad = await turno('espalda completa')
      out.identidad = [identidad.type, identidad.text]
      out.sinCuentaAun = [dom.reservas.length, (await conversationOf(waId)).identifiedAccountId ?? null]
      const tarjeta = await turno('Juan Ignacio Mumbach, DNI 12.345.678')
      out.tarjeta = [tarjeta.type, tarjeta.text, tarjeta.buttons.map((b) => b.title)]
      const conversacion = await conversationOf(waId)
      out.identificada = [conversacion.identifiedAccountId, Boolean(conversacion.identifiedAt), (await contactOf(waId)).linkedAccountId]
      out.antesDeConfirmar = dom.reservas.length
      out.listo = (await turno('Sí')).text
      out.reserva = dom.reservas
      // The same "sí" again requests nothing twice.
      await turno('sí')
      out.unaSola = dom.reservas.length
      // What was looked up, and what was kept.
      out.busquedas = busquedasDeDocumento
      const mensajes = [...waStore.state.mensajes.values()]
      out.documentoGuardado = mensajes.filter((m) => /12\\.?345\\.?678/u.test(m.text ?? '')).length
      out.mensajeDeIdentidad = mensajes.find((m) => m.direction === 'inbound' && /Mumbach/u.test(m.text ?? ''))?.text
      out.auditoria = waStore.state.auditoria.filter((e) => e.action.startsWith('assistant.identity')).map((e) => [e.action, e.actorId, JSON.stringify(e.metadata).includes('12345678'), JSON.stringify(e.metadata).includes('Mumbach')])
      out.internos = conInternos(dichos)
      out.modelo = chat.calls.length
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.match(r.busqueda, /^Encontré 4 profesionales de Masaje con turno mañana sábado 26 a las 18:00:\n1\. Bongio — Camba Cuá: 18:00\n/u)
  assert.deepEqual(r.servicio, ['text', LISTA_SERVICIOS], 'several services: which one, with the price of each in the database')
  assert.deepEqual(r.identidad, ['text', PIDE_IDENTIDAD], 'price and deposit of the chosen service, then who the client is')
  assert.deepEqual(r.sinCuentaAun, [0, null])
  assert.deepEqual(r.tarjeta, ['buttons', `Encontré tu cuenta.\n\n${TARJETA_ESPALDA}`, ['Sí, solicitar turno', 'No']])
  assert.deepEqual(r.identificada, ['customer-user', true, null], 'the conversation knows the account (in the backend); the WhatsApp number is NOT linked to it')
  assert.equal(r.antesDeConfirmar, 0, 'nothing is requested before the explicit yes')
  assert.equal(r.listo, LISTO)
  assert.doesNotMatch(r.listo, /confirmad[oa]|reservad[oa]/iu, 'a request is never announced as a confirmed reservation')
  assert.deepEqual(r.reserva, [{ subjectId: 'customer-user', tenantId: 'customer-tenant', providerId: 'perfil-bongio', oficioId: 'masaje', inicio: '2026-09-26T21:00:00.000Z', tarifaId: 't-espalda', precio: 25000 }])
  assert.equal(r.unaSola, 1)
  assert.deepEqual(r.busquedas, [['DNI', '12345678']], 'the document reaches the lookup normalized (no dots)')
  assert.equal(r.documentoGuardado, 0, 'the stored conversation keeps no document')
  assert.equal(r.mensajeDeIdentidad, 'Juan Ignacio Mumbach, DNI [documento]')
  assert.deepEqual(r.auditoria, [['assistant.identity_verified', 'customer-user', false, false]], 'the audit records who was identified, never the document or the name')
  assert.deepEqual(r.internos, [], 'no reply carries an internal id')
  assert.equal(r.modelo, 1, 'the completed flow used no model; only an extra free-text message after it may do so')
})

test('ASISTENTE identidad (WhatsApp): the backend finds the account by full name + document however they are written; an unknown document, the document of another person and another name with a real document all get the SAME answer and the real registration link; nothing is created; attempts are limited', () => {
  const r = runTypeScriptScenario(`${SETUP(true)}
    const out = { validas: {}, invalidas: {} }
    try {
      script = () => { throw new Error('the model must not be needed') }
      // 1. The same person, written in different ways.
      for (const frase of ['12345678 juan ignacio mumbach', 'JUAN IGNACIO MUMBACH dni 12 345 678', 'Mumbach Juan, DNI: 12.345.678', 'Soy Juan Ignacio Mumbach y mi DNI es 12345678', 'juan mumbach 12.345.678']) {
        const { waId } = await hastaIdentidad()
        const m = await whatsapp(waId, frase)
        out.validas[frase] = [m.type, m.text.split('\\n')[0], (await conversationOf(waId)).identifiedAccountId]
      }
      // 2. Nobody, somebody else's document, somebody else's name: one answer.
      for (const frase of ['Juan Pérez, DNI 99888777', 'Juan Ignacio Mumbach, 30111222', 'María Fuente, 12345678', 'Juan Ignacio Mumbach Gómez 12345678', 'Pedro Mumbach 12345678']) {
        const { waId } = await hastaIdentidad()
        const m = await whatsapp(waId, frase)
        out.invalidas[frase] = [m.type, m.text, m.label ?? null, m.url ?? null, (await conversationOf(waId)).identifiedAccountId ?? null]
      }
      out.nadaCreado = [dom.reservas.length, personas.size, accounts.size]
      out.auditoriaFallos = waStore.state.auditoria.filter((e) => e.action === 'assistant.identity_failed').map((e) => e.metadata.reason)

      // 3. Half of the data: only what is missing is asked; it is not an attempt.
      const incompleta = await hastaIdentidad()
      out.soloDocumento = (await whatsapp(incompleta.waId, '12345678')).text
      out.soloNombre = (await whatsapp(incompleta.waId, 'Juan Ignacio Mumbach')).text
      out.otraCosa = (await whatsapp(incompleta.waId, 'no entiendo, para qué?')).text
      out.luegoCompleta = (await whatsapp(incompleta.waId, 'Juan Ignacio Mumbach 12345678')).type

      // 4. Not registered -> registers on the Web -> writes the same data again: the SAME turno
      //    goes on (no new search, no new choice of professional, service or time).
      const nueva = await hastaIdentidad()
      const consultasAntes = dom.consultas.length
      const sinCuenta = await whatsapp(nueva.waId, 'Laura Benítez 27333444')
      accounts.set('laura-user', { tenantId: 'laura-tenant', status: 'active', roles: ['owner'] })
      personas.set('27333444', { accountId: 'laura-user', tenantId: 'laura-tenant', firstName: 'Laura', lastName: 'Benítez', displayName: 'Laura Benítez' })
      const yaRegistrada = await whatsapp(nueva.waId, 'Laura Benitez, 27.333.444')
      await whatsapp(nueva.waId, 'sí')
      out.trasRegistro = [sinCuenta.type, sinCuenta.url, yaRegistrada.type, yaRegistrada.text.split('\\n').slice(0, 6), dom.consultas.length - consultasAntes, dom.reservas.at(-1)]

      // 5. "No" drops the request; the next message starts clean.
      const arrepentida = await hastaIdentidad()
      out.cancelada = [(await whatsapp(arrepentida.waId, 'no')).text, (await conversationOf(arrepentida.waId)).state.booking ?? null]

      // 6. Guessing documents: after five failures the conversation stops checking, even for a
      //    right answer.
      const adivina = await hastaIdentidad()
      const respuestas = []
      for (let i = 0; i < 6; i += 1) respuestas.push((await whatsapp(adivina.waId, 'Juan Ignacio Mumbach 2000000' + i)).text)
      const conLaCorrecta = await whatsapp(adivina.waId, 'Juan Ignacio Mumbach 12345678')
      out.limite = [respuestas.slice(0, 5).every((t) => t === ${JSON.stringify(NO_ENCONTRADA)}), respuestas[5], conLaCorrecta.text, (await conversationOf(adivina.waId)).identifiedAccountId ?? null]
      out.modelo = chat.calls.length
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  for (const [frase, resultado] of Object.entries(r.validas)) assert.deepEqual(resultado, ['buttons', 'Encontré tu cuenta.', 'customer-user'], `found: "${frase}"`)
  const registro = `https://web.tus.test/registro?returnTo=${encodeURIComponent(RETORNO)}`
  for (const [frase, resultado] of Object.entries(r.invalidas)) assert.deepEqual(resultado, ['cta_url', NO_ENCONTRADA, 'Registrarme', registro, null], `not found, same answer: "${frase}"`)
  assert.deepEqual(r.nadaCreado, [0, 2, 3], 'no request, no person and no account is created for somebody TUS does not know')
  assert.deepEqual(r.auditoriaFallos, ['documento_desconocido', 'nombre_distinto', 'nombre_distinto', 'nombre_distinto', 'nombre_distinto'], 'the reason stays in the audit; the person hears the same thing')
  assert.equal(r.soloDocumento, 'Me falta tu nombre completo (nombre y apellido), junto con tu DNI.')
  assert.equal(r.soloNombre, 'Para registrar la solicitud necesito tu nombre completo y DNI. Por ejemplo: "Juan Pérez, 12345678".')
  assert.equal(r.otraCosa, 'Para registrar la solicitud necesito tu nombre completo y DNI. Por ejemplo: "Juan Pérez, 12345678".')
  assert.equal(r.luegoCompleta, 'buttons')
  assert.deepEqual(r.trasRegistro.slice(0, 3), ['cta_url', registro, 'buttons'], 'the link is the real registration route, with the way back to that very turno')
  assert.deepEqual(r.trasRegistro[3], ['Encontré tu cuenta.', '', 'Vas a solicitar:', 'Prestador: Bongio', 'Servicio: Espalda completa', 'Fecha: sábado 26 de septiembre'])
  assert.equal(r.trasRegistro[4], 0, 'after registering nothing is searched again')
  assert.deepEqual(r.trasRegistro[5], { subjectId: 'laura-user', tenantId: 'laura-tenant', providerId: 'perfil-bongio', oficioId: 'masaje', inicio: '2026-09-26T21:00:00.000Z', tarifaId: 't-espalda', precio: 25000 })
  assert.deepEqual(r.cancelada, ['Listo, no hice ningún cambio.', null])
  assert.deepEqual(r.limite, [true, 'Por seguridad no puedo seguir verificando datos por acá. Iniciá sesión en la Web de TUS para solicitar el turno.', 'Por seguridad no puedo seguir verificando datos por acá. Iniciá sesión en la Web de TUS para solicitar el turno.', null])
  assert.equal(r.modelo, 0)
})

test('ASISTENTE servicios y precios: one variant or none -> no question; the price and the deposit of the card are the backend\'s (20.000 -> 10.000, 25.000 -> 12.500, 30.000 -> 15.000, an odd price keeps its cents, no price -> no deposit); the service can be said with the professional and the time, by number, ordinal or name', () => {
  const r = runTypeScriptScenario(`${SETUP(false)}
    const out = { porServicio: {}, elecciones: {} }
    try {
      const sesion = { token: 'tok-cliente' }
      const lineas = (texto) => texto.split('\\n').filter((l) => /^(Prestador|Servicio|Precio|Seña)/u.test(l))
      const cancelar = async (m) => { if (m.actions) await enviar({ replyId: m.actions[1].id }, sesion) }
      // 1. Each variant of Bongio, chosen in a different way.
      for (const [frase, variante] of [['1', 'Masaje base'], ['el segundo', 'Espalda completa'], ['cuerpo completo', 'Cuerpo completo'], ['quiero el de espalda', 'Espalda completa'], ['el masaje de cuerpo', 'Cuerpo completo'], ['la tercera', 'Cuerpo completo']]) {
        await decir(PRINCIPAL, sesion)
        const pregunta = await decir('el primero', sesion)
        const m = await decir(frase, sesion)
        out.elecciones[frase] = [pregunta.text === ${JSON.stringify(LISTA_SERVICIOS)}, lineas(m.text), m.actions?.map((a) => a.label) ?? null]
        await cancelar(m)
      }
      // 2. Something that is not one of its services: the list again, never a guess.
      await decir(PRINCIPAL, sesion)
      await decir('el primero', sesion)
      out.noExiste = (await decir('drenaje linfático', sesion)).text
      out.ambiguo = (await decir('masaje', sesion)).text.split('\\n')[0]
      await decir('no', sesion)
      // 3. The service said along with the professional and the time.
      await decir('quiero una masajista para mañana', sesion)
      const directo = await decir('con Bongio a las 18, espalda completa', sesion)
      out.directo = lineas(directo.text)
      await cancelar(directo)
      // 4. One variant, a base price (odd), and no price at all.
      for (const [quien, nombre] of [['la segunda', 'ana'], ['el tercero', 'beto'], ['el cuarto', 'caro']]) {
        await decir(PRINCIPAL, sesion)
        const m = await decir(quien, sesion)
        out.porServicio[nombre] = [lineas(m.text), m.actions?.map((a) => a.label) ?? null]
        if (nombre === 'caro') out.sinPrecio = m.text
        await cancelar(m)
      }
      out.reservas = dom.reservas.length
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  const botones = ['Sí, solicitar turno', 'No']
  const tarjeta = (servicio, precio, sena) => ['Prestador: Bongio', `Servicio: ${servicio}`, `Precio: ${precio}`, `Seña: ${sena} (se abona cuando el prestador acepte)`]
  assert.deepEqual(r.elecciones, {
    1: [true, tarjeta('Masaje base', '$20.000', '$10.000'), botones],
    'el segundo': [true, tarjeta('Espalda completa', '$25.000', '$12.500'), botones],
    'cuerpo completo': [true, tarjeta('Cuerpo completo', '$30.000', '$15.000'), botones],
    'quiero el de espalda': [true, tarjeta('Espalda completa', '$25.000', '$12.500'), botones],
    'el masaje de cuerpo': [true, tarjeta('Cuerpo completo', '$30.000', '$15.000'), botones],
    'la tercera': [true, tarjeta('Cuerpo completo', '$30.000', '$15.000'), botones],
  })
  assert.equal(r.noExiste, `No encontré ese servicio. ${LISTA_SERVICIOS}`)
  assert.equal(r.ambiguo, 'No encontré ese servicio. ¿Qué servicio querés con Bongio?', '"masaje" alone names no single variant')
  assert.deepEqual(r.directo, tarjeta('Espalda completa', '$25.000', '$12.500'), 'the service said in the same message is not asked again')
  assert.deepEqual(r.porServicio, {
    ana: [['Prestador: Ana Gómez', 'Servicio: Masaje descontracturante', 'Precio: $18.000', 'Seña: $9.000 (se abona cuando el prestador acepte)'], botones],
    beto: [['Prestador: Beto Ruiz', 'Servicio: Masaje', 'Precio: $15.001', 'Seña: $7.500,50 (se abona cuando el prestador acepte)'], botones],
    caro: [[], null],
  })
  assert.equal(r.sinPrecio, 'El servicio Masaje todavía no tiene un precio publicado. Para solicitar un turno con seña, el prestador debe configurar el precio.')
  assert.equal(r.reservas, 0)
})

test('ASISTENTE solicitud (Web): the client is the session, never asked for a document; a visitor chooses the service and is sent to sign in or register with the way back to that very turno, and after signing in the SAME request goes on; no body field decides the client or the price', () => {
  const r = runTypeScriptScenario(`${SETUP(false)}
    const out = {}
    try {
      const v = nuevoVisitante()
      const dichos = []
      const turno = async (texto, opciones) => { const m = await decir(texto, opciones); dichos.push(m.text); return m }
      await turno(PRINCIPAL, { visitante: v })
      out.servicio = (await turno('el primero', { visitante: v })).text
      const sinSesion = await turno('2', { visitante: v })
      out.sinSesion = [sinSesion.text, sinSesion.attachment, sinSesion.actions, dom.reservas.length]
      // Signing in (or registering) keeps the conversation of this browser: any message goes on.
      const consultas = dom.consultas.length
      const tarjeta = await turno('listo, ya entré', { visitante: v, token: 'tok-cliente' })
      out.tarjeta = [tarjeta.text, tarjeta.actions.map((a) => a.label), dom.consultas.length - consultas]
      const listo = await enviar({ replyId: tarjeta.actions[0].id, clienteId: 'other-user', userId: 'other-user', tenantId: 'other-tenant', precio: 1, sena: 1, estado: 'confirmed', providerId: 'perfil-ana' }, { visitante: v, token: 'tok-cliente' })
      out.listo = [listo.status, listo.mensajes[0]?.text ?? null, listo.code]
      // A signed-in client from the start: no question about who it is.
      const sesion = { token: 'tok-cliente' }
      await turno(PRINCIPAL, sesion)
      await turno('el primero', sesion)
      const directa = await turno('cuerpo completo', sesion)
      out.directa = directa.text.split('\\n').filter((l) => /^(Servicio|Precio|Seña)/u.test(l))
      // The message itself cannot name the client, the price or the state either.
      const intento = await enviar({ replyId: directa.actions[0].id }, sesion)
      out.reservas = dom.reservas
      out.nuncaPideDocumento = dichos.filter((t) => /DNI|documento/iu.test(t)).length
      out.internos = conInternos([...dichos, listo.mensajes[0]?.text ?? '', intento.mensajes[0].text])
      out.busquedasDeDocumento = busquedasDeDocumento.length
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.servicio, LISTA_SERVICIOS, 'the services and their prices are public: a visitor sees them')
  assert.deepEqual(r.sinSesion, ['El servicio cuesta $25.000 y la seña es de $12.500.\nPara continuar con eso necesitás iniciar sesión en TUS.', { kind: 'sign_in', returnTo: RETORNO }, null, 0], 'no account -> the way in, with the way back to that professional, service and time')
  assert.deepEqual(r.tarjeta, [TARJETA_ESPALDA, ['Sí, solicitar turno', 'No'], 0], 'after signing in the same request goes on: nothing is searched or chosen again')
  assert.ok(r.listo[0] === 200 ? r.listo[1] === LISTO : r.listo[0] === 422, 'identity or money fields in the body are ignored or rejected, never honoured')
  const deSesion = r.reservas.filter((x) => x.subjectId === 'customer-user')
  assert.equal(deSesion.length, r.reservas.length, 'every request is for the account of the session')
  assert.deepEqual(r.reservas.at(-1), { subjectId: 'customer-user', tenantId: 'customer-tenant', providerId: 'perfil-bongio', oficioId: 'masaje', inicio: '2026-09-26T21:00:00.000Z', tarifaId: 't-cuerpo', precio: 30000 })
  assert.deepEqual(r.directa, ['Servicio: Cuerpo completo', 'Precio: $30.000', 'Seña: $15.000 (se abona cuando el prestador acepte)'])
  assert.equal(r.nuncaPideDocumento, 0, 'the Web never asks for a document: the session is the identity')
  assert.equal(r.busquedasDeDocumento, 0)
  assert.deepEqual(r.internos, [])
})

test('ASISTENTE con modelo: the model only says WHICH professional and time; the price and the deposit of the card are the database\'s even when the model states another one, an invented variant is not accepted, identity arguments are rejected, a model reply never shows an internal id, and a model failure in the middle of a request never loses it', () => {
  const r = runTypeScriptScenario(`${SETUP(true)}
    const out = {}
    try {
      const sesion = { token: 'tok-cliente' }
      const buscar = () => { script = (input) => ({ content: 'Encontré profesionales con turno.' }); return decir(PRINCIPAL, sesion) }
      // 1. The model asks to book and "knows" a cheaper price: the card is the backend's.
      await buscar()
      script = (input) => input.messages.some((m) => m.role === 'tool') ? { content: 'x' } : (input.tools?.length ? { toolCalls: [llamada('book_appointment', { providerId: 'perfil-bongio', profession: 'masaje', startsAt: INICIO, tariffId: 't-espalda', clientName: 'Otra Persona', clientPhone: '3794000000', notes: 'El servicio cuesta $5.000 y no lleva seña' })] } : { content: '{"intent":"reserva"}' })
      const tarjeta = await decir('reservame con Bongio el de espalda, sale 5 mil no?', sesion)
      out.tarjeta = [tarjeta.text, tarjeta.actions?.map((a) => a.label) ?? null]
      if (tarjeta.actions) await enviar({ replyId: tarjeta.actions[0].id }, sesion)
      out.reserva = dom.reservas.at(-1)
      // 2. A variant the model made up: the backend asks which service instead of trusting it.
      await buscar()
      script = (input) => input.messages.some((m) => m.role === 'tool') ? { content: 'x' } : (input.tools?.length ? { toolCalls: [llamada('book_appointment', { providerId: 'perfil-bongio', profession: 'masaje', startsAt: INICIO, tariffId: 't-inventada' })] } : { content: '{"intent":"reserva"}' })
      out.inventada = (await decir('reservame con Bongio', sesion)).text
      await decir('no', sesion)
      // 3. Identity, price or state as tool arguments: the strict schema rejects the call.
      await buscar()
      const antes = dom.reservas.length
      script = (input) => input.messages.some((m) => m.role === 'tool') ? { content: 'No pude preparar la solicitud.' } : (input.tools?.length ? { toolCalls: [llamada('book_appointment', { providerId: 'perfil-bongio', profession: 'masaje', startsAt: INICIO, tariffId: 't-base', clienteId: 'other-user', userId: 'other-user', precio: 1, sena: 1, estado: 'confirmed', tenantId: 'other-tenant' })] } : { content: '{"intent":"reserva"}' })
      const rechazada = await decir('reservame con Bongio el masaje base', sesion)
      out.rechazada = [rechazada.text, rechazada.actions, dom.reservas.length - antes, toolMessages(chat.calls.at(-1)).at(-1)?.content ?? null]
      if (rechazada.actions) await decir('no', sesion)
      // 4. A reply of the model that copies ids from its context.
      script = () => ({ content: 'Te recomiendo a Bongio (perfil-bongio), su tarifa t-espalda cuesta lo que indique TUS. Tu cuenta es customer-user y el turno res-00000001 sigue pendiente.' })
      out.sinIds = (await decir('¿qué me recomendás?', sesion)).text
      // 5. WhatsApp, the model down in the middle of a request: the steps are the backend's.
      script = () => { throw Object.assign(new Error('rate limited'), { code: 'rate_limit_exceeded' }) }
      const { waId, pregunta } = await hastaIdentidad('2')
      const final = await whatsapp(waId, 'Juan Ignacio Mumbach 12345678')
      out.sinModelo = [pregunta.text, final.type, final.text.split('\\n')[0]]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.ok(r.tarjeta[1], JSON.stringify(r.tarjeta))
  assert.deepEqual([r.tarjeta[0].split('\n').filter((l) => /^(Prestador|Servicio|Precio|Seña)/u.test(l)), r.tarjeta[1]], [['Prestador: Bongio', 'Servicio: Espalda completa', 'Precio: $25.000', 'Seña: $12.500 (se abona cuando el prestador acepte)'], ['Sí, solicitar turno', 'No']], 'the database says $25.000: that is the price, whatever the model or the user wrote')
  assert.deepEqual(r.reserva, { subjectId: 'customer-user', tenantId: 'customer-tenant', providerId: 'perfil-bongio', oficioId: 'masaje', inicio: '2026-09-26T21:00:00.000Z', tarifaId: 't-espalda', precio: 25000 }, 'requested for the session account (not "Otra Persona") at the real price')
  assert.equal(r.inventada, LISTA_SERVICIOS, 'a variant that does not exist is never booked: the real ones are offered')
  assert.match(r.rechazada[0], /Servicio: Masaje base[\s\S]*Precio: \$20\.000/u, 'the deterministic path uses the real service and price')
  assert.deepEqual(r.rechazada[1]?.map((a) => a.label), ['Sí, solicitar turno', 'No'], 'a card is still only a proposal')
  assert.equal(r.rechazada[2], 0, 'nothing requested')
  assert.doesNotMatch(r.sinIds, /perfil-bongio|t-espalda|customer-user|res-00000001/u, 'internal ids are removed from what the model wrote')
  assert.match(r.sinIds, /Te recomiendo a Bongio/u)
  assert.deepEqual(r.sinModelo, [PIDE_IDENTIDAD, 'buttons', 'Encontré tu cuenta.'])
})

test('ASISTENTE seña: "quiero pagar la seña" gives the real checkout of the deposits the client can pay (Web: the session; WhatsApp: after name + document); the provider\'s answer reaches the WhatsApp conversation that asked, with the payment link, only inside the service window', () => {
  const r = runTypeScriptScenario(`${SETUP(false)}
    const { mensajeRespuesta } = await import('./apps/api/src/tus/asistente/avisos-turnos.ts')
    const out = {}
    try {
      const pendiente = { ref: 'res-1', providerName: 'Bongio', service: 'Espalda completa', startsAt: INICIO, amount: 12500 }
      // 1. Nothing to pay yet.
      const sesion = { token: 'tok-cliente' }
      out.nada = (await decir('quiero pagar la seña', sesion)).text
      dom.pendientes.set('customer-user', [pendiente])
      // 2. Web, signed in: the link of the deposit, built by the backend.
      const web = await decir('quiero pagar la seña', sesion)
      out.web = [web.text, web.actions]
      // 3. Web visitor: sign in first, and back to its turnos.
      const visitante = await decir('cómo pago la seña?', { visitante: nuevoVisitante() })
      out.visitante = [visitante.text, visitante.attachment]
      // 4. WhatsApp: who is asking first; then the link. Somebody else gets nothing of this account.
      const waId = '5491155570001'
      const pide = await whatsapp(waId, 'quiero pagar la seña')
      const ajena = await whatsappTodos(waId, 'María de la Fuente 30111222')
      const propia = await whatsappTodos('5491155570002', 'pasame el link para pagar la seña')
      const mia = await whatsappTodos('5491155570002', 'Juan Ignacio Mumbach 12345678')
      out.whatsapp = [pide.text, ajena.map((m) => [m.type, m.text]), propia.map((m) => m.text), mia.map((m) => [m.type, m.text, m.label ?? null, m.url ?? null])]
      out.pagos = dom.pagos
      out.internos = conInternos([out.nada, web.text, ...ajena.map((m) => m.text), ...mia.map((m) => m.text)])

      // 5. The provider answers: the conversation that identified the account is told.
      const avisos = modulo.avisosTurnos
      const aviso = { reservaId: 'res-1', clienteCuentaId: 'customer-user', resultado: 'awaiting_payment', prestadorNombre: 'Bongio', servicio: 'Masaje', inicio: new Date(INICIO), sena: { monto: 12500, moneda: 'ARS', pagable: true, url: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-12500' } }
      const antes = fakeWa.sent.length
      await avisos.solicitudRespondida(aviso)
      out.avisoAceptado = fakeWa.sent.slice(antes).map((item) => [item.to, item.message.type, item.message.text, item.message.label ?? null, item.message.url ?? null])
      const antesConfirmar = fakeWa.sent.length
      await avisos.turnoConfirmado(aviso)
      out.avisoConfirmado = fakeWa.sent.slice(antesConfirmar).map((item) => [item.to, item.message.text])
      // A linked WhatsApp of the same account hears it too; the Web conversation never gets a push.
      await whatsapp('5491155570003', 'hola')
      await linkContact('5491155570003', 'customer-user')
      const antes2 = fakeWa.sent.length
      await avisos.solicitudRespondida({ ...aviso, resultado: 'rejected', sena: null })
      out.avisoRechazado = fakeWa.sent.slice(antes2).map((item) => [item.to, item.message.type, item.message.text]).sort()
      // More than 24 hours after the person's last message: no free-form message may be sent.
      waAdvance(25 * 60 * 60 * 1000)
      const antes3 = fakeWa.sent.length
      await avisos.solicitudRespondida(aviso)
      out.fueraDeVentana = fakeWa.sent.length - antes3
      // The other shapes of the notice.
      out.textos = [
        mensajeRespuesta({ ...aviso, sena: { ...aviso.sena, url: null } }).text,
        mensajeRespuesta({ ...aviso, sena: { ...aviso.sena, pagable: false, url: null } }).text,
        mensajeRespuesta({ ...aviso, sena: null }).text,
      ]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  const link = 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-12500'
  const textoSena = 'Seña de tu turno con Bongio (Espalda completa) del sábado 26 de septiembre a las 18:00: $12.500. El pago se acredita cuando Mercado Pago lo aprueba.'
  assert.equal(r.nada, 'No tenés señas pendientes de pago. La seña se puede abonar cuando el prestador acepta el turno.')
  assert.deepEqual(r.web, [textoSena, [{ kind: 'link', url: link, label: 'Pagar seña' }]])
  assert.deepEqual(r.visitante, ['Para continuar con eso necesitás iniciar sesión en TUS.', { kind: 'sign_in', returnTo: '/mis-turnos' }])
  assert.equal(r.whatsapp[0], 'Para pasarte el link de pago de tu seña necesito tu nombre completo y DNI.')
  assert.deepEqual(r.whatsapp[1], [['text', 'Encontré tu cuenta.'], ['text', 'No tenés señas pendientes de pago. La seña se puede abonar cuando el prestador acepta el turno.']], 'another person, correctly identified, sees only its own deposits (none)')
  assert.deepEqual(r.whatsapp[2], ['Para pasarte el link de pago de tu seña necesito tu nombre completo y DNI.'])
  assert.deepEqual(r.whatsapp[3], [['text', 'Encontré tu cuenta.', null, null], ['cta_url', textoSena, 'Pagar seña', link]])
  assert.deepEqual(r.pagos, [['customer-user', 'res-1'], ['customer-user', 'res-1']], 'the checkout is asked for the identified account and its own turno')
  assert.deepEqual(r.internos, [])
  assert.deepEqual(r.avisoAceptado, [['5491155570002', 'cta_url', 'El prestador aceptó tu solicitud: tu turno de Masaje con Bongio del sábado 26 de septiembre a las 18:00. Para confirmar definitivamente el turno tenés que abonar la seña de $12.500.', 'Pagar seña', link]], 'only the WhatsApp conversation of that account, with the real link')
  assert.deepEqual(r.avisoConfirmado, [['5491155570002', '¡Tu turno quedó confirmado! Masaje con Bongio, sábado 26 de septiembre a las 18:00.']])
  assert.deepEqual(r.avisoRechazado, [
    ['5491155570002', 'text', 'Bongio no pudo tomar tu solicitud de turno de Masaje del sábado 26 de septiembre a las 18:00. Podés pedirme otro horario u otro profesional.'],
    ['5491155570003', 'text', 'Bongio no pudo tomar tu solicitud de turno de Masaje del sábado 26 de septiembre a las 18:00. Podés pedirme otro horario u otro profesional.'],
  ])
  assert.equal(r.fueraDeVentana, 0, 'outside Meta\'s 24-hour window nothing is sent (the email and "Mis turnos" carry the notice)')
  assert.deepEqual(r.textos, [
    'El prestador aceptó tu solicitud: tu turno de Masaje con Bongio del sábado 26 de septiembre a las 18:00. Para confirmar definitivamente el turno tenés que abonar la seña de $12.500: escribime "pagar la seña" y te paso el link.',
    'El prestador aceptó tu solicitud: tu turno de Masaje con Bongio del sábado 26 de septiembre a las 18:00. La seña de $12.500 sigue pendiente; el pago online todavía no está disponible.',
    'El prestador aceptó tu solicitud: tu turno de Masaje con Bongio del sábado 26 de septiembre a las 18:00. El turno sigue esperando el pago de seña.',
  ])
})

test('ASISTENTE identidad y textos (unidad): the document is normalized (dots, spaces), the name matches whatever its case, accents, order or surname particles and never another person; prices are written the same way everywhere; internal ids are removed from a text', () => {
  const r = runTypeScriptScenario(`
    const { extraerIdentidad, mismoNombre, sinDocumento } = await import('./apps/api/src/tus/asistente/identificacion.ts')
    const { sinIdentificadores, elegirServicio, retornoDeSolicitud, enlaceRegistro } = await import('./apps/api/src/tus/asistente/solicitud-turno.ts')
    const { formatearPesos } = await import('./packages/contracts/src/tus-turnos.ts')
    const { redactarPii } = await import('./apps/api/src/tus/asistente/modelo.ts')
    const juan = { firstName: 'Juan Ignacio', lastName: 'Mumbach', displayName: 'Juan Ignacio Mumbach' }
    const maria = { firstName: 'María de los Ángeles', lastName: 'de la Fuente', displayName: 'María de la Fuente' }
    const opciones = [{ tariffId: 'a', name: 'Masaje relajante', durationMinutes: 60, price: 1, deposit: 0.5 }, { tariffId: 'b', name: 'Masaje deportivo', durationMinutes: 60, price: 1, deposit: 0.5 }, { tariffId: 'c', name: 'Piernas', durationMinutes: 30, price: 1, deposit: 0.5 }]
    const elegida = (frase) => elegirServicio(frase, opciones, 'Masaje')?.name ?? null
    console.log(JSON.stringify({
      documentos: ['12.345.678', '12 345 678', '12345678', 'DNI: 12.345.678', 'dni 1.234.567', 'mi dni es 12345678 gracias'].map((t) => extraerIdentidad('Juan Mumbach ' + t).documento),
      noSonDocumento: ['mi teléfono es 3794123456', 'vivo en Junín 1234', 'tengo 2 turnos', '123456', '012345678', '5491155550001'].map((t) => extraerIdentidad('Juan Mumbach ' + t).documento),
      nombres: ['Juan Ignacio Mumbach, 12345678', 'soy juan ignacio mumbach dni 12345678', 'DNI 12345678 - MUMBACH, JUAN IGNACIO', '12345678', 'Juan 12345678', 'hola quiero un turno mañana a la tarde con alguien bueno 12345678'].map((t) => extraerIdentidad(t).nombre),
      juan: ['Juan Ignacio Mumbach', 'JUAN IGNACIO MUMBACH', 'mumbach juan ignacio', 'Juan Mumbach', 'Juán Ignácio Mumbach'].map((n) => mismoNombre(n, juan)),
      noJuan: ['Ignacio Mumbach', 'Juan Ignacio', 'Juan Ignacio Mumbach Pérez', 'Pedro Mumbach', 'Juan Mumbac', 'Mumbach'].map((n) => mismoNombre(n, juan)),
      maria: ['María de la Fuente', 'maria fuente', 'María de los Ángeles de la Fuente', 'Fuente María'].map((n) => mismoNombre(n, maria)),
      noMaria: ['María López', 'Ángeles de la Fuente'].map((n) => mismoNombre(n, maria)),
      sinDocumento: sinDocumento('Juan Mumbach, DNI 12.345.678 y mi hermana 30 111 222'),
      alModelo: redactarPii('Juan Mumbach, DNI 12.345.678'),
      pesos: [20000, 25000, 12500, 1250.5, 999, 1000000, 0.5].map(formatearPesos),
      servicios: ['1', 'la segunda', 'deportivo', 'el masaje deportivo', 'piernas', 'pierna', 'masaje', '7', 'el de espalda'].map(elegida),
      ids: sinIdentificadores('Bongio (perfil-bongio) tiene el turno res-9f8e7d6c5b4a y tu cuenta es 3f2504e0-4f89-11d3-9a0c-0305e82c3301. Cuesta $25.000.', ['perfil-bongio']),
      retorno: retornoDeSolicitud({ providerId: 'perfil-bongio', profession: 'masaje', startsAt: '2026-09-26T21:00:00.000Z', tariffId: null }),
      registro: enlaceRegistro('https://tusservicios.shop/', '/mis-turnos'),
    }))
  `)
  assert.deepEqual(r.documentos, ['12345678', '12345678', '12345678', '12345678', '1234567', '12345678'], 'one normalized form: digits only')
  assert.deepEqual(r.noSonDocumento, [null, null, null, null, null, null], 'a phone, an address, a quantity or a malformed number is not a document')
  assert.deepEqual(r.nombres, ['juan ignacio mumbach', 'juan ignacio mumbach', 'mumbach juan ignacio', null, null, null], 'a full name is at least a first name and a surname, and not a sentence')
  assert.deepEqual(r.juan, [true, true, true, true, true])
  assert.deepEqual(r.noJuan, [false, false, false, false, false, false], 'the first given name and every surname are required, and nothing foreign is accepted')
  assert.deepEqual(r.maria, [true, true, true, true])
  assert.deepEqual(r.noMaria, [false, false])
  assert.equal(r.sinDocumento, 'Juan Mumbach, DNI [documento] y mi hermana [documento]')
  assert.equal(r.alModelo, 'Juan Mumbach, DNI [documento]', 'the model never receives a document')
  assert.deepEqual(r.pesos, ['$20.000', '$25.000', '$12.500', '$1.250,50', '$999', '$1.000.000', '$0,50'])
  assert.deepEqual(r.servicios, ['Masaje relajante', 'Masaje deportivo', 'Masaje deportivo', 'Masaje deportivo', 'Piernas', 'Piernas', null, null, null])
  assert.equal(r.ids, 'Bongio tiene el turno y tu cuenta es. Cuesta $25.000.')
  assert.equal(r.retorno, '/trabajadores/perfil-bongio?turno=1&oficio=masaje&inicio=2026-09-26T21%3A00%3A00.000Z')
  assert.equal(r.registro, 'https://tusservicios.shop/registro?returnTo=%2Fmis-turnos')
})
