'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

import { posFeedback, type PosFeedback, type TusWebSession } from '@/lib/tus-ui-contract'
import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import {
  classifyTusRequestError,
  createStableIdempotencyKey,
  createTusWebClient,
  createTusWebFetchTransport,
  type TusPosOperation,
} from '@/lib/tus-client'
import { resolveTusRoleLabel } from '../../lib/tus-journeys'
import { TusActionButton, TusFieldError, TusStateMessage } from './tus-ui'

const POS_CONTEXT = {
  PRODUCT: 'product',
  SERVICE: 'service',
} as const

type PosContext = (typeof POS_CONTEXT)[keyof typeof POS_CONTEXT]

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
    if (session === null || session === undefined) return

    const amountValue = Number(amount)
    if (!Number.isFinite(amountValue) || amountValue <= 0) return
    const sameIntent =
      operation !== null && operation.context === context && operation.amount === amountValue
    const nextOperation: TusPosOperation =
      sameIntent && operation !== null ? operation : createOperation(session, context, amountValue)
    setOperation(nextOperation)
    await sendOperation(nextOperation)
  }

  async function sendOperation(nextOperation: TusPosOperation): Promise<void> {
    setSubmitting(true)
    setFeedback(null)
    try {
      const response = await createTusWebClient(createTusWebFetchTransport()).recordManualOperation(
        nextOperation
      )
      setFeedback(posFeedback(response))
    } catch (error) {
      if (errorStatus(error) === 401) {
        createTusWebAuthClient().clearLocalSession()
        setSession(null)
      }
      const classified = classifyTusRequestError(error, nextOperation.operationId)
      setFeedback({
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
      })
    } finally {
      setSubmitting(false)
    }
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
    Number.isFinite(numericAmount) && numericAmount > 0
      ? null
      : 'Enter an amount greater than zero.'
  const canSubmit = !submitting && amountError === null

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
          <form
            className="tus-pos-panel"
            aria-labelledby="pos-panel-title"
            onSubmit={(event) => void recordOperation(event)}
            noValidate
          >
            <div className="tus-section-label">
              <span>01</span>
              <h2 id="pos-panel-title">Record a bounded operation.</h2>
            </div>
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
                  min="0"
                  name="amount"
                  onChange={(event) => setAmount(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={amount}
                />
                {amountError === null ? null : (
                  <TusFieldError id="operation-amount-error" message={amountError} />
                )}
              </label>
            </div>
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
                  {feedback.evidence} · Operation {feedback.operationId}
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
                    onClick={() => void sendOperation(operation)}
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
        )}
    </>
  )
}

function createOperation(
  session: TusWebSession,
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
    deviceId: 'web-pos',
    shiftId: 'web-shift',
    schemaVersion: '1.0.0',
    createdAt: new Date().toISOString(),
  }
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
