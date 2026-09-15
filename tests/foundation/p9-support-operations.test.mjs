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
    sessionId: 'session-pr8-a',
    subjectId: 'support-actor-a',
    tenantId: 'tenant-a',
    roles: ['support-agent'],
    permissions: ['tus:whatsapp:write', 'tus:support:write', 'tus:disputes:decide', 'tus:reporting:read'],
    correlationId: 'corr-pr8-a',
    ...overrides,
  }
}

test('BUILD 12E1 y 12H normalizan Soporte en Prisma y conservan las FKs tenant-scoped canonicas', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260827090700_tus_support_reporting/migration.sql'), 'utf8')

  assert.match(schema, /model CasoSoporte[\s\S]*?casoId\s+String\s+@map\("caso_id"\)/)
  assert.match(schema, /model EvidenciaSoporte[\s\S]*?evidenciaId\s+String\s+@map\("evidencia_id"\)/)
  assert.match(schema, /model LineaTiempoSoporte[\s\S]*?entradaId\s+String\s+@map\("entrada_id"\)/)
  assert.match(schema, /model CompensacionSoporte[\s\S]*?monto\s+BigInt\s+@map\("monto"\)/)
  assert.match(schema, /model OutboxSoporte\s+\{[\s\S]*?tipoEvento\s+String\s+@map\("tipo_evento"\)/)
  assert.doesNotMatch(schema, /model TusSupport(Case|Evidence|Timeline|Compensation)\s+\{/)
  assert.match(schema, /model EvidenciaSoporte[\s\S]*?caso\s+CasoSoporte\s+@relation\(fields: \[tenantId, casoId\], references: \[tenantId, casoId\], onDelete: Restrict, onUpdate: NoAction, map: "fk_evidencias_soporte_casos_soporte"\)/)
  assert.match(schema, /model LineaTiempoSoporte[\s\S]*?caso\s+CasoSoporte\s+@relation\(fields: \[tenantId, casoId\], references: \[tenantId, casoId\], onDelete: Restrict, onUpdate: NoAction, map: "fk_lineas_tiempo_soporte_casos_soporte"\)/)
  assert.match(schema, /model CompensacionSoporte[\s\S]*?caso\s+CasoSoporte\s+@relation\(fields: \[tenantId, casoId\], references: \[tenantId, casoId\], onDelete: Restrict, onUpdate: NoAction, map: "fk_compensaciones_soporte_casos_soporte"\)/)
  for (const table of ['casos_soporte', 'evidencias_soporte', 'lineas_tiempo_soporte', 'compensaciones_soporte']) assert.match(schema, new RegExp(`@@map\\("${table}"\\)`))
  for (const index of ['uq_casos_soporte_tenant_caso', 'uq_evidencias_soporte_tenant_evidencia', 'uq_lineas_tiempo_tenant_entrada', 'uq_compensaciones_soporte_tenant_caso']) assert.match(schema, new RegExp(`map: "${index}"`))
  for (const table of ['TusSupportCase', 'TusSupportEvidence', 'TusSupportTimeline', 'TusSupportCompensation']) assert.match(migration, new RegExp(`CREATE TABLE "${table}"`))
})

test('BUILD 12H adapta OutboxSoporte y RegistroOperaciones con campos Prisma españoles', () => {
  const result = runTypeScriptScenario(`
    const { PrismaSupportStore } = (await import('./apps/api/src/tus/support/index.ts')).default
    const { PrismaReportingStore } = (await import('./apps/api/src/tus/reporting/index.ts')).default
    const calls = []
    const client = {
      outboxSoporte: { create: async (input) => { calls.push(input); return input.data }, findMany: async () => [{ eventoId: 'event-support', tenantId: 'tenant-a', correlacionId: 'corr-a', tipoEvento: 'support.case.opened', agregadoId: 'case-a', datosEvento: { caseId: 'case-a' }, estado: 'pending', fechaCreacion: new Date('2026-08-27T12:00:00.000Z') }] },
      registroOperaciones: { findMany: async () => [{ tenantId: 'tenant-a', contexto: 'service', canal: 'web', geografia: 'ar', resultado: 'fulfilled', monto: 2500n, moneda: 'ARS', estadoContable: 'posted', accionesWhatsApp: 1, disputas: 0, posFueraLinea: 0, fechaCreacion: new Date('2026-08-27T12:00:00.000Z') }] },
    }
    const support = new PrismaSupportStore(client)
    const reporting = new PrismaReportingStore(client)
    await support.outbox.append({ eventId: 'event-support', tenantId: 'tenant-a', correlationId: 'corr-a', eventType: 'support.case.opened', aggregateId: 'case-a', payload: { caseId: 'case-a' }, status: 'pending', createdAt: '2026-08-27T12:00:00.000Z' })
    console.log(JSON.stringify({ outbox: await support.outbox.list('tenant-a'), report: await reporting.list('tenant-a'), create: calls[0] }))
  `)
  assert.equal(result.outbox[0].eventId, 'event-support')
  assert.equal(result.report[0].context, 'service')
  assert.equal(result.report[0].amount, 2500)
  assert.deepEqual(result.create.data, { id: 'tenant-a:event-support', tenantId: 'tenant-a', eventoId: 'event-support', correlacionId: 'corr-a', tipoEvento: 'support.case.opened', agregadoId: 'case-a', datosEvento: { caseId: 'case-a' }, estado: 'pending', fechaCreacion: '2026-08-27T12:00:00.000Z' })
 })

test('BUILD 12E1 adapta la persistencia Prisma de Soporte a nombres internos españoles', () => {
  const result = runTypeScriptScenario(`
    const { PrismaSupportStore } = (await import('./apps/api/src/tus/support/index.ts')).default
    const calls = []
    const caseRow = { casoId: 'case-a', disputaId: 'dispute-a', tenantId: 'tenant-a', correlacionId: 'corr-a', compromisoId: 'commitment-a', abiertoPor: 'actor-a', categoria: 'delivery', estado: 'open', resultado: null, fechaCreacion: new Date('2026-08-27T12:00:00.000Z'), fechaResolucion: null }
    const evidenceRow = { evidenciaId: 'evidence-a', casoId: 'case-a', tenantId: 'tenant-a', correlacionId: 'corr-a', parte: 'customer', resumen: 'Evidence', presentadaPor: 'actor-a', fechaCreacion: new Date('2026-08-27T12:01:00.000Z') }
    const timelineRow = { entradaId: 'entry-a', casoId: 'case-a', tenantId: 'tenant-a', correlacionId: 'corr-a', accion: 'support.case.opened', actorId: 'actor-a', fechaCreacion: new Date('2026-08-27T12:00:00.000Z') }
    const compensationRow = { entradaId: 'comp-a', casoId: 'case-a', tenantId: 'tenant-a', correlacionId: 'corr-a', monto: 500n, moneda: 'ARS', motivo: 'remedy', estado: 'recorded', liquidacion: 'not-released', fechaCreacion: new Date('2026-08-27T12:02:00.000Z') }
    const client = {
      casoSoporte: { upsert: async (input) => calls.push({ model: 'casoSoporte', input }), findUnique: async () => caseRow, findMany: async () => [caseRow] },
      evidenciaSoporte: { create: async (input) => calls.push({ model: 'evidenciaSoporte', input }), findMany: async () => [evidenceRow] },
      lineaTiempoSoporte: { create: async (input) => calls.push({ model: 'lineaTiempoSoporte', input }), findMany: async () => [timelineRow] },
      outboxSoporte: { create: async (input) => calls.push({ model: 'outboxSoporte', input }), findMany: async () => [] },
      compensacionSoporte: { upsert: async (input) => calls.push({ model: 'compensacionSoporte', input }), findUnique: async () => compensationRow },
    }
    const store = new PrismaSupportStore(client)
    await store.cases.save({ caseId: 'case-a', disputeId: 'dispute-a', tenantId: 'tenant-a', correlationId: 'corr-a', commitmentId: 'commitment-a', openedBy: 'actor-a', category: 'delivery', status: 'open', outcome: null, createdAt: '2026-08-27T12:00:00.000Z', resolvedAt: null })
    await store.evidence.save({ evidenceId: 'evidence-a', caseId: 'case-a', tenantId: 'tenant-a', correlationId: 'corr-a', party: 'customer', summary: 'Evidence', submittedBy: 'actor-a', createdAt: '2026-08-27T12:01:00.000Z' })
    await store.timeline.append({ entryId: 'entry-a', caseId: 'case-a', tenantId: 'tenant-a', correlationId: 'corr-a', action: 'support.case.opened', actorId: 'actor-a', createdAt: '2026-08-27T12:00:00.000Z' })
    await store.compensations.save({ entryId: 'comp-a', caseId: 'case-a', tenantId: 'tenant-a', correlationId: 'corr-a', amount: 500, currency: 'ARS', reason: 'remedy', status: 'recorded', settlement: 'not-released' })
    console.log(JSON.stringify({ found: await store.cases.find('tenant-a', 'case-a'), evidence: await store.evidence.list('tenant-a', 'case-a'), timeline: store.timeline.list('tenant-a', 'case-a'), compensation: await store.compensations.find('tenant-a', 'case-a'), calls }))
  `)

  assert.equal(result.found.caseId, 'case-a')
  assert.equal(result.evidence[0].evidenceId, 'evidence-a')
  assert.equal(result.timeline[0].entryId, 'entry-a')
  assert.equal(result.compensation.amount, 500)
  assert.deepEqual(result.calls.map(({ model }) => model), ['casoSoporte', 'evidenciaSoporte', 'lineaTiempoSoporte', 'compensacionSoporte'])
  assert.equal(Object.hasOwn(result.calls[0].input.create, 'caseId'), false)
  assert.equal(result.calls[0].input.create.casoId, 'case-a')
  assert.equal(result.calls[1].input.data.evidenciaId, 'evidence-a')
  assert.equal(result.calls[2].input.data.entradaId, 'entry-a')
  assert.equal(result.calls[3].input.create.monto, 500)
})

test('PR8 validates typed WhatsApp actions, sender authorization, quote freshness, confirmation expiry, and exactly-once commitment handoff', () => {
  const result = runTypeScriptScenario(`
    const { TusWhatsAppService, InMemoryWhatsAppActionStore } = (await import('./apps/api/src/tus/whatsapp/index.ts')).default
    let now = Date.parse('2026-08-27T12:00:00.000Z')
    let currentPrice = 1200
    const committed = []
    const service = new TusWhatsAppService({
      store: new InMemoryWhatsAppActionStore(),
      authorizedSenders: { 'tenant-a': ['+549111'] },
      discover: async (tenantId) => tenantId === 'tenant-a' ? [{ listingId: 'listing-a', tenantId, name: 'Haircut', price: currentPrice, currency: 'ARS', availabilityVersion: 2, available: true }] : [],
      commit: async (input) => { committed.push(input); return { commitmentId: 'commitment-wa-a', tenantId: input.tenantId, amount: input.items[0].price, currency: input.items[0].currency, status: 'pending' } },
      now: () => now,
    })
    const staff = ${JSON.stringify(context())}
    const quote = await service.execute({ ...staff, senderId: '+549111', action: { type: 'quote', tenantId: 'tenant-a' }, consent: true, idempotencyKey: 'wa-quote-pr8', requestHash: 'quote-pr8-v1' })
    const confirmation = await service.execute({ ...staff, senderId: '+549111', action: { type: 'confirm', tenantId: 'tenant-a', confirmationId: quote.confirmationId }, confirmationId: quote.confirmationId, consent: true, idempotencyKey: 'wa-confirm-pr8', requestHash: 'confirm-pr8-v1' })
    const replay = await service.execute({ ...staff, senderId: '+549111', action: { type: 'confirm', tenantId: 'tenant-a', confirmationId: quote.confirmationId }, confirmationId: quote.confirmationId, consent: true, idempotencyKey: 'wa-confirm-pr8', requestHash: 'confirm-pr8-v1' })
    const unauthorized = await service.execute({ ...staff, senderId: '+549999', action: { type: 'search', tenantId: 'tenant-a' }, consent: true, idempotencyKey: 'wa-unauthorized-pr8', requestHash: 'unauthorized-pr8-v1' })
    now += 6 * 60 * 1000
    const expired = await service.execute({ ...staff, senderId: '+549111', action: { type: 'confirm', tenantId: 'tenant-a', confirmationId: quote.confirmationId }, confirmationId: quote.confirmationId, consent: true, idempotencyKey: 'wa-expired-pr8', requestHash: 'expired-pr8-v1' })
    console.log(JSON.stringify({ quote, confirmation, replay, unauthorized, expired, committed }))
  `)

  assert.equal(result.quote.status, 'completed')
  assert.equal(result.confirmation.status, 'confirmed')
  assert.equal(result.confirmation.commitment.commitmentId, 'commitment-wa-a')
  assert.equal(result.replay.status, 'replay')
  assert.equal(result.committed.length, 1)
  assert.equal(result.unauthorized.status, 'handoff')
  assert.equal(result.unauthorized.reason, 'sender_not_authorized')
  assert.equal(result.expired.status, 'handoff')
  assert.equal(result.expired.reason, 'confirmation_expired_or_consumed')
})

test('PR8 fails closed for stale WhatsApp quotes, unsupported actions, missing consent, and credential-like input', () => {
  const result = runTypeScriptScenario(`
    const { TusWhatsAppService, InMemoryWhatsAppActionStore } = (await import('./apps/api/src/tus/whatsapp/index.ts')).default
    let currentPrice = 1200
    let commits = 0
    const service = new TusWhatsAppService({
      store: new InMemoryWhatsAppActionStore(),
      authorizedSenders: { 'tenant-a': ['+549111'] },
      discover: async () => [{ listingId: 'listing-a', tenantId: 'tenant-a', name: 'Haircut', price: currentPrice, currency: 'ARS', availabilityVersion: 2, available: currentPrice < 2000 }],
      commit: async () => { commits += 1; return { commitmentId: 'must-not-be-created' } },
      now: () => Date.parse('2026-08-27T12:00:00.000Z'),
    })
    const staff = ${JSON.stringify(context())}
    const quote = await service.execute({ ...staff, senderId: '+549111', action: { type: 'quote', tenantId: 'tenant-a' }, consent: true, idempotencyKey: 'wa-stale-quote', requestHash: 'stale-quote-v1' })
    currentPrice = 2000
    const stale = await service.execute({ ...staff, senderId: '+549111', action: { type: 'confirm', tenantId: 'tenant-a', confirmationId: quote.confirmationId }, confirmationId: quote.confirmationId, consent: true, idempotencyKey: 'wa-stale-confirm', requestHash: 'stale-confirm-v1' })
    const unsupported = await service.execute({ ...staff, senderId: '+549111', action: { type: 'refund', tenantId: 'tenant-a' }, consent: true, idempotencyKey: 'wa-refund-pr8', requestHash: 'refund-pr8-v1' })
    const noConsent = await service.execute({ ...staff, senderId: '+549111', action: { type: 'search', tenantId: 'tenant-a' }, consent: false, idempotencyKey: 'wa-no-consent-pr8', requestHash: 'no-consent-pr8-v1' })
    console.log(JSON.stringify({ stale, unsupported, noConsent, commits }))
  `)

  assert.equal(result.stale.reason, 'quote_stale_or_unavailable')
  assert.equal(result.stale.mutated, false)
  assert.equal(result.unsupported.reason, 'sensitive_action_requires_authenticated_handoff')
  assert.equal(result.noConsent.reason, 'messaging_consent_required')
  assert.equal(result.commits, 0)
  assert.equal(result.stale.credentialsCollected, false)
})

test('PR8 preserves bilateral support evidence, redacts sensitive summaries, and records an auditable compensating outcome', () => {
  const result = runTypeScriptScenario(`
    const { TusSupportService, InMemorySupportStore } = (await import('./apps/api/src/tus/support/index.ts')).default
    const service = new TusSupportService({ store: new InMemorySupportStore(), now: () => Date.parse('2026-08-27T12:00:00.000Z') })
    const customer = ${JSON.stringify(context({ subjectId: 'customer-a', roles: ['customer'], permissions: ['tus:support:write'] }))}
    const merchant = ${JSON.stringify(context({ subjectId: 'merchant-a', roles: ['merchant-admin'], permissions: ['tus:support:write'] }))}
    const support = ${JSON.stringify(context({ subjectId: 'support-a', roles: ['support-agent'], permissions: ['tus:support:write', 'tus:disputes:decide'] }))}
    const opened = await service.openCase(customer, { caseId: 'case-pr8', commitmentId: 'commitment-pr8', category: 'delivery_incident', disputeId: 'dispute-pr8' })
    const customerEvidence = await service.submitEvidence(customer, { caseId: opened.caseId, evidenceId: 'evidence-customer-pr8', party: 'customer', summary: 'Bearer customer-secret was not received' })
    await service.submitEvidence(merchant, { caseId: opened.caseId, evidenceId: 'evidence-merchant-pr8', party: 'merchant', summary: 'Handoff record is available' })
    const resolved = await service.resolveCase(support, { caseId: opened.caseId, outcome: 'partial-refund', amount: 500, reason: 'Bilateral evidence supports a partial remedy' })
    let secondResolution = ''
    try { await service.resolveCase(support, { caseId: opened.caseId, outcome: 'full-refund', amount: 1200, reason: 'duplicate decision' }) } catch (error) { secondResolution = error.code }
    console.log(JSON.stringify({ opened, customerEvidence, resolved, secondResolution, timeline: service.timeline('tenant-a', opened.caseId) }))
  `)

  assert.equal(result.opened.disputeId, 'dispute-pr8')
  assert.doesNotMatch(result.customerEvidence.summary, /customer-secret/)
  assert.equal(result.resolved.status, 'resolved')
  assert.equal(result.resolved.compensatingEntry.settlement, 'not-released')
  assert.equal(result.secondResolution, 'CASE_RESOLVED')
  assert.equal(result.timeline.length, 4)
})

test('PR8 reports freshness and tenant-safe dimensions, excludes revoked discovery, and emits redacted telemetry', () => {
  const result = runTypeScriptScenario(`
    const { TusReportingService, InMemoryReportingStore, createDiscoverySeoModel, createSitemap } = (await import('./apps/api/src/tus/reporting/index.ts')).default
    const { createInMemoryTelemetry, createTusOperationsTelemetry } = await import('./packages/observability/src/index.ts')
    const telemetry = createInMemoryTelemetry({ idPrefix: 'pr8' })
    const store = new InMemoryReportingStore()
    store.add({ tenantId: 'tenant-a', context: 'product', channel: 'web', geography: 'palermo', outcome: 'fulfilled', amount: 1200, currency: 'ARS', ledgerStatus: 'pending', whatsappActions: 2, disputes: 0, posOffline: 1, createdAt: '2026-08-27T11:00:00.000Z' })
    store.add({ tenantId: 'tenant-b', context: 'service', channel: 'whatsapp', geography: 'belgrano', outcome: 'pending', amount: 800, currency: 'ARS', ledgerStatus: 'frozen', whatsappActions: 4, disputes: 1, posOffline: 0, createdAt: '2026-08-27T11:00:00.000Z' })
    const service = new TusReportingService({ store, telemetry: createTusOperationsTelemetry(telemetry), now: () => Date.parse('2026-08-27T12:00:00.000Z') })
    const report = await service.operations({ ...${JSON.stringify(context())}, from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T23:59:59.000Z' })
    const current = createDiscoverySeoModel({ listingId: 'listing-pr8', tenantId: 'tenant-a', slug: 'haircut-palermo', name: 'Haircut', description: 'A precise cut', currency: 'ARS', locale: 'es-AR', price: 1200, location: 'Palermo', availability: 'today', published: true, cohortApproved: true, policyCurrent: true, revoked: false, updatedAt: '2026-08-27T11:00:00.000Z', canonicalBaseUrl: 'https://tusservicios.com', now: '2026-08-27T12:00:00.000Z' })
    const revoked = createDiscoverySeoModel({ ...current, listingId: 'listing-revoked-pr8', revoked: true })
    console.log(JSON.stringify({ report, current, revoked, sitemap: createSitemap([current, revoked]), logs: telemetry.logs, traces: telemetry.traces }))
  `)

  assert.equal(result.report.tenantId, 'tenant-a')
  assert.equal(result.report.dimensions.demand, 1)
  assert.equal(result.report.freshness.latestRecordAt, '2026-08-27T11:00:00.000Z')
  assert.equal(result.current.indexable, true)
  assert.equal(result.revoked.indexable, false)
  assert.deepEqual(result.sitemap, ['https://tusservicios.com/tus/listing/haircut-palermo'])
  assert.equal(result.logs[0].correlationId, 'corr-pr8-a')
  assert.equal(result.traces[0].status, 'ok')
})

test('PR8 exports versioned support and WhatsApp contract validators', () => {
  const result = runTypeScriptScenario(`
    const { TUS_CONTRACT_VERSION, validarCasoSoporte, validarAccionWhatsApp } = await import('./packages/contracts/src/index.ts')
    const support = validarCasoSoporte({ contractVersion: TUS_CONTRACT_VERSION, caseId: 'case-pr8', commitmentId: 'commitment-pr8', tenantId: 'tenant-a', actorId: 'support-a', correlationId: 'corr-pr8', category: 'delivery_incident', status: 'open' })
    const action = validarAccionWhatsApp({ contractVersion: TUS_CONTRACT_VERSION, type: 'quote', tenantId: 'tenant-a' })
    let invalid = ''
    try { validarAccionWhatsApp({ contractVersion: TUS_CONTRACT_VERSION, type: 'refund', tenantId: 'tenant-a' }) } catch (error) { invalid = error.message }
    console.log(JSON.stringify({ support, action, invalid }))
  `)

  assert.equal(result.support.caseId, 'case-pr8')
  assert.equal(result.action.type, 'quote')
  assert.match(result.invalid, /action type/i)
})

test('PR8 authenticated local HTTP smoke keeps support, reporting, and WhatsApp tenant-scoped', async () => {
  const result = runTypeScriptScenario(`
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const application = createTusApplication()
    await application.marketplace.store.commitments.saveMany([{ commitmentId: 'commitment-http-pr8', tenantId: 'tenant-a' }])
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('pr8-token', ${JSON.stringify(context())})
    const app = express()
    app.use(express.json())
    app.use(createTusHttpRouter({ application, sessions }))
    const server = app.listen(0)
    try {
      const port = server.address().port
      const headers = { authorization: 'Bearer pr8-token', 'x-correlation-id': 'corr-http-pr8', 'content-type': 'application/json' }
      const supportResponse = await fetch('http://127.0.0.1:' + port + '/tus/v1/soporte/cases', { method: 'POST', headers, body: JSON.stringify({ caseId: 'case-http-pr8', commitmentId: 'commitment-http-pr8', category: 'delivery_incident' }) })
      const reportResponse = await fetch('http://127.0.0.1:' + port + '/tus/v1/reports/operations', { headers })
      const whatsappResponse = await fetch('http://127.0.0.1:' + port + '/tus/v1/whatsapp/actions', { method: 'POST', headers: { ...headers, 'idempotency-key': 'wa-http-pr8' }, body: JSON.stringify({ action: { type: 'search', tenantId: 'tenant-a' }, senderId: '+549111', consent: true, requestHash: 'http-pr8-v1' }) })
      console.log(JSON.stringify({ supportStatus: supportResponse.status, support: await supportResponse.json(), reportStatus: reportResponse.status, report: await reportResponse.json(), whatsappStatus: whatsappResponse.status, whatsapp: await whatsappResponse.json() }))
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  `)

  assert.equal(result.supportStatus, 201)
  assert.equal(result.support.tenantId, 'tenant-a')
  assert.equal(result.reportStatus, 200)
  assert.equal(result.report.tenantId, 'tenant-a')
  assert.equal(result.whatsappStatus, 200)
  assert.equal(result.whatsapp.credentialsCollected, false)
})

test('PR4 requires a known commitment, preserves support correlation/outbox facts, and records mediation without finance or provider activity', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const application = createTusApplication()
    const customer = ${JSON.stringify(context({ subjectId: 'customer-pr4', roles: ['customer'], permissions: ['tus:support:write'] }))}
    const merchant = ${JSON.stringify(context({ subjectId: 'merchant-pr4', roles: ['merchant-admin'], permissions: ['tus:support:write'] }))}
    const support = ${JSON.stringify(context({ subjectId: 'support-pr4', roles: ['support-agent'], permissions: ['tus:support:write', 'tus:disputes:decide'] }))}
    const commitment = ${JSON.stringify({ contractVersion: '1.0.0', commitmentId: 'commitment-support-pr4', cartId: 'cart-support-pr4', tenantId: 'tenant-a', merchantId: 'merchant-a', context: 'service', amount: 2500, currency: 'ARS', status: 'pending', lineIds: ['line-pr4'], version: 1, createdAt: '2026-08-27T12:00:00.000Z' })}
    await application.marketplace.store.commitments.saveMany([commitment])
    let unknownCode = ''
    try { await application.support.openCase(customer, { caseId: 'case-unknown-pr4', commitmentId: 'missing-commitment-pr4', category: 'delivery_incident' }) } catch (error) { unknownCode = error.code }
    const opened = await application.support.openCase(customer, { caseId: 'case-support-pr4', commitmentId: commitment.commitmentId, category: 'delivery_incident' })
    await application.support.submitEvidence(customer, { caseId: opened.caseId, evidenceId: 'evidence-customer-pr4', party: 'customer', summary: 'Recipient did not receive the order' })
    await application.support.submitEvidence(merchant, { caseId: opened.caseId, evidenceId: 'evidence-merchant-pr4', party: 'merchant', summary: 'Merchant provided the handoff record' })
    const resolved = await application.support.resolveCase(support, { caseId: opened.caseId, outcome: 'partial-refund', amount: 400, reason: 'Evidence-based mediation only' })
    console.log(JSON.stringify({ unknownCode, opened, resolved, outbox: application.support.store.listOutbox('tenant-a'), providerCalls: application.finance.providerCalls ?? 0, ledger: application.finance.store.listLedger('tenant-a', commitment.commitmentId) }))
  `)

  assert.equal(result.unknownCode, 'NOT_FOUND')
  assert.equal(result.opened.commitmentId, 'commitment-support-pr4')
  assert.equal(result.opened.correlationId, 'corr-pr8-a')
  assert.equal(result.resolved.status, 'resolved')
  assert.equal(result.resolved.compensatingEntry.settlement, 'not-released')
  assert.equal(result.outbox.some(({ eventType, correlationId, payload }) => eventType === 'support.case.opened' && correlationId === 'corr-pr8-a' && payload.commitmentId === 'commitment-support-pr4'), true)
  assert.equal(result.outbox.some(({ eventType, payload }) => eventType === 'support.case.resolved' && payload.outcome === 'partial-refund'), true)
  assert.equal(result.providerCalls, 0)
  assert.deepEqual(result.ledger, [])
})
