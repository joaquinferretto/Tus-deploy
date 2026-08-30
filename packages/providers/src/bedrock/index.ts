const BEDROCK_REQUIREMENT_KEYS = {
  CREDITS: 'credits',
  CREDENTIALS: 'credentials',
  REGION: 'region',
  QUOTA: 'quota',
  OWNER_APPROVAL: 'ownerApproval',
  LIVE_CONFORMANCE: 'liveConformance',
} as const

export type BedrockRequirement =
  (typeof BEDROCK_REQUIREMENT_KEYS)[keyof typeof BEDROCK_REQUIREMENT_KEYS]

export interface BedrockActivationRequirements {
  credits: boolean
  credentials: boolean
  region: boolean
  quota: boolean
  ownerApproval: boolean
  liveConformance: boolean
}

const DEFAULT_REQUIREMENTS: BedrockActivationRequirements = {
  credits: false,
  credentials: false,
  region: false,
  quota: false,
  ownerApproval: false,
  liveConformance: false,
}

export class BedrockProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE'

  constructor(message = 'Bedrock activation is gated until required evidence exists') {
    super(message)
    this.name = 'BedrockProviderUnavailableError'
  }
}

export class ProviderAdapterError extends Error {
  readonly code = 'PROVIDER_ADAPTER_FAILED'

  constructor(message: string) {
    super(message)
    this.name = 'ProviderAdapterError'
  }
}

export interface BedrockActivationOptions {
  configRef: string
  region: string
  requirements?: Partial<BedrockActivationRequirements>
}

export class BedrockActivationGate {
  readonly configRef: string
  readonly region: string
  readonly requirements: BedrockActivationRequirements

  constructor(options: BedrockActivationOptions) {
    if (!options.configRef.trim()) throw new Error('Bedrock config reference is required')
    this.configRef = options.configRef
    this.region = options.region.trim()
    this.requirements = { ...DEFAULT_REQUIREMENTS, ...options.requirements }
  }

  get missingRequirements(): BedrockRequirement[] {
    const missing: BedrockRequirement[] = []
    if (!this.requirements.credits) missing.push(BEDROCK_REQUIREMENT_KEYS.CREDITS)
    if (!this.requirements.credentials) missing.push(BEDROCK_REQUIREMENT_KEYS.CREDENTIALS)
    if (!this.requirements.region || !this.region) missing.push(BEDROCK_REQUIREMENT_KEYS.REGION)
    if (!this.requirements.quota) missing.push(BEDROCK_REQUIREMENT_KEYS.QUOTA)
    if (!this.requirements.ownerApproval) missing.push(BEDROCK_REQUIREMENT_KEYS.OWNER_APPROVAL)
    if (!this.requirements.liveConformance) missing.push(BEDROCK_REQUIREMENT_KEYS.LIVE_CONFORMANCE)
    return missing
  }

  get active(): boolean {
    return this.missingRequirements.length === 0
  }

  assertActive(): void {
    if (!this.active) throw new BedrockProviderUnavailableError()
  }
}

export interface BedrockLineage {
  tenantId: string
  actorId: string
  correlationId: string
  rootMessageId: string
  source: string
}

export interface BedrockRequest {
  service: string
  operation: string
  payload: unknown
  lineage: BedrockLineage
}

export interface BedrockUsage {
  inputUnits: number
  outputUnits: number
  estimatedCostUsd: number
}

export interface BedrockResponse<TOutput = string> {
  output: TOutput
  provider: 'fake' | 'bedrock'
  service: string
  operation: string
  usage: BedrockUsage
  lineage: BedrockLineage
}

export type BedrockTransport = (request: BedrockRequest) => Promise<string>

export class DeterministicBedrockFake {
  readonly provider = 'fake' as const

  async invoke(request: BedrockRequest): Promise<BedrockResponse> {
    const canonical = canonicalize(request.payload)
    const digest = await digestValue(canonical)
    return {
      output: `fake-${request.service}-${digest.slice(0, 16)}`,
      provider: this.provider,
      service: request.service,
      operation: request.operation,
      usage: { inputUnits: canonical.length, outputUnits: 1, estimatedCostUsd: 0 },
      lineage: { ...request.lineage },
    }
  }
}

export interface BedrockAdapterOptions extends BedrockActivationOptions {
  costPerOutputUnitUsd?: number
}

export class BedrockAdapter {
  readonly provider = 'bedrock' as const
  readonly configRef: string
  private readonly gate: BedrockActivationGate
  private readonly transport?: BedrockTransport
  private readonly costPerOutputUnitUsd: number

  constructor(transport: BedrockTransport | undefined, options: BedrockAdapterOptions) {
    if ((options.costPerOutputUnitUsd ?? 0.01) < 0)
      throw new Error('Bedrock cost must be non-negative')
    this.transport = transport
    this.gate = new BedrockActivationGate(options)
    this.configRef = options.configRef
    this.costPerOutputUnitUsd = options.costPerOutputUnitUsd ?? 0.01
  }

  get active(): boolean {
    return this.gate.active && this.transport !== undefined
  }

  get activation(): BedrockActivationGate {
    return this.gate
  }

  async invoke(request: BedrockRequest): Promise<BedrockResponse> {
    this.gate.assertActive()
    if (!this.transport)
      throw new BedrockProviderUnavailableError(
        'Bedrock provider is active but transport is unavailable'
      )
    let output: string
    try {
      output = await this.transport(request)
    } catch {
      throw new ProviderAdapterError('Bedrock provider request failed')
    }
    if (!output.trim()) throw new ProviderAdapterError('Bedrock provider returned no output')
    return {
      output: output.trim(),
      provider: this.provider,
      service: request.service,
      operation: request.operation,
      usage: {
        inputUnits: canonicalize(request.payload).length,
        outputUnits: output.trim().split(/\s+/u).length,
        estimatedCostUsd: Number(
          (output.trim().split(/\s+/u).length * this.costPerOutputUnitUsd).toFixed(8)
        ),
      },
      lineage: { ...request.lineage },
    }
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function digestValue(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export default { BedrockActivationGate, BedrockAdapter, DeterministicBedrockFake }
