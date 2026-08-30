import { randomBytes, randomUUID } from 'node:crypto'
import type {
  OAuthIdentity,
  OAuthOidcProviderConfig,
  OAuthTransaction,
  OidcTokenClaims,
} from '../domain.js'
import type {
  OAuthClock,
  OAuthOidcProvider,
  OAuthProviderRegistry,
  OAuthTokenGenerator,
  OAuthTransactionStore,
} from '../ports.js'
import { createPkceChallenge } from '../domain.js'

export class InMemoryOAuthTransactionStore implements OAuthTransactionStore {
  readonly transactions = new Map<string, OAuthTransaction>()

  async save(transaction: OAuthTransaction): Promise<void> {
    this.transactions.set(transaction.state, transaction)
  }

  async find(state: string): Promise<OAuthTransaction | undefined> {
    return this.transactions.get(state)
  }
}

export class DeterministicOAuthTokenGenerator implements OAuthTokenGenerator {
  private sequence = 0

  next(): string {
    this.sequence += 1
    return `oauth-token-${this.sequence}`
  }
}

export class RandomOAuthTokenGenerator implements OAuthTokenGenerator {
  next(): string {
    return randomBytes(32).toString('base64url')
  }
}

export class SystemOAuthClock implements OAuthClock {
  now(): number {
    return Date.now()
  }
}

export class FakeOidcProvider implements OAuthOidcProvider {
  private readonly codes = new Map<
    string,
    { identity: OAuthIdentity; nonce?: string; expectedCodeChallenge?: string }
  >()
  readonly config: OAuthOidcProviderConfig

  constructor(config: OAuthOidcProviderConfig) {
    this.config = config
  }

  issueCode(
    code: string,
    identity: Pick<OAuthIdentity, 'subject' | 'email'>,
    options: { nonce?: string; expectedCodeChallenge?: string } = {}
  ): void {
    this.codes.set(code, {
      identity: {
        providerId: this.config.id,
        issuer: this.config.issuer,
        subject: identity.subject,
        email: identity.email,
        emailVerified: true,
      },
      ...options,
    })
  }

  async exchangeCode(input: {
    code: string
    codeVerifier: string
    redirectUri: string
    expectedNonce: string
  }): Promise<OidcTokenClaims | undefined> {
    const record = this.codes.get(input.code)
    if (!record || !input.codeVerifier || !input.redirectUri) return undefined
    if (
      record.expectedCodeChallenge &&
      record.expectedCodeChallenge !== createPkceChallenge(input.codeVerifier)
    ) {
      return undefined
    }
    return {
      issuer: record.identity.issuer,
      audience: this.config.clientId,
      subject: record.identity.subject,
      nonce: record.nonce ?? input.expectedNonce,
      email: record.identity.email,
      emailVerified: record.identity.emailVerified,
      expiresAt: Date.now() + 60_000,
    }
  }
}

export class InMemoryOAuthProviderRegistry implements OAuthProviderRegistry {
  private readonly providers: Map<string, OAuthOidcProvider>

  constructor(providers: Map<string, OAuthOidcProvider>) {
    this.providers = providers
  }

  find(providerId: string): OAuthOidcProvider | undefined {
    return this.providers.get(providerId)
  }
}

export class RandomOAuthIdGenerator {
  next(): string {
    return randomUUID()
  }
}
