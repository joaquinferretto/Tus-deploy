export const PROVIDER_NAMES = {
  B2: 'b2',
  POSTGRES: 'postgres',
  MONGO: 'mongo',
  REDIS: 'redis',
  SQS: 'sqs',
  AWS: 'aws',
  EMAIL: 'email',
  GROQ: 'groq',
  NOTIFICATIONS: 'notifications',
} as const

export type ProviderName = (typeof PROVIDER_NAMES)[keyof typeof PROVIDER_NAMES]

export const PROVIDER_STATUS = {
  FAKE: 'fake',
  CONFIGURED: 'configured',
  DISABLED: 'disabled',
  UNAVAILABLE: 'unavailable',
} as const

export type ProviderStatus = (typeof PROVIDER_STATUS)[keyof typeof PROVIDER_STATUS]

export const PROVIDER_LIVE_STATUS = {
  UNAVAILABLE: 'unavailable',
  DEFERRED: 'deferred',
  AUTHORIZED: 'authorized',
} as const

export type ProviderLiveStatus = (typeof PROVIDER_LIVE_STATUS)[keyof typeof PROVIDER_LIVE_STATUS]

export interface ProviderLiveDisposition {
  status: ProviderLiveStatus
  reason: string
}

export interface ProviderConfig {
  provider: ProviderName
  status: ProviderStatus
  configRef: string
  owner: string
  maxAttempts: number
  timeoutMs: number
  quotaUnits: number
  live: ProviderLiveDisposition
  liveConformanceClaimed: false
}

export interface ProviderRequest {
  operation: string
  tenantId: string
  actorId: string
  correlationId: string
  idempotencyKey: string
  quotaUnits: number
  payload: Readonly<Record<string, unknown>>
}

export interface ProviderResult {
  provider: ProviderName
  operation: string
  status: 'success'
  output: unknown
  attempts: number
  duplicate: boolean
  quotaUnits: number
  correlationId: string
}

export interface ProviderTransport {
  execute(request: ProviderRequest): Promise<unknown>
}

export type ProviderTransportInput = ProviderTransport | ProviderTransport['execute']

export interface ProviderAdapterPort {
  readonly config: ProviderConfig
  execute(request: ProviderRequest): Promise<ProviderResult>
}

export interface ProviderAdapterOptions {
  configRef?: string
  owner?: string
  status?: ProviderStatus
  maxAttempts?: number
  timeoutMs?: number
  quotaUnits?: number
  live?: ProviderLiveDisposition
}

export interface DeterministicProviderOptions extends ProviderAdapterOptions {
  quotaUnits?: number
}

export class ProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE'
  readonly provider: ProviderName

  constructor(provider: ProviderName, reason = 'provider is unavailable') {
    super(`${provider} ${reason}`)
    this.name = 'ProviderUnavailableError'
    this.provider = provider
  }
}

export class ProviderTimeoutError extends Error {
  readonly code = 'PROVIDER_TIMEOUT'
  readonly provider: ProviderName

  constructor(provider: ProviderName, reason = 'provider request timed out') {
    super(`${provider} ${reason}`)
    this.name = 'ProviderTimeoutError'
    this.provider = provider
  }
}

export class ProviderTransientError extends Error {
  readonly code = 'PROVIDER_RETRYABLE_FAILURE'
  readonly provider: ProviderName

  constructor(provider: ProviderName, reason = 'provider request failed temporarily') {
    super(`${provider} ${reason}`)
    this.name = 'ProviderTransientError'
    this.provider = provider
  }
}

export class ProviderQuotaError extends Error {
  readonly code = 'PROVIDER_QUOTA_EXCEEDED'
  readonly provider: ProviderName

  constructor(provider: ProviderName) {
    super(`${provider} provider quota exceeded`)
    this.name = 'ProviderQuotaError'
    this.provider = provider
  }
}

export class NeutralProviderAdapterError extends Error {
  readonly code = 'PROVIDER_ADAPTER_FAILED'
  readonly provider: ProviderName

  constructor(provider: ProviderName) {
    super(`${provider} provider request failed`)
    this.name = 'NeutralProviderAdapterError'
    this.provider = provider
  }
}

export function createProviderConfig(
  provider: ProviderName,
  options: ProviderAdapterOptions = {}
): ProviderConfig {
  const configRef = options.configRef ?? `local:provider:${provider}`
  if (!configRef.trim()) throw new Error(`${provider} config reference is required`)

  return {
    provider,
    status: options.status ?? PROVIDER_STATUS.CONFIGURED,
    configRef,
    owner: options.owner ?? 'platform-provider-owner',
    maxAttempts: options.maxAttempts ?? 3,
    timeoutMs: options.timeoutMs ?? 5_000,
    quotaUnits: options.quotaUnits ?? Number.MAX_SAFE_INTEGER,
    live: options.live ?? {
      status: PROVIDER_LIVE_STATUS.UNAVAILABLE,
      reason: 'credentials, resources, and authorized live conformance are unavailable',
    },
    liveConformanceClaimed: false,
  }
}

function assertRequest(request: ProviderRequest): void {
  const fields = {
    operation: request.operation,
    tenantId: request.tenantId,
    actorId: request.actorId,
    correlationId: request.correlationId,
    idempotencyKey: request.idempotencyKey,
  }
  for (const [name, value] of Object.entries(fields)) {
    if (!value.trim()) throw new Error(`provider request ${name} is required`)
  }
  if (!Number.isInteger(request.quotaUnits) || request.quotaUnits < 1)
    throw new Error('provider request quotaUnits must be positive')
}

function isRetryable(error: unknown): boolean {
  return error instanceof ProviderTimeoutError || error instanceof ProviderTransientError
}

function cloneResult(result: ProviderResult, duplicate: boolean): ProviderResult {
  return {
    ...result,
    output: result.output,
    duplicate,
  }
}

export function redactProviderError(
  provider: ProviderName,
  _error: unknown
): NeutralProviderAdapterError {
  return new NeutralProviderAdapterError(provider)
}

function withTimeout<T>(
  promise: Promise<T>,
  provider: ProviderName,
  timeoutMs: number
): Promise<T> {
  if (timeoutMs <= 0) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProviderTimeoutError(provider)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export class ConfiguredProviderAdapter implements ProviderAdapterPort {
  readonly config: ProviderConfig
  private readonly transport: ProviderTransport
  private readonly completed = new Map<string, ProviderResult>()
  private consumedQuota = 0

  constructor(config: ProviderConfig, transport: ProviderTransportInput) {
    this.config = config
    this.transport = typeof transport === 'function' ? { execute: transport } : transport
  }

  get status(): ProviderStatus {
    return this.config.status
  }

  get live(): ProviderLiveDisposition {
    return this.config.live
  }

  get liveConformanceClaimed(): false {
    return this.config.liveConformanceClaimed
  }

  async execute(request: ProviderRequest): Promise<ProviderResult> {
    assertRequest(request)
    if (this.config.status === PROVIDER_STATUS.DISABLED)
      throw new ProviderUnavailableError(this.config.provider, 'provider is disabled')
    if (this.config.status === PROVIDER_STATUS.UNAVAILABLE)
      throw new ProviderUnavailableError(this.config.provider)

    const existing = this.completed.get(request.idempotencyKey)
    if (existing) return cloneResult(existing, true)

    if (this.consumedQuota + request.quotaUnits > this.config.quotaUnits)
      throw new ProviderQuotaError(this.config.provider)

    let attempts = 0
    while (attempts < this.config.maxAttempts) {
      attempts += 1
      try {
        const output = await withTimeout(
          this.transport.execute(request),
          this.config.provider,
          this.config.timeoutMs
        )
        const result: ProviderResult = {
          provider: this.config.provider,
          operation: request.operation,
          status: 'success',
          output,
          attempts,
          duplicate: false,
          quotaUnits: request.quotaUnits,
          correlationId: request.correlationId,
        }
        this.consumedQuota += request.quotaUnits
        this.completed.set(request.idempotencyKey, result)
        return result
      } catch (error) {
        if (isRetryable(error) && attempts < this.config.maxAttempts) continue
        if (error instanceof ProviderTimeoutError) throw error
        if (error instanceof ProviderQuotaError) throw error
        throw redactProviderError(this.config.provider, error)
      }
    }
    throw new NeutralProviderAdapterError(this.config.provider)
  }
}

interface DeterministicTransportState {
  provider: ProviderName
  failNext: number
  timeoutNext: number
}

class DeterministicProviderTransport implements ProviderTransport {
  private readonly state: DeterministicTransportState

  constructor(state: DeterministicTransportState) {
    this.state = state
  }

  async execute(request: ProviderRequest): Promise<unknown> {
    if (this.state.timeoutNext > 0) {
      this.state.timeoutNext -= 1
      throw new ProviderTimeoutError(this.state.provider)
    }
    if (this.state.failNext > 0) {
      this.state.failNext -= 1
      throw new ProviderTransientError(this.state.provider)
    }
    return {
      provider: this.state.provider,
      accepted: true,
      operation: request.operation,
      payloadFields: Object.keys(request.payload).sort(),
    }
  }
}

export class DeterministicProviderFake extends ConfiguredProviderAdapter {
  private readonly state: DeterministicTransportState

  constructor(provider: ProviderName, options: DeterministicProviderOptions = {}) {
    const state: DeterministicTransportState = { provider, failNext: 0, timeoutNext: 0 }
    super(
      createProviderConfig(provider, {
        ...options,
        status: PROVIDER_STATUS.FAKE,
        configRef: options.configRef ?? `local:fake:${provider}`,
      }),
      new DeterministicProviderTransport(state)
    )
    this.state = state
  }

  get failNext(): number {
    return this.state.failNext
  }

  set failNext(value: number) {
    this.state.failNext = value
  }

  get timeoutNext(): number {
    return this.state.timeoutNext
  }

  set timeoutNext(value: number) {
    this.state.timeoutNext = value
  }
}

export type ProviderRegistry = {
  [provider in ProviderName]: ConfiguredProviderAdapter | DeterministicProviderFake
}

export interface ProviderRegistryOptions {
  configured?: readonly ProviderName[]
  transports?: Partial<Record<ProviderName, ProviderTransport['execute']>>
  maxAttempts?: number
  timeoutMs?: number
  quotaUnits?: number
}

class UnavailableProviderTransport implements ProviderTransport {
  private readonly provider: ProviderName

  constructor(provider: ProviderName) {
    this.provider = provider
  }

  execute(): Promise<unknown> {
    return Promise.reject(new ProviderUnavailableError(this.provider))
  }
}

function createConfiguredProvider(
  provider: ProviderName,
  options: ProviderRegistryOptions
): ConfiguredProviderAdapter {
  const execute = options.transports?.[provider]
  const transport: ProviderTransport = execute
    ? { execute }
    : new UnavailableProviderTransport(provider)
  return new ConfiguredProviderAdapter(
    createProviderConfig(provider, {
      status: PROVIDER_STATUS.CONFIGURED,
      configRef: `secret-store:${provider}`,
      maxAttempts: options.maxAttempts,
      timeoutMs: options.timeoutMs,
      quotaUnits: options.quotaUnits,
    }),
    transport
  )
}

export function createDeterministicProviderRegistry(
  options: DeterministicProviderOptions = {}
): ProviderRegistry {
  return {
    b2: new DeterministicProviderFake(PROVIDER_NAMES.B2, options),
    postgres: new DeterministicProviderFake(PROVIDER_NAMES.POSTGRES, options),
    mongo: new DeterministicProviderFake(PROVIDER_NAMES.MONGO, options),
    redis: new DeterministicProviderFake(PROVIDER_NAMES.REDIS, options),
    sqs: new DeterministicProviderFake(PROVIDER_NAMES.SQS, options),
    aws: new DeterministicProviderFake(PROVIDER_NAMES.AWS, options),
    email: new DeterministicProviderFake(PROVIDER_NAMES.EMAIL, options),
    groq: new DeterministicProviderFake(PROVIDER_NAMES.GROQ, options),
    notifications: new DeterministicProviderFake(PROVIDER_NAMES.NOTIFICATIONS, options),
  }
}

export function createProviderRegistry(options: ProviderRegistryOptions = {}): ProviderRegistry {
  const configured = new Set(options.configured ?? [])
  const providers = Object.values(PROVIDER_NAMES)
  return Object.fromEntries(
    providers.map((provider) => [
      provider,
      configured.has(provider)
        ? createConfiguredProvider(provider, options)
        : new DeterministicProviderFake(provider, {
            maxAttempts: options.maxAttempts,
            timeoutMs: options.timeoutMs,
            quotaUnits: options.quotaUnits,
          }),
    ])
  ) as ProviderRegistry
}

export default {
  PROVIDER_NAMES,
  PROVIDER_STATUS,
  PROVIDER_LIVE_STATUS,
  ProviderUnavailableError,
  ProviderTimeoutError,
  ProviderTransientError,
  ProviderQuotaError,
  NeutralProviderAdapterError,
  ConfiguredProviderAdapter,
  DeterministicProviderFake,
  createProviderConfig,
  createDeterministicProviderRegistry,
  createProviderRegistry,
  redactProviderError,
}
