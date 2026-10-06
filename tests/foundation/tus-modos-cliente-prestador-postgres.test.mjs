import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

const require = createRequire(import.meta.url)
const { Client } = require('../../apps/api/node_modules/pg')
const root = join(import.meta.dirname, '..', '..')

// MODOS-01 on a DISPOSABLE PostgreSQL 16 (TUS_MIGRATIONS_PG_ADMIN_URL: a server where the user may
// CREATE DATABASE; never a shared or production one): the migration as an UPGRADE of a database
// with accounts and sessions, and the store of the mode against the real tables.
const adminUrl = process.env.TUS_MIGRATIONS_PG_ADMIN_URL
const MIGRACION = '20261106100000_tus_modo_cliente_prestador'
const migrar = (url) => spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, encoding: 'utf8', timeout: 480000 })

test(
  'MODOS PG16: the migration adds two nullable columns over existing accounts and sessions without touching them; the mode is stored per session and the preference per account; the database refuses a mode outside the list; a second deploy is a no-op',
  { skip: !adminUrl && 'TUS_MIGRATIONS_PG_ADMIN_URL not set (disposable PostgreSQL 16 only)', timeout: 600000 },
  async () => {
    const base = `tus_modos_${Date.now().toString(36)}`
    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    const url = (() => { const u = new URL(adminUrl); u.pathname = `/${base}`; return u.toString() })()
    let db
    try {
      await admin.query(`CREATE DATABASE ${base}`)
      assert.equal(migrar(url).status, 0, 'the whole chain applies')
      // Real accounts and sessions, created through the identity service.
      const sembrado = runTypeScriptScenario(`
        const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
        const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url)}, errorFormat: 'minimal' })
        const { createPrismaAuthService } = await import('./apps/api/src/auth-security/composition.ts')
        const out = {}
        try {
          const auth = createPrismaAuthService(prisma)
          for (const nombre of ['ana', 'joaquin']) {
            const alta = await auth.service.registerAccount({ email: nombre + '@example.com', password: 'una-clave-larga-123', displayName: nombre })
            await auth.service.verifyEmail({ token: alta.created.verificationToken })
            const entrada = await auth.service.signIn({ email: nombre + '@example.com', password: 'una-clave-larga-123', device: {} })
            out[nombre] = { cuenta: alta.created.account.id, sesion: entrada.session.sessionId ?? entrada.session.id ?? null }
          }
          out.sesiones = (await prisma.$queryRawUnsafe('SELECT "id", "accountId" FROM public."Session" ORDER BY "createdAt"')).map((s) => [s.id, s.accountId])
        } finally { await prisma.$disconnect() }
        console.log(JSON.stringify(out))
      `)
      db = new Client({ connectionString: url })
      await db.connect()
      // The database as the previous release left it: same data, the two columns and the migration gone.
      await db.query('ALTER TABLE public."Session" DROP COLUMN "activeMode"')
      await db.query('ALTER TABLE public."Account" DROP COLUMN "lastMode"')
      await db.query('DELETE FROM _prisma_migrations WHERE migration_name = $1', [MIGRACION])
      const huella = async () => (await db.query(`SELECT (SELECT md5(string_agg("id" || "accountId" || "accessTokenDigest" || "expiresAt"::text, ',' ORDER BY "id")) FROM public."Session") AS sesiones, (SELECT md5(string_agg("id" || "userId" || "tenantId" || "status", ',' ORDER BY "id")) FROM public."Account") AS cuentas`)).rows[0]
      const antes = await huella()
      const mejora = migrar(url)
      assert.equal(mejora.status, 0, `the migration applies over existing data:\n${(mejora.stdout + mejora.stderr).slice(-1200)}`)
      assert.deepEqual(await huella(), antes, 'no account and no session changed')
      const nulos = (await db.query('SELECT (SELECT count(*)::int FROM public."Session" WHERE "activeMode" IS NOT NULL) AS s, (SELECT count(*)::int FROM public."Account" WHERE "lastMode" IS NOT NULL) AS a, (SELECT count(*)::int FROM public."Session") AS total')).rows[0]
      assert.deepEqual([nulos.s, nulos.a, nulos.total >= 2], [0, 0, true], 'existing rows keep NULL (no backfill)')
      assert.match(migrar(url).stdout, /nothing to apply/u, 'a second deploy applies nothing')
      const columnas = (await db.query(`SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE (table_name = 'Session' AND column_name = 'activeMode') OR (table_name = 'Account' AND column_name = 'lastMode') ORDER BY table_name`)).rows.map((c) => [c.table_name, c.column_name, c.is_nullable])
      assert.deepEqual(columnas, [['Account', 'lastMode', 'YES'], ['Session', 'activeMode', 'YES']])

      const [sesionAna, sesionJoaquin] = [sembrado.sesiones.find((s) => s[1] === sembrado.ana.cuenta)[0], sembrado.sesiones.find((s) => s[1] === sembrado.joaquin.cuenta)[0]]
      const r = runTypeScriptScenario(`
        const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
        const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url)}, errorFormat: 'minimal' })
        const m = await import('./apps/api/src/auth-security/modes/modos.ts')
        const { createPrismaAuthService } = await import('./apps/api/src/auth-security/composition.ts')
        const out = {}
        const codigo = async (op) => { try { await op(); return 'ok' } catch (e) { return String(e?.code ?? e?.meta?.code ?? e?.message).slice(0, 12) } }
        try {
          const almacen = new m.AlmacenModosPrisma(prisma)
          const ana = ${JSON.stringify(sembrado.ana.cuenta)}; const joaquin = ${JSON.stringify(sembrado.joaquin.cuenta)}
          const sAna = ${JSON.stringify(sesionAna)}; const sJoaquin = ${JSON.stringify(sesionJoaquin)}
          out.vacio = await almacen.leer(sJoaquin, joaquin)
          const servicio = new m.ServicioModos(almacen, async (c) => (c.subjectId === joaquin ? 'approved' : 'none'))
          const ctx = (cuenta, sesion) => ({ subjectId: cuenta, sessionId: sesion, tenantId: 't', roles: [], permissions: [], correlationId: 'c' })
          out.cambio = [(await servicio.cambiar(ctx(joaquin, sJoaquin), 'PROVIDER')).ok, await almacen.leer(sJoaquin, joaquin), (await servicio.cambiar(ctx(ana, sAna), 'PROVIDER')).ok, await almacen.leer(sAna, ana)]
          // A session is only written together with ITS account.
          await almacen.fijarSesion(sAna, joaquin, 'PROVIDER')
          out.sesionAjena = (await almacen.leer(sAna, ana)).activeMode
          out.sesionInexistente = await almacen.leer('no-existe', joaquin)
          out.cuentaInexistente = await almacen.leer(sJoaquin, 'no-existe')
          // The database itself refuses anything that is not a mode.
          out.check = [await codigo(() => prisma.$executeRawUnsafe('UPDATE public."Session" SET "activeMode" = $1 WHERE "id" = $2', 'ADMIN', sJoaquin)), await codigo(() => prisma.$executeRawUnsafe('UPDATE public."Account" SET "lastMode" = $1 WHERE "id" = $2', 'ROOT', joaquin))].map((x) => x !== 'ok')
          // Five simultaneous switches of the same session: no error, one of the two modes.
          const carrera = await Promise.all(['CLIENT', 'PROVIDER', 'CLIENT', 'PROVIDER', 'CLIENT'].map((modo) => servicio.cambiar(ctx(joaquin, sJoaquin), modo).then((x) => x.ok, () => 'error')))
          out.carrera = [carrera, ['CLIENT', 'PROVIDER'].includes((await almacen.leer(sJoaquin, joaquin)).activeMode)]
          // The provider state the administration sets is what the store reads back (it used to
          // answer 'approved' whatever the row said, so a suspension was never seen again).
          const { PrismaMarketplaceStore } = await import('./apps/api/src/tus/adapters/prisma-marketplace.ts')
          const mercado = new PrismaMarketplaceStore(prisma)
          const ahora = new Date().toISOString()
          await prisma.tusTenant.create({ data: { id: 't-estado', slug: 't-estado', name: 'Estado', status: 'active', createdAt: new Date(), updatedAt: new Date() } })
          const perfil = { tenantId: 't-estado', merchantId: 'prestador-estado', cohort: 'repairs-trades', locationId: 'ubicacion', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'v1', status: 'approved', createdAt: ahora, updatedAt: ahora }
          await mercado.merchant.save(perfil)
          const aprobado = (await mercado.merchant.find('t-estado')).status
          await mercado.merchant.save({ ...perfil, status: 'suspended' })
          const suspendido = (await mercado.merchant.find('t-estado')).status
          await mercado.merchant.save({ ...perfil, status: 'approved' })
          out.estadoPrestador = [aprobado, suspendido, m.estadoPrestadorDeCuenta(await mercado.merchant.find('t-estado')), m.estadoPrestadorDeCuenta(await mercado.merchant.find('t-no-existe').catch(() => null)), (await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM public."prestadores" WHERE "tenant_id" = $1', 't-estado'))[0].n]
          // The identity service keeps working with the new columns (sign-in, a new session with NULL).
          const auth = createPrismaAuthService(prisma)
          const otra = await auth.service.signIn({ email: 'joaquin@example.com', password: 'una-clave-larga-123', device: {} })
          out.nuevaSesion = [otra.ok, (await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM public."Session" WHERE "accountId" = $1 AND "activeMode" IS NULL', joaquin))[0].n]
        } finally { await prisma.$disconnect() }
        console.log(JSON.stringify(out))
      `)
      assert.deepEqual(r.vacio, { activeMode: null, lastMode: null })
      assert.deepEqual(r.cambio, [true, { activeMode: 'PROVIDER', lastMode: 'PROVIDER' }, false, { activeMode: null, lastMode: null }], 'the mode goes to the session and the preference to the account; a refused change writes nothing')
      assert.equal(r.sesionAjena, null, 'a session cannot be written through another account')
      assert.deepEqual([r.sesionInexistente.activeMode, r.cuentaInexistente], [null, { activeMode: null, lastMode: null }])
      assert.deepEqual(r.check, [true, true], 'the database refuses a mode outside the list')
      assert.deepEqual(r.carrera, [[true, true, true, true, true], true], 'simultaneous switches do not fail')
      assert.deepEqual(r.nuevaSesion, [true, 1], 'a new sign-in creates a session without a mode')
      assert.deepEqual(r.estadoPrestador, ['approved', 'suspended', 'approved', 'none', 1], 'a suspension is read back as a suspension, a reactivation as approved, on the same row')
    } finally {
      await db?.end().catch(() => {})
      await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`).catch(() => {})
      await admin.end()
    }
  }
)
