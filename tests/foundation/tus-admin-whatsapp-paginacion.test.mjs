import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ADMIN-WHATSAPP-AVISOS-01. The inbox of Admin -> WhatsApp pages for real (the store cuts the page
// and counts the filtered total) and its pagination is a compact footer of the panel, not an item
// of the list. The layout itself (one row on desktop, two at 390 px) is measured in a browser by
// scripts/dev/admin-whatsapp-smoke.mjs.
const read = (path) => readFileSync(join(root, path), 'utf8')

test('ADMIN WhatsApp paginación: one page, several pages, the first and the last, another page size and the "needs a person" filter are cut and counted by the backend', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}
    const { paginacion, paginaJson } = await import('./apps/api/src/tus/admin/paginacion.ts')
    const admin = { actorId: 'admin-1', correlationId: 'corr' }
    // What the HTTP route does with the query of the screen.
    const pedir = async (query) => {
      const { pagina, tamano } = paginacion(query)
      const page = await wa.soporte.pagina({ mode: query.mode, pagina, tamano })
      const { items, ...meta } = paginaJson(page.items, pagina, tamano, page.total)
      return { ...meta, n: items.length, ids: items.map((item) => item.conversationId), modos: [...new Set(items.map((item) => item.mode))] }
    }
    const out = {}
    out.vacia = await pedir({})
    for (let i = 0; i < 3; i += 1) { await deliver(inbound('54911556000' + String(i).padStart(2, '0'), 'hola')); waAdvance(1000) }
    out.unaPagina = await pedir({})
    for (let i = 3; i < 32; i += 1) { await deliver(inbound('54911556000' + String(i).padStart(2, '0'), 'hola')); waAdvance(1000) }
    for (let i = 0; i < 4; i += 1) await wa.soporte.tomar((await conversationOf('54911556000' + String(i).padStart(2, '0'))).conversationId, admin)
    out.primera = await pedir({ page: '1', pageSize: '25' })
    out.ultima = await pedir({ page: '2', pageSize: '25' })
    out.sinRepetir = new Set([...out.primera.ids, ...out.ultima.ids]).size
    out.masAlla = await pedir({ page: '9', pageSize: '25' })
    out.diez = await pedir({ page: '1', pageSize: '10' })
    out.diezUltima = await pedir({ page: '4', pageSize: '10' })
    out.cincuenta = await pedir({ page: '1', pageSize: '50' })
    out.tamanoInvalido = [(await pedir({ pageSize: '7' })).pageSize, (await pedir({ pageSize: '1000' })).pageSize, (await pedir({ page: '-3' })).page]
    out.humanas = await pedir({ mode: 'human', page: '1', pageSize: '10' })
    out.humanasSegunda = await pedir({ mode: 'human', page: '2', pageSize: '10' })
    out.asistente = await pedir({ mode: 'bot', page: '3', pageSize: '10' })
    for (const clave of Object.keys(out)) if (out[clave] && out[clave].ids) delete out[clave].ids
    console.log(JSON.stringify(out))
  `)
  const pagina = (page, pageSize, total, totalPages, n) => ({ page, pageSize, total, totalPages, n })
  const sin = ({ modos, ...resto }) => resto
  assert.deepEqual(sin(r.vacia), pagina(1, 25, 0, 1, 0), 'nothing yet: one empty page')
  assert.deepEqual(sin(r.unaPagina), pagina(1, 25, 3, 1, 3), 'one page')
  assert.deepEqual(sin(r.primera), pagina(1, 25, 32, 2, 25), 'the first of several pages')
  assert.deepEqual(sin(r.ultima), pagina(2, 25, 32, 2, 7), 'the last page has what is left')
  assert.equal(r.sinRepetir, 32, 'no conversation is on two pages nor missing')
  assert.deepEqual(sin(r.masAlla), pagina(9, 25, 32, 2, 0), 'a page past the end is empty, with the real total')
  assert.deepEqual(sin(r.diez), pagina(1, 10, 32, 4, 10), 'another page size')
  assert.deepEqual(sin(r.diezUltima), pagina(4, 10, 32, 4, 2))
  assert.deepEqual(sin(r.cincuenta), pagina(1, 50, 32, 1, 32))
  assert.deepEqual(r.tamanoInvalido, [25, 50, 1], 'limits: an unknown size is 25, more than 50 is 50, a page below 1 is 1')
  assert.deepEqual(r.humanas, { ...pagina(1, 10, 4, 1, 4), modos: ['human'] }, 'the filter counts and lists only its conversations')
  assert.deepEqual(sin(r.humanasSegunda), pagina(2, 10, 4, 1, 0))
  assert.deepEqual(r.asistente, { ...pagina(3, 10, 28, 3, 8), modos: ['bot'] }, 'filter and page together')
})

test('ADMIN WhatsApp Web: the pagination is a compact footer of the panel (never an item of the list), keeps the filter and the open conversation, and the shared pagination of the other screens is untouched', () => {
  const whatsapp = read('apps/web/src/components/admin/admin-whatsapp.tsx')
  const paginacion = read('apps/web/src/components/admin/admin-pagination.tsx')
  const css = read('apps/web/src/components/admin/admin.module.css')
  // The footer is a sibling of the list inside the side panel.
  assert.doesNotMatch(whatsapp, /<li><AdminPagination/u, 'the pagination is not an item of the list')
  assert.match(whatsapp, /<\/ul>\s*\{\/\*[\s\S]*?\*\/\}\s*<AdminPagination compact /u)
  assert.match(whatsapp, /className=\{styles\.chatSide\}/u)
  // Real pagination: page, page size and filter go to the API; a filter or another size goes back
  // to the first page; a page that no longer exists falls back to the last real one.
  assert.match(whatsapp, /listWhatsappAdminConversations\(current, filtro === 'human' \? 'human' : undefined, page, pageSize, busqueda\)/u)
  assert.match(whatsapp, /const setFiltro = \(value: 'todas' \| 'human'\) => \{ setFiltroState\(value\); setPage\(1\) \}/u)
  assert.match(whatsapp, /onPageSize=\{\(size\) => \{ setPageSize\(size\); setPage\(1\) \}\}/u)
  assert.match(whatsapp, /if \(page > result\.totalPages\) setPage\(Math\.max\(1, result\.totalPages\)\)/u)
  // The open conversation does not depend on the page nor on the filter.
  assert.doesNotMatch(whatsapp, /setSelectedId\(null\)/u, 'paging or filtering never closes the open conversation')
  // The compact variant is opt-in: every other screen keeps the layout it had.
  assert.match(paginacion, /compact = false/u)
  assert.match(paginacion, /className=\{styles\.pagination\}/u)
  for (const otra of ['admin-usuarios', 'admin-catalogo', 'admin-seguridad', 'admin-solicitudes', 'admin-trabajos', 'admin-liquidaciones', 'admin-prestadores-lista', 'verificaciones-identidad'])
    assert.doesNotMatch(read(`apps/web/src/components/admin/${otra}.tsx`), /<AdminPagination[^>]*\bcompact\b/u, `${otra} keeps the shared pagination`)
  assert.match(paginacion, /disabled=\{page <= 1\}/u)
  assert.match(paginacion, /disabled=\{page >= totalPages\}/u)
  assert.match(css, /\.paginationCompact \{[^}]*flex-wrap: wrap;[^}]*justify-content: space-between;/u, 'page size on the left, pages on the right, wrapping only when they do not fit')
  assert.match(css, /\.paginationPages \{[^}]*flex-wrap: nowrap;/u, 'Anterior, page and Siguiente never split')
  assert.match(css, /\.pagination \{\s*align-items: center;\s*display: flex;\s*flex-wrap: wrap;\s*gap: 10px;\s*justify-content: flex-end;\s*margin-top: 16px;\s*\}/u, 'the shared layout is unchanged')
  // The notice block and the per-message status are shown from what the API returns.
  assert.match(whatsapp, /aria-label="Avisos a prestadores"/u)
  assert.match(whatsapp, /Respondió: \{notice\.answer\.result === 'accepted' \? 'Aceptó' : 'Rechazó'\}/u)
  for (const texto of ['Leído', 'Entregado', 'Enviado (Meta lo recibió; todavía sin entrega)', 'Se intentó enviar; sin confirmación de Meta', 'Falló el envío', 'No enviado: ', 'el prestador no tiene un WhatsApp vinculado', 'está fuera de la ventana de 24 h y no hay plantilla aprobada', 'su conversación está tomada por una persona de TUS', 'el prestador no tiene una cuenta asociada', 'Pendiente: el aviso todavía no se procesó'])
    assert.ok(whatsapp.includes(texto), texto)
})

test('ADMIN WhatsApp avisos: the state of a notice follows the evidence — the answer first, then the furthest any number got, then a failure, then why nothing was sent; nothing at all is "pending"', () => {
  const r = runTypeScriptScenario(`
    const { estadoDelAviso } = await import('./apps/api/src/tus/asistente/soporte.ts')
    console.log(JSON.stringify([
      estadoDelAviso([], null, null),
      estadoDelAviso(['pending_send'], null, null),
      estadoDelAviso(['unknown'], null, null),
      estadoDelAviso(['sent'], null, null),
      estadoDelAviso(['sent', 'delivered'], null, null),
      estadoDelAviso(['failed', 'read'], null, null),
      estadoDelAviso(['failed'], null, null),
      estadoDelAviso(['failed', 'pending_send'], null, null),
      estadoDelAviso([], 'template_required', null),
      estadoDelAviso([], 'no_whatsapp_linked', null),
      estadoDelAviso([], 'conversation_with_operator', null),
      estadoDelAviso([], 'provider_without_account', null),
      estadoDelAviso(['read'], null, 'aceptada'),
      estadoDelAviso([], 'no_whatsapp_linked', 'rechazada'),
    ]))
  `)
  assert.deepEqual(r, ['pending', 'sending', 'sending', 'sent', 'delivered', 'read', 'failed', 'sending', 'template_required', 'not_sent', 'not_sent', 'not_sent', 'accepted', 'rejected'])
})

test('ADMIN WhatsApp Web: a slower answer to an older page never replaces the newer one', () => {
  const whatsapp = read('apps/web/src/components/admin/admin-whatsapp.tsx')
  assert.match(whatsapp, /const turno = \(pedido\.current \+= 1\)/u)
  assert.match(whatsapp, /listWhatsappAdminConversations\([^\n]+\n\s*if \(turno !== pedido\.current\) return\r?\n\s*setItems\(result\.conversations\)/u, 'a stale page is dropped before it touches the list')
})
