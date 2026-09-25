// Migraciones de despliegue de TUS (Hostinger, release manual): `prisma migrate deploy` con dos
// pasos de inicialización necesarios para una base NUEVA, sin editar migraciones históricas.
//
// Por qué hacen falta (reproducido en PostgreSQL 16 descartable con la cadena real):
// 1. Prisma crea `_prisma_migrations.id` como VARCHAR(36) y registra su fila antes de ejecutar
//    cada migración. `20260911120000_tus_pos_index_constraint_repair` y
//    `20260911130000_tus_live_schema_conformance_repair` terminan con un
//    `INSERT ... SELECT '<marcador de 38/41 caracteres>' ... WHERE NOT EXISTS`, pensado para la
//    herramienta de reparación (que crea la tabla con id TEXT). El WHERE descarta la fila, pero la
//    constante igual se convierte a VARCHAR(36) y falla con 22001. Solución: si la tabla todavía no
//    existe, crearla con el mismo formato que Prisma salvo `id TEXT`; si existe con VARCHAR(36) y
//    esas migraciones siguen pendientes, ampliar `id` a TEXT (sin reescritura, compatible con Prisma).
// 2. `20260911130000` compara `ARRAY(SELECT attname ...)` (name[]) con `definition.index_columns`
//    (text[]): no existe `name[] = text[]` en ninguna versión de PostgreSQL (42883), así que esa
//    migración nunca pudo aplicarse tal cual. Se ejecuta derivada del archivo original con UNA
//    sustitución verificada (`)::text[] = definition.index_columns`), sin su INSERT de marcador,
//    dentro de una transacción; si termina, se registra con `prisma migrate resolve --applied`
//    (checksum real del archivo). El archivo del repo no se modifica.
// Bases existentes (todo aplicado): solo corre `prisma migrate deploy` con lo pendiente.

export const POS_REPAIR = '20260911120000_tus_pos_index_constraint_repair'
export const CONFORMANCE_REPAIR = '20260911130000_tus_live_schema_conformance_repair'
// Migraciones cuyo marcador no entra en VARCHAR(36).
export const LONG_MARKER_MIGRATIONS = [POS_REPAIR, CONFORMANCE_REPAIR]

export const CONFORMANCE_TYPE_BUG = ') = definition.index_columns'
export const CONFORMANCE_TYPE_FIX = ')::text[] = definition.index_columns'
const MARKER_INSERT = 'INSERT INTO "_prisma_migrations"'

// Misma definición que crea Prisma 5 (columnas, tipos y PK), salvo `id TEXT`.
export const PRISMA_MIGRATIONS_BOOTSTRAP_SQL = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT NOT NULL,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);
-- Ampliación sin reescritura (VARCHAR(36) -> TEXT); no-op si ya es TEXT.
ALTER TABLE "_prisma_migrations" ALTER COLUMN "id" TYPE TEXT;
`

// ---- lectura de `prisma migrate status` ----------------------------------------------------------
// Estricto: solo se sigue con 'up-to-date' o 'pending' cuando TODA la salida coincide con el
// formato conocido de Prisma 5 (capturado de la CLI real), el código de salida es coherente y los
// nombres existen en el directorio local. Cualquier otra cosa es 'unknown' y detiene el proceso
// antes de escribir. Los errores reconocidos (failed, P1001, P1003...) también detienen.

const MIGRATION_LINE = /^\d{14}_[A-Za-z0-9_]+$/u
const BOILERPLATE = [
  /^Environment variables loaded from \S.*$/u,
  /^Prisma schema loaded from \S.*$/u,
  /^Datasource "db": PostgreSQL database "[^"]*", schema "[^"]*" at "[^"]*"$/u,
  /^To apply migrations in (?:development|production) run prisma migrate (?:dev|deploy)\.?$/u,
  // Aviso de actualización de la CLI (caja) que Prisma puede imprimir.
  /^[┌└│].*$/u,
]

export function parseMigrateStatus(output, exitCode, localMigrations) {
  const text = String(output ?? '').replace(/\r\n/gu, '\n')
  const lines = text.split('\n').map((line) => line.trim())
  const local = new Set(localMigrations ?? [])
  const unknown = (detail) => ({ state: 'unknown', pending: [], failed: [], detail })

  const failedAt = lines.findIndex((line) => /^Following migrations? ha(?:ve|s) failed:$/u.test(line))
  if (failedAt >= 0) {
    const failed = []
    for (let i = failedAt + 1; i < lines.length && MIGRATION_LINE.test(lines[i]); i++) failed.push(lines[i])
    return { state: 'failed', pending: [], failed, detail: null }
  }
  const prismaError = text.match(/^Error: (P\d{4})\b/mu)?.[1]
  if (prismaError) {
    const reachability = ['P1000', 'P1001', 'P1002', 'P1003', 'P1010', 'P1011', 'P1017']
    return reachability.includes(prismaError)
      ? { state: 'unreachable', pending: [], failed: [], detail: prismaError }
      : unknown(`prisma error ${prismaError}`)
  }
  if (exitCode !== 0 && exitCode !== 1) return unknown(`unexpected exit code ${exitCode}`)

  let found = null
  let upToDate = false
  let pendingHeader = false
  const pending = []
  for (const line of lines) {
    if (line === '' || BOILERPLATE.some((pattern) => pattern.test(line))) continue
    const count = line.match(/^(\d+) migrations? found in prisma\/migrations$/u)
    if (count) {
      if (found !== null) return unknown('duplicated migration count')
      found = Number(count[1])
      continue
    }
    if (line === 'Database schema is up to date!') {
      upToDate = true
      continue
    }
    if (/^Following migrations? ha(?:ve|s) not yet been applied:$/u.test(line)) {
      if (pendingHeader) return unknown('duplicated pending list')
      pendingHeader = true
      continue
    }
    if (pendingHeader && MIGRATION_LINE.test(line)) {
      pending.push(line)
      continue
    }
    return unknown(`unrecognized line: ${line.slice(0, 120)}`)
  }

  if (found === null) return unknown('missing migration count')
  if (localMigrations && found !== local.size) return unknown(`Prisma found ${found} migrations, the directory has ${local.size}`)
  if (upToDate && !pendingHeader && exitCode === 0) return { state: 'up-to-date', pending: [], failed: [], detail: null }
  // Pendientes: el caso normal devuelve 1 (se acepta también 0).
  if (pendingHeader && !upToDate && pending.length > 0) {
    const strangers = pending.filter((name) => !local.has(name))
    if (localMigrations && strangers.length > 0) return unknown(`pending migrations not in the directory: ${strangers.join(', ')}`)
    if (new Set(pending).size !== pending.length) return unknown('duplicated pending migration')
    return { state: 'pending', pending, failed: [], detail: null }
  }
  return unknown(`inconsistent status (exit ${exitCode}, upToDate=${upToDate}, pending=${pending.length})`)
}

// Antes de la primera escritura: sin historial de Prisma, el esquema `public` tiene que estar vacío
// (Prisma no distingue una base vacía de una con tablas ajenas en `migrate status`). Solo lee el
// catálogo; RAISE con un código propio si hay objetos.
export const UNMANAGED_GUARD_CODE = 'tus-migrate-unmanaged-public-schema'
export const UNMANAGED_GUARD_SQL = `DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NULL AND EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  ) THEN
    RAISE EXCEPTION '${UNMANAGED_GUARD_CODE}';
  END IF;
END $$;
`

// ---- plan ----------------------------------------------------------------------------------------

export function planDeploy(status, allMigrations) {
  if (status.state === 'up-to-date') return { action: 'none' }
  if (status.state === 'failed') return { action: 'abort', reason: 'failed-migrations', migrations: status.failed }
  if (status.state === 'unreachable') return { action: 'abort', reason: 'database-unreachable', detail: status.detail }
  if (status.state !== 'pending') return { action: 'abort', reason: 'unrecognized-status', detail: status.detail }
  const pending = new Set(status.pending)
  const needsBootstrap = LONG_MARKER_MIGRATIONS.some((name) => pending.has(name))
  const conformancePending = pending.has(CONFORMANCE_REPAIR)
  return {
    action: 'deploy',
    bootstrap: needsBootstrap,
    // Con 20260911130000 pendiente: primero todo lo anterior, luego ella derivada, luego el resto.
    before: conformancePending ? allMigrations.filter((name) => name.localeCompare(CONFORMANCE_REPAIR) < 0) : null,
    conformance: conformancePending,
  }
}

// ---- 20260911130000 derivada ---------------------------------------------------------------------

export function deriveConformanceSql(original) {
  const source = String(original)
  const bugCount = source.split(CONFORMANCE_TYPE_BUG).length - 1
  if (bugCount !== 1) throw new Error(`conformance-derivation: expected exactly one type comparison, found ${bugCount}`)
  const markerAt = source.lastIndexOf(MARKER_INSERT)
  if (markerAt < 0 || source.indexOf(MARKER_INSERT) !== markerAt) throw new Error('conformance-derivation: expected exactly one marker insert')
  const tail = source.slice(markerAt)
  // El marcador tiene que ser la última sentencia: nada ejecutable después de su `;` final.
  const afterMarker = tail.slice(tail.indexOf(');') + 2).trim()
  if (!tail.includes(CONFORMANCE_REPAIR) || afterMarker !== '') throw new Error('conformance-derivation: marker insert is not the final statement')
  const body = source.slice(0, markerAt).replace(CONFORMANCE_TYPE_BUG, CONFORMANCE_TYPE_FIX)
  return `-- Derivada de ${CONFORMANCE_REPAIR}/migration.sql (scripts/db/migrate-deploy-lib.mjs):\n-- cast name[] -> text[] y sin INSERT de marcador; se registra con prisma migrate resolve.\nBEGIN;\n${body.trimEnd()}\nCOMMIT;\n`
}

// ---- destino y seguridad -------------------------------------------------------------------------

// Supabase: conexión directa y PgBouncer dedicado `db.<ref>.supabase.co` (usuario `postgres`);
// Supavisor (session/transaction pooler) `aws-N-<región>.pooler.supabase.com` con usuario
// `<rol>.<ref>`. El ref del proyecto no es secreto (aparece en el host); el usuario no se expone.
const SUPABASE_REF = /^[a-z0-9]{20}$/u

export function supabaseProject(databaseUrl) {
  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (!/(?:^|\.)supabase\.(?:co|com)$/u.test(host)) return null
  const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/u)
  if (direct) return SUPABASE_REF.test(direct[1]) ? { endpoint: 'direct', ref: direct[1] } : { endpoint: 'direct', ref: null }
  if (/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(host)) {
    const user = decodeURIComponent(parsed.username)
    const ref = user.includes('.') ? user.slice(user.lastIndexOf('.') + 1) : ''
    return { endpoint: 'pooler', ref: SUPABASE_REF.test(ref) ? ref : null }
  }
  return { endpoint: 'unknown', ref: null }
}

// Solo host, puerto, base y sslmode: nunca usuario ni contraseña.
export function describeTarget(databaseUrl) {
  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    return null
  }
  if (!/^postgres(?:ql)?:$/u.test(parsed.protocol)) return null
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: decodeURIComponent(parsed.pathname.replace(/^\//u, '')) || 'postgres',
    sslmode: parsed.searchParams.get('sslmode'),
  }
}

export function validateTargets(environment) {
  const problems = []
  const runtime = describeTarget(environment['DATABASE_URL'] ?? '')
  const direct = describeTarget(environment['DIRECT_URL'] ?? '')
  if (!runtime) problems.push('DATABASE_URL missing or invalid')
  if (!direct) problems.push('DIRECT_URL missing or invalid (Prisma migrate uses it)')
  for (const [name, target] of [['DATABASE_URL', runtime], ['DIRECT_URL', direct]]) {
    if (!target) continue
    if (target.database === 'factory_local') problems.push(`${name} points to factory_local; refusing to migrate it`)
    if (environment['NODE_ENV'] === 'production' && !['require', 'verify-ca', 'verify-full'].includes(String(target.sslmode).toLowerCase()))
      problems.push(`${name} must use sslmode=require|verify-ca|verify-full in production`)
  }
  if (runtime && direct && runtime.database !== direct.database) problems.push('DATABASE_URL and DIRECT_URL point to different databases')
  // Si alguna es Supabase, las dos tienen que ser endpoints reconocidos del MISMO proyecto.
  const runtimeProject = runtime ? supabaseProject(environment['DATABASE_URL']) : null
  const directProject = direct ? supabaseProject(environment['DIRECT_URL']) : null
  if (runtimeProject || directProject) {
    for (const [name, project] of [['DATABASE_URL', runtimeProject], ['DIRECT_URL', directProject]]) {
      if (!project) problems.push(`${name} is not a Supabase endpoint while the other one is`)
      else if (project.endpoint === 'unknown') problems.push(`${name} is not a recognized Supabase endpoint (db.<ref>.supabase.co or aws-N-<region>.pooler.supabase.com)`)
      else if (!project.ref) problems.push(project.endpoint === 'pooler' ? `${name} pooler user must be <role>.<project-ref>` : `${name} has an invalid Supabase project ref`)
    }
    if (runtimeProject?.ref && directProject?.ref && runtimeProject.ref !== directProject.ref)
      problems.push(`DATABASE_URL and DIRECT_URL belong to different Supabase projects (${maskRef(runtimeProject.ref)} vs ${maskRef(directProject.ref)})`)
  }
  const project = runtimeProject?.ref && runtimeProject.ref === directProject?.ref ? { ref: runtimeProject.ref, runtime: runtimeProject.endpoint, direct: directProject.endpoint } : null
  return { ok: problems.length === 0, problems, runtime, direct, project }
}

const maskRef = (ref) => `${ref.slice(0, 4)}…${ref.slice(-2)}`

export function redact(text) {
  return String(text ?? '')
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/giu, 'postgresql://<redacted>')
    .replace(/(password|passwd|pwd)=[^\s&'"]+/giu, '$1=<redacted>')
}
