import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// The home map as the centre of the search: a type selector (professionals / lodgings) that
// changes filters, markers and cards together, a shareable address, a simpler header with
// "¿Cómo funciona?" as a dialog, and a layout that follows the visible viewport.

const web = (path) => readFileSync(join(root, 'apps/web/src', path), 'utf8')

test('MAP STATE: the address is untrusted input; only known keys and shapes are read, values are checked against the catalog, and a state round-trips', () => {
  const r = runTypeScriptScenario(`
    const { parseMapState, mapStateQuery, EMPTY_MAP_STATE } = await import('./apps/web/src/features/home/map-state.ts')
    const catalog = { categories: ['hogar', 'salud'], services: [{ id: 'plomeria', categoryId: 'hogar' }, { id: 'masajes', categoryId: 'salud' }, { id: 'suelto', categoryId: null }], zones: ['Centro', 'Laguna Seca'] }
    const viaje = (state) => parseMapState(mapStateQuery({ ...EMPTY_MAP_STATE, ...state }), catalog)
    console.log(JSON.stringify({
      vacio: parseMapState('', catalog),
      profesionales: parseMapState('?categoria=hogar&servicio=plomeria&zona=Centro', catalog),
      servicioDecideCategoria: parseMapState('?categoria=salud&servicio=plomeria', catalog),
      desconocidos: parseMapState('?categoria=inventada&servicio=inventado&zona=Otra', catalog),
      sinCatalogo: parseMapState('?categoria=hogar&servicio=plomeria'),
      hostiles: parseMapState('?tipo=<script>&categoria=../../etc&servicio=%3Cimg%20onerror%3D1%3E&zona=' + 'x'.repeat(500), catalog),
      hostilesSinCatalogo: parseMapState('?categoria=../../etc&servicio=' + encodeURIComponent('"><svg onload=1>') + '&zona=' + 'x'.repeat(500)),
      alojamientos: parseMapState('?tipo=alojamientos&alojamiento=cabana&personas=4&categoria=hogar', catalog),
      personasInvalidas: ['0', '-1', '21', '1.5', 'abc', '1e9', ''].map((personas) => parseMapState('?tipo=alojamientos&personas=' + personas, catalog).guests),
      tipoInvalido: parseMapState('?tipo=alojamientos&alojamiento=' + encodeURIComponent('cabaña; DROP'), catalog).lodgingType,
      claveAjena: parseMapState('?admin=1&tenantId=x&orden=precio', catalog),
      consultaVacia: mapStateQuery(EMPTY_MAP_STATE),
      consultaProfesionales: mapStateQuery({ ...EMPTY_MAP_STATE, category: 'hogar', service: 'plomeria', zone: 'Laguna Seca', lodgingType: 'cabana', guests: 3 }),
      consultaAlojamientos: mapStateQuery({ ...EMPTY_MAP_STATE, kind: 'alojamientos', category: 'hogar', lodgingType: 'cabana', guests: 3 }),
      idaYVuelta: [viaje({ category: 'hogar', service: 'plomeria', zone: 'Laguna Seca' }), viaje({ kind: 'alojamientos', lodgingType: 'cabana', guests: 2 })],
    }))
  `)
  const vacio = { kind: 'profesionales', category: '', service: '', zone: '', lodgingType: '', guests: null }
  assert.deepEqual(r.vacio, vacio)
  assert.deepEqual(r.profesionales, { ...vacio, category: 'hogar', service: 'plomeria', zone: 'Centro' })
  assert.deepEqual(r.servicioDecideCategoria, { ...vacio, category: 'hogar', service: 'plomeria' }, 'a service belongs to one category')
  assert.deepEqual(r.desconocidos, vacio, 'values that are not in the catalog are dropped')
  assert.deepEqual(r.sinCatalogo, { ...vacio, category: 'hogar', service: 'plomeria' })
  assert.deepEqual(r.hostiles, vacio)
  assert.deepEqual([r.hostilesSinCatalogo.category, r.hostilesSinCatalogo.service, r.hostilesSinCatalogo.zone.length], ['', '', 80], 'ids keep a fixed shape and the zone is bounded even before the catalog arrives')
  assert.deepEqual(r.alojamientos, { ...vacio, kind: 'alojamientos', lodgingType: 'cabana', guests: 4 }, 'filters of the other type are not read')
  assert.deepEqual(r.personasInvalidas, [null, null, null, null, null, null, null])
  assert.equal(r.tipoInvalido, '')
  assert.deepEqual(r.claveAjena, vacio)
  assert.equal(r.consultaVacia, '', 'the default map keeps the clean address')
  assert.equal(r.consultaProfesionales, '?categoria=hogar&servicio=plomeria&zona=Laguna+Seca')
  assert.equal(r.consultaAlojamientos, '?tipo=alojamientos&alojamiento=cabana&personas=3')
  assert.deepEqual(r.idaYVuelta, [{ ...vacio, category: 'hogar', service: 'plomeria', zone: 'Laguna Seca' }, { ...vacio, kind: 'alojamientos', lodgingType: 'cabana', guests: 2 }])
})

test('HEADER: "Alojamientos" and "Cómo funciona" are no longer main destinations; "¿Cómo funciona?" opens a native modal dialog; the routes keep answering', () => {
  const header = web('features/home/public-header.tsx')
  const nav = header.slice(header.indexOf('const NAV = ['), header.indexOf('] as const'))
  assert.deepEqual([...nav.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), ['Buscar servicios', 'Buscar trabajador', 'Para profesionales', 'Ayuda'])
  assert.doesNotMatch(nav, /alojamientos|como-funciona/)
  assert.equal((header.match(/aria-haspopup="dialog"/g) ?? []).length, 2, 'desktop navigation and mobile menu')
  assert.match(header, /<HowItWorksDialog onClose=\{\(\) => setHowOpen\(false\)\} open=\{howOpen\} \/>/)

  const dialog = web('features/home/how-it-works.tsx')
  // Native <dialog> + showModal(): focus trap, Escape and focus restoration come from the browser.
  assert.match(dialog, /<dialog\b/)
  assert.match(dialog, /dialog\.showModal\(\)/)
  assert.match(dialog, /aria-labelledby="como-funciona-dialogo-titulo"/)
  assert.match(dialog, /aria-label="Cerrar"/)
  assert.match(dialog, /onClose=\{onClose\}/)
  assert.doesNotMatch(dialog, /dangerouslySetInnerHTML/)
  // One text for the dialog, the home section and the page.
  assert.match(web('features/home/home-page.tsx'), /<HowItWorksSteps \/>/)
  assert.match(web('app/como-funciona/page.tsx'), /<HowItWorksSteps heading="h2" \/>/)

  for (const page of ['alojamientos/page.tsx', 'alojamientos/[id]/page.tsx', 'trabajadores/page.tsx', 'como-funciona/page.tsx', 'buscar-trabajador/page.tsx'])
    assert.ok(existsSync(join(root, 'apps/web/src/app', page)), page)
  const redirect = web('app/buscar-trabajador/page.tsx')
  assert.match(redirect, /permanentRedirect\(suffix \? `\/trabajadores\?\$\{suffix\}` : '\/trabajadores'\)/)
  assert.match(redirect, /for \(const key of \['q', 'oficio'\] as const\)/, 'only the two known filters are carried over')
  assert.match(redirect, /\.slice\(0, 80\)/)
  assert.match(web('features/home/site-footer.tsx'), /href="\/alojamientos"/, 'lodgings stay reachable from the footer')
})

test('MAP TYPE: one selector switches results, markers, filters and cards; lodgings are only requested when chosen; superseded requests are cancelled', () => {
  const home = web('features/home/home-page.tsx')
  const selector = web('features/home/map-type-selector.tsx')
  assert.match(selector, /role="radiogroup"/)
  assert.match(selector, /role="radio"/)
  assert.match(selector, /aria-checked=\{kind === item\.id\}/)
  assert.match(selector, /ArrowLeft[\s\S]*ArrowRight/)
  assert.deepEqual([...selector.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), ['Profesionales', 'Alojamientos'])

  assert.match(home, /<MapTypeSelector kind=\{kind\} onChange=\{changeKind\} \/>/)
  assert.match(home, /<HomeMap[\s\S]*kind=\{kind\}/)
  assert.match(web('features/home/home-map.tsx'), /kind === 'alojamientos'[\s\S]*<LodgingLayer/)
  assert.match(home, /<LodgingFilters/)
  assert.match(home, /<MapFilters/)
  assert.match(home, /<LodgingResults/)
  assert.match(home, /<ProviderResults/)
  // Nothing about lodgings is fetched until the person asks for them.
  assert.equal((home.match(/enabled: lodgingsOn/g) ?? []).length, 2)
  // Cancelable requests: react-query's signal reaches fetch.
  assert.match(home, /queryFn: \(\{ signal \}\) => buscarAlojamientos\([\s\S]*?\{ signal \}\)/)
  assert.match(home, /queryFn: \(\{ signal \}\) => getProvidersSource\(\)\.list\(next, signal\)/)
  assert.match(web('features/home/use-providers.ts'), /queryFn: \(\{ signal \}\) => source\.list\(debounced, signal\)/)
  assert.match(web('features/directory/directory-client.ts'), /list: \(filters: DirectoryFilters, signal\?: AbortSignal\)/)
  assert.match(web('features/directory/worker-directory.tsx'), /queryFn: \(\{ signal \}\) => client\.list\(\{ \.\.\.filters, pagina: page \}, signal\)/)
  assert.match(web('features/alojamientos/alojamientos-client.ts'), /opciones\.signal \? \{ signal: opciones\.signal \} : \{\}/)
  // The address follows the map without adding history entries.
  assert.match(home, /parseMapState\(window\.location\.search, \{/)
  assert.match(home, /window\.history\.replaceState\(null, '', `\$\{window\.location\.pathname\}\$\{query\}\$\{window\.location\.hash\}`\)/)
  assert.doesNotMatch(home, /history\.pushState/)
  // Category and subcategory come from the catalog of the backend.
  const filters = web('features/home/map-filters.tsx')
  assert.doesNotMatch(filters, /\[\s*\{\s*id:/, 'no hardcoded list of categories')
  assert.match(web('features/home/lodging-filters.tsx'), /types\.map\(\(item\) => <option key=\{item\.id\} value=\{item\.slug\}>/)
})

test('CARDS: compact cards show only real public data; a photo is only read from the TUS API; lodging images are https or local', () => {
  const card = web('features/directory/worker-card.tsx')
  assert.match(card, /compact = false/)
  assert.match(card, /<Avatar initials=\{worker\.initials\} photoUrl=\{worker\.photoUrl\} size="sm" \/>/)
  assert.match(card, /const rating = ratingLabel\(worker\.rating\)/, 'the rating is the real one or nothing')
  assert.doesNotMatch(card, /★ ?[0-9]/, 'no invented rating')
  assert.match(web('features/home/provider-results.tsx'), /<WorkerCard compact worker=\{worker\} \/>/)
  const avatar = web('features/directory/avatar.tsx')
  assert.match(avatar, /const src = photoUrl && !failed \? apiUrl\(photoUrl\) : ''/)
  assert.match(avatar, /onError=\{\(\) => setFailed\(true\)\}/, 'a broken photo falls back to the initials')
  assert.match(web('features/directory/directory-client.ts'), /return path\.startsWith\('\/tus\/v1\/'\) \? `\$\{apiBase\(\)\}\$\{path\}` : ''/, 'only API paths become image URLs')

  const r = runTypeScriptScenario(`
    const { RUTA_FOTO_PRESTADOR, esPrestadorPublico } = await import('./packages/contracts/src/tus-directorio.ts')
    const rutas = ['/tus/v1/public/prestadores/abc-123/foto', '/tus/v1/public/prestadores/abc-123/foto?v=0123abcd', 'https://evil.example/x.png', '//evil.example/x.png', '/tus/v1/public/prestadores/../../admin/foto', '/tus/v1/public/prestadores/abc/foto?v=zz', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>']
    console.log(JSON.stringify({ rutas: rutas.map((ruta) => RUTA_FOTO_PRESTADOR.test(ruta)) }))
  `)
  assert.deepEqual(r.rutas, [true, true, false, false, false, false, false, false])

  const lodging = web('features/home/lodging-results.tsx')
  assert.match(lodging, /image\.url\.startsWith\('https:\/\/'\) \|\| \(image\.url\.startsWith\('\/'\) && !image\.url\.startsWith\('\/\/'\)\)/)
  assert.match(lodging, /\{lodging\.rating \? /, 'a lodging rating appears only when the API sends one')
  for (const file of ['features/home/lodging-results.tsx', 'features/home/map-sheet.tsx', 'features/home/map-type-selector.tsx', 'features/home/lodging-filters.tsx', 'features/directory/avatar.tsx'])
    assert.doesNotMatch(web(file), /dangerouslySetInnerHTML|innerHTML/, file)
})

test('RESPONSIVE MAP: the hero follows the visible viewport, small screens get a bottom sheet instead of a popup, and Leaflet is re-measured only when its container changes size', () => {
  const css = web('features/home/home.module.css')
  const hero = css.slice(css.indexOf('.hero {'), css.indexOf('}', css.indexOf('.hero {')))
  assert.match(hero, /height: clamp\(480px, calc\(100vh - 64px\), 900px\);\s*height: clamp\(480px, calc\(100dvh - 64px\), 900px\);/, 'dvh with a vh fallback')
  assert.match(css, /\.mapLayer \{\s*height: 62vh;\s*height: 62dvh;/)
  assert.match(css, /@media \(max-width: 380px\)/)
  assert.match(css, /@media \(min-width: 1600px\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  // Touch targets of the new controls.
  assert.match(css, /\.typeOption \{[^}]*min-height: 40px;/)
  assert.match(css, /\.dialogClose,\s*\.mapSheetClose \{[^}]*height: 44px;/)

  const home = web('features/home/home-page.tsx')
  assert.match(home, /const compact = useMediaQuery\('\(max-width: 768px\)'\)/)
  assert.match(home, /<HomeMap[\s\S]*popups=\{!compact\}/)
  assert.match(home, /compact && !lodgingsOn && selectedProvider \? \(\s*<MapSheet/)
  assert.match(home, /compact && lodgingsOn && selectedLodging \? \(\s*<MapSheet/)
  const sheet = web('features/home/map-sheet.tsx')
  assert.match(sheet, /event\.key === 'Escape'/)
  assert.match(sheet, /aria-label="Cerrar"/)
  // The media query hook renders the same on the server and on the first client render.
  assert.match(web('features/home/use-media-query.ts'), /useSyncExternalStore\(/)

  const map = web('features/home/provider-map.tsx')
  const lifecycle = web('features/home/tus-map.tsx')
  const watcher = lifecycle.slice(lifecycle.indexOf('function MapSizeWatcher'), lifecycle.indexOf('// Timers of a map component'))
  assert.match(watcher, /new ResizeObserver\(/)
  assert.match(watcher, /if \(container\.clientWidth === width && container\.clientHeight === height\) return/, 'nothing happens unless the size really changed')
  assert.match(watcher, /requestAnimationFrame\(\(\) => map\.invalidateSize\(\{ animate: false \}\)\)/)
  assert.match(watcher, /observer\.disconnect\(\)/)
  assert.equal((lifecycle.match(/invalidateSize/g) ?? []).length, 1, 'no other caller re-measures the map')
  assert.doesNotMatch(map, /setInterval/)
  // Icons are memoized, so an unchanged render does not rebuild the markers.
  assert.match(map, /const iconCache = new Map<string, L\.DivIcon>\(\)/)
  assert.match(lifecycle, /<MapSizeWatcher \/>/)
  // The selector swaps layers inside one map. True unmount is delayed until Leaflet's public
  // zoom lifecycle has settled, without private fields, stop(), or exception swallowing.
  assert.match(web('features/home/home-map.tsx'), /kind === 'alojamientos'[\s\S]*<LodgingLayer/)
  assert.match(lifecycle, /map\.on\('zoomanim', onZoomAnimation\)/)
  assert.match(lifecycle, /map\.on\('zoomend', onZoomEnd\)/)
  assert.match(lifecycle, /ZOOM_ANIMATION_MS \+ ZOOM_REMOVAL_GRACE_MS/)
  assert.match(lifecycle, /setTimeout\(\(\) => \{[\s\S]*?map\.remove\(\)/)
  assert.doesNotMatch(lifecycle + map, /_animatingZoom|\._stop|map\.stop\(|try\s*\{/)
  assert.match(lifecycle, /if \(moving\) pending = scheduled/)
  assert.match(lifecycle, /if \(pending === scheduled\) pending = null/)
  // The sheet is anchored to the screen (the bottom of the map can be below the fold).
  assert.match(css, /\.mapSheet \{[^}]*position: fixed;[^}]*z-index: 1200;/)

  const logo = web('features/brand/brand.module.css')
  assert.match(logo, /\.logoHeader \{\s*height: clamp\(26px, 7vw, 36px\);\s*width: auto;/)
})
