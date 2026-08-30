export const TUS_SESSION_STATUS = {
  RESTORING: 'restoring',
  AUTHENTICATED: 'authenticated',
  UNAUTHENTICATED: 'unauthenticated',
  EXPIRED: 'expired',
  UNAVAILABLE: 'unavailable',
} as const

export type TusSessionStatus = (typeof TUS_SESSION_STATUS)[keyof typeof TUS_SESSION_STATUS]

export interface TusSessionContext {
  subjectId: string
  sessionId: string
  tenantId: string
  roles: string[]
  permissions: string[]
  correlationId: string
}

export interface TusAuthenticatedSession extends TusSessionContext {
  accessToken: string
  expiresAt: number
}

export interface TusSessionState {
  status: TusSessionStatus
  message: string
  session?: TusAuthenticatedSession
  returnTo?: string
  code?: string
}

export interface TusServerSession {
  id: string
  accessToken: string
  accountId: string
  tenantId: string
  deviceId: string
  scope: {
    tenantId: string
    roles: string[]
    permissions: string[]
  }
  expiresAt: number
}

export function parseTusServerSession(payload: unknown): TusServerSession {
  const record = asRecord(payload)
  const session = asRecord(record['session'])
  const scope = asRecord(session['scope'])
  const id = requiredString(session, 'id')
  const accessToken = requiredString(session, 'accessToken')
  const accountId = requiredString(session, 'accountId')
  const tenantId = requiredString(session, 'tenantId')
  const deviceId = requiredString(session, 'deviceId')
  const scopeTenantId = requiredString(scope, 'tenantId')
  const roles = requiredStringArray(scope, 'roles')
  const permissions = requiredStringArray(scope, 'permissions')
  const expiresAt = requiredFiniteNumber(session, 'expiresAt')

  if (tenantId !== scopeTenantId) throw new Error('TUS session scope mismatch')
  return { id, accessToken, accountId, tenantId, deviceId, scope: { tenantId: scopeTenantId, roles, permissions }, expiresAt }
}

export function parseTusSessionContext(payload: unknown): TusSessionContext {
  const context = asRecord(asRecord(payload)['context'])
  return {
    subjectId: requiredString(context, 'subjectId'),
    sessionId: requiredString(context, 'sessionId'),
    tenantId: requiredString(context, 'tenantId'),
    roles: requiredStringArray(context, 'roles'),
    permissions: requiredStringArray(context, 'permissions'),
    correlationId: requiredString(context, 'correlationId'),
  }
}

export function createTusAuthenticatedSession(input: {
  accessToken: string
  expiresAt: number
  context: TusSessionContext
}): TusAuthenticatedSession {
  if (input.accessToken.trim().length === 0 || !Number.isFinite(input.expiresAt)) {
    throw new Error('TUS session credential is invalid')
  }
  return {
    accessToken: input.accessToken.trim(),
    expiresAt: input.expiresAt,
    subjectId: input.context.subjectId,
    sessionId: input.context.sessionId,
    tenantId: input.context.tenantId,
    roles: [...input.context.roles],
    permissions: [...input.context.permissions],
    correlationId: input.context.correlationId,
  }
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Invalid TUS session field: ${key}`)
  return value.trim()
}

function requiredStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error(`Invalid TUS session field: ${key}`)
  }
  return value.map((item) => (item as string).trim())
}

function requiredFiniteNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid TUS session field: ${key}`)
  return value
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
