import type {
  Account,
  Device,
  PasswordCredential,
  RecoveryToken,
  Session,
  VerificationToken,
} from '../../domain/models.js'

interface UserIdentityRow {
  id: string
  email: string
  normalizedEmail: string
  displayName: string
}

export interface AccountRow {
  id: string
  tenantId: string
  roles: string[]
  status: string
  emailVerifiedAt: Date | null
  createdAt: Date
  updatedAt: Date
  user: UserIdentityRow
}

export interface CredentialRow {
  id: string
  accountId: string
  passwordHash: string
  status: string
  createdAt: Date
  updatedAt: Date
  lastUsedAt: Date | null
}

export interface TokenRow {
  id: string
  accountId: string
  tokenDigest: string
  expiresAt: Date
  consumedAt: Date | null
}

export interface SessionRow {
  id: string
  accountId: string
  tenantId: string
  deviceId: string
  accessTokenDigest: string
  roles: string[]
  permissions: string[]
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
}

export function mapAccountRow(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.user.email,
    normalizedEmail: row.user.normalizedEmail,
    displayName: row.user.displayName,
    tenantId: row.tenantId,
    roles: [...row.roles],
    status: row.status as Account['status'],
    emailVerifiedAt: row.emailVerifiedAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

export function mapCredentialRow(row: CredentialRow): PasswordCredential {
  return {
    id: row.id,
    accountId: row.accountId,
    passwordHash: row.passwordHash,
    status: row.status as PasswordCredential['status'],
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    lastUsedAt: row.lastUsedAt?.getTime() ?? null,
  }
}

export function mapTokenRow(row: TokenRow): VerificationToken | RecoveryToken {
  return {
    id: row.id,
    accountId: row.accountId,
    tokenDigest: row.tokenDigest,
    expiresAt: row.expiresAt.getTime(),
    consumedAt: row.consumedAt?.getTime() ?? null,
  }
}

export function mapSessionRow(row: SessionRow): Session {
  return {
    id: row.id,
    accountId: row.accountId,
    tenantId: row.tenantId,
    deviceId: row.deviceId,
    accessTokenDigest: row.accessTokenDigest,
    scope: {
      tenantId: row.tenantId,
      roles: [...row.roles],
      permissions: [...row.permissions],
    },
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
    revokedAt: row.revokedAt?.getTime() ?? null,
  }
}

export function mapDeviceRow(row: {
  deviceId: string
  label: string
  firstSeenAt: Date
  lastSeenAt: Date
}): Device {
  return {
    deviceId: row.deviceId,
    label: row.label,
    firstSeenAt: row.firstSeenAt.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
  }
}

export function toDate(value: number | null): Date | null {
  return value === null ? null : new Date(value)
}

export function toRequiredDate(value: number): Date {
  return new Date(value)
}
