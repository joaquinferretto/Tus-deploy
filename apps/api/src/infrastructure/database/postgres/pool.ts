import { Pool } from 'pg'
import type { PoolConfig } from 'pg'
import { resolve } from 'node:path'

import {
  DATABASE_ATTEMPT_TIMEOUT_MS,
  DATABASE_MAX_ATTEMPTS,
  readRootDatabaseUrl,
} from '../../../platform/configuration/domain.ts'

export interface PostgresPoolLike {
  query: (...args: readonly unknown[]) => Promise<{ rowCount?: number | null; rows?: readonly Record<string, unknown>[] }>
  end: () => void | Promise<void>
}

export interface BoundedDatabaseAttemptContext {
  attempt: number
  timeoutMs: number
  registerResource: (resource: PostgresPoolLike) => void
}

export interface BoundedDatabaseRetryOptions {
  attemptTimeoutMs?: number
  backoffMs?: number
  sleep?: (durationMs: number) => Promise<void>
  onAttemptFailure?: (input: { attempt: number }) => void | Promise<void>
}

let pool: PostgresPoolLike | undefined

// Causa de un fallo de arranque apta para logs: solo códigos (pg/libpq como 28P01, TLS de Node
// como SELF_SIGNED_CERT_IN_CHAIN, red como ENOTFOUND, Prisma como P1001) o nombres de tablas
// faltantes. Nunca el mensaje, la URL, el host ni el usuario.
export function safeStartupReason(error: unknown): string {
  const value = error as { reason?: unknown; missingTables?: unknown; code?: unknown; errorCode?: unknown; cause?: { code?: unknown }; name?: unknown } | null
  if (typeof value?.reason === 'string' && /^[A-Z0-9_:,a-z-]{2,300}$/u.test(value.reason)) return value.reason
  if (Array.isArray(value?.missingTables)) {
    const tables = value.missingTables.filter((table): table is string => typeof table === 'string' && /^[a-z0-9_-]{1,64}$/u.test(table))
    return `SCHEMA_INCOMPLETE:${tables.join(',')}`
  }
  for (const code of [value?.code, value?.errorCode, value?.cause?.code])
    if (typeof code === 'string' && /^[A-Z0-9_]{2,48}$/u.test(code)) return code
  return typeof value?.name === 'string' && /^[A-Za-z]{1,40}$/u.test(value.name) ? value.name : 'UNKNOWN'
}

// Both src/ and dist/ have the same depth. Resolve from this module, never the
// hosting provider's working directory. pg reads sslrootcert before connecting.
export function postgresConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  const supabase = /^(?:db\.[a-z0-9]+\.supabase\.co|aws-[a-z0-9-]+\.pooler\.supabase\.com)$/u.test(url.hostname)
  const mode = url.searchParams.get('sslmode')
  if (!supabase || !['require', 'verify-ca', 'verify-full'].includes(mode ?? '')) return databaseUrl
  url.searchParams.set('sslmode', 'verify-full')
  url.searchParams.delete('uselibpqcompat')
  if (!url.searchParams.has('sslrootcert')) {
    url.searchParams.set('sslrootcert', resolve(__dirname, '../../../../certs/supabase-ca.crt'))
  }
  return url.toString()
}

export function createPostgresPool(databaseUrl: string = readRootDatabaseUrl() ?? ''): PostgresPoolLike {
  if (!databaseUrl) throw new Error('Missing canonical PostgreSQL configuration')

  const config: PoolConfig = {
    connectionString: postgresConnectionString(databaseUrl),
    max: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: DATABASE_ATTEMPT_TIMEOUT_MS,
    statement_timeout: DATABASE_ATTEMPT_TIMEOUT_MS,
  }

  const createdPool = new Pool(config)
  createdPool.on('error', () => undefined)
  return createdPool as unknown as PostgresPoolLike
}

export async function withBoundedDatabaseStartupRetry<T>(
  startup: (context: BoundedDatabaseAttemptContext) => Promise<T> | T,
  options: BoundedDatabaseRetryOptions = {},
): Promise<{ value: T; diagnostics: readonly { attempt: number; timeoutMs: number; status: 'passed' }[] }> {
  if (typeof startup !== 'function') throw new TypeError('PostgreSQL startup operation is required')

  const timeoutMs = boundedTimeout(options.attemptTimeoutMs)
  const sleep = options.sleep ?? ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)))
  const diagnostics: Array<{ attempt: number; timeoutMs: number; status: 'passed' }> = []
  let lastReason = 'UNKNOWN'

  for (let attempt = 1; attempt <= DATABASE_MAX_ATTEMPTS; attempt += 1) {
    let resource: PostgresPoolLike | undefined
    try {
      const value = await withTimeout(
        Promise.resolve().then(() => startup({
          attempt,
          timeoutMs,
          registerResource: (candidate) => { resource = candidate },
        })),
        timeoutMs,
      )
      diagnostics.push({ attempt, timeoutMs, status: 'passed' })
      return { value, diagnostics }
    } catch (error) {
      lastReason = safeStartupReason(error)
      await closeFailedResource(resource)
      try {
        await options.onAttemptFailure?.({ attempt })
      } catch {
        // Cleanup diagnostics remain redacted; retry policy is unchanged.
      }
      if (attempt < DATABASE_MAX_ATTEMPTS) {
        await sleep(Math.min(Math.max(Number(options.backoffMs ?? 250) || 0, 0), 1_000))
      }
    }
  }

  const error = new Error('PostgreSQL startup failed after two bounded attempts; diagnostics redacted')
  error.name = 'PostgresStartupError'
  Object.assign(error, {
    reason: lastReason,
    attempts: DATABASE_MAX_ATTEMPTS,
    diagnostics: Array.from({ length: DATABASE_MAX_ATTEMPTS }, (_, index) => ({
      attempt: index + 1,
      timeoutMs,
      status: 'failed' as const,
    })),
  })
  throw error
}

export async function connectPostgres(databaseUrl: string): Promise<PostgresPoolLike> {
  const result = await withBoundedDatabaseStartupRetry(async ({ registerResource }) => {
    const candidate = createPostgresPool(databaseUrl)
    registerResource(candidate)
    await candidate.query('SELECT 1')
    return candidate
  })
  const connectedPool = result.value as PostgresPoolLike
  pool = connectedPool
  return connectedPool
}

export function getPostgresPool(databaseUrl?: string): PostgresPoolLike {
  if (!pool) {
    pool = createPostgresPool(databaseUrl)

  }
  return pool as PostgresPoolLike
}

export async function checkPostgres(databaseUrl?: string): Promise<boolean> {
  try {
    const pool = getPostgresPool(databaseUrl)
    const result = await pool.query('SELECT 1')
    return result.rowCount === 1
  } catch {
    return false
  }
}

export async function closePostgresPool(poolToClose: PostgresPoolLike | undefined = pool): Promise<void> {
  if (!poolToClose) return
  try {
    await poolToClose.end()
  } finally {
    if (pool === poolToClose) pool = undefined
  }
}

function boundedTimeout(value: number | undefined): number {
  const parsed = Number(value ?? DATABASE_ATTEMPT_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, DATABASE_ATTEMPT_TIMEOUT_MS) : DATABASE_ATTEMPT_TIMEOUT_MS
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guarded = Promise.resolve(promise)
  guarded.catch(() => undefined)
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('PostgreSQL startup attempt timed out'), { reason: 'DB_ATTEMPT_TIMEOUT' })), timeoutMs)
    guarded.then(
      (value) => {
        if (timer) clearTimeout(timer)
        resolve(value)
      },
      (cause: unknown) => {
        if (timer) clearTimeout(timer)
        reject(Object.assign(new Error('PostgreSQL startup attempt failed'), { reason: safeStartupReason(cause) }))
      },
    )
  })
}

async function closeFailedResource(resource: PostgresPoolLike | undefined): Promise<void> {
  if (!resource) return
  try {
    await resource.end()
  } catch {
    // The startup error remains redacted and the retry stays bounded.
  }
}
