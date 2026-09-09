import express from 'express'
import type { Request, Response, Router as ExpressRouter } from 'express'
import { buildNativeReadiness } from '@factory/config'
import type { NativeReadiness } from '@factory/config'
import { checkPostgresSchema, type DatabaseLifecycle, type SchemaReadiness } from '../../infrastructure/database/lifecycle.ts'
import { getPostgresPool } from '../../infrastructure/database/postgres/pool.ts'
import { getCorrelationId } from '../middleware/correlation.ts'

const dependencyKeys = ['postgres', 'mongodb', 'redis', 'pythonWorker', 'mobileSupport', 'externalProviders'] as const
const { Router } = express

export type ApiReadiness = NativeReadiness & { schema?: SchemaReadiness }

async function getDefaultReadiness(databaseLifecycle?: DatabaseLifecycle): Promise<ApiReadiness> {
  const [{ checkPostgres }, { checkMongoDB }, { checkRedis }] = await Promise.all([
    import('../../infrastructure/database/postgres/pool.js'),
    import('../../infrastructure/database/mongodb/connection.js'),
    import('../../infrastructure/database/redis/client.js'),
  ])

  const schema = databaseLifecycle
    ? await databaseLifecycle.checkSchema()
    : await checkPostgresSchema(getPostgresPool())
  const readiness = await buildNativeReadiness({
    profile: process.env['NATIVE_PROFILE'] === '1' ? 'native' : 'compose',
    postgresCheck: databaseLifecycle ? () => schema.compatible : checkPostgres,
    checks: { mongodb: checkMongoDB, redis: checkRedis },
  })
  return { ...readiness, schema }
}

export interface HealthRouterOptions {
  getReadiness?: () => Promise<ApiReadiness>
  databaseLifecycle?: DatabaseLifecycle
}

export function createHealthRouter(options: HealthRouterOptions = {}): ExpressRouter {
  const router = Router()
  const getReadiness = options.getReadiness ?? (() => getDefaultReadiness(options.databaseLifecycle))

  router.get('/health', (req: Request, res: Response) => {
    const correlationId = getCorrelationId(req)
    res.setHeader('X-Correlation-Id', correlationId)
    res.status(200).json({ status: 'ok', service: 'factory-api', correlationId, timestamp: new Date().toISOString() })
  })

  router.get('/ready', async (req: Request, res: Response) => {
    const correlationId = getCorrelationId(req)
    res.setHeader('X-Correlation-Id', correlationId)
    try {
      const dependencies = await getReadiness()
      const reports = dependencyKeys.map((key) => dependencies[key])
      const schemaReady = dependencies.schema?.compatible ?? true
      const ready = schemaReady && reports.every((report) => !report.blocksApiReadiness)

      res.status(ready ? 200 : 503).json({
        ready,
        status: ready ? 'ready' : dependencies.schema?.activation === 'incomplete-schema' ? 'incomplete-schema' : 'not-ready',
        correlationId,
        profile: dependencies.profile,
        dependencies,
        ...(dependencies.schema ? { schema: dependencies.schema } : {}),
        checks: {
          ...Object.fromEntries(dependencyKeys.map((key) => [key, dependencies[key].status === 'ready'])),
          ...(dependencies.schema ? { schema: dependencies.schema.compatible } : {}),
        },
        timestamp: new Date().toISOString(),
      })
    } catch {
      res.status(503).json({ ready: false, status: 'not-ready', correlationId, error: 'Readiness unavailable', timestamp: new Date().toISOString() })
    }
  })

  return router
}

export const healthRouter: ExpressRouter = createHealthRouter()
