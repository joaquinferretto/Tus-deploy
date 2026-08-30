import Redis from 'ioredis'

let redisClient: Redis

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000)
        return delay
      },
      reconnectOnError(err) {
        const targetError = 'READONLY'
        if (err.message.includes(targetError)) {
          return true
        }
        return false
      },
    })

    redisClient.on('error', (err) => {
      console.error('Redis connection error:', err)
    })

    redisClient.on('connect', () => {
      console.log('Redis connected successfully')
    })
  }

  return redisClient
}

export async function checkRedis(): Promise<boolean> {
  try {
    const client = getRedisClient()
    const result = await client.ping()
    return result === 'PONG'
  } catch (error) {
    console.error('Redis health check failed:', error)
    return false
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
  }
}
