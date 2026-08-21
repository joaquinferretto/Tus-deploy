import assert from 'node:assert/strict'
import { test } from 'node:test'

const { buildNativeReadiness } = await import('../../packages/config/src/index.ts')

test('native readiness requires PostgreSQL and reports every dependency independently', async () => {
  const readiness = await buildNativeReadiness({
    postgresCheck: async () => false,
    modes: {
      mongodb: 'optional',
      redis: 'disabled',
      pythonWorker: 'fake',
      mobileSupport: 'fake',
      externalProviders: 'disabled',
    },
    checks: {
      mongodb: async () => false,
    },
  })

  assert.equal(readiness.profile, 'native')
  assert.equal(readiness.postgres.mode, 'required')
  assert.equal(readiness.postgres.status, 'unavailable')
  assert.equal(readiness.postgres.blocksApiReadiness, true)
  assert.equal(readiness.mongodb.mode, 'optional')
  assert.equal(readiness.mongodb.status, 'unavailable')
  assert.equal(readiness.mongodb.blocksApiReadiness, false)
  assert.deepEqual(readiness.redis, { mode: 'disabled', status: 'ready', blocksApiReadiness: false })
  assert.deepEqual(readiness.pythonWorker, { mode: 'fake', status: 'ready', blocksApiReadiness: false })
  assert.deepEqual(readiness.mobileSupport, { mode: 'fake', status: 'ready', blocksApiReadiness: false })
  assert.deepEqual(readiness.externalProviders, { mode: 'disabled', status: 'ready', blocksApiReadiness: false })
})

test('native fake and disabled states do not invoke optional dependency checks', async () => {
  const calls = []
  const readiness = await buildNativeReadiness({
    postgresCheck: async () => true,
    checks: {
      mongodb: async () => { calls.push('mongodb'); return true },
      redis: async () => { calls.push('redis'); return true },
    },
  })

  assert.equal(readiness.postgres.status, 'ready')
  assert.equal(calls.length, 0)
  assert.equal(readiness.mongodb.mode, 'disabled')
  assert.equal(readiness.redis.mode, 'disabled')
})

test('compose profile does not inherit native disabled defaults', async () => {
  const readiness = await buildNativeReadiness({
    profile: 'compose',
    postgresCheck: async () => true,
  })

  assert.equal(readiness.profile, 'compose')
  assert.equal(readiness.mongodb.mode, 'required')
  assert.equal(readiness.redis.mode, 'required')
  assert.equal(readiness.pythonWorker.mode, 'required')
  assert.equal(readiness.mobileSupport.mode, 'required')
  assert.equal(readiness.externalProviders.mode, 'fake')
  assert.equal(readiness.mongodb.blocksApiReadiness, true)
})
