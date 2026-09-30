import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// A column created as `timestamp WITH time zone` in SQL must be declared @db.Timestamptz in
// schema.prisma. Otherwise Prisma believes it is `timestamp(3)` and a future `migrate dev` would
// generate a conversion that breaks what depends on the type (e.g. the Alojamientos exclusion
// constraints with tstzrange). Found in 20261018100000_tus_alojamientos_concurrencia.
const root = join(import.meta.dirname, '..', '..')
const migrations = join(root, 'apps', 'api', 'prisma', 'migrations')
const schema = readFileSync(join(root, 'apps', 'api', 'prisma', 'schema.prisma'), 'utf8')

function columnasConZona() {
  const found = []
  for (const name of readdirSync(migrations).filter((entry) => /^\d{14}_/u.test(entry)).sort()) {
    let sql
    try { sql = readFileSync(join(migrations, name, 'migration.sql'), 'utf8') } catch { continue }
    for (const table of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"([^"]+)"\s*\(([\s\S]*?)\n\);/gu))
      for (const column of table[2].matchAll(/^\s*"([^"]+)"\s+timestamp(?:\(\d\))?\s+with time zone/gimu))
        found.push({ migration: name, table: table[1], column: column[1] })
  }
  return found
}

function declaracion(table, column) {
  const model = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/gu)].find((item) => item[2].includes(`@@map("${table}")`))
  if (!model) return null
  const line = model[2].split('\n').find((item) => item.includes(`@map("${column}")`))
  return line ?? null
}

test('PRISMA: every timestamptz column of the migrations is declared @db.Timestamptz (no drift towards timestamp)', () => {
  const columns = columnasConZona()
  assert.ok(columns.some((item) => item.table === 'reservas_alojamiento' && item.column === 'fecha_inicio'), 'the scan finds the Alojamientos columns')
  const missing = columns.filter(({ table, column }) => {
    const line = declaracion(table, column)
    return line !== null && !/@db\.Timestamptz/u.test(line)
  })
  assert.deepEqual(missing, [])
})
