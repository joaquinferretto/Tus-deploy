import { interpretarNecesidad } from '../directorio/modelo.ts'
import { oficiosInterpretables } from '../directorio/oficios.ts'
import { sinAcentos } from '../texto.ts'

// What a person needs, read from ONE free-text message: every fact the message carries is kept
// (trade, day, time, zone or "any zone", who travels, urgency, budget). Pure: the clock is passed
// in, so dates are resolved with the official time of the server in Argentina, never invented.
//
// It is the deterministic floor of the assistant: the model interprets language too, but what
// the person already said is never lost (and never asked again) because of a model's omission,
// and the assistant keeps understanding these messages when the model is unavailable.

export interface VentanaHoraria {
  // exact: a turno that STARTS at `from`. from: from that time on. until: before `to`.
  // between: inside [from, to).
  kind: 'exact' | 'from' | 'until' | 'between'
  from: string | null
  to: string | null
}

export interface NecesidadTurno {
  profession: string | null
  // Trades tied when the text is ambiguous: the person chooses.
  alternatives: string[]
  // Argentina calendar day (YYYY-MM-DD); dayTo closes a range ("este fin de semana").
  day: string | null
  dayTo: string | null
  time: VentanaHoraria | null
  zone: string | null
  // The person said the zone does not matter (or that they travel): it is never asked again.
  anyZone: boolean
  clientTravels: boolean
  urgent: boolean
  budgetMax: number | null
}

export const NECESIDAD_VACIA: NecesidadTurno = { profession: null, alternatives: [], day: null, dayTo: null, time: null, zone: null, anyZone: false, clientTravels: false, urgent: false, budgetMax: null }

// Only the keys the message really mentions.
export type DatosNecesidad = Partial<NecesidadTurno>

const HORA_MS = 3_600_000
const DIA_MS = 24 * HORA_MS
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// Parts of the day as people use them in Argentina.
export const FRANJAS = {
  manana: { from: '06:00', to: '12:00' },
  mediodia: { from: '12:00', to: '14:00' },
  tarde: { from: '13:00', to: '20:00' },
  noche: { from: '20:00', to: '23:59' },
} as const

// Argentina has no daylight saving: UTC-3 all year.
export const hoyArgentina = (ahora: number): string => new Date(ahora - 3 * HORA_MS).toISOString().slice(0, 10)
export const horaArgentina = (ahora: number): string => new Date(ahora - 3 * HORA_MS).toISOString().slice(11, 16)
const sumarDias = (fecha: string, dias: number): string => new Date(Date.parse(`${fecha}T12:00:00.000Z`) + dias * DIA_MS).toISOString().slice(0, 10)
const diaSemana = (fecha: string): number => new Date(`${fecha}T12:00:00.000Z`).getUTCDay()
const hhmm = (hora: number, minuto = 0): string => `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`

// Lowercase, no accents, punctuation as spaces; the colon of a time ("18:30") is kept.
function normalizar(texto: string): string {
  return sinAcentos(texto.toLowerCase().slice(0, 600))
    .replace(/(\d)[.h](\d{2})\b/gu, '$1:$2')
    .replace(/[^a-z0-9ñ:/\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

const NUMEROS: Record<string, number> = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 }
const HORA = String.raw`(\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?::(\d{2}))?(?: y (media|cuarto))?(?: ?(?:hs|horas|hrs|h)\b)?(?: (?:de|por) la (manana|tarde|noche)| ?(am|pm)\b)?`

// One clock time as the person said it. Without "de la mañana/tarde", an hour from 1 to 7 is the
// afternoon (nobody books a massage at 6 in the morning by saying "a las 6").
function leerHora(partes: (string | undefined)[]): string | null {
  const [numero, minutos, fraccion, franja, sufijo] = partes
  if (!numero) return null
  let hora = /^\d/u.test(numero) ? Number(numero) : NUMEROS[numero] ?? NaN
  const minuto = minutos ? Number(minutos) : fraccion === 'media' ? 30 : fraccion === 'cuarto' ? 15 : 0
  if (!Number.isInteger(hora) || hora > 24 || minuto > 59) return null
  if (hora === 24) hora = 0
  const tarde = franja === 'tarde' || franja === 'noche' || sufijo === 'pm'
  const manana = franja === 'manana' || sufijo === 'am'
  if (tarde && hora < 12) hora += 12
  else if (!manana && !tarde && hora >= 1 && hora <= 7) hora += 12
  return hhmm(hora, minuto)
}

function leerVentana(texto: string): { ventana: VentanaHoraria | null; resto: string } {
  const patrones: { regex: RegExp; armar: (m: RegExpExecArray) => VentanaHoraria | null }[] = [
    {
      regex: new RegExp(String.raw`\b(?:entre|de|desde) (?:las? )?${HORA} (?:y|a|hasta) (?:las? )?${HORA}`, 'u'),
      armar: (m) => {
        const from = leerHora(m.slice(1, 6))
        const to = leerHora(m.slice(6, 11))
        return from && to && from < to ? { kind: 'between', from, to } : null
      },
    },
    {
      regex: new RegExp(String.raw`\b(?:despues|luego|a partir|desde|pasadas?|mas tarde) (?:de )?(?:las? )?${HORA}`, 'u'),
      armar: (m) => {
        const from = leerHora(m.slice(1, 6))
        return from ? { kind: 'from', from, to: null } : null
      },
    },
    {
      regex: new RegExp(String.raw`\b(?:antes|hasta) (?:de )?(?:las? )?${HORA}`, 'u'),
      armar: (m) => {
        const to = leerHora(m.slice(1, 6))
        return to ? { kind: 'until', from: null, to } : null
      },
    },
    {
      regex: new RegExp(String.raw`\b(?:(?:a|para|pa|sobre|como a) las?|tipo(?: las?)?) ${HORA}`, 'u'),
      armar: (m) => {
        const from = leerHora(m.slice(1, 6))
        return from ? { kind: 'exact', from, to: null } : null
      },
    },
    {
      // "18hs", "18:30", "18 horas": a time with its unit or its minutes.
      regex: /\b(\d{1,2})(?::(\d{2}))? ?(?:hs|horas|hrs)\b|\b(\d{1,2}):(\d{2})\b/u,
      armar: (m) => {
        const from = leerHora(m[1] ? [m[1], m[2]] : [m[3], m[4]])
        return from ? { kind: 'exact', from, to: null } : null
      },
    },
  ]
  for (const { regex, armar } of patrones) {
    const m = regex.exec(texto)
    const ventana = m ? armar(m) : null
    if (m && ventana) return { ventana, resto: `${texto.slice(0, m.index)} ${texto.slice(m.index + m[0].length)}` }
  }
  return { ventana: null, resto: texto }
}

function leerDia(texto: string, hoy: string): { day: string; dayTo: string | null; resto: string } | null {
  const quitar = (m: RegExpExecArray) => `${texto.slice(0, m.index)} ${texto.slice(m.index + m[0].length)}`
  let m: RegExpExecArray | null
  if ((m = /\bpasado manana\b/u.exec(texto))) return { day: sumarDias(hoy, 2), dayTo: null, resto: quitar(m) }
  // "por la mañana" is a part of the day; a "mañana" left after that is tomorrow.
  const sinFranja = texto.replace(/\b(?:a|por|de|en|durante) la manana\b/gu, (encontrado) => ' '.repeat(encontrado.length))
  if ((m = /\bmanana\b/u.exec(sinFranja))) return { day: sumarDias(hoy, 1), dayTo: null, resto: `${texto.slice(0, m.index)} ${texto.slice(m.index + m[0].length)}` }
  if ((m = /\b(?:hoy|esta (?:tarde|noche|manana))\b/u.exec(texto))) return { day: hoy, dayTo: null, resto: m[0] === 'hoy' ? quitar(m) : texto }
  if ((m = /\b(?:este |el |proximo )?(?:fin de semana|finde)\b/u.exec(texto))) {
    const dia = diaSemana(hoy)
    const sabado = dia === 0 ? hoy : sumarDias(hoy, (6 - dia + 7) % 7)
    return { day: sabado, dayTo: dia === 0 ? null : sumarDias(sabado, 1), resto: quitar(m) }
  }
  // An explicit date wins over the name of its day ("el viernes 16 de octubre").
  if ((m = new RegExp(String.raw`\b(?:el |dia )?(\d{1,2}) de (${MESES.join('|')})\b`, 'u').exec(texto)) || (m = /\b(?:el |dia )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/u.exec(texto))) {
    const dia = Number(m[1])
    const mes = /^\d/u.test(m[2]!) ? Number(m[2]) : MESES.indexOf(m[2]!) + 1
    let anio = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(hoy.slice(0, 4))
    const armar = () => `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    const valida = () => !Number.isNaN(Date.parse(`${armar()}T12:00:00.000Z`)) && new Date(`${armar()}T12:00:00.000Z`).getUTCDate() === dia
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || !valida()) return null
    // A date without year that already passed is next year's.
    if (!m[3] && armar() < hoy) anio += 1
    return valida() ? { day: armar(), dayTo: null, resto: quitar(m) } : null
  }
  if ((m = new RegExp(String.raw`\b(?:(este|el|proximo|para el|del) )?(${DIAS.join('|')})( que viene| proximo)?\b`, 'u').exec(texto))) {
    const objetivo = DIAS.indexOf(m[2]!)
    let saltos = (objetivo - diaSemana(hoy) + 7) % 7
    // "el lunes que viene" said on a Monday is the next one, not today.
    if (saltos === 0 && (m[1] === 'proximo' || m[3])) saltos = 7
    return { day: sumarDias(hoy, saltos), dayTo: null, resto: quitar(m) }
  }
  return null
}

function leerFranja(texto: string): VentanaHoraria | null {
  if (/\b(?:a|por|de|en|durante) la manana\b|\bmanana temprano\b|\btemprano\b|\besta manana\b/u.test(texto)) return { kind: 'between', ...FRANJAS.manana }
  if (/\b(?:al |a |del )?mediodia\b/u.test(texto)) return { kind: 'between', ...FRANJAS.mediodia }
  if (/\b(?:a|por|de|en|durante) la tarde\b|\besta tarde\b|\btardecita\b/u.test(texto)) return { kind: 'between', ...FRANJAS.tarde }
  if (/\b(?:a|por|de|en|durante) la noche\b|\besta noche\b|\bnochecita\b/u.test(texto)) return { kind: 'between', ...FRANJAS.noche }
  return null
}

const CUALQUIER_ZONA = /\bno (?:me )?(?:importa|interesa|preocupa)(?: mucho)? (?:la zona|el barrio|el lugar|donde|la ubicacion|la distancia)\b|\bme da (?:igual|lo mismo) (?:donde|la zona|el barrio|el lugar|en que|que barrio|que zona)\b|\b(?:en |de )?cual(?:qu|k)ier (?:barrio|zona|lugar|lado|parte)\b|\bsin importar (?:el barrio|la zona|el lugar|donde)\b|\b(?:donde|a donde|adonde) sea\b|\bes indistinto\b|\bindistint[oa] (?:la zona|el barrio)\b|\bla zona (?:es lo de menos|no importa|me da igual)\b|\bel barrio (?:no importa|me da igual)\b/u
const SE_DESPLAZA = /\bvoy yo\b|\byo voy\b|\bme (?:traslado|muevo|acerco|desplazo)\b|\bpuedo (?:ir|trasladarme|moverme|acercarme)\b|\bvoy (?:hasta|a) donde\b|\bme puedo (?:trasladar|mover|acercar)\b|\bvoy hasta (?:donde|su|el|la)\b/u
const URGENTE = /\b(?:urgente|urgencia|emergencia|ya mismo|ahora mismo|ahora|cuanto antes|lo antes posible|ya)\b/u

// Words that never name a trade, so a typo check must not turn them into one.
const NO_SON_OFICIO = new Set(['manana', 'tarde', 'noche', 'quiero', 'necesito', 'busco', 'buscando', 'alguien', 'importa', 'barrio', 'cualquier', 'despues', 'antes', 'entre', 'sabado', 'domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'semana', 'urgente', 'ahora', 'centro', 'donde', 'pasado', 'proximo', 'horas', 'turno', 'turnos', 'servicio', 'persona', 'favor', 'gracias', 'puedo', 'quisiera', 'traslado', 'mediodia', 'temprano', 'arregle', 'arreglar', 'arreglo', 'reservar', 'reserva', 'reservo', 'primero', 'primera', 'segundo', 'segunda', 'tercero', 'tercera', 'cuarto', 'quinto', 'confirmar', 'cancelar', 'trabajo', 'trabajos', 'solicitud', 'presupuesto'])

function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1
  let fila = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const nueva = [i]
    for (let j = 1; j <= b.length; j += 1) nueva[j] = Math.min(fila[j]! + 1, nueva[j - 1]! + 1, fila[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    fila = nueva
  }
  return fila[b.length]!
}

// A trade written with a typo ("masagista", "plomro", "eletricista"): one edit (two only for
// words of ten letters or more) against the ONE-WORD names and synonyms of the administered
// catalog, six letters or more, with the same first letter. Pieces of a phrase ("me quede
// afuera") are never compared: "puede" is not a locksmith. Only when exactly one trade matches.
function oficioConErrata(texto: string): string | null {
  const palabras = texto.split(' ').filter((palabra) => palabra.length >= 6 && !NO_SON_OFICIO.has(palabra) && !/\d/u.test(palabra))
  const encontrados = new Set<string>()
  for (const item of oficiosInterpretables()) {
    const claves = [...item.sinonimos, item.nombre, item.profesion.split('/')[0] ?? ''].map((termino) => normalizar(termino)).filter((clave) => !clave.includes(' ') && clave.length >= 6 && !NO_SON_OFICIO.has(clave))
    if (palabras.some((palabra) => claves.some((clave) => clave[0] === palabra[0] && distancia(palabra, clave, palabra.length >= 10 ? 2 : 1) <= (palabra.length >= 10 ? 2 : 1)))) encontrados.add(item.id)
  }
  return encontrados.size === 1 ? [...encontrados][0]! : null
}

export function extraerNecesidad(mensaje: string, ahora: number): DatosNecesidad {
  const texto = normalizar(mensaje)
  if (!texto) return {}
  const datos: DatosNecesidad = {}
  const hoy = hoyArgentina(ahora)

  const interpretado = interpretarNecesidad(mensaje)
  if (interpretado.category) datos.profession = interpretado.category
  else if (interpretado.alternatives.length > 0) datos.alternatives = interpretado.alternatives
  else {
    const errata = oficioConErrata(texto)
    if (errata) datos.profession = errata
  }
  if (interpretado.budgetMax) datos.budgetMax = interpretado.budgetMax

  if (CUALQUIER_ZONA.test(texto)) datos.anyZone = true
  if (SE_DESPLAZA.test(texto)) {
    datos.clientTravels = true
    datos.anyZone = true
  }
  // A named zone wins over "voy yo" ("voy yo hasta el Centro"), never over "no me importa la zona".
  if (interpretado.zone && !CUALQUIER_ZONA.test(texto)) {
    datos.zone = interpretado.zone
    datos.anyZone = false
  }

  const { ventana, resto } = leerVentana(texto)
  const dia = leerDia(resto, hoy)
  if (dia) {
    datos.day = dia.day
    datos.dayTo = dia.dayTo
  }
  const franja = ventana ? null : leerFranja(texto)
  if (ventana) datos.time = ventana
  else if (franja) datos.time = franja

  if (URGENTE.test(texto)) {
    datos.urgent = true
    // "ahora" / "urgente" without a day is today, from this moment on.
    if (!datos.day) datos.day = hoy
    if (!datos.time && datos.day === hoy) datos.time = { kind: 'from', from: horaArgentina(ahora), to: null }
  }
  // A time or a part of the day without a day ("a las 18", "esta tarde") keeps the day known so
  // far; the caller decides (combinarNecesidad).
  return datos
}

// The state of the conversation after a message: what was known plus what the message adds.
// A new trade is a new need (its day and time are kept only if the same message repeats them).
export function combinarNecesidad(previa: NecesidadTurno | null, datos: DatosNecesidad): NecesidadTurno {
  const base = previa ?? NECESIDAD_VACIA
  const cambiaOficio = datos.profession !== undefined && datos.profession !== null && base.profession !== null && datos.profession !== base.profession
  const origen = cambiaOficio ? { ...NECESIDAD_VACIA, zone: base.zone, anyZone: base.anyZone, clientTravels: base.clientTravels } : base
  const siguiente: NecesidadTurno = { ...origen }
  if (datos.profession) {
    siguiente.profession = datos.profession
    siguiente.alternatives = []
  } else if (datos.alternatives?.length && !siguiente.profession) siguiente.alternatives = datos.alternatives
  if (datos.day) {
    siguiente.day = datos.day
    siguiente.dayTo = datos.dayTo ?? null
  }
  if (datos.time) siguiente.time = datos.time
  if (datos.zone) {
    siguiente.zone = datos.zone
    siguiente.anyZone = false
  } else if (datos.anyZone) {
    siguiente.zone = null
    siguiente.anyZone = true
  }
  if (datos.clientTravels) siguiente.clientTravels = true
  if (datos.urgent !== undefined) siguiente.urgent = datos.urgent
  if (datos.budgetMax) siguiente.budgetMax = datos.budgetMax
  return siguiente
}

// What is still needed to look for real availability. The zone is never required: without one
// the search covers every provider of the trade.
export function faltantes(necesidad: NecesidadTurno): ('profession' | 'day')[] {
  return [...(necesidad.profession ? [] : (['profession'] as const)), ...(necesidad.day ? [] : (['day'] as const))]
}

export const mencionaAlgo = (datos: DatosNecesidad): boolean => Object.keys(datos).length > 0

// ---- how a window is told back to the person -----------------------------------------------

export function describirDia(day: string, dayTo: string | null, ahora: number): string {
  const hoy = hoyArgentina(ahora)
  const uno = (fecha: string) => {
    if (fecha === hoy) return 'hoy'
    if (fecha === sumarDias(hoy, 1)) return 'mañana'
    const nombre = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][diaSemana(fecha)]!
    return `el ${nombre} ${Number(fecha.slice(8, 10))}/${Number(fecha.slice(5, 7))}`
  }
  return dayTo ? `${uno(day)} y ${uno(dayTo)}` : uno(day)
}

export function describirVentana(time: VentanaHoraria | null): string {
  if (!time) return ''
  if (time.kind === 'exact') return `a las ${time.from}`
  if (time.kind === 'from') return `desde las ${time.from}`
  if (time.kind === 'until') return `antes de las ${time.to}`
  const franja = Object.entries(FRANJAS).find(([, valor]) => valor.from === time.from && valor.to === time.to)?.[0]
  if (franja) return franja === 'manana' ? 'a la mañana' : franja === 'mediodia' ? 'al mediodía' : `a la ${franja}`
  return `entre las ${time.from} y las ${time.to}`
}

// Does a start (HH:mm, Argentina) fall in the window the person asked for?
export function enVentana(hora: string, time: VentanaHoraria | null): boolean {
  if (!time) return true
  if (time.kind === 'exact') return hora === time.from
  if (time.kind === 'from') return hora >= time.from!
  if (time.kind === 'until') return hora < time.to!
  return hora >= time.from! && hora < time.to!
}
