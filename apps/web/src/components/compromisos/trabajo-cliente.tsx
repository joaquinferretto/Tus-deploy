'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  TusRequestError,
  createTusWebClient,
  createTusWebFetchTransport,
  type TusWork,
  type TusWorkBudget,
  type TusWorkDetail,
} from '@/lib/tus-client'
import { formatTusDate } from '@/lib/tus-journeys'
import { type TusWebSession } from '@/lib/tus-ui-contract'
import { createWorkIntent, type WorkIntent } from '@/lib/tus-work-intent'
import { TusActionButton, TusStateMessage } from '../../app/tus/tus-ui'
import { PagoTrabajo } from './pago-trabajo'

type WorkListState = {
  status: 'loading' | 'ready' | 'empty' | 'disabled' | 'error'
  works: readonly TusWork[]
  message: string
}

type DetailState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  detail: TusWorkDetail | null
  message: string
}

type FeedbackState = {
  status: 'idle' | 'loading' | 'ready' | 'pending' | 'conflict' | 'error'
  message: string
}

const EMPTY_WORK_LIST: WorkListState = {
  status: 'loading',
  works: [],
  message: 'Loading current service work from TUS.',
}

const EMPTY_DETAIL: DetailState = {
  status: 'idle',
  detail: null,
  message: 'Choose service work to inspect its server-confirmed detail.',
}

export function TrabajoCliente({
  session,
  onUnauthorized,
}: {
  session: TusWebSession
  onUnauthorized: () => void
}): ReactNode {
  const [workState, setWorkState] = useState<WorkListState>(EMPTY_WORK_LIST)
  const [detailState, setDetailState] = useState<DetailState>(EMPTY_DETAIL)
  const [feedback, setFeedback] = useState<FeedbackState>({ status: 'idle', message: '' })
  const [rejectionReason, setRejectionReason] = useState('')
  const selectedWorkRef = useRef<string | null>(null)
  const workRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const mutationInFlightRef = useRef(false)
  const retryRef = useRef<(() => Promise<void>) | null>(null)
  // WEB-09E: back from Mercado Pago (`?pago=retorno&trabajo=<id>`): reopen that work and let the
  // payment block confirm against TUS. The URL itself never confirms a payment.
  const returnFromCheckoutRef = useRef<string | null>(null)

  function handleUnauthorized(error: unknown): void {
    if (errorStatus(error) === 401) onUnauthorized()
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const returning = params.get('pago') === 'retorno' ? params.get('trabajo') : null
    if (!returning || !canReadWork(session)) return
    returnFromCheckoutRef.current = returning
    void loadDetail(returning)
  }, [session])

  useEffect(() => {
    if (!canReadWork(session)) {
      setWorkState({
        status: 'disabled',
        works: [],
        message: 'This session does not have the work read permission required by TUS.',
      })
      return
    }
    let cancelled = false
    const requestId = workRequestRef.current + 1
    workRequestRef.current = requestId
    void client()
      .listWork(session)
      .then((response) => {
        if (cancelled || requestId !== workRequestRef.current) return
        const works = response.works.filter((work) => work.tenantId === session.tenantId)
        setWorkState({
          status: works.length === 0 ? 'empty' : 'ready',
          works,
          message:
            works.length === 0
              ? 'No service work is recorded for this customer yet.'
              : 'Service work is current from TUS.',
        })
      })
      .catch((error) => {
        if (cancelled || requestId !== workRequestRef.current) return
        if (errorStatus(error) === 401) onUnauthorized()
        setWorkState({ status: 'error', works: [], message: workErrorMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [onUnauthorized, session])

  async function loadWorks(): Promise<void> {
    const requestId = workRequestRef.current + 1
    workRequestRef.current = requestId
    setWorkState(EMPTY_WORK_LIST)
    try {
      const response = await client().listWork(session)
      if (requestId !== workRequestRef.current) return
      const works = response.works.filter((work) => work.tenantId === session.tenantId)
      setWorkState({
        status: works.length === 0 ? 'empty' : 'ready',
        works,
        message:
          works.length === 0
            ? 'No service work is recorded for this customer yet.'
            : 'Service work is current from TUS.',
      })
    } catch (error) {
      if (requestId !== workRequestRef.current) return
      handleUnauthorized(error)
      setWorkState({ status: 'error', works: [], message: workErrorMessage(error) })
    }
  }

  async function loadDetail(workId: string): Promise<void> {
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId
    selectedWorkRef.current = workId
    setDetailState({
      status: 'loading',
      detail: null,
      message: 'Loading the current work detail from TUS.',
    })
    try {
      const detail = await client().workDetail(session, workId)
      if (requestId !== detailRequestRef.current) return
      if (detail.work.tenantId !== session.tenantId) {
        setDetailState({
          status: 'error',
          detail: null,
          message: 'This work is outside the customer tenant.',
        })
        return
      }
      setDetailState({ status: 'ready', detail, message: 'Current server state loaded.' })
    } catch (error) {
      if (requestId !== detailRequestRef.current) return
      handleUnauthorized(error)
      setDetailState({ status: 'error', detail: null, message: workErrorMessage(error) })
    }
  }

  async function refreshCurrentWork(workId: string): Promise<void> {
    await loadWorks()
    if (selectedWorkRef.current === workId) await loadDetail(workId)
  }

  async function decideBudget(budget: TusWorkBudget, decision: 'accept' | 'reject'): Promise<void> {
    const detail = detailState.detail
    if (!detail || !isLatestIssuedBudget(detail, budget) || !canDecideBudget(session)) return
    const reason = rejectionReason.trim()
    if (decision === 'reject' && reason.length === 0) {
      retryRef.current = null
      setFeedback({
        status: 'error',
        message: 'A reason is required to reject the current budget.',
      })
      return
    }
    await runMutation(
      `${decision === 'accept' ? 'Accepting' : 'Rejecting'} the current budget in TUS.`,
      () =>
        createWorkIntent(`budget-${decision}`, {
          workId: detail.work.trabajoId,
          budgetId: budget.presupuestoId,
          budgetVersion: budget.version,
          decision,
          ...(decision === 'reject' ? { reason } : {}),
        }),
      async (intent) => {
        const input = {
          ...session,
          workId: detail.work.trabajoId,
          budgetId: budget.presupuestoId,
          budgetVersion: budget.version,
          ...(decision === 'reject' ? { reason } : {}),
          ...intent,
        }
        if (decision === 'accept') await client().acceptWorkBudget(input)
        else await client().rejectWorkBudget(input)
        if (decision === 'reject') setRejectionReason('')
        await refreshCurrentWork(detail.work.trabajoId)
      }
    )
  }

  async function runMutation(
    pendingMessage: string,
    createIntent: () => Promise<WorkIntent>,
    operation: (intent: WorkIntent) => Promise<void>
  ): Promise<void> {
    if (mutationInFlightRef.current) return
    mutationInFlightRef.current = true
    retryRef.current = null
    setFeedback({ status: 'loading', message: pendingMessage })
    try {
      const intent = await createIntent()
      retryRef.current = async () => runMutation(pendingMessage, async () => intent, operation)
      await operation(intent)
      setFeedback({ status: 'ready', message: 'TUS confirmed the budget decision.' })
      retryRef.current = null
    } catch (error) {
      handleUnauthorized(error)
      const status =
        errorCode(error) === 'IN_PROGRESS'
          ? 'pending'
          : errorStatus(error) === 409
            ? 'conflict'
            : 'error'
      setFeedback({ status, message: workErrorMessage(error) })
      const workId = selectedWorkRef.current
      if (status === 'conflict' && workId) void refreshCurrentWork(workId)
    } finally {
      mutationInFlightRef.current = false
    }
  }

  const detail = detailState.detail
  const mutationInFlight = feedback.status === 'loading' || feedback.status === 'pending'
  const decisionAllowed = canDecideBudget(session)

  return (
    <section aria-labelledby="customer-work-title">
      <div className="tus-section-label">
        <span>02</span>
        <h2 id="customer-work-title">Service work.</h2>
      </div>
      <p className="tus-evidence-line">
        Budget decisions, work state, and evidence are shown only after TUS confirms them. The
        related commitment remains the source of any scheduled time.
      </p>
      {workState.status === 'ready' ? (
        <div className="tus-commitment-list">
          {workState.works.map((work) => (
            <article className="tus-commitment-card" key={work.trabajoId}>
              <div className="tus-card-kicker">Service work</div>
              <h3>{work.status.replaceAll('_', ' ')}</h3>
              <p>
                {work.budgetRequired
                  ? 'Budget approval is required.'
                  : 'No budget approval is required.'}
              </p>
              <p>Updated: {formatTusDate(work.updatedAt)}</p>
              <div className="tus-session-actions">
                <TusActionButton onClick={() => void loadDetail(work.trabajoId)} type="button">
                  Review work
                </TusActionButton>
                <Link
                  className="tus-action-button tus-action-link"
                  href={`/tus/compromisos/${encodeURIComponent(work.commitmentId)}`}
                >
                  View related commitment
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <TusStateMessage
          state={{
            status: workState.status,
            message: workState.message,
            resource: 'Service work',
            retry: workState.status === 'error' ? () => void loadWorks() : undefined,
          }}
        />
      )}
      {detailState.status === 'idle' ? null : detailState.status === 'ready' && detail ? (
        <section className="tus-state-box" aria-labelledby="customer-work-detail-title">
          <h3 id="customer-work-detail-title">Work detail</h3>
          <p>Current state: {detail.work.status.replaceAll('_', ' ')}</p>
          <p>Budget required: {detail.work.budgetRequired ? 'yes' : 'no'}</p>
          <p>Last update: {formatTusDate(detail.work.updatedAt)}</p>
          <h4>Diagnosis</h4>
          {detail.diagnoses.length === 0 ? (
            <p>No diagnosis has been recorded by TUS.</p>
          ) : (
            <ul>
              {detail.diagnoses.map((diagnosis) => (
                <li key={diagnosis.diagnosticoId}>
                  {diagnosis.status}: {diagnosis.originalDescription}
                </li>
              ))}
            </ul>
          )}
          <h4>Budget versions</h4>
          {detail.budgets.length === 0 ? (
            <p>No budget has been issued by TUS.</p>
          ) : (
            <ul>
              {detail.budgets.map((budget) => {
                const canDecide =
                  decisionAllowed && !mutationInFlight && isLatestIssuedBudget(detail, budget)
                return (
                  <li key={`${budget.presupuestoId}:${budget.version}`}>
                    <strong>Version {budget.version}</strong> {budget.status} - {budget.scope} -{' '}
                    {formatMinorUnits(budget.totalMinor, budget.currency)}
                    {budget.validUntil ? ` - valid until ${formatTusDate(budget.validUntil)}` : ''}
                    {canDecide ? (
                      <div className="tus-session-actions">
                        <TusActionButton
                          onClick={() => void decideBudget(budget, 'accept')}
                          type="button"
                        >
                          Accept current budget
                        </TusActionButton>
                        <label htmlFor="work-budget-rejection-reason">
                          Reason to reject
                          <input
                            id="work-budget-rejection-reason"
                            onChange={(event) => setRejectionReason(event.target.value)}
                            required
                            value={rejectionReason}
                          />
                        </label>
                        <TusActionButton
                          onClick={() => void decideBudget(budget, 'reject')}
                          type="button"
                        >
                          Reject current budget
                        </TusActionButton>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          <h4>Evidence</h4>
          {detail.evidence.length === 0 ? (
            <p>No work evidence has been recorded by TUS.</p>
          ) : (
            <ul>
              {detail.evidence.map((evidence) => (
                <li key={evidence.evidenceId}>
                  {evidence.phase}: {evidence.reference} - {formatTusDate(evidence.occurredAt)}
                  <br />
                  Metadata: {formatEvidenceMetadata(evidence.metadata)}
                </li>
              ))}
            </ul>
          )}
          <PagoTrabajo
            onUnauthorized={onUnauthorized}
            returningFromCheckout={returnFromCheckoutRef.current === detail.work.trabajoId}
            session={session}
            workId={detail.work.trabajoId}
          />
          <h4>History</h4>
          <ul>
            {detail.transitions.map((transition) => (
              <li key={transition.transitionId}>
                {transition.status.replaceAll('_', ' ')} - {formatTusDate(transition.createdAt)}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <TusStateMessage
          state={{
            status: detailState.status,
            message: detailState.message,
            resource: 'Work detail',
            retry:
              detailState.status === 'error' && selectedWorkRef.current
                ? () => void loadDetail(selectedWorkRef.current as string)
                : undefined,
          }}
        />
      )}
      {feedback.status === 'idle' ? null : (
        <TusStateMessage
          state={{
            status: feedback.status,
            message: feedback.message,
            resource: 'Budget decision',
            retry: feedback.status === 'error' ? () => void retryRef.current?.() : undefined,
          }}
        />
      )}
      {feedback.status === 'pending' && retryRef.current ? (
        <TusActionButton onClick={() => void retryRef.current?.()} type="button">
          Retry same intent
        </TusActionButton>
      ) : null}
    </section>
  )
}

function client() {
  return createTusWebClient(createTusWebFetchTransport())
}

function canReadWork(session: TusWebSession): boolean {
  return hasPermission(session, 'tus:work:read') || hasPermission(session, 'tus:marketplace:read')
}

function canDecideBudget(session: TusWebSession): boolean {
  return (
    hasPermission(session, 'tus:work:accept') ||
    hasPermission(session, 'tus:work:write') ||
    hasPermission(session, 'tus:checkout')
  )
}

function hasPermission(session: TusWebSession, permission: string): boolean {
  return (
    session.permissions?.includes(permission) === true ||
    session.permissions?.includes('tus:*') === true
  )
}

function isLatestIssuedBudget(detail: TusWorkDetail, budget: TusWorkBudget): boolean {
  const latestVersion = Math.max(...detail.budgets.map((candidate) => candidate.version))
  return (
    detail.work.status === 'budget_pending' &&
    budget.status === 'issued' &&
    budget.version === latestVersion
  )
}

function formatEvidenceMetadata(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => `${key}: ${String(value)}`)
  return entries.length === 0 ? 'No displayable metadata.' : entries.join('; ')
}

function formatMinorUnits(amount: string, currency: string): string {
  if (!/^\d+$/u.test(amount)) return `Amount unavailable (${currency})`
  return `${new Intl.NumberFormat('es-AR').format(BigInt(amount))} minor units (${currency})`
}

function errorStatus(error: unknown): number | undefined {
  return error instanceof TusRequestError ? error.status : undefined
}

function errorCode(error: unknown): string | undefined {
  return error instanceof TusRequestError ? error.code : undefined
}

function workErrorMessage(error: unknown): string {
  const code = errorCode(error)
  if (code === 'IN_PROGRESS')
    return 'TUS is still processing this intent. Retry the same intent or refresh the work.'
  if (code === 'VERSION_CONFLICT' || code === 'CONCURRENT_MODIFICATION')
    return 'The work changed concurrently. TUS refreshed the current server state.'
  if (code === 'SUPERSEDED_BUDGET')
    return 'A newer budget version exists. Refresh and use the current server version.'
  if (code === 'EXPIRED')
    return 'TUS reports that this budget is expired. Refresh the current state.'
  if (code === 'ALREADY_DECIDED')
    return 'This budget was already decided. TUS remains the source of truth.'
  if (errorStatus(error) === 403)
    return 'This session is not authorized for the requested budget decision.'
  if (errorStatus(error) === 404)
    return 'This work is unavailable in the authenticated tenant scope.'
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return 'TUS did not confirm this work action.'
}

const trabajoClienteModule = { TrabajoCliente }

export default trabajoClienteModule
