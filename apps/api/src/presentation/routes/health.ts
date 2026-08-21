import express from 'express'
import type { Request, Response, Router as ExpressRouter } from 'express'
import { buildNativeReadiness } from '@factory/config'
import type { NativeReadiness } from '@factory/config'

const dependencyKeys = ['postgres', 'mongodb', 'redis', 'pythonWorker', 'mobileSupport', 'externalProviders'] as const
const { Router } = express

async function getDefaultReadiness(): Promise<NativeReadiness> {
  const [{ checkPostgres }, { checkMongoDB }, { checkRedis }] = await Promise.all([
    import('../../infrastructure/database/postgres/pool.js'),
    import('../../infrastructure/database/mongodb/connection.js'),
    import('../../infrastructure/database/redis/client.js'),
  ])

  return buildNativeReadiness({
    profile: process.env['NATIVE_PROFILE'] === '1' ? 'native' : 'compose',
    postgresCheck: checkPostgres,
    checks: { mongodb: checkMongoDB, redis: checkRedis },
  })
}

export function createHealthRouter(options: { getReadiness?: () => Promise<NativeReadiness> } = {}): ExpressRouter {
  const router = Router()
  const getReadiness = options.getReadiness ?? getDefaultReadiness

  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  router.get('/ready', async (_req: Request, res: Response) => {
    try {
      const dependencies = await getReadiness()
      const reports = dependencyKeys.map((key) => dependencies[key])
      const ready = reports.every((report) => !report.blocksApiReadiness)

      res.status(ready ? 200 : 503).json({
        ready,
        profile: dependencies.profile,
        dependencies,
        checks: Object.fromEntries(dependencyKeys.map((key) => [key, dependencies[key].status === 'ready'])),
        timestamp: new Date().toISOString(),
      })
    } catch {
      res.status(503).json({ ready: false, error: 'Readiness unavailable', timestamp: new Date().toISOString() })
    }
  })

  return router
}

export const healthRouter: ExpressRouter = createHealthRouter()
