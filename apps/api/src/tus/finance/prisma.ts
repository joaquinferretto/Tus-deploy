import type {
  Confirmation,
  FinanceCommissionSnapshot,
  FinanceLedgerEntry,
  FinancePaymentIntent,
  FinanceStore,
  FinancialEvidence,
  FinancialFreeze,
  ReconciliationResult,
} from './index.ts'
import { FinanceError } from './index.ts'

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
  splitPolicy?: unknown
}

type Delegate = {
  findUnique(input: { where: Row }): Promise<Row | null>
  findMany(input: { where: Row; orderBy?: Row }): Promise<Row[]>
  create(input: { data: Row }): Promise<Row>
  upsert(input: { where: Row; create: Row; update: Row }): Promise<Row>
}

export type PrismaFinanceClient = {
  tusPaymentIntent: Delegate
  tusCommissionSnapshot: Delegate
  tusLedgerEntry: Delegate
  tusFinancialEvidence: Delegate
  tusFinancialConfirmation: Delegate
  tusFinancialFreeze: Delegate
  tusReconciliationRecord: Delegate
  tusFinanceIdempotency: Delegate
}

export class PrismaTusFinanceStore implements FinanceStore {
  private readonly client: PrismaFinanceClient

  constructor(client: PrismaFinanceClient) {
    this.client = client
  }

  async getPayment(tenantId: string, commitmentId: string): Promise<FinancePaymentIntent | null> {
    const row = await this.client.tusPaymentIntent.findUnique({ where: { tenantId_commitmentId: { tenantId, commitmentId } } })
    return row ? paymentFromRow(row) : null
  }

  async savePayment(payment: FinancePaymentIntent): Promise<FinancePaymentIntent> {
    const row = await this.client.tusPaymentIntent.upsert({
      where: { tenantId_commitmentId: { tenantId: payment.tenantId, commitmentId: payment.commitmentId } },
      create: paymentToRow(payment),
      update: paymentToRow(payment),
    })
    return paymentFromRow(row)
  }

  async getSnapshot(tenantId: string, commitmentId: string): Promise<FinanceCommissionSnapshot | null> {
    const row = await this.client.tusCommissionSnapshot.findUnique({ where: { tenantId_commitmentId: { tenantId, commitmentId } } })
    return row ? snapshotFromRow(row) : null
  }

  async saveSnapshot(snapshot: FinanceCommissionSnapshot): Promise<FinanceCommissionSnapshot> {
    const row = await this.client.tusCommissionSnapshot.create({ data: snapshotToRow(snapshot) })
    return snapshotFromRow(row)
  }

  async appendLedger(entry: FinanceLedgerEntry): Promise<FinanceLedgerEntry> {
    try {
      const row = await this.client.tusLedgerEntry.create({ data: ledgerToRow(entry) })
      return ledgerFromRow(row)
    } catch {
      const existing = await this.client.tusLedgerEntry.findUnique({ where: { tenantId_entryId: { tenantId: entry.tenantId, entryId: entry.entryId } } })
      if (!existing) throw new Error('ledger entry append failed')
      const persisted = ledgerFromRow(existing)
      if (JSON.stringify(persisted) !== JSON.stringify(entry)) throw new FinanceError(409, 'LEDGER_IMMUTABLE', 'ledger entries are append-only')
      return persisted
    }
  }

  async listLedger(tenantId: string, commitmentId: string): Promise<FinanceLedgerEntry[]> {
    const rows = await this.client.tusLedgerEntry.findMany({ where: { tenantId, commitmentId }, orderBy: { createdAt: 'asc' } })
    return rows.map(ledgerFromRow)
  }

  async saveEvidence(evidence: FinancialEvidence): Promise<FinancialEvidence> {
    const row = await this.client.tusFinancialEvidence.upsert({ where: { tenantId_evidenceId: { tenantId: evidence.tenantId, evidenceId: evidence.evidenceId } }, create: evidenceToRow(evidence), update: evidenceToRow(evidence) })
    return evidenceFromRow(row)
  }

  async listEvidence(tenantId: string, commitmentId: string): Promise<FinancialEvidence[]> {
    const rows = await this.client.tusFinancialEvidence.findMany({ where: { tenantId, commitmentId }, orderBy: { occurredAt: 'asc' } })
    return rows.map(evidenceFromRow)
  }

  async saveConfirmation(confirmation: Confirmation): Promise<Confirmation> {
    const values = confirmationToRow(confirmation)
    const row = await this.client.tusFinancialConfirmation.upsert({ where: { tenantId_commitmentId: { tenantId: confirmation.tenantId, commitmentId: confirmation.commitmentId } }, create: values, update: values })
    return confirmationFromRow(row)
  }

  async getConfirmation(tenantId: string, commitmentId: string): Promise<Confirmation | null> {
    const row = await this.client.tusFinancialConfirmation.findUnique({ where: { tenantId_commitmentId: { tenantId, commitmentId } } })
    return row ? confirmationFromRow(row) : null
  }

  async saveFreeze(freeze: FinancialFreeze): Promise<FinancialFreeze> {
    const row = await this.client.tusFinancialFreeze.upsert({ where: { tenantId_commitmentId: { tenantId: freeze.tenantId, commitmentId: freeze.commitmentId } }, create: freezeToRow(freeze), update: freezeToRow(freeze) })
    return freezeFromRow(row)
  }

  async getFreeze(tenantId: string, commitmentId: string): Promise<FinancialFreeze | null> {
    const row = await this.client.tusFinancialFreeze.findUnique({ where: { tenantId_commitmentId: { tenantId, commitmentId } } })
    return row ? freezeFromRow(row) : null
  }

  async getIdempotency(tenantId: string, idempotencyKey: string): Promise<{ requestHash: string; response: unknown } | null> {
    const row = await this.client.tusFinanceIdempotency.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } })
    return row ? { requestHash: text(row.requestHash), response: row.response } : null
  }

  async saveIdempotency(tenantId: string, idempotencyKey: string, record: { requestHash: string; response: unknown }): Promise<void> {
    await this.client.tusFinanceIdempotency.upsert({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } }, create: { id: `finance-idempotency-${tenantId}-${idempotencyKey}`, tenantId, idempotencyKey, requestHash: record.requestHash, response: record.response }, update: { requestHash: record.requestHash, response: record.response } })
  }

  async getReconciliation(tenantId: string, commitmentId: string): Promise<ReconciliationResult | null> {
    const row = await this.client.tusReconciliationRecord.findUnique({ where: { tenantId_commitmentId: { tenantId, commitmentId } } })
    return row ? reconciliationFromRow(row) : null
  }

  async saveReconciliation(result: ReconciliationResult): Promise<ReconciliationResult> {
    const row = await this.client.tusReconciliationRecord.upsert({ where: { tenantId_commitmentId: { tenantId: result.tenantId, commitmentId: result.commitmentId } }, create: reconciliationToRow(result), update: reconciliationToRow(result) })
    return reconciliationFromRow(row)
  }
}

function paymentToRow(value: FinancePaymentIntent): Row {
  return { ...value, id: value.paymentId, releaseAt: new Date(value.releaseAt), providerEventAt: value.providerEventAt === null ? null : new Date(value.providerEventAt), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) }
}

function paymentFromRow(row: Row): FinancePaymentIntent {
  const createdAt = dateMillis(row.createdAt)
  const splitPolicy: FinancePaymentIntent['splitPolicy'] = row['splitPolicy'] && typeof row['splitPolicy'] === 'object' ? row['splitPolicy'] as FinancePaymentIntent['splitPolicy'] : { name: 'five-day-intermediary', version: 'legacy', holdDays: 5, releaseRule: 'completion-confirmation-or-approved-policy', merchantOfRecord: 'tus-intermediary', providerEvidenceId: null, legalEvidenceId: null }
  return { contractVersion: text(row.contractVersion) as FinancePaymentIntent['contractVersion'], paymentId: text(row.paymentId), tenantId: text(row.tenantId), commitmentId: text(row.commitmentId), provider: 'mercado-pago', providerReference: nullableText(row.providerReference), providerStatus: text(row.providerStatus) as FinancePaymentIntent['providerStatus'], commercialStatus: text(row.commercialStatus) as FinancePaymentIntent['commercialStatus'], amount: safeMinorNumber(row.amount), currency: text(row.currency), idempotencyKey: text(row.idempotencyKey), correlationId: text(row.correlationId), credentialsCollected: false, source: text(row.source) as FinancePaymentIntent['source'], orderId: optionalText(row['orderId']) ?? text(row.commitmentId), posOperationId: optionalText(row['posOperationId']) ?? null, merchantOfRecord: 'tus-intermediary', collectionModel: 'intermediary', splitPolicy, releaseAt: row['releaseAt'] ? dateMillis(row['releaseAt']) : createdAt, providerEventAt: row['providerEventAt'] ? dateMillis(row['providerEventAt']) : null, providerError: (optionalText(row['providerError']) as FinancePaymentIntent['providerError']) ?? null, createdAt, updatedAt: dateMillis(row.updatedAt) }
}

function snapshotToRow(value: FinanceCommissionSnapshot): Row {
  return { ...value, id: value.snapshotId, createdAt: new Date(value.createdAt) }
}

function snapshotFromRow(row: Row): FinanceCommissionSnapshot {
  return { contractVersion: text(row.contractVersion) as FinanceCommissionSnapshot['contractVersion'], snapshotId: text(row.snapshotId), tenantId: text(row.tenantId), commitmentId: text(row.commitmentId), context: text(row.context) as FinanceCommissionSnapshot['context'], grossAmount: safeMinorNumber(row.grossAmount), deductions: safeMinorNumber(row.deductions), commissionableBase: safeMinorNumber(row.commissionableBase), rateBps: safeMinorNumber(row.rateBps), ruleVersion: text(row.ruleVersion), commissionAmount: safeMinorNumber(row.commissionAmount), netAmount: safeMinorNumber(row.netAmount), currency: text(row.currency), providerReference: text(row.providerReference), evidenceId: text(row.evidenceId), ledgerStatus: text(row.ledgerStatus) as FinanceCommissionSnapshot['ledgerStatus'], createdAt: dateMillis(row.createdAt) }
}

function ledgerToRow(value: FinanceLedgerEntry): Row {
  return { ...value, id: value.entryId, createdAt: new Date(value.createdAt) }
}

function ledgerFromRow(row: Row): FinanceLedgerEntry {
  return { entryId: text(row.entryId), tenantId: text(row.tenantId), commitmentId: text(row.commitmentId), entryType: text(row.entryType) as FinanceLedgerEntry['entryType'], amount: safeMinorNumber(row.amount), currency: text(row.currency), linkedEntryId: nullableText(row.linkedEntryId), reason: text(row.reason), immutable: true, createdAt: dateMillis(row.createdAt) }
}

function evidenceToRow(value: FinancialEvidence): Row {
  return { ...value, id: value.evidenceId, occurredAt: new Date(value.occurredAt), createdAt: new Date() }
}

function evidenceFromRow(row: Row): FinancialEvidence {
  return { contractVersion: text(row.contractVersion) as FinancialEvidence['contractVersion'], evidenceId: text(row.evidenceId), tenantId: text(row.tenantId), commitmentId: text(row.commitmentId), actorId: text(row.actorId), correlationId: text(row.correlationId), kind: text(row.kind) as FinancialEvidence['kind'], occurredAt: new Date(dateMillis(row.occurredAt)).toISOString() }
}

function confirmationToRow(value: Confirmation): Row {
  return { ...value, id: value.confirmationId, confirmedAt: new Date(value.confirmedAt), createdAt: new Date() }
}

function confirmationFromRow(row: Row): Confirmation {
  return { confirmationId: text(row.confirmationId), tenantId: text(row.tenantId), commitmentId: text(row.commitmentId), actorId: text(row.actorId), correlationId: text(row.correlationId), confirmedAt: new Date(dateMillis(row.confirmedAt)).toISOString() }
}

function freezeToRow(value: FinancialFreeze): Row {
  return { ...value, id: value.freezeId, createdAt: new Date(value.createdAt) }
}

function freezeFromRow(row: Row): FinancialFreeze {
  return { freezeId: text(row.freezeId), tenantId: text(row.tenantId), commitmentId: text(row.commitmentId), reason: text(row.reason) as FinancialFreeze['reason'], actorId: text(row.actorId), correlationId: text(row.correlationId), active: true, createdAt: dateMillis(row.createdAt) }
}

function reconciliationToRow(value: ReconciliationResult): Row {
  return { ...value, id: value.reconciliationId, createdAt: new Date(value.createdAt) }
}

function reconciliationFromRow(row: Row): ReconciliationResult {
  const reconciliationId = text(row.reconciliationId)
  const commitmentId = text(row.commitmentId)
  return { reconciliationId, tenantId: text(row.tenantId), commitmentId, providerReference: text(row.providerReference), providerAmount: safeMinorNumber(row.providerAmount), evidenceId: optionalText(row.evidenceId) ?? `reconciliation-evidence-${commitmentId}`, actorId: optionalText(row.actorId) ?? 'finance-reconciliation', correlationId: optionalText(row.correlationId) ?? `reconciliation-${reconciliationId}`, status: text(row.status) as ReconciliationResult['status'], reason: text(row.reason) as ReconciliationResult['reason'], deterministic: row.deterministic === true, createdAt: dateMillis(row.createdAt) }
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('finance persistence text field is invalid')
  return value
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value)
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function safeMinorNumber(value: unknown): number {
  const normalized = typeof value === 'bigint' ? Number(value) : value
  if (typeof normalized !== 'number' || !Number.isSafeInteger(normalized) || normalized < 0) throw new Error('finance persistence exact minor field is invalid')
  if (typeof value === 'bigint' && BigInt(normalized) !== value) throw new Error('finance persistence exact minor field exceeds safe boundary')
  return normalized
}

function dateMillis(value: unknown): number {
  const date = value instanceof Date ? value : new Date(text(value))
  if (!Number.isFinite(date.getTime())) throw new Error('finance persistence date field is invalid')
  return date.getTime()
}

export default { PrismaTusFinanceStore }
