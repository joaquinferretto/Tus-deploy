import express from 'express'
import type { Application, Router } from 'express'
import type { Server } from 'node:http'
import { helmetMiddleware } from './presentation/middleware/helmet.ts'
import {
  authRateLimitMiddleware,
  rateLimitMiddleware,
  webhookRateLimitMiddleware,
} from './presentation/middleware/rate-limit.ts'
import { corsMiddleware } from './presentation/middleware/cors.ts'
import { createHealthRouter, healthRouter } from './presentation/routes/health.ts'
import { createTusIntegrationRouter } from './tus/integration/index.ts'
import { createTusHttpRouter } from './tus/http/router.ts'
import { createPrismaTusApplication } from './tus/composition/index.ts'
import { crearModuloWhatsappPrisma } from './tus/asistente/prisma-composicion.ts'
import { crearServicioSolicitudes } from './tus/solicitudes/composicion.ts'
import { crearRouterSolicitudes } from './tus/solicitudes/http.ts'
import type { ClientePrismaSolicitudes } from './tus/solicitudes/almacenes.ts'
import { crearServicioDirectorio } from './tus/directorio/composicion.ts'
import { crearRouterDirectorio } from './tus/directorio/http.ts'
import type { ClientePrismaDirectorio } from './tus/directorio/almacenes.ts'
import type { ModuloWhatsapp } from './tus/asistente/composicion.ts'
import type { TusPrismaClient } from './tus/adapters/prisma.ts'
import { getPrismaClient } from './infrastructure/database/prisma/client.ts'
import { createPrismaAuthService } from './auth-security/composition.ts'
import { createAuthRouter } from './auth-security/http/auth-router.ts'
import { createFederatedAuth, createFederatedAuthRouter, readGoogleAuthSettings } from './auth-security/federated/composition.ts'
import type { FederatedPrismaClient } from './auth-security/federated/adapters/stores.ts'
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
import { loadApiRuntimeConfig, type ApiRuntimeConfig } from './platform/configuration/domain.ts'
import { safeStartupReason } from './infrastructure/database/postgres/pool.ts'
import { disconnectMongoDB } from './infrastructure/database/mongodb/connection.ts'
import { disconnectRedis } from './infrastructure/database/redis/client.ts'
import { createApiLifecycle, type ApiLifecycle } from './platform/lifecycle.ts'
import {
  WEBHOOK_PATH_PREFIXES,
  createBodyLimitMiddleware,
} from './presentation/middleware/body-limits.ts'
import { correlationMiddleware } from './presentation/middleware/correlation.ts'
import { createErrorHandler, createNotFoundHandler } from './presentation/middleware/error.ts'
import { resolveListenHost, resolveListenPort, resolveTrustProxy } from './platform/runtime.ts'
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
  trustProxy?: number | false
}

export function createApp(options: CreateAppOptions = {}): Application {
  const app = express()
  app.set('trust proxy', options.trustProxy ?? resolveTrustProxy(process.env))
  const prisma = getPrismaClient() as unknown as TusPrismaClient
  const auth = createPrismaAuthService(prisma as unknown as PrismaIdentityClient)
  const sessions = new DurableIdentitySessionResolver(auth.store)
  // Google sign-in/sign-up: same account model and session type as password sign-in.
  const federated = createFederatedAuth({
    auth: auth.service,
    identityStore: auth.store,
    audit: auth.audit,
    settings: readGoogleAuthSettings(process.env),
    prisma: prisma as unknown as FederatedPrismaClient,
  })
  const tenancy = createPrismaTenancyService(prisma as unknown as TenantPrismaClient)
  const application = createPrismaTusApplication(prisma)
  // "Buscar trabajador" (directorio) and the one TUS service request used by the home map, the
  // directory, the Web assistant and WhatsApp (same PostgreSQL, through Prisma).
  const directorio = crearServicioDirectorio({ application, prisma: prisma as unknown as ClientePrismaDirectorio })
  const solicitudes = crearServicioSolicitudes({ cuentas: auth.store, destinos: directorio, prisma: prisma as unknown as ClientePrismaSolicitudes })
  const whatsapp = options.tusRouter
    ? undefined
    : crearModuloWhatsappPrisma(prisma, application, auth.store, process.env, { directorio, solicitudes })
  const tusRouter = options.tusRouter ?? createTusHttpRouter({ application, sessions, whatsapp })
  if (whatsapp) app.locals['tusWhatsappAssistant'] = whatsapp

  // Security middleware
  app.use(correlationMiddleware)
  app.use(helmetMiddleware)
  app.use(corsMiddleware)
  app.use(rateLimitMiddleware)
  app.use([...WEBHOOK_PATH_PREFIXES], webhookRateLimitMiddleware)
  app.use(
    [
      '/auth/register',
      '/auth/sign-in',
      '/auth/verify-email',
      '/auth/recovery/request',
      '/auth/recovery/complete',
      '/auth/oauth/exchange',
      '/auth/oauth/signup',
      '/auth/oauth/link',
    ],
    authRateLimitMiddleware
  )

  // Body parsing
  app.use(createBodyLimitMiddleware())

  // Routes
  app.use(
    options.getReadiness || options.databaseLifecycle
      ? createHealthRouter({
          getReadiness: options.getReadiness,
          databaseLifecycle: options.databaseLifecycle,
        })
      : healthRouter
  )
  app.use(createAuthRouter({ service: auth.service, sessions }))
  app.use(createFederatedAuthRouter(federated.service, federated.webBaseUrl ?? process.env['TUS_WEB_BASE_URL'] ?? null))
  app.use(createTenancyRouter({ service: tenancy.service, sessions }))
  const tusRoutesEnabled =
    options.tusRoutesEnabled ??
    (options.tusRouter !== undefined || process.env['TUS_ROUTES_ENABLED'] === 'true')
  const providerRoutesEnabled =
    options.providerRoutesEnabled ?? process.env['TUS_PROVIDER_ACTIONS_ENABLED'] === 'true'
  if (tusRoutesEnabled) {
    app.use(crearRouterSolicitudes({ servicio: solicitudes, sessions }))
    app.use(crearRouterDirectorio({ servicio: directorio, sessions }))
    app.use(tusRouter)
  }
  if (providerRoutesEnabled)
    app.use(
      createTusIntegrationRouter({
        evaluadorHabilitacion: application.evaluadorHabilitacion,
        providerActionsEnabled: true,
      })
    )

  // 404 handler
  app.use(createNotFoundHandler())
  app.use(createErrorHandler())

  return app
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const runtimeConfig =
    options.runtimeConfig ?? loadApiRuntimeConfig({ rootDirectory: options.rootDirectory })
  const databaseLifecycle =
    options.databaseLifecycle ?? createDatabaseLifecycle({ config: runtimeConfig })
  const port = options.port ?? resolveListenPort(process.env, runtimeConfig.environment)
  const host = options.host ?? resolveListenHost(process.env)
  const lifecycle = createApiLifecycle(runtimeConfig.shutdownTimeoutMs)
  const logger = createSafeLogger()
  let server: Server | undefined
  let signalHandlersInstalled = false

  try {
    await withTimeout(
      databaseLifecycle.connect(),
      Math.min(runtimeConfig.dbAttemptTimeoutMs * runtimeConfig.dbMaxAttempts + 5_000, 180_000)
    )

    const app = options.app ?? createApp({ databaseLifecycle })
    const whatsapp = readWhatsappAssistant(app)
    if (whatsapp?.config.enabled && whatsapp.config.problems.length > 0)
      throw Object.assign(new Error('WhatsApp configuration is invalid'), { reason: 'WHATSAPP_CONFIG_INVALID' })
    server = await listen(app, port, host, runtimeConfig.shutdownTimeoutMs)
    lifecycle.register('database', databaseLifecycle.close)
    lifecycle.register('mongodb', disconnectMongoDB)
    lifecycle.register('redis', disconnectRedis)
    lifecycle.register('http', () =>
      closeHttpServer(server as Server, runtimeConfig.shutdownTimeoutMs)
    )
    const workerAbort = new AbortController()
    let workerPromise: Promise<void> | undefined
    if (whatsapp?.config.enabled) {
      const worker = whatsapp.crearWorker({
        log: (event, fields) => logger.info(event, { details: fields }),
      })
      lifecycle.register('whatsapp-worker', async () => {
        workerAbort.abort()
        await workerPromise
      })
      lifecycle.start()
      workerPromise = worker.ejecutar({ signal: workerAbort.signal }).catch((error: unknown) => {
        logger.error('whatsapp worker stopped', {
          details: { error: error instanceof Error ? error.name : 'unknown' },
        })
      })
    } else {
      lifecycle.start()
    }

    const shutdown = async (reason = 'signal') => {
      if (signalHandlersInstalled) {
        process.off('SIGTERM', onSigterm)
        process.off('SIGINT', onSigint)
        signalHandlersInstalled = false
      }
      await lifecycle.shutdown(reason)
    }
    const onSigterm = () => {
      void shutdown('SIGTERM')
    }
    const onSigint = () => {
      void shutdown('SIGINT')
    }

    if (options.installSignalHandlers !== false) {
      process.once('SIGTERM', onSigterm)
      process.once('SIGINT', onSigint)
      signalHandlersInstalled = true
    }

    logger.info('api listening', { details: { host, port } })
    return { server, lifecycle, shutdown }
  } catch (error) {
    if (server?.listening)
      await closeHttpServer(server, runtimeConfig.shutdownTimeoutMs).catch(() => undefined)
    await databaseLifecycle.close().catch(() => undefined)
    // Solo un código seguro (ver safeStartupReason), para poder diagnosticar desde los logs.
    throw Object.assign(new Error('API startup failed; diagnostics redacted'), { reason: safeStartupReason(error) })
  }
}

function readWhatsappAssistant(app: Application): ModuloWhatsapp | undefined {
  const value = app.locals['tusWhatsappAssistant']
  return value && typeof value === 'object' && 'config' in value && 'crearWorker' in value
    ? (value as ModuloWhatsapp)
    : undefined
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
      (value) => {
        if (timer) clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        if (timer) clearTimeout(timer)
        reject(error)
      }
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
