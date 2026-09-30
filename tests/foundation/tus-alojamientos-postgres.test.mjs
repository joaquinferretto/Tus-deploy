import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Client } = require('../../apps/api/node_modules/pg')

const PG_URL = process.env.DATABASE_URL || 'postgresql://factory_user:factory_password@localhost:5432/factory_local'

test('ALOJAMIENTOS CONCURRENCIA: exclusion constraint btree_gist en PostgreSQL 16 impide doble reserva y solapamiento de holds', async (t) => {
  const client = new Client({ connectionString: PG_URL })
  try {
    await client.connect()
  } catch (err) {
    t.skip(`PostgreSQL descartable no disponible en ${PG_URL}`)
    return
  }

  const schemaName = `alojamientos_concurrencia_${Date.now()}`

  try {
    // 1. Crear schema descartable y habilitar extensión btree_gist
    await client.query(`CREATE SCHEMA ${schemaName}`)
    await client.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`)

    // 2. Crear tabla reservas_alojamiento con la constraint física exacta de la migración
    await client.query(`
      CREATE TABLE ${schemaName}."reservas_alojamiento" (
        "id" text NOT NULL PRIMARY KEY,
        "unidad_id" text NOT NULL,
        "alojamiento_id" text NOT NULL,
        "cliente_nombre" text NOT NULL,
        "fecha_inicio" timestamptz(3) NOT NULL,
        "fecha_fin" timestamptz(3) NOT NULL,
        "modalidad" text NOT NULL,
        "precio_final_snapshot" bigint NOT NULL,
        "estado" text NOT NULL,
        "hold_expiracion" timestamptz(3),
        CONSTRAINT "ex_reservas_alojamiento_sin_solapamiento"
        EXCLUDE USING gist (
          "unidad_id" WITH =,
          tstzrange("fecha_inicio", "fecha_fin", '[)') WITH &&
        )
        WHERE ("estado" IN ('pending_payment', 'confirmed', 'checked_in'))
      );
    `)

    // 3. Simular dos reservas/holds concurrentes para la misma unidad y período solapado
    const unidadId = 'uni-cabana-1'
    const alojId = 'aloj-cabanas-del-valle'
    const inicio = '2026-11-01T14:00:00.000Z'
    const fin = '2026-11-05T10:00:00.000Z'

    const c1 = new Client({ connectionString: PG_URL })
    const c2 = new Client({ connectionString: PG_URL })
    await Promise.all([c1.connect(), c2.connect()])

    const ejecutarHold = async (c, id, clienteNombre) => {
      try {
        await c.query(`
          INSERT INTO ${schemaName}."reservas_alojamiento" (
            "id", "unidad_id", "alojamiento_id", "cliente_nombre", "fecha_inicio", "fecha_fin", "modalidad", "precio_final_snapshot", "estado", "hold_expiracion"
          ) VALUES ($1, $2, $3, $4, $5, $6, 'noche', 180000, 'pending_payment', NOW() + interval '15 minutes')
        `, [id, unidadId, alojId, clienteNombre, inicio, fin])
        return { ok: true, id }
      } catch (err) {
        return { ok: false, code: err.code, message: err.message }
      }
    }

    const [res1, res2] = await Promise.all([
      ejecutarHold(c1, 'res-aloj-1', 'Huésped Alpha'),
      ejecutarHold(c2, 'res-aloj-2', 'Huésped Beta')
    ])
    await Promise.all([c1.end(), c2.end()])

    const exitosas = [res1, res2].filter(r => r.ok)
    const fallidas = [res1, res2].filter(r => !r.ok)

    assert.equal(exitosas.length, 1, 'Exactamente una solicitud de hold/reserva debe tener éxito')
    assert.equal(fallidas.length, 1, 'Exactamente una solicitud concurrente debe ser rechazada')
    assert.ok(
      ['23P01', '40P01'].includes(fallidas[0].code),
      `El código de error PostgreSQL debe ser 23P01 (exclusion_violation) o 40P01 (deadlock en índice GiST). Obtenido: ${fallidas[0].code}`
    )
    assert.ok(
      /ex_reservas_alojamiento_sin_solapamiento|deadlock/i.test(fallidas[0].message),
      'Debe indicar violación de exclusión o conflicto de concurrencia física'
    )

    // 4. Si la reserva ganadora expira o se cancela, el slot queda libre de nuevo
    const ganadoraId = exitosas[0].id
    await client.query(`UPDATE ${schemaName}."reservas_alojamiento" SET "estado" = 'expired' WHERE "id" = $1`, [ganadoraId])

    const res3 = await ejecutarHold(client, 'res-aloj-3', 'Huésped Gamma (reintento tras expiración)')
    assert.equal(res3.ok, true, 'Tras expirar el hold, la cláusula WHERE excluye la fila y permite reservar')

    // 5. Confirmar reserva ganadora
    await client.query(`UPDATE ${schemaName}."reservas_alojamiento" SET "estado" = 'confirmed', "hold_expiracion" = NULL WHERE "id" = $1`, ['res-aloj-3'])

    // 6. Intentar una nueva reserva solapada contra la confirmada -> debe fallar con 23P01
    const res4 = await ejecutarHold(client, 'res-aloj-4', 'Huésped Delta')
    assert.equal(res4.ok, false)
    assert.equal(res4.code, '23P01')

    // 7. Conteo de filas
    const countRes = await client.query(`SELECT COUNT(*) FROM ${schemaName}."reservas_alojamiento"`)
    assert.equal(Number(countRes.rows[0].count), 2) // 1 expired + 1 confirmed
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
    await client.end()
  }
})
