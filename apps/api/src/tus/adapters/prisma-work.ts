import {
  TUS_CONTRACT_VERSION,
  type AceptacionPresupuesto,
  type Diagnostico,
  type EstadoPresupuesto,
  type EvidenciaTrabajo,
  type Presupuesto,
  type Trabajo,
} from '@factory/contracts'
import type {
  PrismaAceptacionPresupuestoDelegate,
  PrismaDiagnosticoDelegate,
  PrismaEvidenciaTrabajoDelegate,
  PrismaLineaPresupuestoDelegate,
  PrismaPresupuestoDelegate,
  PrismaTrabajoDelegate,
  PrismaTransicionTrabajoDelegate,
  TusPrismaClient,
} from './prisma.ts'
import {
  TrabajoError,
  type AuditoriaTrabajo,
  type PresupuestoPersistido,
  type TrabajoIdempotencyClaim,
  type TrabajoIdempotencyPort,
  type TrabajoOutboxPort,
  type TrabajoOutboxRecord,
  type TrabajoReservaPort,
  type TrabajoStorePort,
  type TrabajoTransactionPort,
  type TrabajoTransactionRepositories,
  type TransicionTrabajo,
} from '../work/index.ts'

export class PrismaTrabajoStore implements TrabajoStorePort {
  constructor(private readonly client: TusPrismaClient) {}

  async findAccessible(input: { tenantId: string; trabajoId: string }): Promise<Trabajo | null> {
    const row = await this.client.trabajo.findFirst({
      where: {
        trabajoId: input.trabajoId,
        OR: [{ tenantId: input.tenantId }, { prestadorTenantId: input.tenantId }],
      },
    })
    return row ? mapTrabajo(row) : null
  }

  async findByCommitment(input: {
    tenantId: string
    commitmentId: string
  }): Promise<Trabajo | null> {
    const row = await this.client.trabajo.findFirst({
      where: { tenantId: input.tenantId, compromisoId: input.commitmentId },
    })
    return row ? mapTrabajo(row) : null
  }

  async findByReservation(input: {
    prestadorTenantId: string
    reservationId: string
  }): Promise<Trabajo | null> {
    const row = await this.client.trabajo.findFirst({
      where: { reservaTenantId: input.prestadorTenantId, reservaId: input.reservationId },
    })
    return row ? mapTrabajo(row) : null
  }

  async listAccessible(tenantId: string): Promise<Trabajo[]> {
    const rows = await this.client.trabajo.findMany({
      where: { OR: [{ tenantId }, { prestadorTenantId: tenantId }] },
      orderBy: { fechaActualizacion: 'desc' },
    })
    return rows.map(mapTrabajo)
  }

  async createWork(work: Trabajo): Promise<void> {
    await this.client.trabajo.create({
      data: {
        id: work.trabajoId,
        versionContrato: work.contractVersion,
        trabajoId: work.trabajoId,
        tenantId: work.tenantId,
        prestadorTenantId: work.prestadorTenantId,
        compromisoId: work.commitmentId,
        prestadorId: work.prestadorId,
        publicacionId: work.publicacionId,
        reservaTenantId: work.reservaId ? work.prestadorTenantId : null,
        reservaId: work.reservaId ?? null,
        clienteId: work.clienteId ?? null,
        estado: work.status,
        version: work.version,
        requierePresupuesto: work.budgetRequired,
        presupuestoAceptadoId: work.acceptedBudgetId ?? null,
        presupuestoAceptadoVersion: work.acceptedBudgetVersion ?? null,
        fechaCreacion: new Date(work.createdAt),
        fechaActualizacion: new Date(work.updatedAt),
      },
    })
  }

  async updateWork(input: {
    tenantId: string
    trabajoId: string
    expectedVersion: number
    work: Trabajo
  }): Promise<Trabajo | null> {
    const result = await this.client.trabajo.updateMany({
      where: {
        tenantId: input.tenantId,
        trabajoId: input.trabajoId,
        version: input.expectedVersion,
      },
      data: {
        estado: input.work.status,
        version: input.work.version,
        presupuestoAceptadoId: input.work.acceptedBudgetId ?? null,
        presupuestoAceptadoVersion: input.work.acceptedBudgetVersion ?? null,
        fechaActualizacion: new Date(input.work.updatedAt),
      },
    })
    return result.count === 0 ? null : input.work
  }

  async appendTransition(transition: TransicionTrabajo): Promise<void> {
    await this.client.transicionTrabajo.create({
      data: {
        id: transition.transitionId,
        tenantId: transition.tenantId,
        trabajoId: transition.trabajoId,
        estadoAnterior: transition.previousStatus,
        estadoNuevo: transition.status,
        version: transition.version,
        actorId: transition.actorId,
        correlacionId: transition.correlationId,
        motivo: transition.reason,
        fechaCreacion: new Date(transition.createdAt),
      },
    })
  }

  async listTransitions(input: {
    tenantId: string
    trabajoId: string
  }): Promise<TransicionTrabajo[]> {
    const rows = await this.client.transicionTrabajo.findMany({
      where: { tenantId: input.tenantId, trabajoId: input.trabajoId },
      orderBy: { version: 'asc' },
    })
    return rows.map((row) => ({
      transitionId: stringValue(row, 'id'),
      tenantId: stringValue(row, 'tenantId'),
      trabajoId: stringValue(row, 'trabajoId'),
      previousStatus: nullableStringValue(
        row,
        'estadoAnterior'
      ) as TransicionTrabajo['previousStatus'],
      status: stringValue(row, 'estadoNuevo') as TransicionTrabajo['status'],
      version: numberValue(row, 'version'),
      actorId: stringValue(row, 'actorId'),
      correlationId: stringValue(row, 'correlacionId'),
      reason: stringValue(row, 'motivo'),
      createdAt: dateValue(row, 'fechaCreacion'),
    }))
  }

  async findDiagnosis(input: {
    tenantId: string
    trabajoId: string
    diagnosticoId: string
  }): Promise<Diagnostico | null> {
    const row = await this.client.diagnostico.findFirst({
      where: {
        tenantId: input.tenantId,
        trabajoId: input.trabajoId,
        diagnosticoId: input.diagnosticoId,
      },
    })
    return row ? mapDiagnostico(row) : null
  }

  async listDiagnoses(input: { tenantId: string; trabajoId: string }): Promise<Diagnostico[]> {
    const rows = await this.client.diagnostico.findMany({
      where: { tenantId: input.tenantId, trabajoId: input.trabajoId },
      orderBy: { version: 'asc' },
    })
    return rows.map(mapDiagnostico)
  }

  async createDiagnosis(diagnosis: Diagnostico): Promise<void> {
    await this.client.diagnostico.create({
      data: {
        id: diagnosis.diagnosticoId,
        versionContrato: diagnosis.contractVersion,
        diagnosticoId: diagnosis.diagnosticoId,
        tenantId: diagnosis.tenantId,
        trabajoId: diagnosis.trabajoId,
        version: diagnosis.version,
        estado: diagnosis.status,
        descripcionOriginal: diagnosis.originalDescription,
        datosEstructurados: diagnosis.structuredData ?? null,
        actorId: diagnosis.actorId,
        correlacionId: diagnosis.correlationId,
        fechaConfirmacion: diagnosis.confirmedAt ? new Date(diagnosis.confirmedAt) : null,
        fechaCreacion: new Date(diagnosis.createdAt),
        fechaActualizacion: new Date(diagnosis.updatedAt),
      },
    })
  }

  async updateDiagnosis(input: {
    tenantId: string
    trabajoId: string
    diagnosticoId: string
    expectedVersion: number
    diagnosis: Diagnostico
  }): Promise<Diagnostico | null> {
    const result = await this.client.diagnostico.updateMany({
      where: {
        tenantId: input.tenantId,
        trabajoId: input.trabajoId,
        diagnosticoId: input.diagnosticoId,
        version: input.expectedVersion,
      },
      data: {
        estado: input.diagnosis.status,
        version: input.diagnosis.version,
        fechaConfirmacion: input.diagnosis.confirmedAt
          ? new Date(input.diagnosis.confirmedAt)
          : null,
        fechaActualizacion: new Date(input.diagnosis.updatedAt),
      },
    })
    return result.count === 0 ? null : input.diagnosis
  }

  async findBudget(input: {
    tenantId: string
    trabajoId: string
    presupuestoId: string
    version: number
  }): Promise<PresupuestoPersistido | null> {
    const row = await this.client.presupuesto.findFirst({
      where: {
        tenantId: input.tenantId,
        trabajoId: input.trabajoId,
        presupuestoId: input.presupuestoId,
        version: input.version,
      },
    })
    return row ? this.mapPresupuesto(row) : null
  }

  async listBudgets(input: {
    tenantId: string
    trabajoId: string
  }): Promise<PresupuestoPersistido[]> {
    const rows = await this.client.presupuesto.findMany({
      where: { tenantId: input.tenantId, trabajoId: input.trabajoId },
      orderBy: { version: 'asc' },
    })
    return Promise.all(rows.map((row) => this.mapPresupuesto(row)))
  }

  async createBudget(budget: PresupuestoPersistido): Promise<void> {
    await this.client.presupuesto.create({
      data: {
        id: budget.recordId,
        versionContrato: budget.contractVersion,
        presupuestoId: budget.presupuestoId,
        tenantId: budget.tenantId,
        prestadorTenantId: budget.prestadorTenantId,
        trabajoId: budget.trabajoId,
        version: budget.version,
        estado: budget.status,
        moneda: budget.currency,
        montoTotal: BigInt(budget.totalMinor),
        alcance: budget.scope,
        fechaValidez: budget.validUntil ? new Date(budget.validUntil) : null,
        creadoPor: budget.createdBy,
        correlacionId: budget.correlationId,
        fechaCreacion: new Date(budget.createdAt),
        fechaActualizacion: new Date(budget.updatedAt),
      },
    })
    await this.client.lineaPresupuesto.createMany({
      data: budget.lines.map((line, index) => ({
        id: `${budget.recordId}:${line.lineId}`,
        lineaId: line.lineId,
        presupuestoRegistroId: budget.recordId,
        descripcion: line.description,
        cantidad: line.quantity,
        montoUnitario: BigInt(line.unitAmountMinor),
        montoTotal: BigInt(line.totalAmountMinor),
        orden: index,
        fechaCreacion: new Date(budget.createdAt),
      })),
    })
  }

  async updateBudgetStatus(input: {
    recordId: string
    expectedStatus: EstadoPresupuesto
    status: EstadoPresupuesto
    updatedAt: string
  }): Promise<PresupuestoPersistido | null> {
    const result = await this.client.presupuesto.updateMany({
      where: { id: input.recordId, estado: input.expectedStatus },
      data: { estado: input.status, fechaActualizacion: new Date(input.updatedAt) },
    })
    if (result.count === 0) return null
    const row = await this.client.presupuesto.findFirst({ where: { id: input.recordId } })
    return row ? this.mapPresupuesto(row) : null
  }

  async findBudgetDecision(input: {
    tenantId: string
    recordId: string
  }): Promise<AceptacionPresupuesto | null> {
    const [budget, row] = await Promise.all([
      this.client.presupuesto.findFirst({
        where: { id: input.recordId, tenantId: input.tenantId },
      }),
      this.client.aceptacionPresupuesto.findFirst({
        where: { tenantId: input.tenantId, presupuestoRegistroId: input.recordId },
      }),
    ])
    if (!budget || !row) return null
    return mapAceptacion(row, budget)
  }

  async createBudgetDecision(
    decision: AceptacionPresupuesto & { budgetRecordId: string; correlationId: string }
  ): Promise<void> {
    await this.client.aceptacionPresupuesto.create({
      data: {
        id: decision.acceptanceId,
        aceptacionId: decision.acceptanceId,
        tenantId: decision.tenantId,
        presupuestoRegistroId: decision.budgetRecordId,
        decision: decision.decision,
        actorId: decision.actorId,
        correlacionId: decision.correlationId,
        motivo: decision.reason ?? null,
        fechaCreacion: new Date(decision.createdAt),
      },
    })
  }

  async findEvidence(input: {
    tenantId: string
    evidenceId: string
  }): Promise<EvidenciaTrabajo | null> {
    const row = await this.client.evidenciaTrabajo.findFirst({
      where: { tenantId: input.tenantId, evidenciaId: input.evidenceId },
    })
    return row ? mapEvidencia(row) : null
  }

  async listEvidence(input: { tenantId: string; trabajoId: string }): Promise<EvidenciaTrabajo[]> {
    const rows = await this.client.evidenciaTrabajo.findMany({
      where: { tenantId: input.tenantId, trabajoId: input.trabajoId },
      orderBy: { fechaCreacion: 'asc' },
    })
    return rows.map(mapEvidencia)
  }

  async createEvidence(evidence: EvidenciaTrabajo): Promise<void> {
    await this.client.evidenciaTrabajo.create({
      data: {
        id: evidence.evidenceId,
        evidenciaId: evidence.evidenceId,
        tenantId: evidence.tenantId,
        prestadorTenantId: evidence.prestadorTenantId,
        trabajoId: evidence.trabajoId,
        fase: evidence.phase,
        actorId: evidence.actorId,
        correlacionId: evidence.correlationId,
        referencia: evidence.reference,
        metadatos: evidence.metadata,
        fechaOcurrencia: new Date(evidence.occurredAt),
        fechaCreacion: new Date(evidence.createdAt),
      },
    })
  }

  async appendAudit(audit: AuditoriaTrabajo): Promise<void> {
    await this.client.auditoriaTrabajo.create({
      data: {
        id: audit.auditId,
        tenantId: audit.tenantId,
        trabajoTenantId: audit.trabajoTenantId,
        prestadorTenantId: audit.prestadorTenantId,
        trabajoId: audit.trabajoId,
        actorId: audit.actorId,
        correlacionId: audit.correlationId,
        accion: audit.action,
        tipoRecurso: audit.resourceType,
        recursoId: audit.resourceId,
        resultado: audit.outcome,
        metadatos: audit.metadata,
        fechaCreacion: new Date(audit.createdAt),
      },
    })
  }

  private async mapPresupuesto(row: Record<string, unknown>): Promise<PresupuestoPersistido> {
    const recordId = stringValue(row, 'id')
    const lines = await this.client.lineaPresupuesto.findMany({
      where: { presupuestoRegistroId: recordId },
      orderBy: { orden: 'asc' },
    })
    return {
      contractVersion: stringValue(row, 'versionContrato') as typeof TUS_CONTRACT_VERSION,
      presupuestoId: stringValue(row, 'presupuestoId'),
      trabajoId: stringValue(row, 'trabajoId'),
      tenantId: stringValue(row, 'tenantId'),
      prestadorTenantId: stringValue(row, 'prestadorTenantId'),
      version: numberValue(row, 'version'),
      status: stringValue(row, 'estado') as Presupuesto['status'],
      currency: stringValue(row, 'moneda'),
      totalMinor: bigintValue(row, 'montoTotal'),
      scope: stringValue(row, 'alcance'),
      validUntil: nullableDateValue(row, 'fechaValidez'),
      createdBy: stringValue(row, 'creadoPor'),
      createdAt: dateValue(row, 'fechaCreacion'),
      updatedAt: dateValue(row, 'fechaActualizacion'),
      lines: lines.map((line) => ({
        lineId: stringValue(line, 'lineaId'),
        description: stringValue(line, 'descripcion'),
        quantity: numberValue(line, 'cantidad'),
        unitAmountMinor: bigintValue(line, 'montoUnitario'),
        totalAmountMinor: bigintValue(line, 'montoTotal'),
      })),
      recordId,
      correlationId: stringValue(row, 'correlacionId'),
    }
  }
}

export class PrismaTrabajoIdempotencyStore implements TrabajoIdempotencyPort {
  constructor(private readonly client: TusPrismaClient) {}

  async claim(input: {
    tenantId: string
    key: string
    requestHash: string
    now: number
    expiresAt: number
  }): Promise<TrabajoIdempotencyClaim> {
    const existing = await this.client.idempotencyRecord.findUnique({
      where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
    })
    if (!existing) {
      try {
        await this.client.idempotencyRecord.create({
          data: {
            id: `tus-work-idempotency-${input.tenantId}-${input.key}`,
            tenantId: input.tenantId,
            key: input.key,
            requestHash: input.requestHash,
            status: 'pending',
            response: null,
            createdAt: new Date(input.now),
            expiresAt: new Date(input.expiresAt),
          },
        })
        return { status: 'claimed' }
      } catch (error) {
        if (isUniqueConstraint(error)) return { status: 'in_progress' }
        throw error
      }
    }
    if (existing.requestHash !== input.requestHash) return { status: 'conflict' }
    if (existing.status === 'completed' && existing.response)
      return { status: 'replay', response: existing.response }
    if (existing.status === 'pending' && existing.expiresAt.getTime() <= input.now) {
      await this.client.idempotencyRecord.delete({
        where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
      })
      return this.claim(input)
    }
    return { status: 'in_progress' }
  }

  async complete(input: { tenantId: string; key: string; response: unknown }): Promise<void> {
    await this.client.idempotencyRecord.update({
      where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
      data: { status: 'completed', response: input.response },
    })
  }

  async release(input: { tenantId: string; key: string }): Promise<void> {
    await this.client.idempotencyRecord.delete({
      where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
    })
  }
}

export class PrismaTrabajoOutboxStore implements TrabajoOutboxPort {
  constructor(private readonly client: TusPrismaClient) {}

  async append(record: TrabajoOutboxRecord): Promise<void> {
    await this.client.outboxEvent.create({
      data: {
        id: record.eventId,
        tenantId: record.tenantId,
        aggregateType: 'trabajo',
        aggregateId: record.aggregateId,
        eventType: record.eventType,
        payload: record.payload,
        status: 'pending',
        attempts: 0,
        availableAt: new Date(record.createdAt),
        createdAt: new Date(record.createdAt),
      },
    })
  }

  list(_tenantId: string): TrabajoOutboxRecord[] {
    throw new Error('Tenant-scoped work outbox listing is exposed through worker adapters')
  }
}

// WEB-08H: valida y bloquea la reserva en la transaccion del trabajo. El UPDATE condicional sin
// cambio efectivo toma el lock de fila: una cancelacion concurrente espera al commit o, si ya
// modifico la fila, esta transaccion Serializable falla y se reintenta sobre el estado nuevo.
export class PrismaTrabajoReservaStore implements TrabajoReservaPort {
  constructor(private readonly client: TusPrismaClient) {}

  async lockForWork(input: {
    ownerTenantId: string
    reservationId: string
    customerTenantId: string
    listingId: string
  }): Promise<boolean> {
    const result = await this.client.reserva.updateMany({
      where: {
        tenantId: input.ownerTenantId,
        reservaId: input.reservationId,
        clienteTenantId: input.customerTenantId,
        publicacionId: input.listingId,
        estado: 'confirmed',
      },
      data: { estado: 'confirmed' },
    })
    return result.count === 1
  }

  // WEB-08I: la cancelacion del trabajo cancela la reserva en la misma transaccion. El trabajo
  // la cancela el prestador, por eso no aplica la ventana de cancelacion tardia del cliente.
  async cancelForWork(input: {
    ownerTenantId: string
    reservationId: string
    updatedAt: string
  }): Promise<boolean> {
    const result = await this.client.reserva.updateMany({
      where: { tenantId: input.ownerTenantId, reservaId: input.reservationId, estado: 'confirmed' },
      data: {
        estado: 'cancelled',
        version: { increment: 1 },
        fechaActualizacion: new Date(input.updatedAt),
      },
    })
    return result.count === 1
  }
}

export class PrismaTrabajoTransaction implements TrabajoTransactionPort {
  constructor(private readonly client: TusPrismaClient) {}

  // Un conflicto de unicidad (dos aceptaciones del mismo compromiso o reserva con distinta
  // clave) aborta la transaccion; el reintento relee y devuelve el trabajo existente como replay.
  async run<TValue>(
    operation: (repositories: TrabajoTransactionRepositories) => Promise<TValue>
  ): Promise<TValue> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.client.$transaction(
          async (client) =>
            operation({
              work: new PrismaTrabajoStore(client),
              idempotency: new PrismaTrabajoIdempotencyStore(client),
              outbox: new PrismaTrabajoOutboxStore(client),
              reservations: new PrismaTrabajoReservaStore(client),
            }),
          { isolationLevel: 'Serializable' }
        )
      } catch (error) {
        if (!isSerializationFailure(error) && !isUniqueConstraint(error)) throw error
        if (attempt === 2)
          throw new TrabajoError(
            409,
            'CONCURRENT_MODIFICATION',
            'work was changed concurrently; retry the request'
          )
      }
    }
    throw new Error('work transaction retry limit exceeded')
  }
}

export function isSerializationFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034'
}

export function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

export function mapTrabajo(row: Record<string, unknown>): Trabajo {
  return {
    contractVersion: stringValue(row, 'versionContrato') as typeof TUS_CONTRACT_VERSION,
    trabajoId: stringValue(row, 'trabajoId'),
    tenantId: stringValue(row, 'tenantId'),
    prestadorTenantId: stringValue(row, 'prestadorTenantId'),
    commitmentId: stringValue(row, 'compromisoId'),
    prestadorId: stringValue(row, 'prestadorId'),
    publicacionId: stringValue(row, 'publicacionId'),
    reservaId: nullableStringValue(row, 'reservaId'),
    clienteId: nullableStringValue(row, 'clienteId'),
    status: stringValue(row, 'estado') as Trabajo['status'],
    version: numberValue(row, 'version'),
    budgetRequired: Boolean(row['requierePresupuesto']),
    acceptedBudgetId: nullableStringValue(row, 'presupuestoAceptadoId'),
    acceptedBudgetVersion:
      row['presupuestoAceptadoVersion'] === null || row['presupuestoAceptadoVersion'] === undefined
        ? null
        : numberValue(row, 'presupuestoAceptadoVersion'),
    createdAt: dateValue(row, 'fechaCreacion'),
    updatedAt: dateValue(row, 'fechaActualizacion'),
  }
}

function mapDiagnostico(row: Record<string, unknown>): Diagnostico {
  return {
    contractVersion: stringValue(row, 'versionContrato') as typeof TUS_CONTRACT_VERSION,
    diagnosticoId: stringValue(row, 'diagnosticoId'),
    trabajoId: stringValue(row, 'trabajoId'),
    tenantId: stringValue(row, 'tenantId'),
    version: numberValue(row, 'version'),
    status: stringValue(row, 'estado') as Diagnostico['status'],
    originalDescription: stringValue(row, 'descripcionOriginal'),
    structuredData: row['datosEstructurados'] as Record<string, unknown> | null,
    actorId: stringValue(row, 'actorId'),
    correlationId: stringValue(row, 'correlacionId'),
    createdAt: dateValue(row, 'fechaCreacion'),
    updatedAt: dateValue(row, 'fechaActualizacion'),
    confirmedAt: nullableDateValue(row, 'fechaConfirmacion'),
  }
}

function mapAceptacion(
  row: Record<string, unknown>,
  budget: Record<string, unknown>
): AceptacionPresupuesto {
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    acceptanceId: stringValue(row, 'aceptacionId'),
    presupuestoId: stringValue(budget, 'presupuestoId'),
    presupuestoVersion: numberValue(budget, 'version'),
    trabajoId: stringValue(budget, 'trabajoId'),
    tenantId: stringValue(row, 'tenantId'),
    actorId: stringValue(row, 'actorId'),
    decision: stringValue(row, 'decision') as AceptacionPresupuesto['decision'],
    ...(nullableStringValue(row, 'motivo') ? { reason: nullableStringValue(row, 'motivo')! } : {}),
    createdAt: dateValue(row, 'fechaCreacion'),
  }
}

function mapEvidencia(row: Record<string, unknown>): EvidenciaTrabajo {
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    evidenceId: stringValue(row, 'evidenciaId'),
    trabajoId: stringValue(row, 'trabajoId'),
    tenantId: stringValue(row, 'tenantId'),
    prestadorTenantId: stringValue(row, 'prestadorTenantId'),
    phase: stringValue(row, 'fase') as EvidenciaTrabajo['phase'],
    actorId: stringValue(row, 'actorId'),
    correlationId: stringValue(row, 'correlacionId'),
    reference: stringValue(row, 'referencia'),
    metadata: (row['metadatos'] as Record<string, unknown> | null) ?? {},
    occurredAt: dateValue(row, 'fechaOcurrencia'),
    createdAt: dateValue(row, 'fechaCreacion'),
  }
}

function stringValue(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? '')
}
function nullableStringValue(row: Record<string, unknown>, key: string): string | null {
  return row[key] === null || row[key] === undefined ? null : String(row[key])
}
function numberValue(row: Record<string, unknown>, key: string): number {
  return Number(row[key])
}
function bigintValue(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? 0)
}
function dateValue(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}
function nullableDateValue(row: Record<string, unknown>, key: string): string | null {
  return row[key] === null || row[key] === undefined ? null : dateValue(row, key)
}

export default { PrismaTrabajoStore, PrismaTrabajoTransaction }
