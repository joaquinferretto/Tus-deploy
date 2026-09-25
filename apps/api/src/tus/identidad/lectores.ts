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

export interface MotorOcr {
  reconocer(image: ImagenParaLectura): Promise<{ text: string; confidence: number }>
}

// tesseract.js (WASM, no system binaries). Language data is fetched once by the library (or
// from TESSERACT_LANG_PATH). One worker is reused for every image.
export class MotorOcrTesseract implements MotorOcr {
  private worker: Promise<{
    recognize(image: Buffer): Promise<{ data: { text: string; confidence: number } }>
  }> | null = null

  constructor(private readonly options: { langPath?: string } = {}) {}

  async reconocer(image: ImagenParaLectura): Promise<{ text: string; confidence: number }> {
    this.worker ??= import('tesseract.js').then(({ createWorker }) =>
      createWorker('eng', 1, this.options.langPath ? { langPath: this.options.langPath } : {})
    ) as never
    const worker = await this.worker!
    const result = await worker.recognize(image.bytes)
    return {
      text: result.data.text,
      confidence: Math.max(0, Math.min(1, result.data.confidence / 100)),
    }
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
