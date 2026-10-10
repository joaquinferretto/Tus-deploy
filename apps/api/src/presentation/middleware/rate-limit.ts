import rateLimit from 'express-rate-limit'
import RedisStore from 'rate-limit-redis'
import { WEBHOOK_PATH_PREFIXES } from './body-limits.ts'

function createRedisStore(prefix: string): RedisStore | undefined {
  const useRedisStore = process.env['NATIVE_PROFILE'] !== '1' && Boolean(process.env['REDIS_URL'])
  return useRedisStore
    ? new RedisStore({
      sendCommand: async (...args: string[]) => {
        const { getRedisClient } = await import('../../infrastructure/database/redis/client.js')
        const client = getRedisClient() as unknown as { call(...command: string[]): Promise<never> }
        return client.call(...args)
      },
      prefix,
    })
    : undefined
}

const redisStore = createRedisStore('rl:global:')

export const rateLimitMiddleware = rateLimit({
  ...(redisStore ? { store: redisStore } : {}),
  windowMs: 15 * 60 * 1000, // 15 minutes
  // Generous per IP: map, directory and navigation make many reads (and many people share a
  // carrier NAT). Sensitive auth has its own per-IP limit plus durable per-account limits.
  max: 1500,
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks. Signed provider webhooks (Meta, Mercado Pago) come
    // from a few provider IPs in bursts: they use `webhookRateLimitMiddleware` instead.
    return req.path === '/health' || req.path === '/ready' || WEBHOOK_PATH_PREFIXES.some((prefix) => req.path.startsWith(prefix))
  },
})

const webhookRedisStore = createRedisStore('rl:webhooks:')

export const webhookRateLimitMiddleware = rateLimit({
  ...(webhookRedisStore ? { store: webhookRedisStore } : {}),
  windowMs: 60 * 1000,
  max: 600,
  message: { error: 'Too many webhook requests.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const authRedisStore = createRedisStore('rl:auth:')

// AUTH-LIMITE-01. Reads of the own session state that an authenticated screen makes on every load
// (the administration asks whether its second factor is active). They try no secret: a wrong
// answer teaches nothing, so they do not spend the budget of the sensitive operations. They are
// still under the general limit above. Everything else under the sensitive prefixes (sign-in,
// registration, recovery, verification, every MFA challenge and change) keeps the strict limit.
export const LECTURAS_DE_SESION = ['/auth/mfa/status'] as const
export const esLecturaDeSesion = (method: string, originalUrl: string): boolean =>
  (method === 'GET' || method === 'HEAD') && (LECTURAS_DE_SESION as readonly string[]).includes(originalUrl.split('?')[0]!.replace(/\/+$/u, ''))

export const authRateLimitMiddleware = rateLimit({
  ...(authRedisStore ? { store: authRedisStore } : {}),
  windowMs: 15 * 60 * 1000,
  // Per IP on login/reset/verify/MFA; per-email and per-account limits live in PostgreSQL.
  max: 40,
  skip: (req) => esLecturaDeSesion(req.method, req.originalUrl),
  message: {
    error: 'Too many authentication attempts from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
})
