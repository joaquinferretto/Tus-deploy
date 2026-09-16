import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

test('WEB-02 preserves product checkout idempotency and service synthetic slot', () => {
  const result = runTypeScriptScenario(`
    const { construirIntencionCheckout } = (await import('./apps/web/src/lib/tus-marketplace.ts')).default
    const base = Date.parse('2026-09-16T12:00:00.000Z')
    const product = construirIntencionCheckout({ listingId: 'product-1', kind: 'product', availabilityVersion: 4 }, 'intent-product', base)
    const service = construirIntencionCheckout({ listingId: 'service-1', kind: 'service', availabilityVersion: 7, durationMinutes: 90 }, 'intent-service', base)
    console.log(JSON.stringify({ product, service }))
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
  assert.equal(result.service.requestHash, 'discovery:service-1:7:2026-09-17T12:00:00.000Z')
  assert.equal(result.service.lines[0].slotStart, '2026-09-17T12:00:00.000Z')
  assert.equal(result.service.lines[0].slotEnd, '2026-09-17T13:30:00.000Z')
})
