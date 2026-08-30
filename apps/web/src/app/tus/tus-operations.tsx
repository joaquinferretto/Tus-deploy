'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import {
  operationalSurfacePresentation,
  sessionRequestContext,
  formatTusDate,
  formatTusNumber,
  type TusWebSession,
} from '@/lib/tus-ui-contract'
import { createTusResourceLoader, type TusResourceStates } from '@/lib/tus-resource-loader'
import {
  createTusSupportDestination,
  resolveTusFreshness,
  resolveTusRoleLabel,
} from '../../lib/tus-journeys'
import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import { createTusWebClient, createTusWebFetchTransport } from '@/lib/tus-client'
import { TusActionButton, TusSkipLink, TusStateMessage } from './tus-ui'

export function TusOperationsSurface(): React.ReactNode {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [resources, setResources] = useState<TusResourceStates | null>(null)
  const [authMessage, setAuthMessage] = useState('Restoring your secure session.')
  const [authStatus, setAuthStatus] = useState<
    'restoring' | 'unauthenticated' | 'expired' | 'unavailable' | 'authenticated'
  >('restoring')

  useEffect(() => {
    void createTusWebAuthClient()
      .restore(window.location.pathname)
      .then((result) => {
        setAuthStatus(result.status)
        setAuthMessage(result.message)
        setSession(result.session === undefined ? null : toTusWebSession(result.session))
      })
  }, [])

  useEffect(() => {
    if (session === undefined) return
    if (session === null) {
      setResources(null)
      return
    }
    let cancelled = false
    const loader = createTusResourceLoader({
      client: createTusWebClient(createTusWebFetchTransport()),
      session: sessionRequestContext(session),
      onUnauthorized: () => {
        createTusWebAuthClient().clearLocalSession()
        setSession(null)
        window.location.assign(`/recovery?returnTo=${encodeURIComponent('/tus/operations')}`)
      },
      onStateChange: (next) => {
        if (!cancelled) setResources(next)
      },
    })
    setResources(loader.snapshot())
    void loader.load()
    return () => {
      cancelled = true
      loader.cancel()
    }
  }, [authMessage, authStatus, session])

  return (
    <>
      <TusSkipLink />
      <main className="tus-shell tus-dashboard" id="tus-main-content">
        <nav className="tus-nav" aria-label="TUS operations navigation">
          <Link className="tus-mark" href="/tus">
            TUS / operations
          </Link>
          <div className="tus-nav-links">
            <Link href="/tus?surface=discovery">Discovery</Link>
            <Link href="/tus/pos">Staff POS</Link>
            <Link href="/tus">Back to workspace</Link>
          </div>
        </nav>
        <header className="tus-workspace-header">
          <div>
            <p className="tus-kicker">{resolveTusRoleLabel(session?.roles)} / operations</p>
            <h1>
              See the work
              <br />
              <em>behind the sale.</em>
            </h1>
          </div>
          <p className="tus-intro">
            <strong>One tenant at a time</strong>Current report facts, discovery inventory, support,
            and WhatsApp handoff stay scoped to the authenticated session.
          </p>
        </header>
        {session === null ? (
          <TusStateMessage
            state={{
              status: authStatus === 'unavailable' ? 'error' : 'disabled',
              message: authMessage,
            }}
          >
            <a
              className="tus-action-button tus-action-link"
              href={`/sign-in?returnTo=${encodeURIComponent('/tus/operations')}`}
            >
              Sign in through TUS
            </a>
          </TusStateMessage>
        ) : resources === null ? (
          <TusStateMessage
            state={{ status: 'loading', message: 'Loading authoritative operations data…' }}
          />
        ) : (
          <ReportContent data={resources} />
        )}
      </main>
    </>
  )
}

function ReportContent({ data }: { data: TusResourceStates }): React.ReactNode {
  const response = data.report.data
  const reportLoading = data.report.status === 'loading'
  const merchantResponse = data.merchant.data
  const listingCount =
    merchantResponse === undefined
      ? 0
      : (merchantResponse.listings ?? merchantResponse.items ?? []).length
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
  const freshness = response === undefined ? null : resolveTusFreshness(response.freshness.stale)
  const supportDestination = createTusSupportDestination(
    process.env['NEXT_PUBLIC_SUPPORT_WHATSAPP_URL']
  )
  return (
    <>
      <section aria-labelledby="report-title">
        <div className="tus-section-label">
          <span>01</span>
          <h2 id="report-title">Operational truth</h2>
        </div>
        {response === undefined ? (
          <TusStateMessage state={data.report} />
        ) : (
          <>
            <p className="tus-evidence-line">
              {response.sourceVersion} · {freshness?.label} · {response.currency} · Latest record{' '}
              {formatTusDate(response.freshness.latestRecordAt)}
            </p>
            {freshness?.action === 'refresh' ? (
                <TusStateMessage state={{ status: freshness.status, message: freshness.message }}>
                <TusActionButton
                  aria-label="Refresh server report"
                  onClick={data.report.retry}
                  disabled={reportLoading}
                  loading={reportLoading}
                  type="button"
                >
                  Refresh server report
                </TusActionButton>
              </TusStateMessage>
            ) : null}
            <div className="tus-metric-grid">
              <Metric label="Supply" value={formatTusNumber(response.dimensions.supply)} />
              <Metric label="Demand" value={formatTusNumber(response.dimensions.demand)} />
              <Metric label="Fulfillment" value={formatTusNumber(response.dimensions.fulfillment)} />
              <Metric label="Settlement aging" value={formatTusNumber(response.dimensions.settlementAging)} />
              <Metric label="Disputes" value={formatTusNumber(response.dimensions.disputes)} />
              <Metric label="Readiness" value={formatTusNumber(response.dimensions.readiness)} />
            </div>
          </>
        )}
      </section>
      {capabilities === null ? null : (
        <section className="tus-boundary-grid" aria-label="Finance delivery and support boundaries">
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
        </section>
      )}
      <section className="tus-operations-note" aria-label="Governed support handoff">
        <strong>Merchant inventory</strong>
        {merchantResponse === undefined ? (
          <TusStateMessage state={data.merchant} />
        ) : (
          <span>{listingCount} tenant-owned listing records returned.</span>
        )}
        <strong>WhatsApp / support</strong>
        <span>
           Search and quote may be conversational. A WhatsApp handoff requires explicit consent,
           authenticated tenant authorization, and a current server confirmation; credentials, payment,
           and settlement decisions never enter chat.
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
      </section>
    </>
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

export default { TusOperationsSurface }
