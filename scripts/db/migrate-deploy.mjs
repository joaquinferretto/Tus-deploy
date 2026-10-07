// `node scripts/db/migrate-deploy.mjs`: aplica las migraciones pendientes de apps/api a la base de
// DATABASE_URL / DIRECT_URL. Lo corre el despliegue de Hostinger después de compilar y antes de
// arrancar (scripts/hostinger-postinstall.mjs) o una persona desde la máquina de release. Nunca lo
// corre el servidor al arrancar ni la Web. Idempotente: una segunda ejecución no cambia nada.
// Falla (exit 1) con un motivo claro si algo no está bien; nunca hace reset ni db push.
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CONFORMANCE_REPAIR,
  PRISMA_MIGRATIONS_BOOTSTRAP_SQL,
  RUNTIME_ROLE_GUARD_CODE,
  RUNTIME_ROLE_GUARD_SQL,
  UNMANAGED_GUARD_CODE,
  UNMANAGED_GUARD_SQL,
  deriveConformanceSql,
  describeStepFailure,
  enablesRowLevelSecurity,
  parseMigrateStatus,
  planDeploy,
  redact,
  runtimeRoleCheck,
  validateTargets,
} from './migrate-deploy-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const API = join(ROOT, 'apps', 'api')
const SCHEMA = join(API, 'prisma', 'schema.prisma')
const MIGRATIONS = join(API, 'prisma', 'migrations')
const PRISMA_CLI = join(dirname(createRequire(join(API, 'package.json')).resolve('prisma/package.json')), 'build', 'index.js')
const STEP_TIMEOUT_MS = Number(process.env['TUS_MIGRATE_STEP_TIMEOUT_MS'] ?? 600_000)

const log = (message) => console.log(`[migrate] ${message}`)

class MigrationError extends Error {}

// `step`: what this call is for, in the words of the log. A step that does not finish says which
// one it was, how long it waited and what it printed (never the connection).
function prisma(args, { schema = SCHEMA, allowFailure = false, step = `prisma ${args[0]} ${args[1] ?? ''}`.trim(), timeout = STEP_TIMEOUT_MS } = {}) {
  const inicio = Date.now()
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args, '--schema', schema], {
    cwd: API,
    env: process.env,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  })
  const output = redact(`${result.stdout ?? ''}${result.stderr ?? ''}`)
  if (result.error) throw new MigrationError(describeStepFailure(step, result.error, { timeoutMs: timeout, elapsedMs: Date.now() - inicio, output }))
  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(output.slice(-4000))
    throw new MigrationError(`prisma ${args.join(' ')} failed with exit code ${result.status}`)
  }
  return { code: result.status, output }
}

function migrationNames() {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

// Copia del schema y de las migraciones anteriores a `before` (mismos archivos, mismos checksums).
function subsetSchema(work, names) {
  const dir = join(work, 'prisma')
  mkdirSync(join(dir, 'migrations'), { recursive: true })
  copyFileSync(SCHEMA, join(dir, 'schema.prisma'))
  copyFileSync(join(MIGRATIONS, 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'))
  for (const name of names) cpSync(join(MIGRATIONS, name), join(dir, 'migrations', name), { recursive: true })
  return join(dir, 'schema.prisma')
}

// `migrate status` devuelve 1 con pendientes (caso normal): se interpreta la salida completa, no
// solo el código. Todo lo que no sea un estado conocido corta antes de escribir.
function status(names) {
  const result = prisma(['migrate', 'status'], { allowFailure: true, step: 'reading the migration history (prisma migrate status, DIRECT_URL)' })
  return parseMigrateStatus(result.output, result.code, names)
}

// Solo lectura del catálogo: sin historial de Prisma, `public` tiene que estar vacío.
function assertPublicSchemaManagedOrEmpty(work) {
  const file = join(work, 'preflight.sql')
  writeFileSync(file, UNMANAGED_GUARD_SQL)
  const result = prisma(['db', 'execute', '--file', file], { allowFailure: true, step: 'preflight of the public schema (prisma db execute, DIRECT_URL)' })
  if (result.code === 0) return
  if (result.output.includes(UNMANAGED_GUARD_CODE))
    throw new MigrationError('database-not-empty-and-unmanaged: the public schema has objects but no Prisma history; refusing to initialize over existing data')
  process.stderr.write(result.output.slice(-2000))
  throw new MigrationError('preflight failed before any write (see output above)')
}

// SEGURIDAD-DATA-API-01. Before a pending migration turns row level security on, the role the API
// really connects with (DATABASE_URL) must be the owner of the tables TUS manages, a superuser or
// BYPASSRLS. If it is not, nothing is applied: the deploy fails and the API that is running keeps
// running, instead of a new one that reads empty tables.
//
// The check never runs a Prisma command over DATABASE_URL: that is a pooled connection, and the
// schema engine of Prisma (migrate, db execute) is not made for one — that is what DIRECT_URL is
// for. On Hostinger it simply never answered and the deploy waited ten minutes for it. Now:
// same role in both URLs -> decided without connecting; different roles -> asked with `pg`, the
// driver the API itself uses over that pooler, with a short limit.
const RUNTIME_CHECK_TIMEOUT_MS = Number(process.env['TUS_MIGRATE_RUNTIME_CHECK_TIMEOUT_MS'] ?? 30_000)

async function askRuntimeRole() {
  const { Client } = createRequire(join(API, 'package.json'))('pg')
  const url = new URL(process.env['DATABASE_URL'])
  // Same TLS as the API pool: Supabase certificates are signed by Supabase's own CA.
  if (/^(?:db\.[a-z0-9]+\.supabase\.co|aws-[a-z0-9-]+\.pooler\.supabase\.com)$/u.test(url.hostname) && ['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')) {
    url.searchParams.set('sslmode', 'verify-full')
    url.searchParams.delete('uselibpqcompat')
    if (!url.searchParams.has('sslrootcert')) url.searchParams.set('sslrootcert', join(API, 'certs', 'supabase-ca.crt'))
  }
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: RUNTIME_CHECK_TIMEOUT_MS, statement_timeout: RUNTIME_CHECK_TIMEOUT_MS, query_timeout: RUNTIME_CHECK_TIMEOUT_MS })
  await client.connect()
  try {
    await client.query(RUNTIME_ROLE_GUARD_SQL)
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function assertRuntimeRoleSurvivesRls(pending) {
  const conRls = pending.filter((name) => enablesRowLevelSecurity(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8')))
  if (conRls.length === 0) return
  const check = runtimeRoleCheck(process.env)
  if (check.mode === 'unknown') throw new MigrationError(`runtime-role-unknown: ${conRls.join(', ')} enables row level security and DATABASE_URL / DIRECT_URL do not name a role. Nothing was applied`)
  if (check.mode === 'same-role') {
    log(`runtime role check passed for ${conRls.join(', ')}: the API and the migrations use the same role ("${check.runtime}"), the owner of what the migrations create`)
    return
  }
  log(`runtime role check: the API role ("${check.runtime}") is not the migration role ("${check.direct}"); asking the database (limit ${Math.round(RUNTIME_CHECK_TIMEOUT_MS / 1000)}s)`)
  const inicio = Date.now()
  try {
    await askRuntimeRole()
  } catch (error) {
    const mensaje = redact(error instanceof Error ? error.message : String(error))
    if (mensaje.includes(RUNTIME_ROLE_GUARD_CODE))
      throw new MigrationError(`runtime-role-not-owner: ${conRls.join(', ')} enables row level security, and the role of DATABASE_URL ("${check.runtime}") is not the owner of the tables (nor superuser/BYPASSRLS): the API would read nothing. Nothing was applied. Use the same role in DATABASE_URL and DIRECT_URL`)
    throw new MigrationError(`runtime role check could not run after ${Math.round((Date.now() - inicio) / 1000)}s (${mensaje.slice(0, 300)}). Nothing was applied`)
  }
  log(`runtime role check passed for ${conRls.join(', ')} (the API role owns the tables or bypasses row level security)`)
}

export async function main() {
  const targets = validateTargets(process.env)
  if (!targets.ok) throw new MigrationError(`configuration: ${targets.problems.join('; ')}`)
  log(`target ${targets.direct.host}:${targets.direct.port}/${targets.direct.database} (sslmode=${targets.direct.sslmode ?? 'none'})`)
  if (targets.project) log(`supabase project ${targets.project.ref} (runtime: ${targets.project.runtime}, migrations: ${targets.project.direct})`)

  const names = migrationNames()
  const initial = status(names)
  const plan = planDeploy(initial, names)
  if (plan.action === 'abort') {
    const hint = {
      'database-unreachable': `check DIRECT_URL/DATABASE_URL, network access and TLS (${plan.detail ?? 'no detail'})`,
      'failed-migrations': `a previous run left failed migrations (${(plan.migrations ?? []).join(', ')}); inspect them before retrying, do not resolve blindly`,
      'unrecognized-status': `prisma migrate status returned something this script does not recognize (${plan.detail}); nothing was written`,
    }[plan.reason]
    throw new MigrationError(`${plan.reason}: ${hint}`)
  }
  if (plan.action === 'none') {
    log('database schema is up to date; nothing to apply')
    return
  }
  log(`${initial.pending.length} pending migration(s)`)

  const work = mkdtempSync(join(tmpdir(), 'tus-migrate-'))
  try {
    assertPublicSchemaManagedOrEmpty(work)
    await assertRuntimeRoleSurvivesRls(initial.pending)
    if (plan.bootstrap) {
      const file = join(work, 'bootstrap.sql')
      writeFileSync(file, PRISMA_MIGRATIONS_BOOTSTRAP_SQL)
      prisma(['db', 'execute', '--file', file])
      log('_prisma_migrations ready (id TEXT) for the historical repair markers')
    }
    if (plan.conformance) {
      if (plan.before.length > 0) {
        prisma(['migrate', 'deploy'], { schema: subsetSchema(work, plan.before) })
        log(`applied migrations before ${CONFORMANCE_REPAIR}`)
      }
      const file = join(work, 'conformance.sql')
      writeFileSync(file, deriveConformanceSql(readFileSync(join(MIGRATIONS, CONFORMANCE_REPAIR, 'migration.sql'), 'utf8')))
      prisma(['db', 'execute', '--file', file])
      prisma(['migrate', 'resolve', '--applied', CONFORMANCE_REPAIR])
      log(`${CONFORMANCE_REPAIR} applied (derived, in one transaction) and recorded with its real checksum`)
    }
    log(`applying ${initial.pending.length} migration(s): ${initial.pending.join(', ')}`)
    prisma(['migrate', 'deploy'], { step: 'applying the pending migrations (prisma migrate deploy, DIRECT_URL)' })
  } finally {
    rmSync(work, { recursive: true, force: true })
  }

  const final = status(names)
  if (final.state !== 'up-to-date')
    throw new MigrationError(`database is not up to date after deploy (state: ${final.state}; pending: ${final.pending.join(', ') || 'none'}; failed: ${final.failed.join(', ') || 'none'}; ${final.detail ?? ''})`)
  log('all migrations applied; database schema is up to date')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[migrate] FAILED: ${redact(error instanceof Error ? error.message : String(error))}`)
    process.exitCode = 1
  })
}
