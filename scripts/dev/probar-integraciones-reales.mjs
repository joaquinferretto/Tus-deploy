// Real, READ-ONLY checks of the external integrations of the WhatsApp assistant. Nothing here
// sends a message, creates, captures, refunds or cancels a payment, or writes to a database, and
// no secret is ever printed (only whether it is present).
//
//   node apps/api/node_modules/tsx/dist/cli.mjs scripts/dev/probar-integraciones-reales.mjs <check> [args]
//
//   groq-vision <synthetic image>      reads a SYNTHETIC receipt with Groq vision (GROQ_API_KEY*).
//                                      The image leaves this machine: never use a real receipt.
//   meta [mediaId]                     GET of the WhatsApp number (WHATSAPP_ACCESS_TOKEN,
//                                      WHATSAPP_PHONE_NUMBER_ID); with a media id (taken from a
//                                      webhook of a controlled test message) also downloads it in
//                                      memory and prints only its type, size and validation.
//   mercado-pago <external reference>  GET /v1/payments/search with TUS's own account
//                                      (MERCADO_PAGO_PLATFORM_ACCESS_TOKEN and _USER_ID). Prints
//                                      counts and statuses, never payer data.
//
// Exit code: 0 verified, 1 the check failed, 2 the credential is missing (nothing was contacted).
import { readFileSync } from 'node:fs'

const [check, argumento] = process.argv.slice(2)
const env = process.env
const presente = (nombre) => Boolean(env[nombre]?.trim())
const faltan = (nombres) => {
  const ausentes = nombres.filter((nombre) => !presente(nombre))
  if (ausentes.length === 0) return false
  console.log('NOT RUN: missing ' + ausentes.join(', ') + ' (nothing was contacted)')
  process.exitCode = 2
  return true
}
const fallo = (error) => {
  // Only a code or a name: a provider error may carry request details.
  console.log('FAILED', error?.code ?? error?.name ?? 'error')
  process.exitCode = 1
}

if (check === 'groq-vision') {
  const { crearPoolCredencialesGroq } = await import('../../apps/api/src/providers/groq/index.ts')
  const c = await import('../../apps/api/src/tus/asistente/comprobantes.ts')
  const pool = crearPoolCredencialesGroq(env)
  if (!pool) {
    console.log('NOT RUN: no Groq credential (GROQ_API_KEY or GROQ_API_KEY_1..6); nothing was contacted')
    process.exitCode = 2
  } else if (!argumento) {
    console.log('usage: groq-vision <synthetic image>')
    process.exitCode = 2
  } else {
    const limites = c.LIMITES_COMPROBANTE_POR_DEFECTO
    const formato = env.GROQ_VISION_RESPONSE_FORMAT?.trim() === 'json_schema' ? 'json_schema' : 'json_object'
    const modelo = new c.ModeloVisionComprobanteGroq({ pool, model: env.GROQ_VISION_MODEL?.trim() || undefined, responseFormat: formato, timeoutMs: limites.timeoutMs })
    const sinPdf = { extraer: async () => { throw new c.ErrorComprobante('ANALYZER_UNAVAILABLE', 'not used') }, disponibilidad: async () => ({ available: false, reason: 'missing' }) }
    const analizador = new c.AnalizadorComprobanteVision(modelo, sinPdf, limites)
    try {
      const mime = /\.jpe?g$/iu.test(argumento) ? 'image/jpeg' : /\.webp$/iu.test(argumento) ? 'image/webp' : 'image/png'
      const archivo = c.validarComprobante(readFileSync(argumento), mime, limites)
      const inicio = Date.now()
      const evidencia = await analizador.analizar(archivo)
      console.log('VERIFIED groq-vision', JSON.stringify({ responseFormat: formato, ms: Date.now() - inicio, evidence: evidencia }))
      console.log('The evidence is untrusted: it confirms no payment.')
    } catch (error) {
      fallo(error)
    }
  }
} else if (check === 'meta') {
  if (!faltan(['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'])) {
    const { MetaWhatsappCloudProvider, leerConfiguracionWhatsapp } = await import('../../apps/api/src/tus/asistente/meta.ts')
    const config = leerConfiguracionWhatsapp(env)
    const meta = new MetaWhatsappCloudProvider({ accessToken: config.accessToken, phoneNumberId: config.phoneNumberId, graphApiVersion: config.graphApiVersion })
    try {
      const numero = await meta.describirNumero()
      console.log('VERIFIED meta number', JSON.stringify({ graphApiVersion: config.graphApiVersion, hasVerifiedName: Boolean(numero.verifiedName), qualityRating: numero.qualityRating }))
      if (argumento) {
        const c = await import('../../apps/api/src/tus/asistente/comprobantes.ts')
        const limites = c.LIMITES_COMPROBANTE_POR_DEFECTO
        const inicio = Date.now()
        const medio = await meta.downloadMedia(argumento, { maxBytes: Math.max(limites.maxImageBytes, limites.maxPdfBytes), allowedMimeTypes: [...limites.allowedMimeTypes, 'image/jpg', 'audio/ogg', 'audio/mpeg', 'audio/mp4'] })
        let validacion = 'not a receipt type'
        if (limites.allowedMimeTypes.includes(medio.mimeType)) {
          try {
            validacion = 'valid ' + c.validarComprobante(medio.bytes, medio.mimeType, limites).kind
          } catch (error) {
            validacion = 'rejected ' + (error?.code ?? 'error')
          }
        }
        // The bytes stay in memory and are dropped here: nothing is written to disk.
        console.log('VERIFIED meta media download', JSON.stringify({ mimeType: medio.mimeType, bytes: medio.bytes.length, ms: Date.now() - inicio, magicBytes: validacion }))
      } else {
        console.log('Media download NOT RUN: pass the media id of a controlled test message.')
      }
    } catch (error) {
      fallo(error)
    }
  }
} else if (check === 'mercado-pago') {
  if (!argumento) {
    console.log('usage: mercado-pago <external reference of a TUS payment intent>')
    process.exitCode = 2
  } else if (!faltan(['MERCADO_PAGO_PLATFORM_ACCESS_TOKEN', 'MERCADO_PAGO_PLATFORM_USER_ID'])) {
    const { ProveedorPagosMercadoPago } = await import('../../apps/api/src/tus/finance/servicios/mercado-pago.ts')
    const pedidos = []
    // Guard of this script: only GET requests to the payment search are let through.
    const soloLectura = async (url, init) => {
      const destino = new URL(url)
      if (init.method !== 'GET' || destino.hostname !== 'api.mercadopago.com' || destino.pathname !== '/v1/payments/search') throw new Error('blocked: not a read-only payment search')
      pedidos.push(destino.searchParams.get('offset'))
      return fetch(url, init)
    }
    const proveedor = new ProveedorPagosMercadoPago(
      {
        environment: env.MERCADO_PAGO_ENVIRONMENT?.trim() === 'production' ? 'production' : 'sandbox',
        webhookSecret: 'not-used-by-this-check',
        notificationUrl: 'https://not-used.invalid/hook',
        webBaseUrl: 'https://not-used.invalid',
        fetch: soloLectura,
        plataforma: { accessToken: env.MERCADO_PAGO_PLATFORM_ACCESS_TOKEN.trim(), userId: env.MERCADO_PAGO_PLATFORM_USER_ID.trim() },
      },
      { tokenVigente: async () => { throw new Error('seller accounts are not used by this check') }, cuentaPorExterna: async () => null }
    )
    try {
      const eventos = await proveedor.consultarPagos({ paymentId: argumento, collectionMode: 'plataforma', prestadorTenantId: 'not-used' })
      const estados = {}
      for (const evento of eventos) estados[evento.status] = (estados[evento.status] ?? 0) + 1
      console.log('VERIFIED mercado-pago search', JSON.stringify({ requests: pedidos.length, payments: eventos.length, statuses: estados, currencies: [...new Set(eventos.map((evento) => evento.currency))], allOfThisReference: eventos.every((evento) => evento.paymentId === argumento), allCollectedByTus: eventos.every((evento) => evento.collectorId === env.MERCADO_PAGO_PLATFORM_USER_ID.trim()) }))
      console.log('Nothing was applied: this check does not touch the TUS ledger.')
    } catch (error) {
      fallo(error)
    }
  }
} else {
  console.log('usage: probar-integraciones-reales.mjs groq-vision <synthetic image> | meta [mediaId] | mercado-pago <external reference>')
  process.exitCode = 2
}
