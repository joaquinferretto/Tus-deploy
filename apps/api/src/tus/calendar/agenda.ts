import { iniciosDeFranja, type DiaAgenda, type EstadoFranjaAgenda, type FranjaAgenda } from '@factory/contracts'
import { dateWeekday, toMinutes } from './rules.ts'

// Agenda of ONE day of a provider: weekly rules crossed with reservations and exceptions. Pure
// (no database, no clock of its own): the service loads the rows and this decides the state of
// every possible start. It is the only place where turnos are generated.

export interface ReglaAgenda {
  diaSemana: number
  horaInicio: string
  horaFin: string
  // Own interval of the day; null/absent = the general interval of the agenda.
  intervaloMinutos?: number | null
}

export interface TramoAgenda {
  inicio: Date
  fin: Date
}

export interface EntradaAgendaDia {
  fecha: string
  reglas: ReglaAgenda[]
  intervaloGeneral: number
  // Real duration of the service: a start exists only if start + duration fits the working hours.
  duracionMinutos: number
  // Rest between two turnos: none may start less than this after another ends, nor end less than
  // this before another starts.
  bufferMinutos: number
  reservas: TramoAgenda[]
  bloqueos: TramoAgenda[]
  ahora: number
}

// The agenda is in Argentina time (UTC-3, no daylight saving).
const medianoche = (fecha: string): number => new Date(`${fecha}T00:00:00.000-03:00`).getTime()
const seSolapan = (inicio: number, fin: number, tramo: TramoAgenda, colchon = 0): boolean => inicio < tramo.fin.getTime() + colchon && fin + colchon > tramo.inicio.getTime()

export function agendaDelDia(input: EntradaAgendaDia): DiaAgenda {
  const diaSemana = dateWeekday(input.fecha)
  const base = medianoche(input.fecha)
  const reglas = input.reglas.filter((regla) => regla.diaSemana === diaSemana).sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
  if (reglas.length === 0) return { fecha: input.fecha, diaSemana, estado: base + 24 * 3_600_000 <= input.ahora ? 'pasado' : 'no_laboral', franjas: [] }

  const duracion = input.duracionMinutos * 60_000
  const franjas: FranjaAgenda[] = []
  for (const regla of reglas) {
    const intervalo = regla.intervaloMinutos ?? input.intervaloGeneral
    for (const hora of iniciosDeFranja(regla.horaInicio, regla.horaFin, intervalo, input.duracionMinutos)) {
      const inicio = base + toMinutes(hora) * 60_000
      const fin = inicio + duracion
      const estado: EstadoFranjaAgenda =
        inicio <= input.ahora
          ? 'pasado'
          : input.bloqueos.some((bloqueo) => seSolapan(inicio, fin, bloqueo))
            ? 'bloqueado'
            : input.reservas.some((reserva) => seSolapan(inicio, fin, reserva, input.bufferMinutos * 60_000))
              ? 'ocupado'
              : 'disponible'
      franjas.push({ inicio: new Date(inicio).toISOString(), fin: new Date(fin).toISOString(), hora, estado })
    }
  }

  const vigentes = franjas.filter((franja) => franja.estado !== 'pasado')
  const estado = franjas.length > 0 && vigentes.length === 0 ? 'pasado' : vigentes.length > 0 && vigentes.every((franja) => franja.estado === 'bloqueado') ? 'bloqueado' : 'laboral'
  return { fecha: input.fecha, diaSemana, estado, franjas }
}
