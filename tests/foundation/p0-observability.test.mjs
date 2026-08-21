import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const { createContextMiddleware, createInMemoryTelemetry } = await import('../../packages/observability/src/index.ts')

test('correlation middleware preserves safe context and redacts sensitive fields', () => {
  const telemetry = createInMemoryTelemetry()
  const middleware = createContextMiddleware({ telemetry })
  const request = { headers: { 'x-correlation-id': 'corr-123', authorization: 'Bearer secret-value' } }
  const response = { setHeader: () => undefined }
  let nextContext

  middleware(request, response, (context) => {
    nextContext = context
  })

  assert.equal(nextContext.correlationId, 'corr-123')
  assert.equal(nextContext.tenantId, undefined)
  assert.ok(telemetry.logs.some((entry) => entry.correlationId === 'corr-123'))
  assert.doesNotMatch(JSON.stringify(telemetry.logs), /secret-value/)
})

test('observability package exposes ports without direct vendor SDK imports', () => {
  const source = readFileSync(new URL('../../packages/observability/src/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /@opentelemetry|@sentry|langsmith|aws-sdk/i)
  assert.match(source, /interface TracerPort/)
  assert.match(source, /interface MetricPort/)
})
