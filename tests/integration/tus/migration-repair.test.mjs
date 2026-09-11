import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  addMoney,
  createMoney,
  deserializeMoney,
  exactMoneyJsonStringify,
  parseDecimalToMinor,
  serializeMoney,
} from '../../../packages/contracts/src/money.ts'

import {
  CONNECTION_TIMEOUT_MS,
  createDefaultBackupOperations,
  LAUNCH_MIGRATION_NAME,
  LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME,
  POS_INDEX_CONSTRAINT_REPAIR_NAME,
  REPAIR_MIGRATION_NAME,
  REQUIRED_CONFORMANCE_MONEY_COLUMNS,
  REQUIRED_CONFORMANCE_PRIMARY_KEYS,
  REQUIRED_LIVE_SCHEMA_TABLE_ENTRIES,
  REQUIRED_LAUNCH_TABLES,
  REQUIRED_MONEY_COLUMNS,
  REQUIRED_POS_TABLES,
  REQUIRED_POS_REPAIR_CONSTRAINTS,
  REQUIRED_POS_REPAIR_INDEXES,
  REQUIRED_LIVE_SCHEMA_REPAIR_INDEXES,
  REQUIRED_SCHEMA_COLUMNS,
  classifySqlStatement,
  createExactMoneyBackfillPlan,
  createLedgerMarker,
  gateInventory,
  inventoryMigrations,
  inspectBackupTooling,
  parseRepairArguments,
  redactText,
  resolveRepairTarget,
  runRepair,
  splitSqlStatements,
  validateConformancePreflight,
  validatePreflight,
  validateExactMoneySql,
  verifyRestorableBackup,
  verifyLiveSchemaSnapshot,
  verifySchemaSnapshot,
  withBoundedRetry,
} from '../../../scripts/tus-migration-repair-lib.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const MIGRATIONS_ROOT = join(REPO_ROOT, 'apps', 'api', 'prisma', 'migrations')
const POS_INDEX_CONSTRAINT_REPAIR_PATH = join(
  MIGRATIONS_ROOT,
  POS_INDEX_CONSTRAINT_REPAIR_NAME,
  'migration.sql',
)
const LIVE_SCHEMA_CONFORMANCE_REPAIR_PATH = join(
  MIGRATIONS_ROOT,
  LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME,
  'migration.sql',
)

async function withTempRoot(contents, callback) {
  const root = await mkdtemp(join(tmpdir(), 'tus-migration-repair-'))
  await writeFile(join(root, '.env'), contents, 'utf8')
  try {
    return await callback(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('inventory classifies the complete backlog and excludes comment-only destructive words', async () => {
  const inventory = await inventoryMigrations({ migrationsDirectory: MIGRATIONS_ROOT })

  assert.equal(inventory.pendingMigrations.length, 28)
  assert.equal(inventory.migrations.length, 32)
  assert.equal(inventory.destructiveStatementCount, 19)
  assert.deepEqual(inventory.destructiveTokens, ['CASCADE', 'DROP'])
  assert.equal(inventory.commentOnlyTokenCount > 0, true)
  assert.equal(inventory.migrations.some((migration) => migration.name === REPAIR_MIGRATION_NAME), true)
  assert.equal(inventory.migrations.some((migration) => migration.name === LAUNCH_MIGRATION_NAME), true)
  assert.equal(inventory.pendingMigrations.every((migration) => migration.historical === true), true)
  assert.equal(classifySqlStatement('-- DROP TABLE ignored\n'), 'comment-only')
})

test('static gate rejects unsafe inventory before any database operation', async () => {
  const calls = []
  const result = await runRepair({
    rootDirectory: REPO_ROOT,
    environment: { NODE_ENV: 'development' },
    confirmed: true,
    backupId: 'backup-redacted-handle',
    selectedMigrationSql: 'DROP TABLE "unsafe"',
    operations: {
      connect: async () => calls.push('connect'),
      backup: { assertRestorable: async () => calls.push('backup') },
    },
  })

  assert.equal(result.status, 'blocked')
  assert.equal(result.safetyGate, 'static-sql-gate')
  assert.equal(result.sideEffects.connections, 0)
  assert.equal(result.sideEffects.writes, 0)
  assert.deepEqual(calls, [])
})

test('SQL gate rejects untagged deletes and ambiguous ledger mutations while allowing comment-safe additive SQL', () => {
  assert.equal(gateInventory({ statements: ['DELETE FROM "TusPosAudit"'] }).status, 'rejected')
  assert.equal(gateInventory({ statements: ['UPDATE "_prisma_migrations" SET "checksum" = \'x\''] }).status, 'rejected')
  assert.equal(gateInventory({ statements: ['INSERT INTO "_prisma_migrations" ("id") VALUES (\'other\')'] }).status, 'rejected')
  assert.equal(gateInventory({ statements: ['-- DROP TABLE ignored\nCREATE TABLE IF NOT EXISTS "SafeTable" ("id" TEXT NOT NULL)'] }).status, 'passed')
})

test('target resolution reads only root DATABASE_URL and requires exact development confirmation', async () => {
  await withTempRoot('DATABASE_URL="postgresql://user:secret@db.example.test/tus"\n', async (rootDirectory) => {
    const unconfirmed = resolveRepairTarget({
      rootDirectory,
      environment: { NODE_ENV: 'development', TUS_POSTGRES_URL: 'postgresql://ambient:secret@wrong.test/db' },
      confirmed: false,
    })
    assert.equal(unconfirmed.status, 'blocked')
    assert.equal(unconfirmed.reason, 'explicit-development-confirmation-required')
    assert.doesNotMatch(JSON.stringify(unconfirmed), /secret|db\.example\.test/u)

    const confirmed = resolveRepairTarget({ rootDirectory, environment: { NODE_ENV: 'development' }, confirmed: true })
    assert.equal(confirmed.status, 'ready')
    assert.equal(confirmed.classification, 'remote-development-attested')
    assert.equal(confirmed.source, 'root-dotenv-DATABASE_URL')
    assert.doesNotMatch(JSON.stringify(confirmed), /secret|db\.example\.test/u)
  })
})

test('production, shared targets, and missing backup fail closed before connection', async () => {
  await withTempRoot('DATABASE_URL=postgresql://user:secret@shared.example.test/tus\n', async (rootDirectory) => {
    for (const environment of [{ NODE_ENV: 'production' }, { NODE_ENV: 'development' }]) {
      const calls = []
      const result = await runRepair({
        rootDirectory,
        environment,
        confirmed: true,
        operations: { connect: async () => calls.push('connect') },
      })
      assert.equal(result.status, 'blocked')
      assert.equal(result.sideEffects.connections, 0)
      assert.deepEqual(calls, [])
    }
  })
})

test('CLI accepts only apply, exact confirmation, and a backup handle', () => {
  assert.deepEqual(parseRepairArguments(['apply', '--confirm-development-target', '--backup-id', 'backup-1']), {
    intent: 'apply',
    confirmed: true,
    backupId: 'backup-1',
    invalidArguments: [],
  })
  assert.equal(parseRepairArguments(['apply', '--backup-id', 'backup-1']).confirmed, false)
  assert.equal(parseRepairArguments(['inspect']).intent, 'inspect')
  assert.equal(parseRepairArguments(['apply', '--database-url', 'secret']).invalidArguments.includes('--database-url'), true)
  assert.doesNotMatch(redactText('password=secret postgres://user:secret@host/db'), /secret|postgres:\/\//u)
})

test('bounded connection retry records exactly two 60-second attempts and never a third', async () => {
  let attempts = 0
  await assert.rejects(
    withBoundedRetry(async ({ attempt, timeoutMs }) => {
      attempts += 1
      assert.equal(attempt, attempts)
      assert.equal(timeoutMs, CONNECTION_TIMEOUT_MS)
      throw new Error('connection secret must not escape')
    }, { backoffMs: 0 }),
    (error) => error.attempts === 2 && error.diagnostics.length === 2,
  )
  assert.equal(attempts, 2)
})

test('preflight rejects shape, data, orphan, and unsafe ledger states', () => {
  const result = validatePreflight({
    tables: { TusPosOperation: { columns: ['id'] } },
    rowCounts: { TusPosOperation: 4 },
    orphans: 1,
    ledger: { present: true, rows: [{ migrationName: 'historical' }], repairMarkerCount: 2 },
  })
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'preflight-mismatch')
  assert.equal(result.writesAllowed, false)
})

test('preflight allows absent current monetary columns so the additive schema can create them', () => {
  const absentTables = Object.fromEntries([...REQUIRED_POS_TABLES].map((table) => [table, {
    present: false,
    columns: [],
    types: {},
  }]))

  const result = validatePreflight({ tables: absentTables, ledger: { repairMarkerCount: 0 } })

  assert.equal(result.status, 'ready')
  assert.equal(result.writesAllowed, true)
  assert.equal(result.reason, 'preflight-passed')
})

test('preflight blocks an existing monetary column with an incompatible type', () => {
  const result = validatePreflight({
    tables: {
      TusPosOperation: {
        present: true,
        columns: ['amount'],
        types: { amount: 'numeric' },
      },
    },
  })

  assert.equal(result.status, 'blocked')
  assert.equal(result.writesAllowed, false)
  assert.equal(result.reason, 'exact-money-type-mismatch')
})

test('ledger marker is one forward-only completed repair row and required table inventory is stable', async () => {
  const marker = createLedgerMarker('checksum-redacted')
  assert.equal(marker.migration_name, REPAIR_MIGRATION_NAME)
  assert.equal(marker.finished_at, 'CURRENT_TIMESTAMP')
  assert.equal(marker.applied_steps_count, 1)
  assert.equal(REQUIRED_POS_TABLES.length, 15)

  const migration = await readFile(join(MIGRATIONS_ROOT, '20260831180000_tus_additive_migration_repair', 'migration.sql'), 'utf8')
  const gate = gateInventory({ statements: splitSqlStatements(migration) })
  assert.equal(gate.status, 'passed')
  assert.equal(validateExactMoneySql(migration).status, 'passed')
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|CASCADE|DELETE\s+FROM)\b/iu)
  assert.doesNotMatch(migration, /"amount"\s+DOUBLE\s+PRECISION/iu)
  for (const table of REQUIRED_POS_TABLES) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`, 'u'))
})

test('launch baseline covers the full marketplace database with exact money and no destructive SQL', async () => {
  const migration = await readFile(join(MIGRATIONS_ROOT, `${LAUNCH_MIGRATION_NAME}`, 'migration.sql'), 'utf8')
  const gate = gateInventory({ statements: splitSqlStatements(migration) })
  const exactMoneyGate = validateExactMoneySql(migration)
  assert.equal(gate.status, 'passed')
  assert.equal(exactMoneyGate.status, 'passed')
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|CASCADE|DELETE\s+FROM)\b/iu)
  assert.match(migration, /BIGINT/u)
  assert.match(migration, /rateBps" INTEGER/u)
  for (const table of REQUIRED_LAUNCH_TABLES) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`, 'u'))
  for (const column of REQUIRED_MONEY_COLUMNS) assert.match(migration, new RegExp(`"${column}" BIGINT`, 'u'))
})

test('currency checks skip reconciliation records without a currency column while preserving safety gates', async () => {
  const migration = await readFile(join(MIGRATIONS_ROOT, `${LAUNCH_MIGRATION_NAME}`, 'migration.sql'), 'utf8')
  const currencyCheck = migration.match(/DO \$\$[\s\S]*?END \$\$/u)?.[0]
  const reconciliationTable = migration.match(/CREATE TABLE IF NOT EXISTS "TusReconciliationRecord" \([\s\S]*?\);/u)?.[0]

  assert.ok(currencyCheck)
  assert.ok(reconciliationTable)
  assert.doesNotMatch(currencyCheck, /'TusReconciliationRecord'/u)
  assert.doesNotMatch(reconciliationTable, /"currency"/u)
  assert.match(reconciliationTable, /"providerAmount" BIGINT/u)
  assert.equal(gateInventory({ statements: splitSqlStatements(migration) }).status, 'passed')
  assert.equal(validateExactMoneySql(migration).status, 'passed')
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|CASCADE|DELETE\s+FROM)\b/iu)
})

test('Prisma launch money fields use BigInt rather than Float', async () => {
  const schema = await readFile(join(REPO_ROOT, 'apps', 'api', 'prisma', 'schema.prisma'), 'utf8')
  assert.doesNotMatch(schema, /(?:amount|price|grossAmount|deductions|commissionableBase|commissionAmount|netAmount|providerAmount)\s+Float/u)
  assert.match(schema, /model TusCommitment[\s\S]*?amount\s+BigInt/u)
  assert.match(schema, /model TusLedgerEntry[\s\S]*?amount\s+BigInt/u)
})

test('Money keeps currency explicit and adds only same-currency minor units', () => {
  const total = addMoney(createMoney('ARS', 1250n), createMoney('ARS', 750n))
  assert.deepEqual(total, { currency: 'ARS', minor: 2000n })
  assert.throws(() => addMoney(createMoney('ARS', 1n), createMoney('USD', 1n)), /currency/u)
})

test('Money JSON uses decimal strings and never leaks bigint serialization errors', () => {
  const money = createMoney('ARS', 1250n)
  assert.deepEqual(serializeMoney(money), { currency: 'ARS', minor: '1250' })
  assert.deepEqual(deserializeMoney({ currency: 'ARS', minor: '1250' }), money)
  assert.equal(exactMoneyJsonStringify({ amount: 1250n }), '{"amount":"1250"}')
  assert.throws(() => deserializeMoney({ currency: 'ARS', minor: '12.50' }), /integer string/u)
  assert.throws(() => parseDecimalToMinor('XXX', '1.00'), /currency scale/u)
})

test('exact-money conversion is decimal-only and backfill remains explicitly gated', () => {
  assert.equal(parseDecimalToMinor('ARS', '12.345', { scale: 2, rounding: 'half-up' }), 1235n)
  assert.throws(() => parseDecimalToMinor('ARS', '12.345', { scale: 2, rounding: 'reject' }), /fraction/u)

  const blocked = createExactMoneyBackfillPlan({
    table: 'TusListing',
    sourceColumn: 'price',
    targetColumn: 'priceMinor',
    currencyColumn: 'currency',
    approved: false,
  })
  assert.deepEqual(blocked, { status: 'blocked', reason: 'exact-money-backfill-approval-required' })

  const approved = createExactMoneyBackfillPlan({
    table: 'TusListing',
    sourceColumn: 'price',
    targetColumn: 'priceMinor',
    currencyColumn: 'currency',
    approved: true,
    approvalId: 'money-policy-ars-v1',
  })
  assert.equal(approved.status, 'ready')
  assert.match(approved.sql, /ADD COLUMN IF NOT EXISTS "priceMinor" BIGINT/u)
  assert.match(approved.sql, /exact-money-backfill-fractional-or-overflow/u)
  assert.match(approved.sql, /exact-money-backfill-unknown-currency/u)
  assert.match(approved.sql, /WHERE "priceMinor" IS NULL/u)
  assert.doesNotMatch(approved.sql, /\b(?:DROP|TRUNCATE|CASCADE|DELETE\s+FROM)\b/iu)
  assert.equal(approved.requiresBackupRestore, true)
  assert.equal(approved.approvalId, 'money-policy-ars-v1')
})

test('backup verification requires a restorable artifact and verifies restore before DDL', async () => {
  const calls = []
  const result = await verifyRestorableBackup({
    backupId: 'backup-operator-handle',
    operations: {
      assertRestorable: async (id) => calls.push(`assert:${id}`),
      restoreToScratch: async () => calls.push('restore'),
      verifyRestore: async () => calls.push('verify'),
    },
  })
  assert.equal(result.status, 'passed')
  assert.deepEqual(calls, ['assert:backup-operator-handle', 'restore', 'verify'])
  await assert.rejects(() => verifyRestorableBackup({ backupId: 'backup-operator-handle', operations: {} }), /backup verification unavailable/u)
})

test('backup tooling is an explicit pre-connection gate and never falls back to a fake dump', async () => {
  const tooling = inspectBackupTooling()
  assert.deepEqual(Object.keys(tooling).sort(), ['pgDump', 'pgRestore'])
  assert.equal(typeof tooling.pgDump, 'string')
  assert.equal(typeof tooling.pgRestore, 'string')

  await withTempRoot('DATABASE_URL=postgresql://user:secret@db.example.test/tus\n', async (rootDirectory) => {
    const calls = []
    const result = await runRepair({
      rootDirectory,
      environment: { NODE_ENV: 'development' },
      confirmed: true,
      backupId: 'backup-operator-handle',
      operations: {
        backup: { assertRestorable: async () => { throw new Error('backup-tooling-unavailable') } },
        connect: async () => calls.push('connect'),
      },
    })
    assert.equal(result.status, 'blocked')
    assert.equal(result.safetyGate, 'backup-gate')
    assert.equal(result.reason, 'backup-tooling-unavailable')
    assert.equal(result.sideEffects.connections, 0)
    assert.deepEqual(calls, [])
  })
})

test('default backup gate requires isolated restore verification after pg_restore list', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'tus-backup-gate-'))
  const backupPath = join(rootDirectory, 'backup.dump')
  const calls = []
  try {
    await writeFile(backupPath, 'custom-format-placeholder', 'utf8')
    const operations = createDefaultBackupOperations({
      pgRestorePath: 'pg_restore.exe',
      spawn: (executable, argumentsList, options) => {
        calls.push({ executable, argumentsList, options })
        return { status: 0 }
      },
    })

    await assert.rejects(
      () => verifyRestorableBackup({ backupId: backupPath, operations }),
      /backup-restore-verification-required/u,
    )
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].argumentsList, ['--format=custom', '--list', backupPath])
    assert.equal(calls[0].options.stdio, 'ignore')
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
})

test('safe additive path applies once, preserves the ledger, closes the pool, and defers POS runtime', async () => {
  await withTempRoot('DATABASE_URL=postgresql://user:secret@db.example.test/tus\n', async (rootDirectory) => {
    const calls = []
    const snapshot = {
      tables: Object.fromEntries([...REQUIRED_POS_TABLES, 'TusHardeningFixture'].map((table) => [table, {
        present: true,
        columns: REQUIRED_SCHEMA_COLUMNS[table] ?? ['id', 'tag', 'version', 'runId', 'tenantId', 'actorId', 'productListingId', 'serviceListingId', 'createdAt', 'updatedAt'],
        types: table === 'TusPosOperation' || table === 'TusPosReceipt' ? { amount: 'int8' } : {},
        primaryKey: true,
        requiredIndexes: true,
        requiredConstraints: true,
      }])),
      rowCounts: Object.fromEntries(REQUIRED_POS_TABLES.map((table) => [table, 0])),
      orphans: 0,
      ledger: { present: true, repairMarkerCount: 1 },
    }
    const result = await runRepair({
      rootDirectory,
      environment: { NODE_ENV: 'development' },
      confirmed: true,
      backupId: 'backup-operator-handle',
      operations: {
        backup: { assertRestorable: async (id) => calls.push(`backup:${id}`), verifyRestore: async () => calls.push('verify-backup') },
        connect: async (_url, timeoutMs, attempt) => {
          calls.push(`connect:${timeoutMs}:${attempt}`)
          return { query: async () => ({ rows: [] }) }
        },
        inspect: async () => snapshot,
        applyBaseline: async (_pool, sql) => calls.push(`apply:${sql.includes(LAUNCH_MIGRATION_NAME)}`),
        recordLedger: async (_pool, marker) => calls.push(`ledger:${marker.migration_name}`),
        verifySchema: async () => ({ status: 'passed', requiredTableCount: 15, presentTableCount: 15, repairMarkerCount: 1 }),
        verifyDurablePos: async () => ({ status: 'external-blocked', providerCalls: 0, reason: 'runtime-harness-prohibited-in-this-phase' }),
        close: async () => calls.push('close'),
      },
    })

    assert.equal(result.status, 'partial')
    assert.equal(result.sideEffects.connections, 1)
    assert.equal(result.sideEffects.writes, 1)
    assert.equal(result.migrationResult.appliedCount, 1)
    assert.equal(result.posVerification.providerCalls, 0)
    assert.equal(verifySchemaSnapshot(snapshot).status, 'passed')
    assert.equal(result.cleanupState, 'verified')
    assert.deepEqual(calls, ['backup:backup-operator-handle', 'verify-backup', 'connect:60000:1', `apply:true`, `ledger:${LAUNCH_MIGRATION_NAME}`, 'close'])
  })
})

test('POS index and constraint repair declares the exact missing additive objects', async () => {
  const migration = await readFile(POS_INDEX_CONSTRAINT_REPAIR_PATH, 'utf8')
  const normalizedMigration = migration.replace(/\s+/gu, ' ')
  assert.equal(gateInventory({ statements: splitSqlStatements(migration) }).status, 'passed')
  const expectedIndexes = [
    ['TusDeliveryZone_tenantId_active_idx', 'TusDeliveryZone', 'tenantId', 'active', false],
    ['TusDeliveryShift_tenantId_zoneId_status_idx', 'TusDeliveryShift', 'tenantId', 'zoneId', 'status', false],
    ['TusDeliveryTask_tenantId_commitmentId_idx', 'TusDeliveryTask', 'tenantId', 'commitmentId', false],
    ['TusDeliveryTask_tenantId_shiftId_status_idx', 'TusDeliveryTask', 'tenantId', 'shiftId', 'status', false],
    ['TusDeliveryTask_tenantId_commitmentId_status_idx', 'TusDeliveryTask', 'tenantId', 'commitmentId', 'status', false],
    ['TusDeliveryProof_tenantId_taskId_idx', 'TusDeliveryProof', 'tenantId', 'taskId', false],
    ['TusDeliveryIncident_tenantId_taskId_status_idx', 'TusDeliveryIncident', 'tenantId', 'taskId', 'status', false],
    ['TusDeliveryAudit_tenantId_auditId_key', 'TusDeliveryAudit', 'tenantId', 'auditId', true],
    ['TusDeliveryAudit_tenantId_createdAt_idx', 'TusDeliveryAudit', 'tenantId', 'createdAt', false],
    ['TusPosOperation_tenantId_shiftId_createdAt_idx', 'TusPosOperation', 'tenantId', 'shiftId', 'createdAt', false],
    ['TusPosOperation_tenantId_context_kind_idx', 'TusPosOperation', 'tenantId', 'context', 'kind', false],
    ['TusPosReceipt_tenantId_operationId_idx', 'TusPosReceipt', 'tenantId', 'operationId', false],
    ['TusPosReceipt_tenantId_operationId_createdAt_idx', 'TusPosReceipt', 'tenantId', 'operationId', 'createdAt', false],
    ['TusPosDevice_tenantId_status_idx', 'TusPosDevice', 'tenantId', 'status', false],
    ['TusPosSession_tenantId_deviceId_shiftId_status_idx', 'TusPosSession', 'tenantId', 'deviceId', 'shiftId', 'status', false],
    ['TusPosConflict_tenantId_operationId_status_idx', 'TusPosConflict', 'tenantId', 'operationId', 'status', false],
    ['TusPosConflict_tenantId_status_createdAt_idx', 'TusPosConflict', 'tenantId', 'status', 'createdAt', false],
    ['TusPosVersion_tenantId_shiftId_version_idx', 'TusPosVersion', 'tenantId', 'shiftId', 'version', false],
    ['TusDeliveryOutbox_tenantId_status_createdAt_idx', 'TusDeliveryOutbox', 'tenantId', 'status', 'createdAt', false],
    ['TusPosOutbox_tenantId_status_createdAt_idx', 'TusPosOutbox', 'tenantId', 'status', 'createdAt', false],
    ['TusPosOutbox_tenantId_aggregateId_status_idx', 'TusPosOutbox', 'tenantId', 'aggregateId', 'status', false],
    ['TusPosAudit_tenantId_operationId_createdAt_idx', 'TusPosAudit', 'tenantId', 'operationId', 'createdAt', false],
  ]

  for (const [name, table, ...columnsWithUniqueness] of expectedIndexes) {
    const unique = columnsWithUniqueness.pop()
    const columns = columnsWithUniqueness.map((column) => `"${column}"`).join(', ')
    const createPrefix = unique ? 'CREATE UNIQUE INDEX IF NOT EXISTS' : 'CREATE INDEX IF NOT EXISTS'
    assert.match(migration, new RegExp(`${createPrefix} "${name}"[\\s\\S]*?ON "${table}"[\\s\\S]*?\\(${columns}\\)`, 'u'))
  }

  const expectedConstraints = [
    ['TusPosConflict_tenant_operation_fk', 'FOREIGN KEY ("tenantId", "operationId") REFERENCES "TusPosOperation" ("tenantId", "operationId")'],
    ['TusPosOperation_amount_non_negative_check', 'CHECK ("amount" >= 0)'],
    ['TusPosVersion_version_non_negative_check', 'CHECK ("version" >= 0)'],
  ]
  for (const [name, definition] of expectedConstraints) {
    assert.match(normalizedMigration, new RegExp(`IF NOT EXISTS[\\s\\S]*?ADD CONSTRAINT "${name}"`, 'u'))
    assert.ok(normalizedMigration.includes(definition))
  }

  assert.match(migration, /INSERT INTO "_prisma_migrations"[\s\S]*?20260911120000_tus_pos_index_constraint_repair/u)
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|CASCADE|DELETE\s+FROM)\b/iu)
})

test('POS index and constraint repair requires the launch marker and never replays the baseline', async () => {
  await withTempRoot('DATABASE_URL=postgresql://user:secret@db.example.test/tus\n', async (rootDirectory) => {
    const calls = []
    const result = await runRepair({
      repairUnit: 'pos-index-constraint',
      rootDirectory,
      environment: { NODE_ENV: 'development' },
      confirmed: true,
      backupId: 'backup-operator-handle',
      operations: {
        backup: { assertRestorable: async () => calls.push('backup'), verifyRestore: async () => calls.push('verify-backup') },
        connect: async (_url, timeoutMs, attempt) => {
          calls.push(`connect:${timeoutMs}:${attempt}`)
          return { query: async () => ({ rows: [] }) }
        },
        inspect: async () => ({
          tables: {},
          ledger: { launchMarkerCount: 1, posIndexConstraintRepairMarkerCount: 0 },
          orphans: 0,
        }),
        applyBaseline: async (_pool, sql) => calls.push(`apply:${sql.includes(POS_INDEX_CONSTRAINT_REPAIR_NAME)}`),
        verifySchema: async () => ({ status: 'passed', requiredTableCount: 15, presentTableCount: 15, repairMarkerCount: 1 }),
        verifyDurablePos: async () => ({ status: 'external-blocked', providerCalls: 0, reason: 'runtime-harness-prohibited-in-this-phase' }),
        close: async () => calls.push('close'),
      },
    })

    assert.equal(result.status, 'partial')
    assert.equal(result.migrationResult.marker, POS_INDEX_CONSTRAINT_REPAIR_NAME)
    assert.deepEqual(calls, ['backup', 'verify-backup', 'connect:60000:1', 'apply:true', 'close'])
  })
})

test('metadata verification rejects wrong repair index columns, uniqueness, and constraint definitions', () => {
  const result = verifySchemaSnapshot({
    tables: {},
    indexes: [{
      table: REQUIRED_POS_REPAIR_INDEXES[0].table,
      name: REQUIRED_POS_REPAIR_INDEXES[0].name,
      columns: ['active', 'tenantId'],
      unique: true,
    }],
    constraints: [{
      table: REQUIRED_POS_REPAIR_CONSTRAINTS[0].table,
      name: REQUIRED_POS_REPAIR_CONSTRAINTS[0].name,
      type: 'f',
      definition: 'FOREIGN KEY ("tenantId", "operationId") REFERENCES "WrongTable" ("tenantId", "operationId") NOT VALID',
    }],
    ledger: { repairMarkerCount: 1 },
  })

  assert.equal(result.status, 'blocked')
  assert.ok(result.missingIndexes.includes(REQUIRED_POS_REPAIR_INDEXES[0].name))
  assert.ok(result.missingConstraints.includes(REQUIRED_POS_REPAIR_CONSTRAINTS[0].name))
})

test('metadata verification accepts PostgreSQL redundant outer parentheses in equivalent checks', () => {
  const result = verifySchemaSnapshot({
    tables: {},
    indexes: [],
    constraints: [
      {
        table: 'TusPosConflict',
        name: 'TusPosConflict_tenant_operation_fk',
        type: 'f',
        definition: 'FOREIGN KEY ("tenantId", "operationId") REFERENCES "TusPosOperation"("tenantId", "operationId") NOT VALID',
      },
      {
        table: 'TusPosOperation',
        name: 'TusPosOperation_amount_non_negative_check',
        type: 'c',
        definition: 'CHECK ( amount >= 0 )',
      },
      {
        table: 'TusPosVersion',
        name: 'TusPosVersion_version_non_negative_check',
        type: 'c',
        definition: 'CHECK (( version >= 0 ))',
      },
    ],
    ledger: { repairMarkerCount: 1 },
  })

  assert.deepEqual(result.missingConstraints, [])
})

test('metadata verification rejects materially different check predicates after normalization', () => {
  const result = verifySchemaSnapshot({
    tables: {},
    indexes: [],
    constraints: [{
      table: 'TusPosOperation',
      name: 'TusPosOperation_amount_non_negative_check',
      type: 'c',
      definition: 'CHECK ((amount > 0))',
    }],
    ledger: { repairMarkerCount: 1 },
  })

  assert.ok(result.missingConstraints.includes('TusPosOperation_amount_non_negative_check'))
})

function completeConformanceSnapshot(overrides = {}) {
  const tableNames = [...new Set(REQUIRED_LIVE_SCHEMA_TABLE_ENTRIES)]
  const billingTables = REQUIRED_CONFORMANCE_PRIMARY_KEYS.map((contract) => contract.table)
  const moneyTables = Object.keys(Object.fromEntries(REQUIRED_CONFORMANCE_MONEY_COLUMNS.map(({ table }) => [table, true])))
  const tables = Object.fromEntries([...new Set([...tableNames, ...billingTables, ...moneyTables])].map((table) => [table, {
    present: true,
    columns: ['id', ...REQUIRED_CONFORMANCE_MONEY_COLUMNS.filter((column) => column.table === table).map((column) => column.column)],
    types: Object.fromEntries(REQUIRED_CONFORMANCE_MONEY_COLUMNS.filter((column) => column.table === table).map((column) => [column.column, 'int8'])),
    columnShapes: {
      id: { udtName: 'text', nullable: false, defaultValue: null },
      ...Object.fromEntries(REQUIRED_CONFORMANCE_MONEY_COLUMNS.filter((column) => column.table === table).map((column) => [column.column, { udtName: 'int8', nullable: false, defaultValue: null }])),
    },
    primaryKey: true,
  }]))

  return {
    tables,
    rowCounts: Object.fromEntries(REQUIRED_CONFORMANCE_PRIMARY_KEYS.map(({ table }) => [table, 0])),
    idAggregates: Object.fromEntries(REQUIRED_CONFORMANCE_PRIMARY_KEYS.map(({ table }) => [table, { rowCount: 0, nullCount: 0, duplicateCount: 0 }])),
    primaryKeys: Object.fromEntries(REQUIRED_CONFORMANCE_PRIMARY_KEYS.map(({ table }) => [table, ['id']])),
    indexes: REQUIRED_LIVE_SCHEMA_REPAIR_INDEXES.map((index) => ({ ...index, predicate: null })),
    constraints: REQUIRED_POS_REPAIR_CONSTRAINTS,
    ledger: {
      markerCounts: {
        [LAUNCH_MIGRATION_NAME]: 1,
        [POS_INDEX_CONSTRAINT_REPAIR_NAME]: 1,
        [LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME]: 1,
        [REPAIR_MIGRATION_NAME]: 0,
      },
      launchMarkerCount: 1,
      posIndexConstraintRepairMarkerCount: 1,
      liveSchemaConformanceRepairMarkerCount: 1,
      historicalAdditiveRepairMarkerCount: 0,
    },
    rowValuesRead: 0,
    ...overrides,
  }
}

test('live conformance SQL is exact, additive, guarded, and never reconstructs historical lineage', async () => {
  const migration = await readFile(LIVE_SCHEMA_CONFORMANCE_REPAIR_PATH, 'utf8')
  const statements = splitSqlStatements(migration)
  const gate = gateInventory({ statements })

  assert.equal(gate.status, 'passed')
  assert.equal(validateExactMoneySql(migration).status, 'passed')
  assert.equal((migration.match(/ADD COLUMN "amountMinor" BIGINT NOT NULL/gu) ?? []).length, 3)
  assert.equal((migration.match(/_pkey'/gu) ?? []).length, 10)
  assert.doesNotMatch(migration, /DEFAULT\s+0|UPDATE\s+|\b(?:DROP|TRUNCATE|CASCADE|DELETE\s+FROM)\b/iu)
  assert.doesNotMatch(migration, new RegExp(REPAIR_MIGRATION_NAME, 'u'))
  assert.match(migration, new RegExp(LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME, 'u'))

  for (const index of REQUIRED_LIVE_SCHEMA_REPAIR_INDEXES.filter(({ legacyAlias }) => legacyAlias)) {
    assert.match(migration, new RegExp(index.legacyAlias, 'u'))
    assert.match(migration, new RegExp(`'${index.name}', '${index.table}', ARRAY\\[${index.columns.map((column) => `'${column}'`).join(', ')}\\]`, 'u'))
  }
})

test('live conformance contracts are source-derived with exact counts and ordered aliases', () => {
  assert.equal(REQUIRED_LIVE_SCHEMA_TABLE_ENTRIES.length, 62)
  assert.equal(new Set(REQUIRED_LIVE_SCHEMA_TABLE_ENTRIES).size, 58)
  assert.equal(REQUIRED_CONFORMANCE_MONEY_COLUMNS.length, 26)
  assert.equal(REQUIRED_CONFORMANCE_PRIMARY_KEYS.length, 68)
  assert.equal(REQUIRED_LIVE_SCHEMA_REPAIR_INDEXES.length, 22)
  assert.equal(REQUIRED_LIVE_SCHEMA_REPAIR_INDEXES.filter(({ legacyAlias }) => legacyAlias).length, 14)
  assert.deepEqual(
    REQUIRED_LIVE_SCHEMA_REPAIR_INDEXES.filter(({ legacyAlias }) => legacyAlias).map(({ legacyAlias }) => legacyAlias),
    Array.from({ length: 14 }, (_, index) => `tus_lscr_legacy_${String(index + 1).padStart(2, '0')}`),
  )
  assert.deepEqual(REQUIRED_CONFORMANCE_MONEY_COLUMNS.filter(({ table }) => table.startsWith('TusBilling') || table === 'TusSubscriptionPlan'), [
    { table: 'TusSubscriptionPlan', column: 'amountMinor', udtName: 'int8', nullable: false, defaultValue: null },
    { table: 'TusBillingRefund', column: 'amountMinor', udtName: 'int8', nullable: false, defaultValue: null },
    { table: 'TusBillingLedger', column: 'amountMinor', udtName: 'int8', nullable: false, defaultValue: null },
  ])
})

test('conformance preflight fails closed for every unsafe aggregate, catalog, alias, and marker gate', () => {
  const cases = [
    ['non-empty money table', { rowCounts: { TusSubscriptionPlan: 1 } }],
    ['null id aggregate', { idAggregates: { TusBillingAccount: { rowCount: 1, nullCount: 1, duplicateCount: 0 } } }],
    ['duplicate id aggregate', { idAggregates: { TusBillingAccount: { rowCount: 2, nullCount: 0, duplicateCount: 1 } } }],
    ['incompatible id metadata', { tables: { TusBillingAccount: { present: true, columns: ['id'], columnShapes: { id: { udtName: 'varchar', nullable: false, defaultValue: null } }, primaryKey: false } } }],
    ['incompatible existing primary key', { primaryKeys: { TusBillingAccount: ['tenantId'] } }],
    ['occupied alias', { indexes: [{ name: 'tus_lscr_legacy_01', table: 'OtherTable', columns: ['id'], unique: false, predicate: null }] }],
    ['missing launch marker', { ledger: { launchMarkerCount: 0, posIndexConstraintRepairMarkerCount: 1, liveSchemaConformanceRepairMarkerCount: 0, historicalAdditiveRepairMarkerCount: 0, markerCounts: {} } }],
    ['historical marker present', { ledger: { launchMarkerCount: 1, posIndexConstraintRepairMarkerCount: 1, liveSchemaConformanceRepairMarkerCount: 0, historicalAdditiveRepairMarkerCount: 1, markerCounts: {} } }],
  ]

  for (const [label, overrides] of cases) {
    const result = validateConformancePreflight(completeConformanceSnapshot(overrides))
    assert.equal(result.status, 'blocked', label)
    assert.equal(result.writesAllowed, false, label)
  }
})

test('unsafe conformance preflight refuses connection-side writes and preserves zero side effects', async () => {
  await withTempRoot('DATABASE_URL=postgresql://user:secret@db.example.test/tus\n', async (rootDirectory) => {
    const calls = []
    const result = await runRepair({
      repairUnit: 'live-schema-conformance',
      rootDirectory,
      environment: { NODE_ENV: 'development' },
      confirmed: true,
      backupId: 'backup-operator-handle',
      operations: {
        backup: { assertRestorable: async () => calls.push('backup'), verifyRestore: async () => calls.push('verify-backup') },
        connect: async () => { calls.push('connect'); return {} },
        inspect: async () => completeConformanceSnapshot({ rowCounts: { TusSubscriptionPlan: 1 } }),
        applyBaseline: async () => calls.push('apply'),
        close: async () => calls.push('close'),
      },
    })

    assert.equal(result.status, 'blocked')
    assert.equal(result.safetyGate, 'preflight-gate')
    assert.equal(result.sideEffects.writes, 0)
    assert.equal(result.sideEffects.migrationInvocations, 0)
    assert.deepEqual(calls, ['backup', 'verify-backup', 'connect', 'close'])
  })
})

test('accepted metadata receipt proves exact live conformance and keeps rowValuesRead at zero', () => {
  const receipt = verifyLiveSchemaSnapshot(completeConformanceSnapshot())

  assert.equal(receipt.status, 'passed')
  assert.equal(receipt.tableCheck.expected, 62)
  assert.equal(receipt.moneyCheck.expected, 26)
  assert.equal(receipt.primaryKeyCheck.expected, 68)
  assert.equal(receipt.indexCheck.expected, 22)
  assert.equal(receipt.constraintCheck.expected, 3)
  assert.deepEqual(receipt.markerLineage, {
    launch: 1,
    pos: 1,
    conformance: 1,
    historicalAdditiveRepair: 0,
  })
  assert.equal(receipt.rowValuesRead, 0)
  assert.equal(receipt.liveConformance, true)
  assert.equal(receipt.noGo, false)
  assert.equal(receipt.runtimeActivity.seedInvocations, 0)
  assert.equal(receipt.runtimeActivity.providerCalls, 0)
  assert.equal(receipt.runtimeActivity.posInvocations, 0)
})

test('accepted conformance repair is idempotent when marker and exact catalog already exist', async () => {
  await withTempRoot('DATABASE_URL=postgresql://user:secret@db.example.test/tus\n', async (rootDirectory) => {
    const calls = []
    const result = await runRepair({
      repairUnit: 'live-schema-conformance',
      rootDirectory,
      environment: { NODE_ENV: 'development' },
      confirmed: true,
      backupId: 'backup-operator-handle',
      operations: {
        backup: { assertRestorable: async () => calls.push('backup'), verifyRestore: async () => calls.push('verify-backup') },
        connect: async () => { calls.push('connect'); return {} },
        inspect: async () => completeConformanceSnapshot(),
        applyBaseline: async () => calls.push('apply'),
        verifySchema: async () => verifyLiveSchemaSnapshot(completeConformanceSnapshot()),
        close: async () => calls.push('close'),
      },
    })

    assert.equal(result.status, 'success')
    assert.equal(result.migrationResult.appliedCount, 0)
    assert.equal(result.migrationResult.idempotent, true)
    assert.equal(result.sideEffects.writes, 0)
    assert.deepEqual(calls, ['backup', 'verify-backup', 'connect', 'close'])
  })
})
