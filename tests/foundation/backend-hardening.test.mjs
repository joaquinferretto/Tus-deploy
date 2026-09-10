import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const { loadApiRuntimeConfig, readRootDatabaseUrl, validateDevelopmentSeedRequest } = await import(
  '../../apps/api/src/platform/configuration/domain.ts'
)
const { withBoundedDatabaseStartupRetry } = await import(
  '../../apps/api/src/infrastructure/database/postgres/pool.ts'
)
const { createHealthRouter } = await import('../../apps/api/src/presentation/routes/health.ts')
const { startServer } = await import('../../apps/api/src/server.ts')
const { createLifecycle } = await import('../../packages/lifecycle/src/index.ts')
const { redactText } = await import('../../packages/errors/src/index.ts')
const express = createRequire(join(import.meta.dirname, '..', '..', 'apps/api/package.json'))('express')

test('API configuration reads only root DATABASE_URL and seed safety fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tus-backend-hardening-'))
  try {
    await writeFile(join(root, '.env'), 'DATABASE_URL=postgresql://user:secret@localhost/tus\n', 'utf8')

    assert.equal(readRootDatabaseUrl(root), 'postgresql://user:secret@localhost/tus')
    const runtimeConfig = loadApiRuntimeConfig({ rootDirectory: root, environment: { NODE_ENV: 'development', TUS_POSTGRES_URL: 'wrong' } })
    assert.equal(runtimeConfig.dbAttemptTimeoutMs, 60_000)
    assert.equal(runtimeConfig.providersEnabled, false)
    assert.equal(
      validateDevelopmentSeedRequest({ environment: 'development', confirmed: false }),
      'explicit-development-confirmation-required',
    )
    assert.equal(
      validateDevelopmentSeedRequest({ environment: 'production', confirmed: true }),
      'development-environment-required',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('database startup makes exactly two bounded attempts and closes each failed pool', async () => {
  let attempts = 0
  let closed = 0

  await assert.rejects(
    withBoundedDatabaseStartupRetry(
      async ({ attempt, timeoutMs, registerResource }) => {
        attempts += 1
        assert.equal(attempt, attempts)
        assert.equal(timeoutMs, 60_000)
        const pool = {
          query: async () => { throw new Error('password=secret') },
          end: async () => { closed += 1 },
        }
        registerResource(pool)
        await pool.query('SELECT 1')
        return pool
      },
      { backoffMs: 0 },
    ),
    (error) => error.attempts === 2 && error.diagnostics.length === 2,
  )

  assert.equal(attempts, 2)
  assert.equal(closed, 2)
})

test('failed database startup never invokes the listener', async () => {
  let listens = 0
  const lifecycle = {
    connect: async () => { throw new Error('postgresql://user:secret@host/db unavailable') },
    checkSchema: async () => ({ compatible: false, activation: 'unverified', missing: ['schema'], migration: 'unverified' }),
    close: async () => undefined,
  }
  const app = {
    listen: () => {
      listens += 1
      throw new Error('listener must not start')
    },
  }

  await assert.rejects(startServer({ app, databaseLifecycle: lifecycle, installSignalHandlers: false }), /database|startup|unavailable/i)
  assert.equal(listens, 0)
})

test('readiness is false when the schema is incompatible even if dependencies are reachable', async () => {
  const body = {
    profile: 'native',
    postgres: { mode: 'required', status: 'ready', blocksApiReadiness: false },
    mongodb: { mode: 'disabled', status: 'ready', blocksApiReadiness: false },
    redis: { mode: 'disabled', status: 'ready', blocksApiReadiness: false },
    pythonWorker: { mode: 'disabled', status: 'ready', blocksApiReadiness: false },
    mobileSupport: { mode: 'fake', status: 'ready', blocksApiReadiness: false },
    externalProviders: { mode: 'disabled', status: 'ready', blocksApiReadiness: false },
    schema: { compatible: false, activation: 'incompatible', missing: ['TusReadinessEvidence'], migration: 'unverified' },
  }
  const router = createHealthRouter({ getReadiness: async () => body })
  const result = await new Promise((resolve, reject) => {
    const app = express()
    app.use(router)
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const address = server.address()
        const response = await fetch(`http://127.0.0.1:${address.port}/ready`)
        resolve({ status: response.status, body: await response.json() })
      } catch (error) {
        reject(error)
      } finally {
        server.close()
      }
    })
  })

  assert.equal(result.status, 503)
  assert.equal(result.body.ready, false)
  assert.equal(result.body.schema.compatible, false)
  assert.doesNotMatch(JSON.stringify(result.body), /secret|postgresql:\/\//u)
})

test('shutdown attempts every owned resource and remains bounded after a close failure', async () => {
  const closed = []
  const lifecycle = createLifecycle({ shutdownTimeoutMs: 100 })
  lifecycle.register('first', async () => { closed.push('first'); throw new Error('raw secret') })
  lifecycle.register('second', async () => { closed.push('second') })

  await assert.rejects(lifecycle.shutdown('test'), /shutdown|secret/)
  assert.deepEqual(closed, ['second', 'first'])
  assert.equal(lifecycle.state(), 'stopped')
})

test('diagnostics redact credentials and database URLs before they leave the process', () => {
  const diagnostic = redactText('password=secret postgres://user:secret@db.example.test/tus at C:\\internal\\server.ts')
  assert.doesNotMatch(diagnostic, /secret|postgres:\/\//u)
  assert.doesNotMatch(diagnostic, /db\.example\.test|C:\\internal/u)
})
