import { createHash } from 'node:crypto'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import type { EvaluadorHabilitacion, PerfilHabilitacion } from '../readiness/index.ts'

export type PosOperationKind = 'manual-sale' | 'manual-service'
export type PosOperationContext = 'product' | 'service'

const POS_PAYMENT_METHOD = {
  CASH: 'cash',
  OTHER: 'other',
} as const

type PosPaymentMethod = (typeof POS_PAYMENT_METHOD)[keyof typeof POS_PAYMENT_METHOD]

const POS_OPERATION_STATUS = {
  ACCEPTED: 'accepted',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  NOT_FOUND: 'not_found',
} as const

type PosOperationStatus = (typeof POS_OPERATION_STATUS)[keyof typeof POS_OPERATION_STATUS]

const POS_COMPENSATION_KIND = {
  REFUND: 'refund',
  CANCELLATION: 'cancellation',
} as const

type PosCompensationKind = (typeof POS_COMPENSATION_KIND)[keyof typeof POS_COMPENSATION_KIND]

const POS_PRINTER_FAILURE_STATUS = {
  RETRYABLE: 'retryable',
  QUARANTINED: 'quarantined',
} as const

type PosPrinterFailureStatus = (typeof POS_PRINTER_FAILURE_STATUS)[keyof typeof POS_PRINTER_FAILURE_STATUS]

export interface PosLineSnapshot {
  lineId: string
  name: string
  context: PosOperationContext
  quantity: number
  unitAmount: number
  totalAmount: number
}

export interface PosCashTotals {
  openingFloat: number
  sales: number
  refunds: number
  cashIn: number
  cashOut: number
  expectedCash: number
}

export interface PosShift {
  shiftId: string
  tenantId: string
  status: 'open' | 'closed'
  version: number
  totals: PosCashTotals
  reconciliation?: { expectedCash: number; countedCash: number; variance: number }
  openedAt: string
  closedAt?: string
}

export interface CompensacionPuntoVenta {
  compensationId: string
  tenantId: string
  actorId: string
  originalOperationId: string
  idempotencyKey: string
  kind: PosCompensationKind
  amount: number
  currency: string
  reason: string
  status: 'accepted'
  createdAt: string
}

export interface PosPrinterFailure {
  failureId: string
  tenantId: string
  operationId: string
  reason: string
  status: PosPrinterFailureStatus
  createdAt: string
}

export interface OperacionManualPuntoVenta {
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
  paymentMethod?: PosPaymentMethod
  lines?: PosLineSnapshot[]
}

export interface ComprobantePuntoVenta {
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
  snapshot?: {
    operationId: string
    amount: number
    currency: string
    lines: PosLineSnapshot[]
  }
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

export interface SesionPuntoVenta {
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

export interface ConflictoPuntoVenta {
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
  availableAt?: string
  lastError?: string | null
  claimId?: string | null
  claimUntil?: string | null
  publishedAt?: string | null
}

export interface RegistroAuditoriaPOS {
  auditId: string
  tenantId: string
  actorId: string
  correlationId: string
  action: string
  operationId: string
  outcome: 'allowed' | 'denied'
  createdAt: string
}

export type PosCommandResult = { status: 'accepted'; operation: OperacionManualPuntoVenta; receipt: ComprobantePuntoVenta } | { status: 'conflict'; operationId: string; reason: 'idempotency_conflict' | 'version_conflict' }

export interface PosStorePort {
  readonly requiresProvisionedDevice?: boolean
  transaction<TValue>(run: (store: PosStorePort) => Promise<TValue>): Promise<TValue>
  getIdempotency(tenantId: string, key: string): MaybePromise<{ fingerprint: string; response: PosCommandResult } | null>
  saveIdempotency(tenantId: string, key: string, value: { fingerprint: string; response: PosCommandResult }): MaybePromise<void>
  getVersion(tenantId: string, shiftId: string): MaybePromise<number>
  incrementVersion(tenantId: string, shiftId: string, expectedVersion?: number): MaybePromise<number>
  saveOperation(operation: OperacionManualPuntoVenta): MaybePromise<void>
  saveReceipt(receipt: ComprobantePuntoVenta): MaybePromise<void>
  listOperations(tenantId: string): MaybePromise<OperacionManualPuntoVenta[]>
  listReceipts(tenantId: string): MaybePromise<ComprobantePuntoVenta[]>
  saveAudit(record: RegistroAuditoriaPOS): MaybePromise<void>
  listAudit(tenantId: string): MaybePromise<RegistroAuditoriaPOS[]>
  getDevice(tenantId: string, deviceId: string): MaybePromise<PosDevice | null>
  saveDevice(device: PosDevice): MaybePromise<void>
  getSession(tenantId: string, sessionId: string): MaybePromise<SesionPuntoVenta | null>
  findOpenSession(tenantId: string, deviceId: string, shiftId: string, actorId: string): MaybePromise<SesionPuntoVenta | null>
  saveSession(session: SesionPuntoVenta): MaybePromise<void>
  saveConflict(conflict: ConflictoPuntoVenta): MaybePromise<void>
  listConflicts(tenantId: string): MaybePromise<ConflictoPuntoVenta[]>
  getShift?(tenantId: string, shiftId: string): MaybePromise<PosShift | null>
  saveShift?(shift: PosShift): MaybePromise<void>
  saveCompensation?(compensation: CompensacionPuntoVenta): MaybePromise<void>
  listCompensations?(tenantId: string): MaybePromise<CompensacionPuntoVenta[]>
  savePrinterFailure?(failure: PosPrinterFailure): MaybePromise<void>
  listPrinterFailures?(tenantId: string): MaybePromise<PosPrinterFailure[]>
  outbox: {
    append(record: PosOutboxRecord): MaybePromise<void>
    list(tenantId: string): MaybePromise<PosOutboxRecord[]>
    claim?(tenantId: string, workerId: string, now: number, leaseMs: number): MaybePromise<PosOutboxRecord | null>
    acknowledge?(input: { tenantId: string; eventId: string; claimId: string; publishedAt: number }): MaybePromise<boolean>
    recover?(now: number): MaybePromise<number>
  }
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
  private readonly operations = new Map<string, OperacionManualPuntoVenta>()
  private readonly receipts = new Map<string, ComprobantePuntoVenta>()
  private readonly audits = new Map<string, RegistroAuditoriaPOS>()
  private readonly devices = new Map<string, PosDevice>()
  private readonly sessions = new Map<string, SesionPuntoVenta>()
  private readonly conflicts = new Map<string, ConflictoPuntoVenta>()
  private readonly shifts = new Map<string, PosShift>()
  private readonly compensations = new Map<string, CompensacionPuntoVenta>()
  private readonly printerFailures = new Map<string, PosPrinterFailure>()
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
  saveOperation(operation: OperacionManualPuntoVenta) { this.operations.set(key(operation.tenantId, operation.operationId), clone(operation)) }
  saveReceipt(receipt: ComprobantePuntoVenta) { this.receipts.set(key(receipt.tenantId, receipt.receiptId), clone(receipt)) }
  listOperations(tenantId: string) { return [...this.operations.values()].filter((operation) => operation.tenantId === tenantId).map(clone) }
  listReceipts(tenantId: string) { return [...this.receipts.values()].filter((receipt) => receipt.tenantId === tenantId).map(clone) }
  saveAudit(record: RegistroAuditoriaPOS) { this.audits.set(record.auditId, clone(record)) }
  listAudit(tenantId: string) { return [...this.audits.values()].filter((record) => record.tenantId === tenantId).map(clone) }
  getDevice(tenantId: string, deviceId: string) { return clone(this.devices.get(key(tenantId, deviceId)) ?? null) }
  saveDevice(device: PosDevice) { this.devices.set(key(device.tenantId, device.deviceId), clone(device)) }
  getSession(tenantId: string, sessionId: string) { return clone(this.sessions.get(key(tenantId, sessionId)) ?? null) }
  findOpenSession(tenantId: string, deviceId: string, shiftId: string, actorId: string) { return clone([...this.sessions.values()].find((session) => session.tenantId === tenantId && session.deviceId === deviceId && session.shiftId === shiftId && session.actorId === actorId && session.status === 'open') ?? null) }
  saveSession(session: SesionPuntoVenta) { this.sessions.set(key(session.tenantId, session.sessionId), clone(session)) }
  saveConflict(conflict: ConflictoPuntoVenta) { this.conflicts.set(key(conflict.tenantId, conflict.conflictId), clone(conflict)) }
  listConflicts(tenantId: string) { return [...this.conflicts.values()].filter((conflict) => conflict.tenantId === tenantId).map(clone) }
  getShift(tenantId: string, shiftId: string) { return clone(this.shifts.get(key(tenantId, shiftId)) ?? null) }
  saveShift(shift: PosShift) { this.shifts.set(key(shift.tenantId, shift.shiftId), clone(shift)) }
  saveCompensation(compensation: CompensacionPuntoVenta) { this.compensations.set(key(compensation.tenantId, compensation.compensationId), clone(compensation)) }
  listCompensations(tenantId: string) { return [...this.compensations.values()].filter((compensation) => compensation.tenantId === tenantId).map(clone) }
  savePrinterFailure(failure: PosPrinterFailure) { this.printerFailures.set(key(failure.tenantId, failure.failureId), clone(failure)) }
  listPrinterFailures(tenantId: string) { return [...this.printerFailures.values()].filter((failure) => failure.tenantId === tenantId).map(clone) }
  readonly outbox = {
    append: (record: PosOutboxRecord) => { this.outboxRecords.set(key(record.tenantId, record.eventId), clone(record)) },
    list: (tenantId: string) => [...this.outboxRecords.values()].filter((record) => record.tenantId === tenantId).map(clone),
    claim: (tenantId: string, workerId: string, now: number, leaseMs: number) => {
      const candidate = [...this.outboxRecords.values()].find((record) => record.tenantId === tenantId
        && record.status === 'pending'
        && (record.availableAt === undefined || Date.parse(record.availableAt) <= now)
        && (record.claimUntil === undefined || record.claimUntil === null || Date.parse(record.claimUntil) <= now))
      if (!candidate) return null
      const claimed: PosOutboxRecord = {
        ...candidate,
        status: 'pending',
        attempts: candidate.attempts + 1,
        claimId: `${workerId}:${candidate.eventId}:${candidate.attempts + 1}`,
        claimUntil: new Date(now + leaseMs).toISOString(),
      }
      this.outboxRecords.set(key(tenantId, candidate.eventId), clone(claimed))
      return clone(claimed)
    },
    acknowledge: ({ tenantId, eventId, claimId, publishedAt }: { tenantId: string; eventId: string; claimId: string; publishedAt: number }) => {
      const existing = this.outboxRecords.get(key(tenantId, eventId))
      if (!existing || existing.claimId !== claimId) return false
      this.outboxRecords.set(key(tenantId, eventId), clone({ ...existing, status: 'published', claimId: null, claimUntil: null, publishedAt: new Date(publishedAt).toISOString() }))
      return true
    },
    recover: (now: number) => {
      let recovered = 0
      for (const [entryKey, record] of this.outboxRecords.entries()) {
        if (record.status !== 'pending' || !record.claimUntil || Date.parse(record.claimUntil) > now) continue
        this.outboxRecords.set(entryKey, clone({ ...record, claimId: null, claimUntil: null, availableAt: new Date(now).toISOString() }))
        recovered += 1
      }
      return recovered
    },
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
      shifts: new Map([...this.shifts.entries()].map(([entryKey, value]) => [entryKey, clone(value)])),
      compensations: new Map([...this.compensations.entries()].map(([entryKey, value]) => [entryKey, clone(value)])),
      printerFailures: new Map([...this.printerFailures.entries()].map(([entryKey, value]) => [entryKey, clone(value)])),
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
    this.shifts.clear()
    for (const [entryKey, value] of snapshot.shifts) this.shifts.set(entryKey, value)
    this.compensations.clear()
    for (const [entryKey, value] of snapshot.compensations) this.compensations.set(entryKey, value)
    this.printerFailures.clear()
    for (const [entryKey, value] of snapshot.printerFailures) this.printerFailures.set(entryKey, value)
    this.outboxRecords.clear()
    for (const [entryKey, value] of snapshot.outboxRecords) this.outboxRecords.set(entryKey, value)
  }
}

export class TusPosService {
  readonly store: PosStorePort
  readonly audit: { list(tenantId: string): MaybePromise<RegistroAuditoriaPOS[]> }
  private readonly now: () => number
  private readonly evaluadorHabilitacion?: EvaluadorHabilitacion
  private readonly perfilHabilitacion: PerfilHabilitacion
  private readonly alcanceHabilitacion: string

  constructor(options: { store: PosStorePort; now?: () => number; evaluadorHabilitacion?: EvaluadorHabilitacion; perfilHabilitacion?: PerfilHabilitacion; alcanceHabilitacion?: string }) {
    this.store = options.store
    this.audit = { list: (tenantId) => options.store.listAudit(tenantId) }
    this.now = options.now ?? (() => Date.now())
    this.evaluadorHabilitacion = options.evaluadorHabilitacion
    this.perfilHabilitacion = options.perfilHabilitacion ?? 'native-local'
    this.alcanceHabilitacion = options.alcanceHabilitacion ?? 'argentina-stage-1'
  }

  async registerDevice(context: TusAuthenticatedTenantContext, input: { deviceId: string; label: string; fingerprint: string }): Promise<PosDevice> {
    this.authorize(context)
    await this.requerirHabilitacion(context)
    if (!input.deviceId.trim() || !input.label.trim() || !input.fingerprint.trim()) throw new PosError(400, 'INVALID_DEVICE', 'device id, label, and fingerprint are required')
    const now = new Date(this.now()).toISOString()
    const device: PosDevice = { contractVersion: '1.0.0', deviceId: input.deviceId, tenantId: context.tenantId, label: input.label.trim(), fingerprint: input.fingerprint, status: 'active', createdAt: now, updatedAt: now }
    return this.store.transaction(async (store) => {
      await store.saveDevice(device)
      await this.registrarAuditoriaPOS(context, 'pos.device.registered', device.deviceId, 'allowed', store)
      await this.recordOutbox(context, 'pos.device.registered', device.deviceId, device, store)
      return clone(device)
    })
  }

  async revokeDevice(context: TusAuthenticatedTenantContext, deviceId: string): Promise<PosDevice> {
    this.authorize(context)
    await this.requerirHabilitacion(context)
    const device = await this.store.getDevice(context.tenantId, deviceId)
    if (!device) throw new PosError(404, 'NOT_FOUND', 'POS device was not found')
    const revoked = { ...device, status: 'revoked' as const, updatedAt: new Date(this.now()).toISOString() }
    return this.store.transaction(async (store) => {
      await store.saveDevice(revoked)
      await this.registrarAuditoriaPOS(context, 'pos.device.revoked', deviceId, 'allowed', store)
      await this.recordOutbox(context, 'pos.device.revoked', deviceId, revoked, store)
      return revoked
    })
  }

  async openSession(context: TusAuthenticatedTenantContext, input: { sessionId: string; deviceId: string; shiftId: string; openingFloat?: number }): Promise<SesionPuntoVenta> {
    this.authorize(context)
    await this.requerirHabilitacion(context)
    if (!input.sessionId.trim() || !input.deviceId.trim() || !input.shiftId.trim()) throw new PosError(400, 'INVALID_SESSION', 'session, device, and shift are required')
    const device = await this.store.getDevice(context.tenantId, input.deviceId)
    if (!device || device.status !== 'active') throw new PosError(409, 'DEVICE_UNAVAILABLE', 'POS device is not active')
    const openingFloat = input.openingFloat ?? 0
    validateNonNegativeMoney(openingFloat, 'openingFloat')
    const existingShift = await this.store.getShift?.(context.tenantId, input.shiftId)
    if (existingShift?.status === 'open') throw new PosError(409, 'SHIFT_OPEN', 'POS shift is already open')
    const session: SesionPuntoVenta = { contractVersion: '1.0.0', sessionId: input.sessionId, tenantId: context.tenantId, deviceId: input.deviceId, actorId: context.subjectId, shiftId: input.shiftId, status: 'open', openedAt: new Date(this.now()).toISOString() }
    const shift: PosShift = { shiftId: input.shiftId, tenantId: context.tenantId, status: 'open', version: 0, totals: { openingFloat, sales: 0, refunds: 0, cashIn: 0, cashOut: 0, expectedCash: openingFloat }, openedAt: session.openedAt }
    return this.store.transaction(async (store) => {
      await store.saveSession(session)
      await store.saveShift?.(shift)
      await this.registrarAuditoriaPOS(context, 'pos.session.opened', session.sessionId, 'allowed', store)
      await this.recordOutbox(context, 'pos.session.opened', session.sessionId, session, store)
      return clone(session)
    })
  }

  async closeSession(context: TusAuthenticatedTenantContext, sessionId: string, input: { countedCash?: number } = {}): Promise<SesionPuntoVenta & { reconciliation?: PosShift['reconciliation'] }> {
    this.authorize(context)
    await this.requerirHabilitacion(context)
    const session = await this.store.getSession(context.tenantId, sessionId)
    if (!session || session.actorId !== context.subjectId) throw new PosError(404, 'NOT_FOUND', 'POS session was not found')
    if (session.status === 'closed') return session
    const shift = await this.store.getShift?.(context.tenantId, session.shiftId)
    const countedCash = input.countedCash ?? shift?.totals.expectedCash ?? 0
    validateNonNegativeMoney(countedCash, 'countedCash')
    const reconciliation = shift === undefined || shift === null
      ? { expectedCash: countedCash, countedCash, variance: 0 }
      : { expectedCash: shift.totals.expectedCash, countedCash, variance: countedCash - shift.totals.expectedCash }
    const closed = { ...session, status: 'closed' as const, closedAt: new Date(this.now()).toISOString() }
    return this.store.transaction(async (store) => {
      await store.saveSession(closed)
      if (shift && store.saveShift) await store.saveShift({ ...shift, status: 'closed', closedAt: closed.closedAt, reconciliation })
      await this.registrarAuditoriaPOS(context, 'pos.session.closed', sessionId, 'allowed', store)
      await this.recordOutbox(context, 'pos.session.closed', sessionId, closed, store)
      return { ...closed, reconciliation }
    })
  }

  async recordManualOperation(context: TusAuthenticatedTenantContext, input: Omit<OperacionManualPuntoVenta, 'tenantId' | 'actorId'> & Partial<Pick<OperacionManualPuntoVenta, 'tenantId' | 'actorId'>>): Promise<PosCommandResult> {
    this.authorize(context)
    await this.requerirHabilitacion(context)
    if ((input.tenantId !== undefined && input.tenantId !== context.tenantId) || (input.actorId !== undefined && input.actorId !== context.subjectId)) {
      await this.registrarAuditoriaPOS(context, 'pos.operation.denied', input.operationId, 'denied')
      throw new PosError(403, 'FORBIDDEN', 'POS authority fields do not match the authenticated session')
    }
    const operation: OperacionManualPuntoVenta = { contractVersion: '1.0.0', ...input, tenantId: context.tenantId, actorId: context.subjectId }
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
    const shift = await this.store.getShift?.(context.tenantId, operation.shiftId)
    if (shift?.status === 'closed') throw new PosError(409, 'SHIFT_CLOSED', 'POS shift is closed')
    const fingerprint = fingerprintFor(operation)
    return this.store.transaction(async (transactionStore) => {
      const existing = await transactionStore.getIdempotency(context.tenantId, operation.idempotencyKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          await this.registrarAuditoriaPOS(context, 'pos.operation.conflict', operation.operationId, 'denied', transactionStore)
          await this.recordConflict(context, operation, 'idempotency_conflict', undefined, transactionStore)
          return { status: 'conflict', operationId: operation.operationId, reason: 'idempotency_conflict' }
        }
        return clone(existing.response)
      }
      const currentVersion = await transactionStore.getVersion(context.tenantId, operation.shiftId)
      if (operation.expectedVersion !== undefined && operation.expectedVersion !== currentVersion) {
        await this.registrarAuditoriaPOS(context, 'pos.operation.conflict', operation.operationId, 'denied', transactionStore)
        await this.recordConflict(context, operation, 'version_conflict', currentVersion, transactionStore)
        return { status: 'conflict', operationId: operation.operationId, reason: 'version_conflict' }
      }
      const snapshot = { operationId: operation.operationId, amount: operation.amount, currency: operation.currency, lines: clone(operation.lines ?? []) }
      const receipt: ComprobantePuntoVenta = { contractVersion: '1.0.0', receiptId: `receipt-${operation.operationId}`, tenantId: context.tenantId, operationId: operation.operationId, kind: operation.kind, context: operation.context, amount: operation.amount, currency: operation.currency, status: 'accepted', source: 'deterministic-test-only', providerCapture: 'not-claimed', settlement: 'not-claimed', integrityHash: '', createdAt: new Date(this.now()).toISOString(), snapshot }
      receipt.integrityHash = receiptIntegrityHash(receipt)
      const response: PosCommandResult = { status: 'accepted', operation, receipt }
      await transactionStore.saveOperation(operation)
      await transactionStore.saveReceipt(receipt)
      const nextVersion = await transactionStore.incrementVersion(context.tenantId, operation.shiftId, currentVersion)
      const storedShift = await transactionStore.getShift?.(context.tenantId, operation.shiftId)
      if (storedShift && transactionStore.saveShift) {
        const sales = operation.paymentMethod === POS_PAYMENT_METHOD.CASH ? storedShift.totals.sales + operation.amount : storedShift.totals.sales
        await transactionStore.saveShift({ ...storedShift, version: nextVersion, totals: { ...storedShift.totals, sales, expectedCash: storedShift.totals.openingFloat + sales + storedShift.totals.cashIn - storedShift.totals.cashOut - storedShift.totals.refunds } })
      }
      await transactionStore.saveIdempotency(context.tenantId, operation.idempotencyKey, { fingerprint, response })
      await this.registrarAuditoriaPOS(context, 'pos.operation.accepted', operation.operationId, 'allowed', transactionStore)
      await this.recordOutbox(context, 'pos.operation.accepted', operation.operationId, response, transactionStore)
      return clone(response)
    })
  }

  async getShift(context: TusAuthenticatedTenantContext, shiftId: string): Promise<PosShift | null> {
    this.authorize(context)
    const shift = await this.store.getShift?.(context.tenantId, shiftId)
    return shift ? clone(shift) : null
  }

  async getOperationStatus(context: TusAuthenticatedTenantContext, operationId: string): Promise<{ status: PosOperationStatus; operationId: string; receipt?: ComprobantePuntoVenta; reason?: string }> {
    this.authorize(context)
    const operation = (await this.store.listOperations(context.tenantId)).find((item) => item.operationId === operationId)
    if (!operation) return { status: POS_OPERATION_STATUS.NOT_FOUND, operationId }
    const receipt = (await this.store.listReceipts(context.tenantId)).find((item) => item.operationId === operationId)
    if (receipt) return { status: POS_OPERATION_STATUS.ACCEPTED, operationId, receipt: clone(receipt) }
    return { status: POS_OPERATION_STATUS.PENDING, operationId, reason: 'receipt_pending' }
  }

  async refund(context: TusAuthenticatedTenantContext, input: { refundId: string; originalOperationId: string; idempotencyKey: string; amount: number; reason: string; expectedVersion: number }): Promise<{ status: 'accepted'; compensation: CompensacionPuntoVenta }> {
    this.authorizeCompensation(context)
    validateMoney(input.amount, 'refund amount')
    const original = (await this.store.listOperations(context.tenantId)).find((operation) => operation.operationId === input.originalOperationId)
    if (!original) throw new PosError(404, 'NOT_FOUND', 'original POS operation was not found')
    if (input.amount > original.amount) throw new PosError(409, 'INVALID_REFUND', 'refund exceeds the original operation')
    return this.createCompensation(context, { compensationId: input.refundId, originalOperationId: input.originalOperationId, idempotencyKey: input.idempotencyKey, amount: input.amount, currency: original.currency, reason: input.reason, expectedVersion: input.expectedVersion, kind: POS_COMPENSATION_KIND.REFUND })
  }

  async cancelOperation(context: TusAuthenticatedTenantContext, input: { cancellationId: string; originalOperationId: string; idempotencyKey: string; reason: string; expectedVersion: number }): Promise<{ status: 'accepted'; compensation: CompensacionPuntoVenta }> {
    this.authorizeCompensation(context)
    const original = (await this.store.listOperations(context.tenantId)).find((operation) => operation.operationId === input.originalOperationId)
    if (!original) throw new PosError(404, 'NOT_FOUND', 'original POS operation was not found')
    return this.createCompensation(context, { compensationId: input.cancellationId, originalOperationId: input.originalOperationId, idempotencyKey: input.idempotencyKey, amount: original.amount, currency: original.currency, reason: input.reason, expectedVersion: input.expectedVersion, kind: POS_COMPENSATION_KIND.CANCELLATION })
  }

  async listCompensations(context: TusAuthenticatedTenantContext): Promise<CompensacionPuntoVenta[]> {
    this.authorize(context)
    return (await this.store.listCompensations?.(context.tenantId)) ?? []
  }

  async recordPrinterFailure(context: TusAuthenticatedTenantContext, input: { failureId: string; operationId: string; reason: string }): Promise<PosPrinterFailure> {
    this.authorize(context)
    const operation = (await this.store.listOperations(context.tenantId)).find((item) => item.operationId === input.operationId)
    if (!operation) throw new PosError(404, 'NOT_FOUND', 'POS operation was not found')
    const failure: PosPrinterFailure = { failureId: input.failureId, tenantId: context.tenantId, operationId: input.operationId, reason: input.reason.trim(), status: POS_PRINTER_FAILURE_STATUS.RETRYABLE, createdAt: new Date(this.now()).toISOString() }
    return this.store.transaction(async (store) => {
      await store.savePrinterFailure?.(failure)
      await this.registrarAuditoriaPOS(context, 'pos.printer.failure', input.operationId, 'allowed', store)
      await this.recordOutbox(context, 'pos.printer.retryable', input.operationId, failure, store)
      return clone(failure)
    })
  }

  private async createCompensation(context: TusAuthenticatedTenantContext, input: { compensationId: string; originalOperationId: string; idempotencyKey: string; amount: number; currency: string; reason: string; expectedVersion: number; kind: PosCompensationKind }): Promise<{ status: 'accepted'; compensation: CompensacionPuntoVenta }> {
    const existing = (await this.store.listCompensations?.(context.tenantId))?.find((item) => item.idempotencyKey === input.idempotencyKey)
    if (existing) return { status: 'accepted', compensation: clone(existing) }
    const compensation: CompensacionPuntoVenta = { compensationId: input.compensationId, tenantId: context.tenantId, actorId: context.subjectId, originalOperationId: input.originalOperationId, idempotencyKey: input.idempotencyKey, kind: input.kind, amount: input.amount, currency: input.currency, reason: input.reason.trim(), status: 'accepted', createdAt: new Date(this.now()).toISOString() }
    return this.store.transaction(async (store) => {
      const currentVersion = await store.getVersion(context.tenantId, (await store.listOperations(context.tenantId)).find((operation) => operation.operationId === input.originalOperationId)?.shiftId ?? '')
      if (currentVersion !== input.expectedVersion) {
        await this.registrarAuditoriaPOS(context, `pos.${input.kind}.denied`, input.originalOperationId, 'denied', store)
        throw new PosError(409, 'VERSION_CONFLICT', 'POS shift version differs from the offline expectation')
      }
      await store.saveCompensation?.(compensation)
      const original = (await store.listOperations(context.tenantId)).find((operation) => operation.operationId === input.originalOperationId)
      if (original) {
        const shift = await store.getShift?.(context.tenantId, original.shiftId)
        if (shift && store.saveShift) {
          const refunds = input.kind === POS_COMPENSATION_KIND.REFUND ? shift.totals.refunds + input.amount : shift.totals.refunds
          await store.saveShift({ ...shift, version: currentVersion + 1, totals: { ...shift.totals, refunds, expectedCash: shift.totals.openingFloat + shift.totals.sales + shift.totals.cashIn - shift.totals.cashOut - refunds } })
        }
      }
      await store.incrementVersion(context.tenantId, (original?.shiftId ?? ''), currentVersion)
      await this.registrarAuditoriaPOS(context, `pos.${input.kind}.accepted`, input.originalOperationId, 'allowed', store)
      await this.recordOutbox(context, `pos.${input.kind}.accepted`, input.compensationId, compensation, store)
      return { status: 'accepted', compensation: clone(compensation) }
    })
  }

  async resolveConflict(context: TusAuthenticatedTenantContext, conflictId: string, resolution: 'discard' | 'retry'): Promise<ConflictoPuntoVenta> {
    this.authorize(context)
    await this.requerirHabilitacion(context)
    return this.store.transaction(async (transactionStore) => {
      const conflict = (await transactionStore.listConflicts(context.tenantId)).find((item) => item.conflictId === conflictId)
      if (!conflict) throw new PosError(404, 'NOT_FOUND', 'POS conflict was not found')
      const resolved = { ...conflict, status: resolution === 'discard' ? 'discarded' as const : 'resolved' as const }
      await transactionStore.saveConflict(resolved)
      await this.registrarAuditoriaPOS(context, `pos.conflict.${resolved.status}`, conflict.operationId, 'allowed', transactionStore)
      await this.recordOutbox(context, `pos.conflict.${resolved.status}`, conflict.operationId, resolved, transactionStore)
      return clone(resolved)
    })
  }

  private async registrarAuditoriaPOS(context: TusAuthenticatedTenantContext, action: string, operationId: string, outcome: RegistroAuditoriaPOS['outcome'], store = this.store): Promise<void> {
    await store.saveAudit({ auditId: `${action}-${operationId}-${this.now()}`, tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, action, operationId, outcome, createdAt: new Date(this.now()).toISOString() })
  }

  private requerirHabilitacion(context: TusAuthenticatedTenantContext): Promise<unknown> {
    return this.evaluadorHabilitacion?.require({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, capability: 'fleet', profile: this.perfilHabilitacion, scope: this.alcanceHabilitacion }) ?? Promise.resolve()
  }

  private async recordConflict(context: TusAuthenticatedTenantContext, operation: OperacionManualPuntoVenta, reason: ConflictoPuntoVenta['reason'], actualVersion?: number, store = this.store): Promise<void> {
    const conflict: ConflictoPuntoVenta = { contractVersion: '1.0.0', conflictId: `conflict-${operation.operationId}-${this.now()}`, tenantId: context.tenantId, operationId: operation.operationId, reason, ...(operation.expectedVersion !== undefined ? { expectedVersion: operation.expectedVersion } : {}), ...(actualVersion !== undefined ? { actualVersion } : {}), status: 'open', createdAt: new Date(this.now()).toISOString() }
    await store.saveConflict(conflict)
    await this.recordOutbox(context, 'pos.conflict.opened', operation.operationId, conflict, store)
  }

  private async recordOutbox(context: TusAuthenticatedTenantContext, eventType: string, aggregateId: string, payload: unknown, store = this.store): Promise<void> {
    await store.outbox.append({ eventId: `${eventType}-${aggregateId}-${this.now()}`, tenantId: context.tenantId, eventType, aggregateId, payload: structuredClone(payload) as Record<string, unknown>, status: 'pending', attempts: 0, createdAt: new Date(this.now()).toISOString() })
  }

  private authorize(context: TusAuthenticatedTenantContext): void {
    if (!context.tenantId.trim() || !context.subjectId.trim() || !context.correlationId.trim() || (!context.permissions.includes('tus:pos:write') && !context.permissions.includes('tus:*'))) throw new PosError(403, 'FORBIDDEN', 'TUS POS operation is not authorized')
  }

  private authorizeCompensation(context: TusAuthenticatedTenantContext): void {
    this.authorize(context)
    const privileged = context.permissions.includes('tus:pos:refund') || context.permissions.includes('tus:*') || context.roles.some((role) => role === 'manager' || role === 'admin')
    if (!privileged) throw new PosError(403, 'FORBIDDEN', 'POS compensation is not authorized')
  }
}

function validateOperation(operation: OperacionManualPuntoVenta): void {
  if (!operation.operationId.trim() || !operation.idempotencyKey.trim() || !operation.schemaVersion.trim() || !operation.deviceId.trim() || !operation.shiftId.trim() || !operation.currency.trim() || !Number.isFinite(Date.parse(operation.createdAt))) throw new PosError(400, 'INVALID', 'POS operation metadata and amount are required')
  validateMoney(operation.amount, 'amount')
  if ((operation.kind === 'manual-sale' && operation.context !== 'product') || (operation.kind === 'manual-service' && operation.context !== 'service')) throw new PosError(400, 'CONTEXT_MISMATCH', 'product sales and service captures use separate POS lifecycles')
  if (operation.expectedVersion !== undefined && (!Number.isInteger(operation.expectedVersion) || operation.expectedVersion < 0)) throw new PosError(400, 'INVALID', 'expectedVersion must be a non-negative integer')
  if (operation.paymentMethod !== undefined && !Object.values(POS_PAYMENT_METHOD).includes(operation.paymentMethod)) throw new PosError(400, 'INVALID', 'payment method is unsupported')
  if (operation.lines !== undefined) validateLineSnapshots(operation.lines, operation.context, operation.amount)
}

function validateMoney(amount: number, label: string): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new PosError(400, 'INVALID', `${label} must be a positive safe integer in minor units`)
}

function validateNonNegativeMoney(amount: number, label: string): void {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new PosError(400, 'INVALID', `${label} must be a non-negative safe integer in minor units`)
}

function validateLineSnapshots(lines: PosLineSnapshot[], context: PosOperationContext, amount: number): void {
  if (lines.length === 0) throw new PosError(400, 'INVALID', 'POS operation lines cannot be empty')
  const total = lines.reduce((sum, line) => {
    if (!line.lineId.trim() || !line.name.trim() || line.context !== context || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.unitAmount) || line.unitAmount <= 0 || !Number.isSafeInteger(line.totalAmount) || line.totalAmount !== line.quantity * line.unitAmount) throw new PosError(400, 'INVALID', 'POS line snapshot is invalid')
    return sum + line.totalAmount
  }, 0)
  if (!Number.isSafeInteger(total) || total !== amount) throw new PosError(400, 'INVALID', 'POS line snapshot total differs from amount')
}

function fingerprintFor(operation: OperacionManualPuntoVenta): string {
  return createHash('sha256').update(JSON.stringify(operation)).digest('hex')
}

export function verifyPosReceipt(receipt: ComprobantePuntoVenta): boolean {
  return receipt.providerCapture === 'not-claimed' && receipt.settlement === 'not-claimed' && receipt.integrityHash === receiptIntegrityHash(receipt)
}

function receiptIntegrityHash(receipt: ComprobantePuntoVenta): string {
  const { integrityHash, ...unsigned } = receipt
  void integrityHash
  return createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')
}

function key(tenantId: string, id: string): string { return `${tenantId}:${id}` }
function clone<T>(value: T): T { return value === null ? value : structuredClone(value) }
type MaybePromise<T> = T | Promise<T>

export default { InMemoryPosStore, PosError, TusPosService, verifyPosReceipt }
