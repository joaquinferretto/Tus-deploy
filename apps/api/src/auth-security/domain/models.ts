import type { AccountStatus, AuthEventKind, CredentialStatus } from './constants.js'

export interface Account {
  id: string
  email: string
  normalizedEmail: string
  displayName: string
  tenantId: string
  roles: string[]
  status: AccountStatus
  emailVerifiedAt: number | null
  createdAt: number
  updatedAt: number
  // Identity phone of the person (E.164), written only by the phone verification module once a
  // user-initiated WhatsApp challenge proves it. Optional so every existing account keeps working.
  phoneNumber?: string | null
  phoneVerifiedAt?: number | null
  phonePending?: string | null
}

// An account is verified when its email OR its identity phone was proved (phone-first sign-up).
export function cuentaVerificada(account: Pick<Account, 'emailVerifiedAt' | 'phoneVerifiedAt'>): boolean {
  return Boolean(account.emailVerifiedAt) || Boolean(account.phoneVerifiedAt)
}

export interface PasswordCredential {
  id: string
  accountId: string
  passwordHash: string
  status: CredentialStatus
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
}

export interface VerificationToken {
  id: string
  accountId: string
  tokenDigest: string
  expiresAt: number
  consumedAt: number | null
}

export interface RecoveryToken {
  id: string
  accountId: string
  tokenDigest: string
  expiresAt: number
  consumedAt: number | null
}

export interface Device {
  deviceId: string
  label: string
  firstSeenAt: number
  lastSeenAt: number
}

export interface SessionScope {
  tenantId: string
  roles: string[]
  permissions: string[]
}

export interface Session {
  id: string
  accountId: string
  tenantId: string
  deviceId: string
  accessTokenDigest: string
  scope: SessionScope
  createdAt: number
  expiresAt: number
  revokedAt: number | null
}

export interface SecurityEvent {
  contractVersion: '1.0.0'
  kind: AuthEventKind
  occurredAt: string
  actorId: string
  tenantId: string
  outcome: 'success' | 'denied' | 'accepted'
  correlationId: string
  metadata: Record<string, string | number | boolean | null>
}

export interface SafeAccount {
  id: string
  email: string
  displayName: string
  tenantId: string
  roles: string[]
  status: AccountStatus
  emailVerifiedAt: number | null
}

export interface SafeCredential {
  id: string
  accountId: string
  status: CredentialStatus
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
}

export function toSafeAccount(account: Account): SafeAccount {
  const { id, email, displayName, tenantId, roles, status, emailVerifiedAt } = account
  return { id, email, displayName, tenantId, roles: [...roles], status, emailVerifiedAt }
}

export function toSafeCredential(credential: PasswordCredential): SafeCredential {
  const { id, accountId, status, createdAt, updatedAt, lastUsedAt } = credential
  return { id, accountId, status, createdAt, updatedAt, lastUsedAt }
}
