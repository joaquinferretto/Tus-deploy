import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  return JSON.parse(execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  }).trim())
}

test('WEB-02 encuentra publicaciones y conserva filtros por tipo', () => {
  const result = runTypeScriptScenario(`
    const { encontrarPublicacion, filtrarPublicaciones } = (await import('./apps/web/src/lib/tus-marketplace.ts')).default
    const publicaciones = [
      { listingId: 'product-1', kind: 'product' },
      { listingId: 'service-1', kind: 'service' },
    ]
    console.log(JSON.stringify({
      found: encontrarPublicacion(publicaciones, ' service-1 ').listingId,
      missing: encontrarPublicacion(publicaciones, 'missing'),
      all: filtrarPublicaciones(publicaciones, 'all').map(({ listingId }) => listingId),
      products: filtrarPublicaciones(publicaciones, 'products').map(({ listingId }) => listingId),
      services: filtrarPublicaciones(publicaciones, 'services').map(({ listingId }) => listingId),
    }))
  `)
  assert.equal(result.found, 'service-1')
  assert.equal(result.missing, undefined)
  assert.deepEqual(result.all, ['product-1', 'service-1'])
  assert.deepEqual(result.products, ['product-1'])
  assert.deepEqual(result.services, ['service-1'])
})

test('WEB-02 builds encoded publication and commitment links', () => {
  const result = runTypeScriptScenario(`
    const { crearEnlaceCompromiso, crearEnlacePublicacion } = (await import('./apps/web/src/lib/tus-marketplace.ts')).default
    console.log(JSON.stringify({
      publication: crearEnlacePublicacion('service/a'),
      commitment: crearEnlaceCompromiso('commitment/a'),
    }))
  `)
  assert.equal(result.publication, '/tus/mercado/service%2Fa')
  assert.equal(result.commitment, '/tus/compromisos/commitment%2Fa')
})

test('WEB-04D3 preserves product checkout and requires a real service slot', () => {
  const result = runTypeScriptScenario(`
    const { construirIntencionCheckout } = (await import('./apps/web/src/lib/tus-marketplace.ts')).default
    const product = construirIntencionCheckout({ listingId: 'product-1', kind: 'product', availabilityVersion: 4 }, 'intent-product')
    let missingSlot = ''
    try { construirIntencionCheckout({ listingId: 'service-1', kind: 'service', availabilityVersion: 7, durationMinutes: 90 }, 'intent-service') } catch (error) { missingSlot = error.message }
    const realSlot = construirIntencionCheckout(
      { listingId: 'service-1', kind: 'service', availabilityVersion: 7, durationMinutes: 90 },
      'intent-real-slot',
      { slotId: 'calendar-1:service-1:2026-09-20T14:00:00.000Z', start: '2026-09-20T14:00:00.000Z', end: '2026-09-20T15:30:00.000Z' },
    )
    console.log(JSON.stringify({ product, missingSlot, realSlot }))
  `)
  assert.equal(result.product.idempotencyKey, 'tus:checkout:intent-product')
  assert.equal(result.product.cartId, 'cart-intent-product')
  assert.deepEqual(result.product.lines[0], {
    lineId: 'line-intent-product',
    listingId: 'product-1',
    context: 'product',
    quantity: 1,
    availabilityVersion: 4,
  })
  assert.match(result.missingSlot, /real service slot/i)

  assert.equal(result.realSlot.requestHash, 'discovery:service-1:7:calendar-1:service-1:2026-09-20T14:00:00.000Z')
  assert.equal(result.realSlot.lines[0].slotStart, '2026-09-20T14:00:00.000Z')
  assert.equal(result.realSlot.lines[0].slotEnd, '2026-09-20T15:30:00.000Z')
})

test('WEB-04D3 blocks automatic service actions for every budget mode', () => {
  const result = runTypeScriptScenario(`
    const { publicacionRequierePresupuesto } = (await import('./apps/web/src/lib/tus-marketplace.ts')).default
    console.log(JSON.stringify({
      bookingMode: publicacionRequierePresupuesto({ kind: 'service', bookingMode: 'requiere_presupuesto' }),
      legacyPriceMode: publicacionRequierePresupuesto({ kind: 'service', priceMode: 'requires_budget' }),
      physicalPriceMode: publicacionRequierePresupuesto({ kind: 'service', priceMode: 'presupuesto' }),
      fixed: publicacionRequierePresupuesto({ kind: 'service', bookingMode: 'fixed_shift', priceMode: 'fixed' }),
      product: publicacionRequierePresupuesto({ kind: 'product', priceMode: 'requires_budget' }),
    }))
  `)
  assert.equal(result.bookingMode, true)
  assert.equal(result.legacyPriceMode, true)
  assert.equal(result.physicalPriceMode, true)
  assert.equal(result.fixed, false)
  assert.equal(result.product, false)
})

test('WEB-04D3 removes synthetic service dates from the public flow', () => {
  const marketplace = readFileSync(join(root, 'apps/web/src/lib/tus-marketplace.ts'), 'utf8')
  const dashboard = readFileSync(join(root, 'apps/web/src/app/tus/tus-dashboard.tsx'), 'utf8')
  const publicMarket = readFileSync(join(root, 'apps/web/src/components/mercado/mercado-servicios.tsx'), 'utf8')
  const calendar = readFileSync(join(root, 'apps/web/src/components/calendario/calendario-cliente.tsx'), 'utf8')

  assert.doesNotMatch(marketplace, /Date\.now\(\)\s*\+\s*24/u)
  assert.doesNotMatch(dashboard, /Date\.now\(\)\s*\+\s*24/u)
  assert.doesNotMatch(publicMarket, /serviceId/u)
  assert.match(publicMarket, /availabilityStatus/u)
  assert.match(calendar, /calendarSlotsForPublication/u)
})
