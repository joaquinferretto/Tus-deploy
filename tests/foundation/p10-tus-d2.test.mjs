import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  TUS_CONTRACT_VERSION,
  validarRespuestaDescubrimientoMercadoServicios,
} from '../../packages/contracts/src/index.ts'

function runTypeScriptScenario(source) {
  const root = join(import.meta.dirname, '..', '..')
  const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], { cwd: root, encoding: 'utf8' })
  return JSON.parse(output.trim())
}

test('D2 resolves the principal provider calendar and books a service publication by listingId', async () => {
  const result = await runTypeScriptScenario(`
    const { InMemoryMarketplaceStore, TusMarketplaceService } = await import('./apps/api/src/tus/catalog/index.ts')
    const { InMemoryServiceCalendarStore, ServiceCalendarService } = await import('./apps/api/src/tus/calendar/bookings.ts')
    const marketplaceStore = new InMemoryMarketplaceStore()
    const calendar = new ServiceCalendarService(new InMemoryServiceCalendarStore())
    const marketplace = new TusMarketplaceService(marketplaceStore, { calendarResolver: calendar })
    const merchant = { subjectId: 'merchant-user', sessionId: 'merchant-session', tenantId: 'merchant-tenant', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'], correlationId: 'corr-merchant' }
    const operator = { ...merchant, permissions: ['tus:marketplace:write', 'tus:calendar:write', 'tus:marketplace:read'] }
    const customer = { subjectId: 'customer-user', sessionId: 'customer-session', tenantId: 'customer-tenant', roles: ['customer'], permissions: ['tus:marketplace:read'], correlationId: 'corr-customer' }
    await marketplace.onboard(merchant, { merchantId: 'provider-1', cohort: 'repairs-trades', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1' })
    const listing = await marketplace.createListing(merchant, { merchantId: 'provider-1', kind: 'service', name: 'Repair', description: 'A scheduled repair', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, durationMinutes: 45, capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '12:00' }] })
    const published = await marketplace.publishListing(merchant, listing.listingId)
    await calendar.createCalendar(operator, { calendarId: 'calendar-primary', prestadorId: 'provider-1', timezone: 'America/Argentina/Buenos_Aires', capacity: 1, granularityMinutes: 15, bufferMinutes: 15, workingHours: [{ weekday: 1, start: '09:00', end: '12:00' }] })
    const discovery = await marketplace.discover()
    const item = discovery.items[0]
    const slots = await calendar.slotsForPublication(customer, published, item.calendarId, '2026-09-14', '2026-09-14T11:00:00.000Z')
    const first = await calendar.bookPublication(customer, published, { calendarId: item.calendarId, customerId: customer.subjectId, slotId: slots[0].slotId, idempotencyKey: 'booking-1', requestHash: 'hash-1', now: '2026-09-14T11:00:00.000Z' })
    const rejected = await calendar.bookPublication({ ...customer, subjectId: 'customer-2' }, published, { calendarId: item.calendarId, customerId: 'customer-2', slotId: slots[0].slotId, idempotencyKey: 'booking-2', requestHash: 'hash-2', now: '2026-09-14T11:00:00.000Z' })
    const replay = await calendar.bookPublication(customer, published, { calendarId: item.calendarId, customerId: customer.subjectId, slotId: slots[0].slotId, idempotencyKey: 'booking-1', requestHash: 'hash-1', now: '2026-09-14T11:00:00.000Z' })
    console.log(JSON.stringify({ item: { listingId: item.listingId, calendarId: item.calendarId, bookingMode: item.bookingMode, priceMode: item.priceMode, availabilityStatus: item.availabilityStatus }, slots: slots.slice(0, 2).map(({ slotId, listingId, serviceId, start, end }) => ({ slotId, listingId, serviceId, start, end })), first: { bookingId: first.bookingId, listingId: first.listingId, serviceId: first.serviceId }, rejected, replay: replay.status }))
  `)

  assert.equal(result.item.calendarId, 'calendar-primary')
  assert.equal(result.item.bookingMode, 'fixed_shift')
  assert.equal(result.item.priceMode, 'fixed')
  assert.equal(result.item.availabilityStatus, 'configured')
  assert.equal(result.slots[0].listingId, result.item.listingId ?? undefined)
  assert.equal('serviceId' in result.slots[0], false)
  assert.equal(result.first.listingId, result.item.listingId ?? undefined)
  assert.equal('serviceId' in result.first, false)
  assert.equal(result.rejected.status, 'rejected')
  assert.equal(result.replay, 'replay')
})

test('D2 exposes not_configured and blocks automatic booking for requires_budget services', async () => {
  const result = await runTypeScriptScenario(`
    const { InMemoryMarketplaceStore, TusMarketplaceService } = await import('./apps/api/src/tus/catalog/index.ts')
    const { InMemoryServiceCalendarStore, ServiceCalendarService } = await import('./apps/api/src/tus/calendar/bookings.ts')
    const calendar = new ServiceCalendarService(new InMemoryServiceCalendarStore())
    const marketplace = new TusMarketplaceService(new InMemoryMarketplaceStore(), { calendarResolver: calendar })
    const merchant = { subjectId: 'merchant-user', sessionId: 'merchant-session', tenantId: 'merchant-tenant', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'], correlationId: 'corr-merchant' }
    await marketplace.onboard(merchant, { merchantId: 'provider-1', cohort: 'beauty-personal-care', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1' })
    const listing = await marketplace.createListing(merchant, { merchantId: 'provider-1', kind: 'service', name: 'Estimate', description: 'A service requiring a quote', cohort: 'beauty-personal-care', locationId: 'location-1', currency: 'ARS', price: 1000, bookingMode: 'variable_duration', estimatedDurationMinutes: 30, capacity: 1, priceMode: 'requires_budget', workingHours: [{ day: 1, start: '09:00', end: '12:00' }] })
    const published = await marketplace.publishListing(merchant, listing.listingId)
    const discovery = await marketplace.discover()
     let code = ''
     const customer = { ...merchant, subjectId: 'customer', roles: ['customer'], permissions: ['tus:marketplace:read'] }
     try { await calendar.slotsForPublication(customer, published, undefined, '2026-09-14') } catch (error) { code = error.code }
     await calendar.createCalendar({ ...merchant, permissions: ['tus:calendar:write'] }, { calendarId: 'calendar-primary', prestadorId: 'provider-1', timezone: 'America/Argentina/Buenos_Aires', capacity: 1, granularityMinutes: 15, bufferMinutes: 15, workingHours: [{ weekday: 1, start: '09:00', end: '12:00' }] })
     let bookingCode = ''
     try { await calendar.bookPublication(customer, published, { calendarId: 'calendar-primary', customerId: 'customer', slotId: 'calendar-primary:listing:2026-09-14T09:00:00.000Z', idempotencyKey: 'budget-booking', requestHash: 'budget-hash', now: '2026-09-01T00:00:00.000Z' }) } catch (error) { bookingCode = error.code }
     const item = discovery.items[0]
     console.log(JSON.stringify({ version: discovery.contractVersion, item: { contractVersion: item.contractVersion, listingId: item.listingId, tenantId: item.tenantId, merchantId: item.merchantId, kind: item.kind, name: item.name, description: item.description, cohort: item.cohort, locationId: item.locationId, currency: item.currency, price: item.price, availabilityVersion: item.availabilityVersion, published: true, policyVersion: item.policyVersion, durationMinutes: null, capacity: item.capacity, workingHours: [{ day: 1, start: '09:00', end: '12:00' }], timezone: item.timezone, bookingMode: item.bookingMode, estimatedDurationMinutes: item.estimatedDurationMinutes, priceMode: item.priceMode, availabilityStatus: item.availabilityStatus }, code, bookingCode }))
  `)

  validarRespuestaDescubrimientoMercadoServicios({ contractVersion: result.version, evidence: 'local-deterministic', items: [{ ...result.item, timezone: 'America/Argentina/Buenos_Aires' }] })
  assert.equal(result.version, TUS_CONTRACT_VERSION)
  assert.equal(result.item.availabilityStatus, 'not_configured')
  assert.equal(result.item.bookingMode, 'variable_duration')
  assert.equal(result.item.estimatedDurationMinutes, 30)
  assert.equal(result.item.priceMode, 'requires_budget')
  assert.equal(result.code, 'NOT_CONFIGURED')
  assert.equal(result.bookingCode, 'BUDGET_REQUIRED')
})

test('D2 applies the physical publication modes to effective duration and automatic booking', async () => {
  const result = await runTypeScriptScenario(`
    const { InMemoryMarketplaceStore, TusMarketplaceService } = await import('./apps/api/src/tus/catalog/index.ts')
    const { InMemoryServiceCalendarStore, ServiceCalendarService } = await import('./apps/api/src/tus/calendar/bookings.ts')
    const merchant = { subjectId: 'merchant-user', sessionId: 'merchant-session', tenantId: 'merchant-tenant', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'], correlationId: 'corr-merchant' }
    const customer = { subjectId: 'customer-user', sessionId: 'customer-session', tenantId: 'customer-tenant', roles: ['customer'], permissions: ['tus:marketplace:read'], correlationId: 'corr-customer' }
    const calendar = new ServiceCalendarService(new InMemoryServiceCalendarStore())
    const marketplace = new TusMarketplaceService(new InMemoryMarketplaceStore(), { calendarResolver: calendar })
    await marketplace.onboard(merchant, { merchantId: 'provider-1', cohort: 'repairs-trades', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1' })
    const diagnostic = await marketplace.createListing(merchant, { merchantId: 'provider-1', kind: 'service', name: 'Diagnostic', description: 'Diagnostic visit', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, bookingMode: 'visita_diagnostico', durationMinutes: 35, capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '12:00' }] })
    const estimated = await marketplace.createListing(merchant, { merchantId: 'provider-1', kind: 'service', name: 'Estimated', description: 'Estimated visit', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, bookingMode: 'duracion_estimada', estimatedDurationMinutes: 20, capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '12:00' }] })
    const budget = await marketplace.createListing(merchant, { merchantId: 'provider-1', kind: 'service', name: 'Budget', description: 'Budget visit', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, bookingMode: 'requiere_presupuesto', capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '12:00' }] })
    const publishedDiagnostic = await marketplace.publishListing(merchant, diagnostic.listingId)
    const publishedEstimated = await marketplace.publishListing(merchant, estimated.listingId)
    const publishedBudget = await marketplace.publishListing(merchant, budget.listingId)
    await calendar.createCalendar({ ...merchant, permissions: ['tus:calendar:write'] }, { calendarId: 'calendar-primary', prestadorId: 'provider-1', timezone: 'America/Argentina/Buenos_Aires', capacity: 1, granularityMinutes: 15, bufferMinutes: 0, workingHours: [{ weekday: 1, start: '09:00', end: '12:00' }] })
    const diagnosticSlots = await calendar.slotsForPublication(customer, publishedDiagnostic, undefined, '2026-09-14')
    const estimatedSlots = await calendar.slotsForPublication(customer, publishedEstimated, undefined, '2026-09-14')
    let budgetCode = ''
    try { await calendar.slotsForPublication(customer, publishedBudget, undefined, '2026-09-14') } catch (error) { budgetCode = error.code }
    console.log(JSON.stringify({ diagnostic: { mode: publishedDiagnostic.bookingMode, duration: Date.parse(diagnosticSlots[0].end) - Date.parse(diagnosticSlots[0].start) }, estimated: { mode: publishedEstimated.bookingMode, duration: Date.parse(estimatedSlots[0].end) - Date.parse(estimatedSlots[0].start) }, budget: { mode: publishedBudget.bookingMode, duration: publishedBudget.durationMinutes, estimated: publishedBudget.estimatedDurationMinutes, budgetCode } }))
  `)

  assert.deepEqual(result.diagnostic, { mode: 'visita_diagnostico', duration: 35 * 60 * 1000 })
  assert.deepEqual(result.estimated, { mode: 'duracion_estimada', duration: 20 * 60 * 1000 })
  assert.deepEqual(result.budget, { mode: 'requiere_presupuesto', duration: null, estimated: null, budgetCode: 'BUDGET_REQUIRED' })
})

test('D2 exposes canonical listing slots and idempotent booking over HTTP without serviceId', async () => {
  const result = await runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('merchant-token', { sessionId: 'merchant-session', subjectId: 'merchant-user', tenantId: 'merchant-tenant', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read', 'tus:calendar:write'] })
    sessions.add('customer-token', { sessionId: 'customer-session', subjectId: 'customer-user', tenantId: 'customer-tenant', roles: ['customer'], permissions: ['tus:marketplace:read'] })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }), tusRoutesEnabled: true })
    const server = app.listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const request = async (token, method, path, body, key) => { const response = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-correlation-id': 'corr-d2', ...(key ? { 'idempotency-key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() } }
    await request('merchant-token', 'POST', '/tus/v1/marketplace/onboarding', { merchantId: 'provider-1', cohort: 'repairs-trades', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1' })
    const listing = await request('merchant-token', 'POST', '/tus/v1/marketplace/listings', { merchantId: 'provider-1', kind: 'service', name: 'Repair', description: 'A scheduled repair', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, durationMinutes: 45, capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '12:00' }] })
    await request('merchant-token', 'POST', '/tus/v1/marketplace/listings/' + listing.body.listingId + '/publish', {})
    await request('merchant-token', 'POST', '/tus/v1/calendar', { calendarId: 'calendar-primary', prestadorId: 'provider-1', timezone: 'America/Argentina/Buenos_Aires', capacity: 1, granularityMinutes: 15, bufferMinutes: 15, workingHours: [{ weekday: 1, start: '09:00', end: '12:00' }] })
    const discovery = await request('', 'GET', '/tus/v1/marketplace/discovery')
    const facts = discovery.body.items.find(({ listingId }) => listingId === listing.body.listingId)
    const slots = await request('customer-token', 'GET', '/tus/v1/marketplace/listings/' + listing.body.listingId + '/slots?date=2026-09-14&now=2026-09-14T11:00:00.000Z')
    const body = { listingId: listing.body.listingId, customerId: 'customer-user', slotId: slots.body.slots[0].slotId, requestHash: 'booking-hash', now: '2026-09-14T11:00:00.000Z' }
    const first = await request('customer-token', 'POST', '/tus/v1/calendar/bookings', body, 'booking-key')
    const replay = await request('customer-token', 'POST', '/tus/v1/calendar/bookings', body, 'booking-key')
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    console.log(JSON.stringify({ facts: { listingId: facts.listingId, calendarId: facts.calendarId, availabilityStatus: facts.availabilityStatus }, slots: { status: slots.status, listingId: slots.body.slots[0].listingId, serviceId: slots.body.slots[0].serviceId }, first, replay }))
  `)

  assert.equal(result.facts.calendarId, 'calendar-primary')
  assert.equal(result.facts.availabilityStatus, 'configured')
  assert.equal(result.slots.status, 200)
  assert.equal(result.slots.listingId, result.facts.listingId)
  assert.equal('serviceId' in result.slots, false)
  assert.equal(result.first.status, 201)
  assert.equal(result.first.body.listingId, result.facts.listingId)
  assert.equal('serviceId' in result.first.body, false)
  assert.equal(result.replay.status, 200)
  assert.equal(result.replay.body.status, 'replay')
})
