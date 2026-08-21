import assert from 'node:assert/strict'
import { test } from 'node:test'

const { loadRuntimeConfig } = await import('../../packages/config/src/index.ts')
const { redactError } = await import('../../packages/errors/src/index.ts')
const { createLifecycle } = await import('../../packages/lifecycle/src/index.ts')

test('production configuration fails fast without exposing secret values', () => {
  const reader = { get: (name) => ({ NODE_ENV: 'production', SERVICE_NAME: 'api' }[name]) }
  assert.throws(() => loadRuntimeConfig(reader), (error) => {
    assert.match(error.message, /secret|missing/i)
    assert.doesNotMatch(error.message, /super-secret-value/)
    return true
  })
})

test('errors redact credentials and lifecycle closes registered resources in order', async () => {
  const syntheticSecret = ['super', 'secret', 'value'].join('-')
  const redacted = redactError(new Error(`Authorization: Bearer ${syntheticSecret}`))
  assert.doesNotMatch(JSON.stringify(redacted), new RegExp(syntheticSecret))
  assert.match(redacted.message, /redacted/i)

  const events = []
  const lifecycle = createLifecycle({ shutdownTimeoutMs: 1000, onEvent: (event) => events.push(event) })
  lifecycle.register('database', async () => events.push('database-closed'))
  lifecycle.register('http', async () => events.push('http-closed'))
  await lifecycle.shutdown('test')
  assert.deepEqual(events.filter((event) => event.endsWith('-closed')), ['http-closed', 'database-closed'])
  assert.equal(lifecycle.state(), 'stopped')
})
