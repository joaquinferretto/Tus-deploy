import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

test('WEB-09A money helpers keep exact minor units, JSON-safe strings and deterministic basis points', () => {
  const result = runTypeScriptScenario(`
    const money = await import('./packages/contracts/src/money.ts')
    const huge = 9007199254740993n
    const roundTrip = money.parseMinorUnits(money.formatMinorUnits(huge)) === huge
    const codes = []
    for (const bad of ['-1', '1.5', '01', '', ' 1', 1.5, -1, Number.MAX_SAFE_INTEGER + 2, null]) {
      try { money.parseMinorUnits(bad); codes.push('accepted') } catch { codes.push('rejected') }
    }
    let currencyMismatch = ''
    try { money.addMoney(money.createMoney('ARS', 1n), money.createMoney('USD', 1n)) } catch (error) { currencyMismatch = error.message }
    let negative = ''
    try { money.subtractMoney(money.createNonNegativeMoney('ARS', 1n), money.createNonNegativeMoney('ARS', 2n)) } catch (error) { negative = error.name }
    let precision = ''
    try { money.majorDecimalToMinorUnits('10.001', 'ARS') } catch (error) { precision = error.name }
    let unknownCurrency = ''
    try { money.minorUnitsToMajorDecimal(1n, 'XAU') } catch (error) { unknownCurrency = error.message }
    console.log(JSON.stringify({
      roundTrip,
      json: JSON.stringify({ amountMinor: money.formatMinorUnits(huge) }),
      codes,
      commission: [money.calculateBasisPointsAmount(150000n, 1000), money.calculateBasisPointsAmount(5n, 1000), money.calculateBasisPointsAmount(15n, 1000), money.calculateBasisPointsAmount(huge, 1000)].map(String),
      repeat: String(money.calculateBasisPointsAmount(123457n, 1000)) === String(money.calculateBasisPointsAmount(123457n, 1000)),
      rateErrors: [10001, -1, 1.5].map((rate) => { try { money.calculateBasisPointsAmount(1n, rate); return 'accepted' } catch { return 'rejected' } }),
      major: [money.minorUnitsToMajorDecimal(150000n, 'ars'), money.minorUnitsToMajorDecimal(5n, 'ARS'), money.minorUnitsToMajorDecimal(5n, 'CLP')],
      minor: [money.majorDecimalToMinorUnits('1500.00', 'ARS'), money.majorDecimalToMinorUnits('0.05', 'ARS'), money.majorDecimalToMinorUnits('12', 'ARS')].map(String),
      currencyMismatch, negative, precision, unknownCurrency,
    }))
  `)

  assert.equal(result.roundTrip, true)
  assert.equal(result.json, '{"amountMinor":"9007199254740993"}')
  assert.deepEqual(result.codes, [
    'rejected',
    'rejected',
    'rejected',
    'rejected',
    'rejected',
    'rejected',
    'rejected',
    'rejected',
    'rejected',
  ])
  assert.deepEqual(result.commission, ['15000', '1', '2', '900719925474099'])
  assert.equal(result.repeat, true)
  assert.deepEqual(result.rateErrors, ['rejected', 'rejected', 'rejected'])
  assert.deepEqual(result.major, ['1500.00', '0.05', '5'])
  assert.deepEqual(result.minor, ['150000', '5', '1200'])
  assert.match(result.currencyMismatch, /currency/u)
  assert.equal(result.negative, 'RangeError')
  assert.equal(result.precision, 'RangeError')
  assert.match(result.unknownCurrency, /XAU/u)
})

test('WEB-09A derives the obligation from the accepted budget and pins the WEB-08 commercial chain', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}
    const budgetWork = await serviceWork('budget', { priceMode: 'requires_budget', bookingMode: 'requiere_presupuesto' })
    const beforeBudget = await codeOf(() => finance.prepararObligacion({ ...customer, trabajoId: budgetWork.work.trabajoId, idempotencyKey: 'prepare-early' }))
    const decided = await acceptBudget(budgetWork.work.trabajoId, '987654321012')
    const prepared = await finance.prepararObligacion({ ...customer, trabajoId: budgetWork.work.trabajoId, idempotencyKey: 'prepare-1' })
    const replay = await finance.prepararObligacion({ ...customer, trabajoId: budgetWork.work.trabajoId, idempotencyKey: 'prepare-1' })
    const secondKey = await finance.prepararObligacion({ ...customer, trabajoId: budgetWork.work.trabajoId, idempotencyKey: 'prepare-2' })
    const providerPrepare = await codeOf(() => finance.prepararObligacion({ ...provider, trabajoId: budgetWork.work.trabajoId, idempotencyKey: 'prepare-provider' }))
    const strangerPrepare = await codeOf(() => finance.prepararObligacion({ ...stranger, trabajoId: budgetWork.work.trabajoId, idempotencyKey: 'prepare-stranger' }))
    const strangerRead = await codeOf(() => finance.consultarObligacion({ ...stranger, trabajoId: budgetWork.work.trabajoId }))
    const providerRead = await finance.consultarObligacion({ ...provider, trabajoId: budgetWork.work.trabajoId })
    const conflict = await codeOf(() => finance.prepararObligacion({ ...customer, actorId: 'customer-user-2', trabajoId: budgetWork.work.trabajoId, idempotencyKey: 'prepare-1' }))
    const { validarObligacionPagoServicio } = await import('./packages/contracts/src/tus.ts')
    validarObligacionPagoServicio(prepared.obligation)
    console.log(JSON.stringify({ beforeBudget, decidedWork: decided.work, prepared, replay: replay.status, sameAsReplay: JSON.stringify(replay.obligation) === JSON.stringify(prepared.obligation), secondKey, providerPrepare, strangerPrepare, strangerRead, providerRead, conflict, obligations: financeStore.state.obligaciones.size }))
  `)

  const obligation = result.prepared.obligation
  assert.equal(result.beforeBudget, 'BUDGET_NOT_ACCEPTED')
  assert.equal(result.prepared.status, 'executed')
  assert.equal(obligation.amountSource, 'accepted_budget')
  assert.equal(obligation.amountMinor, '987654321012')
  assert.equal(obligation.currency, 'ARS')
  assert.equal(obligation.status, 'pending_payment')
  assert.equal(obligation.tenantId, 'customer-tenant')
  assert.equal(obligation.clienteId, 'customer-tenant')
  assert.equal(obligation.prestadorTenantId, 'provider-tenant')
  assert.equal(obligation.prestadorId, 'provider-1')
  assert.equal(obligation.publicacionId, 'listing-budget')
  assert.equal(obligation.commitmentId, 'commitment-budget')
  assert.equal(obligation.trabajoId, result.decidedWork.trabajoId)
  assert.equal(obligation.budgetId, result.decidedWork.acceptedBudgetId)
  assert.equal(obligation.budgetVersion, result.decidedWork.acceptedBudgetVersion)
  assert.equal(result.replay, 'replay')
  assert.equal(result.sameAsReplay, true)
  assert.equal(result.secondKey.status, 'executed')
  assert.equal(result.secondKey.obligation.obligacionId, obligation.obligacionId)
  assert.equal(result.obligations, 1)
  assert.equal(result.providerPrepare, 'FORBIDDEN')
  assert.equal(result.strangerPrepare, 'NOT_FOUND')
  assert.equal(result.strangerRead, 'NOT_FOUND')
  assert.equal(result.providerRead.obligacionId, obligation.obligacionId)
  assert.equal(result.conflict, 'IDEMPOTENCY_CONFLICT')
})

test('WEB-09A uses exact commitment minor units for fixed prices and refuses non-final or inconsistent amounts', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}
    const fixed = await serviceWork('fixed', { priceMode: 'fixed', priceMinor: 123457n, price: 1234.57, priceSnapshot: { currency: 'ARS', minor: 123457n } }, 3)
    const fixedObligation = await finance.prepararObligacion({ ...customer, trabajoId: fixed.work.trabajoId, idempotencyKey: 'fixed-1' })
    const fromPrice = await serviceWork('from', { priceMode: 'precio_desde' })
    const fromPriceCode = await codeOf(() => finance.prepararObligacion({ ...customer, trabajoId: fromPrice.work.trabajoId, idempotencyKey: 'from-1' }))
    const cancelled = await serviceWork('cancelled', { priceMode: 'fixed' })
    await work.cancelWork({ ...provider, trabajoId: cancelled.work.trabajoId, expectedVersion: 1, idempotencyKey: 'cancel-c', requestHash: 'h-cancel-c', createdAt: '2026-09-23T09:40:00.000Z' })
    const cancelledCode = await codeOf(() => finance.prepararObligacion({ ...customer, trabajoId: cancelled.work.trabajoId, idempotencyKey: 'cancelled-1' }))
    const tampered = await serviceWork('tampered', { priceMode: 'fixed' })
    await marketplace.listings.save(listing('listing-tampered', { priceMode: 'fixed', merchantId: 'someone-else' }))
    const tamperedCode = await codeOf(() => finance.prepararObligacion({ ...customer, trabajoId: tampered.work.trabajoId, idempotencyKey: 'tampered-1' }))
    const missing = await serviceWork('missing', { priceMode: 'fixed' })
    await marketplace.commitments.saveMany([{ ...missing.commitment, tenantId: 'other-tenant' }])
    const missingCode = await codeOf(() => finance.prepararObligacion({ ...customer, trabajoId: missing.work.trabajoId, idempotencyKey: 'missing-1' }))
    const unknownWork = await codeOf(() => finance.prepararObligacion({ ...customer, trabajoId: 'trabajo-does-not-exist', idempotencyKey: 'unknown-1' }))
    const { derivarObligacionServicio } = await import('./apps/api/src/tus/finance/servicios/modelo.ts')
    const chain = { context: customer, trabajo: fixed.work, compromiso: { tenantId: customer.tenantId, commitmentId: fixed.work.commitmentId, prestadorTenantId: provider.tenantId, prestadorId: 'provider-1', publicacionId: fixed.work.publicacionId, context: 'service', status: 'confirmed', amountMinor: 1n, currency: 'ARS' }, publicacion: { tenantId: provider.tenantId, publicacionId: fixed.work.publicacionId, prestadorId: 'provider-1', kind: 'service', priceMode: 'fixed' }, presupuesto: null, now: '2026-09-23T10:00:00.000Z' }
    const crossTenant = await codeOf(async () => derivarObligacionServicio({ ...chain, compromiso: { ...chain.compromiso, tenantId: 'other-tenant' } }))
    const wrongProvider = await codeOf(async () => derivarObligacionServicio({ ...chain, compromiso: { ...chain.compromiso, prestadorTenantId: 'other-provider' } }))
    const wrongCommitment = await codeOf(async () => derivarObligacionServicio({ ...chain, compromiso: { ...chain.compromiso, commitmentId: 'other-commitment' } }))
    const productCommitment = await codeOf(async () => derivarObligacionServicio({ ...chain, compromiso: { ...chain.compromiso, context: 'product' } }))
    const cancelledCommitment = await codeOf(async () => derivarObligacionServicio({ ...chain, compromiso: { ...chain.compromiso, status: 'cancelled' } }))
    const budgetMismatch = await codeOf(async () => derivarObligacionServicio({ ...chain, trabajo: { ...fixed.work, status: 'accepted', acceptedBudgetId: 'b-1', acceptedBudgetVersion: 2 }, presupuesto: { tenantId: customer.tenantId, prestadorTenantId: provider.tenantId, trabajoId: fixed.work.trabajoId, presupuestoId: 'b-1', version: 1, status: 'accepted', currency: 'ARS', totalMinor: 10n } }))
    console.log(JSON.stringify({ fixedObligation: fixedObligation.obligation, fromPriceCode, cancelledCode, tamperedCode, missingCode, unknownWork, crossTenant, wrongProvider, wrongCommitment, productCommitment, cancelledCommitment, budgetMismatch, obligations: financeStore.state.obligaciones.size }))
  `)

  assert.equal(result.fixedObligation.amountSource, 'fixed_price_commitment')
  assert.equal(result.fixedObligation.amountMinor, '370371')
  assert.equal(result.fixedObligation.budgetId, null)
  assert.equal(result.fromPriceCode, 'AMOUNT_NOT_FINAL')
  assert.equal(result.cancelledCode, 'WORK_CANCELLED')
  assert.equal(result.tamperedCode, 'INCONSISTENT_COMMERCIAL_CHAIN')
  assert.equal(result.missingCode, 'INCONSISTENT_COMMERCIAL_CHAIN')
  assert.equal(result.unknownWork, 'NOT_FOUND')
  assert.equal(result.crossTenant, 'INCONSISTENT_COMMERCIAL_CHAIN')
  assert.equal(result.wrongProvider, 'INCONSISTENT_COMMERCIAL_CHAIN')
  assert.equal(result.wrongCommitment, 'INCONSISTENT_COMMERCIAL_CHAIN')
  assert.equal(result.productCommitment, 'INVALID_COMMITMENT')
  assert.equal(result.cancelledCommitment, 'INVALID_COMMITMENT_STATUS')
  assert.equal(result.budgetMismatch, 'INCONSISTENT_BUDGET')
  assert.equal(result.obligations, 1)
})

test('WEB-09A obligation state machine only allows transitions backed by real capabilities', () => {
  const result = runTypeScriptScenario(`
    const { esTransicionObligacionPermitida, transicionarObligacion } = await import('./apps/api/src/tus/finance/servicios/modelo.ts')
    const states = ['pending_payment', 'paid', 'refunded', 'charged_back']
    const allowed = []
    for (const from of states) for (const to of states) if (esTransicionObligacionPermitida(from, to)) allowed.push(from + '>' + to)
    let invalid = ''
    try { transicionarObligacion({ status: 'pending_payment', version: 1 }, 'refunded', '2026-09-23T10:00:00.000Z') } catch (error) { invalid = error.code }
    const moved = transicionarObligacion({ status: 'pending_payment', version: 1 }, 'paid', '2026-09-23T10:00:00.000Z')
    console.log(JSON.stringify({ allowed, invalid, moved }))
  `)

  assert.deepEqual(result.allowed, ['pending_payment>paid', 'paid>refunded', 'paid>charged_back'])
  assert.equal(result.invalid, 'INVALID_TRANSITION')
  assert.equal(result.moved.version, 2)
  assert.equal(result.moved.status, 'paid')
})

test('WEB-09A Prisma adapter round-trips bigint amounts, scopes lookups and retries unique races', () => {
  const result = runTypeScriptScenario(`
    const { TransaccionFinanzasServicioPrisma, filaObligacion, mapearObligacion } = await import('./apps/api/src/tus/adapters/prisma-finanzas-servicios.ts')
    const { ServicioFinanzasServicios } = await import('./apps/api/src/tus/finance/servicios/servicio.ts')
    const matches = (row, where) => Object.entries(where).every(([key, value]) => key === 'OR' ? value.some((option) => matches(row, option)) : row[key] === value)
    function delegate(rows, hooks = {}) {
      return {
        findFirst: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
        findMany: async ({ where }) => rows.filter((row) => matches(row, where)),
        create: async ({ data }) => { hooks.beforeCreate?.(data); rows.push({ ...data }); return data },
        updateMany: async ({ where, data }) => { const found = rows.filter((row) => matches(row, where)); found.forEach((row) => Object.assign(row, data)); return { count: found.length } },
      }
    }
    const tables = {
      trabajo: [{ versionContrato: '1.0.0', trabajoId: 'trabajo-1', tenantId: 'customer', prestadorTenantId: 'provider', compromisoId: 'commitment-1', prestadorId: 'p-1', publicacionId: 'listing-1', reservaId: null, clienteId: 'customer', estado: 'in_progress', version: 3, requierePresupuesto: false, presupuestoAceptadoId: null, presupuestoAceptadoVersion: null, fechaCreacion: new Date('2026-09-23T09:00:00.000Z'), fechaActualizacion: new Date('2026-09-23T09:00:00.000Z') }],
      compromisoMercadoServicios: [{ tenantId: 'customer', compromisoId: 'commitment-1', prestadorTenantId: 'provider', prestadorId: 'p-1', publicacionId: 'listing-1', contexto: 'service', estado: 'confirmed', monto: 9007199254740993n, moneda: 'ARS' }],
      publicacion: [{ tenantId: 'provider', id: 'listing-1', prestadorId: 'p-1', tipo: 'service', modalidadPrecio: 'precio_fijo' }],
      presupuesto: [],
      obligacionPagoServicio: [],
      idempotenciaFinanciera: [],
      auditoria: [],
    }
    let raced = false
    const client = {
      trabajo: delegate(tables.trabajo), compromisoMercadoServicios: delegate(tables.compromisoMercadoServicios), publicacion: delegate(tables.publicacion), presupuesto: delegate(tables.presupuesto),
      obligacionPagoServicio: delegate(tables.obligacionPagoServicio, { beforeCreate: () => { if (!raced) { raced = true; throw Object.assign(new Error('unique'), { code: 'P2002' }) } } }),
      idempotenciaFinanciera: delegate(tables.idempotenciaFinanciera), intencionPago: delegate([]), eventoWebhookPago: delegate([]), outboxEvent: delegate([]), auditoriaFinanzasServicio: delegate(tables.auditoria),
      transactions: 0,
      async $transaction(callback, options) { this.transactions += 1; this.isolation = options?.isolationLevel; return callback(this) },
    }
    const finance = new ServicioFinanzasServicios(new TransaccionFinanzasServicioPrisma(client), () => Date.parse('2026-09-23T10:00:00.000Z'))
    const prepared = await finance.prepararObligacion({ tenantId: 'customer', actorId: 'u', correlationId: 'c', trabajoId: 'trabajo-1', idempotencyKey: 'k-1' })
    const txAfterPrepare = client.transactions
    const persisted = tables.obligacionPagoServicio[0]
    const providerRead = await finance.consultarObligacion({ tenantId: 'provider', actorId: 'p', correlationId: 'c', trabajoId: 'trabajo-1' })
    let strangerCode = ''
    try { await finance.consultarObligacion({ tenantId: 'stranger', actorId: 's', correlationId: 'c', trabajoId: 'trabajo-1' }) } catch (error) { strangerCode = error.code }
    const mapped = mapearObligacion(filaObligacion(mapearObligacion(persisted)))
    console.log(JSON.stringify({ prepared, montoType: typeof persisted.monto, monto: String(persisted.monto), transactions: txAfterPrepare, isolation: client.isolation, providerRead, strangerCode, mappedAmount: String(mapped.amountMinor), idempotency: tables.idempotenciaFinanciera.length, audits: tables.auditoria.map((row) => row.accion) }))
  `)

  assert.equal(result.prepared.obligation.amountMinor, '9007199254740993')
  assert.equal(result.montoType, 'bigint')
  assert.equal(result.monto, '9007199254740993')
  assert.equal(result.mappedAmount, '9007199254740993')
  assert.equal(result.transactions, 2)
  assert.equal(result.isolation, 'Serializable')
  assert.equal(result.providerRead.obligacionId, 'obligacion-trabajo-1')
  assert.equal(result.strangerCode, 'NOT_FOUND')
  assert.equal(result.idempotency, 1)
  assert.deepEqual(result.audits, ['obligation.created'])
})

test('WEB-09A legacy finance refuses marketplace commitments whose amount is expressed in major units', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = await import('./apps/api/src/tus/finance/index.ts')
    const marketplaceCommitment = { contractVersion: '1.0.0', commitmentId: 'mc-1', cartId: 'cart', tenantId: 'tenant', merchantId: 'm', context: 'service', amount: 1500, currency: 'ARS', status: 'confirmed', lineIds: [], version: 1, createdAt: '2026-09-23T10:00:00.000Z', listingId: 'l', quantity: 1, availabilityVersion: 1, policyVersion: 'p', priceSnapshot: { currency: 'ARS', minor: 150000n } }
    const finance = new TusFinanceService({ store: new InMemoryFinanceStore(), provider: new DeterministicMercadoPagoFinanceProvider(), commitmentLookup: async () => marketplaceCommitment })
    let code = ''
    try { await finance.createPaymentIntent({ tenantId: 'tenant', actorId: 'a', correlationId: 'c', commitmentId: 'mc-1', idempotencyKey: 'k', requestHash: 'h' }) } catch (error) { code = error.code }
    console.log(JSON.stringify({ code }))
  `)

  assert.equal(result.code, 'SERVICE_OBLIGATION_REQUIRED')
})

test('WEB-09A migration is forward-only, additive and keeps a single finance subject per row', () => {
  const migration = readFileSync(
    join(
      root,
      'apps/api/prisma/migrations/20260923100000_tus_service_finance_identity/migration.sql'
    ),
    'utf8'
  )
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  assert.doesNotMatch(
    migration,
    /\b(?:DROP\s+(?:TABLE|COLUMN|INDEX|CONSTRAINT)|TRUNCATE|DELETE\s+FROM|CASCADE|UPDATE\s+public)\b/iu
  )
  assert.match(migration, /CREATE TABLE public\."obligaciones_pago_servicio"/u)
  assert.match(
    migration,
    /REFERENCES public\."trabajos"\("tenant_id", "trabajo_id", "compromiso_id", "prestador_tenant_id", "prestador_id", "publicacion_id"\)/u
  )
  for (const table of ['intenciones_pago', 'instantaneas_comision', 'movimientos_contables']) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\."${table}" ADD COLUMN "obligacion_id" text;`, 'u')
    )
    assert.match(
      migration,
      new RegExp(
        `"ck_${table}_sujeto_unico" CHECK \\(\\("compromiso_id" IS NULL\\) <> \\("obligacion_id" IS NULL\\)\\) NOT VALID`,
        'u'
      )
    )
  }
  assert.match(migration, /"ck_obligaciones_pago_monto_no_negativo" CHECK \("monto" >= 0\)/u)
  assert.match(schema, /model ObligacionPagoServicio \{/u)
  assert.match(
    schema,
    /@@unique\(\[tenantId, trabajoId\], map: "uq_obligaciones_pago_tenant_trabajo"\)/u
  )
})
