#!/usr/bin/env node
// Read-only diagnosis of the NOT VALID constraints of a TUS database.
//
// For every CHECK or FOREIGN KEY that is not validated yet, it says how many existing rows would
// make VALIDATE CONSTRAINT fail and shows the primary keys of the first ones. It NEVER writes:
// everything runs inside one READ ONLY transaction that is rolled back, and it validates nothing.
//
// Usage (the URL is never printed; only host and database name are):
//   DIAGNOSTICO_DATABASE_URL=postgresql://... node scripts/db/diagnostico-not-valid.mjs [--muestra 10] [--json]
//
// The variable is deliberately NOT DATABASE_URL: running this against a database is an explicit
// decision of whoever sets it.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(join(raiz, 'apps', 'api', 'package.json'))
const { Client } = require('pg')

const args = process.argv.slice(2)
const muestra = Math.min(50, Math.max(1, Number(args[args.indexOf('--muestra') + 1]) || 10))
const comoJson = args.includes('--json')
const url = process.env.DIAGNOSTICO_DATABASE_URL
if (!url) {
  console.error('Falta DIAGNOSTICO_DATABASE_URL (la base a diagnosticar, en modo lectura).')
  process.exit(2)
}

const id = (nombre) => `"${String(nombre).replaceAll('"', '""')}"`

const client = new Client({ connectionString: url, statement_timeout: 120_000, application_name: 'tus-diagnostico-not-valid' })
const resultado = []
try {
  await client.connect()
  await client.query('BEGIN TRANSACTION READ ONLY')
  const destino = (await client.query('SELECT current_database() AS base, inet_server_addr()::text AS host')).rows[0]
  if (!comoJson) console.log(`Base: ${destino.base} @ ${destino.host ?? 'local'} (transacción de solo lectura)\n`)

  const pendientes = (
    await client.query(`
      SELECT co.oid, co.conname, co.contype::text AS tipo, n.nspname AS esquema, c.relname AS tabla,
             pg_get_expr(co.conbin, co.conrelid) AS expresion,
             fn.nspname AS esquema_ref, fc.relname AS tabla_ref,
             (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(co.conkey) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.attnum) AS columnas,
             (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(co.confkey) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = co.confrelid AND a.attnum = k.attnum) AS columnas_ref,
             (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum WHERE i.indrelid = co.conrelid AND i.indisprimary) AS clave
        FROM pg_constraint co
        JOIN pg_class c ON c.oid = co.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_class fc ON fc.oid = co.confrelid
        LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
       WHERE NOT co.convalidated AND n.nspname = 'public' AND co.contype IN ('c', 'f')
       ORDER BY c.relname, co.conname`)
  ).rows

  for (const constraint of pendientes) {
    const tabla = `${id(constraint.esquema)}.${id(constraint.tabla)}`
    // Rows that break the rule. A CHECK passes when its expression is NULL; a FOREIGN KEY (MATCH
    // SIMPLE) is not checked when any of its columns is NULL.
    const condicion =
      constraint.tipo === 'c'
        ? `NOT COALESCE((${constraint.expresion}), true)`
        : `${constraint.columnas.map((columna) => `t.${id(columna)} IS NOT NULL`).join(' AND ')} AND NOT EXISTS (SELECT 1 FROM ${id(constraint.esquema_ref)}.${id(constraint.tabla_ref)} r WHERE ${constraint.columnas.map((columna, indice) => `r.${id(constraint.columnas_ref[indice])} = t.${id(columna)}`).join(' AND ')})`
    const clave = constraint.clave ?? []
    const item = { tabla: constraint.tabla, constraint: constraint.conname, tipo: constraint.tipo === 'c' ? 'CHECK' : 'FOREIGN KEY', filasQueImpiden: null, clave, muestra: [], error: null }
    try {
      await client.query('SAVEPOINT diagnostico')
      item.filasQueImpiden = Number((await client.query(`SELECT count(*) AS n FROM ${tabla} t WHERE ${condicion}`)).rows[0].n)
      if (item.filasQueImpiden > 0 && clave.length > 0) {
        // Only the primary key (and, for a foreign key, the missing reference): never other columns.
        const columnas = [...new Set([...clave, ...(constraint.tipo === 'f' ? constraint.columnas : [])])]
        item.muestra = (await client.query(`SELECT ${columnas.map((columna) => `t.${id(columna)}::text AS ${id(columna)}`).join(', ')} FROM ${tabla} t WHERE ${condicion} ORDER BY ${clave.map((columna) => `t.${id(columna)}`).join(', ')} LIMIT ${muestra}`)).rows
      }
      await client.query('RELEASE SAVEPOINT diagnostico')
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT diagnostico')
      item.error = String(error?.message ?? error).split('\n')[0].slice(0, 200)
    }
    resultado.push(item)
  }
} finally {
  await client.query('ROLLBACK').catch(() => undefined)
  await client.end().catch(() => undefined)
}

if (comoJson) {
  console.log(JSON.stringify(resultado, null, 2))
} else {
  for (const item of resultado) {
    const estado = item.error ? `NO SE PUDO EVALUAR (${item.error})` : item.filasQueImpiden === 0 ? 'se puede validar' : `${item.filasQueImpiden} fila(s) lo impiden`
    console.log(`${item.filasQueImpiden === 0 ? 'OK  ' : 'ATENCIÓN'} ${item.tabla}.${item.constraint} [${item.tipo}]: ${estado}`)
    for (const fila of item.muestra) console.log(`         ${Object.entries(fila).map(([columna, valor]) => `${columna}=${valor}`).join('  ')}`)
  }
  const bloqueadas = resultado.filter((item) => item.filasQueImpiden !== 0)
  console.log(`\n${resultado.length} constraints NOT VALID: ${resultado.length - bloqueadas.length} se pueden validar, ${bloqueadas.length} requieren revisar filas antes. No se validó ni se modificó nada.`)
}
