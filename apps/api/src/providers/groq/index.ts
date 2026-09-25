const GROQ_NUMBERED_KEY_NAMES = [
  'GROQ_API_KEY_1',
  'GROQ_API_KEY_2',
  'GROQ_API_KEY_3',
  'GROQ_API_KEY_4',
  'GROQ_API_KEY_5',
  'GROQ_API_KEY_6',
] as const

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000
const DEFAULT_TRANSIENT_COOLDOWN_MS = 5_000
const DEFAULT_AUTH_COOLDOWN_MS = 15 * 60_000

export interface GroqCredentialMetadata {
  identifier: string
  healthy: boolean
  cooldownUntil: number | null
  lastErrorCode: 'AUTHENTICATION' | 'RATE_LIMITED' | 'TRANSIENT' | null
  requestCount: number
}

export interface GroqCredentialPoolOptions {
  fetch?: typeof fetch
  now?: () => number
  log?: (message: string) => void
  rateLimitCooldownMs?: number
  transientCooldownMs?: number
  authCooldownMs?: number
}

export interface GroqRequestInput {
  url: string
  createInit: () => RequestInit
  idempotent: true
}

export class GroqCredentialPoolUnavailableError extends Error {
  readonly code = 'GROQ_CREDENTIALS_UNAVAILABLE' as const

  constructor(readonly retryAfterMs: number) {
    super('Groq credentials are temporarily unavailable')
    this.name = 'GroqCredentialPoolUnavailableError'
  }
}

export class GroqCredentialRequestError extends Error {
  readonly code = 'GROQ_REQUEST_FAILED' as const

  constructor() {
    super('Groq request failed')
    this.name = 'GroqCredentialRequestError'
  }
}

type ConfiguredCredential = {
  identifier: string
  secret: string
}

type CredentialState = ConfiguredCredential & {
  healthy: boolean
  cooldownUntil: number | null
  lastErrorCode: GroqCredentialMetadata['lastErrorCode']
  requestCount: number
}

type CredentialFailure = {
  code: Exclude<GroqCredentialMetadata['lastErrorCode'], null>
  cooldownMs: number
  poolWide?: boolean
}

type AttemptResult = { response: Response; error?: never } | { response?: never; error: unknown }

export class GroqCredentialPool {
  private cursor = 0
  private readonly credentials: CredentialState[]
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly log?: (message: string) => void
  private readonly rateLimitCooldownMs: number
  private readonly transientCooldownMs: number
  private readonly authCooldownMs: number
  private poolCooldownUntil: number | null = null

  private constructor(
    configured: readonly ConfiguredCredential[],
    options: GroqCredentialPoolOptions = {}
  ) {
    this.credentials = configured.map((credential) => ({
      ...credential,
      healthy: true,
      cooldownUntil: null,
      lastErrorCode: null,
      requestCount: 0,
    }))
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.log = options.log
    this.rateLimitCooldownMs = boundedCooldown(
      options.rateLimitCooldownMs,
      DEFAULT_RATE_LIMIT_COOLDOWN_MS
    )
    this.transientCooldownMs = boundedCooldown(
      options.transientCooldownMs,
      DEFAULT_TRANSIENT_COOLDOWN_MS
    )
    this.authCooldownMs = boundedCooldown(options.authCooldownMs, DEFAULT_AUTH_COOLDOWN_MS)
  }

  static fromEnvironment(
    env: Record<string, string | undefined>,
    options: GroqCredentialPoolOptions = {}
  ): GroqCredentialPool | null {
    const numbered = GROQ_NUMBERED_KEY_NAMES.flatMap((name, index) => {
      const secret = env[name]?.trim()
      return secret ? [{ identifier: `groq-${index + 1}`, secret }] : []
    })
    if (numbered.length > 0) return new GroqCredentialPool(numbered, options)

    const legacy = env['GROQ_API_KEY']?.trim()
    return legacy
      ? new GroqCredentialPool([{ identifier: 'groq-1', secret: legacy }], options)
      : null
  }

  metadata(): readonly GroqCredentialMetadata[] {
    const now = this.now()
    for (const credential of this.credentials) {
      if (credential.cooldownUntil !== null && credential.cooldownUntil <= now) {
        credential.cooldownUntil = null
        credential.healthy = true
      }
    }
    return this.credentials.map(
      ({ identifier, healthy, cooldownUntil, lastErrorCode, requestCount }) => ({
        identifier,
        healthy,
        cooldownUntil,
        lastErrorCode,
        requestCount,
      })
    )
  }

  async request(input: GroqRequestInput): Promise<Response> {
    if (input.idempotent !== true) {
      throw new Error('Groq credential fallback requires an idempotent request')
    }
    const first = this.select()
    const firstAttempt = await this.attempt(first, input)
    const firstFailure = this.failureFor(firstAttempt)
    if (!firstFailure) return this.responseOrThrow(firstAttempt)

    this.cooldown(first, firstFailure)
    if (firstFailure.poolWide) return this.responseOrThrow(firstAttempt)

    let fallback: CredentialState
    try {
      fallback = this.select(new Set([first.identifier]))
    } catch (error) {
      if (!(error instanceof GroqCredentialPoolUnavailableError)) throw error
      return this.responseOrThrow(firstAttempt)
    }

    const fallbackAttempt = await this.attempt(fallback, input)
    const fallbackFailure = this.failureFor(fallbackAttempt)
    if (fallbackFailure) this.cooldown(fallback, fallbackFailure)
    return this.responseOrThrow(fallbackAttempt)
  }

  private select(excluded = new Set<string>()): CredentialState {
    const now = this.now()
    if (this.poolCooldownUntil !== null && this.poolCooldownUntil > now) {
      throw new GroqCredentialPoolUnavailableError(this.poolCooldownUntil - now)
    }
    if (this.poolCooldownUntil !== null) this.poolCooldownUntil = null
    let nextRetryAfterMs = Number.POSITIVE_INFINITY
    for (let offset = 0; offset < this.credentials.length; offset += 1) {
      const index = (this.cursor + offset) % this.credentials.length
      const credential = this.credentials[index]
      if (!credential) continue
      if (excluded.has(credential.identifier)) continue
      if (credential.cooldownUntil !== null && credential.cooldownUntil > now) {
        credential.healthy = false
        nextRetryAfterMs = Math.min(nextRetryAfterMs, credential.cooldownUntil - now)
        continue
      }
      if (credential.cooldownUntil !== null) {
        credential.cooldownUntil = null
        credential.healthy = true
      }
      this.cursor = (index + 1) % this.credentials.length
      credential.requestCount += 1
      this.log?.(`groq credential ${credential.identifier} selected`)
      return credential
    }
    throw new GroqCredentialPoolUnavailableError(
      Number.isFinite(nextRetryAfterMs) ? Math.max(0, nextRetryAfterMs) : 0
    )
  }

  private async attempt(
    credential: CredentialState,
    input: GroqRequestInput
  ): Promise<AttemptResult> {
    try {
      const init = input.createInit()
      const normalizedHeaders: Record<string, string> = {}
      new Headers(init.headers).forEach((value, name) => {
        normalizedHeaders[name] = value
      })
      delete normalizedHeaders['authorization']
      normalizedHeaders['authorization'] = `Bearer ${credential.secret}`
      return {
        response: await this.fetchImpl(input.url, { ...init, headers: normalizedHeaders }),
      }
    } catch (error) {
      return { error }
    }
  }

  private failureFor(attempt: AttemptResult): CredentialFailure | null {
    if ('error' in attempt) {
      return { code: 'TRANSIENT', cooldownMs: this.transientCooldownMs }
    }
    return classifyResponse(attempt.response, this.now(), {
      rateLimitCooldownMs: this.rateLimitCooldownMs,
      transientCooldownMs: this.transientCooldownMs,
      authCooldownMs: this.authCooldownMs,
    })
  }

  private cooldown(credential: CredentialState, failure: CredentialFailure): void {
    credential.healthy = false
    credential.lastErrorCode = failure.code
    credential.cooldownUntil = this.now() + failure.cooldownMs
    if (failure.poolWide) {
      this.poolCooldownUntil = Math.max(this.poolCooldownUntil ?? 0, credential.cooldownUntil)
    }
  }

  private responseOrThrow(attempt: AttemptResult): Response {
    if ('response' in attempt && attempt.response !== undefined) return attempt.response
    throw new GroqCredentialRequestError()
  }

  get configured(): boolean {
    return this.credentials.length > 0
  }

  get size(): number {
    return this.credentials.length
  }
}

export function crearPoolCredencialesGroq(
  env: Record<string, string | undefined>,
  options: GroqCredentialPoolOptions = {}
): GroqCredentialPool | null {
  return GroqCredentialPool.fromEnvironment(env, options)
}

export function tieneCredencialesGroq(env: Record<string, string | undefined>): boolean {
  return Boolean(crearPoolCredencialesGroq(env))
}

function classifyResponse(
  response: Response,
  now: number,
  cooldowns: {
    rateLimitCooldownMs: number
    transientCooldownMs: number
    authCooldownMs: number
  }
): CredentialFailure | null {
  const retryAfterMs = readRetryAfter(response.headers, now)
  if (response.status === 401 || response.status === 403) {
    return { code: 'AUTHENTICATION', cooldownMs: retryAfterMs ?? cooldowns.authCooldownMs }
  }
  if (response.status === 429 || response.status === 498) {
    return {
      code: 'RATE_LIMITED',
      cooldownMs: retryAfterMs ?? cooldowns.rateLimitCooldownMs,
      poolWide: !isCredentialScopedRateLimit(response.headers),
    }
  }
  if ([408, 425, 500, 502, 503, 504].includes(response.status)) {
    return { code: 'TRANSIENT', cooldownMs: retryAfterMs ?? cooldowns.transientCooldownMs }
  }
  return null
}

function readRetryAfter(headers: Headers, now: number): number | null {
  const value = headers.get('retry-after')?.trim()
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null
}

function isCredentialScopedRateLimit(headers: Headers): boolean {
  const scope =
    headers.get('x-groq-rate-limit-scope')?.trim().toLowerCase() ??
    headers.get('x-rate-limit-scope')?.trim().toLowerCase()
  return scope === 'key' || scope === 'credential'
}

function boundedCooldown(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value >= 0 ? value : fallback
}
