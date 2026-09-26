import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')
const web = (path) => readFileSync(join(root, 'apps/web/src', path), 'utf8')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], { cwd: root, encoding: 'utf8' })
  return JSON.parse(output.trim())
}

// Fake API response: what GET /tus/v1/public/solicitudes returns, plus hostile extras that the
// Web must drop (defence in depth).
const FAKE_API = `
  const now = Date.parse('2026-09-25T12:00:00.000Z')
  const dto = (id, category, title, label, extra = {}) => ({ id, category, title, description: null, requesterName: 'Laura M.', approximateLocation: { lat: -27.4692345, lng: -58.8306789, label }, budgetMax: null, urgency: 'urgente', createdAt: new Date(now - 20 * 60_000).toISOString(), images: [], ...extra })
  const items = [
    dto('a', 'plomeria', 'Pierde agua la canilla', 'Camba Cuá', { budgetMax: 25000, images: ['/tus/v1/public/solicitudes/a/imagenes/1', '/tus/v1/public/solicitudes/a/imagenes/2', '/uno.jpg'], phone: '+5493794000000', address: 'Calle Falsa 123' }),
    dto('b', 'electricidad', 'Salta la térmica con el horno', 'Centro', { urgency: 'hoy_manana', images: ['/tus/v1/public/solicitudes/b/imagenes/1'] }),
    dto('c', 'pintura', 'Pintar un dormitorio', 'Libertad', { images: ['https://evil.example/x.png'] }),
    dto('d', 'jardineria', 'Categoría desconocida', 'Centro'),
    { id: 'e', category: 'plomeria', title: 'Sin ubicación' },
  ]
  const requested = []
  const fakeFetch = async (url) => { requested.push(url); return { ok: true, status: 200, json: async () => ({ items }) } }
  process.env.NEXT_PUBLIC_API_URL = 'https://api.tusservicios.shop'
`

test('HOME reads requests from the API and keeps only approximate, non-identifying data and 0-2 images', () => {
  const result = runTypeScriptScenario(`${FAKE_API}
    const mod = await import('./apps/web/src/features/home/requests-source.ts')
    const { createApiRequestsSource, toPublicRequest, publicName, budgetLabel, timeAgoLabel } = mod.default ?? mod
    const source = createApiRequestsSource(fakeFetch)
    const all = await source.list({ category: '' })
    await source.list({ category: 'electricidad' })
    const failing = createApiRequestsSource(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    let failed = false
    try { await failing.list({ category: '' }) } catch { failed = true }
    const raw = { id: 'r1', category: 'plomeria', title: 'x'.repeat(200), requesterName: 'Laura Martínez', approximateLocation: { lat: -27.4692345, lng: -58.8306789, label: 'Camba Cuá' }, images: ['/a.svg', '/b.svg', '/c.svg'] }
    console.log(JSON.stringify({
      all, requested, failed,
      pub: toPublicRequest(raw), single: publicName('Laura'),
      labels: [budgetLabel(25000), budgetLabel(null), timeAgoLabel(new Date(now - 3 * 3600_000).toISOString(), now)],
    }))
  `)

  assert.deepEqual(result.requested, ['https://api.tusservicios.shop/tus/v1/public/solicitudes', 'https://api.tusservicios.shop/tus/v1/public/solicitudes?categoria=electricidad'])
  assert.deepEqual(result.all.map((request) => request.id), ['a', 'b', 'c'])
  assert.deepEqual(result.all.map((request) => request.images.length), [2, 1, 0])
  // Photos are served by the API: resolved against its origin, never the Web's.
  assert.equal(result.all[0].images[0], 'https://api.tusservicios.shop/tus/v1/public/solicitudes/a/imagenes/1')
  assert.deepEqual(result.all[0].approximateLocation, { lat: -27.469, lng: -58.831, label: 'Camba Cuá' })
  assert.equal(result.all[0].budgetLabel, 'Hasta $25.000')
  assert.equal(result.all[0].urgencyLabel, 'Urgente')
  assert.equal(result.all[1].urgencyLabel, 'Hoy o mañana')
  assert.doesNotMatch(JSON.stringify(result.all), /\+549|Calle |evil\.example/)
  assert.equal(result.failed, true)
  assert.equal(result.pub.requesterName, 'Laura M.')
  assert.equal(result.single, 'Laura')
  assert.equal(result.pub.title.length, 90)
  assert.deepEqual(result.labels, ['Hasta $25.000', 'A convenir', 'Hace 3 h'])
})

test('HOME filters by everyday words and zone on the same list', () => {
  const result = runTypeScriptScenario(`${FAKE_API}
    const mod = await import('./apps/web/src/features/home/requests-source.ts')
    const { createApiRequestsSource, matchesFilters } = mod.default ?? mod
    const all = await createApiRequestsSource(fakeFetch).list({ category: '' })
    const filter = (filters) => all.filter((request) => matchesFilters(request, { query: '', category: '', zone: '', ...filters }))
    console.log(JSON.stringify({
      canieria: filter({ query: 'arreglo de cañería' }).map((r) => r.category),
      category: filter({ category: 'electricidad' }).map((r) => r.category),
      none: filter({ query: 'zzzzqqq' }),
      zone: filter({ zone: 'camba cua' }).map((r) => r.approximateLocation.label),
    }))
  `)

  assert.deepEqual(result.canieria, ['plomeria'])
  assert.deepEqual(result.category, ['electricidad'])
  assert.deepEqual(result.none, [])
  assert.deepEqual(result.zone, ['Camba Cuá'])
})

test('PUBLISH client validates like the API and sends only the request fields with the session', () => {
  const result = runTypeScriptScenario(`
    process.env.NEXT_PUBLIC_API_URL = 'https://api.tusservicios.shop'
    const mod = await import('./apps/web/src/features/requests/requests-client.ts')
    const { createRequestsClient, validateNewRequest } = mod.default ?? mod
    const valid = { category: 'plomeria', title: 'Pierde agua la canilla', description: '', zone: 'Centro', budgetMax: 25000, urgency: 'urgente' }
    const calls = []
    const respond = (status, body) => async (url, init) => { calls.push({ url, method: init.method, headers: init.headers, body: init.body }); return { ok: status < 300, status, json: async () => body } }
    const session = { accessToken: 'tok', correlationId: 'corr' }
    const ok = await createRequestsClient(session, respond(201, { id: 's1' })).publish(valid)
    const invalid = await createRequestsClient(session, respond(422, { fields: ['zone'] })).publish(valid)
    const limited = await createRequestsClient(session, respond(429, {})).publish(valid)
    const down = await createRequestsClient(session, async () => { throw new Error('offline') }).publish(valid)
    console.log(JSON.stringify({
      ok, invalid, limited, down, call: calls[0],
      checks: [validateNewRequest(valid), validateNewRequest({ ...valid, title: 'Llamame 3794 123456' }), validateNewRequest({ ...valid, category: '', zone: '', urgency: '', budgetMax: 10.5 })],
    }))
  `)

  assert.equal(result.ok.ok, true)
  assert.deepEqual(result.invalid, { ok: false, kind: 'invalid', fields: ['zone'] })
  assert.equal(result.limited.kind, 'rate_limited')
  assert.equal(result.down.kind, 'unavailable')
  assert.equal(result.call.url, 'https://api.tusservicios.shop/tus/v1/solicitudes')
  assert.equal(result.call.method, 'POST')
  assert.equal(result.call.headers.Authorization, 'Bearer tok')
  assert.deepEqual(Object.keys(JSON.parse(result.call.body)).sort(), ['budgetMax', 'category', 'description', 'title', 'urgency', 'zone'])
  assert.deepEqual(result.checks[0], [])
  assert.deepEqual(result.checks[1], ['title'])
  assert.deepEqual(result.checks[2].sort(), ['budgetMax', 'category', 'urgency', 'zone'])
  const page = web('features/requests/publish-request.tsx')
  assert.match(page, /sign-in\?returnTo=/)
  assert.match(web('features/requests/request-form.tsx'), /No incluyas teléfono, email ni dirección/)
  assert.ok(existsSync(join(root, 'apps/web/src/app/publicar/page.tsx')))
})

test('HOME map is client-only, shares one query with the list and exposes the required states', () => {
  const home = web('features/home/home-page.tsx')
  const list = web('features/home/recent-requests.tsx')
  const map = web('features/home/request-map.tsx')
  const hook = web('features/home/use-requests.ts')
  const page = web('app/page.tsx')

  assert.match(home, /dynamic\(\(\) => import\('\.\/request-map'\)[\s\S]*ssr: false/)
  // One data source feeds map and list.
  assert.equal((home.match(/useRecentRequests\(/g) ?? []).length, 1)
  assert.match(home, /<RequestMap[^>]+requests=\{data\}/)
  assert.match(home, /<RecentRequests[\s\S]*requests=\{data\}/)
  assert.match(hook, /useDebouncedValue/)
  assert.match(list, /Todavía no hay solicitudes visibles en esta zona\./)
  assert.match(list, /Personas de tu zona buscando ayuda profesional\./)
  assert.match(list, /Ver todas las solicitudes/)
  assert.match(list, /href="\/publicar"/)
  assert.doesNotMatch(home + list, /[Ee]jemplo/)
  // Only the map and the filters are visible; the title is for screen readers.
  assert.match(home, /<h1 className=\{styles\.srOnly\}/)
  assert.doesNotMatch(home, /heroCard|Conectamos personas/)
  assert.match(home, /Quiero ofrecer mis servicios/)
  assert.match(map, /Recentrar/)
  assert.match(map, /zona aproximada/)
  assert.doesNotMatch(map, /geolocation/)
  assert.match(web('features/home/types.ts'), /-27\.4692[\s\S]*-58\.8306[\s\S]*Corrientes Capital/)
  assert.match(page, /title: 'TUS \| Servicios cerca tuyo'/)
  assert.doesNotMatch(page, /redirect\(/)
})

test('HEADER shows the panel for signed-in users, a mobile menu and the logo with a text fallback', () => {
  const header = web('features/home/public-header.tsx')
  const logo = web('features/brand/tus-logo.tsx')

  for (const label of ['Buscar servicios', 'Cómo funciona', 'Para profesionales', 'Ayuda', 'Iniciar sesión', 'Registrarse', 'Ir a mi panel'])
    assert.match(header, new RegExp(label))
  assert.match(header, /aria-expanded=/)
  assert.match(logo, /'logo-tus\.png', 'tus-logo\.png'/)
  assert.ok(existsSync(join(root, 'apps/web/public/brand/logo-tus.png')))
  assert.match(logo, /existsSync/)
  assert.match(logo, /from 'next\/image'/)
})

test('AUTH validation is in Spanish and never reveals whether an account exists', () => {
  const result = runTypeScriptScenario(`
    const mod = await import('./apps/web/src/features/auth/auth-validation.ts')
    const v = mod.default ?? mod
    console.log(JSON.stringify({
      login: v.validateLogin({ email: 'no-mail', password: '' }),
      okLogin: v.validateLogin({ email: 'a@b.co', password: 'x' }),
      register: v.validateRegister({ firstName: '', lastName: '', email: 'x', password: 'short', confirmation: 'other', acceptedTerms: false }),
      okRegister: v.validateRegister({ firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com', password: 'una-clave-larga', confirmation: 'una-clave-larga', acceptedTerms: true }),
      wrong: v.signInErrorMessage('unauthenticated'),
      notFound: v.signInErrorMessage('not_found'),
      unavailable: v.signInErrorMessage('unavailable'),
      googleUnknown: v.googleErrorMessage('anything'),
      googleNone: v.googleErrorMessage(null),
      prestador: v.destinationFor('prestador'),
      cliente: v.destinationFor('cliente'),
      code: v.readFragmentParam('#code=' + 'a'.repeat(43), 'code'),
      badCode: v.readFragmentParam('#code=<script>', 'code'),
    }))
  `)

  assert.deepEqual(Object.keys(result.login).sort(), ['email', 'password'])
  assert.deepEqual(result.okLogin, {})
  assert.deepEqual(Object.keys(result.register).sort(), ['confirmation', 'email', 'firstName', 'lastName', 'password', 'terms'])
  assert.match(result.register.password, /12 caracteres/)
  assert.deepEqual(result.okRegister, {})
  assert.equal(result.wrong, result.notFound)
  assert.match(result.wrong, /correo o la contraseña no son correctos/)
  assert.notEqual(result.unavailable, result.wrong)
  assert.match(result.googleUnknown, /Google/)
  assert.equal(result.googleNone, null)
  assert.equal(result.prestador, '/prestador/perfil-publico')
  assert.equal(result.cliente, '/mi-perfil')
  assert.equal(result.code, 'a'.repeat(43))
  assert.equal(result.badCode, null)
})

test('AUTH screens: login and register content, intent without client roles, no Google secret in Web', () => {
  const login = web('features/auth/login-form.tsx') + web('app/(auth)/sign-in/page.tsx')
  const register = web('features/auth/register-form.tsx') + web('app/(auth)/registro/page.tsx')
  const fields = web('features/auth/auth-fields.tsx')

  for (const text of ['Bienvenido de nuevo', '¿Olvidaste tu contraseña?', 'Continuar con Google']) assert.match(login + fields, new RegExp(text.replace('?', '\\?')))
  for (const text of ['Creá tu cuenta', 'Registrarme con Google', 'Quiero contratar servicios', 'Quiero ofrecer mis servicios'])
    assert.match(register + fields, new RegExp(text))
  assert.match(fields, /Mostrar contraseña|Ocultar contraseña/)
  // The intent only picks the next screen: nothing role-like is sent to the API.
  assert.doesNotMatch(register, /roles?\s*:/)
  assert.ok(existsSync(join(root, 'apps/web/src/app/(auth)/registro/page.tsx')))
  assert.ok(existsSync(join(root, 'apps/web/src/app/(auth)/ingresar/google/page.tsx')))

  const webSources = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'apps/web/src'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\.(ts|tsx)$/.test(file) && existsSync(join(root, file)))
  for (const file of webSources) {
    const source = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(source, /GOOGLE_CLIENT_SECRET|NEXT_PUBLIC_GOOGLE/, file)
    assert.doesNotMatch(source, /localStorage\.setItem\([^)]*token/i, file)
  }
})

test('AUTH client talks to the backend OIDC endpoints and stores nothing on failure', () => {
  const result = runTypeScriptScenario(`
    const mod = await import('./apps/web/src/lib/tus-auth-client.ts')
    const { createTusWebAuthClient } = mod.default ?? mod
    const requests = []
    let stored = null
    const storage = { read: () => stored, write: (value) => { stored = value }, clear: () => { stored = null } }
    const available = createTusWebAuthClient({ storage, transport: { request: async (input) => { requests.push(input.path); return { google: { available: true } } } } })
    const unavailable = createTusWebAuthClient({ storage, transport: { request: async () => { throw new Error('down') } } })
    const rejected = createTusWebAuthClient({ storage, transport: { request: async (input) => { requests.push(input.path); const error = new Error('bad'); error.status = 400; throw error } } })
    const exchange = await rejected.googleExchange('a'.repeat(43))
    process.env.NEXT_PUBLIC_API_URL = 'https://api.tusservicios.shop'
    console.log(JSON.stringify({
      available: await available.googleAvailable(),
      unavailable: await unavailable.googleAvailable(),
      exchangeStatus: exchange.status,
      stored,
      requests,
      start: mod.tusGoogleStartUrl ? mod.tusGoogleStartUrl() : mod.default.tusGoogleStartUrl(),
    }))
  `)

  assert.equal(result.available, true)
  assert.equal(result.unavailable, false)
  assert.notEqual(result.exchangeStatus, 'authenticated')
  assert.equal(result.stored, null)
  assert.ok(result.requests.includes('/auth/oauth/providers'))
  assert.ok(result.requests.includes('/auth/oauth/exchange'))
  assert.equal(result.start, 'https://api.tusservicios.shop/auth/oauth/google/start')
})
