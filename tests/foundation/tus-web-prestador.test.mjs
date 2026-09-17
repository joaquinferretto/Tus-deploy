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

test('WEB-07 uses the existing provider onboarding, listing, publish, and operations routes', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebClient } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const calls = []
    const context = { tenantId: 'tenant-provider', actorId: 'actor-provider', correlationId: 'corr-provider', accessToken: 'token' }
    const client = createTusWebClient({ request: async (input) => {
      calls.push(input)
      if (input.method === 'GET') return { merchant: null, listings: [] }
      if (input.path.endsWith('/publish')) return { listingId: 'listing/a', tenantId: context.tenantId, merchantId: 'merchant-a', kind: 'service', name: 'Repair', description: 'Repair service', cohort: 'repairs-trades', locationId: 'location-a', currency: 'ARS', price: 1200, availabilityVersion: 1, published: true, policyVersion: 'policy-v1', stock: null, durationMinutes: 60, capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '18:00' }], createdAt: '2026-09-17T12:00:00.000Z', updatedAt: '2026-09-17T12:00:00.000Z' }
      if (input.path.endsWith('/onboarding')) return { tenantId: context.tenantId, merchantId: 'merchant-a', cohort: 'repairs-trades', locationId: 'location-a', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-v1', status: 'approved', createdAt: '2026-09-17T12:00:00.000Z', updatedAt: '2026-09-17T12:00:00.000Z' }
      return { listingId: 'listing/a', tenantId: context.tenantId, merchantId: 'merchant-a', kind: 'service', name: 'Repair', description: 'Repair service', cohort: 'repairs-trades', locationId: 'location-a', currency: 'ARS', price: 1200, availabilityVersion: 1, published: false, policyVersion: 'policy-v1', stock: null, durationMinutes: 60, capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '18:00' }], createdAt: '2026-09-17T12:00:00.000Z', updatedAt: '2026-09-17T12:00:00.000Z' }
    } })
    const operations = await client.merchantMarketplaceOperations(context)
    const merchant = await client.onboardMerchant({ ...context, merchantId: 'merchant-a', cohort: 'repairs-trades', locationId: 'location-a', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-v1' })
    const listing = await client.createMerchantListing({ ...context, merchantId: merchant.merchantId, kind: 'service', name: 'Repair', description: 'Repair service', cohort: merchant.cohort, locationId: merchant.locationId, currency: 'ARS', price: 1200, capacity: 1, durationMinutes: 60, workingHours: [{ day: 1, start: '09:00', end: '18:00' }], bookingMode: 'fixed_shift', priceMode: 'fixed' })
    const published = await client.publishMerchantListing(context, listing.listingId)
    console.log(JSON.stringify({ calls, operations, merchant, listing, published }))
  `)

  assert.deepEqual(result.calls.map(({ method, path, body }) => ({ method, path, body })), [
    { method: 'GET', path: '/tus/v1/mercado-servicios/merchant/operations', body: undefined },
    { method: 'POST', path: '/tus/v1/marketplace/onboarding', body: { merchantId: 'merchant-a', cohort: 'repairs-trades', locationId: 'location-a', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-v1' } },
    { method: 'POST', path: '/tus/v1/marketplace/listings', body: { merchantId: 'merchant-a', kind: 'service', name: 'Repair', description: 'Repair service', cohort: 'repairs-trades', locationId: 'location-a', currency: 'ARS', price: 1200, capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '18:00' }], bookingMode: 'fixed_shift', priceMode: 'fixed', durationMinutes: 60 } },
    { method: 'POST', path: '/tus/v1/marketplace/listings/listing%2Fa/publish', body: undefined },
  ])
  assert.equal(result.operations.merchant, null)
  assert.equal(result.merchant.status, 'approved')
  assert.equal(result.listing.published, false)
  assert.equal(result.published.published, true)
})

test('WEB-07 keeps provider permissions and calendar readiness honest', () => {
  const surface = readFileSync(join(root, 'apps/web/src/app/tus/tus-prestador.tsx'), 'utf8')
  const shell = readFileSync(join(root, 'apps/web/src/components/layout/tus-app-shell.tsx'), 'utf8')
  const css = readFileSync(join(root, 'apps/web/src/app/globals.css'), 'utf8')

  assert.match(surface, /tus:marketplace:read/)
  assert.match(surface, /tus:marketplace:write/)
  assert.match(surface, /not configured/)
  assert.match(surface, /does not infer calendar readiness/i)
  assert.match(shell, /href="\/tus\/prestador"/)
  assert.match(css, /\.tus-prestador-facts[\s\S]*?grid-template-columns/)
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.tus-prestador-facts,[\s\S]*?grid-template-columns:\s*1fr/)
})
