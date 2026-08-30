import type { TusCommitment, TusTenantContext } from '@factory/contracts/tus'

export { TUS_LOCALE, formatTusCurrency, formatTusDate, formatTusNumber } from './tus-journeys'

export const TUS_UI_STATUS = {
  LOADING: 'loading',
  EMPTY: 'empty',
  READY: 'ready',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  DISABLED: 'disabled',
  ERROR: 'error',
} as const

export const TUS_SESSION_STORAGE_KEY = 'tus.session.v1'

export type TusUiStatus = (typeof TUS_UI_STATUS)[keyof typeof TUS_UI_STATUS]
export type TusResourceStatus = Extract<
  TusUiStatus,
  'loading' | 'ready' | 'empty' | 'disabled' | 'error'
>

export const TUS_UI_STATE_PRESENTATION = {
  loading: { label: 'Loading', role: 'status', live: 'polite', busy: true },
  empty: { label: 'Nothing here yet', role: 'status', live: 'polite', busy: false },
  ready: { label: 'Current', role: 'status', live: 'polite', busy: false },
  pending: { label: 'Pending', role: 'status', live: 'polite', busy: false },
  conflict: { label: 'Review required', role: 'alert', live: 'assertive', busy: false },
  disabled: { label: 'Disabled', role: 'status', live: 'polite', busy: false },
  error: { label: 'Unable to load', role: 'alert', live: 'assertive', busy: false },
} as const

export type TusUiStatePresentation = (typeof TUS_UI_STATE_PRESENTATION)[TusUiStatus]

export interface TusUiState<TData = undefined> {
  status: TusUiStatus
  data?: TData
  message: string
  code?: string
  resource?: string
  retry?: () => void
}

export interface TusResourceState<TData = undefined> {
  status: TusResourceStatus
  data?: TData
  message: string
  code?: string
  resource: string
  retry: () => void
}

export interface TusUiStateInput<TData> {
  loading: boolean
  data?: TData | null
  error?: unknown
  disabled?: boolean
  isEmpty?: (data: TData) => boolean
}

export function statePresentation(status: TusUiStatus): TusUiStatePresentation {
  return TUS_UI_STATE_PRESENTATION[status]
}

export interface TusWebSession extends TusTenantContext {
  accessToken: string
  sessionId?: string
  subjectId?: string
  roles?: string[]
  permissions?: string[]
  expiresAt?: number
}

export interface TusWebSessionInput {
  accessToken: string
  tenantId: string
  actorId: string
  correlationId: string
  sessionId?: string
  subjectId?: string
  roles?: string[]
  permissions?: string[]
  expiresAt?: number
}

export interface CommitmentPresentation {
  context: TusCommitment['context']
  label: string
  status: string
  statusTone: 'neutral' | 'warning' | 'danger' | 'success'
  settlementClaim: 'not-claimed'
  evidence: string
}

export interface PosFeedback {
  status: 'accepted' | 'replayed' | 'pending' | 'conflict' | 'error'
  message: string
  evidence: string
  operationId: string
  retryable: boolean
  action: 'retry' | 'refresh' | 'resolve'
}

const TUS_OPERATIONAL_CAPABILITY = {
  FINANCE: 'finance',
  DELIVERY: 'delivery',
  SUPPORT: 'support',
} as const

type TusOperationalCapability =
  (typeof TUS_OPERATIONAL_CAPABILITY)[keyof typeof TUS_OPERATIONAL_CAPABILITY]

export interface TusOperationalPresentation {
  status: Extract<TusUiStatus, 'ready' | 'pending' | 'disabled' | 'error'>
  label: string
  message: string
  evidence: string
  metric: number
}

export interface TusOperationalSurfacePresentation {
  finance: TusOperationalPresentation
  delivery: TusOperationalPresentation
  support: TusOperationalPresentation
}

export interface TusOperationalSurfaceInput {
  stale: boolean
  disabled?: boolean
  error?: unknown
  dimensions: {
    payment: number
    settlementAging: number
    fulfillment: number
    disputes: number
    whatsappActions: number
  }
}

export function resolveTusUiState<TData>({
  loading,
  data,
  error,
  disabled = false,
  isEmpty = defaultIsEmpty,
}: TusUiStateInput<TData>): TusUiState<TData> {
  if (disabled)
    return {
      status: TUS_UI_STATUS.DISABLED,
      message: 'This capability is disabled until its server gate is enabled.',
    }
  if (loading) return { status: TUS_UI_STATUS.LOADING, message: 'Loading authoritative TUS data…' }
  if (error !== undefined && error !== null) return errorState(error)
  if (data === undefined || data === null)
    return { status: TUS_UI_STATUS.EMPTY, message: 'No authoritative data is available yet.' }
  if (isEmpty(data))
    return {
      status: TUS_UI_STATUS.EMPTY,
      data,
      message: 'Nothing has been recorded for this scope yet.',
    }
  return { status: TUS_UI_STATUS.READY, data, message: 'Authoritative TUS data is current.' }
}

export function createTusWebSession(input: TusWebSessionInput): TusWebSession {
  for (const [name, value] of Object.entries(input)) {
    if (name !== 'sessionId' && (!name || typeof value !== 'string' || value.trim().length === 0)) {
      throw new Error(`TUS session field ${name} is required`)
    }
  }
  return {
    accessToken: input.accessToken.trim(),
    tenantId: input.tenantId.trim(),
    actorId: input.actorId.trim(),
    correlationId: input.correlationId.trim(),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId.trim() }),
    ...(input.subjectId === undefined ? {} : { subjectId: input.subjectId.trim() }),
    ...(input.roles === undefined ? {} : { roles: [...input.roles] }),
    ...(input.permissions === undefined ? {} : { permissions: [...input.permissions] }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  }
}

export function sessionRequestContext(session: TusWebSession): TusWebSession {
  return { ...session }
}

export function commitmentPresentation(
  commitment: Pick<TusCommitment, 'context' | 'status'>
): CommitmentPresentation {
  const statusTone =
    commitment.status === 'frozen'
      ? 'danger'
      : commitment.status === 'pending'
        ? 'warning'
        : commitment.status === 'released'
          ? 'success'
          : 'neutral'
  return {
    context: commitment.context,
    label: commitment.context === 'product' ? 'Product promise' : 'Service promise',
    status: commitment.status,
    statusTone,
    settlementClaim: 'not-claimed',
    evidence:
      'Server status is authoritative; provider capture and settlement are not claimed by this surface.',
  }
}

export function posFeedback(result: {
  status: string
  operationId: string
  reason?: string
}): PosFeedback {
  if (result.status === 'accepted') {
    return {
      status: 'accepted',
      operationId: result.operationId,
      message: 'Accepted by TUS. Keep the server receipt as the source of truth.',
      evidence: 'Server acknowledgement received; provider capture and settlement are not claimed.',
      retryable: false,
      action: 'refresh',
    }
  }
  if (result.status === 'replayed') {
    return {
      status: 'replayed',
      operationId: result.operationId,
      message: 'TUS replayed the original result for this intent.',
      evidence:
        'The server returned the existing result; provider capture and settlement are not claimed.',
      retryable: false,
      action: 'refresh',
    }
  }
  if (result.status === 'conflict') {
    return {
      status: 'conflict',
      operationId: result.operationId,
      message: 'Review required before retry. The local operation remains preserved.',
      evidence: result.reason ?? 'The server reported a conflict.',
      retryable: false,
      action: 'resolve',
    }
  }
  if (result.status === 'error') {
    return {
      status: 'error',
      operationId: result.operationId,
      message: 'The server did not acknowledge this operation.',
      evidence: result.reason ?? 'No server acknowledgement; no success is claimed.',
      retryable: true,
      action: 'retry',
    }
  }
  return {
    status: 'pending',
    operationId: result.operationId,
    message:
      result.status === 'queued-offline'
        ? 'Queued locally; waiting for server acknowledgement.'
        : 'Sync is uncertain; no success is claimed.',
    evidence: result.reason ?? 'Pending server acknowledgement.',
    retryable: true,
    action: result.reason === 'in_progress' ? 'refresh' : 'retry',
  }
}

export function operationalSurfacePresentation(
  input: TusOperationalSurfaceInput
): TusOperationalSurfacePresentation {
  return {
    finance: createOperationalPresentation(
      TUS_OPERATIONAL_CAPABILITY.FINANCE,
      input,
      input.dimensions.payment + input.dimensions.settlementAging
    ),
    delivery: createOperationalPresentation(
      TUS_OPERATIONAL_CAPABILITY.DELIVERY,
      input,
      input.dimensions.fulfillment
    ),
    support: createOperationalPresentation(
      TUS_OPERATIONAL_CAPABILITY.SUPPORT,
      input,
      input.dimensions.disputes + input.dimensions.whatsappActions
    ),
  }
}

function createOperationalPresentation(
  capability: TusOperationalCapability,
  input: TusOperationalSurfaceInput,
  metric: number
): TusOperationalPresentation {
  if (input.disabled) {
    return {
      status: 'disabled',
      label: capabilityLabel(capability),
      message: `${capabilityLabel(capability)} actions are disabled by the server gate.`,
      evidence: 'No local state can enable this capability.',
      metric,
    }
  }
  if (input.error !== undefined && input.error !== null) {
    return {
      status: 'error',
      label: capabilityLabel(capability),
      message: `${capabilityLabel(capability)} data could not be loaded.`,
      evidence: 'No authoritative response; no success is claimed.',
      metric,
    }
  }
  if (input.stale) {
    return {
      status: 'pending',
      label: capabilityLabel(capability),
      message: staleMessage(capability),
      evidence:
        'Report freshness is stale; refresh before acting. Settlement and completion are not claimed.',
      metric,
    }
  }
  return {
    status: 'ready',
    label: capabilityLabel(capability),
    message: readyMessage(capability),
    evidence:
      'Server report is current. Provider capture, settlement, and completion remain separately governed.',
    metric,
  }
}

function capabilityLabel(capability: TusOperationalCapability): string {
  if (capability === TUS_OPERATIONAL_CAPABILITY.FINANCE) return 'Finance'
  if (capability === TUS_OPERATIONAL_CAPABILITY.DELIVERY) return 'Delivery'
  return 'Support'
}

function staleMessage(capability: TusOperationalCapability): string {
  if (capability === TUS_OPERATIONAL_CAPABILITY.FINANCE)
    return 'Finance facts are pending a fresh server report; settlement is not inferred.'
  if (capability === TUS_OPERATIONAL_CAPABILITY.DELIVERY)
    return 'Delivery facts are pending a fresh server report; completion is not inferred.'
  return 'Support facts are pending a fresh server report; handoff requires server authorization.'
}

function readyMessage(capability: TusOperationalCapability): string {
  if (capability === TUS_OPERATIONAL_CAPABILITY.FINANCE)
    return 'Payment and settlement aging are reported without claiming release.'
  if (capability === TUS_OPERATIONAL_CAPABILITY.DELIVERY)
    return 'Fulfillment facts are reported without claiming delivery completion.'
  return 'Disputes and governed messaging are reported without bypassing consent or handoff.'
}

function errorState(error: unknown): TusUiState<never> {
  const record =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
  const message =
    error instanceof Error
      ? error.message
      : typeof record['message'] === 'string'
        ? record['message']
        : 'TUS data could not be loaded.'
  const code = typeof record['code'] === 'string' ? record['code'] : undefined
  return { status: TUS_UI_STATUS.ERROR, message, ...(code === undefined ? {} : { code }) }
}

function defaultIsEmpty<TData>(data: TData): boolean {
  return Array.isArray(data) && data.length === 0
}

export default {
  commitmentPresentation,
  createTusWebSession,
  operationalSurfacePresentation,
  posFeedback,
  resolveTusUiState,
  sessionRequestContext,
  statePresentation,
}
