import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { MULTIMODAL_SETUP } from './fixtures/whatsapp-multimodal.mjs'

// TUS-WHATSAPP-MULTIMODAL-01: voice notes, receipts and "ya pagué" in the WhatsApp assistant.
//
//   THE AI INTERPRETS. THE BACKEND DECIDES. MERCADO PAGO CERTIFIES THE MONEY.
//
// Real orchestrator, ingress, media rules and confirmations; the real speech-to-text adapter is
// replaced by a double at its port and the domain by a fake with a known agenda and deposits whose
// payment state is set ONLY by the test (the backend's answer). Nothing in a conversation may
// create a "confirmed" payment: every confirmation here comes from the domain double.
//
// Clock of the fixture: Friday 2026-09-25, 09:00 in Argentina. "mañana" is Saturday 26.

const SETUP = MULTIMODAL_SETUP

test('voice notes: the transcript enters the SAME conversation as typed text (search, context, asap, any, professional, time); corrupt, large, wrong, slow or failing audio is answered naturally without inventing; duplicates and floods are bounded', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    // PARITY: what is said and what is typed give the same reply and the same real availability search.
    async function paridad(nombre, pasos) {
      const conT = []
      const conV = []
      const idT = '549115560' + (1000 + Object.keys(out).length * 2)
      const idV = '549115560' + (1001 + Object.keys(out).length * 2)
      const instante = waNow
      const antesT = dom.consultas.length
      for (const frase of pasos.escrito) conT.push(...(await turno(idT, frase)).textos)
      const consultasT = JSON.stringify(dom.consultas.slice(antesT))
      waNow = instante
      const antesV = dom.consultas.length
      for (const [indice, frase] of pasos.hablado.entries()) conV.push(...(pasos.voz[indice] ? (await voz(idV, frase)).textos : (await turno(idV, frase)).textos))
      const consultasV = JSON.stringify(dom.consultas.slice(antesV))
      out[nombre] = { mismaRespuesta: JSON.stringify(conT) === JSON.stringify(conV), mismaBusqueda: consultasT === consultasV, hayRespuesta: conV.length > 0, hayBusqueda: consultasV !== '[]', respuesta: conV.join(' | ') }
    }
    await paridad('cualquiera', { escrito: ['Quiero un masaje mañana a la tarde con cualquiera'], hablado: ['Quiero un masaje mañana a la tarde con cualquiera'], voz: [true] })
    await paridad('contexto', { escrito: ['Quiero masaje', 'Con Melina mañana a la tarde'], hablado: ['Quiero masaje', 'Con Melina mañana a la tarde'], voz: [false, true] })
    await paridad('antesPosible', { escrito: ['Quiero un masaje', 'lo antes posible'], hablado: ['Quiero un masaje', 'lo antes posible'], voz: [false, true] })
    await paridad('horario', { escrito: ['Quiero un masaje mañana después de las seis con cualquiera'], hablado: ['Quiero un masaje mañana después de las seis con cualquiera'], voz: [true] })
    await paridad('profesional', { escrito: ['Quiero un masaje con Sabrina mañana'], hablado: ['Quiero un masaje con Sabrina mañana'], voz: [true] })
    // The content of the first typed need is kept through a voice reply: it never asks for the service again.
    out.sinReprompt = !/qu[eé] servicio|qu[eé] necesit/iu.test(out.contexto.respuesta)
    out.melina = /Melina/u.test(out.contexto.respuesta)

    // The transcript is stored as the message text (what was said), the audio is not stored.
    const waG = '54911556009001'
    const audios = (await voz(waG, 'Quiero un masaje mañana a la tarde')).textos
    const mensajes = await mensajesDe(waG)
    const audio = mensajes.find((m) => m.type === 'audio')
    out.guardado = { texto: audio.text, transcribed: audio.metadata.transcribed, stt: audio.metadata.stt?.status, sinBytes: !JSON.stringify(audio).includes('OpusHead') && !JSON.stringify(audio).includes('base64'), media: Object.keys(audio.metadata.media).sort() }

    // FAILURES: the person is asked to repeat or write; the STT provider is never called with junk.
    const NATURAL = 'No pude entender bien ese audio. ¿Podés mandármelo otra vez o escribirme el mensaje?'
    const llamadasAntes = stt.llamadas.length
    const corrupto = await voz('54911556009002', 'x', { bytes: Buffer.from('esto no es un audio, es texto plano de relleno'), mimeType: 'audio/ogg' })
    const grande = await voz('54911556009003', 'x', { bytes: Buffer.concat([oggOpus(3), Buffer.alloc(8000, 7)]) })
    const amr = await voz('54911556009004', 'x', { bytes: Buffer.concat([Buffer.from('#!AMR' + String.fromCharCode(10)), Buffer.alloc(200, 3)]), mimeType: 'audio/amr', mimeDeclarado: 'audio/amr' })
    const imagenComoAudio = await voz('54911556009005', 'x', { bytes: Buffer.from('imagen'), mimeType: 'image/png', mimeDeclarado: 'image/png' })
    const largo = await voz('54911556009006', 'x', { segundos: 400 })
    const llamadasJunk = stt.llamadas.length - llamadasAntes
    const sinVoz = (stt.proxima = { text: 'mmm', confianza: 'sin_voz' }, await turno('54911556009007', '', cuerpoAudio(nuevoMedia('audio/ogg', oggOpus(2)))))
    const baja = (stt.proxima = { text: 'quiero un coso', confianza: 'baja' }, await turno('54911556009008', '', cuerpoAudio(nuevoMedia('audio/ogg', oggOpus(2)))))
    out.fallosSinProveedor = { llamadas: llamadasJunk, corrupto: corrupto.textos, grande: grande.textos, amr: amr.textos, imagen: imagenComoAudio.textos, largo: largo.textos }
    out.sinVoz = sinVoz.textos
    out.baja = baja.textos
    const caido = await voz('54911556009009', new Error('groq down'))
    const colgado = await voz('54911556009010', 'colgar')
    out.proveedor = { caido: caido.textos, colgado: colgado.textos }
    out.motivos = metrics.filter((m) => m.name === 'assistant.audio_failed').map((m) => m.reason)
    out.natural = NATURAL

    // Without confidence data the transcript is used as said (nothing invented); a plain string works.
    const plano = await voz('54911556009011', 'Quiero un masaje mañana a la tarde con cualquiera')
    out.sinConfianza = plano.textos.length > 0 && !plano.textos.includes(NATURAL)

    // The same WhatsApp message delivered twice is processed once.
    const waD = '54911556009012'
    stt.proxima = 'Quiero un masaje mañana a la tarde'
    const idD = nuevoMedia('audio/ogg', oggOpus(2))
    const antesD = stt.llamadas.length
    const primera = await turno(waD, '', { ...cuerpoAudio(idD), wamid: 'wamid.mismo-audio' })
    const segunda = await turno(waD, '', { ...cuerpoAudio(idD), wamid: 'wamid.mismo-audio' })
    out.duplicado = { llamadas: stt.llamadas.length - antesD, primera: primera.resultado.accepted, segunda: segunda.resultado.duplicates, respuestasSegunda: segunda.textos.length }

    // A flood of media is bounded (WHATSAPP_MEDIA_MAX_PER_HOUR=6) before it costs STT calls.
    const waF = '54911556009013'
    const antesF = stt.llamadas.length
    let limitados = 0
    for (let i = 0; i < 9; i += 1) { stt.proxima = 'Hola'; const respuesta = await turno(waF, '', cuerpoAudio(nuevoMedia('audio/ogg', oggOpus(1))), 1000); limitados += respuesta.resultado.rateLimited }
    out.inundacion = { llamadas: stt.llamadas.length - antesF, limitados }
    console.log(JSON.stringify(out))
  `)
  for (const nombre of ['cualquiera', 'contexto', 'antesPosible', 'horario', 'profesional']) {
    assert.equal(r[nombre].mismaRespuesta, true, nombre + ': the voice reply is the typed reply')
    assert.equal(r[nombre].mismaBusqueda, true, nombre + ': the same REAL availability search')
    assert.equal(r[nombre].hayRespuesta, true, nombre)
  }
  assert.equal(r.cualquiera.hayBusqueda, true, 'a voice note asks the real availability, like text')
  assert.equal(r.sinReprompt, true, 'the previous service is kept: it is not asked again')
  assert.equal(r.melina, true)
  assert.deepEqual(r.guardado, { texto: 'Quiero un masaje mañana a la tarde', transcribed: true, stt: 'ok', sinBytes: true, media: ['id', 'mimeType', 'sha256'] })
  assert.equal(r.fallosSinProveedor.llamadas, 0, 'corrupt, large, wrong-type and long audios never reach the STT provider')
  for (const caso of ['corrupto', 'grande', 'amr', 'imagen', 'largo']) assert.deepEqual(r.fallosSinProveedor[caso], [r.natural], caso)
  assert.deepEqual(r.sinVoz, [r.natural])
  assert.deepEqual(r.baja, [r.natural])
  assert.deepEqual(r.proveedor, { caido: [r.natural], colgado: [r.natural] })
  assert.deepEqual([...r.motivos].sort(), ['CORRUPT', 'DOWNLOAD_FAILED', 'DOWNLOAD_FAILED', 'LOW_CONFIDENCE_baja', 'LOW_CONFIDENCE_sin_voz', 'MIME_NOT_ALLOWED', 'STT_TIMEOUT', 'STT_UNAVAILABLE', 'TOO_LONG'])
  assert.equal(r.sinConfianza, true)
  assert.deepEqual(r.duplicado, { llamadas: 1, primera: 1, segunda: 1, respuestasSegunda: 0 })
  assert.deepEqual(r.inundacion, { llamadas: 6, limitados: 3 })
})

test('"ya pagué" and receipts: the backend asks Mercado Pago and words what it found; an image, a PDF, a voice note or a sentence never confirms a payment; no correlation, two deposits, pacing and unknown clients are handled safely', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const MELINA = { ref: 'res-mel', providerName: 'Melina', service: 'Masaje', startsAt: iso('2026-09-26', '17:00'), amount: 15000, estado: 'pending' }
    const SABRINA = { ref: 'res-sab', providerName: 'Sabrina', service: 'Masaje', startsAt: iso('2026-09-27', '16:00'), amount: 15000, estado: 'pending' }
    const CONFIRMADA = { estado: 'confirmed', appliedNow: true, turnoConfirmado: true, amount: 15000 }
    let numero = 0
    const nuevo = async () => { numero += 1; const waId = '54911556100' + String(numero).padStart(2, '0'); await vincular(waId); return waId }
    const verifs = () => dom.verificaciones.length
    const todas = []
    const registrar = (texto) => { todas.push(...texto); return texto }

    // a) approved by Mercado Pago (the backend's answer): confirmed, in the person's words.
    dom.senas.set('customer-user', [MELINA]); dom.resultados.set('res-mel', CONFIRMADA)
    let waId = await nuevo(); let antes = verifs()
    out.aprobado = { textos: (await turno(waId, 'ya pagué')).textos.slice(-1), consultas: dom.verificaciones.slice(antes) }
    // b) pending, c) not found, d) rejected, e) quarantined (the amount did not match), f) provider unavailable.
    const respuestaCon = async (resultado, frase = 'ya pagué', extra) => { dom.resultados.set('res-mel', resultado); const id = await nuevo(); return registrar((await turno(id, frase, extra)).textos).slice(-1)[0] }
    out.pendiente = await respuestaCon({ estado: 'pending' })
    out.noEncontrado = await respuestaCon({ estado: 'not_found' })
    out.rechazado = await respuestaCon({ estado: 'not_approved' })
    out.cuarentena = await respuestaCon({ estado: 'quarantined' })
    dom.lanzar.add('res-mel'); out.caido = await respuestaCon({ estado: 'confirmed' }); dom.lanzar.delete('res-mel')

    // g) a receipt IMAGE with a claim ("$15.000 APPROVED") while Mercado Pago has no such payment:
    // nothing is confirmed, the picture is never downloaded, the person is not accused.
    dom.resultados.set('res-mel', { estado: 'not_found' })
    waId = await nuevo(); antes = verifs(); const descargasAntes = descargas.length
    const falso = await turno(waId, '', cuerpoImagen('Pagué $15.000 APROBADO'))
    out.comprobanteFalso = { textos: falso.textos, consultas: verifs() - antes, descargas: descargas.length - descargasAntes }
    registrar(falso.textos)
    // h) a PDF receipt without words, and a receipt image without words, with a deposit pending: asked the same way.
    waId = await nuevo(); antes = verifs()
    const pdf = await turno(waId, '', cuerpoDocumento(), 1000)
    const imagenSola = await turno(waId, '', cuerpoImagen(), 20000)
    out.sinPalabras = { pdf: pdf.textos, imagen: imagenSola.textos, consultas: verifs() - antes, descargas: descargas.length - descargasAntes }
    registrar(pdf.textos); registrar(imagenSola.textos)
    // i) the receipt of a payment that Mercado Pago DOES confirm: only then it is confirmed (by the backend).
    dom.resultados.set('res-mel', CONFIRMADA); waId = await nuevo()
    out.comprobanteValido = (await turno(waId, '', cuerpoImagen('Ya pagué'))).textos.slice(-1)

    // j) no deposit at all: a receipt cannot be related; a plain photo keeps its old answer.
    dom.senas.set('customer-user', []); waId = await nuevo(); antes = verifs()
    out.sinPago = { comprobante: (await turno(waId, '', cuerpoImagen('adjunto el comprobante'))).textos, foto: (await turno(waId, '', cuerpoImagen())).textos, texto: (await turno(waId, 'ya pagué')).textos, consultas: verifs() - antes }
    // k) a deposit already acknowledged: no new question to Mercado Pago.
    dom.senas.set('customer-user', [{ ...MELINA, estado: 'paid' }]); waId = await nuevo(); antes = verifs()
    out.yaAcreditada = { textos: (await turno(waId, 'ya pagué')).textos, consultas: verifs() - antes }

    // l) two pending deposits: asked, never guessed; the answer names one and only that one is asked.
    dom.senas.set('customer-user', [MELINA, SABRINA]); dom.resultados.set('res-mel', CONFIRMADA); dom.resultados.set('res-sab', { estado: 'pending' })
    waId = await nuevo(); antes = verifs()
    const pregunta = await turno(waId, 'ya pagué')
    const sinElegir = verifs() - antes
    const eleccion = await turno(waId, 'la de Sabrina')
    out.dos = { pregunta: pregunta.textos, consultasAntesDeElegir: sinElegir, respuesta: eleccion.textos, consultas: dom.verificaciones.slice(antes) }
    registrar(pregunta.textos)

    // m) somebody else's operation number in the message: only the person's own deposits are ever asked.
    dom.senas.set('customer-user', [MELINA]); dom.resultados.set('res-mel', { estado: 'not_found' }); waId = await nuevo(); antes = verifs()
    const ajeno = await turno(waId, 'ya pagué, operación 123456789 de otra persona')
    out.idAjeno = { textos: ajeno.textos, consultas: dom.verificaciones.slice(antes) }
    registrar(ajeno.textos)

    // n) a voice note saying it: same flow, same answer.
    waId = await nuevo(); antes = verifs(); dom.resultados.set('res-mel', CONFIRMADA)
    out.voz = { textos: (await voz(waId, 'Ya pagué la seña')).textos.slice(-1), consultas: verifs() - antes }

    // o) pacing: a second question 1 second later is not sent to Mercado Pago; six an hour at most.
    dom.resultados.set('res-mel', { estado: 'pending' }); waId = await nuevo(); antes = verifs()
    const primera = await turno(waId, 'ya pagué', undefined, 1000)
    const apurada = await turno(waId, 'ya pagué', undefined, 20000)
    const ritmo = [primera.textos, apurada.textos]
    for (let i = 0; i < 5; i += 1) await turno(waId, 'ya pagué')
    const septima = await turno(waId, 'ya pagué')
    out.ritmo = { apurada: apurada.textos, septima: septima.textos, consultas: verifs() - antes }

    // p) a person nobody knows: asked for name and ID first; the backend identifies, then asks Mercado Pago.
    dom.resultados.set('res-mel', CONFIRMADA)
    const desconocido = '54911556199'.concat('01')
    await turno(desconocido, 'hola'); antes = verifs()
    const pide = await turno(desconocido, 'ya pagué')
    const sinCuenta = verifs() - antes
    const identificado = await turno(desconocido, 'Juan Ignacio Mumbach, 12345678')
    out.desconocido = { pide: pide.textos, consultasSinCuenta: sinCuenta, identificado: identificado.textos, consultas: dom.verificaciones.slice(antes) }

    // r) the same receipt message delivered twice (same wamid) is processed once; the same picture sent again later is just another question.
    dom.senas.set('customer-user', [MELINA]); dom.resultados.set('res-mel', { estado: 'pending' }); waId = await nuevo(); antes = verifs()
    const cuerpoRepetido = cuerpoImagen('ya pagué')
    const una = await turno(waId, '', { ...cuerpoRepetido, wamid: 'wamid.recibo-repetido' }, 1000)
    const dos = await turno(waId, '', { ...cuerpoRepetido, wamid: 'wamid.recibo-repetido' })
    const tres = await turno(waId, '', cuerpoRepetido)
    out.imagenDuplicada = { una: una.textos.length, mismoWamid: [dos.resultado.duplicates, dos.textos.length], nuevoWamid: tres.textos, consultas: verifs() - antes }
    registrar(una.textos); registrar(tres.textos)

    // s) questions about receipts or about PAYING a deposit are not "I paid": nothing is asked to Mercado Pago.
    dom.senas.set('customer-user', [{ ...MELINA, estado: 'pending' }]); waId = await nuevo(); antes = verifs()
    await turno(waId, '¿Dan comprobante cuando pago?')
    const link = await turno(waId, 'quiero pagar la seña')
    out.noEsPagoRealizado = { consultas: verifs() - antes, link: link.textos.length }

    // q) whatever the domain said that was NOT a confirmation, no reply claims one.
    out.afirmaConfirmacion = todas.filter((texto) => /confirm[oó] tu se[ñn]a|qued[oó] confirmado|ya figura acreditada/iu.test(texto))
    out.consultasTotales = dom.verificaciones.every(([cuenta]) => cuenta === 'customer-user')
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.aprobado, { textos: ['Sí, Mercado Pago confirmó tu seña de $15.000. Tu turno con Melina quedó confirmado.'], consultas: [['customer-user', 'res-mel']] })
  assert.equal(r.pendiente, 'Encontré el pago correspondiente, pero Mercado Pago todavía lo muestra pendiente. Cuando se acredite se confirma tu turno.')
  assert.equal(r.noEncontrado, 'Todavía no encuentro un pago acreditado para esta seña. Si lo hiciste recién, puede tardar un momento en aparecer.')
  assert.match(r.rechazado, /No pude confirmar ese pago en Mercado Pago: figura rechazado o cancelado/u)
  assert.match(r.cuarentena, /no coincide con lo esperado para esta seña, así que no lo puedo aplicar/u)
  assert.equal(r.caido, 'No pude consultar Mercado Pago en este momento. Probá de nuevo en unos minutos.')
  assert.deepEqual(r.comprobanteFalso, { textos: ['Recibí el comprobante, pero no pude confirmar ese pago en Mercado Pago. Un comprobante no alcanza: el pago lo confirma Mercado Pago. Si lo hiciste recién, puede tardar un momento en aparecer.'], consultas: 1, descargas: 0 })
  assert.deepEqual(r.sinPalabras, { pdf: [r.comprobanteFalso.textos[0]], imagen: ['Ya estoy revisando ese pago. Esperá unos segundos y volvé a preguntarme.'], consultas: 1, descargas: 0 }, 'a PDF alone asks the backend; an image seconds later is paced, not sent to Mercado Pago')
  assert.deepEqual(r.comprobanteValido, ['Sí, Mercado Pago confirmó tu seña de $15.000. Tu turno con Melina quedó confirmado.'], 'confirmed only because the backend said so')
  assert.equal(r.sinPago.comprobante[0], 'Recibí el comprobante, pero todavía no pude relacionarlo con un pago confirmado de Mercado Pago.')
  assert.match(r.sinPago.foto[0], /^Recibí la foto\. Por ahora la guardo para el equipo/u)
  assert.match(r.sinPago.texto[0], /No encuentro pagos pendientes en tu cuenta\. Si el pago es de otro trabajo, decime cuál y lo reviso\./u)
  assert.equal(r.sinPago.consultas, 0)
  assert.deepEqual(r.yaAcreditada.consultas, 0)
  assert.match(r.yaAcreditada.textos[0], /ya figura acreditada por Mercado Pago/u)
  assert.equal(r.dos.consultasAntesDeElegir, 0, 'two deposits: nothing is asked before the person chooses')
  assert.match(r.dos.pregunta[0], /Tenés 2 pagos pendientes:\n1\) Melina[^\n]*\n2\) Sabrina[^\n]*\n¿A cuál corresponde el pago\? Decime el nombre del profesional o el servicio\./u)
  assert.deepEqual(r.dos.consultas, [['customer-user', 'res-sab']], 'only the deposit named is asked')
  assert.equal(r.dos.respuesta[0], 'Encontré el pago correspondiente, pero Mercado Pago todavía lo muestra pendiente. Cuando se acredite se confirma tu turno.')
  assert.deepEqual(r.idAjeno.consultas, [['customer-user', 'res-mel']], 'an operation number typed by the person is never looked up')
  assert.equal(r.voz.textos[0], 'Sí, Mercado Pago confirmó tu seña de $15.000. Tu turno con Melina quedó confirmado.')
  assert.equal(r.voz.consultas, 1)
  assert.equal(r.ritmo.apurada[0], 'Ya estoy revisando ese pago. Esperá unos segundos y volvé a preguntarme.')
  assert.match(r.ritmo.septima[0], /Ya revisé tu pago varias veces/u)
  assert.equal(r.ritmo.consultas, 6, 'six questions to Mercado Pago an hour at most')
  assert.deepEqual(r.desconocido.pide, ['Para revisar tu pago necesito tu nombre completo y DNI.'])
  assert.equal(r.desconocido.consultasSinCuenta, 0)
  assert.deepEqual(r.desconocido.consultas, [['customer-user', 'res-mel']])
  assert.equal(r.desconocido.identificado.at(-1), 'Sí, Mercado Pago confirmó tu seña de $15.000. Tu turno con Melina quedó confirmado.')
  assert.deepEqual(r.imagenDuplicada, { una: 1, mismoWamid: [1, 0], nuevoWamid: ['Encontré el pago correspondiente, pero Mercado Pago todavía lo muestra pendiente. Cuando se acredite se confirma tu turno.'], consultas: 2 }, 'a redelivered receipt is processed once; the same picture again is a new, paced question that still confirms nothing')
  assert.equal(r.noEsPagoRealizado.consultas, 0, 'a question about receipts or about paying is not a payment claim')
  assert.deepEqual(r.afirmaConfirmacion, [], 'no reply to a non-confirmed payment says it is confirmed')
  assert.equal(r.consultasTotales, true)
})

test('assistant tools: get_pending_payments and verify_payment_status only ASK the backend (linked accounts only, exactly one of ref or workId, strict fields); the model cannot supply an account, an amount or a status', () => {
  const r = runTypeScriptScenario(`
    const { HERRAMIENTAS, seleccionarHerramientas } = await import('./apps/api/src/tus/asistente/herramientas.ts')
    const tool = (name) => HERRAMIENTAS.find((t) => t.name === name)
    const verificar = tool('verify_payment_status')
    const pendientes = tool('get_pending_payments')
    const llamadas = []
    const dominio = {
      senasVerificables: async (c) => { llamadas.push(['senas', c.subjectId]); return [{ ref: 'res-1', providerName: 'Melina', service: 'Masaje', startsAt: '2026-09-26T20:00:00.000Z', amount: 15000, estado: 'pending' }] },
      verificarSena: async (c, ref) => { llamadas.push(['sena', c.subjectId, ref]); return { estado: 'pending' } },
      verificarPagoTrabajo: async (c, workId) => { llamadas.push(['trabajo', c.subjectId, workId]); return { estado: 'not_found', appliedNow: false, amountMinor: null, currency: null } },
    }
    const actor = { contactId: 'c', conversationId: 'k', context: { subjectId: 'cuenta-1', tenantId: 't-1', correlationId: 'x', roles: ['owner'], permissions: [] }, isProvider: false }
    const valido = (args) => verificar.schema.safeParse(args).success
    const out = {}
    out.audiencia = [verificar.audience, pendientes.audience, verificar.confirmation, pendientes.confirmation]
    out.esquema = [valido({ ref: 'res-1' }), valido({ workId: 'trabajo-1' }), valido({}), valido({ ref: 'res-1', workId: 'trabajo-1' }), valido({ ref: 'res-1', status: 'approved' }), valido({ ref: 'res-1', amountMinor: '1' }), valido({ ref: 'res-1', accountId: 'otra-cuenta' }), valido({ ref: '../x' })]
    out.sena = await verificar.execute({ ref: 'res-1' }, actor, dominio, { idempotencyKey: 'k' })
    out.trabajo = await verificar.execute({ workId: 'trabajo-1' }, actor, dominio, { idempotencyKey: 'k' })
    out.pendientes = (await pendientes.execute({}, actor, dominio, { idempotencyKey: 'k' })).deposits.length
    out.sinDominio = await verificar.execute({ ref: 'res-1' }, actor, {}, { idempotencyKey: 'k' })
    out.llamadas = llamadas
    out.enPago = seleccionarHerramientas('pago', actor).map((t) => t.name).filter((n) => n.includes('payment'))
    out.sinCuenta = seleccionarHerramientas('pago', { ...actor, context: null }).map((t) => t.name).filter((n) => n.includes('payment'))
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.audiencia, ['linked', 'linked', null, null])
  assert.deepEqual(r.esquema, [true, true, false, false, false, false, false, false])
  assert.deepEqual(r.sena, { verification: { estado: 'pending' } })
  assert.deepEqual(r.trabajo, { verification: { estado: 'not_found', appliedNow: false, amountMinor: null, currency: null } })
  assert.equal(r.pendientes, 1)
  assert.deepEqual(r.enPago.sort(), ['get_payment_link', 'get_payment_status', 'get_pending_payments', 'verify_payment_status'])
  assert.deepEqual(r.sinCuenta, [], 'without a linked account the model is not offered any payment tool')
  assert.deepEqual(r.sinDominio, { verification: { estado: 'unavailable' } })
  assert.deepEqual(r.llamadas, [['sena', 'cuenta-1', 'res-1'], ['trabajo', 'cuenta-1', 'trabajo-1'], ['senas', 'cuenta-1']], 'always the actor of the session, never a value of the model')
})
