import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  CONFORMANCE_REPAIR,
  CONFORMANCE_TYPE_BUG,
  CONFORMANCE_TYPE_FIX,
  LONG_MARKER_MIGRATIONS,
  POS_REPAIR,
  PRISMA_MIGRATIONS_BOOTSTRAP_SQL,
  UNMANAGED_GUARD_CODE,
  UNMANAGED_GUARD_SQL,
  deriveConformanceSql,
  describeTarget,
  parseMigrateStatus,
  planDeploy,
  redact,
  supabaseProject,
  validateTargets,
} from '../../scripts/db/migrate-deploy-lib.mjs'

// Inicialización de una base nueva y migraciones automáticas en el despliegue de Hostinger.
// Fallas reproducidas con `prisma migrate deploy` sobre PostgreSQL 16 descartable:
// - 22001 en 20260911120000 / 20260911130000: marcadores de 38/41 caracteres contra
//   `_prisma_migrations.id VARCHAR(36)` (la constante se convierte aunque el WHERE descarte la fila).
// - 42883 en 20260911130000: `name[] = text[]` no existe en PostgreSQL.
const root = join(import.meta.dirname, '..', '..')
const migrations = join(root, 'apps/api/prisma/migrations')
const read = (name) => readFileSync(join(migrations, name, 'migration.sql'), 'utf8')

test('MIGRATIONS root cause: historical repair markers do not fit VARCHAR(36) and are never edited', () => {
  for (const name of LONG_MARKER_MIGRATIONS) {
    const marker = read(name).match(/SELECT\s+'([^']+-marker)'/u)?.[1]
    assert.ok(marker, `${name} keeps its marker`)
    assert.ok(marker.length > 36, `${name} marker (${marker.length}) is longer than Prisma's VARCHAR(36) id`)
  }
  // Los marcadores más viejos entran en 36 y no necesitan bootstrap.
  assert.ok('tus-argentina-market-launch-marker'.length <= 36)
  assert.ok('tus-additive-repair-marker'.length <= 36)
  // La comparación de tipos incorrecta sigue en el archivo histórico (no se reescribe).
  assert.equal(read(CONFORMANCE_REPAIR).split(CONFORMANCE_TYPE_BUG).length - 1, 1)
})

test('MIGRATIONS bootstrap: same _prisma_migrations shape as Prisma, only id widened to TEXT', () => {
  assert.match(PRISMA_MIGRATIONS_BOOTSTRAP_SQL, /CREATE TABLE IF NOT EXISTS "_prisma_migrations"/u)
  assert.match(PRISMA_MIGRATIONS_BOOTSTRAP_SQL, /"id"\s+TEXT NOT NULL/u)
  for (const column of ['"checksum"              VARCHAR(64) NOT NULL', '"migration_name"        VARCHAR(255) NOT NULL', '"started_at"            TIMESTAMPTZ NOT NULL DEFAULT now()', '"applied_steps_count"   INTEGER NOT NULL DEFAULT 0'])
    assert.ok(PRISMA_MIGRATIONS_BOOTSTRAP_SQL.includes(column), column)
  assert.match(PRISMA_MIGRATIONS_BOOTSTRAP_SQL, /ALTER TABLE "_prisma_migrations" ALTER COLUMN "id" TYPE TEXT;/u)
  assert.doesNotMatch(PRISMA_MIGRATIONS_BOOTSTRAP_SQL, /\b(DROP|TRUNCATE|DELETE|INSERT|UPDATE)\b/u)
})

test('MIGRATIONS derived 20260911130000: exactly the original minus the marker, with one cast, in a transaction', () => {
  const original = read(CONFORMANCE_REPAIR)
  const derived = deriveConformanceSql(original)
  assert.match(derived, /^-- Derivada[\s\S]*\nBEGIN;\n/u)
  assert.match(derived, /\nCOMMIT;\n$/u)
  assert.ok(derived.includes(CONFORMANCE_TYPE_FIX))
  assert.ok(!derived.includes(CONFORMANCE_TYPE_BUG))
  assert.doesNotMatch(derived, /INSERT INTO "_prisma_migrations"/u)
  // Todo lo demás es byte a byte el archivo del repo.
  const body = derived.slice(derived.indexOf('BEGIN;\n') + 'BEGIN;\n'.length, derived.lastIndexOf('\nCOMMIT;'))
  const expected = original.slice(0, original.lastIndexOf('INSERT INTO "_prisma_migrations"')).replace(CONFORMANCE_TYPE_BUG, CONFORMANCE_TYPE_FIX).trimEnd()
  assert.equal(body, expected)
  // Fail closed si el archivo cambia de forma inesperada.
  assert.throws(() => deriveConformanceSql(original.replace(CONFORMANCE_TYPE_BUG, 'x')), /exactly one type comparison/u)
  assert.throws(() => deriveConformanceSql(`${original}\nSELECT 1;`), /final statement/u)
})

// Salidas reales de `prisma migrate status` (Prisma 5.22, PostgreSQL 16 descartable), sin rutas.
const STATUS = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/prisma-migrate-status.json'), 'utf8'))
const LOCAL = readdirSync(migrations, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b))
// Las capturas se tomaron con 49 migraciones ("real") y con las 30 anteriores a 20260911120000_tus_pos ("early").
const localFor = (fixture) => {
  const count = fixture.output.match(/(\d+) migrations? found/u)?.[1]
  return count ? LOCAL.slice(0, Number(count)) : LOCAL
}
const parse = (key, override = {}) => {
  const fixture = { ...STATUS[key], ...override }
  return parseMigrateStatus(fixture.output, fixture.exitCode, override.local ?? localFor(STATUS[key]))
}

test('MIGRATIONS status: real Prisma outputs; pending may exit 1; plan for fresh, existing and up-to-date databases', () => {
  const empty = parse('empty')
  assert.equal(STATUS.empty.exitCode, 1, 'pending migrations make migrate status exit 1')
  assert.equal(empty.state, 'pending')
  assert.equal(empty.pending.length, 49)
  const plan = planDeploy(empty, localFor(STATUS.empty))
  assert.equal(plan.action, 'deploy')
  assert.equal(plan.bootstrap, true)
  assert.equal(plan.conformance, true)
  assert.equal(plan.before.at(-1), POS_REPAIR)

  const pending = parse('pending')
  assert.equal(pending.state, 'pending')
  assert.deepEqual(pending.pending.slice(0, 2), [POS_REPAIR, CONFORMANCE_REPAIR])

  const upToDate = parse('upToDateEarly')
  assert.equal(upToDate.state, 'up-to-date')
  assert.deepEqual(planDeploy(upToDate, localFor(STATUS.upToDateEarly)), { action: 'none' })
  // Pendientes con exit 0 también se aceptan; "al día" con exit 1 no.
  assert.equal(parse('pending', { exitCode: 0 }).state, 'pending')
  assert.equal(parse('upToDateEarly', { exitCode: 1 }).state, 'unknown')
})

test('MIGRATIONS status: recognized errors and ANY unknown output stop before writing', () => {
  const failed = parse('failed')
  assert.deepEqual([failed.state, failed.failed], ['failed', ['20260911120000_tus_listing_price_minor']])
  assert.equal(planDeploy(failed, []).reason, 'failed-migrations')
  assert.deepEqual([parse('unreachable').state, parse('unreachable').detail], ['unreachable', 'P1001'])
  assert.deepEqual([parse('noDatabase').state, parse('noDatabase').detail], ['unreachable', 'P1003'])
  assert.equal(planDeploy(parse('unreachable'), []).reason, 'database-unreachable')

  const unknowns = {
    empty: { output: '', exitCode: 1 },
    garbage: { output: 'Segmentation fault', exitCode: 139 },
    otherPrismaError: { output: `${STATUS.pending.output}\nError: P3009: migrate found failed migrations`, exitCode: 1 },
    extraLine: { output: STATUS.pending.output.replace('Following migrations', 'Warning: drift detected\nFollowing migrations'), exitCode: 1 },
    exitWithoutPending: { output: STATUS.upToDateEarly.output.replace('Database schema is up to date!', ''), exitCode: 1 },
    both: { output: `${STATUS.pending.output}\nDatabase schema is up to date!`, exitCode: 1 },
    unexpectedExit: { output: STATUS.pending.output, exitCode: 2 },
    stranger: { output: STATUS.pending.output.replace(POS_REPAIR, '20990101000000_fantasma'), exitCode: 1 },
    countMismatch: { output: STATUS.pending.output.replace('49 migrations found', '48 migrations found'), exitCode: 1 },
  }
  for (const [name, fixture] of Object.entries(unknowns)) {
    const status = parseMigrateStatus(fixture.output, fixture.exitCode, localFor(STATUS.pending))
    assert.equal(status.state, 'unknown', name)
    assert.deepEqual(planDeploy(status, LOCAL).action, 'abort', name)
    assert.equal(planDeploy(status, LOCAL).reason, 'unrecognized-status', name)
  }
  // El aviso de actualización de la CLI (caja) no vuelve desconocida una salida válida.
  const notice = `${STATUS.pending.output}\n┌─────────────────────────────────┐\n│  Update available 5.22.0 -> 6.0.0 │\n└─────────────────────────────────┘\n`
  assert.equal(parseMigrateStatus(notice, 1, localFor(STATUS.pending)).state, 'pending')
})

test('MIGRATIONS unmanaged guard: a non-empty public schema without Prisma history is refused (status cannot tell)', () => {
  // `migrate status` informa lo mismo para una base vacía y para una con tablas ajenas.
  assert.equal(parse('unmanaged').state, 'pending')
  assert.deepEqual(parse('unmanaged').pending, parse('empty').pending)
  assert.match(UNMANAGED_GUARD_SQL, /to_regclass\('public\._prisma_migrations'\) IS NULL/u)
  assert.match(UNMANAGED_GUARD_SQL, new RegExp(`RAISE EXCEPTION '${UNMANAGED_GUARD_CODE}'`, 'u'))
  assert.doesNotMatch(UNMANAGED_GUARD_SQL, /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/u, 'read-only')
  const script = readFileSync(join(root, 'scripts/db/migrate-deploy.mjs'), 'utf8')
  const guard = script.indexOf('assertPublicSchemaManagedOrEmpty(work)')
  assert.ok(guard > 0 && guard < script.indexOf('if (plan.bootstrap)'), 'guard runs before the first write')
})

test('MIGRATIONS target checks: both URLs, same database, TLS in production, never factory_local, no secrets in logs', () => {
  const url = (db, ssl = 'require') => `postgresql://user:s3cr3t@db.example.com:5432/${db}?sslmode=${ssl}`
  assert.deepEqual(describeTarget(url('postgres')), { host: 'db.example.com', port: '5432', database: 'postgres', sslmode: 'require' })
  assert.equal(validateTargets({ DATABASE_URL: url('postgres'), DIRECT_URL: url('postgres'), NODE_ENV: 'production' }).ok, true)
  assert.match(validateTargets({ DATABASE_URL: url('postgres'), NODE_ENV: 'production' }).problems.join(), /DIRECT_URL missing/u)
  assert.match(validateTargets({ DATABASE_URL: url('postgres', 'disable'), DIRECT_URL: url('postgres'), NODE_ENV: 'production' }).problems.join(), /DATABASE_URL must use sslmode/u)
  assert.match(validateTargets({ DATABASE_URL: url('factory_local'), DIRECT_URL: url('factory_local') }).problems.join(), /factory_local/u)
  assert.match(validateTargets({ DATABASE_URL: url('a'), DIRECT_URL: url('b') }).problems.join(), /different databases/u)
  assert.doesNotMatch(JSON.stringify(validateTargets({ DATABASE_URL: url('postgres'), DIRECT_URL: url('postgres') })), /s3cr3t|user/u)
  assert.doesNotMatch(redact(`failed for ${url('x')} password=hunter2`), /s3cr3t|hunter2/u)
})

test('MIGRATIONS Supabase: DATABASE_URL and DIRECT_URL must be the same project (direct and pooler endpoints)', () => {
  const REF = 'abcdefghijklmnopqrst'
  const OTHER = 'zyxwvutsrqponmlkjihg'
  const direct = (ref = REF, port = 5432) => `postgresql://postgres:s3cr3t@db.${ref}.supabase.co:${port}/postgres?sslmode=require`
  const pooler = (user = `postgres.${REF}`, host = 'aws-0-sa-east-1.pooler.supabase.com', port = 5432) => `postgresql://${user}:s3cr3t@${host}:${port}/postgres?sslmode=require`
  const check = (runtime, migrations) => validateTargets({ DATABASE_URL: runtime, DIRECT_URL: migrations, NODE_ENV: 'production' })

  assert.deepEqual(supabaseProject(direct()), { endpoint: 'direct', ref: REF })
  assert.deepEqual(supabaseProject(pooler()), { endpoint: 'pooler', ref: REF })
  assert.equal(supabaseProject('postgresql://u:p@db.example.com/postgres'), null)

  // Aceptados: session pooler + directa, pooler en ambas (session 5432 / transaction 6543),
  // directa en ambas, PgBouncer dedicado (db.<ref>:6543) y regiones aws-1.
  for (const [runtime, migrations] of [
    [pooler(), direct()],
    [pooler(undefined, undefined, 6543), pooler()],
    [direct(), direct()],
    [direct(REF, 6543), direct()],
    [pooler(`postgres.${REF}`, 'aws-1-us-east-2.pooler.supabase.com'), direct()],
  ]) {
    const result = check(runtime, migrations)
    assert.equal(result.ok, true, `${result.problems.join('; ')}`)
    assert.equal(result.project.ref, REF)
  }

  const rejected = {
    otherProjectDirect: [pooler(), direct(OTHER), /different Supabase projects/u],
    otherProjectPooler: [pooler(`postgres.${OTHER}`), direct(), /different Supabase projects/u],
    poolerWithoutRef: [pooler('postgres'), direct(), /pooler user must be <role>\.<project-ref>/u],
    malformedRef: [direct('abc'), direct(), /invalid Supabase project ref/u],
    unknownSupabaseHost: [pooler(`postgres.${REF}`, 'api.supabase.com'), direct(), /not a recognized Supabase endpoint/u],
    mixedProviders: [pooler(), 'postgresql://u:s3cr3t@db.example.com:5432/postgres?sslmode=require', /not a Supabase endpoint while the other one is/u],
  }
  for (const [name, [runtime, migrations, message]] of Object.entries(rejected)) {
    const result = check(runtime, migrations)
    assert.equal(result.ok, false, name)
    assert.match(result.problems.join('; '), message, name)
    assert.doesNotMatch(JSON.stringify(result), /s3cr3t/u, name)
  }
  // El mensaje de proyectos distintos no expone los refs completos.
  assert.doesNotMatch(check(pooler(), direct(OTHER)).problems.join(), new RegExp(`${REF}|${OTHER}`, 'u'))
})

test('MIGRATIONS Hostinger: migrations run after the build and a failure stops the deploy; the API never migrates on start', () => {
  const postinstall = readFileSync(join(root, 'scripts/hostinger-postinstall.mjs'), 'utf8')
  const build = postinstall.indexOf("'@factory/api...'")
  const migrate = postinstall.indexOf("'scripts/db/migrate-deploy.mjs'")
  assert.ok(build > 0 && migrate > build, 'migrations after compiling')
  assert.match(postinstall, /if \(migrate\.error \|\| migrate\.status !== 0\)[\s\S]*process\.exit\(migrate\.status \|\| 1\)/u)
  for (const file of ['apps/api/src/index.ts', 'apps/api/src/server.ts'])
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /migrate deploy|migrate-deploy/u, file)
  const api = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8'))
  assert.equal(api.scripts.start, 'node dist/index.js', 'starting the API never migrates')
  assert.equal(api.scripts.prestart, undefined)
  const script = readFileSync(join(root, 'scripts/db/migrate-deploy.mjs'), 'utf8')
  // Solo los argumentos que ejecuta (no los comentarios): nunca reset, push ni TLS desactivado.
  assert.doesNotMatch(script, /['"](?:reset|push)['"]|--accept-data-loss|--force-reset|sslmode=disable|rejectUnauthorized/u)
})
