import { formatearPesos } from '@factory/contracts'
import { sinAcentos } from '../texto.ts'
import type { ServicioTurnoAsistente } from './dominio.ts'
import type { SolicitudEnCurso } from './modelo.ts'

// TURNOS-SENA-01. Texts and choices of the request of a turno, from the moment the professional
// and the time are known until the confirmation card. Pure functions over what the BACKEND
// returned: every name, price and deposit shown comes from the domain (never from the model), and
// no internal id is ever part of a text.

export type OpcionServicio = ServicioTurnoAsistente['options'][number]

const ZONA_HORARIA = 'America/Argentina/Buenos_Aires'

const normalizar = (texto: string): string =>
  sinAcentos(texto.toLowerCase())
    .replace(/[^a-z0-9ñ\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

const ORDINALES_SERVICIO: [RegExp, number][] = [
  [/\b(?:primer[oa]?|1r[oa]|1er[oa]?)\b/u, 0],
  [/\b(?:segund[oa]|2d[oa])\b/u, 1],
  [/\b(?:tercer[oa]?|3r[oa]|3er[oa]?)\b/u, 2],
  [/\b(?:cuart[oa]|4t[oa])\b/u, 3],
  [/\b(?:quint[oa]|5t[oa])\b/u, 4],
  [/\b(?:sext[oa]|6t[oa])\b/u, 5],
]

// Words that say nothing about which service ("quiero el de espalda, por favor").
const RELLENO = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'un', 'una', 'quiero', 'prefiero', 'elijo', 'dame', 'ese', 'esa', 'servicio', 'por', 'favor', 'porfa', 'mejor', 'si', 'ok', 'dale', 'opcion', 'numero', 'nro', 'con', 'y', 'a', 'para', 'que', 'me', 'gustaria'])

const precioDe = (opcion: OpcionServicio): string => (opcion.price !== null && opcion.price > 0 ? formatearPesos(opcion.price) : 'precio a convenir')

export function lineaOpcion(opcion: OpcionServicio): string {
  return `${opcion.name} — ${precioDe(opcion)}`
}

// "¿Qué servicio querés con Bongio?" with each variant and its real price.
export function preguntaServicio(providerName: string, opciones: OpcionServicio[]): string {
  return [`¿Qué servicio querés con ${providerName}?`, ...opciones.map((opcion, indice) => `${indice + 1}. ${lineaOpcion(opcion)} (${opcion.durationMinutes} min)`), 'Decime el número o el nombre.'].join('\n')
}

// The variant a name in the message refers to: its full name, or words that belong to exactly one
// variant ("espalda" -> "Espalda completa"). Never a number: in a message that also chooses a
// professional ("el segundo a las 18") a number is not a service.
export function elegirServicioPorNombre(mensaje: string, opciones: OpcionServicio[], servicio: string | null = null): OpcionServicio | null {
  const texto = normalizar(mensaje)
  if (!texto) return null
  const nombres = opciones.map((opcion) => normalizar(opcion.name))
  const exactas = opciones.filter((_, indice) => nombres[indice] && ` ${texto} `.includes(` ${nombres[indice]} `))
  // "pintura" and "pintura de interiores" both named: the longest name is the one meant.
  if (exactas.length > 0) return exactas.sort((a, b) => normalizar(b.name).length - normalizar(a.name).length)[0]!
  const dichas = texto.split(' ').filter((palabra) => palabra.length >= 3 && !RELLENO.has(palabra) && !/^\d+$/u.test(palabra))
  const unica = (palabras: string[]): OpcionServicio | null => {
    if (palabras.length === 0) return null
    const candidatas = opciones.filter((_, indice) => {
      const propias = nombres[indice]!.split(' ')
      return palabras.every((palabra) => propias.some((propia) => propia === palabra || (palabra.length >= 4 && propia.startsWith(palabra))))
    })
    return candidatas.length === 1 ? candidatas[0]! : null
  }
  // "la pintura de interiores": the name of the trade itself says nothing about which variant.
  const delOficio = new Set(servicio ? normalizar(servicio).split(' ') : [])
  const especificas = dichas.filter((palabra) => !delOficio.has(palabra) && !delOficio.has(palabra.replace(/s$/u, '')))
  const exacta = unica(especificas)
  if (exacta) return exacta
  // A person can say the variant inside a longer request (provider, hour or price included).
  // Only a word that belongs to exactly one real variant may resolve it; generic trade words
  // and invented variants never authorize a tariff id from the model.
  const indicadas = new Set(especificas.flatMap((palabra) => {
    const coinciden = opciones.filter((_, indice) => nombres[indice]!.split(' ').some((propia) => propia === palabra || (palabra.length >= 4 && propia.startsWith(palabra))))
    return coinciden.length === 1 ? coinciden : []
  }))
  return indicadas.size === 1 ? [...indicadas][0]! : null
}

// The answer to "¿Qué servicio querés?": a number, an ordinal or a name.
export function elegirServicio(mensaje: string, opciones: OpcionServicio[], servicio: string | null = null): OpcionServicio | null {
  const texto = normalizar(mensaje)
  const numero = /^(?:(?:el|la|opcion|numero|nro) )*(\d)$/u.exec(texto)
  if (numero) return opciones[Number(numero[1]) - 1] ?? null
  const porNombre = elegirServicioPorNombre(mensaje, opciones, servicio)
  if (porNombre) return porNombre
  for (const [patron, indice] of ORDINALES_SERVICIO) if (patron.test(texto)) return opciones[indice] ?? null
  return null
}

// "El servicio cuesta $25.000 y la seña es de $12.500."
export function textoPrecio(opcion: OpcionServicio | null): string {
  if (!opcion || opcion.price === null || opcion.price <= 0) return ''
  return `El servicio cuesta ${formatearPesos(opcion.price)}${opcion.deposit !== null ? ` y la seña es de ${formatearPesos(opcion.deposit)}` : ''}.`
}

export function fechaLarga(inicio: Date): string {
  return inicio.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONA_HORARIA }).replace(',', '')
}

export function horaCorta(inicio: Date): string {
  return inicio.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_HORARIA })
}

// The card the person confirms: exactly what will be requested, with the price and the deposit
// the backend computed. A turno is requested, never confirmed by its client.
export function resumenSolicitud(input: { providerName: string; startsAt: string; servicio: string | null; opcion: OpcionServicio | null; notes?: string | null }): string {
  const inicio = new Date(input.startsAt)
  const opcion = input.opcion
  const nombreServicio = opcion?.name ?? input.servicio
  return [
    'Vas a solicitar:',
    `Prestador: ${input.providerName}`,
    ...(nombreServicio ? [`Servicio: ${nombreServicio}`] : []),
    `Fecha: ${fechaLarga(inicio)}`,
    `Horario: ${horaCorta(inicio)}`,
    ...(opcion ? [`Precio: ${opcion.price !== null && opcion.price > 0 ? formatearPesos(opcion.price) : 'a convenir con el prestador'}`] : []),
    ...(opcion && opcion.deposit !== null ? [`Seña: ${formatearPesos(opcion.deposit)} (se abona cuando el prestador acepte)`] : []),
    ...(input.notes ? [`Nota: ${input.notes}`] : []),
    // The payment is announced only when there is a deposit to pay.
    opcion && opcion.deposit !== null
      ? 'La solicitud queda pendiente hasta que el prestador la acepte. El turno se confirma después del pago de la seña.'
      : 'La solicitud queda pendiente hasta que el prestador la acepte.',
    '¿Querés solicitar este turno?',
  ].join('\n')
}

export const BOTONES_SOLICITUD = { si: 'Sí, solicitar turno', no: 'No' } as const

// Where a person who has to sign in or register is sent back to: the booking form of that very
// professional with the service, the variant and the time already chosen (a path of the Web the
// profile page already understands). Only public values travel in it.
export function retornoDeSolicitud(booking: Pick<SolicitudEnCurso, 'providerId' | 'profession' | 'startsAt' | 'tariffId'>): string {
  const consulta = new URLSearchParams({ turno: '1', oficio: booking.profession, inicio: new Date(booking.startsAt).toISOString() })
  if (booking.tariffId) consulta.set('tarifa', booking.tariffId)
  return `/trabajadores/${encodeURIComponent(booking.providerId)}?${consulta.toString()}`
}

// The REAL registration route of the Web (/registro), with the way back to the turno.
export function enlaceRegistro(webBaseUrl: string, returnTo: string): string {
  return `${webBaseUrl.replace(/\/+$/u, '')}/registro?returnTo=${encodeURIComponent(returnTo)}`
}

// Internal identifiers never reach a person. The texts built by the backend do not carry any;
// this removes the ones a model could copy from a tool result into its reply.
const IDENTIFICADOR = /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:res|cal|reg|conf|t|user|customer|trabajo|obligacion|pago|presupuesto|perfil|tarifa|contacto|conversacion|mensaje|solicitud|tenant|cuenta)[-_][A-Za-z0-9][A-Za-z0-9_-]{2,})\b/giu

export function sinIdentificadores(texto: string, conocidos: readonly string[] = []): string {
  let limpio = texto
  for (const id of [...conocidos].sort((a, b) => b.length - a.length)) if (id.length >= 6) limpio = limpio.split(id).join('')
  return limpio
    .replace(IDENTIFICADOR, '')
    .replace(/\((?:\s*(?:id|ID|Id)\s*:?\s*)?\)/gu, '')
    .replace(/\b(?:id|ID|providerId|workId|budgetId)\s*:\s*(?=[,.;)\n]|$)/gu, '')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/ +([,.;:])/gu, '$1')
    .trim()
}
