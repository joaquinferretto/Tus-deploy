import type {
  AccountAuthenticationState,
  AccountLinkingAuditEvent,
  LinkedIdentity,
} from '../domain.js'
import type { AccountLinkingAuditSink, AccountLinkingStore } from '../ports.js'

export function identityKey(providerId: string, subject: string, issuer: string): string {
  return `${issuer}|${providerId}|${subject}`
}

export class InMemoryAccountLinkingStore implements AccountLinkingStore {
  readonly accounts = new Map<string, AccountAuthenticationState>()
  readonly identities = new Map<string, LinkedIdentity>()

  seedAccount(state: AccountAuthenticationState): void {
    this.accounts.set(state.accountId, { ...state })
  }

  async saveIdentity(identity: LinkedIdentity): Promise<void> {
    this.identities.set(identityKey(identity.providerId, identity.subject, identity.issuer), {
      ...identity,
    })
  }

  async findIdentity(
    providerId: string,
    subject: string,
    issuer: string
  ): Promise<LinkedIdentity | undefined> {
    return this.identities.get(identityKey(providerId, subject, issuer))
  }

  async countAuthenticators(accountId: string): Promise<number> {
    const account = this.accounts.get(accountId)
    const password = account?.passwordCredential ? 1 : 0
    const linked = [...this.identities.values()].filter(
      (identity) => identity.accountId === accountId
    ).length
    return password + linked
  }

  async deleteIdentity(providerId: string, subject: string, issuer: string): Promise<void> {
    this.identities.delete(identityKey(providerId, subject, issuer))
  }
}

export class InMemoryAccountLinkingAuditSink implements AccountLinkingAuditSink {
  readonly events: AccountLinkingAuditEvent[] = []

  async record(event: AccountLinkingAuditEvent): Promise<void> {
    this.events.push({ ...event, metadata: { ...event.metadata } })
  }
}
