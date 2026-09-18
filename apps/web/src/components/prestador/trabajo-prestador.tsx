'use client'

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import {
  TusRequestError,
  createTusWebClient,
  createTusWebFetchTransport,
  type TusWork,
  type TusWorkDetail,
} from '@/lib/tus-client'
import { formatTusDate, type TusWebSession } from '@/lib/tus-ui-contract'
import { createWorkIntent, type WorkIntent } from '@/lib/tus-work-intent'
import { TusActionButton, TusStateMessage } from '../../app/tus/tus-ui'

type WorkLoadState = {
  status: 'loading' | 'ready' | 'empty' | 'error' | 'disabled'
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

type DiagnosisDraft = { description: string }
type BudgetDraft = {
  currency: string
  scope: string
  totalMinor: string
  lineDescription: string
  quantity: string
  unitAmountMinor: string
  validUntil: string
}
type EvidenceDraft = {
  phase: 'request' | 'diagnosis' | 'budget' | 'execution' | 'completion'
  reference: string
  note: string
  occurredAt: string
}

const EMPTY_WORK_STATE: WorkLoadState = {
  status: 'loading',
  works: [],
  message: 'Loading server-confirmed work for this provider.',
}

const EMPTY_DETAIL_STATE: DetailState = {
  status: 'idle',
  detail: null,
  message: 'Choose a work item to inspect its current server state.',
}

const DEFAULT_BUDGET: BudgetDraft = {
  currency: 'ARS',
  scope: '',
  totalMinor: '',
  lineDescription: '',
  quantity: '1',
  unitAmountMinor: '',
  validUntil: '',
}

const DEFAULT_EVIDENCE: EvidenceDraft = {
  phase: 'execution',
  reference: '',
  note: '',
  occurredAt: '',
}

export function TrabajoPrestador({
  session,
  onUnauthorized,
}: {
  session: TusWebSession
  onUnauthorized: () => void
}): ReactNode {
  const [workState, setWorkState] = useState<WorkLoadState>(EMPTY_WORK_STATE)
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null)
  const [detailState, setDetailState] = useState<DetailState>(EMPTY_DETAIL_STATE)
  const [feedback, setFeedback] = useState<FeedbackState>({ status: 'idle', message: '' })
  const [commitmentReference, setCommitmentReference] = useState('')
  const [diagnosisDraft, setDiagnosisDraft] = useState<DiagnosisDraft>({ description: '' })
  const [budgetDraft, setBudgetDraft] = useState<BudgetDraft>(DEFAULT_BUDGET)
  const [evidenceDraft, setEvidenceDraft] = useState<EvidenceDraft>(DEFAULT_EVIDENCE)
  const retryRef = useRef<(() => Promise<void>) | null>(null)
  const mutationInFlightRef = useRef(false)
  const workRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const selectedWorkRef = useRef<string | null>(null)

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
        const works = response.works.filter((work) => work.prestadorTenantId === session.tenantId)
        setWorkState({
          status: works.length === 0 ? 'empty' : 'ready',
          works,
          message:
            works.length === 0
              ? 'No accepted service work is available for this provider yet.'
              : 'Work status is current from TUS.',
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
    setWorkState(EMPTY_WORK_STATE)
    try {
      const response = await client().listWork(session)
      if (requestId !== workRequestRef.current) return
      const works = response.works.filter((work) => work.prestadorTenantId === session.tenantId)
      setWorkState({
        status: works.length === 0 ? 'empty' : 'ready',
        works,
        message:
          works.length === 0
            ? 'No accepted service work is available for this provider yet.'
            : 'Work status is current from TUS.',
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
    setSelectedWorkId(workId)
    setDetailState({
      status: 'loading',
      detail: null,
      message: 'Loading the current work detail from TUS.',
    })
    try {
      const detail = await client().workDetail(session, workId)
      if (requestId !== detailRequestRef.current) return
      if (detail.work.prestadorTenantId !== session.tenantId) {
        setDetailState({
          status: 'error',
          detail: null,
          message: 'This work is outside the provider tenant.',
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

  async function acceptCommitment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const commitmentId = commitmentReference.trim()
    if (commitmentId.length === 0) {
      showValidationError('A service commitment reference is required.')
      return
    }
    await runMutation(
      'Accepting the service commitment in TUS.',
      () => createWorkIntent('accept-commitment', { commitmentId }),
      async (intent) => {
        const response = await client().acceptWorkCommitment({
          ...session,
          commitmentId,
          ...intent,
        })
        setCommitmentReference('')
        await loadWorks()
        if (selectedWorkRef.current === null || selectedWorkRef.current === response.work.trabajoId)
          await loadDetail(response.work.trabajoId)
      }
    )
  }

  async function createDiagnosis(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const detail = detailState.detail
    const description = diagnosisDraft.description.trim()
    if (!detail || description.length === 0) {
      showValidationError('A diagnosis description is required.')
      return
    }
    await runMutation(
      'Saving the diagnosis in TUS.',
      () =>
        createWorkIntent('create-diagnosis', {
          workId: detail.work.trabajoId,
          description,
        }),
      async (intent) => {
        await client().createWorkDiagnosis({
          ...session,
          workId: detail.work.trabajoId,
          description,
          ...intent,
        })
        setDiagnosisDraft({ description: '' })
        await refreshCurrentWork(detail.work.trabajoId)
      }
    )
  }

  async function confirmDiagnosis(diagnosisId: string, expectedVersion: number): Promise<void> {
    const detail = detailState.detail
    if (!detail) return
    await runMutation(
      'Confirming the diagnosis in TUS.',
      () =>
        createWorkIntent('confirm-diagnosis', {
          workId: detail.work.trabajoId,
          diagnosisId,
          expectedVersion,
        }),
      async (intent) => {
        await client().confirmWorkDiagnosis({
          ...session,
          workId: detail.work.trabajoId,
          diagnosisId,
          expectedVersion,
          ...intent,
        })
        await refreshCurrentWork(detail.work.trabajoId)
      }
    )
  }

  async function createBudget(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const detail = detailState.detail
    if (!detail) return
    const validation = validateBudgetDraft(budgetDraft)
    if (typeof validation === 'string') {
      showValidationError(validation)
      return
    }
    await runMutation(
      'Issuing the budget in TUS.',
      () =>
        createWorkIntent('create-budget', {
          workId: detail.work.trabajoId,
          ...validation,
        }),
      async (intent) => {
        await client().createWorkBudget({
          ...session,
          workId: detail.work.trabajoId,
          ...validation,
          ...intent,
        })
        setBudgetDraft(DEFAULT_BUDGET)
        await refreshCurrentWork(detail.work.trabajoId)
      }
    )
  }

  async function recordEvidence(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const detail = detailState.detail
    const reference = evidenceDraft.reference.trim()
    const occurredAt = toIsoTimestamp(evidenceDraft.occurredAt)
    if (!detail || reference.length === 0 || occurredAt === null) {
      showValidationError('Evidence reference and a valid occurrence time are required.')
      return
    }
    const evidenceId = `web-evidence-${createIntentId()}`
    const payload = {
      workId: detail.work.trabajoId,
      evidenceId,
      phase: evidenceDraft.phase,
      reference,
      metadata: evidenceDraft.note.trim().length === 0 ? {} : { note: evidenceDraft.note.trim() },
      occurredAt,
    }
    await runMutation(
      'Recording evidence metadata in TUS.',
      () => createWorkIntent('record-evidence', payload),
      async (intent) => {
        await client().recordWorkEvidence({ ...session, ...payload, ...intent })
        setEvidenceDraft(DEFAULT_EVIDENCE)
        await refreshCurrentWork(detail.work.trabajoId)
      }
    )
  }

  async function transition(action: 'start' | 'complete'): Promise<void> {
    const detail = detailState.detail
    if (!detail) return
    await runMutation(
      `${action === 'start' ? 'Starting' : 'Completing'} the work in TUS.`,
      () =>
        createWorkIntent(`work-${action}`, {
          workId: detail.work.trabajoId,
          expectedVersion: detail.work.version,
        }),
      async (intent) => {
        const input = {
          ...session,
          workId: detail.work.trabajoId,
          expectedVersion: detail.work.version,
          ...intent,
        }
        if (action === 'start') await client().startWork(input)
        else await client().completeWork(input)
        await refreshCurrentWork(detail.work.trabajoId)
      }
    )
  }

  async function refreshCurrentWork(workId: string): Promise<void> {
    await loadWorks()
    if (selectedWorkRef.current === workId) await loadDetail(workId)
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
      setFeedback({
        status: 'ready',
        message: 'TUS confirmed the work mutation. Current state was reloaded.',
      })
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
      const currentWorkId = selectedWorkRef.current
      if (status === 'conflict' && currentWorkId) void refreshCurrentWork(currentWorkId)
    } finally {
      mutationInFlightRef.current = false
    }
  }

  function showValidationError(message: string): void {
    if (mutationInFlightRef.current) return
    retryRef.current = null
    setFeedback({ status: 'error', message })
  }

  function handleUnauthorized(error: unknown): void {
    if (errorStatus(error) === 401) onUnauthorized()
  }

  const detail = detailState.detail
  const canWrite =
    hasPermission(session, 'tus:work:write') || hasPermission(session, 'tus:marketplace:write')
  const mutationInFlight = feedback.status === 'loading' || feedback.status === 'pending'
  const canStart =
    detail !== null &&
    (detail.work.budgetRequired
      ? detail.work.status === 'accepted'
      : ['requested', 'in_diagnosis', 'accepted'].includes(detail.work.status))
  const canDiagnose =
    detail !== null && !['in_progress', 'completed', 'cancelled'].includes(detail.work.status)
  const canBudget =
    detail !== null &&
    detail.work.budgetRequired &&
    ['requested', 'in_diagnosis', 'budget_pending'].includes(detail.work.status)

  return (
    <section className="tus-prestador-panel" aria-labelledby="provider-work-title">
      <div className="tus-section-label">
        <span>05</span>
        <h2 id="provider-work-title">Service work.</h2>
      </div>
      <p className="tus-prestador-note">
        TUS currently exposes accepted work, not a provider-scoped inbox of pending commitments. A
        known service commitment can be accepted by its authorized reference.
      </p>
      <form
        className="tus-prestador-form"
        onSubmit={(event) => void acceptCommitment(event)}
        noValidate
      >
        <label htmlFor="work-commitment-reference">
          Service commitment reference
          <input
            id="work-commitment-reference"
            onChange={(event) => setCommitmentReference(event.target.value)}
            placeholder="Provided by an authorized TUS flow"
            value={commitmentReference}
          />
        </label>
        <TusActionButton disabled={!canWrite || mutationInFlight} type="submit">
          Accept referenced commitment
        </TusActionButton>
      </form>
      <TusStateMessage
        state={{
          status: workState.status,
          message: workState.message,
          resource: 'Provider work',
          retry: workState.status === 'error' ? () => void loadWorks() : undefined,
        }}
      />
      {workState.works.length === 0 ? null : (
        <ul className="tus-prestador-listings" aria-label="Accepted provider work">
          {workState.works.map((work) => (
            <li key={work.trabajoId}>
              <div>
                <strong>Service work</strong>
                <span>
                  {work.status.replaceAll('_', ' ')}
                  {work.budgetRequired ? ' · budget required' : ''}
                </span>
                <small>
                  Created {formatTusDate(work.createdAt)} · current version {work.version}
                </small>
              </div>
              <TusActionButton onClick={() => void loadDetail(work.trabajoId)} type="button">
                {selectedWorkId === work.trabajoId ? 'Refresh detail' : 'View work'}
              </TusActionButton>
            </li>
          ))}
        </ul>
      )}
      {detailState.status === 'idle' ? null : detailState.status === 'loading' ? (
        <TusStateMessage
          state={{ status: 'loading', message: detailState.message, resource: 'Work detail' }}
        />
      ) : detailState.status === 'error' || detail === null ? (
        <TusStateMessage
          state={{ status: 'error', message: detailState.message, resource: 'Work detail' }}
        />
      ) : (
        <div className="tus-prestador-workspace">
          <section className="tus-prestador-overview" aria-labelledby="work-detail-title">
            <div className="tus-section-label">
              <span>Work</span>
              <h3 id="work-detail-title">Current lifecycle.</h3>
            </div>
            <dl className="tus-prestador-facts">
              <div>
                <dt>Status</dt>
                <dd>{detail.work.status.replaceAll('_', ' ')}</dd>
              </div>
              <div>
                <dt>Origin</dt>
                <dd>Service commitment</dd>
              </div>
              <div>
                <dt>Booking</dt>
                <dd>{detail.work.reservaId ? 'Confirmed booking linked' : 'No booking linked'}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatTusDate(detail.work.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="tus-prestador-panel" aria-labelledby="work-diagnosis-title">
            <div className="tus-section-label">
              <span>01</span>
              <h3 id="work-diagnosis-title">Diagnosis.</h3>
            </div>
            {detail.diagnoses.length === 0 ? (
              <TusStateMessage
                state={{ status: 'empty', message: 'No diagnosis has been recorded.' }}
              />
            ) : (
              <ul className="tus-prestador-listings">
                {detail.diagnoses.map((diagnosis) => (
                  <li key={diagnosis.diagnosticoId}>
                    <div>
                      <strong>{diagnosis.status}</strong>
                      <span>{diagnosis.originalDescription}</span>
                      <small>
                        Version {diagnosis.version} · {formatTusDate(diagnosis.updatedAt)}
                      </small>
                    </div>
                    {diagnosis.status === 'draft' ? (
                      <TusActionButton
                        disabled={!canWrite || mutationInFlight}
                        onClick={() =>
                          void confirmDiagnosis(diagnosis.diagnosticoId, diagnosis.version)
                        }
                        type="button"
                      >
                        Confirm diagnosis
                      </TusActionButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <form
              className="tus-prestador-form"
              onSubmit={(event) => void createDiagnosis(event)}
              noValidate
            >
              <label htmlFor="work-diagnosis-description">
                Manual diagnosis
                <textarea
                  id="work-diagnosis-description"
                  onChange={(event) => setDiagnosisDraft({ description: event.target.value })}
                  rows={3}
                  value={diagnosisDraft.description}
                />
              </label>
              <TusActionButton
                disabled={!canWrite || !canDiagnose || mutationInFlight}
                type="submit"
              >
                Record diagnosis
              </TusActionButton>
            </form>
          </section>

          <section className="tus-prestador-panel" aria-labelledby="work-budget-title">
            <div className="tus-section-label">
              <span>02</span>
              <h3 id="work-budget-title">Budget history.</h3>
            </div>
            {detail.budgets.length === 0 ? (
              <TusStateMessage state={{ status: 'empty', message: 'No budget has been issued.' }} />
            ) : (
              <ul className="tus-prestador-listings">
                {[...detail.budgets]
                  .sort((left, right) => right.version - left.version)
                  .map((budget) => (
                    <li key={`${budget.presupuestoId}-${budget.version}`}>
                      <div>
                        <strong>
                          Version {budget.version} · {budget.status}
                        </strong>
                        <span>
                          {budget.scope} · {budget.currency} {budget.totalMinor}
                        </span>
                        <small>
                          {budget.validUntil
                            ? `Valid until ${formatTusDate(budget.validUntil)}`
                            : 'No expiry recorded'}
                        </small>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
            <form
              className="tus-prestador-form"
              onSubmit={(event) => void createBudget(event)}
              noValidate
            >
              <label htmlFor="work-budget-scope">
                Scope
                <textarea
                  id="work-budget-scope"
                  onChange={(event) =>
                    setBudgetDraft((current) => ({ ...current, scope: event.target.value }))
                  }
                  rows={2}
                  value={budgetDraft.scope}
                />
              </label>
              <div className="tus-prestador-form-grid">
                <label htmlFor="work-budget-currency">
                  Currency
                  <input
                    id="work-budget-currency"
                    maxLength={3}
                    onChange={(event) =>
                      setBudgetDraft((current) => ({ ...current, currency: event.target.value }))
                    }
                    value={budgetDraft.currency}
                  />
                </label>
                <label htmlFor="work-budget-total">
                  Total minor units
                  <input
                    id="work-budget-total"
                    inputMode="numeric"
                    onChange={(event) =>
                      setBudgetDraft((current) => ({ ...current, totalMinor: event.target.value }))
                    }
                    value={budgetDraft.totalMinor}
                  />
                </label>
              </div>
              <label htmlFor="work-budget-line">
                Line description
                <input
                  id="work-budget-line"
                  onChange={(event) =>
                    setBudgetDraft((current) => ({
                      ...current,
                      lineDescription: event.target.value,
                    }))
                  }
                  value={budgetDraft.lineDescription}
                />
              </label>
              <div className="tus-prestador-form-grid">
                <label htmlFor="work-budget-quantity">
                  Quantity
                  <input
                    id="work-budget-quantity"
                    inputMode="numeric"
                    onChange={(event) =>
                      setBudgetDraft((current) => ({ ...current, quantity: event.target.value }))
                    }
                    value={budgetDraft.quantity}
                  />
                </label>
                <label htmlFor="work-budget-unit">
                  Unit amount in minor units
                  <input
                    id="work-budget-unit"
                    inputMode="numeric"
                    onChange={(event) =>
                      setBudgetDraft((current) => ({
                        ...current,
                        unitAmountMinor: event.target.value,
                      }))
                    }
                    value={budgetDraft.unitAmountMinor}
                  />
                </label>
              </div>
              <label htmlFor="work-budget-valid-until">
                Valid until (optional)
                <input
                  id="work-budget-valid-until"
                  onChange={(event) =>
                    setBudgetDraft((current) => ({ ...current, validUntil: event.target.value }))
                  }
                  type="datetime-local"
                  value={budgetDraft.validUntil}
                />
              </label>
              <TusActionButton disabled={!canWrite || !canBudget || mutationInFlight} type="submit">
                Issue new budget version
              </TusActionButton>
            </form>
          </section>

          <section className="tus-prestador-panel" aria-labelledby="work-evidence-title">
            <div className="tus-section-label">
              <span>03</span>
              <h3 id="work-evidence-title">Evidence metadata.</h3>
            </div>
            {detail.evidence.length === 0 ? (
              <TusStateMessage
                state={{ status: 'empty', message: 'No evidence metadata has been recorded.' }}
              />
            ) : (
              <ul className="tus-prestador-listings">
                {detail.evidence.map((evidence) => (
                  <li key={evidence.evidenceId}>
                    <div>
                      <strong>{evidence.phase}</strong>
                      <span>{evidence.reference}</span>
                      <small>{formatTusDate(evidence.occurredAt)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="tus-prestador-form"
              onSubmit={(event) => void recordEvidence(event)}
              noValidate
            >
              <label htmlFor="work-evidence-phase">
                Phase
                <select
                  id="work-evidence-phase"
                  onChange={(event) =>
                    setEvidenceDraft((current) => ({
                      ...current,
                      phase: event.target.value as EvidenceDraft['phase'],
                    }))
                  }
                  value={evidenceDraft.phase}
                >
                  <option value="request">Request</option>
                  <option value="diagnosis">Diagnosis</option>
                  <option value="budget">Budget</option>
                  <option value="execution">Execution</option>
                  <option value="completion">Completion</option>
                </select>
              </label>
              <label htmlFor="work-evidence-reference">
                Durable reference
                <input
                  id="work-evidence-reference"
                  onChange={(event) =>
                    setEvidenceDraft((current) => ({ ...current, reference: event.target.value }))
                  }
                  placeholder="Document or record reference"
                  value={evidenceDraft.reference}
                />
              </label>
              <label htmlFor="work-evidence-note">
                Note (optional)
                <textarea
                  id="work-evidence-note"
                  onChange={(event) =>
                    setEvidenceDraft((current) => ({ ...current, note: event.target.value }))
                  }
                  rows={2}
                  value={evidenceDraft.note}
                />
              </label>
              <label htmlFor="work-evidence-occurred-at">
                Occurred at
                <input
                  id="work-evidence-occurred-at"
                  onChange={(event) =>
                    setEvidenceDraft((current) => ({ ...current, occurredAt: event.target.value }))
                  }
                  type="datetime-local"
                  value={evidenceDraft.occurredAt}
                />
              </label>
              <TusActionButton disabled={!canWrite || mutationInFlight} type="submit">
                Record evidence metadata
              </TusActionButton>
            </form>
          </section>

          <section className="tus-prestador-panel" aria-labelledby="work-history-title">
            <div className="tus-section-label">
              <span>04</span>
              <h3 id="work-history-title">History and close.</h3>
            </div>
            <ul className="tus-prestador-listings">
              {detail.transitions.map((transition) => (
                <li key={transition.transitionId}>
                  <div>
                    <strong>{transition.status.replaceAll('_', ' ')}</strong>
                    <span>{transition.reason}</span>
                    <small>{formatTusDate(transition.createdAt)}</small>
                  </div>
                </li>
              ))}
            </ul>
            <div className="tus-prestador-form-grid">
              <TusActionButton
                disabled={!canWrite || !canStart || mutationInFlight}
                onClick={() => void transition('start')}
                type="button"
              >
                Start work
              </TusActionButton>
              <TusActionButton
                disabled={!canWrite || detail.work.status !== 'in_progress' || mutationInFlight}
                onClick={() => void transition('complete')}
                type="button"
              >
                Complete work
              </TusActionButton>
            </div>
          </section>
        </div>
      )}
      {feedback.status === 'idle' ? null : (
        <TusStateMessage
          state={{
            status:
              feedback.status === 'loading'
                ? 'loading'
                : feedback.status === 'ready'
                  ? 'ready'
                  : feedback.status,
            message: feedback.message,
            resource: 'Work action',
            retry:
              feedback.status === 'error' && retryRef.current
                ? () => void retryRef.current?.()
                : undefined,
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

function hasPermission(session: TusWebSession, permission: string): boolean {
  return (
    session.permissions?.includes(permission) === true ||
    session.permissions?.includes('tus:*') === true
  )
}

function createIntentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Math.random().toString(36).slice(2)}`
}

function validateBudgetDraft(draft: BudgetDraft):
  | {
      currency: string
      scope: string
      totalMinor: string
      lines: readonly [
        {
          lineId: string
          description: string
          quantity: number
          unitAmountMinor: string
          totalAmountMinor: string
        },
      ]
      validUntil?: string
    }
  | string {
  const currency = draft.currency.trim().toUpperCase()
  const scope = draft.scope.trim()
  const description = draft.lineDescription.trim()
  const validUntil = draft.validUntil === '' ? undefined : toIsoTimestamp(draft.validUntil)
  if (currency.length !== 3 || scope.length === 0 || description.length === 0)
    return 'Currency, scope, and line description are required.'
  if (
    !/^\d+$/u.test(draft.totalMinor) ||
    !/^\d+$/u.test(draft.unitAmountMinor) ||
    !/^\d+$/u.test(draft.quantity)
  )
    return 'Amounts must be non-negative integer minor units and quantity must be an integer.'
  const quantity = Number(draft.quantity)
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    return 'Quantity must be a positive integer.'
  if (BigInt(draft.totalMinor) !== BigInt(draft.unitAmountMinor) * BigInt(quantity))
    return 'The total must equal quantity multiplied by the unit amount.'
  if (validUntil === null) return 'Valid until must be a valid date and time.'
  return {
    currency,
    scope,
    totalMinor: draft.totalMinor,
    lines: [
      {
        lineId: `web-line-${createIntentId()}`,
        description,
        quantity,
        unitAmountMinor: draft.unitAmountMinor,
        totalAmountMinor: draft.totalMinor,
      },
    ],
    ...(validUntil === undefined ? {} : { validUntil }),
  }
}

function toIsoTimestamp(value: string): string | null {
  if (value.trim().length === 0) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
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
  if (code === 'INVALID_STATE') return 'This action is not available in the current server state.'
  if (errorStatus(error) === 403)
    return 'This session is not authorized for the requested work action.'
  if (errorStatus(error) === 404)
    return 'This work is unavailable in the authenticated tenant scope.'
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return 'TUS did not confirm this work action.'
}

const trabajoPrestadorModule = { TrabajoPrestador }

export default trabajoPrestadorModule
