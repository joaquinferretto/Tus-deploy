export const CONFIG_CONTRACT_VERSION = '1.0.0' as const

export * from './feature-flags.ts'

export type RuntimeRole = 'api-edge' | 'workflow-runtime' | 'worker'
export type Environment = 'development' | 'test' | 'staging' | 'production'
export type RuntimeProfile = 'local' | 'render' | 'aws'

export interface RuntimeConfig {
  role: RuntimeRole
  environment: Environment
  profile: RuntimeProfile
  contractVersion: typeof CONFIG_CONTRACT_VERSION
  serviceName: string
  serviceVersion: string
  telemetry: {
    otlpEndpoint?: string
    logLevel: 'debug' | 'info' | 'warn' | 'error'
    sampleRatio: number
  }
  storage: {
    assetBucket?: string
    publicBaseUrl?: string
  }
  runtime: {
    shutdownTimeoutMs: number
    maxConcurrency: number
  }
  providers: {
    llm: string
    objectStorage: string
    queue: string
  }
  databases: {
    postgres: string
    mongo: string
    redis: string
  }
  security: {
    secretStoreRef?: string
  }
}

export interface RuntimePorts {
  http?: number
  metrics?: number
}

export type DependencyMode = 'required' | 'optional' | 'disabled' | 'fake'
export type DependencyStatus = 'ready' | 'unavailable'
export type NativeDependency =
  'postgres' | 'mongodb' | 'redis' | 'pythonWorker' | 'mobileSupport' | 'externalProviders'
export type NativeDependencyModes = Record<Exclude<NativeDependency, 'postgres'>, DependencyMode>

export interface DependencyReport {
  mode: DependencyMode
  status: DependencyStatus
  blocksApiReadiness: boolean
}

export interface NativeReadiness {
  profile: 'native' | 'compose'
  postgres: DependencyReport
  mongodb: DependencyReport
  redis: DependencyReport
  pythonWorker: DependencyReport
  mobileSupport: DependencyReport
  externalProviders: DependencyReport
}

export interface NativeReadinessOptions {
  profile?: 'native' | 'compose'
  postgresCheck?: () => Promise<boolean> | boolean
  modes?: Partial<NativeDependencyModes>
  checks?: Partial<Record<Exclude<NativeDependency, 'postgres'>, () => Promise<boolean> | boolean>>
}

export interface EnvReader {
  get(name: string): string | undefined
}

export class ProcessEnvReader implements EnvReader {
  get(name: string): string | undefined {
    return process.env[name]
  }
}

const DEFAULT_NATIVE_MODES: NativeDependencyModes = {
  mongodb: 'disabled',
  redis: 'disabled',
  pythonWorker: 'disabled',
  mobileSupport: 'fake',
  externalProviders: 'disabled',
}

const DEFAULT_COMPOSE_MODES: NativeDependencyModes = {
  mongodb: 'required',
  redis: 'required',
  pythonWorker: 'required',
  mobileSupport: 'required',
  externalProviders: 'fake',
}

export function loadNativeDependencyModes(
  reader: EnvReader = new ProcessEnvReader(),
  defaults: NativeDependencyModes = DEFAULT_NATIVE_MODES
): NativeDependencyModes {
  const mode = (name: string, fallback: DependencyMode): DependencyMode => {
    const value = reader.get(name)
    if (value === undefined) return fallback
    if (!['required', 'optional', 'disabled', 'fake'].includes(value)) {
      throw new Error(`Invalid native dependency mode for ${name}`)
    }
    return value as DependencyMode
  }

  return {
    mongodb: mode('NATIVE_MONGODB_MODE', defaults.mongodb),
    redis: mode('NATIVE_REDIS_MODE', defaults.redis),
    pythonWorker: mode('NATIVE_PYTHON_WORKER_MODE', defaults.pythonWorker),
    mobileSupport: mode('NATIVE_MOBILE_SUPPORT_MODE', defaults.mobileSupport),
    externalProviders: mode('NATIVE_EXTERNAL_PROVIDERS_MODE', defaults.externalProviders),
  }
}

async function checkDependency(
  mode: DependencyMode,
  check?: () => Promise<boolean> | boolean
): Promise<DependencyStatus> {
  if (mode === 'disabled' || mode === 'fake') return 'ready'
  if (!check) return 'unavailable'

  try {
    return (await check()) ? 'ready' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

function report(mode: DependencyMode, status: DependencyStatus): DependencyReport {
  return { mode, status, blocksApiReadiness: mode === 'required' && status === 'unavailable' }
}

export async function buildNativeReadiness(
  options: NativeReadinessOptions = {}
): Promise<NativeReadiness> {
  const profile = options.profile ?? 'native'
  const defaults = profile === 'native' ? DEFAULT_NATIVE_MODES : DEFAULT_COMPOSE_MODES
  const modes = { ...loadNativeDependencyModes(new ProcessEnvReader(), defaults), ...options.modes }
  const postgresStatus = await checkDependency('required', options.postgresCheck)
  const dependencyReports = await Promise.all(
    (Object.keys(modes) as Array<keyof NativeDependencyModes>).map(
      async (key) =>
        [key, report(modes[key], await checkDependency(modes[key], options.checks?.[key]))] as const
    )
  )

  return {
    profile,
    postgres: report('required', postgresStatus),
    ...Object.fromEntries(dependencyReports),
  } as NativeReadiness
}

export function loadRuntimeConfig(reader: EnvReader = new ProcessEnvReader()): RuntimeConfig {
  const environment = readEnum(
    reader,
    'NODE_ENV',
    ['development', 'test', 'staging', 'production'],
    'development'
  )
  const profile = readEnum(reader, 'FACTORY_PROFILE', ['local', 'render', 'aws'], 'local')
  const secretStoreRef = reader.get('SECRET_STORE_REF')

  if (environment === 'production' && !secretStoreRef) {
    throw new Error('Missing required secret-store reference: SECRET_STORE_REF')
  }

  return {
    contractVersion: CONFIG_CONTRACT_VERSION,
    role: readEnum(reader, 'RUNTIME_ROLE', ['api-edge', 'workflow-runtime', 'worker'], 'api-edge'),
    environment,
    profile,
    serviceName: readRequired(reader, 'SERVICE_NAME', 'golden-runtime'),
    serviceVersion: readRequired(reader, 'SERVICE_VERSION', '0.1.0'),
    telemetry: {
      otlpEndpoint: reader.get('OTEL_EXPORTER_OTLP_ENDPOINT'),
      logLevel: readEnum(
        reader,
        'LOG_LEVEL',
        ['debug', 'info', 'warn', 'error'],
        environment === 'production' ? 'info' : 'debug'
      ),
      sampleRatio: readNumber(reader, 'OTEL_SAMPLE_RATIO', 1, { min: 0, max: 1 }),
    },
    storage: {
      assetBucket: reader.get('ASSET_BUCKET'),
      publicBaseUrl: reader.get('PUBLIC_BASE_URL'),
    },
    runtime: {
      shutdownTimeoutMs: readNumber(reader, 'SHUTDOWN_TIMEOUT_MS', 10_000, { min: 1 }),
      maxConcurrency: readNumber(reader, 'MAX_CONCURRENCY', 8, { min: 1 }),
    },
    providers: {
      llm: readRequired(reader, 'LLM_PROVIDER', 'fake'),
      objectStorage: readRequired(reader, 'OBJECT_STORAGE_PROVIDER', 'fake'),
      queue: readRequired(reader, 'QUEUE_PROVIDER', 'local'),
    },
    databases: {
      postgres: readRequired(reader, 'POSTGRES_PROVIDER', 'local'),
      mongo: readRequired(reader, 'MONGO_PROVIDER', 'local'),
      redis: readRequired(reader, 'REDIS_PROVIDER', 'local'),
    },
    security: { secretStoreRef },
  }
}

export function loadRuntimePorts(reader: EnvReader = new ProcessEnvReader()): RuntimePorts {
  return {
    http: optionalNumber(reader.get('PORT')),
    metrics: optionalNumber(reader.get('METRICS_PORT')),
  }
}

function readRequired(reader: EnvReader, name: string, fallback?: string): string {
  const value = reader.get(name) ?? fallback

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function readEnum<const T extends readonly string[]>(
  reader: EnvReader,
  name: string,
  allowed: T,
  fallback: T[number]
): T[number] {
  const value = reader.get(name) ?? fallback

  if (!allowed.includes(value)) {
    throw new Error(
      `Invalid value for ${name}. Expected one of: ${allowed.join(', ')}. Received: ${value}`
    )
  }

  return value
}

function readNumber(
  reader: EnvReader,
  name: string,
  fallback: number,
  range: { min?: number; max?: number } = {}
): number {
  const raw = reader.get(name)
  const value = raw ? Number(raw) : fallback

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${name}: ${raw}`)
  }

  if (range.min !== undefined && value < range.min) {
    throw new Error(`${name} must be >= ${range.min}`)
  }

  if (range.max !== undefined && value > range.max) {
    throw new Error(`${name} must be <= ${range.max}`)
  }

  return value
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined
  }

  const value = Number(raw)

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value: ${raw}`)
  }

  return value
}
