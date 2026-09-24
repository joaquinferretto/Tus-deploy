import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import {
  classifySqlStatement,
  gateInventory,
  inventoryMigrations,
  splitSqlStatements,
} from '../../scripts/tus-migration-repair-lib.mjs'

const MIGRATIONS = join(root, 'apps/api/prisma/migrations')
const IDENTITY = '20260923100000_tus_service_finance_identity'
const INTENTS = '20260923110000_tus_service_payment_intents'
const SETTLEMENT = '20260923120000_tus_service_settlement_reconciliation'
const HARDENING = '20260924100000_tus_finance_subject_hardening'
const DUAL_SUBJECT_TABLES = ['intenciones_pago', 'instantaneas_comision', 'movimientos_contables']

const readMigration = (name) => readFile(join(MIGRATIONS, name, 'migration.sql'), 'utf8')

// Prisma-like fake with PostgreSQL unique semantics: a unique key with any NULL column never
// conflicts, which is exactly the risk introduced by a nullable compromiso_id.
const PRISMA_FAKE = `
  const same = (left, right) => left === right || ((typeof left === 'bigint' || typeof right === 'bigint') && String(left) === String(right))
  const flat = (where) => Object.fromEntries(Object.entries(where).flatMap(([key, value]) => key.includes('_') && value && typeof value === 'object' && !('not' in value) ? Object.entries(value) : [[key, value]]))
  const matches = (row, where) => Object.entries(flat(where)).every(([key, value]) => key === 'OR' ? value.some((option) => matches(row, option)) : value && typeof value === 'object' && 'not' in value ? row[key] !== value.not && row[key] !== undefined : same(row[key] ?? null, value ?? null))
  function delegate(rows, uniques = []) {
    const conflict = (data, ignore) => uniques.some((columns) => columns.every((column) => data[column] !== null && data[column] !== undefined) && rows.some((row) => row !== ignore && columns.every((column) => same(row[column], data[column]))))
    return {
      rows,
      findUnique: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
      findFirst: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }) => rows.filter((row) => matches(row, where)),
      create: async ({ data }) => { if (conflict(data)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }); rows.push({ ...data }); return { ...data } },
      upsert: async ({ where, create, update }) => { const found = rows.find((row) => matches(row, where)); if (found) { Object.assign(found, update); return { ...found } } if (conflict(create)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }); rows.push({ ...create }); return { ...create } },
      updateMany: async ({ where, data }) => { const found = rows.filter((row) => matches(row, where)); found.forEach((row) => Object.assign(row, data)); return { count: found.length } },
    }
  }
  const tables = {
    intencionPago: delegate([], [['tenantId', 'pagoId'], ['tenantId', 'compromisoId'], ['tenantId', 'claveIdempotencia'], ['tenantId', 'obligacionId', 'intento']]),
    instantaneaComision: delegate([], [['tenantId', 'instantaneaId'], ['tenantId', 'compromisoId'], ['tenantId', 'obligacionId']]),
    movimientoContable: delegate([], [['tenantId', 'entradaId']]),
    idempotenciaFinanciera: delegate([], [['tenantId', 'claveIdempotencia']]),
  }
`

test('DB-09-SAFETY the subject guard accepts exactly one of compromiso_id and obligacion_id', () => {
  const result = runTypeScriptScenario(`
    const { asegurarSujetoFinancieroUnico, tieneSujetoFinancieroUnico } = await import('./apps/api/src/tus/finance/sujeto.ts')
    const cases = { legacy: { compromisoId: 'c-1', obligacionId: null }, service: { compromisoId: null, obligacionId: 'o-1' }, none: { compromisoId: null, obligacionId: null }, both: { compromisoId: 'c-1', obligacionId: 'o-1' }, emptyString: { compromisoId: '', obligacionId: undefined } }
    const outcome = Object.fromEntries(Object.entries(cases).map(([name, row]) => { try { asegurarSujetoFinancieroUnico(row); return [name, 'accepted'] } catch (error) { return [name, error.code] } }))
    // Same truth table as the SQL CHECK: (compromiso_id IS NULL) <> (obligacion_id IS NULL).
    const sqlXor = (row) => (row.compromisoId == null) !== (row.obligacionId == null)
    const agree = Object.values(cases).filter((row) => row.compromisoId !== '').every((row) => sqlXor(row) === tieneSujetoFinancieroUnico(row))
    console.log(JSON.stringify({ outcome, agree }))
  `)

  assert.deepEqual(result.outcome, {
    legacy: 'accepted',
    service: 'accepted',
    none: 'FINANCIAL_SUBJECT_XOR',
    both: 'FINANCIAL_SUBJECT_XOR',
    emptyString: 'FINANCIAL_SUBJECT_XOR',
  })
  assert.equal(result.agree, true)
})

test('DB-09-SAFETY migrations keep one ledger, a validated XOR and restrictive FKs per subject', async () => {
  const identity = await readMigration(IDENTITY)
  const hardening = await readMigration(HARDENING)
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  for (const table of DUAL_SUBJECT_TABLES) {
    assert.match(
      identity,
      new RegExp(`ALTER TABLE public\\."${table}" ALTER COLUMN "compromiso_id" DROP NOT NULL;`, 'u')
    )
    assert.match(
      identity,
      new RegExp(
        `"ck_${table}_sujeto_unico" CHECK \\(\\("compromiso_id" IS NULL\\) <> \\("obligacion_id" IS NULL\\)\\)`,
        'u'
      )
    )
    assert.match(
      identity,
      new RegExp(
        `ALTER TABLE public\\."${table}"\\s+ADD CONSTRAINT "fk_${table}_obligaciones" FOREIGN KEY \\("tenant_id", "obligacion_id"\\)\\s+REFERENCES public\\."obligaciones_pago_servicio"\\("tenant_id", "obligacion_id"\\) ON DELETE RESTRICT`,
        'u'
      )
    )
    assert.match(
      hardening,
      new RegExp(
        `ALTER TABLE public\\."${table}" VALIDATE CONSTRAINT "ck_${table}_sujeto_unico";`,
        'u'
      )
    )
    const model = {
      intenciones_pago: 'IntencionPago',
      instantaneas_comision: 'InstantaneaComision',
      movimientos_contables: 'MovimientoContable',
    }[table]
    const block = schema.slice(
      schema.indexOf(`model ${model} {`),
      schema.indexOf('\n}', schema.indexOf(`model ${model} {`))
    )
    assert.match(
      block,
      /compromiso\s+Compromiso\?\s+@relation\(fields: \[tenantId, compromisoId\], references: \[tenantId, compromisoId\], onDelete: Restrict/u
    )
    assert.match(block, /compromisoId\s+String\?/u)
    assert.match(block, /obligacionId\s+String\?/u)
  }
  // No separate ledger was created: service entries share movimientos_contables.
  assert.equal((schema.match(/@@map\("movimientos_contables"\)/gu) ?? []).length, 1)
  assert.doesNotMatch(schema, /@@map\("movimientos_contables_servicio"\)|@@map\("ledger_servicio/u)
  for (const name of [IDENTITY, INTENTS, SETTLEMENT, HARDENING])
    assert.doesNotMatch(await readMigration(name), /ON DELETE CASCADE/iu)
  assert.match(
    hardening,
    /"ck_movimientos_contables_espacio_sujeto" CHECK \(\("obligacion_id" IS NOT NULL\) = \("entrada_id" LIKE 'svc-%'\)\) NOT VALID/u
  )
  assert.match(
    hardening,
    /FOREIGN KEY \("tenant_id", "obligacion_id", "prestador_tenant_id", "trabajo_id"\)\s+REFERENCES public\."obligaciones_pago_servicio"/u
  )
  assert.match(
    hardening,
    /FOREIGN KEY \("tenant_id", "obligacion_id", "prestador_tenant_id", "orden_id"\)/u
  )
  assert.match(
    hardening,
    /"ck_eventos_webhook_pago_sujeto_completo" CHECK \(\("pago_id" IS NULL\) = \("obligacion_id" IS NULL\)\) NOT VALID;/u
  )
  // Every new FK/check is validated in a separate statement (short ADD lock, non-blocking scan).
  for (const constraint of [
    'fk_intenciones_pago_obligacion_prestador',
    'fk_liquidaciones_servicio_obligacion_prestador',
    'fk_eventos_webhook_pago_intenciones',
    'ck_eventos_webhook_pago_sujeto_completo',
  ])
    assert.match(hardening, new RegExp(`VALIDATE CONSTRAINT "${constraint}";`, 'u'))
})

test('DB-09-SAFETY every logical uniqueness has a legacy and a service variant that ignores the other NULL', async () => {
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const expectations = {
    IntencionPago: [
      '[tenantId, compromisoId]',
      '[tenantId, obligacionId, intento]',
      '[tenantId, pagoId]',
      '[tenantId, claveIdempotencia]',
    ],
    InstantaneaComision: ['[tenantId, compromisoId]', '[tenantId, obligacionId]'],
    MovimientoContable: ['[tenantId, entradaId]'],
    LiquidacionServicio: ['[tenantId, obligacionId]'],
    ObligacionPagoServicio: [
      '[tenantId, trabajoId]',
      '[tenantId, obligacionId, prestadorTenantId, trabajoId]',
    ],
  }
  for (const [model, uniques] of Object.entries(expectations)) {
    const start = schema.indexOf(`model ${model} {`)
    const block = schema.slice(start, schema.indexOf('\n}', start))
    for (const unique of uniques)
      assert.ok(block.includes(`@@unique(${unique}`), `${model} ${unique}`)
  }

  const result = runTypeScriptScenario(`${PRISMA_FAKE}
    const attempt = async (table, data) => { try { await tables[table].create({ data }); return 'ok' } catch (error) { return error.code } }
    const legacySnapshot = { tenantId: 't', instantaneaId: 's-legacy', compromisoId: 'c-1', obligacionId: null }
    const serviceSnapshot = { tenantId: 't', instantaneaId: 's-service', compromisoId: null, obligacionId: 'o-1' }
    const snapshots = [await attempt('instantaneaComision', legacySnapshot), await attempt('instantaneaComision', serviceSnapshot), await attempt('instantaneaComision', { ...legacySnapshot, instantaneaId: 's-legacy-2' }), await attempt('instantaneaComision', { ...serviceSnapshot, instantaneaId: 's-service-2' }), await attempt('instantaneaComision', { tenantId: 't', instantaneaId: 's-service-3', compromisoId: null, obligacionId: 'o-2' })]
    const intents = [await attempt('intencionPago', { tenantId: 't', pagoId: 'p-l', compromisoId: 'c-1', obligacionId: null, intento: null, claveIdempotencia: 'k-l' }), await attempt('intencionPago', { tenantId: 't', pagoId: 'p-s1', compromisoId: null, obligacionId: 'o-1', intento: 1, claveIdempotencia: 'servicio:k-1' }), await attempt('intencionPago', { tenantId: 't', pagoId: 'p-s1b', compromisoId: null, obligacionId: 'o-1', intento: 1, claveIdempotencia: 'servicio:k-2' }), await attempt('intencionPago', { tenantId: 't', pagoId: 'p-s2', compromisoId: null, obligacionId: 'o-1', intento: 2, claveIdempotencia: 'servicio:k-3' }), await attempt('intencionPago', { tenantId: 't', pagoId: 'p-l2', compromisoId: 'c-1', obligacionId: null, intento: null, claveIdempotencia: 'k-l2' })]
    const ledger = [await attempt('movimientoContable', { tenantId: 't', entradaId: 'gross-c-1', compromisoId: 'c-1', obligacionId: null }), await attempt('movimientoContable', { tenantId: 't', entradaId: 'svc-gross-o-1', compromisoId: null, obligacionId: 'o-1' }), await attempt('movimientoContable', { tenantId: 't', entradaId: 'gross-c-1', compromisoId: 'c-1', obligacionId: null }), await attempt('movimientoContable', { tenantId: 't', entradaId: 'svc-gross-o-1', compromisoId: null, obligacionId: 'o-1' })]
    console.log(JSON.stringify({ snapshots, intents, ledger }))
  `)

  assert.deepEqual(result.snapshots, ['ok', 'ok', 'P2002', 'P2002', 'ok'])
  assert.deepEqual(result.intents, ['ok', 'ok', 'P2002', 'ok', 'P2002'])
  assert.deepEqual(result.ledger, ['ok', 'ok', 'P2002', 'P2002'])
})

test('DB-09-SAFETY legacy and service stores stay scoped to their subject in the shared tables', () => {
  const result = runTypeScriptScenario(`${PRISMA_FAKE}
    for (const name of ['evidenciaFinanciera', 'confirmacionFinanciera', 'bloqueoFinanciero', 'registroConciliacion', 'eventoWebhookPago']) tables[name] = delegate([])
    const { PrismaTusFinanceStore } = await import('./apps/api/src/tus/finance/prisma.ts')
    const { LedgerServicioPrisma, ComisionesServicioPrisma } = await import('./apps/api/src/tus/adapters/prisma-finanzas-servicios.ts')
    const legacy = new PrismaTusFinanceStore(tables)
    const serviceLedger = new LedgerServicioPrisma(tables)
    const serviceSnapshots = new ComisionesServicioPrisma(tables)
    const now = Date.parse('2026-09-24T10:00:00.000Z')
    await legacy.appendLedger({ entryId: 'gross_authorized-c-1', tenantId: 't', commitmentId: 'c-1', entryType: 'gross_authorized', amount: 1000, currency: 'ARS', linkedEntryId: null, reason: 'legacy', immutable: true, createdAt: now })
    await serviceLedger.agregar({ entryId: 'svc-gross-o-1', tenantId: 't', obligacionId: 'o-1', entryType: 'gross_authorized', amountMinor: 2000n, currency: 'ARS', linkedEntryId: null, reason: 'service', createdAt: '2026-09-24T10:00:00.000Z' })
    await serviceLedger.agregar({ entryId: 'svc-refund-o-1', tenantId: 't', obligacionId: 'o-1', entryType: 'refund_compensation', amountMinor: 2000n, currency: 'ARS', linkedEntryId: 'svc-gross-o-1', reason: 'provider-event:e', createdAt: '2026-09-24T10:05:00.000Z' })
    const legacyList = await legacy.listLedger('t', 'c-1')
    const serviceList = await serviceLedger.listar({ tenantId: 't', obligacionId: 'o-1' })
    let collision = ''
    try { await legacy.appendLedger({ entryId: 'svc-gross-o-1', tenantId: 't', commitmentId: 'c-1', entryType: 'gross_authorized', amount: 1000, currency: 'ARS', linkedEntryId: null, reason: 'squat', immutable: true, createdAt: now }) } catch (error) { collision = error.code }
    await legacy.saveSnapshot({ contractVersion: '1.0.0', snapshotId: 'snap-c-1', tenantId: 't', commitmentId: 'c-1', context: 'service', grossAmount: 1000, deductions: 0, commissionableBase: 1000, rateBps: 1000, ruleVersion: 'r', commissionAmount: 100, netAmount: 900, currency: 'ARS', providerReference: 'ref', evidenceId: 'e', ledgerStatus: 'held', createdAt: now })
    await serviceSnapshots.crear({ snapshotId: 'comision-o-1', tenantId: 't', obligacionId: 'o-1', grossMinor: 2000n, commissionableBaseMinor: 2000n, rateBps: 1000, ruleVersion: 'r', commissionMinor: 200n, netMinor: 1800n, currency: 'ARS', providerReference: 'ref', evidenceId: 'e', createdAt: '2026-09-24T10:00:00.000Z' })
    const legacySnapshot = await legacy.getSnapshot('t', 'c-1')
    const serviceSnapshot = await serviceSnapshots.buscar({ tenantId: 't', obligacionId: 'o-1' })
    let legacyDuplicate = ''
    try { await legacy.saveSnapshot({ ...legacySnapshot, snapshotId: 'snap-c-1-dup' }) } catch (error) { legacyDuplicate = error.code }
    let serviceDuplicate = ''
    try { await serviceSnapshots.crear({ ...serviceSnapshot, snapshotId: 'comision-o-1-dup' }) } catch (error) { serviceDuplicate = error.code }
    const subjects = tables.movimientoContable.rows.map((row) => [row.entradaId, row.compromisoId ?? null, row.obligacionId ?? null])
    console.log(JSON.stringify({ legacyList: legacyList.map((entry) => entry.entryId), serviceList: serviceList.map((entry) => entry.entryType), collision, legacySnapshot: legacySnapshot.commitmentId, serviceSnapshot: serviceSnapshot.obligacionId, legacyDuplicate, serviceDuplicate, subjects }))
  `)

  assert.deepEqual(result.legacyList, ['gross_authorized-c-1'])
  assert.deepEqual(result.serviceList, ['gross_authorized', 'refund_compensation'])
  assert.equal(result.collision, 'LEDGER_IMMUTABLE')
  assert.equal(result.legacySnapshot, 'c-1')
  assert.equal(result.serviceSnapshot, 'o-1')
  assert.equal(result.legacyDuplicate, 'P2002')
  assert.equal(result.serviceDuplicate, 'P2002')
  assert.deepEqual(result.subjects, [
    ['gross_authorized-c-1', 'c-1', null],
    ['svc-gross-o-1', null, 'o-1'],
    ['svc-refund-o-1', null, 'o-1'],
  ])
})

test('DB-09-SAFETY financial idempotency keys of legacy and service flows never collide', () => {
  const result = runTypeScriptScenario(`${PRISMA_FAKE}
    const { PrismaTusFinanceStore } = await import('./apps/api/src/tus/finance/prisma.ts')
    const { IdempotenciaFinancieraPrisma } = await import('./apps/api/src/tus/adapters/prisma-finanzas-servicios.ts')
    const { resolverIdempotenciaFinanciera } = await import('./apps/api/src/tus/finance/servicios/modelo.ts')
    const legacy = new PrismaTusFinanceStore(tables)
    const service = new IdempotenciaFinancieraPrisma(tables)
    await legacy.saveIdempotency('t', 'shared-key', { requestHash: 'legacy-hash', response: { status: 'held' } })
    const serviceBefore = await service.buscar({ tenantId: 't', key: 'shared-key' })
    await service.registrar({ tenantId: 't', key: 'shared-key', record: { requestHash: 'service-hash', response: { status: 'executed' } } })
    const legacyAfter = await legacy.getIdempotency('t', 'shared-key')
    const serviceAfter = await service.buscar({ tenantId: 't', key: 'shared-key' })
    const replay = resolverIdempotenciaFinanciera(serviceAfter, 'service-hash').status
    let conflict = ''
    try { resolverIdempotenciaFinanciera(serviceAfter, 'other-hash') } catch (error) { conflict = error.code }
    const otherTenant = await service.buscar({ tenantId: 'u', key: 'shared-key' })
    let duplicate = ''
    try { await service.registrar({ tenantId: 't', key: 'shared-key', record: { requestHash: 'x', response: {} } }) } catch (error) { duplicate = error.code }
    console.log(JSON.stringify({ serviceBefore, legacyAfter: legacyAfter.requestHash, serviceAfter: serviceAfter.requestHash, replay, conflict, otherTenant, duplicate, keys: tables.idempotenciaFinanciera.rows.map((row) => row.claveIdempotencia) }))
  `)

  assert.equal(result.serviceBefore, null)
  assert.equal(result.legacyAfter, 'legacy-hash')
  assert.equal(result.serviceAfter, 'service-hash')
  assert.equal(result.replay, 'replay')
  assert.equal(result.conflict, 'IDEMPOTENCY_CONFLICT')
  assert.equal(result.otherTenant, null)
  assert.equal(result.duplicate, 'P2002')
  assert.deepEqual(result.keys, ['shared-key', 'servicio:shared-key'])
})

test('DB-09-SAFETY checker classifies DROP NOT NULL as a relaxation and still blocks real destruction', () => {
  const cases = {
    'ALTER TABLE x ALTER COLUMN compromiso_id DROP NOT NULL;': 'constraint_relaxation',
    'ALTER TABLE public."intenciones_pago" ALTER COLUMN "compromiso_id" DROP NOT NULL;':
      'constraint_relaxation',
    'DROP TABLE x;': 'destructive',
    'DROP SCHEMA finance;': 'destructive',
    'DROP TYPE estado;': 'destructive',
    'ALTER TABLE x DROP COLUMN compromiso_id;': 'destructive',
    'ALTER TABLE x DROP compromiso_id;': 'destructive',
    'ALTER TABLE x DROP COLUMN IF EXISTS compromiso_id;': 'destructive',
    'TRUNCATE TABLE x;': 'destructive',
    'DELETE FROM x;': 'destructive',
    'ALTER TABLE x DROP CONSTRAINT fk_x;': 'high_risk',
    'ALTER TABLE x ALTER COLUMN a DROP DEFAULT;': 'high_risk',
    'DROP INDEX idx_x;': 'high_risk',
    'ALTER TABLE x ALTER COLUMN a DROP NOT NULL, DROP COLUMN b;': 'destructive',
    'ALTER TABLE x DROP COLUMN b, ALTER COLUMN a DROP NOT NULL;': 'destructive',
    'ALTER TABLE x ALTER COLUMN a DROP NOT NULL, DROP CONSTRAINT fk;': 'high_risk',
    'ALTER TABLE x ALTER COLUMN a DROP NOT NULL, ADD COLUMN b text;': 'constraint_relaxation',
    "ALTER TABLE x ADD CONSTRAINT ck CHECK (a IN ('DROP', 'b')) NOT VALID;": 'additive',
    'ALTER TABLE x VALIDATE CONSTRAINT ck_x;': 'additive',
    'ALTER TABLE x ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES y (a) ON DELETE CASCADE;':
      'destructive',
  }
  for (const [sql, expected] of Object.entries(cases))
    assert.equal(classifySqlStatement(sql), expected, sql)
  assert.equal(
    gateInventory({ statements: ['ALTER TABLE x ALTER COLUMN a DROP NOT NULL;'] }).reason,
    'safe-additive-sql-with-constraint-relaxation'
  )
  assert.equal(
    gateInventory({ statements: ['ALTER TABLE x DROP CONSTRAINT fk;'] }).status,
    'rejected'
  )
  assert.equal(
    gateInventory({ statements: ['ALTER TABLE x DROP CONSTRAINT fk;'] }).reason,
    'high-risk-sql-rejected'
  )
})

test('DB-09-SAFETY a migration mixing DROP NOT NULL with DROP COLUMN is rejected as a whole', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'db-09-safety-'))
  try {
    await mkdir(join(directory, '20260924000000_mixed'), { recursive: true })
    await writeFile(
      join(directory, '20260924000000_mixed', 'migration.sql'),
      'ALTER TABLE public."intenciones_pago" ALTER COLUMN "compromiso_id" DROP NOT NULL;\nALTER TABLE public."intenciones_pago" DROP COLUMN "orden_id";\n',
      'utf8'
    )
    await mkdir(join(directory, '20260924000001_relaxation'), { recursive: true })
    await writeFile(
      join(directory, '20260924000001_relaxation', 'migration.sql'),
      'ALTER TABLE public."movimientos_contables" ALTER COLUMN "compromiso_id" DROP NOT NULL;\n',
      'utf8'
    )
    const inventory = await inventoryMigrations({
      migrationsDirectory: directory,
      repairMigrationNames: [],
    })
    const mixed = inventory.migrations.find((migration) => migration.name.endsWith('_mixed'))
    const relaxation = inventory.migrations.find((migration) =>
      migration.name.endsWith('_relaxation')
    )
    assert.deepEqual(
      mixed.statements.map((statement) => statement.classification),
      ['constraint_relaxation', 'destructive']
    )
    assert.equal(gateInventory({ statements: mixed.statements }).status, 'rejected')
    assert.equal(gateInventory({ statements: relaxation.statements }).status, 'passed')
    assert.equal(inventory.destructiveStatementCount, 1)
    assert.equal(inventory.constraintRelaxationCount, 2)
    assert.deepEqual(inventory.destructiveTokens, ['DROP'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('DB-09-SAFETY the WEB-09 and hardening migrations contain no destructive or high-risk SQL', async () => {
  const classifications = {}
  for (const name of [IDENTITY, INTENTS, SETTLEMENT, HARDENING]) {
    classifications[name] = splitSqlStatements(await readMigration(name)).map(classifySqlStatement)
    assert.equal(classifications[name].includes('destructive'), false, name)
    assert.equal(classifications[name].includes('high_risk'), false, name)
  }
  assert.equal(
    classifications[IDENTITY].filter((value) => value === 'constraint_relaxation').length,
    3
  )
  assert.equal(
    classifications[HARDENING].every((value) => value === 'additive'),
    true
  )
  // The append-only trigger function is intentionally left for human review by the checker.
  assert.deepEqual(classifications[SETTLEMENT].filter((value) => value === 'ambiguous').length, 2)
})
