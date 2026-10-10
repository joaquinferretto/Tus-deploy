'use client'

import layout from '../layout/layout.module.css'
import { FotosTurno } from './fotos-turno'
import type { Route } from 'next'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { CODIGO_CANCELACION_TARDIA, CODIGO_POLITICA_CANCELACION_REQUERIDA, MENSAJE_REPROGRAMACION_CERRADA, VERSION_POLITICA_CANCELACION, etiquetaEstadoTurno, textoConfirmacionReprogramacion, textoPoliticaCancelacion, etiquetaSenaTurno, formatearPesos, type DetalleTurno } from '@factory/contracts'

import styles from '../directory/directory.module.css'
import homeStyles from '../home/home.module.css'
import { useTusSession } from '../session/use-tus-session'
import { TurnosError, diaTurno, horaTurno, turnosApi } from '../../lib/tus-turnos-client'
import { AgendaSemanal } from './agenda-semanal'
import { claseEstadoTurno } from './estado-turno'

const RETURN_TO = '/mis-turnos'

const EXPLICACION: Record<string, string> = {
  pending: 'Solicitud enviada. Queda pendiente hasta que el prestador la acepte.',
  awaiting_payment: 'El prestador aceptó tu solicitud. Para confirmar definitivamente el turno tenés que abonar la seña.',
  rejected: 'El prestador no pudo tomar esta solicitud. Podés elegir otro horario u otro profesional.',
  expired: 'La solicitud venció: no fue respondida o la seña no se abonó a tiempo. Podés pedir otro horario.',
  cancelled: 'Este turno fue cancelado.',
}

// What the state means for THIS turno. "Confirmed" is said only for a confirmed turno: by its
// paid deposit, or by the acceptance when it had no deposit.
function explicacion(turno: DetalleTurno): string | null {
  const pagada = turno.sena?.estado === 'paid'
  const pago = turno.pago ?? null
  // PAGOS-MODALIDAD-01: what the backend says about the money, never computed here.
  if (turno.estado === 'awaiting_payment' && pago && pago.opciones.length > 0) return 'El prestador aceptó tu solicitud. Para confirmar el turno elegí cómo pagarlo: una seña ahora y el resto después del servicio, o el total de una vez.'
  if (turno.estado === 'confirmed' && pago?.modalidad === 'total') return 'El pago total fue aprobado. ¡Tu turno quedó confirmado!'
  if (turno.estado === 'completed' && pago) {
    if (pago.cierre?.observacionAbierta) return 'Reportaste un problema con este turno. TUS lo está revisando.'
    if (pago.proximo?.tramo === 'saldo') return 'El turno ya figura como realizado. Ya podés pagar el saldo.'
    if (pago.saldoPendiente === 0) return 'Turno realizado y pagado por completo.'
  }
  if (turno.estado === 'confirmed') return pagada ? 'El pago de la seña fue aprobado. ¡Tu turno quedó confirmado!' : 'El prestador aceptó tu solicitud: el turno está confirmado.'
  if (turno.estado === 'awaiting_payment' && turno.sena?.estado === 'unavailable') return 'El prestador aceptó tu solicitud, pero el pago online de la seña no está disponible en este momento. Probá más tarde.'
  if ((turno.estado === 'expired' || turno.estado === 'cancelled') && pagada) return 'Recibimos el pago de la seña cuando el turno ya no estaba vigente. TUS lo va a revisar para reintegrarlo.'
  return EXPLICACION[turno.estado] ?? null
}

const venceEl = (iso: string): string => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })

// Turnos of the signed-in person: the requests waiting for the provider, the confirmed ones and
// the history. The state shown is the one the API holds; this page never decides it.
export function MisTurnosPage(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const [turnos, setTurnos] = useState<DetalleTurno[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<string | null>(null)
  const [pagando, setPagando] = useState<string | null>(null)
  // The way of paying chosen for each turno that still offers both (the deposit by default).
  const [eleccion, setEleccion] = useState<Record<string, 'sena' | 'total'>>({})
  // The closing of a finished turno: confirming it, or reporting a problem (its text per turno).
  const [cerrando, setCerrando] = useState<string | null>(null)
  const [problema, setProblema] = useState<Record<string, string>>({})
  const [reportando, setReportando] = useState<string | null>(null)
  // Back from Mercado Pago. The return never confirms anything: the turno is confirmed only when
  // TUS receives the verified notification, so the list is read again a few times.
  const [retornoPago, setRetornoPago] = useState(false)
  // TURNOS-CANCELACION-01: the two explicit confirmations. Both are asked by the API (it refuses
  // the payment without the accepted policy, and a late cancellation without the confirmed loss);
  // this only shows them and sends the answer back.
  const [politica, setPolitica] = useState<{ id: string; tramo: 'sena' | 'total' } | null>(null)
  const [perdida, setPerdida] = useState<{ id: string; mensaje: string } | null>(null)
  // TURNOS-REPROGRAMACION-01: the turno being moved, the week of free times the API returned for
  // it and the time chosen (confirmed before the change). Whether a turno can be moved, which
  // times are free and the 24 hours are the API's: nothing of that is decided here.
  const [moviendo, setMoviendo] = useState<{ id: string; elegido: string | null; version: number } | null>(null)
  const [guardandoCambio, setGuardandoCambio] = useState(false)
  async function confirmarCambio(turno: DetalleTurno, inicio: string) {
    if (guardandoCambio) return
    setGuardandoCambio(true)
    setError(null)
    try {
      await turnosApi.reprogramarTurno(turno.id, inicio)
      setMoviendo(null)
      cargar()
    } catch (causa: unknown) {
      setError(causa instanceof Error ? causa.message : 'No pudimos reprogramar el turno.')
      // The time may have been taken meanwhile: the agenda is asked again and the choice is dropped.
      setMoviendo((actual) => (actual && actual.id === turno.id ? { ...actual, elegido: null, version: actual.version + 1 } : actual))
    } finally {
      setGuardandoCambio(false)
    }
  }

  useEffect(() => {
    if (session.status === 'guest') window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }, [session.status])

  const cargar = useCallback(() => {
    setError(null)
    turnosApi
      .misTurnos()
      .then(setTurnos)
      .catch((causa: unknown) => setError(causa instanceof Error ? causa.message : 'No pudimos cargar tus turnos.'))
  }, [])

  useEffect(() => {
    if (session.status === 'authenticated') cargar()
  }, [session.status, cargar])

  useEffect(() => {
    if (session.status !== 'authenticated' || new URLSearchParams(window.location.search).get('pago') !== 'retorno') return
    setRetornoPago(true)
    window.history.replaceState(null, '', RETURN_TO)
    const esperas = [3000, 8000, 15000].map((ms) => window.setTimeout(cargar, ms))
    return () => esperas.forEach((id) => window.clearTimeout(id))
  }, [session.status, cargar])

  async function cancelar(turno: DetalleTurno, confirmaPerdida = false) {
    setCancelando(turno.id)
    setError(null)
    try {
      await turnosApi.cancelarMiTurno(turno.id, confirmaPerdida)
      setPerdida(null)
      cargar()
    } catch (causa: unknown) {
      // Inside the last 24 hours with something paid: the API asks for the loss to be confirmed.
      if (causa instanceof TurnosError && causa.code === CODIGO_CANCELACION_TARDIA) setPerdida({ id: turno.id, mensaje: causa.message })
      else setError(causa instanceof Error ? causa.message : 'No pudimos cancelar el turno.')
    } finally {
      setCancelando(null)
    }
  }

  // The part to pay is the one the backend offers (deposit, total or balance); only the choice
  // between deposit and total is the client's, while nothing was paid.
  async function pagar(turno: DetalleTurno, tramo: 'sena' | 'total' | 'saldo', aceptaPolitica = false) {
    setPagando(turno.id)
    setError(null)
    try {
      const checkout = await turnosApi.pagarTurno(turno.id, tramo, aceptaPolitica ? VERSION_POLITICA_CANCELACION : undefined)
      window.location.assign(checkout.checkoutUrl)
    } catch (causa: unknown) {
      setPagando(null)
      // An advance payment is only opened once the cancellation policy was accepted for this turno.
      if (tramo !== 'saldo' && causa instanceof TurnosError && causa.code === CODIGO_POLITICA_CANCELACION_REQUERIDA) return setPolitica({ id: turno.id, tramo })
      setError(causa instanceof Error ? causa.message : 'No pudimos preparar el pago.')
      cargar()
    }
  }

  async function confirmar(turno: DetalleTurno) {
    setCerrando(turno.id)
    setError(null)
    try {
      await turnosApi.confirmarTurno(turno.id)
      cargar()
    } catch (causa: unknown) {
      setError(causa instanceof Error ? causa.message : 'No pudimos confirmar el turno.')
    } finally {
      setCerrando(null)
    }
  }

  async function reportar(turno: DetalleTurno) {
    setCerrando(turno.id)
    setError(null)
    try {
      await turnosApi.observarTurno(turno.id, (problema[turno.id] ?? '').trim())
      setReportando(null)
      cargar()
    } catch (causa: unknown) {
      setError(causa instanceof Error ? causa.message : 'No pudimos registrar el problema.')
    } finally {
      setCerrando(null)
    }
  }

  return (
    <div className={`${styles.narrow} ${layout.wide}`}>
      <h1 className={styles.title}>Mis turnos</h1>
      <p className={styles.subtitle}>Solicitás el turno, el prestador lo acepta y tu pago (la seña o el total) lo confirma.</p>
      <div className={styles.stateActions} style={{ justifyContent: 'flex-start', margin: '16px 0 8px' }}>
        <a className={homeStyles.buttonPrimary} href="/trabajadores">
          Buscar trabajador
        </a>
        <a className={homeStyles.buttonSecondary} href="/mis-solicitudes">
          Mis solicitudes
        </a>
      </div>

      {error ? (
        <p className={styles.state} role="alert">
          {error}
        </p>
      ) : null}
      {retornoPago ? (
        <p className={styles.state} data-retorno-pago role="status">
          Si completaste el pago, el turno se confirma cuando Mercado Pago lo acredita. Puede tardar unos segundos; el estado de abajo se actualiza solo.
        </p>
      ) : null}

      {session.status !== 'authenticated' ? (
        <p aria-busy="true" className={styles.resultCount} role="status">
          {session.status === 'unavailable' ? 'No pudimos conectar con TUS. Probá de nuevo en unos minutos.' : 'Verificando tu sesión…'}
        </p>
      ) : turnos === null ? (
        error ? null : <div aria-busy="true" aria-label="Cargando tus turnos" className={styles.skeleton} />
      ) : turnos.length === 0 ? (
        <p className={styles.state}>Todavía no solicitaste ningún turno.</p>
      ) : (
        <ul aria-label="Mis turnos" className={styles.turnoList} style={{ listStyle: 'none', margin: '16px 0 0', padding: 0 }}>
          {turnos.map((turno) => {
            const servicio = [turno.oficioNombre, turno.tarifaNombre].filter((nombre, indice, lista) => nombre && lista.indexOf(nombre) === indice).join(' · ') || 'Turno'
            const futuro = Date.parse(turno.inicio) > Date.now()
            const detalle = explicacion(turno)
            const pago = turno.pago ?? null
            const elegida = eleccion[turno.id] ?? (pago?.modalidad === 'total' ? 'total' : 'sena')
            const eligiendo = turno.estado === 'awaiting_payment' && pago !== null && pago.opciones.length > 0 && Boolean(turno.sena)
            const cierre = pago?.cierre ?? null
            const porConfirmar = cierre !== null && !cierre.confirmadoEn && !cierre.observacionAbierta
            return (
              <li className={`${styles.panel} ${styles.turnoCard} ${turno.estado === 'pending' ? styles.turnoCardNew : ''}`} data-turno={turno.estado} data-turno-id={turno.id} key={turno.id}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong>
                    {servicio} — {diaTurno(turno.inicio)} — {horaTurno(turno.inicio)}
                  </strong>
                  <span className={styles.muted}>
                    Con <Link href={`/trabajadores/${encodeURIComponent(turno.prestadorId)}` as Route}>{turno.prestadorNombre}</Link> · {turno.duracionMinutos} min
                  </span>
                  <span>
                    Estado: <span className={claseEstadoTurno(turno.estado)}>{etiquetaEstadoTurno(turno.estado)}</span>
                  </span>
                  {/* LUGAR-FIJO-01: the API sends it only for the client's own confirmed turno. */}
                  {turno.lugarAtencion ? (
                    <span data-lugar-atencion style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, display: 'grid', gap: 2, overflowWrap: 'anywhere', padding: '8px 10px' }}>
                      <strong>Lugar de atención</strong>
                      {turno.lugarAtencion.nombre ? <span>{turno.lugarAtencion.nombre}</span> : null}
                      <span>{turno.lugarAtencion.direccion}</span>
                      {turno.lugarAtencion.descripcion ? <span className={styles.muted}>{turno.lugarAtencion.descripcion}</span> : null}
                    </span>
                  ) : null}
                  {turno.precioFinal != null && turno.precioFinal > 0 ? (
                    <span data-turno-cobro>
                      Precio: <strong>{formatearPesos(turno.precioFinal)}</strong>
                      {turno.sena ? (
                        <>
                          {' '}
                          · Seña: <strong>{formatearPesos(turno.sena.monto)}</strong> ({etiquetaSenaTurno(turno.sena.estado)})
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  {pago && (pago.pagado > 0 || pago.modalidad !== null) ? (
                    <span data-turno-pago={pago.modalidad ?? 'sin-elegir'}>
                      Pagado: <strong>{formatearPesos(pago.pagado)}</strong> de {formatearPesos(pago.total)}
                      {pago.saldoPendiente > 0 && pago.pagado > 0 ? (
                        <>
                          {' '}
                          · Saldo pendiente: <strong>{formatearPesos(pago.saldoPendiente)}</strong>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  {detalle ? <span className={styles.muted} style={{ fontSize: '0.9rem' }}>{detalle}</span> : null}
                  {eligiendo ? (
                    <fieldset data-turno-modalidad style={{ border: 0, display: 'grid', gap: 6, margin: '4px 0 0', padding: 0 }}>
                      <legend className={styles.muted} style={{ fontSize: '0.9rem', padding: 0 }}>¿Cómo querés pagar?</legend>
                      <label style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                        <input checked={elegida === 'sena'} name={`modalidad-${turno.id}`} onChange={() => setEleccion({ ...eleccion, [turno.id]: 'sena' })} type="radio" />
                        Pagar seña — {formatearPesos(turno.sena!.monto)} ahora y el resto después del servicio
                      </label>
                      <label style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                        <input checked={elegida === 'total'} name={`modalidad-${turno.id}`} onChange={() => setEleccion({ ...eleccion, [turno.id]: 'total' })} type="radio" />
                        Pagar total — {formatearPesos(pago!.total)} ahora, sin saldo después
                      </label>
                    </fieldset>
                  ) : null}
                  {porConfirmar ? (
                    <span data-turno-cierre="por-confirmar" style={{ fontSize: '0.9rem' }}>
                      El prestador marcó el turno como finalizado. Confirmá que se realizó o contanos si hubo un problema. Si no respondés antes del {venceEl(cierre!.confirmacionVenceEn)}, se confirma automáticamente.
                    </span>
                  ) : null}
                  {cierre?.confirmadoEn ? (
                    <span className={styles.muted} data-turno-cierre="confirmado" style={{ fontSize: '0.9rem' }}>
                      {cierre.confirmacionOrigen === 'automatica' ? 'Se confirmó automáticamente porque pasó el plazo para responder.' : 'Confirmaste que el turno se realizó.'}
                    </span>
                  ) : null}
                  {reportando === turno.id ? (
                    <label style={{ display: 'grid', gap: 4 }}>
                      <span className={styles.muted} style={{ fontSize: '0.9rem' }}>Contanos qué pasó (lo revisa el equipo de TUS)</span>
                      <textarea maxLength={1000} onChange={(event) => setProblema({ ...problema, [turno.id]: event.target.value })} rows={3} value={problema[turno.id] ?? ''} />
                    </label>
                  ) : null}
                  {turno.estado === 'confirmed' && futuro && turno.reprogramacion?.motivo === 'RESCHEDULE_WINDOW_CLOSED' ? (
                    <span className={styles.muted} data-reprogramacion-cerrada style={{ fontSize: '0.9rem' }}>{MENSAJE_REPROGRAMACION_CERRADA}</span>
                  ) : null}
                  {turno.reprogramacion && turno.reprogramacion.veces > 0 && turno.reprogramacion.anterior ? (
                    <span className={styles.muted} data-turno-reprogramado style={{ fontSize: '0.9rem' }}>Reprogramado: antes era el {diaTurno(turno.reprogramacion.anterior)} a las {horaTurno(turno.reprogramacion.anterior)}.</span>
                  ) : null}
                  {moviendo?.id === turno.id ? (
                    <div data-reprogramacion role="group" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 'var(--tus-control-radius)', display: 'grid', gap: 10, padding: '10px 12px' }}>
                      {moviendo.elegido ? (
                        <>
                          <span data-reprogramacion-confirmar>{textoConfirmacionReprogramacion(`${diaTurno(turno.inicio)} a las ${horaTurno(turno.inicio)}`, `${diaTurno(moviendo.elegido)} a las ${horaTurno(moviendo.elegido)}`)}</span>
                          <dl className={styles.turnoData} data-resumen-reprogramacion>
                            <div><dt>Horario actual</dt><dd>{diaTurno(turno.inicio)} · {horaTurno(turno.inicio)}</dd></div>
                            <div><dt>Nuevo horario</dt><dd>{diaTurno(moviendo.elegido)} · {horaTurno(moviendo.elegido)}</dd></div>
                          </dl>
                          <div className={styles.turnoActions}>
                            <button className={homeStyles.buttonPrimary} data-confirmar-cambio disabled={guardandoCambio} onClick={() => void confirmarCambio(turno, moviendo.elegido!)} type="button">
                              {guardandoCambio ? 'Guardando…' : 'Confirmar cambio'}
                            </button>
                            <button className={homeStyles.buttonSecondary} disabled={guardandoCambio} onClick={() => setMoviendo({ ...moviendo, elegido: null })} type="button">
                              Volver
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <strong>Elegí el nuevo horario</strong>
                          <span className={styles.muted} style={{ fontSize: '0.9rem' }}>Solo se pueden elegir horarios libres con más de 24 horas de anticipación. Tus pagos y tu seña se mantienen.</span>
                          {/* The same weekly agenda as a booking: every time and its state come from the API. */}
                          <AgendaSemanal onSeleccion={(franja) => setMoviendo({ ...moviendo, elegido: franja?.inicio ?? null })} origen={{ tipo: 'reprogramacion', turnoId: turno.id }} semanaInicial={new Date(Date.parse(turno.inicio) - 3 * 60 * 60_000).toISOString().slice(0, 10)} version={moviendo.version} />
                          <div className={styles.turnoActions}>
                            <button className={homeStyles.buttonSecondary} onClick={() => setMoviendo(null)} type="button">Cerrar</button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                  {politica?.id === turno.id ? (
                    <div data-politica-cancelacion role="group" style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 'var(--tus-control-radius)', display: 'grid', gap: 8, padding: '10px 12px' }}>
                      <span>
                        {politica.tramo === 'total' ? `Vas a pagar el total de ${formatearPesos(pago?.total ?? 0)}.` : `Vas a pagar una seña de ${formatearPesos(turno.sena?.monto ?? 0)}.`} {textoPoliticaCancelacion(politica.tramo)} Al continuar aceptás esta política de cancelación.
                      </span>
                      <div className={styles.turnoActions}>
                        <button className={homeStyles.buttonPrimary} data-aceptar-politica disabled={pagando === turno.id} onClick={() => void pagar(turno, politica.tramo, true)} type="button">
                          {pagando === turno.id ? 'Preparando pago…' : 'Aceptar y pagar'}
                        </button>
                        <button className={homeStyles.buttonSecondary} onClick={() => setPolitica(null)} type="button">
                          Volver
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {perdida?.id === turno.id ? (
                    <div data-cancelacion-tardia role="group" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--tus-control-radius)', display: 'grid', gap: 8, padding: '10px 12px' }}>
                      <span>{perdida.mensaje}</span>
                      <div className={styles.turnoActions}>
                        <button className={homeStyles.buttonPrimary} data-confirmar-perdida disabled={cancelando === turno.id} onClick={() => void cancelar(turno, true)} type="button">
                          {cancelando === turno.id ? 'Cancelando…' : 'Sí, cancelar turno'}
                        </button>
                        <button className={homeStyles.buttonSecondary} onClick={() => setPerdida(null)} type="button">
                          Volver
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {turno.cancelacion && turno.cancelacion.devolucion !== 'sin_pago' ? (
                    <span className={styles.muted} data-turno-cancelacion={turno.cancelacion.devolucion} data-turno-cancelacion-regla={turno.cancelacion.regla} style={{ fontSize: '0.9rem' }}>
                      {turno.cancelacion.por === 'cliente' ? '' : `El turno fue cancelado por ${turno.cancelacion.por === 'prestador' ? 'el prestador' : 'TUS'}. `}
                      {turno.cancelacion.resumen}
                    </span>
                  ) : null}
                  <FotosTurno cantidad={turno.imagenes ?? 0} puedeAgregar={turno.estado === 'pending' && futuro} turnoId={turno.id} />
                  {turno.estado === 'awaiting_payment' && turno.expiraEn ? (
                    <span className={styles.muted} style={{ fontSize: '0.9rem' }}>Tenés tiempo para abonarla hasta el {venceEl(turno.expiraEn)}; después el horario se libera.</span>
                  ) : null}
                </div>
                {(turno.estado === 'pending' || turno.estado === 'awaiting_payment' || turno.estado === 'confirmed') && futuro ? (
                  <div className={styles.turnoActions}>
                    {eligiendo ? (
                      <button className={homeStyles.buttonPrimary} data-pagar={elegida} disabled={pagando === turno.id} onClick={() => void pagar(turno, elegida)} type="button">
                        {pagando === turno.id ? 'Preparando pago…' : elegida === 'total' ? `Pagar total — ${formatearPesos(pago!.total)}` : `Pagar seña — ${formatearPesos(turno.sena!.monto)}`}
                      </button>
                    ) : turno.estado === 'awaiting_payment' && turno.sena?.estado === 'pending' ? (
                      <button className={homeStyles.buttonPrimary} data-pagar="sena" disabled={pagando === turno.id} onClick={() => void pagar(turno, 'sena')} type="button">
                        {pagando === turno.id ? 'Preparando pago…' : `Pagar seña — ${formatearPesos(turno.sena.monto)}`}
                      </button>
                    ) : null}
                    {turno.reprogramacion?.permitida && moviendo?.id !== turno.id ? (
                      <button className={homeStyles.buttonSecondary} data-reprogramar disabled={guardandoCambio} onClick={() => { setError(null); setMoviendo({ id: turno.id, elegido: null, version: 0 }) }} type="button">
                        Reprogramar turno
                      </button>
                    ) : null}
                    <button className={homeStyles.buttonSecondary} disabled={cancelando === turno.id} onClick={() => void cancelar(turno)} type="button">
                      {cancelando === turno.id ? 'Cancelando…' : turno.estado === 'pending' ? 'Retirar solicitud' : 'Cancelar turno'}
                    </button>
                  </div>
                ) : null}
                {/* After the service: confirm it or report a problem, and pay what is left. */}
                {porConfirmar || pago?.proximo?.tramo === 'saldo' ? (
                  <div className={styles.turnoActions} data-turno-acciones-cierre>
                    {pago?.proximo?.tramo === 'saldo' ? (
                      <button className={homeStyles.buttonPrimary} data-pagar="saldo" disabled={pagando === turno.id} onClick={() => void pagar(turno, 'saldo')} type="button">
                        {pagando === turno.id ? 'Preparando pago…' : `Pagar saldo — ${formatearPesos(pago.proximo.monto)}`}
                      </button>
                    ) : null}
                    {porConfirmar && reportando !== turno.id ? (
                      <>
                        <button className={homeStyles.buttonPrimary} disabled={cerrando === turno.id} onClick={() => void confirmar(turno)} type="button">
                          {cerrando === turno.id ? 'Confirmando…' : 'Confirmar que se realizó'}
                        </button>
                        <button className={homeStyles.buttonSecondary} onClick={() => setReportando(turno.id)} type="button">
                          Reportar un problema
                        </button>
                      </>
                    ) : null}
                    {porConfirmar && reportando === turno.id ? (
                      <>
                        <button className={homeStyles.buttonPrimary} disabled={cerrando === turno.id || (problema[turno.id] ?? '').trim().length < 10} onClick={() => void reportar(turno)} type="button">
                          {cerrando === turno.id ? 'Enviando…' : 'Enviar el problema'}
                        </button>
                        <button className={homeStyles.buttonSecondary} onClick={() => setReportando(null)} type="button">
                          Volver
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
