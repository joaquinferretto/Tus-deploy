import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

test('PR5 creates deep-linkable journey navigation and denies unscoped staff surfaces', () => {
  const result = runTypeScriptScenario(`
    const journeyModule = await import('./apps/web/src/lib/tus-journeys.ts')
    const { buildTusJourneyLinks, createTusSurfaceHref, resolveTusRoleLabel } = journeyModule.default ?? journeyModule.default?.default ?? journeyModule
    console.log(JSON.stringify({
      links: buildTusJourneyLinks({ roles: ['customer'], permissions: ['tus:read'] }),
      filtered: createTusSurfaceHref('discovery', { filter: 'services', returnTo: '/tus/operations' }),
      external: createTusSurfaceHref('operations', { returnTo: 'https://evil.example' }),
      role: resolveTusRoleLabel(['merchant']),
    }))
  `)

  assert.equal(result.filtered, '/tus?surface=discovery&filter=services&returnTo=%2Ftus%2Foperations')
  assert.equal(result.external, '/tus?surface=operations')
  assert.equal(result.role, 'Merchant · catalog')
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

test('PR5 homepage exposes the full customer, merchant, operations, and POS chain', () => {
  const result = runTypeScriptScenario(`
    const { renderToStaticMarkup } = await import('./apps/web/node_modules/react-dom/server')
    const React = await import('./apps/web/node_modules/react')
    globalThis.React = React
    const pageModule = await import('./apps/web/src/app/page.tsx')
    const HomePage = typeof pageModule.default === 'function' ? pageModule.default : pageModule.default.default
    console.log(JSON.stringify({ markup: renderToStaticMarkup(React.createElement(HomePage)) }))
  `)

  assert.match(result.markup, /href="\/tus\?surface=discovery"/)
  assert.match(result.markup, /href="\/tus\?surface=commitments"/)
  assert.match(result.markup, /href="\/tus\/operations"/)
  assert.match(result.markup, /href="\/tus\/pos"/)
  assert.match(result.markup, /customer|merchant|operations|POS/i)
  assert.match(result.markup, /online operation requires connectivity/i)
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
