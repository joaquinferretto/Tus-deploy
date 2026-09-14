import type {
  CuentaFacturacion,
  ExportacionContableFacturacion,
  RegistroAuditoriaFacturacion,
  NotaCredito,
  RegistroGestionMora,
  Factura,
  MovimientoContable,
  RegistroBandejaSalidaFacturacion,
  Reintegro,
  PuertoAlmacenFacturacion,
  Suscripcion,
  PlanSuscripcion,
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

export type ClientePrismaFacturacion = {
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

export class PrismaBillingStore implements PuertoAlmacenFacturacion {
  constructor(private readonly client: ClientePrismaFacturacion) {}

  async saveAccount(value: CuentaFacturacion): Promise<CuentaFacturacion> {
    const row = await this.client.tusBillingAccount.upsert({ where: { tenantId_billingAccountId: { tenantId: value.tenantId, billingAccountId: value.billingAccountId } }, create: convertirCuentaFacturacionEnFila(value), update: convertirCuentaFacturacionEnFila(value) })
    return convertirFilaEnCuentaFacturacion(row)
  }

  async getAccount(tenantId: string, billingAccountId: string): Promise<CuentaFacturacion | null> {
    const row = await this.client.tusBillingAccount.findUnique({ where: { tenantId_billingAccountId: { tenantId, billingAccountId } } })
    return row ? convertirFilaEnCuentaFacturacion(row) : null
  }

  async savePlan(value: PlanSuscripcion): Promise<PlanSuscripcion> {
    const row = await this.client.tusSubscriptionPlan.upsert({ where: { tenantId_planId: { tenantId: value.tenantId, planId: value.planId } }, create: convertirPlanSuscripcionEnFila(value), update: convertirPlanSuscripcionEnFila(value) })
    return convertirFilaEnPlanSuscripcion(row)
  }

  async getPlan(tenantId: string, planId: string): Promise<PlanSuscripcion | null> {
    const row = await this.client.tusSubscriptionPlan.findUnique({ where: { tenantId_planId: { tenantId, planId } } })
    return row ? convertirFilaEnPlanSuscripcion(row) : null
  }

  async saveSubscription(value: Suscripcion): Promise<Suscripcion> {
    const row = await this.client.tusSubscription.upsert({ where: { tenantId_subscriptionId: { tenantId: value.tenantId, subscriptionId: value.subscriptionId } }, create: convertirSuscripcionEnFila(value), update: convertirSuscripcionEnFila(value) })
    return convertirFilaEnSuscripcion(row)
  }

  async getSubscription(tenantId: string, subscriptionId: string): Promise<Suscripcion | null> {
    const row = await this.client.tusSubscription.findUnique({ where: { tenantId_subscriptionId: { tenantId, subscriptionId } } })
    return row ? convertirFilaEnSuscripcion(row) : null
  }

  async saveInvoice(value: Factura): Promise<Factura> {
    if (value.currency !== BILLING_CURRENCY) throw new BillingError(400, 'UNSUPPORTED_CURRENCY', 'billing persistence accepts ARS only')
    const existing = await this.client.tusInvoice.findUnique({ where: { tenantId_invoiceId: { tenantId: value.tenantId, invoiceId: value.invoiceId } } })
    if (existing) {
      if (!this.client.tusInvoice.update) throw new BillingError(503, 'BILLING_INVOICE_UPDATE_UNAVAILABLE', 'billing invoice issuance update is unavailable')
      const row = await this.client.tusInvoice.update({ where: { tenantId_invoiceId: { tenantId: value.tenantId, invoiceId: value.invoiceId } }, data: convertirFacturaEnFila(value) })
      return convertirFilaEnFactura({ ...row, lines: value.lines })
    }
    const row = await this.client.tusInvoice.create({ data: convertirFacturaEnFila(value) })
    if (value.lines.length > 0 && this.client.tusInvoiceLine.createMany) await this.client.tusInvoiceLine.createMany({ data: value.lines.map((line) => convertirLineaFacturaEnFila(value, line)) })
    return convertirFilaEnFactura({ ...row, lines: value.lines })
  }

  async getInvoice(tenantId: string, invoiceId: string): Promise<Factura | null> {
    const row = await this.client.tusInvoice.findUnique({ where: { tenantId_invoiceId: { tenantId, invoiceId } }, include: { lines: true } })
    return row ? convertirFilaEnFactura(row) : null
  }

  async nextInvoiceNumber(tenantId: string): Promise<string> {
    const row = await this.client.tusBillingNumberSequence.upsert({ where: { tenantId }, create: { id: `billing-sequence-${tenantId}`, tenantId, nextNumber: 2 }, update: { nextNumber: { increment: 1 } } })
    return `A-${String(Number(field(row, 'nextNumber')) - 1).padStart(6, '0')}`
  }

  async saveCreditNote(value: NotaCredito): Promise<NotaCredito> {
    const row = await this.client.tusCreditNote.create({ data: convertirNotaCreditoEnFila(value) })
    return convertirFilaEnNotaCredito(row)
  }

  async getCreditNote(tenantId: string, creditNoteId: string): Promise<NotaCredito | null> {
    const row = await this.client.tusCreditNote.findUnique({ where: { tenantId_creditNoteId: { tenantId, creditNoteId } } })
    return row ? convertirFilaEnNotaCredito(row) : null
  }

  async saveRefund(value: Reintegro): Promise<Reintegro> { return convertirFilaEnReintegro(await this.client.tusBillingRefund.create({ data: convertirReintegroEnFila(value) })) }
  async getRefund(tenantId: string, refundId: string): Promise<Reintegro | null> { const row = await this.client.tusBillingRefund.findUnique({ where: { tenantId_refundId: { tenantId, refundId } } }); return row ? convertirFilaEnReintegro(row) : null }
  async appendLedger(value: MovimientoContable): Promise<MovimientoContable> { return convertirFilaEnMovimientoContable(await this.client.tusBillingLedger.create({ data: convertirMovimientoContableEnFila(value) })) }
  async listLedger(tenantId: string): Promise<MovimientoContable[]> { return (await this.client.tusBillingLedger.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })).map(convertirFilaEnMovimientoContable) }
  async saveDunning(value: RegistroGestionMora): Promise<RegistroGestionMora> { return convertirFilaEnRegistroGestionMora(await this.client.tusBillingDunning.upsert({ where: { tenantId_dunningId: { tenantId: value.tenantId, dunningId: value.dunningId } }, create: convertirRegistroGestionMoraEnFila(value), update: convertirRegistroGestionMoraEnFila(value) })) }
  async getIdempotency(tenantId: string, key: string): Promise<{ requestHash: string; response: unknown } | null> { const row = await this.client.tusBillingIdempotency.findUnique({ where: { tenantId_key: { tenantId, key } } }); return row ? { requestHash: String(field(row, 'requestHash')), response: field(row, 'response') } : null }
  async saveIdempotency(tenantId: string, key: string, value: { requestHash: string; response: unknown }): Promise<void> {
    const existing = await this.client.tusBillingIdempotency.findUnique({ where: { tenantId_key: { tenantId, key } } })
    if (existing) {
      if (String(field(existing, 'requestHash')) !== value.requestHash || huellaRegistro(field(existing, 'response')) !== huellaRegistro(value.response)) throw new BillingError(409, 'IDEMPOTENCY_CONFLICT', 'billing idempotency records are immutable')
      return
    }
    await this.client.tusBillingIdempotency.create({ data: { id: `billing-idempotency-${tenantId}-${key}`, tenantId, key, requestHash: value.requestHash, response: value.response } })
  }
  async appendAudit(value: RegistroAuditoriaFacturacion): Promise<void> { await this.client.tusBillingAudit.create({ data: auditoriaAFila(value) }) }
  async listAudit(tenantId: string): Promise<RegistroAuditoriaFacturacion[]> { return (await this.client.tusBillingAudit.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })).map(auditoriaDesdeFila) }
  async appendOutbox(value: RegistroBandejaSalidaFacturacion): Promise<void> { await this.client.tusBillingOutbox.create({ data: convertirRegistroBandejaSalidaFacturacionEnFila(value) }) }
  async listOutbox(tenantId: string): Promise<RegistroBandejaSalidaFacturacion[]> { return (await this.client.tusBillingOutbox.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })).map(convertirFilaEnRegistroBandejaSalidaFacturacion) }
  async saveAccountingExport(value: ExportacionContableFacturacion): Promise<ExportacionContableFacturacion> { return convertirFilaEnExportacionContableFacturacion(await this.client.tusAccountingExport.create({ data: convertirExportacionContableFacturacionEnFila(value) })) }
}

function convertirCuentaFacturacionEnFila(value: CuentaFacturacion): Row { return { id: value.billingAccountId, ...value, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) } }
function convertirFilaEnCuentaFacturacion(row: Row): CuentaFacturacion { return { contractVersion: field(row, 'contractVersion'), billingAccountId: text(row, 'billingAccountId'), tenantId: text(row, 'tenantId'), partyId: text(row, 'partyId'), role: field(row, 'role'), status: field(row, 'status'), createdAt: date(field(row, 'createdAt')), updatedAt: date(field(row, 'updatedAt')) } }
function convertirPlanSuscripcionEnFila(value: PlanSuscripcion): Row { return { id: value.planId, ...value, amountMinor: value.amountMinor, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) } }
function convertirFilaEnPlanSuscripcion(row: Row): PlanSuscripcion { return { contractVersion: field(row, 'contractVersion'), planId: text(row, 'planId'), tenantId: text(row, 'tenantId'), name: text(row, 'name'), amountMinor: bigint(field(row, 'amountMinor')), currency: BILLING_CURRENCY, interval: field(row, 'interval'), status: field(row, 'status'), createdAt: date(field(row, 'createdAt')), updatedAt: date(field(row, 'updatedAt')) } }
function convertirSuscripcionEnFila(value: Suscripcion): Row { return { id: value.subscriptionId, ...value, planSnapshot: value.planSnapshot, amountMinor: value.amountMinor, cancelledAt: value.cancelledAt === null ? null : new Date(value.cancelledAt), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) } }
function convertirFilaEnSuscripcion(row: Row): Suscripcion { const plan = convertirFilaEnPlanSuscripcion(campoRegistro(row, 'planSnapshot')); const cancelledAt = field<unknown>(row, 'cancelledAt'); return { contractVersion: field(row, 'contractVersion'), subscriptionId: text(row, 'subscriptionId'), tenantId: text(row, 'tenantId'), customerId: text(row, 'customerId'), planId: text(row, 'planId'), planSnapshot: plan, currency: BILLING_CURRENCY, amountMinor: bigint(field(row, 'amountMinor')), interval: field(row, 'interval'), status: field(row, 'status'), dunningAttempt: Number(field(row, 'dunningAttempt') ?? 0), cancelledAt: cancelledAt ? date(cancelledAt) : null, cancelReason: nullableText(row, 'cancelReason'), createdAt: date(field(row, 'createdAt')), updatedAt: date(field(row, 'updatedAt')) } }
function convertirFacturaEnFila(value: Factura): Row { return { id: value.invoiceId, invoiceId: value.invoiceId, tenantId: value.tenantId, accountId: value.accountId, commitmentId: value.commitmentId, paymentId: value.paymentId, orderId: value.orderId, posOperationId: value.posOperationId, currency: value.currency, subtotal: value.subtotalMinor, taxAmount: value.taxMinor, feeAmount: value.feeMinor, total: value.totalMinor, subtotalMinor: value.subtotalMinor, taxMinor: value.taxMinor, feeMinor: value.feeMinor, totalMinor: value.totalMinor, status: value.status, number: value.number, invoiceType: value.invoiceType, taxSnapshot: value.taxSnapshot, snapshotVersion: value.snapshotVersion, issuedAt: value.issuedAt === null || value.issuedAt === undefined ? null : new Date(value.issuedAt), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) } }
function convertirFilaEnFactura(row: Row): Factura { const issuedAt = field<unknown>(row, 'issuedAt'); return { contractVersion: field(row, 'contractVersion'), invoiceId: text(row, 'invoiceId'), tenantId: text(row, 'tenantId'), accountId: text(row, 'accountId'), commitmentId: text(row, 'commitmentId'), paymentId: text(row, 'paymentId'), orderId: text(row, 'orderId'), posOperationId: nullableText(row, 'posOperationId'), currency: BILLING_CURRENCY, subtotalMinor: bigint(field(row, 'subtotalMinor')), taxMinor: bigint(field(row, 'taxMinor')), feeMinor: bigint(field(row, 'feeMinor')), totalMinor: bigint(field(row, 'totalMinor')), status: field(row, 'status'), number: nullableText(row, 'number'), invoiceType: text(row, 'invoiceType'), taxSnapshot: field(row, 'taxSnapshot'), lines: campoFilas(row, 'lines').map(convertirFilaEnLineaFactura), snapshotVersion: Number(field(row, 'snapshotVersion') ?? 1), issuedAt: issuedAt ? date(issuedAt) : null, createdAt: date(field(row, 'createdAt')), updatedAt: date(field(row, 'updatedAt')) } }
function convertirLineaFacturaEnFila(invoice: Factura, line: Factura['lines'][number]): Row { return { id: line.lineId, tenantId: invoice.tenantId, invoiceId: invoice.invoiceId, lineId: line.lineId, description: line.description, quantity: line.quantity, unitMinor: line.unitMinor, taxMinor: line.taxMinor, totalMinor: line.totalMinor, currency: line.currency, snapshot: line, createdAt: new Date(invoice.createdAt) } }
function convertirFilaEnLineaFactura(row: Row): Factura['lines'][number] { const snapshot = campoRegistro(row, 'snapshot'); return { lineId: text(snapshot, 'lineId'), description: text(snapshot, 'description'), quantity: Number(field(snapshot, 'quantity')), unitMinor: bigint(field(snapshot, 'unitMinor')), taxMinor: bigint(field(snapshot, 'taxMinor')), totalMinor: bigint(field(snapshot, 'totalMinor')), currency: BILLING_CURRENCY } }
function convertirNotaCreditoEnFila(value: NotaCredito): Row { return { id: value.creditNoteId, ...value, amountMinor: value.amountMinor, createdAt: new Date(value.createdAt) } }
function convertirFilaEnNotaCredito(row: Row): NotaCredito { return { creditNoteId: text(row, 'creditNoteId'), tenantId: text(row, 'tenantId'), invoiceId: text(row, 'invoiceId'), paymentId: text(row, 'paymentId'), orderId: text(row, 'orderId'), posOperationId: nullableText(row, 'posOperationId'), currency: BILLING_CURRENCY, amountMinor: bigint(field(row, 'amountMinor')), reason: text(row, 'reason'), status: 'accepted', createdAt: date(field(row, 'createdAt')) } }
function convertirReintegroEnFila(value: Reintegro): Row { return { id: value.refundId, ...value, amountMinor: value.amountMinor, createdAt: new Date(value.createdAt) } }
function convertirFilaEnReintegro(row: Row): Reintegro { return { refundId: text(row, 'refundId'), tenantId: text(row, 'tenantId'), invoiceId: text(row, 'invoiceId'), paymentId: text(row, 'paymentId'), orderId: text(row, 'orderId'), posOperationId: nullableText(row, 'posOperationId'), currency: BILLING_CURRENCY, amountMinor: bigint(field(row, 'amountMinor')), reason: text(row, 'reason'), status: 'accepted', createdAt: date(field(row, 'createdAt')) } }
function convertirMovimientoContableEnFila(value: MovimientoContable): Row { return { id: value.entryId, ...value, amountMinor: value.amountMinor, createdAt: new Date(value.createdAt) } }
function convertirFilaEnMovimientoContable(row: Row): MovimientoContable { return { entryId: text(row, 'entryId'), tenantId: text(row, 'tenantId'), invoiceId: text(row, 'invoiceId'), entryType: field(row, 'entryType'), amountMinor: bigint(field(row, 'amountMinor')), currency: BILLING_CURRENCY, linkedEntryId: nullableText(row, 'linkedEntryId'), creditNoteId: nullableText(row, 'creditNoteId'), refundId: nullableText(row, 'refundId'), paymentId: text(row, 'paymentId'), orderId: text(row, 'orderId'), posOperationId: nullableText(row, 'posOperationId'), immutable: true, createdAt: date(field(row, 'createdAt')) } }
function convertirRegistroGestionMoraEnFila(value: RegistroGestionMora): Row { return { id: value.dunningId, ...value, retryAt: value.retryAt === null ? null : new Date(value.retryAt), createdAt: new Date(value.createdAt) } }
function convertirFilaEnRegistroGestionMora(row: Row): RegistroGestionMora { const retryAt = field<unknown>(row, 'retryAt'); return { dunningId: text(row, 'dunningId'), tenantId: text(row, 'tenantId'), subscriptionId: text(row, 'subscriptionId'), attempt: Number(field(row, 'attempt')), reason: text(row, 'reason'), status: field(row, 'status'), retryAt: retryAt ? date(retryAt) : null, createdAt: date(field(row, 'createdAt')) } }
function auditoriaAFila(value: RegistroAuditoriaFacturacion): Row { return { id: value.auditId, ...value, createdAt: new Date(value.createdAt) } }
function auditoriaDesdeFila(row: Row): RegistroAuditoriaFacturacion { return { auditId: text(row, 'auditId'), tenantId: text(row, 'tenantId'), actorId: text(row, 'actorId'), correlationId: text(row, 'correlationId'), action: text(row, 'action'), resourceId: text(row, 'resourceId'), outcome: field(row, 'outcome'), reason: nullableText(row, 'reason'), createdAt: date(field(row, 'createdAt')) } }
function convertirRegistroBandejaSalidaFacturacionEnFila(value: RegistroBandejaSalidaFacturacion): Row { return { id: value.eventId, ...value, availableAt: new Date(value.availableAt), createdAt: new Date(value.createdAt) } }
function convertirFilaEnRegistroBandejaSalidaFacturacion(row: Row): RegistroBandejaSalidaFacturacion { return { eventId: text(row, 'eventId'), tenantId: text(row, 'tenantId'), correlationId: text(row, 'correlationId'), eventType: text(row, 'eventType'), aggregateId: text(row, 'aggregateId'), payload: campoRegistro(row, 'payload'), status: field(row, 'status'), attempts: Number(field(row, 'attempts')), availableAt: date(field(row, 'availableAt')), createdAt: date(field(row, 'createdAt')) } }
function convertirExportacionContableFacturacionEnFila(value: ExportacionContableFacturacion): Row { return { id: value.exportId, ...value, createdAt: new Date(value.createdAt) } }
function convertirFilaEnExportacionContableFacturacion(row: Row): ExportacionContableFacturacion { return { exportId: text(row, 'exportId'), tenantId: text(row, 'tenantId'), invoiceIds: campoArrayCadenas(row, 'invoiceIds'), ledgerEntryIds: campoArrayCadenas(row, 'ledgerEntryIds'), externalApprovalReference: text(row, 'externalApprovalReference'), status: 'prepared', postedExternally: false, createdAt: date(field(row, 'createdAt')) } }
function bigint(value: unknown): bigint { if (typeof value === 'bigint') return value; if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value); if (typeof value === 'string' && /^\d+$/u.test(value)) return BigInt(value); throw new Error('billing persistence minor unit is invalid') }
function date(value: unknown): number { const result = value instanceof Date ? value : new Date(String(value)); if (!Number.isFinite(result.getTime())) throw new Error('billing persistence date is invalid'); return result.getTime() }
function field<T>(row: Row, name: string): T { return row[name] as T }
function text(row: Row, name: string): string { return String(field<unknown>(row, name)) }
function nullableText(row: Row, name: string): string | null { const value = field<unknown>(row, name); return value === null || value === undefined ? null : String(value) }
function campoRegistro(row: Row, name: string): Row { const value = field<unknown>(row, name); return esRegistro(value) ? value : row }
function campoFilas(row: Row, name: string): Row[] { const value = field<unknown>(row, name); return Array.isArray(value) ? value.filter(esRegistro) : [] }
function campoArrayCadenas(row: Row, name: string): string[] { const value = field<unknown>(row, name); return Array.isArray(value) ? value.map(String) : [] }
function esRegistro(value: unknown): value is Row { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function huellaRegistro(value: unknown): string { return JSON.stringify(value, (_key: string, item: unknown) => typeof item === 'bigint' ? `${item}n` : item) ?? '' }

export default { PrismaBillingStore }
