import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { Client } = require('../../apps/api/node_modules/pg')

// Regression of the production failure of 2026-09-30 (P3009 / 42P17): the Turnos migration built
// the exclusion constraint of `reservas` with tstzrange() over `timestamp WITHOUT time zone`
// columns; the implicit cast depends on TimeZone (STABLE) and PostgreSQL refuses it in an index
// expression. This test runs the REAL migration chain on a new database of a DISPOSABLE
// PostgreSQL 16 (TUS_MIGRATIONS_PG_ADMIN_URL: a server where the user may CREATE DATABASE;
// never a shared or production server) and then checks types, constraint definitions and the
// real concurrent behaviour of Turnos and Alojamientos.
const adminUrl = process.env.TUS_MIGRATIONS_PG_ADMIN_URL
// Exactly one concurrent insert survives. The loser gets 23P01 (exclusion violation) or, when both
// inserts wait on each other inside the gist index, 40P01 (deadlock detected): PostgreSQL still
// keeps only one row, and the Turnos/Alojamientos services map both codes to 409 SLOT_OCCUPIED.
function assertUnGanador(resultados) {
  assert.equal(resultados.filter((r) => r === 'ok').length, 1, `exactly one wins: ${resultados}`)
  assert.ok(resultados.filter((r) => r !== 'ok').every((r) => r === '23P01' || r === '40P01'), `the loser is a conflict: ${resultados}`)
}
const root = join(import.meta.dirname, '..', '..')

test(
  'MIGRATIONS PG16: Turnos uses tsrange over timestamp columns (tstzrange fails with 42P17); Alojamientos keeps tstzrange over timestamptz; both constraints reject concurrent overlaps',
  { skip: !adminUrl && 'TUS_MIGRATIONS_PG_ADMIN_URL not set (disposable PostgreSQL 16 only)', timeout: 600000 },
  async () => {
    const database = `tus_rangos_${Date.now().toString(36)}`
    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${database}`)
    const url = new URL(adminUrl)
    url.pathname = `/${database}`
    const clients = []
    const connect = async () => { const client = new Client({ connectionString: url.toString() }); await client.connect(); clients.push(client); return client }
    try {
      // 1. The whole migration chain, through the same script the deploy uses.
      const migrate = spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString() }, encoding: 'utf8', timeout: 480000 })
      assert.equal(migrate.status, 0, `migrate-deploy failed:\n${(migrate.stdout + migrate.stderr).slice(-1500)}`)
      const db = await connect()
      const migrations = (await db.query(`SELECT migration_name, finished_at IS NOT NULL AS ok FROM _prisma_migrations WHERE rolled_back_at IS NULL`)).rows
      assert.ok(migrations.every((row) => row.ok), 'every migration finished')
      for (const name of ['20261017100000_tus_turnos_modalidades_concurrencia', '20261018100000_tus_alojamientos_concurrencia'])
        assert.ok(migrations.some((row) => row.migration_name === name), `${name} applied`)

      // 2. Column types decide the range function.
      const types = Object.fromEntries((await db.query(`SELECT table_name || '.' || column_name AS c, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('reservas', 'reservas_alojamiento') AND column_name IN ('fecha_inicio', 'fecha_fin')`)).rows.map((row) => [row.c, row.data_type]))
      assert.equal(types['reservas.fecha_inicio'], 'timestamp without time zone')
      assert.equal(types['reservas.fecha_fin'], 'timestamp without time zone')
      assert.equal(types['reservas_alojamiento.fecha_inicio'], 'timestamp with time zone')
      assert.equal(types['reservas_alojamiento.fecha_fin'], 'timestamp with time zone')
      const def = async (name) => (await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = $1`, [name])).rows[0]?.d ?? ''
      const turnos = await def('ex_reservas_sin_solapamiento')
      const alojamientos = await def('ex_reservas_alojamiento_sin_solapamiento')
      assert.match(turnos, /EXCLUDE USING gist \(calendario_id WITH =, tsrange\(fecha_inicio, fecha_fin/u)
      assert.doesNotMatch(turnos, /tstzrange/u)
      assert.match(alojamientos, /EXCLUDE USING gist \(unidad_id WITH =, tstzrange\(fecha_inicio, fecha_fin/u)

      // 3. Negative control on the REAL table: the old expression still fails with 42P17, so a
      //    regression to tstzrange would break the chain above (and this assertion documents why).
      await db.query('BEGIN')
      const viejo = await db.query(`ALTER TABLE public."reservas" ADD CONSTRAINT "ex_regresion_tstzrange" EXCLUDE USING gist ("calendario_id" WITH =, tstzrange("fecha_inicio", "fecha_fin", '[)') WITH &&)`).then(() => 'ok', (error) => error.code)
      await db.query('ROLLBACK')
      assert.equal(viejo, '42P17')

      // 4. Turnos: two concurrent overlapping bookings of one calendar -> exactly one wins.
      await db.query(`INSERT INTO "TusTenant"(id, slug, name, status, "createdAt", "updatedAt") VALUES ('t-rangos', 't-rangos', 'Rangos', 'active', now(), now())`)
      await db.query(`INSERT INTO calendarios(id, tenant_id, servicio_id, nombre, zona_horaria, estado, fecha_creacion, fecha_actualizacion) VALUES ('cal-1', 't-rangos', 'masajes', 'Agenda', 'America/Argentina/Buenos_Aires', 'active', now(), now())`)
      let seq = 0
      const reserva = (client, inicio, fin, estado = 'confirmed') => {
        seq += 1
        return client.query(`INSERT INTO reservas(id, tenant_id, reserva_id, calendario_id, cliente_id, fecha_inicio, fecha_fin, estado, version, fecha_creacion, fecha_actualizacion) VALUES ($1, 't-rangos', $1, 'cal-1', 'cliente', $2, $3, $4, 1, now(), now())`, [`r-${seq}`, inicio, fin, estado]).then(() => 'ok', (error) => error.code)
      }
      const [a, b] = await Promise.all([connect(), connect()])
      const carrera = await Promise.all([reserva(a, '2026-10-20 10:00', '2026-10-20 11:00'), reserva(b, '2026-10-20 10:30', '2026-10-20 11:30')])
      assertUnGanador(carrera)
      assert.equal(await reserva(db, '2026-10-21 10:00', '2026-10-21 11:00'), 'ok')
      assert.equal(await reserva(db, '2026-10-21 11:00', '2026-10-21 12:00'), 'ok', 'adjacent [) ranges do not overlap')
      for (const estado of ['cancelled', 'cancelled-late', 'no-show'])
        assert.equal(await reserva(db, '2026-10-20 10:15', '2026-10-20 10:45', estado), 'ok', `${estado} is outside the constraint`)
      assert.equal(await reserva(db, '2026-10-20 10:15', '2026-10-20 10:45', 'completed'), '23P01', 'completed still occupies the slot')

      // 5. Alojamientos: two concurrent overlapping stays of one unit -> exactly one wins.
      const tipo = (await db.query(`SELECT id FROM tipos_alojamiento ORDER BY id LIMIT 1`)).rows[0].id
      await db.query(`INSERT INTO alojamientos(id, tipo_id, nombre, slug, direccion, latitud, longitud) VALUES ('al-1', $1, 'Casa', 'casa-rangos', 'Sin dirección real', -27.46, -58.83)`, [tipo])
      await db.query(`INSERT INTO unidades_alojamiento(id, alojamiento_id, nombre) VALUES ('u-1', 'al-1', 'Habitación 1')`)
      const estadia = (client, id, inicio, fin, estado) => client.query(`INSERT INTO reservas_alojamiento(id, unidad_id, alojamiento_id, cliente_nombre, fecha_inicio, fecha_fin, modalidad, precio_lista_snapshot, precio_final_snapshot${estado ? ', estado' : ''}) VALUES ($1, 'u-1', 'al-1', 'Cliente prueba', $2, $3, 'noche', 1000, 1000${estado ? ', $4' : ''})`, estado ? [id, inicio, fin, estado] : [id, inicio, fin]).then(() => 'ok', (error) => error.code)
      const doble = await Promise.all([estadia(a, 'e-1', '2026-11-01T14:00:00-03', '2026-11-03T10:00:00-03', 'confirmed'), estadia(b, 'e-2', '2026-11-02T14:00:00-03', '2026-11-04T10:00:00-03', 'confirmed')])
      assertUnGanador(doble)
      assert.equal(await estadia(db, 'e-3', '2026-11-02T14:00:00-03', '2026-11-04T10:00:00-03', 'cancelled'), 'ok', 'a cancelled stay does not occupy the unit')
    } finally {
      for (const client of clients) await client.end().catch(() => undefined)
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => undefined)
      await admin.end()
    }
  }
)
