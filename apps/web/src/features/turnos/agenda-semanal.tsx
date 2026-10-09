'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { DIAS_AGENDA, DIAS_SEMANA, MAXIMO_DIAS_ADELANTE_AGENDA, lunesDe, sumarDias, type AgendaSemanal as Agenda, type DiaAgenda, type FranjaAgenda, type TurnoDeFranja } from '@factory/contracts'

import { hoyArgentina, turnosApi } from '../../lib/tus-turnos-client'
import styles from './agenda.module.css'

// Whose agenda: the public one of a provider (booking) or the own one (provider preview).
// TURNOS-REPROGRAMACION-01: the times one turno of the client can be moved to (the same agenda,
// as the API filters it for that turno).
export type OrigenAgenda = { tipo: 'publica'; prestadorId: string; oficioId: string; tarifaId?: string } | { tipo: 'propia'; oficioId: string } | { tipo: 'reprogramacion'; turnoId: string }

// AGENDA-MATRIZ-01: how the provider reads the turno that occupies a time of its own agenda.
const ESTADO_TURNO_FRANJA: Record<string, string> = { pending: 'Pendiente', awaiting_payment: 'Esperando pago', confirmed: 'Confirmado', completed: 'Finalizado' }
export const etiquetaTurnoDeFranja = (turno: TurnoDeFranja): string => `${ESTADO_TURNO_FRANJA[turno.estado] ?? 'Ocupado'}${turno.origen === 'manual' ? ' · Manual' : ''}`

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const numero = (fecha: string) => Number(fecha.slice(8, 10))
const mes = (fecha: string) => MESES[Number(fecha.slice(5, 7)) - 1]!
const diaLargo = (dia: DiaAgenda) => `${DIAS_SEMANA[dia.diaSemana]} ${numero(dia.fecha)} de ${mes(dia.fecha)}`
const tituloSemana = (desde: string, hasta: string) =>
  desde.slice(0, 7) === hasta.slice(0, 7) ? `${numero(desde)} al ${numero(hasta)} de ${mes(hasta)}` : `${numero(desde)} de ${mes(desde)} al ${numero(hasta)} de ${mes(hasta)}`

const ESTADO_DIA: Record<DiaAgenda['estado'], string> = { laboral: '', no_laboral: 'No trabaja', bloqueado: 'No disponible', pasado: 'Ya pasó' }
const ESTADO_FRANJA: Record<FranjaAgenda['estado'], string> = { disponible: 'Disponible', ocupado: 'Ocupado', bloqueado: 'No disponible', pasado: '—' }

const libres = (dia: DiaAgenda) => dia.franjas.filter((franja) => franja.estado === 'disponible').length
// Merge display records returned by the own agenda, not availability calculated on the Web.
// Actual appointments can start outside the sequence of the selected service or on a past day.
const franjasVisibles = (dia: DiaAgenda): FranjaAgenda[] => {
  const porHora = new Map(dia.franjas.map((franja) => [franja.hora, franja]))
  for (const turno of dia.turnos ?? []) porHora.set(turno.hora, turno)
  return [...porHora.values()].sort((a, b) => a.hora.localeCompare(b.hora))
}

// Weekly agenda of turnos. Wide: days across, hours down. Narrow: one day at a time. Every time
// and its state come from the API; this component never builds one.
export function AgendaSemanal({
  origen,
  version = 0,
  seleccion = null,
  onSeleccion,
  onAgenda,
  onTurno,
  soloLectura = false,
  semanaInicial,
}: {
  origen: OrigenAgenda
  // Bump to ask the API again (after a booking, a 409, or a change of the weekly availability).
  version?: number
  // Start (ISO) of the chosen turno.
  seleccion?: string | null
  onSeleccion?: (franja: FranjaAgenda | null) => void
  onAgenda?: (agenda: Agenda) => void
  // AGENDA-MATRIZ-01 (own agenda): a time occupied by a turno was tapped.
  onTurno?: (turno: TurnoDeFranja, franja: FranjaAgenda) => void
  soloLectura?: boolean
  // Week to open on (any date of it), e.g. the one of a time the person had chosen before signing in.
  semanaInicial?: string
}): React.ReactNode {
  const semanaActual = lunesDe(hoyArgentina())
  const [desde, setDesde] = useState(() => (semanaInicial && lunesDe(semanaInicial) > semanaActual ? lunesDe(semanaInicial) : semanaActual))
  const [agenda, setAgenda] = useState<Agenda | null>(null)
  const [agendaKey, setAgendaKey] = useState('')
  const [estado, setEstado] = useState<'cargando' | 'lista' | 'error'>('cargando')
  const [error, setError] = useState('')
  const [activo, setActivo] = useState('')
  // On the first load only: a week with nothing left to book (a Friday evening) opens the next one.
  const avanzar = useRef(true)
  const avisar = useRef({ onAgenda, onSeleccion })
  avisar.current = { onAgenda, onSeleccion }

  const tarifaId = origen.tipo === 'publica' ? origen.tarifaId : undefined
  const prestadorId = origen.tipo === 'publica' ? origen.prestadorId : ''
  const oficioId = origen.tipo === 'reprogramacion' ? '' : origen.oficioId
  const turnoId = origen.tipo === 'reprogramacion' ? origen.turnoId : ''
  const pedidoKey = JSON.stringify([origen.tipo, prestadorId, oficioId, turnoId, tarifaId, desde, version])
  useEffect(() => {
    if (!oficioId && !turnoId) return
    let vigente = true
    setEstado('cargando')
    const pedido: Promise<Agenda> =
      origen.tipo === 'reprogramacion'
        ? turnosApi.horariosReprogramacion(turnoId, desde).then((semana) => ({ ...semana, tarifas: [] }))
        : origen.tipo === 'publica'
          ? turnosApi.agendaPublica(prestadorId, oficioId, desde, tarifaId)
          : turnosApi.miAgenda(oficioId, desde)
    pedido
      .then((resultado) => {
        if (!vigente) return
        const hayLibres = resultado.dias.some((dia) => libres(dia) > 0)
        if (origen.tipo !== 'propia' && avanzar.current && !hayLibres && resultado.dias.length > 0 && desde === semanaActual) {
          avanzar.current = false
          setDesde(sumarDias(desde, DIAS_AGENDA))
          return
        }
        avanzar.current = false
        setAgenda(resultado)
        setAgendaKey(pedidoKey)
        setEstado('lista')
        setActivo((actual) => {
          const mismo = resultado.dias.find((dia) => dia.fecha === actual)
          if (mismo) return actual
          return (resultado.dias.find((dia) => libres(dia) > 0) ?? resultado.dias.find((dia) => dia.estado === 'laboral') ?? resultado.dias[0])?.fecha ?? ''
        })
        avisar.current.onAgenda?.(resultado)
      })
      .catch((causa: unknown) => {
        if (!vigente) return
        setEstado('error')
        setError(causa instanceof Error ? causa.message : 'No pudimos consultar la agenda.')
      })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the origin is compared by its fields
  }, [origen.tipo, prestadorId, oficioId, turnoId, tarifaId, desde, version, pedidoKey])

  // A chosen time that is no longer available (taken meanwhile, another week) is dropped.
  useEffect(() => {
    if (!agenda || agendaKey !== pedidoKey || !seleccion) return
    const sigue = agenda.dias.some((dia) => dia.franjas.some((franja) => franja.inicio === seleccion && franja.estado === 'disponible'))
    if (!sigue) avisar.current.onSeleccion?.(null)
  }, [agenda, agendaKey, pedidoKey, seleccion])

  const horas = useMemo(() => [...new Set((agenda?.dias ?? []).flatMap((dia) => franjasVisibles(dia).map((franja) => franja.hora)))].sort(), [agenda])
  // The agenda on screen is the one of the week in the title. While another week is on its way,
  // the previous one is not shown (its times would be under the wrong dates and still clickable).
  const vigente = agenda !== null && agendaKey === pedidoKey ? agenda : null
  const dias = vigente?.dias ?? []
  const diaActivo = dias.find((dia) => dia.fecha === activo) ?? dias[0]
  const hayAnterior = desde > semanaActual
  const haySiguiente = sumarDias(desde, DIAS_AGENDA) <= sumarDias(hoyArgentina(), MAXIMO_DIAS_ADELANTE_AGENDA)
  const cambiarSemana = (delta: number) => {
    avanzar.current = false
    setDesde((actual) => sumarDias(actual, delta * DIAS_AGENDA))
  }

  function franja(dia: DiaAgenda, item: FranjaAgenda, clase: string, compacta: boolean) {
    const elegida = item.inicio === seleccion
    const texto = compacta ? (elegida ? 'Elegido' : ESTADO_FRANJA[item.estado]) : item.hora
    const detalle = !compacta && item.estado !== 'disponible' && item.estado !== 'pasado' ? <small>{ESTADO_FRANJA[item.estado]}</small> : null
    if (item.estado === 'disponible' && !soloLectura)
      return (
        <button
          aria-label={`${diaLargo(dia)}, ${item.hora}, ${elegida ? 'elegido' : 'disponible'}`}
          aria-pressed={elegida}
          className={clase}
          data-estado="disponible"
          data-inicio={item.inicio}
          onClick={() => onSeleccion?.(elegida ? null : item)}
          type="button"
        >
          <span>{texto}</span>
        </button>
      )
    // AGENDA-MATRIZ-01: in the provider's own agenda an occupied time says which turno it is,
    // and opens it.
    if (item.turno) {
      const etiqueta = etiquetaTurnoDeFranja(item.turno)
      const contenido = (
        <>
          <span>{compacta ? etiqueta : item.hora}</span>
          {compacta ? null : <small>{etiqueta}</small>}
          {item.turno.cliente ? <small>{item.turno.cliente}</small> : null}
        </>
      )
      return onTurno ? (
        <button aria-label={`${diaLargo(dia)}, ${item.hora}, ${etiqueta}${item.turno.cliente ? `, ${item.turno.cliente}` : ''}. Ver detalle`} className={clase} data-estado={item.estado} data-estado-turno={item.turno.estado} data-origen-turno={item.turno.origen} data-turno={item.turno.id} onClick={() => onTurno(item.turno!, item)} type="button">
          {contenido}
        </button>
      ) : (
        <span className={clase} data-estado={item.estado} data-estado-turno={item.turno.estado} data-origen-turno={item.turno.origen}>
          {contenido}
        </span>
      )
    }
    return (
      <span className={clase} data-estado={item.estado}>
        <span>{texto}</span>
        {detalle}
        {compacta ? <span className={styles.srOnly}>{`, ${item.hora}`}</span> : null}
      </span>
    )
  }
  const conTurnos = origen.tipo === 'propia'

  return (
    <div aria-busy={estado === 'cargando'} className={styles.agenda} data-agenda={estado === 'lista' && !vigente ? 'cargando' : estado}>
      <div className={styles.nav}>
        <button aria-label="Semana anterior" className={styles.navButton} disabled={!hayAnterior} onClick={() => cambiarSemana(-1)} type="button">
          <span aria-hidden="true">‹</span>
          <span className={styles.navLabel}>Semana anterior</span>
        </button>
        <p aria-live="polite" className={styles.navTitle} data-semana={desde}>
          {tituloSemana(desde, sumarDias(desde, DIAS_AGENDA - 1))}
        </p>
        <button aria-label="Semana siguiente" className={styles.navButton} disabled={!haySiguiente} onClick={() => cambiarSemana(1)} type="button">
          <span className={styles.navLabel}>Semana siguiente</span>
          <span aria-hidden="true">›</span>
        </button>
      </div>

      {estado === 'error' ? (
        <p className={`${styles.status} ${styles.statusError}`} role="alert">
          {error}
        </p>
      ) : !vigente ? (
        <p className={styles.status} role="status">
          Consultando la agenda…
        </p>
      ) : vigente.mensaje ? (
        <p className={styles.status}>{vigente.mensaje}</p>
      ) : (
        <>
          {/* Narrow: the seven days fit as tabs; the times of the chosen day go below. */}
          <div aria-label="Días de la semana" className={styles.dayTabs} role="group">
            {dias.map((dia) => (
              <button
                aria-label={`${diaLargo(dia)}${libres(dia) > 0 ? `, ${libres(dia)} ${libres(dia) === 1 ? 'horario disponible' : 'horarios disponibles'}` : `, ${ESTADO_DIA[dia.estado] || 'sin horarios disponibles'}`}`}
                aria-pressed={dia.fecha === diaActivo?.fecha}
                className={styles.dayTab}
                data-libre={libres(dia) > 0}
                key={dia.fecha}
                onClick={() => setActivo(dia.fecha)}
                type="button"
              >
                <span className={styles.dayTabName}>{CORTOS[dia.diaSemana]}</span>
                <span className={styles.dayTabDate}>{numero(dia.fecha)}</span>
              </button>
            ))}
          </div>
          {diaActivo ? (
            <div className={styles.dayPanel}>
              <p className={styles.dayHeading}>{diaLargo(diaActivo)}</p>
              {franjasVisibles(diaActivo).length === 0 || (diaActivo.estado !== 'laboral' && !franjasVisibles(diaActivo).some((item) => item.turno)) ? (
                <p className={styles.status}>{diaActivo.estado === 'laboral' ? 'No hay horarios para este servicio ese día.' : diaActivo.estado === 'no_laboral' ? 'No trabaja este día.' : diaActivo.estado === 'bloqueado' ? 'No disponible este día.' : 'Este día ya pasó.'}</p>
              ) : (
                <ul className={styles.times}>
                  {franjasVisibles(diaActivo).map((item) => (
                    <li key={item.inicio}>{franja(diaActivo, item, styles.time, false)}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {/* Wide: days across, hours down. */}
          <div className={styles.gridWrap}>
            <table className={styles.grid}>
              <caption className={styles.srOnly}>{`Agenda de la semana del ${tituloSemana(vigente.desde, vigente.hasta)}`}</caption>
              <thead>
                <tr>
                  <th className={styles.hourCol} scope="col">
                    Horario
                  </th>
                  {dias.map((dia) => (
                    <th data-estado={dia.estado} key={dia.fecha} scope="col">
                      {`${CORTOS[dia.diaSemana]} ${numero(dia.fecha)}`}
                      {ESTADO_DIA[dia.estado] ? <span>{ESTADO_DIA[dia.estado]}</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {horas.length === 0 ? (
                  <tr>
                    <td colSpan={dias.length + 1}>
                      <p className={styles.status}>No hay horarios para este servicio en esta semana.</p>
                    </td>
                  </tr>
                ) : (
                  horas.map((hora) => (
                    <tr key={hora}>
                      <th scope="row">{hora}</th>
                      {dias.map((dia) => {
                        const item = franjasVisibles(dia).find((candidata) => candidata.hora === hora)
                        return (
                          <td data-dia={dia.estado} key={dia.fecha}>
                            {item && (item.estado !== 'pasado' || item.turno) ? (
                              franja(dia, item, styles.cell, true)
                            ) : (
                              <span aria-hidden="true" className={styles.empty}>
                                —
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <ul aria-label="Referencias" className={styles.legend}>
            <li>
              <span aria-hidden="true" className={styles.swatch} />
              Disponible
            </li>
            {soloLectura ? null : (
              <li>
                <span aria-hidden="true" className={styles.swatch} data-muestra="elegido" />
                Elegido
              </li>
            )}
            <li>
              <span aria-hidden="true" className={styles.swatch} data-muestra="ocupado" />
              Ocupado
            </li>
            <li>
              <span aria-hidden="true" className={styles.swatch} data-muestra="bloqueado" />
              Bloqueado
            </li>
            {conTurnos ? (
              <>
                <li>
                  <span aria-hidden="true" className={styles.swatch} data-muestra="pendiente" />
                  Pendiente
                </li>
                <li>
                  <span aria-hidden="true" className={styles.swatch} data-muestra="confirmado" />
                  Confirmado
                </li>
                <li>
                  <span aria-hidden="true" className={styles.swatch} data-muestra="finalizado" />
                  Finalizado
                </li>
              </>
            ) : null}
          </ul>
          {estado === 'cargando' ? (
            <p className={styles.srOnly} role="status">
              Actualizando la agenda…
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
