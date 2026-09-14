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

// Prisma delegates are narrowed at the boundary; row fields are validated by
// the conversion helpers below before entering the finance domain.
type Row = {
  [key: string]: any
  id?: any
  contractVersion?: any
  paymentId?: any
  tenantId?: any
  commitmentId?: any
  providerReference?: any
  providerStatus?: any
  commercialStatus?: any
  amount?: any
  currency?: any
  idempotencyKey?: any
  correlationId?: any
  source?: any
  createdAt?: any
  updatedAt?: any
  snapshotId?: any
  context?: any
  grossAmount?: any
  deductions?: any
  commissionableBase?: any
  rateBps?: any
  ruleVersion?: any
  commissionAmount?: any
  netAmount?: any
  evidenceId?: any
  ledgerStatus?: any
  entryId?: any
  entryType?: any
  linkedEntryId?: any
  reason?: any
  occurredAt?: any
  actorId?: any
  kind?: any
  confirmationId?: any
  confirmedAt?: any
  freezeId?: any
  reconciliationId?: any
  providerAmount?: any
  status?: any
  deterministic?: any
  response?: any
  requestHash?: any
}

type Delegate = {
  findUnique(input: { where: Row }): Promise<Row | null>
  findMany(input: { where: Row; orderBy?: Row }): Promise<Row[]>
  create(input: { data: Row }): Promise<Row>
  upsert(input: { where: Row; create: Row; update: Row }): Promise<Row>
}

export type ClientePrismaFinanzas = {
  tusPaymentIntent: Delegate
  tusCommissionSnapshot: Delegate
  tusLedgerEntry: Delegate
  tusFinancialEvidence: Delegate
  tusFinancialConfirmation: Delegate
  tusFinancialFreeze: Delegate
  tusReconciliationRecord: Delegate
  tusFinanceIdempotency: Delegate
}

export class PrismaTusFinanceStore implements PuertoAlmacenFinanzas {
  private readonly client: ClientePrismaFinanzas

  constructor(client: ClientePrismaFinanzas) {
    this.client = client
  }

  async getPayment(tenantId: string, commitmentId: string): Promise<IntencionPago | null> {
    const row = await this.client.tusPaymentIntent.findUnique({ where: { tenantId_commitmentId: { tenantId, commitmentId } } })
    return row ? convertirFilaEnIntencionPago(row) : null
  }

  async savePayment(payment: IntencionPago): Promise<IntencionPago> {
    const row = await this.client.tusPaymentIntent.upsert({
      where: { tenantId_commitmentId: { tenantId: payment.tenantId, commitmentId: payment.commitmentId } },
      create: convertirIntencionPagoEnFila(payment),
      update: convertirIntencionPagoEnFila(payment),
    })
    return convertirFilaEnIntencionPago(row)
  }

  async getSnapshot(tenantId: string, commitmentId: string): Promise<InstantaneaComision | null> {
    const row = await this.client.tusCommissionSnapshot.findUnique({ where: { tenantId_commitmentId: { tenantId, commitmentId } } })
    return row ? convertirFilaEnInstantaneaComision(row) : null
  }

  async saveSnapshot(snapshot: InstantaneaComision): Promise<InstantaneaComision> {
    const row = await this.client.tusCommissionSnapshot.create({ data: convertirInstantaneaComisionEnFila(snapshot) })
    return convertirFilaEnInstantaneaComision(row)
  }

  async appendLedger(entry: MovimientoContable): Promise<MovimientoContable> {
    try {
      const row = await this.client.tusLedgerEntry.create({ data: convertirMovimientoContableEnFila(entry) })
      return convertirFilaEnMovimientoContable(row)
    } catch {
      const existing = await this.client.tusLedgerEntry.findUnique({ where: { tenantId_entryId: { tenantId: entry.tenantId, entryId: entry.entryId } } })
      if (!existing) throw new Error('ledger entry append failed')
      const persisted = convertirFilaEnMovimientoContable(existing)
      if (JSON.stringify(persisted) !== JSON.stringify(entry)) throw new FinanceError(409, 'LEDGER_IMMUTABLE', 'ledger entries are append-only')
      return persisted
    }
  }

  async listLedger(tenantId: string, commitmentId: string): Promise<MovimientoContable[]> {
    const rows = await this.client.tusLedgerEntry.findMany({ where: { tenantId, commitmentId }, orderBy: { createdAt: 'asc' } })
    return rows.map(convertirFilaEnMovimientoContable)
  }

  async saveEvidence(evidence: EvidenciaFinanciera): Promise<EvidenciaFinanciera> {
    const row = await this.client.tusFinancialEvidence.upsert({ where: { tenantId_evidenceId: { tenantId: evidence.tenantId, evidenceId: evidence.evidenceId } }, create: convertirEvidenciaFinancieraEnFila(evidence), update: convertirEvidenciaFinancieraEnFila(evidence) })
    return convertirFilaEnEvidenciaFinanciera(row)
  }

  async listEvidence(tenantId: string, commitmentId: string): Promise<EvidenciaFinanciera[]> {
    const rows = await this.client.tusFinancialEvidence.findMany({ where: { tenantId, commitmentId }, orderBy: { occurredAt: 'asc' } })
    return rows.map(convertirFilaEnEvidenciaFinanciera)
  }

  async saveConfirmation(confirmation: ConfirmacionCumplimiento): Promise<ConfirmacionCumplimiento> {
    const values = convertirConfirmacionCumplimientoEnFila(confirmation)
    const row = await this.client.tusFinancialConfirmation.upsert({ where: { tenantId_commitmentId: { tenantId: confirmation.tenantId, commitmentId: confirmation.commitmentId } }, create: values, update: values })
    return convertirFilaEnConfirmacionCumplimiento(row)
  }

  async getConfirmation(tenantId: string, commitmentId: string): Promise<ConfirmacionCumplimiento | null> {
    const row = await this.client.tusFinancialConfirmation.findUnique({ where: { tenantId_commitmentId: { tenantId, commitmentId } } })
    return row ? convertirFilaEnConfirmacionCumplimiento(row) : null
  }

  async saveFreeze(freeze: CongelamientoFinanciero): Promise<CongelamientoFinanciero> {
    const row = await this.client.tusFinancialFreeze.upsert({ where: { tenantId_commitmentId: { tenantId: freeze.tenantId, commitmentId: freeze.commitmentId } }, create: convertirCongelamientoFinancieroEnFila(freeze), update: convertirCongelamientoFinancieroEnFila(freeze) })
    return convertirFilaEnCongelamientoFinanciero(row)
  }

  async getFreeze(tenantId: string, commitmentId: string): Promise<CongelamientoFinanciero | null> {
    const row = await this.client.tusFinancialFreeze.findUnique({ where: { tenantId_commitmentId: { tenantId, commitmentId } } })
    return row ? convertirFilaEnCongelamientoFinanciero(row) : null
  }

  async getIdempotency(tenantId: string, idempotencyKey: string): Promise<{ requestHash: string; response: unknown } | null> {
    const row = await this.client.tusFinanceIdempotency.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } })
    return row ? { requestHash: texto(row.requestHash), response: row.response } : null
  }

  async saveIdempotency(tenantId: string, idempotencyKey: string, record: { requestHash: string; response: unknown }): Promise<void> {
    await this.client.tusFinanceIdempotency.upsert({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } }, create: { id: `finance-idempotency-${tenantId}-${idempotencyKey}`, tenantId, idempotencyKey, requestHash: record.requestHash, response: record.response }, update: { requestHash: record.requestHash, response: record.response } })
  }

  async getReconciliation(tenantId: string, commitmentId: string): Promise<ResultadoConciliacion | null> {
    const row = await this.client.tusReconciliationRecord.findUnique({ where: { tenantId_commitmentId: { tenantId, commitmentId } } })
    return row ? convertirFilaEnResultadoConciliacion(row) : null
  }

  async saveReconciliation(result: ResultadoConciliacion): Promise<ResultadoConciliacion> {
    const row = await this.client.tusReconciliationRecord.upsert({ where: { tenantId_commitmentId: { tenantId: result.tenantId, commitmentId: result.commitmentId } }, create: convertirResultadoConciliacionEnFila(result), update: convertirResultadoConciliacionEnFila(result) })
    return convertirFilaEnResultadoConciliacion(row)
  }
}

function convertirIntencionPagoEnFila(value: IntencionPago): Row {
  return { ...value, id: value.paymentId, releaseAt: new Date(value.releaseAt), providerEventAt: value.providerEventAt === null ? null : new Date(value.providerEventAt), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) }
}

function convertirFilaEnIntencionPago(row: Row): IntencionPago {
  const createdAt = fechaEnMilisegundos(row.createdAt)
  const splitPolicy: IntencionPago['splitPolicy'] = row['splitPolicy'] && typeof row['splitPolicy'] === 'object' ? row['splitPolicy'] as IntencionPago['splitPolicy'] : { name: 'five-day-intermediary', version: 'legacy', holdDays: 5, releaseRule: 'completion-confirmation-or-approved-policy', merchantOfRecord: 'tus-intermediary', providerEvidenceId: null, legalEvidenceId: null }
  return { contractVersion: texto(row.contractVersion) as IntencionPago['contractVersion'], paymentId: texto(row.paymentId), tenantId: texto(row.tenantId), commitmentId: texto(row.commitmentId), provider: 'mercado-pago', providerReference: textoNullable(row.providerReference), providerStatus: texto(row.providerStatus) as IntencionPago['providerStatus'], commercialStatus: texto(row.commercialStatus) as IntencionPago['commercialStatus'], amount: numero(row.amount), currency: texto(row.currency), idempotencyKey: texto(row.idempotencyKey), correlationId: texto(row.correlationId), credentialsCollected: false, source: texto(row.source) as IntencionPago['source'], orderId: textoOpcional(row['orderId']) ?? texto(row.commitmentId), posOperationId: textoOpcional(row['posOperationId']) ?? null, merchantOfRecord: 'tus-intermediary', collectionModel: 'intermediary', splitPolicy, releaseAt: row['releaseAt'] ? fechaEnMilisegundos(row['releaseAt']) : createdAt, providerEventAt: row['providerEventAt'] ? fechaEnMilisegundos(row['providerEventAt']) : null, providerError: (textoOpcional(row['providerError']) as IntencionPago['providerError']) ?? null, createdAt, updatedAt: fechaEnMilisegundos(row.updatedAt) }
}

function convertirInstantaneaComisionEnFila(value: InstantaneaComision): Row {
  return { ...value, id: value.snapshotId, createdAt: new Date(value.createdAt) }
}

function convertirFilaEnInstantaneaComision(row: Row): InstantaneaComision {
  return { contractVersion: texto(row.contractVersion) as InstantaneaComision['contractVersion'], snapshotId: texto(row.snapshotId), tenantId: texto(row.tenantId), commitmentId: texto(row.commitmentId), context: texto(row.context) as InstantaneaComision['context'], grossAmount: numero(row.grossAmount), deductions: numero(row.deductions), commissionableBase: numero(row.commissionableBase), rateBps: numero(row.rateBps), ruleVersion: texto(row.ruleVersion), commissionAmount: numero(row.commissionAmount), netAmount: numero(row.netAmount), currency: texto(row.currency), providerReference: texto(row.providerReference), evidenceId: texto(row.evidenceId), ledgerStatus: texto(row.ledgerStatus) as InstantaneaComision['ledgerStatus'], createdAt: fechaEnMilisegundos(row.createdAt) }
}

function convertirMovimientoContableEnFila(value: MovimientoContable): Row {
  return { ...value, id: value.entryId, createdAt: new Date(value.createdAt) }
}

function convertirFilaEnMovimientoContable(row: Row): MovimientoContable {
  return { entryId: texto(row.entryId), tenantId: texto(row.tenantId), commitmentId: texto(row.commitmentId), entryType: texto(row.entryType) as MovimientoContable['entryType'], amount: numero(row.amount), currency: texto(row.currency), linkedEntryId: textoNullable(row.linkedEntryId), reason: texto(row.reason), immutable: true, createdAt: fechaEnMilisegundos(row.createdAt) }
}

function convertirEvidenciaFinancieraEnFila(value: EvidenciaFinanciera): Row {
  return { ...value, id: value.evidenceId, occurredAt: new Date(value.occurredAt), createdAt: new Date() }
}

function convertirFilaEnEvidenciaFinanciera(row: Row): EvidenciaFinanciera {
  return { contractVersion: texto(row.contractVersion) as EvidenciaFinanciera['contractVersion'], evidenceId: texto(row.evidenceId), tenantId: texto(row.tenantId), commitmentId: texto(row.commitmentId), actorId: texto(row.actorId), correlationId: texto(row.correlationId), kind: texto(row.kind) as EvidenciaFinanciera['kind'], occurredAt: new Date(fechaEnMilisegundos(row.occurredAt)).toISOString() }
}

function convertirConfirmacionCumplimientoEnFila(value: ConfirmacionCumplimiento): Row {
  return { ...value, id: value.confirmationId, confirmedAt: new Date(value.confirmedAt), createdAt: new Date() }
}

function convertirFilaEnConfirmacionCumplimiento(row: Row): ConfirmacionCumplimiento {
  return { confirmationId: texto(row.confirmationId), tenantId: texto(row.tenantId), commitmentId: texto(row.commitmentId), actorId: texto(row.actorId), correlationId: texto(row.correlationId), confirmedAt: new Date(fechaEnMilisegundos(row.confirmedAt)).toISOString() }
}

function convertirCongelamientoFinancieroEnFila(value: CongelamientoFinanciero): Row {
  return { ...value, id: value.freezeId, createdAt: new Date(value.createdAt) }
}

function convertirFilaEnCongelamientoFinanciero(row: Row): CongelamientoFinanciero {
  return { freezeId: texto(row.freezeId), tenantId: texto(row.tenantId), commitmentId: texto(row.commitmentId), reason: texto(row.reason) as CongelamientoFinanciero['reason'], actorId: texto(row.actorId), correlationId: texto(row.correlationId), active: true, createdAt: fechaEnMilisegundos(row.createdAt) }
}

function convertirResultadoConciliacionEnFila(value: ResultadoConciliacion): Row {
  return { ...value, id: value.reconciliationId, createdAt: new Date(value.createdAt) }
}

function convertirFilaEnResultadoConciliacion(row: Row): ResultadoConciliacion {
  const reconciliationId = texto(row.reconciliationId)
  const commitmentId = texto(row.commitmentId)
  return { reconciliationId, tenantId: texto(row.tenantId), commitmentId, providerReference: texto(row.providerReference), providerAmount: numero(row.providerAmount), evidenceId: textoOpcional(row.evidenceId) ?? `reconciliation-evidence-${commitmentId}`, actorId: textoOpcional(row.actorId) ?? 'finance-reconciliation', correlationId: textoOpcional(row.correlationId) ?? `reconciliation-${reconciliationId}`, status: texto(row.status) as ResultadoConciliacion['status'], reason: texto(row.reason) as ResultadoConciliacion['reason'], deterministic: row.deterministic === true, createdAt: fechaEnMilisegundos(row.createdAt) }
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
  if (typeof normalized !== 'number' || !Number.isSafeInteger(normalized) || normalized < 0) throw new Error('finance persistence number field is invalid')
  return normalized
}

function fechaEnMilisegundos(value: unknown): number {
  const date = value instanceof Date ? value : new Date(texto(value))
  if (!Number.isFinite(date.getTime())) throw new Error('finance persistence date field is invalid')
  return date.getTime()
}

export default { PrismaTusFinanceStore }
