import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
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

test('PR5 creates deep-linkable journey navigation and denies unscoped staff surfaces', () => {
  const result = runTypeScriptScenario(`
    const journeyModule = await import('./apps/web/src/lib/tus-journeys.ts')
    const { buildTusJourneyLinks, createTusSurfaceHref, resolveTusRoleLabel } = journeyModule.default ?? journeyModule.default?.default ?? journeyModule
    console.log(JSON.stringify({
      links: buildTusJourneyLinks({ roles: ['customer'], permissions: ['tus:read'] }),
      filtered: createTusSurfaceHref('discovery', { filter: 'services', returnTo: '/tus/operations' }),
      external: createTusSurfaceHref('operations', { returnTo: 'https://evil.example' }),
      role: resolveTusRoleLabel(['merchant']),
      ownerRole: resolveTusRoleLabel(['owner']),
    }))
  `)

  assert.equal(result.filtered, '/tus?surface=discovery&filter=services&returnTo=%2Ftus%2Foperations')
  assert.equal(result.external, '/tus?surface=operations')
  assert.equal(result.role, 'Merchant · catalog')
  assert.equal(result.ownerRole, 'Merchant · catalog')
  assert.equal(result.links.find((link) => link.key === 'discovery').href, '/tus?surface=discovery')
  assert.equal(result.links.find((link) => link.key === 'operations').allowed, false)
  assert.match(result.links.find((link) => link.key === 'operations').description, /authorized scope/i)
})

test('PR5 keeps product and service facts separate and makes stale reporting recoverable', () => {
  const result = runTypeScriptScenario(`
    const journeyModule = await import('./apps/web/src/lib/tus-journeys.ts')
    const { resolveTusCatalogFacts, resolveTusFreshness } = journeyModule.default ?? journeyModule.default?.default ?? journeyModule
    console.log(JSON.stringify({
      product: resolveTusCatalogFacts({ kind: 'product', availableQuantity: 4, currency: 'ARS', price: 1250 }),
      service: resolveTusCatalogFacts({ kind: 'service', capacity: 2, durationMinutes: 45, currency: 'ARS', price: 9000 }),
      stale: resolveTusFreshness(true),
      current: resolveTusFreshness(false),
    }))
  `)

  assert.equal(result.product.context, 'Product')
  assert.match(result.product.availability, /4 units available/i)
  assert.match(result.product.policy, /stock/i)
  assert.equal(result.service.context, 'Service')
  assert.match(result.service.availability, /45 min · capacity 2/i)
  assert.match(result.service.policy, /slot capacity/i)
  assert.equal(result.stale.status, 'pending')
  assert.equal(result.stale.action, 'refresh')
  assert.match(result.stale.message, /refresh/i)
  assert.equal(result.current.status, 'ready')
})

test('PR5 public home is the marketplace entry and the authenticated chain stays reachable', () => {
  const result = runTypeScriptScenario(`
    const journeyModule = await import('./apps/web/src/lib/tus-journeys.ts')
    const { buildTusJourneyLinks } = journeyModule.default ?? journeyModule
    const journeys = buildTusJourneyLinks({ roles: ['customer', 'merchant', 'operations', 'staff'], permissions: ['tus:read', 'tus:operations:read', 'tus:pos:write'] })
    console.log(JSON.stringify({ journeys: journeys.map((journey) => journey.href) }))
  `)
  const home = ['home-page.tsx', 'public-header.tsx', 'recent-requests.tsx']
    .map((file) => readFileSync(join(root, 'apps/web/src/features/home', file), 'utf8'))
    .join('\n')

  assert.match(home, /href="\/sign-in"/)
  assert.match(home, /href="\/registro"/)
  assert.match(home, /Solicitudes recientes/)
  assert.match(home, /href="\/registro\?intencion=prestador"/)
  // The customer, merchant, operations and POS chain lives behind sign-in (/tus).
  for (const href of ['/tus?surface=discovery', '/tus?surface=commitments', '/tus/operations', '/tus/pos'])
    assert.ok(result.journeys.includes(href), href)
  assert.match(readFileSync(join(root, 'apps/web/src/app/page.tsx'), 'utf8'), /online operation requires connectivity/i)
})

test('PR4 uses en-AR formatting while preserving foreign and missing currency facts', () => {
  const result = runTypeScriptScenario(`
    const journeyModule = await import('./apps/web/src/lib/tus-journeys.ts')
    const { TUS_LOCALE, formatTusCurrency, formatTusDate, resolveTusCatalogFacts } = journeyModule.default ?? journeyModule.default?.default ?? journeyModule
    console.log(JSON.stringify({
      locale: TUS_LOCALE,
      ars: formatTusCurrency(1250, 'ARS'),
      usd: formatTusCurrency(1250, 'USD'),
      missing: formatTusCurrency(1250, undefined),
      date: formatTusDate('2026-08-29T15:30:00.000Z'),
      facts: resolveTusCatalogFacts({ kind: 'product', price: 1250, currency: 'USD', availableQuantity: 2 }),
    }))
  `)

  assert.equal(result.locale, 'en-AR')
  assert.match(result.ars, /ARS|\$/)
  assert.match(result.usd, /US\$|USD|\$/)
  assert.match(result.missing, /not provided|currency/i)
  assert.match(result.date, /2026|29|Aug/i)
  assert.match(result.facts.price, /US\$|USD|\$/)
  assert.doesNotMatch(result.facts.price, /ARS/)
})

test('PR4 exposes only safe public support destinations and public crawler routes', () => {
  const result = runTypeScriptScenario(`
    const journeyModule = await import('./apps/web/src/lib/tus-journeys.ts')
    const { createTusSupportDestination } = journeyModule.default ?? journeyModule.default?.default ?? journeyModule
    const robotsModule = await import('./apps/web/src/app/robots.ts')
    const sitemapModule = await import('./apps/web/src/app/sitemap.ts')
    const robots = (typeof robotsModule.default === 'function' ? robotsModule.default : robotsModule.default.default)()
    const sitemap = (typeof sitemapModule.default === 'function' ? sitemapModule.default : sitemapModule.default.default)()
    console.log(JSON.stringify({
      safe: createTusSupportDestination('https://wa.me/5491100000000'),
      unsafe: createTusSupportDestination('javascript:alert(1)'),
      robots,
      sitemap,
    }))
  `)

  assert.equal(result.safe, 'https://wa.me/5491100000000')
  assert.equal(result.unsafe, undefined)
  assert.match(result.robots.rules.disallow.join(','), /tus|auth|sign-in/i)
  assert.ok(result.sitemap.some((entry) => entry.url.endsWith('/')))
  assert.doesNotMatch(JSON.stringify(result.sitemap), /\/tus(?:["/]|$)/)
})
