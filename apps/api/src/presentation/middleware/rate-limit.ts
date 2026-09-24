import rateLimit from 'express-rate-limit'
import RedisStore from 'rate-limit-redis'

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
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/ready'
  },
})

const authRedisStore = createRedisStore('rl:auth:')

export const authRateLimitMiddleware = rateLimit({
  ...(authRedisStore ? { store: authRedisStore } : {}),
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: 'Too many authentication attempts from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
})
