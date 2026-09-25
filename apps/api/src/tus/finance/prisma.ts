import type {
  ConfirmacionCumplimiento,
  CongelamientoFinanciero,
  EvidenciaFinanciera,
  InstantaneaComision,
  IntencionPago,
  MovimientoContable,
  PuertoAlmacenFinanzas,
  ResultadoConciliacion,
} from './index.ts'
import { FinanceError } from './index.ts'
import { asegurarSujetoFinancieroUnico } from './sujeto.ts'

// Prisma delegates are narrowed at the boundary; row fields are validated by
// the conversion helpers below before entering the finance domain.
type Row = {
  [key: string]: unknown
  id?: unknown
  contractVersion?: unknown
  paymentId?: unknown
  tenantId?: unknown
  commitmentId?: unknown
  providerReference?: unknown
  providerStatus?: unknown
  commercialStatus?: unknown
  amount?: unknown
  currency?: unknown
  idempotencyKey?: unknown
  correlationId?: unknown
  source?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  snapshotId?: unknown
  context?: unknown
  grossAmount?: unknown
  deductions?: unknown
  commissionableBase?: unknown
  rateBps?: unknown
  ruleVersion?: unknown
  commissionAmount?: unknown
  netAmount?: unknown
  evidenceId?: unknown
  ledgerStatus?: unknown
  entryId?: unknown
  entryType?: unknown
  linkedEntryId?: unknown
  reason?: unknown
  occurredAt?: unknown
  actorId?: unknown
  kind?: unknown
  confirmationId?: unknown
  confirmedAt?: unknown
  freezeId?: unknown
  reconciliationId?: unknown
  providerAmount?: unknown
  status?: unknown
  deterministic?: unknown
  response?: unknown
  requestHash?: unknown
  entradaId?: unknown
  compromisoId?: unknown
  tipoEntrada?: unknown
  monto?: unknown
  moneda?: unknown
  entradaVinculadaId?: unknown
  motivo?: unknown
  inmutable?: unknown
  fechaCreacion?: unknown
  bloqueoId?: unknown
  activo?: unknown
  conciliacionId?: unknown
  referenciaProveedor?: unknown
  montoProveedor?: unknown
  evidenciaId?: unknown
  correlacionId?: unknown
  estado?: unknown
  determinista?: unknown
  versionContrato?: unknown
  pagoId?: unknown
  proveedor?: unknown
  estadoProveedor?: unknown
  estadoComercial?: unknown
  claveIdempotencia?: unknown
  credencialesRecolectadas?: unknown
  origen?: unknown
  ordenId?: unknown
  operacionPosId?: unknown
  comercianteRegistro?: unknown
  modeloCobro?: unknown
  politicaDistribucion?: unknown
  fechaLiberacion?: unknown
  fechaEventoProveedor?: unknown
  errorProveedor?: unknown
  fechaActualizacion?: unknown
  hashSolicitud?: unknown
  respuesta?: unknown
  instantaneaId?: unknown
  contexto?: unknown
  montoBruto?: unknown
  deducciones?: unknown
  baseComisionable?: unknown
  tasaPuntosBase?: unknown
  versionRegla?: unknown
  montoComision?: unknown
  montoNeto?: unknown
  estadoContable?: unknown
  tipo?: unknown
  fechaOcurrencia?: unknown
  confirmacionId?: unknown
  fechaConfirmacion?: unknown
}

type Delegate = {
  findUnique(input: { where: Row }): Promise<Row | null>
  findMany(input: { where: Row; orderBy?: Row }): Promise<Row[]>
  create(input: { data: Row }): Promise<Row>
  upsert(input: { where: Row; create: Row; update: Row }): Promise<Row>
}

export type ClientePrismaFinanzas = {
  intencionPago: Delegate
  instantaneaComision: Delegate
  movimientoContable: Delegate
  evidenciaFinanciera: Delegate
  confirmacionFinanciera: Delegate
  bloqueoFinanciero: Delegate
  registroConciliacion: Delegate
  idempotenciaFinanciera: Delegate
  eventoWebhookPago: Delegate
}

export class PrismaTusFinanceStore implements PuertoAlmacenFinanzas {
  private readonly client: ClientePrismaFinanzas

  constructor(client: ClientePrismaFinanzas) {
    this.client = client
  }

  async getPayment(tenantId: string, commitmentId: string): Promise<IntencionPago | null> {
    const row = await this.client.intencionPago.findUnique({ where: { tenantId_compromisoId: { tenantId, compromisoId: commitmentId } } })
    return row ? convertirFilaEnIntencionPago(row) : null
  }

  async savePayment(payment: IntencionPago): Promise<IntencionPago> {
    const row = await this.client.intencionPago.upsert({
      where: { tenantId_compromisoId: { tenantId: payment.tenantId, compromisoId: payment.commitmentId } },
      create: convertirIntencionPagoEnFila(payment),
      update: convertirIntencionPagoEnFila(payment),
    })
    return convertirFilaEnIntencionPago(row)
  }

  async getSnapshot(tenantId: string, commitmentId: string): Promise<InstantaneaComision | null> {
    const row = await this.client.instantaneaComision.findUnique({ where: { tenantId_compromisoId: { tenantId, compromisoId: commitmentId } } })
    return row ? convertirFilaEnInstantaneaComision(row) : null
  }

  async saveSnapshot(snapshot: InstantaneaComision): Promise<InstantaneaComision> {
    const row = await this.client.instantaneaComision.create({ data: convertirInstantaneaComisionEnFila(snapshot) })
    return convertirFilaEnInstantaneaComision(row)
  }

  async appendLedger(entry: MovimientoContable): Promise<MovimientoContable> {
    try {
      const row = await this.client.movimientoContable.create({ data: convertirMovimientoContableEnFila(entry) })
      return convertirFilaEnMovimientoContable(row)
    } catch {
      const existing = await this.client.movimientoContable.findUnique({ where: { tenantId_entradaId: { tenantId: entry.tenantId, entradaId: entry.entryId } } })
      if (!existing) throw new Error('ledger entry append failed')
      // The id is taken by a service-obligation entry: never read it as a legacy movement.
      if (existing.compromisoId !== entry.commitmentId) throw new FinanceError(409, 'LEDGER_IMMUTABLE', 'ledger entry id belongs to another financial subject')
      const persisted = convertirFilaEnMovimientoContable(existing)
      if (JSON.stringify(persisted) !== JSON.stringify(entry)) throw new FinanceError(409, 'LEDGER_IMMUTABLE', 'ledger entries are append-only')
      return persisted
    }
  }

  async listLedger(tenantId: string, commitmentId: string): Promise<MovimientoContable[]> {
    const rows = await this.client.movimientoContable.findMany({ where: { tenantId, compromisoId: commitmentId }, orderBy: { fechaCreacion: 'asc' } })
    return rows.map(convertirFilaEnMovimientoContable)
  }

  async saveEvidence(evidence: EvidenciaFinanciera): Promise<EvidenciaFinanciera> {
    const row = await this.client.evidenciaFinanciera.upsert({ where: { tenantId_evidenciaId: { tenantId: evidence.tenantId, evidenciaId: evidence.evidenceId } }, create: convertirEvidenciaFinancieraEnFila(evidence), update: convertirEvidenciaFinancieraEnFila(evidence) })
    return convertirFilaEnEvidenciaFinanciera(row)
  }

  async listEvidence(tenantId: string, commitmentId: string): Promise<EvidenciaFinanciera[]> {
    const rows = await this.client.evidenciaFinanciera.findMany({ where: { tenantId, compromisoId: commitmentId }, orderBy: { fechaOcurrencia: 'asc' } })
    return rows.map(convertirFilaEnEvidenciaFinanciera)
  }

  async saveConfirmation(confirmation: ConfirmacionCumplimiento): Promise<ConfirmacionCumplimiento> {
    const values = convertirConfirmacionCumplimientoEnFila(confirmation)
    const row = await this.client.confirmacionFinanciera.upsert({ where: { tenantId_compromisoId: { tenantId: confirmation.tenantId, compromisoId: confirmation.commitmentId } }, create: values, update: values })
    return convertirFilaEnConfirmacionCumplimiento(row)
  }

  async getConfirmation(tenantId: string, commitmentId: string): Promise<ConfirmacionCumplimiento | null> {
    const row = await this.client.confirmacionFinanciera.findUnique({ where: { tenantId_compromisoId: { tenantId, compromisoId: commitmentId } } })
    return row ? convertirFilaEnConfirmacionCumplimiento(row) : null
  }

  async saveFreeze(freeze: CongelamientoFinanciero): Promise<CongelamientoFinanciero> {
    const row = await this.client.bloqueoFinanciero.upsert({ where: { tenantId_compromisoId: { tenantId: freeze.tenantId, compromisoId: freeze.commitmentId } }, create: convertirCongelamientoFinancieroEnFila(freeze), update: convertirCongelamientoFinancieroEnFila(freeze) })
    return convertirFilaEnCongelamientoFinanciero(row)
  }

  async getFreeze(tenantId: string, commitmentId: string): Promise<CongelamientoFinanciero | null> {
    const row = await this.client.bloqueoFinanciero.findUnique({ where: { tenantId_compromisoId: { tenantId, compromisoId: commitmentId } } })
    return row ? convertirFilaEnCongelamientoFinanciero(row) : null
  }

  async getIdempotency(tenantId: string, idempotencyKey: string): Promise<{ requestHash: string; response: unknown } | null> {
    const row = await this.client.idempotenciaFinanciera.findUnique({ where: { tenantId_claveIdempotencia: { tenantId, claveIdempotencia: idempotencyKey } } })
    return row ? { requestHash: texto(row.hashSolicitud), response: row.respuesta } : null
  }

  async saveIdempotency(tenantId: string, idempotencyKey: string, record: { requestHash: string; response: unknown }): Promise<void> {
    await this.client.idempotenciaFinanciera.upsert({ where: { tenantId_claveIdempotencia: { tenantId, claveIdempotencia: idempotencyKey } }, create: { id: `finance-idempotency-${tenantId}-${idempotencyKey}`, tenantId, claveIdempotencia: idempotencyKey, hashSolicitud: record.requestHash, respuesta: record.response }, update: { hashSolicitud: record.requestHash, respuesta: record.response } })
  }

  async getReconciliation(tenantId: string, commitmentId: string): Promise<ResultadoConciliacion | null> {
    const row = await this.client.registroConciliacion.findUnique({ where: { tenantId_compromisoId: { tenantId, compromisoId: commitmentId } } })
    return row ? convertirFilaEnResultadoConciliacion(row) : null
  }

  async saveReconciliation(result: ResultadoConciliacion): Promise<ResultadoConciliacion> {
    const row = await this.client.registroConciliacion.upsert({ where: { tenantId_compromisoId: { tenantId: result.tenantId, compromisoId: result.commitmentId } }, create: convertirResultadoConciliacionEnFila(result), update: convertirResultadoConciliacionEnFila(result) })
    return convertirFilaEnResultadoConciliacion(row)
  }
}

function convertirIntencionPagoEnFila(value: IntencionPago): Row {
  return asegurarSujetoFinancieroUnico({ id: value.paymentId, versionContrato: value.contractVersion, pagoId: value.paymentId, tenantId: value.tenantId, compromisoId: value.commitmentId, proveedor: value.provider, referenciaProveedor: value.providerReference, estadoProveedor: value.providerStatus, estadoComercial: value.commercialStatus, monto: value.amount, moneda: value.currency, claveIdempotencia: value.idempotencyKey, correlacionId: value.correlationId, credencialesRecolectadas: value.credentialsCollected, origen: value.source, ordenId: value.orderId, operacionPosId: value.posOperationId, comercianteRegistro: value.merchantOfRecord, modeloCobro: value.collectionModel, politicaDistribucion: value.splitPolicy, fechaLiberacion: new Date(value.releaseAt), fechaEventoProveedor: value.providerEventAt === null ? null : new Date(value.providerEventAt), errorProveedor: value.providerError, fechaCreacion: new Date(value.createdAt), fechaActualizacion: new Date(value.updatedAt) })
}

function convertirFilaEnIntencionPago(row: Row): IntencionPago {
  const createdAt = fechaEnMilisegundos(row.fechaCreacion)
  const splitPolicy: IntencionPago['splitPolicy'] = row.politicaDistribucion && typeof row.politicaDistribucion === 'object' ? row.politicaDistribucion as IntencionPago['splitPolicy'] : { name: 'five-day-intermediary', version: 'legacy', holdDays: 5, releaseRule: 'completion-confirmation-or-approved-policy', merchantOfRecord: 'tus-intermediary', providerEvidenceId: null, legalEvidenceId: null }
  return { contractVersion: texto(row.versionContrato) as IntencionPago['contractVersion'], paymentId: texto(row.pagoId), tenantId: texto(row.tenantId), commitmentId: texto(row.compromisoId), provider: texto(row.proveedor) as IntencionPago['provider'], providerReference: textoNullable(row.referenciaProveedor), providerStatus: texto(row.estadoProveedor) as IntencionPago['providerStatus'], commercialStatus: texto(row.estadoComercial) as IntencionPago['commercialStatus'], amount: numero(row.monto), currency: texto(row.moneda), idempotencyKey: texto(row.claveIdempotencia), correlationId: texto(row.correlacionId), credentialsCollected: false, source: texto(row.origen) as IntencionPago['source'], orderId: textoOpcional(row.ordenId) ?? texto(row.compromisoId), posOperationId: textoOpcional(row.operacionPosId) ?? null, merchantOfRecord: (textoOpcional(row.comercianteRegistro) as IntencionPago['merchantOfRecord']) ?? 'tus-intermediary', collectionModel: (textoOpcional(row.modeloCobro) as IntencionPago['collectionModel']) ?? 'intermediary', splitPolicy, releaseAt: row.fechaLiberacion ? fechaEnMilisegundos(row.fechaLiberacion) : createdAt, providerEventAt: row.fechaEventoProveedor ? fechaEnMilisegundos(row.fechaEventoProveedor) : null, providerError: (textoOpcional(row.errorProveedor) as IntencionPago['providerError']) ?? null, createdAt, updatedAt: fechaEnMilisegundos(row.fechaActualizacion) }
}

function convertirInstantaneaComisionEnFila(value: InstantaneaComision): Row {
  return asegurarSujetoFinancieroUnico({ id: value.snapshotId, versionContrato: value.contractVersion, instantaneaId: value.snapshotId, tenantId: value.tenantId, compromisoId: value.commitmentId, contexto: value.context, montoBruto: value.grossAmount, deducciones: value.deductions, baseComisionable: value.commissionableBase, tasaPuntosBase: value.rateBps, versionRegla: value.ruleVersion, montoComision: value.commissionAmount, montoNeto: value.netAmount, moneda: value.currency, referenciaProveedor: value.providerReference, evidenciaId: value.evidenceId, estadoContable: value.ledgerStatus, fechaCreacion: new Date(value.createdAt) })
}

function convertirFilaEnInstantaneaComision(row: Row): InstantaneaComision {
  return { contractVersion: texto(row.versionContrato) as InstantaneaComision['contractVersion'], snapshotId: texto(row.instantaneaId), tenantId: texto(row.tenantId), commitmentId: texto(row.compromisoId), context: texto(row.contexto) as InstantaneaComision['context'], grossAmount: numero(row.montoBruto), deductions: numero(row.deducciones), commissionableBase: numero(row.baseComisionable), rateBps: numero(row.tasaPuntosBase), ruleVersion: texto(row.versionRegla), commissionAmount: numero(row.montoComision), netAmount: numero(row.montoNeto), currency: texto(row.moneda), providerReference: texto(row.referenciaProveedor), evidenceId: texto(row.evidenciaId), ledgerStatus: texto(row.estadoContable) as InstantaneaComision['ledgerStatus'], createdAt: fechaEnMilisegundos(row.fechaCreacion) }
}

function convertirMovimientoContableEnFila(value: MovimientoContable): Row {
  return asegurarSujetoFinancieroUnico({ id: value.entryId, entradaId: value.entryId, tenantId: value.tenantId, compromisoId: value.commitmentId, tipoEntrada: value.entryType, monto: value.amount, moneda: value.currency, entradaVinculadaId: value.linkedEntryId, motivo: value.reason, inmutable: value.immutable, fechaCreacion: new Date(value.createdAt) })
}

function convertirFilaEnMovimientoContable(row: Row): MovimientoContable {
  return { entryId: texto(row.entradaId), tenantId: texto(row.tenantId), commitmentId: texto(row.compromisoId), entryType: texto(row.tipoEntrada) as MovimientoContable['entryType'], amount: numero(row.monto), currency: texto(row.moneda), linkedEntryId: textoNullable(row.entradaVinculadaId), reason: texto(row.motivo), immutable: true, createdAt: fechaEnMilisegundos(row.fechaCreacion) }
}

function convertirEvidenciaFinancieraEnFila(value: EvidenciaFinanciera): Row {
  return { id: value.evidenceId, versionContrato: value.contractVersion, evidenciaId: value.evidenceId, tenantId: value.tenantId, compromisoId: value.commitmentId, actorId: value.actorId, correlacionId: value.correlationId, tipo: value.kind, fechaOcurrencia: new Date(value.occurredAt), fechaCreacion: new Date() }
}

function convertirFilaEnEvidenciaFinanciera(row: Row): EvidenciaFinanciera {
  return { contractVersion: texto(row.versionContrato) as EvidenciaFinanciera['contractVersion'], evidenceId: texto(row.evidenciaId), tenantId: texto(row.tenantId), commitmentId: texto(row.compromisoId), actorId: texto(row.actorId), correlationId: texto(row.correlacionId), kind: texto(row.tipo) as EvidenciaFinanciera['kind'], occurredAt: new Date(fechaEnMilisegundos(row.fechaOcurrencia)).toISOString() }
}

function convertirConfirmacionCumplimientoEnFila(value: ConfirmacionCumplimiento): Row {
  return { id: value.confirmationId, confirmacionId: value.confirmationId, tenantId: value.tenantId, compromisoId: value.commitmentId, actorId: value.actorId, correlacionId: value.correlationId, fechaConfirmacion: new Date(value.confirmedAt), fechaCreacion: new Date() }
}

function convertirFilaEnConfirmacionCumplimiento(row: Row): ConfirmacionCumplimiento {
  return { confirmationId: texto(row.confirmacionId), tenantId: texto(row.tenantId), commitmentId: texto(row.compromisoId), actorId: texto(row.actorId), correlationId: texto(row.correlacionId), confirmedAt: new Date(fechaEnMilisegundos(row.fechaConfirmacion)).toISOString() }
}

function convertirCongelamientoFinancieroEnFila(value: CongelamientoFinanciero): Row {
  return { id: value.freezeId, bloqueoId: value.freezeId, tenantId: value.tenantId, compromisoId: value.commitmentId, motivo: value.reason, actorId: value.actorId, correlacionId: value.correlationId, activo: value.active, fechaCreacion: new Date(value.createdAt) }
}

function convertirFilaEnCongelamientoFinanciero(row: Row): CongelamientoFinanciero {
  if (row.activo !== true) throw new Error('finance persistence active freeze field is invalid')
  return { freezeId: texto(row.bloqueoId), tenantId: texto(row.tenantId), commitmentId: texto(row.compromisoId), reason: texto(row.motivo) as CongelamientoFinanciero['reason'], actorId: texto(row.actorId), correlationId: texto(row.correlacionId), active: true, createdAt: fechaEnMilisegundos(row.fechaCreacion) }
}

function convertirResultadoConciliacionEnFila(value: ResultadoConciliacion): Row {
  return { id: value.reconciliationId, conciliacionId: value.reconciliationId, tenantId: value.tenantId, compromisoId: value.commitmentId, referenciaProveedor: value.providerReference, montoProveedor: value.providerAmount, evidenciaId: value.evidenceId, actorId: value.actorId, correlacionId: value.correlationId, estado: value.status, motivo: value.reason, determinista: value.deterministic, fechaCreacion: new Date(value.createdAt) }
}

function convertirFilaEnResultadoConciliacion(row: Row): ResultadoConciliacion {
  const reconciliationId = texto(row.conciliacionId)
  const commitmentId = texto(row.compromisoId)
  return { reconciliationId, tenantId: texto(row.tenantId), commitmentId, providerReference: texto(row.referenciaProveedor), providerAmount: numero(row.montoProveedor), evidenceId: textoOpcional(row.evidenciaId) ?? `reconciliation-evidence-${commitmentId}`, actorId: textoOpcional(row.actorId) ?? 'finance-reconciliation', correlationId: textoOpcional(row.correlacionId) ?? `reconciliation-${reconciliationId}`, status: texto(row.estado) as ResultadoConciliacion['status'], reason: texto(row.motivo) as ResultadoConciliacion['reason'], deterministic: row.determinista === true, createdAt: fechaEnMilisegundos(row.fechaCreacion) }
}

function texto(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('finance persistence text field is invalid')
  return value
}

function textoNullable(value: unknown): string | null {
  return value === null || value === undefined ? null : texto(value)
}

function textoOpcional(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numero(value: unknown): number {
  const normalized = typeof value === 'bigint' ? Number(value) : value
  if (typeof normalized !== 'number' || !Number.isSafeInteger(normalized) || normalized < 0) throw new Error('finance persistence exact minor field is invalid')
  if (typeof value === 'bigint' && BigInt(normalized) !== value) throw new Error('finance persistence exact minor field exceeds safe boundary')
  return normalized
}

function fechaEnMilisegundos(value: unknown): number {
  const date = value instanceof Date ? value : new Date(texto(value))
  if (!Number.isFinite(date.getTime())) throw new Error('finance persistence date field is invalid')
  return date.getTime()
}

export default { PrismaTusFinanceStore }
