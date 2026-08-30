import {
  READINESS_GATE_KEYS,
  TUS_CONTRACT_VERSION,
  type ReadinessCapability,
  type ReadinessConflict,
  type ReadinessGateFailure,
  type ReadinessGateKey,
  type TusReadinessDecision,
  type TusReadinessEvidence,
  validateTusReadinessEvidence,
} from '@factory/contracts'

export const REQUIRED_READINESS_GATES = READINESS_GATE_KEYS

const REQUIRED_GATES_BY_CAPABILITY: Record<ReadinessCapability, readonly ReadinessGateKey[]> = {
  publication: ['legal', 'kyb', 'tax', 'runtimeProvider'],
  'provider-actions': ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'aws', 'groqMigration', 'runtimeProvider'],
  settlement: REQUIRED_READINESS_GATES,
  fleet: ['legal', 'kyc', 'kyb', 'tax', 'posPilot', 'runtimeProvider'],
  'release-jobs': ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'posPilot', 'runtimeProvider'],
}

const LEGACY_READINESS_GATE_KEYS = [
  'legal',
  'kyc',
  'kyb',
  'tax',
  'mercadoPago',
  'posPilot',
  'aws',
  'groqMigration',
] as const

export type CreateReadinessEvidenceInput = Omit<
  TusReadinessEvidence,
  'contractVersion' | 'issuedAt' | 'source'
>

export type ReadinessEvidenceSourceInput = TusReadinessEvidence['source']

const COMPATIBILITY_ISSUED_AT = '1970-01-01T00:00:00.000Z'

function normalizeEvidenceSource(source: ReadinessEvidenceSourceInput): TusReadinessEvidence['source'] {
  if (source === 'authorized') return 'authorized-external'
  if (source === 'deterministic-test-only') return 'local-deterministic'
  return source
}

export function createReadinessEvidence(
  input: CreateReadinessEvidenceInput & { issuedAt?: string; source: ReadinessEvidenceSourceInput },
): TusReadinessEvidence {
  const source = normalizeEvidenceSource(input.source)
  const profile = input.profile ?? 'native-local'
  const execution = input.execution ?? (profile === 'native-local' || profile === 'local-postgresql-http' ? 'local-verification' : 'live')
  const evidence = Object.freeze({
    contractVersion: TUS_CONTRACT_VERSION,
    issuedAt: input.issuedAt ?? COMPATIBILITY_ISSUED_AT,
    ...input,
    source,
    profile,
    execution,
    evidenceClass: input.evidenceClass ?? source,
    liveConformance: input.liveConformance ?? (execution === 'live' && source === 'authorized-external'),
  })
  return validateTusReadinessEvidence(evidence)
}

export interface Stage1PublicationReadinessInput {
  tenantId: string
  cohort: string
  regulatedHealthcare: boolean
}

export type Stage1PublicationReadinessDecision =
  | {
      allowed: true
      reason: 'approved_stage_1_cohort'
      tenantId: string
      nonClaim: null
    }
  | {
      allowed: false
      reason: 'regulated_vertical_excluded' | 'cohort_not_enabled'
      tenantId: string
      nonClaim: 'regulated_vertical_excluded' | 'cohort_not_enabled'
    }

export function evaluateStage1PublicationReadiness(
  input: Stage1PublicationReadinessInput,
): Stage1PublicationReadinessDecision {
  if (input.regulatedHealthcare) {
    return {
      allowed: false,
      reason: 'regulated_vertical_excluded',
      tenantId: input.tenantId,
      nonClaim: 'regulated_vertical_excluded',
    }
  }
  if (input.cohort !== 'beauty-personal-care' && input.cohort !== 'repairs-trades') {
    return {
      allowed: false,
      reason: 'cohort_not_enabled',
      tenantId: input.tenantId,
      nonClaim: 'cohort_not_enabled',
    }
  }
  return {
    allowed: true,
    reason: 'approved_stage_1_cohort',
    tenantId: input.tenantId,
    nonClaim: null,
  }
}

export interface EvaluateTusReadinessInput {
  tenantId: string
  capability: ReadinessCapability
  scope?: string
  now: string
  evidence: readonly TusReadinessEvidence[]
}

export function evaluateTusReadiness(input: EvaluateTusReadinessInput): TusReadinessDecision {
  const failures: ReadinessGateFailure[] = []
  const evidenceIds: string[] = []
  const conflicts: ReadinessConflict[] = []
  const requiredGates = REQUIRED_GATES_BY_CAPABILITY[input.capability]
  const now = Date.parse(input.now)
  if (!Number.isFinite(now)) throw new Error('readiness evaluation requires a valid ISO timestamp')

  const matchingEvidence = input.evidence.filter(
    (item) => item.tenantId === input.tenantId && item.capability === input.capability,
  )

  for (const gate of requiredGates) {
    const candidates = matchingEvidence.filter((item) => item.gate === gate)
    evidenceIds.push(...candidates.map(({ evidenceId }) => evidenceId))
    if (candidates.length === 0) {
      failures.push({ gate, reason: 'evidence_missing' })
      continue
    }

    const scopedCandidates = input.scope === undefined ? candidates : candidates.filter(({ scope }) => scope === input.scope)
    if (scopedCandidates.length === 0) {
      failures.push({ gate, reason: 'evidence_out_of_scope' })
      continue
    }

    const malformed = scopedCandidates.find((candidate) => {
      try {
        validateTusReadinessEvidence(candidate)
        return false
      } catch {
        return true
      }
    })
    if (malformed) {
      failures.push({ gate, reason: 'evidence_malformed' })
      continue
    }

    const currentCandidates = scopedCandidates.filter((candidate) => {
      const issuedAt = Date.parse(candidate.issuedAt)
      const expiresAt = candidate.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(candidate.expiresAt)
      return !candidate.revoked && issuedAt <= now && expiresAt > now && candidate.source === 'authorized-external'
    })
    if (currentCandidates.length > 1) {
      conflicts.push({ gate, evidenceIds: scopedCandidates.map(({ evidenceId }) => evidenceId) })
      failures.push({ gate, reason: 'evidence_conflict' })
      continue
    }

    if (scopedCandidates.some(({ revoked }) => revoked)) {
      failures.push({ gate, reason: 'evidence_revoked' })
      continue
    }
    if (scopedCandidates.some(({ issuedAt }) => Date.parse(issuedAt) > now)) {
      failures.push({ gate, reason: 'evidence_not_yet_valid' })
      continue
    }
    if (
      scopedCandidates.some(
        ({ expiresAt }) => expiresAt !== null && Date.parse(expiresAt) <= now,
      )
    ) {
      failures.push({ gate, reason: 'evidence_expired' })
      continue
    }
    if (scopedCandidates.some(({ source }) => source === 'local-deterministic')) {
      failures.push({ gate, reason: 'deterministic_test_only' })
      continue
    }
    if (scopedCandidates.some(({ source }) => source !== 'authorized-external')) {
      failures.push({ gate, reason: 'evidence_deferred' })
      continue
    }
  }

  const deterministic = failures.some(({ reason }) => reason === 'deterministic_test_only')
  const deferred = failures.some(({ reason }) => reason === 'evidence_deferred')
  const enabled = failures.length === 0 && conflicts.length === 0
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    tenantId: input.tenantId,
    capability: input.capability,
    evaluatedAt: input.now,
    enabled,
    disposition: enabled ? 'authorized' : deterministic || deferred ? 'unavailable-deferred' : 'disabled',
    failedGates: failures,
    evidenceIds,
    deterministic,
    ...(conflicts.length > 0 ? { conflicts } : {}),
    ...(deterministic
      ? { reason: 'deterministic_test_only' }
      : deferred
        ? { reason: 'evidence_deferred' }
        : {}),
  }
}

export interface LegacyReadinessStatus {
  enabled: boolean
  failedGates: ReadinessGateKey[]
}

export function evaluateLegacyReadinessGates(
  gates: Partial<Record<ReadinessGateKey, boolean>>,
): LegacyReadinessStatus {
  const failedGates = LEGACY_READINESS_GATE_KEYS.filter((gate) => gates[gate] !== true)
  return { enabled: failedGates.length === 0, failedGates }
}

export function reconcileReadinessDecision(
  canonical: TusReadinessDecision,
  legacy: LegacyReadinessStatus,
): TusReadinessDecision {
  if (canonical.enabled === legacy.enabled) return canonical

  const gates = legacy.enabled ? canonical.failedGates.map(({ gate }) => gate) : legacy.failedGates
  const failedGates: ReadinessGateFailure[] = gates.map((gate) => ({ gate, reason: 'legacy_conflict' }))
  const conflicts: ReadinessConflict[] = gates.map((gate) => ({ gate, evidenceIds: [], source: 'legacy-boolean' }))
  return {
    ...canonical,
    enabled: false,
    disposition: 'disabled',
    failedGates,
    conflicts,
    reason: 'legacy_readiness_conflict',
  }
}

export function rollbackReadiness(
  decision: TusReadinessDecision,
  reason: string,
  evaluatedAt: string,
): TusReadinessDecision {
  return {
    ...decision,
    evaluatedAt,
    enabled: false,
    disposition: 'disabled',
    failedGates: [],
    reason,
    evidencePreserved: true,
    auditPreserved: true,
  }
}

export const TUS_READINESS_PROFILES = [
  'native-local',
  'render-native',
  'aws-terraform',
  'local-postgresql-http',
] as const

export type TusReadinessProfile = (typeof TUS_READINESS_PROFILES)[number]

export interface TusReadinessRequest {
  tenantId: string
  actorId: string
  correlationId: string
  capability: ReadinessCapability
  profile: TusReadinessProfile
  scope: string
  jobId?: string
  now?: string
}

export interface TusReadinessAuditRecord extends TusReadinessRequest {
  decision: TusReadinessDecision
  outcome: 'authorized' | 'blocked'
}

export interface TusReadinessEvidencePort {
  listEvidence(tenantId: string, capability: ReadinessCapability): Promise<readonly TusReadinessEvidence[]> | readonly TusReadinessEvidence[]
  evaluate?(request: TusReadinessRequest): Promise<TusReadinessDecision> | TusReadinessDecision
  recordDecision?(record: TusReadinessAuditRecord): Promise<void> | void
}

export class TusReadinessBlockedError extends Error {
  readonly code = 'TUS_READINESS_BLOCKED'
  readonly status = 409
  readonly decision: TusReadinessDecision

  constructor(decision: TusReadinessDecision) {
    super('TUS readiness requirements are not satisfied')
    this.name = 'TusReadinessBlockedError'
    this.decision = decision
  }
}

export class InMemoryTusReadinessAuditStore {
  private readonly records: TusReadinessAuditRecord[] = []

  async record(record: TusReadinessAuditRecord): Promise<void> {
    this.records.push(structuredClone(record))
  }

  list(tenantId?: string): TusReadinessAuditRecord[] {
    return this.records
      .filter((record) => tenantId === undefined || record.tenantId === tenantId)
      .map((record) => structuredClone(record))
      .reverse()
  }
}

export interface InMemoryTusReadinessPortOptions {
  evidence?: readonly TusReadinessEvidence[]
  legacy?: LegacyReadinessStatus
  now?: string
  audit?: InMemoryTusReadinessAuditStore
}

export class InMemoryTusReadinessPort implements TusReadinessEvidencePort {
  private readonly evidence: readonly TusReadinessEvidence[]
  private readonly legacy?: LegacyReadinessStatus
  private readonly now?: string

  constructor(options: InMemoryTusReadinessPortOptions = {}) {
    this.evidence = options.evidence ?? []
    this.legacy = options.legacy
    this.now = options.now
  }

  listEvidence(tenantId: string, capability: ReadinessCapability): readonly TusReadinessEvidence[] {
    return this.evidence.filter((item) => item.tenantId === tenantId && item.capability === capability)
  }

  evaluate(request: TusReadinessRequest): TusReadinessDecision {
    const profileEvidence = this.evidence.filter((item) => item.profile === undefined || item.profile === request.profile)
    const canonical = evaluateTusReadiness({
      tenantId: request.tenantId,
      capability: request.capability,
      scope: request.scope,
      now: request.now ?? this.now ?? new Date().toISOString(),
      evidence: profileEvidence,
    })
    return this.legacy === undefined ? canonical : reconcileReadinessDecision(canonical, this.legacy)
  }
}

export class TusReadinessGuard {
  readonly audit: InMemoryTusReadinessAuditStore
  private readonly port: TusReadinessEvidencePort

  constructor(port: TusReadinessEvidencePort, audit = new InMemoryTusReadinessAuditStore()) {
    this.port = port
    this.audit = audit
  }

  async require(request: TusReadinessRequest): Promise<TusReadinessDecision> {
    const baseDecision = await this.evaluate(request)
    const decision: TusReadinessDecision = {
      ...baseDecision,
      profile: request.profile,
      execution: request.profile === 'native-local' || request.profile === 'local-postgresql-http' ? 'local-verification' : 'live',
      ...(baseDecision.enabled ? { evidenceClass: 'authorized-external' as const } : {}),
      ...(baseDecision.deterministic ? { evidenceClass: 'local-deterministic' as const } : {}),
      ...(baseDecision.disposition === 'unavailable-deferred' && !baseDecision.deterministic ? { evidenceClass: 'deferred' as const } : {}),
      scope: request.scope,
      actorId: request.actorId,
      ...(request.jobId ? { jobId: request.jobId } : {}),
      correlationId: request.correlationId,
    }
    const record: TusReadinessAuditRecord = {
      ...request,
      decision,
      outcome: decision.enabled && decision.disposition === 'authorized' ? 'authorized' : 'blocked',
    }
    await this.audit.record(record)
    await this.port.recordDecision?.(record)
    if (record.outcome === 'blocked') throw new TusReadinessBlockedError(decision)
    return decision
  }

  async authorize(request: TusReadinessRequest): Promise<TusReadinessDecision> {
    return this.require(request)
  }

  private async evaluate(request: TusReadinessRequest): Promise<TusReadinessDecision> {
    if (!request.tenantId || !request.actorId || !request.correlationId || !request.scope) {
      throw new TusReadinessBlockedError({
        contractVersion: TUS_CONTRACT_VERSION,
        tenantId: request.tenantId,
        capability: request.capability,
        evaluatedAt: request.now ?? new Date().toISOString(),
        enabled: false,
        disposition: 'disabled',
        failedGates: [],
        evidenceIds: [],
        deterministic: false,
        reason: 'readiness_context_missing',
      })
    }
    if (!TUS_READINESS_PROFILES.includes(request.profile)) {
      throw new TusReadinessBlockedError({
        contractVersion: TUS_CONTRACT_VERSION,
        tenantId: request.tenantId,
        capability: request.capability,
        evaluatedAt: request.now ?? new Date().toISOString(),
        enabled: false,
        disposition: 'disabled',
        failedGates: [],
        evidenceIds: [],
        deterministic: false,
        reason: 'readiness_profile_unknown',
      })
    }
    if (this.port.evaluate) {
      return this.port.evaluate(request)
    }
    const evidence = await this.port.listEvidence(request.tenantId, request.capability)
    return evaluateTusReadiness({
      tenantId: request.tenantId,
      capability: request.capability,
      scope: request.scope,
      now: request.now ?? new Date().toISOString(),
      evidence,
    })
  }
}
