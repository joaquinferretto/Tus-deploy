import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

import { RUNTIME_ROLE_GUARD_CODE, RUNTIME_ROLE_GUARD_SQL, RUNTIME_SCHEMA, enablesRowLevelSecurity } from '../../scripts/db/migrate-deploy-lib.mjs'

// SEGURIDAD-DATA-API-01, the deploy side: a migration that enables row level security is applied
// only when the role the API really connects with (DATABASE_URL) owns the tables or is exempt.
// With the real script (scripts/db/migrate-deploy.mjs) on a DISPOSABLE PostgreSQL 16
// (TUS_MIGRATIONS_PG_ADMIN_URL: a server where the user may CREATE DATABASE and CREATE ROLE; never
// a shared or production one).
const require = createRequire(import.meta.url)
const { Client } = require('../../apps/api/node_modules/pg')
const root = join(import.meta.dirname, '..', '..')
const adminUrl = process.env.TUS_MIGRATIONS_PG_ADMIN_URL
const RLS = '20261110100000_tus_data_api_cerrada'
const migrar = (runtime, direct) => spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, env: { ...process.env, DATABASE_URL: runtime, DIRECT_URL: direct }, encoding: 'utf8', timeout: 480_000 })

test('MIGRATE runtime role: the script knows which migrations enable RLS and asks the runtime role before applying them', () => {
  assert.equal(enablesRowLevelSecurity(readFileSync(join(root, 'apps/api/prisma/migrations', RLS, 'migration.sql'), 'utf8')), true)
  assert.equal(enablesRowLevelSecurity('-- ALTER TABLE x ENABLE ROW LEVEL SECURITY\nSELECT 1;'), false, 'a comment is not SQL')
  assert.equal(enablesRowLevelSecurity(readFileSync(join(root, 'apps/api/prisma/migrations/20261109100000_tus_prestador_cuenta/migration.sql'), 'utf8')), false)
  assert.match(RUNTIME_ROLE_GUARD_SQL, new RegExp(RUNTIME_ROLE_GUARD_CODE, 'u'))
  assert.match(RUNTIME_ROLE_GUARD_SQL, /rolsuper OR rolbypassrls/u)
  assert.doesNotMatch(RUNTIME_ROLE_GUARD_SQL, /\b(UPDATE|INSERT|DELETE|ALTER|DROP|GRANT|REVOKE)\b/u, 'the check only reads')
  assert.match(RUNTIME_SCHEMA, /env\("DATABASE_URL"\)/u)
  assert.doesNotMatch(RUNTIME_SCHEMA, /directUrl/u, 'the check connects as the API does, never with the migration credentials')
  const script = readFileSync(join(root, 'scripts/db/migrate-deploy.mjs'), 'utf8')
  const chequeo = script.indexOf('assertRuntimeRoleSurvivesRls(work, initial.pending)')
  assert.ok(chequeo > 0 && chequeo < script.indexOf('PRISMA_MIGRATIONS_BOOTSTRAP_SQL)', chequeo) && chequeo < script.lastIndexOf("prisma(['migrate', 'deploy'])"), 'the check runs before anything is written or applied')
})

test('MIGRATE runtime role PostgreSQL: when the API would connect as a role that does not own the tables, the RLS migration is NOT applied and the deploy fails; with the owner, or with a role exempt from RLS, it is applied and the API role keeps reading', { skip: !adminUrl && 'TUS_MIGRATIONS_PG_ADMIN_URL not set (disposable PostgreSQL 16 only)', timeout: 900_000 }, async () => {
  const run = 'rg' + Date.now().toString(36)
  const database = `tus_${run}`
  const rol = `tus_api_${run}`
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  const propia = new URL(adminUrl)
  propia.pathname = `/${database}`
  const ajena = new URL(propia)
  ajena.username = rol
  ajena.password = ''
  let db
  try {
    await admin.query(`CREATE DATABASE ${database}`)
    await admin.query(`CREATE ROLE ${rol} LOGIN`)
    // Everything applied by the owner, as a first deploy would.
    const inicial = migrar(propia.toString(), propia.toString())
    assert.equal(inicial.status, 0, (inicial.stdout + inicial.stderr).slice(-600))
    db = new Client({ connectionString: propia.toString() })
    await db.connect()
    // A role that can do everything the API does, but does not own the tables.
    await db.query(`GRANT USAGE ON SCHEMA public TO ${rol}`)
    await db.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${rol}`)
    const aplicada = async () => (await db.query(`SELECT count(*)::int AS n FROM public."_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL`, [RLS])).rows[0].n
    // As production is before this deploy: the RLS migration pending, tables without RLS.
    const pendiente = async () => {
      await db.query(`DELETE FROM public."_prisma_migrations" WHERE migration_name = $1`, [RLS])
      await db.query(`DO $$ DECLARE t record; BEGIN FOR t IN SELECT c.oid::regclass AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity LOOP EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', t.n); END LOOP; END $$`)
    }
    const conRls = async () => (await db.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity`)).rows[0].n

    // 1. The API as another role: refused, nothing applied.
    await pendiente()
    const rechazado = migrar(ajena.toString(), propia.toString())
    const salida = rechazado.stdout + rechazado.stderr
    assert.notEqual(rechazado.status, 0, 'the deploy fails')
    assert.match(salida, /runtime-role-not-owner/u, salida.slice(-600))
    assert.match(salida, /Nothing was applied/u)
    assert.equal(await aplicada(), 0, 'the RLS migration was not applied')
    assert.equal(await conRls(), 0, 'no table got row level security')
    assert.doesNotMatch(salida, new RegExp(propia.password || 'no-password-in-trust-auth', 'u'))

    // 2. That role exempt from RLS: applied.
    await admin.query(`ALTER ROLE ${rol} BYPASSRLS`)
    const exento = migrar(ajena.toString(), propia.toString())
    assert.equal(exento.status, 0, (exento.stdout + exento.stderr).slice(-600))
    assert.match(exento.stdout, /runtime role check passed/u)
    assert.equal(await aplicada(), 1)
    await admin.query(`ALTER ROLE ${rol} NOBYPASSRLS`)

    // 3. The API as the owner (production as documented): applied, and it keeps reading.
    await pendiente()
    const propietario = migrar(propia.toString(), propia.toString())
    assert.equal(propietario.status, 0, (propietario.stdout + propietario.stderr).slice(-600))
    assert.match(propietario.stdout, /runtime role check passed/u)
    assert.equal(await aplicada(), 1)
    assert.ok((await conRls()) > 100, 'every table has row level security now')
    assert.ok((await db.query(`SELECT count(*)::int AS n FROM public."oficios_servicio"`)).rows[0].n > 0, 'the owner (the API) still reads its seeded catalogue')
    // ...and this is what the refused role would have seen: nothing at all, without any error.
    await db.query(`SET ROLE ${rol}`)
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public."oficios_servicio"`)).rows[0].n, 0, 'a non-owner reads empty tables: exactly what the check prevents')
    await db.query('RESET ROLE')

    // 4. Nothing pending: the script changes nothing and asks nothing.
    const otraVez = migrar(ajena.toString(), propia.toString())
    assert.equal(otraVez.status, 0)
    assert.match(otraVez.stdout, /nothing to apply/u)
  } finally {
    await db?.end().catch(() => undefined)
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => undefined)
    await admin.query(`DROP ROLE IF EXISTS ${rol}`).catch(() => undefined)
    await admin.end()
  }
})
