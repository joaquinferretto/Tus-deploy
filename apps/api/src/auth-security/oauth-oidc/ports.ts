import type { OAuthOidcProviderConfig, OAuthTransaction, OidcTokenClaims } from './domain.js'

export interface OAuthTransactionStore {
  readonly transactions: Map<string, OAuthTransaction>
  save(transaction: OAuthTransaction): Promise<void>
  find(state: string): Promise<OAuthTransaction | undefined>
}

export interface OAuthOidcProvider {
  readonly config: OAuthOidcProviderConfig
  exchangeCode(input: {
    code: string
    codeVerifier: string
    redirectUri: string
    expectedNonce: string
  }): Promise<OidcTokenClaims | undefined>
}

export interface OAuthProviderRegistry {
  find(providerId: string): OAuthOidcProvider | undefined
}

export interface OAuthTokenGenerator {
  next(): string
}

export interface OAuthClock {
  now(): number
}
