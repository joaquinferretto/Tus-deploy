import type {
  RegistroAuditoriaEntrega,
  IncidenteEntrega,
  ComprobanteEntrega,
  DeliveryShift,
  DeliveryStorePort,
  TareaEntrega,
  ZonaEntrega,
  DeliveryOutboxRecord,
} from '../delivery/index.ts'
import { PosError, type RegistroAuditoriaPOS, type PosCommandResult, type ConflictoPuntoVenta, type PosDevice, type OperacionManualPuntoVenta, type PosOutboxRecord, type ComprobantePuntoVenta, type SesionPuntoVenta, type PosStorePort } from '../pos/index.ts'

type Row = any

interface DeliveryPrismaClient {
  zonaEntrega: Delegate
  turnoEntrega: Delegate
  tareaEntrega: Delegate
  evidenciaEntrega: Delegate
  incidenteEntrega: Delegate
  auditoriaEntrega: Delegate
  outboxEntrega: Delegate
  operacionPOS: Delegate
  comprobantePOS: Delegate
  auditoriaPOS: Delegate
  dispositivoPOS: Delegate
  sesionPOS: Delegate
  conflictoPOS: Delegate
  outboxPOS: Delegate
  versionPOS: Delegate
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
    save: async (zone: ZonaEntrega) => {
      await this.client.zonaEntrega.create({ data: { id: zone.zoneId, tenantId: zone.tenantId, zonaId: zone.zoneId, nombre: zone.name, codigosPostales: zone.postalCodes, activo: zone.active, fechaCreacion: new Date(), fechaActualizacion: new Date() } })
    },
    find: async (tenantId: string, zoneId: string) => {
      const row = await this.client.zonaEntrega.findUnique({ where: { tenantId_zonaId: { tenantId, zonaId: zoneId } } })
      return row ? mapZone(row) : null
    },
  }

  readonly shifts = {
    save: async (shift: DeliveryShift) => {
      await this.client.turnoEntrega.create({ data: { id: shift.shiftId, tenantId: shift.tenantId, turnoId: shift.shiftId, zonaId: shift.zoneId, fechaInicio: new Date(shift.startsAt), fechaFin: new Date(shift.endsAt), idsOperadores: shift.operatorIds, estado: shift.status, fechaCreacion: new Date(), fechaActualizacion: new Date() } })
    },
    find: async (tenantId: string, shiftId: string) => {
      const row = await this.client.turnoEntrega.findUnique({ where: { tenantId_turnoId: { tenantId, turnoId: shiftId } } })
      return row ? mapShift(row) : null
    },
  }

  readonly tasks = {
    save: async (task: TareaEntrega) => {
      const data = { id: task.taskId, tenantId: task.tenantId, tareaId: task.taskId, compromisoId: task.commitmentId, prestadorId: task.merchantId, contexto: task.context, zonaId: task.zoneId, turnoId: task.shiftId, operadorId: task.operatorId, estado: task.status, version: task.version, evidencia: task.proof, incidente: task.incident, sla: task.sla, retiro: task.pickup, entrega: task.dropoff, fechaCancelacion: task.cancelledAt ? new Date(task.cancelledAt) : null, motivoFallo: task.failureReason, reclamoLiquidacion: task.settlementClaim, fechaCreacion: new Date(task.createdAt), fechaActualizacion: new Date(task.updatedAt) }
      const existing = await this.client.tareaEntrega.findUnique({ where: { tenantId_tareaId: { tenantId: task.tenantId, tareaId: task.taskId } } })
      if (existing) await this.client.tareaEntrega.update({ where: { tenantId_tareaId: { tenantId: task.tenantId, tareaId: task.taskId } }, data })
      else await this.client.tareaEntrega.create({ data })
    },
    find: async (tenantId: string, taskId: string) => {
      const row = await this.client.tareaEntrega.findUnique({ where: { tenantId_tareaId: { tenantId, tareaId: taskId } } })
      return row ? mapTask(row) : null
    },
    forTenant: async (tenantId: string) => (await this.client.tareaEntrega.findMany({ where: { tenantId } })).map(mapTask),
  }

  readonly proofs = {
    save: async (proof: ComprobanteEntrega) => { await this.client.evidenciaEntrega.create({ data: { id: proof.proofId, tenantId: proof.tenantId, evidenciaId: proof.proofId, tareaId: proof.taskId, compromisoId: proof.commitmentId, nombreDestinatario: proof.recipientName, fechaCaptura: new Date(proof.capturedAt), origenEvidencia: proof.evidenceSource, fechaCreacion: new Date() } }) },
    find: async (tenantId: string, proofId: string) => { const row = await this.client.evidenciaEntrega.findUnique({ where: { tenantId_evidenciaId: { tenantId, evidenciaId: proofId } } }); return row ? mapProof(row) : null },
  }

  readonly incidents = {
    save: async (incident: IncidenteEntrega) => { await this.client.incidenteEntrega.create({ data: { id: incident.incidentId, tenantId: incident.tenantId, incidenteId: incident.incidentId, tareaId: incident.taskId, motivo: incident.reason, estado: incident.status, fechaCreacion: new Date(incident.createdAt) } }) },
    find: async (tenantId: string, incidentId: string) => { const row = await this.client.incidenteEntrega.findUnique({ where: { tenantId_incidenteId: { tenantId, incidenteId: incidentId } } }); return row ? mapIncident(row) : null },
  }

  readonly audit = {
    append: async (record: RegistroAuditoriaEntrega) => { await this.client.auditoriaEntrega.create({ data: { id: record.auditId, tenantId: record.tenantId, auditoriaId: record.auditId, actorId: record.actorId, correlacionId: record.correlationId, accion: record.action, tipoRecurso: record.resourceType, recursoId: record.resourceId, resultado: record.outcome, fechaCreacion: new Date(record.createdAt) } }) },
    list: (_tenantId: string): RegistroAuditoriaEntrega[] => { throw new Error('Tenant-scoped audit listing is exposed through reporting adapters') },
  }

  readonly outbox = {
    append: async (record: DeliveryOutboxRecord) => { await this.client.outboxEntrega.create({ data: { id: record.eventId, tenantId: record.tenantId, eventoId: record.eventId, correlacionId: record.correlationId, tipoEvento: record.eventType, agregadoId: record.aggregateId, datosEvento: record.payload, estado: record.status, intentos: record.attempts, fechaCreacion: new Date(record.createdAt) } }) },
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
    const row = await this.client.operacionPOS.findUnique({ where: { tenantId_claveIdempotencia: { tenantId, claveIdempotencia: idempotencyKey } } })
    if (!row?.respuesta) return null
    return { fingerprint: String(row.respuesta['fingerprint']), response: row.respuesta['response'] as PosCommandResult }
  }

  async saveIdempotency(tenantId: string, idempotencyKey: string, value: { fingerprint: string; response: PosCommandResult }): Promise<void> {
    const operationId = value.response.status === 'accepted' ? value.response.operation.operationId : value.response.operationId
    await this.client.operacionPOS.update({ where: { tenantId_operacionId: { tenantId, operacionId: operationId } }, data: { respuesta: { fingerprint: value.fingerprint, response: value.response } } })
    void idempotencyKey
  }

  async getVersion(tenantId: string, shiftId: string): Promise<number> {
    const row = await this.client.versionPOS.findUnique({ where: { tenantId_turnoId: { tenantId, turnoId: shiftId } } })
    return Number(row?.version ?? 0)
  }

  async incrementVersion(tenantId: string, shiftId: string, expectedVersion?: number): Promise<number> {
    const currentVersion = await this.getVersion(tenantId, shiftId)
    const expected = expectedVersion ?? currentVersion
    if (currentVersion !== expected) throw versionConflictError()
    if (currentVersion === 0) {
      try {
        await this.client.versionPOS.create({ data: { id: `${tenantId}:${shiftId}`, tenantId, turnoId: shiftId, version: 1, fechaCreacion: new Date(), fechaActualizacion: new Date() } })
        return 1
      } catch {
        const refreshedVersion = await this.getVersion(tenantId, shiftId)
        if (refreshedVersion !== expected) throw versionConflictError()
        throw new Error('POS shift version could not be initialized')
      }
    }
    const result = await this.client.versionPOS.updateMany({ where: { tenantId, turnoId: shiftId, version: expected }, data: { version: { increment: 1 }, fechaActualizacion: new Date() } })
    if (result.count !== 1) throw versionConflictError()
    return expected + 1
  }

  async saveOperation(operation: OperacionManualPuntoVenta): Promise<void> {
    await this.client.operacionPOS.create({ data: { id: operation.operationId, tenantId: operation.tenantId, operacionId: operation.operationId, claveIdempotencia: operation.idempotencyKey, versionEsquema: operation.schemaVersion, actorId: operation.actorId, dispositivoId: operation.deviceId, turnoId: operation.shiftId, fechaCreacion: new Date(operation.createdAt), versionEsperada: operation.expectedVersion, tipo: operation.kind, contexto: operation.context, monto: operation.amount, moneda: operation.currency, respuesta: null } })
  }

  async saveReceipt(receipt: ComprobantePuntoVenta): Promise<void> { await this.client.comprobantePOS.create({ data: { id: receipt.receiptId, tenantId: receipt.tenantId, comprobanteId: receipt.receiptId, operacionId: receipt.operationId, tipo: receipt.kind, contexto: receipt.context, monto: receipt.amount, moneda: receipt.currency, estado: receipt.status, origen: receipt.source, capturaProveedor: receipt.providerCapture, liquidacion: receipt.settlement, hashIntegridad: receipt.integrityHash, fechaCreacion: new Date(receipt.createdAt) } }) }
  async listOperations(tenantId: string): Promise<OperacionManualPuntoVenta[]> { return (await this.client.operacionPOS.findMany({ where: { tenantId } })).map(mapOperation) }
  async listReceipts(tenantId: string): Promise<ComprobantePuntoVenta[]> { return (await this.client.comprobantePOS.findMany({ where: { tenantId } })).map(mapReceipt) }
  async saveAudit(record: RegistroAuditoriaPOS): Promise<void> { await this.client.auditoriaPOS.create({ data: { id: record.auditId, tenantId: record.tenantId, auditoriaId: record.auditId, actorId: record.actorId, correlacionId: record.correlationId, accion: record.action, operacionId: record.operationId, resultado: record.outcome, fechaCreacion: new Date(record.createdAt) } }) }
  async listAudit(tenantId: string): Promise<RegistroAuditoriaPOS[]> { return this.listAuditRecords(tenantId) }
  async getDevice(tenantId: string, deviceId: string): Promise<PosDevice | null> { const row = await this.client.dispositivoPOS.findUnique({ where: { tenantId_dispositivoId: { tenantId, dispositivoId: deviceId } } }); return row ? mapDevice(row) : null }
  async saveDevice(device: PosDevice): Promise<void> { const data = { id: device.deviceId, tenantId: device.tenantId, dispositivoId: device.deviceId, etiqueta: device.label, huella: device.fingerprint, estado: device.status, fechaCreacion: new Date(device.createdAt), fechaActualizacion: new Date(device.updatedAt) }; const existing = await this.client.dispositivoPOS.findUnique({ where: { tenantId_dispositivoId: { tenantId: device.tenantId, dispositivoId: device.deviceId } } }); if (existing) await this.client.dispositivoPOS.update({ where: { tenantId_dispositivoId: { tenantId: device.tenantId, dispositivoId: device.deviceId } }, data }); else await this.client.dispositivoPOS.create({ data }) }
  async getSession(tenantId: string, sessionId: string): Promise<SesionPuntoVenta | null> { const row = await this.client.sesionPOS.findUnique({ where: { tenantId_sesionId: { tenantId, sesionId: sessionId } } }); return row ? mapSession(row) : null }
  async findOpenSession(tenantId: string, deviceId: string, shiftId: string, actorId: string): Promise<SesionPuntoVenta | null> { const rows = await this.client.sesionPOS.findMany({ where: { tenantId, dispositivoId: deviceId, turnoId: shiftId, actorId, estado: 'open' } }); return rows[0] ? mapSession(rows[0]) : null }
  async saveSession(session: SesionPuntoVenta): Promise<void> { const data = { id: session.sessionId, tenantId: session.tenantId, sesionId: session.sessionId, dispositivoId: session.deviceId, actorId: session.actorId, turnoId: session.shiftId, estado: session.status, fechaApertura: new Date(session.openedAt), ...(session.closedAt ? { fechaCierre: new Date(session.closedAt) } : {}) }; const existing = await this.client.sesionPOS.findUnique({ where: { tenantId_sesionId: { tenantId: session.tenantId, sesionId: session.sessionId } } }); if (existing) await this.client.sesionPOS.update({ where: { tenantId_sesionId: { tenantId: session.tenantId, sesionId: session.sessionId } }, data }); else await this.client.sesionPOS.create({ data }) }
  async saveConflict(conflict: ConflictoPuntoVenta): Promise<void> { const data = { id: conflict.conflictId, tenantId: conflict.tenantId, conflictoId: conflict.conflictId, operacionId: conflict.operationId, motivo: conflict.reason, versionEsperada: conflict.expectedVersion, versionActual: conflict.actualVersion, estado: conflict.status, fechaCreacion: new Date(conflict.createdAt) }; const existing = await this.client.conflictoPOS.findUnique({ where: { tenantId_conflictoId: { tenantId: conflict.tenantId, conflictoId: conflict.conflictId } } }); if (existing) await this.client.conflictoPOS.update({ where: { tenantId_conflictoId: { tenantId: conflict.tenantId, conflictoId: conflict.conflictId } }, data }); else await this.client.conflictoPOS.create({ data }) }
  async listConflicts(tenantId: string): Promise<ConflictoPuntoVenta[]> { return (await this.client.conflictoPOS.findMany({ where: { tenantId } })).map(mapConflict) }
  readonly outbox = {
    append: async (record: PosOutboxRecord) => {
      await this.client.outboxPOS.create({ data: {
        id: record.eventId,
        tenantId: record.tenantId,
        eventoId: record.eventId,
        tipoEvento: record.eventType,
        agregadoId: record.aggregateId,
        datosEvento: record.payload,
        estado: record.status,
        intentos: record.attempts,
        disponibleDesde: new Date(record.availableAt ?? record.createdAt),
        ultimoError: record.lastError ?? null,
        reclamoProcesamientoId: record.claimId ?? null,
        reclamadoHasta: record.claimUntil ? new Date(record.claimUntil) : null,
        fechaPublicacion: record.publishedAt ? new Date(record.publishedAt) : null,
        fechaCreacion: new Date(record.createdAt),
      } })
    },
    list: async (tenantId: string): Promise<PosOutboxRecord[]> => this.listOutboxRecords(tenantId),
    claim: async (tenantId: string, workerId: string, now: number, leaseMs: number): Promise<PosOutboxRecord | null> => {
      const rows = await this.client.outboxPOS.findMany({ where: { tenantId, estado: 'pending', disponibleDesde: { lte: new Date(now) } } })
      const row = rows.find((candidate) => candidate['reclamadoHasta'] === null || candidate['reclamadoHasta'] === undefined || new Date(String(candidate['reclamadoHasta'])).getTime() <= now)
      if (!row) return null
      const attempts = Number(row['intentos'] ?? 0) + 1
      const claimId = `${workerId}:${String(row['eventoId'] ?? row['id'])}:${attempts}`
      const result = await this.client.outboxPOS.updateMany({ where: { id: String(row['id']), tenantId, estado: 'pending' }, data: { intentos: attempts, reclamoProcesamientoId: claimId, reclamadoHasta: new Date(now + leaseMs) } })
      return result.count === 1 ? fromPrismaPosOutbox(row, { attempts, claimId, claimUntil: new Date(now + leaseMs).toISOString() }) : null
    },
    acknowledge: async ({ tenantId, eventId, claimId, publishedAt }: { tenantId: string; eventId: string; claimId: string; publishedAt: number }): Promise<boolean> => {
      const result = await this.client.outboxPOS.updateMany({ where: { id: eventId, tenantId, estado: 'pending', reclamoProcesamientoId: claimId }, data: { estado: 'published', reclamoProcesamientoId: null, reclamadoHasta: null, fechaPublicacion: new Date(publishedAt) } })
      return result.count === 1
    },
    recover: async (now: number): Promise<number> => {
      const result = await this.client.outboxPOS.updateMany({ where: { estado: 'pending', reclamadoHasta: { lte: new Date(now) } }, data: { reclamoProcesamientoId: null, reclamadoHasta: null, disponibleDesde: new Date(now) } })
      return result.count
    },
  }
  async listOutbox(tenantId: string): Promise<PosOutboxRecord[]> { return this.listOutboxRecords(tenantId) }

  async listAuditRecords(tenantId: string): Promise<RegistroAuditoriaPOS[]> {
    return (await this.client.auditoriaPOS.findMany({ where: { tenantId } })).map(mapearAuditoriaPOS)
  }

  async listOutboxRecords(tenantId: string): Promise<PosOutboxRecord[]> {
    return (await this.client.outboxPOS.findMany({ where: { tenantId } })).map(mapOutbox)
  }
}

function mapZone(row: Row): ZonaEntrega { return { zoneId: row.zonaId, tenantId: row.tenantId, name: row.nombre, postalCodes: [...row.codigosPostales], active: row.activo } }
function mapShift(row: Row): DeliveryShift { return { shiftId: row.turnoId, tenantId: row.tenantId, zoneId: row.zonaId, startsAt: row.fechaInicio.toISOString(), endsAt: row.fechaFin.toISOString(), operatorIds: [...row.idsOperadores], status: row.estado } }
function mapTask(row: Row): TareaEntrega { return { contractVersion: '1.0.0', taskId: row.tareaId, tenantId: row.tenantId, commitmentId: row.compromisoId, merchantId: row.prestadorId, context: row.contexto, zoneId: row.zonaId, shiftId: row.turnoId, operatorId: row.operadorId, status: row.estado, version: row.version, proof: row.evidencia, incident: row.incidente, sla: row.sla ?? { pickupDueAt: row.fechaCreacion.toISOString(), dropoffDueAt: row.fechaActualizacion.toISOString(), status: 'on-time', breachedAt: null }, pickup: row.retiro ?? { pickedUpAt: null, inTransitAt: null }, dropoff: row.entrega ?? { handedOffAt: null }, cancelledAt: row.fechaCancelacion ? row.fechaCancelacion.toISOString() : null, failureReason: row.motivoFallo ?? null, settlementClaim: row.reclamoLiquidacion, createdAt: row.fechaCreacion.toISOString(), updatedAt: row.fechaActualizacion.toISOString() } }
function mapProof(row: Row): ComprobanteEntrega { return { contractVersion: '1.0.0', proofId: row.evidenciaId, tenantId: row.tenantId, taskId: row.tareaId, commitmentId: row.compromisoId, recipientName: row.nombreDestinatario, capturedAt: row.fechaCaptura.toISOString(), evidenceSource: row.origenEvidencia } }
function mapIncident(row: Row): IncidenteEntrega { return { contractVersion: '1.0.0', incidentId: row.incidenteId, tenantId: row.tenantId, taskId: row.tareaId, reason: row.motivo, status: row.estado, createdAt: row.fechaCreacion.toISOString() } }
function mapOperation(row: Row): OperacionManualPuntoVenta { return { contractVersion: '1.0.0', operationId: row.operacionId, idempotencyKey: row.claveIdempotencia, schemaVersion: row.versionEsquema, tenantId: row.tenantId, actorId: row.actorId, deviceId: row.dispositivoId, shiftId: row.turnoId, createdAt: row.fechaCreacion.toISOString(), ...(row.versionEsperada === null ? {} : { expectedVersion: row.versionEsperada }), kind: row.tipo, context: row.contexto, amount: row.monto, currency: row.moneda } }
function mapReceipt(row: Row): ComprobantePuntoVenta { return { contractVersion: '1.0.0', receiptId: row.comprobanteId, tenantId: row.tenantId, operationId: row.operacionId, kind: row.tipo, context: row.contexto, amount: row.monto, currency: row.moneda, status: row.estado, source: row.origen, providerCapture: row.capturaProveedor, settlement: row.liquidacion, integrityHash: row.hashIntegridad, createdAt: row.fechaCreacion.toISOString() } as ComprobantePuntoVenta }
function mapDevice(row: Row): PosDevice { return { contractVersion: '1.0.0', deviceId: row.dispositivoId, tenantId: row.tenantId, label: row.etiqueta, fingerprint: row.huella, status: row.estado, createdAt: row.fechaCreacion.toISOString(), updatedAt: row.fechaActualizacion.toISOString() } }
function mapSession(row: Row): SesionPuntoVenta { return { contractVersion: '1.0.0', sessionId: row.sesionId, tenantId: row.tenantId, deviceId: row.dispositivoId, actorId: row.actorId, shiftId: row.turnoId, status: row.estado, openedAt: row.fechaApertura.toISOString(), ...(row.fechaCierre ? { closedAt: row.fechaCierre.toISOString() } : {}) } }
function mapConflict(row: Row): ConflictoPuntoVenta { return { contractVersion: '1.0.0', conflictId: row.conflictoId, tenantId: row.tenantId, operationId: row.operacionId, reason: row.motivo, ...(row.versionEsperada === null ? {} : { expectedVersion: row.versionEsperada }), ...(row.versionActual === null ? {} : { actualVersion: row.versionActual }), status: row.estado, createdAt: row.fechaCreacion.toISOString() } }
function mapearAuditoriaPOS(row: Row): RegistroAuditoriaPOS { return { auditId: row.auditoriaId, tenantId: row.tenantId, actorId: row.actorId, correlationId: row.correlacionId, action: row.accion, operationId: row.operacionId, outcome: row.resultado, createdAt: row.fechaCreacion.toISOString() } }
function mapOutbox(row: Row): PosOutboxRecord { return fromPrismaPosOutbox(row) }

function fromPrismaPosOutbox(row: Row, overrides: Partial<PosOutboxRecord> = {}): PosOutboxRecord {
  return {
    eventId: String(row.eventoId ?? row.id),
    tenantId: String(row.tenantId),
    eventType: String(row.tipoEvento),
    aggregateId: String(row.agregadoId),
    payload: row.datosEvento as Record<string, unknown>,
    status: row.estado as PosOutboxRecord['status'],
    attempts: Number(row.intentos ?? 0),
    availableAt: new Date(String(row.disponibleDesde ?? row.fechaCreacion)).toISOString(),
    lastError: row.ultimoError === null || row.ultimoError === undefined ? null : String(row.ultimoError),
    claimId: row.reclamoProcesamientoId === null || row.reclamoProcesamientoId === undefined ? null : String(row.reclamoProcesamientoId),
    claimUntil: row.reclamadoHasta ? new Date(String(row.reclamadoHasta)).toISOString() : null,
    publishedAt: row.fechaPublicacion ? new Date(String(row.fechaPublicacion)).toISOString() : null,
    createdAt: new Date(String(row.fechaCreacion)).toISOString(),
    ...overrides,
  }
}

function versionConflictError(): PosError {
  return new PosError(409, 'VERSION_CONFLICT', 'POS shift version differs from the offline expectation')
}
