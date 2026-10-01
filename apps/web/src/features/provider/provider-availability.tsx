'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  DIAS_SEMANA,
  INTERVALOS_TURNO,
  INTERVALO_TURNO_PREDETERMINADO,
  etiquetaIntervalo,
  validarHorariosSemanales,
  type BloqueoAgendaDTO,
  type DisponibilidadSemanalDTO,
  type HorarioSemanalDTO,
  type ServicioTurnosDTO,
} from '@factory/contracts'

import ui from '../../components/admin/admin-usuarios.module.css'
import { fechaTurno, horaTurno, turnosApi } from '../../lib/tus-turnos-client'
import { AgendaSemanal } from '../turnos/agenda-semanal'
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
  personalizado: boolean
  intervalo: number
}

const RANGO_INICIAL: Rango = { horaInicio: '09:00', horaFin: '18:00' }

function aFormulario(disponibilidad: DisponibilidadSemanalDTO): DiaForm[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dia) => {
    const delDia = disponibilidad.horarios.filter((horario) => horario.diaSemana === dia)
    const propio = delDia[0]?.intervaloMinutos ?? null
    return {
      activo: delDia.length > 0,
      rangos: delDia.length > 0 ? delDia.map(({ horaInicio, horaFin }) => ({ horaInicio, horaFin })) : [{ ...RANGO_INICIAL }],
      personalizado: propio !== null,
      intervalo: propio ?? 30,
    }
  })
}

const aHorarios = (dias: DiaForm[]): HorarioSemanalDTO[] =>
  dias.flatMap((dia, diaSemana) => (dia.activo ? dia.rangos.map((rango) => ({ diaSemana, ...rango, intervaloMinutos: dia.personalizado ? dia.intervalo : null })) : []))

// Agenda of the provider. Top: the weekly availability it configures (general interval, days,
// hours, own interval of a day). Bottom: the agenda its clients see, computed by the API from
// that configuration, the taken turnos and the blocks. Times are never invented here.
export function ProviderAvailability({ servicios, version = 0 }: { servicios: ServicioTurnosDTO[]; version?: number }): React.ReactNode {
  const conTurnos = servicios.filter((servicio) => servicio.turnosHabilitados)
  const [oficioId, setOficioId] = useState('')
  const [general, setGeneral] = useState<number>(INTERVALO_TURNO_PREDETERMINADO)
  const [dias, setDias] = useState<DiaForm[] | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [bloqueos, setBloqueos] = useState<BloqueoAgendaDTO[]>([])
  const [avisoBloqueo, setAvisoBloqueo] = useState('')
  // Bumped after saving or removing a block: the agenda below is asked again.
  const [cambios, setCambios] = useState(0)

  useEffect(() => {
    if (!oficioId && conTurnos[0]) setOficioId(conTurnos[0].oficioId)
  }, [conTurnos, oficioId])

  useEffect(() => {
    void turnosApi
      .miDisponibilidadSemanal()
      .then((disponibilidad) => {
        setGeneral(disponibilidad.intervaloGeneral)
        setDias(aFormulario(disponibilidad))
      })
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
      const guardada = await turnosApi.guardarMiDisponibilidadSemanal({ intervaloGeneral: general, horarios: validado.valor })
      setGeneral(guardada.intervaloGeneral)
      setDias(aFormulario(guardada))
      setAviso({ kind: 'ok', text: 'Guardamos tu disponibilidad. La agenda ya refleja el cambio; los turnos ya reservados no cambian.' })
      setCambios((value) => value + 1)
    } catch (error) {
      setAviso({ kind: 'error', text: error instanceof Error ? error.message : 'No pudimos guardar tu disponibilidad.' })
    } finally {
      setGuardando(false)
    }
  }

  async function quitarBloqueo(id: string) {
    setAvisoBloqueo('')
    try {
      await turnosApi.quitarBloqueo(id)
      cargarBloqueos()
      setCambios((value) => value + 1)
    } catch (error) {
      setAvisoBloqueo(error instanceof Error ? error.message : 'No pudimos quitar el bloqueo.')
    }
  }

  // An agenda saved with an interval outside the list (older data) still shows its real value.
  const opciones = (actual: number) => (INTERVALOS_TURNO as readonly number[]).includes(actual) ? [...INTERVALOS_TURNO] : [actual, ...INTERVALOS_TURNO]

  return (
    <>
      <section aria-labelledby="disponibilidad-semanal-titulo" className={ui.panel}>
        <h2 id="disponibilidad-semanal-titulo">Disponibilidad semanal</h2>
        <p className={ui.muted}>Elegí qué días trabajás, en qué horario y cada cuánto puede empezar un turno. La duración de cada turno es la del servicio.</p>
        {dias === null ? (
          aviso ? null : (
            <p className={ui.muted} role="status">
              Cargando tu disponibilidad…
            </p>
          )
        ) : (
          <div className={styles.config}>
            <div className={styles.general}>
              <label htmlFor="intervalo-general">Intervalo general</label>
              <select
                className={styles.control}
                id="intervalo-general"
                onChange={(event) => {
                  setGeneral(Number(event.target.value))
                  setAviso(null)
                }}
                value={general}
              >
                {opciones(general).map((minutos) => (
                  <option key={minutos} value={minutos}>
                    {etiquetaIntervalo(minutos)}
                  </option>
                ))}
              </select>
              <p className={styles.hint}>Se usa en todos los días, salvo en los que personalices.</p>
            </div>

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
                        <fieldset className={styles.interval}>
                          <legend className={styles.srOnly}>{`Intervalo del ${nombre}`}</legend>
                          <label className={styles.choice}>
                            <input checked={!item.personalizado} name={`intervalo-${dia}`} onChange={() => cambiarDia(dia, { personalizado: false })} type="radio" />
                            Usar intervalo general ({etiquetaIntervalo(general)})
                          </label>
                          <label className={styles.choice}>
                            <input checked={item.personalizado} name={`intervalo-${dia}`} onChange={() => cambiarDia(dia, { personalizado: true })} type="radio" />
                            Personalizar
                          </label>
                          {item.personalizado ? (
                            <span className={styles.choice}>
                              <select aria-label={`Intervalo del ${nombre}`} className={styles.control} onChange={(event) => cambiarDia(dia, { intervalo: Number(event.target.value) })} value={item.intervalo}>
                                {opciones(item.intervalo).map((minutos) => (
                                  <option key={minutos} value={minutos}>
                                    {etiquetaIntervalo(minutos)}
                                  </option>
                                ))}
                              </select>
                            </span>
                          ) : null}
                        </fieldset>
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

      <section aria-labelledby="agenda-titulo" className={ui.panel}>
        <h2 id="agenda-titulo">Tu agenda</h2>
        <p className={ui.muted}>Así ven tus clientes los horarios: tu disponibilidad semanal, menos los turnos tomados y los bloqueos.</p>
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
            {oficioId ? <AgendaSemanal origen={{ tipo: 'propia', oficioId }} soloLectura version={cambios + version} /> : null}
          </>
        )}
        {bloqueos.length > 0 ? (
          <div>
            <h3 style={{ fontSize: '0.95rem', margin: '4px 0 8px' }}>Bloqueos y días sin atención</h3>
            <ul className={styles.blocks}>
              {bloqueos.map((bloqueo) => (
                <li key={bloqueo.id}>
                  <span>
                    <strong>{bloqueo.motivo}</strong> · {fechaTurno(bloqueo.inicio)} {horaTurno(bloqueo.inicio)} a {fechaTurno(bloqueo.fin)} {horaTurno(bloqueo.fin)}
                  </span>
                  <button className={styles.textButton} onClick={() => void quitarBloqueo(bloqueo.id)} type="button">
                    Quitar<span className={styles.srOnly}>{` bloqueo ${bloqueo.motivo}`}</span>
                  </button>
                </li>
              ))}
            </ul>
            {avisoBloqueo ? (
              <p className={ui.alertError} role="alert">
                {avisoBloqueo}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  )
}
