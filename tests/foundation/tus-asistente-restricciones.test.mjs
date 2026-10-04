import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { GENERAL_SETUP } from './fixtures/asistente-general.mjs'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-RESTRICCIONES-01. The person does not have to talk like a machine: "otra persona",
// "que no sea Melina", "cualquiera menos la segunda", "dejalo", "cambiame el horario" change the
// request under way — only what they say — and the backend acts on it with the REAL calendar. The
// text says what was meant; who is excluded is resolved by the backend against the professional
// proposed and the options really shown. No model is involved in any of these tests.
// Clock of the fixture: Tuesday 2026-10-06, 09:00 in Argentina. Masaje on Wednesday 7: Melina
// (09:00, 09:15, 09:30, 09:45), Sabrina (09:45, 10:00), Bongio (09:45).

// The same WhatsApp pipeline of the help suite (identity lookup by name + document included).
const ayuda = readFileSync(join(root, 'tests/foundation/tus-asistente-ayuda-interrupciones.test.mjs'), 'utf8')
const SETUP = `${GENERAL_SETUP}${ayuda.slice(ayuda.indexOf('const { createAuthService }'), ayuda.indexOf('`\n\nconst PIDE_DATOS'))}
  const charlar = async (waId, mensajes) => { const respuestas = []; for (const texto of mensajes) respuestas.push((await enviar(waId, texto)).text); return respuestas }
  const estado = async (waId) => {
    const s = (await conversationOf(waId)).state
    return {
      servicio: s.need?.profession ?? null, dia: s.need?.day ?? null, asap: s.need?.asap ?? null, cualquiera: s.need?.anyProvider ?? null, profesional: s.need?.providerId ?? null,
      excluidos: s.need?.excludedProviderIds ?? [],
      reserva: s.booking ? [s.booking.providerName, s.booking.step, s.booking.startsAt] : null,
      propuesta: s.suggestion?.kind === 'offer' ? [s.suggestion.name, s.suggestion.start] : null,
    }
  }
  const M9 = iso('2026-10-07', '09:00'); const M945 = iso('2026-10-07', '09:45')
`

const LISTA = '1. Melina — Barrio Sur: 09:00, 09:15, 09:30, 09:45\n2. Sabrina — San Benito: 09:45, 10:00\n3. Bongio — Centro: 09:45'
const PRIMERA = `La primera disponibilidad de Masaje es mañana miércoles 7 a las 09:00 con Melina.\n\nOpciones de ese día:\n${LISTA}\n\nPodés decirme el número, el nombre o el horario que preferís.`
const propone = (nombre, hora = '09:45') => `Entendido, busco otra persona.\n\nLa primera disponibilidad es mañana miércoles 7 a las ${hora} con ${nombre}. ¿Querés esa?`
const PIDE_DATOS_MELINA = 'Perfecto: Melina, mañana miércoles 7 a las 09:00.\nEl servicio cuesta $200 y la seña es de $100.\nPara registrar la solicitud necesito tu nombre completo y DNI.'
const NO_ES_IDENTIDAD = /necesito tu nombre completo y DNI\.$|No pude validar esos datos|Me falta tu nombre/u

test('RESTRICCIONES regresión de las capturas: "Quiero a otra persona" excludes the professional proposed and searches the others — it never asks "¿Con cuál?"; "otra persona lo antes posible" is the first real turno among everybody else', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const A = '5493794700001'
    out.a = await charlar(A, ['necesito un masaje lo antes posible', 'Quiero a otra persona'])
    out.aEstado = await estado(A)
    out.a2 = await charlar(A, ['otra persona lo antes posible'])
    out.a2Estado = await estado(A)
    out.a3 = await charlar(A, ['sí'])
    out.a3Estado = await estado(A)
    const B = '5493794700002'
    out.b = await charlar(B, ['necesito un masaje lo antes posible', 'No sé cuál, quiero alguien lo antes posible que no sea Melina'])
    out.bEstado = await estado(B)
    const C = '5493794700003'
    out.c = await charlar(C, ['necesito un masaje', 'no sé cuál, alguien lo antes posible'])
    out.cEstado = await estado(C)
    out.consultas = dom.consultas.every((c) => c.profession === 'masaje')
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.a[0], PRIMERA)
  assert.equal(r.a[1], propone('Sabrina'), 'Melina had the first turno: she is excluded and the first turno of the OTHERS is proposed')
  assert.doesNotMatch(r.a[1], /¿Con cuál\?/u)
  assert.deepEqual([r.aEstado.servicio, r.aEstado.asap, r.aEstado.cualquiera, r.aEstado.profesional, r.aEstado.excluidos], ['masaje', true, true, null, ['perfil-melina']], 'structured state: the service is kept, nobody is chosen, Melina is excluded')
  assert.deepEqual(r.aEstado.propuesta, ['Sabrina', '2026-10-07T12:45:00.000Z'])
  assert.equal(r.a2[0], propone('Bongio'), 'again: now the one just proposed is excluded too')
  assert.deepEqual(r.a2Estado.excluidos, ['perfil-melina', 'perfil-sabrina'], 'exclusions add up within the request')
  assert.match(r.a3[0], /^Perfecto: Bongio, mañana miércoles 7 a las 09:45\./u, '"sí" takes the proposal')
  assert.equal(r.a3Estado.reserva[0], 'Bongio')
  assert.equal(r.b[1], propone('Sabrina'), '"no sé cuál ... que no sea Melina": anybody, as soon as possible, but her')
  assert.deepEqual([r.bEstado.asap, r.bEstado.cualquiera, r.bEstado.excluidos], [true, true, ['perfil-melina']])
  assert.equal(r.c[1], 'La primera disponibilidad es mañana miércoles 7 a las 09:00 con Melina. ¿Querés esa?', '"alguien lo antes posible" proposes the first real start; it does not ask who')
  assert.deepEqual([r.cEstado.asap, r.cEstado.cualquiera, r.cEstado.propuesta], [true, true, ['Melina', '2026-10-07T12:00:00.000Z']])
  assert.equal(r.consultas, true, 'every option came from the calendar, for the same service')
})

test('RESTRICCIONES negaciones: "que no sea X", "menos X", "cualquiera excepto X", "no X", "otro", "no quiero a ese", "alguno diferente", "menos la segunda", "cualquiera menos ella" — resolved against the state, never against the text of a previous reply', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const { detectarRestriccionProfesional: d, sinInsultos, pideDetener, cuentaTrivial, detectarCambioDeHorario, pideOtrasOpciones, pideEmpezarDeNuevo, expresaFrustracion, esPreguntaSuelta } = await import('./apps/api/src/tus/asistente/restricciones.ts')
    const out = {}
    out.lectura = Object.fromEntries(['que no sea Juan', 'menos Juan', 'cualquiera excepto Juan', 'no Melina', 'no me gusta Sabrina', 'el primero que haya pero no Melina', 'otro', 'otra persona', 'otro profesional', 'alguno diferente', 'buscame otro', 'buscame alguien distinto', 'no quiero a ese', 'cualquiera menos ella', 'cualquiera menos la segunda', 'que no sea la segunda', 'No quiero a Melina, buscame otra'].map((t) => [t, d(t)]))
    out.noSon = ['no, con Melina', 'no sé', 'no importa', 'otro día', 'otra hora', 'la otra', 'mejor el martes', 'Juan Pérez, 12345678', 'necesito un plomero', 'sin seña', 'con Melina'].map((t) => d(t))
    out.detener = ['basta', 'dejá', 'cancelar', 'no quiero seguir', 'olvidate', 'chau', 'dejalo', 'Dejalo, gracias', 'bueno dejalo así'].map(pideDetener)
    out.noDetener = ['quiero cancelar mi turno del lunes', 'no', 'Juan Pérez 12345678', 'no importa', 'dejame el de las 9', 'cancelar el pago de la seña del turno que pedí ayer'].map(pideDetener)
    out.cuentas = ['Cuánto es 2 + 2', '2+2', 'cuánto es 7 por 8?', 'cuanto es 10 dividido 4', 'cuanto es 9 menos 12', 'cuanto sale', 'cuanto es 5 / 0', 'cuánto es la seña', 'cuanto es 99999999999 + 1'].map(cuentaTrivial)
    out.horario = ['cambiame el horario', 'más tarde', 'mas temprano', 'otro día', 'otra hora', 'otra persona'].map(detectarCambioDeHorario)
    out.varios = [pideOtrasOpciones('qué otros hay'), pideOtrasOpciones('quiénes más?'), pideOtrasOpciones('otro día'), pideEmpezarDeNuevo('empezar de nuevo'), pideEmpezarDeNuevo('arranquemos de cero'), pideEmpezarDeNuevo('quiero un turno nuevo')]
    out.frustracion = ['te dije que no', 'otra vez lo mismo', 'no entendés', 'ya te dije', 'me estás ofreciendo la misma persona', 'sos un inútil', 'hola', 'quiero un masaje'].map(expresaFrustracion)
    out.suelta = ['quién ganó el partido?', 'como te llamas', 'Juan Pérez, 12345678', 'mi dni es 30111222', 'Juan Pérez'].map(esPreguntaSuelta)
    out.limpio = sinInsultos('Que no sea Melina la concha puta de tu madre')

    // Against the state: a list shown for Wednesday, nobody chosen.
    const W = '5493794700010'
    out.segunda = await charlar(W, ['necesito un masaje el miércoles', 'cualquiera menos la segunda'])
    out.segundaEstado = await estado(W)
    out.ella = await charlar(W, ['que no sea ella'])
    out.ellaEstado = await estado(W)
    out.insiste = await charlar(W, ['te dije que no'])
    out.insisteEstado = await estado(W)
    // A name that is not one of the professionals excludes nobody: the message goes on as before.
    const X = '5493794700011'
    out.desconocido = await charlar(X, ['necesito un masaje el miércoles', 'que no sea Roberto'])
    out.desconocidoEstado = await estado(X)
    // Excluding one and choosing another in the same breath.
    const Y = '5493794700012'
    out.elige = await charlar(Y, ['necesito un masaje el miércoles', 'no quiero a Melina, mejor Sabrina'])
    out.eligeEstado = await estado(Y)
    console.log(JSON.stringify(out))
  `)
  const nombre = (texto) => r.lectura[texto]
  for (const texto of ['que no sea Juan', 'menos Juan', 'cualquiera excepto Juan']) assert.deepEqual(nombre(texto), { otro: false, actual: false, posiciones: [], nombres: ['juan'] }, texto)
  for (const texto of ['no Melina', 'el primero que haya pero no Melina']) assert.deepEqual(nombre(texto).nombres, ['melina'], texto)
  assert.deepEqual(nombre('no me gusta Sabrina').nombres, ['sabrina'])
  for (const texto of ['otro', 'otra persona', 'otro profesional', 'alguno diferente', 'buscame alguien distinto']) assert.equal(nombre(texto).otro, true, texto)
  for (const texto of ['no quiero a ese', 'cualquiera menos ella']) assert.equal(nombre(texto).actual, true, texto)
  for (const texto of ['cualquiera menos la segunda', 'que no sea la segunda']) assert.deepEqual(nombre(texto).posiciones, [1], texto)
  assert.deepEqual(nombre('No quiero a Melina, buscame otra'), { otro: true, actual: false, posiciones: [], nombres: ['melina'] }, 'two restrictions in one message')
  assert.deepEqual(r.noSon, r.noSon.map(() => null), 'an answer, a day, a time, a name and document are not exclusions ("no, con Melina" CHOOSES her)')
  assert.ok(r.detener.every(Boolean), JSON.stringify(r.detener))
  assert.ok(r.noDetener.every((valor) => valor === false), JSON.stringify(r.noDetener))
  assert.deepEqual(r.cuentas, ['4', '4', '56', '2,50', '-3', null, null, null, null], 'whole numbers, one operation, bounded; a price question is not a sum')
  assert.deepEqual(r.horario, ['otro_horario', 'mas_tarde', 'mas_temprano', 'otro_dia', 'otro_horario', null])
  assert.deepEqual(r.varios, [true, true, false, true, true, false])
  assert.deepEqual(r.frustracion, [true, true, true, true, true, true, false, false])
  assert.deepEqual(r.suelta, [true, true, false, false, false])
  assert.equal(r.limpio, 'que no sea melina')

  assert.equal(r.segunda[1], propone('Melina', '09:00'), 'the second of the list (Sabrina) is excluded; the first turno of the others is Melina at 09:00')
  assert.deepEqual([r.segundaEstado.excluidos, r.segundaEstado.dia], [['perfil-sabrina'], '2026-10-07'], 'optionsShown[1] resolved by the backend; the day asked for is kept')
  assert.equal(r.ella[0], propone('Bongio'), '"ella" is the professional just proposed')
  assert.deepEqual(r.ellaEstado.excluidos, ['perfil-sabrina', 'perfil-melina'])
  assert.equal(r.insiste[0], 'No encontré a otra persona de Masaje con turnos libres, además de Sabrina, Melina y Bongio. ¿Querés que busque otro día?', '"te dije que no" refuses the proposal on the table; with nobody left that is said, not the same reply again')
  assert.notEqual(r.insiste[0], r.ella[0])
  assert.equal(r.insisteEstado.servicio, 'masaje')
  assert.deepEqual(r.desconocidoEstado.excluidos, [], 'words that name nobody listed exclude nobody')
  assert.doesNotMatch(r.desconocido[1], /^Entendido, busco otra persona/u)
  assert.deepEqual([r.eligeEstado.excluidos, r.eligeEstado.profesional], [['perfil-melina'], 'perfil-sabrina'], 'the one named after the exclusion is the one chosen')
  assert.match(r.elige[1], /Sabrina/u)
  assert.doesNotMatch(r.elige[1], /Melina/u)
})

test('RESTRICCIONES lenguaje brusco y cambio durante la identidad: the insult is ignored, the intention is not; the identity step is interrupted, the service is kept, the professional and her time are dropped', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const W = '5493794700020'
    out.hasta = await charlar(W, ['necesito un masaje el miércoles', 'Melina a las 9'])
    out.antes = await estado(W)
    out.brusco = await charlar(W, ['Que no sea Melina la concha puta de tu madre'])
    out.despues = await estado(W)
    const conversacionW = await conversationOf(W)
    out.intentos = await waTx.ejecutar((repos) => repos.auditoria.contarDesde({ action: 'assistant.identity_failed', conversationId: conversacionW.conversationId, since: new Date(0).toISOString() }))
    const X = '5493794700021'
    await charlar(X, ['necesito un masaje el miércoles', 'Melina a las 9'])
    out.cambio = await charlar(X, ['No quiero a Melina, buscame otra'])
    out.cambioEstado = await estado(X)
    out.acepta = await charlar(X, ['dale'])
    out.aceptaEstado = await estado(X)
    // The exclusion belongs to THIS request: a new service starts without it.
    out.otroServicio = await charlar(X, ['necesito un plomero para el jueves'])
    out.otroEstado = await estado(X)
    const todo = fakeWa.sent.map((item) => item.message.text ?? '').join('\\n').toLowerCase()
    out.eco = ['concha', 'puta', 'madre', 'insult', 'respeto', 'lenguaje'].filter((palabra) => todo.includes(palabra))
    out.reservas = dom.reservas.length
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.hasta[1], PIDE_DATOS_MELINA)
  assert.deepEqual(r.antes.reserva, ['Melina', 'identity', '2026-10-07T12:00:00.000Z'])
  assert.equal(r.brusco[0], propone('Sabrina'), 'a neutral answer and the search, as if it had been asked politely')
  assert.doesNotMatch(r.brusco[0], NO_ES_IDENTIDAD, 'the message is not read as a name and document')
  assert.deepEqual([r.despues.servicio, r.despues.dia, r.despues.reserva, r.despues.excluidos, r.despues.profesional], ['masaje', '2026-10-07', null, ['perfil-melina'], null], 'service and day kept; professional and time dropped; Melina excluded')
  assert.equal(r.intentos, 0, 'no failed identification was counted')
  assert.deepEqual(r.eco, [], 'the insult is never repeated, answered or lectured about')
  assert.equal(r.cambio[0], propone('Sabrina'))
  assert.deepEqual([r.cambioEstado.reserva, r.cambioEstado.propuesta], [null, ['Sabrina', '2026-10-07T12:45:00.000Z']])
  assert.match(r.acepta[0], /^Perfecto: Sabrina, mañana miércoles 7 a las 09:45\.\nEl servicio cuesta \$200 y la seña es de \$100\.\nPara registrar la solicitud necesito tu nombre completo y DNI\.$/u, 'the request goes on with the other professional, from the price on: nothing was restarted')
  assert.deepEqual(r.aceptaEstado.reserva, ['Sabrina', 'identity', '2026-10-07T12:45:00.000Z'])
  assert.deepEqual([r.otroEstado.servicio, r.otroEstado.excluidos], ['plomeria', []], 'another request: no exclusion is carried over')
  assert.match(r.otroServicio[0], /Juan Pérez/u)
  assert.equal(r.reservas, 0, 'nothing was requested for anybody along the way')
})

test('RESTRICCIONES interrupciones mientras espera la identidad: a trivial sum, a question that is not about TUS, another time, the other professionals, the price, "dejalo" and "empezar de nuevo" are never an attempt to identify', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const nueva = async (waId) => { await charlar(waId, ['necesito un masaje el miércoles', 'Melina a las 9']); return waId }
    const fallidas = async (waId) => { const conversacion = await conversationOf(waId); return waTx.ejecutar((repos) => repos.auditoria.contarDesde({ action: 'assistant.identity_failed', conversationId: conversacion.conversationId, since: new Date(0).toISOString() })) }
    const A = await nueva('5493794700030')
    out.suma = await charlar(A, ['Cuánto es 2 + 2'])
    out.sumaEstado = await estado(A)
    out.ajena = await charlar(A, ['quién ganó el mundial?'])
    out.ajenaEstado = await estado(A)
    out.precio = await charlar(A, ['cuánto sale'])
    out.precioEstado = await estado(A)
    out.dejalo = await charlar(A, ['dejalo'])
    out.dejaloEstado = await estado(A)
    out.fallidasA = await fallidas(A)
    out.despues = await charlar(A, ['hola'])
    const B = await nueva('5493794700031')
    out.horario = await charlar(B, ['cambiame el horario', '9:30'])
    out.horarioEstado = await estado(B)
    out.tarde = await charlar(B, ['más tarde'])
    out.tardeEstado = await estado(B)
    out.otros = await charlar(B, ['qué otros hay'])
    out.otrosEstado = await estado(B)
    out.fallidasB = await fallidas(B)
    const C = await nueva('5493794700032')
    out.acumula = await charlar(C, ['Quiero otra persona, mañana después de las 9:30 y que sea lo antes posible'])
    out.acumulaEstado = await estado(C)
    out.ultimaConsulta = dom.consultas.at(-1)
    out.denuevo = await charlar(C, ['empezar de nuevo'])
    out.denuevoEstado = await estado(C)
    for (const frase of ['basta', 'olvidate', 'no quiero seguir', 'cancelar', 'chau']) {
      const D = await nueva('54937947001' + String(40 + Object.keys(out.frases ?? {}).length))
      out.frases = { ...(out.frases ?? {}), [frase]: [(await charlar(D, [frase]))[0], (await estado(D)).reserva] }
    }
    // With nothing under way, "chau" and "dejalo" are just messages.
    out.sinFlujo = (await charlar('5493794700050', ['chau']))[0]
    // The real data still identifies: the step itself is untouched.
    const E = await nueva('5493794700051')
    out.datos = (await charlar(E, ['Juan Pérez, 12345678']))[0].split('. ')[0]
    out.reservas = dom.reservas.length
    console.log(JSON.stringify(out))
  `)
  const SIGUE = 'Seguíamos con tu turno de Masaje con Melina, mañana miércoles 7 a las 09:00. Para registrar la solicitud necesito identificar tu cuenta: decime tu nombre completo y DNI.'
  assert.equal(r.suma[0], `4.\n\n${SIGUE}`, 'a short answer, and what the conversation was doing')
  assert.deepEqual(r.sumaEstado.reserva, ['Melina', 'identity', '2026-10-07T12:00:00.000Z'], 'the turno is still waiting')
  assert.equal(r.ajena[0], `Eso no te lo puedo responder: soy el asistente de TUS y te ayudo con servicios, turnos, pagos y tu cuenta.\n\n${SIGUE}`)
  assert.equal(r.precio[0], `Masaje con Melina: $200.\n\n${SIGUE}`, 'the real price, and the flow is still there')
  assert.deepEqual(r.precioEstado.reserva, ['Melina', 'identity', '2026-10-07T12:00:00.000Z'])
  assert.equal(r.dejalo[0], 'Listo, lo dejamos acá: no se envió ninguna solicitud. Cuando quieras, escribime y lo retomamos.')
  assert.deepEqual([r.dejaloEstado.reserva, r.dejaloEstado.servicio, r.dejaloEstado.propuesta], [null, null, null], 'the request is dropped')
  assert.equal(r.fallidasA, 0, 'none of those messages was read as a failed identification')
  assert.match(r.despues[0], /^¡Hola! Soy el asistente de TUS/u, 'the conversation starts clean afterwards')
  for (const texto of [...r.suma, ...r.ajena, ...r.precio, ...r.dejalo]) assert.doesNotMatch(texto, /No pude validar esos datos|Me falta tu nombre|Sigo necesitando/u)

  assert.equal(r.horario[0], '¿A qué hora con Melina? Tiene: 09:00, 09:15, 09:30, 09:45.', 'same professional and day: her real times')
  assert.match(r.horario[1], /^Perfecto: Melina, mañana miércoles 7 a las 09:30\./u)
  assert.deepEqual(r.horarioEstado.reserva, ['Melina', 'identity', '2026-10-07T12:30:00.000Z'], 'only the time changed')
  assert.equal(r.tarde[0], 'La primera disponibilidad es mañana miércoles 7 a las 09:45 con Melina. ¿Querés esa?', '"más tarde": her next real start after the one chosen')
  assert.deepEqual(r.tardeEstado.propuesta, ['Melina', '2026-10-07T12:45:00.000Z'])
  assert.equal(r.otros[0], `Encontré 3 profesionales de Masaje con turno mañana miércoles 7:\n${LISTA}\nDecime con quién y a qué hora y te preparo la solicitud.`, '"¿qué otros hay?": the professionals of the service again, nobody excluded')
  assert.deepEqual([r.otrosEstado.servicio, r.otrosEstado.dia, r.otrosEstado.profesional, r.otrosEstado.excluidos], ['masaje', '2026-10-07', null, []])
  assert.equal(r.fallidasB, 0)

  assert.equal(r.acumula[0], propone('Sabrina'), 'three restrictions at once: not Melina, tomorrow from 09:30, the first one')
  assert.deepEqual([r.acumulaEstado.excluidos, r.acumulaEstado.dia, r.acumulaEstado.asap, r.acumulaEstado.cualquiera], [['perfil-melina'], '2026-10-07', true, true])
  assert.deepEqual([r.ultimaConsulta.profession, r.ultimaConsulta.day, r.ultimaConsulta.time], ['masaje', '2026-10-07', { kind: 'from', from: '09:30', to: null }], 'the backend searched with the day and the time of the message')
  assert.equal(r.denuevo[0], 'Dale, empezamos de nuevo. ¿Qué servicio necesitás?')
  assert.deepEqual([r.denuevoEstado.servicio, r.denuevoEstado.excluidos, r.denuevoEstado.propuesta], [null, [], null])
  for (const [frase, [respuesta, reserva]] of Object.entries(r.frases)) {
    assert.match(respuesta, /^Listo, lo dejamos acá/u, frase)
    assert.equal(reserva, null, frase)
  }
  assert.doesNotMatch(r.sinFlujo, /^Listo, lo dejamos acá/u, 'nothing to drop when nothing is under way')
  assert.equal(r.datos, 'No pude validar esos datos con una cuenta TUS', 'a name and a document are still read as the identity')
  assert.equal(r.reservas, 0)
})

test('RESTRICCIONES búsqueda: the excluded professionals are filtered where the calendar is read, so every search of the request respects them — a list, the first turno, the days', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const W = '5493794700060'
    await charlar(W, ['necesito un masaje lo antes posible', 'que no sea Melina'])
    out.lista = (await charlar(W, ['qué otros hay']))[0]
    out.estado = await estado(W)
    out.dias = (await charlar(W, ['qué días hay?']))[0]
    // Choosing her by name afterwards takes her out of the exclusions: the last thing said wins.
    out.vuelve = (await charlar(W, ['bueno, con Melina a las 9']))[0]
    out.vuelveEstado = await estado(W)
    const { combinarNecesidad } = await import('./apps/api/src/tus/asistente/necesidad.ts')
    const base = combinarNecesidad(null, { profession: 'masaje', excludedProviderIds: ['a', 'b'] })
    out.combinar = [
      combinarNecesidad(base, { day: '2026-10-07' }).excludedProviderIds,
      combinarNecesidad(base, { excludedProviderIds: ['b', 'c'] }).excludedProviderIds,
      combinarNecesidad(base, { providerId: 'a', providerName: 'A' }).excludedProviderIds,
      combinarNecesidad(base, { profession: 'plomeria' }).excludedProviderIds ?? [],
    ]
    console.log(JSON.stringify(out))
  `)
  assert.doesNotMatch(r.lista, /Melina/u, 'a listing asked afterwards does not bring her back')
  assert.match(r.lista, /Sabrina/u)
  assert.match(r.lista, /Bongio/u)
  assert.deepEqual(r.estado.excluidos, ['perfil-melina'])
  assert.doesNotMatch(r.dias, /Melina/u)
  assert.match(r.vuelve, /^Perfecto: Melina, mañana miércoles 7 a las 09:00\./u, 'she can still be chosen explicitly')
  assert.deepEqual(r.vuelveEstado.excluidos, [])
  assert.deepEqual(r.combinar, [['a', 'b'], ['a', 'b', 'c'], ['b'], []], 'kept across changes of day, accumulated, lifted by an explicit choice, cleared by another service')
  const orquestador = readFileSync(join(root, 'apps/api/src/tus/asistente/orquestador.ts'), 'utf8')
  assert.match(orquestador, /const cambio = await this\.cambioDeRestricciones\(turn, actor, text, correlationId\)\s+if \(cambio\) return \[\.\.\.avisos, \.\.\.cambio\]\s[\s\S]{0,500}this\.pasoDeSolicitud\(/u, 'the constraint router runs BEFORE the identity step')
  assert.match(orquestador, /excluded: true, note: 'El usuario pidió que NO sea este profesional/u, 'a tool the model calls never shows an excluded professional')
})
