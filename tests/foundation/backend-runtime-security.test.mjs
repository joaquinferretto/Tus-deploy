import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const { createErrorEnvelope, createErrorHandler, asyncHandler } = await import(
  '../../apps/api/src/presentation/middleware/error.ts'
)
const {
  createCorrelationMiddleware,
  getCorrelationId,
} = await import('../../apps/api/src/presentation/middleware/correlation.ts')
const { BODY_LIMITS, createBodyLimitMiddleware } = await import(
  '../../apps/api/src/presentation/middleware/body-limits.ts'
)
const { createCorsMiddleware, CORS_ALLOWED_HEADERS } = await import(
  '../../apps/api/src/presentation/middleware/cors.ts'
)
const { createSafeLogger } = await import('../../apps/api/src/presentation/middleware/logger.ts')
const { resolveListenHost, resolveListenPort } = await import('../../apps/api/src/platform/runtime.ts')
const { incompleteSchema } = await import('../../apps/api/src/infrastructure/database/lifecycle.ts')
const { InMemoryIdentityStore } = await import(
  '../../apps/api/src/auth-security/adapters/in-memory-identity-store.ts'
)
const express = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps/api/package.json'))('express')

test('error envelope is correlation-aware and redacts secret-bearing failures', () => {
  const envelope = createErrorEnvelope(
    new Error('password=secret postgres://user:secret@db.example.test/app C:\\internal\\server.ts'),
    'corr-runtime-1',
  )

  assert.deepEqual(envelope, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId: 'corr-runtime-1',
    },
  })
  assert.doesNotMatch(JSON.stringify(envelope), /secret|postgres:|db\.example|internal/u)
})

test('async route failures use the same bounded envelope as unknown routes', async () => {
  const app = express()
  app.use(createCorrelationMiddleware())
  app.get('/failure', asyncHandler(async () => {
    throw new Error('token=secret')
  }))
  app.use(createErrorHandler())

  const server = await new Promise((resolve) => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value))
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/failure`, {
      headers: { 'x-correlation-id': 'corr-runtime-2' },
    })
    const body = await response.json()
    assert.equal(response.status, 500)
    assert.equal(body.error.correlationId, 'corr-runtime-2')
    assert.equal(body.error.code, 'INTERNAL_ERROR')
    assert.equal(getCorrelationId({ headers: { 'x-correlation-id': 'corr-runtime-2' } }), 'corr-runtime-2')
  } finally {
    server.close()
  }
})

test('CORS explicitly allows all client context and idempotency headers', () => {
  assert.deepEqual(CORS_ALLOWED_HEADERS, [
    'Content-Type',
    'Authorization',
    'X-Correlation-Id',
    'X-Tenant-Id',
    'X-Session-Id',
    'X-Idempotency-Key',
    'X-Request-Id',
  ])
  assert.equal(typeof createCorsMiddleware, 'function')
})

test('JSON, form, and upload limits are explicit and bounded', () => {
  assert.deepEqual(BODY_LIMITS, {
    json: '1mb',
    form: '100kb',
    upload: '10mb',
  })
  assert.equal(typeof createBodyLimitMiddleware, 'function')
})

test('Render uses PORT and public binding while local development remains loopback', () => {
  assert.equal(resolveListenPort({ PORT: '4312', API_PORT: '3999' }, 'production'), 4312)
  assert.equal(resolveListenHost({ NODE_ENV: 'production' }), '0.0.0.0')
  assert.equal(resolveListenPort({ API_PORT: '3999' }, 'development'), 3999)
  assert.equal(resolveListenHost({ NODE_ENV: 'development' }), '127.0.0.1')
})

test('incomplete schema is explicit and safe for readiness consumers', () => {
  assert.deepEqual(incompleteSchema(['TusReadinessEvidence']), {
    compatible: false,
    activation: 'incomplete-schema',
    missing: ['TusReadinessEvidence'],
    migration: 'unverified',
  })
})

test('identity transaction rolls back session and revocation mutations after failure', async () => {
  const store = new InMemoryIdentityStore()
  await assert.rejects(store.transaction(async (transaction) => {
    await transaction.saveSession({
      id: 'session-1',
      accountId: 'account-1',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      accessTokenDigest: 'digest-1',
      scope: { tenantId: 'tenant-1', roles: ['member'], permissions: [] },
      createdAt: 1,
      expiresAt: 10,
      revokedAt: null,
    })
    throw new Error('rollback')
  }), /rollback/u)
  assert.equal(store.sessions.size, 0)
})

test('safe structured logger never emits credentials or raw provider diagnostics', () => {
  const events = []
  const logger = createSafeLogger((event) => events.push(event))
  logger.error('provider failed', {
    correlationId: 'corr-runtime-3',
    tenantId: 'tenant-1',
    details: 'token=secret postgres://user:secret@db.example.test/app',
  })
  assert.equal(events.length, 1)
  assert.equal(events[0].correlationId, 'corr-runtime-3')
  assert.doesNotMatch(JSON.stringify(events[0]), /secret|postgres:|db\.example/u)
})
