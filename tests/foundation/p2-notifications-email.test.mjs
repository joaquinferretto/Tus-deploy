import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })

  return JSON.parse(output.trim())
}

function context(tenantId, actorId = `${tenantId}-actor`) {
  return {
    tenantId,
    workspaceId: `${tenantId}-workspace`,
    actorId,
    correlationId: `${tenantId}-${actorId}`,
  }
}

function request(overrides = {}) {
  return {
    context: context('tenant-a'),
    userId: 'user-a',
    recipient: 'user-a@example.test',
    category: 'product',
    template: 'notification',
    variables: { title: 'Ready', body: 'Your export is ready.' },
    idempotencyKey: 'notification-a',
    now: 100,
    ...overrides,
  }
}

test('P2.6 publishes notification, email-status, and preference schemas', () => {
  const names = ['notification', 'email-status', 'preferences']
  const schemas = names.map((name) =>
    JSON.parse(
      readFileSync(
        join(root, `packages/contracts/schemas/notifications/${name}.schema.json`),
        'utf8'
      )
    )
  )

  assert.deepEqual(
    schemas.map((schema) => schema.$id),
    names.map(
      (name) => `https://golden-boilerplate.dev/contracts/notifications/${name}.v1.schema.json`
    )
  )
  assert.ok(
    schemas.every((schema) => schema.type === 'object' && schema.additionalProperties === false)
  )
})

test('email templates render deterministic text and HTML without leaking unrelated variables', () => {
  const result = runTypeScriptScenario(`
    const { renderEmailTemplate } = await import('./packages/email/src/index.ts')
    const rendered = renderEmailTemplate('notification', { title: 'Ready', body: 'Export complete' })
    console.log(JSON.stringify({ subject: rendered.subject, text: rendered.text, html: rendered.html }))
  `)

  assert.deepEqual(result, {
    subject: 'Ready',
    text: 'Export complete',
    html: '<p>Export complete</p>',
  })
})

test('tenant and user opt-in suppress delivery until both preferences are enabled', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryNotificationService } = (await import('./apps/api/src/platform/notifications/composition.ts')).default
    const service = createInMemoryNotificationService({ now: () => 100 })
    await service.preferences.setTenantOptIn('tenant-a', true)
    const userDisabled = await service.send(${JSON.stringify(request())})
    await service.preferences.setUserOptIn('tenant-a', 'user-a', true)
    const delivered = await service.send(${JSON.stringify(request({ idempotencyKey: 'notification-b' }))})
    console.log(JSON.stringify({ suppressed: userDisabled.notification.status, delivered: delivered.notification.status, sent: service.provider.sent.length }))
  `)

  assert.deepEqual(result, { suppressed: 'suppressed', delivered: 'sent', sent: 1 })
})

test('notification quota is tenant-scoped and rejects only the exhausted tenant', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryNotificationService } = (await import('./apps/api/src/platform/notifications/composition.ts')).default
    const service = createInMemoryNotificationService({ now: () => 100 })
    await service.preferences.setTenantOptIn('tenant-a', true)
    await service.preferences.setTenantOptIn('tenant-b', true)
    await service.preferences.setUserOptIn('tenant-a', 'user-a', true)
    await service.preferences.setUserOptIn('tenant-b', 'user-b', true)
    service.quota.setLimit('tenant-a', 1)
    service.quota.setLimit('tenant-b', 1)
    const first = await service.send(${JSON.stringify(request())})
    const exhausted = await service.send(${JSON.stringify(request({ idempotencyKey: 'notification-c' }))})
    const otherTenant = await service.send(${JSON.stringify(request({ context: context('tenant-b'), userId: 'user-b', recipient: 'user-b@example.test', idempotencyKey: 'notification-d' }))})
    console.log(JSON.stringify({ first: first.notification.status, exhausted: exhausted.code, otherTenant: otherTenant.notification.status }))
  `)

  assert.deepEqual(result, { first: 'sent', exhausted: 'QUOTA_EXCEEDED', otherTenant: 'sent' })
})

test('provider failure is durably retryable with bounded exponential backoff', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryNotificationService } = (await import('./apps/api/src/platform/notifications/composition.ts')).default
    const service = createInMemoryNotificationService({ now: () => 100, baseDelayMs: 10, maxAttempts: 3 })
    await service.preferences.setTenantOptIn('tenant-a', true)
    await service.preferences.setUserOptIn('tenant-a', 'user-a', true)
    service.provider.failNext = 1
    const queued = await service.send(${JSON.stringify(request())})
    const tooEarly = await service.retry({ context: ${JSON.stringify(context('tenant-a'))}, notificationId: queued.notification.notificationId, now: 109 })
    service.provider.failNext = 0
    const delivered = await service.retry({ context: ${JSON.stringify(context('tenant-a'))}, notificationId: queued.notification.notificationId, now: 110 })
    console.log(JSON.stringify({ queued: queued.notification.status, nextAttemptAt: queued.notification.nextAttemptAt, tooEarly: tooEarly.code, delivered: delivered.notification.status, attempts: delivered.notification.attempts, sent: service.provider.sent.length }))
  `)

  assert.deepEqual(result, {
    queued: 'retryable',
    nextAttemptAt: 110,
    tooEarly: 'RETRY_NOT_DUE',
    delivered: 'sent',
    attempts: 2,
    sent: 1,
  })
})

test('idempotency returns the original delivery and provider outage remains recoverable', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryNotificationService } = (await import('./apps/api/src/platform/notifications/composition.ts')).default
    const service = createInMemoryNotificationService({ now: () => 100, baseDelayMs: 10 })
    await service.preferences.setTenantOptIn('tenant-a', true)
    await service.preferences.setUserOptIn('tenant-a', 'user-a', true)
    service.provider.available = false
    const unavailable = await service.send(${JSON.stringify(request())})
    const duplicate = await service.send(${JSON.stringify(request())})
    service.provider.available = true
    const recovered = await service.retry({ context: ${JSON.stringify(context('tenant-a'))}, notificationId: unavailable.notification.notificationId, now: 110 })
    console.log(JSON.stringify({ unavailable: unavailable.notification.status, duplicate: duplicate.idempotent, recovered: recovered.notification.status, sends: service.provider.sent.length }))
  `)

  assert.deepEqual(result, {
    unavailable: 'retryable',
    duplicate: true,
    recovered: 'sent',
    sends: 1,
  })
})

test('SES adapter is explicit and disabled without activation or provider credentials', () => {
  const result = runTypeScriptScenario(`
    const { SesEmailProvider, EmailProviderUnavailableError } = await import('./packages/email/src/index.ts')
    const provider = new SesEmailProvider({ send: async () => ({ providerMessageId: 'live' }) }, { activation: 'disabled', configRef: 'secret://ses' })
    let code = ''
    try { await provider.send({ emailId: 'email-a', tenantId: 'tenant-a', recipient: 'user@example.test', template: 'notification', variables: { title: 'T', body: 'B' }, rendered: { subject: 'T', text: 'B', html: '<p>B</p>' } }) } catch (error) { code = error instanceof EmailProviderUnavailableError ? error.code : 'WRONG_ERROR' }
    console.log(JSON.stringify({ code, configRef: provider.configRef }))
  `)

  assert.deepEqual(result, { code: 'PROVIDER_UNAVAILABLE', configRef: 'secret://ses' })
})

test('notification domain and email ports remain vendor-free', () => {
  const result = runTypeScriptScenario(`
    const { readFileSync } = await import('node:fs')
    const files = [
      './apps/api/src/platform/notifications/domain.ts',
      './apps/api/src/platform/notifications/ports.ts',
      './apps/api/src/platform/notifications/application/notification-service.ts',
      './packages/email/src/domain.ts',
      './packages/email/src/ports.ts',
      './packages/email/src/templates.ts',
      './packages/email/src/fakes.ts',
      './packages/email/src/ses.ts',
    ]
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\\n')
    console.log(JSON.stringify({ forbidden: /@aws-sdk|aws-sdk|boto3|@google-cloud|azure/i.test(source), activation: source.includes('activation') }))
  `)

  assert.deepEqual(result, { forbidden: false, activation: true })
})
