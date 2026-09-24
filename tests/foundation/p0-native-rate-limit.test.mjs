import assert from 'node:assert/strict'
import { test } from 'node:test'

test('native API can load rate limiting without attempting Redis when Redis is disabled', async () => {
  const previous = process.env.REDIS_URL
  const previousProfile = process.env.NATIVE_PROFILE
  delete process.env.REDIS_URL
  process.env.NATIVE_PROFILE = '1'
  try {
    const { authRateLimitMiddleware, rateLimitMiddleware } = await import('../../apps/api/src/presentation/middleware/rate-limit.ts')
    assert.equal(typeof rateLimitMiddleware, 'function')
    assert.equal(typeof authRateLimitMiddleware, 'function')
  } finally {
    if (previous === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = previous
    if (previousProfile === undefined) delete process.env.NATIVE_PROFILE
    else process.env.NATIVE_PROFILE = previousProfile
  }
})
