import type { SecurityEvent } from '../domain/models.js'

export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(password: string, hash: string): Promise<boolean>
  dummyHash: string
}

export interface TokenIssuer {
  issue(): string
  digest(token: string): string
}

export interface IdGenerator {
  next(): string
}

export interface AuditSink {
  record(event: SecurityEvent): Promise<void>
}

// Email provider boundary (Resend in production, in-memory in tests). Auth never knows which
// provider is behind it. Messages carry only a one-time link; no password or secret.
export const SECURITY_NOTIFICATION = {
  PASSWORD_CHANGED: 'password_changed',
  PASSWORD_RESET: 'password_reset',
  MFA_ENABLED: 'mfa_enabled',
  MFA_DISABLED: 'mfa_disabled',
  RECOVERY_CODES_REGENERATED: 'recovery_codes_regenerated',
  REGISTRATION_ATTEMPT: 'registration_attempt',
} as const

export type SecurityNotificationKind = (typeof SECURITY_NOTIFICATION)[keyof typeof SECURITY_NOTIFICATION]

export interface EmailSender {
  sendVerification(input: { email: string; token: string }): Promise<void>
  sendRecovery(input: { email: string; token: string }): Promise<void>
  sendSecurityNotification?(input: { email: string; kind: SecurityNotificationKind }): Promise<void>
}

// May be durable (PostgreSQL) so the limit survives a restart.
export interface RateLimiter {
  allow(key: string, now: number): boolean | Promise<boolean>
}

// Pwned Passwords (k-anonymity): true when the password appears in known breaches.
export interface PasswordBreachChecker {
  isBreached(password: string): Promise<boolean>
}
