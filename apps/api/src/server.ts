import express from 'express'
import type { Application, Router } from 'express'
import type { Server } from 'node:http'
import { helmetMiddleware } from './presentation/middleware/helmet.ts'
import { rateLimitMiddleware } from './presentation/middleware/rate-limit.ts'
import { corsMiddleware } from './presentation/middleware/cors.ts'
import { createHealthRouter, healthRouter } from './presentation/routes/health.ts'
import { createTusIntegrationRouter } from './tus/integration/index.ts'
import { createTusHttpRouter } from './tus/http/router.ts'
import { createPrismaTusApplication } from './tus/composition/index.ts'
import type { TusPrismaClient } from './tus/adapters/prisma.ts'
import { getPrismaClient } from './infrastructure/database/prisma/client.ts'
import { createPrismaAuthService } from './auth-security/composition.ts'
import { createAuthRouter } from './auth-security/http/auth-router.ts'
import { DurableIdentitySessionResolver } from './auth-security/adapters/durable-session-resolver.ts'
import type { PrismaIdentityClient } from './auth-security/adapters/postgres/prisma-identity-store.ts'
import { createPrismaTenancyService } from './tenancy/composition.ts'
import { createTenancyRouter } from './tenancy/http/tenancy-router.ts'
import type { TenantPrismaClient } from './tenancy/adapters/prisma.ts'
import {
  createDatabaseLifecycle,
  type DatabaseLifecycle,
} from './infrastructure/database/lifecycle.ts'
import type { ApiReadiness } from './presentation/routes/health.ts'
import {
  loadApiRuntimeConfig,
  type ApiRuntimeConfig,
} from './platform/configuration/domain.ts'
import { disconnectMongoDB } from './infrastructure/database/mongodb/connection.ts'
import { disconnectRedis } from './infrastructure/database/redis/client.ts'
import { createApiLifecycle, type ApiLifecycle } from './platform/lifecycle.ts'

const DEFAULT_PORT = 3101

export interface StartServerOptions {
  app?: Application
  databaseLifecycle?: DatabaseLifecycle
  runtimeConfig?: ApiRuntimeConfig
  rootDirectory?: string
  port?: number
  installSignalHandlers?: boolean
}

export interface StartedServer {
  server: Server
  lifecycle: ApiLifecycle
  shutdown: (reason?: string) => Promise<void>
}

export interface CreateAppOptions {
  tusRouter?: Router
  databaseLifecycle?: DatabaseLifecycle
  getReadiness?: () => Promise<ApiReadiness>
}

export function createApp(options: CreateAppOptions = {}): Application {
  const app = express()
  const prisma = getPrismaClient() as unknown as TusPrismaClient
  const auth = createPrismaAuthService(prisma as unknown as PrismaIdentityClient)
  const sessions = new DurableIdentitySessionResolver(auth.store)
  const tenancy = createPrismaTenancyService(prisma as unknown as TenantPrismaClient)
  const application = createPrismaTusApplication(prisma)
  const tusRouter = options.tusRouter ?? createTusHttpRouter({
    application,
    sessions,
  })

  // Security middleware
  app.use(helmetMiddleware)
  app.use(corsMiddleware)
  app.use(rateLimitMiddleware)

  // Body parsing
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  // Routes
  app.use(options.getReadiness || options.databaseLifecycle ? createHealthRouter({
    getReadiness: options.getReadiness,
    databaseLifecycle: options.databaseLifecycle,
  }) : healthRouter)
  app.use(createAuthRouter({ service: auth.service, sessions }))
  app.use(createTenancyRouter({ service: tenancy.service, sessions }))
  app.use(tusRouter)
  app.use(createTusIntegrationRouter({ readinessGuard: application.readinessGuard }))

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' })
  })

  return app
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const runtimeConfig = options.runtimeConfig ?? loadApiRuntimeConfig({ rootDirectory: options.rootDirectory })
  const databaseLifecycle = options.databaseLifecycle ?? createDatabaseLifecycle({ config: runtimeConfig })
  const port = options.port ?? Number(process.env['API_PORT'] || process.env['PORT'] || DEFAULT_PORT)
  const lifecycle = createApiLifecycle(runtimeConfig.shutdownTimeoutMs)
  let server: Server | undefined
  let signalHandlersInstalled = false

  try {
    await databaseLifecycle.connect()

    const app = options.app ?? createApp({ databaseLifecycle })
    server = await listen(app, port)
    lifecycle.register('database', databaseLifecycle.close)
    lifecycle.register('mongodb', disconnectMongoDB)
    lifecycle.register('redis', disconnectRedis)
    lifecycle.register('http', () => closeHttpServer(server as Server, runtimeConfig.shutdownTimeoutMs))
    lifecycle.start()

    const shutdown = async (reason = 'signal') => {
      if (signalHandlersInstalled) {
        process.off('SIGTERM', onSigterm)
        process.off('SIGINT', onSigint)
        signalHandlersInstalled = false
      }
      await lifecycle.shutdown(reason)
    }
    const onSigterm = () => { void shutdown('SIGTERM') }
    const onSigint = () => { void shutdown('SIGINT') }

    if (options.installSignalHandlers !== false) {
      process.once('SIGTERM', onSigterm)
      process.once('SIGINT', onSigint)
      signalHandlersInstalled = true
    }

    console.log(`API server listening on http://localhost:${port}`)
    return { server, lifecycle, shutdown }
  } catch {
    await databaseLifecycle.close().catch(() => undefined)
    throw new Error('API startup failed; diagnostics redacted')
  }
}

function listen(app: Application, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server))
    server.once('error', (error) => {
      server.close(() => undefined)
      reject(error)
    })
  })
}

function closeHttpServer(server: Server, timeoutMs: number): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('HTTP shutdown timeout')), timeoutMs)
    server.close((error) => {
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    })
  })
}
