import type { ModalidadTarifaAlojamiento } from '@factory/contracts'

// Price of a stay from the tarifas of a unit. Pure: no database, no clock. The ONLY place where a
// stay is priced (the hold that is stored and the price shown for chosen dates use it).
//
// - dias_semana: a tarifa applies only on its days. A stay by night is priced night by night,
//   each night with the tarifa of its day (a weekend tarifa and a weekday tarifa can coexist).
// - temporada: a tarifa with a season is NOT applied automatically. The model has the label but
//   no dates for a season, so there is nothing to decide with; it waits for dated seasons.

export interface TarifaCotizable {
  id: string
  modalidad: string
  duracionHoras: number | null
  precio: bigint | number
  moneda: string
  diasSemana?: number[] | null
  temporada?: string | null
  minimoEstadia: number
  maximoEstadia: number | null
}

export type Cotizacion =
  | {
      ok: true
      total: number
      moneda: string
      modalidad: ModalidadTarifaAlojamiento
      // Tarifa of the first night / of the start (the snapshot kept on the reservation).
      tarifaId: string
      precioPorUnidad: number
      cantidadPeriodos: number
      duracionHoras?: number
    }
  | { ok: false; motivo: 'sin_tarifa' | 'sin_tarifa_para_fecha' | 'estadia_minima' | 'estadia_maxima' | 'monedas_mixtas'; limite?: number }

const HORA = 3_600_000
const DIA = 24 * HORA
const TODOS_LOS_DIAS = [0, 1, 2, 3, 4, 5, 6]

// Day of the week (0 = Sunday) of an instant in Argentina (UTC-3, no daylight saving).
const diaSemana = (instante: number): number => new Date(instante - 3 * HORA).getUTCDay()
const dias = (tarifa: TarifaCotizable): number[] => (Array.isArray(tarifa.diasSemana) && tarifa.diasSemana.length > 0 ? tarifa.diasSemana : TODOS_LOS_DIAS)
const sinTemporada = (tarifa: TarifaCotizable): boolean => !tarifa.temporada || tarifa.temporada.trim() === ''

export function tarifasAplicables<T extends TarifaCotizable>(tarifas: T[]): T[] {
  return tarifas.filter(sinTemporada)
}

export function cotizarEstadia(tarifas: TarifaCotizable[], inicio: Date, fin: Date, preferencia: { tarifaId?: string | null; modalidad?: string | null } = {}): Cotizacion {
  const aplicables = tarifasAplicables(tarifas)
  const elegida = preferencia.tarifaId ? aplicables.find((tarifa) => tarifa.id === preferencia.tarifaId) : undefined
  const modalidad = (elegida?.modalidad ?? (preferencia.modalidad ? aplicables.find((tarifa) => tarifa.modalidad === preferencia.modalidad)?.modalidad : aplicables[0]?.modalidad)) as ModalidadTarifaAlojamiento | undefined
  if (!modalidad) return { ok: false, motivo: 'sin_tarifa' }
  const deModalidad = aplicables.filter((tarifa) => tarifa.modalidad === modalidad)

  // The tarifa of a day: the one the client chose when it applies that day; otherwise the most
  // specific one (fewest days), then the cheapest, then by id (always the same answer).
  const delDia = (instante: number): TarifaCotizable | undefined => {
    const dia = diaSemana(instante)
    const candidatas = deModalidad.filter((tarifa) => dias(tarifa).includes(dia))
    if (elegida && candidatas.includes(elegida)) return elegida
    return candidatas.sort((a, b) => dias(a).length - dias(b).length || Number(a.precio) - Number(b.precio) || a.id.localeCompare(b.id))[0]
  }

  const diffMs = fin.getTime() - inicio.getTime()
  const horas = Math.max(1, Math.round(diffMs / HORA))
  const noches = Math.max(1, Math.round(diffMs / DIA))
  const primera = delDia(inicio.getTime())
  if (!primera) return { ok: false, motivo: 'sin_tarifa_para_fecha' }
  const base = { moneda: primera.moneda, modalidad, tarifaId: primera.id, precioPorUnidad: Number(primera.precio) }

  if (modalidad === 'por_hora' || modalidad === 'bloque_horas') {
    const duracionHoras = primera.duracionHoras ?? 1
    const bloques = Math.ceil(horas / duracionHoras)
    return { ok: true, ...base, total: Number(primera.precio) * bloques, cantidadPeriodos: bloques, duracionHoras }
  }
  if (modalidad === 'semana') {
    const semanas = Math.ceil(noches / 7)
    return { ok: true, ...base, total: Number(primera.precio) * semanas, cantidadPeriodos: semanas }
  }

  // noche / dia: the stay limits are those of the tarifa of the first night.
  if (noches < primera.minimoEstadia) return { ok: false, motivo: 'estadia_minima', limite: primera.minimoEstadia }
  if (primera.maximoEstadia && noches > primera.maximoEstadia) return { ok: false, motivo: 'estadia_maxima', limite: primera.maximoEstadia }
  let total = 0
  for (let noche = 0; noche < noches; noche += 1) {
    const tarifa = delDia(inicio.getTime() + noche * DIA)
    if (!tarifa) return { ok: false, motivo: 'sin_tarifa_para_fecha' }
    if (tarifa.moneda !== primera.moneda) return { ok: false, motivo: 'monedas_mixtas' }
    total += Number(tarifa.precio)
  }
  return { ok: true, ...base, total, cantidadPeriodos: noches }
}

// Cheapest way to stay those dates among the modalities the unit offers (price shown in a search).
export function mejorCotizacion(tarifas: TarifaCotizable[], inicio: Date, fin: Date): Extract<Cotizacion, { ok: true }> | null {
  let mejor: Extract<Cotizacion, { ok: true }> | null = null
  for (const modalidad of new Set(tarifasAplicables(tarifas).map((tarifa) => tarifa.modalidad))) {
    const cotizacion = cotizarEstadia(tarifas, inicio, fin, { modalidad })
    if (cotizacion.ok && (!mejor || cotizacion.total < mejor.total)) mejor = cotizacion
  }
  return mejor
}
