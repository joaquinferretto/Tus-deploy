import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function billingModule(source) {
  return `(async () => {
    const billing = await import('./apps/api/src/tus/billing/index.ts')
    ${source}
  })()`
}

function runScenario(source) {
  const root = join(import.meta.dirname, '..', '..')
  const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')
  const output = execFileSync(process.execPath, [tsxCli, '--eval', billingModule(source)], { cwd: root, encoding: 'utf8' })
  return JSON.parse(output.trim())
}

const context = { tenantId: 'tenant-a', actorId: 'finance-a', correlationId: 'corr-billing', idempotencyKey: 'billing-key', requestHash: 'billing-hash' }
const commitment = { commitmentId: 'commitment-a', orderId: 'order-a', paymentId: 'payment-a', posOperationId: 'pos-a' }

test('billing owns accounts by tenant and rejects cross-tenant account access', () => {
  const result = runScenario(`
    const { InMemoryBillingStore, BillingService } = billing.default
    const store = new InMemoryBillingStore()
    const service = new BillingService({ store, now: () => 1700000000000 })
    const account = await service.createBillingAccount({ ...${JSON.stringify(context)}, billingAccountId: 'account-a', partyId: 'merchant-a', role: 'merchant' })
    let forbidden = ''
    try { await service.getBillingAccount('tenant-b', 'account-a') } catch (error) { forbidden = error.code }
    console.log(JSON.stringify({ account, forbidden }))
  `)
  assert.equal(result.account.tenantId, 'tenant-a')
  assert.equal(result.account.role, 'merchant')
  assert.equal(result.forbidden, 'NOT_FOUND')
})

test('billing invoices require a tenant-owned billing account when one is supplied', () => {
  const result = runScenario(`
    const { InMemoryBillingStore, BillingService } = billing.default
    const store = new InMemoryBillingStore()
    const service = new BillingService({ store, now: () => 1700000000000 })
    await service.createBillingAccount({ ...${JSON.stringify(context)}, tenantId: 'tenant-b', billingAccountId: 'account-b', partyId: 'merchant-b', role: 'merchant' })
    let errorCode = ''
    try {
      await service.createInvoice({ ...${JSON.stringify(context)}, invoiceId: 'invoice-cross-tenant', accountId: 'account-b', ...${JSON.stringify(commitment)}, lines: [{ lineId: 'line-cross-tenant', description: 'Servicio', quantity: 1, unitMinor: 100n, taxMinor: 0n }], taxProfile: { taxIdentity: 'opaque-tax-id', taxCategory: 'unverified' } })
    } catch (error) { errorCode = error.code }
    console.log(JSON.stringify({ errorCode }))
  `)
  assert.equal(result.errorCode, 'BILLING_ACCOUNT_NOT_FOUND')
})

test('subscriptions snapshot an ARS plan and stop renewals after cancellation or dunning failure', () => {
  const result = runScenario(`
    const { InMemoryBillingStore, BillingService } = billing.default
    const store = new InMemoryBillingStore()
    const service = new BillingService({ store, now: () => 1700000000000, providerEnabled: false })
    const plan = await service.createPlan({ ...${JSON.stringify(context)}, planId: 'plan-a', name: 'Base', amountMinor: 2500n, currency: 'ars', interval: 'monthly' })
    const subscription = await service.startSubscription({ ...${JSON.stringify(context)}, subscriptionId: 'sub-a', customerId: 'customer-a', planId: plan.planId })
    const renewal = await service.renewSubscription({ ...${JSON.stringify(context)}, subscriptionId: 'sub-a', idempotencyKey: 'renew-a', requestHash: 'renew-hash' })
    const cancelled = await service.cancelSubscription({ ...${JSON.stringify(context)}, subscriptionId: 'sub-a', idempotencyKey: 'cancel-a', requestHash: 'cancel-hash', reason: 'customer-request' })
    let renewAfterCancel = ''
    try { await service.renewSubscription({ ...${JSON.stringify(context)}, subscriptionId: 'sub-a', idempotencyKey: 'renew-b', requestHash: 'renew-b-hash' }) } catch (error) { renewAfterCancel = error.code }
    console.log(JSON.stringify({ plan: { amount: plan.amountMinor.toString(), currency: plan.currency }, subscription: { status: subscription.status, tenantId: subscription.tenantId }, renewal: { status: renewal.status, reason: renewal.reason, subscriptionStatus: renewal.subscription.status }, cancelled: cancelled.status, renewAfterCancel }))
  `)
  assert.deepEqual(result.plan, { amount: '2500', currency: 'ARS' })
  assert.equal(result.subscription.status, 'active')
  assert.equal(result.renewal.status, 'blocked')
  assert.equal(result.renewal.reason, 'provider_disabled')
  assert.equal(result.cancelled, 'cancelled')
  assert.equal(result.renewAfterCancel, 'SUBSCRIPTION_CANCELLED')
})

test('invoice issuance is tax-gated, numbers only approved invoices, and snapshots cannot be rewritten', () => {
  const result = runScenario(`
    const { InMemoryBillingStore, BillingService } = billing.default
    const store = new InMemoryBillingStore()
    const blocked = new BillingService({ store, now: () => 1700000000000 })
     const draft = await blocked.createInvoice({ ...${JSON.stringify(context)}, invoiceId: 'invoice-a', ...${JSON.stringify(commitment)}, lines: [{ lineId: 'line-a', description: 'Servicio', quantity: 2, unitMinor: 1000n, taxMinor: 0n }], taxProfile: { partyId: 'merchant-a', taxIdentity: 'opaque-tax-id', taxCategory: 'unverified', evidenceRef: 'tax-evidence-not-approval' }, taxGate: { approved: false, externalReference: null } })
    const issuedBlocked = await blocked.issueInvoice({ ...${JSON.stringify(context)}, invoiceId: draft.invoiceId, idempotencyKey: 'issue-a', requestHash: 'issue-hash' })
    const approved = new BillingService({ store, now: () => 1700000000000, taxGate: { approved: true, externalReference: 'external-approval-a' } })
    const issued = await approved.issueInvoice({ ...${JSON.stringify(context)}, invoiceId: draft.invoiceId, idempotencyKey: 'issue-b', requestHash: 'issue-b-hash' })
  let rewriteCode = ''
  let taxRewriteCode = ''
  try { await store.saveInvoice({ ...issued.invoice, totalMinor: 1n }) } catch (error) { rewriteCode = error.code }
    try { await store.saveInvoice({ ...issued.invoice, taxSnapshot: { ...issued.invoice.taxSnapshot, externalApprovalReference: 'tampered' } }) } catch (error) { taxRewriteCode = error.code }
    console.log(JSON.stringify({ draft: { total: draft.totalMinor.toString(), approvalReference: draft.taxSnapshot.externalApprovalReference }, issuedBlocked: { status: issuedBlocked.status, reason: issuedBlocked.reason }, issued: { status: issued.invoice.status, number: issued.invoice.number, total: issued.invoice.totalMinor.toString() }, rewriteCode, taxRewriteCode }))
  `)
  assert.equal(result.draft.total, '2000')
  assert.equal(result.draft.approvalReference, null)
  assert.equal(result.issuedBlocked.reason, 'tax_external_approval_required')
  assert.equal(result.issued.status, 'issued')
  assert.equal(result.issued.number, 'A-000001')
  assert.equal(result.issued.total, '2000')
  assert.equal(result.rewriteCode, 'INVOICE_IMMUTABLE')
  assert.equal(result.taxRewriteCode, 'INVOICE_IMMUTABLE')
})

test('credits link invoice/payment/order/POS references and append compensating ledger entries without rewriting history', () => {
  const result = runScenario(`
    const { InMemoryBillingStore, BillingService } = billing.default
    const store = new InMemoryBillingStore()
    const service = new BillingService({ store, now: () => 1700000000000, taxGate: { approved: true, externalReference: 'tax-approval' }, accountingGate: { approved: true, externalReference: 'accounting-approval' } })
    await service.createInvoice({ ...${JSON.stringify(context)}, invoiceId: 'invoice-credit', ...${JSON.stringify(commitment)}, lines: [{ lineId: 'line-credit', description: 'Producto', quantity: 1, unitMinor: 5000n, taxMinor: 0n }], taxProfile: { partyId: 'merchant-a', taxIdentity: 'opaque-tax-id', taxCategory: 'unverified', evidenceRef: null }, taxGate: { approved: true, externalReference: 'tax-approval' } })
    await service.issueInvoice({ ...${JSON.stringify(context)}, invoiceId: 'invoice-credit', idempotencyKey: 'issue-credit', requestHash: 'issue-credit-hash' })
    const credit = await service.createCredit({ ...${JSON.stringify(context)}, creditNoteId: 'credit-a', invoiceId: 'invoice-credit', amountMinor: 1200n, reason: 'approved-adjustment', ...${JSON.stringify(commitment)}, idempotencyKey: 'credit-key', requestHash: 'credit-hash' })
    const replay = await service.createCredit({ ...${JSON.stringify(context)}, creditNoteId: 'credit-a', invoiceId: 'invoice-credit', amountMinor: 1200n, reason: 'approved-adjustment', ...${JSON.stringify(commitment)}, idempotencyKey: 'credit-key', requestHash: 'credit-hash' })
    const exported = await service.prepareAccountingExport({ ...${JSON.stringify(context)}, idempotencyKey: 'export-a-key', requestHash: 'export-a-hash', exportId: 'export-a', invoiceIds: ['invoice-credit'] })
    console.log(JSON.stringify({ credit: { status: credit.status, amount: credit.amountMinor.toString(), paymentId: credit.paymentId, orderId: credit.orderId, posOperationId: credit.posOperationId }, replay: replay.creditNoteId, exported: exported.status, entries: (await store.listLedger('tenant-a')).map((entry) => ({ type: entry.entryType, amount: entry.amountMinor.toString(), linked: entry.linkedEntryId })) }))
  `)
  assert.equal(result.credit.status, 'accepted')
  assert.equal(result.credit.amount, '1200')
  assert.equal(result.credit.paymentId, 'payment-a')
  assert.equal(result.credit.orderId, 'order-a')
  assert.equal(result.credit.posOperationId, 'pos-a')
  assert.equal(result.replay, 'credit-a')
  assert.equal(result.exported, 'prepared')
  assert.deepEqual(result.entries, [{ type: 'invoice_issued', amount: '5000', linked: null }, { type: 'credit_compensation', amount: '1200', linked: 'invoice-invoice-credit' }])
})

test('billing keeps tenant-scoped idempotency, audit, outbox, retryable dunning, and fail-closed accounting gates', () => {
  const result = runScenario(`
    const { InMemoryBillingStore, BillingService } = billing.default
    const store = new InMemoryBillingStore()
    const service = new BillingService({ store, now: () => 1700000000000, providerEnabled: false })
    const input = { ...${JSON.stringify(context)}, invoiceId: 'invoice-retry', ...${JSON.stringify(commitment)}, lines: [{ lineId: 'line-retry', description: 'Servicio', quantity: 1, unitMinor: 900n, taxMinor: 0n }], taxProfile: { partyId: 'merchant-a', taxIdentity: 'opaque-tax-id', taxCategory: 'unverified', evidenceRef: null }, taxGate: { approved: false, externalReference: null } }
    const first = await service.createInvoice(input)
    const replay = await service.createInvoice(input)
    const dunning = await service.recordDunning({ ...${JSON.stringify(context)}, idempotencyKey: 'dunning-key', requestHash: 'dunning-hash', subscriptionId: 'sub-missing', attempt: 2, reason: 'provider_unavailable', retryAt: 1700003600000 })
    let exportCode = ''
    try { await service.prepareAccountingExport({ ...${JSON.stringify(context)}, idempotencyKey: 'export-blocked-key', requestHash: 'export-blocked-hash', exportId: 'export-blocked', invoiceIds: [first.invoiceId] }) } catch (error) { exportCode = error.code }
    console.log(JSON.stringify({ sameId: replay.invoiceId, dunning: { status: dunning.status, retryAt: dunning.retryAt }, audit: (await store.listAudit('tenant-a')).length, outbox: (await store.listOutbox('tenant-a')).map((event) => event.eventType), exportCode }))
  `)
  assert.equal(result.sameId, 'invoice-retry')
  assert.equal(result.dunning.status, 'retryable')
  assert.equal(result.dunning.retryAt, 1700003600000)
  assert.equal(result.audit, 2)
  assert.deepEqual(result.outbox, ['billing.invoice.created', 'billing.subscription.dunning'])
  assert.equal(result.exportCode, 'ACCOUNTING_EXTERNAL_APPROVAL_REQUIRED')
})

test('the Prisma boundary maps billing minor units to BIGINT-compatible values and dates without provider effects', () => {
  const result = runScenario(`
    const { PrismaBillingStore } = (await import('./apps/api/src/tus/billing/prisma.ts')).default
    let invoiceData
    const client = { factura: { create: async (input) => { invoiceData = input.data; return input.data }, findUnique: async () => null }, lineaFactura: { createMany: async () => ({ count: 1 }), findMany: async () => [] }, cuentaFacturacion: { upsert: async (input) => input.create, findUnique: async () => null }, planSuscripcion: { upsert: async (input) => input.create, findUnique: async () => null }, suscripcion: { upsert: async (input) => input.create, findUnique: async () => null }, notaCredito: { create: async (input) => input.data, findMany: async () => [] }, idempotenciaFacturacion: { upsert: async (input) => input.create, findUnique: async () => null }, auditoriaFacturacion: { create: async (input) => input.data, findMany: async () => [] }, outboxFacturacion: { create: async (input) => input.data, findMany: async () => [] }, movimientoContableFacturacion: { create: async (input) => input.data, findMany: async () => [] } }
    const store = new PrismaBillingStore(client)
    await store.saveInvoice({ invoiceId: 'invoice-prisma', tenantId: 'tenant-a', accountId: 'account-a', commitmentId: 'order-a', paymentId: 'payment-a', orderId: 'order-a', posOperationId: 'pos-a', currency: 'ARS', subtotalMinor: 100n, taxMinor: 0n, feeMinor: 0n, totalMinor: 100n, status: 'draft', number: null, invoiceType: 'commercial', snapshotVersion: 1, taxSnapshot: { authority: 'ARCA/AFIP-external', taxCategory: 'unverified', taxIdentity: 'opaque', ivaTreatment: null, withholdingTreatment: null, externalApprovalReference: null }, lines: [], createdAt: 1700000000000, updatedAt: 1700000000000 })
     console.log(JSON.stringify({ subtotalBigInt: typeof invoiceData.subtotalMenor === 'bigint', taxBigInt: typeof invoiceData.montoImpuestos === 'bigint', feeBigInt: typeof invoiceData.montoTarifas === 'bigint', totalBigInt: typeof invoiceData.totalMenor === 'bigint', createdDate: invoiceData.fechaCreacion instanceof Date, hasEnglishKeys: ['invoiceId', 'accountId', 'commitmentId', 'paymentId', 'subtotalMinor', 'taxAmount'].some((key) => key in invoiceData) }))
   `)
  assert.deepEqual(result, { subtotalBigInt: true, taxBigInt: true, feeBigInt: true, totalBigInt: true, createdDate: true, hasEnglishKeys: false })
})

test('BUILD 12G maps every billing delegate to Spanish Prisma fields and preserves append-only boundaries', () => {
  const result = runScenario(`
    const { PrismaBillingStore } = (await import('./apps/api/src/tus/billing/prisma.ts')).default
    const captured = {}
    const client = {
      cuentaFacturacion: { upsert: async (input) => { captured.account = input; return input.create } },
      planSuscripcion: { upsert: async (input) => { captured.plan = input; return input.create } },
      suscripcion: { upsert: async (input) => { captured.subscription = input; return input.create } },
      factura: { findUnique: async () => null, create: async (input) => { captured.invoice = input; return input.data } },
      lineaFactura: { createMany: async (input) => { captured.line = input; return { count: input.data.length } } },
      notaCredito: { create: async (input) => { captured.credit = input; return input.data } },
      reintegroFacturacion: { create: async (input) => { captured.refund = input; return input.data } },
      movimientoContableFacturacion: { create: async (input) => { captured.ledger = input; return input.data } },
      idempotenciaFacturacion: { findUnique: async () => null, create: async (input) => { captured.idempotency = input; return input.data } },
      auditoriaFacturacion: { create: async (input) => { captured.audit = input; return input.data } },
      outboxFacturacion: { create: async () => ({}) },
      gestionMora: { upsert: async (input) => { captured.dunning = input; return input.create } },
      secuenciaNumeracion: { upsert: async (input) => { captured.sequence = input; return { siguienteNumero: 2 } } },
      exportacionContable: { create: async (input) => { captured.export = input; return input.data } },
    }
    const store = new PrismaBillingStore(client)
    const plan = { contractVersion: '1.0.0', planId: 'plan-12g', tenantId: 'tenant-a', name: 'Base', amountMinor: 2500n, currency: 'ARS', interval: 'monthly', status: 'active', createdAt: 1700000000000, updatedAt: 1700000000000 }
    const invoice = { contractVersion: '1.0.0', invoiceId: 'invoice-12g', tenantId: 'tenant-a', accountId: 'account-12g', commitmentId: 'commitment-12g', paymentId: 'payment-12g', orderId: 'order-12g', posOperationId: 'pos-12g', currency: 'ARS', subtotalMinor: 2500n, taxMinor: 0n, feeMinor: 0n, totalMinor: 2500n, status: 'draft', number: null, invoiceType: 'commercial', taxSnapshot: { authority: 'ARCA/AFIP-external', taxIdentity: 'tax-12g', taxCategory: 'unverified', ivaTreatment: null, withholdingTreatment: null, evidenceReference: null, externalApprovalReference: null }, lines: [{ lineId: 'line-12g', description: 'Servicio', quantity: 1, unitMinor: 2500n, taxMinor: 0n, totalMinor: 2500n, currency: 'ARS' }], snapshotVersion: 1, issuedAt: null, createdAt: 1700000000000, updatedAt: 1700000000000 }
    await store.saveAccount({ contractVersion: '1.0.0', billingAccountId: 'account-12g', tenantId: 'tenant-a', partyId: 'party-12g', role: 'merchant', status: 'active', createdAt: 1700000000000, updatedAt: 1700000000000 })
    await store.savePlan(plan)
    await store.saveSubscription({ contractVersion: '1.0.0', subscriptionId: 'subscription-12g', tenantId: 'tenant-a', customerId: 'customer-12g', planId: plan.planId, planSnapshot: plan, currency: 'ARS', amountMinor: 2500n, interval: 'monthly', status: 'active', dunningAttempt: 0, cancelledAt: null, cancelReason: null, createdAt: 1700000000000, updatedAt: 1700000000000 })
    await store.saveInvoice(invoice)
    await store.saveCreditNote({ creditNoteId: 'credit-12g', tenantId: 'tenant-a', invoiceId: invoice.invoiceId, paymentId: invoice.paymentId, orderId: invoice.orderId, posOperationId: invoice.posOperationId, currency: 'ARS', amountMinor: 100n, reason: 'adjustment', status: 'accepted', createdAt: 1700000000000 })
    await store.saveRefund({ refundId: 'refund-12g', tenantId: 'tenant-a', invoiceId: invoice.invoiceId, paymentId: invoice.paymentId, orderId: invoice.orderId, posOperationId: invoice.posOperationId, currency: 'ARS', amountMinor: 100n, reason: 'refund', status: 'accepted', createdAt: 1700000000000 })
    await store.appendLedger({ entryId: 'entry-12g', tenantId: 'tenant-a', invoiceId: invoice.invoiceId, entryType: 'invoice_issued', amountMinor: 2500n, currency: 'ARS', linkedEntryId: null, creditNoteId: null, refundId: null, paymentId: invoice.paymentId, orderId: invoice.orderId, posOperationId: invoice.posOperationId, immutable: true, createdAt: 1700000000000 })
    await store.saveDunning({ dunningId: 'dunning-12g', tenantId: 'tenant-a', subscriptionId: 'subscription-12g', attempt: 1, reason: 'provider_unavailable', status: 'retryable', retryAt: 1700003600000, createdAt: 1700000000000 })
    await store.nextInvoiceNumber('tenant-a')
    await store.saveIdempotency('tenant-a', 'key-12g', { requestHash: 'hash-12g', response: { invoiceId: invoice.invoiceId } })
    await store.appendAudit({ auditId: 'audit-12g', tenantId: 'tenant-a', actorId: 'actor-12g', correlationId: 'corr-12g', action: 'created', resourceId: invoice.invoiceId, outcome: 'allowed', reason: null, createdAt: 1700000000000 })
    await store.saveAccountingExport({ exportId: 'export-12g', tenantId: 'tenant-a', invoiceIds: [invoice.invoiceId], ledgerEntryIds: ['entry-12g'], externalApprovalReference: 'approval-12g', status: 'prepared', postedExternally: false, createdAt: 1700000000000 })
    const keys = (value) => Object.keys(value).sort()
    console.log(JSON.stringify({ accountWhere: captured.account.where, accountKeys: keys(captured.account.create), planKeys: keys(captured.plan.create), subscriptionKeys: keys(captured.subscription.create), invoiceKeys: keys(captured.invoice.data), lineKeys: keys(captured.line.data[0]), creditKeys: keys(captured.credit.data), refundKeys: keys(captured.refund.data), ledgerKeys: keys(captured.ledger.data), dunningKeys: keys(captured.dunning.create), sequenceKeys: keys(captured.sequence.create), sequenceUpdate: captured.sequence.update, idempotencyKeys: keys(captured.idempotency.data), auditKeys: keys(captured.audit.data), exportKeys: keys(captured.export.data), moneyTypes: { invoice: typeof captured.invoice.data.totalMenor, line: typeof captured.line.data[0].unitarioMenor, ledger: typeof captured.ledger.data.montoMenor } }))
  `)
  const schema = readFileSync(join(import.meta.dirname, '..', '..', 'apps/api/prisma/schema.prisma'), 'utf8')
  const models = {
    Factura: 'TusInvoice',
    LineaFactura: 'TusInvoiceLine',
    NotaCredito: 'TusCreditNote',
    Suscripcion: 'TusSubscription',
    PerfilFiscal: 'TusTaxProfile',
    CuentaFacturacion: 'TusBillingAccount',
    PlanSuscripcion: 'TusSubscriptionPlan',
    ReintegroFacturacion: 'TusBillingRefund',
    MovimientoContableFacturacion: 'TusBillingLedger',
    IdempotenciaFacturacion: 'TusBillingIdempotency',
    AuditoriaFacturacion: 'TusBillingAudit',
    GestionMora: 'TusBillingDunning',
    SecuenciaNumeracion: 'TusBillingNumberSequence',
    ExportacionContable: 'TusAccountingExport',
  }

  assert.deepEqual(result.accountWhere, { tenantId_cuentaFacturacionId: { tenantId: 'tenant-a', cuentaFacturacionId: 'account-12g' } })
  for (const [model, table] of Object.entries(models)) assert.match(schema, new RegExp(`model ${model}[\\s\\S]*?@@map\\("${table}"\\)`))
  assert.match(schema, /model LineaFactura[\s\S]*?factura\s+Factura\s+@relation\(fields: \[tenantId, facturaId\], references: \[tenantId, facturaId\], map: "TusInvoiceLine_tenant_invoice_fk"\)/)
  assert.deepEqual(result.moneyTypes, { invoice: 'bigint', line: 'bigint', ledger: 'bigint' })
  assert.equal(result.sequenceUpdate.siguienteNumero.increment, 1)
  assert.doesNotMatch(schema, /model Tus(?:Invoice|InvoiceLine|CreditNote|Subscription|TaxProfile|BillingAccount|SubscriptionPlan|BillingRefund|BillingLedger|BillingIdempotency|BillingAudit|BillingDunning|BillingNumberSequence|AccountingExport)\b/)
})

test('refunds use the same immutable linkage boundary and non-ARS or non-BigInt money fails closed', () => {
  const result = runScenario(`
    const { InMemoryBillingStore, BillingService, createBillingMoney } = billing.default
    const store = new InMemoryBillingStore()
    const service = new BillingService({ store, taxGate: { approved: true, externalReference: 'tax-approval' }, now: () => 1700000000000 })
    await service.createInvoice({ ...${JSON.stringify(context)}, invoiceId: 'invoice-refund', ...${JSON.stringify(commitment)}, lines: [{ lineId: 'line-refund', description: 'Producto', quantity: 1, unitMinor: 3000n, taxMinor: 0n }], taxProfile: { taxIdentity: 'opaque-tax-id', taxCategory: 'unverified' } })
    await service.issueInvoice({ ...${JSON.stringify(context)}, idempotencyKey: 'issue-refund', requestHash: 'issue-refund-hash', invoiceId: 'invoice-refund' })
    const refund = await service.recordRefund({ ...${JSON.stringify(context)}, idempotencyKey: 'refund-key', requestHash: 'refund-hash', refundId: 'refund-a', invoiceId: 'invoice-refund', amountMinor: 700n, reason: 'customer-approved', ...${JSON.stringify(commitment)} })
    let arsCode = ''
    let malformedCurrencyCode = ''
    let typeCode = ''
    try { createBillingMoney('USD', 1n) } catch (error) { arsCode = error.code }
    try { createBillingMoney(null, 1n) } catch (error) { malformedCurrencyCode = error.code }
    try { createBillingMoney('ARS', 1) } catch (error) { typeCode = error.code }
    console.log(JSON.stringify({ refund: { status: refund.status, amount: refund.amountMinor.toString(), paymentId: refund.paymentId }, ledger: (await store.listLedger('tenant-a')).at(-1).entryType, arsCode, malformedCurrencyCode, typeCode }))
  `)
  assert.deepEqual(result.refund, { status: 'accepted', amount: '700', paymentId: 'payment-a' })
  assert.equal(result.ledger, 'refund_compensation')
  assert.equal(result.arsCode, 'UNSUPPORTED_CURRENCY')
  assert.equal(result.malformedCurrencyCode, 'UNSUPPORTED_CURRENCY')
  assert.equal(result.typeCode, 'INVALID_MONEY')
})

test('credits and refunds cannot relink an invoice to another payment or order', () => {
  const result = runScenario(`
    const { InMemoryBillingStore, BillingService } = billing.default
    const store = new InMemoryBillingStore()
    const service = new BillingService({ store, taxGate: { approved: true, externalReference: 'tax-approval' }, now: () => 1700000000000 })
    await service.createInvoice({ ...${JSON.stringify(context)}, invoiceId: 'invoice-linkage', ...${JSON.stringify(commitment)}, lines: [{ lineId: 'line-linkage', description: 'Producto', quantity: 1, unitMinor: 3000n, taxMinor: 0n }], taxProfile: { taxIdentity: 'opaque-tax-id', taxCategory: 'unverified' } })
    await service.issueInvoice({ ...${JSON.stringify(context)}, idempotencyKey: 'issue-linkage', requestHash: 'issue-linkage-hash', invoiceId: 'invoice-linkage' })
    let refundCode = ''
    let creditCode = ''
    try { await service.recordRefund({ ...${JSON.stringify(context)}, idempotencyKey: 'refund-linkage', requestHash: 'refund-linkage-hash', refundId: 'refund-linkage', invoiceId: 'invoice-linkage', amountMinor: 700n, reason: 'customer-approved', paymentId: 'payment-other', orderId: 'order-a' }) } catch (error) { refundCode = error.code }
    try { await service.createCredit({ ...${JSON.stringify(context)}, idempotencyKey: 'credit-linkage', requestHash: 'credit-linkage-hash', creditNoteId: 'credit-linkage', invoiceId: 'invoice-linkage', amountMinor: 700n, reason: 'approved-adjustment', paymentId: 'payment-a', orderId: 'order-other' }) } catch (error) { creditCode = error.code }
    console.log(JSON.stringify({ refundCode, creditCode }))
  `)
  assert.equal(result.refundCode, 'BILLING_LINKAGE_MISMATCH')
  assert.equal(result.creditCode, 'BILLING_LINKAGE_MISMATCH')
})

test('billing migration fences invoice lines as immutable history', () => {
  const root = join(import.meta.dirname, '..', '..')
  const sql = readFileSync(join(root, 'apps/api/prisma/migrations/20260909170000_tus_billing/migration.sql'), 'utf8')
  assert.match(sql, /IF TG_TABLE_NAME = 'TusInvoice' AND OLD\.status = 'draft' AND NEW\.status = 'issued'/u)
  assert.match(sql, /CREATE TRIGGER "TusInvoiceLine_append_only" BEFORE UPDATE OR DELETE ON "TusInvoiceLine"/u)
  assert.match(sql, /CREATE TRIGGER "TusBillingAudit_append_only" BEFORE UPDATE OR DELETE ON "TusBillingAudit"/u)
  assert.match(sql, /CREATE TRIGGER "TusBillingIdempotency_append_only" BEFORE UPDATE OR DELETE ON "TusBillingIdempotency"/u)
  assert.match(sql, /CREATE TRIGGER "TusAccountingExport_append_only" BEFORE UPDATE OR DELETE ON "TusAccountingExport"/u)
})

test('billing audit, outbox, and idempotency records reject conflicting rewrites', () => {
  const result = runScenario(`
    const { InMemoryBillingStore } = billing.default
    const store = new InMemoryBillingStore()
    const audit = { auditId: 'audit-a', tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a', action: 'created', resourceId: 'invoice-a', outcome: 'allowed', reason: null, createdAt: 1700000000000 }
    const outbox = { eventId: 'event-a', tenantId: 'tenant-a', correlationId: 'corr-a', eventType: 'invoice.created', aggregateId: 'invoice-a', payload: { totalMinor: '100' }, status: 'pending', attempts: 0, availableAt: 1700000000000, createdAt: 1700000000000 }
    await store.saveIdempotency('tenant-a', 'key-a', { requestHash: 'hash-a', response: { invoiceId: 'invoice-a' } })
    await store.appendAudit(audit)
    await store.appendOutbox(outbox)
    let idempotencyCode = ''
    let auditCode = ''
    let outboxCode = ''
    try { await store.saveIdempotency('tenant-a', 'key-a', { requestHash: 'hash-b', response: { invoiceId: 'invoice-b' } }) } catch (error) { idempotencyCode = error.code }
    try { await store.appendAudit({ ...audit, action: 'changed' }) } catch (error) { auditCode = error.code }
    try { await store.appendOutbox({ ...outbox, payload: { totalMinor: '200' } }) } catch (error) { outboxCode = error.code }
    console.log(JSON.stringify({ idempotencyCode, auditCode, outboxCode }))
  `)
  assert.equal(result.idempotencyCode, 'IDEMPOTENCY_CONFLICT')
  assert.equal(result.auditCode, 'BILLING_AUDIT_IMMUTABLE')
  assert.equal(result.outboxCode, 'BILLING_OUTBOX_IMMUTABLE')
})

test('Prisma billing issuance uses the controlled draft-to-issued update boundary', () => {
  const result = runScenario(`
    const { PrismaBillingStore } = (await import('./apps/api/src/tus/billing/prisma.ts')).default
    let updated = false
    const draft = { invoiceId: 'invoice-prisma-update', tenantId: 'tenant-a', accountId: 'account-a', commitmentId: 'commitment-a', paymentId: 'payment-a', orderId: 'order-a', posOperationId: null, currency: 'ARS', subtotalMinor: 100n, taxMinor: 0n, feeMinor: 0n, totalMinor: 100n, status: 'draft', number: null, invoiceType: 'commercial', taxSnapshot: { authority: 'ARCA/AFIP-external', taxCategory: 'unverified', taxIdentity: 'opaque', ivaTreatment: null, withholdingTreatment: null, externalApprovalReference: null }, snapshotVersion: 1, issuedAt: null, createdAt: new Date(1700000000000), updatedAt: new Date(1700000000000), lines: [] }
    const store = new PrismaBillingStore({ factura: { findUnique: async () => draft, update: async (input) => { updated = true; return { ...draft, ...input.data } }, create: async () => { throw new Error('create must not be used for issuance') } } })
    await store.saveInvoice({ ...draft, contractVersion: '1.0.0', status: 'issued', number: 'A-000001', issuedAt: 1700000000000 })
    console.log(JSON.stringify({ updated }))
  `)
  assert.deepEqual(result, { updated: true })
})
