import {
  CLAVES_REQUISITOS_HABILITACION as CLAVES_REQUISITOS_HABILITACION_CONTRATO,
  TUS_CONTRACT_VERSION,
  type CapacidadHabilitacion as CapacidadHabilitacionContrato,
  type ConflictoHabilitacion as ConflictoHabilitacionContrato,
  type FallaRequisitoHabilitacion as FallaRequisitoHabilitacionContrato,
  type ClaveRequisitoHabilitacion as ClaveRequisitoHabilitacionContrato,
  type DecisionHabilitacion as DecisionHabilitacionContrato,
  type EvidenciaHabilitacion as EvidenciaHabilitacionContrato,
  validarEvidenciaHabilitacion as validarEvidenciaHabilitacionContrato,
} from '@factory/contracts'

export const REQUISITOS_HABILITACION_REQUERIDOS = CLAVES_REQUISITOS_HABILITACION_CONTRATO

const REQUISITOS_POR_CAPACIDAD: Record<CapacidadHabilitacionContrato, readonly ClaveRequisitoHabilitacionContrato[]> = {
  publication: ['legal', 'kyb', 'tax', 'runtimeProvider'],
  // PROVIDER-ACTIONS-GATES-01. Payment intents, evidence, provider webhooks and deterministic
  // WhatsApp actions: none of them runs a model, so the migration of Groq is not asked. `aws`
  // is conditional on the runtime (REQUISITOS_CONDICIONALES below).
  'provider-actions': ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider'],
  // SETTLEMENT-GATES-01. The core every settlement needs. `aws` and `posPilot` are added only
  // when the runtime or the flow really involves them (REQUISITOS_CONDICIONALES below); the
  // migration of Groq belongs to the assistant's capability and never takes part in money.
  settlement: ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider'],
  // PAGOS-HABILITACION-TECNICA-01. The evidence kept under this key is the readiness for the
  // PUBLIC LAUNCH of service payments (`public-launch-readiness` for an operator): commercial and
  // legal approvals. It is reported, and it does not decide whether a payment can be charged:
  // that depends on the real controls of the payment engine (finance/servicios/configuracion.ts).
  'service-payments': ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider'],
  fleet: ['legal', 'kyc', 'kyb', 'tax', 'posPilot', 'runtimeProvider'],
  'release-jobs': ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'posPilot', 'runtimeProvider'],
}

// Capabilities whose evidence is recorded and renewed through the administrative registry
// (evidencias-admin.ts). `settlement` and the rest are deliberately not here.
const CAPACIDADES_RENOVABLES: ReadonlySet<CapacidadHabilitacionContrato> = new Set(['service-payments'])

// Where and how an operation runs: what decides the conditional requirements.
//   profile  the deployment profile the process really runs with (never a manual switch)
//   flow     'pos' for an operation processed through the point of sale
export type FlujoHabilitacion = 'pos'
export interface ContextoRequisitosHabilitacion {
  profile?: string
  flow?: FlujoHabilitacion
}

export type MotivoRequisitoNoRequerido = 'not_required_in_runtime' | 'not_required_for_flow'

// SETTLEMENT-GATES-01. Requirements that apply only in some runtime or flow. The moment the
// condition holds (TUS runs on AWS, an operation goes through the POS) the gate is required
// again, with valid evidence, without anybody switching anything.
const REQUISITOS_CONDICIONALES: Partial<Record<CapacidadHabilitacionContrato, readonly { gate: ClaveRequisitoHabilitacionContrato; requerido: (contexto: ContextoRequisitosHabilitacion) => boolean; motivo: MotivoRequisitoNoRequerido }[]>> = {
  settlement: [
    { gate: 'aws', requerido: (contexto) => contexto.profile === 'aws-terraform', motivo: 'not_required_in_runtime' },
    { gate: 'posPilot', requerido: (contexto) => contexto.flow === 'pos', motivo: 'not_required_for_flow' },
  ],
  'provider-actions': [
    { gate: 'aws', requerido: (contexto) => contexto.profile === 'aws-terraform', motivo: 'not_required_in_runtime' },
  ],
}

export function requisitosDeCapacidad(
  capability: CapacidadHabilitacionContrato,
  contexto: ContextoRequisitosHabilitacion = {},
): readonly ClaveRequisitoHabilitacionContrato[] {
  const condicionales = (REQUISITOS_CONDICIONALES[capability] ?? []).filter((item) => item.requerido(contexto)).map((item) => item.gate)
  return condicionales.length === 0 ? REQUISITOS_POR_CAPACIDAD[capability] : [...REQUISITOS_POR_CAPACIDAD[capability], ...condicionales]
}

// The conditional requirements that do NOT apply in that context, with why (for an operator).
export function requisitosNoRequeridos(
  capability: CapacidadHabilitacionContrato,
  contexto: ContextoRequisitosHabilitacion = {},
): { gate: ClaveRequisitoHabilitacionContrato; reason: MotivoRequisitoNoRequerido }[] {
  return (REQUISITOS_CONDICIONALES[capability] ?? []).filter((item) => !item.requerido(contexto)).map((item) => ({ gate: item.gate, reason: item.motivo }))
}

// Every requirement the capability can ever ask for (its core and its conditional ones).
export function requisitosPosiblesDeCapacidad(capability: CapacidadHabilitacionContrato): readonly ClaveRequisitoHabilitacionContrato[] {
  return [...REQUISITOS_POR_CAPACIDAD[capability], ...(REQUISITOS_CONDICIONALES[capability] ?? []).map((item) => item.gate)]
}

const CLAVES_REQUISITO_LEGACY = [
  'legal',
  'kyc',
  'kyb',
  'tax',
  'mercadoPago',
  'posPilot',
  'aws',
  'groqMigration',
] as const

export type EntradaCrearEvidenciaHabilitacion = Omit<
  EvidenciaHabilitacionContrato,
  'contractVersion' | 'issuedAt' | 'source'
>

export type FuenteEvidenciaHabilitacion = EvidenciaHabilitacionContrato['source']

const COMPATIBILITY_ISSUED_AT = '1970-01-01T00:00:00.000Z'

function normalizarFuenteEvidencia(source: FuenteEvidenciaHabilitacion): EvidenciaHabilitacionContrato['source'] {
  if (source === 'authorized') return 'authorized-external'
  if (source === 'deterministic-test-only') return 'local-deterministic'
  return source
}

export function crearEvidenciaHabilitacion(
  input: EntradaCrearEvidenciaHabilitacion & { issuedAt?: string; source: FuenteEvidenciaHabilitacion },
): EvidenciaHabilitacionContrato {
  const source = normalizarFuenteEvidencia(input.source)
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
  return validarEvidenciaHabilitacionContrato(evidence)
}

export interface EntradaHabilitacionPublicacionEtapa1 {
  tenantId: string
  cohort: string
  regulatedHealthcare: boolean
}

export type DecisionHabilitacionPublicacionEtapa1 =
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

export function evaluarHabilitacionPublicacionEtapa1(
  input: EntradaHabilitacionPublicacionEtapa1,
): DecisionHabilitacionPublicacionEtapa1 {
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

export interface EntradaEvaluarHabilitacion {
  tenantId: string
  capability: CapacidadHabilitacionContrato
  scope?: string
  now: string
  evidence: readonly EvidenciaHabilitacionContrato[]
  // What decides the conditional requirements of the capability (see requisitosDeCapacidad).
  profile?: string
  flow?: FlujoHabilitacion
}

export function evaluarHabilitacion(input: EntradaEvaluarHabilitacion): DecisionHabilitacionContrato {
  const failures: FallaRequisitoHabilitacionContrato[] = []
  const evidenceIds: string[] = []
  const conflicts: ConflictoHabilitacionContrato[] = []
  const requiredGates = requisitosDeCapacidad(input.capability, { profile: input.profile, flow: input.flow })
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
        validarEvidenciaHabilitacionContrato(candidate)
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

    // Renewal, only for the capabilities that opted in: a revoked or expired record is history.
    // Exactly one current authorized record, with nothing else beside it but that history,
    // satisfies the gate. Any other record next to it (deterministic, deferred, not yet valid)
    // still fails below. Every other capability keeps the original rule: any revoked or expired
    // record of a gate blocks it.
    const [vigente] = currentCandidates
    if (
      CAPACIDADES_RENOVABLES.has(input.capability) &&
      vigente &&
      scopedCandidates.every(
        (candidate) =>
          candidate === vigente ||
          candidate.revoked ||
          (candidate.expiresAt !== null && Date.parse(candidate.expiresAt) <= now),
      )
    )
      continue

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

export interface EstadoHabilitacionLegacy {
  enabled: boolean
  failedGates: ClaveRequisitoHabilitacionContrato[]
}

export function evaluarRequisitosHabilitacionLegacy(
  gates: Partial<Record<ClaveRequisitoHabilitacionContrato, boolean>>,
): EstadoHabilitacionLegacy {
  const failedGates = CLAVES_REQUISITO_LEGACY.filter((gate) => gates[gate] !== true)
  return { enabled: failedGates.length === 0, failedGates }
}

export function conciliarDecisionHabilitacion(
  canonical: DecisionHabilitacionContrato,
  legacy: EstadoHabilitacionLegacy,
): DecisionHabilitacionContrato {
  if (canonical.enabled === legacy.enabled) return canonical

  const gates = legacy.enabled ? canonical.failedGates.map(({ gate }) => gate) : legacy.failedGates
  const failedGates: FallaRequisitoHabilitacionContrato[] = gates.map((gate) => ({ gate, reason: 'legacy_conflict' }))
  const conflicts: ConflictoHabilitacionContrato[] = gates.map((gate) => ({ gate, evidenceIds: [], source: 'legacy-boolean' }))
  return {
    ...canonical,
    enabled: false,
    disposition: 'disabled',
    failedGates,
    conflicts,
    reason: 'legacy_readiness_conflict',
  }
}

export function revertirHabilitacion(
  decision: DecisionHabilitacionContrato,
  reason: string,
  evaluatedAt: string,
): DecisionHabilitacionContrato {
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

export const PERFILES_HABILITACION = [
  'native-local',
  'render-native',
  'aws-terraform',
  'local-postgresql-http',
] as const

export type PerfilHabilitacion = (typeof PERFILES_HABILITACION)[number]

export interface SolicitudHabilitacion {
  tenantId: string
  actorId: string
  correlationId: string
  capability: CapacidadHabilitacionContrato
  profile: PerfilHabilitacion
  scope: string
  // 'pos' when the operation is processed through the point of sale.
  flow?: FlujoHabilitacion
  jobId?: string
  now?: string
}

export interface RegistroAuditoriaHabilitacion extends SolicitudHabilitacion {
  decision: DecisionHabilitacionContrato
  outcome: 'authorized' | 'blocked'
}

export interface PuertoEvidenciaHabilitacion {
  listEvidence(tenantId: string, capability: CapacidadHabilitacionContrato): Promise<readonly EvidenciaHabilitacionContrato[]> | readonly EvidenciaHabilitacionContrato[]
  evaluate?(request: SolicitudHabilitacion): Promise<DecisionHabilitacionContrato> | DecisionHabilitacionContrato
  recordDecision?(record: RegistroAuditoriaHabilitacion): Promise<void> | void
}

export class HabilitacionBloqueadaError extends Error {
  readonly code = 'TUS_READINESS_BLOCKED'
  readonly status = 409
  readonly decision: DecisionHabilitacionContrato

  constructor(decision: DecisionHabilitacionContrato) {
    super('TUS readiness requirements are not satisfied')
    this.name = 'TusReadinessBlockedError'
    this.decision = decision
  }
}

export class AlmacenMemoriaAuditoriaHabilitacion {
  private readonly records: RegistroAuditoriaHabilitacion[] = []

  async record(record: RegistroAuditoriaHabilitacion): Promise<void> {
    this.records.push(structuredClone(record))
  }

  list(tenantId?: string): RegistroAuditoriaHabilitacion[] {
    return this.records
      .filter((record) => tenantId === undefined || record.tenantId === tenantId)
      .map((record) => structuredClone(record))
      .reverse()
  }
}

export interface OpcionesPuertoMemoriaHabilitacion {
  evidence?: readonly EvidenciaHabilitacionContrato[]
  legacy?: EstadoHabilitacionLegacy
  now?: string
  audit?: AlmacenMemoriaAuditoriaHabilitacion
}

export class PuertoMemoriaHabilitacion implements PuertoEvidenciaHabilitacion {
  private readonly evidence: readonly EvidenciaHabilitacionContrato[]
  private readonly legacy?: EstadoHabilitacionLegacy
  private readonly now?: string

  constructor(options: OpcionesPuertoMemoriaHabilitacion = {}) {
    this.evidence = options.evidence ?? []
    this.legacy = options.legacy
    this.now = options.now
  }

  listEvidence(tenantId: string, capability: CapacidadHabilitacionContrato): readonly EvidenciaHabilitacionContrato[] {
    return this.evidence.filter((item) => item.tenantId === tenantId && item.capability === capability)
  }

  evaluate(request: SolicitudHabilitacion): DecisionHabilitacionContrato {
    const profileEvidence = this.evidence.filter((item) => item.profile === undefined || item.profile === request.profile)
    const canonical = evaluarHabilitacion({
      tenantId: request.tenantId,
      capability: request.capability,
      scope: request.scope,
      now: request.now ?? this.now ?? new Date().toISOString(),
      evidence: profileEvidence,
      profile: request.profile,
      flow: request.flow,
    })
    return this.legacy === undefined ? canonical : conciliarDecisionHabilitacion(canonical, this.legacy)
  }
}

/** Evaluates habilitation evidence and blocks operations without an authorized decision. */
export class EvaluadorHabilitacion {
  readonly audit: AlmacenMemoriaAuditoriaHabilitacion
  private readonly port: PuertoEvidenciaHabilitacion

  constructor(port: PuertoEvidenciaHabilitacion, audit = new AlmacenMemoriaAuditoriaHabilitacion()) {
    this.port = port
    this.audit = audit
  }

  async require(request: SolicitudHabilitacion): Promise<DecisionHabilitacionContrato> {
    const baseDecision = await this.evaluate(request)
    const decision: DecisionHabilitacionContrato = {
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
    const record: RegistroAuditoriaHabilitacion = {
      ...request,
      decision,
      outcome: decision.enabled && decision.disposition === 'authorized' ? 'authorized' : 'blocked',
    }
    await this.audit.record(record)
    await this.port.recordDecision?.(record)
    if (record.outcome === 'blocked') throw new HabilitacionBloqueadaError(decision)
    return decision
  }

  async authorize(request: SolicitudHabilitacion): Promise<DecisionHabilitacionContrato> {
    return this.require(request)
  }

  private async evaluate(request: SolicitudHabilitacion): Promise<DecisionHabilitacionContrato> {
    if (!request.tenantId || !request.actorId || !request.correlationId || !request.scope) {
      throw new HabilitacionBloqueadaError({
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
    if (!PERFILES_HABILITACION.includes(request.profile)) {
      throw new HabilitacionBloqueadaError({
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
    return evaluarHabilitacion({
      tenantId: request.tenantId,
      capability: request.capability,
      scope: request.scope,
      now: request.now ?? new Date().toISOString(),
      evidence,
      profile: request.profile,
      flow: request.flow,
    })
  }
}
