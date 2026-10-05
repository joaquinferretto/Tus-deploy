import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { Client } = require('../../apps/api/node_modules/pg')
const root = join(import.meta.dirname, '..', '..')

// MEMORIA-01, the four migrations of the conversational memory as an UPGRADE of a database that
// already has conversations, on a DISPOSABLE PostgreSQL 16 (TUS_MIGRATIONS_PG_ADMIN_URL: a server
// where the user may CREATE DATABASE; never a shared or production one).
// 20261102100000 numbers the existing messages with one UPDATE:
//   A. the numbering is deterministic (creation date, then id), without gaps or duplicates;
//   B. no other column of any message changes, and no other table changes;
//   C. new messages continue the sequence; on an empty table the first one is 1;
//   D. the column is NOT NULL with its default, unique and indexed with the conversation;
//   E. a second deploy is a no-op;
//   F. with a large history it still finishes in seconds (it holds the table locked meanwhile).
const adminUrl = process.env.TUS_MIGRATIONS_PG_ADMIN_URL
const MEMORIA = ['20261102100000_tus_memoria_historial_canonico', '20261103100000_tus_memoria_resumenes', '20261104100000_tus_memoria_fragmentos', '20261105100000_tus_memoria_hechos']
const VOLUMEN = 200_000

const migrar = (url) => spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, encoding: 'utf8', timeout: 480000 })

// The database as the release before the memory left it: same schema, same history, the four
// migrations pending. Only ever run on the disposable databases this test creates.
async function volverALaVersionAnterior(db) {
  await db.query('DROP TABLE public."hechos_memoria", public."fragmentos_memoria", public."resumenes_conversacion"')
  await db.query('DROP INDEX public."ix_rag_embedding_tenant_workspace"')
  await db.query('ALTER TABLE public."mensajes_conversacion_whatsapp" DROP COLUMN "secuencia"')
  await db.query('DROP SEQUENCE IF EXISTS public."mensajes_conversacion_whatsapp_secuencia_seq"')
  await db.query('DELETE FROM _prisma_migrations WHERE migration_name = ANY($1)', [MEMORIA])
}

const sembrarConversacion = (db, id) => db.query(`INSERT INTO public."contactos_whatsapp" ("id","wa_id","fecha_creacion") VALUES ($1, $2, now())`, [`contacto-${id}`, `54937940000${id}`]).then(() => db.query(`INSERT INTO public."conversaciones_whatsapp" ("id","contacto_id","estado","modo","abierta_en","ultimo_mensaje_en","estado_conversacional") VALUES ($1, $2, 'active', 'bot', now(), now(), '{}'::jsonb)`, [`conversacion-${id}`, `contacto-${id}`]))

// `cantidad` messages spread over two conversations, inserted in an order that is NOT the order
// of their dates, with many dates repeated (the id decides those).
const sembrarMensajes = (db, cantidad) => db.query(
  `INSERT INTO public."mensajes_conversacion_whatsapp" ("id","conversacion_id","contacto_id","direccion","tipo","texto","estado","actor","metadata","correlacion_id","fecha_creacion")
   SELECT 'mensaje-' || lpad(n::text, 7, '0'), 'conversacion-' || (1 + n % 2), 'contacto-' || (1 + n % 2), CASE WHEN n % 2 = 0 THEN 'inbound' ELSE 'outbound' END, 'text', 'texto ' || n, 'processed', 'contact', '{}'::jsonb, 'corr',
          timestamp '2026-01-01' + ((n * 7919) % (${cantidad} / 4 + 1)) * interval '1 second'
     FROM generate_series(1, ${cantidad}) AS n`
)

const huellaDeMensajes = async (db) => (await db.query(`SELECT count(*)::int AS n, md5(string_agg(md5(concat_ws('|', "id","conversacion_id","contacto_id","wamid","direccion","tipo","texto","estado","actor","metadata"::text,"correlacion_id","fecha_creacion"::text)), '' ORDER BY "id")) AS h FROM public."mensajes_conversacion_whatsapp"`)).rows[0]
const huellaDelResto = async (db) => {
  const tablas = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows.map((row) => row.table_name)
  const resultado = {}
  for (const tabla of tablas) {
    if (['mensajes_conversacion_whatsapp', '_prisma_migrations', 'hechos_memoria', 'fragmentos_memoria', 'resumenes_conversacion'].includes(tabla)) continue
    resultado[tabla] = (await db.query(`SELECT count(*)::int AS n FROM public."${tabla}"`)).rows[0].n
  }
  return resultado
}

test(
  'MEMORIA migraciones PG16: as an upgrade over existing conversations the messages are numbered deterministically, without duplicates, changing nothing else; new messages continue the sequence; a second deploy is a no-op; a large history is numbered in seconds',
  { skip: !adminUrl && 'TUS_MIGRATIONS_PG_ADMIN_URL not set (disposable PostgreSQL 16 only)', timeout: 900000 },
  async () => {
    const sufijo = Date.now().toString(36)
    const bases = { mejora: `tus_memoria_mejora_${sufijo}`, vacia: `tus_memoria_vacia_${sufijo}`, grande: `tus_memoria_grande_${sufijo}` }
    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    const urlDe = (database) => { const url = new URL(adminUrl); url.pathname = `/${database}`; return url.toString() }
    const clientes = []
    const conectar = async (database) => { const client = new Client({ connectionString: urlDe(database) }); await client.connect(); clientes.push(client); return client }
    const preparar = async (database) => {
      await admin.query(`CREATE DATABASE ${database}`)
      const completa = migrar(urlDe(database))
      assert.equal(completa.status, 0, `migrate-deploy failed:\n${(completa.stdout + completa.stderr).slice(-1500)}`)
      const db = await conectar(database)
      await volverALaVersionAnterior(db)
      return db
    }
    const carpetas = readdirSync(join(root, 'apps/api/prisma/migrations'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    const historial = async (db) => (await db.query(`SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL ORDER BY migration_name`)).rows.map((row) => row.migration_name)
    try {
      // ---- Existing history ------------------------------------------------------------------
      const db = await preparar(bases.mejora)
      assert.deepEqual(await historial(db), carpetas.filter((name) => !MEMORIA.includes(name)), 'the history of the previous release')
      await sembrarConversacion(db, 1); await sembrarConversacion(db, 2)
      await sembrarMensajes(db, 500)
      const antes = await huellaDeMensajes(db); const restoAntes = await huellaDelResto(db)
      const mejora = migrar(urlDe(bases.mejora))
      assert.equal(mejora.status, 0, `migrate-deploy (upgrade) failed:\n${(mejora.stdout + mejora.stderr).slice(-1500)}`)
      assert.deepEqual(await historial(db), carpetas, 'the four migrations are applied')
      const numeracion = (await db.query(`SELECT count(*)::int AS total, count("secuencia")::int AS numerados, count(DISTINCT "secuencia")::int AS distintos, min("secuencia")::int AS primero, max("secuencia")::int AS ultimo FROM public."mensajes_conversacion_whatsapp"`)).rows[0]
      assert.deepEqual(numeracion, { total: 500, numerados: 500, distintos: 500, primero: 1, ultimo: 500 }, 'A. every message is numbered once, 1..N without gaps')
      const orden = (await db.query(`SELECT bool_and(esperado = "secuencia") AS igual FROM (SELECT "secuencia", row_number() OVER (ORDER BY "fecha_creacion", "id") AS esperado FROM public."mensajes_conversacion_whatsapp") AS x`)).rows[0]
      assert.equal(orden.igual, true, 'A. the order is the creation date and then the id: the same on every run')
      const repetidas = (await db.query(`SELECT count(*)::int AS n FROM (SELECT "fecha_creacion" FROM public."mensajes_conversacion_whatsapp" GROUP BY 1 HAVING count(*) > 1) AS x`)).rows[0].n
      assert.ok(repetidas > 0, 'the fixture really has messages with the same date')
      assert.deepEqual(await huellaDeMensajes(db), antes, 'B. no other column of any message changed')
      assert.deepEqual(await huellaDelResto(db), restoAntes, 'B. no other table gained or lost rows')
      // C. A message stored afterwards, by code that knows nothing about the column.
      await db.query(`INSERT INTO public."mensajes_conversacion_whatsapp" ("id","conversacion_id","contacto_id","direccion","tipo","estado","actor","metadata","correlacion_id","fecha_creacion") VALUES ('nuevo-1','conversacion-1','contacto-1','inbound','text','received','contact','{}'::jsonb,'corr', timestamp '2020-01-01')`)
      assert.equal((await db.query(`SELECT "secuencia"::int AS s FROM public."mensajes_conversacion_whatsapp" WHERE "id" = 'nuevo-1'`)).rows[0].s, 501, 'C. a new message continues the sequence whatever its date')
      // D. The column and its indexes.
      const columna = (await db.query(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'mensajes_conversacion_whatsapp' AND column_name = 'secuencia'`)).rows[0]
      assert.equal(columna.is_nullable, 'NO'); assert.match(columna.column_default, /nextval/u)
      const indices = (await db.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'mensajes_conversacion_whatsapp' AND indexname LIKE '%secuencia%' ORDER BY 1`)).rows.map((row) => row.indexname)
      assert.deepEqual(indices, ['ix_mensajes_conversacion_whatsapp_secuencia', 'uq_mensajes_conversacion_whatsapp_secuencia'], 'D. unique, and indexed with the conversation')
      const validos = (await db.query(`SELECT count(*)::int AS n FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname LIKE '%mensajes_conversacion_whatsapp_secuencia' AND i.indisvalid`)).rows[0].n
      assert.equal(validos, 2, 'D. both indexes are valid')
      // E. Again.
      const numerosAntes = (await db.query(`SELECT md5(string_agg("id" || ':' || "secuencia", ',' ORDER BY "id")) AS h FROM public."mensajes_conversacion_whatsapp"`)).rows[0].h
      const otraVez = migrar(urlDe(bases.mejora))
      assert.equal(otraVez.status, 0)
      assert.match(otraVez.stdout, /nothing to apply/u, 'E. the second deploy applies nothing')
      assert.equal((await db.query(`SELECT md5(string_agg("id" || ':' || "secuencia", ',' ORDER BY "id")) AS h FROM public."mensajes_conversacion_whatsapp"`)).rows[0].h, numerosAntes, 'E. and no number moves')

      // ---- Empty table -----------------------------------------------------------------------
      const vacia = await preparar(bases.vacia)
      assert.equal(migrar(urlDe(bases.vacia)).status, 0)
      await sembrarConversacion(vacia, 1)
      await vacia.query(`INSERT INTO public."mensajes_conversacion_whatsapp" ("id","conversacion_id","contacto_id","direccion","tipo","estado","actor","metadata","correlacion_id","fecha_creacion") VALUES ('primero','conversacion-1','contacto-1','inbound','text','received','contact','{}'::jsonb,'corr', now()), ('segundo','conversacion-1','contacto-1','outbound','text','sent','assistant','{}'::jsonb,'corr', now())`)
      assert.deepEqual((await vacia.query(`SELECT "secuencia"::int AS s FROM public."mensajes_conversacion_whatsapp" ORDER BY "secuencia"`)).rows.map((row) => row.s), [1, 2], 'C. on an empty table the first message is 1')

      // ---- A large history -------------------------------------------------------------------
      const grande = await preparar(bases.grande)
      await sembrarConversacion(grande, 1); await sembrarConversacion(grande, 2)
      await sembrarMensajes(grande, VOLUMEN)
      const inicio = Date.now()
      const conVolumen = migrar(urlDe(bases.grande))
      const segundos = (Date.now() - inicio) / 1000
      assert.equal(conVolumen.status, 0, `migrate-deploy (large) failed:\n${(conVolumen.stdout + conVolumen.stderr).slice(-1500)}`)
      const total = (await grande.query(`SELECT count(*)::int AS total, count(DISTINCT "secuencia")::int AS distintos, max("secuencia")::int AS ultimo FROM public."mensajes_conversacion_whatsapp"`)).rows[0]
      assert.deepEqual(total, { total: VOLUMEN, distintos: VOLUMEN, ultimo: VOLUMEN })
      console.log(`[memoria-migracion] ${VOLUMEN} messages numbered; the whole deploy of the four migrations took ${segundos.toFixed(1)} s`)
      assert.ok(segundos < 120, `F. ${VOLUMEN} messages: the deploy took ${segundos.toFixed(1)} s`)
    } finally {
      for (const client of clientes) await client.end().catch(() => {})
      for (const database of Object.values(bases)) await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => {})
      await admin.end()
    }
  }
)
