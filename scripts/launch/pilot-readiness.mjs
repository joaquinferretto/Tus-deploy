export const CAPABILITY_KEYS = Object.freeze([
  'database',
  'schema',
  'tenancy',
  'pos',
  'payments',
  'whatsapp',
  'delivery',
  'billing',
  'web',
  'mobile',
  'deployment',
])

export const EVIDENCE_CLASSES = Object.freeze([
  'deterministic',
  'real-postgresql',
  'provider',
  'browser/mobile',
  'deployment',
  'legal/tax',
  'external-blocked',
])

export const PILOT_FLAG_KEYS = Object.freeze([
  'providers',
  'payments',
  'worker',
  'delivery',
  'broadLaunch',
])

export const DEFAULT_PILOT_FLAGS = Object.freeze({
  providers: false,
  payments: false,
  worker: false,
  delivery: false,
  broadLaunch: false,
})

const DEFAULT_PROFILE = 'render-native'
const DEFAULT_SCOPE = 'argentina-stage-1'
const STAGES = Object.freeze(['none', 'canary', 'pilot', 'broad'])

function recordsForCapability(evidence, capability) {
  return (Array.isArray(evidence) ? evidence : [])
    .filter((record) => record !== null && typeof record === 'object' && record.capability === capability)
}

function hasValidTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function failureForRecord(record, { now, profile, scope }) {
  if (record.replayed === true) return 'replay'
  if (record.revoked === true) return 'revoked'
  if (record.profile !== profile || record.scope !== scope) return 'out-of-scope'
  if (hasValidTimestamp(record.expiresAt) && Date.parse(record.expiresAt) <= now) return 'expired'
  if (hasValidTimestamp(record.issuedAt) && Date.parse(record.issuedAt) > now) return 'not-yet-valid'
  if (record.direct !== true || record.source !== 'authorized-external' || record.approved !== true) {
    return record.evidenceClass === 'deterministic' ? 'deterministic-only' : 'direct-evidence-required'
  }
  if (!hasValidTimestamp(record.issuedAt) || (record.expiresAt !== null && !hasValidTimestamp(record.expiresAt))) return 'malformed'
  if (!EVIDENCE_CLASSES.includes(record.evidenceClass)) return 'malformed'
  return null
}

function evaluateCapability(capability, evidence, context) {
  const records = recordsForCapability(evidence, capability)
  if (records.length === 0) {
    return {
      capability,
      status: 'blocked',
      evidenceClass: 'external-blocked',
      directEvidence: false,
      blocker: `${capability}:direct-evidence-required`,
    }
  }

  const failures = records.map((record) => failureForRecord(record, context))
  const current = records.filter((_, index) => failures[index] === null)
  if (current.length > 1) {
    return {
      capability,
      status: 'blocked',
      evidenceClass: 'external-blocked',
      directEvidence: false,
      blocker: `${capability}:conflict`,
      evidenceIds: current.map((record) => record.evidenceId).filter(Boolean),
    }
  }
  if (current.length === 1) {
    const record = current[0]
    return {
      capability,
      status: 'verified',
      evidenceClass: record.evidenceClass,
      directEvidence: true,
      evidenceId: record.evidenceId,
      owner: record.owner,
      expiresAt: record.expiresAt,
    }
  }

  const priority = ['replay', 'revoked', 'out-of-scope', 'expired', 'not-yet-valid', 'deterministic-only', 'malformed', 'direct-evidence-required']
  const reason = priority.find((candidate) => failures.includes(candidate)) ?? 'direct-evidence-required'
  return {
    capability,
    status: 'blocked',
    evidenceClass: records[0].evidenceClass ?? 'external-blocked',
    directEvidence: false,
    blocker: `${capability}:${reason}`,
  }
}

export function createCapabilityMatrix(evidence = []) {
  const context = {
    now: Number.NaN,
    profile: DEFAULT_PROFILE,
    scope: DEFAULT_SCOPE,
  }
  return Object.fromEntries(CAPABILITY_KEYS.map((capability) => [
    capability,
    recordsForCapability(evidence, capability).length === 0
      ? {
          capability,
          status: 'blocked',
          evidenceClass: 'external-blocked',
          directEvidence: false,
          blocker: `${capability}:direct-evidence-required`,
        }
      : evaluateCapability(capability, evidence, context),
  ]))
}

export function evaluateStagedActivation({ requested = {}, liveConformance = false } = {}) {
  const stage = requested.stage ?? 'none'
  const tenantIds = Array.isArray(requested.tenantIds) ? [...new Set(requested.tenantIds.filter(Boolean))] : []
  const customerIds = Array.isArray(requested.customerIds) ? [...new Set(requested.customerIds.filter(Boolean))] : []
  const blockers = []
  if (!STAGES.includes(stage)) blockers.push('stage-unsupported')
  if (stage === 'canary' || stage === 'pilot') {
    if (tenantIds.length === 0) blockers.push('tenant-allowlist-required')
    if (customerIds.length === 0) blockers.push('customer-allowlist-required')
  }
  if (stage === 'broad' && !liveConformance) blockers.push('broad-launch-direct-evidence-required')
  return {
    stage,
    tenantIds,
    customerIds,
    enabled: blockers.length === 0 && stage !== 'none',
    blockers,
  }
}

function effectiveFlags(requestedFlags, matrix, p0Passed, activation) {
  const requested = { ...DEFAULT_PILOT_FLAGS, ...(requestedFlags ?? {}) }
  const verified = (capability) => matrix[capability]?.status === 'verified'
  return {
    providers: requested.providers === true && verified('payments') && verified('whatsapp'),
    payments: requested.payments === true && verified('payments'),
    worker: requested.worker === true && verified('database') && verified('schema') && verified('deployment'),
    delivery: requested.delivery === true && verified('delivery') && verified('deployment'),
    broadLaunch: requested.broadLaunch === true && p0Passed && activation.enabled && activation.stage === 'broad',
  }
}

export function evaluatePilotGoLive({ now, evidence = [], requestedFlags, activation: requestedActivation } = {}) {
  const evaluatedAt = now ?? new Date().toISOString()
  const parsedNow = Date.parse(evaluatedAt)
  if (!Number.isFinite(parsedNow)) throw new TypeError('pilot readiness requires a valid ISO timestamp')
  const profile = requestedActivation?.profile ?? DEFAULT_PROFILE
  const scope = requestedActivation?.scope ?? DEFAULT_SCOPE
  const matrix = Object.fromEntries(CAPABILITY_KEYS.map((capability) => [
    capability,
    evaluateCapability(capability, evidence, { now: parsedNow, profile, scope }),
  ]))
  const blockers = Object.values(matrix).map((row) => row.blocker).filter(Boolean)
  const p0 = {
    passed: blockers.length === 0,
    blockers: [...blockers],
    liveConformance: blockers.length === 0 && evidence.some((record) => record?.direct === true),
  }
  const activation = evaluateStagedActivation({ requested: requestedActivation, liveConformance: p0.liveConformance })
  const flags = effectiveFlags(requestedFlags, matrix, p0.passed, activation)
  const activationBlockers = activation.blockers.map((blocker) => `activation:${blocker}`)
  const allBlockers = [...new Set([...blockers, ...activationBlockers])]
  const liveConformance = p0.passed && p0.liveConformance && activation.enabled
  return {
    schema: 'tus.pilot-go-live-evaluation.v1',
    evaluatedAt,
    profile,
    scope,
    status: liveConformance ? 'go-for-scoped-pilot' : 'not-production-ready',
    liveConformance,
    matrix,
    p0: { ...p0, passed: p0.passed && activationBlockers.length === 0 },
    blockers: allBlockers,
    flags,
    activation,
    evidenceClasses: [...new Set(evidence.map((record) => record?.evidenceClass).filter(Boolean))],
    claim: 'No production readiness is claimed; broad launch remains disabled unless direct evidence and explicit staged authorization exist.',
  }
}

export function applyLaunchDecision({ ledger = [], idempotencyKey, requestHash, decision } = {}) {
  if (!idempotencyKey || !requestHash) throw new TypeError('launch decision idempotencyKey and requestHash are required')
  const existing = ledger.find((entry) => entry.idempotencyKey === idempotencyKey)
  if (existing) {
    if (existing.requestHash === requestHash) return { outcome: 'replay', decision: structuredClone(existing.decision), ledger: structuredClone(ledger) }
    return {
      outcome: 'conflict',
      decision: {
        ...structuredClone(existing.decision),
        status: 'not-production-ready',
        liveConformance: false,
        reason: 'idempotency_conflict',
      },
      ledger: structuredClone(ledger),
    }
  }
  const next = [...ledger, { idempotencyKey, requestHash, decision: structuredClone(decision) }]
  return { outcome: 'accepted', decision: structuredClone(decision), ledger: next }
}

export function createP0RollbackPlan({ now, reason } = {}) {
  if (!reason) throw new TypeError('P0 rollback reason is required')
  const rolledBackAt = now ?? new Date().toISOString()
  return {
    status: 'rollback-required',
    reason,
    stopIntake: true,
    drain: true,
    quarantine: true,
    preserve: ['audit', 'evidence', 'ledger', 'outbox', 'dlq', 'idempotency'],
    financialCorrection: 'append-only-compensation',
    destructiveRollback: false,
    liveConformance: false,
    rolledBackAt,
  }
}
