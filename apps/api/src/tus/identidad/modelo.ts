import { sinAcentos } from '../texto.ts'

// IDENTITY-NOSIS: identity verification of providers (prestadores). Pure domain: states,
// normalization, Argentine CUIL validation, document reconciliation and matching. No I/O.

export const ESTADOS_VERIFICACION_IDENTIDAD = [
  'pending_upload',
  'queued',
  'processing',
  'retry_pending',
  'session_required',
  'review_required',
  'verified',
  'rejected',
  'failed',
] as const
export type EstadoVerificacionIdentidad = (typeof ESTADOS_VERIFICACION_IDENTIDAD)[number]

export const MOTIVOS_REVISION_IDENTIDAD = [
  'DOCUMENT_READER_MISMATCH',
  'DOCUMENT_UNREADABLE',
  'DOCUMENT_LOW_CONFIDENCE',
  'NOSIS_NOT_FOUND',
  'NOSIS_AMBIGUOUS_RESULT',
  'DOCUMENT_NUMBER_MISMATCH',
  'NAME_MISMATCH',
  'NAME_PARTIAL_MATCH',
  'CUIL_INVALID',
  'CUIL_DOCUMENT_MISMATCH',
  // DOCUMENTO-NOSIS-PUBLICO-01: the province is the third datum compared.
  'PROVINCE_MISMATCH',
  'PROVINCE_UNAVAILABLE',
  // The source answered something that is not its documented shape: a person looks at it.
  'PROVIDER_RESPONSE_UNEXPECTED',
  'IDENTITY_ALREADY_VERIFIED',
  'RETRIES_EXHAUSTED',
  'MANUAL_REVIEW_REQUESTED',
] as const
export type MotivoRevisionIdentidad = (typeof MOTIVOS_REVISION_IDENTIDAD)[number]

export type MetodoVerificacionIdentidad = 'nosis_browser' | 'nosis_api' | 'nosis_public' | 'demo' | 'manual'

export const VERSION_CONSENTIMIENTO_IDENTIDAD = 'identidad-prestador-v1'
export const PROPOSITO_CONSENTIMIENTO_IDENTIDAD = 'alta_prestador'
export const TEXTO_CONSENTIMIENTO_IDENTIDAD =
  'Autorizo a TUS a verificar los datos de identidad proporcionados mediante fuentes externas de validación con el fin de validar mi alta como prestador.'

export class ErrorIdentidad extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ErrorIdentidad'
  }
}

// ---- normalization -------------------------------------------------------------------------

export function soloDigitos(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D+/gu, '')
}

// Trim, collapse spaces, uppercase and strip diacritics. Only used for comparison; the original
// value is preserved separately.
export function normalizarNombre(value: string | null | undefined): string {
  return sinAcentos(String(value ?? ''))
    .replace(/[^A-Za-zÑñ' -]+/gu, ' ')
    .toUpperCase()
    .replace(/\s+/gu, ' ')
    .trim()
}

export function normalizarDni(value: string | null | undefined): string | null {
  const digits = soloDigitos(value).replace(/^0+/u, '')
  return /^\d{6,9}$/u.test(digits) ? digits : null
}

// ---- CUIL / CUIT ---------------------------------------------------------------------------

const PESOS_CUIL = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
const PREFIJOS_PERSONA = new Set(['20', '23', '24', '27'])

export function digitoVerificadorCuil(first10: string): number | null {
  if (!/^\d{10}$/u.test(first10)) return null
  const sum = PESOS_CUIL.reduce(
    (total, weight, index) => total + weight * Number(first10[index]),
    0
  )
  const mod = 11 - (sum % 11)
  if (mod === 11) return 0
  if (mod === 10) return null // invalid combination: AFIP reassigns the prefix (23) instead
  return mod
}

export interface ValidacionCuil {
  valid: boolean
  cuil: string | null
  reason: 'FORMAT' | 'PREFIX' | 'CHECKSUM' | 'DOCUMENT_MISMATCH' | null
}

// Validates structure, person prefix and checksum; when a DNI is given, the middle 8 digits must
// be that DNI (left-padded). A value is never accepted by format alone.
export function validarCuil(value: string | null | undefined, dni?: string | null): ValidacionCuil {
  const digits = soloDigitos(value)
  if (!/^\d{11}$/u.test(digits)) return { valid: false, cuil: null, reason: 'FORMAT' }
  if (!PREFIJOS_PERSONA.has(digits.slice(0, 2)))
    return { valid: false, cuil: digits, reason: 'PREFIX' }
  if (digitoVerificadorCuil(digits.slice(0, 10)) !== Number(digits[10]))
    return { valid: false, cuil: digits, reason: 'CHECKSUM' }
  if (dni) {
    const normalized = normalizarDni(dni)
    if (!normalized || digits.slice(2, 10) !== normalized.padStart(8, '0'))
      return { valid: false, cuil: digits, reason: 'DOCUMENT_MISMATCH' }
  }
  return { valid: true, cuil: digits, reason: null }
}

// ---- masking for logs/audit ----------------------------------------------------------------

export function enmascararDni(value: string | null | undefined): string {
  const digits = soloDigitos(value)
  return digits.length <= 3 ? '***' : `***${digits.slice(-3)}`
}

export function enmascararCuil(value: string | null | undefined): string {
  const digits = soloDigitos(value)
  return digits.length === 11
    ? `${digits.slice(0, 2)}-*****${digits.slice(7, 10)}-${digits[10]}`
    : '***'
}

// ---- document readings ---------------------------------------------------------------------

export interface LecturaDocumento {
  reader: 'ocr' | 'vision'
  documentNumber: string | null
  firstName: string | null
  lastName: string | null
  birthDate: string | null
  sex: 'M' | 'F' | 'X' | null
  nationality: string | null
  expirationDate: string | null
  // DOCUMENTO-NOSIS-PUBLICO-01: the province printed in the address of the document, only when
  // the reader could read it (the MRZ carries none). Never a street or a number.
  province?: string | null
  // 0..1. Low confidence never verifies.
  confidence: number
  unavailable?: boolean
  // The reader could not run (engine or provider outage): worth retrying later.
  transient?: boolean
}

export const CONFIANZA_MINIMA_LECTURA = 0.6

export type ResultadoReconciliacion =
  | {
      status: 'consistent'
      documentNumber: string
      firstName: string | null
      lastName: string | null
      birthDate: string | null
      sex: 'M' | 'F' | 'X' | null
    }
  | { status: 'review'; reason: MotivoRevisionIdentidad }

// OCR and vision only produce candidates. Both must agree on the document number before an
// external (rate-limited) Nosis query is spent.
export function reconciliarLecturas(
  ocr: LecturaDocumento,
  vision: LecturaDocumento
): ResultadoReconciliacion {
  const usable = [ocr, vision].filter(
    (reading) => !reading.unavailable && reading.confidence >= CONFIANZA_MINIMA_LECTURA
  )
  if (usable.length < 2) {
    const any = [ocr, vision].some((reading) => normalizarDni(reading.documentNumber))
    return { status: 'review', reason: any ? 'DOCUMENT_LOW_CONFIDENCE' : 'DOCUMENT_UNREADABLE' }
  }
  const dniOcr = normalizarDni(ocr.documentNumber)
  const dniVision = normalizarDni(vision.documentNumber)
  if (!dniOcr || !dniVision) return { status: 'review', reason: 'DOCUMENT_UNREADABLE' }
  if (dniOcr !== dniVision) return { status: 'review', reason: 'DOCUMENT_READER_MISMATCH' }
  const pick = (a: string | null, b: string | null) => {
    if (a && b && normalizarNombre(a) !== normalizarNombre(b)) return null
    return a ?? b
  }
  return {
    status: 'consistent',
    documentNumber: dniOcr,
    firstName: pick(ocr.firstName, vision.firstName),
    lastName: pick(ocr.lastName, vision.lastName),
    birthDate:
      ocr.birthDate && vision.birthDate && ocr.birthDate !== vision.birthDate
        ? null
        : (ocr.birthDate ?? vision.birthDate),
    sex: ocr.sex && vision.sex && ocr.sex !== vision.sex ? null : (ocr.sex ?? vision.sex),
  }
}

// ---- matching against the external source ---------------------------------------------------

export interface PersonaFuenteExterna {
  documentNumber: string | null
  // "Denominación" as shown by the source, usually "APELLIDO NOMBRE" or "APELLIDO, NOMBRE".
  fullName: string | null
  cuil: string | null
  // Optional normalized area returned by an identity source. Exact address data is never stored.
  verifiedArea?: AreaDomicilioVerificada | null
}

export interface AreaDomicilioVerificada {
  barrio: string | null
  localidad: string | null
  provincia: string | null
}

export type ResultadoComparacion =
  | { decision: 'verified'; cuil: string }
  | { decision: 'review_required'; reason: MotivoRevisionIdentidad }
  | { decision: 'rejected'; reason: MotivoRevisionIdentidad }

function tokens(value: string | null | undefined): string[] {
  // Punctuation never separates two people: a comma, a dot and a hyphen are spaces here
  // ("PEREZ-GOMEZ" and "PEREZ GOMEZ" are the same tokens).
  return normalizarNombre(String(value ?? '').replace(/[,.-]/gu, ' '))
    .split(' ')
    .filter(Boolean)
}

// Name compatibility without permissive fuzzy matching: every token of the document first and
// last name must appear in the source name, and the source must not carry extra tokens. Extra
// tokens on either side (second given names) are a controlled "partial" that goes to review.
export function compararNombre(
  document: { firstName: string | null; lastName: string | null },
  sourceFullName: string | null
): 'match' | 'partial' | 'mismatch' {
  const docTokens = [...tokens(document.lastName), ...tokens(document.firstName)]
  const sourceTokens = tokens(sourceFullName)
  if (docTokens.length === 0 || sourceTokens.length === 0) return 'mismatch'
  const lastNames = tokens(document.lastName)
  if (lastNames.length === 0 || !lastNames.every((token) => sourceTokens.includes(token)))
    return 'mismatch'
  const docSet = new Set(docTokens)
  const sourceSet = new Set(sourceTokens)
  const missingInSource = [...docSet].filter((token) => !sourceSet.has(token))
  const extraInSource = [...sourceSet].filter((token) => !docSet.has(token))
  if (missingInSource.length === 0 && extraInSource.length === 0) return 'match'
  // At least one given name shared: second names differ -> partial (review, never auto-reject).
  const givenNames = tokens(document.firstName)
  if (givenNames.some((token) => sourceSet.has(token))) return 'partial'
  return 'mismatch'
}

// ---- province (DOCUMENTO-NOSIS-PUBLICO-01) --------------------------------------------------

// The 24 jurisdictions of Argentina, as compared: uppercase, no accents, no punctuation.
const PROVINCIAS = ['BUENOS AIRES', 'CIUDAD AUTONOMA DE BUENOS AIRES', 'CATAMARCA', 'CHACO', 'CHUBUT', 'CORDOBA', 'CORRIENTES', 'ENTRE RIOS', 'FORMOSA', 'JUJUY', 'LA PAMPA', 'LA RIOJA', 'MENDOZA', 'MISIONES', 'NEUQUEN', 'RIO NEGRO', 'SALTA', 'SAN JUAN', 'SAN LUIS', 'SANTA CRUZ', 'SANTA FE', 'SANTIAGO DEL ESTERO', 'TIERRA DEL FUEGO', 'TUCUMAN'] as const
const ALIAS_PROVINCIA: Record<string, (typeof PROVINCIAS)[number]> = {
  CABA: 'CIUDAD AUTONOMA DE BUENOS AIRES',
  'C A B A': 'CIUDAD AUTONOMA DE BUENOS AIRES',
  'CAPITAL FEDERAL': 'CIUDAD AUTONOMA DE BUENOS AIRES',
  'CIUDAD DE BUENOS AIRES': 'CIUDAD AUTONOMA DE BUENOS AIRES',
  'TIERRA DEL FUEGO ANTARTIDA E ISLAS DEL ATLANTICO SUR': 'TIERRA DEL FUEGO',
  'PROVINCIA DE BUENOS AIRES': 'BUENOS AIRES',
}

// A province as it is compared, or null when the text is not one of them (never approximated).
export function normalizarProvincia(value: string | null | undefined): string | null {
  const texto = normalizarNombre(String(value ?? '').replace(/[.'-]/gu, ' ')).replace(/\s+/gu, ' ').trim()
  if (!texto) return null
  const sinPrefijo = texto.replace(/^(?:PROVINCIA|PCIA|PROV)\s+(?:DE\s+|DEL\s+)?/u, '')
  for (const candidata of [texto, sinPrefijo]) {
    if ((PROVINCIAS as readonly string[]).includes(candidata)) return candidata
    if (ALIAS_PROVINCIA[candidata]) return ALIAS_PROVINCIA[candidata]!
  }
  return null
}

// 'unavailable': one of the two sources has no province TUS can recognize.
export function compararProvincia(documento: string | null | undefined, fuente: string | null | undefined): 'match' | 'mismatch' | 'unavailable' {
  const a = normalizarProvincia(documento)
  const b = normalizarProvincia(fuente)
  if (!a || !b) return 'unavailable'
  return a === b ? 'match' : 'mismatch'
}

// What an administrator reads next to a verification: the datum of the document, the one of the
// source and whether they agree. Only for a single result; nothing else of the source.
export interface DetalleComparacionDocumental {
  dni: { document: string | null; source: string | null; match: boolean }
  name: { document: string | null; source: string | null; match: 'match' | 'partial' | 'mismatch' }
  province: { document: string | null; source: string | null; match: 'match' | 'mismatch' | 'unavailable' }
}

export function detalleComparacion(input: { documentNumber: string | null; firstName: string | null; lastName: string | null; documentProvince: string | null; results: PersonaFuenteExterna[] }): DetalleComparacionDocumental | null {
  if (input.results.length !== 1) return null
  const person = input.results[0]!
  const dniDocumento = normalizarDni(input.documentNumber)
  const dniFuente = normalizarDni(person.documentNumber)
  const nombreDocumento = normalizarNombre([input.firstName, input.lastName].filter(Boolean).join(' ')) || null
  return {
    dni: { document: dniDocumento, source: dniFuente, match: Boolean(dniDocumento && dniFuente && dniDocumento === dniFuente) },
    name: { document: nombreDocumento, source: normalizarNombre(String(person.fullName ?? '').replace(/,/gu, ' ')) || null, match: compararNombre({ firstName: input.firstName, lastName: input.lastName }, person.fullName) },
    province: { document: normalizarProvincia(input.documentProvince), source: normalizarProvincia(person.verifiedArea?.provincia ?? null), match: compararProvincia(input.documentProvince, person.verifiedArea?.provincia ?? null) },
  }
}

// The outcome of a documentary verification, in the words of the product. Derived from the stored
// state and reason; null while nothing was decided yet.
export type ResultadoDocumental = 'VERIFIED' | 'MISMATCH' | 'NOT_FOUND' | 'MANUAL_REVIEW_REQUIRED' | 'PROVIDER_UNAVAILABLE'
const MOTIVOS_NO_COINCIDE: ReadonlySet<string> = new Set(['DOCUMENT_NUMBER_MISMATCH', 'NAME_MISMATCH', 'CUIL_DOCUMENT_MISMATCH', 'PROVINCE_MISMATCH'])
export function resultadoDocumental(verificacion: { status: EstadoVerificacionIdentidad; reviewReason: string | null }): ResultadoDocumental | null {
  if (verificacion.status === 'verified') return 'VERIFIED'
  if (verificacion.status === 'retry_pending' || verificacion.status === 'session_required' || verificacion.status === 'failed') return 'PROVIDER_UNAVAILABLE'
  if (verificacion.status === 'rejected') return 'MISMATCH'
  if (verificacion.status !== 'review_required') return null
  if (verificacion.reviewReason === 'NOSIS_NOT_FOUND') return 'NOT_FOUND'
  return verificacion.reviewReason && MOTIVOS_NO_COINCIDE.has(verificacion.reviewReason) ? 'MISMATCH' : 'MANUAL_REVIEW_REQUIRED'
}

export function compararConFuente(input: {
  documentNumber: string
  firstName: string | null
  lastName: string | null
  results: PersonaFuenteExterna[]
  // DOCUMENTO-NOSIS-PUBLICO-01: with `required`, the province of the document must also agree
  // with the one of the source. Missing on either side: a person decides (never an automatic
  // approval nor an automatic rejection). Different: it does not match.
  province?: { required: boolean; document: string | null }
}): ResultadoComparacion {
  if (input.results.length === 0) return { decision: 'review_required', reason: 'NOSIS_NOT_FOUND' }
  if (input.results.length > 1)
    return { decision: 'review_required', reason: 'NOSIS_AMBIGUOUS_RESULT' }
  const person = input.results[0]!
  const dni = normalizarDni(person.documentNumber)
  // Different DNI: never verified. It is a different person, but a DNI search that returns
  // another number is a data problem, so it goes to review rather than an automatic rejection.
  if (!dni || dni !== normalizarDni(input.documentNumber))
    return { decision: 'review_required', reason: 'DOCUMENT_NUMBER_MISMATCH' }
  const cuil = validarCuil(person.cuil, input.documentNumber)
  if (!cuil.valid)
    return {
      decision: 'review_required',
      reason: cuil.reason === 'DOCUMENT_MISMATCH' ? 'CUIL_DOCUMENT_MISMATCH' : 'CUIL_INVALID',
    }
  const name = compararNombre(
    { firstName: input.firstName, lastName: input.lastName },
    person.fullName
  )
  if (name === 'partial') return { decision: 'review_required', reason: 'NAME_PARTIAL_MATCH' }
  if (name === 'mismatch') return { decision: 'rejected', reason: 'NAME_MISMATCH' }
  if (input.province?.required) {
    const provincia = compararProvincia(input.province.document, person.verifiedArea?.provincia ?? null)
    if (provincia === 'unavailable') return { decision: 'review_required', reason: 'PROVINCE_UNAVAILABLE' }
    if (provincia === 'mismatch') return { decision: 'review_required', reason: 'PROVINCE_MISMATCH' }
  }
  return { decision: 'verified', cuil: cuil.cuil! }
}

// ---- retries -------------------------------------------------------------------------------

export const ESPERAS_REINTENTO_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000] as const

export function proximoReintento(attempt: number, now: number): number | null {
  const wait = ESPERAS_REINTENTO_MS[attempt - 1]
  return wait === undefined ? null : now + wait
}
