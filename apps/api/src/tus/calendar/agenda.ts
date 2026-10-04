import { iniciosDeFranja, type DiaAgenda, type EstadoFranjaAgenda, type FranjaAgenda } from '@factory/contracts'
import { dateWeekday, toMinutes } from './rules.ts'

// Agenda of ONE day of a provider: weekly rules crossed with reservations and exceptions. Pure
// (no database, no clock of its own): the service loads the rows and this decides the state of
// every possible start. It is the only place where turnos are generated.
//
// The agenda says WHEN the provider works; the service says HOW LONG a turno lasts. Starts go
// from the real beginning of each range of hours, one every (duration + rest): a 60 minute
// service that opens at 09:30 is offered at 09:30, 10:30, 11:30... never every 15 minutes. The
// sequence is fixed by the range: a reservation or a block removes the starts it overlaps, it
// does not shift the others.

export interface ReglaAgenda {
  diaSemana: number
  horaInicio: string
  horaFin: string
}

export interface TramoAgenda {
  inicio: Date
  fin: Date
}

export interface EntradaAgendaDia {
  fecha: string
  reglas: ReglaAgenda[]
  // Real duration of the service (of the chosen variant): it is also the step between starts. A
  // start exists only if start + duration fits the working hours.
  duracionMinutos: number
  // Rest between two turnos: it is added to the step, and none may start less than this after
  // another ends, nor end less than this before another starts. The rest AFTER the last turno of
  // a range does not have to fit inside the working hours: only the service itself does.
  bufferMinutos: number
  reservas: TramoAgenda[]
  bloqueos: TramoAgenda[]
  ahora: number
}

// The agenda is in Argentina time (UTC-3, no daylight saving).
const medianoche = (fecha: string): number => new Date(`${fecha}T00:00:00.000-03:00`).getTime()
const seSolapan = (inicio: number, fin: number, tramo: TramoAgenda, colchon = 0): boolean => inicio < tramo.fin.getTime() + colchon && fin + colchon > tramo.inicio.getTime()

// Minutes between two consecutive starts of a service: its duration plus the rest after it.
export const pasoDeTurnos = (duracionMinutos: number, bufferMinutos: number): number => duracionMinutos + Math.max(0, bufferMinutos || 0)

export function agendaDelDia(input: EntradaAgendaDia): DiaAgenda {
  const diaSemana = dateWeekday(input.fecha)
  const base = medianoche(input.fecha)
  const reglas = input.reglas.filter((regla) => regla.diaSemana === diaSemana).sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
  if (reglas.length === 0) return { fecha: input.fecha, diaSemana, estado: base + 24 * 3_600_000 <= input.ahora ? 'pasado' : 'no_laboral', franjas: [] }

  const duracion = input.duracionMinutos * 60_000
  const franjas: FranjaAgenda[] = []
  for (const regla of reglas) {
    for (const hora of iniciosDeFranja(regla.horaInicio, regla.horaFin, pasoDeTurnos(input.duracionMinutos, input.bufferMinutos), input.duracionMinutos)) {
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
