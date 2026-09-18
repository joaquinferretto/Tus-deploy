'use client'

import { useEffect, useState } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import {
  createTusWebClient,
  createTusWebFetchTransport,
  type TusCustomerCommitmentsResponse,
} from '@/lib/tus-client'
import { TrabajoCliente } from '@/components/compromisos/trabajo-cliente'
import {
  crearEnlaceCompromiso,
  encontrarCompromiso,
  presentarEstadoCompromiso,
} from '@/lib/tus-commitments'
import { formatTusCurrency, formatTusDate } from '@/lib/tus-journeys'
import { sessionRequestContext, type TusWebSession } from '@/lib/tus-ui-contract'
import { TusStateMessage } from '../../app/tus/tus-ui'

export function CompromisosCliente({ commitmentId }: { commitmentId?: string }): React.ReactNode {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [authMessage, setAuthMessage] = useState('Restaurando tu sesión segura.')
  const [authStatus, setAuthStatus] = useState('restoring')
  const [state, setState] = useState<CompromisosState>({
    status: 'loading',
    message: 'Cargando compromisos…',
  })

  useEffect(() => {
    let cancelled = false
    void createTusWebAuthClient()
      .restore(window.location.pathname)
      .then((result) => {
        if (cancelled) return
        setAuthStatus(result.status)
        setAuthMessage(result.message)
        setSession(result.session === undefined ? null : toTusWebSession(result.session))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (session === undefined || session === null) return
    let cancelled = false
    setState({ status: 'loading', message: 'Cargando compromisos…' })
    void createTusWebClient(createTusWebFetchTransport())
      .marketplaceCustomerCommitments(sessionRequestContext(session))
      .then((response) => {
        if (cancelled) return
        setState({
          status: response.commitments.length === 0 ? 'empty' : 'ready',
          data: response,
          message:
            response.commitments.length === 0
              ? 'Todavía no hay compromisos para este cliente.'
              : 'Compromisos actuales devueltos por TUS.',
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (statusOf(error) === 401) {
          createTusWebAuthClient().clearLocalSession()
          setAuthStatus('expired')
          setAuthMessage('Tu sesión de TUS ya no es válida. Ingresá nuevamente.')
          setSession(null)
          return
        }
        setState({
          status: 'error',
          message: 'No pudimos cargar tus compromisos. Reintentá para consultar TUS.',
          code: codeOf(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [session])

  if (session === undefined) {
    return (
      <TusStateMessage state={{ status: 'loading', message: 'Restaurando tu sesión segura…' }} />
    )
  }
  if (session === null) {
    return (
      <TusStateMessage
        state={{
          status: authStatus === 'unavailable' ? 'error' : 'disabled',
          message: authMessage,
        }}
      >
        <p>Necesitás una sesión autenticada para consultar tus compromisos.</p>
        <a
          className="tus-action-button tus-action-link"
          href={`/sign-in?returnTo=${encodeURIComponent(commitmentId === undefined ? '/tus/compromisos' : `/tus/compromisos/${commitmentId}`)}`}
        >
          Ingresar a TUS
        </a>
      </TusStateMessage>
    )
  }

  const compromiso =
    commitmentId === undefined || state.data === undefined
      ? undefined
      : encontrarCompromiso(state.data.commitments, commitmentId)
  const reload = () => {
    setSession((current) => (current === undefined || current === null ? current : { ...current }))
  }

  return (
    <>
      <div className="tus-nav-links tus-session-actions">
        <span className="tus-session-chip">Compromisos del cliente</span>
        <button className="tus-text-button" onClick={reload} type="button">
          Actualizar compromisos
        </button>
      </div>
      <header className="tus-workspace-header">
        <div>
          <p className="tus-kicker">Cliente / Compromisos</p>
          <h1>
            Seguí lo que
            <br />
            <em>ya empezaste.</em>
          </h1>
        </div>
        <p className="tus-intro">
          <strong>Estado del servidor</strong>El compromiso, el importe, la publicación y las fechas
          se muestran solo con datos confirmados por TUS.
        </p>
      </header>
      {commitmentId === undefined ? (
        <>
          <ListadoCompromisos state={state} />
          <TrabajoCliente
            onUnauthorized={() => {
              createTusWebAuthClient().clearLocalSession()
              setAuthStatus('expired')
              setAuthMessage('Tu sesión de TUS ya no es válida. Ingresá nuevamente.')
              setSession(null)
            }}
            session={session}
          />
        </>
      ) : (
        <DetalleCompromiso state={state} compromiso={compromiso} commitmentId={commitmentId} />
      )}
    </>
  )
}

interface CompromisosState {
  status: 'loading' | 'ready' | 'empty' | 'error'
  data?: TusCustomerCommitmentsResponse
  message: string
  code?: string
}

function ListadoCompromisos({ state }: { state: CompromisosState }): React.ReactNode {
  if (state.status === 'loading' || state.status === 'error') {
    return (
      <section aria-labelledby="compromisos-title">
        <SectionHeading title="Compromisos" />
        <TusStateMessage state={{ ...state }} />
      </section>
    )
  }
  if (state.data === undefined || state.data.commitments.length === 0) {
    return (
      <section aria-labelledby="compromisos-title">
        <SectionHeading title="Compromisos" />
        <TusStateMessage state={{ status: 'empty', message: state.message }} />
      </section>
    )
  }
  return (
    <section aria-labelledby="compromisos-title">
      <SectionHeading title="Compromisos" />
      <p className="tus-evidence-line">Colección de compromisos actual devuelta por TUS.</p>
      <div className="tus-commitment-list">
        {state.data.commitments.map((compromiso) => (
          <CompromisoCard compromiso={compromiso} key={compromiso.commitmentId} />
        ))}
      </div>
    </section>
  )
}

function DetalleCompromiso({
  state,
  compromiso,
  commitmentId,
}: {
  state: CompromisosState
  compromiso?: TusCustomerCommitmentsResponse['commitments'][number]
  commitmentId: string
}): React.ReactNode {
  if (state.status === 'loading' || state.status === 'error') {
    return (
      <section aria-labelledby="compromiso-title">
        <SectionHeading title="Compromiso" />
        <TusStateMessage state={{ ...state }} />
      </section>
    )
  }
  if (compromiso === undefined) {
    return (
      <section aria-labelledby="compromiso-title">
        <SectionHeading title="Compromiso" />
        <TusStateMessage
          state={{
            status: 'empty',
            message: `No encontramos el compromiso ${commitmentId} en la colección actual.`,
          }}
        >
          <a className="tus-action-button tus-action-link" href="/tus/compromisos">
            Volver a compromisos
          </a>
        </TusStateMessage>
      </section>
    )
  }
  return (
    <section aria-labelledby="compromiso-title">
      <SectionHeading title="Compromiso" />
      <p className="tus-evidence-line">
        Detalle construido a partir de la colección actual devuelta por TUS.
      </p>
      <div className="tus-detail-layout">
        <CompromisoCard compromiso={compromiso} />
        <aside className="tus-state-box" aria-labelledby="compromiso-contexto-title">
          <h2 id="compromiso-contexto-title">Contexto comercial</h2>
          <p>Publicación: {compromiso.listingId}</p>
          <p>Prestador: {compromiso.merchantId}</p>
          <p>Carrito: {compromiso.cartId}</p>
          <small className="tus-boundary-note">
            El pago no está habilitado en esta pantalla. Las acciones disponibles dependen de una
            transición confirmada por el servidor.
          </small>
        </aside>
      </div>
    </section>
  )
}

function CompromisoCard({
  compromiso,
}: {
  compromiso: TusCustomerCommitmentsResponse['commitments'][number]
}): React.ReactNode {
  const presentation = presentarEstadoCompromiso(compromiso.status)
  return (
    <article className={`tus-commitment-card tus-tone-${presentation.tone}`}>
      <div className="tus-card-kicker">
        {compromiso.context === 'product' ? 'Producto' : 'Servicio'}
      </div>
      <h3>{presentation.label}</h3>
      <p>{formatTusCurrency(compromiso.amount, compromiso.currency)}</p>
      <p>
        <strong>ID:</strong> {compromiso.commitmentId}
      </p>
      <p>
        <strong>Creado:</strong> {formatTusDate(compromiso.createdAt)}
      </p>
      {compromiso.listingId === undefined ? null : (
        <p>
          <strong>Publicación:</strong> {compromiso.listingId}
        </p>
      )}
      {compromiso.slotStart === undefined ? null : (
        <p>
          <strong>Franja:</strong> {formatTusDate(compromiso.slotStart)}
          {compromiso.slotEnd === undefined ? null : ` a ${formatTusDate(compromiso.slotEnd)}`}
        </p>
      )}
      <small className="tus-boundary-note">
        Versión de disponibilidad: {compromiso.availabilityVersion} · Política:{' '}
        {compromiso.policyVersion}
      </small>
      <a
        className="tus-action-button tus-action-link"
        href={crearEnlaceCompromiso(compromiso.commitmentId)}
      >
        Ver compromiso
      </a>
    </article>
  )
}

function SectionHeading({ title }: { title: string }): React.ReactNode {
  return (
    <div className="tus-section-label">
      <span>01</span>
      <h2 id={title === 'Compromiso' ? 'compromiso-title' : 'compromisos-title'}>{title}</h2>
    </div>
  )
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
    ? error.status
    : undefined
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined
}

const compromisosClienteModule = { CompromisosCliente }

export default compromisosClienteModule
