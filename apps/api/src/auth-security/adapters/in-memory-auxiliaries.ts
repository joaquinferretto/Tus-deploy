import type { AuditSink, EmailSender, RateLimiter } from '../ports/security.js'
import type { SecurityEvent } from '../domain/models.js'

export class InMemoryAuditSink implements AuditSink {
  readonly events: SecurityEvent[] = []

  async record(event: SecurityEvent): Promise<void> {
    this.events.push(structuredClone(event))
  }
}

export interface SentMessage {
  kind: 'verification' | 'recovery'
  email: string
  token: string
}

export class InMemoryEmailSender implements EmailSender {
  readonly messages: SentMessage[] = []

  async sendVerification(input: { email: string; token: string }): Promise<void> {
    this.messages.push({ kind: 'verification', ...input })
  }

  async sendRecovery(input: { email: string; token: string }): Promise<void> {
    this.messages.push({ kind: 'recovery', ...input })
  }
}

interface RateLimitWindow {
  startedAt: number
  attempts: number
}

export class FixedWindowRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, RateLimitWindow>()
  private readonly maxAttempts: number
  private readonly windowMs: number

  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts
    this.windowMs = windowMs
  }

  allow(key: string, now: number): boolean {
    const current = this.windows.get(key)
    if (!current || now - current.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, attempts: 1 })
      return true
    }
    if (current.attempts >= this.maxAttempts) return false
    current.attempts += 1
    return true
  }
}
