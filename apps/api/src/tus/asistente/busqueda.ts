import { oficio } from '../directorio/oficios.ts'
import { sinAcentos } from '../texto.ts'
import type { DisponibilidadNecesidad, OfertaTurnos } from './dominio.ts'
import type { AdjuntoAsistente } from './meta.ts'
import { describirDia, describirVentana, enVentana, horasPosibles, type DatosNecesidad, type NecesidadTurno } from './necesidad.ts'

// From a real availability result to what the person reads. Pure: every name, time and count
// comes from the result of the domain; nothing here can add a provider, a time or a price.

export interface OfertasMostradas {
  profession: string
  items: { providerId: string; name: string; starts: string[] }[]
  // The conversation asked "¿a qué hora?" about the ONE professional in `items`: the next message
  // is read as a time (a bare "10" is 10:00 there, not "the tenth" nor a professional).
  esperaHora?: boolean
}

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const local = (iso: string) => new Date(Date.parse(iso) - 3 * 3_600_000)
export const horaLocal = (iso: string): string => local(iso).toISOString().slice(11, 16)
export const diaLocal = (iso: string): string => local(iso).toISOString().slice(0, 10)

const conTurnos = (resultado: DisponibilidadNecesidad): OfertaTurnos[] => resultado.providers.filter((item) => item.matches.length > 0 || item.nearby.length > 0)
const iniciosDe = (item: OfertaTurnos): string[] => (item.matches.length > 0 ? item.matches : item.nearby)

// The providers and starts shown, in the order shown: what "el segundo" or a name refers to next.
export function ofertasDeResultado(resultado: DisponibilidadNecesidad): OfertasMostradas {
  return { profession: resultado.profession, items: conTurnos(resultado).map((item) => ({ providerId: item.providerId, name: item.name, starts: iniciosDe(item) })) }
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
export function preguntaHora(item: OfertasMostradas['items'][number]): string {
  return `No entendí la hora. ${item.name} tiene: ${item.starts.slice(0, 6).map(horaLocal).join(', ')}. ¿Cuál preferís?`
}

// The ONE thing still missing to search (never the zone).
export function preguntaFaltante(need: NecesidadTurno): string {
  if (!need.profession) {
    if (need.alternatives.length > 1) return `¿Qué necesitás: ${need.alternatives.map((id) => oficio(id).label).join(', ')}?`
    return '¿Qué servicio necesitás?'
  }
  return `¿Para cuándo necesitás ${oficio(need.profession).label}?`
}

// The result as DATA for the model that writes the reply (compact, no ids to recite).
export function resumenParaModelo(need: NecesidadTurno, resultado: DisponibilidadNecesidad, ahora: number) {
  return {
    servicio: oficio(resultado.profession).label,
    pedido: { dia: need.day ? describirDia(need.day, need.dayTo, ahora) : null, horario: describirVentana(need.time) || null, zona: need.zone ?? (need.anyZone ? 'cualquiera' : null) },
    resultado: resultado.outcome,
    zonaAmpliada: resultado.zoneRelaxed,
    profesionales: resultado.providers.map((item, indice) => ({
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
  for (const [patron, indice] of ORDINALES) if (!item && patron.test(texto)) item = ofertas.items[indice]
  const numero = /^(?:el |la |opcion |numero |nro )?([1-5])$/u.exec(texto)
  if (!item && numero) item = ofertas.items[Number(numero[1]) - 1]
  if (!item) {
    const nombres = ofertas.items.filter((candidato) => {
      const completo = sinAcentos(candidato.name.toLowerCase())
      const primero = completo.split(' ')[0] ?? ''
      return texto.includes(completo) || (primero.length >= 3 && new RegExp(`\\b${primero.replace(/[^a-zñ]/gu, '')}\\b`, 'u').test(texto))
    })
    if (nombres.length === 1) item = nombres[0]
  }
  // One provider on the table and the message is only a time: it is about that provider.
  if (!item && ofertas.items.length === 1 && datos.time?.kind === 'exact' && !datos.profession) item = ofertas.items[0]
  if (!item) return null
  const hora = datos.time?.kind === 'exact' ? datos.time.from : null
  const starts = item.starts.filter((inicio) => (!hora || horaLocal(inicio) === hora) && (!datos.day || diaLocal(inicio) === datos.day))
  return { item, starts }
}
