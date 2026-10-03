import * as z from 'zod/v4'
import { crearPoolCredencialesGroq, type GroqCredentialPool } from '../../providers/groq/index.ts'
import { normalizarDni, type LecturaDocumento } from './modelo.ts'

// Document readers only produce CANDIDATE data. Neither reader verifies identity.

export interface ImagenParaLectura {
  side: 'front' | 'back'
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  bytes: Buffer
}

export interface IdentityDocumentReader {
  readonly kind: 'ocr' | 'vision'
  leer(images: ImagenParaLectura[]): Promise<LecturaDocumento>
}

export function lecturaNoDisponible(kind: 'ocr' | 'vision'): LecturaDocumento {
  return {
    reader: kind,
    documentNumber: null,
    firstName: null,
    lastName: null,
    birthDate: null,
    sex: null,
    nationality: null,
    expirationDate: null,
    confidence: 0,
    unavailable: true,
  }
}

// ---- OCR -----------------------------------------------------------------------------------

// Whether the local OCR can run here, and why not. Never a path or file content.
export interface DisponibilidadOcr {
  available: boolean
  reason: 'ok' | 'lang_path_not_set' | 'lang_path_not_local' | 'language_data_missing' | 'engine_failed'
  languages: string[]
  missing: string[]
}

export interface MotorOcr {
  reconocer(image: ImagenParaLectura): Promise<{ text: string; confidence: number }>
  // Stops the engine (after a timeout or a failure); the next reading starts a fresh one.
  reiniciar?(): Promise<void>
  disponibilidad?(): Promise<DisponibilidadOcr>
}

export class ErrorOcrNoDisponible extends Error {
  constructor(readonly reason: DisponibilidadOcr['reason']) {
    super(`local OCR is not available: ${reason}`)
    this.name = 'ErrorOcrNoDisponible'
  }
}

export interface OpcionesMotorOcr {
  // Directory with <language>.traineddata (or .traineddata.gz). A URL downloads from the network.
  langPath?: string
  // Tesseract language codes (default: English, what the identity reader needs for a DNI's MRZ).
  idiomas?: readonly string[]
  // true: the language data must already be on disk (langPath, a local directory). Nothing is
  // downloaded and nothing is written; without the files the engine is unavailable.
  soloLocal?: boolean
}

type WorkerTesseract = {
  recognize(image: Buffer): Promise<{ data: { text: string; confidence: number } }>
  terminate(): Promise<unknown>
}

const IDIOMA_OCR = /^[a-z]{3}(?:_[a-z]{2,8})?$/u
const esUrl = (value: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//iu.test(value)

// tesseract.js (WASM, no system binaries). One worker is reused and readings go one at a time.
// With `soloLocal` the language data is read from langPath and never fetched or cached (the
// library otherwise downloads it from a CDN on first use and writes it to the working directory).
export class MotorOcrTesseract implements MotorOcr {
  private worker: Promise<WorkerTesseract> | null = null
  private cola: Promise<unknown> = Promise.resolve()
  private readonly idiomas: string[]

  constructor(private readonly options: OpcionesMotorOcr = {}) {
    const idiomas = [...new Set((options.idiomas ?? ['eng']).map((idioma) => idioma.trim().toLowerCase()))].filter((idioma) => IDIOMA_OCR.test(idioma))
    this.idiomas = idiomas.length > 0 ? idiomas : ['eng']
  }

  // Which language files exist in langPath and in which form (all gzip or all plain).
  private async datosLocales(): Promise<{ gzip: boolean | null; missing: string[] }> {
    const { access } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const existe = (archivo: string) => access(join(this.options.langPath ?? '', archivo)).then(() => true, () => false)
    const planos = await Promise.all(this.idiomas.map((idioma) => existe(`${idioma}.traineddata`)))
    if (planos.every(Boolean)) return { gzip: false, missing: [] }
    const comprimidos = await Promise.all(this.idiomas.map((idioma) => existe(`${idioma}.traineddata.gz`)))
    if (comprimidos.every(Boolean)) return { gzip: true, missing: [] }
    return { gzip: null, missing: this.idiomas.filter((_, indice) => !planos[indice] && !comprimidos[indice]) }
  }

  async disponibilidad(): Promise<DisponibilidadOcr> {
    const base = { languages: [...this.idiomas], missing: [] as string[] }
    if (!this.options.soloLocal) return { available: true, reason: 'ok', ...base }
    const langPath = this.options.langPath?.trim()
    if (!langPath) return { available: false, reason: 'lang_path_not_set', ...base, missing: [...this.idiomas] }
    if (esUrl(langPath)) return { available: false, reason: 'lang_path_not_local', ...base, missing: [...this.idiomas] }
    const datos = await this.datosLocales()
    // Mixed forms (one plain, one gzip) cannot be loaded together: reported as missing too.
    return datos.gzip === null ? { available: false, reason: 'language_data_missing', ...base, missing: datos.missing.length > 0 ? datos.missing : [...this.idiomas] } : { available: true, reason: 'ok', ...base }
  }

  private async crear(): Promise<WorkerTesseract> {
    let opciones: Record<string, unknown> = this.options.langPath ? { langPath: this.options.langPath } : {}
    if (this.options.soloLocal) {
      const estado = await this.disponibilidad()
      if (!estado.available) throw new ErrorOcrNoDisponible(estado.reason)
      const { gzip } = await this.datosLocales()
      opciones = { langPath: this.options.langPath!.trim(), cacheMethod: 'none', gzip: gzip === true }
    }
    const { createWorker } = await import('tesseract.js')
    return (await createWorker(this.idiomas.join('+'), 1, opciones)) as unknown as WorkerTesseract
  }

  async reconocer(image: ImagenParaLectura): Promise<{ text: string; confidence: number }> {
    const turno = this.cola.then(async () => {
      // A worker that could not be created is not remembered: the next reading tries again.
      this.worker ??= this.crear().catch((error: unknown) => {
        this.worker = null
        throw error
      })
      const worker = await this.worker
      const result = await worker.recognize(image.bytes)
      return { text: result.data.text, confidence: Math.max(0, Math.min(1, result.data.confidence / 100)) }
    })
    this.cola = turno.catch(() => undefined)
    return turno
  }

  async reiniciar(): Promise<void> {
    const worker = this.worker
    this.worker = null
    this.cola = Promise.resolve()
    if (worker) await worker.then((item) => item.terminate()).catch(() => undefined)
  }
}

export class OcrIdentityDocumentReader implements IdentityDocumentReader {
  readonly kind = 'ocr' as const

  constructor(private readonly engine: MotorOcr) {}

  async leer(images: ImagenParaLectura[]): Promise<LecturaDocumento> {
    try {
      const texts = await Promise.all(images.map((image) => this.engine.reconocer(image)))
      return interpretarTextoDni(
        texts.map((item) => item.text).join('\n'),
        texts.reduce((min, item) => Math.min(min, item.confidence), 1)
      )
    } catch {
      return { ...lecturaNoDisponible('ocr'), transient: true }
    }
  }
}

// ICAO 9303 check digit (weights 7-3-1).
export function digitoControlMrz(value: string): number {
  const weights = [7, 3, 1]
  let sum = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!
    const n = char === '<' ? 0 : /\d/u.test(char) ? Number(char) : char.charCodeAt(0) - 55
    sum += n * weights[index % 3]!
  }
  return sum % 10
}

function fechaMrz(yymmdd: string, pivotFuture: boolean): string | null {
  if (!/^\d{6}$/u.test(yymmdd)) return null
  const yy = Number(yymmdd.slice(0, 2))
  const currentYY = new Date().getUTCFullYear() % 100
  const century = pivotFuture ? 2000 : yy > currentYY ? 1900 : 2000
  return `${century + yy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`
}

// Parses the OCR text of both sides. The TD1 machine readable zone on the back of the Argentine
// DNI carries document number, birth date, sex, expiry, nationality and names protected by
// check digits: when those validate the reading is high confidence. The front is a fallback.
export function interpretarTextoDni(text: string, engineConfidence = 1): LecturaDocumento {
  const lines = text
    .toUpperCase()
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, '').replace(/[«‹]/gu, '<'))
    .filter((line) => line.length >= 25 && /<{2,}/u.test(line))
  const mrzStart = lines.findIndex((line) => /^I[D<]ARG/u.test(line))
  if (mrzStart >= 0 && lines.length >= mrzStart + 3) {
    const l1 = lines[mrzStart]!.padEnd(30, '<')
    const l2 = lines[mrzStart + 1]!.padEnd(30, '<')
    const l3 = lines[mrzStart + 2]!
    const docField = l1.slice(5, 14)
    const docOk = digitoControlMrz(docField) === Number(l1[14])
    const birth = l2.slice(0, 6)
    const birthOk = digitoControlMrz(birth) === Number(l2[6])
    const expiry = l2.slice(8, 14)
    const expiryOk = digitoControlMrz(expiry) === Number(l2[14])
    const [surname = '', given = ''] = l3.split('<<')
    const sexChar = l2[7]
    const checks = [docOk, birthOk, expiryOk].filter(Boolean).length
    return {
      reader: 'ocr',
      documentNumber: normalizarDni(docField.replace(/</gu, '')),
      lastName: surname.replace(/</gu, ' ').trim() || null,
      firstName: given.replace(/</gu, ' ').trim() || null,
      birthDate: birthOk ? fechaMrz(birth, false) : null,
      sex: sexChar === 'M' || sexChar === 'F' ? sexChar : sexChar === 'X' ? 'X' : null,
      nationality: l2.slice(15, 18).replace(/</gu, '') || null,
      expirationDate: expiryOk ? fechaMrz(expiry, true) : null,
      // The document number check digit is mandatory for a usable reading.
      confidence: docOk
        ? Math.min(engineConfidence, 0.5 + checks * 0.15)
        : Math.min(engineConfidence, 0.3),
    }
  }
  // Front fallback: "12.345.678" style number near "DOCUMENTO". Names are not guessed.
  const match = text.match(/DOCUMENTO[^\d]{0,40}(\d{1,2}[.\s]?\d{3}[.\s]?\d{3})/iu)
  return {
    reader: 'ocr',
    documentNumber: match ? normalizarDni(match[1]) : null,
    firstName: null,
    lastName: null,
    birthDate: null,
    sex: null,
    nationality: null,
    expirationDate: null,
    confidence: match ? Math.min(engineConfidence, 0.6) : 0,
  }
}

// ---- Vision (Groq) -------------------------------------------------------------------------

// Strict schema: every field is present and nullable; the model must return null instead of
// guessing. `legible=false` forces a zero-confidence reading.
export const EsquemaLecturaVision = z.object({
  legible: z.boolean(),
  document_number: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  birth_date: z.string().nullable(),
  sex: z.enum(['M', 'F', 'X']).nullable(),
  nationality: z.string().nullable(),
  expiration_date: z.string().nullable(),
  confidence: z.number(),
})
export type LecturaVisionModelo = z.infer<typeof EsquemaLecturaVision>

export interface ModeloVisionDocumento {
  extraer(images: ImagenParaLectura[]): Promise<LecturaVisionModelo | null>
}

// JSON Schema sent to the provider (all fields required, no extra properties) so the same
// definition works with strict structured outputs. The answer is still validated with zod.
const JSON_SCHEMA_LECTURA_VISION = {
  type: 'object',
  additionalProperties: false,
  required: [
    'legible',
    'document_number',
    'first_name',
    'last_name',
    'birth_date',
    'sex',
    'nationality',
    'expiration_date',
    'confidence',
  ],
  properties: {
    legible: { type: 'boolean' },
    document_number: { type: ['string', 'null'] },
    first_name: { type: ['string', 'null'] },
    last_name: { type: ['string', 'null'] },
    birth_date: { type: ['string', 'null'] },
    sex: { type: ['string', 'null'], enum: ['M', 'F', 'X', null] },
    nationality: { type: ['string', 'null'] },
    expiration_date: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
} as const

const INSTRUCCION_VISION = [
  'You read Argentine national identity cards (DNI) for an identity verification workflow.',
  'Extract ONLY what is printed on the images. Never infer, complete or correct a value:',
  'if a field is not clearly legible, return null for it. Dates as YYYY-MM-DD.',
  'document_number: digits only. last_name / first_name exactly as printed (apellido / nombre).',
  'Set legible=false if the images are not an Argentine DNI or cannot be read.',
  'confidence is your overall confidence between 0 and 1 in the document_number reading.',
  `Answer with a single JSON object matching this JSON Schema: ${JSON.stringify(JSON_SCHEMA_LECTURA_VISION)}`,
].join(' ')

export const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions'
export const GROQ_VISION_MODEL_POR_DEFECTO = 'qwen/qwen3.8-27b'
// Groq accepts at most 3 images and 20 MB per request (base64 included).
const GROQ_MAX_IMAGENES = 3
const GROQ_MAX_BYTES_REQUEST = 20 * 1024 * 1024

export interface OpcionesVisionGroq {
  apiKey?: string
  pool?: GroqCredentialPool
  model?: string
  // `json_schema` (strict structured outputs) only on models that support it; `json_object`
  // (JSON mode) otherwise. Either way the answer is validated with zod afterwards.
  responseFormat?: 'json_schema' | 'json_object'
  timeoutMs?: number
  endpoint?: string
  fetch?: typeof fetch
}

// Groq vision (OpenAI-compatible chat completions) with the GROQ_API_KEY. No SDK: plain fetch.
// The images travel as base64 data URLs; nothing is logged.
export class ModeloVisionGroq implements ModeloVisionDocumento {
  private readonly pool: GroqCredentialPool

  constructor(private readonly options: OpcionesVisionGroq) {
    const pool =
      options.pool ??
      (options.apiKey
        ? crearPoolCredencialesGroq({ GROQ_API_KEY: options.apiKey }, { fetch: options.fetch })
        : null)
    if (!pool) throw new Error('GROQ_API_KEY is required for the vision reader')
    this.pool = pool
  }

  async extraer(images: ImagenParaLectura[]): Promise<LecturaVisionModelo | null> {
    const selected = images.slice(0, GROQ_MAX_IMAGENES)
    const content = [
      { type: 'text', text: 'Extract the DNI fields from the front and back images.' },
      ...selected.map((image) => ({
        type: 'image_url',
        image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}` },
      })),
    ]
    const responseFormat =
      this.options.responseFormat === 'json_schema'
        ? {
            type: 'json_schema',
            json_schema: { name: 'lectura_dni', strict: true, schema: JSON_SCHEMA_LECTURA_VISION },
          }
        : { type: 'json_object' }
    const body = JSON.stringify({
      model: this.options.model || GROQ_VISION_MODEL_POR_DEFECTO,
      temperature: 0,
      max_completion_tokens: 1024,
      response_format: responseFormat,
      messages: [
        { role: 'system', content: INSTRUCCION_VISION },
        { role: 'user', content },
      ],
    })
    if (Buffer.byteLength(body) > GROQ_MAX_BYTES_REQUEST) return null
    const response = await this.pool.request({
      url: this.options.endpoint ?? GROQ_CHAT_COMPLETIONS_URL,
      idempotent: true,
      createInit: () => ({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      }),
    })
    // Provider errors are reported by status only (the body may echo request data).
    if (!response.ok) throw new Error(`groq vision request failed with status ${response.status}`)
    const payload = (await response.json()) as {
      choices?: { finish_reason?: string; message?: { content?: string | null } }[]
    }
    const choice = payload.choices?.[0]
    if (!choice?.message?.content || choice.finish_reason === 'length') return null
    return extraerJson(choice.message.content)
  }
}

// Tolerates a fenced block or leading reasoning text; anything that is not one JSON object is
// treated as "could not read" (review), never guessed.
export function extraerJson(text: string): LecturaVisionModelo | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gu, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as LecturaVisionModelo
  } catch {
    return null
  }
}

export class VisionIdentityDocumentReader implements IdentityDocumentReader {
  readonly kind = 'vision' as const

  constructor(private readonly model: ModeloVisionDocumento | null) {}

  async leer(images: ImagenParaLectura[]): Promise<LecturaDocumento> {
    if (!this.model) return lecturaNoDisponible('vision')
    let raw: LecturaVisionModelo | null
    try {
      raw = await this.model.extraer(images)
    } catch {
      return { ...lecturaNoDisponible('vision'), transient: true }
    }
    const parsed = raw ? EsquemaLecturaVision.safeParse(raw) : null
    if (!parsed?.success) return lecturaNoDisponible('vision')
    const value = parsed.data
    const date = (input: string | null) =>
      input && /^\d{4}-\d{2}-\d{2}$/u.test(input) ? input : null
    const confidence = value.legible ? Math.max(0, Math.min(1, value.confidence)) : 0
    return {
      reader: 'vision',
      documentNumber: normalizarDni(value.document_number),
      firstName: value.first_name?.trim() || null,
      lastName: value.last_name?.trim() || null,
      birthDate: date(value.birth_date),
      sex: value.sex,
      nationality: value.nationality?.trim() || null,
      expirationDate: date(value.expiration_date),
      confidence,
    }
  }
}
