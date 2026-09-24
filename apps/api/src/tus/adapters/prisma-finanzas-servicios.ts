import {
  TUS_CONTRACT_VERSION,
  parseMinorUnits,
  type EstadoDespachoPagoServicio,
  type EstadoProveedorPagoServicio,
  type OrigenIntencionPagoServicio,
  type EstadoObligacionPagoServicio,
  type EstadoPresupuesto,
  type OrigenImporteObligacionServicio,
  type Trabajo,
} from '@factory/contracts'
import {
  ErrorFinanzasServicio,
  type ObligacionServicio,
  type RegistroIdempotenciaFinanciera,
} from '../finance/servicios/modelo.ts'
import type { IntencionPagoServicioDominio } from '../finance/servicios/pagos.ts'
import type {
  InstantaneaComisionServicio,
  LiquidacionServicioDominio,
  MovimientoContableServicio,
  TipoMovimientoServicio,
} from '../finance/servicios/liquidacion.ts'
import type { ConciliacionServicio, EstadoLiquidacionServicio } from '@factory/contracts'
import type {
  PuertoComisionesServicio,
  PuertoConciliacionesServicio,
  PuertoLedgerServicio,
  PuertoLiquidacionesServicio,
  PuertoAuditoriaFinanciera,
  PuertoIdempotenciaFinanciera,
  PuertoIdentidadServicio,
  PuertoInboxEventosPago,
  PuertoIntencionesPagoServicio,
  PuertoObligacionesServicio,
  PuertoOutboxFinanciero,
  PuertoTransaccionFinanzasServicio,
  PuertoReembolsosServicio,
  ReembolsoServicioDominio,
  RegistroAuditoriaFinanciera,
  RegistroEventoProveedor,
  RegistroOutboxFinanciero,
  RepositoriosFinanzasServicio,
  ResultadoEventoProveedor,
} from '../finance/servicios/servicio.ts'
import { isSerializationFailure, isUniqueConstraint, mapTrabajo } from './prisma-work.ts'
import { asegurarSujetoFinancieroUnico } from '../finance/sujeto.ts'

// Service keys live in their own namespace inside `idempotencia_financiera`, which the legacy
// commitment finance flow shares with raw keys: the same tenant key can never collide across flows.
export function claveIdempotenciaServicio(key: string): string {
  return `servicio:${key}`
}

type Fila = Record<string, unknown>

export interface DelegadoPrismaFinanzasServicio {
  findFirst(input: { where: Fila; orderBy?: Fila }): Promise<Fila | null>
  findMany(input: { where: Fila; orderBy?: Fila }): Promise<Fila[]>
  create(input: { data: Fila }): Promise<Fila>
  updateMany(input: { where: Fila; data: Fila }): Promise<{ count: number }>
}

export interface ClientePrismaFinanzasServicio {
  trabajo: DelegadoPrismaFinanzasServicio
  compromisoMercadoServicios: DelegadoPrismaFinanzasServicio
  publicacion: DelegadoPrismaFinanzasServicio
  presupuesto: DelegadoPrismaFinanzasServicio
  obligacionPagoServicio: DelegadoPrismaFinanzasServicio
  idempotenciaFinanciera: DelegadoPrismaFinanzasServicio
  intencionPago: DelegadoPrismaFinanzasServicio
  eventoWebhookPago: DelegadoPrismaFinanzasServicio
  outboxEvent: DelegadoPrismaFinanzasServicio
  auditoriaFinanzasServicio: DelegadoPrismaFinanzasServicio
  instantaneaComision: DelegadoPrismaFinanzasServicio
  movimientoContable: DelegadoPrismaFinanzasServicio
  liquidacionServicio: DelegadoPrismaFinanzasServicio
  conciliacionServicio: DelegadoPrismaFinanzasServicio
  reembolsoServicio?: DelegadoPrismaFinanzasServicio
  $transaction<T>(
    callback: (client: ClientePrismaFinanzasServicio) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' }
  ): Promise<T>
}

export class IdentidadServicioPrisma implements PuertoIdentidadServicio {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async buscarTrabajoAccesible(input: {
    tenantId: string
    trabajoId: string
  }): Promise<Trabajo | null> {
    const row = await this.client.trabajo.findFirst({
      where: {
        trabajoId: input.trabajoId,
        OR: [{ tenantId: input.tenantId }, { prestadorTenantId: input.tenantId }],
      },
    })
    return row ? mapTrabajo(row) : null
  }

  async buscarCompromiso(input: { tenantId: string; commitmentId: string }) {
    const row = await this.client.compromisoMercadoServicios.findFirst({
      where: { tenantId: input.tenantId, compromisoId: input.commitmentId },
    })
    if (!row) return null
    return {
      tenantId: texto(row, 'tenantId'),
      commitmentId: texto(row, 'compromisoId'),
      prestadorTenantId: texto(row, 'prestadorTenantId'),
      prestadorId: texto(row, 'prestadorId'),
      publicacionId: texto(row, 'publicacionId'),
      context: texto(row, 'contexto'),
      status: texto(row, 'estado'),
      amountMinor: parseMinorUnits(row['monto']),
      currency: texto(row, 'moneda').toUpperCase(),
    }
  }

  async buscarPublicacion(input: { prestadorTenantId: string; publicacionId: string }) {
    const row = await this.client.publicacion.findFirst({
      where: { tenantId: input.prestadorTenantId, id: input.publicacionId },
    })
    if (!row) return null
    return {
      tenantId: texto(row, 'tenantId'),
      publicacionId: texto(row, 'id'),
      prestadorId: texto(row, 'prestadorId'),
      kind: texto(row, 'tipo'),
      priceMode: textoNullable(row, 'modalidadPrecio'),
      nombre: textoNullable(row, 'nombre'),
      categoria: textoNullable(row, 'cohorte'),
    }
  }

  async buscarPresupuesto(input: {
    tenantId: string
    trabajoId: string
    presupuestoId: string
    version: number
  }) {
    const row = await this.client.presupuesto.findFirst({
      where: {
        tenantId: input.tenantId,
        trabajoId: input.trabajoId,
        presupuestoId: input.presupuestoId,
        version: input.version,
      },
    })
    if (!row) return null
    return {
      tenantId: texto(row, 'tenantId'),
      prestadorTenantId: texto(row, 'prestadorTenantId'),
      trabajoId: texto(row, 'trabajoId'),
      presupuestoId: texto(row, 'presupuestoId'),
      version: Number(row['version']),
      status: texto(row, 'estado') as EstadoPresupuesto,
      currency: texto(row, 'moneda').toUpperCase(),
      totalMinor: parseMinorUnits(row['montoTotal']),
    }
  }
}

export class ObligacionesServicioPrisma implements PuertoObligacionesServicio {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async buscarPorTrabajo(input: {
    tenantId: string
    trabajoId: string
  }): Promise<ObligacionServicio | null> {
    const row = await this.client.obligacionPagoServicio.findFirst({
      where: { tenantId: input.tenantId, trabajoId: input.trabajoId },
    })
    return row ? mapearObligacion(row) : null
  }

  async buscar(input: {
    tenantId: string
    obligacionId: string
  }): Promise<ObligacionServicio | null> {
    const row = await this.client.obligacionPagoServicio.findFirst({
      where: { tenantId: input.tenantId, obligacionId: input.obligacionId },
    })
    return row ? mapearObligacion(row) : null
  }

  async crear(obligacion: ObligacionServicio): Promise<void> {
    await this.client.obligacionPagoServicio.create({ data: filaObligacion(obligacion) })
  }

  async actualizar(input: {
    obligacion: ObligacionServicio
    expectedVersion: number
  }): Promise<ObligacionServicio | null> {
    const { obligacion } = input
    const result = await this.client.obligacionPagoServicio.updateMany({
      where: {
        tenantId: obligacion.tenantId,
        obligacionId: obligacion.obligacionId,
        version: input.expectedVersion,
      },
      data: {
        estado: obligacion.status,
        version: obligacion.version,
        fechaActualizacion: new Date(obligacion.updatedAt),
      },
    })
    return result.count === 1 ? obligacion : null
  }
}

export class IdempotenciaFinancieraPrisma implements PuertoIdempotenciaFinanciera {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async buscar(input: {
    tenantId: string
    key: string
  }): Promise<RegistroIdempotenciaFinanciera | null> {
    const row = await this.client.idempotenciaFinanciera.findFirst({
      where: { tenantId: input.tenantId, claveIdempotencia: claveIdempotenciaServicio(input.key) },
    })
    if (!row) return null
    const response = row['respuesta']
    if (!response || typeof response !== 'object' || Array.isArray(response))
      throw new ErrorFinanzasServicio(
        500,
        'INVALID_REPLAY',
        'financial idempotency replay is invalid'
      )
    return {
      requestHash: texto(row, 'hashSolicitud'),
      response: response as Record<string, unknown>,
    }
  }

  // Insert-only: a concurrent claim of the same key fails with P2002 and the whole
  // transaction is retried, where it observes the committed record as replay or conflict.
  async registrar(input: {
    tenantId: string
    key: string
    record: RegistroIdempotenciaFinanciera
  }): Promise<void> {
    await this.client.idempotenciaFinanciera.create({
      data: {
        id: `finanzas-servicio-${input.tenantId}-${input.key}`,
        tenantId: input.tenantId,
        claveIdempotencia: claveIdempotenciaServicio(input.key),
        hashSolicitud: input.record.requestHash,
        respuesta: input.record.response,
      },
    })
  }
}

// Service intents share `intenciones_pago` with legacy commitment intents; they always carry
// `obligacion_id` and never `compromiso_id`. Legacy-only columns get neutral, explicit values.
export class IntencionesPagoServicioPrisma implements PuertoIntencionesPagoServicio {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async listarPorObligacion(input: { tenantId: string; obligacionId: string }) {
    const rows = await this.client.intencionPago.findMany({
      where: { tenantId: input.tenantId, obligacionId: input.obligacionId },
      orderBy: { intento: 'asc' },
    })
    return rows.map(mapearIntencion)
  }

  async buscar(input: { tenantId: string; paymentId: string }) {
    const row = await this.client.intencionPago.findFirst({
      where: { tenantId: input.tenantId, pagoId: input.paymentId, obligacionId: { not: null } },
    })
    return row ? mapearIntencion(row) : null
  }

  async buscarPorReferenciaProveedor(providerReference: string) {
    const rows = await this.client.intencionPago.findMany({
      where: {
        proveedor: 'mercado-pago',
        referenciaProveedor: providerReference,
        obligacionId: { not: null },
      },
    })
    return rows.map(mapearIntencion)
  }

  async buscarPorPaymentId(paymentId: string) {
    const rows = await this.client.intencionPago.findMany({
      where: { pagoId: paymentId, obligacionId: { not: null } },
    })
    return rows.map(mapearIntencion)
  }

  async crear(intent: IntencionPagoServicioDominio): Promise<void> {
    await this.client.intencionPago.create({
      data: asegurarSujetoFinancieroUnico(filaIntencion(intent)),
    })
  }

  async actualizar(intent: IntencionPagoServicioDominio): Promise<void> {
    const result = await this.client.intencionPago.updateMany({
      where: {
        tenantId: intent.tenantId,
        pagoId: intent.paymentId,
        obligacionId: intent.obligacionId,
      },
      data: {
        estadoProveedor: intent.providerStatus,
        estadoDespacho: intent.dispatchStatus,
        referenciaProveedor: intent.providerReference,
        errorProveedor: intent.providerError,
        fechaEventoProveedor: intent.providerEventAt ? new Date(intent.providerEventAt) : null,
        estadoComercial: estadoComercialLegacy(intent.providerStatus),
        fechaActualizacion: new Date(intent.updatedAt),
        ...camposCheckout(intent),
      },
    })
    if (result.count !== 1)
      throw new ErrorFinanzasServicio(409, 'VERSION_CONFLICT', 'payment intent was not updated')
  }
}

export class InboxEventosPagoPrisma implements PuertoInboxEventosPago {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async buscar(input: { tenantId: string; provider: string; eventId: string }) {
    const row = await this.client.eventoWebhookPago.findFirst({
      where: {
        tenantId: input.tenantId,
        proveedor: input.provider,
        eventoProveedorId: input.eventId,
      },
    })
    return row ? mapearEvento(row) : null
  }

  async registrar(record: RegistroEventoProveedor): Promise<void> {
    await this.client.eventoWebhookPago.create({
      data: {
        id: `evento-pago-${record.tenantId}-${record.provider}-${record.eventId}`,
        tenantId: record.tenantId,
        proveedor: record.provider,
        eventoProveedorId: record.eventId,
        firma: record.signature,
        fechaOcurrencia: new Date(record.occurredAt),
        datosEvento: { rawBody: record.rawBody },
        estado: record.result,
        fechaCreacion: new Date(record.receivedAt),
        pagoId: record.paymentId,
        obligacionId: record.obligacionId,
        referenciaProveedor: record.providerReference,
        estadoProveedor: record.status,
        monto: record.amountMinor,
        moneda: record.currency,
        motivo: record.reason,
        fechaRecepcion: new Date(record.receivedAt),
      },
    })
  }

  async listarPorObligacion(input: { tenantId: string; obligacionId: string }) {
    const rows = await this.client.eventoWebhookPago.findMany({
      where: { tenantId: input.tenantId, obligacionId: input.obligacionId },
      orderBy: { fechaOcurrencia: 'asc' },
    })
    return rows.map(mapearEvento)
  }
}

// Reuses the shared OutboxEvent table; no second bus.
export class OutboxFinancieroPrisma implements PuertoOutboxFinanciero {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async publicar(record: RegistroOutboxFinanciero): Promise<void> {
    await this.client.outboxEvent.create({
      data: {
        id: record.eventId,
        tenantId: record.tenantId,
        aggregateType: record.aggregateType,
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
}

export class AuditoriaFinancieraPrisma implements PuertoAuditoriaFinanciera {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async registrar(record: RegistroAuditoriaFinanciera): Promise<void> {
    await this.client.auditoriaFinanzasServicio.create({
      data: {
        id: record.auditId,
        tenantId: record.tenantId,
        prestadorTenantId: record.prestadorTenantId,
        obligacionId: record.obligacionId,
        tipoRecurso: record.resourceType,
        recursoId: record.resourceId,
        accion: record.action,
        origen: record.origin,
        actorId: record.actorId,
        correlacionId: record.correlationId,
        claveIdempotencia: record.idempotencyKey,
        estadoAnterior: record.previousStatus,
        estadoNuevo: record.status,
        metadatos: record.metadata,
        fechaCreacion: new Date(record.createdAt),
      },
    })
  }
}

// Service snapshots share `instantaneas_comision`; `(tenant_id, obligacion_id)` is unique.
export class ComisionesServicioPrisma implements PuertoComisionesServicio {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async buscar(input: {
    tenantId: string
    obligacionId: string
  }): Promise<InstantaneaComisionServicio | null> {
    const row = await this.client.instantaneaComision.findFirst({
      where: { tenantId: input.tenantId, obligacionId: input.obligacionId },
    })
    if (!row) return null
    return {
      snapshotId: texto(row, 'instantaneaId'),
      tenantId: texto(row, 'tenantId'),
      obligacionId: texto(row, 'obligacionId'),
      grossMinor: parseMinorUnits(row['montoBruto']),
      commissionableBaseMinor: parseMinorUnits(row['baseComisionable']),
      rateBps: Number(row['tasaPuntosBase']),
      ruleVersion: texto(row, 'versionRegla'),
      commissionMinor: parseMinorUnits(row['montoComision']),
      netMinor: parseMinorUnits(row['montoNeto']),
      currency: texto(row, 'moneda'),
      providerReference: texto(row, 'referenciaProveedor'),
      evidenceId: texto(row, 'evidenciaId'),
      createdAt: fecha(row, 'fechaCreacion'),
      politicaId: textoNullable(row, 'politicaComisionId'),
      pspFeeMinor:
        row['comisionProveedorPago'] == null ? null : parseMinorUnits(row['comisionProveedorPago']),
      pspFeeBearer: (textoNullable(row, 'feeProveedorACargo') ??
        'undetermined') as InstantaneaComisionServicio['pspFeeBearer'],
      providerNetMinor: row['netoPrestador'] == null ? null : parseMinorUnits(row['netoPrestador']),
    }
  }

  async crear(snapshot: InstantaneaComisionServicio): Promise<void> {
    await this.client.instantaneaComision.create({
      data: asegurarSujetoFinancieroUnico({
        id: snapshot.snapshotId,
        versionContrato: TUS_CONTRACT_VERSION,
        instantaneaId: snapshot.snapshotId,
        tenantId: snapshot.tenantId,
        compromisoId: null,
        obligacionId: snapshot.obligacionId,
        contexto: 'service',
        montoBruto: snapshot.grossMinor,
        deducciones: 0n,
        baseComisionable: snapshot.commissionableBaseMinor,
        tasaPuntosBase: snapshot.rateBps,
        versionRegla: snapshot.ruleVersion,
        montoComision: snapshot.commissionMinor,
        montoNeto: snapshot.netMinor,
        moneda: snapshot.currency,
        referenciaProveedor: snapshot.providerReference,
        evidenciaId: snapshot.evidenceId,
        estadoContable: 'held',
        fechaCreacion: new Date(snapshot.createdAt),
        politicaComisionId: snapshot.politicaId,
        comisionProveedorPago: snapshot.pspFeeMinor,
        feeProveedorACargo: snapshot.pspFeeBearer,
        netoPrestador: snapshot.providerNetMinor,
      }),
    })
  }

  async registrarFeeProveedor(input: {
    tenantId: string
    obligacionId: string
    pspFeeMinor: bigint
    providerNetMinor: bigint
  }): Promise<boolean> {
    const result = await this.client.instantaneaComision.updateMany({
      where: {
        tenantId: input.tenantId,
        obligacionId: input.obligacionId,
        comisionProveedorPago: null,
      },
      data: { comisionProveedorPago: input.pspFeeMinor, netoPrestador: input.providerNetMinor },
    })
    return result.count === 1
  }
}

// WEB-09E refund attempts (`reembolsos_servicio`), optimistic versions.
export class ReembolsosServicioPrisma implements PuertoReembolsosServicio {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  private get delegado(): DelegadoPrismaFinanzasServicio {
    if (!this.client.reembolsoServicio)
      throw new ErrorFinanzasServicio(503, 'UNAVAILABLE', 'refund persistence is not composed')
    return this.client.reembolsoServicio
  }

  async listarPorPago(input: { tenantId: string; paymentId: string }) {
    const rows = await this.delegado.findMany({
      where: { tenantId: input.tenantId, pagoId: input.paymentId },
      orderBy: { intento: 'asc' },
    })
    return rows.map(mapearReembolso)
  }

  async buscarPorClave(input: { tenantId: string; key: string }) {
    const row = await this.delegado.findFirst({
      where: { tenantId: input.tenantId, claveIdempotencia: input.key },
    })
    return row ? mapearReembolso(row) : null
  }

  async crear(refund: ReembolsoServicioDominio): Promise<void> {
    await this.delegado.create({
      data: {
        id: refund.reembolsoId,
        versionContrato: TUS_CONTRACT_VERSION,
        reembolsoId: refund.reembolsoId,
        tenantId: refund.tenantId,
        prestadorTenantId: refund.prestadorTenantId,
        obligacionId: refund.obligacionId,
        pagoId: refund.paymentId,
        intento: refund.attempt,
        monto: refund.amountMinor,
        moneda: refund.currency,
        estado: refund.status,
        referenciaReembolsoProveedor: refund.providerRefundId,
        errorProveedor: refund.providerError,
        motivo: refund.reason,
        claveIdempotencia: refund.idempotencyKey,
        actorId: refund.actorId,
        correlacionId: refund.correlationId,
        version: refund.version,
        fechaCreacion: new Date(refund.createdAt),
        fechaActualizacion: new Date(refund.updatedAt),
      },
    })
  }

  async actualizar(input: { refund: ReembolsoServicioDominio; expectedVersion: number }) {
    const result = await this.delegado.updateMany({
      where: {
        tenantId: input.refund.tenantId,
        reembolsoId: input.refund.reembolsoId,
        version: input.expectedVersion,
      },
      data: {
        estado: input.refund.status,
        referenciaReembolsoProveedor: input.refund.providerRefundId,
        errorProveedor: input.refund.providerError,
        version: input.refund.version,
        fechaActualizacion: new Date(input.refund.updatedAt),
      },
    })
    return result.count === 1
  }
}

function mapearReembolso(row: Fila): ReembolsoServicioDominio {
  return {
    reembolsoId: texto(row, 'reembolsoId'),
    tenantId: texto(row, 'tenantId'),
    prestadorTenantId: texto(row, 'prestadorTenantId'),
    obligacionId: texto(row, 'obligacionId'),
    paymentId: texto(row, 'pagoId'),
    attempt: Number(row['intento']),
    amountMinor: parseMinorUnits(row['monto']),
    currency: texto(row, 'moneda'),
    status: texto(row, 'estado') as ReembolsoServicioDominio['status'],
    providerRefundId: textoNullable(row, 'referenciaReembolsoProveedor'),
    providerError: textoNullable(row, 'errorProveedor'),
    reason: texto(row, 'motivo'),
    idempotencyKey: texto(row, 'claveIdempotencia'),
    actorId: texto(row, 'actorId'),
    correlationId: texto(row, 'correlacionId'),
    version: Number(row['version']),
    createdAt: fecha(row, 'fechaCreacion'),
    updatedAt: fecha(row, 'fechaActualizacion'),
  }
}

// Single ledger: rows are only created; the database trigger rejects UPDATE and DELETE.
export class LedgerServicioPrisma implements PuertoLedgerServicio {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async listar(input: {
    tenantId: string
    obligacionId: string
  }): Promise<MovimientoContableServicio[]> {
    const rows = await this.client.movimientoContable.findMany({
      where: { tenantId: input.tenantId, obligacionId: input.obligacionId },
      orderBy: { fechaCreacion: 'asc' },
    })
    return rows.map((row) => ({
      entryId: texto(row, 'entradaId'),
      tenantId: texto(row, 'tenantId'),
      obligacionId: texto(row, 'obligacionId'),
      entryType: texto(row, 'tipoEntrada') as TipoMovimientoServicio,
      amountMinor: parseMinorUnits(row['monto']),
      currency: texto(row, 'moneda'),
      linkedEntryId: textoNullable(row, 'entradaVinculadaId'),
      reason: texto(row, 'motivo'),
      createdAt: fecha(row, 'fechaCreacion'),
    }))
  }

  async agregar(entry: MovimientoContableServicio): Promise<void> {
    await this.client.movimientoContable.create({
      data: asegurarSujetoFinancieroUnico({
        id: entry.entryId,
        entradaId: entry.entryId,
        tenantId: entry.tenantId,
        compromisoId: null,
        obligacionId: entry.obligacionId,
        tipoEntrada: entry.entryType,
        monto: entry.amountMinor,
        moneda: entry.currency,
        entradaVinculadaId: entry.linkedEntryId,
        motivo: entry.reason,
        inmutable: true,
        fechaCreacion: new Date(entry.createdAt),
      }),
    })
  }
}

export class LiquidacionesServicioPrisma implements PuertoLiquidacionesServicio {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async buscar(input: {
    tenantId: string
    obligacionId: string
  }): Promise<LiquidacionServicioDominio | null> {
    const row = await this.client.liquidacionServicio.findFirst({
      where: { tenantId: input.tenantId, obligacionId: input.obligacionId },
    })
    if (!row) return null
    return {
      liquidacionId: texto(row, 'liquidacionId'),
      tenantId: texto(row, 'tenantId'),
      prestadorTenantId: texto(row, 'prestadorTenantId'),
      obligacionId: texto(row, 'obligacionId'),
      trabajoId: texto(row, 'trabajoId'),
      grossMinor: parseMinorUnits(row['montoBruto']),
      commissionMinor: parseMinorUnits(row['montoComision']),
      netMinor: parseMinorUnits(row['montoNeto']),
      currency: texto(row, 'moneda'),
      status: texto(row, 'estado') as EstadoLiquidacionServicio,
      reason: texto(row, 'motivo'),
      version: Number(row['version']),
      createdAt: fecha(row, 'fechaCreacion'),
      updatedAt: fecha(row, 'fechaActualizacion'),
    }
  }

  async crear(settlement: LiquidacionServicioDominio): Promise<void> {
    await this.client.liquidacionServicio.create({
      data: {
        id: settlement.liquidacionId,
        versionContrato: TUS_CONTRACT_VERSION,
        liquidacionId: settlement.liquidacionId,
        tenantId: settlement.tenantId,
        prestadorTenantId: settlement.prestadorTenantId,
        obligacionId: settlement.obligacionId,
        trabajoId: settlement.trabajoId,
        montoBruto: settlement.grossMinor,
        montoComision: settlement.commissionMinor,
        montoNeto: settlement.netMinor,
        moneda: settlement.currency,
        estado: settlement.status,
        motivo: settlement.reason,
        estadoDesembolso: 'not_executed',
        version: settlement.version,
        fechaCreacion: new Date(settlement.createdAt),
        fechaActualizacion: new Date(settlement.updatedAt),
      },
    })
  }

  async actualizar(input: { settlement: LiquidacionServicioDominio; expectedVersion: number }) {
    const { settlement } = input
    const result = await this.client.liquidacionServicio.updateMany({
      where: {
        tenantId: settlement.tenantId,
        obligacionId: settlement.obligacionId,
        version: input.expectedVersion,
      },
      data: {
        estado: settlement.status,
        motivo: settlement.reason,
        version: settlement.version,
        fechaActualizacion: new Date(settlement.updatedAt),
      },
    })
    return result.count === 1 ? settlement : null
  }
}

export class ConciliacionesServicioPrisma implements PuertoConciliacionesServicio {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async registrar(result: ConciliacionServicio & { prestadorTenantId: string }): Promise<void> {
    await this.client.conciliacionServicio.create({
      data: {
        id: result.conciliacionId,
        versionContrato: result.contractVersion,
        conciliacionId: result.conciliacionId,
        tenantId: result.tenantId,
        prestadorTenantId: result.prestadorTenantId,
        obligacionId: result.obligacionId,
        estado: result.status,
        hallazgos: result.findings,
        montoEsperado: parseMinorUnits(result.expectedMinor),
        moneda: result.currency,
        actorId: result.actorId,
        correlacionId: result.correlationId,
        fechaCreacion: new Date(result.createdAt),
      },
    })
  }
}

export class TransaccionFinanzasServicioPrisma implements PuertoTransaccionFinanzasServicio {
  constructor(protected readonly client: ClientePrismaFinanzasServicio) {}

  async ejecutar<T>(
    operation: (repositories: RepositoriosFinanzasServicio) => Promise<T>
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.client.$transaction((client) => operation(this.repositorios(client)), {
          isolationLevel: 'Serializable',
        })
      } catch (error) {
        if (!isSerializationFailure(error) && !isUniqueConstraint(error)) throw error
        if (attempt === 2)
          throw new ErrorFinanzasServicio(
            409,
            'CONCURRENT_MODIFICATION',
            'financial state changed concurrently; retry the request'
          )
      }
    }
    throw new Error('financial transaction retry limit exceeded')
  }

  protected repositorios(client: ClientePrismaFinanzasServicio): RepositoriosFinanzasServicio {
    return {
      identidad: new IdentidadServicioPrisma(client),
      obligaciones: new ObligacionesServicioPrisma(client),
      idempotencia: new IdempotenciaFinancieraPrisma(client),
      intenciones: new IntencionesPagoServicioPrisma(client),
      inbox: new InboxEventosPagoPrisma(client),
      outbox: new OutboxFinancieroPrisma(client),
      auditoria: new AuditoriaFinancieraPrisma(client),
      comisiones: new ComisionesServicioPrisma(client),
      ledger: new LedgerServicioPrisma(client),
      liquidaciones: new LiquidacionesServicioPrisma(client),
      conciliaciones: new ConciliacionesServicioPrisma(client),
      reembolsos: new ReembolsosServicioPrisma(client),
    }
  }
}

export function filaObligacion(obligacion: ObligacionServicio): Fila {
  return {
    id: obligacion.obligacionId,
    versionContrato: TUS_CONTRACT_VERSION,
    obligacionId: obligacion.obligacionId,
    tenantId: obligacion.tenantId,
    clienteId: obligacion.clienteId,
    prestadorTenantId: obligacion.prestadorTenantId,
    prestadorId: obligacion.prestadorId,
    publicacionId: obligacion.publicacionId,
    compromisoId: obligacion.commitmentId,
    trabajoId: obligacion.trabajoId,
    origenImporte: obligacion.amountSource,
    presupuestoId: obligacion.budgetId,
    presupuestoVersion: obligacion.budgetVersion,
    monto: obligacion.amountMinor,
    moneda: obligacion.currency,
    estado: obligacion.status,
    version: obligacion.version,
    actorId: obligacion.actorId,
    correlacionId: obligacion.correlationId,
    fechaCreacion: new Date(obligacion.createdAt),
    fechaActualizacion: new Date(obligacion.updatedAt),
  }
}

export function mapearObligacion(row: Fila): ObligacionServicio {
  return {
    obligacionId: texto(row, 'obligacionId'),
    tenantId: texto(row, 'tenantId'),
    clienteId: texto(row, 'clienteId'),
    prestadorTenantId: texto(row, 'prestadorTenantId'),
    prestadorId: texto(row, 'prestadorId'),
    publicacionId: texto(row, 'publicacionId'),
    commitmentId: texto(row, 'compromisoId'),
    trabajoId: texto(row, 'trabajoId'),
    amountSource: texto(row, 'origenImporte') as OrigenImporteObligacionServicio,
    budgetId: textoNullable(row, 'presupuestoId'),
    budgetVersion:
      row['presupuestoVersion'] === null || row['presupuestoVersion'] === undefined
        ? null
        : Number(row['presupuestoVersion']),
    amountMinor: parseMinorUnits(row['monto']),
    currency: texto(row, 'moneda'),
    status: texto(row, 'estado') as EstadoObligacionPagoServicio,
    version: Number(row['version']),
    actorId: texto(row, 'actorId'),
    correlationId: texto(row, 'correlacionId'),
    createdAt: fecha(row, 'fechaCreacion'),
    updatedAt: fecha(row, 'fechaActualizacion'),
  }
}

export function filaIntencion(intent: IntencionPagoServicioDominio): Fila {
  return {
    id: intent.paymentId,
    versionContrato: TUS_CONTRACT_VERSION,
    pagoId: intent.paymentId,
    tenantId: intent.tenantId,
    compromisoId: null,
    obligacionId: intent.obligacionId,
    prestadorTenantId: intent.prestadorTenantId,
    intento: intent.attempt,
    estadoDespacho: intent.dispatchStatus,
    proveedor: 'mercado-pago',
    referenciaProveedor: intent.providerReference,
    estadoProveedor: intent.providerStatus,
    estadoComercial: estadoComercialLegacy(intent.providerStatus),
    monto: intent.amountMinor,
    moneda: intent.currency,
    claveIdempotencia: claveIdempotenciaServicio(intent.idempotencyKey),
    correlacionId: intent.correlationId,
    credencialesRecolectadas: false,
    origen: intent.source,
    ordenId: intent.trabajoId,
    operacionPosId: null,
    comercianteRegistro: 'tus-intermediary',
    modeloCobro: 'intermediary',
    fechaLiberacion: new Date(intent.createdAt),
    fechaEventoProveedor: intent.providerEventAt ? new Date(intent.providerEventAt) : null,
    errorProveedor: intent.providerError,
    fechaCreacion: new Date(intent.createdAt),
    fechaActualizacion: new Date(intent.updatedAt),
    ...camposCheckout(intent),
    tasaComisionBps: intent.commission?.rateBps ?? null,
    versionReglaComision: intent.commission?.ruleVersion ?? null,
    politicaComisionId: intent.commission?.politicaId ?? null,
    comisionMarketplace: intent.commission?.commissionMinor ?? null,
    entornoProveedor: intent.environment ?? null,
  }
}

// WEB-09E mutable checkout fields; the frozen commission is only written on creation.
function camposCheckout(intent: IntencionPagoServicioDominio): Fila {
  return {
    preferenciaId: intent.checkoutReference ?? null,
    urlCheckout: intent.checkoutUrl ?? null,
    checkoutExpiraEn: intent.checkoutExpiresAt ? new Date(intent.checkoutExpiresAt) : null,
    despachoReclamadoHasta: intent.dispatchClaimedUntil
      ? new Date(intent.dispatchClaimedUntil)
      : null,
  }
}

export function mapearIntencion(row: Fila): IntencionPagoServicioDominio {
  const claveIdempotencia = texto(row, 'claveIdempotencia')
  return {
    paymentId: texto(row, 'pagoId'),
    obligacionId: texto(row, 'obligacionId'),
    trabajoId: texto(row, 'ordenId'),
    tenantId: texto(row, 'tenantId'),
    prestadorTenantId: texto(row, 'prestadorTenantId'),
    attempt: Number(row['intento']),
    amountMinor: parseMinorUnits(row['monto']),
    currency: texto(row, 'moneda'),
    providerStatus: texto(row, 'estadoProveedor') as EstadoProveedorPagoServicio,
    dispatchStatus: texto(row, 'estadoDespacho') as EstadoDespachoPagoServicio,
    source: texto(row, 'origen') as OrigenIntencionPagoServicio,
    providerReference: textoNullable(row, 'referenciaProveedor'),
    providerError: textoNullable(row, 'errorProveedor'),
    providerEventAt: row['fechaEventoProveedor'] ? fecha(row, 'fechaEventoProveedor') : null,
    idempotencyKey: claveIdempotencia.startsWith('servicio:')
      ? claveIdempotencia.slice('servicio:'.length)
      : claveIdempotencia,
    correlationId: texto(row, 'correlacionId'),
    createdAt: fecha(row, 'fechaCreacion'),
    updatedAt: fecha(row, 'fechaActualizacion'),
    commission:
      row['comisionMarketplace'] === null || row['comisionMarketplace'] === undefined
        ? null
        : {
            rateBps: Number(row['tasaComisionBps']),
            ruleVersion: texto(row, 'versionReglaComision'),
            politicaId: textoNullable(row, 'politicaComisionId'),
            commissionMinor: parseMinorUnits(row['comisionMarketplace']),
          },
    checkoutReference: textoNullable(row, 'preferenciaId'),
    checkoutUrl: textoNullable(row, 'urlCheckout'),
    checkoutExpiresAt: row['checkoutExpiraEn'] ? fecha(row, 'checkoutExpiraEn') : null,
    dispatchClaimedUntil: row['despachoReclamadoHasta']
      ? fecha(row, 'despachoReclamadoHasta')
      : null,
    environment: (textoNullable(row, 'entornoProveedor') ??
      null) as IntencionPagoServicioDominio['environment'],
  }
}

function mapearEvento(row: Fila): RegistroEventoProveedor {
  const datos = row['datosEvento'] as { rawBody?: unknown } | null
  return {
    eventId: texto(row, 'eventoProveedorId'),
    tenantId: texto(row, 'tenantId'),
    provider: 'mercado-pago',
    paymentId: texto(row, 'pagoId'),
    obligacionId: texto(row, 'obligacionId'),
    providerReference: texto(row, 'referenciaProveedor'),
    status: texto(row, 'estadoProveedor'),
    amountMinor: parseMinorUnits(row['monto']),
    currency: texto(row, 'moneda'),
    signature: texto(row, 'firma'),
    rawBody: typeof datos?.rawBody === 'string' ? datos.rawBody : '',
    occurredAt: fecha(row, 'fechaOcurrencia'),
    receivedAt: fecha(row, 'fechaRecepcion'),
    result: texto(row, 'estado') as ResultadoEventoProveedor,
    reason: textoNullable(row, 'motivo'),
  }
}

// The legacy commercial status column is informational for service intents; settlement lives
// in the WEB-09C internal settlement aggregate.
function estadoComercialLegacy(status: EstadoProveedorPagoServicio): string {
  if (status === 'refunded') return 'refunded'
  if (status === 'charged_back') return 'frozen'
  return 'held'
}

export function texto(row: Fila, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`finance persistence field ${key} is invalid`)
  return value
}

export function textoNullable(row: Fila, key: string): string | null {
  return row[key] === null || row[key] === undefined ? null : texto(row, key)
}

export function fecha(row: Fila, key: string): string {
  const value = row[key]
  const date = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(date.getTime()))
    throw new Error(`finance persistence date ${key} is invalid`)
  return date.toISOString()
}

export default { TransaccionFinanzasServicioPrisma }
