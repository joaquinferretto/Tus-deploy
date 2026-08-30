export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export const EVENT_CONTRACT_VERSION = '1.0.0' as const

export interface EventMessage {
  contractVersion: typeof EVENT_CONTRACT_VERSION
  eventId: string
  tenantId: string
  actorId: string
  correlationId: string
  idempotencyKey: string
  type: string
  occurredAt: string
  payload: JsonValue
}

export type EventPublishStatus = 'published' | 'retryable' | 'unavailable'

export interface EventPublishResult {
  status: EventPublishStatus
  eventId: string
  attempts: number
  retryDelaysMs: number[]
  nextAttemptAt?: number
  error?: string
}

export interface EventInvocationResult {
  status: 'invoked' | 'retryable' | 'unavailable'
  eventId: string
  attempts: number
  retryDelaysMs: number[]
  nextAttemptAt?: number
  error?: string
}

export interface EventPublishOptions {
  now?: number
}

export interface EventAdapterOptions {
  maxAttempts?: number
  baseBackoffMs?: number
  maxBackoffMs?: number
}

export interface EventBridgeRequest {
  eventBusRef: string
  source: 'product-factory-core'
  detailType: string
  detail: EventMessage
}

export interface LambdaRequest {
  functionRef: string
  invocationType: 'RequestResponse'
  detail: EventMessage
}

export type EventBridgeSender = (request: EventBridgeRequest) => void | Promise<void>
export type LambdaSender = (request: LambdaRequest) => void | Promise<void>

export class EventActivationError extends Error {
  constructor(boundary: string) {
    super(`${boundary} activation is disabled`)
    this.name = 'EventActivationError'
  }
}

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1))
}

export function redactEventMessage(event: EventMessage): EventMessage {
  return structuredClone({ ...event, payload: redactValue(event.payload) })
}

export function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/(authorization\s*:\s*bearer\s+)\S+/gi, '$1[REDACTED]')
    .replace(/((?:token|secret|password|credential|cookie)\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
}

function redactValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redactValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        isSensitiveKey(key) ? '[REDACTED]' : redactValue(child),
      ])
    )
  }
  return value
}

function isSensitiveKey(key: string): boolean {
  return /authorization|token|secret|password|credential|cookie/i.test(key)
}
