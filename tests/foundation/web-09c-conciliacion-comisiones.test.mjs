import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Builds a paid service: fixed price, intent, dispatch and a verified approval event.
const PAID_SERVICE = `
  function providerEvent(id, payment, status, amount, date, overrides = {}) {
    const rawBody = JSON.stringify({ id, type: 'payment', data: { id: 'fake-mp-' + payment.paymentId, external_reference: payment.paymentId, status, transaction_amount: amount, currency_id: 'ARS', date_last_updated: date, ...overrides } })
    return { rawBody, signature: proveedorPagos.firmar(rawBody), receivedAt: '2026-09-23T10:30:00.000Z' }
  }
  const plain = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
  async function paidService(id, priceMinor = 123457n) {
    const service = await serviceWork(id, { priceMode: 'fixed', priceMinor, price: Number(priceMinor) / 100, priceSnapshot: { currency: 'ARS', minor: priceMinor } })
    const created = await finance.crearIntencionPago({ ...customer, trabajoId: service.work.trabajoId, idempotencyKey: 'pay-' + id })
    const dispatched = await finance.despacharIntencionPago({ tenantId: customer.tenantId, paymentId: created.payment.paymentId, correlationId: 'dispatch-' + id })
    const major = (Number(priceMinor) / 100).toFixed(2)
    const approved = await finance.ingerirEventoProveedor(providerEvent('evt-approved-' + id, dispatched.payment, 'approved', major, '2026-09-23T10:10:00.000Z'))
    return { service, payment: dispatched.payment, approved, major, obligacionId: created.obligation.obligacionId }
  }
`

test('WEB-09C books an exact commission, a single ledger set and a held internal settlement once', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${PAID_SERVICE}
    const paid = await paidService('commission')
    const duplicate = await finance.ingerirEventoProveedor(providerEvent('evt-approved-commission', paid.payment, 'approved', paid.major, '2026-09-23T10:10:00.000Z'))
    const sameStatusNewEvent = await finance.ingerirEventoProveedor(providerEvent('evt-approved-again', paid.payment, 'approved', paid.major, '2026-09-23T10:12:00.000Z'))
    const ledger = plain([...financeStore.state.ledger.values()])
    const snapshots = plain([...financeStore.state.comisiones.values()])
    const settlement = plain([...financeStore.state.liquidaciones.values()])
    const { validarLiquidacionServicio } = await import('./packages/contracts/src/tus.ts')
    const providerView = await finance.consultarFinanzasTrabajo({ ...provider, trabajoId: paid.service.work.trabajoId })
    validarLiquidacionServicio(providerView.settlement)
    const customerView = await finance.consultarFinanzasTrabajo({ ...customer, trabajoId: paid.service.work.trabajoId })
    const appendAgain = await codeOf(() => financeStore.ledger().agregar({ ...[...financeStore.state.ledger.values()][0], amountMinor: 1n }))
    console.log(JSON.stringify({ duplicate: duplicate.status, sameStatusNewEvent: sameStatusNewEvent.result, ledger, snapshots, settlement, providerView, customerView, appendAgain, outbox: financeStore.state.outbox.map((event) => event.eventType) }))
  `)

  assert.equal(result.duplicate, 'duplicate')
  assert.equal(result.sameStatusNewEvent, 'no_op')
  assert.equal(result.snapshots.length, 1)
  assert.deepEqual(
    {
      gross: result.snapshots[0].grossMinor,
      commission: result.snapshots[0].commissionMinor,
      net: result.snapshots[0].netMinor,
      rate: result.snapshots[0].rateBps,
      rule: result.snapshots[0].ruleVersion,
    },
    { gross: '123457', commission: '12346', net: '111111', rate: 1000, rule: 'mvp-10-percent-v1' }
  )
  assert.deepEqual(
    result.ledger.map((entry) => [entry.entryType, entry.amountMinor, entry.currency]),
    [
      ['gross_authorized', '123457', 'ARS'],
      ['commission_reserved', '12346', 'ARS'],
      ['merchant_payable_held', '111111', 'ARS'],
    ]
  )
  assert.equal(result.settlement.length, 1)
  assert.equal(result.settlement[0].status, 'held')
  assert.equal(result.providerView.settlement.payoutStatus, 'not_executed')
  assert.equal(result.providerView.settlement.netMinor, '111111')
  assert.deepEqual(result.providerView.commission, {
    rateBps: 1000,
    ruleVersion: 'mvp-10-percent-v1',
  })
  assert.equal(result.customerView.settlement, undefined)
  assert.equal(result.customerView.commission, undefined)
  assert.equal(result.appendAgain, 'P2002')
  assert.equal(result.outbox.filter((type) => type === 'tus.service_settlement.held').length, 1)
})

test('WEB-09C settlement becomes eligible only after completed work and never claims a payout', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${PAID_SERVICE}
    const paid = await paidService('eligible')
    const before = await finance.evaluarLiquidacion({ tenantId: customer.tenantId, obligacionId: paid.obligacionId, correlationId: 'eval-1' })
    const started = await work.startWork({ ...provider, trabajoId: paid.service.work.trabajoId, expectedVersion: 1, idempotencyKey: 'start-e', requestHash: 'h-start-e', createdAt: '2026-09-23T10:20:00.000Z' })
    await work.completeWork({ ...provider, trabajoId: paid.service.work.trabajoId, expectedVersion: started.work.version, idempotencyKey: 'complete-e', requestHash: 'h-complete-e', createdAt: '2026-09-23T10:40:00.000Z' })
    const after = await finance.evaluarLiquidacion({ tenantId: customer.tenantId, obligacionId: paid.obligacionId, correlationId: 'eval-2' })
    const repeat = await finance.evaluarLiquidacion({ tenantId: customer.tenantId, obligacionId: paid.obligacionId, correlationId: 'eval-3' })
    const crossTenant = await codeOf(() => finance.evaluarLiquidacion({ tenantId: provider.tenantId, obligacionId: paid.obligacionId, correlationId: 'eval-x' }))
    const unpaid = await serviceWork('unpaid', { priceMode: 'fixed' })
    await finance.crearIntencionPago({ ...customer, trabajoId: unpaid.work.trabajoId, idempotencyKey: 'pay-unpaid' })
    const unpaidEval = await finance.evaluarLiquidacion({ tenantId: customer.tenantId, obligacionId: 'obligacion-' + unpaid.work.trabajoId, correlationId: 'eval-u' })
    console.log(JSON.stringify({ before: [before.status, before.reason, before.settlement.status], after: [after.status, after.settlement.status, after.settlement.payoutStatus], repeat: [repeat.status, repeat.reason], crossTenant, unpaidEval: [unpaidEval.status, unpaidEval.reason], ledgerTypes: [...financeStore.state.ledger.values()].map((entry) => entry.entryType) }))
  `)

  assert.deepEqual(result.before, ['unchanged', 'work_not_completed', 'held'])
  assert.deepEqual(result.after, ['eligible', 'eligible', 'not_executed'])
  assert.deepEqual(result.repeat, ['unchanged', 'settlement_eligible'])
  assert.equal(result.crossTenant, 'NOT_FOUND')
  assert.deepEqual(result.unpaidEval, ['unchanged', 'payment_not_approved'])
  assert.equal(result.ledgerTypes.includes('merchant_release'), false)
})

test('WEB-09C reconciliation reports matched, duplicate, missing, amount, currency and state discrepancies without fixing money', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${PAID_SERVICE}
    const system = { actorId: 'system:reconciliation', correlationId: 'recon' }
    const matchedPaid = await paidService('matched')
    const matched = await finance.conciliarObligacion({ tenantId: customer.tenantId, obligacionId: matchedPaid.obligacionId, ...system })
    const pendingWork = await serviceWork('pending', { priceMode: 'fixed' })
    const pendingIntent = await finance.crearIntencionPago({ ...customer, trabajoId: pendingWork.work.trabajoId, idempotencyKey: 'pay-pending' })
    const pending = await finance.conciliarObligacion({ tenantId: customer.tenantId, obligacionId: pendingIntent.obligation.obligacionId, ...system })
    const mismatchWork = await serviceWork('mismatch', { priceMode: 'fixed' })
    const mismatchIntent = await finance.crearIntencionPago({ ...customer, trabajoId: mismatchWork.work.trabajoId, idempotencyKey: 'pay-mismatch' })
    await finance.ingerirEventoProveedor(providerEvent('evt-bad-amount', mismatchIntent.payment, 'approved', '1.00', '2026-09-23T10:10:00.000Z'))
    await finance.ingerirEventoProveedor(providerEvent('evt-bad-currency', mismatchIntent.payment, 'approved', '1500.00', '2026-09-23T10:11:00.000Z', { currency_id: 'USD' }))
    const mismatch = await finance.conciliarObligacion({ tenantId: customer.tenantId, obligacionId: mismatchIntent.obligation.obligacionId, ...system })
    const duplicatePaid = await paidService('duplicate')
    const intentKey = [...financeStore.state.intenciones.keys()].find((key) => key.endsWith(duplicatePaid.payment.paymentId))
    const cloned = { ...financeStore.state.intenciones.get(intentKey), paymentId: duplicatePaid.payment.paymentId + '-copy', attempt: 2 }
    financeStore.state.intenciones.set(intentKey + '-copy', cloned)
    const ledgerBefore = [...financeStore.state.ledger.keys()].length
    const duplicate = await finance.conciliarObligacion({ tenantId: customer.tenantId, obligacionId: duplicatePaid.obligacionId, ...system })
    const ledgerAfter = [...financeStore.state.ledger.keys()].length
    const missingPaid = await paidService('missing')
    for (const [key, entry] of financeStore.state.ledger) if (entry.obligacionId === missingPaid.obligacionId && entry.entryType === 'gross_authorized') financeStore.state.ledger.delete(key)
    const missing = await finance.conciliarObligacion({ tenantId: customer.tenantId, obligacionId: missingPaid.obligacionId, ...system })
    const invalidPaid = await paidService('invalid')
    for (const [key, obligation] of financeStore.state.obligaciones) if (obligation.obligacionId === invalidPaid.obligacionId) financeStore.state.obligaciones.set(key, { ...obligation, status: 'pending_payment' })
    const invalid = await finance.conciliarObligacion({ tenantId: customer.tenantId, obligacionId: invalidPaid.obligacionId, ...system })
    const crossTenant = await codeOf(() => finance.conciliarObligacion({ tenantId: stranger.tenantId, obligacionId: matchedPaid.obligacionId, ...system }))
    const { validarConciliacionServicio } = await import('./packages/contracts/src/tus.ts')
    for (const run of [matched, pending, mismatch, duplicate, missing, invalid]) validarConciliacionServicio(run)
    const settlements = Object.fromEntries([...financeStore.state.liquidaciones.values()].map((settlement) => [settlement.obligacionId.replace('obligacion-trabajo-customer-tenant-commitment-', ''), settlement.status]))
    const codes = (run) => [...new Set(run.findings.map((finding) => finding.code))].sort()
    console.log(JSON.stringify({ matched: [matched.status, codes(matched)], pending: [pending.status, codes(pending)], mismatch: [mismatch.status, codes(mismatch)], mismatchObligation: [...financeStore.state.obligaciones.values()].find((obligation) => obligation.obligacionId === mismatchIntent.obligation.obligacionId).status, duplicate: [duplicate.status, codes(duplicate)], ledgerUnchanged: ledgerBefore === ledgerAfter, missing: [missing.status, codes(missing)], invalid: [invalid.status, codes(invalid)], crossTenant, settlements, runs: financeStore.state.conciliaciones.length }))
  `)

  assert.deepEqual(result.matched, ['matched', ['matched']])
  assert.deepEqual(result.pending, ['pending', []])
  assert.deepEqual(result.mismatch, ['discrepancy', ['amount_mismatch', 'currency_mismatch']])
  assert.equal(result.mismatchObligation, 'pending_payment')
  assert.deepEqual(result.duplicate, ['discrepancy', ['duplicate']])
  assert.equal(result.ledgerUnchanged, true)
  assert.deepEqual(result.missing, ['discrepancy', ['missing']])
  assert.deepEqual(result.invalid, ['discrepancy', ['invalid_state']])
  assert.equal(result.crossTenant, 'NOT_FOUND')
  assert.deepEqual(result.settlements, {
    matched: 'held',
    duplicate: 'frozen',
    missing: 'frozen',
    invalid: 'frozen',
  })
  assert.equal(result.runs, 6)
})

test('WEB-09C refunds and chargebacks compensate the ledger and settlement without provider calls', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${PAID_SERVICE}
    const refundPaid = await paidService('refund')
    const refund = await finance.ingerirEventoProveedor(providerEvent('evt-refund', refundPaid.payment, 'refunded', refundPaid.major, '2026-09-23T11:00:00.000Z'))
    const refundDuplicate = await finance.ingerirEventoProveedor(providerEvent('evt-refund', refundPaid.payment, 'refunded', refundPaid.major, '2026-09-23T11:00:00.000Z'))
    const chargebackPaid = await paidService('chargeback')
    const chargeback = await finance.ingerirEventoProveedor(providerEvent('evt-chargeback', chargebackPaid.payment, 'charged_back', chargebackPaid.major, '2026-09-23T11:00:00.000Z'))
    const refundReconciliation = await finance.conciliarObligacion({ tenantId: customer.tenantId, obligacionId: refundPaid.obligacionId, actorId: 'system', correlationId: 'r' })
    const byObligation = (obligacionId) => [...financeStore.state.ledger.values()].filter((entry) => entry.obligacionId === obligacionId).map((entry) => entry.entryType + ':' + entry.amountMinor)
    const settlementOf = (obligacionId) => [...financeStore.state.liquidaciones.values()].find((settlement) => settlement.obligacionId === obligacionId).status
    console.log(JSON.stringify({ refund: [refund.result, refund.obligation.status], refundDuplicate: refundDuplicate.status, refundLedger: byObligation(refundPaid.obligacionId), refundSettlement: settlementOf(refundPaid.obligacionId), chargeback: [chargeback.result, chargeback.obligation.status], chargebackLedger: byObligation(chargebackPaid.obligacionId), chargebackSettlement: settlementOf(chargebackPaid.obligacionId), refundReconciliation: refundReconciliation.status, providerCalls: proveedorPagos.llamadas.length }))
  `)

  assert.deepEqual(result.refund, ['applied', 'refunded'])
  assert.equal(result.refundDuplicate, 'duplicate')
  assert.deepEqual(result.refundLedger, [
    'gross_authorized:123457',
    'commission_reserved:12346',
    'merchant_payable_held:111111',
    'refund_compensation:123457',
  ])
  assert.equal(result.refundSettlement, 'reversed')
  assert.deepEqual(result.chargeback, ['applied', 'charged_back'])
  assert.deepEqual(result.chargebackLedger.at(-1), 'chargeback_compensation:123457')
  assert.equal(result.chargebackSettlement, 'frozen')
  assert.equal(result.refundReconciliation, 'matched')
  assert.equal(result.providerCalls, 2)
})

test('WEB-09C rolls back commission, ledger and settlement when any internal write fails', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${PAID_SERVICE}
    const service = await serviceWork('atomic', { priceMode: 'fixed' })
    const created = await finance.crearIntencionPago({ ...customer, trabajoId: service.work.trabajoId, idempotencyKey: 'pay-atomic' })
    const dispatched = await finance.despacharIntencionPago({ tenantId: customer.tenantId, paymentId: created.payment.paymentId, correlationId: 'd' })
    financeStore.inyectarFalla('liquidaciones')
    const failure = await codeOf(() => finance.ingerirEventoProveedor(providerEvent('evt-atomic', dispatched.payment, 'approved', '1500.00', '2026-09-23T10:10:00.000Z')))
    const afterFailure = { commissions: financeStore.state.comisiones.size, ledger: financeStore.state.ledger.size, settlements: financeStore.state.liquidaciones.size, inbox: financeStore.state.inbox.size, status: [...financeStore.state.intenciones.values()][0].providerStatus }
    const retried = await finance.ingerirEventoProveedor(providerEvent('evt-atomic', dispatched.payment, 'approved', '1500.00', '2026-09-23T10:10:00.000Z'))
    console.log(JSON.stringify({ failure, afterFailure, retried: retried.result, afterRetry: { commissions: financeStore.state.comisiones.size, ledger: financeStore.state.ledger.size, settlements: financeStore.state.liquidaciones.size } }))
  `)

  assert.match(result.failure, /injected liquidaciones failure/u)
  assert.deepEqual(result.afterFailure, {
    commissions: 0,
    ledger: 0,
    settlements: 0,
    inbox: 0,
    status: 'pending',
  })
  assert.equal(result.retried, 'applied')
  assert.deepEqual(result.afterRetry, { commissions: 1, ledger: 3, settlements: 1 })
})

test('WEB-09C Prisma adapters use the shared snapshot and ledger tables with obligation subjects', () => {
  const result = runTypeScriptScenario(`
    const { TransaccionFinanzasServicioPrisma } = await import('./apps/api/src/tus/adapters/prisma-finanzas-servicios.ts')
    const { ServicioFinanzasServicios } = await import('./apps/api/src/tus/finance/servicios/servicio.ts')
    const { ProveedorPagosServicioDeterminista } = await import('./apps/api/src/tus/finance/servicios/pagos.ts')
    const same = (left, right) => left === right || ((typeof left === 'bigint' || typeof right === 'bigint') && String(left) === String(right))
    const matches = (row, where) => Object.entries(where).every(([key, value]) => key === 'OR' ? value.some((option) => matches(row, option)) : value && typeof value === 'object' && 'not' in value ? row[key] !== value.not && row[key] !== undefined : same(row[key], value))
    const delegate = (rows) => ({
      findFirst: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }) => rows.filter((row) => matches(row, where)),
      create: async ({ data }) => { if (data.id && rows.some((row) => row.id === data.id)) throw Object.assign(new Error('unique'), { code: 'P2002' }); rows.push({ ...data }); return data },
      updateMany: async ({ where, data }) => { const found = rows.filter((row) => matches(row, where)); found.forEach((row) => Object.assign(row, data)); return { count: found.length } },
    })
    const tables = {
      trabajo: [{ versionContrato: '1.0.0', trabajoId: 'trabajo-1', tenantId: 'customer', prestadorTenantId: 'provider', compromisoId: 'commitment-1', prestadorId: 'p-1', publicacionId: 'listing-1', reservaId: null, clienteId: 'customer', estado: 'completed', version: 3, requierePresupuesto: false, presupuestoAceptadoId: null, presupuestoAceptadoVersion: null, fechaCreacion: new Date('2026-09-23T09:00:00.000Z'), fechaActualizacion: new Date('2026-09-23T09:00:00.000Z') }],
      compromisoMercadoServicios: [{ tenantId: 'customer', compromisoId: 'commitment-1', prestadorTenantId: 'provider', prestadorId: 'p-1', publicacionId: 'listing-1', contexto: 'service', estado: 'confirmed', monto: 250000n, moneda: 'ARS' }],
      publicacion: [{ tenantId: 'provider', id: 'listing-1', prestadorId: 'p-1', tipo: 'service', modalidadPrecio: 'fixed' }],
      presupuesto: [], obligacionPagoServicio: [], idempotenciaFinanciera: [], intencionPago: [], eventoWebhookPago: [], outboxEvent: [], auditoriaFinanzasServicio: [], instantaneaComision: [], movimientoContable: [], liquidacionServicio: [], conciliacionServicio: [],
    }
    const client = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, delegate(rows)]))
    client.$transaction = async (callback) => callback(client)
    const provider = new ProveedorPagosServicioDeterminista('prisma-secret')
    const finance = new ServicioFinanzasServicios(new TransaccionFinanzasServicioPrisma(client), () => Date.parse('2026-09-23T10:00:00.000Z'), provider)
    const created = await finance.crearIntencionPago({ tenantId: 'customer', actorId: 'u', correlationId: 'c', trabajoId: 'trabajo-1', idempotencyKey: 'k-1' })
    await finance.despacharIntencionPago({ tenantId: 'customer', paymentId: created.payment.paymentId, correlationId: 'd' })
    const rawBody = JSON.stringify({ id: 'evt-1', data: { id: 'fake-mp-' + created.payment.paymentId, external_reference: created.payment.paymentId, status: 'approved', transaction_amount: '2500.00', currency_id: 'ARS', date_last_updated: '2026-09-23T10:05:00.000Z' } })
    await finance.ingerirEventoProveedor({ rawBody, signature: provider.firmar(rawBody), receivedAt: '2026-09-23T10:06:00.000Z' })
    const eligible = await finance.evaluarLiquidacion({ tenantId: 'customer', obligacionId: created.obligation.obligacionId, correlationId: 'e' })
    const reconciliation = await finance.conciliarObligacion({ tenantId: 'customer', obligacionId: created.obligation.obligacionId, actorId: 'system', correlationId: 'r' })
    const view = await finance.consultarFinanzasTrabajo({ tenantId: 'provider', actorId: 'p', correlationId: 'c', trabajoId: 'trabajo-1' })
    console.log(JSON.stringify({
      snapshot: tables.instantaneaComision.map((row) => ({ compromisoId: row.compromisoId, obligacionId: row.obligacionId, bruto: String(row.montoBruto), comision: String(row.montoComision), neto: String(row.montoNeto), tipo: typeof row.montoComision })),
      ledger: tables.movimientoContable.map((row) => [row.tipoEntrada, String(row.monto), row.compromisoId, row.inmutable]),
      settlement: tables.liquidacionServicio.map((row) => [row.estado, row.estadoDesembolso, row.version]),
      eligible: eligible.status,
      reconciliation: [reconciliation.status, tables.conciliacionServicio.length, String(tables.conciliacionServicio[0].montoEsperado)],
      view: [view.settlement.status, view.settlement.netMinor, view.commission.rateBps],
    }))
  `)

  assert.deepEqual(result.snapshot, [
    {
      compromisoId: null,
      obligacionId: 'obligacion-trabajo-1',
      bruto: '250000',
      comision: '25000',
      neto: '225000',
      tipo: 'bigint',
    },
  ])
  assert.deepEqual(result.ledger, [
    ['gross_authorized', '250000', null, true],
    ['commission_reserved', '25000', null, true],
    ['merchant_payable_held', '225000', null, true],
  ])
  assert.deepEqual(result.settlement, [['eligible', 'not_executed', 2]])
  assert.equal(result.eligible, 'eligible')
  assert.deepEqual(result.reconciliation, ['matched', 1, '250000'])
  assert.deepEqual(result.view, ['eligible', '225000', 1000])
})

test('WEB-09C migration adds settlement and append-only reconciliation without payouts', () => {
  const migration = readFileSync(
    join(
      root,
      'apps/api/prisma/migrations/20260923120000_tus_service_settlement_reconciliation/migration.sql'
    ),
    'utf8'
  )
  const withoutTriggerGuard = migration.replace(/BEFORE UPDATE OR DELETE/u, '')
  assert.doesNotMatch(
    withoutTriggerGuard,
    /\b(?:DROP|TRUNCATE|DELETE\s+FROM|CASCADE|UPDATE\s+public)\b/iu
  )
  assert.match(
    migration,
    /"ck_liquidaciones_servicio_sin_desembolso" CHECK \("estado_desembolso" = 'not_executed'\)/u
  )
  assert.match(migration, /"monto_comision" \+ "monto_neto" = "monto_bruto"/u)
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\."conciliaciones_servicio"/u)
})
