import type { AuthService } from '../application/auth-service.js'
import { OpaqueTokenIssuer } from '../adapters/crypto-security.js'
import { AUTH_EVENT_KIND } from '../domain/constants.js'
import {
  InMemoryOAuthProviderRegistry,
  InMemoryOAuthTransactionStore,
  RandomOAuthIdGenerator,
  RandomOAuthTokenGenerator,
  SystemOAuthClock,
} from '../oauth-oidc/adapters/in-memory.js'
import { GoogleOidcProvider } from '../oauth-oidc/adapters/google.js'
import { OAuthOidcService } from '../oauth-oidc/application/oauth-oidc-service.js'
import type { OAuthOidcProvider, OAuthTransactionStore } from '../oauth-oidc/ports.js'
import type { IdentityStore } from '../ports/identity-store.js'
import type { AuditSink } from '../ports/security.js'
import {
  InMemoryFederatedIdentityStore,
  InMemoryLoginCodeStore,
  PrismaFederatedIdentityStore,
  PrismaLoginCodeStore,
  PrismaOAuthTransactionStore,
  type FederatedPrismaClient,
} from './adapters/stores.js'
import { FederatedAuthService, type FederatedAuthConfig } from './application/federated-auth-service.js'
import type { FederatedIdentityStore, LoginCodeStore } from './ports.js'

export interface GoogleAuthSettings {
  clientId: string
  clientSecret: string
  redirectUri: string
  webBaseUrl: string
}

// Google is enabled only when every value is present (and HTTPS in production); otherwise the
// button shows as unavailable and no flow can start (fail closed).
export function readGoogleAuthSettings(env: Record<string, string | undefined>): GoogleAuthSettings | null {
  const clientId = env['GOOGLE_CLIENT_ID']?.trim()
  const clientSecret = env['GOOGLE_CLIENT_SECRET']?.trim()
  const redirectUri = env['GOOGLE_REDIRECT_URI']?.trim()
  const webBaseUrl = env['TUS_WEB_BASE_URL']?.trim()
  if (!clientId || !clientSecret || !redirectUri || !webBaseUrl) return null
  try {
    const redirect = new URL(redirectUri)
    const web = new URL(webBaseUrl)
    if (env['NODE_ENV']?.trim() === 'production' && (redirect.protocol !== 'https:' || web.protocol !== 'https:')) return null
    if (!redirect.pathname.endsWith('/auth/oauth/google/callback')) return null
  } catch {
    return null
  }
  return { clientId, clientSecret, redirectUri, webBaseUrl }
}

export function createFederatedAuth(input: {
  auth: AuthService
  identityStore: IdentityStore
  audit?: AuditSink
  settings: GoogleAuthSettings | null
  prisma?: FederatedPrismaClient
  // Tests inject a fake OIDC provider (never a fake "successful" login in production).
  provider?: OAuthOidcProvider
  identities?: FederatedIdentityStore
  codes?: LoginCodeStore
  transactions?: OAuthTransactionStore
  now?: () => number
}) {
  const settings = input.settings
  const provider = input.provider ?? (settings ? new GoogleOidcProvider({ clientId: settings.clientId, clientSecret: settings.clientSecret }) : null)
  const registry = new InMemoryOAuthProviderRegistry(new Map(provider ? [['google', provider]] : []))
  const transactions = input.transactions ?? (input.prisma ? new PrismaOAuthTransactionStore(input.prisma) : new InMemoryOAuthTransactionStore())
  const oauth = new OAuthOidcService({
    registry,
    transactions,
    tokens: new RandomOAuthTokenGenerator(),
    ids: new RandomOAuthIdGenerator(),
    clock: input.now ? { now: input.now } : new SystemOAuthClock(),
  })
  const tokens = new OpaqueTokenIssuer()
  const config: FederatedAuthConfig | null = settings && provider ? { providerId: 'google', redirectUri: settings.redirectUri, webBaseUrl: settings.webBaseUrl } : null
  const service = new FederatedAuthService({
    oauth,
    auth: input.auth,
    identityStore: input.identityStore,
    identities: input.identities ?? (input.prisma ? new PrismaFederatedIdentityStore(input.prisma) : new InMemoryFederatedIdentityStore()),
    codes: input.codes ?? (input.prisma ? new PrismaLoginCodeStore(input.prisma) : new InMemoryLoginCodeStore()),
    digestAccessToken: (token) => tokens.digest(token),
    config,
    ...(input.now ? { now: input.now } : {}),
    audit: async (event) => {
      await input.audit?.record({
        contractVersion: '1.0.0',
        kind: event.outcome === 'success' ? AUTH_EVENT_KIND.AUTH_SIGNED_IN : AUTH_EVENT_KIND.AUTH_FAILED,
        occurredAt: new Date((input.now ?? Date.now)()).toISOString(),
        actorId: event.accountId ?? 'anonymous',
        tenantId: 'unknown',
        outcome: event.outcome,
        correlationId: `federated-${Date.now().toString(36)}`,
        metadata: { reason: event.reason, method: 'google' },
      })
    },
  })
  return { service, oauth, webBaseUrl: settings?.webBaseUrl ?? null }
}

export { FederatedAuthService } from './application/federated-auth-service.js'
export { createFederatedAuthRouter } from './http/federated-router.js'
