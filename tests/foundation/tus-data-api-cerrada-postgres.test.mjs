import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

// SEGURIDAD-DATA-API-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). Never a shared or production database.
//
// Supabase exposes the schema `public` through its Data API with the roles `anon` (the public key)
// and `authenticated`. This reproduces that exposure (those roles, with the grants Supabase gives
// them) and proves that after the migration nobody reaches a table of TUS through them, while the
// role of the API keeps reading and writing. It does NOT call Supabase: the Security Advisor of
// the real project has to be looked at after the deploy.
const require = createRequire(import.meta.url)
const { Client } = require('../../apps/api/node_modules/pg')
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'
const MIGRACION = new URL('../../apps/api/prisma/migrations/20261110100000_tus_data_api_cerrada/migration.sql', import.meta.url)

// Tables with personal or secret data: the ones that must never answer to an anonymous caller.
const SENSIBLES = ['"User"', '"Account"', '"Session"', '"PasswordCredential"', '"VerificationToken"', 'contactos_whatsapp', 'mensajes_conversacion_whatsapp', 'verificaciones_identidad', 'reservas', 'reservas_alojamiento', 'solicitudes_servicio', 'imagenes_reserva', 'prestadores']

test('DATA API: with the roles and grants Supabase gives, an anonymous or signed-in caller of the Data API cannot list, read, change or delete anything of TUS (no grants, and RLS without policies behind them); the role of the API keeps working; every table has RLS', { skip, timeout: 240_000 }, async () => {
  const db = new Client({ connectionString: url })
  await db.connect()
  try {
    const run = 'da' + Date.now().toString(36)
    // What Supabase does to a project: the two roles, and every table of `public` granted to them.
    for (const rol of ['anon', 'authenticated']) {
      await db.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${rol}') THEN CREATE ROLE ${rol} NOLOGIN; END IF; END $$`)
      await db.query(`GRANT USAGE ON SCHEMA public TO ${rol}`)
      await db.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${rol}`)
      await db.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${rol}`)
    }
    await db.query(`INSERT INTO "User"(id, email, "normalizedEmail", "displayName", "phoneNumber", "phoneVerifiedAt", "documentType", "documentNumber", "updatedAt") VALUES ($1, $2, $2, 'Persona Privada', $3, now(), 'DNI', $4, now())`, [run + '-u', run + '@t.invalid', '+54937941' + String(Date.now()).slice(-5), '31' + String(Date.now()).slice(-6)])
    const como = async (rol, sql, params = []) => {
      await db.query(`SET ROLE ${rol}`)
      try {
        const r = await db.query(sql, params)
        return { ok: true, filas: r.rowCount }
      } catch (error) {
        return { ok: false, code: error.code }
      } finally {
        await db.query('RESET ROLE')
      }
    }
    // Exposed as Supabase leaves it only where RLS is not on yet; here the migration already ran,
    // so even WITH the grants nothing comes back: RLS without policies denies by default.
    for (const tabla of SENSIBLES) {
      const leido = await como('anon', `SELECT * FROM public.${tabla} LIMIT 5`)
      assert.deepEqual(leido, { ok: true, filas: 0 }, `${tabla}: with a grant but RLS and no policy, anon reads nothing`)
    }
    assert.deepEqual(await como('anon', `UPDATE public."User" SET "displayName" = 'x' WHERE id = $1`, [run + '-u']), { ok: true, filas: 0 }, 'RLS: anon changes no row')
    assert.deepEqual(await como('authenticated', `DELETE FROM public."User" WHERE id = $1`, [run + '-u']), { ok: true, filas: 0 }, 'RLS: a signed-in Data API caller deletes no row')
    assert.equal((await como('anon', `INSERT INTO public."User"(id, email, "normalizedEmail", "displayName", "updatedAt") VALUES ($1, $2, $2, 'intruso', now())`, [run + '-x', run + '-x@t.invalid'])).ok, false, 'RLS: anon inserts nothing')

    // The migration again (it is idempotent): the grants themselves go away.
    await db.query(readFileSync(MIGRACION, 'utf8'))
    for (const rol of ['anon', 'authenticated']) {
      for (const tabla of SENSIBLES) assert.deepEqual(await como(rol, `SELECT * FROM public.${tabla} LIMIT 1`), { ok: false, code: '42501' }, `${rol} / ${tabla}: permission denied`)
      assert.deepEqual(await como(rol, `SELECT email, "phoneNumber", "documentNumber" FROM public."User"`), { ok: false, code: '42501' }, `${rol}: cannot list users, phones or documents`)
      assert.deepEqual(await como(rol, `UPDATE public."User" SET "displayName" = 'x'`), { ok: false, code: '42501' }, `${rol}: cannot change records`)
      assert.deepEqual(await como(rol, `DELETE FROM public.reservas`), { ok: false, code: '42501' }, `${rol}: cannot delete records`)
      const conPermiso = await db.query(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee = $1 AND table_schema = 'public'`, [rol])
      assert.equal(conPermiso.rows[0].n, 0, `${rol}: no privilege left on any table of public`)
    }
    // A table created afterwards (a later migration) is not granted to them either.
    await db.query(`CREATE TABLE public."${run}_nueva" (id text primary key)`)
    assert.deepEqual(await como('anon', `SELECT * FROM public."${run}_nueva"`), { ok: false, code: '42501' }, 'default privileges: a new table is not public')
    await db.query(`DROP TABLE public."${run}_nueva"`)

    // The API (the owner of the tables, as in production) is not affected.
    const propia = await db.query(`SELECT "displayName" FROM public."User" WHERE id = $1`, [run + '-u'])
    assert.equal(propia.rows[0].displayName, 'Persona Privada', 'the role of the API reads')
    assert.equal((await db.query(`UPDATE public."User" SET "displayName" = 'Persona Privada 2' WHERE id = $1`, [run + '-u'])).rowCount, 1, 'the role of the API writes')
    assert.equal((await db.query(`DELETE FROM public."User" WHERE id = $1`, [run + '-u'])).rowCount, 1)

    // Every table of public has RLS, none is forced (the owner must keep working), and no policy
    // opens anything. A later migration that adds a table without RLS fails here.
    const tablas = await db.query(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`)
    assert.ok(tablas.rows.length > 100, 'the tables of TUS are there')
    assert.deepEqual(tablas.rows.filter((t) => !t.relrowsecurity).map((t) => t.relname), [], 'every table of public has RLS enabled (add ENABLE ROW LEVEL SECURITY to the migration that created the missing ones)')
    assert.deepEqual(tablas.rows.filter((t) => t.relforcerowsecurity).map((t) => t.relname), [], 'RLS is never forced: the API is the owner')
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`)).rows[0].n, 0, 'no policy: nothing is public')
  } finally {
    await db.query('RESET ROLE').catch(() => undefined)
    await db.end()
  }
})

test('DATA API: no migration grants a table to anon or authenticated, creates a policy or forces RLS; no client holds a Supabase key or a database URL', () => {
  const raiz = new URL('../../apps/api/prisma/migrations/', import.meta.url)
  for (const carpeta of readdirSync(raiz, { withFileTypes: true }).filter((item) => item.isDirectory())) {
    const sql = readFileSync(new URL(`${carpeta.name}/migration.sql`, raiz), 'utf8').split('\n').filter((linea) => !linea.trim().startsWith('--')).join('\n')
    assert.doesNotMatch(sql, /GRANT[^;]*\bTO\s+"?(anon|authenticated|public)\b/iu, `${carpeta.name}: grants nothing to the Data API roles`)
    assert.doesNotMatch(sql, /CREATE\s+POLICY|FORCE\s+ROW\s+LEVEL\s+SECURITY/iu, `${carpeta.name}: no policy, no forced RLS`)
  }
  // Tables created after the closing migration must close themselves.
  const cierre = '20261110100000_tus_data_api_cerrada'
  for (const carpeta of readdirSync(raiz, { withFileTypes: true }).filter((item) => item.isDirectory() && item.name > cierre)) {
    const sql = readFileSync(new URL(`${carpeta.name}/migration.sql`, raiz), 'utf8')
    const creadas = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?([A-Za-z_]+)"?/gu)].map((m) => m[1])
    for (const tabla of creadas) assert.match(sql, new RegExp(`ALTER TABLE (?:public\\.)?"?${tabla}"? ENABLE ROW LEVEL SECURITY`, 'u'), `${carpeta.name}: ${tabla} must enable RLS`)
  }
  const paquetes = ['../../apps/web/package.json', '../../apps/mobile/package.json', '../../apps/api/package.json'].map((ruta) => { try { return readFileSync(new URL(ruta, import.meta.url), 'utf8') } catch { return '' } }).join('\n')
  assert.doesNotMatch(paquetes, /@supabase\//u, 'no Supabase client library anywhere')
})
