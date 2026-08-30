import {
  ACCOUNT_LINKING_RESULT_CODE,
  type AccountLinkingFailure,
  type AccountLinkingResultCode,
  type ExternalIdentity,
  type LinkedIdentity,
} from '../domain.js'
import type { AccountLinkingAuditSink, AccountLinkingClock, AccountLinkingStore } from '../ports.js'

const RECENT_AUTH_WINDOW_MS = 5 * 60 * 1000

export interface AccountLinkingServiceDependencies {
  store: AccountLinkingStore
  audit: AccountLinkingAuditSink
  clock: AccountLinkingClock
}

export type AccountLinkingResult = { ok: true; identity: LinkedIdentity } | AccountLinkingFailure
export type AccountUnlinkResult = { ok: true } | AccountLinkingFailure

export class AccountLinkingService {
  private readonly dependencies: AccountLinkingServiceDependencies

  constructor(dependencies: AccountLinkingServiceDependencies) {
    this.dependencies = dependencies
  }

  async link(input: {
    actorId: string
    accountId: string
    authenticatedAt: number
    identity: ExternalIdentity
  }): Promise<AccountLinkingResult> {
    const denied = this.authorize(input.actorId, input.accountId, input.authenticatedAt)
    if (denied) return denied
    const account = this.dependencies.store.accounts.get(input.accountId)
    if (!account)
      return this.fail(
        input.accountId,
        ACCOUNT_LINKING_RESULT_CODE.NOT_FOUND,
        'Account was not found'
      )
    const existing = await this.dependencies.store.findIdentity(
      input.identity.providerId,
      input.identity.subject,
      input.identity.issuer
    )
    if (existing && existing.accountId !== input.accountId) {
      return this.fail(
        input.accountId,
        ACCOUNT_LINKING_RESULT_CODE.IDENTITY_COLLISION,
        'Identity is already linked'
      )
    }
    if (existing) return { ok: true, identity: existing }
    const linked: LinkedIdentity = {
      ...input.identity,
      accountId: input.accountId,
      linkedAt: this.dependencies.clock.now(),
    }
    await this.dependencies.store.saveIdentity(linked)
    await this.record(input.accountId, 'identity.linked', 'success', 'verified_identity')
    return { ok: true, identity: linked }
  }

  async unlink(input: {
    actorId: string
    accountId: string
    authenticatedAt: number
    providerId: string
    subject: string
    issuer?: string
  }): Promise<AccountUnlinkResult> {
    const denied = this.authorize(input.actorId, input.accountId, input.authenticatedAt)
    if (denied) return denied
    const issuer = input.issuer ?? 'https://idp.example.test'
    const existing = await this.dependencies.store.findIdentity(
      input.providerId,
      input.subject,
      issuer
    )
    if (!existing || existing.accountId !== input.accountId)
      return this.fail(
        input.accountId,
        ACCOUNT_LINKING_RESULT_CODE.NOT_FOUND,
        'Identity was not found'
      )
    if ((await this.dependencies.store.countAuthenticators(input.accountId)) <= 1) {
      return this.fail(
        input.accountId,
        ACCOUNT_LINKING_RESULT_CODE.LAST_AUTHENTICATOR,
        'At least one authenticator is required'
      )
    }
    await this.dependencies.store.deleteIdentity(input.providerId, input.subject, issuer)
    await this.record(input.accountId, 'identity.unlinked', 'success', 'authenticator_remaining')
    return { ok: true }
  }

  private authorize(
    actorId: string,
    accountId: string,
    authenticatedAt: number
  ): AccountLinkingFailure | undefined {
    if (actorId !== accountId)
      return {
        ok: false,
        code: ACCOUNT_LINKING_RESULT_CODE.FORBIDDEN,
        message: 'Account linking is not permitted',
      }
    if (this.dependencies.clock.now() - authenticatedAt > RECENT_AUTH_WINDOW_MS) {
      return {
        ok: false,
        code: ACCOUNT_LINKING_RESULT_CODE.RECENT_AUTH_REQUIRED,
        message: 'Recent authentication is required',
      }
    }
    return undefined
  }

  private async fail(
    accountId: string,
    code: AccountLinkingResultCode,
    message: string
  ): Promise<AccountLinkingFailure> {
    await this.record(accountId, 'identity.operation_denied', 'denied', code)
    return { ok: false, code, message }
  }

  private async record(
    accountId: string,
    kind: string,
    outcome: 'success' | 'denied',
    reason: string
  ): Promise<void> {
    await this.dependencies.audit.record({
      kind,
      accountId,
      outcome,
      reason,
      occurredAt: new Date(this.dependencies.clock.now()).toISOString(),
      metadata: { reason },
    })
  }
}
