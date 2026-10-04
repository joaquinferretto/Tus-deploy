import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Public provider map: ONE marker per provider (never one per service), clustering of nearby
// markers, a list popup for providers on the same point, Categoría -> Servicio filters and a
// fixed number of reads for the whole map whatever the number of providers.
const read = (file) => readFileSync(join(root, file), 'utf8')

test('CLUSTER: same point always grouped (any zoom), nearby points clustered only when zoomed out, deterministic, invalid coordinates ignored', () => {
  const r = runTypeScriptScenario(`
    const { clusterMarkers, MAX_CLUSTER_ZOOM } = await import('./apps/web/src/features/home/map-clusters.ts')
    const entries = [
      { item: 'a', lat: -31.66, lng: -64.43 }, { item: 'b', lat: -31.66, lng: -64.43 }, { item: 'c', lat: -31.66, lng: -64.43 },
      { item: 'd', lat: -31.6605, lng: -64.4305 },
      { item: 'far', lat: -27.4692, lng: -58.8306 },
      { item: 'nan', lat: Number.NaN, lng: -58 },
    ]
    const shape = (groups) => groups.map((g) => [g.items.slice().sort().join(''), g.samePoint]).sort()
    const out = shape(clusterMarkers(entries, 12))
    const inside = shape(clusterMarkers(entries, MAX_CLUSTER_ZOOM))
    const max = shape(clusterMarkers(entries, 20))
    const reversed = shape(clusterMarkers(entries.slice().reverse(), 12))
    const single = clusterMarkers([{ item: 'x', lat: -27.1, lng: -58.1 }], 5)
    const cluster = clusterMarkers(entries, 12).find((g) => g.items.includes('d'))
    console.log(JSON.stringify({ out, inside, max, reversed, single: [single.length, single[0].lat, single[0].lng, single[0].samePoint], bounds: cluster.bounds, empty: clusterMarkers([], 10).length }))
  `)
  // Zoomed out: the three providers on one point and the one 70 m away form ONE cluster.
  assert.deepEqual(r.out, [['abcd', false], ['far', true]])
  // From the max clustering zoom only exact points are merged: 3 providers stay a same-point list.
  assert.deepEqual(r.inside, [['abc', true], ['d', true], ['far', true]])
  assert.deepEqual(r.max, r.inside)
  assert.deepEqual(r.reversed, r.out)
  assert.deepEqual(r.single, [1, -27.1, -58.1, true])
  assert.deepEqual(r.bounds, { south: -31.6605, west: -64.4305, north: -31.66, east: -64.43 })
  assert.equal(r.empty, 0)
})

test('CLUSTER: 300 providers on 3 points render 3 markers; 300 spread providers stay bounded and fast', () => {
  const r = runTypeScriptScenario(`
    const { clusterMarkers } = await import('./apps/web/src/features/home/map-clusters.ts')
    const same = Array.from({ length: 300 }, (_, i) => ({ item: 'p' + i, lat: -27.46 - (i % 3) * 0.05, lng: -58.83 }))
    const spread = Array.from({ length: 300 }, (_, i) => ({ item: 's' + i, lat: -27.40 - (i % 20) * 0.01, lng: -58.90 + Math.floor(i / 20) * 0.01 }))
    const t0 = performance.now()
    const a = clusterMarkers(same, 18)
    const b = clusterMarkers(spread, 12)
    const ms = performance.now() - t0
    console.log(JSON.stringify({ markers: a.length, sizes: a.map((g) => g.items.length), spread: b.length, all: b.reduce((n, g) => n + g.items.length, 0), ms }))
  `)
  assert.equal(r.markers, 3)
  assert.deepEqual(r.sizes, [100, 100, 100])
  assert.ok(r.spread < 300 && r.spread > 0)
  assert.equal(r.all, 300)
  assert.ok(r.ms < 1000, `clustering took ${r.ms} ms`)
})

test('ONE MARKER PER PROVIDER: a provider with 5 services has one map point; the map never draws one marker per service', () => {
  const r = runTypeScriptScenario(`
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const merchants = new Map()
    const application = { marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null, findMany: async (ids) => ids.map((t) => merchants.get(t)).filter(Boolean) }, listings: { forTenant: async () => [], forTenants: async () => [] } } }, identity: { identidadVerificada: async () => false, resumenDeTenants: async () => new Map() } }
    const directorio = crearServicioDirectorio({ application, contarCompletados: async () => 0, now: () => Date.parse('2026-09-28T13:00:00.000Z') })
    const ctx = (tenantId) => ({ tenantId, subjectId: 'a-' + tenantId, sessionId: 's', roles: ['merchant'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
    merchants.set('t-multi', { tenantId: 't-multi', merchantId: 'm', status: 'approved' })
    await directorio.guardarPerfil(ctx('t-multi'), { displayName: 'Sabrina', profession: 'electricidad', professions: ['electricidad', 'plomeria', 'pintura', 'albanileria', 'mecanica'], zone: 'Centro' })
    await directorio.guardarMiUbicacion('t-multi', { lat: -27.4692, lng: -58.8306, mostrarExacta: true })
    const { items } = await directorio.listar({})
    const worker = items[0]
    console.log(JSON.stringify({ count: items.length, services: worker.professions.length, locations: worker.mapLocations.length, point: worker.mapPoint }))
  `)
  assert.equal(r.count, 1)
  assert.equal(r.services, 5)
  assert.equal(r.locations, 1)
  assert.deepEqual(r.point && [r.point.lat, r.point.lng, r.point.precision], [-27.4692, -58.8306, 'exact'])
  const map = read('apps/web/src/features/home/provider-map.tsx')
  // Markers come from the per-provider point, grouped; never one per mapLocations entry.
  assert.match(map, /clusterMarkers\(allLocations\(workers\)/)
  assert.doesNotMatch(map, /mapLocations\.map\(/)
})

test('NO N+1: the public map reads a fixed number of batches for 1 and for 40 providers; no per-provider read', () => {
  const r = runTypeScriptScenario(`
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const calls = {}
    const hit = (name) => { calls[name] = (calls[name] ?? 0) + 1 }
    const merchants = new Map()
    const listings = []
    const application = {
      marketplace: { store: {
        merchant: { find: async (t) => { hit('merchant.find'); return merchants.get(t) ?? null }, findMany: async (ids) => { hit('merchant.findMany'); return ids.map((t) => merchants.get(t)).filter(Boolean) } },
        listings: { forTenant: async (t) => { hit('listings.forTenant'); return listings.filter((l) => l.tenantId === t) }, forTenants: async (ids) => { hit('listings.forTenants'); return listings.filter((l) => ids.includes(l.tenantId)) } },
      } },
      identity: {
        identidadVerificada: async () => { hit('identity.one'); return true },
        ubicacionPublicaVerificada: async () => { hit('identity.area'); return null },
        resumenDeTenants: async (ids) => { hit('identity.batch'); return new Map(ids.map((t) => [t, { verificado: true, area: null }])) },
      },
    }
    const directorio = crearServicioDirectorio({
      application,
      contarCompletados: async () => { hit('completed.one'); return 0 },
      contarCompletadosLote: async () => { hit('completed.batch'); return new Map() },
      calificaciones: async (ids) => { hit('ratings.batch'); return new Map() },
      now: () => Date.parse('2026-09-28T13:00:00.000Z'),
    })
    const ctx = (tenantId) => ({ tenantId, subjectId: 'a-' + tenantId, sessionId: 's', roles: ['merchant'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
    async function add(i) {
      const t = 't-' + i
      merchants.set(t, { tenantId: t, merchantId: 'm-' + i, status: 'approved' })
      listings.push({ tenantId: t, listingId: 'l-' + i, published: true, kind: 'service', name: 'Servicio ' + i, price: 1000, currency: 'ARS', priceMode: 'fixed', workingHours: [] })
      await directorio.guardarPerfil(ctx(t), { displayName: 'Prestador ' + i, profession: 'plomeria', professions: ['plomeria', 'electricidad'], zone: 'Centro' })
    }
    await add(0)
    for (const k of Object.keys(calls)) delete calls[k]
    const one = await directorio.listar({})
    const withOne = { ...calls }
    for (let i = 1; i < 40; i++) await add(i)
    for (const k of Object.keys(calls)) delete calls[k]
    const forty = await directorio.listar({ categoria: 'hogar' })
    const withForty = { ...calls }
    const mapa = await directorio.listar({ mapa: '1', pagina: '3' })
    const lista = await directorio.listar({})
    console.log(JSON.stringify({ mapa: [mapa.items.length, mapa.page, mapa.hasMore], lista: [lista.items.length, lista.hasMore], withOne, withForty, n1: one.items.length, n40: forty.total, verified: forty.items.every((w) => w.verified), price: forty.items[0].startingPrice }))
  `)
  assert.equal(r.n1, 1)
  assert.equal(r.n40, 40)
  // The map gets every provider in one response; the directory list keeps pages of 12.
  assert.deepEqual(r.mapa, [40, 1, false])
  assert.deepEqual(r.lista, [12, true])
  assert.equal(r.verified, true)
  // Listings were read in the batch: the starting price comes from them.
  assert.equal(r.price?.amount, 1000)
  // Same reads for 1 and 40 providers, each one a batch.
  assert.deepEqual(r.withForty, r.withOne)
  assert.deepEqual(r.withOne, { 'merchant.findMany': 1, 'listings.forTenants': 1, 'identity.batch': 1, 'completed.batch': 1, 'ratings.batch': 1 })
})

test('FILTERS: Categoría -> Subcategoría (a service) in the home; the service wins over the category; the query string carries categoria', () => {
  const r = runTypeScriptScenario(`
    const { toProviderFilters } = await import('./apps/web/src/features/home/providers-source.ts')
    const { directoryQuery } = await import('./apps/web/src/features/directory/directory-client.ts')
    console.log(JSON.stringify({
      category: directoryQuery(toProviderFilters({ query: '', profession: '', zone: '', category: 'hogar' })),
      service: directoryQuery(toProviderFilters({ query: '', profession: 'plomeria', zone: '', category: 'hogar' })),
      none: directoryQuery(toProviderFilters({ query: '', profession: '', zone: '' })),
    }))
  `)
  // The home map asks for every matching provider at once (mapa=1), not the 12 of a list page.
  assert.equal(r.category, '?categoria=hogar&mapa=1')
  assert.equal(r.service, '?oficio=plomeria&mapa=1')
  assert.equal(r.none, '?mapa=1')
  const home = read('apps/web/src/features/home/home-page.tsx')
  assert.match(home, /<MapFilters/)
  const filters = read('apps/web/src/features/home/map-filters.tsx')
  // The second select is labelled "Subcategoría": it still lists the services of the category.
  assert.match(filters, /<span>Categoría<\/span>/)
  assert.match(filters, /<span>Subcategoría<\/span>/)
  assert.match(filters, /catalog\?\.categories/)
  assert.match(filters, /catalog\?\.items/)
})

test('SANITIZED POPUPS: provider text is rendered as JSX text only; marker HTML carries a number or a fixed icon', () => {
  const map = read('apps/web/src/features/home/provider-map.tsx')
  assert.doesNotMatch(map, /dangerouslySetInnerHTML/)
  assert.doesNotMatch(map, /bindPopup|setContent|innerHTML/)
  // The only HTML strings are the divIcons: category svg (fixed catalog of icons) and a clamped count.
  const html = [...map.matchAll(/html: `([^`]*)`/g)].map((m) => m[1])
  assert.equal(html.length, 2)
  for (const item of html) assert.doesNotMatch(item, /displayName|label|name|description/)
  assert.match(html[1], /Math\.min\(999, Math\.max\(0, Math\.trunc\(count\)\)\)/)
  // Same-point list shows name, services, rating and "Ver perfil".
  assert.match(map, /prestadores \{group\.samePoint \? 'en esta ubicación' : 'en esta zona'\}/)
  assert.match(map, /servicesLabel\(worker\)/)
  assert.match(map, /ratingLabel\(worker\.rating\)/)
  assert.match(map, /Ver perfil/)
})
