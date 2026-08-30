import { createHash } from 'node:crypto'

export const AUDIT_OUTCOME = {
  SUCCESS: 'success',
  DENIED: 'denied',
} as const

export type AuditOutcome = (typeof AUDIT_OUTCOME)[keyof typeof AUDIT_OUTCOME]

export interface AuditMetadata {
  [key: string]: string | number | boolean | null
}

export interface AuditEvent {
  id: string
  action: string
  actorId: string | null
  productId: string | null
  tenantId: string | null
  correlationId: string
  outcome: AuditOutcome
  reason: string
  occurredAt: string
  metadata: AuditMetadata
}

const REDACTED_KEYS = /token|secret|password|credential|authorization|cookie|email|sessionid/i

export function digestAuditValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function redactAuditMetadata(metadata: AuditMetadata): AuditMetadata {
  return Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) => {
      if (REDACTED_KEYS.test(key)) return [[`${key}Hash`, digestAuditValue(String(value))]]
      return [[key, value]]
    })
  )
}
