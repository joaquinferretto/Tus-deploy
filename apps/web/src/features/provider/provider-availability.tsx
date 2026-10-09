'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  DIAS_SEMANA,
  validarHorariosSemanales,
  type BloqueoAgendaDTO,
  type HorarioSemanalDTO,
  type ServicioTurnosDTO,
} from '@factory/contracts'

import ui from '../../components/admin/admin-usuarios.module.css'
import type { FranjaAgenda, TurnoDeFranja } from '@factory/contracts'
import { turnosApi } from '../../lib/tus-turnos-client'
import { AgendaSemanal } from '../turnos/agenda-semanal'
import { ProviderAusencias } from './provider-ausencias'
import styles from '../turnos/agenda.module.css'

// Monday first, Sunday last (the API uses 0 = Sunday).
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]

interface Rango {
  horaInicio: string
  horaFin: string
}

// One day of the form. A day that is switched off keeps what was typed, so switching it on again
// restores it; only the active days are sent.
interface DiaForm {
  activo: boolean
  rangos: Rango[]
}

const RANGO_INICIAL: Rango = { horaInicio: '09:00', horaFin: '18:00' }

function aFormulario(horarios: HorarioSemanalDTO[]): DiaForm[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dia) => {
    const delDia = horarios.filter((horario) => horario.diaSemana === dia)
    return {
      activo: delDia.length > 0,
      rangos: delDia.length > 0 ? delDia.map(({ horaInicio, horaFin }) => ({ horaInicio, horaFin })) : [{ ...RANGO_INICIAL }],
    }
  })
}

const aHorarios = (dias: DiaForm[]): HorarioSemanalDTO[] =>
  dias.flatMap((dia, diaSemana) => (dia.activo ? dia.rangos.map((rango) => ({ diaSemana, ...rango })) : []))

// Agenda of the provider. Top: the weekly availability it configures (days and hours: WHEN it
// works). Bottom: the agenda its clients see, computed by the API from that configuration, the
// duration of the service (one turno after another, from the opening time), the taken turnos and
// the blocks. Times are never invented here, and there is no interval to choose: how often a
// turno starts is how long the service lasts.
// AGENDA-MATRIZ-01: `onLibre` (a free time was tapped: load a manual turno there) and `onTurno`
// (an occupied one: open its detail) make the agenda of the provider interactive.
export function ProviderAvailability({ servicios, version = 0, onLibre, onTurno }: { servicios: ServicioTurnosDTO[]; version?: number; onLibre?: (franja: FranjaAgenda, oficioId: string) => void; onTurno?: (turno: TurnoDeFranja, franja: FranjaAgenda) => void }): React.ReactNode {
  const conTurnos = servicios.filter((servicio) => servicio.turnosHabilitados)
  const [oficioId, setOficioId] = useState('')
  const [dias, setDias] = useState<DiaForm[] | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [bloqueos, setBloqueos] = useState<BloqueoAgendaDTO[]>([])
  // Bumped after saving or removing a block: the agenda below is asked again.
  const [cambios, setCambios] = useState(0)

  useEffect(() => {
    if (!oficioId && conTurnos[0]) setOficioId(conTurnos[0].oficioId)
  }, [conTurnos, oficioId])

  useEffect(() => {
    void turnosApi
      .miDisponibilidadSemanal()
      .then((horarios) => setDias(aFormulario(horarios)))
      .catch(() => setAviso({ kind: 'error', text: 'No pudimos cargar tu disponibilidad. Recargá la página.' }))
  }, [])

  const cargarBloqueos = useCallback(() => {
    void turnosApi
      .misBloqueos()
      .then(setBloqueos)
      .catch(() => setBloqueos([]))
  }, [])
  useEffect(cargarBloqueos, [cargarBloqueos, version])

  const cambiarDia = (dia: number, patch: Partial<DiaForm>) => {
    setDias((actual) => (actual ?? []).map((item, index) => (index === dia ? { ...item, ...patch } : item)))
    setAviso(null)
  }
  const cambiarRango = (dia: number, posicion: number, patch: Partial<Rango>) =>
    cambiarDia(dia, { rangos: (dias?.[dia]?.rangos ?? []).map((rango, index) => (index === posicion ? { ...rango, ...patch } : rango)) })

  async function guardar() {
    if (!dias) return
    const validado = validarHorariosSemanales(aHorarios(dias))
    if (!validado.ok) {
      setAviso({
        kind: 'error',
        text:
          validado.motivo === 'solapados'
            ? 'Hay dos horarios que se superponen en el mismo día.'
            : validado.motivo === 'rango'
              ? 'En cada día, la hora "Desde" tiene que ser anterior a la hora "Hasta".'
              : 'Revisá los horarios cargados.',
      })
      return
    }
    setGuardando(true)
    try {
      setDias(aFormulario(await turnosApi.guardarMiDisponibilidadSemanal(validado.valor)))
      setAviso({ kind: 'ok', text: 'Guardamos tu disponibilidad. La agenda ya refleja el cambio; los turnos ya reservados no cambian.' })
      setCambios((value) => value + 1)
    } catch (error) {
      setAviso({ kind: 'error', text: error instanceof Error ? error.message : 'No pudimos guardar tu disponibilidad.' })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <section aria-labelledby="disponibilidad-semanal-titulo" className={ui.panel}>
        <h2 id="disponibilidad-semanal-titulo">Disponibilidad semanal</h2>
        <p className={ui.muted}>Elegí qué días trabajás y en qué horario. Los turnos se ofrecen uno detrás de otro desde tu hora de inicio, según lo que dura cada servicio.</p>
        {dias === null ? (
          aviso ? null : (
            <p className={ui.muted} role="status">
              Cargando tu disponibilidad…
            </p>
          )
        ) : (
          <div className={styles.config}>
            <ul className={styles.days}>
              {ORDEN_DIAS.map((dia) => {
                const item = dias[dia]!
                const nombre = DIAS_SEMANA[dia]
                return (
                  <li className={styles.day} data-activo={item.activo} data-dia={dia} key={dia}>
                    <label className={styles.dayToggle}>
                      <input checked={item.activo} onChange={(event) => cambiarDia(dia, { activo: event.target.checked })} type="checkbox" />
                      <span>
                        {nombre}
                        <small>{item.activo ? 'Trabaja' : 'No trabaja'}</small>
                      </span>
                    </label>
                    {item.activo ? (
                      <div className={styles.dayBody}>
                        {item.rangos.map((rango, posicion) => (
                          <div className={styles.range} key={posicion}>
                            <label>
                              Desde
                              <input
                                aria-label={`${nombre}: desde`}
                                className={styles.control}
                                onChange={(event) => cambiarRango(dia, posicion, { horaInicio: event.target.value })}
                                step={900}
                                type="time"
                                value={rango.horaInicio}
                              />
                            </label>
                            <label>
                              Hasta
                              <input
                                aria-label={`${nombre}: hasta`}
                                className={styles.control}
                                onChange={(event) => cambiarRango(dia, posicion, { horaFin: event.target.value })}
                                step={900}
                                type="time"
                                value={rango.horaFin}
                              />
                            </label>
                            {posicion > 0 ? (
                              <button className={styles.textButton} onClick={() => cambiarDia(dia, { rangos: item.rangos.filter((_, index) => index !== posicion) })} type="button">
                                Quitar<span className={styles.srOnly}>{` horario del ${nombre}`}</span>
                              </button>
                            ) : item.rangos.length === 1 ? (
                              <button className={styles.textButton} onClick={() => cambiarDia(dia, { rangos: [...item.rangos, { horaInicio: rango.horaFin < '20:00' ? rango.horaFin : '20:00', horaFin: '22:00' }] })} type="button">
                                + Horario cortado<span className={styles.srOnly}>{` el ${nombre}`}</span>
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.dayOff}>No se ofrecen turnos este día.</p>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {aviso ? (
          <p className={aviso.kind === 'ok' ? ui.alertOk : ui.alertError} role={aviso.kind === 'ok' ? 'status' : 'alert'} style={{ marginBottom: 0 }}>
            {aviso.text}
          </p>
        ) : null}
        <div className={ui.actions}>
          <button className={ui.buttonPrimary} disabled={guardando || dias === null} onClick={() => void guardar()} type="button">
            {guardando ? 'Guardando…' : 'Guardar disponibilidad'}
          </button>
        </div>
      </section>

      <ProviderAusencias
        bloqueos={bloqueos}
        onCambio={() => {
          cargarBloqueos()
          setCambios((value) => value + 1)
        }}
      />

      <section aria-labelledby="agenda-titulo" className={ui.panel}>
        <h2 id="agenda-titulo">Tu agenda</h2>
        <p className={ui.muted}>Así ven tus clientes los horarios: tu disponibilidad semanal, menos los turnos tomados y tus ausencias.</p>
        {conTurnos.length === 0 ? (
          <p className={ui.alertWarn}>Todavía no tenés servicios con turnos habilitados.</p>
        ) : (
          <>
            <label className={ui.field} style={{ maxWidth: 360 }}>
              <span>Servicio</span>
              <select onChange={(event) => setOficioId(event.target.value)} value={oficioId}>
                {conTurnos.map((servicio) => (
                  <option key={servicio.oficioId} value={servicio.oficioId}>
                    {servicio.nombre} · {servicio.duracionMinutos} min
                  </option>
                ))}
              </select>
            </label>
            {oficioId ? <AgendaSemanal onSeleccion={(franja) => { if (franja) onLibre?.(franja, oficioId) }} onTurno={onTurno} origen={{ tipo: 'propia', oficioId }} soloLectura={!onLibre} version={cambios + version} /> : null}
            {onLibre ? <p data-agenda-ayuda style={{ color: '#6b7280', fontSize: '0.85rem', margin: '8px 0 0' }}>Tocá un horario libre para agregar un turno manual, o un turno para ver su detalle.</p> : null}
          </>
        )}
      </section>
    </>
  )
}
