import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Home: one service search shared by the search bar and the floating assistant, real providers
// only; navigation by the REAL role returned by the API.
const root = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

test('HOME search: natural text -> trade (same API interpreter); map filters; never invents providers', () => {
  const result = runTypeScriptScenario(`
    const { searchServices, searchCategory, describeOutcome } = await import('./apps/web/src/features/home/service-search.ts')
    const { interpretarNecesidad } = await import('./apps/api/src/tus/directorio/modelo.ts')
    const catalog = [{ id: 'plomeria', label: 'Plomería' }, { id: 'electricidad', label: 'Electricidad' }, { id: 'aire', label: 'Aire acondicionado' }, { id: 'pintura', label: 'Pintura' }, { id: 'mecanica', label: 'Mecánica' }, { id: 'otros', label: 'Otros oficios' }]
    const ana = { id: 'ana', displayName: 'Ana P.', profession: { id: 'plomeria' } }
    const asked = []
    const deps = (providers) => ({ catalog, interpret: async (text) => interpretarNecesidad(text), providers: async (filters) => { asked.push(filters); return providers(filters) } })
    const real = deps((filters) => (filters.profession === 'plomeria' ? [ana] : []))
    const texts = ['quiero un plomero', 'se rompió una cañería', 'no prende el aire', 'se cortó la luz en una parte de mi casa', 'necesito pintar mi casa', 'cerrajero', 'plomero en Centro']
    const outcomes = []
    for (const text of texts) outcomes.push(await searchServices(text, real))
    const none = await searchServices('necesito un electricista', real)
    const choose = await searchServices('se rompió el motor', real)
    const chosen = await searchCategory('mecanica', null, real)
    const unknown = await searchServices('hola que tal', real)
    console.log(JSON.stringify({
      categories: outcomes.map((o) => o.kind === 'category' ? o.filters.profession : o.kind),
      zone: outcomes.at(-1).filters,
      plumberText: describeOutcome(outcomes[0]),
      noneText: describeOutcome(none),
      noneProviders: none.providers.length,
      choose: choose.kind === 'choose' ? choose.options.map((o) => o.id) : choose.kind,
      chooseText: describeOutcome(choose),
      chosen: chosen.filters,
      unknown: [unknown.kind, unknown.filters.query, unknown.providers.length],
      unknownText: describeOutcome(unknown),
      onlyDirectoryProviders: outcomes.flatMap((o) => o.providers ?? []).every((p) => p.id === 'ana'),
      empty: (await searchServices('   ', real)).kind,
    }))
  `)
  assert.deepEqual(result.categories, ['plomeria', 'plomeria', 'aire', 'electricidad', 'pintura', 'cerrajeria', 'plomeria'], 'cerrajero is its own trade now')
  assert.deepEqual(result.zone, { query: '', profession: 'plomeria', zone: 'Centro' }, '"plomero en Centro" combines trade and zone')
  assert.equal(result.plumberText, 'Parece que necesitás plomería. Te muestro 1 profesional disponible en el mapa.')
  assert.equal(result.noneProviders, 0)
  assert.equal(result.noneText, 'Por ahora no encontré profesionales de electricidad publicados. Podés ampliar la búsqueda o publicar una solicitud.')
  assert.ok(result.choose.length > 1 && result.choose.includes('mecanica'), 'ambiguous text asks to choose')
  assert.match(result.chooseText, /^¿Qué necesitás: /u)
  assert.deepEqual(result.chosen, { query: '', profession: 'mecanica', zone: '' })
  assert.deepEqual(result.unknown, ['text', 'hola que tal', 0])
  assert.match(result.unknownText, /^Por ahora no encontré/u)
  assert.equal(result.onlyDirectoryProviders, true, 'every provider shown comes from the directory call')
  assert.equal(result.empty, 'empty')
})

test('ROLES: "Ir a mi panel" follows the server-side role; admin gets "Panel admin"; Mi perfil is not the panel', () => {
  const result = runTypeScriptScenario(`
    process.env.NEXT_PUBLIC_API_URL = 'https://api.tusservicios.shop'
    const mod = await import('./apps/web/src/lib/tus-auth-client.ts')
    const { panelFor } = mod.default ?? mod
    const { accountLinks } = mod.default ?? mod
    const hrefs = (capabilities) => accountLinks(capabilities).map((link) => link.href)
    console.log(JSON.stringify({
      links: { platformOnly: hrefs({ platformAdmin: true, provider: false }), adminProvider: hrefs({ platformAdmin: true, provider: true }), provider: hrefs({ platformAdmin: false, provider: true }), client: hrefs({ platformAdmin: false, provider: false }) },
      admin: panelFor({ platformAdmin: true, provider: true }),
      provider: panelFor({ platformAdmin: false, provider: true }),
      client: panelFor({ platformAdmin: false, provider: false }),
      unknown: panelFor(null),
    }))
  `)
  assert.deepEqual(result.admin, { href: '/tus/admin', label: 'Panel admin' })
  assert.deepEqual(result.provider, { href: '/prestador/solicitudes', label: 'Panel prestador' })
  assert.deepEqual(result.client, { href: '/mis-solicitudes', label: 'Mis solicitudes' })
  assert.deepEqual(result.unknown, { href: '/mis-solicitudes', label: 'Mis solicitudes' })
  // Navigation follows real capabilities: a platform administration account has no works.
  assert.deepEqual(result.links.platformOnly, ['/tus/admin', '/mi-perfil'])
  assert.deepEqual(result.links.adminProvider, ['/tus/admin', '/mi-perfil', '/mis-turnos', '/trabajos', '/ayuda/prestadores'])
  assert.deepEqual(result.links.provider, ['/prestador/solicitudes', '/mi-perfil', '/mis-turnos', '/trabajos', '/ayuda/prestadores'], 'only a provider gets the provider manual')
  assert.deepEqual(result.links.client, ['/mis-solicitudes', '/mi-perfil', '/mis-turnos', '/trabajos'])
  const header = read('apps/web/src/features/home/public-header.tsx')
  assert.doesNotMatch(header, /href="\/mi-perfil">\s*(?:<span[^]*?<\/span>\s*)?Ir a mi panel/u, 'the panel is not /mi-perfil')
  // The header builds its account links from ONE capability-based list (accountLinks), whose first
  // entry is the panel of the server-side role.
  assert.match(header, /accountLinks\(auth\.capabilities\)/u)
  assert.doesNotMatch(header, /href=\{'\/trabajos' as Route\}/u, '"Mis trabajos" is not hard-coded for every account')
  assert.match(header, /useAccountView\(\)/u)
  // Role never decided from emails or local data.
  for (const file of ['apps/web/src/features/session/use-account-view.ts', 'apps/web/src/features/home/public-header.tsx', 'apps/web/src/features/profile/profile-page.tsx', 'apps/web/src/features/home/site-footer.tsx'])
    assert.doesNotMatch(read(file), /hotmail|@example|localStorage|TUS_PLATFORM_ADMIN_EMAILS/u, file)
  const profile = read('apps/web/src/features/profile/profile-page.tsx')
  assert.match(profile, /role\.capabilities\.platformAdmin \?/u, 'admin sees the admin panel, not client/provider tools')
  assert.match(profile, /role\.capabilities\.provider \?/u)
  assert.match(read('apps/web/src/components/admin/admin-layout.tsx'), /<AdminMfaGate returnTo=\{pathname\}>/u, 'the admin panel stays behind the MFA gate')
})

test('ROLES API: /auth/session returns server-resolved capabilities; admin candidate even before MFA, never for a client', () => {
  const result = runTypeScriptScenario(`
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { createInMemoryAuthService } = await import('./apps/api/src/auth-security/composition.ts')
    const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
    const { MfaAdminSessionResolver } = await import('./apps/api/src/auth-security/mfa/admin-gate.ts')
    const { createAuthRouter } = await import('./apps/api/src/auth-security/http/auth-router.ts')
    const auth = createInMemoryAuthService({ platformAdminEmails: ['admin@example.com'] })
    const password = 'una frase larga y segura 2026'
    for (const email of ['admin@example.com', 'cliente@example.com']) {
      const r = await auth.register({ email, password, displayName: 'X' })
      await auth.verifyEmail({ token: r.verificationToken })
    }
    const raw = new DurableIdentitySessionResolver(auth.store)
    const gate = new MfaAdminSessionResolver(raw, { isElevated: async () => false }, auth.store, () => ['admin@example.com'])
    const providers = new Set()
    const app = express()
    app.use(createAuthRouter({ service: auth.service, sessions: gate, describeCapabilities: async (token, cid, context) => {
      const rawContext = await raw.resolve(token, cid)
      return { platformAdmin: rawContext ? await gate.isAdminCandidate(rawContext) : false, provider: providers.has(context.tenantId) }
    } }))
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const call = async (email) => {
      const signIn = await auth.signIn({ email, password })
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/auth/session', { headers: { authorization: 'Bearer ' + signIn.session.accessToken, 'x-correlation-id': 'c' } })
      return { body: await response.json(), tenantId: signIn.session.tenantId }
    }
    try {
      const admin = await call('admin@example.com')
      const client = await call('cliente@example.com')
      providers.add(client.tenantId)
      const provider = await call('cliente@example.com')
      console.log(JSON.stringify({ admin: admin.body.capabilities, adminPerms: admin.body.context.permissions.includes('tus:identity:admin'), client: client.body.capabilities, provider: provider.body.capabilities }))
    } finally { server.close() }
  `)
  assert.deepEqual(result.admin, { platformAdmin: true, provider: false })
  assert.equal(result.adminPerms, false, 'the capability shows the panel, but admin permissions still need MFA')
  assert.deepEqual(result.client, { platformAdmin: false, provider: false })
  assert.deepEqual(result.provider, { platformAdmin: false, provider: true })
  assert.match(read('apps/api/src/server.ts'), /describeCapabilities: async \(accessToken, correlationId, context\) =>/u)
})

test('HOME layout: map first, one search field, floating assistant, orange markers, shared footer', () => {
  const home = read('apps/web/src/features/home/home-page.tsx')
  assert.match(home, /<HomeMap/u)
  // The floating assistant is the shared orchestrator of the API (it no longer runs the Web search).
  assert.match(home, /<AssistantWidget \/>/u)
  assert.match(home, /searchServices\(text, searchDeps\)/u, 'the search bar interprets natural text with the API interpreter')
  assert.equal((home.match(/searchServices\(/gu) ?? []).length, 1)
  const hero = read('apps/web/src/features/home/hero-search.tsx')
  assert.doesNotMatch(hero, /<select|busqueda-ubicacion|busqueda-categoria/u, 'a single natural-language field')
  assert.match(read('apps/web/src/features/home/provider-map.tsx'), /const MARKER_COLOR = '#ff5a00'/u)
  const widget = read('apps/web/src/features/home/assistant-widget.tsx')
  assert.match(widget, /aria-label="Abrir el asistente de TUS"/u)
  assert.doesNotMatch(widget, /soporte|una persona|operador/iu, 'no human handoff that does not exist')
  const footer = read('apps/web/src/features/home/site-footer.tsx')
  for (const href of ['/trabajadores', '/publicar', '/#como-funciona', '/#profesionales', '/ayuda']) assert.ok(footer.includes(`href="${href}"`), href)
  assert.doesNotMatch(footer, /terminos|privacidad/iu, 'no links to pages that do not exist')
  // The shared footer receives the page logo since the centred branding was unified (c3407dc).
  assert.match(read('apps/web/src/features/home/site-page.tsx'), /<SiteFooter logo=\{logo\} \/>/u)
  assert.match(read('apps/web/src/features/home/home.module.css'), /flex-direction: column;[\s\S]*\.main \{\s*flex: 1 0 auto;/u)
})
