'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { AgendaSemanal as Agenda, DetalleTurno, FranjaAgenda, PerfilPrestadorPublico, SolicitanteTurnoDTO, TarifaServicioPublica } from '@factory/contracts'
import { CODIGO_HORARIO_NO_DISPONIBLE, CODIGO_HORARIO_OCUPADO, CODIGO_SESION_REQUERIDA, etiquetaEstadoTurno, formatearPesos } from '@factory/contracts'
import homeStyles from '../home/home.module.css'
import { AgendaSemanal } from '../turnos/agenda-semanal'
import { TurnosError, diaTurno, fechaTurno, horaTurno, turnosApi } from '../../lib/tus-turnos-client'
import styles from './directory.module.css'

const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

// A time the person had chosen before being sent to sign in (read from the return URL). It is
// only a suggestion: it is selected again only if the API still offers it as available.
export interface TurnoElegido {
  oficioId: string
  inicio: string
  tarifaId?: string
}

// The client does not confirm a turno: it REQUESTS it. The request is made as the account of the
// session (its name and contact are shown, never asked again and never sent by this page) and
// stays pending until the provider accepts it. A visitor is sent to sign in and comes back here.
export function TurnoBooking({
  worker,
  autenticado,
  retorno,
  elegido = null,
  onSolicitado,
}: {
  worker: PerfilPrestadorPublico
  // null while the session is being verified.
  autenticado: boolean | null
  // Path of this profile: where the sign-in returns to.
  retorno: string
  elegido?: TurnoElegido | null
  onSolicitado?: (turno: DetalleTurno) => void
}): React.ReactNode {
  const ofrece = (oficioId: string) => worker.profession.id === oficioId || (worker.professions ?? []).some((item) => item.id === oficioId)
  const inicial = elegido && ofrece(elegido.oficioId) ? elegido : null
  const [selectedOficio, setSelectedOficio] = useState<string>(inicial?.oficioId ?? worker.profession.id)
  // Bumped to ask the API for the agenda again (after someone else took the time).
  const [refresh, setRefresh] = useState(0)
  const [tarifas, setTarifas] = useState<TarifaServicioPublica[]>([])
  // The tarifa the client picked; without a pick the first one applies (API and Web alike).
  const [tarifaElegida, setTarifaElegida] = useState<string>(inicial?.tarifaId ?? '')
  const selectedTarifaId = tarifaElegida || tarifas[0]?.id || ''
  const [duracion, setDuracion] = useState(0)
  // Price and deposit of the selection, exactly as the API computed them (never derived here).
  const [cobro, setCobro] = useState<{ precio: number | null; sena: number | null }>({ precio: null, sena: null })
  // SERVICIO-A-PRESUPUESTAR-01: the API says this service is priced by a budget (no turno here).
  const [requierePresupuesto, setRequierePresupuesto] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<FranjaAgenda | null>(null)
  // The time chosen before signing in, until the agenda says whether it is still available.
  const [pendienteDeElegir, setPendienteDeElegir] = useState<string | null>(inicial?.inicio ?? null)
  const [notas, setNotas] = useState('')
  const [solicitante, setSolicitante] = useState<SolicitanteTurnoDTO | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [solicitado, setSolicitado] = useState<DetalleTurno | null>(null)

  // Who the request is made as: the account of the session, read from the API.
  useEffect(() => {
    if (autenticado !== true) return
    let vigente = true
    turnosApi
      .solicitante()
      .then((datos) => {
        if (vigente) setSolicitante(datos)
      })
      .catch(() => {
        if (vigente) setSolicitante(null)
      })
    return () => {
      vigente = false
    }
  }, [autenticado])

  // The service or the tarifa (its duration) changed: the chosen time belongs to another agenda.
  function cambiarServicio(oficioId: string) {
    setSelectedOficio(oficioId)
    setTarifaElegida('')
    setTarifas([])
    setSelectedSlot(null)
    setPendienteDeElegir(null)
    setErrorMsg(null)
  }

  function cambiarTarifa(tarifaId: string) {
    setTarifaElegida(tarifaId)
    setSelectedSlot(null)
    setPendienteDeElegir(null)
    setErrorMsg(null)
  }

  function agendaRecibida(agenda: Agenda) {
    setTarifas(agenda.tarifas)
    setDuracion(agenda.duracionMinutos)
    setCobro({ precio: agenda.precio ?? null, sena: agenda.sena ?? null })
    setRequierePresupuesto(agenda.requierePresupuesto === true)
    if (!pendienteDeElegir) return
    // Back from sign-in: the time is chosen again only if the API still offers it.
    const franja = agenda.dias.flatMap((dia) => dia.franjas).find((item) => item.inicio === pendienteDeElegir && item.estado === 'disponible')
    setPendienteDeElegir(null)
    if (franja) setSelectedSlot(franja)
    else setErrorMsg('El horario que habías elegido ya no está disponible. Elegí otro.')
  }

  function irAIniciarSesion() {
    const params = new URLSearchParams({ turno: '1', oficio: selectedOficio })
    if (selectedSlot) params.set('inicio', selectedSlot.inicio)
    if (tarifaElegida) params.set('tarifa', tarifaElegida)
    window.location.assign(`/sign-in?returnTo=${encodeURIComponent(`${retorno}?${params.toString()}`)}`)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSlot) {
      setErrorMsg('Por favor seleccioná un horario disponible.')
      return
    }
    if (autenticado !== true) {
      irAIniciarSesion()
      return
    }

    setSubmitting(true)
    setErrorMsg(null)

    try {
      // Only what the request is about. Who asks is the session: nothing of the person is sent.
      const turno = await turnosApi.solicitarTurno(worker.id, {
        oficioId: selectedOficio,
        inicio: selectedSlot.inicio,
        ...(selectedTarifaId ? { tarifaId: selectedTarifaId } : {}),
        ...(notas.trim() ? { notas: notas.trim() } : {}),
      })
      setSolicitado(turno)
      onSolicitado?.(turno)
    } catch (err: unknown) {
      // The session ended meanwhile: sign in and come back to this same time.
      if (err instanceof TurnosError && (err.code === CODIGO_SESION_REQUERIDA || err.status === 401)) {
        irAIniciarSesion()
        return
      }
      setErrorMsg(err instanceof Error ? err.message : 'No pudimos enviar la solicitud.')
      // Someone took the slot (409): show the real availability again so another one is chosen.
      if (err instanceof TurnosError && (err.code === CODIGO_HORARIO_OCUPADO || err.code === CODIGO_HORARIO_NO_DISPONIBLE)) {
        setSelectedSlot(null)
        setRefresh((value) => value + 1)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (solicitado) {
    return (
      <section aria-labelledby="solicitud-enviada" className={`${styles.panel} ${styles.requestSent}`} data-solicitud-enviada>
        <h2 className={styles.panelTitle} id="solicitud-enviada" style={{ margin: 0 }}>
          Solicitud enviada
        </h2>
        <p style={{ lineHeight: 1.5, margin: 0 }}>
          Solicitud enviada a <strong>{worker.displayName}</strong>. {solicitado.sena ? 'Queda pendiente hasta que el prestador la acepte; después deberás pagar la seña para confirmar el turno.' : 'Queda pendiente hasta que el prestador la acepte.'}
        </p>
        <ul className={styles.requestFacts}>
          {solicitado.oficioNombre || solicitado.tarifaNombre ? (
            <li>
              <strong>Servicio:</strong> {[solicitado.oficioNombre, solicitado.tarifaNombre].filter((nombre, indice, lista) => nombre && lista.indexOf(nombre) === indice).join(' · ')}
            </li>
          ) : null}
          <li>
            <strong>Fecha:</strong> {diaTurno(solicitado.inicio)}
          </li>
          <li>
            <strong>Horario:</strong> {horaTurno(solicitado.inicio)} hs ({solicitado.duracionMinutos} min)
          </li>
          {solicitado.precioFinal != null && solicitado.precioFinal > 0 ? (
            <li>
              <strong>Precio:</strong> {formatearPesos(solicitado.precioFinal)}
            </li>
          ) : null}
          {solicitado.sena ? (
            <li>
              <strong>Seña:</strong> {formatearPesos(solicitado.sena.monto)} (se abona cuando el prestador acepte)
            </li>
          ) : null}
        </ul>
        <p style={{ margin: 0 }}>
          Estado: <span className={`${styles.turnoState} ${styles.turnoStatePending}`}>{etiquetaEstadoTurno(solicitado.estado)} del prestador</span>
        </p>
        <p className={styles.muted} style={{ fontSize: '0.9rem', margin: 0 }}>
          Te avisamos cuando responda. Mientras tanto podés ver el estado en <Link href={'/mis-turnos' as Route}>Mis turnos</Link>.
        </p>
      </section>
    )
  }

  const selectedTarifa = tarifas.find((t) => t.id === selectedTarifaId)

  return (
    <section aria-labelledby="solicitar-turno" className={styles.panel} style={{ marginTop: 24 }}>
      <h2 className={styles.panelTitle} id="solicitar-turno">
        Solicitar turno con {worker.displayName}
      </h2>

      <form onSubmit={handleSubmit} className={styles.bookingForm}>
        {/* Selector de servicio / oficio si tiene varios */}
        {(worker.professions?.length ?? 0) > 1 && (
          <div>
            <label htmlFor="turno-oficio" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
              Servicio
            </label>
            <select id="turno-oficio" value={selectedOficio} onChange={(e) => cambiarServicio(e.target.value)} className={styles.bookingControl}>
              {worker.professions?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Variantes de Tarifas y Duración */}
        {tarifas.length > 0 && (
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Tarifa / Duración</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tarifas.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={selectedTarifaId === t.id}
                  onClick={() => cambiarTarifa(t.id)}
                  className={`${styles.tarifaCard} ${selectedTarifaId === t.id ? styles.tarifaCardActive : ''}`}
                >
                  <div style={{ fontWeight: 600 }}>{t.nombre}</div>
                  <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                    {t.duracionMinutos} min · ${PESOS.format(t.precio)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Agenda semanal: every time and its state come from the API, for the real duration of
            the chosen service. The Web never builds a time on its own. */}
        <div aria-labelledby="turno-agenda-titulo" role="group">
          <p id="turno-agenda-titulo" style={{ fontWeight: 600, margin: '0 0 6px' }}>
            Elegí día y horario{duracion > 0 ? <span className={styles.muted} style={{ fontWeight: 400 }}>{` · turnos de ${duracion} min`}</span> : null}
          </p>
          <AgendaSemanal
            onAgenda={agendaRecibida}
            onSeleccion={(franja) => {
              setSelectedSlot(franja)
              if (franja) setErrorMsg(null)
            }}
            origen={{ tipo: 'publica', prestadorId: worker.id, oficioId: selectedOficio, ...(tarifaElegida ? { tarifaId: tarifaElegida } : {}) }}
            seleccion={selectedSlot?.inicio ?? null}
            {...(inicial ? { semanaInicial: new Date(new Date(inicial.inicio).getTime() - 3 * 60 * 60_000).toISOString().slice(0, 10) } : {})}
            version={refresh}
          />
        </div>

        {/* Who asks: the account of the session. Nothing is typed again. */}
        {autenticado === true ? (
          <div className={styles.requester} data-solicitante>
            <span className={styles.requesterLabel}>Solicitás el turno como</span>
            {solicitante ? (
              <>
                <strong>{solicitante.nombre}</strong>
                {solicitante.telefono ? <span>{solicitante.telefono}</span> : null}
                <span>{solicitante.email}</span>
              </>
            ) : (
              <span className={styles.muted}>Tu cuenta de TUS</span>
            )}
          </div>
        ) : autenticado === false ? (
          <p className={styles.notice} role="note">
            Para solicitar el turno tenés que iniciar sesión. Te traemos de vuelta a este mismo horario.
          </p>
        ) : null}

        <div>
          <label htmlFor="turno-notas" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
            Notas para el profesional (opcional)
          </label>
          <textarea
            id="turno-notas"
            maxLength={500}
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Detalle o consulta sobre la atención..."
            className={styles.bookingControl}
            style={{ minHeight: 80, resize: 'vertical' }}
          />
        </div>

        {errorMsg && (
          <div role="alert" style={{ color: '#dc2626', background: '#fee2e2', padding: '8px 12px', borderRadius: 'var(--tus-control-radius)' }}>
            {errorMsg}
          </div>
        )}

        {requierePresupuesto ? (
          <p data-servicio-a-presupuestar role="status" style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 'var(--tus-control-radius)', margin: 0, padding: '10px 12px' }}>
            Este servicio no tiene un precio fijo: se presupuesta. No hace falta reservar un turno todavía: usá <strong>Solicitar servicio</strong> en este perfil, contale al profesional qué necesitás y te pasa un presupuesto.
          </p>
        ) : null}

        {/* Resumen y pedido: una solicitud, no una confirmación */}
        <div className={styles.submitRow}>
          <div aria-live="polite">
            {selectedSlot ? (
              <span data-turno-elegido style={{ fontSize: '0.95rem' }}>
                Elegiste: <strong>{fechaTurno(selectedSlot.inicio)}, {horaTurno(selectedSlot.inicio)} hs</strong>
                {selectedTarifa ? ` · ${selectedTarifa.nombre}` : ''}
              </span>
            ) : null}
            {cobro.precio !== null ? (
              <span data-turno-precio style={{ display: 'block', fontSize: '0.95rem' }}>
                Precio: <strong>{formatearPesos(cobro.precio)}</strong>
                {cobro.sena !== null ? (
                  <>
                    {' '}
                    · Seña: <strong>{formatearPesos(cobro.sena)}</strong> (se abona cuando el prestador acepte)
                  </>
                ) : null}
              </span>
            ) : null}
          </div>

          <button type="submit" disabled={submitting || !selectedSlot || autenticado === null || requierePresupuesto} className={homeStyles.buttonPrimary} style={{ opacity: submitting || !selectedSlot ? 0.6 : 1 }}>
            {submitting ? 'Enviando solicitud...' : autenticado === false ? 'Iniciar sesión para solicitar' : 'Solicitar reserva'}
          </button>
        </div>
        <p className={styles.submitHint}>La solicitud queda pendiente hasta que el prestador acepte.{cobro.sena !== null ? ' El turno se confirma cuando se acredite la seña.' : ''}</p>
      </form>
    </section>
  )
}
