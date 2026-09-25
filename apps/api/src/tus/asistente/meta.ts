import { createHmac, timingSafeEqual } from 'node:crypto'

// WHATSAPP-AI-01: official Meta WhatsApp Business Platform (Cloud API) boundary. Every Graph API
// call goes through `MetaWhatsappCloudProvider`; nothing else calls graph.facebook.com.
// Docs checked 2026-09: webhook verification (hub.*), X-Hub-Signature-256 = sha256 HMAC of the
// raw payload with the App Secret, messages API, read + typing indicator, interactive reply
// buttons (max 3, title <= 20 chars), CTA URL, templates, media retrieval.

export const GRAPH_API_VERSION_POR_DEFECTO = 'v25.0'
export const LIMITE_TEXTO_WHATSAPP = 4096
export const VENTANA_SERVICIO_MS = 24 * 60 * 60 * 1000

export interface ConfiguracionWhatsapp {
  enabled: boolean
  graphApiVersion: string
  accessToken: string | null
  phoneNumberId: string | null
  wabaId: string | null
  appSecret: string | null
  verifyToken: string | null
  businessPhoneNumber: string | null
  problems: string[]
}

// Reads configuration; secrets are kept only in memory and are never logged or returned.
export function leerConfiguracionWhatsapp(
  env: Record<string, string | undefined>
): ConfiguracionWhatsapp {
  const value = (name: string) => env[name]?.trim() || null
  const tusEnabled = env['TUS_WHATSAPP_ENABLED']?.trim()
  const legacyEnabled = env['WHATSAPP_ENABLED']?.trim()
  const enabledValue = tusEnabled ?? legacyEnabled
  const enabled = enabledValue === 'true'
  const graphApiVersion = value('WHATSAPP_GRAPH_API_VERSION') ?? GRAPH_API_VERSION_POR_DEFECTO
  const problems: string[] = []
  if (tusEnabled !== undefined && legacyEnabled !== undefined && tusEnabled !== legacyEnabled)
    problems.push('TUS_WHATSAPP_ENABLED and WHATSAPP_ENABLED must not disagree')
  if (!/^v\d{1,3}\.\d$/u.test(graphApiVersion))
    problems.push('WHATSAPP_GRAPH_API_VERSION must look like v25.0')
  const enabledBy = tusEnabled !== undefined ? 'TUS_WHATSAPP_ENABLED' : 'WHATSAPP_ENABLED'
  if (enabled) {
    for (const name of [
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    ])
      if (!value(name)) problems.push(`${name} is required when ${enabledBy}=true`)
    const phoneNumberId = value('WHATSAPP_PHONE_NUMBER_ID')
    if (phoneNumberId && !/^\d{5,30}$/u.test(phoneNumberId))
      problems.push('WHATSAPP_PHONE_NUMBER_ID must be numeric')
    const verifyToken = value('WHATSAPP_WEBHOOK_VERIFY_TOKEN')
    if (verifyToken && verifyToken.length < 16)
      problems.push('WHATSAPP_WEBHOOK_VERIFY_TOKEN must have at least 16 characters')
  }
  return {
    enabled,
    graphApiVersion,
    accessToken: value('WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId: value('WHATSAPP_PHONE_NUMBER_ID'),
    wabaId: value('WHATSAPP_WABA_ID'),
    appSecret: value('WHATSAPP_APP_SECRET'),
    verifyToken: value('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
    businessPhoneNumber: value('WHATSAPP_BUSINESS_PHONE_NUMBER'),
    problems,
  }
}

function igualesTiempoConstante(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

// GET handshake: only echo the challenge when mode=subscribe and the token matches.
export function verificarSuscripcionWebhook(
  query: { mode: unknown; verifyToken: unknown; challenge: unknown },
  expectedToken: string | null
): string | null {
  if (!expectedToken) return null
  if (
    query.mode !== 'subscribe' ||
    typeof query.verifyToken !== 'string' ||
    typeof query.challenge !== 'string'
  )
    return null
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(query.challenge)) return null
  return igualesTiempoConstante(query.verifyToken, expectedToken) ? query.challenge : null
}

// POST authenticity: HMAC-SHA256 of the ORIGINAL bytes with the App Secret, timing-safe.
export function verificarFirmaMeta(
  rawBody: Buffer,
  header: unknown,
  appSecret: string | null
): boolean {
  if (!appSecret || !Buffer.isBuffer(rawBody) || typeof header !== 'string') return false
  const match = /^sha256=([0-9a-f]{64})$/u.exec(header.trim())
  if (!match) return false
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')
  return igualesTiempoConstante(match[1]!, expected)
}

export function firmarPayloadMeta(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`
}

// ---- normalized webhook events -------------------------------------------------------------

export type TipoMensajeEntrante =
  'text' | 'image' | 'audio' | 'location' | 'interactive' | 'button' | 'unsupported'

export interface MensajeEntranteMeta {
  kind: 'message'
  wamid: string
  waId: string
  displayName: string | null
  phoneNumberId: string
  timestamp: number
  type: TipoMensajeEntrante
  text: string | null
  // Interactive reply (button id) chosen by the user.
  replyId: string | null
  replyToWamid: string | null
  media: { id: string; mimeType: string | null; sha256: string | null } | null
  location: { latitude: number; longitude: number; name: string | null } | null
}

export type EstadoEntregaMeta = 'sent' | 'delivered' | 'read' | 'failed'

export interface EstadoMensajeMeta {
  kind: 'status'
  wamid: string
  status: EstadoEntregaMeta
  timestamp: number
  recipientWaId: string | null
  errorCode: number | null
}

export type EventoWebhookMeta = MensajeEntranteMeta | EstadoMensajeMeta

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

// Parses the Cloud API "whatsapp_business_account" payload into minimal events. Unknown shapes are
// ignored (never thrown) so that one odd entry cannot block the rest of the batch.
export function parsearWebhookMeta(
  payload: unknown,
  phoneNumberId: string | null
): EventoWebhookMeta[] {
  const root = asRecord(payload)
  if (root['object'] !== 'whatsapp_business_account') return []
  const events: EventoWebhookMeta[] = []
  for (const entry of asArray(root['entry'])) {
    for (const change of asArray(asRecord(entry)['changes'])) {
      const changeRecord = asRecord(change)
      if (changeRecord['field'] !== 'messages') continue
      const value = asRecord(changeRecord['value'])
      const metadata = asRecord(value['metadata'])
      const destination = asString(metadata['phone_number_id'])
      // Only events addressed to the configured TUS number are accepted.
      if (!destination || (phoneNumberId && destination !== phoneNumberId)) continue
      const names = new Map<string, string>()
      for (const contact of asArray(value['contacts'])) {
        const record = asRecord(contact)
        const waId = asString(record['wa_id'])
        const name = asString(asRecord(record['profile'])['name'])
        if (waId && name) names.set(waId, name.slice(0, 120))
      }
      for (const raw of asArray(value['messages'])) {
        const message = asRecord(raw)
        const wamid = asString(message['id'])
        const waId = asString(message['from'])
        const timestamp = Number(message['timestamp'])
        if (!wamid || !waId || !Number.isFinite(timestamp)) continue
        const type = asString(message['type']) ?? 'unsupported'
        const base = {
          kind: 'message' as const,
          wamid,
          waId,
          displayName: names.get(waId) ?? null,
          phoneNumberId: destination,
          timestamp: timestamp * 1000,
          replyToWamid: asString(asRecord(message['context'])['id']),
          media: null,
          location: null,
          replyId: null,
          text: null,
        }
        if (type === 'text') {
          events.push({ ...base, type: 'text', text: asString(asRecord(message['text'])['body']) })
        } else if (type === 'image' || type === 'audio') {
          const media = asRecord(message[type])
          const id = asString(media['id'])
          events.push({
            ...base,
            type: id ? type : 'unsupported',
            text: asString(media['caption']),
            media: id
              ? { id, mimeType: asString(media['mime_type']), sha256: asString(media['sha256']) }
              : null,
          })
        } else if (type === 'location') {
          const location = asRecord(message['location'])
          const latitude = Number(location['latitude'])
          const longitude = Number(location['longitude'])
          events.push(
            Number.isFinite(latitude) &&
              Number.isFinite(longitude) &&
              Math.abs(latitude) <= 90 &&
              Math.abs(longitude) <= 180
              ? {
                  ...base,
                  type: 'location',
                  location: { latitude, longitude, name: asString(location['name']) },
                }
              : { ...base, type: 'unsupported' }
          )
        } else if (type === 'interactive') {
          const interactive = asRecord(message['interactive'])
          const reply = asRecord(interactive['button_reply'] ?? interactive['list_reply'])
          events.push({
            ...base,
            type: 'interactive',
            replyId: asString(reply['id']),
            text: asString(reply['title']),
          })
        } else if (type === 'button') {
          const button = asRecord(message['button'])
          events.push({
            ...base,
            type: 'button',
            replyId: asString(button['payload']),
            text: asString(button['text']),
          })
        } else {
          events.push({ ...base, type: 'unsupported' })
        }
      }
      for (const raw of asArray(value['statuses'])) {
        const status = asRecord(raw)
        const wamid = asString(status['id'])
        const state = asString(status['status'])
        const timestamp = Number(status['timestamp'])
        if (
          !wamid ||
          !state ||
          !['sent', 'delivered', 'read', 'failed'].includes(state) ||
          !Number.isFinite(timestamp)
        )
          continue
        const firstError = asRecord(asArray(status['errors'])[0])
        events.push({
          kind: 'status',
          wamid,
          status: state as EstadoEntregaMeta,
          timestamp: timestamp * 1000,
          recipientWaId: asString(status['recipient_id']),
          errorCode: Number.isFinite(Number(firstError['code']))
            ? Number(firstError['code'])
            : null,
        })
      }
    }
  }
  return events
}

// ---- provider (Graph API client) ------------------------------------------------------------

export interface BotonRespuesta {
  id: string
  title: string
}

export type MensajeSaliente =
  | { type: 'text'; text: string }
  | { type: 'buttons'; text: string; buttons: BotonRespuesta[] }
  | { type: 'cta_url'; text: string; label: string; url: string }
  | { type: 'template'; name: string; language: string; parameters: string[] }

export interface ResultadoEnvioMeta {
  wamid: string
}

export interface MediaMeta {
  mimeType: string
  bytes: Buffer
}

export class ErrorMetaWhatsapp extends Error {
  constructor(
    readonly code:
      | 'WHATSAPP_NOT_CONFIGURED'
      | 'WHATSAPP_AUTH'
      | 'WHATSAPP_RATE_LIMITED'
      | 'WHATSAPP_WINDOW_CLOSED'
      | 'WHATSAPP_INVALID_REQUEST'
      | 'WHATSAPP_MEDIA'
      | 'WHATSAPP_UNAVAILABLE'
      | 'WHATSAPP_TIMEOUT',
    message: string,
    readonly metaCode: number | null = null,
    // True when the request may have reached Meta (unknown outcome): do not blindly resend.
    readonly ambiguous = false
  ) {
    super(message)
    this.name = 'ErrorMetaWhatsapp'
  }
}

export interface WhatsappProvider {
  readonly id: 'meta' | 'fake'
  send(
    to: string,
    message: MensajeSaliente,
    options?: { replyToWamid?: string }
  ): Promise<ResultadoEnvioMeta>
  // Marks an inbound message as read and shows "typing" (best effort; never throws upstream).
  markReadTyping(wamid: string): Promise<void>
  downloadMedia(
    mediaId: string,
    limits: { maxBytes: number; allowedMimeTypes: readonly string[] }
  ): Promise<MediaMeta>
}

// Maps Graph API errors to safe codes (never includes the token or the raw payload).
export function mapearErrorMeta(status: number, body: unknown): ErrorMetaWhatsapp {
  const error = asRecord(asRecord(body)['error'])
  const metaCode = Number.isFinite(Number(error['code'])) ? Number(error['code']) : null
  if (status === 401 || metaCode === 190)
    return new ErrorMetaWhatsapp('WHATSAPP_AUTH', 'Meta rejected the access token', metaCode)
  if (metaCode === 131047)
    return new ErrorMetaWhatsapp(
      'WHATSAPP_WINDOW_CLOSED',
      'customer service window is closed; a template is required',
      metaCode
    )
  if (status === 429 || metaCode === 130429 || metaCode === 131056 || metaCode === 80007)
    return new ErrorMetaWhatsapp('WHATSAPP_RATE_LIMITED', 'Meta rate limit reached', metaCode)
  if (status >= 500)
    return new ErrorMetaWhatsapp('WHATSAPP_UNAVAILABLE', 'Meta is unavailable', metaCode, true)
  return new ErrorMetaWhatsapp('WHATSAPP_INVALID_REQUEST', 'Meta rejected the request', metaCode)
}

export function cuerpoMensajeMeta(
  to: string,
  message: MensajeSaliente,
  replyToWamid?: string
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    ...(replyToWamid ? { context: { message_id: replyToWamid } } : {}),
  }
  const text = (value: string, max: number) => value.slice(0, max)
  if (message.type === 'text')
    return {
      ...base,
      type: 'text',
      text: { preview_url: false, body: text(message.text, LIMITE_TEXTO_WHATSAPP) },
    }
  if (message.type === 'buttons')
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: text(message.text, 1024) },
        action: {
          buttons: message.buttons.slice(0, 3).map((button) => ({
            type: 'reply',
            reply: { id: text(button.id, 256), title: text(button.title, 20) },
          })),
        },
      },
    }
  if (message.type === 'cta_url')
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: text(message.text, 1024) },
        action: {
          name: 'cta_url',
          parameters: { display_text: text(message.label, 20), url: message.url },
        },
      },
    }
  return {
    ...base,
    type: 'template',
    template: {
      name: message.name,
      language: { code: message.language },
      ...(message.parameters.length > 0
        ? {
            components: [
              {
                type: 'body',
                parameters: message.parameters.map((value) => ({ type: 'text', text: value })),
              },
            ],
          }
        : {}),
    },
  }
}

export class MetaWhatsappCloudProvider implements WhatsappProvider {
  readonly id = 'meta' as const
  private readonly base: string

  constructor(
    private readonly config: {
      accessToken: string
      phoneNumberId: string
      graphApiVersion: string
      timeoutMs?: number
    },
    private readonly fetchImpl: typeof fetch = fetch,
    baseUrl = 'https://graph.facebook.com'
  ) {
    this.base = `${baseUrl}/${config.graphApiVersion}`
  }

  async send(
    to: string,
    message: MensajeSaliente,
    options: { replyToWamid?: string } = {}
  ): Promise<ResultadoEnvioMeta> {
    const payload = await this.request(
      'POST',
      `/${this.config.phoneNumberId}/messages`,
      cuerpoMensajeMeta(to, message, options.replyToWamid)
    )
    const wamid = asString(asRecord(asArray(asRecord(payload)['messages'])[0])['id'])
    if (!wamid)
      throw new ErrorMetaWhatsapp(
        'WHATSAPP_UNAVAILABLE',
        'Meta did not return a message id',
        null,
        true
      )
    return { wamid }
  }

  async markReadTyping(wamid: string): Promise<void> {
    try {
      await this.request('POST', `/${this.config.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: wamid,
        typing_indicator: { type: 'text' },
      })
    } catch {
      // Best effort only.
    }
  }

  async downloadMedia(
    mediaId: string,
    limits: { maxBytes: number; allowedMimeTypes: readonly string[] }
  ): Promise<MediaMeta> {
    if (!/^\d{3,40}$/u.test(mediaId))
      throw new ErrorMetaWhatsapp('WHATSAPP_MEDIA', 'invalid media id')
    const info = asRecord(await this.request('GET', `/${mediaId}`))
    const url = asString(info['url'])
    const mimeType = asString(info['mime_type'])?.split(';')[0]?.trim() ?? null
    const size = Number(info['file_size'])
    if (!url || !mimeType || !limits.allowedMimeTypes.includes(mimeType))
      throw new ErrorMetaWhatsapp('WHATSAPP_MEDIA', 'media type is not allowed')
    if (Number.isFinite(size) && size > limits.maxBytes)
      throw new ErrorMetaWhatsapp('WHATSAPP_MEDIA', 'media is too large')
    // Media URLs are only downloadable from Meta hosts with the same bearer token.
    let mediaUrl: URL
    try {
      mediaUrl = new URL(url)
    } catch {
      throw new ErrorMetaWhatsapp('WHATSAPP_MEDIA', 'invalid media URL')
    }
    if (
      mediaUrl.protocol !== 'https:' ||
      !/(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net)$/u.test(mediaUrl.hostname)
    )
      throw new ErrorMetaWhatsapp('WHATSAPP_MEDIA', 'unexpected media host')
    const response = await this.fetchImpl(mediaUrl, {
      headers: { authorization: `Bearer ${this.config.accessToken}` },
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
    })
    if (!response.ok)
      throw new ErrorMetaWhatsapp(
        'WHATSAPP_MEDIA',
        `media download failed with status ${response.status}`
      )
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > limits.maxBytes)
      throw new ErrorMetaWhatsapp('WHATSAPP_MEDIA', 'media size is invalid')
    return { mimeType, bytes }
  }

  // Read-only checks for `pnpm tus:whatsapp:check`.
  async describirNumero(): Promise<{
    verifiedName: string | null
    displayPhoneNumber: string | null
    qualityRating: string | null
  }> {
    const info = asRecord(
      await this.request(
        'GET',
        `/${this.config.phoneNumberId}?fields=verified_name,display_phone_number,quality_rating`
      )
    )
    return {
      verifiedName: asString(info['verified_name']),
      displayPhoneNumber: asString(info['display_phone_number']),
      qualityRating: asString(info['quality_rating']),
    }
  }

  async appsSuscritas(wabaId: string): Promise<number> {
    const info = asRecord(await this.request('GET', `/${wabaId}/subscribed_apps`))
    return asArray(info['data']).length
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      })
    } catch {
      throw new ErrorMetaWhatsapp(
        'WHATSAPP_TIMEOUT',
        'Meta request timed out or failed',
        null,
        method === 'POST'
      )
    }
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw mapearErrorMeta(response.status, payload)
    return payload
  }
}

// Deterministic provider for tests and local development: never calls Meta.
export class FakeWhatsappProvider implements WhatsappProvider {
  readonly id = 'fake' as const
  readonly sent: { to: string; message: MensajeSaliente; wamid: string; replyToWamid?: string }[] =
    []
  readonly reads: string[] = []
  readonly media = new Map<string, MediaMeta>()
  private failures: ErrorMetaWhatsapp[] = []
  private sequence = 0

  fallarProximo(error: ErrorMetaWhatsapp): void {
    this.failures.push(error)
  }

  async send(
    to: string,
    message: MensajeSaliente,
    options: { replyToWamid?: string } = {}
  ): Promise<ResultadoEnvioMeta> {
    const failure = this.failures.shift()
    if (failure) throw failure
    this.sequence += 1
    const wamid = `wamid.fake-out-${this.sequence}`
    this.sent.push({
      to,
      message,
      wamid,
      ...(options.replyToWamid ? { replyToWamid: options.replyToWamid } : {}),
    })
    return { wamid }
  }

  async markReadTyping(wamid: string): Promise<void> {
    this.reads.push(wamid)
  }

  async downloadMedia(
    mediaId: string,
    limits: { maxBytes: number; allowedMimeTypes: readonly string[] }
  ): Promise<MediaMeta> {
    const media = this.media.get(mediaId)
    if (
      !media ||
      !limits.allowedMimeTypes.includes(media.mimeType) ||
      media.bytes.length > limits.maxBytes
    )
      throw new ErrorMetaWhatsapp('WHATSAPP_MEDIA', 'media is not available')
    return media
  }

  textos(): string[] {
    return this.sent.map((item) =>
      item.message.type === 'template' ? `template:${item.message.name}` : item.message.text
    )
  }
}
