import express from 'express'
import type { Application } from 'express'
import { helmetMiddleware } from './presentation/middleware/helmet'
import { rateLimitMiddleware } from './presentation/middleware/rate-limit'
import { corsMiddleware } from './presentation/middleware/cors'
import { healthRouter } from './presentation/routes/health'

const PORT = Number(process.env['API_PORT'] || process.env['PORT'] || 3001)

export function createApp(): Application {
  const app = express()

  // Security middleware
  app.use(helmetMiddleware)
  app.use(corsMiddleware)
  app.use(rateLimitMiddleware)

  // Body parsing
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  // Routes
  app.use(healthRouter)

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
