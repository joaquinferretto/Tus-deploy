import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

const requireApiDependency = createRequire(join(import.meta.dirname, '..', '..', 'apps/api/package.json'))
const express = requireApiDependency('express')

const { createHealthRouter } = await import('../../apps/api/src/presentation/routes/health.ts')

function request(router) {
  return new Promise((resolve, reject) => {
    const app = express()
    app.use(router)
    const server = createServer(app)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      fetch(`http://127.0.0.1:${address.port}/ready`)
        .then(async (response) => resolve({ status: response.status, body: await response.json() }))
        .catch(reject)
        .finally(() => server.close())
    })
    server.on('error', reject)
  })
}

test('native readiness endpoint exposes six dependency reports and only required failure blocks', async () => {
  const body = {
    profile: 'native',
    postgres: { mode: 'required', status: 'ready', blocksApiReadiness: false },
    mongodb: { mode: 'optional', status: 'unavailable', blocksApiReadiness: false },
    redis: { mode: 'disabled', status: 'ready', blocksApiReadiness: false },
    pythonWorker: { mode: 'fake', status: 'ready', blocksApiReadiness: false },
    mobileSupport: { mode: 'fake', status: 'ready', blocksApiReadiness: false },
    externalProviders: { mode: 'disabled', status: 'ready', blocksApiReadiness: false },
  }
  const result = await request(createHealthRouter({ getReadiness: async () => body }))

  assert.equal(result.status, 200)
  assert.deepEqual(result.body.dependencies, body)
  assert.equal(result.body.ready, true)
})

test('native readiness endpoint returns unavailable without credential details', async () => {
  const result = await request(createHealthRouter({
    getReadiness: async () => ({
      profile: 'native',
      postgres: { mode: 'required', status: 'unavailable', blocksApiReadiness: true },
      mongodb: { mode: 'disabled', status: 'ready', blocksApiReadiness: false },
      redis: { mode: 'disabled', status: 'ready', blocksApiReadiness: false },
      pythonWorker: { mode: 'disabled', status: 'ready', blocksApiReadiness: false },
      mobileSupport: { mode: 'fake', status: 'ready', blocksApiReadiness: false },
      externalProviders: { mode: 'disabled', status: 'ready', blocksApiReadiness: false },
    }),
  }))

  assert.equal(result.status, 503)
  assert.equal(result.body.ready, false)
  assert.equal(result.body.dependencies.postgres.status, 'unavailable')
  assert.equal(JSON.stringify(result.body).includes('DATABASE_URL'), false)
})
