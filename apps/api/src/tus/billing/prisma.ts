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
  cuentaFacturacion: Delegate
  planSuscripcion: Delegate
  suscripcion: Delegate
  factura: Delegate
  lineaFactura: Delegate
  notaCredito: Delegate
  reintegroFacturacion: Delegate
  movimientoContableFacturacion: Delegate
  idempotenciaFacturacion: Delegate
  auditoriaFacturacion: Delegate
  outboxFacturacion: Delegate
  gestionMora: Delegate
  secuenciaNumeracion: Delegate
  exportacionContable: Delegate
}

export class PrismaBillingStore implements PuertoAlmacenFacturacion {
  constructor(private readonly client: ClientePrismaFacturacion) {}

  async saveAccount(value: CuentaFacturacion): Promise<CuentaFacturacion> {
    const row = await this.client.cuentaFacturacion.upsert({ where: { tenantId_cuentaFacturacionId: { tenantId: value.tenantId, cuentaFacturacionId: value.billingAccountId } }, create: convertirCuentaFacturacionEnFila(value), update: convertirCuentaFacturacionEnFila(value) })
    return convertirFilaEnCuentaFacturacion(row)
  }

  async getAccount(tenantId: string, billingAccountId: string): Promise<CuentaFacturacion | null> {
    const row = await this.client.cuentaFacturacion.findUnique({ where: { tenantId_cuentaFacturacionId: { tenantId, cuentaFacturacionId: billingAccountId } } })
    return row ? convertirFilaEnCuentaFacturacion(row) : null
  }

  async savePlan(value: PlanSuscripcion): Promise<PlanSuscripcion> {
    const row = await this.client.planSuscripcion.upsert({ where: { tenantId_planId: { tenantId: value.tenantId, planId: value.planId } }, create: convertirPlanSuscripcionEnFila(value), update: convertirPlanSuscripcionEnFila(value) })
    return convertirFilaEnPlanSuscripcion(row)
  }

  async getPlan(tenantId: string, planId: string): Promise<PlanSuscripcion | null> {
    const row = await this.client.planSuscripcion.findUnique({ where: { tenantId_planId: { tenantId, planId } } })
    return row ? convertirFilaEnPlanSuscripcion(row) : null
  }

  async saveSubscription(value: Suscripcion): Promise<Suscripcion> {
    const row = await this.client.suscripcion.upsert({ where: { tenantId_suscripcionId: { tenantId: value.tenantId, suscripcionId: value.subscriptionId } }, create: convertirSuscripcionEnFila(value), update: convertirSuscripcionEnFila(value) })
    return convertirFilaEnSuscripcion(row)
  }

  async getSubscription(tenantId: string, subscriptionId: string): Promise<Suscripcion | null> {
    const row = await this.client.suscripcion.findUnique({ where: { tenantId_suscripcionId: { tenantId, suscripcionId: subscriptionId } } })
    return row ? convertirFilaEnSuscripcion(row) : null
  }

  async saveInvoice(value: Factura): Promise<Factura> {
    if (value.currency !== BILLING_CURRENCY) throw new BillingError(400, 'UNSUPPORTED_CURRENCY', 'billing persistence accepts ARS only')
    const existing = await this.client.factura.findUnique({ where: { tenantId_facturaId: { tenantId: value.tenantId, facturaId: value.invoiceId } } })
    if (existing) {
      if (!this.client.factura.update) throw new BillingError(503, 'BILLING_INVOICE_UPDATE_UNAVAILABLE', 'billing invoice issuance update is unavailable')
      const row = await this.client.factura.update({ where: { tenantId_facturaId: { tenantId: value.tenantId, facturaId: value.invoiceId } }, data: convertirFacturaEnFila(value) })
      return convertirFilaEnFactura({ ...row, lineas: value.lines })
    }
    const row = await this.client.factura.create({ data: convertirFacturaEnFila(value) })
    if (value.lines.length > 0 && this.client.lineaFactura.createMany) await this.client.lineaFactura.createMany({ data: value.lines.map((line) => convertirLineaFacturaEnFila(value, line)) })
    return convertirFilaEnFactura({ ...row, lineas: value.lines })
  }

  async getInvoice(tenantId: string, invoiceId: string): Promise<Factura | null> {
    const row = await this.client.factura.findUnique({ where: { tenantId_facturaId: { tenantId, facturaId: invoiceId } }, include: { lineas: true } })
    return row ? convertirFilaEnFactura(row) : null
  }

  async nextInvoiceNumber(tenantId: string): Promise<string> {
    const row = await this.client.secuenciaNumeracion.upsert({ where: { tenantId }, create: { id: `billing-sequence-${tenantId}`, tenantId, siguienteNumero: 2 }, update: { siguienteNumero: { increment: 1 } } })
    return `A-${String(Number(field(row, 'siguienteNumero')) - 1).padStart(6, '0')}`
  }

  async saveCreditNote(value: NotaCredito): Promise<NotaCredito> {
    const row = await this.client.notaCredito.create({ data: convertirNotaCreditoEnFila(value) })
    return convertirFilaEnNotaCredito(row)
  }

  async getCreditNote(tenantId: string, creditNoteId: string): Promise<NotaCredito | null> {
    const row = await this.client.notaCredito.findUnique({ where: { tenantId_notaCreditoId: { tenantId, notaCreditoId: creditNoteId } } })
    return row ? convertirFilaEnNotaCredito(row) : null
  }

  async saveRefund(value: Reintegro): Promise<Reintegro> { return convertirFilaEnReintegro(await this.client.reintegroFacturacion.create({ data: convertirReintegroEnFila(value) })) }
  async getRefund(tenantId: string, refundId: string): Promise<Reintegro | null> { const row = await this.client.reintegroFacturacion.findUnique({ where: { tenantId_reintegroId: { tenantId, reintegroId: refundId } } }); return row ? convertirFilaEnReintegro(row) : null }
  async appendLedger(value: MovimientoContable): Promise<MovimientoContable> { return convertirFilaEnMovimientoContable(await this.client.movimientoContableFacturacion.create({ data: convertirMovimientoContableEnFila(value) })) }
  async listLedger(tenantId: string): Promise<MovimientoContable[]> { return (await this.client.movimientoContableFacturacion.findMany({ where: { tenantId }, orderBy: { fechaCreacion: 'asc' } })).map(convertirFilaEnMovimientoContable) }
  async saveDunning(value: RegistroGestionMora): Promise<RegistroGestionMora> { return convertirFilaEnRegistroGestionMora(await this.client.gestionMora.upsert({ where: { tenantId_moraId: { tenantId: value.tenantId, moraId: value.dunningId } }, create: convertirRegistroGestionMoraEnFila(value), update: convertirRegistroGestionMoraEnFila(value) })) }
  async getIdempotency(tenantId: string, key: string): Promise<{ requestHash: string; response: unknown } | null> { const row = await this.client.idempotenciaFacturacion.findUnique({ where: { tenantId_clave: { tenantId, clave: key } } }); return row ? { requestHash: String(field(row, 'hashSolicitud')), response: field(row, 'respuesta') } : null }
  async saveIdempotency(tenantId: string, key: string, value: { requestHash: string; response: unknown }): Promise<void> {
    const existing = await this.client.idempotenciaFacturacion.findUnique({ where: { tenantId_clave: { tenantId, clave: key } } })
    if (existing) {
      if (String(field(existing, 'requestHash')) !== value.requestHash || huellaRegistro(field(existing, 'response')) !== huellaRegistro(value.response)) throw new BillingError(409, 'IDEMPOTENCY_CONFLICT', 'billing idempotency records are immutable')
      return
    }
    await this.client.idempotenciaFacturacion.create({ data: { id: `billing-idempotency-${tenantId}-${key}`, tenantId, clave: key, hashSolicitud: value.requestHash, respuesta: value.response } })
  }
  async appendAudit(value: RegistroAuditoriaFacturacion): Promise<void> { await this.client.auditoriaFacturacion.create({ data: auditoriaAFila(value) }) }
  async listAudit(tenantId: string): Promise<RegistroAuditoriaFacturacion[]> { return (await this.client.auditoriaFacturacion.findMany({ where: { tenantId }, orderBy: { fechaCreacion: 'asc' } })).map(auditoriaDesdeFila) }
  async appendOutbox(value: RegistroBandejaSalidaFacturacion): Promise<void> { await this.client.outboxFacturacion.create({ data: convertirRegistroBandejaSalidaFacturacionEnFila(value) }) }
  async listOutbox(tenantId: string): Promise<RegistroBandejaSalidaFacturacion[]> { return (await this.client.outboxFacturacion.findMany({ where: { tenantId }, orderBy: { fechaCreacion: 'asc' } })).map(convertirFilaEnRegistroBandejaSalidaFacturacion) }
  async saveAccountingExport(value: ExportacionContableFacturacion): Promise<ExportacionContableFacturacion> { return convertirFilaEnExportacionContableFacturacion(await this.client.exportacionContable.create({ data: convertirExportacionContableFacturacionEnFila(value) })) }
}

function convertirCuentaFacturacionEnFila(value: CuentaFacturacion): Row { return { id: value.billingAccountId, cuentaFacturacionId: value.billingAccountId, tenantId: value.tenantId, parteId: value.partyId, rol: value.role, estado: value.status, fechaCreacion: new Date(value.createdAt), fechaActualizacion: new Date(value.updatedAt) } }
function convertirFilaEnCuentaFacturacion(row: Row): CuentaFacturacion { return { contractVersion: field(row, 'contractVersion'), billingAccountId: text(row, 'cuentaFacturacionId'), tenantId: text(row, 'tenantId'), partyId: text(row, 'parteId'), role: field(row, 'rol'), status: field(row, 'estado'), createdAt: date(field(row, 'fechaCreacion')), updatedAt: date(field(row, 'fechaActualizacion')) } }
function convertirPlanSuscripcionEnFila(value: PlanSuscripcion): Row { return { id: value.planId, planId: value.planId, tenantId: value.tenantId, nombre: value.name, montoMenor: value.amountMinor, moneda: value.currency, intervalo: value.interval, estado: value.status, fechaCreacion: new Date(value.createdAt), fechaActualizacion: new Date(value.updatedAt) } }
function convertirFilaEnPlanSuscripcion(row: Row): PlanSuscripcion { return { contractVersion: field(row, 'contractVersion'), planId: text(row, 'planId'), tenantId: text(row, 'tenantId'), name: text(row, 'nombre'), amountMinor: bigint(field(row, 'montoMenor')), currency: BILLING_CURRENCY, interval: field(row, 'intervalo'), status: field(row, 'estado'), createdAt: date(field(row, 'fechaCreacion')), updatedAt: date(field(row, 'fechaActualizacion')) } }
function convertirSuscripcionEnFila(value: Suscripcion): Row { return { id: value.subscriptionId, suscripcionId: value.subscriptionId, tenantId: value.tenantId, clienteId: value.customerId, planId: value.planId, instantaneaPlan: value.planSnapshot, moneda: value.currency, montoMenor: value.amountMinor, intervalo: value.interval, estado: value.status, intentoMora: value.dunningAttempt, motivoCancelacion: value.cancelReason, fechaCancelacion: value.cancelledAt === null ? null : new Date(value.cancelledAt), fechaCreacion: new Date(value.createdAt), fechaActualizacion: new Date(value.updatedAt) } }
function convertirFilaEnSuscripcion(row: Row): Suscripcion { const plan = convertirPlanDesdeInstantanea(campoRegistro(row, 'instantaneaPlan')); const cancelledAt = field<unknown>(row, 'fechaCancelacion'); return { contractVersion: field(row, 'contractVersion'), subscriptionId: text(row, 'suscripcionId'), tenantId: text(row, 'tenantId'), customerId: text(row, 'clienteId'), planId: text(row, 'planId'), planSnapshot: plan, currency: BILLING_CURRENCY, amountMinor: bigint(field(row, 'montoMenor')), interval: field(row, 'intervalo'), status: field(row, 'estado'), dunningAttempt: Number(field(row, 'intentoMora') ?? 0), cancelledAt: cancelledAt ? date(cancelledAt) : null, cancelReason: nullableText(row, 'motivoCancelacion'), createdAt: date(field(row, 'fechaCreacion')), updatedAt: date(field(row, 'fechaActualizacion')) } }
function convertirPlanDesdeInstantanea(row: Row): PlanSuscripcion { return { contractVersion: field(row, 'contractVersion'), planId: text(row, 'planId'), tenantId: text(row, 'tenantId'), name: text(row, 'name'), amountMinor: bigint(field(row, 'amountMinor')), currency: BILLING_CURRENCY, interval: field(row, 'interval'), status: field(row, 'status'), createdAt: date(field(row, 'createdAt')), updatedAt: date(field(row, 'updatedAt')) } }
function convertirFacturaEnFila(value: Factura): Row { return { id: value.invoiceId, facturaId: value.invoiceId, tenantId: value.tenantId, cuentaId: value.accountId, compromisoId: value.commitmentId, pagoId: value.paymentId, ordenId: value.orderId, operacionPosId: value.posOperationId, moneda: value.currency, subtotal: value.subtotalMinor, montoImpuestos: value.taxMinor, montoTarifas: value.feeMinor, total: value.totalMinor, subtotalMenor: value.subtotalMinor, impuestosMenor: value.taxMinor, tarifasMenor: value.feeMinor, totalMenor: value.totalMinor, estado: value.status, numero: value.number, tipoFactura: value.invoiceType, instantaneaFiscal: value.taxSnapshot, versionInstantanea: value.snapshotVersion, fechaEmision: value.issuedAt === null || value.issuedAt === undefined ? null : new Date(value.issuedAt), fechaCreacion: new Date(value.createdAt), fechaActualizacion: new Date(value.updatedAt) } }
function convertirFilaEnFactura(row: Row): Factura { const issuedAt = field<unknown>(row, 'fechaEmision'); return { contractVersion: field(row, 'contractVersion'), invoiceId: text(row, 'facturaId'), tenantId: text(row, 'tenantId'), accountId: text(row, 'cuentaId'), commitmentId: text(row, 'compromisoId'), paymentId: text(row, 'pagoId'), orderId: text(row, 'ordenId'), posOperationId: nullableText(row, 'operacionPosId'), currency: BILLING_CURRENCY, subtotalMinor: bigint(field(row, 'subtotalMenor')), taxMinor: bigint(field(row, 'impuestosMenor')), feeMinor: bigint(field(row, 'tarifasMenor')), totalMinor: bigint(field(row, 'totalMenor')), status: field(row, 'estado'), number: nullableText(row, 'numero'), invoiceType: text(row, 'tipoFactura'), taxSnapshot: field(row, 'instantaneaFiscal'), lines: campoFilas(row, 'lineas').map(convertirFilaEnLineaFactura), snapshotVersion: Number(field(row, 'versionInstantanea') ?? 1), issuedAt: issuedAt ? date(issuedAt) : null, createdAt: date(field(row, 'fechaCreacion')), updatedAt: date(field(row, 'fechaActualizacion')) } }
function convertirLineaFacturaEnFila(invoice: Factura, line: Factura['lines'][number]): Row { return { id: line.lineId, tenantId: invoice.tenantId, facturaId: invoice.invoiceId, lineaId: line.lineId, descripcion: line.description, cantidad: line.quantity, unitarioMenor: line.unitMinor, impuestosMenor: line.taxMinor, totalMenor: line.totalMinor, moneda: line.currency, instantanea: line, fechaCreacion: new Date(invoice.createdAt) } }
function convertirFilaEnLineaFactura(row: Row): Factura['lines'][number] { const snapshot = campoRegistro(row, 'instantanea'); return { lineId: text(snapshot, 'lineId'), description: text(snapshot, 'description'), quantity: Number(field(snapshot, 'quantity')), unitMinor: bigint(field(snapshot, 'unitMinor')), taxMinor: bigint(field(snapshot, 'taxMinor')), totalMinor: bigint(field(snapshot, 'totalMinor')), currency: BILLING_CURRENCY } }
function convertirNotaCreditoEnFila(value: NotaCredito): Row { return { id: value.creditNoteId, notaCreditoId: value.creditNoteId, tenantId: value.tenantId, facturaId: value.invoiceId, pagoId: value.paymentId, ordenId: value.orderId, operacionPosId: value.posOperationId, moneda: value.currency, montoMenor: value.amountMinor, motivo: value.reason, estado: value.status, fechaCreacion: new Date(value.createdAt) } }
function convertirFilaEnNotaCredito(row: Row): NotaCredito { return { creditNoteId: text(row, 'notaCreditoId'), tenantId: text(row, 'tenantId'), invoiceId: text(row, 'facturaId'), paymentId: text(row, 'pagoId'), orderId: text(row, 'ordenId'), posOperationId: nullableText(row, 'operacionPosId'), currency: BILLING_CURRENCY, amountMinor: bigint(field(row, 'montoMenor')), reason: text(row, 'motivo'), status: 'accepted', createdAt: date(field(row, 'fechaCreacion')) } }
function convertirReintegroEnFila(value: Reintegro): Row { return { id: value.refundId, reintegroId: value.refundId, tenantId: value.tenantId, facturaId: value.invoiceId, pagoId: value.paymentId, ordenId: value.orderId, operacionPosId: value.posOperationId, moneda: value.currency, montoMenor: value.amountMinor, motivo: value.reason, estado: value.status, fechaCreacion: new Date(value.createdAt) } }
function convertirFilaEnReintegro(row: Row): Reintegro { return { refundId: text(row, 'reintegroId'), tenantId: text(row, 'tenantId'), invoiceId: text(row, 'facturaId'), paymentId: text(row, 'pagoId'), orderId: text(row, 'ordenId'), posOperationId: nullableText(row, 'operacionPosId'), currency: BILLING_CURRENCY, amountMinor: bigint(field(row, 'montoMenor')), reason: text(row, 'motivo'), status: 'accepted', createdAt: date(field(row, 'fechaCreacion')) } }
function convertirMovimientoContableEnFila(value: MovimientoContable): Row { return { id: value.entryId, entradaId: value.entryId, tenantId: value.tenantId, facturaId: value.invoiceId, tipoEntrada: value.entryType, montoMenor: value.amountMinor, moneda: value.currency, entradaVinculadaId: value.linkedEntryId, notaCreditoId: value.creditNoteId, reintegroId: value.refundId, pagoId: value.paymentId, ordenId: value.orderId, operacionPosId: value.posOperationId, inmutable: value.immutable, fechaCreacion: new Date(value.createdAt) } }
function convertirFilaEnMovimientoContable(row: Row): MovimientoContable { return { entryId: text(row, 'entradaId'), tenantId: text(row, 'tenantId'), invoiceId: text(row, 'facturaId'), entryType: field(row, 'tipoEntrada'), amountMinor: bigint(field(row, 'montoMenor')), currency: BILLING_CURRENCY, linkedEntryId: nullableText(row, 'entradaVinculadaId'), creditNoteId: nullableText(row, 'notaCreditoId'), refundId: nullableText(row, 'reintegroId'), paymentId: text(row, 'pagoId'), orderId: text(row, 'ordenId'), posOperationId: nullableText(row, 'operacionPosId'), immutable: true, createdAt: date(field(row, 'fechaCreacion')) } }
function convertirRegistroGestionMoraEnFila(value: RegistroGestionMora): Row { return { id: value.dunningId, moraId: value.dunningId, tenantId: value.tenantId, suscripcionId: value.subscriptionId, intento: value.attempt, motivo: value.reason, estado: value.status, fechaReintento: value.retryAt === null ? null : new Date(value.retryAt), fechaCreacion: new Date(value.createdAt) } }
function convertirFilaEnRegistroGestionMora(row: Row): RegistroGestionMora { const retryAt = field<unknown>(row, 'fechaReintento'); return { dunningId: text(row, 'moraId'), tenantId: text(row, 'tenantId'), subscriptionId: text(row, 'suscripcionId'), attempt: Number(field(row, 'intento')), reason: text(row, 'motivo'), status: field(row, 'estado'), retryAt: retryAt ? date(retryAt) : null, createdAt: date(field(row, 'fechaCreacion')) } }
function auditoriaAFila(value: RegistroAuditoriaFacturacion): Row { return { id: value.auditId, auditoriaId: value.auditId, tenantId: value.tenantId, actorId: value.actorId, correlacionId: value.correlationId, accion: value.action, recursoId: value.resourceId, resultado: value.outcome, motivo: value.reason, fechaCreacion: new Date(value.createdAt) } }
function auditoriaDesdeFila(row: Row): RegistroAuditoriaFacturacion { return { auditId: text(row, 'auditoriaId'), tenantId: text(row, 'tenantId'), actorId: text(row, 'actorId'), correlationId: text(row, 'correlacionId'), action: text(row, 'accion'), resourceId: text(row, 'recursoId'), outcome: field(row, 'resultado'), reason: nullableText(row, 'motivo'), createdAt: date(field(row, 'fechaCreacion')) } }
function convertirRegistroBandejaSalidaFacturacionEnFila(value: RegistroBandejaSalidaFacturacion): Row { return { id: value.eventId, tenantId: value.tenantId, eventoId: value.eventId, correlacionId: value.correlationId, tipoEvento: value.eventType, agregadoId: value.aggregateId, datosEvento: value.payload, estado: value.status, intentos: value.attempts, disponibleDesde: new Date(value.availableAt), fechaCreacion: new Date(value.createdAt) } }
function convertirFilaEnRegistroBandejaSalidaFacturacion(row: Row): RegistroBandejaSalidaFacturacion { return { eventId: text(row, 'eventoId'), tenantId: text(row, 'tenantId'), correlationId: text(row, 'correlacionId'), eventType: text(row, 'tipoEvento'), aggregateId: text(row, 'agregadoId'), payload: campoRegistro(row, 'datosEvento'), status: field(row, 'estado'), attempts: Number(field(row, 'intentos')), availableAt: date(field(row, 'disponibleDesde')), createdAt: date(field(row, 'fechaCreacion')) } }
function convertirExportacionContableFacturacionEnFila(value: ExportacionContableFacturacion): Row { return { id: value.exportId, exportacionId: value.exportId, tenantId: value.tenantId, idsFacturas: value.invoiceIds, idsEntradasContables: value.ledgerEntryIds, referenciaAprobacionExterna: value.externalApprovalReference, estado: value.status, publicadaExternamente: value.postedExternally, fechaCreacion: new Date(value.createdAt) } }
function convertirFilaEnExportacionContableFacturacion(row: Row): ExportacionContableFacturacion { return { exportId: text(row, 'exportacionId'), tenantId: text(row, 'tenantId'), invoiceIds: campoArrayCadenas(row, 'idsFacturas'), ledgerEntryIds: campoArrayCadenas(row, 'idsEntradasContables'), externalApprovalReference: text(row, 'referenciaAprobacionExterna'), status: 'prepared', postedExternally: false, createdAt: date(field(row, 'fechaCreacion')) } }
function bigint(value: unknown): bigint { if (typeof value === 'bigint') return value; if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value); if (typeof value === 'string' && /^\d+$/u.test(value)) return BigInt(value); throw new Error('billing persistence minor unit is invalid') }
function date(value: unknown): number { const result = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : new Date(String(value)); if (!Number.isFinite(result.getTime())) throw new Error('billing persistence date is invalid'); return result.getTime() }
function field<T>(row: Row, name: string): T { return row[name] as T }
function text(row: Row, name: string): string { return String(field<unknown>(row, name)) }
function nullableText(row: Row, name: string): string | null { const value = field<unknown>(row, name); return value === null || value === undefined ? null : String(value) }
function campoRegistro(row: Row, name: string): Row { const value = field<unknown>(row, name); return esRegistro(value) ? value : row }
function campoFilas(row: Row, name: string): Row[] { const value = field<unknown>(row, name); return Array.isArray(value) ? value.filter(esRegistro) : [] }
function campoArrayCadenas(row: Row, name: string): string[] { const value = field<unknown>(row, name); return Array.isArray(value) ? value.map(String) : [] }
function esRegistro(value: unknown): value is Row { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function huellaRegistro(value: unknown): string { return JSON.stringify(value, (_key: string, item: unknown) => typeof item === 'bigint' ? `${item}n` : item) ?? '' }

export default { PrismaBillingStore }
