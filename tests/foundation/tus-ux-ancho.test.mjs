import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root } from './fixtures/web-09-servicio.mjs'

// UX-ANCHO-01. How wide a page is, is decided in ONE place (features/layout): contained for
// reading, wide for a form with context, dashboard for the operating screens. The browser smoke
// (scripts/dev/pagos-servicios-smoke.mjs) measures it at 390, 1280 and 1920.
const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')

test('UX ancho: three widths in one module; the provider panel and the private operating screens use the wide ones, with no footer; the provider navigation is one set of tabs; requests are cards with a short empty state; the Help keeps a reading width with its index at the side', () => {
  const css = read('apps/web/src/features/layout/layout.module.css')
  const ancho = (clase) => new RegExp(`\\.${clase} \\{\\n  max-width: (\\d+)px !important;`, 'u').exec(css)?.[1]
  assert.deepEqual([ancho('contained'), ancho('wide'), ancho('dashboard')], ['800', '1180', '1680'])
  assert.match(css, /\.cardGrid \{[\s\S]*?grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 380px\), 1fr\)\) !important;/u, 'cards: one column on a phone, as many as fit on a desk')
  // No operating page brings its own width any more: it adds one of the three.
  const paginas = { 'apps/web/src/app/prestador/solicitudes/page.tsx': 'dashboard', 'apps/web/src/app/prestador/turnos/page.tsx': 'dashboard', 'apps/web/src/app/prestador/pagos/page.tsx': 'dashboard', 'apps/web/src/app/prestador/ubicacion/page.tsx': 'dashboard', 'apps/web/src/app/prestador/perfil-publico/page.tsx': 'wide', 'apps/web/src/features/requests/my-requests-page.tsx': 'dashboard', 'apps/web/src/features/work/work-page.tsx': 'dashboard', 'apps/web/src/features/turnos/mis-turnos-page.tsx': 'wide' }
  for (const [archivo, variante] of Object.entries(paginas)) assert.match(read(archivo), new RegExp(`\\$\\{layout\\.${variante}\\}`, 'u'), `${archivo} -> ${variante}`)
  // Private operating screens are a workspace: no footer of the public site.
  assert.match(read('apps/web/src/features/home/site-page.tsx'), /\{footer \? <SiteFooter logo=\{logo\} \/> : null\}/u)
  for (const archivo of ['apps/web/src/app/prestador/solicitudes/page.tsx', 'apps/web/src/app/prestador/turnos/page.tsx', 'apps/web/src/app/prestador/pagos/page.tsx', 'apps/web/src/app/prestador/ubicacion/page.tsx', 'apps/web/src/app/prestador/perfil-publico/page.tsx', 'apps/web/src/app/mis-turnos/page.tsx', 'apps/web/src/app/mis-solicitudes/page.tsx', 'apps/web/src/app/trabajos/page.tsx']) assert.match(read(archivo), /<SitePage footer=\{false\} /u, archivo)
  // Reading pages keep the footer and their own narrow width.
  for (const archivo of ['apps/web/src/app/ayuda/page.tsx', 'apps/web/src/app/ayuda/[...slug]/page.tsx']) assert.doesNotMatch(read(archivo), /footer=\{false\}|layout\.dashboard/u, archivo)

  // One navigation for the provider: its modules as tabs; the manual is help, at the side.
  const nav = read('apps/web/src/features/provider/provider-nav.tsx')
  assert.deepEqual([...nav.matchAll(/\{ href: '([^']+)', label: '([^']+)' \},/gu)].map((m) => `${m[2]} ${m[1]}`), ['Solicitudes /prestador/solicitudes', 'Agenda /prestador/turnos', 'Trabajos /trabajos', 'Servicios y perfil /prestador/perfil-publico', 'Ganancias /prestador/pagos', 'Ubicación /prestador/ubicacion'], 'the same routes as always')
  assert.match(nav, /<nav aria-label="Prestador" className=\{layout\.tabs\} data-nav-prestador>/u)
  assert.match(read('apps/web/src/features/home/public-header.tsx'), /pathname\.startsWith\('\/prestador\/'\) \? null : links\.filter\(/u, 'inside the panel the header does not repeat its tabs')

  // Requests: who asks first, then what and where; a short empty state with one action.
  const inbox = read('apps/web/src/features/provider/provider-inbox.tsx')
  assert.match(inbox, /<strong data-solicitante>\{item\.requesterName\}<\/strong>/u)
  for (const texto of ['No hay solicitudes nuevas por ahora', 'Cuando aparezca una solicitud compatible con tu perfil, la vas a ver acá.', 'Editar mis servicios']) assert.ok(inbox.includes(texto), texto)
  assert.match(inbox, /item\.images\.length > 0 \? <PrivateImages paths=\{item\.images\} session=\{session\.session\} \/> : null/u, 'the pictures of the client, read with the session')
  for (const archivo of ['apps/web/src/features/provider/provider-inbox.tsx', 'apps/web/src/features/provider/provider-open-requests.tsx', 'apps/web/src/features/provider/provider-urgent.tsx']) assert.doesNotMatch(read(archivo), /gridTemplateColumns: '1fr'/u, `${archivo}: no list forced to one column`)
  assert.match(read('apps/web/src/app/prestador/solicitudes/page.tsx'), /<div className=\{layout\.split\}[\s\S]*?<ProviderInbox \/>[\s\S]*?<ProviderOpenRequests \/>[\s\S]*?<\/div>\n\s+<ProviderUrgent \/>/u, 'urgencies are a compact panel at the side')
  // A client attaches up to two pictures to a request (validated by the API).
  assert.match(read('apps/web/src/features/requests/request-form.tsx'), /const MAX_IMAGES = 2/u)

  // The Help: wider on a desk, never a longer line of text.
  const ayuda = read('apps/web/src/features/help/help.module.css')
  assert.match(ayuda, /\.wrap \{\n  margin: 0 auto;\n  max-width: 760px;/u, 'the reading width is the default')
  assert.match(ayuda, /@media \(min-width: 1100px\) \{\n  \.wrap:has\(> \.toc\) \{[\s\S]*?grid-template-columns: 260px minmax\(0, 760px\);/u)
  assert.match(ayuda, /\.wrap:has\(> \.toc\) > \.toc \{[\s\S]*?position: sticky;/u)
})
