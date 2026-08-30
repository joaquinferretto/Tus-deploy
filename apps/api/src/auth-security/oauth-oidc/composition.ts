import { OAuthOidcService } from './application/oauth-oidc-service.js'
import {
  DeterministicOAuthTokenGenerator,
  FakeOidcProvider,
  InMemoryOAuthProviderRegistry,
  InMemoryOAuthTransactionStore,
  SystemOAuthClock,
} from './adapters/in-memory.js'

export function createInMemoryOAuthOidcService(options: { now?: () => number } = {}) {
  const provider = new FakeOidcProvider({
    id: 'local',
    issuer: 'https://idp.example.test',
    clientId: 'factory-client',
    clientCredentialRef: 'secret-ref/oauth/local',
    authorizationEndpoint: 'https://idp.example.test/authorize',
    tokenEndpoint: 'https://idp.example.test/token',
    enabled: true,
    credentialAvailable: true,
  })
  const providers = new InMemoryOAuthProviderRegistry(new Map([['local', provider]]))
  const transactions = new InMemoryOAuthTransactionStore()
  const clock = options.now ? { now: options.now } : new SystemOAuthClock()
  const service = new OAuthOidcService({
    registry: providers,
    transactions,
    tokens: new DeterministicOAuthTokenGenerator(),
    ids: new DeterministicOAuthTokenGenerator(),
    clock,
  })
  return {
    service,
    provider,
    transactions,
    beginAuthorization: service.beginAuthorization.bind(service),
    handleCallback: service.handleCallback.bind(service),
  }
}

export { OAuthOidcService } from './application/oauth-oidc-service.js'
export { FakeOidcProvider } from './adapters/in-memory.js'
export type * from './domain.js'
export type * from './ports.js'
