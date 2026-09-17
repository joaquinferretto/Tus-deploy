'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

import {
  formatTusCurrency,
  formatTusDate,
  posFeedback,
  type PosFeedback,
  type TusWebSession,
} from '@/lib/tus-ui-contract'
import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import {
  classifyTusRequestError,
  createStableIdempotencyKey,
  createTusWebClient,
  createTusWebFetchTransport,
  type TusPosOperation,
  type TusPosOperationStatus,
  type TusPosResponse,
  type TusPosSession,
} from '@/lib/tus-client'
import { resolveTusRoleLabel } from '../../lib/tus-journeys'
import { TusActionButton, TusFieldError, TusStateMessage } from './tus-ui'

const POS_CONTEXT = {
  PRODUCT: 'product',
  SERVICE: 'service',
} as const

type PosContext = (typeof POS_CONTEXT)[keyof typeof POS_CONTEXT]

type RecentPosOperation = {
  operation: TusPosOperation
  status: TusPosResponse['status'] | TusPosOperationStatus['status']
  reason?: string
}

const POS_CONTEXT_PRESENTATION: Record<PosContext, { label: string; description: string }> = {
  product: {
    label: 'Product sale',
    description: 'Stock and product commitment facts stay separate from service capacity.',
  },
  service: {
    label: 'Service capture',
    description: 'Capacity and service timing stay separate from product stock.',
  },
}

export function TusPosSurface(): React.ReactNode {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [authMessage, setAuthMessage] = useState('Restoring your secure session…')
  const [authStatus, setAuthStatus] = useState<
    'restoring' | 'unauthenticated' | 'expired' | 'unavailable' | 'authenticated'
  >('restoring')
  const [context, setContext] = useState<PosContext>(POS_CONTEXT.PRODUCT)
  const [amount, setAmount] = useState('0')
  const [feedback, setFeedback] = useState<PosFeedback | null>(null)
  const [operation, setOperation] = useState<TusPosOperation | null>(null)
  const [posSession, setPosSession] = useState<TusPosSession | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionBusy, setSessionBusy] = useState(false)
  const [recentOperations, setRecentOperations] = useState<RecentPosOperation[]>([])
  const [refreshingOperationId, setRefreshingOperationId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void createTusWebAuthClient()
      .restore(window.location.pathname)
      .then((result) => {
        setAuthStatus(result.status)
        setAuthMessage(result.message)
        setSession(result.session === undefined ? null : toTusWebSession(result.session))
      })
  }, [])

  async function recordOperation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (session === null || session === undefined || posSession === null) return

    const amountValue = Number(amount)
    if (!Number.isSafeInteger(amountValue) || amountValue <= 0) return
    const nextOperation = createOperation(session, posSession, context, amountValue)
    setOperation(nextOperation)
    await sendOperation(nextOperation)
  }

  async function openSession(): Promise<void> {
    if (session === null || session === undefined || sessionBusy) return
    setSessionBusy(true)
    setSessionError(null)
    const client = createTusWebClient(createTusWebFetchTransport())
    const sessionId = window.crypto.randomUUID()
    const shiftId = `web-shift-${window.crypto.randomUUID()}`
    const deviceId = 'web-pos'
    try {
      await client.registerPosDevice({
        ...session,
        deviceId,
        label: 'TUS Web POS',
        fingerprint: 'tus-web-pos-v1',
      })
      const opened = await client.openPosSession({ ...session, sessionId, deviceId, shiftId })
      setPosSession(opened)
    } catch (error) {
      if (errorStatus(error) === 401) {
        createTusWebAuthClient().clearLocalSession()
        setSession(null)
      }
      setSessionError(readRequestMessage(error, 'TUS could not open the POS session.'))
    } finally {
      setSessionBusy(false)
    }
  }

  async function closeSession(): Promise<void> {
    if (session === null || session === undefined || posSession === null || sessionBusy) return
    setSessionBusy(true)
    setSessionError(null)
    try {
      const closed = await createTusWebClient(createTusWebFetchTransport()).closePosSession(
        session,
        posSession.sessionId
      )
      setPosSession(closed)
    } catch (error) {
      setSessionError(readRequestMessage(error, 'TUS could not close the POS session.'))
    } finally {
      setSessionBusy(false)
    }
  }

  async function sendOperation(nextOperation: TusPosOperation): Promise<void> {
    setSubmitting(true)
    setFeedback(null)
    try {
      const response = await createTusWebClient(createTusWebFetchTransport()).recordManualOperation(
        nextOperation
      )
      setFeedback(posFeedback(response))
      upsertRecentOperation(nextOperation, response.status, response.reason)
    } catch (error) {
      if (errorStatus(error) === 401) {
        createTusWebAuthClient().clearLocalSession()
        setSession(null)
      }
      const classified = classifyTusRequestError(error, nextOperation.operationId)
      const nextFeedback: PosFeedback = {
        status:
          classified.status === 'conflict'
            ? 'conflict'
            : classified.status === 'pending'
              ? 'pending'
              : 'error',
        operationId: nextOperation.operationId,
        message: classified.message,
        evidence: classified.evidence,
        retryable: classified.retryable,
        action:
          classified.action === 'resolve'
            ? 'resolve'
            : classified.action === 'refresh'
              ? 'refresh'
              : 'retry',
      }
      setFeedback(nextFeedback)
      upsertRecentOperation(nextOperation, nextFeedback.status, nextFeedback.evidence)
    } finally {
      setSubmitting(false)
    }
  }

  async function refreshOperationStatus(recent: RecentPosOperation): Promise<void> {
    if (session === null || session === undefined || refreshingOperationId !== null) return
    setRefreshingOperationId(recent.operation.operationId)
    try {
      const response = await createTusWebClient(createTusWebFetchTransport()).posOperationStatus(
        session,
        recent.operation.operationId
      )
      const nextFeedback = posFeedback({
        ...response,
        status: response.status === 'not_found' ? 'pending' : response.status,
        reason: response.reason ?? (response.status === 'not_found' ? 'operation_not_found' : undefined),
      })
      setOperation(recent.operation)
      setFeedback(nextFeedback)
      upsertRecentOperation(recent.operation, response.status, response.reason)
    } catch (error) {
      const classified = classifyTusRequestError(error, recent.operation.operationId)
      setOperation(recent.operation)
      setFeedback({
        status: classified.status,
        operationId: recent.operation.operationId,
        message: classified.message,
        evidence: classified.evidence,
        retryable: classified.retryable,
        action:
          classified.action === 'resolve'
            ? 'resolve'
            : classified.action === 'refresh'
              ? 'refresh'
              : 'retry',
      })
      upsertRecentOperation(recent.operation, classified.status, classified.evidence)
    } finally {
      setRefreshingOperationId(null)
    }
  }

  function upsertRecentOperation(
    nextOperation: TusPosOperation,
    status: RecentPosOperation['status'],
    reason?: string
  ): void {
    setRecentOperations((current) => {
      const next = { operation: nextOperation, status, ...(reason === undefined ? {} : { reason }) }
      return [next, ...current.filter((item) => item.operation.operationId !== nextOperation.operationId)]
    })
  }

  function resolveFeedback(): void {
    setFeedback((current) =>
      current === null
        ? null
        : {
            ...current,
            message:
              'The operation remains preserved for review. Refresh before taking another action.',
            action: 'refresh',
          }
    )
  }

  const numericAmount = Number(amount)
  const amountError =
    Number.isSafeInteger(numericAmount) && numericAmount > 0
      ? null
      : 'Enter a whole amount greater than zero.'
  const canSubmit = !submitting && posSession?.status === 'open' && amountError === null

  return (
    <>
      <div className="tus-nav-links tus-session-actions">
        <Link href="/tus?surface=discovery">Market</Link>
        <Link href="/tus/operations">Operations</Link>
      </div>
      <header className="tus-workspace-header">
        <div>
          <p className="tus-kicker">{resolveTusRoleLabel(session?.roles)} / bounded capture</p>
          <h1>
            Keep the counter
            <br />
            <em>moving honestly.</em>
          </h1>
        </div>
        <p className="tus-intro">
          <strong>Local operations only</strong>Every receipt needs server acknowledgement.
          Provider capture, settlement, and payout remain unclaimed.
        </p>
      </header>
      {session === undefined ? (
        <TusStateMessage
          state={{ status: 'loading', message: 'Restoring your secure session…' }}
        />
      ) : session === null ? (
        <TusStateMessage
          state={{
            status: authStatus === 'unavailable' ? 'error' : 'disabled',
            message: authMessage,
          }}
        >
          <a
            className="tus-action-button tus-action-link"
            href={`/sign-in?returnTo=${encodeURIComponent('/tus/pos')}`}
          >
            Sign in through TUS
          </a>
        </TusStateMessage>
      ) : (
        <div className="tus-pos-workspace">
          <section className="tus-pos-session" aria-labelledby="pos-session-title">
            <div className="tus-section-label">
              <span>01</span>
              <h2 id="pos-session-title">Open a real counter session.</h2>
            </div>
            {posSession === null ? (
              <div className="tus-pos-session-state" data-status="closed">
                <div>
                  <strong>Closed</strong>
                  <span>No operations can be sent until TUS opens a device-bound shift.</span>
                </div>
                <TusActionButton
                  disabled={sessionBusy}
                  loading={sessionBusy}
                  loadingLabel="Opening session…"
                  onClick={() => void openSession()}
                  type="button"
                >
                  Open POS session
                </TusActionButton>
              </div>
            ) : (
              <div className="tus-pos-session-state" data-status={posSession.status}>
                <div>
                  <strong>{posSession.status === 'open' ? 'Open' : 'Closed'}</strong>
                  <span>Started {formatTusDate(posSession.openedAt)}</span>
                  <small>
                    Device TUS Web POS · {posSession.status === 'open' ? 'Server session active' : `Closed ${formatTusDate(posSession.closedAt)}`}
                  </small>
                </div>
                {posSession.status === 'open' ? (
                  <TusActionButton
                    disabled={sessionBusy || submitting}
                    loading={sessionBusy}
                    loadingLabel="Closing session…"
                    onClick={() => void closeSession()}
                    type="button"
                  >
                    Close POS session
                  </TusActionButton>
                ) : (
                  <TusActionButton
                    disabled={sessionBusy}
                    loading={sessionBusy}
                    loadingLabel="Opening session…"
                    onClick={() => void openSession()}
                    type="button"
                  >
                    Open another session
                  </TusActionButton>
                )}
              </div>
            )}
            {sessionError === null ? null : (
              <p className="tus-auth-error" role="alert">{sessionError}</p>
            )}
          </section>

          <form
            className="tus-pos-panel"
            aria-labelledby="pos-panel-title"
            onSubmit={(event) => void recordOperation(event)}
            noValidate
          >
            <div className="tus-section-label">
              <span>02</span>
              <h2 id="pos-panel-title">Record a bounded operation.</h2>
            </div>
            <fieldset disabled={posSession?.status !== 'open' || submitting}>
              <legend className="tus-visually-hidden">Operation details</legend>
              <div className="tus-pos-controls">
                <label htmlFor="commitment-context">
                  Commitment context
                  <select
                    aria-describedby="commitment-context-note"
                    autoComplete="off"
                    id="commitment-context"
                    name="commitmentContext"
                    value={context}
                    onChange={(event) => setContext(event.target.value as PosContext)}
                  >
                    <option value={POS_CONTEXT.PRODUCT}>Product sale</option>
                    <option value={POS_CONTEXT.SERVICE}>Service capture</option>
                  </select>
                  <small id="commitment-context-note" className="tus-field-note">
                    {POS_CONTEXT_PRESENTATION[context].description}
                  </small>
                </label>
                <label htmlFor="operation-amount">
                  Amount (ARS)
                  <input
                    aria-describedby={amountError === null ? undefined : 'operation-amount-error'}
                    aria-errormessage={amountError === null ? undefined : 'operation-amount-error'}
                    aria-invalid={amountError !== null}
                    autoComplete="off"
                    id="operation-amount"
                    inputMode="decimal"
                    min="1"
                    name="amount"
                    onChange={(event) => setAmount(event.target.value)}
                    required
                    step="1"
                    type="number"
                    value={amount}
                  />
                  {amountError === null ? null : (
                    <TusFieldError id="operation-amount-error" message={amountError} />
                  )}
                </label>
              </div>
            </fieldset>
            <TusActionButton
              disabled={!canSubmit}
              loading={submitting}
              loadingLabel="Waiting for TUS…"
              type="submit"
            >
              Send to TUS
            </TusActionButton>
            {feedback === null ? (
              <p className="tus-boundary-note">
                No local success state is shown. Pending and conflicts stay visible until the server
                responds.
              </p>
            ) : (
              <div
                aria-atomic="true"
                aria-live={
                  feedback.status === 'conflict' || feedback.status === 'error'
                    ? 'assertive'
                    : 'polite'
                }
                className={`tus-pos-feedback tus-feedback-${feedback.status}`}
                data-status={feedback.status}
                role={
                  feedback.status === 'conflict' || feedback.status === 'error' ? 'alert' : 'status'
                }
              >
                <strong>{feedback.status}</strong>
                <span>{feedback.message}</span>
                <small>
                  {feedback.evidence}
                </small>
                {feedback.action === 'resolve' ? (
                  <TusActionButton onClick={resolveFeedback} type="button">
                    Review preserved operation
                  </TusActionButton>
                ) : operation === null ? null : (
                  <TusActionButton
                    disabled={submitting}
                    loading={submitting}
                    loadingLabel="Checking TUS…"
                    onClick={() =>
                      feedback.action === 'refresh'
                        ? void refreshOperationStatus({ operation, status: feedback.status })
                        : void sendOperation(operation)
                    }
                    type="button"
                  >
                    {feedback.action === 'refresh'
                      ? 'Refresh server status'
                      : 'Retry same operation'}
                  </TusActionButton>
                )}
              </div>
            )}
          </form>

          <section className="tus-pos-recent" aria-labelledby="pos-recent-title">
            <div className="tus-section-label">
              <span>03</span>
              <h2 id="pos-recent-title">Operations from this visit.</h2>
            </div>
            {recentOperations.length === 0 ? (
              <TusStateMessage
                state={{
                  status: 'empty',
                  message: 'No operations were recorded during this visit.',
                }}
              />
            ) : (
              <ul className="tus-pos-operation-list">
                {recentOperations.map((recent) => (
                  <li key={recent.operation.operationId}>
                    <div>
                      <time dateTime={recent.operation.createdAt}>{formatTusDate(recent.operation.createdAt)}</time>
                      <strong>
                        {POS_CONTEXT_PRESENTATION[recent.operation.context].label} ·{' '}
                        {formatTusCurrency(recent.operation.amount, recent.operation.currency)}
                      </strong>
                      <span data-status={recent.status}>{presentOperationStatus(recent.status)}</span>
                    </div>
                    <TusActionButton
                      disabled={refreshingOperationId !== null || submitting}
                      loading={refreshingOperationId === recent.operation.operationId}
                      loadingLabel="Refreshing…"
                      onClick={() => void refreshOperationStatus(recent)}
                      type="button"
                    >
                      Refresh status
                    </TusActionButton>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  )
}

function createOperation(
  session: TusWebSession,
  posSession: TusPosSession,
  context: PosContext,
  amount: number
): TusPosOperation {
  const operationId = window.crypto.randomUUID()
  return {
    ...session,
    operationId,
    idempotencyKey: createStableIdempotencyKey('pos', operationId),
    kind: context === POS_CONTEXT.PRODUCT ? 'manual-sale' : 'manual-service',
    context,
    amount,
    currency: 'ARS',
    deviceId: posSession.deviceId,
    shiftId: posSession.shiftId,
    schemaVersion: '1.0.0',
    createdAt: new Date().toISOString(),
  }
}

function presentOperationStatus(status: RecentPosOperation['status']): string {
  if (status === 'accepted') return 'Accepted'
  if (status === 'replayed') return 'Replayed safely'
  if (status === 'pending' || status === 'queued-offline') return 'Pending confirmation'
  if (status === 'conflict') return 'Review required'
  if (status === 'not_found') return 'Not found on server'
  return 'Unable to confirm'
}

function readRequestMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return fallback
}

function errorStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  )
    return error.status
  return undefined
}

const tusPosModule = { TusPosSurface }

export default tusPosModule
