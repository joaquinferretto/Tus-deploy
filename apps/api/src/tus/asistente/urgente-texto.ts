import { buscarBarrio } from '../catalogo/vigente.ts'
import type { AvisoOfertaUrgente } from '../urgentes/puertos.ts'

// SERVICIO-URGENTE-01. What a message says about an urgent request, read by the backend (no
// model): whether it asks for one, the address and what happened. The service and the zone are
// read by the same reader as every other message (extraerNecesidad).

// ---- the notice to a provider: template name, buttons and wording ---------------------------

export const PLANTILLA_SERVICIO_URGENTE = 'servicio_urgente_disponible'
export const BOTONES_URGENTE = ['Puedo asistir', 'No puedo'] as const

// Each button carries which request and which answer; never who answers.
export const idRespuestaUrgente = (decision: 'asistir' | 'nopuedo', solicitudId: string): string => `urgente:${decision}:${solicitudId}`

export function leerRespuestaUrgente(replyId: string | null | undefined): { asistir: boolean; solicitudId: string } | null {
  const partes = /^urgente:(asistir|nopuedo):([A-Za-z0-9_-]{6,80})$/u.exec(replyId ?? '')
  return partes ? { asistir: partes[1] === 'asistir', solicitudId: partes[2]! } : null
}

// Every message of the notice of one request in one round carries this correlation.
export const correlacionOfertaUrgente = (solicitudId: string, ronda: number): string => `urgente-oferta:${solicitudId}:${ronda}`

// The same sentence the template carries, so the provider reads the same inside and outside the
// 24 hour window.
export function textoOfertaUrgente(aviso: Pick<AvisoOfertaUrgente, 'cliente' | 'servicio' | 'direccion' | 'zona' | 'motivo'>): string {
  return `Hola, ${aviso.cliente} necesita un servicio urgente de ${aviso.servicio}.\nDirección: ${aviso.direccion}\nBarrio/Zona: ${aviso.zona}\nMotivo: ${aviso.motivo}\n¿Podés asistir ahora?`
}

// ---- what a message says ------------------------------------------------------------------------

const plano = (value: string): string => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// "urgente", "urgencia", "emergencia": the words that ask for immediate attention. "ahora" or "ya"
// alone are not (they ask for the first free turno, as always).
const PALABRA_URGENTE = /\b(?:urgente|urgentemente|urgencia|emergencia)\b/u
// The product term, said as such: it starts the flow even before an address is given.
const SERVICIO_URGENTE = /\b(?:servicio|pedido|atencion|asistencia)s? (?:de )?(?:urgente|urgencia|emergencia)\b|\b(?:urgencia|emergencia)\b/u

// A street and its number, after "estoy en", "en", "dirección:" …: everything up to the LAST
// number that is followed by a separator. "Av. 3 de Abril 1850, Barrio Sur" -> "Av. 3 de Abril 1850".
const DIRECCION = /(?:\b(?:estoy|vivo|queda|es|sera|seria) en|\bdirecci[oó]n(?: es)?\s*:?|\bdomicilio(?: es)?\s*:?|\ben(?: la| el)?)\s+((?:(?:av|avda|avenida|calle|pasaje|pje|ruta|bv|boulevard|diagonal)\b\.?\s*)?[^,;\n]{2,70}?\b\d{1,5}(?:\s?(?:bis|[a-d]))?)(?=\s*(?:[,;.\n]|$|\bbarrio\b|\bentre\b|\besquina\b|\besq\b|\bpiso\b|\bdpto\b|\bdepto\b))/iu
// The same shape when the whole message is the answer to "¿cuál es la dirección?".
const DIRECCION_SUELTA = /^\s*((?:(?:av|avda|avenida|calle|pasaje|pje|ruta|bv|boulevard|diagonal)\b\.?\s*)?[^,;\n]{2,70}?\b\d{1,5}(?:\s?(?:bis|[a-d]))?)(?=\s*(?:[,;.\n]|$|\bbarrio\b|\bentre\b|\besquina\b|\besq\b|\bpiso\b|\bdpto\b|\bdepto\b))/iu
// A number that is a duration or a time, never a street number.
const NO_ES_DIRECCION = /\b\d{1,5}\s*(?:hs|horas?|minutos?|min|dias?|pesos)\b|\$\s*\d/iu

const limpiar = (value: string): string => value.replace(/\s+/gu, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/gu, '').trim()

export function direccionEn(texto: string, opciones: { suelta?: boolean } = {}): string | null {
  const encontrada = DIRECCION.exec(texto) ?? (opciones.suelta ? DIRECCION_SUELTA.exec(texto) : null)
  if (!encontrada) return null
  const direccion = limpiar(encontrada[1]!)
  if (direccion.length < 5 || NO_ES_DIRECCION.test(`${direccion} ${texto.slice(encontrada.index + encontrada[0].length, encontrada.index + encontrada[0].length + 12)}`)) return null
  // "en Barrio Sur 2": a zone, not a street.
  return buscarBarrio(direccion.replace(/\s*\d+.*$/u, '')) ? null : direccion
}

export interface UrgenteLeido {
  // The message asks for immediate attention.
  urgente: boolean
  // ...and names the urgent service as such ("un servicio urgente", "es una urgencia").
  explicito: boolean
  direccion: string | null
  // What happened, in the person's words: the sentences that are neither the request nor where.
  problema: string | null
}

// `suelta`: the conversation is waiting for the address, so a bare "Junín 1234" is one.
export function leerUrgente(mensaje: string, opciones: { zona?: string | null; suelta?: boolean } = {}): UrgenteLeido {
  const texto = plano(mensaje)
  const direccion = direccionEn(mensaje, { suelta: opciones.suelta === true })
  const zona = opciones.zona ? plano(opciones.zona) : null
  // The sentence that asks ("necesito un electricista urgente…") and the one that says where are
  // not the problem; what is left is.
  const PIDE = /\b(?:necesito|nesecito|busco|quiero|preciso|me hace falta|mandame|manden|necesitaria)\b/u
  // The address leaves first: "Av. 3 de Abril" must not be cut at its dot.
  const partes = (direccion ? mensaje.replace(direccion, ' ') : mensaje)
    .split(/[.!?\n;]+/u)
    .map(limpiar)
    .filter((parte) => {
      if (parte.length < 5) return false
      const p = plano(parte)
      if (PIDE.test(p) && (PALABRA_URGENTE.test(p) || /\b(?:un|una|al|el|la)\s+\p{L}+/u.test(p))) return false
      // "Urgente: gasista en": the request itself, said short.
      if (/^(?:es )?(?:urgente|urgencia)\b/u.test(p) && p.length < 40) return false
      if (zona && p.replace(/^(?:estoy |vivo |es )?(?:en )?(?:el |la )?(?:barrio )?/u, '').replace(/^barrio /u, '') === zona.replace(/^barrio /u, '')) return false
      return true
    })
  const problema = limpiar(partes.join('. ')).slice(0, 300)
  return { urgente: PALABRA_URGENTE.test(texto), explicito: SERVICIO_URGENTE.test(texto), direccion, problema: problema.length >= 5 ? problema : null }
}

// The assigned provider says it cannot go after all, in its own words.
// "no puedo" counts when it is about going ("no puedo ir") or stands alone; "no puedo creer…" does not.
const RENUNCIA = /\b(?:no (?:puedo|podre|podria|voy a poder|llego|alcanzo|voy a llegar)(?: a)? (?:asistir|ir|llegar|concurrir|hacerlo|tomarlo|tomarla)\b|no (?:puedo|podre|voy a poder|llego|alcanzo|voy a llegar)(?=\s*(?:$|[.,;!]))|al final no (?:puedo|voy|llego|podre)\b|finalmente no (?:puedo|voy|llego)\b|me equivoque\b|me confundi\b|toque sin querer\b|no voy a ir\b|tengo que cancelar\b)/u
const CANCELAR = /^\s*(?:cancelar|cancelo|cancela|cancelalo|cancelala)\s*[.!]*\s*$/u

export function esRenuncia(mensaje: string): { renuncia: boolean; motivo: string | null } {
  const texto = plano(mensaje)
  const encontrada = RENUNCIA.exec(texto)
  if (!encontrada && !CANCELAR.test(texto)) return { renuncia: false, motivo: null }
  // Its words are the reason only when they say more than the phrase itself.
  const resto = limpiar(mensaje)
  return { renuncia: true, motivo: encontrada && resto.length - encontrada[0].length >= 8 ? resto.slice(0, 300) : null }
}
