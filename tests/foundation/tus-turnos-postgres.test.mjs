import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Client } = require('../../apps/api/node_modules/pg')

const PG_URL = process.env.DATABASE_URL || 'postgresql://factory_user:factory_password@localhost:5432/factory_local'

test('TURNOS CONCURRENCIA: exclusion constraint btree_gist en PostgreSQL 16 previene solapamiento de reservas en el mismo calendario', async (t) => {
  const client = new Client({ connectionString: PG_URL })
  try {
    await client.connect()
  } catch (err) {
    t.skip(`PostgreSQL descartable no disponible en ${PG_URL}`)
    return
  }

  const schemaName = `turnos_concurrencia_${Date.now()}`

  try {
    // 1. Crear schema descartable y habilitar extension btree_gist
    await client.query(`CREATE SCHEMA ${schemaName}`)
    await client.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`)

    // 2. Crear tabla reservas con la constraint de exclusion exacta de la migracion
    await client.query(`
      CREATE TABLE ${schemaName}."reservas" (
        "id" text NOT NULL PRIMARY KEY,
        "calendario_id" text NOT NULL,
        "fecha_inicio" timestamptz(3) NOT NULL,
        "fecha_fin" timestamptz(3) NOT NULL,
        "estado" text NOT NULL,
        "precio_final" bigint,
        "cliente_nombre" text,
        CONSTRAINT "ex_reservas_sin_solapamiento"
        EXCLUDE USING gist (
          "calendario_id" WITH =,
          tstzrange("fecha_inicio", "fecha_fin", '[)') WITH &&
        )
        WHERE ("estado" NOT IN ('cancelled', 'cancelled-late', 'no-show'))
      );
    `)

    // 3. Simular dos reservas concurrentes exactamente en el mismo horario y calendario
    const calId = 'cal-concurrente-1'
    const inicio = '2026-10-20T14:00:00.000Z'
    const fin = '2026-10-20T15:00:00.000Z'

    const c1 = new Client({ connectionString: PG_URL })
    const c2 = new Client({ connectionString: PG_URL })
    await Promise.all([c1.connect(), c2.connect()])

    const ejecutar = async (c, id, clienteNombre) => {
      try {
        await c.query(`
          INSERT INTO ${schemaName}."reservas" (
            "id", "calendario_id", "fecha_inicio", "fecha_fin", "estado", "precio_final", "cliente_nombre"
          ) VALUES ($1, $2, $3, $4, 'confirmed', 25000, $5)
        `, [id, calId, inicio, fin, clienteNombre])
        return { ok: true, id }
      } catch (err) {
        return { ok: false, code: err.code, message: err.message }
      }
    }

    const [res1, res2] = await Promise.all([
      ejecutar(c1, 'res-1', 'Cliente A'),
      ejecutar(c2, 'res-2', 'Cliente B')
    ])
    await Promise.all([c1.end(), c2.end()])

    // Exactamente una debe ganar y una debe ser rechazada por exclusion_violation (23P01)
    const exitosas = [res1, res2].filter(r => r.ok)
    const fallidas = [res1, res2].filter(r => !r.ok)

    assert.equal(exitosas.length, 1, 'Exactamente una reserva debe confirmarse')
    assert.equal(fallidas.length, 1, 'Exactamente una reserva debe ser rechazada')
    assert.ok(
      ['23P01', '40P01'].includes(fallidas[0].code),
      `El codigo de error PostgreSQL debe ser 23P01 (exclusion_violation) o 40P01 (deadlock en GiST concurrente). Obtenido: ${fallidas[0].code}`
    )
    assert.ok(
      /ex_reservas_sin_solapamiento|deadlock/i.test(fallidas[0].message),
      'Debe indicar violacion de exclusion o conflicto de concurrencia'
    )

    // 4. Comprobar que si la reserva se cancela, el slot queda libre para una nueva reserva
    const ganadoraId = exitosas[0].id
    await client.query(`UPDATE ${schemaName}."reservas" SET "estado" = 'cancelled' WHERE "id" = $1`, [ganadoraId])

    const res3 = await ejecutar(client, 'res-3', 'Cliente C (reintento tras cancelacion)')
    assert.equal(res3.ok, true, 'Tras cancelar, la constraint WHERE excluye la fila cancelada y permite la nueva reserva')

    // 5. Verificar conteo final
    const countRes = await client.query(`SELECT COUNT(*) FROM ${schemaName}."reservas"`)
    assert.equal(Number(countRes.rows[0].count), 2) // 1 cancelada + 1 activa
  } finally {
    // Destruir schema descartable completamente
    await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
    await client.end()
  }
})
