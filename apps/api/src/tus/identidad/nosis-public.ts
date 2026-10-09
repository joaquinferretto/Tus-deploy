import { soloDigitos, type PersonaFuenteExterna } from './modelo.ts'
import {
  ErrorProveedorIdentidad,
  type IdentityVerificationProvider,
  type ResultadoProveedorIdentidad,
} from './proveedor.ts'

// DOCUMENTO-NOSIS-PUBLICO-01. The PUBLIC search of Nosis (informes.nosis.com), asked over plain
// HTTP: one POST that answers JSON. No login, no browser, no report.
//
// What this adapter does and does not do:
// - It only ever asks for the document number of a verification of TUS (the worker calls it; there
//   is no route that takes a document number).
// - It reads ONLY the tax id (CUIT/CUIL), the name and the province of each result. Everything else
//   the answer carries (activity, the links to the paid report, the habeas data notice) is dropped
//   here, before anything leaves this file: it is never returned, stored or logged.
// - It never opens nor buys a report ("UrlInforme" is not even read).
// - When Nosis asks for a captcha it STOPS and reports it: a captcha is never answered here.
// - Nothing of a person is logged: errors carry a code, never the document number or the answer.

export const NOSIS_PUBLICO_URL_BASE = 'https://informes.nosis.com'
const RUTA_BUSCAR = '/Home/Buscar'
const AGENTE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

// What TUS keeps of a result of the public search.
export interface ResultadoBusquedaPublicaNosis {
  documentNumber: string
  taxId: string | null
  fullName: string
  province: string | null
  source: 'nosis_public'
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; headers?: { getSetCookie?: () => string[]; get?: (name: string) => string | null }; json(): Promise<unknown>; text?: () => Promise<string> }>

export interface ConfiguracionNosisPublico {
  fetch?: FetchLike
  baseUrl?: string
  timeoutMs?: number
}

const esObjeto = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const textoLimpio = (value: unknown): string => (typeof value === 'string' ? value.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim() : '')

// The document number inside a CUIT/CUIL ("20-45247702-6" -> "45247702"). Null when the value is
// not an 11-digit tax id.
export function dniDeCuit(value: string | null | undefined): string | null {
  const digits = soloDigitos(value)
  if (!/^\d{11}$/u.test(digits)) return null
  return digits.slice(2, 10).replace(/^0+/u, '') || null
}

// Reads the JSON of the public search. Pure: the same function reads a real answer and a fixture.
// An answer that is not the documented shape is NOSIS_LAYOUT_CHANGED (never guessed).
export function leerRespuestaNosisPublica(body: unknown): ResultadoBusquedaPublicaNosis[] {
  if (!esObjeto(body) || typeof body['ExigirCaptcha'] !== 'boolean' || !Array.isArray(body['EntidadesEncontradas']))
    throw new ErrorProveedorIdentidad('NOSIS_LAYOUT_CHANGED', 'the public search answered an unexpected shape', true)
  if (body['ExigirCaptcha']) throw new ErrorProveedorIdentidad('NOSIS_CHALLENGE_REQUIRED', 'the public search asks for a captcha', true)
  if (body['HayError'] === true) throw new ErrorProveedorIdentidad('NOSIS_UNAVAILABLE', 'the public search reported an error', true)
  const resultados: ResultadoBusquedaPublicaNosis[] = []
  for (const entidad of body['EntidadesEncontradas']) {
    if (!esObjeto(entidad) || typeof entidad['Documento'] !== 'string' || typeof entidad['RazonSocial'] !== 'string')
      throw new ErrorProveedorIdentidad('NOSIS_LAYOUT_CHANGED', 'a result of the public search has an unexpected shape', true)
    const documento = soloDigitos(entidad['Documento'])
    const taxId = /^\d{11}$/u.test(documento) ? documento : null
    // The search is by document number: a result shows its CUIT/CUIL (the document inside it) or,
    // rarely, the document number itself.
    const documentNumber = taxId ? dniDeCuit(taxId) : /^\d{6,9}$/u.test(documento) ? documento.replace(/^0+/u, '') : null
    const fullName = textoLimpio(entidad['RazonSocial'])
    if (!documentNumber || !fullName) throw new ErrorProveedorIdentidad('NOSIS_LAYOUT_CHANGED', 'a result of the public search has no document or name', true)
    // Only these four values leave this function; every other key of the entity is ignored.
    resultados.push({ documentNumber, taxId, fullName, province: textoLimpio(entidad['Provincia']) || null, source: 'nosis_public' })
  }
  // More results than the answer carries: a document number must identify ONE person, so this
  // is reported as more than one result (ambiguous: a person looks at it).
  if (body['HayMasResultados'] === true && resultados.length <= 1) resultados.push(...resultados.slice(0, 1))
  return resultados
}

export class NosisPublicLookupAdapter implements IdentityVerificationProvider {
  readonly id = 'nosis-public' as const
  readonly method = 'nosis_public' as const
  private readonly fetchImpl: FetchLike
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(config: ConfiguracionNosisPublico = {}) {
    this.fetchImpl = config.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.baseUrl = (config.baseUrl ?? NOSIS_PUBLICO_URL_BASE).replace(/\/+$/u, '')
    this.timeoutMs = config.timeoutMs ?? 15_000
  }

  // The public search has no session: nothing to prepare, and no slot is consumed here.
  async prepararSesion(): Promise<void> {}

  async consultar(query: { documentNumber: string }, consumirSlot: () => Promise<boolean>): Promise<ResultadoProveedorIdentidad> {
    const documento = soloDigitos(query.documentNumber)
    if (!/^\d{6,9}$/u.test(documento)) throw new ErrorProveedorIdentidad('NOSIS_UNAVAILABLE', 'invalid document number for the public search')
    if (!(await consumirSlot())) throw new ErrorProveedorIdentidad('NOSIS_RATE_LIMITED', 'rate limit reached')
    const resultados = leerRespuestaNosisPublica(await this.buscar(documento))
    const results: PersonaFuenteExterna[] = resultados.map((item) => ({
      documentNumber: item.documentNumber,
      fullName: item.fullName,
      cuil: item.taxId,
      verifiedArea: item.province ? { barrio: null, localidad: null, provincia: item.province } : null,
    }))
    return { results, providerReference: null }
  }

  // The same request the public page makes: its landing page first (the session cookie of the
  // site), then the search form. Any failure is a code; nothing of the answer travels in an error.
  private async buscar(documento: string): Promise<unknown> {
    const cabeceras = { 'user-agent': AGENTE, accept: 'application/json, text/javascript, */*; q=0.01', 'accept-language': 'es-AR,es;q=0.9' }
    let cookie = ''
    try {
      const inicio = await this.fetchImpl(`${this.baseUrl}/`, { method: 'GET', headers: { ...cabeceras, accept: 'text/html' }, signal: AbortSignal.timeout(this.timeoutMs) })
      cookie = (inicio.headers?.getSetCookie?.() ?? []).map((item) => item.split(';')[0]).filter(Boolean).join('; ')
    } catch {
      throw new ErrorProveedorIdentidad('NOSIS_NETWORK', 'the public search is unreachable', false)
    }
    const form = new URLSearchParams({
      Texto: documento,
      Tipo: '-1',
      EdadDesde: '-1',
      EdadHasta: '-1',
      IdProvincia: '-1',
      Localidad: '',
      // The values the public form itself sends while no captcha is shown. When the site asks for
      // one (ExigirCaptcha) this adapter stops: it never sends an answer to a captcha.
      recaptcha_response_field: 'enganio al captcha',
      recaptcha_challenge_field: 'enganio al captcha',
      encodedResponse: '',
    })
    let respuesta: Awaited<ReturnType<FetchLike>>
    try {
      respuesta = await this.fetchImpl(`${this.baseUrl}${RUTA_BUSCAR}`, {
        method: 'POST',
        headers: { ...cabeceras, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', referer: `${this.baseUrl}/`, ...(cookie ? { cookie } : {}) },
        body: form.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      // A timeout or a dropped connection: the search may or may not have been received.
      throw new ErrorProveedorIdentidad('NOSIS_NETWORK', 'the public search did not answer in time', true)
    }
    if (respuesta.status === 429) throw new ErrorProveedorIdentidad('NOSIS_CHALLENGE_REQUIRED', 'the public search is throttling', true)
    if (!respuesta.ok) throw new ErrorProveedorIdentidad('NOSIS_UNAVAILABLE', `the public search answered HTTP ${respuesta.status}`, true)
    try {
      return await respuesta.json()
    } catch {
      throw new ErrorProveedorIdentidad('NOSIS_LAYOUT_CHANGED', 'the public search did not answer JSON', true)
    }
  }
}
