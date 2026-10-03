import { SERVICE_SETUP } from './web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './whatsapp.mjs'

// Shared by the WhatsApp multimodal scenarios (voice notes, "ya pagué", receipts): the real
// orchestrator and ingress over a domain double whose payment state is set ONLY by the test.
export const MULTIMODAL_SETUP = `${SERVICE_SETUP}${WHATSAPP_SETUP}
  Date.now = waClock
  const { catalogoVigente, establecerCatalogo } = await import('./apps/api/src/tus/catalogo/vigente.ts')
  const catalogo = catalogoVigente()
  establecerCatalogo({ ...catalogo, oficios: [...catalogo.oficios, { id: 'masaje', categoriaId: null, nombre: 'Masaje', profesion: 'Masajista', slug: 'masaje', descripcion: null, icono: 'herramienta', activo: true, orden: 20, sinonimos: ['masaje', 'masajes', 'masajista', 'contractura'] }] })
  const iso = (dia, hora) => new Date(dia + 'T' + hora + ':00.000-03:00').toISOString()
  const cabe = (hora, t) => !t || (t.kind === 'exact' ? hora === t.from : t.kind === 'from' ? hora >= t.from : t.kind === 'until' ? hora < t.to : hora >= t.from && hora < t.to)
  const TARIFA = [{ id: 't-unica', name: 'Masaje descontracturante', durationMinutes: 60, price: 30000 }]
  const AGENDA = [
    { id: 'perfil-melina', name: 'Melina', area: 'Centro', verified: true, jobs: 9, turnos: true, horas: ['17:00', '18:00', '19:00'], tarifas: TARIFA, base: null },
    { id: 'perfil-sabrina', name: 'Sabrina', area: 'Centro', verified: true, jobs: 5, turnos: true, horas: ['16:00', '20:00'], tarifas: TARIFA, base: null },
  ]
  // What the backend knows about each deposit's payment: set by the test, never by the assistant.
  const dom = { consultas: [], senas: new Map(), trabajos: new Map(), resultados: new Map(), verificaciones: [], lanzar: new Set(), pagos: [], trabajosVerificados: [] }
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
    servicioDeTurno: async (providerId) => {
      const p = AGENDA.find((item) => item.id === providerId)
      if (!p) return null
      return { serviceName: 'Masaje', options: p.tarifas.map((t) => ({ tariffId: t.id, name: t.name, durationMinutes: t.durationMinutes, price: t.price, deposit: 15000 })) }
    },
    nombrePrestador: async (providerId) => AGENDA.find((item) => item.id === providerId)?.name ?? null,
    reservarTurno: async () => { throw Object.assign(new Error('not used'), { code: 'NOT_USED' }) },
    senasPendientes: async () => [],
    pagarSena: async (context, ref) => { dom.pagos.push([context.subjectId, ref]); return { url: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-' + ref, amount: 15000 } },
    misTurnos: async () => [],
    senasVerificables: async (context) => (dom.senas.get(context.subjectId) ?? []).map((s) => ({ ...s })),
    // Deposits of turnos plus open payments of works (what the real domain lists from the client's OWN data).
    pagosVerificables: async (context) => [
      ...(dom.senas.get(context.subjectId) ?? []).map((s) => ({ ref: s.ref, kind: 'turno', part: null, providerName: s.providerName, service: s.service, startsAt: s.startsAt, amountMinor: String(Math.round(s.amount * 100)), currency: 'ARS', estado: s.estado, operationRef: s.operationRef ?? null })),
      ...(dom.trabajos.get(context.subjectId) ?? []).map((t) => ({ kind: 'trabajo', startsAt: null, providerName: '', currency: 'ARS', estado: 'pending', operationRef: null, ...t })),
    ],
    verificarPagoTrabajo: async (context, workId) => {
      dom.verificaciones.push([context.subjectId, 'work:' + workId])
      dom.trabajosVerificados.push([context.subjectId, workId])
      const r = dom.resultados.get('work:' + workId) ?? { estado: 'not_found' }
      return r.estado === 'confirmed' ? { estado: 'confirmed', appliedNow: r.appliedNow ?? true, amountMinor: r.amountMinor ?? null, currency: 'ARS' } : { estado: r.estado, appliedNow: false, amountMinor: null, currency: null }
    },
    verificarSena: async (context, ref) => {
      dom.verificaciones.push([context.subjectId, ref])
      if (dom.lanzar.has(ref)) throw new Error('mercado pago down')
      return dom.resultados.get(ref) ?? { estado: 'not_found' }
    },
  }
  const personas = new Map([['12345678', { accountId: 'customer-user', tenantId: customer.tenantId, firstName: 'Juan Ignacio', lastName: 'Mumbach', displayName: 'Juan Ignacio Mumbach' }]])
  const identidades = { buscarPorDocumento: async (tipo, numero) => personas.get(numero) ?? null }
  const cuentas = { ...accountResolver, contextoDeCuenta: async (accountId, correlationId) => { const cuenta = accounts.get(accountId); return cuenta ? accountResolver.contexto(accountId, cuenta.tenantId, correlationId) : null } }

  // The speech-to-text port: the test says what the provider answers.
  // Both ports: the plain one (text only) and the one that also reports confidence (what the real adapter has).
  const stt = { llamadas: [], proxima: 'hola',
    transcribirDetallado: async (audio) => { stt.llamadas.push({ mime: audio.mimeType, bytes: audio.bytes.length }); const salida = stt.proxima; if (salida instanceof Error) throw salida; if (salida === 'colgar') return new Promise(() => {}); return typeof salida === 'string' ? { text: salida, confianza: 'desconocida' } : salida },
    transcribir: async (audio) => (await stt.transcribirDetallado(audio)).text }
  const env = { ...waEnv, WHATSAPP_STT_MAX_BYTES: '4096', WHATSAPP_STT_TIMEOUT_MS: '1000', WHATSAPP_STT_MAX_SECONDS: '60', WHATSAPP_MEDIA_MAX_PER_HOUR: '6', WHATSAPP_INBOUND_MAX_PER_MINUTE: '120' }
  // The receipt analyzer: the test says what the file "says" (evidence) or that the reader fails.
  const { ServicioComprobantes, leerLimitesComprobante, EVIDENCIA_VACIA } = await import('./apps/api/src/tus/asistente/comprobantes.ts')
  const envComprobantes = { WHATSAPP_RECEIPT_ANALYSIS: 'true', WHATSAPP_RECEIPT_MAX_PER_HOUR: '3', WHATSAPP_RECEIPT_MAX_BYTES: '20000', WHATSAPP_RECEIPT_PDF_MAX_BYTES: '20000', WHATSAPP_RECEIPT_TIMEOUT_MS: '1000' }
  const limitesComprobante = leerLimitesComprobante({ ...envComprobantes })
  const lector = { llamadas: [], evidencia: null, fallo: null, kind: 'ocr',
    analizar: async (archivo) => { lector.llamadas.push({ tipo: archivo.kind, mime: archivo.mimeType, bytes: archivo.bytes.length }); if (lector.fallo === 'colgar') return new Promise(() => {}); if (lector.fallo) throw lector.fallo; return { ...EVIDENCIA_VACIA, analyzer: 'ocr', ...(lector.evidencia ?? {}) } } }
  const comprobantes = new ServicioComprobantes(fakeWa, lector, limitesComprobante)
  const modulo = crearModuloWhatsapp({ env: { ...env, ...envComprobantes }, transaction: waTx, accounts: cuentas, domain: dominio, knowledgeIndex, whatsapp: fakeWa, chat: null, embeddings, transcriptor: stt, comprobantes, now: waClock, identidades, metric: (name, fields) => metrics.push({ name, ...fields }) })
  const cola = modulo.crearWorker({ owner: 'mm' })
  const descargas = []
  const descargaOriginal = fakeWa.downloadMedia.bind(fakeWa)
  fakeWa.downloadMedia = async (id, limites) => { descargas.push(id); return descargaOriginal(id, limites) }

  // An Ogg/Opus voice note of the given length (real container: header page and last page).
  function oggOpus(segundos) {
    const cabeza = Buffer.alloc(19)
    cabeza.write('OpusHead', 0, 'latin1'); cabeza[8] = 1; cabeza[9] = 1; cabeza.writeUInt16LE(312, 10); cabeza.writeUInt32LE(48000, 12)
    const pagina = (flags, granule, payload) => { const h = Buffer.alloc(28); h.write('OggS', 0, 'latin1'); h[5] = flags; h.writeBigInt64LE(BigInt(granule), 6); h.writeUInt32LE(1, 14); h[26] = 1; h[27] = payload.length; return Buffer.concat([h, payload]) }
    return Buffer.concat([pagina(2, 0, cabeza), pagina(4, Math.round(segundos * 48000) + 312, Buffer.alloc(40, 1))])
  }
  let mediaSeq = 0
  const nuevoMedia = (mimeType, bytes) => { mediaSeq += 1; const id = '55500' + String(mediaSeq).padStart(4, '0'); fakeWa.media.set(id, { mimeType, bytes }); return id }
  const cuerpoAudio = (id, mime = 'audio/ogg; codecs=opus') => ({ type: 'audio', body: { audio: { id, mime_type: mime, sha256: 'hash-' + id } } })
  const cuerpoImagen = (caption) => { const id = nuevoMedia('image/jpeg', Buffer.from('fake-jpeg-bytes')); return { type: 'image', body: { image: { id, mime_type: 'image/jpeg', sha256: 'hash-' + id, ...(caption ? { caption } : {}) } } } }
  const cuerpoDocumento = (caption) => { const id = nuevoMedia('application/pdf', Buffer.from('%PDF-1.4 fake')); return { type: 'document', body: { document: { id, mime_type: 'application/pdf', filename: 'comprobante.pdf', sha256: 'hash-' + id, ...(caption ? { caption } : {}) } } } }

  // Real-looking receipt files (valid headers): a PNG and a text PDF of the given pages.
  const NL = String.fromCharCode(10)
  const pngBytes = (w = 800, h = 600, extra = 0) => { const b = Buffer.alloc(33 + extra); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = 2; return b }
  const pdfBytes = (texto, paginas = 1) => {
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>']
    objs.push('<< /Type /Pages /Kids [' + Array.from({ length: paginas }, (_, i) => (3 + i) + ' 0 R').join(' ') + '] /Count ' + paginas + ' >>')
    const flujo = 'BT /F1 12 Tf 10 100 Td (' + texto + ') Tj ET'
    for (let i = 0; i < paginas; i += 1) objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 144] /Contents ' + (3 + paginas) + ' 0 R /Resources << /Font << /F1 ' + (4 + paginas) + ' 0 R >> >> >>')
    objs.push('<< /Length ' + flujo.length + ' >>' + NL + 'stream' + NL + flujo + NL + 'endstream')
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    let out = '%PDF-1.4' + NL
    const offs = []
    objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj' + NL + o + NL + 'endobj' + NL })
    const x = out.length
    out += 'xref' + NL + '0 ' + (objs.length + 1) + NL + '0000000000 65535 f ' + NL
    for (const o of offs) out += String(o).padStart(10, '0') + ' 00000 n ' + NL
    return Buffer.from(out + 'trailer' + NL + '<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>' + NL + 'startxref' + NL + x + NL + '%%EOF' + NL, 'latin1')
  }
  // A receipt message: an image (PNG by default) or a document (PDF), with its Meta hash and caption.
  function cuerpoArchivo(tipo, bytes, mime, opciones = {}) {
    const id = nuevoMedia(mime, bytes)
    const meta = { id, mime_type: mime, sha256: opciones.sha256 ?? 'hash-' + id, ...(opciones.caption ? { caption: opciones.caption } : {}) }
    return tipo === 'image' ? { type: 'image', body: { image: meta } } : { type: 'document', body: { document: { ...meta, filename: 'comprobante.pdf' } } }
  }
  // Two inbound messages of the same person in the same turn (a receipt and a voice note).
  async function turnoMixto(waId, mensajes) {
    const antes = fakeWa.sent.length
    for (const m of mensajes) await modulo.ingreso.procesar(parsearWebhookMeta(inbound(waId, m.text ?? '', m.extra), PHONE_ID), 'corr-mm')
    for (let i = 0; i < 5; i += 1) if ((await cola.procesarSiguiente()).outcome === 'idle') break
    waAdvance(20000)
    return fakeWa.sent.slice(antes).map((x) => x.message.text ?? x.message.type)
  }
  const textosEnviados = () => fakeWa.sent.map((x) => x.message.text ?? x.message.type)
  async function turno(waId, text, extra, avance = 20000) {
    const antes = fakeWa.sent.length
    const resultado = await modulo.ingreso.procesar(parsearWebhookMeta(inbound(waId, text, extra), PHONE_ID), 'corr-mm')
    for (let i = 0; i < 5; i += 1) if ((await cola.procesarSiguiente()).outcome === 'idle') break
    waAdvance(avance)
    return { resultado, textos: fakeWa.sent.slice(antes).map((x) => x.message.text ?? x.message.type) }
  }
  // A voice note of a person: the STT provider hears "frase".
  async function voz(waId, frase, opciones = {}) {
    stt.proxima = frase
    const id = nuevoMedia(opciones.mimeType ?? 'audio/ogg', opciones.bytes ?? oggOpus(opciones.segundos ?? 4))
    return turno(waId, '', cuerpoAudio(id, opciones.mimeDeclarado))
  }
  const conversacionDe = async (waId) => { const c = await contactOf(waId); return c ? waStore.repositorios().conversaciones.activaDeContacto(c.contactId) : null }
  const mensajesDe = async (waId) => { const c = await contactOf(waId); return [...waStore.state.mensajes.values()].filter((m) => m.contactId === c.contactId) }
  async function vincular(waId) { await turno(waId, 'hola'); await linkContact(waId, 'customer-user') }
`
