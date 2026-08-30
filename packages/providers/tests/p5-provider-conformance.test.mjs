import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PROVIDER_NAMES,
  PROVIDER_STATUS,
  ProviderQuotaError,
  ProviderTimeoutError,
  createDeterministicProviderRegistry,
  createProviderRegistry,
  redactProviderError,
} from '../src/index.ts'
import { B2ProviderAdapter, DeterministicB2Provider } from '../src/b2/index.ts'
import { PostgresProviderAdapter, DeterministicPostgresProvider } from '../src/postgres/index.ts'
import { MongoProviderAdapter, DeterministicMongoProvider } from '../src/mongo/index.ts'
import { RedisProviderAdapter, DeterministicRedisProvider } from '../src/redis/index.ts'
import { SqsProviderAdapter, DeterministicSqsProvider } from '../src/sqs/index.ts'
import { AwsProviderAdapter, DeterministicAwsProvider } from '../src/aws/index.ts'
import { EmailProviderAdapter, DeterministicEmailProvider } from '../src/email/index.ts'
import { GroqProviderAdapter, DeterministicGroqProvider } from '../src/groq/neutral.ts'
import {
  NotificationProviderAdapter,
  DeterministicNotificationProvider,
} from '../src/notifications/index.ts'

const request = (provider, overrides = {}) => ({
  operation: 'write',
  tenantId: 'tenant-a',
  actorId: 'actor-a',
  correlationId: 'corr-a',
  idempotencyKey: `${provider}-request-1`,
  quotaUnits: 1,
  payload: { provider, value: 'neutral-fixture' },
  ...overrides,
})

test('P5.1 exposes configured ports and deterministic fakes for every provider boundary', async () => {
  const providers = createDeterministicProviderRegistry()

  for (const provider of Object.values(PROVIDER_NAMES)) {
    const result = await providers[provider].execute(request(provider))
    assert.equal(result.status, 'success')
    assert.equal(result.provider, provider)
    assert.equal(result.attempts, 1)
    assert.equal(result.duplicate, false)
  }

  assert.deepEqual(Object.keys(providers).sort(), Object.values(PROVIDER_NAMES).sort())
})

test('P5.1 fakes deterministically cover timeout retry duplicate and quota semantics', async () => {
  const providers = createDeterministicProviderRegistry({ quotaUnits: 2, maxAttempts: 2 })
  const groq = providers.groq

  groq.failNext = 1
  const retried = await groq.execute(request('groq', { idempotencyKey: 'retry-1' }))
  assert.equal(retried.attempts, 2)

  const duplicate = await groq.execute(request('groq', { idempotencyKey: 'retry-1' }))
  assert.equal(duplicate.duplicate, true)
  assert.deepEqual(duplicate.output, retried.output)

  groq.timeoutNext = 2
  await assert.rejects(
    () => groq.execute(request('groq', { idempotencyKey: 'timeout-1' })),
    ProviderTimeoutError
  )

  await assert.rejects(
    () => groq.execute(request('groq', { idempotencyKey: 'quota-1', quotaUnits: 3 })),
    ProviderQuotaError
  )
})

test('P5.1 redacts provider errors and makes live availability explicit', async () => {
  const registry = createProviderRegistry()
  assert.equal(registry.b2.status, PROVIDER_STATUS.FAKE)
  assert.equal(registry.b2.live.status, 'unavailable')
  assert.equal(registry.b2.liveConformanceClaimed, false)

  const error = redactProviderError('groq', new Error('token=secret-value prompt=private text'))
  assert.equal(error.message, 'groq provider request failed')
  assert.equal(error.message.includes('secret-value'), false)
  assert.equal(error.message.includes('private'), false)
  assert.equal(error.provider, 'groq')
})

test('P5.1 configured adapters use injected transports without SDK or live I/O', async () => {
  const calls = []
  const registry = createProviderRegistry({
    configured: Object.values(PROVIDER_NAMES),
    transports: Object.fromEntries(
      Object.values(PROVIDER_NAMES).map((provider) => [
        provider,
        async (input) => {
          calls.push({ provider, operation: input.operation })
          return { provider, accepted: true }
        },
      ])
    ),
  })

  for (const provider of Object.values(PROVIDER_NAMES)) {
    const result = await registry[provider].execute(request(provider))
    assert.deepEqual(result.output, { provider, accepted: true })
  }
  assert.equal(calls.length, Object.values(PROVIDER_NAMES).length)
})

test('P5.1 named adapters preserve provider-specific ports and fake dispositions', async () => {
  const cases = [
    [B2ProviderAdapter, DeterministicB2Provider, 'b2'],
    [PostgresProviderAdapter, DeterministicPostgresProvider, 'postgres'],
    [MongoProviderAdapter, DeterministicMongoProvider, 'mongo'],
    [RedisProviderAdapter, DeterministicRedisProvider, 'redis'],
    [SqsProviderAdapter, DeterministicSqsProvider, 'sqs'],
    [AwsProviderAdapter, DeterministicAwsProvider, 'aws'],
    [EmailProviderAdapter, DeterministicEmailProvider, 'email'],
    [GroqProviderAdapter, DeterministicGroqProvider, 'groq'],
    [NotificationProviderAdapter, DeterministicNotificationProvider, 'notifications'],
  ]

  for (const [Adapter, Fake, provider] of cases) {
    const adapter = new Adapter(async () => ({ accepted: provider }), {
      configRef: `secret-store:${provider}`,
    })
    const fake = new Fake()
    assert.equal((await adapter.execute(request(provider))).output.accepted, provider)
    assert.equal((await fake.execute(request(provider))).provider, provider)
    assert.equal(fake.live.status, 'unavailable')
  }
})

test('P5.1 provider source remains free of vendor SDK imports', async () => {
  const { readdir, readFile } = await import('node:fs/promises')
  const sourceFiles = []
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directory)
      if (entry.isDirectory()) await visit(path)
      else if (entry.name.endsWith('.ts')) sourceFiles.push(path)
    }
  }
  await visit(new URL('../src/', import.meta.url))
  const source = await Promise.all(sourceFiles.map((path) => readFile(path, 'utf8')))
  assert.equal(
    source.some((text) => /@aws-sdk|mongoose|mongodb|ioredis|@google-cloud|resend/.test(text)),
    false
  )
})
