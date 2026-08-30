import { createHash } from 'node:crypto'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import type { TusReadinessGuard, TusReadinessProfile } from '../readiness/index.ts'

export type PosOperationKind = 'manual-sale' | 'manual-service'
export type PosOperationContext = 'product' | 'service'

export interface PosManualOperation {
  contractVersion?: '1.0.0'
  operationId: string
  idempotencyKey: string
  schemaVersion: string
  tenantId: string
  actorId: string
  deviceId: string
  shiftId: string
  createdAt: string
  expectedVersion?: number
  kind: PosOperationKind
  context: PosOperationContext
  amount: number
  currency: string
}

export interface PosReceipt {
  contractVersion?: '1.0.0'
  receiptId: string
  tenantId: string
  operationId: string
  kind: PosOperationKind
  context: PosOperationContext
  amount: number
  currency: string
  status: 'pending' | 'accepted'
  source: 'authorized' | 'deterministic-test-only'
  providerCapture: 'not-claimed'
  settlement: 'not-claimed'
  integrityHash: string
  createdAt: string
}

export interface PosDevice {
  contractVersion?: '1.0.0'
  deviceId: string
  tenantId: string
  label: string
  fingerprint: string
  status: 'active' | 'revoked'
  createdAt: string
  updatedAt: string
}

export interface PosSession {
  contractVersion?: '1.0.0'
  sessionId: string
  tenantId: string
  deviceId: string
  actorId: string
  shiftId: string
  status: 'open' | 'closed'
  openedAt: string
  closedAt?: string
}

export interface PosConflict {
  contractVersion?: '1.0.0'
  conflictId: string
  tenantId: string
  operationId: string
  reason: 'idempotency_conflict' | 'version_conflict' | 'uncertain_sync'
  expectedVersion?: number
  actualVersion?: number
  status: 'open' | 'resolved' | 'discarded'
  createdAt: string
}

export interface PosOutboxRecord {
  eventId: string
  tenantId: string
  eventType: string
  aggregateId: string
  payload: Record<string, unknown>
  status: 'pending' | 'published' | 'dead-letter'
  attempts: number
  createdAt: string
}

export interface PosAuditRecord {
  auditId: string
  tenantId: string
  actorId: string
  correlationId: string
  action: string
  operationId: string
  outcome: 'allowed' | 'denied'
  createdAt: string
}

export type PosCommandResult = { status: 'accepted'; operation: PosManualOperation; receipt: PosReceipt } | { status: 'conflict'; operationId: string; reason: 'idempotency_conflict' | 'version_conflict' }

export interface PosStorePort {
  readonly requiresProvisionedDevice?: boolean
  transaction<TValue>(run: (store: PosStorePort) => Promise<TValue>): Promise<TValue>
  getIdempotency(tenantId: string, key: string): MaybePromise<{ fingerprint: string; response: PosCommandResult } | null>
  saveIdempotency(tenantId: string, key: string, value: { fingerprint: string; response: PosCommandResult }): MaybePromise<void>
  getVersion(tenantId: string, shiftId: string): MaybePromise<number>
  incrementVersion(tenantId: string, shiftId: string, expectedVersion?: number): MaybePromise<number>
  saveOperation(operation: PosManualOperation): MaybePromise<void>
  saveReceipt(receipt: PosReceipt): MaybePromise<void>
  listOperations(tenantId: string): MaybePromise<PosManualOperation[]>
  listReceipts(tenantId: string): MaybePromise<PosReceipt[]>
  saveAudit(record: PosAuditRecord): MaybePromise<void>
  listAudit(tenantId: string): MaybePromise<PosAuditRecord[]>
  getDevice(tenantId: string, deviceId: string): MaybePromise<PosDevice | null>
  saveDevice(device: PosDevice): MaybePromise<void>
  getSession(tenantId: string, sessionId: string): MaybePromise<PosSession | null>
  findOpenSession(tenantId: string, deviceId: string, shiftId: string, actorId: string): MaybePromise<PosSession | null>
  saveSession(session: PosSession): MaybePromise<void>
  saveConflict(conflict: PosConflict): MaybePromise<void>
  listConflicts(tenantId: string): MaybePromise<PosConflict[]>
  outbox: { append(record: PosOutboxRecord): MaybePromise<void>; list(tenantId: string): MaybePromise<PosOutboxRecord[]> }
  listOutbox(tenantId: string): MaybePromise<PosOutboxRecord[]>
}

export class PosError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'PosError'
    this.status = status
    this.code = code
  }
}

export class InMemoryPosStore implements PosStorePort {
  private readonly idempotency = new Map<string, { fingerprint: string; response: PosCommandResult }>()
  private readonly versions = new Map<string, number>()
  private readonly operations = new Map<string, PosManualOperation>()
  private readonly receipts = new Map<string, PosReceipt>()
  private readonly audits = new Map<string, PosAuditRecord>()
  private readonly devices = new Map<string, PosDevice>()
  private readonly sessions = new Map<string, PosSession>()
  private readonly conflicts = new Map<string, PosConflict>()
  private readonly outboxRecords = new Map<string, PosOutboxRecord>()
  private transactionTail: Promise<void> = Promise.resolve()

  async transaction<TValue>(run: (store: PosStorePort) => Promise<TValue>): Promise<TValue> {
    const previous = this.transactionTail
    let release!: () => void
    this.transactionTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    const snapshot = this.snapshot()
    try {
      return await run(this)
    } catch (error) {
      this.restore(snapshot)
      throw error
    } finally {
      release()
    }
  }

  getIdempotency(tenantId: string, idempotencyKey: string) { return clone(this.idempotency.get(key(tenantId, idempotencyKey)) ?? null) }
  saveIdempotency(tenantId: string, idempotencyKey: string, value: { fingerprint: string; response: PosCommandResult }) { this.idempotency.set(key(tenantId, idempotencyKey), clone(value)) }
  getVersion(tenantId: string, shiftId: string) { return this.versions.get(key(tenantId, shiftId)) ?? 0 }
  incrementVersion(tenantId: string, shiftId: string, expectedVersion = this.getVersion(tenantId, shiftId)) {
    const currentVersion = this.getVersion(tenantId, shiftId)
    if (currentVersion !== expectedVersion) throw new PosError(409, 'VERSION_CONFLICT', 'POS shift version differs from the offline expectation')
    const version = currentVersion + 1
    this.versions.set(key(tenantId, shiftId), version)
    return version
  }
  saveOperation(operation: PosManualOperation) { this.operations.set(key(operation.tenantId, operation.operationId), clone(operation)) }
  saveReceipt(receipt: PosReceipt) { this.receipts.set(key(receipt.tenantId, receipt.receiptId), clone(receipt)) }
  listOperations(tenantId: string) { return [...this.operations.values()].filter((operation) => operation.tenantId === tenantId).map(clone) }
  listReceipts(tenantId: string) { return [...this.receipts.values()].filter((receipt) => receipt.tenantId === tenantId).map(clone) }
  saveAudit(record: PosAuditRecord) { this.audits.set(record.auditId, clone(record)) }
  listAudit(tenantId: string) { return [...this.audits.values()].filter((record) => record.tenantId === tenantId).map(clone) }
  getDevice(tenantId: string, deviceId: string) { return clone(this.devices.get(key(tenantId, deviceId)) ?? null) }
  saveDevice(device: PosDevice) { this.devices.set(key(device.tenantId, device.deviceId), clone(device)) }
  getSession(tenantId: string, sessionId: string) { return clone(this.sessions.get(key(tenantId, sessionId)) ?? null) }
  findOpenSession(tenantId: string, deviceId: string, shiftId: string, actorId: string) { return clone([...this.sessions.values()].find((session) => session.tenantId === tenantId && session.deviceId === deviceId && session.shiftId === shiftId && session.actorId === actorId && session.status === 'open') ?? null) }
  saveSession(session: PosSession) { this.sessions.set(key(session.tenantId, session.sessionId), clone(session)) }
  saveConflict(conflict: PosConflict) { this.conflicts.set(key(conflict.tenantId, conflict.conflictId), clone(conflict)) }
  listConflicts(tenantId: string) { return [...this.conflicts.values()].filter((conflict) => conflict.tenantId === tenantId).map(clone) }
  readonly outbox = {
    append: (record: PosOutboxRecord) => { this.outboxRecords.set(key(record.tenantId, record.eventId), clone(record)) },
    list: (tenantId: string) => [...this.outboxRecords.values()].filter((record) => record.tenantId === tenantId).map(clone),
  }
  listOutbox(tenantId: string) { return this.outbox.list(tenantId) }

  private snapshot() {
    return {
      idempotency: new Map([...this.idempotency.entries()].map(([entryKey, value]) => [entryKey, clone(value)])),
      versions: new Map(this.versions),
      operations: new Map([...this.operations.entries()].map(([entryKey, value]) => [entryKey, clone(value)])),
      receipts: new Map([...this.receipts.entries()].map(([entryKey, value]) => [entryKey, clone(value)])),
      audits: new Map([...this.audits.entries()].map(([entryKey, value]) => [entryKey, clone(value)])),
      devices: new Map([...this.devices.entries()].map(([entryKey, value]) => [entryKey, clone(value)])),
      sessions: new Map([...this.sessions.entries()].map(([entryKey, value]) => [entryKey, clone(value)])),
      conflicts: new Map([...this.conflicts.entries()].map(([entryKey, value]) => [entryKey, clone(value)])),
      outboxRecords: new Map([...this.outboxRecords.entries()].map(([entryKey, value]) => [entryKey, clone(value)])),
    }
  }

  private restore(snapshot: ReturnType<InMemoryPosStore['snapshot']>): void {
    this.idempotency.clear()
    for (const [entryKey, value] of snapshot.idempotency) this.idempotency.set(entryKey, value)
    this.versions.clear()
    for (const [entryKey, value] of snapshot.versions) this.versions.set(entryKey, value)
    this.operations.clear()
    for (const [entryKey, value] of snapshot.operations) this.operations.set(entryKey, value)
    this.receipts.clear()
    for (const [entryKey, value] of snapshot.receipts) this.receipts.set(entryKey, value)
    this.audits.clear()
    for (const [entryKey, value] of snapshot.audits) this.audits.set(entryKey, value)
    this.devices.clear()
    for (const [entryKey, value] of snapshot.devices) this.devices.set(entryKey, value)
    this.sessions.clear()
    for (const [entryKey, value] of snapshot.sessions) this.sessions.set(entryKey, value)
    this.conflicts.clear()
    for (const [entryKey, value] of snapshot.conflicts) this.conflicts.set(entryKey, value)
    this.outboxRecords.clear()
    for (const [entryKey, value] of snapshot.outboxRecords) this.outboxRecords.set(entryKey, value)
  }
}

export class TusPosService {
  readonly store: PosStorePort
  readonly audit: { list(tenantId: string): MaybePromise<PosAuditRecord[]> }
  private readonly now: () => number
  private readonly readinessGuard?: TusReadinessGuard
  private readonly readinessProfile: TusReadinessProfile
  private readonly readinessScope: string

  constructor(options: { store: PosStorePort; now?: () => number; readinessGuard?: TusReadinessGuard; readinessProfile?: TusReadinessProfile; readinessScope?: string }) {
    this.store = options.store
    this.audit = { list: (tenantId) => options.store.listAudit(tenantId) }
    this.now = options.now ?? (() => Date.now())
    this.readinessGuard = options.readinessGuard
    this.readinessProfile = options.readinessProfile ?? 'native-local'
    this.readinessScope = options.readinessScope ?? 'argentina-stage-1'
  }

  async registerDevice(context: TusAuthenticatedTenantContext, input: { deviceId: string; label: string; fingerprint: string }): Promise<PosDevice> {
    this.authorize(context)
    await this.requireReadiness(context)
    if (!input.deviceId.trim() || !input.label.trim() || !input.fingerprint.trim()) throw new PosError(400, 'INVALID_DEVICE', 'device id, label, and fingerprint are required')
    const now = new Date(this.now()).toISOString()
    const device: PosDevice = { contractVersion: '1.0.0', deviceId: input.deviceId, tenantId: context.tenantId, label: input.label.trim(), fingerprint: input.fingerprint, status: 'active', createdAt: now, updatedAt: now }
    return this.store.transaction(async (store) => {
      await store.saveDevice(device)
      await this.recordAudit(context, 'pos.device.registered', device.deviceId, 'allowed', store)
      await this.recordOutbox(context, 'pos.device.registered', device.deviceId, device, store)
      return clone(device)
    })
  }

  async revokeDevice(context: TusAuthenticatedTenantContext, deviceId: string): Promise<PosDevice> {
    this.authorize(context)
    await this.requireReadiness(context)
    const device = await this.store.getDevice(context.tenantId, deviceId)
    if (!device) throw new PosError(404, 'NOT_FOUND', 'POS device was not found')
    const revoked = { ...device, status: 'revoked' as const, updatedAt: new Date(this.now()).toISOString() }
    return this.store.transaction(async (store) => {
      await store.saveDevice(revoked)
      await this.recordAudit(context, 'pos.device.revoked', deviceId, 'allowed', store)
      await this.recordOutbox(context, 'pos.device.revoked', deviceId, revoked, store)
      return revoked
    })
  }

  async openSession(context: TusAuthenticatedTenantContext, input: { sessionId: string; deviceId: string; shiftId: string }): Promise<PosSession> {
    this.authorize(context)
    await this.requireReadiness(context)
    if (!input.sessionId.trim() || !input.deviceId.trim() || !input.shiftId.trim()) throw new PosError(400, 'INVALID_SESSION', 'session, device, and shift are required')
    const device = await this.store.getDevice(context.tenantId, input.deviceId)
    if (!device || device.status !== 'active') throw new PosError(409, 'DEVICE_UNAVAILABLE', 'POS device is not active')
    const session: PosSession = { contractVersion: '1.0.0', sessionId: input.sessionId, tenantId: context.tenantId, deviceId: input.deviceId, actorId: context.subjectId, shiftId: input.shiftId, status: 'open', openedAt: new Date(this.now()).toISOString() }
    return this.store.transaction(async (store) => {
      await store.saveSession(session)
      await this.recordAudit(context, 'pos.session.opened', session.sessionId, 'allowed', store)
      await this.recordOutbox(context, 'pos.session.opened', session.sessionId, session, store)
      return clone(session)
    })
  }

  async closeSession(context: TusAuthenticatedTenantContext, sessionId: string): Promise<PosSession> {
    this.authorize(context)
    await this.requireReadiness(context)
    const session = await this.store.getSession(context.tenantId, sessionId)
    if (!session || session.actorId !== context.subjectId) throw new PosError(404, 'NOT_FOUND', 'POS session was not found')
    if (session.status === 'closed') return session
    const closed = { ...session, status: 'closed' as const, closedAt: new Date(this.now()).toISOString() }
    return this.store.transaction(async (store) => {
      await store.saveSession(closed)
      await this.recordAudit(context, 'pos.session.closed', sessionId, 'allowed', store)
      await this.recordOutbox(context, 'pos.session.closed', sessionId, closed, store)
      return closed
    })
  }

  async recordManualOperation(context: TusAuthenticatedTenantContext, input: Omit<PosManualOperation, 'tenantId' | 'actorId'> & Partial<Pick<PosManualOperation, 'tenantId' | 'actorId'>>): Promise<PosCommandResult> {
    this.authorize(context)
    await this.requireReadiness(context)
    if ((input.tenantId !== undefined && input.tenantId !== context.tenantId) || (input.actorId !== undefined && input.actorId !== context.subjectId)) {
      await this.recordAudit(context, 'pos.operation.denied', input.operationId, 'denied')
      throw new PosError(403, 'FORBIDDEN', 'POS authority fields do not match the authenticated session')
    }
    const operation: PosManualOperation = { contractVersion: '1.0.0', ...input, tenantId: context.tenantId, actorId: context.subjectId }
    validateOperation(operation)
    const device = await this.store.getDevice(context.tenantId, operation.deviceId)
    if (!device && this.store.requiresProvisionedDevice) {
      throw new PosError(409, 'DEVICE_UNAVAILABLE', 'POS device is not registered for the authenticated tenant')
    }
    if (device) {
      if (device.status !== 'active') throw new PosError(409, 'DEVICE_UNAVAILABLE', 'POS device is not active')
      const session = await this.store.findOpenSession(context.tenantId, operation.deviceId, operation.shiftId, context.subjectId)
      if (!session) throw new PosError(409, 'SESSION_REQUIRED', 'an open POS session is required for this device and shift')
    }
    const fingerprint = fingerprintFor(operation)
    return this.store.transaction(async (transactionStore) => {
      const existing = await transactionStore.getIdempotency(context.tenantId, operation.idempotencyKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          await this.recordAudit(context, 'pos.operation.conflict', operation.operationId, 'denied', transactionStore)
          await this.recordConflict(context, operation, 'idempotency_conflict', undefined, transactionStore)
          return { status: 'conflict', operationId: operation.operationId, reason: 'idempotency_conflict' }
        }
        return clone(existing.response)
      }
      const currentVersion = await transactionStore.getVersion(context.tenantId, operation.shiftId)
      if (operation.expectedVersion !== undefined && operation.expectedVersion !== currentVersion) {
        await this.recordAudit(context, 'pos.operation.conflict', operation.operationId, 'denied', transactionStore)
        await this.recordConflict(context, operation, 'version_conflict', currentVersion, transactionStore)
        return { status: 'conflict', operationId: operation.operationId, reason: 'version_conflict' }
      }
      const receipt: PosReceipt = { contractVersion: '1.0.0', receiptId: `receipt-${operation.operationId}`, tenantId: context.tenantId, operationId: operation.operationId, kind: operation.kind, context: operation.context, amount: operation.amount, currency: operation.currency, status: 'accepted', source: 'deterministic-test-only', providerCapture: 'not-claimed', settlement: 'not-claimed', integrityHash: '', createdAt: new Date(this.now()).toISOString() }
      receipt.integrityHash = receiptIntegrityHash(receipt)
      const response: PosCommandResult = { status: 'accepted', operation, receipt }
      await transactionStore.saveOperation(operation)
      await transactionStore.saveReceipt(receipt)
      await transactionStore.incrementVersion(context.tenantId, operation.shiftId, currentVersion)
      await transactionStore.saveIdempotency(context.tenantId, operation.idempotencyKey, { fingerprint, response })
      await this.recordAudit(context, 'pos.operation.accepted', operation.operationId, 'allowed', transactionStore)
      await this.recordOutbox(context, 'pos.operation.accepted', operation.operationId, response, transactionStore)
      return clone(response)
    })
  }

  async resolveConflict(context: TusAuthenticatedTenantContext, conflictId: string, resolution: 'discard' | 'retry'): Promise<PosConflict> {
    this.authorize(context)
    await this.requireReadiness(context)
    return this.store.transaction(async (transactionStore) => {
      const conflict = (await transactionStore.listConflicts(context.tenantId)).find((item) => item.conflictId === conflictId)
      if (!conflict) throw new PosError(404, 'NOT_FOUND', 'POS conflict was not found')
      const resolved = { ...conflict, status: resolution === 'discard' ? 'discarded' as const : 'resolved' as const }
      await transactionStore.saveConflict(resolved)
      await this.recordAudit(context, `pos.conflict.${resolved.status}`, conflict.operationId, 'allowed', transactionStore)
      await this.recordOutbox(context, `pos.conflict.${resolved.status}`, conflict.operationId, resolved, transactionStore)
      return clone(resolved)
    })
  }

  private async recordAudit(context: TusAuthenticatedTenantContext, action: string, operationId: string, outcome: PosAuditRecord['outcome'], store = this.store): Promise<void> {
    await store.saveAudit({ auditId: `${action}-${operationId}-${this.now()}`, tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, action, operationId, outcome, createdAt: new Date(this.now()).toISOString() })
  }

  private requireReadiness(context: TusAuthenticatedTenantContext): Promise<unknown> {
    return this.readinessGuard?.require({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, capability: 'fleet', profile: this.readinessProfile, scope: this.readinessScope }) ?? Promise.resolve()
  }

  private async recordConflict(context: TusAuthenticatedTenantContext, operation: PosManualOperation, reason: PosConflict['reason'], actualVersion?: number, store = this.store): Promise<void> {
    const conflict: PosConflict = { contractVersion: '1.0.0', conflictId: `conflict-${operation.operationId}-${this.now()}`, tenantId: context.tenantId, operationId: operation.operationId, reason, ...(operation.expectedVersion !== undefined ? { expectedVersion: operation.expectedVersion } : {}), ...(actualVersion !== undefined ? { actualVersion } : {}), status: 'open', createdAt: new Date(this.now()).toISOString() }
    await store.saveConflict(conflict)
    await this.recordOutbox(context, 'pos.conflict.opened', operation.operationId, conflict, store)
  }

  private async recordOutbox(context: TusAuthenticatedTenantContext, eventType: string, aggregateId: string, payload: unknown, store = this.store): Promise<void> {
    await store.outbox.append({ eventId: `${eventType}-${aggregateId}-${this.now()}`, tenantId: context.tenantId, eventType, aggregateId, payload: structuredClone(payload) as Record<string, unknown>, status: 'pending', attempts: 0, createdAt: new Date(this.now()).toISOString() })
  }

  private authorize(context: TusAuthenticatedTenantContext): void {
    if (!context.tenantId.trim() || !context.subjectId.trim() || !context.correlationId.trim() || (!context.permissions.includes('tus:pos:write') && !context.permissions.includes('tus:*'))) throw new PosError(403, 'FORBIDDEN', 'TUS POS operation is not authorized')
  }
}

function validateOperation(operation: PosManualOperation): void {
  if (!operation.operationId.trim() || !operation.idempotencyKey.trim() || !operation.schemaVersion.trim() || !operation.deviceId.trim() || !operation.shiftId.trim() || !operation.currency.trim() || !Number.isFinite(Date.parse(operation.createdAt)) || !Number.isFinite(operation.amount) || operation.amount < 0) throw new PosError(400, 'INVALID', 'POS operation metadata and amount are required')
  if ((operation.kind === 'manual-sale' && operation.context !== 'product') || (operation.kind === 'manual-service' && operation.context !== 'service')) throw new PosError(400, 'CONTEXT_MISMATCH', 'product sales and service captures use separate POS lifecycles')
  if (operation.expectedVersion !== undefined && (!Number.isInteger(operation.expectedVersion) || operation.expectedVersion < 0)) throw new PosError(400, 'INVALID', 'expectedVersion must be a non-negative integer')
}

function fingerprintFor(operation: PosManualOperation): string {
  return createHash('sha256').update(JSON.stringify(operation)).digest('hex')
}

export function verifyPosReceipt(receipt: PosReceipt): boolean {
  return receipt.providerCapture === 'not-claimed' && receipt.settlement === 'not-claimed' && receipt.integrityHash === receiptIntegrityHash(receipt)
}

function receiptIntegrityHash(receipt: PosReceipt): string {
  const { integrityHash: _integrityHash, ...unsigned } = receipt
  return createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')
}

function key(tenantId: string, id: string): string { return `${tenantId}:${id}` }
function clone<T>(value: T): T { return value === null ? value : structuredClone(value) }
type MaybePromise<T> = T | Promise<T>

export default { InMemoryPosStore, PosError, TusPosService, verifyPosReceipt }
