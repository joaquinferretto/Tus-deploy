import { Pool } from 'pg'
import type { PoolConfig } from 'pg'

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

export function createPostgresPool(databaseUrl: string = readRootDatabaseUrl() ?? ''): PostgresPoolLike {
  if (!databaseUrl) throw new Error('Missing canonical PostgreSQL configuration')

  const config: PoolConfig = {
    connectionString: databaseUrl,
    max: 20,
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
    } catch {
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
    timer = setTimeout(() => reject(new Error('PostgreSQL startup attempt timed out')), timeoutMs)
    guarded.then(
      (value) => {
        if (timer) clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (timer) clearTimeout(timer)
        reject(new Error('PostgreSQL startup attempt failed'))
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
