import cors from 'cors'

export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Correlation-Id',
  'X-Tenant-Id',
  'X-Session-Id',
  'X-Idempotency-Key',
  'X-Request-Id',
] as const

export function createCorsMiddleware(environment: Record<string, string | undefined> = process.env) {
  const allowedOrigins = (environment['CORS_ORIGINS'] ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
      const error = Object.assign(new Error('Origin is not allowed'), { code: 'CORS_ORIGIN_DENIED' })
      callback(error)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    maxAge: 86400,
  })
}

export const corsMiddleware = createCorsMiddleware()
