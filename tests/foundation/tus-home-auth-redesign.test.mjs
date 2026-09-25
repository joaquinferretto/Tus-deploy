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

test('HOME public requests keep only approximate, non-identifying data and 0-2 images', () => {
  const result = runTypeScriptScenario(`
    const mod = await import('./apps/web/src/features/home/requests-source.ts')
    const { toPublicRequest, publicName, exampleRequestsSource, getRequestsSource } = mod.default ?? mod
    const exampleMod = await import('./apps/web/src/features/home/example-requests.ts')
    const { EXAMPLE_REQUESTS } = exampleMod.default ?? exampleMod
    const raw = {
      id: 'r1', category: 'plomeria', title: 'x'.repeat(200), requesterName: 'Laura Martínez',
      approximateLocation: { lat: -31.4167891, lng: -64.1833456, label: 'Nueva Córdoba' },
      images: ['/a.svg', '/b.svg', '/c.svg'], phone: '+5493510000000', address: 'Calle Falsa 123',
    }
    const all = await exampleRequestsSource.list({ query: '', category: '', zone: '' })
    console.log(JSON.stringify({
      pub: toPublicRequest(raw),
      single: publicName('Laura'),
      all,
      imageCounts: [...new Set(EXAMPLE_REQUESTS.map((request) => (request.images ?? []).length))].sort(),
      sameSource: getRequestsSource() === exampleRequestsSource,
      kind: exampleRequestsSource.kind,
    }))
  `)

  assert.deepEqual(result.pub.approximateLocation, { lat: -31.417, lng: -64.183, label: 'Nueva Córdoba' })
  assert.equal(result.pub.requesterName, 'Laura M.')
  assert.equal(result.single, 'Laura')
  assert.equal(result.pub.images.length, 2)
  assert.equal(result.pub.title.length, 90)
  assert.equal(result.pub.phone, undefined)
  assert.equal(result.pub.address, undefined)
  assert.doesNotMatch(JSON.stringify(result.all), /\+549|@|Calle /)
  assert.deepEqual(result.imageCounts, [0, 1, 2])
  for (const request of result.all) assert.ok(request.images.length <= 2)
  assert.ok(result.sameSource)
  assert.equal(result.kind, 'example')
})

test('HOME filters by everyday words, category and zone', () => {
  const result = runTypeScriptScenario(`
    const mod = await import('./apps/web/src/features/home/requests-source.ts')
    const { exampleRequestsSource } = mod.default ?? mod
    const list = (filters) => exampleRequestsSource.list({ query: '', category: '', zone: '', ...filters })
    console.log(JSON.stringify({
      canieria: (await list({ query: 'arreglo de cañería' })).map((r) => r.category),
      category: (await list({ category: 'electricidad' })).map((r) => r.category),
      none: await list({ query: 'zzzzqqq' }),
      zone: (await list({ zone: 'nueva cordoba' })).map((r) => r.approximateLocation.label),
    }))
  `)

  assert.ok(result.canieria.length > 0)
  assert.ok(result.canieria.every((category) => category === 'plomeria'))
  assert.ok(result.category.length > 0 && result.category.every((category) => category === 'electricidad'))
  assert.deepEqual(result.none, [])
  assert.ok(result.zone.every((label) => /nueva c[oó]rdoba/i.test(label)))
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
  assert.match(home, /La ayuda que necesitás, <span[^>]*>más cerca\.<\/span>/)
  assert.match(home, /Quiero ofrecer mis servicios/)
  assert.match(map, /Recentrar/)
  assert.match(map, /zona aproximada/)
  assert.doesNotMatch(map, /geolocation/)
  assert.match(page, /title: 'TUS \| Servicios cerca tuyo'/)
  assert.doesNotMatch(page, /redirect\(/)
})

test('HEADER shows the panel for signed-in users, a mobile menu and the logo with a text fallback', () => {
  const header = web('features/home/public-header.tsx')
  const logo = web('features/brand/tus-logo.tsx')

  for (const label of ['Buscar servicios', 'Cómo funciona', 'Para profesionales', 'Ayuda', 'Iniciar sesión', 'Registrarse', 'Ir a mi panel'])
    assert.match(header, new RegExp(label))
  assert.match(header, /aria-expanded=/)
  assert.match(logo, /\/brand\/tus-logo\.png/)
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
  assert.equal(result.prestador, '/tus/prestador')
  assert.equal(result.cliente, '/tus/mercado')
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
    .filter((file) => /\.(ts|tsx)$/.test(file))
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
