import type {
  DeliveryAuditRecord,
  DeliveryIncident,
  DeliveryProof,
  DeliveryShift,
  DeliveryStorePort,
  DeliveryTask,
  DeliveryZone,
  DeliveryOutboxRecord,
} from '../delivery/index.ts'
import { PosError, type PosAuditRecord, type PosCommandResult, type PosConflict, type PosDevice, type PosManualOperation, type PosOutboxRecord, type PosReceipt, type PosSession, type PosStorePort } from '../pos/index.ts'

type Row = any

interface DeliveryPrismaClient {
  tusDeliveryZone: Delegate
  tusDeliveryShift: Delegate
  tusDeliveryTask: Delegate
  tusDeliveryProof: Delegate
  tusDeliveryIncident: Delegate
  tusDeliveryAudit: Delegate
  tusDeliveryOutbox: Delegate
  tusPosOperation: Delegate
  tusPosReceipt: Delegate
  tusPosAudit: Delegate
  tusPosDevice: Delegate
  tusPosSession: Delegate
  tusPosConflict: Delegate
  tusPosOutbox: Delegate
  tusPosVersion: Delegate
  $transaction<TValue>(callback: (client: DeliveryPrismaClient) => Promise<TValue>): Promise<TValue>
}

interface Delegate {
  create(input: { data: Row }): Promise<Row>
  update(input: { where: Row; data: Row }): Promise<Row>
  findUnique(input: { where: Row }): Promise<Row | null>
  findMany(input: { where: Row }): Promise<Row[]>
  updateMany(input: { where: Row; data: Row }): Promise<{ count: number }>
}

export class PrismaDeliveryStore implements DeliveryStorePort {
  private readonly client: DeliveryPrismaClient

  constructor(client: object) {
    this.client = client as DeliveryPrismaClient
  }

  readonly zones = {
    save: async (zone: DeliveryZone) => {
      await this.client.tusDeliveryZone.create({ data: { id: zone.zoneId, tenantId: zone.tenantId, zoneId: zone.zoneId, name: zone.name, postalCodes: zone.postalCodes, active: zone.active, createdAt: new Date(), updatedAt: new Date() } })
    },
    find: async (tenantId: string, zoneId: string) => {
      const row = await this.client.tusDeliveryZone.findUnique({ where: { tenantId_zoneId: { tenantId, zoneId } } })
      return row ? mapZone(row) : null
    },
  }

  readonly shifts = {
    save: async (shift: DeliveryShift) => {
      await this.client.tusDeliveryShift.create({ data: { id: shift.shiftId, tenantId: shift.tenantId, shiftId: shift.shiftId, zoneId: shift.zoneId, startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt), operatorIds: shift.operatorIds, status: shift.status, createdAt: new Date(), updatedAt: new Date() } })
    },
    find: async (tenantId: string, shiftId: string) => {
      const row = await this.client.tusDeliveryShift.findUnique({ where: { tenantId_shiftId: { tenantId, shiftId } } })
      return row ? mapShift(row) : null
    },
  }

  readonly tasks = {
    save: async (task: DeliveryTask) => {
      const data = { id: task.taskId, tenantId: task.tenantId, taskId: task.taskId, commitmentId: task.commitmentId, merchantId: task.merchantId, context: task.context, zoneId: task.zoneId, shiftId: task.shiftId, operatorId: task.operatorId, status: task.status, version: task.version, proof: task.proof, incident: task.incident, settlementClaim: task.settlementClaim, createdAt: new Date(task.createdAt), updatedAt: new Date(task.updatedAt) }
      const existing = await this.client.tusDeliveryTask.findUnique({ where: { tenantId_taskId: { tenantId: task.tenantId, taskId: task.taskId } } })
      if (existing) await this.client.tusDeliveryTask.update({ where: { tenantId_taskId: { tenantId: task.tenantId, taskId: task.taskId } }, data })
      else await this.client.tusDeliveryTask.create({ data })
    },
    find: async (tenantId: string, taskId: string) => {
      const row = await this.client.tusDeliveryTask.findUnique({ where: { tenantId_taskId: { tenantId, taskId } } })
      return row ? mapTask(row) : null
    },
    forTenant: async (tenantId: string) => (await this.client.tusDeliveryTask.findMany({ where: { tenantId } })).map(mapTask),
  }

  readonly proofs = {
    save: async (proof: DeliveryProof) => { await this.client.tusDeliveryProof.create({ data: { id: proof.proofId, tenantId: proof.tenantId, proofId: proof.proofId, taskId: proof.taskId, commitmentId: proof.commitmentId, recipientName: proof.recipientName, capturedAt: new Date(proof.capturedAt), evidenceSource: proof.evidenceSource, createdAt: new Date() } }) },
    find: async (tenantId: string, proofId: string) => { const row = await this.client.tusDeliveryProof.findUnique({ where: { tenantId_proofId: { tenantId, proofId } } }); return row ? mapProof(row) : null },
  }

  readonly incidents = {
    save: async (incident: DeliveryIncident) => { await this.client.tusDeliveryIncident.create({ data: { id: incident.incidentId, tenantId: incident.tenantId, incidentId: incident.incidentId, taskId: incident.taskId, reason: incident.reason, status: incident.status, createdAt: new Date(incident.createdAt) } }) },
    find: async (tenantId: string, incidentId: string) => { const row = await this.client.tusDeliveryIncident.findUnique({ where: { tenantId_incidentId: { tenantId, incidentId } } }); return row ? mapIncident(row) : null },
  }

  readonly audit = {
    append: async (record: DeliveryAuditRecord) => { await this.client.tusDeliveryAudit.create({ data: { id: record.auditId, ...record, createdAt: new Date(record.createdAt) } }) },
    list: (_tenantId: string): DeliveryAuditRecord[] => { throw new Error('Tenant-scoped audit listing is exposed through reporting adapters') },
  }

  readonly outbox = {
    append: async (record: DeliveryOutboxRecord) => { await this.client.tusDeliveryOutbox.create({ data: { id: record.eventId, ...record, createdAt: new Date(record.createdAt) } }) },
    list: (_tenantId: string): DeliveryOutboxRecord[] => { throw new Error('Tenant-scoped delivery outbox listing is exposed through reporting adapters') },
  }
  listOutbox(_tenantId: string): DeliveryOutboxRecord[] { throw new Error('Tenant-scoped delivery outbox listing is exposed through reporting adapters') }
}

export class PrismaPosStore implements PosStorePort {
  readonly requiresProvisionedDevice = true
  private readonly client: DeliveryPrismaClient

  constructor(client: object) { this.client = client as DeliveryPrismaClient }

  transaction<TValue>(run: (store: PosStorePort) => Promise<TValue>): Promise<TValue> {
    return this.client.$transaction(async (client) => run(new PrismaPosStore(client)))
  }

  async getIdempotency(tenantId: string, idempotencyKey: string) {
    const row = await this.client.tusPosOperation.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } })
    if (!row?.response) return null
    return { fingerprint: String(row.response['fingerprint']), response: row.response['response'] as PosCommandResult }
  }

  async saveIdempotency(tenantId: string, idempotencyKey: string, value: { fingerprint: string; response: PosCommandResult }): Promise<void> {
    const operationId = value.response.status === 'accepted' ? value.response.operation.operationId : value.response.operationId
    await this.client.tusPosOperation.update({ where: { tenantId_operationId: { tenantId, operationId } }, data: { response: { fingerprint: value.fingerprint, response: value.response } } })
    void idempotencyKey
  }

  async getVersion(tenantId: string, shiftId: string): Promise<number> {
    const row = await this.client.tusPosVersion.findUnique({ where: { tenantId_shiftId: { tenantId, shiftId } } })
    return Number(row?.version ?? 0)
  }

  async incrementVersion(tenantId: string, shiftId: string, expectedVersion?: number): Promise<number> {
    const currentVersion = await this.getVersion(tenantId, shiftId)
    const expected = expectedVersion ?? currentVersion
    if (currentVersion !== expected) throw versionConflictError()
    if (currentVersion === 0) {
      try {
        await this.client.tusPosVersion.create({ data: { id: `${tenantId}:${shiftId}`, tenantId, shiftId, version: 1, createdAt: new Date(), updatedAt: new Date() } })
        return 1
      } catch {
        const refreshedVersion = await this.getVersion(tenantId, shiftId)
        if (refreshedVersion !== expected) throw versionConflictError()
        throw new Error('POS shift version could not be initialized')
      }
    }
    const result = await this.client.tusPosVersion.updateMany({ where: { tenantId, shiftId, version: expected }, data: { version: { increment: 1 }, updatedAt: new Date() } })
    if (result.count !== 1) throw versionConflictError()
    return expected + 1
  }

  async saveOperation(operation: PosManualOperation): Promise<void> {
    await this.client.tusPosOperation.create({ data: { id: operation.operationId, tenantId: operation.tenantId, operationId: operation.operationId, idempotencyKey: operation.idempotencyKey, schemaVersion: operation.schemaVersion, actorId: operation.actorId, deviceId: operation.deviceId, shiftId: operation.shiftId, createdAt: new Date(operation.createdAt), expectedVersion: operation.expectedVersion, kind: operation.kind, context: operation.context, amount: operation.amount, currency: operation.currency, response: null } })
  }

  async saveReceipt(receipt: PosReceipt): Promise<void> { await this.client.tusPosReceipt.create({ data: { id: receipt.receiptId, tenantId: receipt.tenantId, receiptId: receipt.receiptId, operationId: receipt.operationId, kind: receipt.kind, context: receipt.context, amount: receipt.amount, currency: receipt.currency, status: receipt.status, source: receipt.source, providerCapture: receipt.providerCapture, settlement: receipt.settlement, integrityHash: receipt.integrityHash, createdAt: new Date(receipt.createdAt) } }) }
  async listOperations(tenantId: string): Promise<PosManualOperation[]> { return (await this.client.tusPosOperation.findMany({ where: { tenantId } })).map(mapOperation) }
  async listReceipts(tenantId: string): Promise<PosReceipt[]> { return (await this.client.tusPosReceipt.findMany({ where: { tenantId } })).map(mapReceipt) }
  async saveAudit(record: PosAuditRecord): Promise<void> { await this.client.tusPosAudit.create({ data: { id: record.auditId, ...record, createdAt: new Date(record.createdAt) } }) }
  async listAudit(tenantId: string): Promise<PosAuditRecord[]> { return this.listAuditRecords(tenantId) }
  async getDevice(tenantId: string, deviceId: string): Promise<PosDevice | null> { const row = await this.client.tusPosDevice.findUnique({ where: { tenantId_deviceId: { tenantId, deviceId } } }); return row ? mapDevice(row) : null }
  async saveDevice(device: PosDevice): Promise<void> { const data = { id: device.deviceId, tenantId: device.tenantId, deviceId: device.deviceId, label: device.label, fingerprint: device.fingerprint, status: device.status, createdAt: new Date(device.createdAt), updatedAt: new Date(device.updatedAt) }; const existing = await this.client.tusPosDevice.findUnique({ where: { tenantId_deviceId: { tenantId: device.tenantId, deviceId: device.deviceId } } }); if (existing) await this.client.tusPosDevice.update({ where: { tenantId_deviceId: { tenantId: device.tenantId, deviceId: device.deviceId } }, data }); else await this.client.tusPosDevice.create({ data }) }
  async getSession(tenantId: string, sessionId: string): Promise<PosSession | null> { const row = await this.client.tusPosSession.findUnique({ where: { tenantId_sessionId: { tenantId, sessionId } } }); return row ? mapSession(row) : null }
  async findOpenSession(tenantId: string, deviceId: string, shiftId: string, actorId: string): Promise<PosSession | null> { const rows = await this.client.tusPosSession.findMany({ where: { tenantId, deviceId, shiftId, actorId, status: 'open' } }); return rows[0] ? mapSession(rows[0]) : null }
  async saveSession(session: PosSession): Promise<void> { const data = { id: session.sessionId, tenantId: session.tenantId, sessionId: session.sessionId, deviceId: session.deviceId, actorId: session.actorId, shiftId: session.shiftId, status: session.status, openedAt: new Date(session.openedAt), ...(session.closedAt ? { closedAt: new Date(session.closedAt) } : {}) }; const existing = await this.client.tusPosSession.findUnique({ where: { tenantId_sessionId: { tenantId: session.tenantId, sessionId: session.sessionId } } }); if (existing) await this.client.tusPosSession.update({ where: { tenantId_sessionId: { tenantId: session.tenantId, sessionId: session.sessionId } }, data }); else await this.client.tusPosSession.create({ data }) }
  async saveConflict(conflict: PosConflict): Promise<void> { const data = { id: conflict.conflictId, tenantId: conflict.tenantId, conflictId: conflict.conflictId, operationId: conflict.operationId, reason: conflict.reason, expectedVersion: conflict.expectedVersion, actualVersion: conflict.actualVersion, status: conflict.status, createdAt: new Date(conflict.createdAt) }; const existing = await this.client.tusPosConflict.findUnique({ where: { tenantId_conflictId: { tenantId: conflict.tenantId, conflictId: conflict.conflictId } } }); if (existing) await this.client.tusPosConflict.update({ where: { tenantId_conflictId: { tenantId: conflict.tenantId, conflictId: conflict.conflictId } }, data }); else await this.client.tusPosConflict.create({ data }) }
  async listConflicts(tenantId: string): Promise<PosConflict[]> { return (await this.client.tusPosConflict.findMany({ where: { tenantId } })).map(mapConflict) }
  readonly outbox = {
    append: async (record: PosOutboxRecord) => {
      await this.client.tusPosOutbox.create({ data: {
        id: record.eventId,
        tenantId: record.tenantId,
        eventId: record.eventId,
        eventType: record.eventType,
        aggregateId: record.aggregateId,
        payload: record.payload,
        status: record.status,
        attempts: record.attempts,
        availableAt: new Date(record.availableAt ?? record.createdAt),
        lastError: record.lastError ?? null,
        claimId: record.claimId ?? null,
        claimUntil: record.claimUntil ? new Date(record.claimUntil) : null,
        publishedAt: record.publishedAt ? new Date(record.publishedAt) : null,
        createdAt: new Date(record.createdAt),
      } })
    },
    list: async (tenantId: string): Promise<PosOutboxRecord[]> => this.listOutboxRecords(tenantId),
    claim: async (tenantId: string, workerId: string, now: number, leaseMs: number): Promise<PosOutboxRecord | null> => {
      const rows = await this.client.tusPosOutbox.findMany({ where: { tenantId, status: 'pending', availableAt: { lte: new Date(now) } } })
      const row = rows.find((candidate) => candidate['claimUntil'] === null || candidate['claimUntil'] === undefined || new Date(String(candidate['claimUntil'])).getTime() <= now)
      if (!row) return null
      const attempts = Number(row['attempts'] ?? 0) + 1
      const claimId = `${workerId}:${String(row['eventId'] ?? row['id'])}:${attempts}`
      const result = await this.client.tusPosOutbox.updateMany({ where: { id: String(row['id']), tenantId, status: 'pending' }, data: { attempts, claimId, claimUntil: new Date(now + leaseMs) } })
      return result.count === 1 ? fromPrismaPosOutbox(row, { attempts, claimId, claimUntil: new Date(now + leaseMs).toISOString() }) : null
    },
    acknowledge: async ({ tenantId, eventId, claimId, publishedAt }: { tenantId: string; eventId: string; claimId: string; publishedAt: number }): Promise<boolean> => {
      const result = await this.client.tusPosOutbox.updateMany({ where: { id: eventId, tenantId, status: 'pending', claimId }, data: { status: 'published', claimId: null, claimUntil: null, publishedAt: new Date(publishedAt) } })
      return result.count === 1
    },
    recover: async (now: number): Promise<number> => {
      const result = await this.client.tusPosOutbox.updateMany({ where: { status: 'pending', claimUntil: { lte: new Date(now) } }, data: { claimId: null, claimUntil: null, availableAt: new Date(now) } })
      return result.count
    },
  }
  async listOutbox(tenantId: string): Promise<PosOutboxRecord[]> { return this.listOutboxRecords(tenantId) }

  async listAuditRecords(tenantId: string): Promise<PosAuditRecord[]> {
    return (await this.client.tusPosAudit.findMany({ where: { tenantId } })).map(mapAudit)
  }

  async listOutboxRecords(tenantId: string): Promise<PosOutboxRecord[]> {
    return (await this.client.tusPosOutbox.findMany({ where: { tenantId } })).map(mapOutbox)
  }
}

function mapZone(row: Row): DeliveryZone { return { zoneId: row.zoneId, tenantId: row.tenantId, name: row.name, postalCodes: [...row.postalCodes], active: row.active } }
function mapShift(row: Row): DeliveryShift { return { shiftId: row.shiftId, tenantId: row.tenantId, zoneId: row.zoneId, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), operatorIds: [...row.operatorIds], status: row.status } }
function mapTask(row: Row): DeliveryTask { return { contractVersion: '1.0.0', taskId: row.taskId, tenantId: row.tenantId, commitmentId: row.commitmentId, merchantId: row.merchantId, context: 'product', zoneId: row.zoneId, shiftId: row.shiftId, operatorId: row.operatorId, status: row.status, version: row.version, proof: row.proof, incident: row.incident, settlementClaim: 'not-claimed', createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } }
function mapProof(row: Row): DeliveryProof { return { contractVersion: '1.0.0', proofId: row.proofId, tenantId: row.tenantId, taskId: row.taskId, commitmentId: row.commitmentId, recipientName: row.recipientName, capturedAt: row.capturedAt.toISOString(), evidenceSource: row.evidenceSource } }
function mapIncident(row: Row): DeliveryIncident { return { contractVersion: '1.0.0', incidentId: row.incidentId, tenantId: row.tenantId, taskId: row.taskId, reason: row.reason, status: row.status, createdAt: row.createdAt.toISOString() } }
function mapOperation(row: Row): PosManualOperation { const operation = { ...row }; delete operation.response; return { contractVersion: '1.0.0', ...operation, createdAt: row.createdAt.toISOString() } as PosManualOperation }
function mapReceipt(row: Row): PosReceipt { return { contractVersion: '1.0.0', ...row, createdAt: row.createdAt.toISOString() } as PosReceipt }
function mapDevice(row: Row): PosDevice { return { contractVersion: '1.0.0', deviceId: row.deviceId, tenantId: row.tenantId, label: row.label, fingerprint: row.fingerprint, status: row.status, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } }
function mapSession(row: Row): PosSession { return { contractVersion: '1.0.0', sessionId: row.sessionId, tenantId: row.tenantId, deviceId: row.deviceId, actorId: row.actorId, shiftId: row.shiftId, status: row.status, openedAt: row.openedAt.toISOString(), ...(row.closedAt ? { closedAt: row.closedAt.toISOString() } : {}) } }
function mapConflict(row: Row): PosConflict { return { contractVersion: '1.0.0', conflictId: row.conflictId, tenantId: row.tenantId, operationId: row.operationId, reason: row.reason, ...(row.expectedVersion === null ? {} : { expectedVersion: row.expectedVersion }), ...(row.actualVersion === null ? {} : { actualVersion: row.actualVersion }), status: row.status, createdAt: row.createdAt.toISOString() } }
function mapAudit(row: Row): PosAuditRecord { return { auditId: row.auditId, tenantId: row.tenantId, actorId: row.actorId, correlationId: row.correlationId, action: row.action, operationId: row.operationId, outcome: row.outcome, createdAt: row.createdAt.toISOString() } }
function mapOutbox(row: Row): PosOutboxRecord { return fromPrismaPosOutbox(row) }

function fromPrismaPosOutbox(row: Row, overrides: Partial<PosOutboxRecord> = {}): PosOutboxRecord {
  return {
    eventId: String(row.eventId ?? row.id),
    tenantId: String(row.tenantId),
    eventType: String(row.eventType),
    aggregateId: String(row.aggregateId),
    payload: row.payload as Record<string, unknown>,
    status: row.status as PosOutboxRecord['status'],
    attempts: Number(row.attempts ?? 0),
    availableAt: new Date(String(row.availableAt ?? row.createdAt)).toISOString(),
    lastError: row.lastError === null || row.lastError === undefined ? null : String(row.lastError),
    claimId: row.claimId === null || row.claimId === undefined ? null : String(row.claimId),
    claimUntil: row.claimUntil ? new Date(String(row.claimUntil)).toISOString() : null,
    publishedAt: row.publishedAt ? new Date(String(row.publishedAt)).toISOString() : null,
    createdAt: new Date(String(row.createdAt)).toISOString(),
    ...overrides,
  }
}

function versionConflictError(): PosError {
  return new PosError(409, 'VERSION_CONFLICT', 'POS shift version differs from the offline expectation')
}
