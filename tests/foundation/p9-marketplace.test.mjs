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

test('PR4 publishes durable marketplace facts and emits tenant-scoped audit/outbox records', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryMarketplaceStore, TusMarketplaceService } = (await import('./apps/api/src/tus/catalog/index.ts')).default
    const { TUS_CONTRACT_VERSION, validarPublicacionMercadoServicios } = await import('./packages/contracts/src/tus.ts')
    const store = new InMemoryMarketplaceStore()
    const marketplace = new TusMarketplaceService(store)
    const merchantContext = { subjectId: 'owner-a', sessionId: 'session-a', tenantId: 'merchant-a', roles: ['merchant-admin'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'], correlationId: 'corr-a' }
    await marketplace.onboard(merchantContext, { merchantId: 'merchant-a', cohort: 'beauty-personal-care', locationId: 'location-a', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'stage-1-v1' })
    const listing = await marketplace.createListing(merchantContext, { merchantId: 'merchant-a', kind: 'product', name: '  Botanical balm  ', description: 'A local care product', cohort: 'beauty-personal-care', locationId: 'location-a', currency: 'ARS', price: 1200, stock: 3 })
    const published = await marketplace.publishListing(merchantContext, listing.listingId)
    const discovery = await marketplace.discover({ locationId: 'location-a', cohort: 'beauty-personal-care' })
    console.log(JSON.stringify({ published, discovery, audits: store.audit.list('merchant-a'), outbox: store.outbox.list('merchant-a'), contract: validarPublicacionMercadoServicios(published), version: TUS_CONTRACT_VERSION }))
  `)

  assert.equal(result.published.contractVersion, result.version)
  assert.equal(result.published.name, 'Botanical balm')
  assert.equal(result.published.published, true)
  assert.equal(result.discovery.items[0].availableQuantity, 3)
  assert.equal(result.discovery.items[0].price, 1200)
  assert.deepEqual(result.discovery.items[0].policyVersion, 'stage-1-v1')
  assert.deepEqual(result.audits.map(({ action, outcome }) => ({ action, outcome })), [
    { action: 'merchant.onboarded', outcome: 'allowed' },
    { action: 'listing.created', outcome: 'allowed' },
    { action: 'listing.published', outcome: 'allowed' },
  ])
  assert.deepEqual(result.outbox.map(({ eventType, aggregateId }) => ({ eventType, aggregateId })), [
    { eventType: 'tus.marketplace.merchant.onboarded', aggregateId: 'merchant-a' },
    { eventType: 'tus.marketplace.listing.created', aggregateId: result.published.listingId },
    { eventType: 'tus.marketplace.listing.published', aggregateId: result.published.listingId },
  ])
})

test('PR4 creates separate product/service commitments with current facts, replay, capacity, and stock correctness', async () => {
  const result = runTypeScriptScenario(`
    const { InMemoryMarketplaceStore, TusMarketplaceService, MarketplaceError } = (await import('./apps/api/src/tus/catalog/index.ts')).default
    const store = new InMemoryMarketplaceStore()
    const marketplace = new TusMarketplaceService(store)
    const merchantContext = { subjectId: 'owner-a', sessionId: 'session-a', tenantId: 'merchant-a', roles: ['merchant-admin'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'], correlationId: 'corr-a' }
    const customerContext = { subjectId: 'customer-a', sessionId: 'customer-session', tenantId: 'customer-a', roles: ['customer'], permissions: ['tus:marketplace:read', 'tus:checkout'], correlationId: 'corr-customer' }
    await marketplace.onboard(merchantContext, { merchantId: 'merchant-a', cohort: 'beauty-personal-care', locationId: 'location-a', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'stage-1-v1' })
    const product = await marketplace.createListing(merchantContext, { merchantId: 'merchant-a', kind: 'product', name: 'Limited soap', description: 'One unit per order', cohort: 'beauty-personal-care', locationId: 'location-a', currency: 'ARS', price: 1000, stock: 3 })
    const service = await marketplace.createListing(merchantContext, { merchantId: 'merchant-a', kind: 'service', name: 'Consultation', description: 'A focused appointment', cohort: 'beauty-personal-care', locationId: 'location-a', currency: 'ARS', price: 2000, durationMinutes: 60, capacity: 2, workingHours: [{ day: 1, start: '09:00', end: '18:00' }] })
    await marketplace.publishListing(merchantContext, product.listingId)
    await marketplace.publishListing(merchantContext, service.listingId)
    const facts = (await marketplace.discover()).items
    const productFacts = facts.find(({ listingId }) => listingId === product.listingId)
    const serviceFacts = facts.find(({ listingId }) => listingId === service.listingId)
    const input = { tenantId: 'customer-a', actorId: 'customer-a', correlationId: 'corr-customer', idempotencyKey: 'checkout-1', cartId: 'cart-1', requestHash: 'hash-1', createdAt: '2026-08-27T10:00:00.000Z', lines: [{ lineId: 'product-line', listingId: product.listingId, context: 'product', quantity: 1, availabilityVersion: productFacts.availabilityVersion, price: productFacts.price }, { lineId: 'service-line', listingId: service.listingId, context: 'service', quantity: 1, availabilityVersion: serviceFacts.availabilityVersion, price: serviceFacts.price, slotStart: '2026-08-31T10:00:00.000Z', slotEnd: '2026-08-31T11:00:00.000Z' }] }
    const first = await marketplace.checkout(input)
    const replay = await marketplace.checkout(input)
    const secondService = await marketplace.checkout({ ...input, idempotencyKey: 'checkout-2', cartId: 'cart-2', requestHash: 'hash-2', lines: [{ ...input.lines[1], lineId: 'service-line-2', slotStart: '2026-08-31T10:00:00.000Z', slotEnd: '2026-08-31T11:00:00.000Z' }] })
    let thirdServiceCode = ''
    try { await marketplace.checkout({ ...input, idempotencyKey: 'checkout-3', cartId: 'cart-3', requestHash: 'hash-3', lines: [{ ...input.lines[1], lineId: 'service-line-3', slotStart: '2026-08-31T10:00:00.000Z', slotEnd: '2026-08-31T11:00:00.000Z' }] }) } catch (error) { thirdServiceCode = error instanceof MarketplaceError ? error.code : 'unknown' }
    let stalePriceCode = ''
    try { await marketplace.checkout({ ...input, idempotencyKey: 'checkout-stale-price', cartId: 'cart-stale-price', requestHash: 'hash-stale-price', lines: [{ ...input.lines[0], lineId: 'stale-price', price: 1 }] }) } catch (error) { stalePriceCode = error instanceof MarketplaceError ? error.code : 'unknown' }
    const discoveryAfter = await marketplace.discover()
    const commitments = await marketplace.customerCommitments(customerContext)
    console.log(JSON.stringify({ first, replay, secondService, thirdServiceCode, stalePriceCode, productAvailable: discoveryAfter.items.find(({ listingId }) => listingId === product.listingId).availableQuantity, commitments, outbox: store.outbox.list('customer-a'), audits: store.audit.list('customer-a') }))
  `)

  assert.equal(result.first.status, 'executed')
  assert.deepEqual(result.first.commitments.map(({ context, policyVersion }) => ({ context, policyVersion })), [
    { context: 'product', policyVersion: 'stage-1-v1' },
    { context: 'service', policyVersion: 'stage-1-v1' },
  ])
  assert.notEqual(result.first.commitments[0].commitmentId, result.first.commitments[1].commitmentId)
  assert.equal(result.replay.status, 'replay')
  assert.deepEqual(result.replay.commitments, result.first.commitments)
  assert.equal(result.secondService.status, 'executed')
  assert.equal(result.thirdServiceCode, 'SLOT_UNAVAILABLE')
  assert.equal(result.stalePriceCode, 'STALE_FACTS')
  assert.equal(result.productAvailable, 2)
  assert.equal(result.commitments.commitments.length, 3)
  assert.ok(result.outbox.some(({ eventType }) => eventType === 'tus.marketplace.commitments.created'))
  assert.equal(result.audits.filter(({ action }) => action === 'commitment.created').length, 3)
})

test('PR4 keeps customer access authenticated and rejects spoofed or foreign tenant operations without writes', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('merchant-token', { sessionId: 'merchant-session', subjectId: 'merchant-admin', tenantId: 'merchant-a', roles: ['merchant-admin'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'] })
    sessions.add('customer-token', { sessionId: 'customer-session', subjectId: 'customer-a', tenantId: 'customer-a', roles: ['customer'], permissions: ['tus:marketplace:read', 'tus:checkout'] })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const address = server.address()
    const base = 'http://127.0.0.1:' + address.port
    const merchantHeaders = { authorization: 'Bearer merchant-token', 'content-type': 'application/json', 'x-correlation-id': 'corr-merchant' }
    const customerHeaders = { authorization: 'Bearer customer-token', 'content-type': 'application/json', 'x-correlation-id': 'corr-customer', 'idempotency-key': 'customer-checkout' }
    const onboarding = await fetch(base + '/tus/marketplace/onboarding', { method: 'POST', headers: merchantHeaders, body: JSON.stringify({ merchantId: 'merchant-a', cohort: 'beauty-personal-care', locationId: 'location-a', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'stage-1-v1' }) })
    const listing = await fetch(base + '/tus/marketplace/listings', { method: 'POST', headers: merchantHeaders, body: JSON.stringify({ merchantId: 'merchant-a', kind: 'product', name: 'Soap', description: 'Soap', cohort: 'beauty-personal-care', locationId: 'location-a', currency: 'ARS', price: 100, stock: 1 }) }).then((response) => response.json())
    await fetch(base + '/tus/marketplace/listings/' + listing.listingId + '/publish', { method: 'POST', headers: merchantHeaders, body: '{}' })
    const discovery = await fetch(base + '/tus/marketplace/discovery').then((response) => response.json())
    const facts = discovery.items.find(({ listingId }) => listingId === listing.listingId)
    const checkout = await fetch(base + '/tus/marketplace/checkout', { method: 'POST', headers: customerHeaders, body: JSON.stringify({ cartId: 'customer-cart', requestHash: 'customer-hash', lines: [{ lineId: 'customer-line', listingId: listing.listingId, context: 'product', quantity: 1, availabilityVersion: facts.availabilityVersion, price: facts.price }] }) })
    const commitments = await fetch(base + '/tus/marketplace/customer/commitments', { headers: { authorization: 'Bearer customer-token', 'x-correlation-id': 'corr-customer' } })
    const spoof = await fetch(base + '/tus/marketplace/customer/commitments', { headers: { authorization: 'Bearer customer-token', 'x-correlation-id': 'corr-customer', 'x-tenant-id': 'merchant-a' } })
    const unauthenticated = await fetch(base + '/tus/marketplace/customer/commitments')
    const customerRecords = await commitments.json()
    const spoofBody = await spoof.json()
    const unauthenticatedBody = await unauthenticated.json()
    const checkoutBody = await checkout.json()
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ onboarding: onboarding.status, checkout: checkout.status, checkoutBody, commitments: commitments.status, customerRecords, spoof: { status: spoof.status, body: spoofBody }, unauthenticated: { status: unauthenticated.status, body: unauthenticatedBody }, audits: application.marketplace.audit.list('customer-a') }))
  `)

  assert.equal(result.onboarding, 201)
  assert.equal(result.checkout, 201)
  assert.equal(result.checkoutBody.commitments[0].tenantId, 'customer-a')
  assert.equal(result.commitments, 200)
  assert.equal(result.customerRecords.commitments.length, 1)
  assert.equal(result.customerRecords.commitments[0].context, 'product')
  assert.equal(result.spoof.status, 403)
  assert.equal(result.spoof.body.code, 'FORBIDDEN')
  assert.equal(result.unauthenticated.status, 403)
  assert.equal(result.unauthenticated.body.code, 'FORBIDDEN')
  assert.equal(result.audits.at(-1).outcome, 'denied')
})

test('PR4 adds the additive marketplace migration and versioned contract schemas', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260827090300_tus_marketplace/migration.sql'), 'utf8')
  const listingSchema = readFileSync(join(root, 'packages/contracts/schemas/tus/marketplace-listing.v1.schema.json'), 'utf8')
  const checkoutSchema = readFileSync(join(root, 'packages/contracts/schemas/tus/marketplace-checkout.v1.schema.json'), 'utf8')
  const priceMigration = readFileSync(join(root, 'apps/api/prisma/migrations/20260911120000_tus_listing_price_minor/migration.sql'), 'utf8')

  assert.match(schema, /model TusListing[\s\S]*?contractVersion\s+String/)
  assert.match(schema, /model TusMarketplaceCommitment[\s\S]*?policyVersion\s+String/)
  assert.match(migration, /ALTER TABLE "TusListing"[\s\S]*?ADD COLUMN IF NOT EXISTS "contractVersion"/)
  assert.match(migration, /ALTER TABLE "TusMarketplaceCommitment"[\s\S]*?ADD COLUMN IF NOT EXISTS "policyVersion"/)
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "TusMarketplaceCommitment_tenantId_listingId_idx"/)
  assert.match(listingSchema, /"contractVersion"/)
  assert.match(listingSchema, /"availableQuantity"/)
  assert.match(checkoutSchema, /"idempotencyKey"/)
  assert.match(checkoutSchema, /"availabilityVersion"/)
  assert.match(priceMigration, /ALTER COLUMN "price" TYPE BIGINT/)
  assert.match(priceMigration, /ROUND\("price" \* 100\)::BIGINT/)
})

test('PR1 exposes tenant-scoped marketplace audit and outbox readback from the Prisma adapter', () => {
  const result = runTypeScriptScenario(`
    const { PrismaMarketplaceStore } = (await import('./apps/api/src/tus/adapters/prisma-marketplace.ts')).default
    const writes = []
    const audits = [
      { id: 'audit-tenant-a', tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a', action: 'listing.published', resourceType: 'listing', resourceId: 'listing-a', outcome: 'allowed', createdAt: new Date('2026-08-27T12:00:00.000Z') },
      { id: 'audit-tenant-b', tenantId: 'tenant-b', actorId: 'actor-b', correlationId: 'corr-b', action: 'listing.published', resourceType: 'listing', resourceId: 'listing-b', outcome: 'allowed', createdAt: new Date('2026-08-27T12:00:00.000Z') },
    ]
    const outbox = [
      { id: 'event-tenant-a', tenantId: 'tenant-a', aggregateType: 'listing', aggregateId: 'listing-a', eventType: 'tus.marketplace.listing.published', payload: { auditIds: ['audit-tenant-a'], correlationId: 'corr-a' }, status: 'pending', attempts: 0, createdAt: new Date('2026-08-27T12:00:00.000Z') },
      { id: 'event-tenant-b', tenantId: 'tenant-b', aggregateType: 'listing', aggregateId: 'listing-b', eventType: 'tus.marketplace.listing.published', payload: { auditIds: ['audit-tenant-b'], correlationId: 'corr-b' }, status: 'pending', attempts: 0, createdAt: new Date('2026-08-27T12:00:00.000Z') },
    ]
    const client = {
      tusMarketplaceAudit: {
        findMany: async ({ where }) => audits.filter((row) => row.tenantId === where.tenantId),
        createMany: async ({ data }) => (writes.push(...data), { count: data.length }),
      },
      outboxEvent: { findMany: async ({ where }) => outbox.filter((row) => row.tenantId === where.tenantId) },
    }
    const store = new PrismaMarketplaceStore(client)
    await store.audit.append([{ auditId: 'audit-write', tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-write', action: 'merchant.onboarded', resourceType: 'merchant', resourceId: 'merchant-a', outcome: 'allowed', createdAt: '2026-08-27T12:00:00.000Z' }])
    const tenantAudits = await store.audit.list('tenant-a')
    const tenantOutbox = await store.outbox.list('tenant-a')
    console.log(JSON.stringify({ tenantAudits, tenantOutbox, writes }))
  `)

  assert.deepEqual(result.tenantAudits.map(({ tenantId, correlationId, resourceId }) => ({ tenantId, correlationId, resourceId })), [{ tenantId: 'tenant-a', correlationId: 'corr-a', resourceId: 'listing-a' }])
  assert.deepEqual(result.tenantOutbox.map(({ tenantId, correlationId, aggregateId, eventType }) => ({ tenantId, correlationId, aggregateId, eventType })), [{ tenantId: 'tenant-a', correlationId: 'corr-a', aggregateId: 'listing-a', eventType: 'tus.marketplace.listing.published' }])
  assert.equal(result.writes[0].id, 'audit-write')
  assert.equal('auditId' in result.writes[0], false)
  assert.equal(result.writes[0].createdAt, '2026-08-27T12:00:00.000Z')
})

test('PR1 looks up marketplace commitments through the Prisma primary key', () => {
  const result = runTypeScriptScenario(`
    const { PrismaMarketplaceStore } = (await import('./apps/api/src/tus/adapters/prisma-marketplace.ts')).default
    const calls = []
    const client = {
      tusMarketplaceCommitment: {
        findUnique: async (args) => (calls.push(args), null),
      },
    }
    const store = new PrismaMarketplaceStore(client)
    const commitment = await store.commitments.find('commitment-a')
    console.log(JSON.stringify({ calls, commitment }))
  `)

  assert.deepEqual(result.calls, [{ where: { id: 'commitment-a' } }])
  assert.equal(result.commitment, null)
})

test('PR4 exposes JSON-safe public marketplace listing facts over HTTP', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('merchant-token', { sessionId: 'merchant-session', subjectId: 'merchant-admin', tenantId: 'merchant-a', roles: ['merchant-admin'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'] })
    const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const headers = { authorization: 'Bearer merchant-token', 'content-type': 'application/json', 'x-correlation-id': 'corr-public-listing' }
    await fetch(base + '/tus/v1/marketplace/onboarding', { method: 'POST', headers, body: JSON.stringify({ merchantId: 'merchant-a', cohort: 'beauty-personal-care', locationId: 'location-a', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'stage-1-v1' }) })
    const createdResponse = await fetch(base + '/tus/v1/marketplace/listings', { method: 'POST', headers, body: JSON.stringify({ merchantId: 'merchant-a', kind: 'product', name: 'Soap', description: 'Soap', cohort: 'beauty-personal-care', locationId: 'location-a', currency: 'ARS', price: 100, stock: 1 }) })
    const created = await createdResponse.json()
    const publishedResponse = await fetch(base + '/tus/v1/marketplace/listings/' + created.listingId + '/publish', { method: 'POST', headers, body: '{}' })
    const published = await publishedResponse.json()
    const discoveryResponse = await fetch(base + '/tus/v1/marketplace/discovery')
    const discovery = await discoveryResponse.json()
    const operationsResponse = await fetch(base + '/tus/v1/marketplace/merchant/operations', { headers })
    const operations = await operationsResponse.json()
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    console.log(JSON.stringify({ statuses: [createdResponse.status, publishedResponse.status, discoveryResponse.status, operationsResponse.status], created, published, discovery, operations }))
  `)

  assert.deepEqual(result.statuses, [201, 200, 200, 200])
  assert.equal(result.created.price, 100)
  assert.equal('priceMinor' in result.created, false)
  assert.equal('priceSnapshot' in result.created, false)
  assert.equal(result.published.published, true)
  assert.equal(result.discovery.items[0].listingId, result.created.listingId)
  assert.equal('priceMinor' in result.discovery.items[0], false)
  assert.equal(result.operations.listings[0].listingId, result.created.listingId)
  assert.equal('priceMinor' in result.operations.listings[0], false)
})

test('PR1 completes one server-derived actor, tenant, and session flow for marketplace and POS contracts', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const contracts = await import('./packages/contracts/src/tus.ts')
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('closure-merchant-token', { sessionId: 'closure-merchant-session', subjectId: 'closure-merchant-actor', tenantId: 'closure-merchant-tenant', roles: ['merchant-admin'], permissions: ['tus:marketplace:write', 'tus:marketplace:read', 'tus:pos:write'] })
    sessions.add('closure-customer-token', { sessionId: 'closure-customer-session', subjectId: 'closure-customer-actor', tenantId: 'closure-customer-tenant', roles: ['customer'], permissions: ['tus:marketplace:read', 'tus:checkout'] })
    const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const request = async (token, method, path, body, extra = {}) => {
      const response = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-correlation-id': extra.correlationId || 'closure-correlation', ...(extra.idempotencyKey ? { 'idempotency-key': extra.idempotencyKey } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      return { status: response.status, body: await response.json() }
    }
    const merchant = 'closure-merchant-token'
    const onboarding = await request(merchant, 'POST', '/tus/v1/marketplace/onboarding', { merchantId: 'closure-merchant-tenant', cohort: 'repairs-trades', locationId: 'closure-location', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'stage-1-v1' })
    const product = await request(merchant, 'POST', '/tus/v1/marketplace/listings', { merchantId: 'closure-merchant-tenant', kind: 'product', name: 'Closure tool', description: 'A durable product', cohort: 'repairs-trades', locationId: 'closure-location', currency: 'ARS', price: 1400, stock: 2 })
    const service = await request(merchant, 'POST', '/tus/v1/marketplace/listings', { merchantId: 'closure-merchant-tenant', kind: 'service', name: 'Closure repair', description: 'A durable service', cohort: 'repairs-trades', locationId: 'closure-location', currency: 'ARS', price: 2600, durationMinutes: 60, capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '18:00' }] })
    await request(merchant, 'POST', '/tus/v1/marketplace/listings/' + product.body.listingId + '/publish', {})
    await request(merchant, 'POST', '/tus/v1/marketplace/listings/' + service.body.listingId + '/publish', {})
    const discovery = await request('', 'GET', '/tus/v1/marketplace/discovery')
    const productFacts = discovery.body.items.find(({ listingId }) => listingId === product.body.listingId)
    const serviceFacts = discovery.body.items.find(({ listingId }) => listingId === service.body.listingId)
    const checkoutBody = { contractVersion: '1.0.0', cartId: 'closure-cart', requestHash: 'closure-hash', idempotencyKey: 'closure-checkout', lines: [{ lineId: 'closure-product-line', listingId: product.body.listingId, context: 'product', quantity: 1, availabilityVersion: productFacts.availabilityVersion, price: productFacts.price }, { lineId: 'closure-service-line', listingId: service.body.listingId, context: 'service', quantity: 1, availabilityVersion: serviceFacts.availabilityVersion, price: serviceFacts.price, slotStart: '2026-09-01T10:00:00.000Z', slotEnd: '2026-09-01T11:00:00.000Z' }] }
    const checkout = await request('closure-customer-token', 'POST', '/tus/v1/marketplace/checkout', checkoutBody, { idempotencyKey: 'closure-checkout', correlationId: 'closure-customer-correlation' })
    const replay = await request('closure-customer-token', 'POST', '/tus/v1/marketplace/checkout', checkoutBody, { idempotencyKey: 'closure-checkout', correlationId: 'closure-customer-correlation' })
    const device = await request(merchant, 'POST', '/tus/v1/pos/devices', { deviceId: 'closure-device', label: 'Closure counter', fingerprint: 'closure-fingerprint' })
    const session = await request(merchant, 'POST', '/tus/v1/pos/sessions', { sessionId: 'closure-pos-session', deviceId: device.body.deviceId, shiftId: 'closure-shift' })
    const posProduct = await request(merchant, 'POST', '/tus/v1/pos/manual-operations', { operationId: 'closure-pos-product', idempotencyKey: 'closure-pos-product-key', schemaVersion: '1.0.0', deviceId: device.body.deviceId, shiftId: session.body.shiftId, createdAt: '2026-08-29T12:00:00.000Z', expectedVersion: 0, kind: 'manual-sale', context: 'product', amount: 1400, currency: 'ARS' })
    const posService = await request(merchant, 'POST', '/tus/v1/pos/manual-operations', { operationId: 'closure-pos-service', idempotencyKey: 'closure-pos-service-key', schemaVersion: '1.0.0', deviceId: device.body.deviceId, shiftId: session.body.shiftId, createdAt: '2026-08-29T12:01:00.000Z', expectedVersion: 1, kind: 'manual-service', context: 'service', amount: 2600, currency: 'ARS' })
    contracts.validarPublicacionMercadoServicios(product.body)
    contracts.validarPublicacionMercadoServicios(service.body)
    contracts.validarSolicitudConfirmacionCompraMercadoServicios(checkoutBody)
    if (discovery.body.contractVersion !== contracts.TUS_CONTRACT_VERSION || discovery.body.evidence !== 'local-deterministic' || checkout.body.contractVersion !== contracts.TUS_CONTRACT_VERSION || checkout.body.commitments.length !== 2) throw new Error('unsafe marketplace response contract')
    contracts.validarDispositivoPOS(device.body)
    contracts.validarSesionPOS(session.body)
    contracts.validarOperacionPOS(posProduct.body.operation)
    contracts.validarComprobantePOS(posProduct.body.receipt)
    contracts.validarOperacionPOS(posService.body.operation)
    contracts.validarComprobantePOS(posService.body.receipt)
    const marketplaceAudits = application.marketplace.audit.list('closure-customer-tenant')
    const marketplaceOutbox = application.marketplace.store.outbox.list('closure-customer-tenant')
    const posAudits = application.pos.audit.list('closure-merchant-tenant')
    const posOutbox = application.pos.store.listOutbox('closure-merchant-tenant')
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    console.log(JSON.stringify({ onboarding, discovery, checkout, replay, device, session, posProduct, posService, marketplaceAudits, marketplaceOutbox, posAudits, posOutbox }))
  `)

  assert.equal(result.onboarding.status, 201)
  assert.equal(result.discovery.body.evidence, 'local-deterministic')
  assert.deepEqual(result.checkout.body.commitments.map(({ context, tenantId, merchantId }) => ({ context, tenantId, merchantId })), [
    { context: 'product', tenantId: 'closure-customer-tenant', merchantId: 'closure-merchant-tenant' },
    { context: 'service', tenantId: 'closure-customer-tenant', merchantId: 'closure-merchant-tenant' },
  ])
  assert.equal(result.replay.status, 200)
  assert.deepEqual(result.replay.body.commitments, result.checkout.body.commitments)
  assert.equal(result.device.body.tenantId, 'closure-merchant-tenant')
  assert.equal(result.session.body.actorId, 'closure-merchant-actor')
  assert.equal(result.posProduct.body.operation.actorId, 'closure-merchant-actor')
  assert.equal(result.posService.body.operation.context, 'service')
  assert.equal(result.posProduct.body.receipt.settlement, 'not-claimed')
  assert.equal(result.marketplaceAudits.filter(({ action }) => action === 'commitment.created').length, 2)
  assert.equal(result.marketplaceOutbox.length, 1)
  assert.equal(result.posAudits.filter(({ action }) => action === 'pos.operation.accepted').length, 2)
  assert.equal(result.posOutbox.filter(({ eventType }) => eventType === 'pos.operation.accepted').length, 2)
})
