import { createHash } from 'node:crypto'
import { TUS_CONTRACT_VERSION, type Compromiso, type EvidenciaHabilitacion as EvidenciaHabilitacionContrato, type CapacidadHabilitacion as CapacidadHabilitacionContrato } from '@factory/contracts'
import {
  TUS_OUTBOX_STATUSES,
  type ReferenciaAuditoria,
  type PuertoReferenciasAuditoria,
  type TusCommitmentStorePort,
  type TusIdempotencyClaim,
  type TusIdempotencyStorePort,
  type TusOutboxRecord,
  type TusOutboxStorePort,
  type TusSessionResolverPort,
  type TusAuthenticatedTenantContext,
  type TusTransactionPort,
  type TusTransactionRepositories,
  type TusCheckoutResponse,
  type TusCommitmentCompensation,
  type TusCommitmentCompensationStorePort,
  type TusOutboxStatus,
} from '../ports/index.ts'
import { evaluarHabilitacion, type RegistroAuditoriaHabilitacion, type PuertoEvidenciaHabilitacion, type SolicitudHabilitacion } from '../readiness/index.ts'
/*
  ReferenciaAuditoria,
  PuertoReferenciasAuditoria,
  TusCommitmentStorePort,
  TusIdempotencyClaim,
  TusIdempotencyStorePort,
  TusOutboxRecord,
  TusOutboxStorePort,
  TusSessionResolverPort,
  TusAuthenticatedTenantContext,
  TusTransactionPort,
  TusTransactionRepositories,
  TusCheckoutResponse,
  TusCommitmentCompensation,
  TusCommitmentCompensationStorePort,
  TusOutboxStatus,
*/

interface PrismaCommitmentRow extends Omit<Compromiso, 'createdAt'> {
  id: string
  createdAt: Date
  updatedAt: Date
}

interface PrismaSessionRow {
  id: string
  accountId: string
  tenantId: string
  roles: string[]
  permissions: string[]
  accessTokenDigest: string
  expiresAt: Date
  revokedAt: Date | null
}

interface PrismaIdempotencyRow {
  id: string
  tenantId: string
  key: string
  requestHash: string
  status: string
  response: unknown
  expiresAt: Date
}

interface PrismaCommitmentDelegate {
  createMany(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>
  findFirst(input: { where: { commitmentId: string } }): Promise<PrismaCommitmentRow | null>
  updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
}

interface PrismaCompensationDelegate {
  create(input: { data: Record<string, unknown> }): Promise<unknown>
  findFirst(input: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>
}

interface DelegadoPrismaReferenciasAuditoria {
  createMany(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>
}

interface PrismaSessionDelegate {
  findUnique(input: { where: { accessTokenDigest: string } }): Promise<PrismaSessionRow | null>
}

interface PrismaIdempotencyDelegate {
  findUnique(input: { where: { tenantId_key: { tenantId: string; key: string } } }): Promise<PrismaIdempotencyRow | null>
  findFirst(input: { where: { key: string } }): Promise<PrismaIdempotencyRow | null>
  create(input: { data: Record<string, unknown> }): Promise<PrismaIdempotencyRow>
  update(input: { where: { tenantId_key: { tenantId: string; key: string } }; data: Record<string, unknown> }): Promise<PrismaIdempotencyRow>
  delete(input: { where: { tenantId_key: { tenantId: string; key: string } } }): Promise<PrismaIdempotencyRow>
}

interface PrismaOutboxDelegate {
  create(input: { data: Record<string, unknown> }): Promise<unknown>
  findMany(input: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>
  findFirst(input: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>
  updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  update(input: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>
}

interface PrismaMarketplaceMerchantDelegate {
  upsert(input: { where: { tenantId: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
  findUnique(input: { where: { tenantId: string } }): Promise<Record<string, unknown> | null>
}

interface PrismaMarketplaceListingDelegate {
  upsert(input: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
  findUnique(input: { where: { id: string } }): Promise<Record<string, unknown> | null>
  findMany(input: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>
  updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
}

interface PrismaMarketplaceCommitmentDelegate {
  createMany(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>
  findUnique(input: { where: { id: string } }): Promise<Record<string, unknown> | null>
  findMany(input: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>
}

interface DelegadoPrismaAuditoriaMercadoServicios {
  createMany(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>
  findMany(input: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>
}

interface PrismaCalendarDelegate {
  upsert(input: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
  findUnique(input: { where: { id: string } }): Promise<Record<string, unknown> | null>
}

interface PrismaCalendarRuleDelegate {
  deleteMany(input: { where: Record<string, unknown> }): Promise<{ count: number }>
  createMany(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>
  findMany(input: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>
}

interface PrismaCalendarExceptionDelegate {
  deleteMany(input: { where: Record<string, unknown> }): Promise<{ count: number }>
  createMany(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>
  findMany(input: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>
}

interface PrismaBookingDelegate {
  upsert(input: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
  findUnique(input: { where: { id: string } }): Promise<Record<string, unknown> | null>
  findMany(input: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>
}

interface DelegadoPrismaEvidenciaHabilitacion {
  findMany(input: { where: { tenantId: string; capability: string } }): Promise<Record<string, unknown>[]>
}

interface DelegadoPrismaDecisionHabilitacion {
  create(input: { data: Record<string, unknown> }): Promise<unknown>
}

export interface TusPrismaClient {
  tusCommitment: PrismaCommitmentDelegate
  tusCommitmentCompensation: PrismaCompensationDelegate
  tusAuditReference: DelegadoPrismaReferenciasAuditoria
  session: PrismaSessionDelegate
  idempotencyRecord: PrismaIdempotencyDelegate
  outboxEvent: PrismaOutboxDelegate
  tusMerchant: PrismaMarketplaceMerchantDelegate
  tusListing: PrismaMarketplaceListingDelegate
  tusMarketplaceCommitment: PrismaMarketplaceCommitmentDelegate
  tusMarketplaceAudit: DelegadoPrismaAuditoriaMercadoServicios
  tusCalendar: PrismaCalendarDelegate
  tusCalendarRule: PrismaCalendarRuleDelegate
  tusCalendarException: PrismaCalendarExceptionDelegate
  tusBooking: PrismaBookingDelegate
  tusReadinessEvidence: DelegadoPrismaEvidenciaHabilitacion
  tusReadinessDecision: DelegadoPrismaDecisionHabilitacion
  $transaction<TValue>(callback: (client: TusPrismaClient) => Promise<TValue>): Promise<TValue>
}

export class AlmacenPrismaEvidenciaHabilitacion implements PuertoEvidenciaHabilitacion {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) {
    this.client = client
  }

  async listEvidence(tenantId: string, capability: CapacidadHabilitacionContrato): Promise<readonly EvidenciaHabilitacionContrato[]> {
    const rows = await this.client.tusReadinessEvidence.findMany({ where: { tenantId, capability } })
    return rows.map((row) => ({
      contractVersion: TUS_CONTRACT_VERSION,
      evidenceId: String(row['id']),
      tenantId: String(row['tenantId']),
      capability: row['capability'] as CapacidadHabilitacionContrato,
      gate: row['gate'] as EvidenciaHabilitacionContrato['gate'],
      owner: String(row['owner']),
      scope: String(row['scope']),
      evidenceType: String(row['evidenceType']),
      evidenceRef: String(row['evidenceRef']),
      policyVersion: String(row['policyVersion']),
      issuedAt: toIsoString(row['issuedAt'] ?? row['createdAt']),
      expiresAt: row['expiresAt'] === null || row['expiresAt'] === undefined ? null : toIsoString(row['expiresAt']),
      revoked: Boolean(row['revoked']),
      source: row['source'] as EvidenciaHabilitacionContrato['source'],
      ...(esPerfilHabilitacion(row['profile']) ? { profile: row['profile'] } : {}),
      ...(esEjecucionHabilitacion(row['execution']) ? { execution: row['execution'] } : {}),
      ...(esClaseEvidenciaHabilitacion(row['evidenceClass']) ? { evidenceClass: row['evidenceClass'] } : {}),
      ...(typeof row['liveConformance'] === 'boolean' ? { liveConformance: row['liveConformance'] } : {}),
    }))
  }

  async evaluate(request: SolicitudHabilitacion) {
    const evidence = await this.listEvidence(request.tenantId, request.capability)
    return evaluarHabilitacion({
      tenantId: request.tenantId,
      capability: request.capability,
      scope: request.scope,
      now: request.now ?? new Date().toISOString(),
      evidence: evidence.filter((item) => item.profile === undefined || item.profile === request.profile),
    })
  }

  async recordDecision(record: RegistroAuditoriaHabilitacion): Promise<void> {
    await this.client.tusReadinessDecision.create({
      data: {
        id: `tus-readiness-${record.correlationId}-${Date.now()}`,
        tenantId: record.tenantId,
        capability: record.capability,
        evaluatedAt: new Date(record.decision.evaluatedAt),
        enabled: record.decision.enabled,
        disposition: record.decision.disposition,
        failedGates: record.decision.failedGates,
        evidenceIds: record.decision.evidenceIds,
        deterministic: record.decision.deterministic,
        conflicts: record.decision.conflicts ?? null,
        reason: record.decision.reason ?? null,
        evidencePreserved: record.decision.evidencePreserved ?? null,
        auditPreserved: record.decision.auditPreserved ?? null,
        actorId: record.actorId,
        jobId: record.jobId ?? null,
        correlationId: record.correlationId,
        profile: record.profile,
        scope: record.scope,
        outcome: record.outcome,
        createdAt: new Date(),
      },
    })
  }
}

function toIsoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

function esPerfilHabilitacion(value: unknown): value is 'native-local' | 'render-native' | 'aws-terraform' | 'local-postgresql-http' {
  return ['native-local', 'render-native', 'aws-terraform', 'local-postgresql-http'].includes(String(value))
}

function esEjecucionHabilitacion(value: unknown): value is 'local-verification' | 'live' {
  return value === 'local-verification' || value === 'live'
}

function esClaseEvidenciaHabilitacion(value: unknown): value is 'authorized-external' | 'local-deterministic' | 'local-postgresql-http' | 'deferred' {
  return ['authorized-external', 'local-deterministic', 'local-postgresql-http', 'deferred'].includes(String(value))
}

export class PrismaTusCommitmentStore implements TusCommitmentStorePort {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) {
    this.client = client
  }

  async saveMany(commitments: readonly Compromiso[]): Promise<void> {
    await this.client.tusCommitment.createMany({ data: commitments.map((commitment) => ({
      id: commitment.commitmentId,
      contractVersion: commitment.contractVersion,
      commitmentId: commitment.commitmentId,
      cartId: commitment.cartId,
      tenantId: commitment.tenantId,
      merchantId: commitment.merchantId,
      context: commitment.context,
      amount: commitment.amount,
      currency: commitment.currency,
      status: commitment.status,
      lineIds: commitment.lineIds,
      version: commitment.version,
      createdAt: new Date(commitment.createdAt),
      updatedAt: new Date(commitment.createdAt),
    })) })
  }

  async find(commitmentId: string): Promise<Compromiso | null> {
    const row = await this.client.tusCommitment.findFirst({ where: { commitmentId } })
    if (!row) return null
    return {
      contractVersion: row.contractVersion as Compromiso['contractVersion'],
      commitmentId: row.commitmentId,
      cartId: row.cartId,
      tenantId: row.tenantId,
      merchantId: row.merchantId,
      context: row.context as Compromiso['context'],
      amount: row.amount,
      currency: row.currency,
      status: row.status as Compromiso['status'],
      lineIds: [...row.lineIds],
      version: row.version,
      createdAt: row.createdAt.toISOString(),
    }
  }

  async update(input: { tenantId: string; commitmentId: string; expectedVersion: number; commitment: Compromiso }): Promise<Compromiso | null> {
    const result = await this.client.tusCommitment.updateMany({
      where: { tenantId: input.tenantId, commitmentId: input.commitmentId, version: input.expectedVersion },
      data: { status: input.commitment.status, version: input.commitment.version, updatedAt: new Date(input.commitment.createdAt) },
    })
    return result.count === 0 ? null : input.commitment
  }
}

export class PrismaTusCompensationStore implements TusCommitmentCompensationStorePort {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) {
    this.client = client
  }

  async save(compensation: TusCommitmentCompensation): Promise<void> {
    await this.client.tusCommitmentCompensation.create({ data: { id: compensation.compensationId, ...compensation, createdAt: new Date(compensation.createdAt) } })
  }

  async find(tenantId: string, commitmentId: string): Promise<TusCommitmentCompensation | null> {
    const row = await this.client.tusCommitmentCompensation.findFirst({ where: { tenantId, commitmentId } })
    if (!row) return null
    return { compensationId: String(row['compensationId']), tenantId: String(row['tenantId']), commitmentId: String(row['commitmentId']), actorId: String(row['actorId']), correlationId: String(row['correlationId']), amount: Number(row['amount']), currency: String(row['currency']), reason: String(row['reason']), createdAt: new Date(String(row['createdAt'])).toISOString() }
  }
}

export class AlmacenPrismaReferenciasAuditoria implements PuertoReferenciasAuditoria {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) {
    this.client = client
  }

  async append(references: readonly ReferenciaAuditoria[]): Promise<void> {
    await this.client.tusAuditReference.createMany({ data: references.map((reference) => ({
      id: reference.referenceId,
      referenceId: reference.referenceId,
      tenantId: reference.tenantId,
      actorId: reference.actorId,
      correlationId: reference.correlationId,
      commitmentId: reference.commitmentId,
      referenceType: reference.referenceType,
      metadata: { ...(reference.status ? { status: reference.status } : {}), ...(reference.previousStatus ? { previousStatus: reference.previousStatus } : {}), ...(reference.reason ? { reason: reference.reason } : {}), ...(reference.metadata ?? {}) },
      createdAt: new Date(reference.createdAt),
    })) })
  }

  list(_tenantId: string): ReferenciaAuditoria[] {
    throw new Error('Tenant-scoped audit listing is exposed through reporting adapters, not the write transaction')
  }
}

export class PrismaTusIdempotencyStore implements TusIdempotencyStorePort {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) {
    this.client = client
  }

  async claim(input: { tenantId: string; key: string; requestHash: string; now: number; expiresAt: number }): Promise<TusIdempotencyClaim> {
    const existing = await this.client.idempotencyRecord.findUnique({ where: { tenantId_key: { tenantId: input.tenantId, key: input.key } } })
    const foreign = await this.client.idempotencyRecord.findFirst({ where: { key: input.key } })
    if (foreign && foreign.tenantId !== input.tenantId) return { status: 'conflict' }
    if (!existing) {
      try {
        await this.client.idempotencyRecord.create({ data: {
          id: `tus-idempotency-${input.tenantId}-${input.key}`,
          tenantId: input.tenantId,
          key: input.key,
          requestHash: input.requestHash,
          status: 'pending',
          response: null,
          createdAt: new Date(input.now),
          expiresAt: new Date(input.expiresAt),
        } })
        return { status: 'claimed' }
      } catch {
        return this.claim(input)
      }
    }
    if (existing.requestHash !== input.requestHash) return { status: 'conflict' }
    if (existing.status === 'completed' && existing.response) return { status: 'replay', response: existing.response as TusCheckoutResponse }
    if (existing.status === 'pending' && existing.expiresAt.getTime() <= input.now) {
      await this.client.idempotencyRecord.delete({ where: { tenantId_key: { tenantId: input.tenantId, key: input.key } } })
      return this.claim(input)
    }
    return { status: 'in_progress' }
  }

  async complete(input: { tenantId: string; key: string; response: TusCheckoutResponse }): Promise<void> {
    await this.client.idempotencyRecord.update({
      where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
      data: { status: 'completed', response: input.response },
    })
  }

  async release(input: { tenantId: string; key: string }): Promise<void> {
    await this.client.idempotencyRecord.delete({ where: { tenantId_key: { tenantId: input.tenantId, key: input.key } } })
  }
}

export class PrismaTusOutboxStore implements TusOutboxStorePort {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) {
    this.client = client
  }

  async append(record: TusOutboxRecord): Promise<void> {
    await this.client.outboxEvent.create({ data: {
      id: record.eventId,
      tenantId: record.tenantId,
      aggregateType: 'tus-checkout',
      aggregateId: record.aggregateId,
      eventType: record.eventType,
      payload: record.payload,
      status: 'pending',
      availableAt: new Date(record.createdAt),
      createdAt: new Date(record.createdAt),
    } })
  }

  list(_tenantId: string): TusOutboxRecord[] {
    throw new Error('Tenant-scoped outbox listing is exposed through worker adapters, not the write transaction')
  }

  async claim(tenantId: string, workerId: string, now: number, leaseMs: number): Promise<TusOutboxRecord | null> {
    const rows = await this.client.outboxEvent.findMany({ where: { tenantId, status: TUS_OUTBOX_STATUSES.PENDING, availableAt: { lte: new Date(now) } } })
    const row = rows[0]
    if (!row) return null
    const claimId = `${workerId}:${String(row['id'])}:${Number(row['attempts'] ?? 0) + 1}`
    const result = await this.client.outboxEvent.updateMany({ where: { id: row['id'], tenantId, status: TUS_OUTBOX_STATUSES.PENDING }, data: { status: TUS_OUTBOX_STATUSES.PROCESSING, attempts: Number(row['attempts'] ?? 0) + 1, claimId, claimUntil: new Date(now + leaseMs) } })
    return result.count === 0 ? null : fromPrismaOutbox(row, { status: TUS_OUTBOX_STATUSES.PROCESSING, attempts: Number(row['attempts'] ?? 0) + 1, claimId, claimUntil: now + leaseMs })
  }

  async acknowledge(input: { tenantId: string; eventId: string; claimId: string; publishedAt: number }): Promise<boolean> {
    const result = await this.client.outboxEvent.updateMany({ where: { id: input.eventId, tenantId: input.tenantId, status: TUS_OUTBOX_STATUSES.PROCESSING, claimId: input.claimId }, data: { status: TUS_OUTBOX_STATUSES.PUBLISHED, claimId: null, claimUntil: null, publishedAt: new Date(input.publishedAt) } })
    return result.count === 1
  }

  async fail(input: { tenantId: string; eventId: string; claimId: string; error: string; now: number; maxAttempts: number }): Promise<TusOutboxStatus> {
    const row = await this.client.outboxEvent.findFirst({ where: { id: input.eventId, tenantId: input.tenantId, status: TUS_OUTBOX_STATUSES.PROCESSING, claimId: input.claimId } })
    if (!row) return TUS_OUTBOX_STATUSES.DEAD_LETTER
    const status = Number(row['attempts'] ?? 0) >= input.maxAttempts ? TUS_OUTBOX_STATUSES.DEAD_LETTER : TUS_OUTBOX_STATUSES.PENDING
    await this.client.outboxEvent.update({ where: { id: input.eventId }, data: { status, lastError: input.error, availableAt: new Date(input.now), claimId: null, claimUntil: null } })
    return status
  }

  async recover(now: number): Promise<number> {
    const result = await this.client.outboxEvent.updateMany({ where: { status: TUS_OUTBOX_STATUSES.PROCESSING, claimUntil: { lte: new Date(now) } }, data: { status: TUS_OUTBOX_STATUSES.PENDING, claimId: null, claimUntil: null, availableAt: new Date(now) } })
    return result.count
  }
}

function fromPrismaOutbox(row: Record<string, unknown>, overrides: Partial<TusOutboxRecord> = {}): TusOutboxRecord {
  return { eventId: String(row['id']), tenantId: String(row['tenantId']), eventType: row['eventType'] as TusOutboxRecord['eventType'], aggregateId: String(row['aggregateId']), payload: row['payload'] as TusOutboxRecord['payload'], createdAt: new Date(String(row['createdAt'])).getTime(), status: row['status'] as TusOutboxStatus, attempts: Number(row['attempts'] ?? 0), availableAt: new Date(String(row['availableAt'])).getTime(), lastError: typeof row['lastError'] === 'string' ? row['lastError'] : null, claimId: typeof row['claimId'] === 'string' ? row['claimId'] : null, claimUntil: row['claimUntil'] ? new Date(String(row['claimUntil'])).getTime() : null, ...overrides }
}

export class PrismaTusTransaction implements TusTransactionPort {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) {
    this.client = client
  }

  run<TValue>(operation: (repositories: TusTransactionRepositories) => Promise<TValue>): Promise<TValue> {
    return this.client.$transaction(async (client) => operation({
      commitments: new PrismaTusCommitmentStore(client),
      compensations: new PrismaTusCompensationStore(client),
      audits: new AlmacenPrismaReferenciasAuditoria(client),
      idempotency: new PrismaTusIdempotencyStore(client),
      outbox: new PrismaTusOutboxStore(client),
    }))
  }
}

export class PrismaTusSessionResolver implements TusSessionResolverPort {
  private readonly client: TusPrismaClient
  private readonly now: () => number

  constructor(client: TusPrismaClient, now: () => number = () => Date.now()) {
    this.client = client
    this.now = now
  }

  async resolve(accessToken: string, correlationId: string): Promise<TusAuthenticatedTenantContext | null> {
    const accessTokenDigest = createHash('sha256').update(accessToken).digest('hex')
    const session = await this.client.session.findUnique({ where: { accessTokenDigest } })
    if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= this.now()) return null
    return {
      subjectId: session.accountId,
      sessionId: session.id,
      tenantId: session.tenantId,
      roles: [...session.roles],
      permissions: [...session.permissions],
      correlationId,
    }
  }
}

export default {
  AlmacenPrismaReferenciasAuditoria,
  PrismaTusCommitmentStore,
  PrismaTusCompensationStore,
  PrismaTusIdempotencyStore,
  PrismaTusOutboxStore,
  PrismaTusSessionResolver,
  PrismaTusTransaction,
}
