import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

const require = createRequire(import.meta.url)
const { Client } = require('../../apps/api/node_modules/pg')
const root = join(import.meta.dirname, '..', '..')

// PRECIOS-INICIALES-01 on a DISPOSABLE PostgreSQL 16 (TUS_MIGRATIONS_PG_ADMIN_URL: a server where
// the user may CREATE DATABASE; never a shared or production one). The data migration that leaves
// every CURRENT service at ARS $200:
//   A. applies on a database built from scratch (and creates nothing there);
//   B. applies as an upgrade over a database at the previous release with real rows;
//   C. leaves the current prices at 200 (whole pesos, the unit TUS stores);
//   D. changes no historical snapshot (the price stored on a reservation, nor any other table);
//   E. creates no provider-service relation that did not exist;
//   F. duplicates nothing and is a no-op the second time;
//   G. is the price the assistant reads, with the deposit computed by the backend.
const adminUrl = process.env.TUS_MIGRATIONS_PG_ADMIN_URL
const MIGRACION = '20261101100000_tus_precios_iniciales_servicios'
const DIRECTORIO = join(root, 'apps/api/prisma/migrations')

const migrar = (url) => spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, encoding: 'utf8', timeout: 480000 })

// Every table of `public` except the two the migration is allowed to write (and Prisma's own
// history), as a count and a hash of its rows: what must be byte-for-byte the same afterwards.
async function huella(db) {
  const tablas = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows.map((row) => row.table_name)
  const resultado = {}
  for (const tabla of tablas) {
    if (['perfil_servicios', 'tarifas_servicio_prestador', '_prisma_migrations'].includes(tabla)) continue
    const fila = (await db.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(md5(t::text), '' ORDER BY md5(t::text)), '')) AS h FROM public."${tabla}" t`)).rows[0]
    resultado[tabla] = `${fila.n}:${fila.h}`
  }
  return resultado
}

const precios = async (db) => ({
  servicios: (await db.query(`SELECT perfil_id, oficio_id, precio_base::text AS precio FROM public."perfil_servicios" ORDER BY perfil_id, oficio_id`)).rows,
  tarifas: (await db.query(`SELECT id, perfil_id, oficio_id, nombre, precio::text AS precio, activo, fecha_actualizacion FROM public."tarifas_servicio_prestador" ORDER BY id`)).rows,
})

test(
  'PRECIOS PG16: the data migration leaves every current service at ARS $200 (fresh and upgrade), creates no relation, duplicates nothing, touches no historical snapshot, and is what the assistant reads',
  { skip: !adminUrl && 'TUS_MIGRATIONS_PG_ADMIN_URL not set (disposable PostgreSQL 16 only)', timeout: 900000 },
  async () => {
    const sufijo = Date.now().toString(36)
    const bases = { fresca: `tus_precios_fresca_${sufijo}`, mejora: `tus_precios_mejora_${sufijo}` }
    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    const urlDe = (database) => { const url = new URL(adminUrl); url.pathname = `/${database}`; return url.toString() }
    const clientes = []
    const conectar = async (database) => { const client = new Client({ connectionString: urlDe(database) }); await client.connect(); clientes.push(client); return client }
    try {
      for (const database of Object.values(bases)) await admin.query(`CREATE DATABASE ${database}`)

      // ---- A. From scratch: the whole chain, through the script the deploy uses. ----------------
      const fresca = migrar(urlDe(bases.fresca))
      assert.equal(fresca.status, 0, `migrate-deploy (fresh) failed:\n${(fresca.stdout + fresca.stderr).slice(-1500)}`)
      const dbFresca = await conectar(bases.fresca)
      const historial = (await dbFresca.query(`SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL ORDER BY migration_name`)).rows.map((row) => row.migration_name)
      const carpetas = readdirSync(DIRECTORIO, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
      assert.deepEqual(historial, carpetas, 'every migration of the repository is applied, the new one included')
      assert.equal(historial.at(-1), MIGRACION, 'it is the last migration of the chain')
      const vacia = await precios(dbFresca)
      assert.deepEqual([vacia.servicios.length, vacia.tarifas.length], [0, 0], 'on a new database there is no current service: nothing is created')
      // No default was added: a service created later has no price until its provider sets one.
      const defectos = (await dbFresca.query(`SELECT table_name, column_name, column_default FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'perfil_servicios' AND column_name = 'precio_base') OR (table_name = 'tarifas_servicio_prestador' AND column_name = 'precio'))`)).rows
      assert.deepEqual(defectos.map((row) => row.column_default), [null, null], '$200 is not a permanent default for future services')

      // ---- B. Upgrade: a database at the PREVIOUS release, with real rows. ---------------------
      // The migration only writes data, so the schema of the previous release is the same one:
      // the chain is applied and the new migration is taken out of the history, which leaves the
      // database exactly as production is today (same schema, same history, the migration pending).
      const previa = migrar(urlDe(bases.mejora))
      assert.equal(previa.status, 0, `migrate-deploy (previous release) failed:\n${(previa.stdout + previa.stderr).slice(-1500)}`)
      const db = await conectar(bases.mejora)
      await db.query(`DELETE FROM _prisma_migrations WHERE migration_name = $1`, [MIGRACION])
      const antesDeMigrar = (await db.query(`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`)).rows.map((row) => row.migration_name)
      assert.deepEqual(antesDeMigrar, carpetas.filter((name) => name !== MIGRACION), 'the history of the previous release')

      const sembrado = runTypeScriptScenario(`
        const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
        const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(urlDe(bases.mejora))}, errorFormat: 'minimal' })
        const { createPrismaAuthService } = await import('./apps/api/src/auth-security/composition.ts')
        const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
        const out = {}
        try {
          const auth = createPrismaAuthService(prisma)
          const turnos = new ServicioTurnos(prisma)
          const [uno, dos] = await prisma.oficioServicio.findMany({ where: { activo: true }, orderBy: { orden: 'asc' }, take: 2 })
          const ahora = new Date()
          await prisma.oficioServicio.create({ data: { id: 'oficio-inactivo', nombre: 'Oficio dado de baja', profesion: 'Baja', slug: 'oficio-inactivo', icono: 'herramienta', activo: false, orden: 90, creadoEn: ahora, actualizadoEn: ahora } })
          async function prestador(tag, servicios) {
            const tenantId = 'tenant-' + tag
            await prisma.tusTenant.create({ data: { id: tenantId, slug: tenantId, name: tag, status: 'active', createdAt: ahora, updatedAt: ahora } })
            await prisma.prestador.create({ data: { id: 'p-' + tag, tenantId, prestadorId: 'prestador-' + tag, cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
            await prisma.perfilPublicoPrestador.create({ data: { id: 'perfil-' + tag, tenantId, prestadorId: 'prestador-' + tag, nombrePublico: 'Prestador ' + tag, oficio: servicios[0].oficioId, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: servicios.map((servicio, orden) => ({ ...servicio, orden, duracionMinutos: 60 })) } } })
            return { tenantId, perfilId: 'perfil-' + tag }
          }
          const tarifa = (id, perfil, oficioId, precio, activo = true) => prisma.tarifaServicioPrestador.create({ data: { id, tenantId: perfil.tenantId, perfilId: perfil.perfilId, oficioId, nombre: id, duracionMinutos: 60, precio, activo, orden: 0, fechaActualizacion: new Date('2026-01-01T00:00:00.000Z') } })
          // a: a service with no price and variants (one priced, one at zero, one inactive); a second
          //    service with its own base price; and a service of a trade that was deactivated.
          const a = await prestador('a', [{ oficioId: uno.id, precioBase: null }, { oficioId: dos.id, precioBase: 15000n }, { oficioId: 'oficio-inactivo', precioBase: 7000n }])
          await tarifa('tarifa-a-activa', a, uno.id, 18000n)
          await tarifa('tarifa-a-cero', a, uno.id, 0n)
          await tarifa('tarifa-a-inactiva', a, uno.id, 9000n, false)
          await tarifa('tarifa-a-oficio-inactivo', a, 'oficio-inactivo', 7000n)
          // b: one service at zero, no variants. It does NOT offer the second trade.
          const b = await prestador('b', [{ oficioId: uno.id, precioBase: 0n }])
          // c: one service with a real base price, and a turno already requested at that price.
          const c = await prestador('c', [{ oficioId: uno.id, precioBase: 15000n }])
          const cliente = (await auth.service.registerAccount({ email: 'cliente-precios@example.com', password: 'una frase larga y segura 2026', displayName: 'Cliente Precios' })).created.account
          const dia = (() => { const d = new Date(Date.now() - 3 * 3600_000 + 2 * 86400_000); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
          const reserva = await turnos.reservarTurno({ prestadorId: c.perfilId, oficioId: uno.id, inicio: new Date(dia + 'T10:00:00.000-03:00').toISOString(), clienteId: cliente.id, clienteTenantId: cliente.tenantId })
          out.reserva = [reserva.id, reserva.precioFinal]
          out.oficios = [uno.id, dos.id]
        } finally { await prisma.$disconnect() }
        console.log(JSON.stringify(out))
      `)
      const [uno, dos] = sembrado.oficios
      assert.equal(sembrado.reserva[1], 15000, 'the turno was requested at the price of that moment')

      const antes = await precios(db)
      const huellaAntes = await huella(db)
      const reservaAntes = (await db.query(`SELECT to_jsonb(r) AS fila FROM public."reservas" r WHERE r.id = $1`, [sembrado.reserva[0]])).rows[0].fila
      assert.equal(Number(reservaAntes.precio_final), 15000)

      const mejora = migrar(urlDe(bases.mejora))
      assert.equal(mejora.status, 0, `migrate-deploy (upgrade) failed:\n${(mejora.stdout + mejora.stderr).slice(-1500)}`)
      assert.match(mejora.stdout, /1 pending migration\(s\)/u, 'only the new migration was pending')
      const aplicada = (await db.query(`SELECT finished_at IS NOT NULL AS ok FROM _prisma_migrations WHERE migration_name = $1 AND rolled_back_at IS NULL`, [MIGRACION])).rows
      assert.deepEqual(aplicada, [{ ok: true }])

      // ---- C. The current prices are 200 (whole pesos). ----------------------------------------
      const despues = await precios(db)
      const base = Object.fromEntries(despues.servicios.map((row) => [`${row.perfil_id}/${row.oficio_id}`, row.precio]))
      assert.deepEqual(base, {
        [`perfil-a/${uno}`]: '200', // had no price
        [`perfil-a/${dos}`]: '200', // had 15000
        'perfil-a/oficio-inactivo': '7000', // a deactivated trade is not touched
        [`perfil-b/${uno}`]: '200', // had 0
        [`perfil-c/${uno}`]: '200', // had 15000
      })
      const variantes = Object.fromEntries(despues.tarifas.map((row) => [row.id, row.precio]))
      assert.deepEqual(variantes, { 'tarifa-a-activa': '200', 'tarifa-a-cero': '200', 'tarifa-a-inactiva': '9000', 'tarifa-a-oficio-inactivo': '7000' }, 'active variants of active trades; an inactive variant and a deactivated trade keep their price')

      // ---- E / F. No relation created, nothing duplicated. --------------------------------------
      assert.deepEqual(despues.servicios.map((row) => `${row.perfil_id}/${row.oficio_id}`), antes.servicios.map((row) => `${row.perfil_id}/${row.oficio_id}`), 'the same provider-service pairs: none was created (b still does not offer the second trade)')
      assert.deepEqual(despues.tarifas.map((row) => row.id), antes.tarifas.map((row) => row.id), 'the same variants: none created, none duplicated')
      const intactas = (id) => String(despues.tarifas.find((row) => row.id === id).fecha_actualizacion) === String(antes.tarifas.find((row) => row.id === id).fecha_actualizacion)
      assert.deepEqual([intactas('tarifa-a-inactiva'), intactas('tarifa-a-oficio-inactivo'), intactas('tarifa-a-activa')], [true, true, false], 'rows out of scope are not even rewritten')

      // ---- D. No historical snapshot changed: every other table is identical. -------------------
      const huellaDespues = await huella(db)
      assert.deepEqual(huellaDespues, huellaAntes, 'no table but the two price tables changed (reservations, payments, obligations, ledger, earnings, payouts...)')
      assert.ok(Object.keys(huellaAntes).includes('reservas') && Object.keys(huellaAntes).length > 50, 'the comparison really covers the schema')
      const reservaDespues = (await db.query(`SELECT to_jsonb(r) AS fila FROM public."reservas" r WHERE r.id = $1`, [sembrado.reserva[0]])).rows[0].fila
      assert.deepEqual(reservaDespues, reservaAntes, 'the turno requested before keeps its price (15000), not the new one')

      // ---- F. Idempotent: the same statements again change no row; the deploy has nothing to do. -
      const sentencias = readFileSync(join(DIRECTORIO, MIGRACION, 'migration.sql'), 'utf8').replace(/^--.*$/gmu, '').split(';').map((sql) => sql.trim()).filter(Boolean)
      assert.equal(sentencias.length, 2)
      for (const sql of sentencias) assert.equal((await db.query(sql)).rowCount, 0, 'a second run updates nothing')
      const otraVez = migrar(urlDe(bases.mejora))
      assert.equal(otraVez.status, 0)
      assert.match(otraVez.stdout, /nothing to apply/u)
      assert.deepEqual(await precios(db), despues)

      // ---- G. The price the assistant reads, and the deposit the backend derives from it. -------
      const leido = runTypeScriptScenario(`
        const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
        const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(urlDe(bases.mejora))}, errorFormat: 'minimal' })
        const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
        const { senaDePrecio } = await import('./apps/api/src/tus/calendar/turnos-sena.ts')
        const { DominioAsistenteTus } = await import('./apps/api/src/tus/asistente/dominio.ts')
        const { textoPrecio } = await import('./apps/api/src/tus/asistente/solicitud-turno.ts')
        const out = {}
        try {
          const dominio = new DominioAsistenteTus({}, Date.now, { turnos: new ServicioTurnos(prisma) })
          const ver = async (perfil, oficio) => { const servicio = await dominio.servicioDeTurno(perfil, oficio); return servicio ? servicio.options.map((opcion) => [opcion.tariffId, opcion.price]) : null }
          out.a = await ver('perfil-a', ${JSON.stringify(uno)})
          out.aSegundo = await ver('perfil-a', ${JSON.stringify(dos)})
          out.b = await ver('perfil-b', ${JSON.stringify(uno)})
          out.bNoOfrece = await ver('perfil-b', ${JSON.stringify(dos)})
          out.c = await ver('perfil-c', ${JSON.stringify(uno)})
          // The deposit is the domain's: half of the stored price, never a number of the assistant.
          out.sena = senaDePrecio(200)
          out.texto = textoPrecio({ tariffId: null, name: 'Servicio', durationMinutes: 60, price: 200, deposit: senaDePrecio(200) })
        } finally { await prisma.$disconnect() }
        console.log(JSON.stringify(out))
      `)
      assert.deepEqual(leido.a, [['tarifa-a-activa', 200], ['tarifa-a-cero', 200]], 'the active variants, each at $200')
      assert.deepEqual(leido.aSegundo, [[null, 200]])
      assert.deepEqual(leido.b, [[null, 200]])
      assert.equal(leido.bNoOfrece, null, 'a service the provider does not offer has no price')
      assert.deepEqual(leido.c, [[null, 200]])
      assert.equal(leido.sena, 100, 'the deposit of $200 is derived by the backend rule (50%)')
      assert.match(leido.texto, /^El servicio cuesta \$ ?200 y la seña es de \$ ?100\.$/u)
    } finally {
      for (const client of clientes) await client.end().catch(() => undefined)
      for (const database of Object.values(bases)) await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => undefined)
      await admin.end().catch(() => undefined)
    }
  }
)
