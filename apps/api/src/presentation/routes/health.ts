import { Router, Request, Response } from 'express'
import { checkPostgres } from '../../infrastructure/database/postgres/pool'
import { checkMongoDB } from '../../infrastructure/database/mongodb/connection'
import { checkRedis } from '../../infrastructure/database/redis/client'

export const healthRouter = Router()

healthRouter.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
})

healthRouter.get('/ready', async (req: Request, res: Response) => {
  try {
    const [postgresOk, mongoOk, redisOk] = await Promise.all([
      checkPostgres(),
      checkMongoDB(),
      checkRedis(),
    ])

    const ready = postgresOk && mongoOk && redisOk

    res.status(ready ? 200 : 503).json({
      ready,
      checks: {
        postgres: postgresOk,
        mongodb: mongoOk,
        redis: redisOk,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    res.status(503).json({
      ready: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    })
  }
})
