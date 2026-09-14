import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'
import {
  TUS_CONTRACT_VERSION,
  validarSolicitudConfirmacionCompraMercadoServicios,
} from '../../packages/contracts/src/index.ts'

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

function headers(token, permission = 'tus:read', idempotencyKey) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-correlation-id': `corr-${token}`,
    ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
    'x-permission-used': permission,
  }
}

async function post(base, path, token, body, idempotencyKey) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: headers(token, 'tus:marketplace:write', idempotencyKey),
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

test('marketplace checkout contract accepts the canonical version and rejects mismatches', () => {
  const request = {
    contractVersion: TUS_CONTRACT_VERSION,
    cartId: 'cart-contract',
    requestHash: 'hash-contract',
    idempotencyKey: 'key-contract',
    lines: [{
      lineId: 'line-contract',
      listingId: 'listing-contract',
      context: 'product',
      quantity: 1,
      availabilityVersion: 1,
    }],
  }

  assert.deepEqual(validarSolicitudConfirmacionCompraMercadoServicios(request), request)
  assert.throws(
    () => validarSolicitudConfirmacionCompraMercadoServicios({ ...request, contractVersion: '9.0.0' }),
    /unsupported contract version/i,
  )
})

test('canonical and legacy marketplace paths share the error envelope while unknown versions fail closed', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const address = server.address()
    const base = 'http://127.0.0.1:' + address.port
    const read = async (path) => { const response = await fetch(base + path); return { status: response.status, body: await response.json() } }
    const canonical = await read('/tus/v1/marketplace/discovery')
    const legacy = await read('/tus/marketplace/discovery')
    const unknown = await read('/tus/v2/marketplace/discovery')
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ canonical, legacy, unknown }))
  `)

  assert.equal(result.canonical.status, 200)
  assert.deepEqual(result.legacy, result.canonical)
  assert.equal(result.unknown.status, 404)
  assert.deepEqual(result.unknown.body, {
    code: 'UNSUPPORTED_API_VERSION',
    error: 'Unsupported TUS API version',
  })
})

test('marketplace checkout keeps version, tenant, and idempotency semantics identical across canonical and legacy paths', () => {
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
    const customerHeaders = (key) => ({ authorization: 'Bearer customer-token', 'content-type': 'application/json', 'x-correlation-id': 'corr-customer', 'idempotency-key': key })
    const send = async (path, body, tokenHeaders) => { const response = await fetch(base + path, { method: 'POST', headers: tokenHeaders, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() } }
    await send('/tus/v1/marketplace/onboarding', { merchantId: 'merchant-a', cohort: 'beauty-personal-care', locationId: 'location-a', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'stage-1-v1' }, merchantHeaders)
    const listing = await send('/tus/v1/marketplace/listings', { merchantId: 'merchant-a', kind: 'product', name: 'Canonical soap', description: 'One unit only', cohort: 'beauty-personal-care', locationId: 'location-a', currency: 'ARS', price: 1000, stock: 2 }, merchantHeaders)
    await send('/tus/v1/marketplace/listings/' + listing.body.listingId + '/publish', {}, merchantHeaders)
    const checkout = { contractVersion: '1.0.0', cartId: 'cart-compat', requestHash: 'hash-compat', idempotencyKey: 'key-compat', lines: [{ lineId: 'line-compat', listingId: listing.body.listingId, context: 'product', quantity: 1, availabilityVersion: 1 }] }
    const first = await send('/tus/v1/marketplace/checkout', checkout, customerHeaders('key-compat'))
    const replay = await send('/tus/marketplace/checkout', checkout, customerHeaders('key-compat'))
    const conflict = await send('/tus/v1/marketplace/checkout', { ...checkout, requestHash: 'hash-conflict' }, customerHeaders('key-compat'))
    const mismatchedKey = await send('/tus/v1/marketplace/checkout', { ...checkout, idempotencyKey: 'body-key' }, customerHeaders('header-key'))
    const mismatchedVersion = await send('/tus/v1/marketplace/checkout', { ...checkout, contractVersion: '9.0.0', idempotencyKey: 'version-key' }, customerHeaders('version-key'))
    const commitments = await fetch(base + '/tus/v1/marketplace/customer/commitments', { headers: { authorization: 'Bearer customer-token', 'x-correlation-id': 'corr-customer' } })
    const commitmentBody = await commitments.json()
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ first, replay, conflict, mismatchedKey, mismatchedVersion, commitmentCount: commitmentBody.commitments.length }))
  `)

  assert.equal(result.first.status, 201)
  assert.equal(result.first.body.contractVersion, TUS_CONTRACT_VERSION)
  assert.equal(result.replay.status, 200)
  assert.equal(result.replay.body.status, 'replay')
  assert.deepEqual(result.replay.body.commitments, result.first.body.commitments)
  assert.equal(result.conflict.status, 409)
  assert.deepEqual(result.conflict.body, {
    code: 'CONFLICT',
    error: 'idempotency key was already used for another request',
  })
  assert.equal(result.mismatchedKey.status, 400)
  assert.equal(result.mismatchedKey.body.code, 'IDEMPOTENCY_KEY_MISMATCH')
  assert.equal(result.mismatchedVersion.status, 400)
  assert.equal(result.mismatchedVersion.body.code, 'UNSUPPORTED_CONTRACT_VERSION')
  assert.equal(result.commitmentCount, 1)
})

test('WU3 onboards only complete in-scope merchants and publishes tenant-scoped catalog listings', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('merchant-token', { sessionId: 'merchant-session', subjectId: 'merchant-admin', tenantId: 'merchant-a', roles: ['merchant-admin'], permissions: ['tus:marketplace:write', 'tus:marketplace:read', 'tus:checkout'] })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const address = server.address()
    const base = 'http://127.0.0.1:' + address.port
    const send = async (path, body, key) => { const response = await fetch(base + path, { method: 'POST', headers: { authorization: 'Bearer merchant-token', 'content-type': 'application/json', 'x-correlation-id': 'corr-merchant', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() } }
     const incomplete = await send('/tus/v1/marketplace/onboarding', { merchantId: 'merchant-a', cohort: 'beauty-personal-care' })
     const onboarded = await send('/tus/v1/marketplace/onboarding', { merchantId: 'merchant-a', cohort: 'beauty-personal-care', locationId: 'location-a', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'stage-1-v1' })
     const excluded = await send('/tus/v1/marketplace/onboarding', { merchantId: 'merchant-a', cohort: 'regulated-healthcare', locationId: 'location-a', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'stage-1-v1' })
     const listing = await send('/tus/v1/marketplace/listings', { merchantId: 'merchant-a', kind: 'product', name: 'Botanical balm', description: 'A local care product', cohort: 'beauty-personal-care', locationId: 'location-a', currency: 'ARS', price: 1200, stock: 3 })
     const published = await send('/tus/v1/marketplace/listings/' + listing.body.listingId + '/publish', {})
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ incomplete, onboarded, excluded, listing, published }))
  `)



  assert.equal(result.incomplete.status, 400)
  assert.equal(result.onboarded.status, 201)
  assert.equal(result.onboarded.body.status, 'approved')
  assert.equal(result.excluded.status, 400)
  assert.equal(result.excluded.body.code, 'COHORT_NOT_SUPPORTED')
  assert.equal(result.listing.status, 201)
  assert.equal(result.published.status, 200)
  assert.equal(result.published.body.published, true)
  assert.equal(result.published.body.tenantId, 'merchant-a')
})

test('WU3 discovery exposes current product and service facts while stale checkout, stock, and overlapping slots fail closed', () => {
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
    const customerHeaders = (key) => ({ authorization: 'Bearer customer-token', 'content-type': 'application/json', 'x-correlation-id': 'corr-customer', 'idempotency-key': key })
    const send = async (path, body, key) => { const response = await fetch(base + path, { method: 'POST', headers: key ? customerHeaders(key) : merchantHeaders, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() } }
     await fetch(base + '/tus/v1/marketplace/onboarding', { method: 'POST', headers: merchantHeaders, body: JSON.stringify({ merchantId: 'merchant-a', cohort: 'beauty-personal-care', locationId: 'location-a', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'stage-1-v1' }) })
     const product = await send('/tus/v1/marketplace/listings', { merchantId: 'merchant-a', kind: 'product', name: 'Limited soap', description: 'One unit only', cohort: 'beauty-personal-care', locationId: 'location-a', currency: 'ARS', price: 1000, stock: 1 })
     const service = await send('/tus/v1/marketplace/listings', { merchantId: 'merchant-a', kind: 'service', name: 'Consultation', description: 'A focused appointment', cohort: 'beauty-personal-care', locationId: 'location-a', currency: 'ARS', price: 2000, durationMinutes: 60, capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '18:00' }] })
     await send('/tus/v1/marketplace/listings/' + product.body.listingId + '/publish', {})
     await send('/tus/v1/marketplace/listings/' + service.body.listingId + '/publish', {})
     const discoveryResponse = await fetch(base + '/tus/v1/marketplace/discovery')
    const discovery = await discoveryResponse.json()
    const productFacts = discovery.items.find(({ listingId }) => listingId === product.body.listingId)
    const serviceFacts = discovery.items.find(({ listingId }) => listingId === service.body.listingId)
     const stale = await send('/tus/v1/marketplace/checkout', { cartId: 'cart-stale', requestHash: 'hash-stale', lines: [{ lineId: 'product-stale', listingId: product.body.listingId, context: 'product', quantity: 1, availabilityVersion: productFacts.availabilityVersion - 1 }] }, 'stale-key')
     const first = await send('/tus/v1/marketplace/checkout', { cartId: 'cart-first', requestHash: 'hash-first', lines: [{ lineId: 'product-first', listingId: product.body.listingId, context: 'product', quantity: 1, availabilityVersion: productFacts.availabilityVersion }] }, 'first-key')
     const outOfStock = await send('/tus/v1/marketplace/checkout', { cartId: 'cart-stock', requestHash: 'hash-stock', lines: [{ lineId: 'product-stock', listingId: product.body.listingId, context: 'product', quantity: 1, availabilityVersion: first.body.commitments[0].availabilityVersion + 1 }] }, 'stock-key')
    const serviceInput = { cartId: 'cart-service', requestHash: 'hash-service', lines: [{ lineId: 'service-first', listingId: service.body.listingId, context: 'service', quantity: 1, availabilityVersion: serviceFacts.availabilityVersion, slotStart: '2026-08-31T10:00:00.000Z', slotEnd: '2026-08-31T11:00:00.000Z' }] }
     const booked = await send('/tus/v1/marketplace/checkout', serviceInput, 'service-key')
     const bookedReplay = await send('/tus/v1/marketplace/checkout', serviceInput, 'service-key')
     const overlap = await send('/tus/v1/marketplace/checkout', { ...serviceInput, cartId: 'cart-overlap', requestHash: 'hash-overlap', lines: [{ ...serviceInput.lines[0], lineId: 'service-overlap' }] }, 'overlap-key')
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ discoveryStatus: discoveryResponse.status, productFacts, serviceFacts, stale: { status: stale.status, body: stale.body }, first: { status: first.status, body: first.body }, outOfStock: { status: outOfStock.status, body: outOfStock.body }, booked: { status: booked.status, body: booked.body }, bookedReplay: { status: bookedReplay.status, body: bookedReplay.body }, overlap: { status: overlap.status, body: overlap.body } }))
  `)

  assert.equal(result.discoveryStatus, 200)
  assert.equal(result.productFacts.kind, 'product')
  assert.equal(result.productFacts.availableQuantity, 1)
  assert.equal(result.serviceFacts.kind, 'service')
  assert.equal(result.stale.status, 409)
  assert.equal(result.stale.body.code, 'STALE_FACTS')
  assert.equal(result.first.status, 201)
  assert.equal(result.first.body.commitments[0].context, 'product')
  assert.equal(result.outOfStock.status, 409)
  assert.equal(result.outOfStock.body.code, 'UNAVAILABLE')
  assert.equal(result.booked.status, 201)
  assert.equal(result.booked.body.commitments[0].context, 'service')
  assert.equal(result.bookedReplay.status, 200)
  assert.equal(result.bookedReplay.body.status, 'replay')
  assert.equal(result.overlap.status, 409)
  assert.equal(result.overlap.body.code, 'SLOT_UNAVAILABLE')
})

test('WU3 keeps product and service commitments separately addressable and denies cross-tenant merchant mutations', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('merchant-a-token', { sessionId: 'merchant-a-session', subjectId: 'merchant-a-admin', tenantId: 'merchant-a', roles: ['merchant-admin'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'] })
    sessions.add('merchant-b-token', { sessionId: 'merchant-b-session', subjectId: 'merchant-b-admin', tenantId: 'merchant-b', roles: ['merchant-admin'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'] })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const address = server.address()
    const base = 'http://127.0.0.1:' + address.port
     const response = await fetch(base + '/tus/v1/marketplace/onboarding', { method: 'POST', headers: { authorization: 'Bearer merchant-a-token', 'content-type': 'application/json', 'x-correlation-id': 'corr-a', 'x-tenant-id': 'merchant-b' }, body: JSON.stringify({ merchantId: 'merchant-b', cohort: 'beauty-personal-care', locationId: 'location-b', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'stage-1-v1' }) })
    const body = await response.json()
    const audit = application.marketplace.audit.list('merchant-a')
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ status: response.status, body, audit }))
  `)

  assert.equal(result.status, 403)
  assert.equal(result.body.code, 'FORBIDDEN')
  assert.equal(result.audit.length, 1)
  assert.equal(result.audit[0].outcome, 'denied')
})

test('WU3 persists marketplace tenant boundaries and availability facts in the relational source-of-truth schema', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260826110000_tus_marketplace/migration.sql'), 'utf8')

  assert.match(schema, /model TusMerchant[\s\S]*?tenantId\s+String/)
  assert.match(schema, /model TusListing[\s\S]*?tenantId\s+String/)
  assert.match(schema, /model TusListing[\s\S]*?availabilityVersion\s+Int/)
  assert.match(schema, /model TusMarketplaceCommitment[\s\S]*?tenantId\s+String/)
  assert.match(schema, /model TusMarketplaceCommitment[\s\S]*?context\s+String/)
  assert.match(migration, /CREATE TABLE "TusMerchant"/)
  assert.match(migration, /CREATE TABLE "TusListing"/)
  assert.match(migration, /CREATE INDEX "TusListing_tenantId_published_idx"/)
  assert.match(migration, /CREATE TABLE "TusMarketplaceCommitment"/)
})

test('WU3 web client exposes marketplace discovery and separate checkout operations', () => {
  const result = runTypeScriptScenario(`
     const { createTusWebClient, parseTusCheckoutResponse } = (await import('./apps/web/src/lib/tus-client.ts')).default
     const calls = []
     const client = createTusWebClient({ request: async (input) => { calls.push(input); return input.path.includes('discovery') ? { items: [] } : { contractVersion: '1.0.0', status: 'executed', commitments: [] } } })
     await client.discoverMarketplace({ tenantId: 'customer-a', actorId: 'customer-a', correlationId: 'corr-web' })
     await client.checkoutMarketplace({ tenantId: 'customer-a', actorId: 'customer-a', correlationId: 'corr-web', idempotencyKey: 'web-key', cartId: 'cart-web', requestHash: 'hash-web', lines: [] })
     const mismatchedVersion = parseTusCheckoutResponse({ contractVersion: '9.0.0', status: 'executed', commitments: [] }, 'version-intent')
     console.log(JSON.stringify({ calls, mismatchedVersion }))
  `)

  assert.equal(result.calls[0].path, '/tus/v1/marketplace/discovery')
  assert.equal(result.calls[1].path, '/tus/v1/marketplace/checkout')
  assert.equal(result.calls[1].method, 'POST')
  assert.equal(result.calls[1].body.contractVersion, TUS_CONTRACT_VERSION)
  assert.equal(result.calls[1].body.idempotencyKey, 'web-key')
  assert.deepEqual(result.mismatchedVersion, {
    status: 'error',
    intentId: 'version-intent',
    reason: 'invalid_server_response',
  })
})
