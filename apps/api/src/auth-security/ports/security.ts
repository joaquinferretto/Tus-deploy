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

export interface EmailSender {
  sendVerification(input: { email: string; token: string }): Promise<void>
  sendRecovery(input: { email: string; token: string }): Promise<void>
}

export interface RateLimiter {
  allow(key: string, now: number): boolean
}
