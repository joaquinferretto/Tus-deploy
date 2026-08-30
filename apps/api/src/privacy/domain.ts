import { createHash } from 'node:crypto'

export const DATA_CLASSIFICATION = {
  PUBLIC: 'public',
  INTERNAL: 'internal',
  PERSONAL: 'personal',
  SENSITIVE: 'sensitive',
  SECRET: 'secret',
} as const

export type DataClassification = (typeof DATA_CLASSIFICATION)[keyof typeof DATA_CLASSIFICATION]

export const DATA_PURPOSE = {
  SERVICE_DELIVERY: 'service_delivery',
  SUPPORT: 'support',
  SECURITY: 'security',
  ANALYTICS: 'analytics',
  AI_IMPROVEMENT: 'ai_improvement',
  LEGAL: 'legal',
} as const

export type DataPurpose = (typeof DATA_PURPOSE)[keyof typeof DATA_PURPOSE]

export const PRIVACY_REQUEST_TYPE = {
  ACCESS: 'access',
  EXPORT: 'export',
  DELETE: 'delete',
} as const

export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPE)[keyof typeof PRIVACY_REQUEST_TYPE]

export const PRIVACY_REQUEST_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  HELD: 'held',
  FAILED: 'failed',
} as const

export type PrivacyRequestStatus =
  (typeof PRIVACY_REQUEST_STATUS)[keyof typeof PRIVACY_REQUEST_STATUS]

export const RETENTION_ACTION = {
  DELETE: 'delete',
  ANONYMIZE: 'anonymize',
} as const

export type RetentionAction = (typeof RETENTION_ACTION)[keyof typeof RETENTION_ACTION]

export const PRIVACY_RESULT_CODE = {
  ALLOWED: 'ALLOWED',
  INVALID: 'INVALID',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  HELD: 'HELD',
  CONFLICT: 'CONFLICT',
  FAILED: 'FAILED',
} as const

export type PrivacyResultCode = (typeof PRIVACY_RESULT_CODE)[keyof typeof PRIVACY_RESULT_CODE]

export const CONSENT_REQUIRED_PURPOSES = new Set<DataPurpose>([
  DATA_PURPOSE.ANALYTICS,
  DATA_PURPOSE.AI_IMPROVEMENT,
])

export interface PrivacyContext {
  tenantId: string
  actorId: string
  correlationId: string
  permissions?: string[]
}

export interface FieldDefinition {
  name: string
  classification: DataClassification
  required?: boolean
}

export interface ClassifiedFields {
  values: Record<string, unknown>
  classifications: Record<string, DataClassification>
  omittedFields: string[]
  missingRequiredFields: string[]
}

export interface StoredSecretMarker {
  redacted: true
  digest: string
}

export interface PrivacyRecord {
  id: string
  tenantId: string
  subjectUserId: string
  resourceType: string
  purpose: DataPurpose
  values: Record<string, unknown>
  classifications: Record<string, DataClassification>
  fieldDefinitions: FieldDefinition[]
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  anonymizedAt: number | null
}

export interface ConsentRecord {
  id: string
  tenantId: string
  subjectUserId: string
  purpose: DataPurpose
  version: string
  granted: boolean
  recordedAt: number
  withdrawnAt: number | null
}

export interface PrivacyExportRecord {
  id: string
  resourceType: string
  purpose: DataPurpose
  values: Record<string, unknown>
  createdAt: number
  deletedAt: number | null
}

export interface PrivacyExportData {
  subjectUserIdHash: string
  records: PrivacyExportRecord[]
  consents: Array<Pick<ConsentRecord, 'purpose' | 'version' | 'granted' | 'recordedAt'>>
}

export interface PrivacyRequest {
  id: string
  tenantId: string
  subjectUserId: string
  type: PrivacyRequestType
  idempotencyKey: string
  requestedBy: string
  status: PrivacyRequestStatus
  createdAt: number
  completedAt: number | null
  attemptCount: number
  lastError: string | null
  data: PrivacyExportData | null
}

export interface RectificationRecord {
  id: string
  tenantId: string
  recordId: string
  subjectUserId: string
  idempotencyKey: string
  updatedAt: number
}

export interface RetentionSchedule {
  tenantId: string
  resourceType: string
  purpose: DataPurpose
  retentionMs: number
  action: RetentionAction
  updatedAt: number
}

export interface LegalHold {
  id: string
  tenantId: string
  subjectUserId: string
  recordId: string | null
  reasonDigest: string
  createdAt: number
  releasedAt: number | null
}

export interface PropagationAction {
  action: RetentionAction
  recordId: string
  tenantId: string
  subjectUserId: string
  occurredAt: number
}

export interface PrivacyFailure {
  ok: false
  code: PrivacyResultCode
  message: string
}

export function digestPrivacyValue(value: unknown): string {
  let serialized = ''
  try {
    serialized = JSON.stringify(value) ?? String(value)
  } catch {
    serialized = String(value)
  }
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16)
}

export function classifyFields(
  fields: Record<string, unknown>,
  definitions: FieldDefinition[]
): ClassifiedFields {
  const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]))
  const values: Record<string, unknown> = {}
  const classifications: Record<string, DataClassification> = {}
  const omittedFields: string[] = []

  for (const [name, value] of Object.entries(fields)) {
    const definition = definitionsByName.get(name)
    if (!definition || value === undefined) {
      omittedFields.push(name)
      continue
    }
    classifications[name] = definition.classification
    values[name] =
      definition.classification === DATA_CLASSIFICATION.SECRET
        ? { redacted: true, digest: digestPrivacyValue(value) }
        : value
  }

  const missingRequiredFields = definitions
    .filter((definition) => definition.required && !(definition.name in values))
    .map((definition) => definition.name)

  return { values, classifications, omittedFields, missingRequiredFields }
}

export function redactFields(
  values: Record<string, unknown>,
  classifications: Record<string, DataClassification>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      const classification = classifications[name]
      if (
        classification === DATA_CLASSIFICATION.SECRET ||
        classification === DATA_CLASSIFICATION.SENSITIVE ||
        isStoredSecretMarker(value)
      ) {
        return [name, '[REDACTED]']
      }
      return [name, value]
    })
  )
}

export function anonymizeFields(
  values: Record<string, unknown>,
  classifications: Record<string, DataClassification>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      const classification = classifications[name]
      if (classification === DATA_CLASSIFICATION.PERSONAL) return [name, '[ANONYMIZED]']
      if (
        classification === DATA_CLASSIFICATION.SECRET ||
        classification === DATA_CLASSIFICATION.SENSITIVE ||
        isStoredSecretMarker(value)
      ) {
        return [name, '[REDACTED]']
      }
      return [name, value]
    })
  )
}

export function isStoredSecretMarker(value: unknown): value is StoredSecretMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    'redacted' in value &&
    value.redacted === true &&
    'digest' in value &&
    typeof value.digest === 'string'
  )
}

export function validPrivacyContext(context: PrivacyContext | undefined): context is PrivacyContext {
  return Boolean(
    context?.tenantId.trim() && context.actorId.trim() && context.correlationId.trim()
  )
}
