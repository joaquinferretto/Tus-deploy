import type {
  AccountAuthenticationState,
  AccountLinkingAuditEvent,
  LinkedIdentity,
} from './domain.js'

export interface AccountLinkingStore {
  readonly accounts: Map<string, AccountAuthenticationState>
  readonly identities: Map<string, LinkedIdentity>
  seedAccount(state: AccountAuthenticationState): void
  saveIdentity(identity: LinkedIdentity): Promise<void>
  findIdentity(
    providerId: string,
    subject: string,
    issuer: string
  ): Promise<LinkedIdentity | undefined>
  countAuthenticators(accountId: string): Promise<number>
  deleteIdentity(providerId: string, subject: string, issuer: string): Promise<void>
}

export interface AccountLinkingAuditSink {
  readonly events: AccountLinkingAuditEvent[]
  record(event: AccountLinkingAuditEvent): Promise<void>
}

export interface AccountLinkingClock {
  now(): number
}
