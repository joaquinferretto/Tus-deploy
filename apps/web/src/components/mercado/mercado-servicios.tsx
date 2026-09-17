'use client'

import { useEffect, useState } from 'react'

import {
  createTusWebAuthClient,
  toTusWebSession,
} from '@/lib/tus-auth-client'
import {
  createTusWebClient,
  createTusWebFetchTransport,
  tusIntentFeedback,
  type TusCheckoutResult,
  type TusCalendarSlot,
  type TusDiscoveryResponse,
  type TusIntentFeedback,
} from '@/lib/tus-client'
import {
  construirIntencionCheckout,
  crearEnlaceCompromiso,
  crearEnlacePublicacion,
  encontrarPublicacion,
  filtrarPublicaciones,
  publicacionRequierePresupuesto,
  type MercadoServiciosFilter,
  type TusMarketplaceCheckoutIntent,
} from '@/lib/tus-marketplace'
import { sessionRequestContext, type TusWebSession } from '@/lib/tus-ui-contract'
import { CalendarioCliente } from '../calendario/calendario-cliente'
import { PublicacionCard, type PublicacionCardCopy } from './publicacion-card'
import { TusIntentFeedbackView, TusStateMessage } from '../../app/tus/tus-ui'

export function MercadoServicios({ listingId }: { listingId?: string }): React.ReactNode {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [authMessage, setAuthMessage] = useState('Restaurando tu sesión segura.')
  const [authStatus, setAuthStatus] = useState('restoring')
  const [state, setState] = useState<MercadoState>({
    status: 'loading',
    message: 'Cargando publicaciones disponibles…',
  })
  const [filter, setFilter] = useState<MercadoServiciosFilter>('all')
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutFeedback, setCheckoutFeedback] = useState<TusIntentFeedback | null>(null)
  const [checkoutIntent, setCheckoutIntent] = useState<TusMarketplaceCheckoutIntent | null>(null)
  const [compromisoId, setCompromisoId] = useState<string | undefined>(undefined)

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
    setState({ status: 'loading', message: 'Cargando publicaciones disponibles…' })
    setCheckoutFeedback(null)
    setCompromisoId(undefined)
    const client = createTusWebClient(createTusWebFetchTransport())
    void client
      .discoverMarketplace(sessionRequestContext(session))
      .then((response) => {
        if (cancelled) return
        setState({
          status: response.items.length === 0 ? 'empty' : 'ready',
          data: response,
          message:
            response.items.length === 0
              ? 'Todavía no hay publicaciones disponibles para este alcance.'
              : 'Publicaciones actuales devueltas por TUS.',
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
          message: 'No pudimos cargar el Mercado de servicios. Reintentá para consultar TUS.',
          code: codeOf(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [session])

  if (session === undefined) {
    return <TusStateMessage state={{ status: 'loading', message: 'Restaurando tu sesión segura…' }} />
  }
  if (session === null) {
    return <SesionRequerida status={authStatus} message={authMessage} returnTo={listingId === undefined ? '/tus/mercado' : `/tus/mercado/${listingId}`} />
  }

  const publicacion =
    listingId === undefined || state.data === undefined
      ? undefined
      : encontrarPublicacion(state.data.items, listingId)
  const visibleItems =
    state.data === undefined ? [] : filtrarPublicaciones(state.data.items, filter)
  const retry = () => {
    setSession((current) =>
      current === undefined || current === null ? current : { ...current }
    )
  }

  return (
    <>
      <div className="tus-nav-links tus-session-actions">
        <span className="tus-session-chip">Mercado de servicios</span>
        <button className="tus-text-button" onClick={retry} type="button">
          Actualizar publicaciones
        </button>
      </div>
      <header className="tus-workspace-header">
        <div>
          <p className="tus-kicker">Cliente / Mercado de servicios</p>
          <h1>
            Encontrá una publicación
            <br />
            <em>y empezá bien.</em>
          </h1>
        </div>
        <p className="tus-intro">
          <strong>Datos del servidor</strong>La oferta, el precio, la disponibilidad y el prestador
          se muestran únicamente cuando TUS los devuelve.
        </p>
      </header>

      {listingId === undefined ? (
        <ListadoPublicaciones
          state={state}
          filter={filter}
          items={visibleItems}
          onFilter={setFilter}
          onReload={retry}
          onCheckout={(item, slot) => void iniciarCheckout(item, session, setCheckoutLoading, setCheckoutFeedback, setCheckoutIntent, setCompromisoId, slot)}
          checkoutLoading={checkoutLoading}
          checkoutFeedback={checkoutFeedback}
          checkoutIntent={checkoutIntent}
          compromisoId={compromisoId}
          onRetry={() => void reintentarCheckout(checkoutIntent, session, setCheckoutLoading, setCheckoutFeedback, setCompromisoId)}
          onRefresh={retry}
          onResolve={() => resolverFeedback(setCheckoutFeedback)}
        />
      ) : (
        <DetallePublicacion
          state={state}
          publicacion={publicacion}
          listingId={listingId}
          checkoutLoading={checkoutLoading}
          checkoutFeedback={checkoutFeedback}
          checkoutIntent={checkoutIntent}
          compromisoId={compromisoId}
          onCheckout={(item, slot) => void iniciarCheckout(item, session, setCheckoutLoading, setCheckoutFeedback, setCheckoutIntent, setCompromisoId, slot)}
          onRetry={() => void reintentarCheckout(checkoutIntent, session, setCheckoutLoading, setCheckoutFeedback, setCompromisoId)}
          onRefresh={retry}
          onResolve={() => resolverFeedback(setCheckoutFeedback)}
        />
      )}
    </>
  )
}

interface MercadoState {
  status: 'loading' | 'ready' | 'empty' | 'error'
  data?: TusDiscoveryResponse
  message: string
  code?: string
}

function ListadoPublicaciones({
  state,
  filter,
  items,
  onFilter,
  onReload,
  onCheckout,
  checkoutLoading,
  checkoutFeedback,
  checkoutIntent,
  compromisoId,
  onRetry,
  onRefresh,
  onResolve,
}: {
  state: MercadoState
  filter: MercadoServiciosFilter
  items: TusDiscoveryResponse['items']
  onFilter: (filter: MercadoServiciosFilter) => void
  onReload: () => void
  onCheckout: (item: TusDiscoveryResponse['items'][number], slot?: TusCalendarSlot) => void
  checkoutLoading: boolean
  checkoutFeedback: TusIntentFeedback | null
  checkoutIntent: TusMarketplaceCheckoutIntent | null
  compromisoId?: string
  onRetry: () => void
  onRefresh: () => void
  onResolve: () => void
}): React.ReactNode {
  if (state.status === 'loading' || state.status === 'error') {
    return (
      <section aria-labelledby="mercado-title">
        <SectionHeading title="Mercado de servicios" />
        <TusStateMessage state={{ ...state, retry: state.status === 'error' ? onReload : undefined }} />
      </section>
    )
  }
  if (state.data === undefined) return null
  return (
    <section aria-labelledby="mercado-title">
      <SectionHeading title="Mercado de servicios" />
      <p className="tus-evidence-line">
        Evidencia: {state.data.evidence} · {state.data.items.length} publicaciones devueltas por TUS.
      </p>
      <label className="tus-filter-control" htmlFor="mercado-filter">
        Mostrar{' '}
        <select id="mercado-filter" value={filter} onChange={(event) => onFilter(event.target.value as MercadoServiciosFilter)}>
          <option value="all">todas</option>
          <option value="products">productos</option>
          <option value="services">servicios</option>
        </select>
      </label>
      <CheckoutFeedback
        loading={checkoutLoading}
        feedback={checkoutFeedback}
        intent={checkoutIntent}
        compromisoId={compromisoId}
        onRetry={onRetry}
        onRefresh={onRefresh}
        onResolve={onResolve}
      />
      {items.length === 0 ? (
        <TusStateMessage
          state={{
            status: 'empty',
            message:
              filter === 'all'
                ? 'Todavía no hay publicaciones disponibles para este alcance.'
                : `No hay ${filter === 'products' ? 'productos' : 'servicios'} disponibles para este alcance.`,
          }}
        />
      ) : (
        <div className="tus-offer-grid">
          {items.map((item) => (
            <PublicacionCard
              copy={copyForPublicacion(item)}
              detailHref={crearEnlacePublicacion(item.listingId)}
              publicacion={item}
              onCheckout={item.kind === 'product' ? () => onCheckout(item) : undefined}
              checkoutLoading={checkoutLoading}
              key={item.listingId}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function DetallePublicacion({
  state,
  publicacion,
  listingId,
  checkoutLoading,
  checkoutFeedback,
  checkoutIntent,
  compromisoId,
  onCheckout,
  onRetry,
  onRefresh,
  onResolve,
}: {
  state: MercadoState
  publicacion?: TusDiscoveryResponse['items'][number]
  listingId: string
  checkoutLoading: boolean
  checkoutFeedback: TusIntentFeedback | null
  checkoutIntent: TusMarketplaceCheckoutIntent | null
  compromisoId?: string
  onCheckout: (item: TusDiscoveryResponse['items'][number], slot?: TusCalendarSlot) => void
  onRetry: () => void
  onRefresh: () => void
  onResolve: () => void
}): React.ReactNode {
  if (state.status === 'loading' || state.status === 'error') {
    return (
      <section aria-labelledby="publicacion-title">
        <SectionHeading title="Publicación" />
        <TusStateMessage state={{ ...state, retry: state.status === 'error' ? onRefresh : undefined }} />
      </section>
    )
  }
  if (publicacion === undefined) {
    return (
      <section aria-labelledby="publicacion-title">
        <SectionHeading title="Publicación" />
        <TusStateMessage
          state={{
            status: 'empty',
            message: `No encontramos la publicación ${listingId} en el Mercado de servicios actual.`,
          }}
        >
          <a className="tus-action-button tus-action-link" href="/tus/mercado">
            Volver al mercado
          </a>
        </TusStateMessage>
      </section>
    )
  }
  const calendarId = publicacion.calendarId
  const service = publicacion.kind === 'service'
  const budgetRequired = publicacionRequierePresupuesto(publicacion)
  const calendarConfigured = service && publicacion.availabilityStatus === 'configured' && calendarId !== undefined
  const canBook = calendarConfigured && !budgetRequired
  return (
    <section aria-labelledby="publicacion-title">
      <SectionHeading title="Publicación" />
      <p className="tus-evidence-line">La información se obtuvo de la publicación actual devuelta por TUS.</p>
      <CheckoutFeedback
        loading={checkoutLoading}
        feedback={checkoutFeedback}
        intent={checkoutIntent}
        compromisoId={compromisoId}
        onRetry={onRetry}
        onRefresh={onRefresh}
        onResolve={onResolve}
      />
      <div className="tus-detail-layout">
        <PublicacionCard
          copy={copyForPublicacion(publicacion)}
          detailHref={crearEnlacePublicacion(publicacion.listingId)}
          publicacion={publicacion}
          onCheckout={publicacion.kind === 'product' ? () => onCheckout(publicacion) : undefined}
          checkoutLoading={checkoutLoading}
        />
        {canBook && calendarId !== undefined ? (
          <CalendarioCliente
            calendarId={calendarId}
            listingId={publicacion.listingId}
            onReservaConfirmada={(slot) => onCheckout(publicacion, slot)}
          />
        ) : null}
        {service && budgetRequired ? (
          <aside className="tus-state-box" aria-labelledby="calendar-dependency-title">
            <h2 id="calendar-dependency-title">Disponibilidad</h2>
            <TusStateMessage
              state={{
                status: 'disabled',
                code: 'BUDGET_REQUIRED',
                message: 'Este servicio requiere un presupuesto antes de generar o reservar horarios.',
              }}
            />
          </aside>
        ) : service && !calendarConfigured ? (
          <aside className="tus-state-box" aria-labelledby="calendar-dependency-title">
            <h2 id="calendar-dependency-title">Disponibilidad</h2>
            <TusStateMessage
              state={{
                status: 'disabled',
                code: 'NOT_CONFIGURED',
                message: 'Esta publicación todavía no tiene una agenda activa devuelta por discovery.',
              }}
            />
          </aside>
        ) : null}
        <aside className="tus-state-box" aria-labelledby="prestador-title">
          <h2 id="prestador-title">Prestador</h2>
          <p>Identificador disponible en la publicación:</p>
          <strong>{publicacion.merchantId}</strong>
          <small className="tus-boundary-note">
            Dependencia backend futura: discovery todavía no entrega un perfil rico del prestador.
          </small>
        </aside>
      </div>
    </section>
  )
}

function CheckoutFeedback({
  loading,
  feedback,
  intent,
  compromisoId,
  onRetry,
  onRefresh,
  onResolve,
}: {
  loading: boolean
  feedback: TusIntentFeedback | null
  intent: TusMarketplaceCheckoutIntent | null
  compromisoId?: string
  onRetry: () => void
  onRefresh: () => void
  onResolve: () => void
}): React.ReactNode {
  if (loading) return <TusStateMessage state={{ status: 'loading', message: 'Enviando la solicitud a TUS…' }} />
  return (
    <>
      {feedback === null ? null : (
        <TusIntentFeedbackView
          feedback={feedback}
          onAction={
            feedback.action === 'retry'
              ? onRetry
              : feedback.action === 'refresh'
                ? onRefresh
                : feedback.action === 'resolve'
                  ? onResolve
                  : undefined
          }
        />
      )}
      {compromisoId === undefined || intent === null ? null : (
        <div className="tus-state-box" data-status="accepted">
          <strong>Compromiso iniciado</strong>
          <p>El servidor confirmó el compromiso para esta intención.</p>
          <a className="tus-action-button tus-action-link" href={crearEnlaceCompromiso(compromisoId)}>
            Ver compromiso
          </a>
        </div>
      )}
    </>
  )
}

function SectionHeading({ title }: { title: string }): React.ReactNode {
  return (
    <div className="tus-section-label">
      <span>01</span>
      <h2 id={title === 'Publicación' ? 'publicacion-title' : 'mercado-title'}>{title}</h2>
    </div>
  )
}

function copyForPublicacion(publicacion: TusDiscoveryResponse['items'][number]): PublicacionCardCopy {
  return {
    typeLabel: publicacion.kind === 'product' ? 'Producto' : 'Servicio',
    availability:
      publicacion.kind === 'product'
        ? `${publicacion.availableQuantity ?? 0} unidades disponibles`
        : publicacionRequierePresupuesto(publicacion)
          ? 'Presupuesto requerido antes de reservar'
          : `${publicacion.durationMinutes ?? publicacion.estimatedDurationMinutes ?? 'Duración no informada'} min · capacidad ${publicacion.capacity ?? 'no informada'}`,
    policy:
      publicacion.kind === 'product'
        ? 'TUS vuelve a verificar el stock antes de iniciar el compromiso.'
        : publicacionRequierePresupuesto(publicacion)
          ? 'TUS no genera slots ni reservas automáticas hasta contar con un presupuesto.'
          : publicacion.availabilityStatus === 'configured'
            ? 'La disponibilidad y la reserva se confirman contra la agenda activa del prestador.'
            : 'La agenda del prestador no está configurada para esta publicación.',
    actionLabel: publicacion.kind === 'product' ? 'Iniciar compra' : 'Solicitar servicio',
    detailLabel: 'Ver publicación',
    prestadorLabel: 'Prestador',
  }
}

async function iniciarCheckout(
  publicacion: TusDiscoveryResponse['items'][number],
  session: TusWebSession,
  setLoading: (loading: boolean) => void,
  setFeedback: (feedback: TusIntentFeedback) => void,
  setIntent: (intent: TusMarketplaceCheckoutIntent) => void,
  setCompromisoId: (commitmentId: string | undefined) => void,
  franja?: TusCalendarSlot
): Promise<void> {
  const intent = construirIntencionCheckout(publicacion, window.crypto.randomUUID(), franja)
  setIntent(intent)
  setCompromisoId(undefined)
  await enviarCheckout(intent, session, setLoading, setFeedback, setCompromisoId)
}

async function reintentarCheckout(
  intent: TusMarketplaceCheckoutIntent | null,
  session: TusWebSession,
  setLoading: (loading: boolean) => void,
  setFeedback: (feedback: TusIntentFeedback) => void,
  setCompromisoId: (commitmentId: string | undefined) => void
): Promise<void> {
  if (intent === null) return
  await enviarCheckout(intent, session, setLoading, setFeedback, setCompromisoId)
}

async function enviarCheckout(
  intent: TusMarketplaceCheckoutIntent,
  session: TusWebSession,
  setLoading: (loading: boolean) => void,
  setFeedback: (feedback: TusIntentFeedback) => void,
  setCompromisoId: (commitmentId: string | undefined) => void
): Promise<void> {
  setLoading(true)
  try {
    const result = await createTusWebClient(createTusWebFetchTransport()).checkoutMarketplace({
      ...sessionRequestContext(session),
      idempotencyKey: intent.idempotencyKey,
      cartId: intent.cartId,
      requestHash: intent.requestHash,
      lines: intent.lines,
    })
    setFeedback(tusIntentFeedback(result))
    setCompromisoId(commitmentIdFromResult(result))
  } finally {
    setLoading(false)
  }
}

function commitmentIdFromResult(result: TusCheckoutResult): string | undefined {
  if (result.status !== 'accepted' && result.status !== 'replayed') return undefined
  return result.commitments[0]?.commitmentId
}

function resolverFeedback(setFeedback: (feedback: TusIntentFeedback) => void): void {
  setFeedback({
    status: 'conflict',
    intentId: 'preserved',
    message: 'La intención original queda preservada. Actualizá el estado del servidor antes de actuar nuevamente.',
    evidence: 'No se afirma un compromiso nuevo.',
    retryable: false,
    action: 'refresh',
  })
}

function SesionRequerida({
  status,
  message,
  returnTo,
}: {
  status: string
  message: string
  returnTo: string
}): React.ReactNode {
  return (
    <TusStateMessage
      state={{
        status: status === 'unavailable' ? 'error' : 'disabled',
        message,
      }}
    >
      <p>Necesitás una sesión autenticada para consultar publicaciones y comenzar un compromiso.</p>
      <a className="tus-action-button tus-action-link" href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>
        Ingresar a TUS
      </a>
    </TusStateMessage>
  )
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

const mercadoServiciosModule = { MercadoServicios }

export default mercadoServiciosModule
