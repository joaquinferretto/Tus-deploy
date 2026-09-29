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
import { createVersionRouter } from './presentation/routes/version.ts'
import { createTusIntegrationRouter } from './tus/integration/index.ts'
import { createTusHttpRouter } from './tus/http/router.ts'
import { createPrismaTusApplication } from './tus/composition/index.ts'
import { crearModuloWhatsappPrisma } from './tus/asistente/prisma-composicion.ts'
import { crearServicioSolicitudes } from './tus/solicitudes/composicion.ts'
import { crearRouterSolicitudes } from './tus/solicitudes/http.ts'
import { crearRouterMensajesTrabajo } from './tus/work/http-mensajes.ts'
import { crearRouterResumenTrabajo } from './tus/work/http-resumen.ts'
import { PrismaWorkSummarySource, ServicioResumenTrabajo } from './tus/work/resumen.ts'
import { AlmacenMensajesTrabajoPrisma, ServicioMensajesTrabajo, type ClientePrismaMensajesTrabajo } from './tus/work/mensajes.ts'
import { PrismaTrabajoStore } from './tus/adapters/prisma-work.ts'
import type { ClientePrismaSolicitudes } from './tus/solicitudes/almacenes.ts'
import { crearServicioDirectorio } from './tus/directorio/composicion.ts'
import { crearRouterDirectorio } from './tus/directorio/http.ts'
import { crearAltaPrestadorAdmin } from './tus/directorio/admin.ts'
import { crearRouterAyuda } from './tus/asistente/http-ayuda.ts'
import { crearRouterAdmin } from './tus/admin/http.ts'
import { crearRouterAdminTrabajos } from './tus/admin/trabajos.ts'
import { AlmacenCalificacionesPrisma, ServicioCalificaciones, type ClientePrismaCalificaciones } from './tus/reputacion/calificaciones.ts'
import { crearRouterCalificaciones } from './tus/reputacion/http.ts'
import { ActividadAdminPrisma, CuentasAdminPrisma } from './tus/admin/fuentes.ts'
import { AlmacenCatalogoPrisma, type ClientePrismaCatalogo } from './tus/catalogo/almacen.ts'
import { ConteosCatalogoPrisma, type ClientePrismaConteos } from './tus/admin/conteos.ts'
import { ServicioCatalogo } from './tus/catalogo/servicio.ts'
import { iniciarCatalogo } from './tus/catalogo/vigente.ts'
import { randomUUID } from 'node:crypto'
import type { ClientePrismaDirectorio } from './tus/directorio/almacenes.ts'
import type { ModuloWhatsapp } from './tus/asistente/composicion.ts'
import type { TusPrismaClient } from './tus/adapters/prisma.ts'
import { getPrismaClient } from './infrastructure/database/prisma/client.ts'
import { createPrismaAuthService } from './auth-security/composition.ts'
import { leerAdminsPlataforma } from './auth-security/application/auth-service.ts'
import { createAuthRouter } from './auth-security/http/auth-router.ts'
import { createFederatedAuth, createFederatedAuthRouter, readGoogleAuthSettings } from './auth-security/federated/composition.ts'
import type { FederatedPrismaClient } from './auth-security/federated/adapters/stores.ts'
import { DurableIdentitySessionResolver } from './auth-security/adapters/durable-session-resolver.ts'
import { createPrismaMfaService } from './auth-security/mfa/composition.ts'
import type { PrismaMfaClient } from './auth-security/mfa/adapters/prisma-mfa-store.ts'
import { MfaAdminSessionResolver } from './auth-security/mfa/admin-gate.ts'
import { createMfaRouter } from './auth-security/mfa/http/mfa-router.ts'
import { createSessionCookieMiddleware, readSessionCookieSettings } from './auth-security/http/session-cookie.ts'
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
  trustProxy?: number | string[] | false
}

export function createApp(options: CreateAppOptions = {}): Application {
  const app = express()
  app.set('trust proxy', options.trustProxy ?? resolveTrustProxy(process.env))
  const prisma = getPrismaClient() as unknown as TusPrismaClient
  const auth = createPrismaAuthService(prisma as unknown as PrismaIdentityClient, {
    platformAdminEmails: leerAdminsPlataforma(process.env['TUS_PLATFORM_ADMIN_EMAILS']),
    env: process.env,
  })
  // Platform admin permissions are honored only for sessions that passed the second factor:
  // every router below resolves sessions through the MFA gate (see mfa/admin-gate.ts).
  const rawSessions = new DurableIdentitySessionResolver(auth.store)
  const mfa = createPrismaMfaService(prisma as unknown as PrismaMfaClient, process.env)
  // Admin = allowlist (read live, removing an email ends access on the next request) + verified
  // email + MFA elevation of this session. Google sessions never carry admin scope.
  const sessions = new MfaAdminSessionResolver(rawSessions, mfa, auth.store, () =>
    leerAdminsPlataforma(process.env['TUS_PLATFORM_ADMIN_EMAILS'])
  )
  const sessionCookies = readSessionCookieSettings(process.env)
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
  // Administered catalog (trades, synonyms, locations): loaded from PostgreSQL now, refreshed
  // every minute and right after each change made in the admin panel.
  const almacenCatalogo = new AlmacenCatalogoPrisma(prisma as unknown as ClientePrismaCatalogo)
  app.locals['tusCatalogo'] = almacenCatalogo
  // FASE 9: provider ratings (client of a completed work, once); averages in one grouped read.
  const calificaciones = new ServicioCalificaciones({
    almacen: new AlmacenCalificacionesPrisma(prisma as unknown as ClientePrismaCalificaciones),
    trabajos: { buscarAccesible: (input) => new PrismaTrabajoStore(prisma).findAccessible(input) },
  })
  const directorio = crearServicioDirectorio({ application, prisma: prisma as unknown as ClientePrismaDirectorio, calificaciones: (tenantIds) => calificaciones.resumen(tenantIds) })
  // Every match (client picks an application / provider accepts a direct request) creates the
  // work in the same PostgreSQL transaction that assigns the request.
  const solicitudes = crearServicioSolicitudes({ cuentas: auth.store, destinos: directorio, prisma: prisma as unknown as ClientePrismaSolicitudes, ...(application.work ? { trabajos: application.work } : {}) })
  const whatsapp = options.tusRouter
    ? undefined
    : crearModuloWhatsappPrisma(prisma, application, auth.store, process.env, { directorio, solicitudes })
  const tusRouter = options.tusRouter ?? createTusHttpRouter({ application, sessions, whatsapp })
  if (whatsapp) app.locals['tusWhatsappAssistant'] = whatsapp

  // Security middleware
  app.use(correlationMiddleware)
  app.use(helmetMiddleware)
  app.use(corsMiddleware)
  // HttpOnly session cookie -> Authorization for every router, with CSRF origin checks.
  app.use(createSessionCookieMiddleware(sessionCookies))
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
      '/auth/mfa',
      '/auth/verify-email/resend',
      '/auth/admin/bootstrap-verify',
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
  app.use(createVersionRouter())
  app.use(
    createAuthRouter({
      service: auth.service,
      sessions,
      cookies: sessionCookies,
      describeCapabilities: async (accessToken, correlationId, context) => {
        const raw = await rawSessions.resolve(accessToken, correlationId)
        const merchant = await application.marketplace?.store.merchant.find(context.tenantId).catch(() => null)
        return { platformAdmin: raw ? await sessions.isAdminCandidate(raw) : false, provider: Boolean(merchant) }
      },
    })
  )
  app.use(
    createMfaRouter({
      service: mfa,
      sessions: rawSessions,
      accounts: auth.service,
      reauthenticate: (accountId, password) => auth.service.verifyCurrentPassword(accountId, password),
      adminCandidate: (context) => sessions.isAdminCandidate(context),
      rotate: (accessToken) => auth.service.rotateSession({ accessToken }),
      cookies: sessionCookies,
      notify: (accountId, kind) => auth.service.notifyAccount(accountId, kind),
    })
  )
  app.use(createFederatedAuthRouter(federated.service, federated.webBaseUrl ?? process.env['TUS_WEB_BASE_URL'] ?? null, sessionCookies))
  app.use(createTenancyRouter({ service: tenancy.service, sessions }))
  const tusRoutesEnabled =
    options.tusRoutesEnabled ??
    (options.tusRouter !== undefined || process.env['TUS_ROUTES_ENABLED'] === 'true')
  const providerRoutesEnabled =
    options.providerRoutesEnabled ?? process.env['TUS_PROVIDER_ACTIONS_ENABLED'] === 'true'
  if (tusRoutesEnabled) {
    app.use(crearRouterSolicitudes({ servicio: solicitudes, sessions }))
    // Private chat of each work (client <-> chosen provider), authorized against the work.
    const trabajosAccesibles = new PrismaTrabajoStore(prisma)
    app.use(crearRouterResumenTrabajo({ sessions, servicio: new ServicioResumenTrabajo(trabajosAccesibles, new PrismaWorkSummarySource(prisma as unknown as ConstructorParameters<typeof PrismaWorkSummarySource>[0]), Date.now, application.serviceFinance ?? null, calificaciones) }))
    app.use(crearRouterCalificaciones({ servicio: calificaciones, sessions }))
    app.use(crearRouterMensajesTrabajo({
      sessions,
      servicio: new ServicioMensajesTrabajo({
        mensajes: new AlmacenMensajesTrabajoPrisma(prisma as unknown as ClientePrismaMensajesTrabajo),
        trabajos: { buscarAccesible: (input) => trabajosAccesibles.findAccessible(input) },
      }),
    }))
    app.use(crearRouterDirectorio({ servicio: directorio, sessions, adminSave: crearAltaPrestadorAdmin({ accounts: auth.store, application, directorio, createManagedAccount: (input) => auth.service.createManagedProviderAccount(input) }) }))
    app.use(crearRouterAyuda({ ayuda: whatsapp?.ayuda ?? null }))
    // Platform administration panel (read views + publish/hide a profile), behind the MFA gate.
    // Usage counts of the catalog lists come from aggregate queries (GROUP BY), never per row.
    // Platform support over works (cancel with payments; never moves money).
    if (application.work) app.use(crearRouterAdminTrabajos({ sessions, trabajos: application.work }))
    const conteos = new ConteosCatalogoPrisma(prisma as unknown as ClientePrismaConteos)
    app.use(
      crearRouterAdmin({
        sessions,
        directorio,
        solicitudes,
        cuentas: new CuentasAdminPrisma(prisma as unknown as ConstructorParameters<typeof CuentasAdminPrisma>[0]),
        actividad: new ActividadAdminPrisma(prisma as unknown as ConstructorParameters<typeof ActividadAdminPrisma>[0]),
        adminEmails: () => leerAdminsPlataforma(process.env['TUS_PLATFORM_ADMIN_EMAILS']),
        crearUsuario: (input) => auth.service.createAccountAsAdmin(input),
        actualizarUsuario: (input) => auth.service.updateAccountAsAdmin(input),
        conteos,
        catalogo: new ServicioCatalogo({
          almacen: almacenCatalogo,
          auditar: async (evento) => {
            await (prisma as unknown as { auditEvent?: { create(input: { data: Record<string, unknown> }): Promise<unknown> } }).auditEvent?.create({
              data: { id: randomUUID(), tenantId: 'tus-platform', actorId: evento.actorId, correlationId: randomUUID(), eventType: `catalog.${evento.entidad}_${evento.accion}`, outcome: 'success', metadata: { id: evento.id, nombre: evento.nombre }, occurredAt: new Date() },
            })
          },
          referenciasBarrio: (nombre) => conteos.referenciasBarrio(nombre),
        }),
        ...(whatsapp ? { whatsappPendientes: async () => (await whatsapp.soporte.listar({ mode: 'human', limit: '100' })).length } : {}),
      })
    )
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
    // The administered catalog is read once the database is connected (never during createApp,
    // which tests build without a database).
    const catalogo = app.locals['tusCatalogo'] as AlmacenCatalogoPrisma | undefined
    if (catalogo) await iniciarCatalogo(catalogo)
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
