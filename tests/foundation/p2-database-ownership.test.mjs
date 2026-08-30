import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })

  return JSON.parse(output.trim())
}

test('P2.1 schema keeps PostgreSQL as the explicit owner of auth, tenancy, audit, search, aggregates, quotas, ledger, and outbox', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')

  for (const model of [
    'User',
    'Account',
    'Organization',
    'Workspace',
    'Membership',
    'AuditEvent',
    'SearchRecord',
    'AggregateSnapshot',
    'QuotaAccount',
    'QuotaReservation',
    'IdempotencyRecord',
    'OutboxEvent',
    'RunLedger',
  ]) {
    assert.match(schema, new RegExp(`^model ${model} \\{`, 'm'))
  }

  assert.match(schema, /datasource db \{[\s\S]*provider\s+=\s+"postgresql"/)
  assert.match(schema, /OutboxEvent[\s\S]*payload\s+Json/)
  assert.match(schema, /IdempotencyRecord[\s\S]*@@unique\(\[tenantId, key\]\)/)
  assert.match(schema, /QuotaReservation[\s\S]*@@unique\(\[quotaAccountId, idempotencyKey\]\)/)
  assert.match(schema, /RunLedger[\s\S]*@@unique\(\[tenantId, idempotencyKey\]\)/)
  assert.match(schema, /@@unique\(\[tenantId, entityType, entityId\]\)/)
})

test('P2.1 migration creates owned relational records with tenant-safe uniqueness and no distributed transaction primitive', () => {
  const migration = join(
    root,
    'apps/api/prisma/migrations/20260823140000_p2_database_ownership/migration.sql'
  )
  assert.equal(existsSync(migration), true)
  const sql = readFileSync(migration, 'utf8')

  for (const table of [
    'Organization',
    'Workspace',
    'Membership',
    'AuditEvent',
    'SearchRecord',
    'AggregateSnapshot',
    'QuotaAccount',
    'QuotaReservation',
    'IdempotencyRecord',
    'OutboxEvent',
    'RunLedger',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`))
  }

  assert.match(sql, /CREATE UNIQUE INDEX .*IdempotencyRecord_tenantId_key_key/)
  assert.match(sql, /CREATE UNIQUE INDEX .*RunLedger_tenantId_idempotencyKey_key/)
  assert.match(sql, /CREATE UNIQUE INDEX .*SearchRecord_tenantId_entityType_entityId_key/)
  assert.match(sql, /FOREIGN KEY \("workspaceId"\)/)
  assert.match(sql, /FOREIGN KEY \("quotaAccountId"\)/)
  assert.doesNotMatch(sql, /PREPARE TRANSACTION|COMMIT PREPARED/i)
})

test('P2.1 ownership recovery contracts identify PostgreSQL restore and outbox rebuild boundaries', () => {
  const result = runTypeScriptScenario(`
    const { ownershipFor, buildRecoveryPlan } = (await import('./apps/api/src/infrastructure/database/postgres/ownership.ts')).default
    console.log(JSON.stringify({
      identity: ownershipFor('identity'),
      tenancy: ownershipFor('tenancy'),
      mongoProjection: buildRecoveryPlan('mongo-projection'),
      vectorMetadata: buildRecoveryPlan('vector-metadata'),
    }))
  `)

  assert.equal(result.identity.sourceOfTruth, 'postgresql')
  assert.equal(result.tenancy.reconciliation, 'rebuild-from-postgres-outbox')
  assert.deepEqual(result.mongoProjection, {
    sourceOfTruth: 'postgresql',
    strategy: 'replay-outbox',
    target: 'mongo-projection',
  })
  assert.deepEqual(result.vectorMetadata, {
    sourceOfTruth: 'b2-lineage',
    strategy: 'rebuild-from-lineage',
    target: 'vector-metadata',
  })
})

test('P2.1 local ACID boundary commits one PostgreSQL transaction and rolls it back on failure', () => {
  const result = runTypeScriptScenario(`
    const { withPostgresTransaction } = (await import('./apps/api/src/infrastructure/database/postgres/ownership.ts')).default
    const events = []
    const client = {
      $transaction: async (operation) => {
        events.push('begin')
        try {
          const value = await operation({ query: async (sql, params) => ({ sql, params }) })
          events.push('commit')
          return value
        } catch (error) {
          events.push('rollback')
          throw error
        }
      },
    }
    const success = await withPostgresTransaction(client, async (transaction) => transaction.query('INSERT INTO "OutboxEvent" VALUES ($1)', ['event-a']))
    let failure
    try {
      await withPostgresTransaction(client, async () => { throw new Error('transaction-failed') })
    } catch (error) {
      failure = error.message
    }
    console.log(JSON.stringify({ success, failure, events }))
  `)

  assert.deepEqual(result.success, {
    sql: 'INSERT INTO "OutboxEvent" VALUES ($1)',
    params: ['event-a'],
  })
  assert.equal(result.failure, 'transaction-failed')
  assert.deepEqual(result.events, ['begin', 'commit', 'begin', 'rollback'])
})

test('P2.1 transaction boundary rejects fake two-phase commit and preserves one database owner', () => {
  const ownership = readFileSync(
    join(root, 'apps/api/src/infrastructure/database/postgres/ownership.ts'),
    'utf8'
  )
  const documentation = readFileSync(join(root, 'docs/data/ownership.md'), 'utf8')

  assert.match(ownership, /LOCAL_ACID_BOUNDARY/)
  assert.match(ownership, /DISTRIBUTED_2PC_PROHIBITED/)
  assert.doesNotMatch(ownership, /PREPARE TRANSACTION|COMMIT PREPARED/i)
  assert.match(documentation, /PostgreSQL\/Neon is the source of truth/i)
  assert.match(documentation, /2PC|two-phase commit/i)
  assert.match(documentation, /outbox/i)
  assert.match(documentation, /rebuild|restore/i)
})

test('P2.1 seed remains empty by default and only writes explicitly supplied safe ownership records', () => {
  const result = runTypeScriptScenario(`
    const { buildDatabaseSeed, seedDatabaseOwnership } = (await import('./apps/api/prisma/seed.ts')).default
    const calls = []
    const client = { ownershipRecord: { upsert: async (args) => calls.push(args) } }
    const first = buildDatabaseSeed()
    await seedDatabaseOwnership(client)
    await seedDatabaseOwnership(client, [{ dataClass: 'audit', owner: 'postgresql', rebuildStrategy: 'restore-backup' }])
    console.log(JSON.stringify({ first, calls }))
  `)

  assert.deepEqual(result.first, [])
  assert.equal(result.calls.length, 1)
  assert.deepEqual(result.calls[0].where, { dataClass: 'audit' })
  assert.deepEqual(result.calls[0].create, {
    dataClass: 'audit',
    owner: 'postgresql',
    rebuildStrategy: 'restore-backup',
  })
})
