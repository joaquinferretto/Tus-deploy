import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// TUS-WHATSAPP-MULTIMODAL-01: the rules a voice note must satisfy before the STT provider sees it,
// the STT adapter's request and answers, and the media download cap. No network, no secrets.

test('audio validation: the real bytes decide the format, size and duration; declared type and extension are never trusted; limits come from the environment with safe defaults', () => {
  const r = runTypeScriptScenario(`
    const a = await import('./apps/api/src/tus/asistente/audio.ts')
    const oggOpus = (segundos) => {
      const cabeza = Buffer.alloc(19); cabeza.write('OpusHead', 0, 'latin1'); cabeza[8] = 1; cabeza[9] = 1; cabeza.writeUInt16LE(312, 10)
      const pagina = (flags, granule, payload) => { const h = Buffer.alloc(28); h.write('OggS', 0, 'latin1'); h[5] = flags; h.writeBigInt64LE(BigInt(granule), 6); h[26] = 1; h[27] = payload.length; return Buffer.concat([h, payload]) }
      return Buffer.concat([pagina(2, 0, cabeza), pagina(4, Math.round(segundos * 48000) + 312, Buffer.alloc(40, 1))])
    }
    const mp3Id3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40, 5)])
    const mp3Frame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(40, 5)])
    const m4a = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A '), Buffer.alloc(40, 5)])
    const amr = Buffer.concat([Buffer.from('#!AMR'), Buffer.from([10]), Buffer.alloc(40, 5)])
    const png = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG'), Buffer.alloc(40, 5)])
    const limites = { ...a.LIMITES_AUDIO_POR_DEFECTO, enabled: true, maxBytes: 4096, maxSeconds: 60 }
    const intentar = (bytes, mime, l = limites) => { try { const v = a.validarAudio(bytes, mime, l); return [v.mimeType, v.durationSeconds === null ? null : Math.round(v.durationSeconds)] } catch (e) { return e.code } }
    const out = {}
    out.formatos = [intentar(oggOpus(5), 'audio/ogg; codecs=opus'), intentar(mp3Id3, 'audio/mpeg'), intentar(mp3Frame, 'audio/mpeg'), intentar(m4a, 'audio/mp4')]
    // The declared type does not matter once the content is audio: an Ogg declared as mpeg is Ogg.
    out.declaradoMentiroso = intentar(oggOpus(5), 'audio/mpeg')
    out.noAudioDeclarado = [intentar(oggOpus(5), 'image/png'), intentar(oggOpus(5), null), intentar(oggOpus(5), 'application/pdf')]
    out.contenidoNoAudio = [intentar(png, 'audio/ogg'), intentar(Buffer.from('texto plano que dice ser un audio, relleno'), 'audio/ogg'), intentar(Buffer.alloc(0), 'audio/ogg'), intentar(Buffer.from('OggS'), 'audio/ogg')]
    out.noSoportados = [intentar(amr, 'audio/amr'), intentar(Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.alloc(60, 3)]), 'audio/aac')]
    out.tamano = [intentar(Buffer.concat([oggOpus(2), Buffer.alloc(5000)]), 'audio/ogg'), intentar(oggOpus(2), 'audio/ogg', { ...limites, maxBytes: 100 })]
    out.duracion = [intentar(oggOpus(59), 'audio/ogg'), intentar(oggOpus(61), 'audio/ogg'), a.duracionOggOpus(Buffer.from('OggS plain')), a.duracionOggOpus(oggOpus(3.5)) === 3.5]
    out.listaBlanca = [intentar(oggOpus(5), 'audio/ogg', { ...limites, allowedMimeTypes: ['audio/mpeg'] }), intentar(mp3Id3, 'audio/mpeg', { ...limites, allowedMimeTypes: ['audio/mpeg'] })]
    out.extension = ['audio/ogg', 'audio/mpeg', 'audio/mp4'].map(a.extensionDeAudio)
    // Environment: invalid or out-of-range values keep the safe defaults; formats outside the provider's are ignored.
    out.entornoVacio = a.leerLimitesAudio({})
    out.entorno = a.leerLimitesAudio({ WHATSAPP_AUDIO_TRANSCRIPTION: 'true', GROQ_STT_MODEL: 'whisper-large-v3', WHATSAPP_STT_MAX_BYTES: '2000000', WHATSAPP_STT_TIMEOUT_MS: '15000', WHATSAPP_STT_MAX_SECONDS: '90', WHATSAPP_STT_MIME_TYPES: 'audio/ogg, audio/amr, audio/mpeg' })
    out.entornoInvalido = a.leerLimitesAudio({ WHATSAPP_STT_MAX_BYTES: '999999999', WHATSAPP_STT_TIMEOUT_MS: 'abc', WHATSAPP_STT_MAX_SECONDS: '0', WHATSAPP_STT_MIME_TYPES: 'audio/amr' })
    // Confidence: only what the provider reports (Whisper's own thresholds); nothing when it reports nothing.
    out.confianza = [a.confianzaDeSegmentos(undefined), a.confianzaDeSegmentos([]), a.confianzaDeSegmentos([{ avg_logprob: -0.3, no_speech_prob: 0.01 }]), a.confianzaDeSegmentos([{ avg_logprob: -1.4, no_speech_prob: 0.1 }]), a.confianzaDeSegmentos([{ avg_logprob: -1.5, no_speech_prob: 0.9 }]), a.confianzaDeSegmentos([{ avg_logprob: -0.2, no_speech_prob: 0.9 }]), a.confianzaDeSegmentos([{ nada: 1 }])]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.formatos, [['audio/ogg', 5], ['audio/mpeg', null], ['audio/mpeg', null], ['audio/mp4', null]])
  assert.deepEqual(r.declaradoMentiroso, ['audio/ogg', 5], 'the content decides, not the declared type')
  assert.deepEqual(r.noAudioDeclarado, ['MIME_NOT_ALLOWED', 'MIME_NOT_ALLOWED', 'MIME_NOT_ALLOWED'])
  assert.deepEqual(r.contenidoNoAudio, ['CORRUPT', 'CORRUPT', 'EMPTY', 'CORRUPT'])
  assert.deepEqual(r.noSoportados, ['MIME_NOT_ALLOWED', 'MIME_NOT_ALLOWED'], 'raw AMR and AAC are not accepted by the provider and are not converted')
  assert.deepEqual(r.tamano, ['TOO_LARGE', 'TOO_LARGE'])
  assert.deepEqual(r.duracion, [['audio/ogg', 59], 'TOO_LONG', null, true])
  assert.deepEqual(r.listaBlanca, ['MIME_NOT_ALLOWED', ['audio/mpeg', null]])
  assert.deepEqual(r.extension, ['ogg', 'mp3', 'm4a'])
  assert.deepEqual(r.entornoVacio, { enabled: false, provider: 'groq', model: null, maxBytes: 16777216, timeoutMs: 30000, maxSeconds: 180, allowedMimeTypes: ['audio/ogg', 'audio/mpeg', 'audio/mp4'] })
  assert.deepEqual(r.entorno, { enabled: true, provider: 'groq', model: 'whisper-large-v3', maxBytes: 2000000, timeoutMs: 15000, maxSeconds: 90, allowedMimeTypes: ['audio/ogg', 'audio/mpeg'] })
  assert.deepEqual(r.entornoInvalido, r.entornoVacio)
  assert.deepEqual(r.confianza, ['desconocida', 'desconocida', 'normal', 'baja', 'sin_voz', 'normal', 'desconocida'])
})

test('Groq speech-to-text adapter: the original format is sent as is, the model and timeout come from configuration, confidence comes only from what Groq reports, failures are typed, and no key reaches the result', async () => {
  const r = runTypeScriptScenario(`
    const { TranscriptorGroq } = await import('./apps/api/src/tus/asistente/groq.ts')
    const { ErrorAudio } = await import('./apps/api/src/tus/asistente/audio.ts')
    // AbortSignal.timeout does not keep the process alive: something has to.
    const mantener = setInterval(() => {}, 100)
    const pedidos = []
    const responder = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) })
    let proxima = responder(200, { text: ' Quiero un masaje mañana ', segments: [{ avg_logprob: -0.3, no_speech_prob: 0.02 }] })
    const fetchFalso = async (url, init) => {
      const file = init.body.get('file')
      pedidos.push({ url: String(url), metodo: init.method, auth: init.headers?.authorization ? 'bearer' : null, modelo: init.body.get('model'), idioma: init.body.get('language'), formato: init.body.get('response_format'), nombre: file.name, tipo: file.type, tamano: file.size, conSenal: Boolean(init.signal) })
      if (proxima instanceof Error) throw proxima
      if (proxima === 'colgar') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))))
      return proxima
    }
    const stt = new TranscriptorGroq({ apiKey: 'fictitious-groq-key', model: 'whisper-large-v3', timeoutMs: 1000, fetch: fetchFalso })
    const audio = { bytes: Buffer.from('OggS-fake-bytes'), mimeType: 'audio/ogg' }
    const codigo = async () => { try { await stt.transcribirDetallado(audio); return 'ok' } catch (e) { return e instanceof ErrorAudio ? e.code : 'otro:' + e.message } }
    const out = {}
    out.normal = await stt.transcribirDetallado(audio)
    out.pedido = pedidos[0]
    out.mp3 = (await stt.transcribirDetallado({ bytes: Buffer.from('ID3xxxx'), mimeType: 'audio/mpeg' }), pedidos[1].nombre + ':' + pedidos[1].tipo)
    out.m4a = (await stt.transcribirDetallado({ bytes: Buffer.from('ftypxxxx'), mimeType: 'audio/mp4' }), pedidos[2].nombre + ':' + pedidos[2].tipo)
    out.textoPlano = await stt.transcribir(audio)
    proxima = responder(200, { text: 'hola' }); out.sinDatos = await stt.transcribirDetallado(audio)
    proxima = responder(200, { text: 'mmm', segments: [{ avg_logprob: -1.6, no_speech_prob: 0.95 }] }); out.silencio = await stt.transcribirDetallado(audio)
    proxima = responder(503, { error: 'down' }); out.http = await codigo()
    proxima = responder(200, { nada: true }); out.sinTexto = await codigo()
    proxima = new Error('socket'); out.red = await codigo()
    // A failed attempt puts the only credential in cooldown (pool behaviour): the timeout is read with a fresh adapter.
    const fresco = new TranscriptorGroq({ apiKey: 'fictitious-groq-key', model: 'whisper-large-v3', timeoutMs: 1000, fetch: fetchFalso })
    proxima = 'colgar'; out.timeout = await fresco.transcribirDetallado(audio).then(() => 'ok', (e) => (e instanceof ErrorAudio ? e.code : 'otro:' + e.message))
    out.sinClaveEnResultados = !JSON.stringify([out.normal, out.sinDatos, out.silencio]).includes('fictitious-groq-key')
    out.constructorSinClave = (() => { try { new TranscriptorGroq({}); return 'creado' } catch (e) { return e.message } })()
    clearInterval(mantener)
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.normal, { text: 'Quiero un masaje mañana', confianza: 'normal' })
  assert.equal(r.textoPlano, 'Quiero un masaje mañana', 'transcribir() keeps returning the plain text')
  assert.deepEqual(r.pedido, { url: 'https://api.groq.com/openai/v1/audio/transcriptions', metodo: 'POST', auth: 'bearer', modelo: 'whisper-large-v3', idioma: 'es', formato: 'verbose_json', nombre: 'audio.ogg', tipo: 'audio/ogg', tamano: 15, conSenal: true })
  assert.equal(r.mp3, 'audio.mp3:audio/mpeg')
  assert.equal(r.m4a, 'audio.m4a:audio/mp4')
  assert.deepEqual(r.sinDatos, { text: 'hola', confianza: 'desconocida' }, 'no confidence is invented when the provider gives none')
  assert.deepEqual(r.silencio, { text: 'mmm', confianza: 'sin_voz' })
  assert.deepEqual([r.http, r.sinTexto, r.red, r.timeout], ['STT_UNAVAILABLE', 'STT_UNAVAILABLE', 'STT_UNAVAILABLE', 'STT_TIMEOUT'])
  assert.equal(r.sinClaveEnResultados, true)
  assert.match(r.constructorSinClave, /GROQ_API_KEY is required/u)
})

test('Meta media download: only Meta hosts, a declared or real size above the cap is refused while it is being read (never buffered whole), and the bytes are returned only within the allowlist', async () => {
  const r = runTypeScriptScenario(`
    const { MetaWhatsappCloudProvider, ErrorMetaWhatsapp } = await import('./apps/api/src/tus/asistente/meta.ts')
    const respuesta = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => body })
    const flujo = (partes, headers = {}) => ({ ok: true, status: 200, headers: new Headers(headers), body: { getReader: () => { let i = 0; let cancelado = false; return { read: async () => (i < partes.length && !cancelado ? { done: false, value: partes[i++] } : { done: true }), cancel: async () => { cancelado = true } } } }, arrayBuffer: async () => { throw new Error('buffered whole') } })
    let info = { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'audio/ogg; codecs=opus', file_size: 100 }
    let descarga = flujo([new Uint8Array(40), new Uint8Array(40)])
    const pedidos = []
    const fetchFalso = async (url, init) => { pedidos.push(String(url)); return String(url).includes('graph.facebook.com') ? respuesta(200, info) : descarga }
    const meta = new MetaWhatsappCloudProvider({ accessToken: 'fictitious-token', phoneNumberId: '1234567890', graphApiVersion: 'v25.0' }, fetchFalso)
    const limites = { maxBytes: 100, allowedMimeTypes: ['audio/ogg', 'audio/mpeg'] }
    const intentar = async (l = limites) => { try { const m = await meta.downloadMedia('1234567', l); return [m.mimeType, m.bytes.length] } catch (e) { return e instanceof ErrorMetaWhatsapp ? e.message : 'otro:' + e.message } }
    const out = {}
    out.ok = await intentar()
    descarga = flujo([new Uint8Array(60), new Uint8Array(60)]); out.cuerpoMasGrandeQueElDeclarado = await intentar()
    descarga = flujo([new Uint8Array(10)], { 'content-length': '5000' }); out.contentLengthGrande = await intentar()
    info = { ...info, file_size: 5000 }; descarga = flujo([new Uint8Array(10)]); out.tamanoDeclaradoGrande = await intentar()
    info = { ...info, file_size: 10, mime_type: 'application/x-msdownload' }; out.mimeNoPermitido = await intentar()
    info = { ...info, mime_type: 'audio/ogg', url: 'https://evil.example.com/a.ogg' }; out.hostAjeno = await intentar()
    info = { ...info, url: 'http://lookaside.fbsbx.com/a.ogg' }; out.sinHttps = await intentar()
    out.idInvalido = await (async () => { try { await meta.downloadMedia('../etc', limites); return 'ok' } catch (e) { return e.message } })()
    out.descargasAjenas = pedidos.filter((url) => url.includes('evil.example.com') || url.startsWith('http://')).length
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.ok, ['audio/ogg', 80])
  assert.deepEqual([r.cuerpoMasGrandeQueElDeclarado, r.contentLengthGrande, r.tamanoDeclaradoGrande], ['media is too large', 'media is too large', 'media is too large'])
  assert.equal(r.mimeNoPermitido, 'media type is not allowed')
  assert.equal(r.hostAjeno, 'unexpected media host')
  assert.equal(r.sinHttps, 'unexpected media host')
  assert.equal(r.idInvalido, 'invalid media id')
  assert.equal(r.descargasAjenas, 0, 'the bearer token never goes to a host that is not Meta')
})

test('Meta media download failures: metadata and download errors (401, 403, 404, 429, 5xx, an expired URL), network failures and a hung body are classified without leaking the token or the URL; redirects are followed only to Meta hosts over HTTPS and the token stays on the first host', async () => {
  const r = runTypeScriptScenario(`
    const { MetaWhatsappCloudProvider, ErrorMetaWhatsapp } = await import('./apps/api/src/tus/asistente/meta.ts')
    const TOKEN = 'fictitious-token'
    const URL_MEDIO = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1&ext=1'
    const json = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body })
    const binario = (status, headers = {}, partes = [new Uint8Array(20)]) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), body: { getReader: () => { let i = 0; return { read: async () => (i < partes.length ? { done: false, value: partes[i++] } : { done: true }), cancel: async () => {} } } } })
    let metadatos = () => json(200, { url: URL_MEDIO, mime_type: 'image/jpeg', file_size: 20 })
    let descarga = () => binario(200)
    const pedidos = []
    const fetchFalso = async (url, init = {}) => {
      const destino = String(url)
      pedidos.push({ destino, conToken: new Headers(init.headers).get('authorization') === 'Bearer ' + TOKEN, redirect: init.redirect ?? null })
      return destino.includes('graph.facebook.com') ? metadatos() : descarga(destino, init)
    }
    const meta = new MetaWhatsappCloudProvider({ accessToken: TOKEN, phoneNumberId: '1234567890', graphApiVersion: 'v25.0', timeoutMs: 150 }, fetchFalso)
    const limites = { maxBytes: 100, allowedMimeTypes: ['image/jpeg', 'application/pdf'] }
    const errores = []
    const intentar = async () => { try { const m = await meta.downloadMedia('1234567', limites); return 'ok:' + m.bytes.length } catch (e) { errores.push(String(e.message) + ' ' + String(e.stack)); return e instanceof ErrorMetaWhatsapp ? e.code + ':' + e.message : 'otro:' + e.message } }
    const out = {}
    // AbortSignal.timeout does not keep the process alive on its own.
    const vivo = setInterval(() => {}, 1000)

    // Metadata request (Graph API).
    out.metadatos = {}
    for (const status of [401, 403, 404, 429, 500, 503]) { metadatos = () => json(status, { error: { message: 'x' } }); out.metadatos[status] = (await intentar()).split(':')[0] }
    metadatos = () => { throw new Error('socket hang up ' + TOKEN) }; out.metadatos.red = (await intentar()).split(':')[0]
    metadatos = () => json(200, { mime_type: 'image/jpeg' }); out.metadatos.sinUrl = await intentar()
    metadatos = () => json(200, { url: 'https://user:pass@lookaside.fbsbx.com/a', mime_type: 'image/jpeg' }); out.metadatos.urlConCredenciales = await intentar()
    metadatos = () => json(200, { url: 'https://fbsbx.com.evil.example/a', mime_type: 'image/jpeg' }); out.metadatos.hostParecido = await intentar()
    metadatos = () => json(200, { url: URL_MEDIO, mime_type: 'image/jpeg', file_size: 20 })

    // Download (the temporary URL): an expired URL answers 401/404.
    out.descarga = {}
    for (const status of [401, 403, 404, 429, 500, 503]) { descarga = () => binario(status); out.descarga[status] = await intentar() }
    descarga = () => { throw new Error('getaddrinfo ENOTFOUND ' + URL_MEDIO) }; out.descarga.red = await intentar()
    descarga = (_u, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
    let antes = Date.now(); out.descarga.colgada = await intentar(); out.descarga.colgadaAcotada = Date.now() - antes < 3000
    descarga = (_u, init) => ({ ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))), cancel: async () => {} }) } })
    antes = Date.now(); out.descarga.cuerpoColgado = await intentar(); out.descarga.cuerpoColgadoAcotado = Date.now() - antes < 3000
    descarga = () => binario(200, {}, []); out.descarga.vacia = await intentar()

    // Redirects.
    out.redireccion = {}
    const saltos = (ubicaciones) => { let i = 0; return () => { if (i >= ubicaciones.length) return binario(200); const ubicacion = ubicaciones[i++]; return binario(302, ubicacion === null ? {} : { location: ubicacion }) } }
    let desde = pedidos.length
    descarga = saltos(['https://scontent.xx.fbcdn.net/v/file.jpg']); out.redireccion.aMeta = await intentar()
    out.redireccion.tokenEnElSalto = pedidos.slice(desde).filter((p) => p.destino.includes('fbcdn.net')).map((p) => p.conToken)
    desde = pedidos.length
    descarga = saltos(['/whatsapp_business/otro']); out.redireccion.mismoHost = await intentar()
    out.redireccion.tokenMismoHost = pedidos.slice(desde).filter((p) => p.destino.includes('/whatsapp_business/otro')).map((p) => p.conToken)
    descarga = saltos(['https://evil.example.com/a']); out.redireccion.aOtroHost = await intentar()
    descarga = saltos(['http://lookaside.fbsbx.com/a']); out.redireccion.sinHttps = await intentar()
    descarga = saltos(['http://169.254.169.254/latest/meta-data']); out.redireccion.aRedInterna = await intentar()
    descarga = saltos([null]); out.redireccion.sinDestino = await intentar()
    descarga = saltos(['/a', '/b', '/c']); out.redireccion.demasiadas = await intentar()

    out.pedidosAjenos = pedidos.filter((p) => !/^https:\\/\\/([a-z0-9.-]+\\.)?(facebook\\.com|fbsbx\\.com|fbcdn\\.net)\\//u.test(p.destino)).length
    out.tokenFueraDelPrimerHost = pedidos.filter((p) => p.conToken && !/^https:\\/\\/(graph\\.facebook\\.com|lookaside\\.fbsbx\\.com)\\//u.test(p.destino)).length
    out.descargasSinRedireccionManual = pedidos.filter((p) => !p.destino.includes('graph.facebook.com') && p.redirect !== 'manual').length
    out.secretoEnErrores = errores.some((texto) => texto.includes(TOKEN) || texto.includes('mid=1'))
    clearInterval(vivo)
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.metadatos, {
    401: 'WHATSAPP_AUTH', 403: 'WHATSAPP_INVALID_REQUEST', 404: 'WHATSAPP_INVALID_REQUEST', 429: 'WHATSAPP_RATE_LIMITED', 500: 'WHATSAPP_UNAVAILABLE', 503: 'WHATSAPP_UNAVAILABLE',
    red: 'WHATSAPP_TIMEOUT',
    sinUrl: 'WHATSAPP_MEDIA:media type is not allowed',
    urlConCredenciales: 'WHATSAPP_MEDIA:unexpected media host',
    hostParecido: 'WHATSAPP_MEDIA:unexpected media host',
  })
  for (const status of [401, 403, 404, 429, 500, 503]) assert.equal(r.descarga[status], `WHATSAPP_MEDIA:media download failed with status ${status}`)
  assert.equal(r.descarga.red, 'WHATSAPP_MEDIA:media download timed out or failed')
  assert.deepEqual([r.descarga.colgada, r.descarga.colgadaAcotada], ['WHATSAPP_MEDIA:media download timed out or failed', true])
  assert.deepEqual([r.descarga.cuerpoColgado, r.descarga.cuerpoColgadoAcotado], ['WHATSAPP_MEDIA:media download timed out or failed', true], 'the deadline also covers the body')
  assert.equal(r.descarga.vacia, 'WHATSAPP_MEDIA:media size is invalid')
  assert.deepEqual([r.redireccion.aMeta, r.redireccion.tokenEnElSalto], ['ok:20', [false]], 'another origin does not receive the token')
  assert.deepEqual([r.redireccion.mismoHost, r.redireccion.tokenMismoHost], ['ok:20', [true]])
  assert.equal(r.redireccion.aOtroHost, 'WHATSAPP_MEDIA:unexpected media host')
  assert.equal(r.redireccion.sinHttps, 'WHATSAPP_MEDIA:unexpected media host')
  assert.equal(r.redireccion.aRedInterna, 'WHATSAPP_MEDIA:unexpected media host')
  assert.equal(r.redireccion.sinDestino, 'WHATSAPP_MEDIA:unexpected media redirect')
  assert.equal(r.redireccion.demasiadas, 'WHATSAPP_MEDIA:unexpected media redirect')
  assert.equal(r.pedidosAjenos, 0, 'nothing is requested from a host that is not Meta')
  assert.equal(r.tokenFueraDelPrimerHost, 0)
  assert.equal(r.descargasSinRedireccionManual, 0)
  assert.equal(r.secretoEnErrores, false, 'no error carries the token or the media URL')
})
