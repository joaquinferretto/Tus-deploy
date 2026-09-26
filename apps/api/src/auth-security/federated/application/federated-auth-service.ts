import { randomBytes, randomUUID } from 'node:crypto'
import type { AuthService, SignInInput, SignInResult } from '../../application/auth-service.js'
import { normalizeEmail } from '../../domain/validation.js'
import type { OAuthOidcService } from '../../oauth-oidc/application/oauth-oidc-service.js'
import type { OAuthIdentity } from '../../oauth-oidc/domain.js'
import type { IdentityStore } from '../../ports/identity-store.js'
import {
  FEDERATED_RESULT_CODE,
  LOGIN_CODE_TTL_MS,
  RECENT_AUTH_FOR_LINK_MS,
  hashLoginCode,
  maskEmail,
  type FederatedFailure,
  type FederatedResultCode,
  type LoginCode,
  type LoginCodeKind,
  type LoginCodePayload,
} from '../domain.js'
import type { FederatedIdentityStore, LoginCodeStore } from '../ports.js'

export interface FederatedAuthConfig {
  providerId: 'google'
  // Registered callback of the API (for example https://api.example/auth/oauth/google/callback).
  redirectUri: string
  // Web origin that receives the result (for example https://www.example).
  webBaseUrl: string
}

export interface FederatedAuthDependencies {
  oauth: OAuthOidcService
  auth: AuthService
  identityStore: IdentityStore
  identities: FederatedIdentityStore
  codes: LoginCodeStore
  digestAccessToken: (token: string) => string
  config: FederatedAuthConfig | null
  now?: () => number
  audit?: (event: { kind: string; accountId: string | null; outcome: 'success' | 'denied'; reason: string }) => Promise<void>
}

type Result<T> = ({ ok: true } & T) | FederatedFailure

// Google sign-in and sign-up through ONE flow. Google proves the identity; TUS decides the
// account, tenant, roles and gates, and issues its normal session.
export class FederatedAuthService {
  constructor(private readonly dependencies: FederatedAuthDependencies) {}

  private now() {
    return (this.dependencies.now ?? Date.now)()
  }

  available(): boolean {
    return this.dependencies.config !== null
  }

  async start(): Promise<Result<{ authorizationUrl: string }>> {
    const config = this.dependencies.config
    if (!config) return this.fail(FEDERATED_RESULT_CODE.PROVIDER_UNAVAILABLE, 'Google sign-in is not configured')
    const result = await this.dependencies.oauth.beginAuthorization({ providerId: config.providerId, redirectUri: config.redirectUri })
    if (!result.ok) return this.fail(FEDERATED_RESULT_CODE.PROVIDER_UNAVAILABLE, result.message)
    const url = new URL(result.authorizationUrl)
    // Let the person choose the Google account instead of silently reusing one.
    url.searchParams.set('prompt', 'select_account')
    return { ok: true, authorizationUrl: url.toString() }
  }

  // Always answers with a Web URL. Results travel as single-use codes in the URL fragment.
  async callback(input: { state: unknown; code: unknown; error: unknown }): Promise<{ redirectTo: string }> {
    const config = this.dependencies.config
    if (!config) return { redirectTo: '/sign-in?error=google_unavailable' }
    const web = config.webBaseUrl.replace(/\/+$/u, '')
    const errorUrl = (reason: string) => ({ redirectTo: `${web}/sign-in?error=google_${reason}` })
    if (typeof input.error === 'string' && input.error) return errorUrl('cancelled')
    if (typeof input.state !== 'string' || typeof input.code !== 'string' || !input.state || !input.code) return errorUrl('invalid')
    let identity: OAuthIdentity
    try {
      const result = await this.dependencies.oauth.handleCallback({ providerId: config.providerId, redirectUri: config.redirectUri, state: input.state, code: input.code })
      if (!result.ok) {
        await this.audit(null, 'denied', `oauth_${result.code.toLowerCase()}`)
        return errorUrl('invalid')
      }
      identity = result.identity
    } catch {
      // Concurrent replay of the same state (atomic consumption in the store).
      await this.audit(null, 'denied', 'oauth_replayed')
      return errorUrl('invalid')
    }
    if (!identity.email || !identity.emailVerified) {
      await this.audit(null, 'denied', 'email_not_verified')
      return errorUrl('email_not_verified')
    }
    const linked = await this.dependencies.identities.find(identity.providerId, identity.issuer, identity.subject)
    if (linked) {
      const code = await this.issueCode('session', { accountId: linked.accountId })
      return { redirectTo: `${web}/ingresar/google#code=${code}` }
    }
    const identityPayload = { providerId: identity.providerId, issuer: identity.issuer, subject: identity.subject, email: identity.email, name: identity.name ?? null }
    const existing = await this.dependencies.identityStore.findAccountByEmail(normalizeEmail(identity.email))
    if (existing) {
      // Same email as an existing account: explicit linking after a password sign-in.
      const code = await this.issueCode('link', identityPayload)
      return { redirectTo: `${web}/ingresar/google#link=${code}` }
    }
    // A first Google visit uses the same completion screen as a returning user.
    // The short-lived signup code is exchanged for an account and a TUS session;
    // Google tokens and user data never travel in the redirect URL.
    const code = await this.issueCode('signup', identityPayload)
    return { redirectTo: `${web}/ingresar/google#code=${code}` }
  }

  async exchange(input: { code: unknown; device?: SignInInput['device'] }): Promise<SignInResult | FederatedFailure> {
    const signup = await this.peek(input.code, 'signup')
    if (signup) return this.registerAndSignIn({ code: input.code, device: input.device })
    const code = await this.consume(input.code, 'session')
    if (!code?.payload.accountId) return this.fail(FEDERATED_RESULT_CODE.INVALID_CODE, 'The sign-in link is invalid or expired')
    const result = await this.dependencies.auth.signInFederated({ accountId: code.payload.accountId, ...(input.device ? { device: input.device } : {}) })
    if (!result.ok) return this.fail(FEDERATED_RESULT_CODE.SIGN_IN_FAILED, 'The account cannot sign in')
    return result
  }

  async previewSignup(input: { code: unknown }): Promise<Result<{ email: string | null; name: string | null }>> {
    const code = await this.peek(input.code, 'signup')
    if (!code) return this.fail(FEDERATED_RESULT_CODE.INVALID_CODE, 'The sign-up link is invalid or expired')
    return { ok: true, email: code.payload.email ?? null, name: code.payload.name ?? null }
  }

  async completeSignup(input: { code: unknown; displayName: unknown; acceptedTerms: unknown; device?: SignInInput['device'] }): Promise<SignInResult | FederatedFailure> {
    if (input.acceptedTerms !== true) return this.fail(FEDERATED_RESULT_CODE.TERMS_REQUIRED, 'Terms must be accepted')
    return this.registerAndSignIn(input)
  }

  private async registerAndSignIn(input: { code: unknown; displayName?: unknown; device?: SignInInput['device'] }): Promise<SignInResult | FederatedFailure> {
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim().slice(0, 120) : ''
    const pending = await this.peek(input.code, 'signup')
    if (!pending?.payload.email || !pending.payload.subject) return this.fail(FEDERATED_RESULT_CODE.INVALID_CODE, 'The sign-up link is invalid or expired')
    const code = await this.consume(input.code, 'signup')
    if (!code) return this.fail(FEDERATED_RESULT_CODE.INVALID_CODE, 'The sign-up link is invalid or expired')
    // Another tab may have completed this Google identity since the callback.
    // Reuse only the verified provider/issuer/subject, never just a matching email.
    const linked = await this.dependencies.identities.find(code.payload.providerId!, code.payload.issuer!, code.payload.subject!)
    if (linked) {
      const session = await this.dependencies.auth.signInFederated({ accountId: linked.accountId, ...(input.device ? { device: input.device } : {}) })
      return session.ok ? session : this.fail(FEDERATED_RESULT_CODE.SIGN_IN_FAILED, 'The account cannot sign in')
    }
    const created = await this.dependencies.auth.registerFederated({ email: code.payload.email!, displayName: displayName || code.payload.name || code.payload.email!.split('@')[0]! })
    if (!created.ok) return this.fail(FEDERATED_RESULT_CODE.ACCOUNT_EXISTS, 'An account with this email already exists; sign in to link Google')
    await this.dependencies.identities.save({
      id: randomUUID(),
      accountId: created.account.id,
      providerId: code.payload.providerId!,
      issuer: code.payload.issuer!,
      subject: code.payload.subject!,
      email: code.payload.email ?? null,
      linkedAt: this.now(),
    })
    await this.audit(created.account.id, 'success', 'federated_identity_linked_at_signup')
    const session = await this.dependencies.auth.signInFederated({ accountId: created.account.id, ...(input.device ? { device: input.device } : {}) })
    return session.ok ? session : this.fail(FEDERATED_RESULT_CODE.SIGN_IN_FAILED, 'The account cannot sign in')
  }

  async previewLink(input: { code: unknown }): Promise<Result<{ emailMasked: string | null }>> {
    const code = await this.peek(input.code, 'link')
    if (!code) return this.fail(FEDERATED_RESULT_CODE.INVALID_CODE, 'The link is invalid or expired')
    return { ok: true, emailMasked: maskEmail(code.payload.email) }
  }

  // Requires a RECENT TUS session of the account that owns the same email (proof of possession of
  // the existing account), then links the Google identity to it.
  async link(input: { code: unknown; accessToken: string | null }): Promise<Result<{ linked: true }>> {
    const session = input.accessToken ? await this.dependencies.identityStore.findSessionByAccessTokenDigest(this.dependencies.digestAccessToken(input.accessToken)) : undefined
    if (!session || session.revokedAt !== null || session.expiresAt <= this.now() || this.now() - session.createdAt > RECENT_AUTH_FOR_LINK_MS)
      return this.fail(FEDERATED_RESULT_CODE.RECENT_AUTH_REQUIRED, 'Sign in again with your password to link Google')
    const account = await this.dependencies.identityStore.getAccount(session.accountId)
    const pending = await this.peek(input.code, 'link')
    if (!account || !pending?.payload.email) return this.fail(FEDERATED_RESULT_CODE.INVALID_CODE, 'The link is invalid or expired')
    if (account.normalizedEmail !== normalizeEmail(pending.payload.email)) {
      await this.audit(account.id, 'denied', 'federated_link_email_mismatch')
      return this.fail(FEDERATED_RESULT_CODE.EMAIL_MISMATCH, 'The Google email does not match this account')
    }
    const code = await this.consume(input.code, 'link')
    if (!code) return this.fail(FEDERATED_RESULT_CODE.INVALID_CODE, 'The link is invalid or expired')
    const collision = await this.dependencies.identities.find(code.payload.providerId!, code.payload.issuer!, code.payload.subject!)
    if (collision && collision.accountId !== account.id) return this.fail(FEDERATED_RESULT_CODE.IDENTITY_COLLISION, 'This Google account is linked to another TUS account')
    if (!collision)
      await this.dependencies.identities.save({
        id: randomUUID(),
        accountId: account.id,
        providerId: code.payload.providerId!,
        issuer: code.payload.issuer!,
        subject: code.payload.subject!,
        email: code.payload.email ?? null,
        linkedAt: this.now(),
      })
    await this.audit(account.id, 'success', 'federated_identity_linked')
    return { ok: true, linked: true }
  }

  private async issueCode(kind: LoginCodeKind, payload: LoginCodePayload): Promise<string> {
    const code = randomBytes(32).toString('base64url')
    const record: LoginCode = { id: randomUUID(), codeHash: hashLoginCode(code), kind, payload, expiresAt: this.now() + LOGIN_CODE_TTL_MS[kind], usedAt: null }
    await this.dependencies.codes.save(record)
    return code
  }

  private valid(code: unknown): code is string {
    return typeof code === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(code)
  }

  private async peek(code: unknown, kind: LoginCodeKind) {
    if (!this.valid(code)) return undefined
    const record = await this.dependencies.codes.peek(hashLoginCode(code), this.now())
    return record?.kind === kind ? record : undefined
  }

  private async consume(code: unknown, kind: LoginCodeKind) {
    if (!this.valid(code)) return undefined
    const peeked = await this.peek(code, kind)
    if (!peeked) return undefined
    return this.dependencies.codes.consume(hashLoginCode(code), this.now())
  }

  private async audit(accountId: string | null, outcome: 'success' | 'denied', reason: string) {
    await this.dependencies.audit?.({ kind: 'auth.federated', accountId, outcome, reason })
  }

  private fail(code: FederatedResultCode, message: string): FederatedFailure {
    return { ok: false, code, message }
  }
}
