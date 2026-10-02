import { normalizarDocumento } from '@factory/contracts'
import { sinAcentos } from '../texto.ts'

// TURNOS-SENA-01. Who is asking for a turno on a channel without a TUS session (WhatsApp): the
// person says its full name and its document and the BACKEND looks the account up. The model
// never sees those values (they are redacted before any prompt) and never decides who somebody
// is. The account id found here stays in the backend: it is never written in a reply.
//
// The document is the identifier ("User"."documentNumber", normalized and unique in the database:
// uq_user_documento); the name is checked against the same person. A document that exists with
// another name answers exactly like a document that does not exist, so nothing can be probed.

export interface CuentaPorDocumento {
  accountId: string
  tenantId: string
  firstName: string | null
  lastName: string | null
  displayName: string
}

export interface PuertoCuentasPorDocumento {
  // The ACTIVE account of the person with that document, or null.
  buscarPorDocumento(tipo: string, numero: string): Promise<CuentaPorDocumento | null>
}

// "12.345.678", "12 345 678", "12345678", "1.234.567": seven or eight digits, with or without
// separators, that are not part of a longer number (a phone, an amount).
const DOCUMENTO = /(?<!\d)(\d{1,2})[.\s]?(\d{3})[.\s]?(\d{3})(?!\d)/u

// Words around a name that are not part of it.
const NO_ES_NOMBRE = new Set(['dni', 'documento', 'doc', 'numero', 'nro', 'num', 'mi', 'nombre', 'completo', 'apellido', 'es', 'me', 'llamo', 'soy', 'hola', 'si', 'ok', 'dale', 'con', 'el', 'tengo', 'cuenta', 'tus', 'nombres', 'y'])
// Particles of a surname: "María de la Fuente" and "María Fuente" are the same person here.
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'do', 'dos', 'van', 'von', 'y'])

const palabras = (texto: string): string[] =>
  sinAcentos(texto.toLowerCase())
    .replace(/[^a-zñ'\s-]/gu, ' ')
    .split(/[\s-]+/u)
    .map((palabra) => palabra.replace(/^'+|'+$/gu, ''))
    .filter((palabra) => palabra.length >= 2 || PARTICULAS.has(palabra))

const significativas = (texto: string): string[] => palabras(texto).filter((palabra) => !PARTICULAS.has(palabra))

// What a message says about who the person is. Nothing here is trusted: it is only what will be
// looked up. `documento` is already normalized (digits only), exactly as it is stored.
export function extraerIdentidad(mensaje: string): { nombre: string | null; documento: string | null } {
  const texto = mensaje.slice(0, 300)
  const hallado = DOCUMENTO.exec(texto)
  const normalizado = hallado ? normalizarDocumento('DNI', `${hallado[1]}${hallado[2]}${hallado[3]}`) : null
  const resto = hallado ? `${texto.slice(0, hallado.index)} ${texto.slice(hallado.index + hallado[0].length)}` : texto
  const nombre = palabras(resto.replace(/\bd\.?\s?n\.?\s?i\.?(?=\s|$|:)/giu, ' ')).filter((palabra) => !NO_ES_NOMBRE.has(palabra))
  // A full name: at least a first name and a surname, and not a whole sentence.
  const completo = nombre.filter((palabra) => !PARTICULAS.has(palabra)).length >= 2 && nombre.length <= 7
  return { nombre: completo ? nombre.join(' ') : null, documento: normalizado?.ok ? normalizado.numero : null }
}

// The name given is the name of that person: every surname, the first given name, and nothing
// that is not part of the person's name. Case, accents, order and surname particles do not
// matter; a second given name may be left out ("Juan Mumbach" for "Juan Ignacio Mumbach").
export function mismoNombre(dado: string, persona: { firstName: string | null; lastName: string | null; displayName: string }): boolean {
  const dadas = new Set(significativas(dado))
  if (dadas.size < 2) return false
  const nombres = significativas(persona.firstName ?? '')
  const apellidos = significativas(persona.lastName ?? '')
  if (nombres.length === 0 || apellidos.length === 0) {
    const visibles = new Set(significativas(persona.displayName))
    return visibles.size >= 2 && visibles.size === dadas.size && [...visibles].every((palabra) => dadas.has(palabra))
  }
  const propias = new Set([...nombres, ...apellidos])
  return apellidos.every((palabra) => dadas.has(palabra)) && dadas.has(nombres[0]!) && [...dadas].every((palabra) => propias.has(palabra))
}

export type ResultadoIdentificacion =
  | { ok: true; cuenta: { accountId: string; tenantId: string } }
  // datos_incompletos: the message does not carry both a full name and a document.
  // no_encontrada: no account for that document, or the name is not the one of that person (the
  // caller answers both the same way).
  | { ok: false; motivo: 'datos_incompletos' | 'no_encontrada'; detalle: 'sin_nombre' | 'sin_documento' | 'documento_desconocido' | 'nombre_distinto' }

export class ServicioIdentificacionCliente {
  constructor(private readonly cuentas: PuertoCuentasPorDocumento) {}

  async identificar(mensaje: string): Promise<ResultadoIdentificacion> {
    const { nombre, documento } = extraerIdentidad(mensaje)
    if (!documento) return { ok: false, motivo: 'datos_incompletos', detalle: 'sin_documento' }
    if (!nombre) return { ok: false, motivo: 'datos_incompletos', detalle: 'sin_nombre' }
    const cuenta = await this.cuentas.buscarPorDocumento('DNI', documento)
    if (!cuenta) return { ok: false, motivo: 'no_encontrada', detalle: 'documento_desconocido' }
    if (!mismoNombre(nombre, cuenta)) return { ok: false, motivo: 'no_encontrada', detalle: 'nombre_distinto' }
    return { ok: true, cuenta: { accountId: cuenta.accountId, tenantId: cuenta.tenantId } }
  }
}

// Removes the document (and any other identifier) from a message before it is kept as the
// memory of the conversation: the stored text never carries it.
export function sinDocumento(mensaje: string): string {
  return mensaje.replace(new RegExp(DOCUMENTO.source, 'gu'), '[documento]')
}
