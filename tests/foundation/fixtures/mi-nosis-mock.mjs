// Local Mi Nosis mock (fictitious data, 127.0.0.1 only) for the Chromium adapter tests.
// `mode` switches: loginChallenge (third-party widget marker), layoutChanged, sessionsCleared.
export const MI_NOSIS_MOCK_SETUP = `
  const http = await import('node:http')
  const mock = { logins: 0, searches: [], sessions: new Set(), mode: { loginChallenge: false, layoutChanged: false }, checkboxSeen: [] }
  const people = {
    '30111222': [['30.111.222', 'PRUEBA DEMO, JUAN', '20-30111222-0', 'Comercio', '11-5555-0000']],
    '30111224': [['30.111.224', 'PRUEBA UNO, ANA', '27-30111224-1', '-', '-'], ['30.111.224', 'PRUEBA DOS, ANA', '23-30111224-6', '-', '-']],
  }
  const page = (body) => '<!doctype html><html><head><meta charset="utf-8"><title>Mi Nosis mock</title></head><body>' + body + '</body></html>'
  const cookieOf = (req) => /mn_session=([a-z0-9]+)/u.exec(req.headers.cookie ?? '')?.[1]
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const send = (status, html, headers = {}) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers }); res.end(html) }
    if (url.pathname === '/login' && req.method === 'GET') {
      const challenge = mock.mode.loginChallenge ? '<div class="g-recaptcha" data-sitekey="mock-site-key"></div>' : ''
      return send(200, page('<form method="post" action="/login"><input name="documento"><input type="password" name="clave"><label><input type="checkbox" name="recordar"> No soy un robot</label>' + challenge + '<button type="submit">Ingresar</button></form>'))
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        const form = new URLSearchParams(raw)
        mock.logins += 1
        mock.checkboxSeen.push(form.get('recordar') === 'on')
        if (form.get('documento') !== 'op-doc' || form.get('clave') !== 'op-pass' || form.get('recordar') !== 'on')
          return send(200, page('<p>Datos inválidos</p><form method="post" action="/login"><input name="documento"><input type="password" name="clave"><input type="checkbox" name="recordar"><button type="submit">Ingresar</button></form>'))
        const token = Math.random().toString(36).slice(2)
        mock.sessions.add(token)
        send(302, '', { location: '/localizador', 'set-cookie': 'mn_session=' + token + '; Path=/; HttpOnly' })
      })
      return
    }
    if (url.pathname === '/localizador') {
      if (!mock.sessions.has(cookieOf(req))) return send(302, '', { location: '/login' })
      const form = '<a href="/logout">Salir</a><form method="get" action="/localizador"><select name="tipo"><option value="nombre">Nombre</option><option value="doc">Documento</option></select><input name="busqueda"><button type="submit">Buscar</button></form>'
      const query = url.searchParams.get('busqueda')
      if (!query) return send(200, page(form))
      mock.searches.push({ tipo: url.searchParams.get('tipo'), query })
      const rows = people[query] ?? []
      if (rows.length === 0) return send(200, page(form + '<p>No se encontraron resultados</p>'))
      const headers = mock.mode.layoutChanged ? ['Col A', 'Col B', 'Col C'] : ['Documento', 'Denominación', 'CUIT/CUIL', 'Actividad', 'Teléfono']
      return send(200, page(form + '<table><thead><tr>' + headers.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>'))
    }
    send(404, page('not found'))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  const { NosisBrowserIdentityProvider } = await import('./apps/api/src/tus/identidad/nosis-browser.ts')
  const { SesionNavegadorCifrada, BackendSesionEnMemoria } = await import('./apps/api/src/tus/identidad/memoria.ts')
  const { BovedaCredencialesAesGcm: SessionVault } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
  const sessionBackend = new BackendSesionEnMemoria()
  const sessionStore = new SesionNavegadorCifrada(new SessionVault(Buffer.alloc(32, 5).toString('base64')), sessionBackend)
  const nosisConfig = (overrides = {}) => ({ loginUrl: base + '/login', localizadorUrl: base + '/localizador', documento: 'op-doc', clave: 'op-pass', headless: true, autoLogin: true, timeoutMs: 4000, ...overrides })
  const browserProviders = []
  const newBrowserProvider = (overrides) => { const p = new NosisBrowserIdentityProvider(nosisConfig(overrides), sessionStore); browserProviders.push(p); return p }
  const errorOf = async (operation) => { try { await operation(); return 'none' } catch (error) { return [error?.code ?? String(error), Boolean(error?.searchSubmitted)] } }
  const shutdown = async () => { for (const p of browserProviders) await p.cerrar(); server.close() }
`
