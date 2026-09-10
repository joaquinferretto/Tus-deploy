import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveMongoUrl } from '../../apps/api/src/infrastructure/database/mongodb/connection.ts'

test('MONGODB_URL is canonical and takes precedence over the compatibility alias', () => {
  assert.equal(
    resolveMongoUrl({
      MONGODB_URL: 'mongodb://canonical.example/app',
      MONGODB_URI: 'mongodb://legacy.example/app',
      NODE_ENV: 'production',
    }),
    'mongodb://canonical.example/app'
  )
})

test('development accepts MONGODB_URI only as a compatibility fallback', () => {
  assert.equal(
    resolveMongoUrl({ MONGODB_URI: 'mongodb://legacy.example/app', NODE_ENV: 'development' }),
    'mongodb://legacy.example/app'
  )
  assert.equal(resolveMongoUrl({ NODE_ENV: 'development' }), 'mongodb://localhost:27017/appdb')
})

test('production fails closed when neither the canonical key nor its compatibility alias exists', () => {
  assert.throws(
    () => resolveMongoUrl({ NODE_ENV: 'production' }),
    (error) => error instanceof Error && error.message === 'MONGODB_URL is required in production'
  )
})
