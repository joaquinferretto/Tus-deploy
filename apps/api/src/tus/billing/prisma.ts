import type {
  BillingAccount,
  BillingAccountingExport,
  RegistroAuditoriaFacturacion,
  BillingCreditNote,
  BillingDunningRecord,
  BillingInvoice,
  BillingLedgerEntry,
  BillingOutboxRecord,
  BillingRefund,
  BillingStore,
  BillingSubscription,
  BillingSubscriptionPlan,
} from './index.ts'
import { BILLING_CURRENCY, BillingError } from './index.ts'

// Prisma's generated delegates are intentionally kept behind this loose row boundary;
// the domain types remain strict while this adapter handles generated JSON/BigInt values.
type Row = Record<string, unknown>
type Delegate = {
  findUnique(input: { where: Row; include?: Row }): Promise<Row | null>
  findMany(input: { where: Row; orderBy?: Row }): Promise<Row[]>
  create(input: { data: Row }): Promise<Row>
  update?(input: { where: Row; data: Row }): Promise<Row>
  createMany?(input: { data: Row[] }): Promise<{ count: number }>
  upsert(input: { where: Row; create: Row; update: Row }): Promise<Row>
}

export type PrismaBillingClient = {
  tusBillingAccount: Delegate
  tusSubscriptionPlan: Delegate
  tusSubscription: Delegate
  tusInvoice: Delegate
  tusInvoiceLine: Delegate
  tusCreditNote: Delegate
  tusBillingRefund: Delegate
  tusBillingLedger: Delegate
  tusBillingIdempotency: Delegate
  tusBillingAudit: Delegate
  tusBillingOutbox: Delegate
  tusBillingDunning: Delegate
  tusBillingNumberSequence: Delegate
  tusAccountingExport: Delegate
}

export class PrismaBillingStore implements BillingStore {
  constructor(private readonly client: PrismaBillingClient) {}

  async saveAccount(value: BillingAccount): Promise<BillingAccount> {
    const row = await this.client.tusBillingAccount.upsert({ where: { tenantId_billingAccountId: { tenantId: value.tenantId, billingAccountId: value.billingAccountId } }, create: accountToRow(value), update: accountToRow(value) })
    return accountFromRow(row)
  }

  async getAccount(tenantId: string, billingAccountId: string): Promise<BillingAccount | null> {
    const row = await this.client.tusBillingAccount.findUnique({ where: { tenantId_billingAccountId: { tenantId, billingAccountId } } })
    return row ? accountFromRow(row) : null
  }

  async savePlan(value: BillingSubscriptionPlan): Promise<BillingSubscriptionPlan> {
    const row = await this.client.tusSubscriptionPlan.upsert({ where: { tenantId_planId: { tenantId: value.tenantId, planId: value.planId } }, create: planToRow(value), update: planToRow(value) })
    return planFromRow(row)
  }

  async getPlan(tenantId: string, planId: string): Promise<BillingSubscriptionPlan | null> {
    const row = await this.client.tusSubscriptionPlan.findUnique({ where: { tenantId_planId: { tenantId, planId } } })
    return row ? planFromRow(row) : null
  }

  async saveSubscription(value: BillingSubscription): Promise<BillingSubscription> {
    const row = await this.client.tusSubscription.upsert({ where: { tenantId_subscriptionId: { tenantId: value.tenantId, subscriptionId: value.subscriptionId } }, create: subscriptionToRow(value), update: subscriptionToRow(value) })
    return subscriptionFromRow(row)
  }

  async getSubscription(tenantId: string, subscriptionId: string): Promise<BillingSubscription | null> {
    const row = await this.client.tusSubscription.findUnique({ where: { tenantId_subscriptionId: { tenantId, subscriptionId } } })
    return row ? subscriptionFromRow(row) : null
  }

  async saveInvoice(value: BillingInvoice): Promise<BillingInvoice> {
    if (value.currency !== BILLING_CURRENCY) throw new BillingError(400, 'UNSUPPORTED_CURRENCY', 'billing persistence accepts ARS only')
    const existing = await this.client.tusInvoice.findUnique({ where: { tenantId_invoiceId: { tenantId: value.tenantId, invoiceId: value.invoiceId } } })
    if (existing) {
      if (!this.client.tusInvoice.update) throw new BillingError(503, 'BILLING_INVOICE_UPDATE_UNAVAILABLE', 'billing invoice issuance update is unavailable')
      const row = await this.client.tusInvoice.update({ where: { tenantId_invoiceId: { tenantId: value.tenantId, invoiceId: value.invoiceId } }, data: invoiceToRow(value) })
      return invoiceFromRow({ ...row, lines: value.lines })
    }
    const row = await this.client.tusInvoice.create({ data: invoiceToRow(value) })
    if (value.lines.length > 0 && this.client.tusInvoiceLine.createMany) await this.client.tusInvoiceLine.createMany({ data: value.lines.map((line) => lineToRow(value, line)) })
    return invoiceFromRow({ ...row, lines: value.lines })
  }

  async getInvoice(tenantId: string, invoiceId: string): Promise<BillingInvoice | null> {
    const row = await this.client.tusInvoice.findUnique({ where: { tenantId_invoiceId: { tenantId, invoiceId } }, include: { lines: true } })
    return row ? invoiceFromRow(row) : null
  }

  async nextInvoiceNumber(tenantId: string): Promise<string> {
    const row = await this.client.tusBillingNumberSequence.upsert({ where: { tenantId }, create: { id: `billing-sequence-${tenantId}`, tenantId, nextNumber: 2 }, update: { nextNumber: { increment: 1 } } })
    return `A-${String(Number(field(row, 'nextNumber')) - 1).padStart(6, '0')}`
  }

  async saveCreditNote(value: BillingCreditNote): Promise<BillingCreditNote> {
    const row = await this.client.tusCreditNote.create({ data: creditToRow(value) })
    return creditFromRow(row)
  }

  async getCreditNote(tenantId: string, creditNoteId: string): Promise<BillingCreditNote | null> {
    const row = await this.client.tusCreditNote.findUnique({ where: { tenantId_creditNoteId: { tenantId, creditNoteId } } })
    return row ? creditFromRow(row) : null
  }

  async saveRefund(value: BillingRefund): Promise<BillingRefund> { return refundFromRow(await this.client.tusBillingRefund.create({ data: refundToRow(value) })) }
  async getRefund(tenantId: string, refundId: string): Promise<BillingRefund | null> { const row = await this.client.tusBillingRefund.findUnique({ where: { tenantId_refundId: { tenantId, refundId } } }); return row ? refundFromRow(row) : null }
  async appendLedger(value: BillingLedgerEntry): Promise<BillingLedgerEntry> { return ledgerFromRow(await this.client.tusBillingLedger.create({ data: ledgerToRow(value) })) }
  async listLedger(tenantId: string): Promise<BillingLedgerEntry[]> { return (await this.client.tusBillingLedger.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })).map(ledgerFromRow) }
  async saveDunning(value: BillingDunningRecord): Promise<BillingDunningRecord> { return dunningFromRow(await this.client.tusBillingDunning.upsert({ where: { tenantId_dunningId: { tenantId: value.tenantId, dunningId: value.dunningId } }, create: dunningToRow(value), update: dunningToRow(value) })) }
  async getIdempotency(tenantId: string, key: string): Promise<{ requestHash: string; response: unknown } | null> { const row = await this.client.tusBillingIdempotency.findUnique({ where: { tenantId_key: { tenantId, key } } }); return row ? { requestHash: String(field(row, 'requestHash')), response: field(row, 'response') } : null }
  async saveIdempotency(tenantId: string, key: string, value: { requestHash: string; response: unknown }): Promise<void> {
    const existing = await this.client.tusBillingIdempotency.findUnique({ where: { tenantId_key: { tenantId, key } } })
    if (existing) {
      if (String(field(existing, 'requestHash')) !== value.requestHash || recordFingerprint(field(existing, 'response')) !== recordFingerprint(value.response)) throw new BillingError(409, 'IDEMPOTENCY_CONFLICT', 'billing idempotency records are immutable')
      return
    }
    await this.client.tusBillingIdempotency.create({ data: { id: `billing-idempotency-${tenantId}-${key}`, tenantId, key, requestHash: value.requestHash, response: value.response } })
  }
  async appendAudit(value: RegistroAuditoriaFacturacion): Promise<void> { await this.client.tusBillingAudit.create({ data: auditoriaAFila(value) }) }
  async listAudit(tenantId: string): Promise<RegistroAuditoriaFacturacion[]> { return (await this.client.tusBillingAudit.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })).map(auditoriaDesdeFila) }
  async appendOutbox(value: BillingOutboxRecord): Promise<void> { await this.client.tusBillingOutbox.create({ data: outboxToRow(value) }) }
  async listOutbox(tenantId: string): Promise<BillingOutboxRecord[]> { return (await this.client.tusBillingOutbox.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })).map(outboxFromRow) }
  async saveAccountingExport(value: BillingAccountingExport): Promise<BillingAccountingExport> { return exportFromRow(await this.client.tusAccountingExport.create({ data: exportToRow(value) })) }
}

function accountToRow(value: BillingAccount): Row { return { id: value.billingAccountId, ...value, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) } }
function accountFromRow(row: Row): BillingAccount { return { contractVersion: field(row, 'contractVersion'), billingAccountId: text(row, 'billingAccountId'), tenantId: text(row, 'tenantId'), partyId: text(row, 'partyId'), role: field(row, 'role'), status: field(row, 'status'), createdAt: date(field(row, 'createdAt')), updatedAt: date(field(row, 'updatedAt')) } }
function planToRow(value: BillingSubscriptionPlan): Row { return { id: value.planId, ...value, amountMinor: value.amountMinor, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) } }
function planFromRow(row: Row): BillingSubscriptionPlan { return { contractVersion: field(row, 'contractVersion'), planId: text(row, 'planId'), tenantId: text(row, 'tenantId'), name: text(row, 'name'), amountMinor: bigint(field(row, 'amountMinor')), currency: BILLING_CURRENCY, interval: field(row, 'interval'), status: field(row, 'status'), createdAt: date(field(row, 'createdAt')), updatedAt: date(field(row, 'updatedAt')) } }
function subscriptionToRow(value: BillingSubscription): Row { return { id: value.subscriptionId, ...value, planSnapshot: value.planSnapshot, amountMinor: value.amountMinor, cancelledAt: value.cancelledAt === null ? null : new Date(value.cancelledAt), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) } }
function subscriptionFromRow(row: Row): BillingSubscription { const plan = planFromRow(recordField(row, 'planSnapshot')); const cancelledAt = field<unknown>(row, 'cancelledAt'); return { contractVersion: field(row, 'contractVersion'), subscriptionId: text(row, 'subscriptionId'), tenantId: text(row, 'tenantId'), customerId: text(row, 'customerId'), planId: text(row, 'planId'), planSnapshot: plan, currency: BILLING_CURRENCY, amountMinor: bigint(field(row, 'amountMinor')), interval: field(row, 'interval'), status: field(row, 'status'), dunningAttempt: Number(field(row, 'dunningAttempt') ?? 0), cancelledAt: cancelledAt ? date(cancelledAt) : null, cancelReason: nullableText(row, 'cancelReason'), createdAt: date(field(row, 'createdAt')), updatedAt: date(field(row, 'updatedAt')) } }
function invoiceToRow(value: BillingInvoice): Row { return { id: value.invoiceId, invoiceId: value.invoiceId, tenantId: value.tenantId, accountId: value.accountId, commitmentId: value.commitmentId, paymentId: value.paymentId, orderId: value.orderId, posOperationId: value.posOperationId, currency: value.currency, subtotal: value.subtotalMinor, taxAmount: value.taxMinor, feeAmount: value.feeMinor, total: value.totalMinor, subtotalMinor: value.subtotalMinor, taxMinor: value.taxMinor, feeMinor: value.feeMinor, totalMinor: value.totalMinor, status: value.status, number: value.number, invoiceType: value.invoiceType, taxSnapshot: value.taxSnapshot, snapshotVersion: value.snapshotVersion, issuedAt: value.issuedAt === null || value.issuedAt === undefined ? null : new Date(value.issuedAt), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) } }
function invoiceFromRow(row: Row): BillingInvoice { const issuedAt = field<unknown>(row, 'issuedAt'); return { contractVersion: field(row, 'contractVersion'), invoiceId: text(row, 'invoiceId'), tenantId: text(row, 'tenantId'), accountId: text(row, 'accountId'), commitmentId: text(row, 'commitmentId'), paymentId: text(row, 'paymentId'), orderId: text(row, 'orderId'), posOperationId: nullableText(row, 'posOperationId'), currency: BILLING_CURRENCY, subtotalMinor: bigint(field(row, 'subtotalMinor')), taxMinor: bigint(field(row, 'taxMinor')), feeMinor: bigint(field(row, 'feeMinor')), totalMinor: bigint(field(row, 'totalMinor')), status: field(row, 'status'), number: nullableText(row, 'number'), invoiceType: text(row, 'invoiceType'), taxSnapshot: field(row, 'taxSnapshot'), lines: rowsField(row, 'lines').map(lineFromRow), snapshotVersion: Number(field(row, 'snapshotVersion') ?? 1), issuedAt: issuedAt ? date(issuedAt) : null, createdAt: date(field(row, 'createdAt')), updatedAt: date(field(row, 'updatedAt')) } }
function lineToRow(invoice: BillingInvoice, line: BillingInvoice['lines'][number]): Row { return { id: line.lineId, tenantId: invoice.tenantId, invoiceId: invoice.invoiceId, lineId: line.lineId, description: line.description, quantity: line.quantity, unitMinor: line.unitMinor, taxMinor: line.taxMinor, totalMinor: line.totalMinor, currency: line.currency, snapshot: line, createdAt: new Date(invoice.createdAt) } }
function lineFromRow(row: Row): BillingInvoice['lines'][number] { const snapshot = recordField(row, 'snapshot'); return { lineId: text(snapshot, 'lineId'), description: text(snapshot, 'description'), quantity: Number(field(snapshot, 'quantity')), unitMinor: bigint(field(snapshot, 'unitMinor')), taxMinor: bigint(field(snapshot, 'taxMinor')), totalMinor: bigint(field(snapshot, 'totalMinor')), currency: BILLING_CURRENCY } }
function creditToRow(value: BillingCreditNote): Row { return { id: value.creditNoteId, ...value, amountMinor: value.amountMinor, createdAt: new Date(value.createdAt) } }
function creditFromRow(row: Row): BillingCreditNote { return { creditNoteId: text(row, 'creditNoteId'), tenantId: text(row, 'tenantId'), invoiceId: text(row, 'invoiceId'), paymentId: text(row, 'paymentId'), orderId: text(row, 'orderId'), posOperationId: nullableText(row, 'posOperationId'), currency: BILLING_CURRENCY, amountMinor: bigint(field(row, 'amountMinor')), reason: text(row, 'reason'), status: 'accepted', createdAt: date(field(row, 'createdAt')) } }
function refundToRow(value: BillingRefund): Row { return { id: value.refundId, ...value, amountMinor: value.amountMinor, createdAt: new Date(value.createdAt) } }
function refundFromRow(row: Row): BillingRefund { return { refundId: text(row, 'refundId'), tenantId: text(row, 'tenantId'), invoiceId: text(row, 'invoiceId'), paymentId: text(row, 'paymentId'), orderId: text(row, 'orderId'), posOperationId: nullableText(row, 'posOperationId'), currency: BILLING_CURRENCY, amountMinor: bigint(field(row, 'amountMinor')), reason: text(row, 'reason'), status: 'accepted', createdAt: date(field(row, 'createdAt')) } }
function ledgerToRow(value: BillingLedgerEntry): Row { return { id: value.entryId, ...value, amountMinor: value.amountMinor, createdAt: new Date(value.createdAt) } }
function ledgerFromRow(row: Row): BillingLedgerEntry { return { entryId: text(row, 'entryId'), tenantId: text(row, 'tenantId'), invoiceId: text(row, 'invoiceId'), entryType: field(row, 'entryType'), amountMinor: bigint(field(row, 'amountMinor')), currency: BILLING_CURRENCY, linkedEntryId: nullableText(row, 'linkedEntryId'), creditNoteId: nullableText(row, 'creditNoteId'), refundId: nullableText(row, 'refundId'), paymentId: text(row, 'paymentId'), orderId: text(row, 'orderId'), posOperationId: nullableText(row, 'posOperationId'), immutable: true, createdAt: date(field(row, 'createdAt')) } }
function dunningToRow(value: BillingDunningRecord): Row { return { id: value.dunningId, ...value, retryAt: value.retryAt === null ? null : new Date(value.retryAt), createdAt: new Date(value.createdAt) } }
function dunningFromRow(row: Row): BillingDunningRecord { const retryAt = field<unknown>(row, 'retryAt'); return { dunningId: text(row, 'dunningId'), tenantId: text(row, 'tenantId'), subscriptionId: text(row, 'subscriptionId'), attempt: Number(field(row, 'attempt')), reason: text(row, 'reason'), status: field(row, 'status'), retryAt: retryAt ? date(retryAt) : null, createdAt: date(field(row, 'createdAt')) } }
function auditoriaAFila(value: RegistroAuditoriaFacturacion): Row { return { id: value.auditId, ...value, createdAt: new Date(value.createdAt) } }
function auditoriaDesdeFila(row: Row): RegistroAuditoriaFacturacion { return { auditId: text(row, 'auditId'), tenantId: text(row, 'tenantId'), actorId: text(row, 'actorId'), correlationId: text(row, 'correlationId'), action: text(row, 'action'), resourceId: text(row, 'resourceId'), outcome: field(row, 'outcome'), reason: nullableText(row, 'reason'), createdAt: date(field(row, 'createdAt')) } }
function outboxToRow(value: BillingOutboxRecord): Row { return { id: value.eventId, ...value, availableAt: new Date(value.availableAt), createdAt: new Date(value.createdAt) } }
function outboxFromRow(row: Row): BillingOutboxRecord { return { eventId: text(row, 'eventId'), tenantId: text(row, 'tenantId'), correlationId: text(row, 'correlationId'), eventType: text(row, 'eventType'), aggregateId: text(row, 'aggregateId'), payload: recordField(row, 'payload'), status: field(row, 'status'), attempts: Number(field(row, 'attempts')), availableAt: date(field(row, 'availableAt')), createdAt: date(field(row, 'createdAt')) } }
function exportToRow(value: BillingAccountingExport): Row { return { id: value.exportId, ...value, createdAt: new Date(value.createdAt) } }
function exportFromRow(row: Row): BillingAccountingExport { return { exportId: text(row, 'exportId'), tenantId: text(row, 'tenantId'), invoiceIds: stringArrayField(row, 'invoiceIds'), ledgerEntryIds: stringArrayField(row, 'ledgerEntryIds'), externalApprovalReference: text(row, 'externalApprovalReference'), status: 'prepared', postedExternally: false, createdAt: date(field(row, 'createdAt')) } }
function bigint(value: unknown): bigint { if (typeof value === 'bigint') return value; if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value); if (typeof value === 'string' && /^\d+$/u.test(value)) return BigInt(value); throw new Error('billing persistence minor unit is invalid') }
function date(value: unknown): number { const result = value instanceof Date ? value : new Date(String(value)); if (!Number.isFinite(result.getTime())) throw new Error('billing persistence date is invalid'); return result.getTime() }
function field<T>(row: Row, name: string): T { return row[name] as T }
function text(row: Row, name: string): string { return String(field<unknown>(row, name)) }
function nullableText(row: Row, name: string): string | null { const value = field<unknown>(row, name); return value === null || value === undefined ? null : String(value) }
function recordField(row: Row, name: string): Row { const value = field<unknown>(row, name); return isRecord(value) ? value : row }
function rowsField(row: Row, name: string): Row[] { const value = field<unknown>(row, name); return Array.isArray(value) ? value.filter(isRecord) : [] }
function stringArrayField(row: Row, name: string): string[] { const value = field<unknown>(row, name); return Array.isArray(value) ? value.map(String) : [] }
function isRecord(value: unknown): value is Row { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function recordFingerprint(value: unknown): string { return JSON.stringify(value, (_key: string, item: unknown) => typeof item === 'bigint' ? `${item}n` : item) ?? '' }

export default { PrismaBillingStore }
