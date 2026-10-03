import { spawn } from 'node:child_process'
import * as z from 'zod/v4'
import { crearPoolCredencialesGroq, type GroqCredentialPool } from '../../providers/groq/index.ts'
import { ErrorOcrNoDisponible, GROQ_CHAT_COMPLETIONS_URL, GROQ_VISION_MODEL_POR_DEFECTO, type DisponibilidadOcr, type MotorOcr } from '../identidad/lectores.ts'

// TUS-WHATSAPP-MULTIMODAL-02: reading a payment receipt (image or PDF) sent through WhatsApp.
//
//   IMAGE / PDF = HINT.  TUS CONTEXT = CORRELATION.  MERCADO PAGO = FINANCIAL AUTHORITY.
//   TUS BACKEND = DECISION.
//
// Everything this module extracts is `untrusted_receipt_evidence`: what a person's file says,
// nothing a bank or Mercado Pago certified. It is only ever used to choose among the payments of
// the SAME client (see correlacionarComprobante); it never reaches the financial domain as a fact
// and never confirms a payment, a turno, a work or an earning. The bytes live in memory while they
// are validated and read, and are dropped; nothing here persists them.

export interface LimitesComprobante {
  // Master switch (WHATSAPP_RECEIPT_ANALYSIS): without it a receipt is only a hint that somebody
  // says they paid (the PR #1 behaviour): nothing is downloaded.
  enabled: boolean
  // 'ocr': local OCR/PDF text, nothing leaves TUS. 'vision': the image is sent to Groq vision.
  analyzer: 'ocr' | 'vision'
  maxImageBytes: number
  maxPdfBytes: number
  maxPdfPages: number
  // Decoded pixels allowed (decompression-bomb guard), read from the image header.
  maxPixels: number
  timeoutMs: number
  // Receipt analyses per conversation per hour (cost: download + OCR/vision). A receipt already
  // analysed (same Meta hash) is reused and does not count.
  maxPerHour: number
  allowedMimeTypes: readonly string[]
}

export const MIME_COMPROBANTE_SOPORTADOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

export const LIMITES_COMPROBANTE_POR_DEFECTO: LimitesComprobante = {
  enabled: false,
  analyzer: 'ocr',
  maxImageBytes: 5 * 1024 * 1024,
  maxPdfBytes: 2 * 1024 * 1024,
  maxPdfPages: 3,
  maxPixels: 40_000_000,
  timeoutMs: 25_000,
  maxPerHour: 6,
  allowedMimeTypes: MIME_COMPROBANTE_SOPORTADOS,
}

const entero = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(value?.trim() ?? '', 10)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

export function leerLimitesComprobante(env: Record<string, string | undefined>): LimitesComprobante {
  const permitidos = (env['WHATSAPP_RECEIPT_MIME_TYPES'] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => (MIME_COMPROBANTE_SOPORTADOS as readonly string[]).includes(value))
  return {
    enabled: env['WHATSAPP_RECEIPT_ANALYSIS']?.trim() === 'true',
    analyzer: env['WHATSAPP_RECEIPT_ANALYZER']?.trim() === 'vision' ? 'vision' : 'ocr',
    maxImageBytes: entero(env['WHATSAPP_RECEIPT_MAX_BYTES'], LIMITES_COMPROBANTE_POR_DEFECTO.maxImageBytes, 10_240, 10 * 1024 * 1024),
    maxPdfBytes: entero(env['WHATSAPP_RECEIPT_PDF_MAX_BYTES'], LIMITES_COMPROBANTE_POR_DEFECTO.maxPdfBytes, 10_240, 5 * 1024 * 1024),
    maxPdfPages: entero(env['WHATSAPP_RECEIPT_PDF_MAX_PAGES'], LIMITES_COMPROBANTE_POR_DEFECTO.maxPdfPages, 1, 10),
    maxPixels: LIMITES_COMPROBANTE_POR_DEFECTO.maxPixels,
    timeoutMs: entero(env['WHATSAPP_RECEIPT_TIMEOUT_MS'], LIMITES_COMPROBANTE_POR_DEFECTO.timeoutMs, 1_000, 120_000),
    maxPerHour: entero(env['WHATSAPP_RECEIPT_MAX_PER_HOUR'], LIMITES_COMPROBANTE_POR_DEFECTO.maxPerHour, 1, 60),
    allowedMimeTypes: permitidos.length > 0 ? permitidos : MIME_COMPROBANTE_SOPORTADOS,
  }
}

export type CodigoErrorComprobante =
  | 'MIME_NOT_ALLOWED'
  | 'TOO_LARGE'
  | 'CORRUPT'
  | 'TOO_MANY_PAGES'
  | 'DOWNLOAD_FAILED'
  // The reader does not exist here (binary missing, language data missing, provider not configured).
  | 'ANALYZER_UNAVAILABLE'
  // The reader exists and broke (process killed, unexpected exit, provider error): not the file's fault.
  | 'ANALYZER_FAILED'
  | 'ANALYZER_TIMEOUT'
  | 'NO_TEXT'

export class ErrorComprobante extends Error {
  constructor(
    readonly code: CodigoErrorComprobante,
    message: string
  ) {
    super(message)
    this.name = 'ErrorComprobante'
  }
}

// ---- the real file ----------------------------------------------------------------------------

type FormatoReal = 'jpeg' | 'png' | 'webp' | 'pdf'
const MIME_DE: Record<FormatoReal, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }

export function detectarFormatoComprobante(bytes: Buffer): FormatoReal | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (bytes.toString('latin1', 0, Math.min(bytes.length, 1024)).includes('%PDF-')) return 'pdf'
  return null
}

// Width and height from the header (never decoding the pixels). null: not readable = corrupt.
export function dimensionesDeImagen(bytes: Buffer, formato: 'jpeg' | 'png' | 'webp'): { width: number; height: number } | null {
  try {
    if (formato === 'png') {
      if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    }
    if (formato === 'jpeg') {
      let i = 2
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null
        const marker = bytes[i + 1]!
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2
          continue
        }
        const length = bytes.readUInt16BE(i + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
          return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) }
        if (length < 2) return null
        i += 2 + length
      }
      return null
    }
    const chunk = bytes.toString('latin1', 12, 16)
    if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
    if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    return null
  } catch {
    return null
  }
}

export interface ComprobanteValidado {
  kind: 'image' | 'pdf'
  mimeType: string
  bytes: Buffer
}

// The real bytes decide the format (never the declared type, the name or the extension), the size,
// the pixels and, for a PDF, whether it is whole, not encrypted and short enough.
export function validarComprobante(bytes: Buffer, declaredMimeType: string | null, limits: LimitesComprobante): ComprobanteValidado {
  if (bytes.length === 0) throw new ErrorComprobante('CORRUPT', 'file is empty')
  const declared = (declaredMimeType ?? '').split(';')[0]!.trim().toLowerCase()
  if (!declared.startsWith('image/') && declared !== 'application/pdf') throw new ErrorComprobante('MIME_NOT_ALLOWED', 'declared type is not an image or a PDF')
  const real = detectarFormatoComprobante(bytes)
  if (!real) throw new ErrorComprobante('CORRUPT', 'content is not a supported image or PDF')
  const mimeType = MIME_DE[real]
  if (!limits.allowedMimeTypes.includes(mimeType)) throw new ErrorComprobante('MIME_NOT_ALLOWED', 'file format is not allowed')
  if (real === 'pdf') {
    if (bytes.length > limits.maxPdfBytes) throw new ErrorComprobante('TOO_LARGE', 'PDF is too large')
    // A truncated PDF has no end marker; an encrypted one cannot be read without a password.
    if (!bytes.toString('latin1', Math.max(0, bytes.length - 2048)).includes('%%EOF')) throw new ErrorComprobante('CORRUPT', 'PDF is truncated')
    const texto = bytes.toString('latin1')
    if (/\/Encrypt\b/u.test(texto)) throw new ErrorComprobante('CORRUPT', 'PDF is encrypted')
    // Best-effort count of the page objects (compressed object streams cannot be counted: the
    // text extraction is limited to the same number of pages anyway).
    const paginas = (texto.match(/\/Type\s*\/Page(?![A-Za-z])/gu) ?? []).length
    if (paginas > limits.maxPdfPages) throw new ErrorComprobante('TOO_MANY_PAGES', 'PDF has too many pages')
    return { kind: 'pdf', mimeType, bytes }
  }
  if (bytes.length > limits.maxImageBytes) throw new ErrorComprobante('TOO_LARGE', 'image is too large')
  const dimensiones = dimensionesDeImagen(bytes, real)
  if (!dimensiones || dimensiones.width < 1 || dimensiones.height < 1) throw new ErrorComprobante('CORRUPT', 'image header is not readable')
  if (dimensiones.width * dimensiones.height > limits.maxPixels) throw new ErrorComprobante('TOO_LARGE', 'image has too many pixels')
  return { kind: 'image', mimeType, bytes }
}

// ---- what a receipt says (never a financial fact) ----------------------------------------------

export type StatusTextoComprobante = 'approved' | 'rejected' | 'pending' | 'unknown'

export interface EvidenciaComprobante {
  // Always this: the contents of a file somebody sent. Not verified by anybody.
  origen: 'untrusted_receipt_evidence'
  analyzer: 'ocr' | 'vision'
  // Centavos, as printed.
  amountMinor: string | null
  currency: 'ARS' | 'USD' | null
  // Digits of an operation number as printed. Never looked up by itself (see correlacionarComprobante).
  operationId: string | null
  externalReference: string | null
  // Local date (and time when printed): YYYY-MM-DD or YYYY-MM-DDTHH:mm.
  occurredAt: string | null
  recipientName: string | null
  // Only the last four digits of a CVU/CBU, never the whole number.
  recipientAccountHint: string | null
  payerName: string | null
  // What the receipt says about its own state, as a category. It certifies nothing.
  status: StatusTextoComprobante | null
  // Per field, only when the reader really reports it (OCR overall confidence, model confidence).
  confidence: Partial<Record<'amount' | 'currency' | 'operationId' | 'occurredAt' | 'recipientName' | 'overall', number>> | null
}

export const EVIDENCIA_VACIA: Omit<EvidenciaComprobante, 'analyzer'> = {
  origen: 'untrusted_receipt_evidence',
  amountMinor: null,
  currency: null,
  operationId: null,
  externalReference: null,
  occurredAt: null,
  recipientName: null,
  recipientAccountHint: null,
  payerName: null,
  status: null,
  confidence: null,
}

export const hayEvidencia = (evidencia: EvidenciaComprobante): boolean =>
  [evidencia.amountMinor, evidencia.operationId, evidencia.externalReference, evidencia.occurredAt, evidencia.recipientName, evidencia.payerName].some((value) => value !== null)

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const sinAcentos = (value: string): string => value.normalize('NFD').replace(/\p{M}/gu, '')

// "15.000,50", "15000", "15,000.50", "$ 15.000" -> centavos. null when it is not an amount.
// The last separator decides: followed by three digits it groups thousands, by one or two it is the
// decimal mark; anything else is not an amount.
export function montoAMinor(raw: string): string | null {
  const limpio = raw.replace(/\s/gu, '')
  if (!/^\d[\d.,]*$/u.test(limpio)) return null
  const separador = Math.max(limpio.lastIndexOf('.'), limpio.lastIndexOf(','))
  let entera = limpio
  let decimales = ''
  if (separador >= 0) {
    const cola = limpio.slice(separador + 1)
    if (cola.length === 3) entera = limpio
    else if (cola.length >= 1 && cola.length <= 2) {
      entera = limpio.slice(0, separador)
      decimales = cola
    } else return null
  }
  const digitos = entera.replace(/[.,]/gu, '')
  if (!/^\d{1,12}$/u.test(digitos)) return null
  const total = BigInt(digitos) * 100n + BigInt((decimales + '00').slice(0, 2))
  return total > 0n ? total.toString(10) : null
}

function nombre(value: string | undefined): string | null {
  if (!value) return null
  const limpio = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/[0-9]{4,}/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 60)
  return /\p{L}{2,}/u.test(limpio) ? limpio : null
}

// Reads the text of a receipt (OCR or the text of a PDF) with fixed patterns. Missing is null:
// nothing is completed, corrected or guessed. Account numbers are cut to their last four digits.
export function interpretarTextoComprobante(text: string, opciones: { analyzer?: 'ocr' | 'vision'; confidence?: number | null } = {}): EvidenciaComprobante {
  const plano = text.replace(/\r/gu, '').slice(0, 20_000)
  const lineas = plano.split('\n').map((linea) => linea.trim()).filter(Boolean)
  const evidencia: EvidenciaComprobante = { ...EVIDENCIA_VACIA, analyzer: opciones.analyzer ?? 'ocr' }
  const normal = sinAcentos(plano).toLowerCase()

  // Amount: labelled lines first ("monto", "importe", "total", "pagaste"), else the first one with a currency mark.
  const reMonto = /(?:u\$s|usd|ar\$|ars|\$)\s*([0-9][0-9.,\s]{0,18})/giu
  const rotulo = /(monto|importe|total|pagaste|transferiste|pago de|valor)/iu
  const candidatos: { raw: string; moneda: 'ARS' | 'USD'; rotulado: boolean }[] = []
  for (const linea of lineas) {
    for (const match of linea.matchAll(reMonto)) {
      const marca = match[0].toLowerCase()
      candidatos.push({ raw: match[1]!, moneda: /u\$s|usd/u.test(marca) ? 'USD' : 'ARS', rotulado: rotulo.test(sinAcentos(linea)) })
    }
  }
  const elegido = candidatos.find((c) => c.rotulado && montoAMinor(c.raw)) ?? candidatos.find((c) => montoAMinor(c.raw))
  if (elegido) {
    evidencia.amountMinor = montoAMinor(elegido.raw)
    evidencia.currency = elegido.moneda
  } else {
    const suelto = plano.match(/(?:monto|importe|total)\s*[:\-]?\s*([0-9][0-9.,]{0,15})/iu)
    if (suelto && montoAMinor(suelto[1]!)) evidencia.amountMinor = montoAMinor(suelto[1]!)
    if (/\b(?:usd|u\$s|dolares?)\b/u.test(normal)) evidencia.currency = 'USD'
    else if (/\b(?:ars|pesos?)\b/u.test(normal)) evidencia.currency = 'ARS'
  }

  // Operation number ("Número de operación: 1234567890", "Nro. de transacción 123..."). Digits only.
  const operacion = plano.match(/(?:numero|número|n[°ºo]\.?|nro\.?|codigo|código|id)\s*(?:de\s*)?(?:la\s*)?(?:operaci[oó]n|transacci[oó]n|pago|comprobante)\s*[:#]?\s*([0-9]{6,20})/iu)
  if (operacion) evidencia.operationId = operacion[1]!
  const referencia = plano.match(/(?:referencia(?:\s+externa)?|external[_ ]reference)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9._:-]{7,79})/iu)
  if (referencia) evidencia.externalReference = referencia[1]!

  // Date and time.
  const numerica = plano.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](20\d{2})(?:[ ,T]+(\d{1,2}):(\d{2}))?/u)
  const iso = plano.match(/\b(20\d{2})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2}))?/u)
  const larga = normal.match(/\b(\d{1,2}) de ([a-z]+)(?: de)? (20\d{2})(?:[ ,]+(\d{1,2}):(\d{2}))?/u)
  const fecha = (anio: string, mes: number, dia: string, hh?: string, mm?: string): string | null => {
    const d = Number(dia)
    if (mes < 1 || mes > 12 || d < 1 || d > 31) return null
    const base = `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return hh && mm ? `${base}T${String(Number(hh)).padStart(2, '0')}:${mm}` : base
  }
  if (iso) evidencia.occurredAt = fecha(iso[1]!, Number(iso[2]), iso[3]!, iso[4], iso[5])
  else if (numerica) evidencia.occurredAt = fecha(numerica[3]!, Number(numerica[2]), numerica[1]!, numerica[4], numerica[5])
  else if (larga && MESES.includes(larga[2]!)) evidencia.occurredAt = fecha(larga[3]!, MESES.indexOf(larga[2]!) + 1, larga[1]!, larga[4], larga[5])

  // People and accounts.
  for (const linea of lineas) {
    const destinatario = linea.match(/^(?:para|destinatario|receptor|cobr[oó]|vendedor|a nombre de|beneficiario)\s*[:\-]\s*(.{3,80})$/iu)
    if (destinatario && !evidencia.recipientName) evidencia.recipientName = nombre(destinatario[1])
    const pagador = linea.match(/^(?:de|pagador|ordenante|titular|enviado por)\s*[:\-]\s*(.{3,80})$/iu)
    if (pagador && !evidencia.payerName) evidencia.payerName = nombre(pagador[1])
    const cuenta = linea.match(/(?:cvu|cbu)\D{0,6}([0-9][0-9\s-]{9,30})/iu)
    if (cuenta && !evidencia.recipientAccountHint) {
      const digitos = cuenta[1]!.replace(/\D/gu, '')
      if (digitos.length >= 10) evidencia.recipientAccountHint = digitos.slice(-4)
    }
  }

  // What the receipt says of itself.
  if (/\b(?:rechazad[oa]|cancelad[oa]|denegad[oa])\b/u.test(normal)) evidencia.status = 'rejected'
  else if (/\b(?:pendiente|en proceso|en revision)\b/u.test(normal)) evidencia.status = 'pending'
  else if (/\b(?:aprobad[oa]|acreditad[oa]|realizad[oa]|exitos[oa]|completad[oa])\b/u.test(normal)) evidencia.status = 'approved'
  else evidencia.status = 'unknown'

  if (typeof opciones.confidence === 'number' && Number.isFinite(opciones.confidence)) evidencia.confidence = { overall: Math.max(0, Math.min(1, opciones.confidence)) }
  return evidencia
}

// ---- analyzers ---------------------------------------------------------------------------------

// What of the receipt reading can run here (for readiness): never a path, a key or a content.
export interface CapacidadesComprobantes {
  analyzer: 'ocr' | 'vision'
  images: { available: boolean; reason: string }
  pdf: { available: boolean; reason: string }
}

export interface AnalizadorComprobante {
  readonly kind: 'ocr' | 'vision'
  // Reads a VALIDATED file. The answer is evidence, never a fact. Throws ErrorComprobante.
  analizar(archivo: ComprobanteValidado): Promise<EvidenciaComprobante>
  capacidades?(): Promise<CapacidadesComprobantes>
}

export interface ExtractorTextoPdf {
  extraer(bytes: Buffer, opciones: { maxPaginas: number; timeoutMs: number }): Promise<string>
  disponibilidad?(forzar?: boolean): Promise<{ available: boolean; reason: string }>
}

async function capacidadPdf(extractor: ExtractorTextoPdf | null): Promise<{ available: boolean; reason: string }> {
  if (!extractor) return { available: false, reason: 'not_configured' }
  if (!extractor.disponibilidad) return { available: true, reason: 'ok' }
  const estado = await extractor.disponibilidad().catch(() => ({ available: false, reason: 'failed' }))
  return { available: estado.available, reason: estado.reason }
}

// Whether pdftotext can be used here, and why not. Never the binary's output or a path.
export interface DisponibilidadPdf {
  available: boolean
  // 'incompatible': a pdftotext exists but cannot read a PDF from standard input (TUS never writes
  // the file to disk). Poppler's pdftotext can; Xpdf's cannot.
  reason: 'ok' | 'missing' | 'not_executable' | 'incompatible' | 'failed' | 'timeout' | 'invalid_path'
  version: string | null
}

type ProcesoPdf = ReturnType<typeof spawn>
// How the process is started (tests replace it to simulate each way of failing).
export type LanzadorPdf = (binario: string, argumentos: string[]) => ProcesoPdf

const MARCA_AUTOPRUEBA = 'TUSPDFOK'

// A one-page PDF with a known word, built in memory: what the availability check extracts to
// prove that this pdftotext really reads a PDF from standard input.
export function pdfDeAutoprueba(): Buffer {
  const flujo = `BT /F1 12 Tf 10 100 Td (${MARCA_AUTOPRUEBA}) Tj ET`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let salida = '%PDF-1.4\n'
  const posiciones: number[] = []
  objetos.forEach((objeto, indice) => {
    posiciones.push(salida.length)
    salida += `${indice + 1} 0 obj\n${objeto}\nendobj\n`
  })
  const xref = salida.length
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const posicion of posiciones) salida += `${String(posicion).padStart(10, '0')} 00000 n \n`
  salida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(salida, 'latin1')
}

// The configured binary: a bare program name found through PATH or an absolute path. Anything
// else (arguments, relative paths, shell syntax) is refused: nothing is ever run through a shell.
export function binarioPdftotextValido(binario: string): boolean {
  if (binario.length === 0 || binario.length > 260 || /[\u0000-\u001f"'`;|&<>$*?]/u.test(binario)) return false
  if (/^[A-Za-z0-9._-]+$/u.test(binario)) return true
  return /^(?:[A-Za-z]:[\\/]|\/)[^\n]*$/u.test(binario) && !/(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(binario)
}

const TEXTO_PDF_MAXIMO = 256 * 1024
const DISPONIBILIDAD_VIGENTE_MS = 5 * 60_000

// pdftotext (poppler-utils) without a shell and without temporary files: the PDF goes through
// stdin, the text comes through stdout, the arguments are fixed, the output and the time are
// capped, and only the first pages are read. Each way of failing has its own code:
//   ANALYZER_UNAVAILABLE  the binary is missing or cannot be executed (installation problem)
//   CORRUPT               pdftotext says the PDF cannot be opened or is protected (exit 1, 3)
//   ANALYZER_FAILED       the process broke for another reason (other exit code, killed by a signal)
//   ANALYZER_TIMEOUT      it did not finish in time (it is killed)
//   TOO_LARGE             the file or its text is over the cap
export class ExtractorTextoPdfPoppler implements ExtractorTextoPdf {
  private comprobada: { at: number; valor: DisponibilidadPdf } | null = null

  constructor(
    private readonly binario = 'pdftotext',
    private readonly opciones: { maxBytes?: number; now?: () => number; lanzar?: LanzadorPdf } = {}
  ) {}

  private proceso(argumentos: string[]): ProcesoPdf {
    if (this.opciones.lanzar) return this.opciones.lanzar(this.binario, argumentos)
    return spawn(this.binario, argumentos, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env['PATH'] ?? '', LANG: 'C.UTF-8' }, shell: false, windowsHide: true })
  }

  private ahora(): number {
    return this.opciones.now?.() ?? Date.now()
  }

  // Whether PDFs can really be read here: `pdftotext -v` (the binary exists and runs) and then a
  // built-in one-page PDF extracted through standard input (it is a pdftotext TUS can use). Cached
  // for a few minutes so that a readiness probe never spawns a process per request; `forzar`
  // re-checks now.
  async disponibilidad(forzar = false): Promise<DisponibilidadPdf> {
    if (!forzar && this.comprobada && this.ahora() - this.comprobada.at < DISPONIBILIDAD_VIGENTE_MS) return this.comprobada.valor
    let valor = await this.comprobar()
    if (valor.available) {
      const version = valor.version
      valor = await this.extraer(pdfDeAutoprueba(), { maxPaginas: 1, timeoutMs: 5_000 }).then(
        (texto): DisponibilidadPdf => (texto.includes(MARCA_AUTOPRUEBA) ? { available: true, reason: 'ok', version } : { available: false, reason: 'incompatible', version }),
        (error: unknown): DisponibilidadPdf => {
          const code = error instanceof ErrorComprobante ? error.code : 'ANALYZER_FAILED'
          // It runs but cannot extract its own sample PDF: this build does not read standard input
          // (or is broken). Either way PDFs cannot be read with it.
          return { available: false, reason: code === 'ANALYZER_TIMEOUT' ? 'timeout' : code === 'ANALYZER_UNAVAILABLE' ? 'missing' : 'incompatible', version }
        }
      )
    }
    this.comprobada = { at: this.ahora(), valor }
    return valor
  }

  private comprobar(): Promise<DisponibilidadPdf> {
    if (!binarioPdftotextValido(this.binario)) return Promise.resolve({ available: false, reason: 'invalid_path', version: null })
    return new Promise((resolve) => {
      let hijo: ProcesoPdf
      try {
        hijo = this.proceso(['-v'])
      } catch {
        return resolve({ available: false, reason: 'missing', version: null })
      }
      let salida = ''
      let resuelto = false
      const terminar = (valor: DisponibilidadPdf) => {
        if (resuelto) return
        resuelto = true
        clearTimeout(temporizador)
        hijo.kill('SIGKILL')
        resolve(valor)
      }
      const temporizador = setTimeout(() => terminar({ available: false, reason: 'timeout', version: null }), 5_000)
      const leer = (parte: Buffer) => {
        if (salida.length < 2_048) salida += parte.toString('latin1')
      }
      hijo.stdout!.on('data', leer)
      hijo.stderr!.on('data', leer)
      hijo.stdin!.on('error', () => undefined)
      hijo.stdin!.end()
      hijo.on('error', (error: NodeJS.ErrnoException) => terminar({ available: false, reason: error.code === 'EACCES' || error.code === 'EPERM' ? 'not_executable' : 'missing', version: null }))
      hijo.on('close', (codigo) => {
        // Poppler prints "pdftotext version X.Y.Z" (Xpdf's build prints it too and exits 99).
        const version = salida.match(/pdftotext\s+version\s+([0-9][0-9A-Za-z.]*)/iu)?.[1] ?? null
        terminar(version || codigo === 0 ? { available: true, reason: 'ok', version } : { available: false, reason: 'failed', version: null })
      })
    })
  }

  extraer(bytes: Buffer, opciones: { maxPaginas: number; timeoutMs: number }): Promise<string> {
    if (!binarioPdftotextValido(this.binario)) return Promise.reject(new ErrorComprobante('ANALYZER_UNAVAILABLE', 'pdftotext path is not valid'))
    if (this.opciones.maxBytes !== undefined && bytes.length > this.opciones.maxBytes) return Promise.reject(new ErrorComprobante('TOO_LARGE', 'PDF is too large'))
    return new Promise((resolve, reject) => {
      let hijo: ProcesoPdf
      try {
        hijo = this.proceso(['-l', String(opciones.maxPaginas), '-q', '-nopgbrk', '-enc', 'UTF-8', '-', '-'])
      } catch {
        return reject(new ErrorComprobante('ANALYZER_UNAVAILABLE', 'pdftotext is not available'))
      }
      const partes: Buffer[] = []
      let total = 0
      let cerrado = false
      const terminar = (error: ErrorComprobante | null, texto = '') => {
        if (cerrado) return
        cerrado = true
        clearTimeout(temporizador)
        hijo.kill('SIGKILL')
        if (error) reject(error)
        else resolve(texto)
      }
      const temporizador = setTimeout(() => terminar(new ErrorComprobante('ANALYZER_TIMEOUT', 'PDF text extraction timed out')), opciones.timeoutMs)
      hijo.on('error', (error: NodeJS.ErrnoException) => {
        // The binary is not there (or cannot be run): remembered, so readiness reports it at once.
        this.comprobada = { at: this.ahora(), valor: { available: false, reason: error.code === 'EACCES' || error.code === 'EPERM' ? 'not_executable' : 'missing', version: null } }
        terminar(new ErrorComprobante('ANALYZER_UNAVAILABLE', 'pdftotext is not available'))
      })
      hijo.stdout!.on('data', (parte: Buffer) => {
        total += parte.length
        if (total > TEXTO_PDF_MAXIMO) return terminar(new ErrorComprobante('TOO_LARGE', 'PDF text is too large'))
        partes.push(parte)
      })
      // stderr is drained and discarded: it may quote the document, so it is never kept or logged.
      hijo.stderr!.on('data', () => undefined)
      hijo.stdin!.on('error', () => undefined)
      hijo.on('close', (codigo, senal) => {
        if (cerrado) return
        if (codigo === 0) return terminar(null, Buffer.concat(partes).toString('utf8'))
        // Poppler: 1 = the PDF could not be opened, 3 = protected against text extraction.
        if (codigo === 1 || codigo === 3) return terminar(new ErrorComprobante('CORRUPT', 'PDF could not be read'))
        terminar(new ErrorComprobante('ANALYZER_FAILED', senal ? 'pdftotext was ended by a signal' : `pdftotext ended with exit code ${codigo}`))
      })
      hijo.stdin!.end(bytes)
    })
  }
}

export function conLimiteDeTiempo<T>(promesa: Promise<T>, ms: number, codigo: CodigoErrorComprobante = 'ANALYZER_TIMEOUT'): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<never>((_, reject) => {
    temporizador = setTimeout(() => reject(new ErrorComprobante(codigo, 'receipt analysis timed out')), ms)
  })
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador))
}

// Local reading: OCR for images (nothing leaves TUS), the text layer for PDFs.
export class AnalizadorComprobanteOcr implements AnalizadorComprobante {
  readonly kind = 'ocr' as const

  constructor(
    private readonly motor: MotorOcr,
    private readonly pdf: ExtractorTextoPdf | null,
    private readonly limits: Pick<LimitesComprobante, 'maxPdfPages' | 'timeoutMs'>
  ) {}

  async analizar(archivo: ComprobanteValidado): Promise<EvidenciaComprobante> {
    if (archivo.kind === 'pdf') return analizarPdf(archivo, this.pdf, this.limits, 'ocr')
    let lectura: { text: string; confidence: number }
    try {
      lectura = await conLimiteDeTiempo(this.motor.reconocer({ bytes: archivo.bytes, mimeType: archivo.mimeType } as never), this.limits.timeoutMs)
    } catch (error) {
      // The language data is not installed: an installation problem, nothing was read.
      if (error instanceof ErrorOcrNoDisponible) throw new ErrorComprobante('ANALYZER_UNAVAILABLE', 'local OCR is not available')
      // A reading that ran out of time or broke keeps the engine busy or damaged: it is stopped,
      // and the next receipt starts a fresh one.
      await this.motor.reiniciar?.().catch(() => undefined)
      throw error instanceof ErrorComprobante ? error : new ErrorComprobante('ANALYZER_FAILED', 'OCR failed')
    }
    if (lectura.text.trim().length < 8) throw new ErrorComprobante('NO_TEXT', 'no text could be read')
    return interpretarTextoComprobante(lectura.text, { analyzer: 'ocr', confidence: lectura.confidence })
  }

  async capacidades(): Promise<CapacidadesComprobantes> {
    const ocr: DisponibilidadOcr | { available: boolean; reason: string } = this.motor.disponibilidad ? await this.motor.disponibilidad().catch(() => ({ available: false, reason: 'engine_failed' })) : { available: true, reason: 'ok' }
    return { analyzer: 'ocr', images: { available: ocr.available, reason: ocr.reason }, pdf: await capacidadPdf(this.pdf) }
  }
}

async function analizarPdf(
  archivo: ComprobanteValidado,
  extractor: ExtractorTextoPdf | null,
  limits: Pick<LimitesComprobante, 'maxPdfPages' | 'timeoutMs'>,
  analyzer: 'ocr' | 'vision'
): Promise<EvidenciaComprobante> {
  if (!extractor) throw new ErrorComprobante('ANALYZER_UNAVAILABLE', 'PDF reading is not configured')
  const texto = await conLimiteDeTiempo(extractor.extraer(archivo.bytes, { maxPaginas: limits.maxPdfPages, timeoutMs: limits.timeoutMs }), limits.timeoutMs + 1_000)
  if (texto.trim().length < 8) throw new ErrorComprobante('NO_TEXT', 'the PDF has no readable text')
  return interpretarTextoComprobante(texto, { analyzer })
}

// Vision answer: strict schema, every field present and nullable, no extra fields. The model
// says what is printed ("parece monto 15000"), never that a payment happened.
export const EsquemaComprobanteVision = z.strictObject({
  legible: z.boolean(),
  amount: z.string().nullable(),
  currency: z.enum(['ARS', 'USD']).nullable(),
  operation_id: z.string().nullable(),
  external_reference: z.string().nullable(),
  date: z.string().nullable(),
  recipient_name: z.string().nullable(),
  recipient_account_last4: z.string().nullable(),
  payer_name: z.string().nullable(),
  status_text: z.enum(['approved', 'rejected', 'pending', 'unknown']).nullable(),
  confidence: z.number(),
})
export type ComprobanteVisionModelo = z.infer<typeof EsquemaComprobanteVision>

const JSON_SCHEMA_COMPROBANTE_VISION = {
  type: 'object',
  additionalProperties: false,
  required: ['legible', 'amount', 'currency', 'operation_id', 'external_reference', 'date', 'recipient_name', 'recipient_account_last4', 'payer_name', 'status_text', 'confidence'],
  properties: {
    legible: { type: 'boolean' },
    amount: { type: ['string', 'null'] },
    currency: { type: ['string', 'null'], enum: ['ARS', 'USD', null] },
    operation_id: { type: ['string', 'null'] },
    external_reference: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
    recipient_name: { type: ['string', 'null'] },
    recipient_account_last4: { type: ['string', 'null'] },
    payer_name: { type: ['string', 'null'] },
    status_text: { type: ['string', 'null'], enum: ['approved', 'rejected', 'pending', 'unknown', null] },
    confidence: { type: 'number' },
  },
} as const

const INSTRUCCION_VISION_COMPROBANTE = [
  'You read an Argentine payment receipt (transfer or Mercado Pago) for a customer-support assistant.',
  'Extract ONLY what is printed. Never infer, complete or correct a value: return null when a field is not clearly legible.',
  'You do NOT decide whether a payment happened: status_text only reports what the receipt itself says (approved, rejected, pending, unknown).',
  'amount: digits with a decimal point (for example 15000.00). date: YYYY-MM-DD or YYYY-MM-DDTHH:mm as printed.',
  'recipient_account_last4: the LAST FOUR digits of a CVU/CBU only, never the whole number. Never return DNI, CUIL, email or phone.',
  'Set legible=false if the image is not a payment receipt or cannot be read. confidence is between 0 and 1.',
  `Answer with a single JSON object matching this JSON Schema: ${JSON.stringify(JSON_SCHEMA_COMPROBANTE_VISION)}`,
].join(' ')

export interface ModeloVisionComprobante {
  extraer(imagen: { bytes: Buffer; mimeType: string }): Promise<unknown | null>
}

// Groq vision with the same pool and endpoint as the identity reader. The image travels as a
// base64 data URL to Groq: only used with WHATSAPP_RECEIPT_ANALYZER=vision. Nothing is logged.
export class ModeloVisionComprobanteGroq implements ModeloVisionComprobante {
  private readonly pool: GroqCredentialPool

  constructor(
    private readonly options: { apiKey?: string; pool?: GroqCredentialPool; model?: string; responseFormat?: 'json_schema' | 'json_object'; timeoutMs?: number; endpoint?: string; fetch?: typeof fetch }
  ) {
    const pool = options.pool ?? (options.apiKey ? crearPoolCredencialesGroq({ GROQ_API_KEY: options.apiKey }, { fetch: options.fetch }) : null)
    if (!pool) throw new Error('GROQ_API_KEY is required for the receipt vision reader')
    this.pool = pool
  }

  async extraer(imagen: { bytes: Buffer; mimeType: string }): Promise<unknown | null> {
    const body = JSON.stringify({
      model: this.options.model || GROQ_VISION_MODEL_POR_DEFECTO,
      temperature: 0,
      max_completion_tokens: 700,
      response_format:
        this.options.responseFormat === 'json_schema'
          ? { type: 'json_schema', json_schema: { name: 'lectura_comprobante', strict: true, schema: JSON_SCHEMA_COMPROBANTE_VISION } }
          : { type: 'json_object' },
      messages: [
        { role: 'system', content: INSTRUCCION_VISION_COMPROBANTE },
        { role: 'user', content: [{ type: 'text', text: 'Read this payment receipt.' }, { type: 'image_url', image_url: { url: `data:${imagen.mimeType};base64,${imagen.bytes.toString('base64')}` } }] },
      ],
    })
    if (Buffer.byteLength(body) > 20 * 1024 * 1024) return null
    const timeoutMs = this.options.timeoutMs ?? 30_000
    const enviadoEn = Date.now()
    const response = await this.pool
      .request({
        url: this.options.endpoint ?? GROQ_CHAT_COMPLETIONS_URL,
        idempotent: true,
        createInit: () => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(timeoutMs) }),
      })
      .catch((error: unknown) => {
        // The pool reports a failed request without its cause (it may quote the request). A
        // request that used up its time limit is a timeout, not a provider error.
        if (Date.now() - enviadoEn >= timeoutMs) throw Object.assign(new Error('groq vision request timed out'), { name: 'TimeoutError' })
        throw error
      })
    // Reported by status only: the body may echo request data.
    if (!response.ok) throw new Error(`groq vision request failed with status ${response.status}`)
    const payload = (await response.json()) as { choices?: { finish_reason?: string; message?: { content?: string | null } }[] }
    const choice = payload.choices?.[0]
    if (!choice?.message?.content || choice.finish_reason === 'length') return null
    const limpio = choice.message.content.replace(/<think>[\s\S]*?<\/think>/gu, '').trim()
    const inicio = limpio.indexOf('{')
    const fin = limpio.lastIndexOf('}')
    if (inicio < 0 || fin <= inicio) return null
    try {
      return JSON.parse(limpio.slice(inicio, fin + 1))
    } catch {
      return null
    }
  }
}

// Vision reading of images (the model's answer must fit the strict schema or it is discarded);
// PDFs are read from their text layer locally, never sent to the model.
export class AnalizadorComprobanteVision implements AnalizadorComprobante {
  readonly kind = 'vision' as const

  constructor(
    private readonly modelo: ModeloVisionComprobante,
    private readonly pdf: ExtractorTextoPdf | null,
    private readonly limits: Pick<LimitesComprobante, 'maxPdfPages' | 'timeoutMs'>
  ) {}

  async analizar(archivo: ComprobanteValidado): Promise<EvidenciaComprobante> {
    if (archivo.kind === 'pdf') return analizarPdf(archivo, this.pdf, this.limits, 'vision')
    let crudo: unknown
    try {
      crudo = await conLimiteDeTiempo(this.modelo.extraer({ bytes: archivo.bytes, mimeType: archivo.mimeType }), this.limits.timeoutMs)
    } catch (error) {
      // The provider answered an error, was unreachable or is rate limited: it failed, the file
      // was not judged. Nothing of its answer is kept.
      if (error instanceof ErrorComprobante) throw error
      // The request was aborted by its own time limit: a timeout, like the outer guard.
      const nombre = error instanceof Error ? error.name : ''
      throw new ErrorComprobante(nombre === 'TimeoutError' || nombre === 'AbortError' ? 'ANALYZER_TIMEOUT' : 'ANALYZER_FAILED', 'vision provider failed')
    }
    const parsed = EsquemaComprobanteVision.safeParse(crudo)
    // Output outside the schema is discarded: nothing a model says freely is ever used.
    if (!parsed.success || !parsed.data.legible) throw new ErrorComprobante('NO_TEXT', 'the receipt could not be read')
    const lectura = parsed.data
    const confianza = Math.max(0, Math.min(1, lectura.confidence))
    const ultimos = lectura.recipient_account_last4?.replace(/\D/gu, '').slice(-4) ?? ''
    return {
      ...EVIDENCIA_VACIA,
      analyzer: 'vision',
      amountMinor: lectura.amount ? montoAMinor(lectura.amount) : null,
      currency: lectura.currency,
      operationId: lectura.operation_id && /^\d{6,20}$/u.test(lectura.operation_id) ? lectura.operation_id : null,
      externalReference: lectura.external_reference && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/u.test(lectura.external_reference) ? lectura.external_reference : null,
      occurredAt: lectura.date && /^20\d{2}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/u.test(lectura.date) ? lectura.date : null,
      recipientName: nombre(lectura.recipient_name ?? undefined),
      recipientAccountHint: ultimos.length === 4 ? ultimos : null,
      payerName: nombre(lectura.payer_name ?? undefined),
      status: lectura.status_text ?? 'unknown',
      confidence: { overall: confianza },
    }
  }

  // The provider is only known to be configured: it is not called to find out.
  async capacidades(): Promise<CapacidadesComprobantes> {
    return { analyzer: 'vision', images: { available: true, reason: 'configured' }, pdf: await capacidadPdf(this.pdf) }
  }
}

// ---- correlation: only among the client's OWN payments ------------------------------------------

// A payment of the asking client that could be what the receipt is about (the backend lists them
// from the client's own turnos and works, never from the receipt).
export interface PagoCandidato {
  ref: string
  amountMinor: string | null
  currency: string | null
  // ISO start of the turno (null for a work).
  startsAt: string | null
  providerName: string
  service: string | null
  // Mercado Pago's payment id when TUS already knows it for THIS intent (a webhook or an earlier
  // query linked it). Used only to match an operation number against the client's own payment.
  operationRef: string | null
}

export interface PistasDelTexto {
  // Local date YYYY-MM-DD the person's words point to ("mañana"), when they say one.
  day?: string | null
  // The person's words, lower-case and without accents (provider or service names).
  words?: string
}

export type ResultadoCorrelacion =
  | { tipo: 'unica'; candidato: PagoCandidato }
  | { tipo: 'ambigua'; candidatos: PagoCandidato[] }
  | { tipo: 'ninguna' }

// Chooses among the client's OWN candidates. The evidence only ranks them (amount, currency,
// date, who is paid, an operation number that matches a candidate's own payment, the words of
// the person); it never creates a candidate, never reaches Mercado Pago, never confirms. One
// candidate: it is that one. Several: the best only if clearly better than the rest, else ask.
export function correlacionarComprobante(evidencia: EvidenciaComprobante | null, candidatos: PagoCandidato[], pistas: PistasDelTexto = {}): ResultadoCorrelacion {
  if (candidatos.length === 0) return { tipo: 'ninguna' }
  if (candidatos.length === 1) return { tipo: 'unica', candidato: candidatos[0]! }
  const palabras = (value: string) => sinAcentos(value).toLowerCase().split(/[^a-z0-9ñ]+/u).filter((palabra) => palabra.length >= 3)
  const puntaje = (candidato: PagoCandidato): number => {
    let total = 0
    if (evidencia) {
      // An amount in another currency is not the candidate's amount.
      if (evidencia.amountMinor !== null && candidato.amountMinor !== null && (evidencia.currency === null || evidencia.currency === candidato.currency) && evidencia.amountMinor === candidato.amountMinor) total += 4
      if (evidencia.operationId !== null && candidato.operationRef !== null && evidencia.operationId === candidato.operationRef) total += 6
      if (evidencia.occurredAt !== null && candidato.startsAt !== null && evidencia.occurredAt.slice(0, 10) === candidato.startsAt.slice(0, 10)) total += 1
      if (evidencia.recipientName !== null) {
        const destinatario = new Set(palabras(evidencia.recipientName))
        if (palabras(candidato.providerName).some((palabra) => destinatario.has(palabra))) total += 2
      }
    }
    if (pistas.day && candidato.startsAt !== null && candidato.startsAt.slice(0, 10) === pistas.day) total += 2
    if (pistas.words) {
      const dichas = new Set(palabras(pistas.words))
      if (palabras(candidato.providerName).some((palabra) => dichas.has(palabra))) total += 3
      if (candidato.service && palabras(candidato.service).some((palabra) => dichas.has(palabra))) total += 2
    }
    return total
  }
  const ordenados = candidatos.map((candidato) => ({ candidato, puntos: puntaje(candidato) })).sort((a, b) => b.puntos - a.puntos)
  const [mejor, segundo] = ordenados
  if (mejor!.puntos > 0 && mejor!.puntos > segundo!.puntos) return { tipo: 'unica', candidato: mejor!.candidato }
  return { tipo: 'ambigua', candidatos }
}

// ---- download + validation + reading -------------------------------------------------------------

export interface DescargaMedia {
  downloadMedia(mediaId: string, limits: { maxBytes: number; allowedMimeTypes: readonly string[] }): Promise<{ mimeType: string; bytes: Buffer }>
}

// Download (Meta, hosts and bytes controlled), validation of the real file, reading, and the
// bytes are dropped: nothing is stored here.
export class ServicioComprobantes {
  constructor(
    private readonly descarga: DescargaMedia,
    private readonly analizador: AnalizadorComprobante,
    private readonly limits: LimitesComprobante
  ) {}

  // What can be read here, for readiness and for the start-up log.
  async capacidades(): Promise<CapacidadesComprobantes> {
    return this.analizador.capacidades ? this.analizador.capacidades() : { analyzer: this.analizador.kind, images: { available: true, reason: 'ok' }, pdf: { available: true, reason: 'ok' } }
  }

  async analizar(mediaId: string): Promise<EvidenciaComprobante> {
    let descargado: { mimeType: string; bytes: Buffer }
    try {
      descargado = await this.descarga.downloadMedia(mediaId, {
        maxBytes: Math.max(this.limits.maxImageBytes, this.limits.maxPdfBytes),
        allowedMimeTypes: [...this.limits.allowedMimeTypes, 'image/jpg'],
      })
    } catch (error) {
      // The provider enforces the byte cap while reading: an oversized file is reported as such.
      if (error instanceof Error && /too large/i.test(error.message)) throw new ErrorComprobante('TOO_LARGE', 'the file is too large')
      throw new ErrorComprobante('DOWNLOAD_FAILED', 'the file could not be downloaded')
    }
    const archivo = validarComprobante(descargado.bytes, descargado.mimeType, this.limits)
    // Outer guard: whatever the analyzer does, the analysis is bounded in time.
    return conLimiteDeTiempo(this.analizador.analizar(archivo), this.limits.timeoutMs + 1_000)
  }
}
