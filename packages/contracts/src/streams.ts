export const STREAM_CONTRACT_VERSION = '1.0.0' as const

export const STREAM_KIND = {
  TOKEN: 'token',
  AUDIO: 'audio',
  EVENT: 'event',
  PROGRESS: 'progress',
} as const

export type StreamKind = (typeof STREAM_KIND)[keyof typeof STREAM_KIND]

export const STREAM_FRAME_STATUS = {
  PARTIAL: 'partial',
  PROGRESS: 'progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const

export type StreamFrameStatus = (typeof STREAM_FRAME_STATUS)[keyof typeof STREAM_FRAME_STATUS]

export const STREAM_PARTIAL_RESULT_POLICY = {
  EMIT_PARTIAL: 'emit-partial',
  HOLD_UNTIL_COMPLETE: 'hold-until-complete',
  DISCARD_ON_CANCEL: 'discard-on-cancel',
} as const

export type StreamPartialResultPolicy =
  (typeof STREAM_PARTIAL_RESULT_POLICY)[keyof typeof STREAM_PARTIAL_RESULT_POLICY]

export interface StreamContext {
  streamId: string
  tenantId: string
  actorId: string
  correlationId: string
}

export interface StreamCreateInput extends StreamContext {
  runId: string
  partialResultPolicy: StreamPartialResultPolicy
  maxBuffer?: number
}

export interface StreamFrameInput {
  kind: StreamKind
  status: StreamFrameStatus
  payload: Readonly<Record<string, unknown>>
}

export interface StreamFrame extends StreamFrameInput {
  contractVersion: typeof STREAM_CONTRACT_VERSION
  streamId: string
  runId: string
  tenantId: string
  actorId: string
  correlationId: string
  sequence: number
  cursor: string
  emittedAt: string
}

export interface StreamConnectRequest extends StreamContext {
  cursor?: string
  maxInFlight: number
}

export interface StreamConnection {
  connectionId: string
  streamId: string
  cursor: string | null
}

export interface StreamPollRequest extends StreamContext {
  connectionId: string
}

export interface StreamPollResult {
  status: 'open' | 'empty' | 'completed' | 'failed' | 'cancelled'
  frames: readonly StreamFrame[]
}

export interface StreamAckRequest extends StreamContext {
  connectionId: string
  cursor: string
}

export interface StreamCancelRequest extends StreamContext {
  connectionId: string
  reason: string
}

export class StreamContractValidationError extends Error {
  readonly field: string

  constructor(field: string, reason: string) {
    super(`Invalid stream frame ${field}: ${reason}`)
    this.name = 'StreamContractValidationError'
    this.field = field
  }
}

export function createStreamCursor(streamId: string, sequence: number): string {
  if (!isNonEmptyString(streamId) || !Number.isInteger(sequence) || sequence < 1) {
    throw new StreamContractValidationError('cursor', 'streamId and positive sequence are required')
  }
  return `${streamId}:${sequence}`
}

export function parseStreamCursor(cursor: string): { streamId: string; sequence: number } {
  const separator = cursor.lastIndexOf(':')
  const streamId = separator > 0 ? cursor.slice(0, separator) : ''
  const sequence = separator > 0 ? Number(cursor.slice(separator + 1)) : Number.NaN
  if (!isNonEmptyString(streamId) || !Number.isInteger(sequence) || sequence < 1) {
    throw new StreamContractValidationError('cursor', 'must be streamId:sequence')
  }
  return { streamId, sequence }
}

export function validateStreamFrame(value: unknown): StreamFrame {
  if (!isRecord(value)) throw new StreamContractValidationError('frame', 'must be an object')
  if (value['contractVersion'] !== STREAM_CONTRACT_VERSION) {
    throw new StreamContractValidationError('contractVersion', 'unsupported contract version')
  }
  for (const field of [
    'streamId',
    'runId',
    'tenantId',
    'actorId',
    'correlationId',
    'cursor',
    'emittedAt',
  ]) {
    if (!isNonEmptyString(value[field])) {
      throw new StreamContractValidationError(field, 'must be a non-empty string')
    }
  }
  if (!isStreamKind(value['kind']))
    throw new StreamContractValidationError('kind', 'is unsupported')
  if (!isStreamFrameStatus(value['status'])) {
    throw new StreamContractValidationError('status', 'is unsupported')
  }
  if (!Number.isInteger(value['sequence']) || Number(value['sequence']) < 1) {
    throw new StreamContractValidationError('sequence', 'must be a positive integer')
  }
  const parsedCursor = parseStreamCursor(value['cursor'] as string)
  if (parsedCursor.streamId !== value['streamId'] || parsedCursor.sequence !== value['sequence']) {
    throw new StreamContractValidationError('cursor', 'must match streamId and sequence')
  }
  if (!isRecord(value['payload']))
    throw new StreamContractValidationError('payload', 'must be an object')
  if (!isCanonicalIsoTimestamp(value['emittedAt'])) {
    throw new StreamContractValidationError(
      'emittedAt',
      'must be a canonical ISO-8601 UTC timestamp'
    )
  }
  return value as unknown as StreamFrame
}

export function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false
  return new Date(value).toISOString() === value
}

function isStreamKind(value: unknown): value is StreamKind {
  return Object.values(STREAM_KIND).includes(value as StreamKind)
}

function isStreamFrameStatus(value: unknown): value is StreamFrameStatus {
  return Object.values(STREAM_FRAME_STATUS).includes(value as StreamFrameStatus)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
