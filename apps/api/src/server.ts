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
import { createBodyLimitMiddleware } from './presentation/middleware/body-limits.ts'
import { correlationMiddleware } from './presentation/middleware/correlation.ts'
import { createErrorHandler, createNotFoundHandler } from './presentation/middleware/error.ts'
import { resolveListenHost, resolveListenPort } from './platform/runtime.ts'
import { createSafeLogger } from './presentation/middleware/logger.ts'

export interface StartServerOptions {
  app?: Application
  databaseLifecycle?: DatabaseLifecycle
  runtimeConfig?: ApiRuntimeConfig
  rootDirectory?: string
  port?: number
  host?: string
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
  tusRoutesEnabled?: boolean
  providerRoutesEnabled?: boolean
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
  app.use(correlationMiddleware)
  app.use(helmetMiddleware)
  app.use(corsMiddleware)
  app.use(rateLimitMiddleware)

  // Body parsing
  app.use(createBodyLimitMiddleware())

  // Routes
  app.use(options.getReadiness || options.databaseLifecycle ? createHealthRouter({
    getReadiness: options.getReadiness,
    databaseLifecycle: options.databaseLifecycle,
  }) : healthRouter)
  app.use(createAuthRouter({ service: auth.service, sessions }))
  app.use(createTenancyRouter({ service: tenancy.service, sessions }))
  const tusRoutesEnabled = options.tusRoutesEnabled ?? (options.tusRouter !== undefined || process.env['TUS_ROUTES_ENABLED'] === 'true')
  const providerRoutesEnabled = options.providerRoutesEnabled ?? process.env['TUS_PROVIDER_ACTIONS_ENABLED'] === 'true'
  if (tusRoutesEnabled) app.use(tusRouter)
  if (providerRoutesEnabled) app.use(createTusIntegrationRouter({ readinessGuard: application.readinessGuard, providerActionsEnabled: true }))

  // 404 handler
  app.use(createNotFoundHandler())
  app.use(createErrorHandler())

  return app
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const runtimeConfig = options.runtimeConfig ?? loadApiRuntimeConfig({ rootDirectory: options.rootDirectory })
  const databaseLifecycle = options.databaseLifecycle ?? createDatabaseLifecycle({ config: runtimeConfig })
  const port = options.port ?? resolveListenPort(process.env, runtimeConfig.environment)
  const host = options.host ?? resolveListenHost(process.env)
  const lifecycle = createApiLifecycle(runtimeConfig.shutdownTimeoutMs)
  const logger = createSafeLogger()
  let server: Server | undefined
  let signalHandlersInstalled = false

  try {
    await withTimeout(databaseLifecycle.connect(), Math.min(runtimeConfig.dbAttemptTimeoutMs * runtimeConfig.dbMaxAttempts + 5_000, 180_000))

    const app = options.app ?? createApp({ databaseLifecycle })
    server = await listen(app, port, host, runtimeConfig.shutdownTimeoutMs)
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

    logger.info('api listening', { details: { host, port } })
    return { server, lifecycle, shutdown }
  } catch {
    if (server?.listening) await closeHttpServer(server, runtimeConfig.shutdownTimeoutMs).catch(() => undefined)
    await databaseLifecycle.close().catch(() => undefined)
    throw new Error('API startup failed; diagnostics redacted')
  }
}

function listen(app: Application, port: number, host: string, timeoutMs: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    let server: Server | undefined
    const timer = setTimeout(() => {
      server?.close(() => undefined)
      reject(new Error('API listener startup timeout'))
    }, timeoutMs)
    const listener = app.listen(port, host, () => {
      clearTimeout(timer)
      resolve(listener)
    })
    server = listener
    listener.once('error', (error) => {
      clearTimeout(timer)
      listener.close(() => undefined)
      reject(error)
    })
  })
}

function withTimeout<TValue>(promise: Promise<TValue>, timeoutMs: number): Promise<TValue> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Promise<TValue>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('API startup timeout')), timeoutMs)
    promise.then(
      (value) => { if (timer) clearTimeout(timer); resolve(value) },
      (error: unknown) => { if (timer) clearTimeout(timer); reject(error) },
    )
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
