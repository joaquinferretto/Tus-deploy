import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import type { EvaluadorHabilitacion, PerfilHabilitacion } from '../readiness/index.ts'

export const DELIVERY_TASK_STATUS = {
  QUEUED: 'queued',
  ACCEPTED: 'accepted',
  PICKED_UP: 'picked-up',
  IN_TRANSIT: 'in-transit',
  HANDED_OFF: 'handed-off',
  DELIVERED: 'delivered',
  RETURNED: 'returned',
  CANCELLED: 'cancelled',
  INCIDENT_REVIEW: 'incident-review',
} as const

export type DeliveryTaskStatus = (typeof DELIVERY_TASK_STATUS)[keyof typeof DELIVERY_TASK_STATUS]
export type DeliveryEvidenceSource = 'authorized' | 'deterministic-test-only'

export interface DeliverySla {
  pickupDueAt: string
  dropoffDueAt: string
  status: 'on-time' | 'breached'
  breachedAt: string | null
}

export interface DeliveryPickupEvidence {
  pickedUpAt: string | null
  inTransitAt: string | null
}

export interface DeliveryDropoffEvidence {
  handedOffAt: string | null
}

export interface ZonaEntrega {
  zoneId: string
  tenantId: string
  name: string
  postalCodes: string[]
  active: boolean
}

export interface DeliveryShift {
  shiftId: string
  tenantId: string
  zoneId: string
  startsAt: string
  endsAt: string
  operatorIds: string[]
  status: 'open' | 'closed'
}

export interface DeliveryCommitmentReference {
  commitmentId: string
  tenantId: string
  context: 'product' | 'service'
  merchantId: string
  amount: number
  currency: string
}

export interface ComprobanteEntrega {
  contractVersion?: '1.0.0'
  proofId: string
  tenantId: string
  taskId: string
  commitmentId: string
  recipientName: string
  capturedAt: string
  evidenceSource: DeliveryEvidenceSource
}

export interface IncidenteEntrega {
  contractVersion?: '1.0.0'
  incidentId: string
  tenantId: string
  taskId: string
  reason: string
  status: 'open' | 'resolved'
  createdAt: string
}

export interface TareaEntrega {
  contractVersion?: '1.0.0'
  taskId: string
  tenantId: string
  commitmentId: string
  merchantId: string
  context: 'product'
  zoneId: string
  shiftId: string
  operatorId: string | null
  status: DeliveryTaskStatus
  version: number
  proof: ComprobanteEntrega | null
  incident: IncidenteEntrega | null
  sla: DeliverySla
  pickup: DeliveryPickupEvidence
  dropoff: DeliveryDropoffEvidence
  cancelledAt: string | null
  failureReason: string | null
  settlementClaim: 'not-claimed'
  createdAt: string
  updatedAt: string
}

export interface RegistroAuditoriaEntrega {
  auditId: string
  tenantId: string
  actorId: string
  correlationId: string
  action: string
  resourceType: 'zone' | 'shift' | 'task' | 'proof' | 'incident' | 'authorization'
  resourceId: string
  outcome: 'allowed' | 'denied'
  createdAt: string
}

export interface DeliveryOutboxRecord {
  eventId: string
  tenantId: string
  correlationId: string
  eventType: string
  aggregateId: string
  payload: Record<string, unknown>
  status: 'pending' | 'published' | 'dead-letter'
  attempts: number
  createdAt: string
}

export interface DeliveryStorePort {
  zones: { save(zone: ZonaEntrega): Promise<void>; find(tenantId: string, zoneId: string): Promise<ZonaEntrega | null> }
  shifts: { save(shift: DeliveryShift): Promise<void>; find(tenantId: string, shiftId: string): Promise<DeliveryShift | null> }
  tasks: { save(task: TareaEntrega): Promise<void>; find(tenantId: string, taskId: string): Promise<TareaEntrega | null>; forTenant(tenantId: string): Promise<TareaEntrega[]> }
  proofs: { save(proof: ComprobanteEntrega): Promise<void>; find(tenantId: string, proofId: string): Promise<ComprobanteEntrega | null> }
  incidents: { save(incident: IncidenteEntrega): Promise<void>; find(tenantId: string, incidentId: string): Promise<IncidenteEntrega | null> }
  audit: { append(record: RegistroAuditoriaEntrega): Promise<void>; list(tenantId: string): RegistroAuditoriaEntrega[] }
  outbox: { append(record: DeliveryOutboxRecord): Promise<void>; list(tenantId: string): DeliveryOutboxRecord[] }
  listOutbox(tenantId: string): DeliveryOutboxRecord[]
}

export class DeliveryError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'DeliveryError'
    this.status = status
    this.code = code
  }
}

export class InMemoryDeliveryStore implements DeliveryStorePort {
  private readonly zoneRecords = new Map<string, ZonaEntrega>()
  private readonly shiftRecords = new Map<string, DeliveryShift>()
  private readonly taskRecords = new Map<string, TareaEntrega>()
  private readonly proofRecords = new Map<string, ComprobanteEntrega>()
  private readonly incidentRecords = new Map<string, IncidenteEntrega>()
  private readonly auditRecords = new Map<string, RegistroAuditoriaEntrega>()
  private readonly outboxRecords = new Map<string, DeliveryOutboxRecord>()

  readonly zones = {
    save: async (zone: ZonaEntrega) => { this.zoneRecords.set(key(zone.tenantId, zone.zoneId), clone(zone)) },
    find: async (tenantId: string, zoneId: string) => clone(this.zoneRecords.get(key(tenantId, zoneId)) ?? null),
  }

  readonly shifts = {
    save: async (shift: DeliveryShift) => { this.shiftRecords.set(key(shift.tenantId, shift.shiftId), clone(shift)) },
    find: async (tenantId: string, shiftId: string) => clone(this.shiftRecords.get(key(tenantId, shiftId)) ?? null),
  }

  readonly tasks = {
    save: async (task: TareaEntrega) => { this.taskRecords.set(key(task.tenantId, task.taskId), clone(task)) },
    find: async (tenantId: string, taskId: string) => clone(this.taskRecords.get(key(tenantId, taskId)) ?? null),
    forTenant: async (tenantId: string) => [...this.taskRecords.values()].filter((task) => task.tenantId === tenantId).map(clone),
  }

  readonly proofs = {
    save: async (proof: ComprobanteEntrega) => { this.proofRecords.set(key(proof.tenantId, proof.proofId), clone(proof)) },
    find: async (tenantId: string, proofId: string) => clone(this.proofRecords.get(key(tenantId, proofId)) ?? null),
  }

  readonly incidents = {
    save: async (incident: IncidenteEntrega) => { this.incidentRecords.set(key(incident.tenantId, incident.incidentId), clone(incident)) },
    find: async (tenantId: string, incidentId: string) => clone(this.incidentRecords.get(key(tenantId, incidentId)) ?? null),
  }

  readonly audit = {
    append: async (record: RegistroAuditoriaEntrega) => { this.auditRecords.set(record.auditId, clone(record)) },
    list: (tenantId: string) => [...this.auditRecords.values()].filter((record) => record.tenantId === tenantId).map(clone),
  }

  readonly outbox = {
    append: async (record: DeliveryOutboxRecord) => { this.outboxRecords.set(key(record.tenantId, record.eventId), clone(record)) },
    list: (tenantId: string) => [...this.outboxRecords.values()].filter((record) => record.tenantId === tenantId).map(clone),
  }
  listOutbox(tenantId: string) { return this.outbox.list(tenantId) }
}

export interface CreateDeliveryTaskInput {
  taskId: string
  commitment: DeliveryCommitmentReference
  zoneId: string
  shiftId: string
  operatorId?: string
  sla?: { pickupDueAt: string; dropoffDueAt: string }
}

export class TusDeliveryService {
  readonly store: DeliveryStorePort
  readonly audit: DeliveryStorePort['audit']
  private readonly commitmentLookup?: (commitmentId: string) => Promise<DeliveryCommitmentReference | null>
  private readonly now: () => number
  private readonly evaluadorHabilitacion?: EvaluadorHabilitacion
  private readonly perfilHabilitacion: PerfilHabilitacion
  private readonly alcanceHabilitacion: string

  constructor(options: { store: DeliveryStorePort; commitmentLookup?: (commitmentId: string) => Promise<DeliveryCommitmentReference | null>; now?: () => number; evaluadorHabilitacion?: EvaluadorHabilitacion; perfilHabilitacion?: PerfilHabilitacion; alcanceHabilitacion?: string }) {
    this.store = options.store
    this.audit = options.store.audit
    this.commitmentLookup = options.commitmentLookup
    this.now = options.now ?? (() => Date.now())
    this.evaluadorHabilitacion = options.evaluadorHabilitacion
    this.perfilHabilitacion = options.perfilHabilitacion ?? 'native-local'
    this.alcanceHabilitacion = options.alcanceHabilitacion ?? 'argentina-stage-1'
  }

  async createZone(context: TusAuthenticatedTenantContext, input: { zoneId: string; name: string; postalCodes: string[] }): Promise<ZonaEntrega> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    if (!input.zoneId.trim() || !input.name.trim() || !Array.isArray(input.postalCodes)) throw new DeliveryError(400, 'INVALID', 'zone id, name, and postal codes are required')
    const zone = { zoneId: input.zoneId, tenantId: context.tenantId, name: input.name.trim(), postalCodes: [...input.postalCodes], active: true }
    await this.store.zones.save(zone)
    await this.registrarAuditoriaEntrega(context, 'delivery.zone.created', 'zone', zone.zoneId, 'allowed')
    await this.recordOutbox(context, 'delivery.zone.created', zone.zoneId, zone)
    return zone
  }

  async openShift(context: TusAuthenticatedTenantContext, input: Omit<DeliveryShift, 'tenantId' | 'status'>): Promise<DeliveryShift> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    const zone = await this.requireZone(context, input.zoneId)
    if (!validInterval(input.startsAt, input.endsAt) || !Array.isArray(input.operatorIds) || input.operatorIds.length === 0) throw new DeliveryError(400, 'INVALID', 'shift interval and internal operators are required')
    const shift: DeliveryShift = { ...input, tenantId: zone.tenantId, status: 'open', operatorIds: [...input.operatorIds] }
    await this.store.shifts.save(shift)
    await this.registrarAuditoriaEntrega(context, 'delivery.shift.opened', 'shift', shift.shiftId, 'allowed')
    await this.recordOutbox(context, 'delivery.shift.opened', shift.shiftId, shift)
    return shift
  }

  async createTask(context: TusAuthenticatedTenantContext, input: CreateDeliveryTaskInput): Promise<TareaEntrega> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    if (input.commitment.tenantId !== context.tenantId) throw new DeliveryError(403, 'FORBIDDEN', 'commitment is outside the authenticated tenant')
    if (input.commitment.context !== 'product') throw new DeliveryError(409, 'CONTEXT_MISMATCH', 'delivery tasks only accept product commitments')
    const zone = await this.requireZone(context, input.zoneId)
    const shift = await this.requireShift(context, input.shiftId)
    if (shift.zoneId !== zone.zoneId || shift.status !== 'open') throw new DeliveryError(409, 'SHIFT_UNAVAILABLE', 'delivery shift is not active for this zone')
    if (input.operatorId !== undefined && !shift.operatorIds.includes(input.operatorId)) throw new DeliveryError(403, 'FORBIDDEN', 'operator is not assigned to this shift')
    const now = new Date(this.now()).toISOString()
    const sla = input.sla ?? { pickupDueAt: shift.startsAt, dropoffDueAt: shift.endsAt }
    if (!validInterval(sla.pickupDueAt, sla.dropoffDueAt)) throw new DeliveryError(400, 'INVALID_SLA', 'pickup and dropoff SLA deadlines are required')
    const task: TareaEntrega = { contractVersion: '1.0.0', taskId: input.taskId, tenantId: context.tenantId, commitmentId: input.commitment.commitmentId, merchantId: input.commitment.merchantId, context: 'product', zoneId: zone.zoneId, shiftId: shift.shiftId, operatorId: input.operatorId ?? (shift.operatorIds.length === 1 ? shift.operatorIds[0]! : null), status: DELIVERY_TASK_STATUS.QUEUED, version: 0, proof: null, incident: null, sla: { ...sla, status: 'on-time', breachedAt: null }, pickup: { pickedUpAt: null, inTransitAt: null }, dropoff: { handedOffAt: null }, cancelledAt: null, failureReason: null, settlementClaim: 'not-claimed', createdAt: now, updatedAt: now }
    await this.store.tasks.save(task)
    await this.registrarAuditoriaEntrega(context, 'delivery.task.created', 'task', task.taskId, 'allowed')
    await this.recordOutbox(context, 'delivery.task.created', task.taskId, task)
    return task
  }

  async createTaskFromCommitment(context: TusAuthenticatedTenantContext, input: Omit<CreateDeliveryTaskInput, 'commitment'> & { commitmentId: string }): Promise<TareaEntrega> {
    if (!this.commitmentLookup) throw new DeliveryError(503, 'UNAVAILABLE', 'commitment lookup is unavailable')
    const commitment = await this.commitmentLookup(input.commitmentId)
    if (!commitment) throw new DeliveryError(404, 'NOT_FOUND', 'commitment was not found')
    return this.createTask(context, { ...input, commitment })
  }

  async assignTask(context: TusAuthenticatedTenantContext, taskId: string, operatorId: string, expectedVersion: number): Promise<TareaEntrega> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    const task = await this.requireTask(context, taskId)
    const shift = await this.requireShift(context, task.shiftId)
    if (!shift.operatorIds.includes(operatorId)) throw new DeliveryError(403, 'FORBIDDEN', 'operator is not assigned to this shift')
    this.assertVersion(task, expectedVersion)
    const updated = { ...task, operatorId, version: task.version + 1, updatedAt: new Date(this.now()).toISOString() }
    await this.store.tasks.save(updated)
    await this.registrarAuditoriaEntrega(context, 'delivery.task.assigned', 'task', task.taskId, 'allowed')
    await this.recordOutbox(context, 'delivery.task.assigned', task.taskId, updated)
    return updated
  }

  async acceptTask(context: TusAuthenticatedTenantContext, taskId: string, expectedVersion: number): Promise<TareaEntrega> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    const task = await this.requireTask(context, taskId)
    if (task.operatorId !== context.subjectId) throw new DeliveryError(403, 'FORBIDDEN', 'only the assigned internal operator may accept the task')
    return this.transitionTask(context, taskId, 'accepted', expectedVersion)
  }

  async transitionTask(context: TusAuthenticatedTenantContext, taskId: string, status: Extract<DeliveryTaskStatus, 'accepted' | 'picked-up' | 'in-transit' | 'handed-off' | 'delivered'>, expectedVersion: number): Promise<TareaEntrega> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    const task = await this.requireTask(context, taskId)
    this.assertVersion(task, expectedVersion)
    if (status !== DELIVERY_TASK_STATUS.ACCEPTED && task.operatorId !== context.subjectId) throw new DeliveryError(403, 'FORBIDDEN', 'only the assigned internal operator may update this delivery')
    if (!isAllowedTransition(task.status, status) || (['handed-off', 'delivered'].includes(status) && task.proof === null)) throw new DeliveryError(409, 'INVALID_TRANSITION', 'delivery task transition is not supported by its current evidence')
    const timestamp = new Date(this.now()).toISOString()
    const updated: TareaEntrega = {
      ...task,
      status,
      pickup: status === DELIVERY_TASK_STATUS.PICKED_UP ? { ...task.pickup, pickedUpAt: timestamp } : status === DELIVERY_TASK_STATUS.IN_TRANSIT ? { ...task.pickup, inTransitAt: timestamp } : task.pickup,
      dropoff: ['handed-off', 'delivered'].includes(status) ? { ...task.dropoff, handedOffAt: task.dropoff.handedOffAt ?? timestamp } : task.dropoff,
      version: task.version + 1,
      updatedAt: timestamp,
    }
    return this.saveTask(context, updated, `delivery.task.${status}`)
  }

  async evaluateSla(context: TusAuthenticatedTenantContext, taskId: string, at = this.now()): Promise<{ status: DeliverySla['status']; pickupDueAt: string; dropoffDueAt: string; breachedAt: string | null }> {
    this.authorize(context, 'tus:delivery:read')
    const task = await this.requireTask(context, taskId)
    const breached = at > Date.parse(task.sla.dropoffDueAt)
    if (breached && task.sla.status !== 'breached') {
      const timestamp = new Date(at).toISOString()
      const updated = await this.saveTask(context, { ...task, sla: { ...task.sla, status: 'breached', breachedAt: timestamp }, version: task.version + 1, updatedAt: timestamp }, 'delivery.sla.breached')
      return { status: updated.sla.status, pickupDueAt: updated.sla.pickupDueAt, dropoffDueAt: updated.sla.dropoffDueAt, breachedAt: updated.sla.breachedAt }
    }
    return { status: breached || task.sla.status === 'breached' ? 'breached' : 'on-time', pickupDueAt: task.sla.pickupDueAt, dropoffDueAt: task.sla.dropoffDueAt, breachedAt: breached ? task.sla.breachedAt ?? new Date(at).toISOString() : task.sla.breachedAt }
  }

  async cancelTask(context: TusAuthenticatedTenantContext, taskId: string, expectedVersion: number, reason: string): Promise<TareaEntrega> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    const task = await this.requireTask(context, taskId)
    this.assertVersion(task, expectedVersion)
    this.assertOperator(task, context)
    if (!reason.trim() || !([DELIVERY_TASK_STATUS.QUEUED, DELIVERY_TASK_STATUS.ACCEPTED] as DeliveryTaskStatus[]).includes(task.status)) throw new DeliveryError(409, 'INVALID_CANCELLATION', 'only queued or accepted deliveries can be cancelled')
    const timestamp = new Date(this.now()).toISOString()
    return this.saveTask(context, { ...task, status: DELIVERY_TASK_STATUS.CANCELLED, cancelledAt: timestamp, failureReason: reason.trim(), version: task.version + 1, updatedAt: timestamp }, 'delivery.task.cancelled')
  }

  async recordProof(context: TusAuthenticatedTenantContext, input: Omit<ComprobanteEntrega, 'tenantId' | 'commitmentId'>, expectedVersion: number): Promise<TareaEntrega> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    const task = await this.requireTask(context, input.taskId)
    this.assertVersion(task, expectedVersion)
    this.assertOperator(task, context)
    if (task.status !== 'in-transit') throw new DeliveryError(409, 'INVALID_PROOF_STATE', 'delivery proof requires an in-transit task')
    if (!input.recipientName.trim() || !Number.isFinite(Date.parse(input.capturedAt)) || !['authorized', 'deterministic-test-only'].includes(input.evidenceSource)) throw new DeliveryError(400, 'INVALID_PROOF', 'recipient, timestamp, and evidence source are required')
    const proof: ComprobanteEntrega = { contractVersion: '1.0.0', ...input, tenantId: context.tenantId, commitmentId: task.commitmentId }
    await this.store.proofs.save(proof)
    const updated = { ...task, proof, version: task.version + 1, updatedAt: new Date(this.now()).toISOString() }
    await this.store.tasks.save(updated)
    await this.registrarAuditoriaEntrega(context, 'delivery.proof.recorded', 'proof', proof.proofId, 'allowed')
    await this.recordOutbox(context, 'delivery.proof.recorded', proof.proofId, { ...proof, commitmentId: task.commitmentId, evidenceId: proof.proofId })
    return updated
  }

  async failTask(context: TusAuthenticatedTenantContext, taskId: string, input: { incidentId: string; reason: string }, expectedVersion: number): Promise<{ status: 'incident-review'; task: TareaEntrega; incident: IncidenteEntrega }> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    const task = await this.requireTask(context, taskId)
    this.assertVersion(task, expectedVersion)
    this.assertOperator(task, context)
    if (([DELIVERY_TASK_STATUS.CANCELLED, DELIVERY_TASK_STATUS.RETURNED, DELIVERY_TASK_STATUS.DELIVERED, DELIVERY_TASK_STATUS.INCIDENT_REVIEW] as DeliveryTaskStatus[]).includes(task.status)) throw new DeliveryError(409, 'INVALID_TRANSITION', 'terminal or incident delivery tasks cannot fail again')
    if (!input.incidentId.trim() || !input.reason.trim()) throw new DeliveryError(400, 'INVALID_INCIDENT', 'incident id and reason are required')
    const incident: IncidenteEntrega = { contractVersion: '1.0.0', incidentId: input.incidentId, tenantId: context.tenantId, taskId, reason: input.reason.trim(), status: 'open', createdAt: new Date(this.now()).toISOString() }
    await this.store.incidents.save(incident)
    const updated = { ...task, status: DELIVERY_TASK_STATUS.INCIDENT_REVIEW, incident, failureReason: input.reason.trim(), version: task.version + 1, updatedAt: new Date(this.now()).toISOString() }
    await this.store.tasks.save(updated)
    await this.registrarAuditoriaEntrega(context, 'delivery.incident.opened', 'incident', incident.incidentId, 'allowed')
    await this.recordOutbox(context, 'delivery.incident.opened', taskId, incident)
    return { status: 'incident-review', task: updated, incident }
  }

  async resolveIncident(context: TusAuthenticatedTenantContext, taskId: string, expectedVersion: number): Promise<TareaEntrega> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    const task = await this.requireTask(context, taskId)
    this.assertVersion(task, expectedVersion)
    this.assertOperator(task, context)
    if (task.status !== 'incident-review' || task.incident === null) throw new DeliveryError(409, 'INVALID_INCIDENT_STATE', 'only an open delivery incident can be resolved')
    const incident = { ...task.incident, status: 'resolved' as const }
    const updated = { ...task, incident, status: 'returned' as const, version: task.version + 1, updatedAt: new Date(this.now()).toISOString() }
    await this.store.incidents.save(incident)
    await this.store.tasks.save(updated)
    await this.registrarAuditoriaEntrega(context, 'delivery.incident.resolved', 'incident', incident.incidentId, 'allowed')
    await this.recordOutbox(context, 'delivery.incident.resolved', taskId, updated)
    return updated
  }

  async returnTask(context: TusAuthenticatedTenantContext, taskId: string, expectedVersion: number): Promise<TareaEntrega> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    const task = await this.requireTask(context, taskId)
    this.assertVersion(task, expectedVersion)
    this.assertOperator(task, context)
    if (!['in-transit', 'incident-review'].includes(task.status)) throw new DeliveryError(409, 'INVALID_TRANSITION', 'only an active or incident delivery can be returned')
    return this.saveTask(context, { ...task, status: 'returned', version: task.version + 1, updatedAt: new Date(this.now()).toISOString() }, 'delivery.task.returned')
  }

  async closeShift(context: TusAuthenticatedTenantContext, shiftId: string): Promise<DeliveryShift> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    const shift = await this.requireShift(context, shiftId)
    if (shift.status === 'closed') return shift
    const closed = { ...shift, status: 'closed' as const }
    await this.store.shifts.save(closed)
    await this.registrarAuditoriaEntrega(context, 'delivery.shift.closed', 'shift', shiftId, 'allowed')
    await this.recordOutbox(context, 'delivery.shift.closed', shiftId, closed)
    return closed
  }

  async getTask(context: TusAuthenticatedTenantContext, taskId: string): Promise<TareaEntrega> {
    this.authorize(context, 'tus:delivery:read')
    return this.requireTask(context, taskId)
  }

  async listTasks(context: TusAuthenticatedTenantContext): Promise<TareaEntrega[]> {
    this.authorize(context, 'tus:delivery:read')
    return this.store.tasks.forTenant(context.tenantId)
  }

  async openPublicBidding(context: TusAuthenticatedTenantContext, _input: { taskId: string }): Promise<never> {
    this.authorize(context, 'tus:delivery:write')
    await this.requerirHabilitacion(context)
    await this.registrarAuditoriaEntrega(context, 'delivery.public-bidding.denied', 'authorization', 'public-bidding', 'denied')
    throw new DeliveryError(400, 'OUT_OF_SCOPE', 'public courier bidding is outside Stage 1 delivery')
  }

  private async requireZone(context: TusAuthenticatedTenantContext, zoneId: string): Promise<ZonaEntrega> {
    const zone = await this.store.zones.find(context.tenantId, zoneId)
    if (!zone || !zone.active) throw new DeliveryError(404, 'NOT_FOUND', 'delivery zone was not found')
    return zone
  }

  private requerirHabilitacion(context: TusAuthenticatedTenantContext): Promise<unknown> {
    return this.evaluadorHabilitacion?.require({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, capability: 'fleet', profile: this.perfilHabilitacion, scope: this.alcanceHabilitacion }) ?? Promise.resolve()
  }

  private async requireShift(context: TusAuthenticatedTenantContext, shiftId: string): Promise<DeliveryShift> {
    const shift = await this.store.shifts.find(context.tenantId, shiftId)
    if (!shift) throw new DeliveryError(404, 'NOT_FOUND', 'delivery shift was not found')
    return shift
  }

  private async requireTask(context: TusAuthenticatedTenantContext, taskId: string): Promise<TareaEntrega> {
    const task = await this.store.tasks.find(context.tenantId, taskId)
    if (!task) throw new DeliveryError(403, 'FORBIDDEN', 'delivery task is outside the authenticated tenant')
    return task
  }

  private async saveTask(context: TusAuthenticatedTenantContext, task: TareaEntrega, action: string): Promise<TareaEntrega> {
    await this.store.tasks.save(task)
    await this.registrarAuditoriaEntrega(context, action, 'task', task.taskId, 'allowed')
    await this.recordOutbox(context, action, task.taskId, task)
    return task
  }

  private assertVersion(task: TareaEntrega, expectedVersion: number): void {
    if (!Number.isInteger(expectedVersion) || task.version !== expectedVersion) throw new DeliveryError(409, 'VERSION_CONFLICT', 'delivery task version differs from the offline expectation')
  }

  private assertOperator(task: TareaEntrega, context: TusAuthenticatedTenantContext): void {
    if (task.operatorId !== context.subjectId) throw new DeliveryError(403, 'FORBIDDEN', 'only the assigned internal operator may update this delivery')
  }

  private authorize(context: TusAuthenticatedTenantContext, permission: string): void {
    if (!context.tenantId.trim() || !context.subjectId.trim() || !context.correlationId.trim() || (!context.permissions.includes(permission) && !context.permissions.includes('tus:*'))) throw new DeliveryError(403, 'FORBIDDEN', 'TUS delivery operation is not authorized')
  }

  private async registrarAuditoriaEntrega(context: TusAuthenticatedTenantContext, action: string, resourceType: RegistroAuditoriaEntrega['resourceType'], resourceId: string, outcome: RegistroAuditoriaEntrega['outcome']): Promise<void> {
    await this.store.audit.append({ auditId: `${action}-${resourceId}-${this.now()}`, tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, action, resourceType, resourceId, outcome, createdAt: new Date(this.now()).toISOString() })
  }

  private async recordOutbox(context: TusAuthenticatedTenantContext, eventType: string, aggregateId: string, payload: unknown): Promise<void> {
    await this.store.outbox.append({ eventId: `${eventType}-${aggregateId}-${this.now()}`, tenantId: context.tenantId, correlationId: context.correlationId, eventType, aggregateId, payload: structuredClone(payload) as Record<string, unknown>, status: 'pending', attempts: 0, createdAt: new Date(this.now()).toISOString() })
  }
}

function isAllowedTransition(from: DeliveryTaskStatus, to: DeliveryTaskStatus): boolean {
  return (from === 'queued' && to === 'accepted') || (from === 'accepted' && to === 'picked-up') || (from === 'picked-up' && to === 'in-transit') || (from === 'in-transit' && to === 'handed-off') || (from === 'handed-off' && to === 'delivered')
}

function validInterval(start: string, end: string): boolean {
  return Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end)) && Date.parse(end) > Date.parse(start)
}

function key(tenantId: string, id: string): string {
  return `${tenantId}:${id}`
}

function clone<T>(value: T): T {
  return value === null ? value : structuredClone(value)
}

export default { DeliveryError, InMemoryDeliveryStore, TusDeliveryService }
