'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import {
  commitmentPresentation,
  operationalSurfacePresentation,
  sessionRequestContext,
  type CommitmentPresentation,
  type TusWebSession,
} from '@/lib/tus-ui-contract'
import { createTusResourceLoader, type TusResourceStates } from '@/lib/tus-resource-loader'
import {
  buildTusJourneyLinks,
  createTusSupportDestination,
  createTusSurfaceHref,
  formatTusCurrency,
  formatTusDate,
  formatTusNumber,
  resolveTusCatalogFacts,
  resolveTusRoleLabel,
} from '../../lib/tus-journeys'
import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import {
  createTusWebClient,
  createTusWebFetchTransport,
  createStableIdempotencyKey,
  type TusCheckoutResult,
  type TusDiscoveryResponse,
  type TusCustomerCommitmentsResponse,
  type TusMarketplaceLine,
  type TusIntentFeedback,
  tusIntentFeedback,
} from '@/lib/tus-client'
import { TusActionButton, TusIntentFeedbackView, TusSkipLink, TusStateMessage } from './tus-ui'

type Surface = 'discovery' | 'commitments' | 'operations'
type DiscoveryFilter = 'all' | 'products' | 'services'

interface CheckoutIntent {
  intentId: string
  idempotencyKey: string
  cartId: string
  requestHash: string
  lines: TusMarketplaceLine[]
  listingId: string
}

export function TusDashboard(): React.ReactNode {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [authMessage, setAuthMessage] = useState('Restoring your secure session.')
  const [authStatus, setAuthStatus] = useState<
    'restoring' | 'unauthenticated' | 'expired' | 'unavailable' | 'authenticated'
  >('restoring')

  useEffect(() => {
    const authClient = createTusWebAuthClient()
    void authClient.restore(window.location.pathname).then((result) => {
      setAuthStatus(result.status)
      setAuthMessage(result.message)
      setSession(result.session === undefined ? null : toTusWebSession(result.session))
    })
  }, [])

  if (session === undefined) {
    return (
      <>
        <TusSkipLink />
        <main className="tus-shell tus-dashboard" id="tus-main-content">
          <TusStateMessage state={{ status: 'loading', message: 'Restoring your secure session…' }} />
        </main>
      </>
    )
  }
  if (session === null) {
    return <SessionRequired status={authStatus} message={authMessage} />
  }
  return (
    <AuthenticatedDashboard
      session={session}
      onUnauthorized={() => {
        createTusWebAuthClient().clearLocalSession()
        setSession(null)
        window.location.assign(`/recovery?returnTo=${encodeURIComponent('/tus')}`)
      }}
    />
  )
}

function AuthenticatedDashboard({
  session,
  onUnauthorized,
}: {
  session: TusWebSession
  onUnauthorized: () => void
}): React.ReactNode {
  const [activeSurface, setActiveSurface] = useState<Surface>('discovery')
  const [discoveryFilter, setDiscoveryFilter] = useState<DiscoveryFilter>('all')
  const [refreshKey, setRefreshKey] = useState(0)
  const [checkoutFeedback, setCheckoutFeedback] = useState<TusIntentFeedback | null>(null)
  const [checkoutIntent, setCheckoutIntent] = useState<CheckoutIntent | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [resources, setResources] = useState<TusResourceStates | null>(null)
  const loaderRef = useRef<ReturnType<typeof createTusResourceLoader> | null>(null)

  useEffect(() => {
    const surface = new URLSearchParams(window.location.search).get('surface')
    const filter = new URLSearchParams(window.location.search).get('filter')
    if (surface === 'discovery' || surface === 'commitments' || surface === 'operations')
      setActiveSurface(surface)
    if (filter === 'products' || filter === 'services') setDiscoveryFilter(filter)
  }, [])

  function selectSurface(surface: Surface): void {
    setActiveSurface(surface)
    window.history.replaceState(
      null,
      '',
      createTusSurfaceHref(
        surface,
        surface === 'discovery' && discoveryFilter !== 'all' ? { filter: discoveryFilter } : {}
      )
    )
  }

  function selectDiscoveryFilter(filter: DiscoveryFilter): void {
    setDiscoveryFilter(filter)
    window.history.replaceState(
      null,
      '',
      createTusSurfaceHref('discovery', filter === 'all' ? {} : { filter })
    )
  }

  async function signOut(): Promise<void> {
    if (!window.confirm('Sign out of this tenant session?')) return
    setSigningOut(true)
    try {
      await createTusWebAuthClient().signOut()
      window.location.assign('/sign-in?returnTo=%2Ftus')
    } finally {
      setSigningOut(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const loader = createTusResourceLoader({
      client: createTusWebClient(createTusWebFetchTransport()),
      session: sessionRequestContext(session),
      onUnauthorized,
      onStateChange: (next) => {
        if (!cancelled) setResources(next)
      },
    })
    loaderRef.current = loader
    setResources(loader.snapshot())
    void loader.load()
    return () => {
      cancelled = true
      loader.cancel()
      if (loaderRef.current === loader) loaderRef.current = null
    }
  }, [onUnauthorized, refreshKey, session])

  const loadingState = { status: 'loading' as const, message: 'Loading authoritative TUS data…' }

  return (
    <>
      <TusSkipLink />
      <main className="tus-shell tus-dashboard" id="tus-main-content">
        <nav className="tus-nav" aria-label="TUS workspace navigation">
          <Link className="tus-mark" href="/tus">
            TUS / workspace
          </Link>
          <div className="tus-nav-links">
            <span className="tus-session-chip">Tenant scope: {session.tenantId}</span>
            <span className="tus-session-chip">{resolveTusRoleLabel(session.roles)}</span>
            <button
              className="tus-text-button"
              onClick={() => setRefreshKey((value) => value + 1)}
              type="button"
            >
              Refresh truth
            </button>
            <button
              aria-busy={signingOut}
              className="tus-text-button"
              disabled={signingOut}
              onClick={() => void signOut()}
              type="button"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
            <Link href="/tus/pos">Staff POS</Link>
          </div>
        </nav>

        <header className="tus-workspace-header">
          <div>
            <p className="tus-kicker">
              Authenticated surface / contract{' '}
              {resources?.discovery.data?.contractVersion ?? 'pending'}
            </p>
            <h1>
              Run the day
              <br />
              <em>without guessing.</em>
            </h1>
          </div>
          <p className="tus-intro">
            <strong>Server truth only</strong>Every status below is either returned by TUS or
            explicitly marked pending, disabled, conflicted, or unavailable.
          </p>
        </header>

        <nav className="tus-surface-tabs" aria-label="Workspace surfaces">
          {buildTusJourneyLinks(session).map((journey) =>
            renderJourneyLink(journey, activeSurface, selectSurface)
          )}
          <Link className="tus-nav-pos" href="/tus/pos">
            Staff POS <span>↗</span>
          </Link>
        </nav>

        {resources === null ? (
          <TusStateMessage state={loadingState} />
        ) : (
          <SurfaceContent
            surface={activeSurface}
            resources={resources}
            session={session}
            discoveryFilter={discoveryFilter}
            onDiscoveryFilter={selectDiscoveryFilter}
            checkoutFeedback={checkoutFeedback}
            checkoutLoading={checkoutLoading}
            onCheckout={async (item) => {
              const intent = createCheckoutIntent(item)
              setCheckoutIntent(intent)
              await submitCheckout(intent, session, setCheckoutLoading, setCheckoutFeedback)
            }}
            onRetry={async () => {
              if (checkoutIntent === null) return
              await submitCheckout(checkoutIntent, session, setCheckoutLoading, setCheckoutFeedback)
            }}
            onRefresh={() => setRefreshKey((value) => value + 1)}
            onResolve={() =>
              setCheckoutFeedback((current) =>
                current === null
                  ? null
                  : {
                      ...current,
                      message:
                        'The original intent remains preserved for review. Refresh before taking another action.',
                      action: 'refresh',
                    }
              )
            }
          />
        )}
      </main>
    </>
  )
}

function renderJourneyLink(
  journey: ReturnType<typeof buildTusJourneyLinks>[number],
  activeSurface: Surface,
  onSelect: (surface: Surface) => void
): React.ReactNode {
  if (journey.key === 'pos') return null
  if (!journey.allowed)
    return (
      <span
        aria-disabled="true"
        className="tus-nav-disabled"
        data-surface={journey.key}
        key={journey.key}
      >
        {journey.label}
        <small>{journey.description}</small>
      </span>
    )
  return (
    <a
      aria-current={activeSurface === journey.key ? 'page' : undefined}
      data-surface={journey.key}
      href={journey.href}
      key={journey.key}
      onClick={(event) => {
        event.preventDefault()
        onSelect(journey.key as Surface)
      }}
    >
      {journey.label}
    </a>
  )
}

function SessionRequired({
  status,
  message,
}: {
  status: 'restoring' | 'unauthenticated' | 'expired' | 'unavailable' | 'authenticated'
  message: string
}): React.ReactNode {
  const presentation =
    status === 'unavailable' ? 'error' : status === 'expired' ? 'disabled' : 'disabled'
  return (
    <>
      <TusSkipLink />
      <main className="tus-shell tus-auth-required" id="tus-main-content">
        <nav className="tus-nav" aria-label="TUS primary navigation">
          <Link className="tus-mark" href="/tus">
            TUS / platform
          </Link>
        </nav>
        <TusStateMessage state={{ status: presentation, message }}>
          <p>
            An authenticated tenant session is required before marketplace, reporting, or support
            data can be shown. Tenant and actor scope are never entered here.
          </p>
          <a
            className="tus-action-button tus-action-link"
            href={`/sign-in?returnTo=${encodeURIComponent('/tus')}`}
          >
            Sign in through TUS
          </a>
        </TusStateMessage>
      </main>
    </>
  )
}

function SurfaceContent({
  surface,
  resources,
  session: _session,
  discoveryFilter,
  onDiscoveryFilter,
  checkoutFeedback,
  checkoutLoading,
  onCheckout,
  onRetry,
  onRefresh,
  onResolve,
}: {
  surface: Surface
  resources: TusResourceStates
  session: TusWebSession
  discoveryFilter: DiscoveryFilter
  onDiscoveryFilter: (filter: DiscoveryFilter) => void
  checkoutFeedback: TusIntentFeedback | null
  checkoutLoading: boolean
  onCheckout: (item: TusDiscoveryResponse['items'][number]) => Promise<void>
  onRetry: () => Promise<void>
  onRefresh: () => void
  onResolve: () => void
}): React.ReactNode {
  if (surface === 'discovery')
    return (
      <DiscoverySurface
        state={resources.discovery}
        filter={discoveryFilter}
        onFilter={onDiscoveryFilter}
        checkoutFeedback={checkoutFeedback}
        checkoutLoading={checkoutLoading}
        onCheckout={onCheckout}
        onRetry={onRetry}
        onRefresh={onRefresh}
        onResolve={onResolve}
      />
    )
  if (surface === 'commitments') return <CommitmentsSurface state={resources.commitments} />
  return <OperationsSurface report={resources.report} merchant={resources.merchant} />
}

function DiscoverySurface({
  state,
  filter,
  onFilter,
  checkoutFeedback,
  checkoutLoading,
  onCheckout,
  onRetry,
  onRefresh,
  onResolve,
}: {
  state: TusResourceStates['discovery']
  filter: DiscoveryFilter
  onFilter: (filter: DiscoveryFilter) => void
  checkoutFeedback: TusIntentFeedback | null
  checkoutLoading: boolean
  onCheckout: (item: TusDiscoveryResponse['items'][number]) => Promise<void>
  onRetry: () => Promise<void>
  onRefresh: () => void
  onResolve: () => void
}): React.ReactNode {
  if (state.data === undefined)
    return (
      <section aria-labelledby="discovery-title">
        <div className="tus-section-label">
          <span>01</span>
          <h2 id="discovery-title">Current offers, close by.</h2>
        </div>
        <TusStateMessage state={state} />
      </section>
    )
  const response = state.data
  const items =
    filter === 'all'
      ? response.items
      : response.items.filter(
          (item) => item.kind === (filter === 'products' ? 'product' : 'service')
        )
  return (
    <section aria-labelledby="discovery-title">
      <div className="tus-section-label">
        <span>01</span>
        <h2 id="discovery-title">Current offers, close by.</h2>
      </div>
      <p className="tus-evidence-line">
        Evidence: {response.evidence ?? 'deferred'} · Locale and currency come from each listing.
      </p>
      <label className="tus-filter-control" htmlFor="discovery-filter">
        Show{' '}
        <select
          id="discovery-filter"
          name="discoveryFilter"
          value={filter}
          onChange={(event) => onFilterChange(event, onFilter)}
        >
          <option value="all">all offers</option>
          <option value="products">products only</option>
          <option value="services">services only</option>
        </select>
      </label>
      {checkoutLoading ? (
        <TusStateMessage state={{ status: 'loading', message: 'Submitting this intent to TUS…' }} />
      ) : null}
      {checkoutFeedback === null ? null : (
        <TusIntentFeedbackView
          feedback={checkoutFeedback}
          onAction={
            checkoutFeedback.action === 'retry'
              ? () => void onRetry()
              : checkoutFeedback.action === 'refresh'
                ? onRefresh
                : checkoutFeedback.action === 'resolve'
                  ? onResolve
                  : undefined
          }
        />
      )}
      {items.length === 0 ? (
        <TusStateMessage
          state={{
            status: 'empty',
            message:
              filter === 'all'
                ? 'No published offers are available for this authorized scope.'
                : `No ${filter} offers are available for this authorized scope.`,
          }}
        />
      ) : (
        <div className="tus-offer-grid">
          {items.map((item) => {
            const facts = resolveTusCatalogFacts(item)
            return (
              <article className="tus-offer-card" data-kind={item.kind} key={item.listingId}>
                <div className="tus-card-kicker">
                  {facts.context} · {item.cohort}
                </div>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                <div className="tus-offer-meta">
                  <strong>{facts.price}</strong>
                  <span>{facts.availability}</span>
                </div>
                <TusActionButton
                  disabled={checkoutLoading}
                  loading={checkoutLoading}
                  loadingLabel="Sending to TUS…"
                  onClick={() => void onCheckout(item)}
                  type="button"
                >
                  {item.kind === 'service' ? 'Request service slot' : 'Start product commitment'}
                </TusActionButton>
                <small className="tus-boundary-note">{facts.policy}</small>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function onFilterChange(
  event: React.ChangeEvent<HTMLSelectElement>,
  onFilter: (filter: DiscoveryFilter) => void
): void {
  const filter = event.target.value
  if (filter === 'products' || filter === 'services' || filter === 'all') {
    onFilter(filter)
  }
}

function CommitmentsSurface({
  state,
}: {
  state: TusResourceStates['commitments']
}): React.ReactNode {
  if (state.data === undefined)
    return (
      <section aria-labelledby="commitments-title">
        <div className="tus-section-label">
          <span>02</span>
          <h2 id="commitments-title">Two promises, two timelines.</h2>
        </div>
        <TusStateMessage state={state} />
      </section>
    )
  const response = state.data
  return (
    <section aria-labelledby="commitments-title">
      <div className="tus-section-label">
        <span>02</span>
        <h2 id="commitments-title">Two promises, two timelines.</h2>
      </div>
      <p className="tus-evidence-line">
        Product delivery, service completion, payment provider state, and settlement eligibility are
        separate facts.
      </p>
      {response.commitments.length === 0 ? (
        <TusStateMessage
          state={{
            status: 'empty',
            message: 'No customer commitments have been returned for this tenant.',
          }}
        />
      ) : (
        <div className="tus-commitment-list">
          {response.commitments.map((commitment) => (
            <CommitmentCard key={commitment.commitmentId} commitment={commitment} />
          ))}
        </div>
      )}
    </section>
  )
}

function CommitmentCard({
  commitment,
}: {
  commitment: TusCustomerCommitmentsResponse['commitments'][number]
}): React.ReactNode {
  const presentation: CommitmentPresentation = {
    ...commitmentPresentation(commitment),
  }
  return (
    <article className={`tus-commitment-card tus-tone-${presentation.statusTone}`}>
      <div className="tus-card-kicker">
        {presentation.label} · {commitment.commitmentId}
      </div>
      <h3>{presentation.status}</h3>
      <p>
         {formatTusCurrency(commitment.amount, commitment.currency)} · version {commitment.version}
      </p>
      <p className="tus-boundary-note">{presentation.evidence}</p>
      <TusActionButton disabled aria-disabled="true" type="button">
        Secure payment handoff requires explicit server confirmation
      </TusActionButton>
    </article>
  )
}

function OperationsSurface({
  report,
  merchant,
}: {
  report: TusResourceStates['report']
  merchant: TusResourceStates['merchant']
}): React.ReactNode {
  const response = report.data
  const merchantResponse = merchant.data
  const listings =
    merchantResponse === undefined
      ? []
      : (merchantResponse.listings ?? merchantResponse.items ?? [])
  const capabilities =
    response === undefined
      ? null
      : operationalSurfacePresentation({
          stale: response.freshness.stale,
          dimensions: {
            payment: response.dimensions.payment,
            settlementAging: response.dimensions.settlementAging,
            fulfillment: response.dimensions.fulfillment,
            disputes: response.dimensions.disputes,
            whatsappActions: response.dimensions.whatsappActions,
          },
        })
  const supportDestination = createTusSupportDestination(
    process.env['NEXT_PUBLIC_SUPPORT_WHATSAPP_URL']
  )
  return (
    <section aria-labelledby="operations-title">
      <div className="tus-section-label">
        <span>03</span>
        <h2 id="operations-title">The edges stay visible.</h2>
      </div>
      {response === undefined ? (
        <TusStateMessage state={report} />
      ) : (
        <>
          <p className="tus-evidence-line">
            Source: {response.sourceVersion} ·{' '}
            {response.freshness.stale
              ? 'Report is stale — refresh before acting.'
              : 'Freshness window is current.'}{' '}
            · Latest record {formatTusDate(response.freshness.latestRecordAt)}
          </p>
          <div className="tus-metric-grid">
            <Metric label="Supply" value={formatTusNumber(response.dimensions.supply)} />
            <Metric label="Demand" value={formatTusNumber(response.dimensions.demand)} />
            <Metric label="Fulfillment" value={formatTusNumber(response.dimensions.fulfillment)} />
            <Metric label="Payment aging" value={formatTusNumber(response.dimensions.settlementAging)} />
            <Metric label="Disputes" value={formatTusNumber(response.dimensions.disputes)} />
            <Metric label="POS offline" value={formatTusNumber(response.dimensions.posOffline)} />
          </div>
          {capabilities === null ? null : <OperationalBoundaries capabilities={capabilities} />}
        </>
      )}
      <div className="tus-operations-note">
        <strong>Merchant discovery</strong>
        {merchantResponse === undefined ? (
          <TusStateMessage state={merchant} />
        ) : (
          <span>{listings.length} tenant-owned listing records returned.</span>
        )}
        <strong>Support / WhatsApp</strong>
        <span>
          A governed WhatsApp handoff requires explicit consent, tenant-scoped authorization, and a
          current server confirmation. Credentials, payment details, and settlement decisions never
          enter chat.
        </span>
        {supportDestination === undefined ? (
          <span>Support destination is not configured; no external handoff link is exposed.</span>
        ) : (
          <a
            className="tus-action-button tus-action-link"
            href={supportDestination}
            rel="noreferrer"
            target="_blank"
          >
            Continue to governed WhatsApp support
          </a>
        )}
      </div>
    </section>
  )
}

function OperationalBoundaries({
  capabilities,
}: {
  capabilities: ReturnType<typeof operationalSurfacePresentation>
}): React.ReactNode {
  return (
    <div className="tus-boundary-grid" aria-label="Finance delivery and support boundaries">
      {[capabilities.finance, capabilities.delivery, capabilities.support].map((capability) => (
        <article
          className="tus-boundary-card"
          data-status={capability.status}
          key={capability.label}
        >
          <div className="tus-card-kicker">
            {capability.label} · {capability.status}
          </div>
          <strong>{capability.metric}</strong>
          <p>{capability.message}</p>
          <small>{capability.evidence}</small>
        </article>
      ))}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <div className="tus-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function createCheckoutIntent(item: TusDiscoveryResponse['items'][number]): CheckoutIntent {
  const intentId = window.crypto.randomUUID()
  const slotStart =
    item.kind === 'service' ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : undefined
  const slotEnd =
    item.kind === 'service' && slotStart !== undefined
      ? new Date(Date.parse(slotStart) + (item.durationMinutes ?? 0) * 60 * 1000).toISOString()
      : undefined
  const lines: TusMarketplaceLine[] = [
    {
      lineId: `line-${intentId}`,
      listingId: item.listingId,
      context: item.kind,
      quantity: 1,
      availabilityVersion: item.availabilityVersion,
      ...(slotStart === undefined ? {} : { slotStart, slotEnd }),
    },
  ]
  return {
    intentId,
    idempotencyKey: createStableIdempotencyKey('checkout', intentId),
    cartId: `cart-${intentId}`,
    requestHash: `discovery:${item.listingId}:${item.availabilityVersion}:${slotStart ?? 'product'}`,
    lines,
    listingId: item.listingId,
  }
}

async function submitCheckout(
  intent: CheckoutIntent,
  session: TusWebSession,
  setLoading: (loading: boolean) => void,
  setFeedback: (feedback: TusIntentFeedback) => void
): Promise<void> {
  setLoading(true)
  try {
    const result = await checkoutListing(intent, session)
    setFeedback(tusIntentFeedback(result))
  } finally {
    setLoading(false)
  }
}

async function checkoutListing(
  intent: CheckoutIntent,
  session: TusWebSession
): Promise<TusCheckoutResult> {
  const client = createTusWebClient(createTusWebFetchTransport())
  return client.checkoutMarketplace({
    ...sessionRequestContext(session),
    idempotencyKey: intent.idempotencyKey,
    cartId: intent.cartId,
    requestHash: intent.requestHash,
    lines: intent.lines,
  })
}
