import { sinAcentos } from '../texto.ts'
import { diaLocal, horaLocal } from './busqueda.ts'
import { describirDia } from './necesidad.ts'

// MEMORIA-01 (phase 6). The real state of TUS answers; the memory only says WHAT is being asked
// about. "¿Ya aceptó?", "¿a qué hora viene?", "¿cómo va mi turno?" are references: the person
// does not say which turno. The reference is resolved with what the conversation and the memory
// know (the service, the professional that were being talked about); the answer — state, day,
// time — comes from the entities of TUS, read now, for the account of the session. If a memory
// says 16:00 and the reservation says 17:00, the answer is 17:00.
//
// Payments keep their own verifier (the backend asks Mercado Pago): nothing here says "paid".

export type ConsultaOperativa = 'aceptacion' | 'horario' | 'estado'

// A question about the person's OWN turno that names no turno. Narrow on purpose: how to do
// something ("¿cómo veo mis turnos?") is help, and a new request is a search.
export function detectarConsultaOperativa(text: string): ConsultaOperativa | null {
  const plano = sinAcentos(text.toLowerCase()).replace(/[¿?¡!.,]/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (plano.split(' ').length > 14) return null
  if (/\b(?:ya )?(?:me )?(?:lo |la )?(?:acepto|aceptaron|aceptaste|confirmo|confirmaron|respondio|respondieron|contesto|contestaron)\b/u.test(plano) && !/\b(?:presupuesto|pago|pague|sena|postul\w*)\b/u.test(plano)) return 'aceptacion'
  if (/\b(?:a que hora|cuando|que dia|para cuando)\b.*\b(?:viene|vienen|va a venir|llega|es|era|quedo|tengo|tenia|toca|seria)\b/u.test(plano) && /\b(?:viene|vienen|venir|llega|turno|cita|quedo|toca)\b/u.test(plano) && !/\b(?:puedo|podes|hay|tenes|atiende|atienden|disponib\w*)\b/u.test(plano)) return 'horario'
  if (/\b(?:como (?:va|viene|sigue|quedo)|en que (?:quedo|estado esta)|que paso con|novedades (?:de|del|sobre)|alguna novedad)\b.*\b(?:turno|reserva|cita|lo del|la del|el de)\b/u.test(plano) || /^(?:y )?(?:el|mi) turno\s*$/u.test(plano)) return 'estado'
  return null
}

export interface TurnoReal {
  id: string
  providerName: string
  service: string | null
  startsAt: string
  status: string
  statusLabel: string
}

// What the conversation and the memory know, strongest first: the request under way, the recent
// messages, then the summary and the memories of the account.
export interface PistasReferencia {
  fuertes: string[]
  recientes: string[]
  memoria: string[]
}

const VIVOS = new Set(['pending', 'awaiting_payment', 'confirmed'])
const plano = (text: string): string => sinAcentos(text.toLowerCase())

// Which of the person's turnos is meant. One live turno: that one. Several: the one the hints
// point at, when they point at exactly one. Otherwise it is ambiguous and the person chooses.
export function elegirTurnoReferido(turnos: readonly TurnoReal[], pistas: PistasReferencia, now: number): { elegido: TurnoReal | null; candidatos: TurnoReal[] } {
  const proximos = turnos.filter((turno) => Date.parse(turno.startsAt) > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const vivos = proximos.filter((turno) => VIVOS.has(turno.status))
  // A turno that was answered "no" or cancelled is still what "¿ya aceptó?" may be about, when
  // nothing live is left.
  const candidatos = vivos.length > 0 ? vivos : proximos
  if (candidatos.length <= 1) return { elegido: candidatos[0] ?? null, candidatos }
  const puntaje = (turno: TurnoReal): number => {
    const nombre = plano(turno.providerName).split(' ')[0] ?? ''
    const servicio = turno.service ? plano(turno.service) : ''
    const aparece = (textos: string[], peso: number) => (textos.some((texto) => (nombre.length >= 3 && plano(texto).includes(nombre)) || (servicio.length >= 4 && plano(texto).includes(servicio))) ? peso : 0)
    return aparece(pistas.fuertes, 4) + aparece(pistas.recientes, 2) + aparece(pistas.memoria, 1)
  }
  const puntuados = candidatos.map((turno) => ({ turno, puntos: puntaje(turno) })).sort((a, b) => b.puntos - a.puntos)
  const mejor = puntuados[0]!
  return { elegido: mejor.puntos > 0 && mejor.puntos > (puntuados[1]?.puntos ?? 0) ? mejor.turno : null, candidatos }
}

const cuando = (turno: TurnoReal, now: number): string => `${describirDia(diaLocal(turno.startsAt), null, now)} a las ${horaLocal(turno.startsAt)}`
const deQue = (turno: TurnoReal): string => `${turno.service ? `de ${turno.service} ` : ''}con ${turno.providerName}`

const SIGUIENTE: Record<string, string> = {
  pending: 'Todavía no respondió tu solicitud. Te aviso apenas lo haga.',
  awaiting_payment: 'Ya aceptó tu solicitud. Falta pagar la seña para que el turno quede confirmado.',
  confirmed: 'Ya está confirmado.',
  rejected: 'No pudo aceptar ese turno. Si querés, te busco otra persona para el mismo servicio.',
  cancelled: 'Ese turno está cancelado.',
  'cancelled-late': 'Ese turno está cancelado.',
  expired: 'La solicitud venció sin respuesta. Si querés, la pedimos de nuevo o busco otra persona.',
  completed: 'Ese turno ya se realizó.',
}

// The answer, written by the backend from the REAL turno. Every value comes from `turno`.
export function responderEstadoDeTurno(consulta: ConsultaOperativa, turno: TurnoReal, now: number): string {
  const base = `Tu turno ${deQue(turno)} es ${cuando(turno, now)}.`
  const estado = SIGUIENTE[turno.status] ?? `Estado: ${turno.statusLabel}.`
  if (consulta === 'horario') return turno.status === 'confirmed' ? base : `${base} ${estado}`
  if (consulta === 'aceptacion') return `${estado} ${base}`
  return `${base} ${estado}`
}

export function preguntarCualTurno(candidatos: readonly TurnoReal[], now: number): string {
  return `¿De cuál turno? ${candidatos.slice(0, 5).map((turno, indice) => `${indice + 1}. ${turno.service ? `${turno.service} ` : ''}con ${turno.providerName}, ${cuando(turno, now)} (${turno.statusLabel})`).join(' · ')}`
}

export const SIN_TURNOS_PROPIOS = 'No encontré turnos tuyos pendientes ni próximos.'
