const SERVICE_NAMES = ['postgresql', 'mongodb', 'redis', 'object-storage', 'queues']
const SECRET_KEY_PATTERN = /(authorization|cookie|password|secret|token|credential|private.?key)/i
const BEARER_PATTERN = /Bearer\s+\S+/gi

const BOUNDARY_DEFINITIONS = {
  postgresql: {
    owner: 'Data Platform',
    refs: { render: 'render.secret-store.database-url', aws: 'aws.secrets-manager.database-url' },
    rollback: 'last-passing-schema-and-verified-backup',
    gate: 'endpoint + secret reference + backup + quota + authorized smoke',
    fakeMode: 'disabled',
  },
  mongodb: {
    owner: 'Document Data',
    refs: { render: 'render.secret-store.mongodb-uri', aws: 'aws.secrets-manager.mongodb-uri' },
    rollback: 'restore-or-rebuild-projections-with-reconciliation',
    gate: 'owner + network + retention + backup + authorized smoke',
    fakeMode: 'fake',
  },
  redis: {
    owner: 'Runtime Jobs',
    refs: { render: 'render.secret-store.redis-url', aws: 'aws.secrets-manager.redis-url' },
    rollback: 'disable-consumers-and-replay-postgresql-ledger',
    gate: 'retry + quota + secret reference + authorized smoke',
    fakeMode: 'fake',
  },
  'object-storage': {
    owner: 'Assets',
    refs: { render: 'render.secret-store.object-storage-ref', aws: 'aws.terraform.s3-output-ref' },
    rollback: 'revert-adapter-and-reconcile-versioned-objects',
    gate: 'policy + encryption + lifecycle + authorized smoke',
    fakeMode: 'fake',
  },
  queues: {
    owner: 'Runtime Jobs',
    refs: { render: 'render.managed-queue-ref', aws: 'aws.terraform.sqs-dlq-output-ref' },
    rollback: 'stop-intake-and-replay-ledger-outbox-dlq',
    gate: 'queue policy + retry + secret reference + quota + authorized smoke',
    fakeMode: 'fake',
  },
}

function makeBoundaries(provider) {
  const profileKey = provider === 'Render' ? 'render' : 'aws'
  return Object.fromEntries(
    Object.entries(BOUNDARY_DEFINITIONS).map(([name, definition]) => [
      name,
      {
        name,
        owner: definition.owner,
        configRef: definition.refs[profileKey],
        rollbackRef: definition.rollback,
        mode: 'managed',
        fakeMode: definition.fakeMode,
        activationGate: definition.gate,
      },
    ]),
  )
}

export const DELIVERY_PROFILES = Object.freeze({
  'render-native': {
    id: 'render-native',
    provider: 'Render',
    deployment: 'native-services-and-workers',
    infrastructureAuthority: 'render-native-service-model',
    boundaries: makeBoundaries('Render'),
  },
  'aws-terraform': {
    id: 'aws-terraform',
    provider: 'AWS',
    deployment: 'terraform-managed-services',
    infrastructureAuthority: 'terraform',
    boundaries: makeBoundaries('AWS'),
  },
})

export function resolveDeliveryProfile(profileId) {
  if (!profileId) throw new Error('An explicit profile is required: render-native or aws-terraform')
  const profile = DELIVERY_PROFILES[profileId]
  if (!profile) throw new Error(`Unsupported delivery profile: ${profileId}; Compose fallback is not allowed`)
  return profile
}

export function evaluateActivationGate(boundaryContract, options = {}) {
  const ready = ['credentials', 'resources', 'authorizedSmoke'].every((key) => options[key] === true)
  if (ready) {
    return {
      status: 'pass',
      evidenceKind: 'authorized-cloud-smoke',
      effectiveMode: 'managed',
      liveConformance: true,
      reason: 'Authorized resources and smoke evidence satisfy the boundary gate',
    }
  }

  const missing = ['credentials', 'resources', 'authorized smoke'].filter(
    (key) => options[key.replace(' ', '')] !== true,
  )
  return {
    status: 'unavailable',
    evidenceKind: 'unavailable-deferred',
    effectiveMode: boundaryContract.fakeMode,
    liveConformance: false,
    reason: `Live activation deferred until ${missing.join(', ')} exist`,
  }
}

export function buildEvidenceRecord({ profile, boundary, planValidated, credentials, resources, authorizedSmoke }) {
  const profileContract = resolveDeliveryProfile(profile)
  const boundaryContract = profileContract.boundaries[boundary]
  if (!boundaryContract) throw new Error(`Unknown managed boundary: ${boundary}`)
  if (!planValidated) {
    return {
      profile,
      boundaries: [boundary],
      kind: 'unavailable-deferred',
      status: 'unavailable',
      liveConformance: false,
      reason: 'Plan or validation evidence is missing',
    }
  }

  const gate = evaluateActivationGate(boundaryContract, { credentials, resources, authorizedSmoke })
  if (gate.liveConformance) return { profile, boundaries: [boundary], kind: gate.evidenceKind, ...gate }
  return {
    profile,
    boundaries: [boundary],
    kind: 'cloud-plan-validation',
    status: 'pass',
    liveConformance: false,
    reason: 'Plan/validation proves declared shape only; live conformance is not claimed',
  }
}

export function redactDiagnostics(value) {
  if (Array.isArray(value)) return value.map(redactDiagnostics)
  if (typeof value === 'string') return value.replace(BEARER_PATTERN, 'Bearer [REDACTED]')
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactDiagnostics(nested),
    ]),
  )
}

export function validatePlanFixture(fixture) {
  const errors = []
  let profile
  try {
    profile = resolveDeliveryProfile(fixture.profile)
  } catch (error) {
    errors.push(error.message)
  }

  const declared = fixture.declaredBoundaries ?? []
  const missingBoundaries = SERVICE_NAMES.filter((name) => !declared.includes(name))
  if (missingBoundaries.length) errors.push(`Missing managed boundaries: ${missingBoundaries.join(', ')}`)
  if (fixture.provisioned !== false) errors.push('Plan fixture must not provision resources')
  if (fixture.cloudCalls !== false) errors.push('Plan fixture must not call cloud providers')
  if (fixture.liveConformance !== false) errors.push('Plan fixture must not claim live conformance')
  if (profile && fixture.infrastructureAuthority !== profile.infrastructureAuthority) {
    errors.push('Plan fixture infrastructure authority does not match the selected profile')
  }

  return {
    valid: errors.length === 0,
    profile: fixture.profile,
    provisioned: fixture.provisioned === true,
    cloudCalls: fixture.cloudCalls === true,
    liveConformance: fixture.liveConformance === true,
    missingBoundaries,
    errors: redactDiagnostics(errors),
  }
}
