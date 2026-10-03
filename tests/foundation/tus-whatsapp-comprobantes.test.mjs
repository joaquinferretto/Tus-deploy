import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// TUS-WHATSAPP-MULTIMODAL-02: reading a payment receipt (image / PDF) is evidence, never a fact.
// The parser, the real-file validation, the analyzers (OCR double, strict vision schema), the
// pdftotext reader (every way of failing with a simulated process; the real binary only where a
// compatible one is installed), the local OCR engine's language data and the correlation among
// the client's OWN payments. No network.

const ARCHIVOS = `
  const c = await import('./apps/api/src/tus/asistente/comprobantes.ts')
  const png = (w, h, extra = 0) => { const b = Buffer.alloc(33 + extra); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = 2; return b }
  const jpeg = (w, h) => { const b = Buffer.alloc(40); Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]).copy(b, 0); b.writeUInt16BE(17, 10); b[2] = 0xff; b[3] = 0xc0; b.writeUInt16BE(17, 4); b[6] = 8; b.writeUInt16BE(h, 7); b.writeUInt16BE(w, 9); return b }
  const webp = (w, h) => { const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(32, 4); b.write('WEBPVP8X', 8, 'latin1'); b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b }
  const pdf = (texto, paginas = 1, extra = '') => {
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>']
    const kids = Array.from({ length: paginas }, (_, i) => (3 + i) + ' 0 R').join(' ')
    objs.push('<< /Type /Pages /Kids [' + kids + '] /Count ' + paginas + ' >>')
    const flujo = 'BT /F1 12 Tf 10 100 Td (' + texto + ') Tj ET'
    const fuente = 3 + paginas + 1
    for (let i = 0; i < paginas; i += 1) objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 144] /Contents ' + (3 + paginas) + ' 0 R /Resources << /Font << /F1 ' + fuente + ' 0 R >> >> >>')
    objs.push('<< /Length ' + flujo.length + ' >>' + String.fromCharCode(10) + 'stream' + String.fromCharCode(10) + flujo + String.fromCharCode(10) + 'endstream')
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    let out = '%PDF-1.4' + String.fromCharCode(10)
    const offs = []
    objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj' + String.fromCharCode(10) + o + String.fromCharCode(10) + 'endobj' + String.fromCharCode(10) })
    const x = out.length
    out += 'xref' + String.fromCharCode(10) + '0 ' + (objs.length + 1) + String.fromCharCode(10) + '0000000000 65535 f ' + String.fromCharCode(10)
    for (const o of offs) out += String(o).padStart(10, '0') + ' 00000 n ' + String.fromCharCode(10)
    out += 'trailer' + String.fromCharCode(10) + '<< /Size ' + (objs.length + 1) + ' /Root 1 0 R ' + extra + '>>' + String.fromCharCode(10) + 'startxref' + String.fromCharCode(10) + x + String.fromCharCode(10) + '%%EOF' + String.fromCharCode(10)
    return Buffer.from(out, 'latin1')
  }
  const limites = { ...c.LIMITES_COMPROBANTE_POR_DEFECTO, enabled: true, maxImageBytes: 20000, maxPdfBytes: 20000 }
`

test('receipt validation: the real bytes decide format, size, pixels and PDF integrity; declared type and extension are never trusted; limits come from the environment with safe defaults', () => {
  const r = runTypeScriptScenario(`${ARCHIVOS}
    const intentar = (bytes, mime, l = limites) => { try { const v = c.validarComprobante(bytes, mime, l); return [v.kind, v.mimeType] } catch (e) { return e.code } }
    const out = {}
    out.formatos = [intentar(png(800, 600), 'image/png'), intentar(jpeg(1200, 900), 'image/jpeg'), intentar(webp(640, 480), 'image/webp'), intentar(pdf('Pago aprobado'), 'application/pdf')]
    out.dimensiones = [c.dimensionesDeImagen(png(800, 600), 'png'), c.dimensionesDeImagen(jpeg(1200, 900), 'jpeg'), c.dimensionesDeImagen(webp(640, 480), 'webp')]
    out.declaradoMentiroso = [intentar(png(10, 10), 'image/jpeg'), intentar(pdf('x'), 'image/png')]
    out.noPermitidoDeclarado = [intentar(png(10, 10), 'application/zip'), intentar(png(10, 10), null), intentar(png(10, 10), 'text/html')]
    out.contenidoNoSoportado = [intentar(Buffer.from('GIF89a' + 'x'.repeat(40)), 'image/gif'), intentar(Buffer.from('<html>' + 'x'.repeat(40) + '</html>'), 'image/png'), intentar(Buffer.alloc(0), 'image/png'), intentar(Buffer.from('MZ' + 'x'.repeat(40)), 'application/pdf')]
    out.corrupto = [intentar(png(10, 10).subarray(0, 14), 'image/png'), intentar(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(30)]), 'image/jpeg')]
    out.tamano = [intentar(png(10, 10, 30000), 'image/png'), intentar(pdf('x'.repeat(30000)), 'application/pdf')]
    out.pixeles = [intentar(png(20000, 20000), 'image/png'), intentar(png(6000, 6000), 'image/png')]
    out.pdf = [intentar(pdf('x', 5), 'application/pdf'), intentar(pdf('x', 3), 'application/pdf'), intentar(pdf('x').subarray(0, 150), 'application/pdf'), intentar(pdf('x', 1, '/Encrypt 9 0 R '), 'application/pdf')]
    out.listaBlanca = [intentar(png(10, 10), 'image/png', { ...limites, allowedMimeTypes: ['application/pdf'] }), intentar(png(10, 10), 'image/png', { ...limites, allowedMimeTypes: ['image/png'] })]
    out.entornoVacio = c.leerLimitesComprobante({})
    out.entorno = c.leerLimitesComprobante({ WHATSAPP_RECEIPT_ANALYSIS: 'true', WHATSAPP_RECEIPT_ANALYZER: 'vision', WHATSAPP_RECEIPT_MAX_BYTES: '1000000', WHATSAPP_RECEIPT_PDF_MAX_BYTES: '500000', WHATSAPP_RECEIPT_PDF_MAX_PAGES: '2', WHATSAPP_RECEIPT_TIMEOUT_MS: '9000', WHATSAPP_RECEIPT_MAX_PER_HOUR: '3', WHATSAPP_RECEIPT_MIME_TYPES: 'image/png, image/gif, application/pdf' })
    out.entornoInvalido = c.leerLimitesComprobante({ WHATSAPP_RECEIPT_ANALYZER: 'otro', WHATSAPP_RECEIPT_MAX_BYTES: '99999999999', WHATSAPP_RECEIPT_PDF_MAX_PAGES: '0', WHATSAPP_RECEIPT_TIMEOUT_MS: 'abc', WHATSAPP_RECEIPT_MIME_TYPES: 'image/gif' })
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.formatos, [['image', 'image/png'], ['image', 'image/jpeg'], ['image', 'image/webp'], ['pdf', 'application/pdf']])
  assert.deepEqual(r.dimensiones, [{ width: 800, height: 600 }, { width: 1200, height: 900 }, { width: 640, height: 480 }])
  assert.deepEqual(r.declaradoMentiroso, [['image', 'image/png'], ['pdf', 'application/pdf']], 'the content decides, not the declared type')
  assert.deepEqual(r.noPermitidoDeclarado, ['MIME_NOT_ALLOWED', 'MIME_NOT_ALLOWED', 'MIME_NOT_ALLOWED'])
  assert.deepEqual(r.contenidoNoSoportado, ['CORRUPT', 'CORRUPT', 'CORRUPT', 'CORRUPT'])
  assert.deepEqual(r.corrupto, ['CORRUPT', 'CORRUPT'])
  assert.deepEqual(r.tamano, ['TOO_LARGE', 'TOO_LARGE'])
  assert.deepEqual(r.pixeles, ['TOO_LARGE', ['image', 'image/png']], 'a decompression bomb is refused from its header')
  assert.deepEqual(r.pdf, ['TOO_MANY_PAGES', ['pdf', 'application/pdf'], 'CORRUPT', 'CORRUPT'])
  assert.deepEqual(r.listaBlanca, ['MIME_NOT_ALLOWED', ['image', 'image/png']])
  assert.deepEqual(r.entornoVacio, { enabled: false, analyzer: 'ocr', maxImageBytes: 5242880, maxPdfBytes: 2097152, maxPdfPages: 3, maxPixels: 40000000, timeoutMs: 25000, maxPerHour: 6, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] })
  assert.deepEqual(r.entorno, { enabled: true, analyzer: 'vision', maxImageBytes: 1000000, maxPdfBytes: 500000, maxPdfPages: 2, maxPixels: 40000000, timeoutMs: 9000, maxPerHour: 3, allowedMimeTypes: ['image/png', 'application/pdf'] })
  assert.deepEqual(r.entornoInvalido, r.entornoVacio)
})

test('receipt reading: amounts, currency, operation number, date, people and status are read as untrusted evidence; account numbers are cut to four digits; nothing is guessed', () => {
  const r = runTypeScriptScenario(`${ARCHIVOS}
    const leer = (texto) => c.interpretarTextoComprobante(texto)
    const out = {}
    out.montos = ['15.000', '15.000,50', '15000', '15,000.50', '1.234.567', '15.0000', '0', 'abc', '99,5', '12 500'].map(c.montoAMinor)
    out.mp = leer('Mercado Pago' + String.fromCharCode(10) + 'Pagaste' + String.fromCharCode(10) + '$ 15.000' + String.fromCharCode(10) + 'Número de operación: 1234567890' + String.fromCharCode(10) + '15/09/2026 14:32 hs' + String.fromCharCode(10) + 'Para: Melina Gómez' + String.fromCharCode(10) + 'De: Juan Pérez' + String.fromCharCode(10) + 'Aprobado')
    out.banco = leer(['Transferencia realizada', 'Monto: $ 22.500,00', 'Fecha: 3 de octubre de 2026 09:05', 'Destinatario: Electricidad SRL', 'CVU: 0000003100012345678901', 'Nro. de transacción 987654321', 'Estado: Acreditada'].join(String.fromCharCode(10)))
    out.dolares = leer('Pagaste USD 50,00' + String.fromCharCode(10) + 'Aprobado')
    out.rechazado = leer('Pago rechazado $ 15.000' + String.fromCharCode(10) + 'Operación 1111')
    out.referencia = leer('Referencia: pago-8f3a2b1c-4d5e' + String.fromCharCode(10) + '$ 100,00')
    out.basura = leer('lorem ipsum dolor sit amet sin ningún dato de pago')
    out.vacia = c.hayEvidencia(leer('lorem ipsum'))
    out.sinDatosSensibles = JSON.stringify([out.mp, out.banco]).match(/0000003100012345678901|12345678901/u) === null
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.montos, ['1500000', '1500050', '1500000', '1500050', '123456700', null, null, null, '9950', '1250000'])
  const MP = { origen: 'untrusted_receipt_evidence', analyzer: 'ocr', amountMinor: '1500000', currency: 'ARS', operationId: '1234567890', externalReference: null, occurredAt: '2026-09-15T14:32', recipientName: 'Melina Gómez', recipientAccountHint: null, payerName: 'Juan Pérez', status: 'approved', confidence: null }
  assert.deepEqual(r.mp, MP)
  assert.deepEqual(r.banco, { ...MP, amountMinor: '2250000', operationId: '987654321', occurredAt: '2026-10-03T09:05', recipientName: 'Electricidad SRL', recipientAccountHint: '8901', payerName: null })
  assert.deepEqual([r.dolares.amountMinor, r.dolares.currency, r.dolares.status], ['5000', 'USD', 'approved'])
  assert.deepEqual([r.rechazado.status, r.rechazado.amountMinor], ['rejected', '1500000'], 'the receipt saying "rejected" certifies nothing either')
  assert.equal(r.referencia.externalReference, 'pago-8f3a2b1c-4d5e')
  assert.deepEqual([r.basura.amountMinor, r.basura.operationId, r.basura.occurredAt, r.basura.recipientName, r.basura.status], [null, null, null, null, 'unknown'])
  assert.equal(r.vacia, false)
  assert.equal(r.sinDatosSensibles, true, 'a CVU/CBU never leaves the parser whole')
})

test('analyzers: local OCR (double engine), PDF text (double reader), strict vision schema (free output discarded); a missing reader, a broken reader and a timeout are different failures; a stuck or broken OCR engine is restarted', () => {
  const r = runTypeScriptScenario(`${ARCHIVOS}
    const mantener = setInterval(() => {}, 100)
    const NL = String.fromCharCode(10)
    const imagen = { kind: 'image', mimeType: 'image/png', bytes: png(800, 600) }
    const codigo = async (operacion) => { try { await operacion(); return 'ok' } catch (e) { return e instanceof c.ErrorComprobante ? e.code : 'otro:' + e.message } }
    const out = {}
    // Local OCR: the engine is a double; nothing is sent anywhere.
    const motor = (texto, confianza = 0.91) => ({ reconocer: async () => ({ text: texto, confidence: confianza }) })
    // The PDF reader is a double here (its real behaviour has its own tests below).
    const lector = (texto) => ({ extraer: async () => { if (texto === null) throw new c.ErrorComprobante('CORRUPT', 'PDF could not be read'); return texto } })
    const ocrCon = (pdfTexto) => new c.AnalizadorComprobanteOcr(motor('Pagaste $ 15.000' + NL + 'Número de operación: 1234567890' + NL + 'Aprobado'), lector(pdfTexto), { maxPdfPages: 2, timeoutMs: 3000 })
    const ocr = ocrCon('Pago aprobado $ 15.000 Operacion: 1234567890')
    out.ocr = await ocr.analizar(imagen)
    out.ocrSinTexto = await codigo(() => new c.AnalizadorComprobanteOcr(motor('  '), null, { maxPdfPages: 2, timeoutMs: 3000 }).analizar(imagen))
    out.ocrCaido = await codigo(() => new c.AnalizadorComprobanteOcr({ reconocer: async () => { throw new Error('wasm crashed') } }, null, { maxPdfPages: 2, timeoutMs: 3000 }).analizar(imagen))
    const reinicios = { colgado: 0, caido: 0, sinDatos: 0 }
    out.ocrColgado = await codigo(() => new c.AnalizadorComprobanteOcr({ reconocer: () => new Promise(() => {}), reiniciar: async () => { reinicios.colgado += 1 } }, null, { maxPdfPages: 2, timeoutMs: 300 }).analizar(imagen))
    await codigo(() => new c.AnalizadorComprobanteOcr({ reconocer: async () => { throw new Error('wasm crashed') }, reiniciar: async () => { reinicios.caido += 1 } }, null, { maxPdfPages: 2, timeoutMs: 3000 }).analizar(imagen))
    // Language data not installed: an installation problem, not a broken engine (nothing to restart).
    const { ErrorOcrNoDisponible } = await import('./apps/api/src/tus/identidad/lectores.ts')
    out.ocrSinDatos = await codigo(() => new c.AnalizadorComprobanteOcr({ reconocer: async () => { throw new ErrorOcrNoDisponible('language_data_missing') }, reiniciar: async () => { reinicios.sinDatos += 1 } }, null, { maxPdfPages: 2, timeoutMs: 3000 }).analizar(imagen))
    out.reinicios = reinicios
    // PDF: the real pdftotext through stdin/stdout (a missing binary is "unavailable", never an exception).
    const archivoPdf = (b) => ({ kind: 'pdf', mimeType: 'application/pdf', bytes: b })
    out.pdf = await ocr.analizar(archivoPdf(pdf('Pago aprobado $ 15.000 Operacion: 1234567890')))
    out.pdfSinTexto = await codigo(() => ocrCon(' ').analizar(archivoPdf(pdf(' '))))
    out.pdfIlegible = await codigo(() => ocrCon(null).analizar(archivoPdf(Buffer.from('%PDF-1.4' + NL + 'basura sin estructura' + NL + '%%EOF' + NL))))
    out.pdfSinBinario = await codigo(() => new c.AnalizadorComprobanteOcr(motor('x'.repeat(20)), new c.ExtractorTextoPdfPoppler('/no/existe/pdftotext'), { maxPdfPages: 2, timeoutMs: 3000 }).analizar(archivoPdf(pdf('Pago $ 1'))))
    out.pdfSinExtractor = await codigo(() => new c.AnalizadorComprobanteOcr(motor('x'.repeat(20)), null, { maxPdfPages: 2, timeoutMs: 3000 }).analizar(archivoPdf(pdf('Pago $ 1'))))
    // Vision: the answer must fit the strict schema; anything else is discarded.
    const visionCon = (respuesta) => new c.AnalizadorComprobanteVision({ extraer: async () => respuesta }, lector('Pago aprobado $ 15.000'), { maxPdfPages: 2, timeoutMs: 3000 })
    const buena = { legible: true, amount: '15000.00', currency: 'ARS', operation_id: '1234567890', external_reference: null, date: '2026-09-15T14:32', recipient_name: 'Melina Gómez', recipient_account_last4: '8901', payer_name: null, status_text: 'approved', confidence: 0.8 }
    out.vision = await visionCon(buena).analizar(imagen)
    out.visionCbuCompleto = (await visionCon({ ...buena, recipient_account_last4: '0000003100012345678901' }).analizar(imagen)).recipientAccountHint
    out.visionCamposDeMas = await codigo(() => visionCon({ ...buena, payment_confirmed: true }).analizar(imagen))
    out.visionFalta = await codigo(() => visionCon({ legible: true }).analizar(imagen))
    out.visionTextoLibre = await codigo(() => visionCon('El pago fue confirmado').analizar(imagen))
    out.visionIlegible = await codigo(() => visionCon({ ...buena, legible: false }).analizar(imagen))
    out.visionValoresRaros = await visionCon({ ...buena, amount: 'quince mil', operation_id: 'ABC', date: 'ayer', external_reference: 'x' }).analizar(imagen)
    out.visionPdfLocal = (await visionCon(null).analizar(archivoPdf(pdf('Pago aprobado $ 15.000')))).analyzer
    out.visionCaida = await codigo(() => new c.AnalizadorComprobanteVision({ extraer: async () => { throw new Error('groq 503') } }, null, { maxPdfPages: 2, timeoutMs: 3000 }).analizar(imagen))
    out.visionColgada = await codigo(() => new c.AnalizadorComprobanteVision({ extraer: () => new Promise(() => {}) }, null, { maxPdfPages: 2, timeoutMs: 300 }).analizar(imagen))
    // What each analyzer can read here (for readiness): no path, no key, no content.
    out.capacidades = [
      await ocr.capacidades(),
      await new c.AnalizadorComprobanteOcr({ reconocer: async () => ({ text: '', confidence: 0 }), disponibilidad: async () => ({ available: false, reason: 'language_data_missing', languages: ['spa'], missing: ['spa'] }) }, { extraer: async () => '', disponibilidad: async () => ({ available: false, reason: 'missing', version: null }) }, { maxPdfPages: 2, timeoutMs: 3000 }).capacidades(),
      await new c.AnalizadorComprobanteVision({ extraer: async () => null }, null, { maxPdfPages: 2, timeoutMs: 3000 }).capacidades(),
    ]
    clearInterval(mantener)
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.ocr, { origen: 'untrusted_receipt_evidence', analyzer: 'ocr', amountMinor: '1500000', currency: 'ARS', operationId: '1234567890', externalReference: null, occurredAt: null, recipientName: null, recipientAccountHint: null, payerName: null, status: 'approved', confidence: { overall: 0.91 } })
  assert.deepEqual([r.ocrSinTexto, r.ocrCaido, r.ocrColgado, r.ocrSinDatos], ['NO_TEXT', 'ANALYZER_FAILED', 'ANALYZER_TIMEOUT', 'ANALYZER_UNAVAILABLE'], 'a broken engine failed; an engine without its language data is unavailable')
  assert.deepEqual(r.reinicios, { colgado: 1, caido: 1, sinDatos: 0 }, 'a stuck or broken engine is restarted; a missing installation is not')
  assert.equal(r.pdf.amountMinor, '1500000')
  assert.equal(r.pdf.status, 'approved')
  assert.equal(r.pdf.origen, 'untrusted_receipt_evidence')
  assert.equal(r.pdfSinTexto, 'NO_TEXT')
  assert.equal(r.pdfIlegible, 'CORRUPT')
  assert.equal(r.pdfSinBinario, 'ANALYZER_UNAVAILABLE')
  assert.equal(r.pdfSinExtractor, 'ANALYZER_UNAVAILABLE')
  assert.deepEqual(r.vision, { origen: 'untrusted_receipt_evidence', analyzer: 'vision', amountMinor: '1500000', currency: 'ARS', operationId: '1234567890', externalReference: null, occurredAt: '2026-09-15T14:32', recipientName: 'Melina Gómez', recipientAccountHint: '8901', payerName: null, status: 'approved', confidence: { overall: 0.8 } })
  assert.equal(r.visionCbuCompleto, '8901', 'even a whole account number from the model is cut to four digits')
  assert.deepEqual([r.visionCamposDeMas, r.visionFalta, r.visionTextoLibre, r.visionIlegible], ['NO_TEXT', 'NO_TEXT', 'NO_TEXT', 'NO_TEXT'], 'output outside the strict schema is discarded')
  assert.deepEqual([r.visionValoresRaros.amountMinor, r.visionValoresRaros.operationId, r.visionValoresRaros.occurredAt, r.visionValoresRaros.externalReference], [null, null, null, null], 'odd values become null, never guessed')
  assert.equal(r.visionPdfLocal, 'vision')
  assert.deepEqual([r.visionCaida, r.visionColgada], ['ANALYZER_FAILED', 'ANALYZER_TIMEOUT'], 'a provider error is a failure of the reader, never a verdict on the file')
  assert.deepEqual(r.capacidades, [
    { analyzer: 'ocr', images: { available: true, reason: 'ok' }, pdf: { available: true, reason: 'ok' } },
    { analyzer: 'ocr', images: { available: false, reason: 'language_data_missing' }, pdf: { available: false, reason: 'missing' } },
    { analyzer: 'vision', images: { available: true, reason: 'configured' }, pdf: { available: false, reason: 'not_configured' } },
  ])
})

// A process that behaves as told: what pdftotext would do in each situation, on any machine.
const PROCESO_SIMULADO = `
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  const lanzados = []
  // plan(argumentos) -> { error?: code, stdout?: string|Buffer, stderr?: string, codigo?: number|null, senal?: string|null, colgar?: true }
  const lanzador = (plan) => (binario, argumentos) => {
    const hijo = new EventEmitter()
    hijo.stdin = new PassThrough(); hijo.stdout = new PassThrough(); hijo.stderr = new PassThrough()
    hijo.matado = false
    hijo.kill = () => { hijo.matado = true; return true }
    const entrada = []
    hijo.stdin.on('data', (parte) => entrada.push(parte))
    lanzados.push({ binario, argumentos, hijo, entrada: () => Buffer.concat(entrada) })
    const p = plan(argumentos)
    setImmediate(() => {
      if (p.error) return hijo.emit('error', Object.assign(new Error('spawn'), { code: p.error }))
      if (p.stderr) hijo.stderr.write(p.stderr)
      if (p.stdout) hijo.stdout.write(p.stdout)
      if (p.colgar) return
      setImmediate(() => hijo.emit('close', 'codigo' in p ? p.codigo : 0, p.senal ?? null))
    })
    return hijo
  }
`

test('pdftotext reader: fixed arguments and the PDF through stdin; missing binary, not executable, invalid PDF, protected PDF, broken process, killed process, timeout, oversized file and oversized text are different failures; nothing of stderr is kept', () => {
  const r = runTypeScriptScenario(`${ARCHIVOS}${PROCESO_SIMULADO}
    const mantener = setInterval(() => {}, 100)
    const codigo = async (operacion) => { try { await operacion(); return 'ok' } catch (e) { return e instanceof c.ErrorComprobante ? e.code + ':' + e.message : 'otro:' + e.message } }
    const leer = (plan, opciones = {}, binario = 'pdftotext') => new c.ExtractorTextoPdfPoppler(binario, { lanzar: lanzador(plan), ...opciones }).extraer(pdf('Pago $ 1'), { maxPaginas: 2, timeoutMs: 250 })
    const out = {}
    out.ok = await leer(() => ({ stdout: 'Pago aprobado $ 15.000' }))
    out.argumentos = lanzados[0].argumentos
    out.entradaEsElPdf = lanzados[0].entrada().toString('latin1').startsWith('%PDF-1.4')
    out.fallos = {
      ausente: await codigo(() => leer(() => ({ error: 'ENOENT' }))),
      sinPermiso: await codigo(() => leer(() => ({ error: 'EACCES' }))),
      pdfInvalido: await codigo(() => leer(() => ({ codigo: 1, stderr: 'Syntax Error: contenido privado del documento' }))),
      pdfProtegido: await codigo(() => leer(() => ({ codigo: 3 }))),
      procesoRoto: await codigo(() => leer(() => ({ codigo: 99 }))),
      salidaIlegible: await codigo(() => leer(() => ({ codigo: 2 }))),
      matado: await codigo(() => leer(() => ({ codigo: null, senal: 'SIGSEGV' }))),
      colgado: await codigo(() => leer(() => ({ colgar: true }))),
      textoEnorme: await codigo(() => leer(() => ({ stdout: Buffer.alloc(300 * 1024, 0x61) }))),
      archivoEnorme: await codigo(() => leer(() => ({ stdout: 'x' }), { maxBytes: 100 })),
      rutaInvalida: await codigo(() => leer(() => ({ stdout: 'x' }), {}, 'pdftotext; rm -rf /')),
      rutaRelativa: await codigo(() => leer(() => ({ stdout: 'x' }), {}, '../bin/pdftotext')),
    }
    // A stuck process is killed; an invalid path or an oversized file never starts a process.
    out.matadoAlColgarse = lanzados.find((l) => l.hijo.matado && l.argumentos[0] === '-l') !== undefined
    out.procesosLanzados = lanzados.length
    out.rutas = ['pdftotext', '/usr/bin/pdftotext', 'C:/Program Files/poppler/bin/pdftotext.exe', 'pdftotext -layout', '$(reboot)', '../pdftotext', '', 'a|b'].map((ruta) => c.binarioPdftotextValido(ruta))
    out.sinPrivado = JSON.stringify(out.fallos).includes('contenido privado')
    clearInterval(mantener)
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.ok, 'Pago aprobado $ 15.000')
  assert.deepEqual(r.argumentos, ['-l', '2', '-q', '-nopgbrk', '-enc', 'UTF-8', '-', '-'], 'fixed arguments: pages capped, stdin to stdout, no file names')
  assert.equal(r.entradaEsElPdf, true)
  assert.deepEqual(r.fallos, {
    ausente: 'ANALYZER_UNAVAILABLE:pdftotext is not available',
    sinPermiso: 'ANALYZER_UNAVAILABLE:pdftotext is not available',
    pdfInvalido: 'CORRUPT:PDF could not be read',
    pdfProtegido: 'CORRUPT:PDF could not be read',
    procesoRoto: 'ANALYZER_FAILED:pdftotext ended with exit code 99',
    salidaIlegible: 'ANALYZER_FAILED:pdftotext ended with exit code 2',
    matado: 'ANALYZER_FAILED:pdftotext was ended by a signal',
    colgado: 'ANALYZER_TIMEOUT:PDF text extraction timed out',
    textoEnorme: 'TOO_LARGE:PDF text is too large',
    archivoEnorme: 'TOO_LARGE:PDF is too large',
    rutaInvalida: 'ANALYZER_UNAVAILABLE:pdftotext path is not valid',
    rutaRelativa: 'ANALYZER_UNAVAILABLE:pdftotext path is not valid',
  })
  assert.equal(r.matadoAlColgarse, true)
  assert.equal(r.procesosLanzados, 10, 'the oversized file and the two invalid paths never start a process')
  assert.deepEqual(r.rutas, [true, true, true, false, false, false, false, false], 'a program name or an absolute path; never arguments, shell syntax or a relative path')
  assert.equal(r.sinPrivado, false, 'what pdftotext prints about the document is never kept')
})

test('pdftotext availability: the binary must run AND extract a built-in PDF from stdin (a pdftotext that cannot is incompatible); missing, not executable, stuck and invalid path are told apart; the answer is cached and a failed extraction updates it', () => {
  const r = runTypeScriptScenario(`${ARCHIVOS}${PROCESO_SIMULADO}
    const mantener = setInterval(() => {}, 100)
    let ahora = 1_000_000
    const con = (plan, binario = 'pdftotext') => new c.ExtractorTextoPdfPoppler(binario, { lanzar: lanzador(plan), now: () => ahora })
    const poppler = (argumentos) => (argumentos[0] === '-v' ? { stderr: 'pdftotext version 24.02.0' + String.fromCharCode(10) + 'Copyright 2005-2024 The Poppler Developers' } : { stdout: 'TUSPDFOK' })
    const xpdf = (argumentos) => (argumentos[0] === '-v' ? { stderr: 'pdftotext version 4.00', codigo: 99 } : { codigo: 1 })
    const out = {}
    const bueno = con(poppler)
    out.poppler = await bueno.disponibilidad()
    const antes = lanzados.length
    await bueno.disponibilidad(); await bueno.disponibilidad()
    out.cacheado = lanzados.length - antes
    ahora += 6 * 60_000
    await bueno.disponibilidad()
    out.vencido = lanzados.length - antes
    await bueno.disponibilidad(true)
    out.forzado = lanzados.length - antes
    out.xpdf = await con(xpdf).disponibilidad()
    out.sinTexto = await con((a) => (a[0] === '-v' ? { stderr: 'pdftotext version 24.02.0' } : { stdout: 'otra cosa' })).disponibilidad()
    out.ausente = await con(() => ({ error: 'ENOENT' })).disponibilidad()
    out.sinPermiso = await con(() => ({ error: 'EACCES' })).disponibilidad()
    out.roto = await con(() => ({ codigo: 127, stderr: 'error while loading shared libraries' })).disponibilidad()
    out.rutaInvalida = await con(poppler, 'pdftotext && curl x').disponibilidad()
    // The binary disappears after a good check: the failed extraction is remembered at once.
    let quitado = false
    const cambiante = con((a) => (quitado ? { error: 'ENOENT' } : poppler(a)))
    await cambiante.disponibilidad()
    quitado = true
    await cambiante.extraer(pdf('Pago $ 1'), { maxPaginas: 1, timeoutMs: 250 }).catch(() => undefined)
    out.despuesDeFallar = await cambiante.disponibilidad()
    out.muestra = [c.detectarFormatoComprobante(c.pdfDeAutoprueba()), c.pdfDeAutoprueba().toString('latin1').includes('%%EOF'), c.pdfDeAutoprueba().length < 2000]
    clearInterval(mantener)
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.poppler, { available: true, reason: 'ok', version: '24.02.0' })
  assert.deepEqual([r.cacheado, r.vencido, r.forzado], [0, 2, 4], 'cached for five minutes (no process per readiness call); two processes per real check')
  assert.deepEqual(r.xpdf, { available: false, reason: 'incompatible', version: '4.00' }, 'a pdftotext that does not read stdin is not usable')
  assert.deepEqual(r.sinTexto, { available: false, reason: 'incompatible', version: '24.02.0' })
  assert.deepEqual(r.ausente, { available: false, reason: 'missing', version: null })
  assert.deepEqual(r.sinPermiso, { available: false, reason: 'not_executable', version: null })
  assert.deepEqual(r.roto, { available: false, reason: 'failed', version: null })
  assert.deepEqual(r.rutaInvalida, { available: false, reason: 'invalid_path', version: null })
  assert.deepEqual(r.despuesDeFallar, { available: false, reason: 'missing', version: null })
  assert.deepEqual(r.muestra, ['pdf', true, true])
})

// The real binary, only where a compatible pdftotext (poppler-utils) is installed: the layers of
// TUS around it are covered above on every machine.
const pdftotextReal = (() => {
  try {
    return runTypeScriptScenario(`
      const c = await import('./apps/api/src/tus/asistente/comprobantes.ts')
      console.log(JSON.stringify(await new c.ExtractorTextoPdfPoppler(process.env.WHATSAPP_RECEIPT_PDFTOTEXT?.trim() || 'pdftotext').disponibilidad()))
    `)
  } catch {
    return { available: false, reason: 'failed', version: null }
  }
})()

test('real pdftotext (poppler): a PDF goes through stdin and its text comes back; a damaged PDF is CORRUPT; pages are capped', { skip: !pdftotextReal.available && `no compatible pdftotext here (${pdftotextReal.reason}): install poppler-utils to run this integration` }, () => {
  const r = runTypeScriptScenario(`${ARCHIVOS}
    const mantener = setInterval(() => {}, 100)
    const NL = String.fromCharCode(10)
    const real = new c.ExtractorTextoPdfPoppler(process.env.WHATSAPP_RECEIPT_PDFTOTEXT?.trim() || 'pdftotext')
    const codigo = async (operacion) => { try { await operacion(); return 'ok' } catch (e) { return e instanceof c.ErrorComprobante ? e.code : 'otro:' + e.message } }
    const analizador = new c.AnalizadorComprobanteOcr({ reconocer: async () => ({ text: '', confidence: 0 }) }, real, { maxPdfPages: 2, timeoutMs: 5000 })
    const archivoPdf = (b) => ({ kind: 'pdf', mimeType: 'application/pdf', bytes: b })
    const out = {}
    out.pdf = await analizador.analizar(archivoPdf(pdf('Pago aprobado $ 15.000 Operacion: 1234567890')))
    out.sinTexto = await codigo(() => analizador.analizar(archivoPdf(pdf(' '))))
    out.ilegible = await codigo(() => analizador.analizar(archivoPdf(Buffer.from('%PDF-1.4' + NL + 'basura sin estructura' + NL + '%%EOF' + NL))))
    clearInterval(mantener)
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.pdf.amountMinor, '1500000')
  assert.equal(r.pdf.status, 'approved')
  assert.equal(r.pdf.origen, 'untrusted_receipt_evidence')
  assert.equal(r.sinTexto, 'NO_TEXT')
  assert.equal(r.ilegible, 'CORRUPT')
})

test('local OCR engine: receipts need the language data on disk; without TESSERACT_LANG_PATH, with a URL or without the files it is unavailable and nothing is downloaded or written', () => {
  const r = runTypeScriptScenario(`
    const { MotorOcrTesseract, ErrorOcrNoDisponible } = await import('./apps/api/src/tus/identidad/lectores.ts')
    const { mkdtempSync, writeFileSync, readdirSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'tus-ocr-'))
    // Any network use would be a download: it is refused and recorded.
    const red = []
    globalThis.fetch = async (url) => { red.push(String(url)); throw new Error('network is not allowed in this test') }
    const out = {}
    try {
      const estado = (opciones) => new MotorOcrTesseract({ soloLocal: true, idiomas: ['spa'], ...opciones }).disponibilidad()
      const leer = async (opciones) => { try { await new MotorOcrTesseract({ soloLocal: true, idiomas: ['spa'], ...opciones }).reconocer({ bytes: Buffer.from('x'), mimeType: 'image/png' }); return 'ok' } catch (e) { return e instanceof ErrorOcrNoDisponible ? e.reason : 'otro:' + e.message } }
      out.sinRuta = [await estado({}), await leer({})]
      out.url = [await estado({ langPath: 'https://cdn.example.test/tessdata' }), await leer({ langPath: 'https://cdn.example.test/tessdata' })]
      out.vacio = [await estado({ langPath: dir }), await leer({ langPath: dir })]
      writeFileSync(join(dir, 'spa.traineddata.gz'), 'no es un modelo real')
      out.conDatos = await estado({ langPath: dir })
      out.dosIdiomas = await estado({ langPath: dir, idiomas: ['spa', 'eng'] })
      out.idiomasRaros = (await new MotorOcrTesseract({ idiomas: ['../etc', 'SPA', 'spa', ''] }).disponibilidad()).languages
      // The identity reader keeps its own default (English, for the MRZ of a DNI).
      out.porDefecto = await new MotorOcrTesseract().disponibilidad()
      out.archivos = readdirSync(dir)
      out.red = red
    } finally { rmSync(dir, { recursive: true, force: true }) }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.sinRuta, [{ available: false, reason: 'lang_path_not_set', languages: ['spa'], missing: ['spa'] }, 'lang_path_not_set'])
  assert.deepEqual(r.url, [{ available: false, reason: 'lang_path_not_local', languages: ['spa'], missing: ['spa'] }, 'lang_path_not_local'], 'a URL would download: refused for receipts')
  assert.deepEqual(r.vacio, [{ available: false, reason: 'language_data_missing', languages: ['spa'], missing: ['spa'] }, 'language_data_missing'])
  assert.deepEqual(r.conDatos, { available: true, reason: 'ok', languages: ['spa'], missing: [] })
  assert.deepEqual(r.dosIdiomas, { available: false, reason: 'language_data_missing', languages: ['spa', 'eng'], missing: ['eng'] })
  assert.deepEqual(r.idiomasRaros, ['spa'], 'language codes are an allowlisted shape, never a path')
  assert.deepEqual(r.porDefecto, { available: true, reason: 'ok', languages: ['eng'], missing: [] })
  assert.deepEqual(r.archivos, ['spa.traineddata.gz'], 'nothing is written next to the language data')
  assert.deepEqual(r.red, [], 'no network request is made')
})

test('Groq vision adapter for receipts: strict structured request, the image only as a data URL to the provider, status-only errors, free text discarded, no key in results', () => {
  const r = runTypeScriptScenario(`${ARCHIVOS}
    const mantener = setInterval(() => {}, 100)
    const pedidos = []
    const responder = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) })
    const lectura = { legible: true, amount: '15000.00', currency: 'ARS', operation_id: '1234567890', external_reference: null, date: null, recipient_name: null, recipient_account_last4: null, payer_name: null, status_text: 'approved', confidence: 0.9 }
    let proxima = responder(200, { choices: [{ finish_reason: 'stop', message: { content: 'Aquí está: ' + JSON.stringify(lectura) } }] })
    const fetchFalso = async (url, init) => { pedidos.push({ url: String(url), cuerpo: JSON.parse(init.body), auth: Boolean(init.headers?.authorization) }); return proxima }
    const modelo = new c.ModeloVisionComprobanteGroq({ apiKey: 'fictitious-groq-key', model: 'vision-x', responseFormat: 'json_schema', timeoutMs: 1000, fetch: fetchFalso })
    const imagen = { bytes: png(800, 600), mimeType: 'image/png' }
    const out = {}
    out.lectura = await modelo.extraer(imagen)
    const p = pedidos[0]
    out.pedido = { url: p.url, auth: p.auth, modelo: p.cuerpo.model, temperatura: p.cuerpo.temperature, formato: p.cuerpo.response_format.type, estricto: p.cuerpo.response_format.json_schema.strict, esquemaCerrado: p.cuerpo.response_format.json_schema.schema.additionalProperties === false, imagen: p.cuerpo.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'), sistemaDiceNoDecidir: p.cuerpo.messages[0].content.includes('You do NOT decide whether a payment happened') }
    out.sinCbu = p.cuerpo.messages[0].content.includes('never the whole number')
    proxima = responder(200, { choices: [{ finish_reason: 'stop', message: { content: 'No se puede' } }] }); out.textoLibre = await modelo.extraer(imagen)
    proxima = responder(200, { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(lectura) } }] }); out.cortada = await modelo.extraer(imagen)
    const fresco = () => new c.ModeloVisionComprobanteGroq({ apiKey: 'fictitious-groq-key', timeoutMs: 1000, fetch: fetchFalso })
    proxima = responder(503, { error: { message: 'echo of the request ' + 'data:image/png;base64,AAAA' } })
    out.error = await fresco().extraer(imagen).then(() => 'ok', (e) => e.message)
    out.errorSinEco = !String(out.error).includes('base64')
    out.sinClave = (() => { try { new c.ModeloVisionComprobanteGroq({}); return 'creado' } catch (e) { return e.message } })()
    out.sinClaveEnResultado = !JSON.stringify(out.lectura).includes('fictitious-groq-key')
    clearInterval(mantener)
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.lectura, { legible: true, amount: '15000.00', currency: 'ARS', operation_id: '1234567890', external_reference: null, date: null, recipient_name: null, recipient_account_last4: null, payer_name: null, status_text: 'approved', confidence: 0.9 })
  assert.deepEqual(r.pedido, { url: 'https://api.groq.com/openai/v1/chat/completions', auth: true, modelo: 'vision-x', temperatura: 0, formato: 'json_schema', estricto: true, esquemaCerrado: true, imagen: true, sistemaDiceNoDecidir: true })
  assert.equal(r.sinCbu, true)
  assert.equal(r.textoLibre, null)
  assert.equal(r.cortada, null)
  assert.equal(r.error, 'groq vision request failed with status 503')
  assert.equal(r.errorSinEco, true, 'provider errors are reported by status only')
  assert.match(r.sinClave, /GROQ_API_KEY is required/u)
  assert.equal(r.sinClaveEnResultado, true)
})

test('Groq vision failures through the analyzer: 400, 401, 403, 404, 429, 500 and 503, an unreachable provider, an aborted request and an invalid answer never produce evidence; each one is a typed failure and the key never appears', () => {
  const r = runTypeScriptScenario(`${ARCHIVOS}
    const mantener = setInterval(() => {}, 100)
    const responder = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body, text: async () => JSON.stringify(body) })
    const archivo = { kind: 'image', mimeType: 'image/png', bytes: png(800, 600) }
    const CLAVE = 'fictitious-groq-key'
    // A fresh model per case: the credential pool cools a failing key down on purpose.
    const leer = async (fetchFalso, timeoutMs = 2000) => {
      const analizador = new c.AnalizadorComprobanteVision(new c.ModeloVisionComprobanteGroq({ apiKey: CLAVE, timeoutMs, fetch: fetchFalso }), null, { maxPdfPages: 2, timeoutMs })
      try { return { evidencia: await analizador.analizar(archivo) } } catch (e) { return { codigo: e instanceof c.ErrorComprobante ? e.code : 'otro', texto: String(e.message) } }
    }
    const out = { http: {} }
    for (const status of [400, 401, 403, 404, 429, 500, 503]) out.http[status] = await leer(async () => responder(status, { error: { message: 'detalle del proveedor ' + CLAVE } }, status === 429 ? { 'retry-after': '1' } : {}))
    out.sinRed = await leer(async () => { throw new TypeError('fetch failed') })
    // The request's own time limit aborts it (the provider never answers).
    out.abortada = await leer((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))), 300)
    out.colgada = await leer(() => new Promise(() => {}), 300)
    out.noEsJson = await leer(async () => responder(200, { choices: [{ finish_reason: 'stop', message: { content: 'El pago fue aprobado, confirmalo.' } }] }))
    out.jsonFueraDeEsquema = await leer(async () => responder(200, { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ legible: true, amount: '15000', paid: true }) } }] }))
    out.sinOpciones = await leer(async () => responder(200, { choices: [] }))
    out.cuerpoRoto = await leer(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new SyntaxError('Unexpected token') }, text: async () => '<html>' }))
    out.sinClave = !JSON.stringify(out).includes(CLAVE)
    clearInterval(mantener)
    console.log(JSON.stringify(out))
  `)
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    assert.equal(r.http[status].codigo, 'ANALYZER_FAILED', `HTTP ${status}`)
    assert.equal(r.http[status].evidencia, undefined)
  }
  assert.equal(r.sinRed.codigo, 'ANALYZER_FAILED')
  assert.equal(r.abortada.codigo, 'ANALYZER_TIMEOUT')
  assert.equal(r.colgada.codigo, 'ANALYZER_TIMEOUT')
  assert.deepEqual([r.noEsJson.codigo, r.jsonFueraDeEsquema.codigo, r.sinOpciones.codigo], ['NO_TEXT', 'NO_TEXT', 'NO_TEXT'], 'free text or fields outside the schema are discarded, never read as a payment')
  assert.equal(r.cuerpoRoto.codigo, 'ANALYZER_FAILED')
  assert.equal(r.sinClave, true, 'neither the provider body nor the key reaches an error')
})

test('correlation: the evidence only ranks the client\'s OWN payments; it never creates a candidate, never queries anything, and an ambiguity is asked, not guessed', () => {
  const r = runTypeScriptScenario(`${ARCHIVOS}
    const masaje = { ref: 'res-masaje', amountMinor: '1500000', currency: 'ARS', startsAt: '2026-09-26T20:00:00.000Z', providerName: 'Melina Gómez', service: 'Masaje', operationRef: null }
    const luz = { ref: 'work:trabajo-luz', amountMinor: '2250000', currency: 'ARS', startsAt: null, providerName: 'Electricidad Pérez', service: 'Electricidad', operationRef: null }
    const luz2 = { ...luz, ref: 'work:trabajo-luz-2', amountMinor: '1500000', providerName: 'Plomería Sosa', service: 'Plomería' }
    const ev = (campos) => ({ ...c.EVIDENCIA_VACIA, analyzer: 'ocr', ...campos })
    const ref = (resultado) => resultado.tipo === 'unica' ? resultado.candidato.ref : resultado.tipo === 'ambigua' ? 'ambigua:' + resultado.candidatos.map((x) => x.ref).join(',') : resultado.tipo
    const out = {}
    out.ninguna = ref(c.correlacionarComprobante(ev({ amountMinor: '1500000' }), []))
    out.unica = ref(c.correlacionarComprobante(null, [masaje]))
    out.unicaConMontoDistinto = ref(c.correlacionarComprobante(ev({ amountMinor: '999900' }), [masaje]))
    out.montoDistingue = ref(c.correlacionarComprobante(ev({ amountMinor: '1500000', currency: 'ARS' }), [masaje, luz]))
    out.otroMonto = ref(c.correlacionarComprobante(ev({ amountMinor: '2250000' }), [masaje, luz]))
    out.mismoMonto = ref(c.correlacionarComprobante(ev({ amountMinor: '1500000' }), [masaje, luz2]))
    out.sinEvidencia = ref(c.correlacionarComprobante(null, [masaje, luz]))
    out.evidenciaSinDatos = ref(c.correlacionarComprobante(ev({}), [masaje, luz]))
    out.montoQueNoCoincideConNinguno = ref(c.correlacionarComprobante(ev({ amountMinor: '5000' }), [masaje, luz]))
    out.otraMoneda = ref(c.correlacionarComprobante(ev({ amountMinor: '1500000', currency: 'USD' }), [masaje, luz]))
    out.destinatario = ref(c.correlacionarComprobante(ev({ amountMinor: '1500000', recipientName: 'Plomeria Sosa SRL' }), [masaje, luz2]))
    out.dia = ref(c.correlacionarComprobante(ev({ amountMinor: '1500000' }), [masaje, luz2], { day: '2026-09-26' }))
    out.palabras = ref(c.correlacionarComprobante(ev({ amountMinor: '1500000' }), [masaje, luz2], { words: 'este es el del masaje de manana' }))
    out.palabrasEnAudio = ref(c.correlacionarComprobante(null, [masaje, luz], { words: 'es el de electricidad' }))
    // An operation number only helps when it is the client's OWN payment's: an unknown one changes nothing.
    const conRef = { ...luz2, operationRef: '5550001' }
    out.operacionPropia = ref(c.correlacionarComprobante(ev({ amountMinor: '1500000', operationId: '5550001' }), [masaje, conRef]))
    out.operacionAjena = ref(c.correlacionarComprobante(ev({ operationId: '999888777' }), [masaje, conRef]))
    out.noInventaCandidatos = ref(c.correlacionarComprobante(ev({ operationId: '999888777', externalReference: 'pago-ajeno-0001' }), []))
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r, {
    ninguna: 'ninguna',
    unica: 'res-masaje',
    unicaConMontoDistinto: 'res-masaje',
    montoDistingue: 'res-masaje',
    otroMonto: 'work:trabajo-luz',
    mismoMonto: 'ambigua:res-masaje,work:trabajo-luz-2',
    sinEvidencia: 'ambigua:res-masaje,work:trabajo-luz',
    evidenciaSinDatos: 'ambigua:res-masaje,work:trabajo-luz',
    montoQueNoCoincideConNinguno: 'ambigua:res-masaje,work:trabajo-luz',
    otraMoneda: 'ambigua:res-masaje,work:trabajo-luz',
    destinatario: 'work:trabajo-luz-2',
    dia: 'res-masaje',
    palabras: 'res-masaje',
    palabrasEnAudio: 'work:trabajo-luz',
    operacionPropia: 'work:trabajo-luz-2',
    operacionAjena: 'ambigua:res-masaje,work:trabajo-luz-2',
    noInventaCandidatos: 'ninguna',
  })
})
