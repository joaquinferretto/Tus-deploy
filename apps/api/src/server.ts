import express from 'express'
import type { Application, Router } from 'express'
import { helmetMiddleware } from './presentation/middleware/helmet.ts'
import { rateLimitMiddleware } from './presentation/middleware/rate-limit.ts'
import { corsMiddleware } from './presentation/middleware/cors.ts'
import { healthRouter } from './presentation/routes/health.ts'
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

const PORT = Number(process.env['API_PORT'] || process.env['PORT'] || 3001)

export function createApp(options: { tusRouter?: Router } = {}): Application {
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
  app.use(healthRouter)
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

export function startServer(): void {
  const app = createApp()

  app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`)
  })
}
