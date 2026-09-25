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
  UNMANAGED_GUARD_CODE,
  UNMANAGED_GUARD_SQL,
  deriveConformanceSql,
  parseMigrateStatus,
  planDeploy,
  redact,
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

function prisma(args, { schema = SCHEMA, allowFailure = false } = {}) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args, '--schema', schema], {
    cwd: API,
    env: process.env,
    encoding: 'utf8',
    timeout: STEP_TIMEOUT_MS,
    windowsHide: true,
  })
  const output = redact(`${result.stdout ?? ''}${result.stderr ?? ''}`)
  if (result.error) throw new MigrationError(`prisma ${args[0]} ${args[1] ?? ''} did not finish (${result.error.name})`)
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
  const result = prisma(['migrate', 'status'], { allowFailure: true })
  return parseMigrateStatus(result.output, result.code, names)
}

// Solo lectura del catálogo: sin historial de Prisma, `public` tiene que estar vacío.
function assertPublicSchemaManagedOrEmpty(work) {
  const file = join(work, 'preflight.sql')
  writeFileSync(file, UNMANAGED_GUARD_SQL)
  const result = prisma(['db', 'execute', '--file', file], { allowFailure: true })
  if (result.code === 0) return
  if (result.output.includes(UNMANAGED_GUARD_CODE))
    throw new MigrationError('database-not-empty-and-unmanaged: the public schema has objects but no Prisma history; refusing to initialize over existing data')
  process.stderr.write(result.output.slice(-2000))
  throw new MigrationError('preflight failed before any write (see output above)')
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
    prisma(['migrate', 'deploy'])
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
