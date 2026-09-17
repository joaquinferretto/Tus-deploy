'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import {
  createTusWebClient,
  createTusWebFetchTransport,
  type TusSupportCase,
  type TusSupportEvidenceResponse,
} from '@/lib/tus-client'
import { formatTusDate, type TusWebSession } from '@/lib/tus-ui-contract'
import { TusActionButton, TusStateMessage } from './tus-ui'

type CasesState = {
  status: 'loading' | 'ready' | 'empty' | 'error' | 'disabled'
  cases: readonly TusSupportCase[]
  message: string
}

type FormState = {
  status: 'idle' | 'submitting' | 'success' | 'error'
  message: string
}

type CreatedCase = {
  supportCase: TusSupportCase
  evidence: TusSupportEvidenceResponse | null
}

const EMPTY_CASES_STATE: CasesState = {
  status: 'loading',
  cases: [],
  message: 'Loading support cases from TUS…',
}

export function TusSupportSurface(): React.ReactNode {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [authMessage, setAuthMessage] = useState('Restoring your secure session.')
  const [authStatus, setAuthStatus] = useState<
    'restoring' | 'unauthenticated' | 'expired' | 'unavailable' | 'authenticated'
  >('restoring')
  const [casesState, setCasesState] = useState<CasesState>(EMPTY_CASES_STATE)
  const [caseId, setCaseId] = useState('')
  const [commitmentId, setCommitmentId] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [party, setParty] = useState<'customer' | 'merchant'>('customer')
  const [caseForm, setCaseForm] = useState<FormState>({ status: 'idle', message: '' })
  const [createdCase, setCreatedCase] = useState<CreatedCase | null>(null)
  const [handoffReason, setHandoffReason] = useState('')
  const [handoffAcknowledged, setHandoffAcknowledged] = useState(false)
  const [handoffState, setHandoffState] = useState<FormState>({ status: 'idle', message: '' })

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
      setCasesState({ status: 'disabled', cases: [], message: 'An authenticated TUS session is required.' })
      return
    }
    if (!hasPermission(session, 'tus:support:write')) {
      setCasesState({
        status: 'disabled',
        cases: [],
        message: 'This session does not have the support permission required by the current API.',
      })
      return
    }
    let cancelled = false
    setCasesState({ status: 'loading', cases: [], message: 'Loading support cases from TUS…' })
    void loadSupportCases(session)
      .then((cases) => {
        if (cancelled) return
        setCasesState({
          status: cases.length === 0 ? 'empty' : 'ready',
          cases,
          message: cases.length === 0 ? 'No support cases are recorded for this tenant.' : 'Current cases from TUS.',
        })
      })
      .catch((error) => {
        if (cancelled) return
        if (errorStatus(error) === 401) {
          createTusWebAuthClient().clearLocalSession()
          setSession(null)
        }
        setCasesState({ status: 'error', cases: [], message: supportErrorMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [session])

  async function createCase(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (session === null || session === undefined || caseForm.status === 'submitting') return
    if (!commitmentId.trim() || !category.trim() || !description.trim()) {
      setCaseForm({ status: 'error', message: 'Commitment reference, reason, and description are required.' })
      return
    }

    const nextCaseId = caseId.trim() || window.crypto.randomUUID()
    setCaseId(nextCaseId)
    setCaseForm({ status: 'submitting', message: 'Opening the case and recording its description in TUS…' })
    setCreatedCase(null)
    let openedCase: TusSupportCase | null = null
    try {
      const client = createTusWebClient(createTusWebFetchTransport())
      openedCase = await client.openSupportCase({
        ...session,
        caseId: nextCaseId,
        commitmentId: commitmentId.trim(),
        category: category.trim(),
      })
      setCreatedCase({ supportCase: openedCase, evidence: null })
      const evidence = await client.submitSupportEvidence({
        ...session,
        caseId: nextCaseId,
        evidenceId: window.crypto.randomUUID(),
        party,
        summary: description.trim(),
      })
      setCreatedCase({ supportCase: openedCase, evidence })
      setCasesState((current) => ({
        status: 'ready',
        cases: [openedCase as TusSupportCase, ...current.cases.filter((item) => item.caseId !== openedCase?.caseId)],
        message: 'Current cases from TUS.',
      }))
      setCaseForm({ status: 'success', message: 'Case opened and description recorded by TUS.' })
      setDescription('')
    } catch (error) {
      if (errorStatus(error) === 401) {
        createTusWebAuthClient().clearLocalSession()
        setSession(null)
      }
      setCaseForm({
        status: 'error',
        message:
          openedCase === null
            ? supportErrorMessage(error)
            : 'The case was opened, but its description was not confirmed. No automatic retry was sent.',
      })
    }
  }

  async function requestHandoff(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (session === null || session === undefined || handoffState.status === 'submitting') return
    if (!handoffReason.trim() || !handoffAcknowledged) {
      setHandoffState({ status: 'error', message: 'Add a reason and acknowledge the TUS-only handoff.' })
      return
    }
    setHandoffState({ status: 'submitting', message: 'Recording the governed handoff in TUS…' })
    try {
      const response = await createTusWebClient(createTusWebFetchTransport()).whatsappSupportHandoff({
        ...session,
        senderId: session.actorId,
        reason: handoffReason.trim(),
      })
      if (response.status !== 'handoff') {
        setHandoffState({ status: 'error', message: 'TUS did not confirm the handoff. No WhatsApp delivery is claimed.' })
        return
      }
      setHandoffState({
        status: 'success',
        message: 'TUS recorded the handoff. No WhatsApp message was sent or confirmed by this surface.',
      })
      setHandoffReason('')
      setHandoffAcknowledged(false)
    } catch (error) {
      setHandoffState({
        status: 'error',
        message:
          errorStatus(error) === 503
            ? 'WhatsApp/handoff is unavailable. No external message was sent.'
            : supportErrorMessage(error),
      })
    }
  }

  return (
    <>
      <div className="tus-nav-links tus-session-actions">
        <Link href="/tus?surface=discovery">Market</Link>
        <Link href="/tus/operations">Operations</Link>
        <Link href="/tus/pos">POS</Link>
      </div>
      <header className="tus-workspace-header">
        <div>
          <p className="tus-kicker">TUS / protection</p>
          <h1>
            Keep the case
            <br />
            <em>inside the record.</em>
          </h1>
        </div>
        <p className="tus-intro">
          <strong>Support stays tenant-scoped</strong>Cases, evidence, and handoff status come from TUS. No provider
          message or payment outcome is inferred here.
        </p>
      </header>
      {session === undefined ? (
        <TusStateMessage state={{ status: 'loading', message: 'Restoring your secure session…' }} />
      ) : session === null ? (
        <TusStateMessage
          state={{
            status: authStatus === 'unavailable' ? 'error' : 'disabled',
            message: authMessage,
          }}
        >
          <a
            className="tus-action-button tus-action-link"
            href={`/sign-in?returnTo=${encodeURIComponent('/tus/soporte')}`}
          >
            Sign in through TUS
          </a>
        </TusStateMessage>
      ) : (
        <div className="tus-support-workspace">
          <section className="tus-support-panel" aria-labelledby="support-cases-title">
            <div className="tus-section-label">
              <span>01</span>
              <h2 id="support-cases-title">Current cases.</h2>
            </div>
            {casesState.status === 'ready' ? (
              <ul className="tus-support-case-list">
                {casesState.cases.map((supportCase) => (
                  <li key={supportCase.caseId}>
                    <div>
                      <strong>{supportCase.category}</strong>
                      <span data-status={supportCase.status}>{supportCase.status}</span>
                      <small>
                        {supportCase.createdAt === undefined ? 'Date not provided by server.' : formatTusDate(supportCase.createdAt)}
                        {' · '}Reference ending {compactReference(supportCase.commitmentId)}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <TusStateMessage
                state={{
                  status: casesState.status,
                  message: casesState.message,
                  resource: 'Support cases',
                  retry: casesState.status === 'error' ? () => window.location.reload() : undefined,
                }}
              />
            )}
          </section>

          <section className="tus-support-panel" aria-labelledby="support-create-title">
            <div className="tus-section-label">
              <span>02</span>
              <h2 id="support-create-title">Open a case.</h2>
            </div>
            <form className="tus-support-form" onSubmit={(event) => void createCase(event)} noValidate>
              <label htmlFor="support-commitment">
                Commitment reference
                <input
                  autoComplete="off"
                  id="support-commitment"
                  onChange={(event) => setCommitmentId(event.target.value)}
                  placeholder="Existing TUS commitment"
                  required
                  value={commitmentId}
                />
              </label>
              <label htmlFor="support-category">
                Reason
                <input
                  autoComplete="off"
                  id="support-category"
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="Delivery issue, service issue…"
                  required
                  value={category}
                />
              </label>
              <label htmlFor="support-party">
                Evidence submitted as
                <select id="support-party" onChange={(event) => setParty(event.target.value as typeof party)} value={party}>
                  <option value="customer">Customer</option>
                  <option value="merchant">Merchant</option>
                </select>
              </label>
              <label htmlFor="support-description">
                Description
                <textarea
                  id="support-description"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe what happened without credentials or payment details."
                  required
                  rows={5}
                  value={description}
                />
              </label>
              <TusActionButton
                disabled={!hasPermission(session, 'tus:support:write')}
                loading={caseForm.status === 'submitting'}
                loadingLabel="Recording in TUS…"
                type="submit"
              >
                Open support case
              </TusActionButton>
              {caseForm.message === '' ? null : (
                <p className={`tus-support-feedback tus-feedback-${caseForm.status}`} role={caseForm.status === 'error' ? 'alert' : 'status'}>
                  {caseForm.message}
                </p>
              )}
            </form>
          </section>

          <section className="tus-support-panel" aria-labelledby="support-timeline-title">
            <div className="tus-section-label">
              <span>03</span>
              <h2 id="support-timeline-title">Case timeline.</h2>
            </div>
            {createdCase === null ? (
              <TusStateMessage
                state={{
                  status: 'disabled',
                  message: 'The current HTTP API lists cases but does not expose timeline readback for the Web.',
                }}
              />
            ) : (
              <div className="tus-support-timeline-note">
                <strong>{createdCase.evidence === null ? 'Case opening confirmed' : 'Case and description confirmed'}</strong>
                <p>
                  TUS recorded the case and evidence. Timeline readback is not exposed by the current HTTP contract, so no
                  events are inferred or reconstructed in the browser.
                </p>
              </div>
            )}
          </section>

          <section className="tus-support-handoff" aria-labelledby="support-handoff-title">
            <div>
              <p className="tus-card-kicker">WhatsApp / human handoff</p>
              <h2 id="support-handoff-title">Keep the channel honest.</h2>
              <p>
                This records a governed handoff inside TUS. It does not send WhatsApp, expose a phone number, collect
                credentials, or claim provider delivery.
              </p>
            </div>
            <form className="tus-support-form" onSubmit={(event) => void requestHandoff(event)} noValidate>
              <label htmlFor="support-handoff-reason">
                Handoff reason
                <textarea
                  id="support-handoff-reason"
                  onChange={(event) => setHandoffReason(event.target.value)}
                  placeholder="Why should a human review this?"
                  required
                  rows={3}
                  value={handoffReason}
                />
              </label>
              <label className="tus-support-check" htmlFor="support-handoff-acknowledgement">
                <input
                  checked={handoffAcknowledged}
                  id="support-handoff-acknowledgement"
                  onChange={(event) => setHandoffAcknowledged(event.target.checked)}
                  type="checkbox"
                />
                <span>I understand this is a TUS handoff record, not a WhatsApp delivery confirmation.</span>
              </label>
              <TusActionButton
                disabled={!hasPermission(session, 'tus:whatsapp:write')}
                loading={handoffState.status === 'submitting'}
                loadingLabel="Recording handoff…"
                type="submit"
              >
                Record governed handoff
              </TusActionButton>
              {handoffState.message === '' ? null : (
                <p className={`tus-support-feedback tus-feedback-${handoffState.status}`} role={handoffState.status === 'error' ? 'alert' : 'status'}>
                  {handoffState.message}
                </p>
              )}
            </form>
          </section>
        </div>
      )}
    </>
  )
}

async function loadSupportCases(session: TusWebSession): Promise<readonly TusSupportCase[]> {
  const response = await createTusWebClient(createTusWebFetchTransport()).listSupportCases(session)
  return response.cases
}

function hasPermission(session: TusWebSession, permission: string): boolean {
  return session.permissions?.includes(permission) === true || session.permissions?.includes('tus:*') === true
}

function compactReference(value: string): string {
  const normalized = value.trim()
  return normalized.length <= 8 ? normalized : `…${normalized.slice(-8)}`
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') return error.status
  return undefined
}

function supportErrorMessage(error: unknown): string {
  if (errorStatus(error) === 403) return 'This authenticated session is not authorized for the current support route.'
  if (errorStatus(error) === 404) return 'The referenced TUS commitment was not found in this tenant.'
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return 'TUS did not confirm the support request. No success is claimed.'
}

const tusSupportModule = { TusSupportSurface }

export default tusSupportModule
