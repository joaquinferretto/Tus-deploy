import {
  OAUTH_OIDC_RESULT_CODE,
  type OAuthIdentity,
  type OAuthOidcFailure,
  type OAuthTransaction,
} from '../domain.js'
import type {
  OAuthClock,
  OAuthOidcProvider,
  OAuthProviderRegistry,
  OAuthTokenGenerator,
  OAuthTransactionStore,
} from '../ports.js'
import { createPkceChallenge } from '../domain.js'

const TRANSACTION_TTL_MS = 5 * 60 * 1000

export interface OAuthOidcServiceDependencies {
  registry: OAuthProviderRegistry
  transactions: OAuthTransactionStore
  tokens: OAuthTokenGenerator
  ids: OAuthTokenGenerator
  clock: OAuthClock
}

export type AuthorizationResult =
  { ok: true; transactionId: string; state: string; authorizationUrl: string } | OAuthOidcFailure

export type CallbackResult = { ok: true; identity: OAuthIdentity } | OAuthOidcFailure

export class OAuthOidcService {
  private readonly dependencies: OAuthOidcServiceDependencies

  constructor(dependencies: OAuthOidcServiceDependencies) {
    this.dependencies = dependencies
  }

  async beginAuthorization(input: {
    providerId: string
    redirectUri: string
  }): Promise<AuthorizationResult> {
    const provider = this.dependencies.registry.find(input.providerId)
    if (!provider || !this.isActivated(provider)) {
      return this.fail(
        OAUTH_OIDC_RESULT_CODE.PROVIDER_UNAVAILABLE,
        'OAuth/OIDC provider is unavailable'
      )
    }
    const state = this.dependencies.tokens.next()
    const nonce = this.dependencies.tokens.next()
    const codeVerifier = this.dependencies.tokens.next()
    const transaction: OAuthTransaction = {
      id: this.dependencies.ids.next(),
      providerId: input.providerId,
      state,
      nonce,
      codeVerifier,
      redirectUri: input.redirectUri,
      expiresAt: this.dependencies.clock.now() + TRANSACTION_TTL_MS,
      consumedAt: null,
    }
    await this.dependencies.transactions.save(transaction)
    const url = new URL(provider.config.authorizationEndpoint)
    url.searchParams.set('client_id', provider.config.clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('state', state)
    url.searchParams.set('nonce', nonce)
    url.searchParams.set('code_challenge', createPkceChallenge(codeVerifier))
    url.searchParams.set('code_challenge_method', 'S256')
    return { ok: true, transactionId: transaction.id, state, authorizationUrl: url.toString() }
  }

  async handleCallback(input: {
    providerId: string
    redirectUri: string
    state: string
    code: string
  }): Promise<CallbackResult> {
    const transaction = await this.dependencies.transactions.find(input.state)
    if (
      !transaction ||
      transaction.providerId !== input.providerId ||
      transaction.redirectUri !== input.redirectUri
    ) {
      return this.fail(OAUTH_OIDC_RESULT_CODE.INVALID_STATE, 'OAuth state is invalid')
    }
    if (transaction.consumedAt !== null)
      return this.fail(OAUTH_OIDC_RESULT_CODE.REPLAYED, 'OAuth state was already used')
    if (transaction.expiresAt <= this.dependencies.clock.now()) {
      return this.fail(OAUTH_OIDC_RESULT_CODE.EXPIRED, 'OAuth state expired')
    }
    const provider = this.dependencies.registry.find(input.providerId)
    if (!provider || !this.isActivated(provider))
      return this.fail(
        OAUTH_OIDC_RESULT_CODE.PROVIDER_UNAVAILABLE,
        'OAuth/OIDC provider is unavailable'
      )
    transaction.consumedAt = this.dependencies.clock.now()
    await this.dependencies.transactions.save(transaction)
    const claims = await provider.exchangeCode({
      code: input.code,
      codeVerifier: transaction.codeVerifier,
      redirectUri: input.redirectUri,
      expectedNonce: transaction.nonce,
    })
    if (!claims) return this.fail(OAUTH_OIDC_RESULT_CODE.PKCE_FAILED, 'OAuth code exchange failed')
    if (claims.issuer !== provider.config.issuer)
      return this.fail(OAUTH_OIDC_RESULT_CODE.INVALID_ISSUER, 'OIDC issuer is invalid')
    if (claims.audience !== provider.config.clientId)
      return this.fail(OAUTH_OIDC_RESULT_CODE.INVALID_AUDIENCE, 'OIDC audience is invalid')
    if (claims.nonce !== transaction.nonce)
      return this.fail(OAUTH_OIDC_RESULT_CODE.INVALID_NONCE, 'OIDC nonce is invalid')
    if (claims.expiresAt <= this.dependencies.clock.now())
      return this.fail(OAUTH_OIDC_RESULT_CODE.EXPIRED, 'OIDC token expired')
    return {
      ok: true,
      identity: {
        providerId: provider.config.id,
        issuer: claims.issuer,
        subject: claims.subject,
        email: claims.email,
        emailVerified: claims.emailVerified,
        name: claims.name ?? null,
        picture: claims.picture ?? null,
      },
    }
  }

  private isActivated(provider: OAuthOidcProvider): boolean {
    const config = provider.config
    return Boolean(
      config.enabled &&
      config.credentialAvailable &&
      config.issuer &&
      config.clientId &&
      config.clientCredentialRef
    )
  }

  private fail(code: OAuthOidcFailure['code'], message: string): OAuthOidcFailure {
    return { ok: false, code, message }
  }
}
