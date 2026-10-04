import { interpretarNecesidad } from '../directorio/modelo.ts'
import { oficiosInterpretables } from '../directorio/oficios.ts'
import { DIA_MS, MESES, NOMBRES_DIA, diaSemana, horaArgentina, hoyArgentina, leerFecha, lunesDe, normalizarTexto as normalizar, sumarDias } from './fechas.ts'

// The clock and the calendar live in fechas.ts; these are re-exported for the callers of this module.
export { horaArgentina, hoyArgentina, lunesDe }

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
  // A part of the day said as such ("a la tarde"): the same bounds as a range, but the state says
  // what the person said. Never sent to the backend (it searches the bounds).
  part?: 'manana' | 'mediodia' | 'siesta' | 'tarde' | 'noche'
}

export interface NecesidadTurno {
  profession: string | null
  // Trades tied when the text is ambiguous: the person chooses.
  alternatives: string[]
  // Argentina calendar day (YYYY-MM-DD); dayTo closes a range ("este fin de semana").
  day: string | null
  dayTo: string | null
  // "la semana que viene": no single day, the calendar is walked from this day on.
  since?: string | null
  // "el viernes que viene" said when it may be this week's or the next: the two days the person
  // is asked to choose between. Never a day chosen for the person.
  dayOptions?: string[] | null
  time: VentanaHoraria | null
  zone: string | null
  // The person said the zone does not matter (or that they travel): it is never asked again.
  anyZone: boolean
  clientTravels: boolean
  urgent: boolean
  budgetMax: number | null
  // "lo antes posible", "el día más próximo", "ya": the FIRST real free turno. The search starts
  // at `day` (today, from the current time, when there is none) and walks forward day by day.
  asap: boolean
  // "cualquiera", "me da igual quién", "la que esté disponible": no professional is preferred and
  // the backend may propose the first one with a real free turno.
  anyProvider: boolean
  // The professional the person chose by name or by position ("Melina", "la segunda"), resolved
  // by the backend against the professionals it really listed. Never a value the person typed.
  providerId: string | null
  providerName: string | null
  // Professionals the person does NOT want for THIS request ("otra persona", "que no sea
  // Melina", "cualquiera menos la segunda"), resolved by the backend against the professionals
  // it really listed. It lives and dies with the need: another service, or a need that expired,
  // starts without exclusions. Never a preference of the account.
  excludedProviderIds?: string[]
}

export const NECESIDAD_VACIA: NecesidadTurno = { profession: null, alternatives: [], day: null, dayTo: null, time: null, zone: null, anyZone: false, clientTravels: false, urgent: false, budgetMax: null, asap: false, anyProvider: false, providerId: null, providerName: null }

// Only the keys the message really mentions.
export type DatosNecesidad = Partial<NecesidadTurno>

// Parts of the day as people use them in Argentina. The bounds are fixed HERE, in the backend:
// a model never decides what "a la tarde" means, and it means the same in every message.
export const FRANJAS = {
  manana: { from: '06:00', to: '12:00' },
  mediodia: { from: '12:00', to: '14:00' },
  siesta: { from: '13:00', to: '17:00' },
  tarde: { from: '13:00', to: '20:00' },
  noche: { from: '20:00', to: '23:59' },
} as const

const hhmm = (hora: number, minuto = 0): string => `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`

const NUMEROS: Record<string, number> = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 }
// The hour, then its minutes in any of the ways people say them: "9:30", "9 y 30", "9 y media",
// "9 y cuarto". The minutes are part of the time: "a las 9 y 30" is never read as 09:00.
const NUMERO_HORA = String.raw`\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce`
const HORA = String.raw`(${NUMERO_HORA})(?::(\d{2}))?(?: y (media|cuarto|\d{2})\b)?(?: ?(?:hs|horas|hrs|h)\b)?(?: (?:de|por) la (manana|tarde|noche)| ?(am|pm)\b)?`

// One clock time as the person said it. Without "de la mañana/tarde", an hour from 1 to 7 is the
// afternoon (nobody books a turno at 6 in the morning by saying "a las 6").
function leerHora(partes: (string | undefined)[]): string | null {
  const [numero, minutos, fraccion, franja, sufijo] = partes
  if (!numero) return null
  let hora = /^\d/u.test(numero) ? Number(numero) : NUMEROS[numero] ?? NaN
  const minuto = minutos ? Number(minutos) : fraccion === 'media' ? 30 : fraccion === 'cuarto' ? 15 : fraccion ? Number(fraccion) : 0
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
        // "cuanto antes un profesional": a word for a number is a time only with its article
        // ("antes de la una"); digits always are.
        if (!/\d|\blas? /u.test(m[0])) return null
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
    {
      // "9 y 30", "9 y media", "nueve y cuarto": an hour with its minutes, with no "a las".
      // Not two days of a month ("el 5 y 10 de octubre").
      regex: new RegExp(String.raw`\b(${NUMERO_HORA}) y (media|cuarto|\d{2})\b(?! de (?!la ))(?: (?:de|por) la (manana|tarde|noche)| ?(am|pm)\b)?`, 'u'),
      armar: (m) => {
        const from = leerHora([m[1], undefined, m[2], m[3], m[4]])
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

function leerFranja(texto: string): VentanaHoraria | null {
  if (/\b(?:a|por|de|en|durante) la manana\b|\bmanana temprano\b|\btemprano\b|\besta manana\b/u.test(texto)) return { kind: 'between', ...FRANJAS.manana, part: 'manana' }
  if (/\b(?:al |a |del )?mediodia\b/u.test(texto)) return { kind: 'between', ...FRANJAS.mediodia, part: 'mediodia' }
  if (/\b(?:a|por|de|en|durante) la siesta\b|\besta siesta\b/u.test(texto)) return { kind: 'between', ...FRANJAS.siesta, part: 'siesta' }
  if (/\b(?:a|por|de|en|durante) la tarde\b|\besta tarde\b|\btardecita\b/u.test(texto)) return { kind: 'between', ...FRANJAS.tarde, part: 'tarde' }
  if (/\b(?:a|por|de|en|durante) la noche\b|\besta noche\b|\bnochecita\b/u.test(texto)) return { kind: 'between', ...FRANJAS.noche, part: 'noche' }
  return null
}

// The window as the backend searches it: the bounds only.
export function limitesVentana(time: VentanaHoraria | null): VentanaHoraria | null {
  return time ? { kind: time.kind, from: time.from, to: time.to } : null
}

const CUALQUIER_ZONA = /\bno (?:me )?(?:importa|interesa|preocupa)(?: mucho)? (?:la zona|el barrio|el lugar|donde|la ubicacion|la distancia)\b|\bme da (?:igual|lo mismo) (?:donde|la zona|el barrio|el lugar|en que|que barrio|que zona)\b|\b(?:en |de )?cual(?:qu|k)ier (?:barrio|zona|lugar|lado|parte)\b|\bsin importar (?:el barrio|la zona|el lugar|donde)\b|\b(?:donde|a donde|adonde) sea\b|\bes indistinto\b|\bindistint[oa] (?:la zona|el barrio)\b|\bla zona (?:es lo de menos|no importa|me da igual)\b|\bel barrio (?:no importa|me da igual)\b/u
const SE_DESPLAZA = /\bvoy yo\b|\byo voy\b|\bme (?:traslado|muevo|acerco|desplazo)\b|\bpuedo (?:ir|trasladarme|moverme|acercarme)\b|\bvoy (?:hasta|a) donde\b|\bme puedo (?:trasladar|mover|acercar)\b|\bvoy hasta (?:donde|su|el|la)\b/u
// "ya" is urgency only when it stands for "now" ("lo necesito ya", "ya mismo"). Followed by a verb
// or a pronoun it is "already" ("ya estoy registrado", "ya pagué", "ya te dije") and says nothing
// about when.
const YA = String.raw`ya(?! (?:estoy|estas?|estaba|estan|estamos|esta|tengo|tenia|tenes|soy|fui|hice|hizo|pague|abone|transferi|me|lo|la|las|los|te|le|se|no|verifique|vincule|registre|inicie|entre|habia|he|ha|elegi|dije|dijiste|sabes|paso|pasaron|mande|envie|vi|vimos|quedo|quede|que)\b)`
const URGENTE = new RegExp(String.raw`\b(?:urgente|urgencia|emergencia|ya mismo|ahora mismo|ahora|${YA})\b`, 'u')
// The first real free turno, whenever it is: no day of its own (the search walks forward).
const LO_ANTES_POSIBLE = new RegExp(
  [
    String.raw`\b(?:urgente|urgencia|emergencia|ya mismo|ahora mismo|ahora|${YA}|hoy mismo)\b`,
    String.raw`\b(?:lo antes posible|cuanto antes|lo (?:mas|antes) (?:pronto|rapido) (?:posible|que (?:se )?pueda)|lo mas pronto|lo mas proximo|apenas (?:haya|pueda|puedas|se pueda|tengan?)|cuando (?:haya|se pueda)|en cuanto (?:haya|se pueda|pueda))\b`,
    String.raw`\b(?:el|la) (?:dia|fecha|turno|horario|hora) mas (?:proxim[oa]|cercan[oa]|pronto|temprano)\b`,
    String.raw`\b(?:el )?primer (?:dia|turno|horario|hueco|lugar)(?: (?:que|libre|disponible|posible))?\b`,
    String.raw`\bla primera (?:fecha|hora|que (?:haya|tenga|pueda|este)|disponible|libre)\b`,
    String.raw`\b(?:el|la) que (?:este|tenga|pueda|haya) (?:disponible|libre|lugar)? ?primer[oa]\b`,
    String.raw`\bqui[e]n (?:puede|tiene|atiende) (?:antes|primero)\b`,
    String.raw`\b(?:que venga|que pueda venir|que me atienda|que me vea) (?:ya|hoy|ahora)\b`,
  ].join('|'),
  'u'
)
// No professional is preferred: whoever has a real free turno. The zone is not a professional
// ("me da igual donde" is CUALQUIER_ZONA).
const CUALQUIER_PROFESIONAL = new RegExp(
  [
    String.raw`\bcualquiera\b`,
    // "alguien lo antes posible": no professional was chosen. A generic "alguien que me
    // arregle..." only describes the need and keeps the historical extractor shape.
    String.raw`\balguien (?:lo antes posible|cuanto antes|lo mas pronto|urgente|ya|ahora)\b`,
    // "cualquier profesional", "cualquier plomero": whatever the trade is called. A zone, a day or
    // a time said that way is not a professional.
    String.raw`\bcualquier (?!barrio\b|zona\b|lugar\b|lado\b|parte\b|dia\b|hora\b|horario\b|momento\b|fecha\b|cosa\b|servicio\b|precio\b)[a-zñ]+\b`,
    String.raw`\b(?:la|el|lo) que sea\b|\bquien sea\b`,
    String.raw`\bme da (?:igual|lo mismo)(?! (?:donde|la zona|el barrio|el lugar|en que|que barrio|que zona|la hora|el horario|el dia))(?: (?:quien|cual|con quien|la [a-z]+|el [a-z]+))?\b`,
    String.raw`\bno (?:me )?importa (?:quien|cual|con quien|(?:la|el) (?!zona\b|barrio\b|lugar\b|ubicacion\b|distancia\b|hora\b|horario\b|dia\b|precio\b)[a-z]+)\b`,
    String.raw`\b(?:la|el) que (?:este|tenga|pueda|haya)(?: (?:disponible|libre|lugar|turno))?\b`,
    String.raw`\b(?:una|uno) que (?:pueda|este|tenga|venga|me atienda)\b`,
    String.raw`\b(?:la|el) primer[oa]? que (?:haya|tenga|pueda|este)\b`,
    String.raw`\b(?:mandame|asignam[ea]|buscame|conseguime|dame|pasame) (?:una|uno|cualquiera|a cualquiera|alguien)\b`,
  ].join('|'),
  'u'
)

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

// ---- a time on its own, when the conversation is waiting for one ------------------------------
// "¿A qué hora con Ana?" was asked: the answer is a time even when it is said bare ("10", "930",
// "nueve y media"). Returned as the clock times it may mean, the most likely first: without "de
// la mañana / de la tarde", an hour written from 1 to 12 may be either half of the day ("3" is
// 15:00 or 03:00) and the caller keeps the one the professional really offers. Empty: the message
// is not one time. Only for that step: anywhere else a bare number is not a time.
export function horasPosibles(mensaje: string): string[] {
  const texto = normalizar(mensaje).replace(/ (?:por favor|porfa|gracias)$/u, '')
  if (!texto) return []
  const prefijo = String.raw`^(?:(?:a|para|pa|sobre|como a|tipo|mejor|dale|si|ok) )*(?:las? )?`
  let partes: (string | undefined)[] | null = null
  // "930", "0930", "1030": the hour and its minutes written together.
  const junta = new RegExp(String.raw`${prefijo}(\d{1,2})(\d{2})(?: ?(?:hs|horas|hrs|h))?$`, 'u').exec(texto)
  if (junta) partes = [junta[1], junta[2]]
  else {
    const entera = new RegExp(String.raw`${prefijo}${HORA}$`, 'u').exec(texto)
    if (entera) partes = entera.slice(1, 6)
  }
  if (!partes) {
    // A time inside a longer sentence ("dale, a las 9 y media entonces"): as the extractor reads it.
    const { ventana } = leerVentana(texto)
    return ventana?.kind === 'exact' && ventana.from ? [ventana.from] : []
  }
  const principal = leerHora(partes)
  if (!principal) return []
  const escrita = /^\d/u.test(partes[0]!) ? Number(partes[0]) : NUMEROS[partes[0]!] ?? NaN
  const explicita = Boolean(partes[3] || partes[4])
  if (explicita || !(escrita >= 1 && escrita <= 12)) return [principal]
  const hora = Number(principal.slice(0, 2))
  return [principal, hhmm(hora >= 12 ? hora - 12 : hora + 12, Number(principal.slice(3)))]
}

// The message looks like an attempt to say a time (a number, "media", "cuarto"), understood or
// not. "una" counts only as "la una": on its own it is an article ("tengo una duda").
export function pareceHora(mensaje: string): boolean {
  return /\d|\b(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|media|cuarto|mediodia|medianoche|la una)\b/u.test(normalizar(mensaje))
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
  // The date is resolved by the calendar of the backend (fechas.ts), with its documented rules.
  const fecha = leerFecha(resto, hoy)
  if (fecha?.tipo === 'exact') {
    datos.day = fecha.day!
    datos.dayTo = fecha.dayTo
  } else if (fecha?.tipo === 'range') datos.since = fecha.day
  else if (fecha?.tipo === 'ambiguous') datos.dayOptions = fecha.options
  const franja = ventana ? null : leerFranja(texto)
  if (ventana) datos.time = ventana
  else if (franja) datos.time = franja

  if (URGENTE.test(texto)) datos.urgent = true
  // "lo antes posible", "ahora", "el día más próximo": the first real free turno. No day is
  // fixed here: the search starts at the day already known (today from the current time when
  // there is none) and goes forward until there is one.
  if (LO_ANTES_POSIBLE.test(texto)) datos.asap = true
  if (CUALQUIER_PROFESIONAL.test(texto)) datos.anyProvider = true
  // A time or a part of the day without a day ("a las 18", "esta tarde") keeps the day known so
  // far; the caller decides (combinarNecesidad).
  return datos
}

// The state of the conversation after a message: what was known plus what the message adds.
// A new trade is a new need (its day and time are kept only if the same message repeats them).
export function combinarNecesidad(previa: NecesidadTurno | null, datos: DatosNecesidad): NecesidadTurno {
  // A state saved before a field existed reads as its empty value.
  const base: NecesidadTurno = { ...NECESIDAD_VACIA, ...(previa ?? {}) }
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
    siguiente.since = null
  } else if (datos.since) {
    // A stretch of the calendar replaces the day said before.
    siguiente.since = datos.since
    siguiente.day = null
    siguiente.dayTo = null
  }
  // A doubt about the day lasts one message: it is asked and answered, never stored.
  siguiente.dayOptions = null
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
  if (datos.asap) siguiente.asap = true
  // A professional chosen by name and "cualquiera" exclude each other: the last one said wins.
  if (datos.providerId) {
    siguiente.providerId = datos.providerId
    siguiente.providerName = datos.providerName ?? null
    siguiente.anyProvider = false
    // Choosing somebody by name takes them out of the exclusions: the last thing said wins.
    if (siguiente.excludedProviderIds?.includes(datos.providerId)) siguiente.excludedProviderIds = siguiente.excludedProviderIds.filter((id) => id !== datos.providerId)
  } else if (datos.anyProvider) {
    siguiente.anyProvider = true
    siguiente.providerId = null
    siguiente.providerName = null
  }
  if (datos.excludedProviderIds?.length) siguiente.excludedProviderIds = [...new Set([...(siguiente.excludedProviderIds ?? []), ...datos.excludedProviderIds])].filter((id) => id !== siguiente.providerId)
  return siguiente
}

// What is still needed to look for real availability: only the service. The zone is never
// required (without one the search covers every provider of the trade) and neither is the day:
// without one the backend walks the calendar forward and shows the real days with free turnos.
export function faltantes(necesidad: NecesidadTurno): 'profession'[] {
  return necesidad.profession ? [] : ['profession']
}

// The day after a calendar day (YYYY-MM-DD), for the search that walks forward.
export const diaSiguiente = (fecha: string): string => sumarDias(fecha, 1)

// The window of TODAY that is still ahead: what the person asked, from the current time on.
// null when nothing of it is left today (the search moves to the next day).
export function ventanaDesde(time: VentanaHoraria | null, hora: string): VentanaHoraria | null | 'pasada' {
  if (!time) return { kind: 'from', from: hora, to: null }
  if (time.kind === 'exact') return time.from! >= hora ? time : 'pasada'
  if (time.kind === 'from') return { kind: 'from', from: time.from! >= hora ? time.from : hora, to: null }
  if (time.kind === 'until') return time.to! > hora ? { kind: 'between', from: hora, to: time.to } : 'pasada'
  if (time.to! <= hora) return 'pasada'
  return { kind: 'between', from: time.from! >= hora ? time.from : hora, to: time.to }
}

export const mencionaAlgo = (datos: DatosNecesidad): boolean => Object.keys(datos).length > 0

// ---- how a window is told back to the person -----------------------------------------------

// A calendar day (YYYY-MM-DD, Argentina) as a person names it: "jueves 8". The month is added when
// the bare number could be misread: another month than today's, or a week or more ahead (the same
// weekday twice in sight): "jueves 15 de octubre".
export function nombreDia(fecha: string, ahora: number): string {
  const hoy = hoyArgentina(ahora)
  const lejos = Math.round((Date.parse(`${fecha}T12:00:00.000Z`) - Date.parse(`${hoy}T12:00:00.000Z`)) / DIA_MS) >= 7
  const mes = fecha.slice(0, 7) !== hoy.slice(0, 7) || lejos ? ` de ${MESES[Number(fecha.slice(5, 7)) - 1]}` : ''
  return `${NOMBRES_DIA[diaSemana(fecha)]} ${Number(fecha.slice(8, 10))}${mes}`
}

// How a day is told back inside a sentence: always with its real weekday and number, so "hoy" and
// "mañana" are never the only thing said ("mañana viernes 9", "el jueves 15 de octubre").
export function describirDia(day: string, dayTo: string | null, ahora: number): string {
  const hoy = hoyArgentina(ahora)
  const uno = (fecha: string) => {
    if (fecha === hoy) return `hoy ${nombreDia(fecha, ahora)}`
    if (fecha === sumarDias(hoy, 1)) return `mañana ${nombreDia(fecha, ahora)}`
    return `el ${nombreDia(fecha, ahora)}`
  }
  return dayTo ? `${uno(day)} y ${uno(dayTo)}` : uno(day)
}

export function describirVentana(time: VentanaHoraria | null): string {
  if (!time) return ''
  if (time.part) return time.part === 'manana' ? 'a la mañana' : time.part === 'mediodia' ? 'al mediodía' : `a la ${time.part}`
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
