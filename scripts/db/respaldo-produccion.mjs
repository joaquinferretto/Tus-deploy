// `node scripts/db/respaldo-produccion.mjs`: respaldo manual, completo y VERIFICADO del esquema
// `public` de la base de TUS (estructura, datos, relaciones y el historial `_prisma_migrations`).
//
// Para un proyecto sin backups automáticos (Supabase Free): se corre a mano antes de cada
// despliegue con migraciones. SOLO LEE de la base de origen. No escribe nada en ella.
//
// Qué hace:
//   1. pg_dump (formato custom) del esquema public, con un cliente de la MISMA versión mayor que
//      el servidor (PostgreSQL 17), dentro de un contenedor Docker descartable.
//   2. Verifica el archivo: `pg_restore --list` lo lee entero, se cuenta lo que contiene y se
//      calcula su SHA-256.
//   3. Prueba de restauración: lo restaura en un PostgreSQL 17 descartable (otro contenedor, sin
//      red hacia afuera) y compara, tabla por tabla, la cantidad de filas con la base de origen.
//   4. Deja el respaldo FUERA del repositorio, con un informe sin credenciales.
//
// Cómo se usa (PowerShell, en una ventana propia; la URL no se escribe en ningún archivo):
//   $env:TUS_BACKUP_URL = "<URI del Session pooler de Supabase, con la contraseña>"
//   node scripts/db/respaldo-produccion.mjs
//   Remove-Item Env:TUS_BACKUP_URL
// La URI está en Supabase -> Connect -> Session pooler (puerto 5432). Requiere Docker Desktop
// en ejecución. La URL nunca se imprime, no va en la línea de comandos de ningún proceso y no se
// guarda: viaja solo como variable de entorno.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const IMAGEN = process.env.TUS_BACKUP_IMAGE ?? 'pgvector/pgvector:pg17'
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')
const log = (mensaje) => console.log(`[respaldo] ${mensaje}`)

class ErrorRespaldo extends Error {}

// Nunca deja salir la URL ni su contraseña en un mensaje.
function sinSecretos(texto, url) {
  let limpio = String(texto ?? '')
  try {
    const parsed = new URL(url)
    for (const secreto of [url, decodeURIComponent(parsed.password), parsed.password].filter((valor) => valor && valor.length >= 4)) limpio = limpio.split(secreto).join('***')
  } catch {}
  return limpio.replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, 'postgresql://***')
}

function docker(args, { env = {}, input, timeout = 900_000 } = {}) {
  const resultado = spawnSync('docker', args, { encoding: 'utf8', env: { ...process.env, ...env }, input, timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  if (resultado.error) throw new ErrorRespaldo(`docker no respondió (${resultado.error.code ?? resultado.error.name}). ¿Está Docker Desktop en ejecución?`)
  return resultado
}

// Cantidad exacta de filas de cada tabla de public, en una sola consulta de solo lectura.
const SQL_CONTEOS = `SELECT table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
const conteos = (salida) => new Map(String(salida).split(/\r?\n/u).map((linea) => linea.trim()).filter((linea) => linea.includes('=')).map((linea) => { const corte = linea.lastIndexOf('='); return [linea.slice(0, corte), Number(linea.slice(corte + 1))] }))

export function compararConteos(origen, restaurado) {
  const diferencias = []
  for (const [tabla, filas] of origen) if (restaurado.get(tabla) !== filas) diferencias.push({ tabla, origen: filas, restaurado: restaurado.get(tabla) ?? null })
  for (const tabla of restaurado.keys()) if (!origen.has(tabla)) diferencias.push({ tabla, origen: null, restaurado: restaurado.get(tabla) })
  return diferencias
}

async function main() {
  const url = process.env.TUS_BACKUP_URL
  if (!url) throw new ErrorRespaldo('falta TUS_BACKUP_URL (la URI del Session pooler de Supabase). No se escribe en archivos: definila solo en esta ventana')
  let destinoUrl
  try { destinoUrl = new URL(url) } catch { throw new ErrorRespaldo('TUS_BACKUP_URL no es una URI de PostgreSQL válida') }
  if (!/^postgres(ql)?:$/u.test(destinoUrl.protocol)) throw new ErrorRespaldo('TUS_BACKUP_URL no es una URI de PostgreSQL')
  const marca = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19)
  const carpeta = resolve(process.env.TUS_BACKUP_DIR ?? join(homedir(), 'TUS-respaldos'), marca)
  if (carpeta.toLowerCase().startsWith(ROOT.toLowerCase())) throw new ErrorRespaldo('el respaldo no se guarda dentro del repositorio: elegí otra carpeta en TUS_BACKUP_DIR')
  mkdirSync(carpeta, { recursive: true })
  const archivo = 'tus-public.dump'
  log(`origen ${destinoUrl.hostname}:${destinoUrl.port || 5432}${destinoUrl.pathname} (solo lectura)`)
  log(`destino ${carpeta}`)

  const version = docker(['version', '--format', '{{.Server.Version}}'])
  if (version.status !== 0) throw new ErrorRespaldo('Docker no está en ejecución. Abrí Docker Desktop, esperá a que arranque y volvé a correr este script')
  const pull = docker(['pull', '-q', IMAGEN])
  if (pull.status !== 0) throw new ErrorRespaldo(`no se pudo obtener la imagen ${IMAGEN}`)

  // La URL entra al contenedor como variable de entorno heredada (`-e NOMBRE`, sin valor): no
  // aparece en la línea de comandos de docker ni en la del proceso de adentro.
  const cliente = (comando, extra = {}) => docker(['run', '--rm', '-i', '-e', 'TUS_BACKUP_URL', '-v', `${carpeta}:/respaldo`, IMAGEN, 'sh', '-c', comando], extra)

  // ---- 1. servidor de origen y conteos
  const servidor = cliente(`psql "$TUS_BACKUP_URL" -At -v ON_ERROR_STOP=1 -c "SELECT current_setting('server_version') || '|' || current_user || '|' || (SELECT count(*) FROM public.\\"_prisma_migrations\\" WHERE finished_at IS NOT NULL) || '|' || coalesce((SELECT max(migration_name) FROM public.\\"_prisma_migrations\\" WHERE finished_at IS NOT NULL), '')"`)
  if (servidor.status !== 0) throw new ErrorRespaldo(`no se pudo conectar a la base de origen: ${sinSecretos(servidor.stderr, url).trim().split(/\r?\n/u).at(-1)}`)
  const [versionServidor, rol, migraciones, ultima] = servidor.stdout.trim().split('|')
  log(`servidor PostgreSQL ${versionServidor}, rol ${rol}, ${migraciones} migraciones aplicadas (última: ${ultima})`)
  if (Number.parseInt(versionServidor, 10) > 17) throw new ErrorRespaldo(`el servidor es PostgreSQL ${versionServidor}: hace falta un cliente de esa versión (TUS_BACKUP_IMAGE)`)
  // La consulta también viaja por entorno (sin comillas que escapar en la línea de comandos).
  const contado = docker(['run', '--rm', '-i', '-e', 'TUS_BACKUP_URL', '-e', 'SQL', IMAGEN, 'sh', '-c', 'psql "$TUS_BACKUP_URL" -At -v ON_ERROR_STOP=1 -c "$SQL"'], { env: { SQL: SQL_CONTEOS } })
  if (contado.status !== 0) throw new ErrorRespaldo(`no se pudieron contar las tablas de origen: ${sinSecretos(contado.stderr, url).trim().split(/\r?\n/u).at(-1)}`)
  const origenConteos = conteos(contado.stdout)
  if (origenConteos.size === 0) throw new ErrorRespaldo('no se pudieron contar las tablas de origen')
  const filasOrigen = [...origenConteos.values()].reduce((suma, filas) => suma + filas, 0)
  log(`origen: ${origenConteos.size} tablas, ${filasOrigen} filas`)

  // ---- 2. respaldo
  const dump = cliente(`pg_dump "$TUS_BACKUP_URL" --schema=public --format=custom --no-owner --no-privileges --file=/respaldo/${archivo}`)
  if (dump.status !== 0) throw new ErrorRespaldo(`pg_dump falló: ${sinSecretos(dump.stderr, url).trim().split(/\r?\n/u).slice(-3).join(' | ')}`)
  const ruta = join(carpeta, archivo)
  const bytes = statSync(ruta).size
  if (bytes < 1024) throw new ErrorRespaldo('el archivo de respaldo quedó vacío')
  const sha256 = createHash('sha256').update(readFileSync(ruta)).digest('hex')
  log(`respaldo escrito: ${archivo} (${(bytes / 1024 / 1024).toFixed(2)} MB)`)

  // ---- 3. verificación del archivo
  const lista = docker(['run', '--rm', '-v', `${carpeta}:/respaldo`, IMAGEN, 'pg_restore', '--list', `/respaldo/${archivo}`])
  if (lista.status !== 0) throw new ErrorRespaldo('pg_restore no pudo leer el respaldo: el archivo no es válido')
  const tablasConDatos = (lista.stdout.match(/ TABLE DATA public /gu) ?? []).length
  const tablas = (lista.stdout.match(/ TABLE public /gu) ?? []).length
  const restricciones = (lista.stdout.match(/ (FK )?CONSTRAINT public /gu) ?? []).length
  const conHistorial = / TABLE DATA public _prisma_migrations /u.test(lista.stdout)
  log(`contenido: ${tablas} tablas, ${tablasConDatos} con datos, ${restricciones} restricciones, historial de Prisma ${conHistorial ? 'incluido' : 'AUSENTE'}`)
  if (!conHistorial) throw new ErrorRespaldo('el respaldo no incluye _prisma_migrations')

  // ---- 4. prueba de restauración en un PostgreSQL descartable y aislado
  const contenedor = `tus-restore-${marca.toLowerCase()}`
  let diferencias = null
  let erroresRestauracion = ''
  try {
    const arranque = docker(['run', '-d', '--rm', '--name', contenedor, '--network', 'none', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-v', `${carpeta}:/respaldo:ro`, IMAGEN])
    if (arranque.status !== 0) throw new ErrorRespaldo('no se pudo iniciar el PostgreSQL de prueba')
    let listo = false
    for (let intento = 0; intento < 60 && !listo; intento += 1) {
      listo = docker(['exec', contenedor, 'psql', '-U', 'postgres', '-At', '-c', 'SELECT 1']).status === 0
      if (!listo) await new Promise((resolver) => setTimeout(resolver, 1000))
    }
    if (!listo) throw new ErrorRespaldo('el PostgreSQL de prueba no arrancó')
    docker(['exec', contenedor, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE restauracion'])
    for (const extension of ['vector', 'btree_gist', 'pgcrypto', '"uuid-ossp"']) docker(['exec', contenedor, 'psql', '-U', 'postgres', '-d', 'restauracion', '-c', `CREATE EXTENSION IF NOT EXISTS ${extension}`])
    const restaurar = docker(['exec', contenedor, 'pg_restore', '-U', 'postgres', '-d', 'restauracion', '--no-owner', '--no-privileges', `/respaldo/${archivo}`])
    erroresRestauracion = (restaurar.stderr ?? '').trim()
    const despues = docker(['exec', '-e', 'SQL', contenedor, 'sh', '-c', 'psql -U postgres -d restauracion -At -v ON_ERROR_STOP=1 -c "$SQL"'], { env: { SQL: SQL_CONTEOS } })
    if (despues.status !== 0) throw new ErrorRespaldo('no se pudieron contar las tablas restauradas')
    diferencias = compararConteos(origenConteos, conteos(despues.stdout))
    if (restaurar.status !== 0 && diferencias.length === 0) log(`pg_restore terminó con avisos (${erroresRestauracion.split(/\r?\n/u).length} líneas), sin diferencias de datos`)
  } finally {
    docker(['rm', '-f', contenedor])
  }

  const informe = {
    fecha: new Date().toISOString(),
    origen: { host: destinoUrl.hostname, base: destinoUrl.pathname.replace(/^\//u, ''), servidor: versionServidor, rol, migracionesAplicadas: Number(migraciones), ultimaMigracion: ultima, tablas: origenConteos.size, filas: filasOrigen },
    archivo: { nombre: archivo, bytes, sha256, formato: 'pg_dump custom (--schema=public --no-owner --no-privileges)', tablas, tablasConDatos, restricciones },
    restauracion: { imagen: IMAGEN, tablasComparadas: origenConteos.size, diferencias, avisos: sinSecretos(erroresRestauracion, url).split(/\r?\n/u).filter(Boolean).slice(0, 20) },
    recuperar: `pg_restore --no-owner --no-privileges -d <URL de la base destino> ${archivo}  (cliente PostgreSQL 17; antes: extensiones vector y btree_gist)`,
    verificado: diferencias !== null && diferencias.length === 0,
  }
  writeFileSync(join(carpeta, 'informe.json'), `${JSON.stringify(informe, null, 2)}\n`)
  if (!informe.verificado) {
    log(`RESTAURACIÓN CON DIFERENCIAS en ${diferencias.length} tabla(s): ${diferencias.slice(0, 8).map((d) => `${d.tabla} (${d.origen} / ${d.restaurado})`).join(', ')}`)
    throw new ErrorRespaldo(`el respaldo NO quedó verificado. Detalle en ${join(carpeta, 'informe.json')}. No migres todavía`)
  }
  log(`restauración probada: ${origenConteos.size} tablas y ${filasOrigen} filas iguales a las de origen`)
  log(`SHA-256 ${sha256}`)
  log(`RESPALDO VERIFICADO en ${carpeta}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[respaldo] FALLÓ: ${sinSecretos(error instanceof Error ? error.message : String(error), process.env.TUS_BACKUP_URL ?? '')}`)
    process.exitCode = 1
  })
}
