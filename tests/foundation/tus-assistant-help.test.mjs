import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// The floating TUS assistant: session-aware help and navigation to real screens, the shared service
// search on the map, and no invented providers or human support.
const root = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

test('ASSISTANT: guest/client/provider/admin cases answer from real features; search stays the shared one', () => {
  const result = runTypeScriptScenario(`
    const { respond, greeting } = await import('./apps/web/src/features/home/assistant-service.ts')
    const { searchServices } = await import('./apps/web/src/features/home/service-search.ts')
    const { interpretarNecesidad } = await import('./apps/api/src/tus/directorio/modelo.ts')
    const catalog = [{ id: 'plomeria', label: 'Plomería' }, { id: 'mecanica', label: 'Mecánica' }, { id: 'aire', label: 'Aire acondicionado' }, { id: 'otros', label: 'Otros oficios' }]
    const searched = []
    const deps = { catalog, interpret: async (text) => interpretarNecesidad(text), providers: async (filters) => { searched.push(filters.profession || filters.query); return filters.profession === 'plomeria' ? [{ id: 'ana' }, { id: 'beto' }, { id: 'caro' }] : [] } }
    const search = (text) => searchServices(text, deps)
    const ctx = (role, extra = {}) => ({ role, name: role === 'guest' ? null : 'Juan Pérez', returnTo: '/', search, help: async () => null, ...extra })
    const out = {}
    const g = greeting({ role: 'guest', name: null, returnTo: '/' })
    out.guestGreeting = [g.text.startsWith('¡Hola! Soy el asistente de TUS'), g.actions.map((a) => a.label)]
    const c = greeting({ role: 'client', name: 'Juan Pérez', returnTo: '/' })
    out.clientGreeting = [c.text, c.actions.map((a) => a.label)]
    out.providerGreeting = greeting({ role: 'provider', name: null, returnTo: '/' }).actions.map((a) => a.label)
    out.adminGreeting = greeting({ role: 'admin', name: null, returnTo: '/' }).actions.map((a) => a.label)
    // Caso 1: guest search filters the map without login.
    out.case1 = (await respond('se rompió una cañería', ctx('guest'))).text
    // Caso 2: publishing needs a session.
    const c2 = await respond('quiero publicar un trabajo', ctx('guest'))
    out.case2 = [c2.text, c2.actions.map((a) => a.label + '=' + a.href)]
    out.case2Client = (await respond('quiero publicar un trabajo', ctx('client'))).actions.map((a) => a.href)
    // Caso 3: where are the applicants.
    const c3 = await respond('¿Dónde veo quién se postuló?', ctx('client'))
    out.case3 = [c3.text, c3.actions.map((a) => a.href)]
    // Caso 4: provider on the map, from the REAL profile state.
    const status = (profile) => ctx('provider', { providerStatus: async () => ({ profile }) })
    out.case4 = [
      (await respond('¿Cómo aparezco en el mapa?', status(null))).text,
      (await respond('¿Cómo aparezco en el mapa?', status({ id: 'p1', visible: false, published: false }))).text,
      (await respond('¿Cómo aparezco en el mapa?', status({ id: 'p1', visible: true, published: false }))).text,
      (await respond('¿Cómo aparezco en el mapa?', status({ id: 'p1', visible: true, published: true }))).actions[0].href,
    ]
    // Caso 5: how it works.
    out.case5 = (await respond('¿Cómo funciona TUS?', ctx('guest'))).text
    out.mustPublish = (await respond('¿Tengo que publicar sí o sí?', ctx('guest'))).text
    out.ambiguous = (await respond('se rompió el motor', ctx('guest'))).options?.map((o) => o.id)
    out.none = await respond('se me rompió el aire acondicionado', ctx('guest'))
    out.edit = (await respond('¿Puedo editar una solicitud?', ctx('client'))).text
    out.cancel = (await respond('¿Cómo cancelo?', ctx('client'))).actions[0].href
    out.profile = (await respond('quiero modificar mi perfil', ctx('client'))).actions[0].href
    out.providerJobs = (await respond('quiero ver trabajos disponibles', ctx('provider'))).actions[0].href
    out.admin = (await respond('ir al panel admin', ctx('admin'))).actions[0].href
    out.offHome = await respond('necesito un plomero', { ...ctx('guest'), search: undefined })
    out.unknown = (await respond('asdf qwer', ctx('guest'))).text
    out.searched = searched
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(result.guestGreeting, [true, ['Buscar profesional', 'Cómo funciona TUS', 'Iniciar sesión', 'Registrarme']])
  assert.deepEqual(result.clientGreeting, ['Hola Juan 👋 ¿Qué necesitás hacer?', ['Buscar profesional', 'Publicar solicitud', 'Mis solicitudes', 'Cómo funciona TUS']])
  assert.deepEqual(result.providerGreeting, ['Ver solicitudes', 'Editar mi perfil profesional', 'Buscar profesional'])
  assert.deepEqual(result.adminGreeting, ['Buscar profesional', 'Ir al panel admin', 'Cómo funciona TUS'])
  assert.equal(result.case1, 'Parece que necesitás plomería. Te muestro 3 profesionales en el mapa.')
  assert.equal(result.case2[0], 'Para publicar una solicitud necesitás iniciar sesión o crear una cuenta.')
  assert.deepEqual(result.case2[1], ['Iniciar sesión=/sign-in?returnTo=%2Fpublicar', 'Registrarme=/registro?returnTo=%2Fpublicar'])
  assert.deepEqual(result.case2Client, ['/publicar'])
  assert.match(result.case3[0], /dentro de tus solicitudes/u)
  assert.deepEqual(result.case3[1], ['/mis-solicitudes'])
  assert.match(result.case4[0], /Todavía no creaste tu perfil profesional/u)
  assert.match(result.case4[1], /está oculto/u)
  assert.match(result.case4[2], /todavía no está habilitado/u)
  assert.equal(result.case4[3], '/trabajadores/p1')
  assert.match(result.case5, /buscar un profesional directamente en el mapa/u)
  assert.match(result.mustPublish, /^No\. Podés buscar profesionales directamente en el mapa/u)
  assert.ok(result.ambiguous.includes('mecanica') && result.ambiguous.length > 1, 'ambiguous: asks, does not pick')
  assert.equal(result.none.text, 'Por ahora no encontré profesionales de aire acondicionado publicados. Podés ampliar la búsqueda o publicar una solicitud.')
  assert.equal(result.none.actions[0].label, 'Publicar solicitud')
  assert.match(result.edit, /no se puede editar/u, 'editing a request does not exist today: it says so')
  assert.equal(result.cancel, '/mis-solicitudes')
  assert.equal(result.profile, '/mi-perfil')
  assert.equal(result.providerJobs, '/prestador/solicitudes')
  assert.equal(result.admin, '/tus/admin')
  assert.equal(result.offHome.actions[0].href, '/?buscar=necesito%20un%20plomero', 'off the home, the search opens the home map')
  assert.match(result.unknown, /No estoy seguro/u)
  assert.ok(result.searched.every((value) => value), 'every provider list came from the shared search')
})

test('ASSISTANT UI: on the home and public pages, real session, no human support, no raw URLs in the text', () => {
  const service = read('apps/web/src/features/home/assistant-service.ts')
  const widget = read('apps/web/src/features/home/assistant-widget.tsx')
  assert.doesNotMatch(service + widget, /soporte|una persona|un agente|operador/iu)
  assert.doesNotMatch(service, /text: '[^']*https?:\/\//u, 'links are buttons, never raw URLs')
  assert.match(widget, /useAccountView\(\)/u, 'role from the API session')
  assert.match(widget, /placeholder="Escribí tu consulta\.\.\."/u)
  assert.match(read('apps/web/src/features/home/site-page.tsx'), /<AssistantWidget \/>/u)
  assert.match(read('apps/web/src/features/home/home-page.tsx'), /<AssistantWidget chooseCategory=\{runCategory\} search=\{runSearch\} \/>/u)
  assert.match(read('apps/web/src/features/home/home-page.tsx'), /get\('buscar'\)/u)
})
