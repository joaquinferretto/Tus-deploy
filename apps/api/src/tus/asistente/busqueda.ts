import { formatearPesos } from '@factory/contracts'
import { oficio, oficiosInterpretables } from '../directorio/oficios.ts'
import { sinAcentos } from '../texto.ts'
import type { DisponibilidadNecesidad, OfertaTurnos } from './dominio.ts'
import type { AdjuntoAsistente } from './meta.ts'
import { describirDia, describirVentana, enVentana, horasPosibles, hoyArgentina, lunesDe, nombreDia, type DatosNecesidad, type NecesidadTurno } from './necesidad.ts'

// From a real availability result to what the person reads. Pure: every name, time and count
// comes from the result of the domain; nothing here can add a provider, a time or a price.

export interface OfertasMostradas {
  profession: string
  // area: the approximate zone shown next to the name ("la de Barrio Sur" refers to it).
  // day: the calendar day (YYYY-MM-DD, Argentina) this option was listed under, when the listing
  // covers several days: the same professional is then one option per day, each with its number.
  items: { providerId: string; name: string; area?: string; starts: string[]; day?: string }[]
  // The conversation asked "¿a qué hora?" about the ONE professional in `items`: the next message
  // is read as a time (a bare "10" is 10:00 there, not "the tenth" nor a professional).
  esperaHora?: boolean
}

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const local = (iso: string) => new Date(Date.parse(iso) - 3 * 3_600_000)
export const horaLocal = (iso: string): string => local(iso).toISOString().slice(11, 16)
export const diaLocal = (iso: string): string => local(iso).toISOString().slice(0, 10)

// When at least one professional fits what was asked (an exact time, "desde las 18", a range, a
// part of the day), ONLY those are listed: a professional with other hours is never shown under
// "con turno a las 09:15". When nobody fits, the closest real starts are offered and said so.
const conTurnos = (resultado: DisponibilidadNecesidad): OfertaTurnos[] =>
  resultado.outcome === 'matches' ? resultado.providers.filter((item) => item.matches.length > 0) : resultado.providers.filter((item) => item.matches.length > 0 || item.nearby.length > 0)
const iniciosDe = (item: OfertaTurnos): string[] => (item.matches.length > 0 ? item.matches : item.nearby)

// The providers and starts shown, in the order shown: what "el segundo" or a name refers to next.
export function ofertasDeResultado(resultado: DisponibilidadNecesidad): OfertasMostradas {
  return { profession: resultado.profession, items: conTurnos(resultado).map((item) => ({ providerId: item.providerId, name: item.name, area: item.area, starts: iniciosDe(item) })) }
}

export function adjuntoDisponibilidad(resultado: DisponibilidadNecesidad): AdjuntoAsistente | null {
  const ofertas = conTurnos(resultado)
  if (ofertas.length > 0)
    return {
      kind: 'appointments',
      profession: resultado.profession,
      providers: ofertas.map((item) => ({
        providerId: item.providerId,
        name: item.name,
        area: item.area,
        verified: item.verified,
        completedJobs: item.completedJobs,
        durationMinutes: item.durationMinutes,
        exact: item.matches.length > 0,
        starts: iniciosDe(item),
      })),
    }
  // Providers that work by request (no turnos online): the existing provider cards.
  if (resultado.outcome === 'no_appointments')
    return {
      kind: 'providers',
      providers: resultado.providers.map((item) => ({ providerId: item.providerId, name: item.name, profession: item.profession, area: item.area, verified: item.verified, completedJobs: item.completedJobs, availability: 'Se coordina por solicitud' })),
    }
  return null
}

const cuantos = (cantidad: number) => (cantidad === 1 ? '1 profesional' : `${cantidad} profesionales`)

// How the person is invited to choose among numbered options.
const COMO_ELEGIR = 'Podés decirme el número, el nombre o el horario que preferís.'

// The first real free turno found by walking the calendar forward: said as what it is (its real
// day, time and professional), followed by the options of that day. The days before it are not
// recited ("hoy no hay"): the person asked for the first one, not for the ones that are missing.
export function textoPrimeraDisponibilidad(need: NecesidadTurno, resultado: DisponibilidadNecesidad, dia: string, ahora: number): string {
  const label = oficio(resultado.profession).label
  if (resultado.outcome === 'no_providers' || resultado.outcome === 'no_appointments') return textoDisponibilidad({ ...need, day: dia, dayTo: null }, resultado, ahora)
  const ofertas = conTurnos(resultado)
  if (ofertas.length === 0) return `No encontré turnos libres de ${label}${need.providerName ? ` con ${need.providerName}` : ''} ${describirVentana(need.time) ? `${describirVentana(need.time)} ` : ''}en los próximos ${DIAS_BUSQUEDA_PRIMERA} días.`
  const primera = ofertas.map((item) => ({ item, start: [...iniciosDe(item)].sort()[0]! })).sort((a, b) => a.start.localeCompare(b.start))[0]!
  const cabecera = `La primera disponibilidad de ${label} es ${describirDia(dia, null, ahora)} a las ${horaLocal(primera.start)} con ${primera.item.name}.`
  if (ofertas.length === 1 && iniciosDe(ofertas[0]!).length === 1) return `${cabecera} ¿Querés solicitar ese turno?`
  const lista = ofertas.map((item, indice) => `${indice + 1}. ${item.name} — ${item.area}: ${iniciosDe(item).slice(0, 4).map(horaLocal).join(', ')}`).join('\n')
  return `${cabecera}\n\nOpciones de ese día:\n${lista}\n\n${COMO_ELEGIR}`
}

// Days the search for the first free turno walks forward (today included).
export const DIAS_BUSQUEDA_PRIMERA = 14
// No day was asked: the calendar is walked this many days (twice as many when the first stretch
// has nothing) and at most this many days with free turnos are listed.
export const DIAS_PANORAMA = 7
export const DIAS_LISTADOS = 3
const OPCIONES_LISTADAS = 9

const capitalizar = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

// One concrete option proposed by the backend (the first real free turno of whoever, or of the
// professional the person chose). The person accepts it with "sí": nothing is requested before.
export function textoPropuesta(input: { name: string; start: string; ahora: number; motivo?: string | null }): string {
  return `${input.motivo ? `${input.motivo} ` : ''}La primera disponibilidad es ${describirDia(diaLocal(input.start), null, input.ahora)} a las ${horaLocal(input.start)} con ${input.name}. ¿Querés esa?`
}

// ---- several days at once ---------------------------------------------------------------------

// A day of the calendar with the real result of its search.
export interface DiaDisponible {
  dia: string
  resultado: DisponibilidadNecesidad
}

// The options of a listing that covers several days, in the order shown: one per professional and
// day, numbered across the whole listing (a number always means one professional on one day).
export function ofertasDePanorama(profession: string, dias: DiaDisponible[]): OfertasMostradas {
  const items = dias.flatMap(({ dia, resultado }) => conTurnos(resultado).filter((item) => item.matches.length > 0).map((item) => ({ providerId: item.providerId, name: item.name, area: item.area, starts: item.matches, day: dia })))
  return { profession, items: items.slice(0, OPCIONES_LISTADAS) }
}

// The calendar days of a listing, in order.
export const diasDe = (ofertas: Pick<OfertasMostradas, 'items'>): string[] => [...new Set(ofertas.items.flatMap((item) => (item.day ? [item.day] : item.starts.map(diaLocal))))].sort()

// Options as they are shown, grouped under their real day ("Jueves 8") when there is more than one.
export function listaDeOpciones(ofertas: Pick<OfertasMostradas, 'items'>, ahora: number, horasPorOpcion = 4): string {
  const dias = diasDe(ofertas)
  const linea = (item: OfertasMostradas['items'][number], indice: number) => `${indice + 1}. ${item.name}${item.area ? ` — ${item.area}` : ''}${item.starts.length > 0 ? `: ${item.starts.slice(0, horasPorOpcion).map(horaLocal).join(', ')}` : ''}`
  if (dias.length <= 1) return ofertas.items.map(linea).join('\n')
  return dias
    .map((dia) => {
      const lineas = ofertas.items.map((item, indice) => ((item.day ?? diaLocal(item.starts[0] ?? '')) === dia ? linea(item, indice) : null)).filter(Boolean)
      return `${capitalizar(nombreDia(dia, ahora))}\n${lineas.join('\n')}`
    })
    .join('\n\n')
}

// No day was asked: the real days with free turnos, each with its professionals and times.
export function textoPanorama(need: NecesidadTurno, ofertas: OfertasMostradas, ahora: number, opciones: { zonaAmpliada?: boolean; motivo?: string | null } = {}): string {
  const label = oficio(ofertas.profession).label
  const ventana = describirVentana(need.time)
  const otraZona = opciones.zonaAmpliada && need.zone ? `No encontré profesionales de ${label} que atiendan en ${need.zone}; estos son de otras zonas.\n` : ''
  const dias = diasDe(ofertas)
  const cabecera = dias.length === 1
    ? `Hay disponibilidad de ${label}${need.providerName ? ` con ${need.providerName}` : ''} ${describirDia(dias[0]!, null, ahora)}${ventana ? ` ${ventana}` : ''}:`
    : `Hay disponibilidad de ${label}${need.providerName ? ` con ${need.providerName}` : ''}${ventana ? ` ${ventana}` : ''}:`
  return `${opciones.motivo ? `${opciones.motivo} ` : ''}${otraZona}${cabecera}\n\n${listaDeOpciones(ofertas, ahora)}\n\n${COMO_ELEGIR}`
}

// "¿Qué días atiende?": exactly that, the real days (no times). `nombre`: one professional's agenda.
export function textoDias(profession: string, dias: string[], ahora: number, nombre: string | null = null): string {
  const label = oficio(profession).label
  if (dias.length === 0) return `No encontré días con turnos libres de ${label}${nombre ? ` con ${nombre}` : ''} en los próximos ${DIAS_PANORAMA * 2} días.`
  const hoy = hoyArgentina(ahora)
  const domingo = new Date(Date.parse(`${lunesDe(hoy)}T12:00:00.000Z`) + 6 * 86_400_000).toISOString().slice(0, 10)
  const cuando = dias.every((dia) => dia <= domingo) ? 'Esta semana' : 'En los próximos días'
  const nombres = dias.map((dia) => describirDia(dia, null, ahora))
  const lista = nombres.length === 1 ? nombres[0]! : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
  return `${cuando} ${nombre ? `${nombre} tiene` : 'hay'} disponibilidad de ${label} ${lista}. ${dias.length === 1 ? '¿Te muestro los horarios de ese día?' : '¿Qué día preferís?'}`
}

// The real times of a professional as they are read out: the times alone when they are all on one
// day, each day with its times otherwise.
export function horasDe(starts: readonly string[], ahora: number, maximo = 6): string {
  const dias = [...new Set(starts.map(diaLocal))].sort()
  if (dias.length <= 1) return starts.slice(0, maximo).map(horaLocal).join(', ')
  return dias.map((dia) => `${nombreDia(dia, ahora)}: ${starts.filter((inicio) => diaLocal(inicio) === dia).slice(0, 4).map(horaLocal).join(', ')}`).join(' · ')
}

// Each professional of a listing once, with every start shown for her across its days.
export function personasDe<T extends { providerId: string; starts: string[] }>(items: readonly T[]): T[] {
  const unicas = new Map<string, T>()
  for (const item of items) {
    const previa = unicas.get(item.providerId)
    unicas.set(item.providerId, previa ? ({ ...previa, starts: [...new Set([...previa.starts, ...item.starts])].sort(), day: undefined } as T) : item)
  }
  return [...unicas.values()]
}

// "¿Qué días atiende?", "¿cuándo hay turnos?": the DAYS are asked, not the times.
export const PIDE_DIAS = /\bqu[eé] d[ií]as?\b|\bcu[aá]les d[ií]as\b|\bcu[aá]ndo (?:atiende[ns]?|hay|tiene[ns]?|trabaja[ns]?|puede[ns]?|est[aá]n? disponibles?)\b|\bd[ií]as (?:disponibles|libres|de atenci[oó]n)\b/iu
// "¿Qué horarios tiene?", "¿a qué hora atienden?": the TIMES are asked.
export const PIDE_HORARIOS = /\bqu[eé] horarios?\b|\ba qu[eé] horas?\b|\bhorarios? (?:disponibles?|libres?|tiene[ns]?|hay)\b|\bqu[eé] turnos?\b|\bturnos (?:disponibles|libres)\b/iu

// The real prices of the service being talked about, per professional (pesos). Every value comes
// from the backend; a professional without a published price says so.
export function textoPrecios(label: string, precios: { name: string; options: { name: string; price: number | null }[] }[]): string {
  const conPrecio = precios.map((item) => ({ ...item, options: item.options.filter((opcion) => opcion.price !== null && opcion.price > 0) }))
  if (conPrecio.every((item) => item.options.length === 0)) return `El servicio de ${label} todavía no tiene un precio publicado${precios.length === 1 ? ` con ${precios[0]!.name}` : ''}.`
  const describir = (options: { name: string; price: number | null }[]) => options.length === 1 ? formatearPesos(options[0]!.price!) : options.map((opcion) => `${opcion.name} ${formatearPesos(opcion.price!)}`).join(', ')
  const valores = new Set(conPrecio.map((item) => describir(item.options)))
  if (conPrecio.length === 1) return `${label} con ${conPrecio[0]!.name}: ${describir(conPrecio[0]!.options) || 'todavía sin precio publicado'}.`
  if (valores.size === 1 && conPrecio.every((item) => item.options.length > 0)) return `${label} cuesta ${[...valores][0]} con cualquiera de los ${conPrecio.length} profesionales.`
  return `Los precios de ${label} dependen del profesional:\n${conPrecio.map((item, indice) => `${indice + 1}. ${item.name}: ${item.options.length ? describir(item.options) : 'todavía sin precio publicado'}`).join('\n')}`
}

// A name of a professional inside a message, against the ones the backend listed: the full name,
// its first name, or the first name with one typo ("melna" for Melina). Only when exactly ONE
// professional matches: two possible ones are never guessed between.
export function profesionalNombrado<T extends { name: string }>(mensaje: string, candidatos: readonly T[]): T | null {
  const posibles = profesionalesNombrados(mensaje, candidatos)
  return posibles.length === 1 ? posibles[0]! : null
}

// Every professional of the list the message may name. More than one: the person is asked which
// (never guessed). The full name wins over the first name ("Melina Martínez" said entirely names
// her, not "Melina"); a typo only counts when no name was written right.
export function profesionalesNombrados<T extends { name: string }>(mensaje: string, candidatos: readonly T[]): T[] {
  const limpiar = (texto: string) => sinAcentos(texto.toLowerCase()).replace(/[^a-z0-9ñ\s]/gu, ' ').replace(/\s+/gu, ' ').trim()
  const texto = limpiar(mensaje)
  const palabras = texto.split(' ')
  const contiene = (frase: string) => new RegExp(`(?:^| )${frase}(?: |$)`, 'u').test(texto)
  const completos = candidatos.filter((candidato) => { const completo = limpiar(candidato.name); return completo.includes(' ') && contiene(completo) })
  if (completos.length > 0) return completos
  const exactos = candidatos.filter((candidato) => {
    const completo = limpiar(candidato.name)
    const primero = completo.split(' ')[0] ?? ''
    return contiene(completo) || (primero.length >= 3 && palabras.includes(primero))
  })
  if (exactos.length > 0) return exactos
  return candidatos.filter((candidato) => {
    const primero = limpiar(candidato.name).split(' ')[0]?.replace(/[^a-zñ]/gu, '') ?? ''
    return primero.length >= 5 && palabras.some((palabra) => palabra.length >= 4 && palabra[0] === primero[0] && distanciaEdicion(palabra, primero) <= 1)
  })
}

// "la de Barrio Sur", "el de Centro": the professional of the list shown in that zone (only one).
export function profesionalPorZona<T extends { area?: string }>(mensaje: string, candidatos: readonly T[]): T | null {
  const texto = sinAcentos(mensaje.toLowerCase()).replace(/[^a-z0-9ñ\s]/gu, ' ').replace(/\s+/gu, ' ').trim()
  const de = /\b(?:la|el|con la|con el) (?:que (?:atiende|esta|es) )?(?:de|en|del barrio) (.+)$/u.exec(texto)
  if (!de) return null
  const zona = de[1]!.trim()
  const posibles = candidatos.filter((candidato) => candidato.area && sinAcentos(candidato.area.toLowerCase()).replace(/[^a-z0-9ñ\s]/gu, ' ').replace(/\s+/gu, ' ').trim() === zona)
  return posibles.length === 1 ? posibles[0]! : null
}

function distanciaEdicion(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2
  let fila = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const nueva = [i]
    for (let j = 1; j <= b.length; j += 1) nueva[j] = Math.min(fila[j]! + 1, nueva[j - 1]! + 1, fila[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    fila = nueva
  }
  return fila[b.length]!
}

// "la otra", "el otro", "no esa, la otra": another of the professionals listed.
// "otro plomero", "otra profesional": whatever the trade is called; another day, time or zone is
// not another professional.
export const PIDE_OTRA = /\b(?:la|el|con la|con el) otr[oa]\b|\botr[oa] (?!d[ií]a\b|hora\b|horario\b|fecha\b|zona\b|barrio\b|lugar\b|vez\b|cosa\b|servicio\b|momento\b|semana\b|turno\b|precio\b)[a-zñáéíóú]{4,}\b|^\s*otr[oa]\s*[.!?]*\s*$|^\s*[¿]?\s*(?:y\s+)?con\s+otr[oa]\s*[.!?]*\s*$/iu

export function textoDisponibilidad(need: NecesidadTurno, resultado: DisponibilidadNecesidad, ahora: number): string {
  const label = oficio(resultado.profession).label
  const dia = need.day ? describirDia(need.day, need.dayTo, ahora) : ''
  const cuando = [dia, describirVentana(need.time)].filter(Boolean).join(' ')
  const dosDias = Boolean(need.dayTo)
  const horas = (inicios: string[]) => inicios.slice(0, 4).map((inicio) => (dosDias ? `${DIAS_CORTOS[local(inicio).getUTCDay()]} ${horaLocal(inicio)}` : horaLocal(inicio))).join(', ')
  const linea = (item: OfertaTurnos, indice: number, inicios: string[] | null) => `${indice + 1}. ${item.name} — ${item.area}${inicios ? `: ${horas(inicios)}` : ''}`
  const otraZona = resultado.zoneRelaxed && need.zone ? `No encontré profesionales de ${label} que atiendan en ${need.zone}; estos son de otras zonas.\n` : ''
  const ofertas = conTurnos(resultado)

  if (resultado.outcome === 'no_providers') return `Todavía no hay profesionales de ${label} publicados en TUS${need.zone && !resultado.zoneRelaxed ? ` que atiendan en ${need.zone}` : ''}.`

  if (resultado.outcome === 'no_appointments')
    return `${otraZona}Encontré ${cuantos(resultado.providers.length)} de ${label}. No toman turnos online: se coordina enviándoles una solicitud.\n${resultado.providers.map((item, indice) => linea(item, indice, null)).join('\n')}\n¿A cuál querés enviársela?`

  if (resultado.outcome === 'no_availability')
    return `${otraZona}Hay ${cuantos(resultado.providers.filter((item) => item.takesAppointments).length)} de ${label}, pero sin turnos libres ${dia || 'ese día'}. ¿Querés que busque otro día?`

  // Several durations change which starts exist: said once, with what the result really has.
  const conVarias = ofertas.find((item) => new Set(item.tariffs.map((tarifa) => tarifa.durationMinutes)).size > 1)
  const duraciones = conVarias
    ? `\nLos horarios son para turnos de ${conVarias.durationMinutes} min; ${conVarias.name} también ofrece ${[...new Set(conVarias.tariffs.map((tarifa) => tarifa.durationMinutes))].filter((minutos) => minutos !== conVarias.durationMinutes).join(' y ')} min.`
    : ''

  if (resultado.outcome === 'nearby')
    return `${otraZona}No encontré turnos de ${label} ${cuando}. Lo más cercano ${dia}:\n${ofertas.map((item, indice) => linea(item, indice, item.nearby)).join('\n')}${duraciones}\n¿Te sirve alguno?`

  const unoSolo = ofertas.every((item) => iniciosDe(item).length === 1)
  return `${otraZona}Encontré ${cuantos(ofertas.length)} de ${label} con turno ${cuando}:\n${ofertas.map((item, indice) => linea(item, indice, iniciosDe(item))).join('\n')}${duraciones}\n${unoSolo ? '¿Con cuál querés solicitar el turno?' : 'Decime con quién y a qué hora y te preparo la solicitud.'}`
}

// The time was not understood while a professional was waiting for one: its real times again,
// never an error.
export function preguntaHora(item: OfertasMostradas['items'][number], ahora: number): string {
  return `No entendí la hora. ${item.name} tiene: ${horasDe(item.starts, ahora)}. ¿Cuál preferís?`
}

// The ONE thing that can be missing to search: which service. Nothing is assumed: the examples
// are services of the administered catalog, never a default one.
export function preguntaFaltante(need: Pick<NecesidadTurno, 'alternatives'>, opciones: { noEncontrado?: boolean } = {}): string {
  if (need.alternatives.length > 1) return `¿Qué necesitás: ${need.alternatives.map((id) => oficio(id).label).join(', ')}?`
  const ejemplos = oficiosInterpretables().slice(0, 6).map((item) => item.nombre)
  const pregunta = opciones.noEncontrado ? 'No encontré ese servicio en TUS. ¿Qué servicio necesitás?' : '¿Qué servicio necesitás?'
  return ejemplos.length > 0 ? `${pregunta} Por ejemplo: ${ejemplos.join(', ')}.` : pregunta
}

// The result as DATA for the model that writes the reply (compact, no ids to recite).
export function resumenParaModelo(need: NecesidadTurno, resultado: DisponibilidadNecesidad, ahora: number) {
  return {
    servicio: oficio(resultado.profession).label,
    pedido: { dia: need.day ? describirDia(need.day, need.dayTo, ahora) : null, horario: describirVentana(need.time) || null, zona: need.zone ?? (need.anyZone ? 'cualquiera' : null) },
    resultado: resultado.outcome,
    zonaAmpliada: resultado.zoneRelaxed,
    // The same professionals the person sees: when someone fits, only who fits.
    profesionales: (resultado.outcome === 'matches' ? resultado.providers.filter((item) => item.matches.length > 0) : resultado.providers).map((item, indice) => ({
      numero: indice + 1,
      nombre: item.name,
      zona: item.area,
      tomaTurnosOnline: item.takesAppointments,
      duracionMinutos: item.durationMinutes,
      otrasDuraciones: [...new Set(item.tariffs.map((tarifa) => tarifa.durationMinutes))].filter((minutos) => minutos !== item.durationMinutes),
      horariosQueCoinciden: item.matches.map(horaLocal),
      horariosCercanos: item.nearby.map(horaLocal),
    })),
  }
}

const ORDINALES: [RegExp, number][] = [
  [/\b(?:primer[oa]?|1r[oa]|1er[oa]?)\b/u, 0],
  [/\b(?:segund[oa]|2d[oa])\b/u, 1],
  [/\b(?:tercer[oa]?|3r[oa]|3er[oa]?)\b/u, 2],
  // "y cuarto" is a quarter past the hour ("a las 9 y cuarto"), never the fourth professional.
  [/(?<!\by )\b(?:cuart[oa]|4t[oa])\b/u, 3],
  [/\b(?:quint[oa]|5t[oa])\b/u, 4],
]

// Which of the offers shown the message refers to: an ordinal ("el segundo"), a bare number
// ("2"), a name, or just a time when a single provider is on the table. With the starts of that
// provider that fit the time (and day) the message says. null: the message does not choose.
export function elegirOferta(mensaje: string, datos: DatosNecesidad, ofertas: OfertasMostradas | null | undefined): { item: OfertasMostradas['items'][number]; starts: string[] } | null {
  if (!ofertas || ofertas.items.length === 0) return null
  // "cualquiera", "la que esté disponible primero": nobody in particular is chosen.
  if (datos.anyProvider) return null
  // The conversation is waiting for the time of ONE professional: the message is read as a time
  // first, normalised here and matched against the times that professional really has. A time it
  // does not have comes back with no starts (the caller says which ones it has).
  if (ofertas.esperaHora && ofertas.items.length === 1 && !datos.profession) {
    const unico = ofertas.items[0]!
    const delDia = unico.starts.filter((inicio) => !datos.day || diaLocal(inicio) === datos.day)
    const horas = horasPosibles(mensaje)
    if (horas.length > 0) {
      for (const hora of horas) {
        const starts = delDia.filter((inicio) => horaLocal(inicio) === hora)
        if (starts.length > 0) return { item: unico, starts }
      }
      return { item: unico, starts: [] }
    }
    // "a la tarde", "después de las 10": the times of that professional inside that part of the day.
    if (datos.time && datos.time.kind !== 'exact') return { item: unico, starts: delDia.filter((inicio) => enVentana(horaLocal(inicio), datos.time!)) }
  }
  const texto = sinAcentos(mensaje.toLowerCase()).replace(/[^a-z0-9ñ:\s]/gu, ' ').replace(/\s+/gu, ' ').trim()
  let item: OfertasMostradas['items'][number] | undefined
  // A position ("la segunda", "2", "el 2 a las 16") is the option shown at that place: one
  // professional and, in a listing of several days, the day it was listed under.
  for (const [patron, indice] of ORDINALES) if (!item && patron.test(texto)) item = ofertas.items[indice]
  const numero = /^(?:(?:con )?(?:el|la) |opcion |numero |nro )?(\d)(?:$| (?=a las?\b|para las?\b|tipo\b|sobre las?\b|el\b|este\b|manana\b|hoy\b|por favor\b|porfa\b))/u.exec(texto)
  if (!item && numero) item = ofertas.items[Number(numero[1]) - 1]
  // A name or a zone is the professional, on whichever of the days listed.
  const personas = personasDe(ofertas.items)
  if (!item) item = profesionalNombrado(mensaje, personas) ?? profesionalPorZona(mensaje, personas) ?? undefined
  // One professional on the table and the message is only a time or a day: it is about her.
  if (!item && personas.length === 1 && (datos.time?.kind === 'exact' || datos.day) && !datos.profession) item = personas[0]
  if (!item) return null
  const hora = datos.time?.kind === 'exact' ? datos.time.from : null
  const starts = item.starts.filter((inicio) => (!hora || horaLocal(inicio) === hora) && (!datos.day || diaLocal(inicio) === datos.day) && (!datos.time || datos.time.kind === 'exact' || enVentana(horaLocal(inicio), datos.time)))
  // "Melina ya mismo": her FIRST real start (the list is in time order), nothing to ask.
  if (datos.asap && !hora && starts.length > 1) return { item, starts: [...starts].sort().slice(0, 1) }
  return { item, starts }
}
