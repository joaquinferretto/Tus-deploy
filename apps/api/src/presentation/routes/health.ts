import express from 'express'
import type { Request, Response, Router as ExpressRouter } from 'express'
import { buildNativeReadiness } from '@factory/config'
import type { DependencyReport, NativeReadiness } from '@factory/config'
import { checkPostgresSchema, type DatabaseLifecycle, type SchemaReadiness } from '../../infrastructure/database/lifecycle.ts'
import { checkPostgres, getPostgresPool } from '../../infrastructure/database/postgres/pool.ts'
import { getCorrelationId } from '../middleware/correlation.ts'

const dependencyKeys = ['postgres', 'mongodb', 'redis', 'pythonWorker', 'mobileSupport', 'externalProviders'] as const
const { Router } = express

// /ready must answer well before the reverse proxy gives up (nginx: 60 s by default). The pool keeps
// its 60 s startup timeouts; readiness never waits for them:
// - PostgreSQL (critical): SELECT 1 + required tables, 2.5 s in total -> 503 when it fails or times out.
// - Optional dependencies (MongoDB, Redis, ...): only probed when their mode is required/optional,
//   1.5 s each, in parallel with PostgreSQL. A disabled/fake dependency is never loaded or contacted.
// - Whole endpoint: 2.9 s hard cap.
export const READY_POSTGRES_TIMEOUT_MS = 2500
export const READY_OPTIONAL_TIMEOUT_MS = 1500
export const READY_TOTAL_TIMEOUT_MS = 2900

export type PostgresReadinessCheck = 'ok' | 'unavailable' | 'timeout' | 'schema_incomplete'

export type ApiReadiness = Omit<NativeReadiness, 'postgres'> & {
  postgres: DependencyReport & { check?: PostgresReadinessCheck; latencyMs?: number }
  schema?: SchemaReadiness
}

export interface ReadinessProbes {
  // Returns true when a trivial query succeeds.
  postgresConnection: (timeoutMs: number) => Promise<boolean>
  postgresSchema: () => Promise<SchemaReadiness>
  // Lazily loaded: only called when the dependency mode requires a probe.
  mongodb: () => Promise<boolean>
  redis: () => Promise<boolean>
}

export interface ReadinessTimeouts {
  postgresMs: number
  optionalMs: number
  totalMs: number
}

class ReadinessTimeout extends Error {}

function bounded<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ReadinessTimeout()), timeoutMs)
    Promise.resolve()
      .then(work)
      .then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        },
      )
  })
}

const unverifiedSchema = (reason: string): SchemaReadiness => ({ compatible: false, activation: 'unverified', missing: [reason], migration: 'unverified' })

function defaultProbes(databaseLifecycle?: DatabaseLifecycle): ReadinessProbes {
  return {
    postgresConnection: databaseLifecycle
      ? (timeoutMs) => (databaseLifecycle.checkConnection ? databaseLifecycle.checkConnection(timeoutMs) : Promise.resolve(true))
      : () => checkPostgres(),
    postgresSchema: databaseLifecycle ? () => databaseLifecycle.checkSchema() : () => checkPostgresSchema(getPostgresPool()),
    mongodb: () => import('../../infrastructure/database/mongodb/connection.js').then((module) => module.checkMongoDB()),
    redis: () => import('../../infrastructure/database/redis/client.js').then((module) => module.checkRedis()),
  }
}

async function checkPostgresReadiness(probes: ReadinessProbes, timeoutMs: number) {
  const started = performance.now()
  const elapsed = () => Math.max(0, Math.round(performance.now() - started))
  try {
    return await bounded(async () => {
      if (!(await probes.postgresConnection(timeoutMs))) return { check: 'unavailable' as const, schema: unverifiedSchema('database-unavailable'), latencyMs: elapsed() }
      const schema = await probes.postgresSchema()
      return { check: schema.compatible ? ('ok' as const) : ('schema_incomplete' as const), schema, latencyMs: elapsed() }
    }, timeoutMs)
  } catch (error) {
    // Never forward the driver error: only a fixed reason reaches the response.
    const check = error instanceof ReadinessTimeout ? ('timeout' as const) : ('unavailable' as const)
    return { check, schema: unverifiedSchema(check === 'timeout' ? 'database-timeout' : 'database-unavailable'), latencyMs: elapsed() }
  }
}

export async function buildApiReadiness(
  probes: ReadinessProbes,
  timeouts: Pick<ReadinessTimeouts, 'postgresMs' | 'optionalMs'> = { postgresMs: READY_POSTGRES_TIMEOUT_MS, optionalMs: READY_OPTIONAL_TIMEOUT_MS },
): Promise<ApiReadiness> {
  const optional = (probe: () => Promise<boolean>) => () => bounded(probe, timeouts.optionalMs).catch(() => false)
  const [postgres, native] = await Promise.all([
    checkPostgresReadiness(probes, timeouts.postgresMs),
    // PostgreSQL is checked above (in parallel); buildNativeReadiness only resolves the modes and
    // probes the dependencies whose mode is required/optional.
    buildNativeReadiness({
      profile: process.env['NATIVE_PROFILE'] === '1' ? 'native' : 'compose',
      postgresCheck: () => true,
      checks: { mongodb: optional(probes.mongodb), redis: optional(probes.redis) },
    }),
  ])
  // An incomplete schema is reported by `schema` (status "incomplete-schema"), not as an unreachable DB.
  const reachable = postgres.check === 'ok' || postgres.check === 'schema_incomplete'
  return {
    ...native,
    postgres: { mode: 'required', status: reachable ? 'ready' : 'unavailable', blocksApiReadiness: !reachable, check: postgres.check, latencyMs: postgres.latencyMs },
    schema: postgres.schema,
  }
}

// Human-readable state per dependency: disabled/fake are reported as such (never "degraded").
function summary(dependencies: ApiReadiness): Record<string, string> {
  return Object.fromEntries(
    dependencyKeys.map((key) => {
      const report = dependencies[key]
      if (key === 'postgres' && dependencies.postgres.check) return [key, dependencies.postgres.check]
      if (report.mode === 'disabled' || report.mode === 'fake') return [key, report.mode]
      if (report.status === 'ready') return [key, 'ok']
      return [key, report.mode === 'required' ? 'unavailable' : 'degraded']
    }),
  )
}

export interface HealthRouterOptions {
  getReadiness?: () => Promise<ApiReadiness>
  databaseLifecycle?: DatabaseLifecycle
  probes?: Partial<ReadinessProbes>
  timeouts?: Partial<ReadinessTimeouts>
}

export function createHealthRouter(options: HealthRouterOptions = {}): ExpressRouter {
  const router = Router()
  const timeouts: ReadinessTimeouts = {
    postgresMs: options.timeouts?.postgresMs ?? READY_POSTGRES_TIMEOUT_MS,
    optionalMs: options.timeouts?.optionalMs ?? READY_OPTIONAL_TIMEOUT_MS,
    totalMs: options.timeouts?.totalMs ?? READY_TOTAL_TIMEOUT_MS,
  }
  const getReadiness =
    options.getReadiness ?? (() => buildApiReadiness({ ...defaultProbes(options.databaseLifecycle), ...options.probes }, timeouts))

  // Liveness only: never touches a database or any external dependency.
  router.get('/health', (req: Request, res: Response) => {
    const correlationId = getCorrelationId(req)
    res.setHeader('X-Correlation-Id', correlationId)
    res.status(200).json({ status: 'ok', service: 'factory-api', correlationId, timestamp: new Date().toISOString() })
  })

  router.get('/ready', async (req: Request, res: Response) => {
    const correlationId = getCorrelationId(req)
    res.setHeader('X-Correlation-Id', correlationId)
    res.setHeader('Cache-Control', 'no-store')
    try {
      const dependencies = await bounded(getReadiness, timeouts.totalMs)
      const reports = dependencyKeys.map((key) => dependencies[key])
      const schemaReady = dependencies.schema?.compatible ?? true
      const ready = schemaReady && reports.every((report) => !report.blocksApiReadiness)

      res.status(ready ? 200 : 503).json({
        ready,
        status: ready ? 'ready' : dependencies.schema?.activation === 'incomplete-schema' ? 'incomplete-schema' : 'not-ready',
        correlationId,
        profile: dependencies.profile,
        summary: summary(dependencies),
        dependencies,
        ...(dependencies.schema ? { schema: dependencies.schema } : {}),
        checks: {
          ...Object.fromEntries(dependencyKeys.map((key) => [key, dependencies[key].status === 'ready'])),
          ...(dependencies.schema ? { schema: dependencies.schema.compatible } : {}),
        },
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      const timedOut = error instanceof ReadinessTimeout
      res.status(503).json({ ready: false, status: 'not-ready', correlationId, error: timedOut ? 'Readiness timed out' : 'Readiness unavailable', timestamp: new Date().toISOString() })
    }
  })

  return router
}

export const healthRouter: ExpressRouter = createHealthRouter()
