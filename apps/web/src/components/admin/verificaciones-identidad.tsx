'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import { TusRequestError } from '@/lib/tus-client'
import {
  ETIQUETAS_ESTADO_IDENTIDAD,
  MOTIVOS_REVISION_TEXTO,
  clienteIdentidad,
  type DetalleVerificacionAdmin,
  type EstadoWorkerWeb,
  type ItemVerificacionAdmin,
  type LecturaDocumentoWeb,
} from '@/lib/tus-identidad'
import { formatTusDate, type TusWebSession } from '@/lib/tus-ui-contract'
import { TusActionButton, TusStateMessage } from '../../app/tus/tus-ui'

// IDENTITY-NOSIS platform administration. The API enforces `tus:identity:admin` plus the
// platform tenant; this page only renders what the API allows.

const FILTROS = [
  ['', 'Todas'],
  ['review_required', 'En revisión'],
  ['queued', 'En cola'],
  ['processing', 'Verificando'],
  ['retry_pending', 'Reintento programado'],
  ['session_required', 'Sesión requerida'],
  ['verified', 'Verificadas'],
  ['rejected', 'Rechazadas'],
] as const

const WORKER_TEXTO: Record<EstadoWorkerWeb['status'], string> = {
  running: 'Funcionando',
  paused: 'Pausado',
  rate_limited: 'Límite horario alcanzado',
  session_required: 'Requiere reautenticar Mi Nosis',
  circuit_open: 'Pausado por errores consecutivos (circuit breaker)',
}

export function VerificacionesIdentidadAdmin(): ReactNode {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [authMessage, setAuthMessage] = useState('Restaurando la sesión.')
  const [filter, setFilter] = useState('review_required')
  const [items, setItems] = useState<ItemVerificacionAdmin[] | null>(null)
  const [worker, setWorker] = useState<EstadoWorkerWeb | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void createTusWebAuthClient()
      .restore(window.location.pathname)
      .then((result) => {
        setAuthMessage(result.message)
        setSession(result.session === undefined ? null : toTusWebSession(result.session))
      })
  }, [])

  const load = useCallback(async () => {
    if (!session) return
    try {
      const [list, status] = await Promise.all([
        clienteIdentidad.listar(session, filter || undefined),
        clienteIdentidad.estadoWorker(session),
      ])
      setItems(list.verifications)
      setWorker(status)
      setError('')
    } catch (failure) {
      setError(
        failure instanceof TusRequestError && failure.status === 403
          ? 'Esta sesión no administra verificaciones de identidad.'
          : 'No se pudo cargar la información. Reintentá.'
      )
    }
  }, [filter, session])

  useEffect(() => {
    void load()
  }, [load])

  async function controlWorker(action: 'pause' | 'resume' | 'reauthenticate') {
    if (!session) return
    try {
      await clienteIdentidad.controlarWorker(session, action)
      await load()
    } catch {
      setError('No se pudo cambiar el estado del worker.')
    }
  }

  if (session === undefined)
    return <TusStateMessage state={{ status: 'loading', message: authMessage }} />
  if (session === null)
    return (
      <TusStateMessage state={{ status: 'disabled', message: authMessage }}>
        <a
          className="tus-action-button tus-action-link"
          href="/sign-in?returnTo=%2Ftus%2Fadmin%2Fidentidad"
        >
          Ingresar
        </a>
      </TusStateMessage>
    )

  return (
    <>
      <div className="tus-nav-links tus-session-actions">
        <Link href="/tus/operations">Operaciones</Link>
      </div>
      <header className="tus-workspace-header">
        <div>
          <p className="tus-kicker">Plataforma / identidad</p>
          <h1>Verificaciones de identidad</h1>
        </div>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {worker ? (
        <section aria-labelledby="identity-worker-title" className="tus-state-box">
          <h2 id="identity-worker-title">Worker Nosis</h2>
          <p>
            <strong>{WORKER_TEXTO[worker.status]}</strong> · {worker.used} / {worker.max} consultas
            en la última hora · {worker.pending} en cola
          </p>
          {worker.nextEligibleAt ? (
            <p>Próxima capacidad: {formatTusDate(worker.nextEligibleAt)}</p>
          ) : null}
          <p>
            <TusActionButton onClick={() => void controlWorker('pause')} type="button">
              Pausar
            </TusActionButton>{' '}
            <TusActionButton onClick={() => void controlWorker('resume')} type="button">
              Reanudar
            </TusActionButton>{' '}
            <TusActionButton onClick={() => void controlWorker('reauthenticate')} type="button">
              Reautenticar Nosis
            </TusActionButton>
          </p>
          {worker.status === 'session_required' ? (
            <p role="status">
              Un operador debe ejecutar <code>pnpm tus:identity:nosis-login</code> y completar el
              ingreso a Mi Nosis. La cola se conserva; ninguna verificación se rechaza por esto.
            </p>
          ) : null}
        </section>
      ) : null}
      <section aria-labelledby="identity-list-title">
        <h2 id="identity-list-title">Solicitudes</h2>
        <label>
          Estado:{' '}
          <select onChange={(event) => setFilter(event.target.value)} value={filter}>
            {FILTROS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {items === null ? (
          <TusStateMessage state={{ status: 'loading', message: 'Cargando verificaciones…' }} />
        ) : items.length === 0 ? (
          <p>No hay verificaciones con ese estado.</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.verificationId}>
                <button onClick={() => setSelected(item.verificationId)} type="button">
                  {ETIQUETAS_ESTADO_IDENTIDAD[item.status]} · DNI {item.documentNumberMasked ?? '—'}{' '}
                  ·{' '}
                  {item.reviewReason
                    ? (MOTIVOS_REVISION_TEXTO[item.reviewReason] ?? item.reviewReason)
                    : 'sin motivo'}{' '}
                  · {formatTusDate(item.createdAt)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {selected ? (
        <DetalleVerificacion
          id={selected}
          onChanged={() => void load()}
          onClose={() => setSelected(null)}
          session={session}
        />
      ) : null}
    </>
  )
}

function DetalleVerificacion({
  id,
  session,
  onChanged,
  onClose,
}: {
  id: string
  session: TusWebSession
  onChanged: () => void
  onClose: () => void
}): ReactNode {
  const [detail, setDetail] = useState<DetalleVerificacionAdmin | null>(null)
  const [images, setImages] = useState<{ front?: string; back?: string }>({})
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    void clienteIdentidad.detalle(session, id).then((value) => {
      if (!cancelled) setDetail(value)
    })
    for (const side of ['front', 'back'] as const) {
      void clienteIdentidad
        .imagenDocumento(session, id, side)
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          urls.push(url)
          if (!cancelled) setImages((current) => ({ ...current, [side]: url }))
        })
        .catch(() => undefined)
    }
    // Object URLs are revoked when the detail closes: images never outlive the review.
    return () => {
      cancelled = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [id, session])

  async function decide(decision: 'approve' | 'reject' | 'review' | 'retry') {
    if ((decision === 'approve' || decision === 'reject') && !reason.trim()) {
      setMessage('Escribí el motivo de la decisión.')
      return
    }
    try {
      setDetail(await clienteIdentidad.decidir(session, id, decision, reason.trim()))
      setMessage('Decisión registrada.')
      onChanged()
    } catch (failure) {
      setMessage(
        failure instanceof TusRequestError ? failure.message : 'No se pudo registrar la decisión.'
      )
    }
  }

  if (!detail)
    return <TusStateMessage state={{ status: 'loading', message: 'Cargando detalle…' }} />
  return (
    <section aria-labelledby="identity-detail-title" className="tus-state-box">
      <h2 id="identity-detail-title">Detalle de verificación</h2>
      <p>
        <strong>{ETIQUETAS_ESTADO_IDENTIDAD[detail.status]}</strong>
        {detail.reviewReason
          ? ` · ${MOTIVOS_REVISION_TEXTO[detail.reviewReason] ?? detail.reviewReason}`
          : ''}
      </p>
      <p>
        Prestador: {detail.tenantId} · Consentimiento: {detail.consentVersion ?? '—'}{' '}
        {detail.consentAcceptedAt ? formatTusDate(detail.consentAcceptedAt) : ''}
      </p>
      <div className="tus-identity-images">
        {(['front', 'back'] as const).map((side) =>
          images[side] ? (
            // eslint-disable-next-line @next/next/no-img-element -- private blob URL, not optimizable
            <img
              alt={side === 'front' ? 'Frente del DNI' : 'Dorso del DNI'}
              key={side}
              src={images[side]}
              width={320}
            />
          ) : (
            <p key={side}>{side === 'front' ? 'Frente' : 'Dorso'}: no disponible</p>
          )
        )}
      </div>
      <Lectura title="OCR" value={detail.ocrReading} />
      <Lectura title="Visión (Groq)" value={detail.visionReading} />
      <p>
        Candidato: {detail.extractedLastName ?? '—'}, {detail.extractedFirstName ?? '—'} · DNI{' '}
        {detail.documentNumber ?? '—'}
      </p>
      <p>
        Fuente externa:{' '}
        {detail.externalSnapshot
          ? `${detail.externalSnapshot.resultCount} resultado(s) · nombre ${detail.externalSnapshot.nameMatch ?? '—'} · CUIL ${detail.externalSnapshot.cuilValid === null ? '—' : detail.externalSnapshot.cuilValid ? 'válido' : 'inválido'}`
          : 'sin consulta'}
        {detail.verifiedCuil ? ` · CUIL verificado ${detail.verifiedCuil}` : ''}
      </p>
      {detail.job ? (
        <p>
          Cola: {detail.job.stage} / {detail.job.status} · intento {detail.job.attemptCount} ·
          disponible {formatTusDate(detail.job.availableAt)}{' '}
          {detail.job.lastErrorCode ? `· ${detail.job.lastErrorCode}` : ''}
        </p>
      ) : null}
      {detail.decisionNote ? <p>Nota: {detail.decisionNote}</p> : null}
      <label>
        Motivo (obligatorio para aprobar o rechazar):{' '}
        <input maxLength={500} onChange={(event) => setReason(event.target.value)} value={reason} />
      </label>
      <p>
        <TusActionButton onClick={() => void decide('approve')} type="button">
          Aprobar manualmente
        </TusActionButton>{' '}
        <TusActionButton onClick={() => void decide('reject')} type="button">
          Rechazar
        </TusActionButton>{' '}
        <TusActionButton onClick={() => void decide('review')} type="button">
          Marcar para revisión
        </TusActionButton>{' '}
        <TusActionButton onClick={() => void decide('retry')} type="button">
          Reintentar
        </TusActionButton>{' '}
        <button onClick={onClose} type="button">
          Cerrar
        </button>
      </p>
      {message ? <p role="status">{message}</p> : null}
    </section>
  )
}

function Lectura({
  title,
  value,
}: {
  title: string
  value: LecturaDocumentoWeb | null
}): ReactNode {
  if (!value) return <p>{title}: sin lectura</p>
  if (value.unavailable) return <p>{title}: no disponible</p>
  return (
    <p>
      {title}: DNI {value.documentNumber ?? '—'} · {value.lastName ?? '—'}, {value.firstName ?? '—'}{' '}
      · nac. {value.birthDate ?? '—'} · vence {value.expirationDate ?? '—'} · confianza{' '}
      {Math.round(value.confidence * 100)}%
    </p>
  )
}

const verificacionesIdentidadAdminModule = { VerificacionesIdentidadAdmin }

export default verificacionesIdentidadAdminModule
