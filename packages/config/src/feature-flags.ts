export const DELIVERY_PROFILE = {
  NATIVE: 'native',
  RENDER_NATIVE: 'render-native',
  AWS_TERRAFORM: 'aws-terraform',
} as const

export type DeliveryProfile = (typeof DELIVERY_PROFILE)[keyof typeof DELIVERY_PROFILE]

export const CONFIGURATION_SCOPE = {
  PROFILE: 'profile',
  TENANT: 'tenant',
  PRODUCT: 'product',
} as const

export type ConfigurationScope = (typeof CONFIGURATION_SCOPE)[keyof typeof CONFIGURATION_SCOPE]

export type ConfigurationValue = string | number | boolean

export interface ConfigurationRevision {
  scope: ConfigurationScope
  profile: DeliveryProfile
  tenantId?: string
  productId?: string
  version: number
  requiredKeys: string[]
  values: Record<string, ConfigurationValue>
  flags: Record<string, boolean>
}

export interface ConfigurationContext {
  profile: DeliveryProfile
  tenantId?: string
  productId?: string
}

export interface ResolvedConfiguration {
  profile: DeliveryProfile
  values: Record<string, ConfigurationValue>
  flags: Record<string, boolean>
  versions: {
    profile: number
    tenant?: number
    product?: number
  }
}

export const CONFIGURATION_ERROR_CODE = {
  INVALID: 'CONFIGURATION_INVALID',
  MISSING: 'CONFIGURATION_MISSING',
  CONFLICT: 'CONFIGURATION_CONFLICT',
  NOT_FOUND: 'CONFIGURATION_NOT_FOUND',
} as const

export type ConfigurationErrorCode =
  (typeof CONFIGURATION_ERROR_CODE)[keyof typeof CONFIGURATION_ERROR_CODE]

export class ConfigurationValidationError extends Error {
  readonly code: ConfigurationErrorCode
  readonly field: string

  constructor(code: ConfigurationErrorCode, field: string, message: string) {
    super(message)
    this.name = 'ConfigurationValidationError'
    this.code = code
    this.field = field
  }
}

const PROFILE_VALUES = new Set<DeliveryProfile>(Object.values(DELIVERY_PROFILE))
const SCOPE_VALUES = new Set<ConfigurationScope>(Object.values(CONFIGURATION_SCOPE))
const CONFIGURATION_KEY = /^[a-z][a-z0-9_.-]*$/

export function validateConfigurationRevision(
  revision: ConfigurationRevision
): ConfigurationRevision {
  if (!PROFILE_VALUES.has(revision.profile)) {
    throw invalid('profile', 'profile is unsupported')
  }

  if (!SCOPE_VALUES.has(revision.scope)) {
    throw invalid('scope', 'scope is unsupported')
  }

  if (!Number.isInteger(revision.version) || revision.version < 1) {
    throw invalid('version', 'version must be a positive integer')
  }

  if (
    !Array.isArray(revision.requiredKeys) ||
    new Set(revision.requiredKeys).size !== revision.requiredKeys.length
  ) {
    throw invalid('requiredKeys', 'required keys must be unique')
  }

  for (const key of revision.requiredKeys) {
    validateKey(key, 'requiredKeys')
  }

  validateScopeIdentity(revision)
  validateMap(revision.values, 'values', isConfigurationValue)
  validateMap(revision.flags, 'flags', (value) => typeof value === 'boolean')

  if (revision.scope === CONFIGURATION_SCOPE.PROFILE) {
    for (const key of revision.requiredKeys) {
      if (!(key in revision.values)) {
        throw missing(key)
      }
    }
  }

  return cloneRevision(revision)
}

export function configurationScopeKey(input: {
  scope?: ConfigurationScope
  profile: DeliveryProfile
  tenantId?: string
  productId?: string
}): string {
  const scope = input.scope ?? CONFIGURATION_SCOPE.PROFILE
  return [scope, input.profile, input.tenantId ?? '-', input.productId ?? '-'].join(':')
}

export function resolveConfigurationLayers(
  layers: ConfigurationRevision[],
  context: ConfigurationContext
): ResolvedConfiguration {
  if (!PROFILE_VALUES.has(context.profile)) {
    throw invalid('profile', 'profile is unsupported')
  }

  const matching = layers
    .filter((layer) => matchesContext(layer, context))
    .map(validateConfigurationRevision)

  const profile = selectLayer(matching, CONFIGURATION_SCOPE.PROFILE, 'profile')
  if (!profile) {
    throw missing(`profile:${context.profile}`)
  }

  const tenant = selectLayer(matching, CONFIGURATION_SCOPE.TENANT, 'tenant')
  const product = selectLayer(matching, CONFIGURATION_SCOPE.PRODUCT, 'product')
  const ordered = [profile, tenant, product].filter(
    (layer): layer is ConfigurationRevision => layer !== undefined
  )
  const values = mergeValues(ordered.map((layer) => layer.values))
  const flags = mergeFlags(ordered.map((layer) => layer.flags))

  for (const key of profile.requiredKeys) {
    if (!(key in values)) {
      throw missing(key)
    }
  }

  return {
    profile: context.profile,
    values,
    flags,
    versions: {
      profile: profile.version,
      ...(tenant ? { tenant: tenant.version } : {}),
      ...(product ? { product: product.version } : {}),
    },
  }
}

export function cloneRevision(revision: ConfigurationRevision): ConfigurationRevision {
  return {
    ...revision,
    requiredKeys: [...revision.requiredKeys].sort(),
    values: sortRecord(revision.values),
    flags: sortRecord(revision.flags),
  }
}

function matchesContext(layer: ConfigurationRevision, context: ConfigurationContext): boolean {
  if (layer.profile !== context.profile) return false
  if (layer.scope === CONFIGURATION_SCOPE.PROFILE) return true
  if (layer.scope === CONFIGURATION_SCOPE.TENANT) return layer.tenantId === context.tenantId
  return layer.tenantId === context.tenantId && layer.productId === context.productId
}

function selectLayer(
  layers: ConfigurationRevision[],
  scope: ConfigurationScope,
  field: string
): ConfigurationRevision | undefined {
  const candidates = layers.filter((layer) => layer.scope === scope)
  if (candidates.length === 0) return undefined

  const versions = new Set(candidates.map((candidate) => candidate.version))
  if (versions.size !== candidates.length) {
    throw new ConfigurationValidationError(
      CONFIGURATION_ERROR_CODE.CONFLICT,
      field,
      `Multiple active ${field} configuration revisions are not allowed`
    )
  }

  return [...candidates].sort((left, right) => right.version - left.version)[0]
}

function validateScopeIdentity(revision: ConfigurationRevision): void {
  const tenant = revision.tenantId?.trim()
  const product = revision.productId?.trim()

  if (revision.scope === CONFIGURATION_SCOPE.PROFILE && (tenant || product)) {
    throw invalid('scope', 'profile configuration cannot target a tenant or product')
  }
  if (revision.scope === CONFIGURATION_SCOPE.TENANT && (!tenant || product)) {
    throw invalid('tenantId', 'tenant configuration requires only tenantId')
  }
  if (revision.scope === CONFIGURATION_SCOPE.PRODUCT && (!tenant || !product)) {
    throw invalid('productId', 'product configuration requires tenantId and productId')
  }
}

function validateMap(
  values: Record<string, unknown>,
  field: string,
  predicate: (value: unknown) => boolean
): void {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    throw invalid(field, `${field} must be an object`)
  }

  for (const [key, value] of Object.entries(values)) {
    validateKey(key, field)
    if (!predicate(value)) throw invalid(`${field}.${key}`, 'value has an unsupported type')
  }
}

function validateKey(key: string, field: string): void {
  if (typeof key !== 'string' || !CONFIGURATION_KEY.test(key)) {
    throw invalid(field, 'keys must use lowercase dot-separated names')
  }
}

function isConfigurationValue(value: unknown): value is ConfigurationValue {
  return (
    (typeof value === 'string' && value.length > 0) ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  )
}

function mergeValues(
  layers: Array<Record<string, ConfigurationValue>>
): Record<string, ConfigurationValue> {
  return sortRecord(Object.assign({}, ...layers))
}

function mergeFlags(layers: Array<Record<string, boolean>>): Record<string, boolean> {
  return sortRecord(Object.assign({}, ...layers))
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  )
}

function invalid(field: string, reason: string): ConfigurationValidationError {
  return new ConfigurationValidationError(
    CONFIGURATION_ERROR_CODE.INVALID,
    field,
    `Invalid configuration ${field}: ${reason}`
  )
}

function missing(field: string): ConfigurationValidationError {
  return new ConfigurationValidationError(
    CONFIGURATION_ERROR_CODE.MISSING,
    field,
    `Missing required configuration: ${field}`
  )
}
