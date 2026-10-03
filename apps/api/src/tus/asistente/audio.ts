// TUS-WHATSAPP-MULTIMODAL-01: what a voice note must be before it reaches speech to text.
//
// Nothing the sender or Meta declares is trusted: the real bytes decide the format. Processing is
// in memory only (no temporary files, no conversion, no shell): the audio is downloaded, checked,
// sent to the STT provider and dropped. It is never stored.

export interface LimitesAudio {
  // Master switch: without it audios are answered with "I cannot listen to audios yet".
  enabled: boolean
  provider: 'groq'
  // Model of the STT provider (the provider adapter has its own default when null).
  model: string | null
  maxBytes: number
  timeoutMs: number
  // Longest audio accepted, in seconds, when the container lets it be measured safely (Ogg/Opus,
  // the format of WhatsApp voice notes). Other containers are bounded by `maxBytes` only.
  maxSeconds: number
  // Real formats accepted (after the content is identified), not the declared ones.
  allowedMimeTypes: readonly string[]
}

// Formats Whisper accepts without conversion: Ogg (Opus, the WhatsApp voice note), MP3 and MP4/M4A.
// Raw AAC and AMR are NOT accepted by the provider, and TUS does not convert them.
export const MIME_AUDIO_SOPORTADOS = ['audio/ogg', 'audio/mpeg', 'audio/mp4'] as const

export const LIMITES_AUDIO_POR_DEFECTO: LimitesAudio = {
  enabled: false,
  provider: 'groq',
  model: null,
  maxBytes: 16 * 1024 * 1024,
  timeoutMs: 30_000,
  maxSeconds: 180,
  allowedMimeTypes: MIME_AUDIO_SOPORTADOS,
}

const entero = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(value?.trim() ?? '', 10)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

// Environment (documented in docs/WHATSAPP_IA_TUS.md). Anything invalid keeps the safe default.
export function leerLimitesAudio(env: Record<string, string | undefined>): LimitesAudio {
  const permitidos = (env['WHATSAPP_STT_MIME_TYPES'] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => (MIME_AUDIO_SOPORTADOS as readonly string[]).includes(value))
  return {
    enabled: env['WHATSAPP_AUDIO_TRANSCRIPTION']?.trim() === 'true',
    provider: 'groq',
    model: env['GROQ_STT_MODEL']?.trim() || null,
    maxBytes: entero(env['WHATSAPP_STT_MAX_BYTES'], LIMITES_AUDIO_POR_DEFECTO.maxBytes, 1024, 25 * 1024 * 1024),
    timeoutMs: entero(env['WHATSAPP_STT_TIMEOUT_MS'], LIMITES_AUDIO_POR_DEFECTO.timeoutMs, 1_000, 120_000),
    maxSeconds: entero(env['WHATSAPP_STT_MAX_SECONDS'], LIMITES_AUDIO_POR_DEFECTO.maxSeconds, 1, 600),
    allowedMimeTypes: permitidos.length > 0 ? permitidos : MIME_AUDIO_SOPORTADOS,
  }
}

export type CodigoErrorAudio =
  | 'MIME_NOT_ALLOWED'
  | 'TOO_LARGE'
  | 'TOO_LONG'
  | 'CORRUPT'
  | 'EMPTY'
  | 'STT_TIMEOUT'
  | 'STT_UNAVAILABLE'
  | 'DOWNLOAD_FAILED'

export class ErrorAudio extends Error {
  constructor(
    readonly code: CodigoErrorAudio,
    message: string
  ) {
    super(message)
    this.name = 'ErrorAudio'
  }
}

type FormatoReal = 'ogg' | 'mp3' | 'mp4'

// The container of the bytes, by its signature. null: not an audio container TUS accepts.
export function detectarFormatoAudio(bytes: Buffer): FormatoReal | null {
  if (bytes.length < 12) return null
  if (bytes.toString('latin1', 0, 4) === 'OggS') return 'ogg'
  if (bytes.toString('latin1', 4, 8) === 'ftyp') return 'mp4'
  // MP3: an ID3 tag, or an MPEG audio frame header (11 bits of sync and a valid layer).
  if (bytes.toString('latin1', 0, 3) === 'ID3') return 'mp3'
  const b0 = bytes[0]!
  const b1 = bytes[1]!
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0 && (b1 & 0x06) !== 0x00 && (b1 & 0x18) !== 0x08) return 'mp3'
  return null
}

const MIME_DE: Record<FormatoReal, string> = { ogg: 'audio/ogg', mp3: 'audio/mpeg', mp4: 'audio/mp4' }
const EXTENSION_DE: Record<FormatoReal, string> = { ogg: 'ogg', mp3: 'mp3', mp4: 'm4a' }

export function extensionDeAudio(mimeType: string): string {
  return mimeType === 'audio/ogg' ? EXTENSION_DE.ogg : mimeType === 'audio/mpeg' ? EXTENSION_DE.mp3 : EXTENSION_DE.mp4
}

// Duration of an Ogg/Opus voice note: the granule position of its last page over 48 kHz, minus
// the pre-skip of its header. Bounds-checked; null when it cannot be read with certainty.
export function duracionOggOpus(bytes: Buffer): number | null {
  const head = bytes.indexOf('OpusHead')
  if (head < 0 || head > 512 || head + 12 > bytes.length) return null
  const preSkip = bytes.readUInt16LE(head + 10)
  const last = bytes.lastIndexOf('OggS')
  if (last < 0 || last + 14 > bytes.length) return null
  const granule = bytes.readBigInt64LE(last + 6)
  if (granule <= 0n) return null
  const seconds = Number(granule - BigInt(preSkip)) / 48_000
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

export interface AudioValidado {
  mimeType: string
  bytes: Buffer
  durationSeconds: number | null
}

// Checks the real audio. The declared type only has to be an audio family: the content decides.
export function validarAudio(bytes: Buffer, declaredMimeType: string | null, limits: LimitesAudio): AudioValidado {
  if (bytes.length === 0) throw new ErrorAudio('EMPTY', 'audio is empty')
  if (bytes.length > limits.maxBytes) throw new ErrorAudio('TOO_LARGE', 'audio is too large')
  const declared = (declaredMimeType ?? '').split(';')[0]!.trim().toLowerCase()
  if (!declared.startsWith('audio/')) throw new ErrorAudio('MIME_NOT_ALLOWED', 'declared type is not audio')
  const real = detectarFormatoAudio(bytes)
  if (!real) {
    // Raw AAC and AMR are real WhatsApp audio formats the STT provider does not accept (no conversion).
    const noSoportado = declared === 'audio/aac' || declared === 'audio/amr' || bytes.toString('latin1', 0, 6) === '#!AMR\n' || (bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0)
    throw new ErrorAudio(noSoportado ? 'MIME_NOT_ALLOWED' : 'CORRUPT', 'content is not a supported audio container')
  }
  const mimeType = MIME_DE[real]
  if (!limits.allowedMimeTypes.includes(mimeType)) throw new ErrorAudio('MIME_NOT_ALLOWED', 'audio format is not allowed')
  const durationSeconds = real === 'ogg' ? duracionOggOpus(bytes) : null
  if (durationSeconds !== null && durationSeconds > limits.maxSeconds) throw new ErrorAudio('TOO_LONG', 'audio is too long')
  return { mimeType, bytes, durationSeconds }
}

// What the STT provider says about how sure it is, when (and only when) it says it.
//   desconocida  the provider returned no confidence data: nothing is invented
//   normal       the speech was recognised
//   baja         the transcription is probably wrong: the person is asked to repeat
//   sin_voz      no speech was detected
export type ConfianzaTranscripcion = 'desconocida' | 'normal' | 'baja' | 'sin_voz'

export interface ResultadoTranscripcion {
  text: string
  confianza: ConfianzaTranscripcion
}

// Whisper's own decision thresholds (its reference implementation): a segment is silence when
// no_speech_prob > 0.6 and avg_logprob < -1; a transcription is unreliable when avg_logprob < -1.
export function confianzaDeSegmentos(segments: unknown): ConfianzaTranscripcion {
  if (!Array.isArray(segments) || segments.length === 0) return 'desconocida'
  const datos = segments
    .map((segment) => (segment && typeof segment === 'object' ? (segment as Record<string, unknown>) : {}))
    .map((segment) => ({ logprob: Number(segment['avg_logprob']), sinVoz: Number(segment['no_speech_prob']) }))
    .filter((segment) => Number.isFinite(segment.logprob) && Number.isFinite(segment.sinVoz))
  if (datos.length === 0) return 'desconocida'
  if (datos.every((segment) => segment.sinVoz > 0.6 && segment.logprob < -1)) return 'sin_voz'
  const promedio = datos.reduce((total, segment) => total + segment.logprob, 0) / datos.length
  return promedio < -1 ? 'baja' : 'normal'
}
