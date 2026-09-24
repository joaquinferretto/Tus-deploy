import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  REVIEWED_MIGRATION_STATEMENTS,
  classifySqlStatement,
  classifyStatementInContext,
  createMigrationContext,
  gateInventory,
  reviewMigrationChain,
} from '../../scripts/tus-migration-repair-lib.mjs'

const root = join(import.meta.dirname, '..', '..')
const MIGRATIONS = join(root, 'apps/api/prisma/migrations')
const WEB_08_09_CHAIN = [
  '20260917100000_tus_work_budget',
  '20260923100000_tus_service_finance_identity',
  '20260923110000_tus_service_payment_intents',
  '20260923120000_tus_service_settlement_reconciliation',
  '20260924100000_tus_finance_subject_hardening',
]
const GUARD_FUNCTION = `CREATE OR REPLACE FUNCTION public.tus_guard_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fixture is append-only';
END;
$$;`
const GUARD_TRIGGER = `CREATE TRIGGER tus_guard_fixture_trigger
  BEFORE UPDATE OR DELETE ON public."fixture"
  FOR EACH ROW EXECUTE FUNCTION public.tus_guard_fixture();`

async function withMigrations(migrations, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'db-09-gate-'))
  try {
    for (const [name, sql] of Object.entries(migrations)) {
      await mkdir(join(directory, name), { recursive: true })
      await writeFile(join(directory, name, 'migration.sql'), sql, 'utf8')
    }
    return await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('DB-09-GATE accepts the WEB-08/WEB-09 chain only through explicit reasons', async () => {
  const review = await reviewMigrationChain({ names: WEB_08_09_CHAIN })
  assert.equal(review.accepted, true)
  assert.deepEqual(review.missing, [])
  const byName = Object.fromEntries(review.reviews.map((item) => [item.name, item]))
  const settlement = byName['20260923120000_tus_service_settlement_reconciliation'].statements
  assert.deepEqual(
    settlement.filter((statement) => statement.classification === 'append_only_guard').length,
    2
  )
  const workBudget = byName['20260917100000_tus_work_budget'].statements.filter(
    (statement) => statement.reviewed
  )
  assert.deepEqual(workBudget.map((statement) => statement.classification).sort(), [
    'ambiguous',
    'destructive',
    'high_risk',
  ])
  assert.equal(
    REVIEWED_MIGRATION_STATEMENTS.every(
      (entry) =>
        entry.migration === '20260917100000_tus_work_budget' &&
        /^[a-f0-9]{64}$/u.test(entry.sha256) &&
        entry.reason.length > 40
    ),
    true
  )
  assert.equal(
    byName['20260923100000_tus_service_finance_identity'].statements.filter(
      (statement) => statement.classification === 'constraint_relaxation'
    ).length,
    3
  )
})

test('DB-09-GATE keeps earlier destructive and high-risk history blocked', async () => {
  const review = await reviewMigrationChain({})
  assert.equal(review.accepted, false)
  const blocked = review.reviews.filter((item) => !item.accepted)
  assert.ok(blocked.length > 0)
  assert.ok(
    blocked.some((item) =>
      item.blocking.some((statement) => statement.classification === 'destructive')
    )
  )
  assert.ok(
    blocked.some((item) =>
      item.blocking.some((statement) => statement.classification === 'high_risk')
    )
  )
  assert.equal(
    blocked.some((item) => WEB_08_09_CHAIN.includes(item.name)),
    false
  )
})

test('DB-09-GATE recognizes guard DDL structurally and nothing broader', () => {
  const context = createMigrationContext()
  assert.equal(classifyStatementInContext(GUARD_FUNCTION, context), 'append_only_guard')
  assert.equal(classifyStatementInContext(GUARD_TRIGGER, context), 'append_only_guard')
  // Without chain context the statements stay fail-closed.
  assert.equal(classifySqlStatement(GUARD_FUNCTION), 'ambiguous')
  assert.equal(classifySqlStatement(GUARD_TRIGGER), 'ambiguous')
  assert.equal(gateInventory({ statements: [GUARD_FUNCTION, GUARD_TRIGGER] }).status, 'rejected')

  const fresh = () => createMigrationContext()
  const negatives = {
    'body does more than raising': GUARD_FUNCTION.replace(
      "RAISE EXCEPTION 'fixture is append-only';",
      'RETURN NEW;'
    ),
    'body raises and returns': GUARD_FUNCTION.replace(
      "RAISE EXCEPTION 'fixture is append-only';",
      "RAISE EXCEPTION 'x'; RETURN NEW;"
    ),
    'function with arguments': GUARD_FUNCTION.replace(
      'tus_guard_fixture()',
      'tus_guard_fixture(integer)'
    ),
    'function returning a value': GUARD_FUNCTION.replace('RETURNS trigger', 'RETURNS integer'),
    'sql language function': GUARD_FUNCTION.replace('LANGUAGE plpgsql', 'LANGUAGE sql'),
  }
  for (const [label, sql] of Object.entries(negatives))
    assert.equal(classifyStatementInContext(sql, fresh()), 'ambiguous', label)
  assert.equal(
    classifyStatementInContext(
      GUARD_FUNCTION.replace(
        "RAISE EXCEPTION 'fixture is append-only';",
        'DELETE FROM public."fixture";'
      ),
      fresh()
    ),
    'destructive'
  )

  const guardContext = () => {
    const value = createMigrationContext()
    classifyStatementInContext(GUARD_FUNCTION, value)
    return value
  }
  const triggerNegatives = {
    'after insert trigger': GUARD_TRIGGER.replace('BEFORE UPDATE OR DELETE', 'AFTER INSERT'),
    'only update trigger': GUARD_TRIGGER.replace('BEFORE UPDATE OR DELETE', 'BEFORE UPDATE'),
    'statement trigger': GUARD_TRIGGER.replace('FOR EACH ROW', 'FOR EACH STATEMENT'),
    'or replace trigger': GUARD_TRIGGER.replace('CREATE TRIGGER', 'CREATE OR REPLACE TRIGGER'),
    'unknown function': GUARD_TRIGGER.replace(
      'public.tus_guard_fixture()',
      'public.audit_everything()'
    ),
  }
  for (const [label, sql] of Object.entries(triggerNegatives))
    assert.equal(classifyStatementInContext(sql, guardContext()), 'ambiguous', label)
  assert.equal(classifyStatementInContext(GUARD_TRIGGER, fresh()), 'ambiguous')

  const redefined = createMigrationContext()
  classifyStatementInContext(
    'CREATE FUNCTION public.tus_guard_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;',
    redefined
  )
  assert.equal(classifyStatementInContext(GUARD_FUNCTION, redefined), 'ambiguous')

  for (const sql of [
    'DROP FUNCTION public.tus_guard_fixture();',
    'DROP TRIGGER tus_guard_fixture_trigger ON public."fixture";',
    'DROP TRIGGER IF EXISTS tus_guard_fixture_trigger ON public."fixture";',
  ]) {
    assert.equal(classifyStatementInContext(sql, guardContext()), 'high_risk', sql)
    assert.equal(gateInventory({ statements: [sql] }).status, 'rejected', sql)
  }
  assert.equal(
    classifyStatementInContext('DROP TABLE public."fixture";', guardContext()),
    'destructive'
  )
})

test('DB-09-GATE rejects guard chains, reviewed statements or migrations that were altered', async () => {
  const workBudget = await readFile(
    join(MIGRATIONS, '20260917100000_tus_work_budget', 'migration.sql'),
    'utf8'
  )
  const tampered = workBudget.replace(
    'ON DELETE CASCADE ON UPDATE NO ACTION;',
    'ON DELETE CASCADE ON UPDATE CASCADE;'
  )
  assert.notEqual(tampered, workBudget)
  await withMigrations({ '20260917100000_tus_work_budget': tampered }, async (directory) => {
    const review = await reviewMigrationChain({ migrationsDirectory: directory })
    assert.equal(review.accepted, false)
    assert.equal(review.reviews[0].blocking.length, 1)
    assert.equal(review.reviews[0].blocking[0].classification, 'destructive')
  })
  await withMigrations({ '20260930000000_copy_of_work_budget': workBudget }, async (directory) => {
    const review = await reviewMigrationChain({ migrationsDirectory: directory })
    assert.equal(review.accepted, false)
    assert.equal(review.reviews[0].blocking.length, 3)
  })
  await withMigrations(
    { '20260930000000_guard': `${GUARD_FUNCTION}\n${GUARD_TRIGGER}\n` },
    async (directory) => {
      assert.equal((await reviewMigrationChain({ migrationsDirectory: directory })).accepted, true)
    }
  )
  await withMigrations(
    {
      '20260930000000_existing_function':
        'CREATE FUNCTION public.tus_guard_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;\n',
      '20260930000001_replace_with_guard': `${GUARD_FUNCTION}\n${GUARD_TRIGGER}\n`,
    },
    async (directory) => {
      const review = await reviewMigrationChain({ migrationsDirectory: directory })
      assert.equal(review.accepted, false)
      assert.deepEqual(
        review.reviews[1].blocking.map((statement) => statement.classification),
        ['ambiguous', 'ambiguous']
      )
    }
  )
  await withMigrations(
    {
      '20260930000000_guard_then_drop': `${GUARD_FUNCTION}\n${GUARD_TRIGGER}\nDROP TRIGGER tus_guard_fixture_trigger ON public."fixture";\n`,
    },
    async (directory) => {
      const review = await reviewMigrationChain({ migrationsDirectory: directory })
      assert.equal(review.accepted, false)
      assert.deepEqual(
        review.reviews[0].blocking.map((statement) => statement.classification),
        ['high_risk']
      )
    }
  )
})
