import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { addMoney, createMoney } from '../../../packages/contracts/src/money.ts'

import {
  CONNECTION_TIMEOUT_MS,
  LAUNCH_MIGRATION_NAME,
  REPAIR_MIGRATION_NAME,
  REQUIRED_LAUNCH_TABLES,
  REQUIRED_MONEY_COLUMNS,
  REQUIRED_POS_TABLES,
  REQUIRED_SCHEMA_COLUMNS,
  classifySqlStatement,
  createLedgerMarker,
  gateInventory,
  inventoryMigrations,
  parseRepairArguments,
  redactText,
  resolveRepairTarget,
  runRepair,
  splitSqlStatements,
  validatePreflight,
  verifyRestorableBackup,
  verifySchemaSnapshot,
  withBoundedRetry,
} from '../../../scripts/tus-migration-repair-lib.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const MIGRATIONS_ROOT = join(REPO_ROOT, 'apps', 'api', 'prisma', 'migrations')

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
  assert.equal(inventory.migrations.length, 30)
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

test('ledger marker is one forward-only completed repair row and required table inventory is stable', async () => {
  const marker = createLedgerMarker('checksum-redacted')
  assert.equal(marker.migration_name, REPAIR_MIGRATION_NAME)
  assert.equal(marker.finished_at, 'CURRENT_TIMESTAMP')
  assert.equal(marker.applied_steps_count, 1)
  assert.equal(REQUIRED_POS_TABLES.length, 15)

  const migration = await readFile(join(MIGRATIONS_ROOT, '20260831180000_tus_additive_migration_repair', 'migration.sql'), 'utf8')
  const gate = gateInventory({ statements: splitSqlStatements(migration) })
  assert.equal(gate.status, 'passed')
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|CASCADE|DELETE\s+FROM)\b/iu)
  for (const table of REQUIRED_POS_TABLES) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`, 'u'))
})

test('launch baseline covers the full marketplace database with exact money and no destructive SQL', async () => {
  const migration = await readFile(join(MIGRATIONS_ROOT, `${LAUNCH_MIGRATION_NAME}`, 'migration.sql'), 'utf8')
  const gate = gateInventory({ statements: splitSqlStatements(migration) })
  assert.equal(gate.status, 'passed')
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|CASCADE|DELETE\s+FROM)\b/iu)
  assert.match(migration, /BIGINT/u)
  assert.match(migration, /rateBps" INTEGER/u)
  for (const table of REQUIRED_LAUNCH_TABLES) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`, 'u'))
  for (const column of REQUIRED_MONEY_COLUMNS) assert.match(migration, new RegExp(`"${column}" BIGINT`, 'u'))
})

test('Prisma launch money fields use BigInt rather than Float', async () => {
  const schema = await readFile(join(REPO_ROOT, 'apps', 'api', 'prisma', 'schema.prisma'), 'utf8')
  assert.doesNotMatch(schema, /(?:amount|price|grossAmount|deductions|commissionableBase|commissionAmount|netAmount|providerAmount)\s+Float/u)
  assert.match(schema, /model Compromiso[\s\S]*?monto\s+BigInt/u)
  assert.match(schema, /model TusLedgerEntry[\s\S]*?amount\s+BigInt/u)
})

test('Money keeps currency explicit and adds only same-currency minor units', () => {
  const total = addMoney(createMoney('ARS', 1250n), createMoney('ARS', 750n))
  assert.deepEqual(total, { currency: 'ARS', minor: 2000n })
  assert.throws(() => addMoney(createMoney('ARS', 1n), createMoney('USD', 1n)), /currency/u)
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

test('safe additive path applies once, preserves the ledger, closes the pool, and defers POS runtime', async () => {
  await withTempRoot('DATABASE_URL=postgresql://user:secret@db.example.test/tus\n', async (rootDirectory) => {
    const calls = []
    const snapshot = {
      tables: Object.fromEntries([...REQUIRED_POS_TABLES, 'TusHardeningFixture'].map((table) => [table, {
        present: true,
        columns: REQUIRED_SCHEMA_COLUMNS[table] ?? ['id', 'tag', 'version', 'runId', 'tenantId', 'actorId', 'productListingId', 'serviceListingId', 'createdAt', 'updatedAt'],
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
