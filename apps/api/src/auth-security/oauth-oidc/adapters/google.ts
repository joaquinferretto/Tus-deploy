import { createPublicKey, verify } from 'node:crypto'
import type { webcrypto } from 'node:crypto'
import type { OAuthOidcProviderConfig, OidcTokenClaims } from '../domain.js'
import type { OAuthOidcProvider } from '../ports.js'

// Google OpenID Connect (authorization code + PKCE). The ID token is only trusted after its RS256
// signature is verified against Google's published keys; issuer, audience, nonce and expiry are
// then checked by OAuthOidcService. No Google access or refresh token is stored.

export const GOOGLE_ISSUER = 'https://accounts.google.com'
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])
export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs'

export interface GoogleOidcConfig {
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
  now?: () => number
  tokenEndpoint?: string
  jwksUri?: string
}

interface Jwk extends webcrypto.JsonWebKey {
  kid?: string
}

export function googleProviderConfig(clientId: string, credentialAvailable: boolean): OAuthOidcProviderConfig {
  return {
    id: 'google',
    issuer: GOOGLE_ISSUER,
    clientId,
    clientCredentialRef: 'env:GOOGLE_CLIENT_SECRET',
    authorizationEndpoint: GOOGLE_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    enabled: true,
    credentialAvailable,
  }
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export class GoogleOidcProvider implements OAuthOidcProvider {
  readonly config: OAuthOidcProviderConfig
  private keys: { values: Jwk[]; expiresAt: number } | null = null

  constructor(private readonly options: GoogleOidcConfig) {
    this.config = googleProviderConfig(options.clientId, Boolean(options.clientSecret))
  }

  private get fetchImpl() {
    return this.options.fetch ?? fetch
  }

  private now() {
    return (this.options.now ?? Date.now)()
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string; expectedNonce: string }): Promise<OidcTokenClaims | undefined> {
    if (!input.code || !input.codeVerifier || !input.redirectUri) return undefined
    let response: Response
    try {
      response = await this.fetchImpl(this.options.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          code_verifier: input.codeVerifier,
          redirect_uri: input.redirectUri,
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      return undefined
    }
    if (!response.ok) return undefined
    const payload = (await response.json().catch(() => null)) as { id_token?: unknown } | null
    if (typeof payload?.id_token !== 'string') return undefined
    return this.verifyIdToken(payload.id_token)
  }

  // Signature first; claims are only read from a verified token.
  async verifyIdToken(idToken: string): Promise<OidcTokenClaims | undefined> {
    const parts = idToken.split('.')
    if (parts.length !== 3) return undefined
    const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string]
    const header = decodeSegment(headerSegment)
    if (!header || header['alg'] !== 'RS256' || typeof header['kid'] !== 'string') return undefined
    const jwk = await this.findKey(header['kid'])
    if (!jwk) return undefined
    let valid = false
    try {
      valid = verify(
        'RSA-SHA256',
        Buffer.from(`${headerSegment}.${payloadSegment}`),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(signatureSegment, 'base64url')
      )
    } catch {
      valid = false
    }
    if (!valid) return undefined
    const claims = decodeSegment(payloadSegment)
    if (!claims) return undefined
    const issuer = typeof claims['iss'] === 'string' && GOOGLE_ISSUERS.has(claims['iss']) ? GOOGLE_ISSUER : String(claims['iss'] ?? '')
    const audiences = Array.isArray(claims['aud']) ? claims['aud'].map(String) : [String(claims['aud'] ?? '')]
    const audience = audiences.includes(this.options.clientId) ? this.options.clientId : (audiences[0] ?? '')
    const subject = typeof claims['sub'] === 'string' ? claims['sub'] : ''
    const expiresAt = Number(claims['exp']) * 1000
    if (!subject || !Number.isFinite(expiresAt)) return undefined
    return {
      issuer,
      audience,
      subject,
      nonce: typeof claims['nonce'] === 'string' ? claims['nonce'] : '',
      email: typeof claims['email'] === 'string' ? claims['email'] : null,
      emailVerified: claims['email_verified'] === true || claims['email_verified'] === 'true',
      expiresAt,
      name: typeof claims['name'] === 'string' ? claims['name'].slice(0, 120) : null,
      picture: typeof claims['picture'] === 'string' && claims['picture'].startsWith('https://') ? claims['picture'] : null,
    }
  }

  private async findKey(kid: string): Promise<Jwk | undefined> {
    const current = this.keys && this.keys.expiresAt > this.now() ? this.keys.values : null
    const cached = current?.find((key) => key.kid === kid)
    if (cached) return cached
    // Unknown kid (key rotation) or expired cache: refresh once.
    try {
      const response = await this.fetchImpl(this.options.jwksUri ?? GOOGLE_JWKS_URI, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) return undefined
      const payload = (await response.json()) as { keys?: Jwk[] }
      const maxAge = Number(/max-age=(\d+)/u.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600)
      this.keys = { values: (payload.keys ?? []).filter((key) => key.kty === 'RSA'), expiresAt: this.now() + Math.min(maxAge, 86_400) * 1000 }
    } catch {
      return undefined
    }
    return this.keys.values.find((key) => key.kid === kid)
  }
}
