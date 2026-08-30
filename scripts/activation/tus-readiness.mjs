import { pathToFileURL } from 'node:url'

export const TUS_DEPLOYMENT_PROFILES = Object.freeze(['render-native', 'aws-terraform'])

export const TUS_EVIDENCE_CLASSES = Object.freeze([
  'local-deterministic',
  'local-postgresql-http',
  'authorized-external',
  'deferred',
])

export const TUS_DEPLOYMENT_FLAGS = Object.freeze([
  'api',
  'web',
  'workers',
  'tusRoutes',
  'providers',
  'releaseJobs',
  'fleetJobs',
])

export const DEFAULT_TUS_DEPLOYMENT = Object.freeze({
  api: true,
  web: true,
  workers: true,
  tusRoutes: false,
  providers: false,
  releaseJobs: false,
  fleetJobs: false,
})

export const ACTIVATION_GATE_KEYS = Object.freeze([
  'mercadoPago',
  'whatsapp',
  'aws',
  'render',
  'cloud',
  'legal',
  'tax',
  'kyc',
  'kyb',
  'postgresql',
  'browser',
  'device',
  'posPilot',
  'productionOperations',
])

export const DEFAULT_TUS_ACTIVATION_REQUEST = Object.freeze({
  ...DEFAULT_TUS_DEPLOYMENT,
  mercadoPago: false,
  whatsapp: false,
  aws: false,
  render: false,
  cloud: false,
  legal: false,
  tax: false,
  kyc: false,
  kyb: false,
  postgresql: false,
  browser: false,
  device: false,
  posPilot: false,
  productionOperations: false,
})

const ACTIVATION_COMPOSITION_REQUIREMENTS = Object.freeze({
  tusRoutes: ['legal', 'kyb', 'tax', 'postgresql', 'browser', 'productionOperations'],
  providers: [
    'legal',
    'tax',
    'kyc',
    'kyb',
    'postgresql',
    'mercadoPago',
    'whatsapp',
    'aws',
    'cloud',
    'render',
    'productionOperations',
  ],
  releaseJobs: ['legal', 'tax', 'kyc', 'kyb', 'postgresql', 'mercadoPago', 'posPilot', 'productionOperations'],
  fleetJobs: ['legal', 'tax', 'kyc', 'kyb', 'postgresql', 'device', 'posPilot', 'productionOperations'],
})

export const TUS_EXCLUDED_SCOPES = Object.freeze([
  'global-launch',
  'rentals',
  'regulated-healthcare',
  'financing-credit',
  'custody-escrow',
  'open-driver-bidding',
  'mature-dispatch',
  'warehouse-automation',
  'unbounded-ai-authority',
])

const REQUIRED_GATES = Object.freeze({
  tusRoutes: ['legal', 'kyb', 'tax', 'runtimeProvider'],
  providers: ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'aws', 'groqMigration', 'runtimeProvider'],
  releaseJobs: ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'posPilot', 'runtimeProvider'],
  fleetJobs: ['legal', 'kyc', 'kyb', 'tax', 'posPilot', 'runtimeProvider'],
})

const PRODUCTION_READINESS_GATES = Object.freeze([
  'postgresql',
  'cloud',
  'browser',
  'device',
  'legal',
  'tax',
  'kyc',
  'kyb',
  'posPilot',
  'productionOperations',
])

function isAuthorizedEvidence(value, profile, now) {
  return value !== null && typeof value === 'object'
    && value.approved === true
    && value.source === 'authorized-cloud-smoke'
    && value.profile === profile
    && typeof value.scope === 'string'
    && value.scope.trim().length > 0
    && value.revoked !== true
    && (value.expiresAt === null || (typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) > now))
}

function evidenceFailure(value, profile, now) {
  if (value && typeof value === 'object' && value.profile !== profile) return 'out-of-scope'
  if (value && typeof value === 'object' && value.revoked === true) return 'revoked'
  if (value && typeof value === 'object' && typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) <= now) return 'expired'
  if (value && typeof value === 'object' && value.approved === true) {
    return value.source === 'deterministic-test-only' ? 'deterministic-test-only' : 'unauthorized'
  }
  return 'missing'
}

export function evaluateTusDeploymentReadiness(input = {}) {
  const profile = input.profile ?? 'render-native'
  if (!TUS_DEPLOYMENT_PROFILES.includes(profile)) {
    throw new TypeError(`unsupported TUS deployment profile: ${profile}`)
  }

  const requested = { ...DEFAULT_TUS_DEPLOYMENT, ...(input.requested ?? {}) }
  const enabled = Object.fromEntries(
    TUS_DEPLOYMENT_FLAGS.map((flag) => [flag, requested[flag] === true])
  )
  const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : {}
  const now = Date.parse(input.now ?? new Date().toISOString())
  const blockers = []
  const deferredCapabilities = []
  let authorizedCapabilityCount = 0

  for (const [capability, gates] of Object.entries(REQUIRED_GATES)) {
    if (requested[capability] !== true) {
      enabled[capability] = false
      deferredCapabilities.push(capability)
      continue
    }

    let capabilityAuthorized = true
    for (const gate of gates) {
      const record = evidence[gate]
      if (!isAuthorizedEvidence(record, profile, now)) {
        capabilityAuthorized = false
        const failure = evidenceFailure(record, profile, now)
        blockers.push(`${capability}:${failure === 'missing' ? gate : failure}`)
      }
    }

    if (!capabilityAuthorized) {
      enabled[capability] = false
      if (!deferredCapabilities.includes(capability)) deferredCapabilities.push(capability)
    } else {
      authorizedCapabilityCount += 1
    }
  }

  const liveConformance = blockers.length === 0 && authorizedCapabilityCount > 0
  return {
    profile,
    requested,
    enabled,
    status: liveConformance ? 'production-ready' : 'not-production-ready',
    disposition: liveConformance ? 'authorized-live' : 'unavailable-deferred',
    liveConformance,
    blockers,
    deferredCapabilities,
    deterministicVerificationMayContinue: true,
    reason: liveConformance
      ? 'authorized evidence is scoped to the selected profile and requested capabilities'
      : 'required TUS evidence is missing, unauthorized, or deterministic-only; gated actions remain disabled',
  }
}

function asEvidenceRecords(value) {
  if (Array.isArray(value)) return value
  return value === undefined ? [] : [value]
}

function isEvidenceShape(value, profile, now) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.approved !== true || (value.approvalStatus !== undefined && value.approvalStatus !== 'approved')) return false
  if (value.profile !== profile || typeof value.scope !== 'string' || value.scope.trim().length === 0) return false
  for (const field of ['evidenceId', 'owner', 'evidenceType', 'evidenceRef', 'policyVersion']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) return false
  }
  if (typeof value.issuedAt !== 'string' || !Number.isFinite(Date.parse(value.issuedAt)) || Date.parse(value.issuedAt) > now) return false
  if (value.expiresAt !== null && (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)))) return false
  return value.revoked === false && value.source === 'authorized-external'
    && (value.expiresAt === null || Date.parse(value.expiresAt) > now)
}

function evidenceRecordFailure(value, profile, now) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'missing'
  if (value.profile !== profile) return 'out-of-scope'
  if (value.revoked === true) return 'revoked'
  if (typeof value.issuedAt === 'string' && Number.isFinite(Date.parse(value.issuedAt)) && Date.parse(value.issuedAt) > now) return 'not-yet-valid'
  if (typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt)) && Date.parse(value.expiresAt) <= now) return 'expired'
  if (value.source === 'local-deterministic' || value.source === 'deterministic-test-only') return 'deterministic-test-only'
  if (value.source === 'local-postgresql-http') return 'local-postgresql-http'
  if (value.source === 'deferred') return 'deferred'
  if (value.source !== 'authorized-external' || value.approved !== true || (value.approvalStatus !== undefined && value.approvalStatus !== 'approved')) return 'unauthorized'
  if (!isEvidenceShape(value, profile, now)) return 'malformed'
  return null
}

function gateEvidence(value, profile, now) {
  const records = asEvidenceRecords(value)
  if (records.length === 0) return { reason: 'missing' }

  const failures = records.map((record) => evidenceRecordFailure(record, profile, now))
  const current = records.filter((record, index) => failures[index] === null)
  if (current.length > 1) return { reason: 'conflict' }
  if (failures.includes('revoked')) return { reason: 'revoked' }
  if (current.length === 1) {
    const record = current[0]
    return {
      reason: null,
      evidenceId: record.evidenceId,
      owner: record.owner,
      expiresAt: record.expiresAt,
    }
  }

  const priority = ['out-of-scope', 'expired', 'not-yet-valid', 'deterministic-test-only', 'local-postgresql-http', 'deferred', 'malformed', 'unauthorized', 'missing']
  return { reason: priority.find((reason) => failures.includes(reason)) ?? 'missing' }
}

function evidenceValues(evidence) {
  return Object.values(evidence).flatMap((value) => asEvidenceRecords(value))
}

function classifyEvidence(evidence, blockers, liveConformance) {
  const sources = new Set(
    evidenceValues(evidence)
      .filter((value) => value !== null && typeof value === 'object')
      .map((value) => value.source),
  )
  const classes = []
  if (sources.has('local-deterministic') || sources.has('deterministic-test-only')) {
    classes.push('local-deterministic')
  }
  if (sources.has('local-postgresql-http')) classes.push('local-postgresql-http')
  if (sources.has('authorized-external')) classes.push('authorized-external')
  if (blockers.length > 0 || classes.length === 0) classes.push('deferred')

  const evidenceClass = liveConformance
    ? 'authorized-external'
    : classes.includes('local-deterministic')
      ? 'local-deterministic'
      : classes.includes('local-postgresql-http')
        ? 'local-postgresql-http'
        : 'deferred'
  return { evidenceClass, evidenceClasses: [...new Set(classes)] }
}

function createGateResults({ requested, evidence, profile, now }) {
  return Object.fromEntries(
    ACTIVATION_GATE_KEYS.map((gate) => {
      if (requested[gate] !== true) return [gate, { status: 'disabled', reason: 'not-requested' }]
      const result = gateEvidence(evidence[gate], profile, now)
      return [
        gate,
        result.reason === null
          ? { status: 'enabled', reason: 'authorized-evidence', evidenceId: result.evidenceId, owner: result.owner, expiresAt: result.expiresAt }
          : { status: 'disabled', reason: result.reason },
      ]
    }),
  )
}

function buildComposition(requested, gates) {
  const enabled = Object.fromEntries(
    TUS_DEPLOYMENT_FLAGS.map((flag) => [flag, requested[flag] === true]),
  )
  const blockers = []
  for (const [capability, requirements] of Object.entries(ACTIVATION_COMPOSITION_REQUIREMENTS)) {
    if (requested[capability] !== true) {
      enabled[capability] = false
      continue
    }
    const missing = requirements.filter((gate) => gates[gate]?.status !== 'enabled')
    if (missing.length > 0) {
      enabled[capability] = false
      blockers.push(...missing.map((gate) => `${capability}:${gates[gate]?.reason === 'not-requested' ? 'missing' : gates[gate]?.reason}`))
    }
  }
  return { enabled, blockers }
}

export function evaluateTusActivation(input = {}) {
  const profile = input.profile ?? 'render-native'
  if (!TUS_DEPLOYMENT_PROFILES.includes(profile)) throw new TypeError(`unsupported TUS deployment profile: ${profile}`)
  const requested = { ...DEFAULT_TUS_ACTIVATION_REQUEST, ...(input.requested ?? {}) }
  const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : {}
  const nowValue = Date.parse(input.now ?? new Date().toISOString())
  const now = Number.isFinite(nowValue) ? nowValue : Number.NaN
  const gates = createGateResults({ requested, evidence, profile, now })
  const directBlockers = ACTIVATION_GATE_KEYS
    .filter((gate) => requested[gate] === true && gates[gate].status !== 'enabled')
    .map((gate) => `${gate}:${gates[gate].reason}`)
  const composition = buildComposition(requested, gates)
  const enabledCapabilities = ACTIVATION_GATE_KEYS.filter((gate) => gates[gate].status === 'enabled')
  const productionReadinessBlockers = PRODUCTION_READINESS_GATES
    .map((gate) => ({ gate, result: gateEvidence(evidence[gate], profile, now) }))
    .filter(({ result }) => result.reason !== null)
    .map(({ gate, result }) => `${gate}:${result.reason}`)
  const blockers = [...new Set([
    ...directBlockers,
    ...composition.blockers,
    ...productionReadinessBlockers,
  ])]
  const liveConformance = blockers.length === 0
    && productionReadinessBlockers.length === 0
    && enabledCapabilities.length > 0
  const evidenceClassification = classifyEvidence(evidence, [...blockers, ...productionReadinessBlockers], liveConformance)
  return {
    schema: 'tus.activation-evaluation.v1',
    profile,
    requested,
    gates,
    deployment: {
      enabled: composition.enabled,
      planOnly: true,
      provisioned: false,
      cloudCalls: false,
    },
    blockers,
    productionReadinessBlockers,
    excludedScopes: [...TUS_EXCLUDED_SCOPES],
    status: liveConformance ? 'production-ready' : 'not-production-ready',
    disposition: liveConformance ? 'authorized-live' : 'unavailable-deferred',
    liveConformance,
    planOnly: true,
    provisioned: false,
    cloudCalls: false,
    evidenceClass: evidenceClassification.evidenceClass,
    evidenceClasses: evidenceClassification.evidenceClasses,
    claims: {
      liveAuthorization: liveConformance,
      enabledCapabilities: liveConformance ? enabledCapabilities : [],
      statement: liveConformance
        ? 'Live authorization is limited to the requested capabilities and selected profile.'
        : 'No production readiness is claimed; missing or invalid evidence keeps gated actions disabled.',
    },
  }
}

export function createDisablementPlan({ capability, reason, now, inFlight = 0 }) {
  if (typeof capability !== 'string' || capability.trim().length === 0) throw new TypeError('disablement capability is required')
  if (typeof reason !== 'string' || reason.trim().length === 0) throw new TypeError('disablement reason is required')
  if (!Number.isInteger(inFlight) || inFlight < 0) throw new TypeError('disablement inFlight must be a non-negative integer')
  const disabledAt = now ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(disabledAt))) throw new TypeError('disablement requires a valid ISO timestamp')
  return {
    capability,
    status: 'disabled',
    reason,
    disabledAt,
    stopIntake: true,
    drain: true,
    quarantine: true,
    inFlight,
    preserved: { audit: true, evidence: true, ledger: true, outbox: true, dlq: true },
    financialRollback: 'append-only-compensation',
    replay: 'requires-new-authorized-evidence',
    destructiveRollback: false,
  }
}

export const buildDisablementPlan = createDisablementPlan

export function createActivationReport(input = {}) {
  const evaluation = evaluateTusActivation(input)
  const unavailableGates = ACTIVATION_GATE_KEYS.filter((gate) => evaluation.gates[gate].status !== 'enabled')
  return {
    schema: 'tus.activation-report.v1',
    generatedAt: input.now ?? new Date().toISOString(),
    profile: evaluation.profile,
    status: evaluation.status,
    disposition: evaluation.disposition,
    evidenceClass: evaluation.evidenceClass,
    evidenceClasses: evaluation.evidenceClasses,
    liveConformance: evaluation.liveConformance,
    blockers: evaluation.blockers,
    productionReadinessBlockers: evaluation.productionReadinessBlockers,
    gates: evaluation.gates,
    composition: evaluation.deployment,
    readiness: {
      decision: evaluation.status,
      evidenceBoundary: evaluation.evidenceClass,
      externalEvidenceRequired: true,
      unavailableGates,
    },
    excludedScopes: evaluation.excludedScopes,
    claims: evaluation.claims,
    deterministicVerificationMayContinue: true,
    rollback: createDisablementPlan({
      capability: 'all-gated-capabilities',
      reason: 'revoke or disable the activation evidence before rollback',
      now: evaluation.generatedAt,
    }),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profile = process.argv[2] ?? 'render-native'
  process.stdout.write(`${JSON.stringify(createActivationReport({ profile }), null, 2)}\n`)
}
