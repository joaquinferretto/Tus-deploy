import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { MULTIMODAL_SETUP } from './fixtures/whatsapp-multimodal.mjs'

// TUS-WHATSAPP-MULTIMODAL-02 in the assistant: a receipt (image or PDF) is read as UNTRUSTED
// evidence, only to choose among the client's OWN payments, and never confirms anything.
//
//   IMAGE / PDF = HINT. TUS CONTEXT = CORRELATION. MERCADO PAGO = AUTHORITY. BACKEND = DECISION.
//
// Real orchestrator, ingress, receipt download/validation service and (for the PDF case) the real
// text extraction; the OCR/vision reader is a double (what the file "says"); the domain is a fake
// whose payment answers are set ONLY by the test. Clock: Friday 2026-09-25 09:00 in Argentina.

const SETUP = MULTIMODAL_SETUP

test('receipts: one pending payment is verified without reading the file; with several, the evidence and the words choose among the client\'s own or the person is asked; false, foreign and arbitrary receipts confirm nothing and reveal nothing', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const MASAJE = { ref: 'res-mel', providerName: 'Melina', service: 'Masaje', startsAt: iso('2026-09-26', '17:00'), amount: 15000, estado: 'pending' }
    const LUZ = (monto = '2250000') => ({ ref: 'work:t-luz', part: 'sena', service: 'Electricidad', amountMinor: monto })
    const OTRO = { ref: 'res-otro', providerName: 'Sabrina', service: 'Masaje', startsAt: iso('2026-09-27', '16:00'), amount: 15000, estado: 'pending' }
    dom.senas.set('other-user', [OTRO])
    const CONFIRMADA = { estado: 'confirmed', appliedNow: true, turnoConfirmado: true, amount: 15000 }
    let numero = 0
    const nuevo = async () => { numero += 1; const waId = '54911556200' + String(numero).padStart(2, '0'); await vincular(waId); return waId }
    const reiniciar = (senas, trabajos = []) => { dom.senas.set('customer-user', senas); dom.trabajos.set('customer-user', trabajos); dom.verificaciones.length = 0; lector.llamadas.length = 0; lector.evidencia = null; lector.fallo = null; descargas.length = 0 }
    const png = (extra = {}) => cuerpoArchivo('image', pngBytes(), 'image/jpeg', extra)
    const imagen = (opciones) => cuerpoArchivo('image', pngBytes(), 'image/png', opciones)
    const sinConfirmar = []
    const nota = (textos) => { sinConfirmar.push(...textos); return textos }

    // A) an image alone and ONE pending payment: it is verified at once, the file is not even downloaded.
    reiniciar([MASAJE]); dom.resultados.set('res-mel', CONFIRMADA)
    let waId = await nuevo()
    out.imagenSola = { textos: (await turno(waId, '', imagen())).textos, consultas: dom.verificaciones.slice(), lecturas: lector.llamadas.length, descargas: descargas.length }
    // B) the same with a caption.
    waId = await nuevo(); dom.verificaciones.length = 0
    out.imagenYTexto = { textos: (await turno(waId, '', imagen({ caption: 'Ya pagué, acá está el comprobante' }))).textos, consultas: dom.verificaciones.slice(), lecturas: lector.llamadas.length }

    // D) two pending payments of the client, the amount in the receipt tells them apart.
    reiniciar([MASAJE], [LUZ()]); dom.resultados.set('res-mel', CONFIRMADA); dom.resultados.set('work:t-luz', { estado: 'confirmed', amountMinor: '2250000' })
    lector.evidencia = { amountMinor: '1500000', currency: 'ARS', status: 'approved' }
    waId = await nuevo()
    out.montoDistingueTurno = { textos: (await turno(waId, '', imagen())).textos, consultas: dom.verificaciones.slice(), lecturas: lector.llamadas.length, descargas: descargas.length }
    lector.evidencia = { amountMinor: '2250000', currency: 'ARS' }; dom.verificaciones.length = 0; waId = await nuevo()
    out.montoDistingueTrabajo = { textos: (await turno(waId, '', imagen())).textos, consultas: dom.verificaciones.slice() }

    // E) two payments of the SAME amount: asked, never guessed; the answer names one and only that one is verified.
    reiniciar([MASAJE], [LUZ('1500000')]); dom.resultados.set('work:t-luz', { estado: 'pending' })
    lector.evidencia = { amountMinor: '1500000', currency: 'ARS' }
    waId = await nuevo()
    const pregunta = await turno(waId, '', imagen())
    const consultasAntes = dom.verificaciones.length
    const respuesta = await turno(waId, 'el del trabajo de electricidad')
    out.mismoMonto = { pregunta: pregunta.textos, consultasAntesDeElegir: consultasAntes, respuesta: respuesta.textos, consultas: dom.verificaciones.slice() }
    nota(pregunta.textos)

    // C) a receipt and a voice note in the same turn: the words help correlate (service, day), never confirm.
    reiniciar([MASAJE], [LUZ('1500000')]); dom.resultados.set('res-mel', CONFIRMADA)
    lector.evidencia = { amountMinor: '1500000', currency: 'ARS' }
    waId = await nuevo(); stt.proxima = 'Este es el del masaje de mañana'
    const idVoz = nuevoMedia('audio/ogg', oggOpus(3))
    out.imagenYAudio = { textos: await turnoMixto(waId, [{ extra: imagen() }, { extra: cuerpoAudio(idVoz) }]), consultas: dom.verificaciones.slice(), transcripcion: stt.llamadas.length }

    // F) a FAKE receipt ("Pago aprobado $15.000") while Mercado Pago has no such payment: nothing is confirmed.
    reiniciar([MASAJE]); dom.resultados.set('res-mel', { estado: 'not_found' })
    lector.evidencia = { amountMinor: '1500000', currency: 'ARS', status: 'approved', operationId: '1234567890' }
    waId = await nuevo()
    out.falso = { textos: nota((await turno(waId, '', imagen({ caption: 'Pago aprobado $15.000' }))).textos), consultas: dom.verificaciones.slice() }

    // G, H) a receipt of ANOTHER client and an arbitrary payment id: the ids are ignored, only the client's own payments exist.
    reiniciar([MASAJE], [LUZ('1500000')])
    lector.evidencia = { amountMinor: '1500000', currency: 'ARS', operationId: '5550001234', recipientName: 'Sabrina', status: 'approved' }
    waId = await nuevo()
    const ajeno = await turno(waId, 'ya pagué, operación 5550001234', imagen())
    out.ajeno = { textos: nota(ajeno.textos), consultas: dom.verificaciones.slice(), filtraOperacion: JSON.stringify(ajeno.textos).includes('5550001234'), tocoAjeno: dom.verificaciones.some(([, ref]) => ref === 'res-otro') }

    // R) the same picture twice: read once; the second time it is reused (no download, no new reading).
    reiniciar([MASAJE], [LUZ('1500000')]); lector.evidencia = { amountMinor: '1500000', currency: 'ARS' }
    const mismoHash = { sha256: 'hash-recibo-duplicado' }
    waId = await nuevo()
    const primera = await turno(waId, '', imagen(mismoHash))
    const lecturasPrimera = lector.llamadas.length; const descargasPrimera = descargas.length
    const segunda = await turno(waId, '', imagen(mismoHash))
    out.duplicada = { lecturas: [lecturasPrimera, lector.llamadas.length], descargas: [descargasPrimera, descargas.length], reuso: metrics.filter((m) => m.name === 'assistant.receipt_reused').length, preguntas: [primera.textos.length, segunda.textos.length] }

    // S, T, X) too large, wrong type, truncated PDF: refused before any reader sees it; the person is told and asked.
    const fallos = {}
    for (const [nombre, cuerpo] of [
      ['grande', () => cuerpoArchivo('image', pngBytes(800, 600, 30000), 'image/png')],
      ['zipComoImagen', () => cuerpoArchivo('image', Buffer.from('PK' + 'x'.repeat(80)), 'image/png')],
      ['htmlDeclarado', () => cuerpoArchivo('document', Buffer.from('<html>' + 'x'.repeat(80) + '</html>'), 'text/html')],
      ['pdfTruncado', () => cuerpoArchivo('document', pdfBytes('Pago $ 15.000').subarray(0, 200), 'application/pdf')],
      ['pdfDemasiadasPaginas', () => cuerpoArchivo('document', pdfBytes('Pago $ 15.000', 6), 'application/pdf')],
    ]) {
      reiniciar([MASAJE], [LUZ('1500000')]); lector.evidencia = { amountMinor: '1500000', currency: 'ARS' }
      const antesMetricas = metrics.length
      const w = await nuevo()
      const respuesta = await turno(w, '', cuerpo())
      fallos[nombre] = { empieza: respuesta.textos[0].startsWith('No pude leer el comprobante, así que no sé a cuál corresponde. Tenés 2 pagos pendientes:'), lecturas: lector.llamadas.length, consultas: dom.verificaciones.length, motivo: metrics.slice(antesMetricas).filter((m) => m.name === 'assistant.receipt_failed').map((m) => m.reason) }
    }
    out.fallosDeArchivo = fallos

    // U, V) the reader is down, or hangs: the same honest question.
    reiniciar([MASAJE], [LUZ('1500000')]); lector.fallo = new Error('ocr crashed')
    let antesM = metrics.length; waId = await nuevo()
    const caido = await turno(waId, '', imagen())
    out.lectorCaido = { empieza: caido.textos[0].startsWith('No pude leer el comprobante'), consultas: dom.verificaciones.length, motivo: metrics.slice(antesM).filter((m) => m.name === 'assistant.receipt_failed').map((m) => m.reason) }
    reiniciar([MASAJE], [LUZ('1500000')]); lector.fallo = 'colgar'
    antesM = metrics.length; waId = await nuevo()
    const colgado = await turno(waId, '', imagen())
    out.lectorColgado = { empieza: colgado.textos[0].startsWith('No pude leer el comprobante'), consultas: dom.verificaciones.length, motivo: metrics.slice(antesM).filter((m) => m.name === 'assistant.receipt_failed').map((m) => m.reason) }

    // W) a valid PDF read for real (pdftotext through stdin/stdout): its amount chooses the work.
    // Only a pdftotext that really extracts from stdin counts (poppler's; Xpdf's does not).
    const { AnalizadorComprobanteOcr, ExtractorTextoPdfPoppler } = await import('./apps/api/src/tus/asistente/comprobantes.ts')
    out.hayPoppler = (await new ExtractorTextoPdfPoppler().disponibilidad()).available
    const real = new AnalizadorComprobanteOcr({ reconocer: async () => ({ text: '', confidence: 0 }) }, new ExtractorTextoPdfPoppler(), limitesComprobante)
    reiniciar([MASAJE], [LUZ()]); dom.resultados.set('work:t-luz', { estado: 'confirmed', amountMinor: '2250000' })
    const delegado = lector.analizar; lector.analizar = (archivo) => { lector.llamadas.push({ tipo: archivo.kind, mime: archivo.mimeType, bytes: archivo.bytes.length }); return real.analizar(archivo) }
    waId = await nuevo()
    const conPdf = await turno(waId, '', cuerpoArchivo('document', pdfBytes('Pago aprobado $ 22.500 Operacion: 987654321'), 'application/pdf'))
    out.pdfValido = { textos: conPdf.textos, consultas: dom.verificaciones.slice(), tipo: lector.llamadas[0]?.tipo }
    lector.analizar = delegado

    // Rate limit of analyses (3 an hour): distinct pictures; the fourth is not read, the person is asked.
    reiniciar([MASAJE], [LUZ('1500000')]); lector.evidencia = { amountMinor: '1500000', currency: 'ARS' }
    waId = await nuevo(); const respuestas = []
    for (let i = 0; i < 4; i += 1) respuestas.push((await turno(waId, '', imagen({ sha256: 'hash-distinto-' + i }))).textos[0].slice(0, 28))
    out.limite = { lecturas: lector.llamadas.length, cuarta: respuestas[3], limitadas: metrics.filter((m) => m.name === 'assistant.receipt_limited').length }

    // PRIVACY: what remains of a read receipt is the minimum; no file, no names, no operation number, no account.
    reiniciar([MASAJE], [LUZ('1500000')]); lector.evidencia = { amountMinor: '1500000', currency: 'ARS', operationId: '987654321', recipientName: 'Melina Gómez', recipientAccountHint: '8901', payerName: 'Juan Pérez', externalReference: 'pago-secreto-0001', status: 'approved', occurredAt: '2026-09-15T14:32' }
    waId = await nuevo()
    await turno(waId, '', imagen({ sha256: 'hash-privacidad' }))
    const mensajes = await mensajesDe(waId); const conv = await conversacionDe(waId)
    const recibo = mensajes.find((m) => m.type === 'image')
    const guardado = JSON.stringify({ mensajes, estado: conv.state })
    out.privacidad = { receipt: recibo.metadata.receipt, cache: conv.state.paymentCheck.receipts, sinDatosPersonales: !/987654321|Melina G|Juan P|8901|pago-secreto|base64|PNG/u.test(guardado.replace(/Melina/gu, '')) }

    // NOTHING non-confirmed was ever worded as confirmed.
    out.afirmaConfirmacion = sinConfirmar.filter((texto) => /confirm[oó] (tu|la|el)|qued[oó] confirmado|ya figura acreditada/iu.test(texto))
    out.soloPropios = true
    console.log(JSON.stringify(out))
  `)
  const CONFIRMA_TURNO = ['Sí, Mercado Pago confirmó tu seña de $15.000. Tu turno con Melina quedó confirmado.']
  assert.deepEqual(r.imagenSola, { textos: CONFIRMA_TURNO, consultas: [['customer-user', 'res-mel']], lecturas: 0, descargas: 0 }, 'one pending payment: verified by Mercado Pago, the file is not downloaded or read')
  assert.deepEqual(r.imagenYTexto, { textos: CONFIRMA_TURNO, consultas: [['customer-user', 'res-mel']], lecturas: 0 })
  assert.deepEqual(r.montoDistingueTurno, { textos: CONFIRMA_TURNO, consultas: [['customer-user', 'res-mel']], lecturas: 1, descargas: 1 }, 'the amount ranks the client\'s own payments; the turno is verified, not the work')
  assert.deepEqual(r.montoDistingueTrabajo, { textos: ['Sí, Mercado Pago confirmó la seña de $22.500 del trabajo de Electricidad.'], consultas: [['customer-user', 'work:t-luz']] })
  assert.equal(r.mismoMonto.pregunta[0], 'Tenés 2 pagos pendientes:\n1) Melina (Masaje), sábado 26 de septiembre a las 17:00, seña de $15.000\n2) Trabajo de Electricidad, seña de $15.000\n¿A cuál corresponde el comprobante? Decime el nombre del profesional o el servicio.')
  assert.equal(r.mismoMonto.consultasAntesDeElegir, 0, 'ambiguous: nothing is asked to Mercado Pago')
  assert.deepEqual(r.mismoMonto.consultas, [['customer-user', 'work:t-luz']], 'only the payment the person names')
  assert.equal(r.mismoMonto.respuesta[0], 'Encontré el pago correspondiente, pero Mercado Pago todavía lo muestra pendiente. Cuando se acredite se registra solo.')
  assert.deepEqual(r.imagenYAudio, { textos: CONFIRMA_TURNO, consultas: [['customer-user', 'res-mel']], transcripcion: 1 }, 'the voice note ("el del masaje de mañana") correlates; Mercado Pago confirms')
  assert.deepEqual(r.falso.consultas, [['customer-user', 'res-mel']])
  assert.equal(r.falso.textos[0], 'Recibí el comprobante, pero no pude confirmar ese pago en Mercado Pago. Un comprobante no alcanza: el pago lo confirma Mercado Pago. Si lo hiciste recién, puede tardar un momento en aparecer.')
  assert.deepEqual(r.ajeno.consultas, [], 'a foreign operation number is not a candidate: ambiguous, nothing asked')
  assert.equal(r.ajeno.filtraOperacion, false)
  assert.equal(r.ajeno.tocoAjeno, false)
  assert.match(r.ajeno.textos[0], /^Tenés 2 pagos pendientes:/u)
  assert.deepEqual(r.duplicada.lecturas, [1, 1], 'the same picture is read once')
  assert.deepEqual(r.duplicada.descargas, [1, 1])
  assert.equal(r.duplicada.reuso, 1)
  for (const nombre of ['grande', 'zipComoImagen', 'htmlDeclarado', 'pdfTruncado', 'pdfDemasiadasPaginas']) {
    assert.equal(r.fallosDeArchivo[nombre].empieza, true, nombre + ': told and asked')
    assert.equal(r.fallosDeArchivo[nombre].lecturas, 0, nombre + ': no reader saw it')
    assert.equal(r.fallosDeArchivo[nombre].consultas, 0, nombre + ': nothing asked to Mercado Pago')
  }
  assert.deepEqual(r.fallosDeArchivo.grande.motivo, ['TOO_LARGE'])
  assert.deepEqual(r.fallosDeArchivo.zipComoImagen.motivo, ['CORRUPT'])
  assert.deepEqual(r.fallosDeArchivo.htmlDeclarado.motivo, ['DOWNLOAD_FAILED'])
  assert.deepEqual(r.fallosDeArchivo.pdfTruncado.motivo, ['CORRUPT'])
  assert.deepEqual(r.fallosDeArchivo.pdfDemasiadasPaginas.motivo, ['TOO_MANY_PAGES'])
  assert.deepEqual([r.lectorCaido.empieza, r.lectorCaido.consultas, r.lectorCaido.motivo], [true, 0, ['ANALYZER_UNAVAILABLE']])
  assert.deepEqual([r.lectorColgado.empieza, r.lectorColgado.consultas, r.lectorColgado.motivo], [true, 0, ['ANALYZER_TIMEOUT']])
  if (r.hayPoppler) {
    assert.deepEqual(r.pdfValido, { textos: ['Sí, Mercado Pago confirmó la seña de $22.500 del trabajo de Electricidad.'], consultas: [['customer-user', 'work:t-luz']], tipo: 'pdf' })
  } else {
    assert.match(r.pdfValido.textos[0], /^No pude leer el comprobante/u)
  }
  assert.deepEqual(r.limite, { lecturas: 3, cuarta: 'No pude leer el comprobante,', limitadas: 1 })
  assert.deepEqual(r.privacidad.receipt, { status: 'analyzed', analyzer: 'ocr', amountMinor: '1500000', currency: 'ARS', date: '2026-09-15', reads: 'approved' })
  assert.deepEqual(r.privacidad.cache.map(({ sha256, amountMinor, currency, occurredAt }) => ({ sha256, amountMinor, currency, occurredAt })), [{ sha256: 'hash-privacidad', amountMinor: '1500000', currency: 'ARS', occurredAt: '2026-09-15T14:32' }])
  assert.equal(r.privacidad.sinDatosPersonales, true, 'no file, name, account, reference or operation number is kept')
  assert.deepEqual(r.afirmaConfirmacion, [], 'no reply to a non-confirmed payment says it is confirmed')
})
