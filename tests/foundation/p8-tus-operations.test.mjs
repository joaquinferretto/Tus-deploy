import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

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

function context(overrides = {}) {
  return {
    sessionId: 'session-ops-a',
    subjectId: 'merchant-a',
    tenantId: 'tenant-a',
    roles: ['merchant-admin'],
    permissions: ['tus:marketplace:read', 'tus:reporting:read', 'tus:support:write', 'tus:whatsapp:write'],
    correlationId: 'corr-ops-a',
    ...overrides,
  }
}

test('WU6 enforces typed WhatsApp actions, consent, expiring confirmation, and tenant isolation', () => {
  const result = runTypeScriptScenario(`
    const { TusWhatsAppService, InMemoryWhatsAppActionStore } = (await import('./apps/api/src/tus/whatsapp/index.ts')).default
    const service = new TusWhatsAppService({
      store: new InMemoryWhatsAppActionStore(),
      discover: async (tenantId) => tenantId === 'tenant-a' ? [{ listingId: 'listing-a', tenantId, name: 'Haircut', price: 1200, currency: 'ARS' }] : [],
      commitments: async (tenantId, commitmentId) => tenantId === 'tenant-a' && commitmentId === 'commitment-a' ? { commitmentId, tenantId, status: 'pending' } : null,
      now: () => Date.parse('2026-08-26T12:00:00.000Z'),
    })
    const staff = ${JSON.stringify(context())}
    const search = await service.execute({ ...staff, senderId: 'customer-a', action: { type: 'search', tenantId: 'tenant-a' }, consent: true, idempotencyKey: 'wa-search', requestHash: 'search-v1' })
    const quote = await service.execute({ ...staff, senderId: 'customer-a', action: { type: 'quote', tenantId: 'tenant-a' }, consent: true, idempotencyKey: 'wa-quote', requestHash: 'quote-v1' })
    const confirmation = await service.execute({ ...staff, senderId: 'customer-a', action: { type: 'confirm', tenantId: 'tenant-a', confirmationId: quote.confirmationId }, confirmationId: quote.confirmationId, consent: true, idempotencyKey: 'wa-confirm', requestHash: 'confirm-v1' })
    const replay = await service.execute({ ...staff, senderId: 'customer-a', action: { type: 'confirm', tenantId: 'tenant-a', confirmationId: quote.confirmationId }, confirmationId: quote.confirmationId, consent: true, idempotencyKey: 'wa-confirm', requestHash: 'confirm-v1' })
    const foreign = await service.execute({ ...staff, senderId: 'customer-a', action: { type: 'status', tenantId: 'tenant-b', commitmentId: 'commitment-a' }, consent: true, idempotencyKey: 'wa-foreign', requestHash: 'foreign-v1' })
    const optOut = await service.execute({ ...staff, senderId: 'customer-a', action: { type: 'search', tenantId: 'tenant-a' }, consent: false, idempotencyKey: 'wa-optout', requestHash: 'optout-v1' })
    console.log(JSON.stringify({ search, quote, confirmation, replay, foreign, optOut, audits: service.audit.list('tenant-a') }))
  `)

  assert.equal(result.search.status, 'completed')
  assert.equal(result.search.items[0].tenantId, 'tenant-a')
  assert.equal(result.quote.expiresAt, '2026-08-26T12:05:00.000Z')
  assert.equal(result.confirmation.status, 'confirmed')
  assert.equal(result.replay.status, 'replay')
  assert.equal(result.foreign.status, 'handoff')
  assert.equal(result.optOut.status, 'handoff')
  assert.equal(result.audits.some(({ action, outcome }) => action === 'whatsapp.action.denied' && outcome === 'denied'), true)
})

test('WU6 hands off sensitive WhatsApp actions and never collects credentials', () => {
  const result = runTypeScriptScenario(`
    const { TusWhatsAppService, InMemoryWhatsAppActionStore } = (await import('./apps/api/src/tus/whatsapp/index.ts')).default
    const service = new TusWhatsAppService({ store: new InMemoryWhatsAppActionStore(), now: () => Date.parse('2026-08-26T12:00:00.000Z') })
    const handoff = await service.execute({ ...${JSON.stringify(context())}, senderId: 'customer-a', action: { type: 'refund', tenantId: 'tenant-a' }, consent: true, idempotencyKey: 'wa-refund', requestHash: 'refund-v1' })
    console.log(JSON.stringify(handoff))
  `)

  assert.equal(result.status, 'handoff')
  assert.equal(result.reason, 'sensitive_action_requires_authenticated_handoff')
  assert.equal(result.credentialsCollected, false)
  assert.equal(result.mutated, false)
})

test('WU6 supports bilateral evidence, auditable timelines, and compensating dispute outcomes', () => {
  const result = runTypeScriptScenario(`
    const { TusSupportService, InMemorySupportStore } = (await import('./apps/api/src/tus/support/index.ts')).default
    const service = new TusSupportService({ store: new InMemorySupportStore(), now: () => Date.parse('2026-08-26T12:00:00.000Z') })
    const customer = ${JSON.stringify(context({ subjectId: 'customer-a', roles: ['customer'], permissions: ['tus:support:write'] }))}
    const merchant = ${JSON.stringify(context({ subjectId: 'merchant-a', roles: ['merchant-admin'], permissions: ['tus:support:write'] }))}
    const support = ${JSON.stringify(context({ subjectId: 'support-a', roles: ['support-agent'], permissions: ['tus:support:write', 'tus:disputes:decide'] }))}
    const opened = await service.openCase(customer, { caseId: 'case-a', commitmentId: 'commitment-a', category: 'delivery_incident', disputeId: 'dispute-a' })
    await service.submitEvidence(customer, { caseId: opened.caseId, evidenceId: 'evidence-customer', party: 'customer', summary: 'Package was not received' })
    await service.submitEvidence(merchant, { caseId: opened.caseId, evidenceId: 'evidence-merchant', party: 'merchant', summary: 'Carrier scan and handoff record' })
    const resolved = await service.resolveCase(support, { caseId: opened.caseId, outcome: 'partial-refund', amount: 500, reason: 'Evidence supports a partial remedy' })
    let foreign = ''
    try { await service.getCase({ ...support, tenantId: 'tenant-b' }, opened.caseId) } catch (error) { foreign = error.code }
    console.log(JSON.stringify({ opened, resolved, foreign, timeline: service.timeline('tenant-a', opened.caseId), audits: service.audit.list('tenant-a') }))
  `)

  assert.equal(result.opened.status, 'open')
  assert.equal(result.resolved.status, 'resolved')
  assert.equal(result.resolved.outcome, 'partial-refund')
  assert.equal(result.resolved.compensatingEntry.amount, 500)
  assert.equal(result.timeline.length, 4)
  assert.equal(result.foreign, 'FORBIDDEN')
  assert.equal(result.audits.some(({ action }) => action === 'support.case.resolved'), true)
})

test('WU6 returns tenant-safe reports and immutable-ledger dimensions without platform leakage', () => {
  const result = runTypeScriptScenario(`
    const { TusReportingService, InMemoryReportingStore } = (await import('./apps/api/src/tus/reporting/index.ts')).default
    const store = new InMemoryReportingStore()
    store.add({ tenantId: 'tenant-a', context: 'product', channel: 'web', geography: 'palermo', outcome: 'fulfilled', amount: 1200, currency: 'ARS', ledgerStatus: 'pending', whatsappActions: 2, disputes: 0, posOffline: 1 })
    store.add({ tenantId: 'tenant-b', context: 'service', channel: 'whatsapp', geography: 'belgrano', outcome: 'pending', amount: 800, currency: 'ARS', ledgerStatus: 'frozen', whatsappActions: 4, disputes: 1, posOffline: 0 })
    const service = new TusReportingService({ store, now: () => Date.parse('2026-08-26T12:00:00.000Z') })
    const report = await service.operations({ ...${JSON.stringify(context())}, from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T23:59:59.000Z' })
    let foreign = ''
    try { await service.operations({ ...${JSON.stringify(context())}, tenantId: 'tenant-b' }) } catch (error) { foreign = error.code }
    console.log(JSON.stringify({ report, foreign }))
  `)

  assert.equal(result.report.tenantId, 'tenant-a')
  assert.equal(result.report.dimensions.supply, 1)
  assert.equal(result.report.dimensions.whatsappActions, 2)
  assert.equal(result.report.currency, 'ARS')
  assert.equal(result.report.sourceVersion, 'tus-operations-v1')
  assert.equal(result.foreign, 'FORBIDDEN')
})

test('WU6 removes revoked and stale listings from SEO output and renders canonical structured data', () => {
  const result = runTypeScriptScenario(`
    const { createDiscoverySeoModel, createSitemap, createRobots } = (await import('./apps/api/src/tus/reporting/index.ts')).default
    const current = '2026-08-26T12:00:00.000Z'
    const active = createDiscoverySeoModel({ listingId: 'listing-a', tenantId: 'tenant-a', slug: 'haircut-palermo', name: 'Haircut', description: 'A precise cut', currency: 'ARS', price: 1200, location: 'Palermo', availability: 'today', published: true, cohortApproved: true, policyCurrent: true, updatedAt: current, canonicalBaseUrl: 'https://tusservicios.com', now: current })
    const revoked = createDiscoverySeoModel({ ...active, listingId: 'listing-b', slug: 'revoked', published: false })
    const stale = createDiscoverySeoModel({ ...active, listingId: 'listing-c', slug: 'stale', updatedAt: '2026-07-01T12:00:00.000Z', freshnessWindowMs: 60 * 60 * 1000 })
    console.log(JSON.stringify({ active, revoked, stale, sitemap: createSitemap([active, revoked, stale]), robots: createRobots() }))
  `)

  assert.equal(result.active.indexable, true)
  assert.equal(result.active.canonicalUrl, 'https://tusservicios.com/tus/listing/haircut-palermo')
  assert.equal(result.active.structuredData.price, 1200)
  assert.equal(result.revoked.indexable, false)
  assert.equal(result.stale.indexable, false)
  assert.deepEqual(result.sitemap, ['https://tusservicios.com/tus/listing/haircut-palermo'])
  assert.match(result.robots, /Disallow: \/tus\/listing\//)
})

test('WU6 emits correlated redacted telemetry and alertable tenant-boundary signals', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryTelemetry, createTusOperationsTelemetry } = (await import('./packages/observability/src/index.ts'))
    const telemetry = createInMemoryTelemetry({ idPrefix: 'ops' })
    const hooks = createTusOperationsTelemetry(telemetry)
    hooks.record({ name: 'tus.authorization.denied', tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a', outcome: 'denied', latencyMs: 12, attributes: { authorization: 'Bearer secret-value', resource: 'tenant-b' } })
    console.log(JSON.stringify({ logs: telemetry.logs, metrics: telemetry.metricSamples, traces: telemetry.traces }))
  `)

  assert.equal(result.logs[0].correlationId, 'corr-a')
  assert.equal(result.logs[0].attributes.outcome, 'denied')
  assert.equal(result.logs[0].attributes.authorization, '[REDACTED]')
  assert.equal(result.metrics[0].name, 'tus.authorization.denied')
  assert.equal(result.traces[0].status, 'error')
  assert.doesNotMatch(JSON.stringify(result), /secret-value/)
})

test('WU6 exposes operations routes and SEO foundations without enabling financial release', () => {
  const source = readFileSync(join(root, 'apps/api/src/tus/http/router.ts'), 'utf8')
  const page = readFileSync(join(root, 'apps/web/src/app/tus/page.tsx'), 'utf8')
  const observability = readFileSync(join(root, 'packages/observability/src/index.ts'), 'utf8')
  assert.match(source, /whatsapp\/actions/)
  assert.match(source, /support\/cases/)
  assert.match(source, /reports\/operations/)
  assert.match(page, /Reporting|Support|WhatsApp/)
  assert.match(observability, /createTusOperationsTelemetry/)
  assert.doesNotMatch(source, /payout|release.*enabled/i)
})
