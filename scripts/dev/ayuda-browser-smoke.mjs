import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Self-contained browser check of the Help Center (/ayuda): starts the production Web build on its
// own port, answers the API with fixtures, visits the cover, the search and EVERY guide at six
// widths, drives the "Ayuda" menu with the keyboard and stops the server in `finally`. Needs
// `next build` first, with NEXT_PUBLIC_API_URL=http://localhost:3101 (the address the fixtures
// answer: without it the bundle has no API client and every visitor looks signed out). Never talks
// to a real API.
const root = join(import.meta.dirname, '../..')
const webRoot = join(root, 'apps/web')
const { chromium } = createRequire(join(root, 'apps/api/package.json'))('playwright-core')
const chrome = process.env.TUS_TEST_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = 3211
const baseUrl = `http://127.0.0.1:${port}`
const artifacts = join(tmpdir(), `tus-ayuda-${Date.now()}`)
const viewports = [
  { name: 'mobile-320', width: 320, height: 720, touch: true },
  { name: 'mobile-360', width: 360, height: 800, touch: true },
  { name: 'mobile-393', width: 393, height: 852, touch: true },
  { name: 'tablet-768', width: 768, height: 1024, touch: true },
  { name: 'desktop-1280', width: 1280, height: 800, touch: false },
  { name: 'desktop-1920', width: 1920, height: 1080, touch: false },
]

// The published guides: the documents of docs/conocimiento that declare a slug.
const slugs = readdirSync(join(root, 'docs/conocimiento'))
  .filter((name) => name.endsWith('.md'))
  .map((name) => /^slug:\s*(\S+)\s*$/mu.exec(readFileSync(join(root, 'docs/conocimiento', name), 'utf8'))?.[1])
  .filter(Boolean)
  .sort()

// Who is looking: a visitor, a client or a provider. The API is answered by these fixtures.
const SESSIONS = {
  visitante: null,
  cliente: { provider: false, phone: { verified: true, phoneMasked: '+549379•••3456', verifiedAt: '2026-10-01T10:00:00.000Z', pendingMasked: null, whatsappLinked: false } },
  prestador: { provider: true, phone: { verified: true, phoneMasked: '+549379•••3456', verifiedAt: '2026-10-01T10:00:00.000Z', pendingMasked: null, whatsappLinked: true } },
}

function installApiFixtures({ session }) {
  const state = { calls: [] }
  window.__tusSmoke = state
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname
    if (url.port !== '3101' && !path.startsWith('/tus/v1') && !path.startsWith('/auth')) return realFetch(input, init)
    state.calls.push(`${method} ${path}`)
    if (!session) return json({ error: 'unauthenticated' }, 401)
    if (path === '/auth/session') return json({ context: { subjectId: 'acc-1', sessionId: 's-1', tenantId: 't-1', roles: ['owner'], permissions: [], correlationId: 'c-1' }, capabilities: { platformAdmin: false, provider: session.provider, profileComplete: true, profileRequired: false } })
    if (path === '/auth/account') return json({ account: { id: 'acc-1', email: 'persona@example.com', displayName: 'Persona Prueba', roles: ['owner'], status: 'active', emailVerifiedAt: 1 } })
    if (path === '/auth/phone' && method === 'GET') return json({ phone: session.phone })
    return json({ items: [] })
  }
}

async function waitForServer(child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next exited with code ${child.exitCode}`)
    try {
      const response = await fetch(baseUrl)
      await response.body?.cancel()
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Next did not become ready')
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 10_000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

const checker = (totals, label) => (condition, message) => {
  totals.total += 1
  assert.ok(condition, `${label}: ${message}`)
  totals.pass += 1
}

// What the server sends to anybody, before any script runs: status codes, headers, the public
// HTML of every guide and every internal link of every guide.
async function http(totals) {
  const check = checker(totals, 'http')
  const get = async (path) => {
    const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' })
    return { status: response.status, headers: response.headers, html: await response.text() }
  }
  const portada = await get('/ayuda')
  check(portada.status === 200, `/ayuda answers 200 (${portada.status})`)
  const csp = portada.headers.get('content-security-policy') ?? ''
  check(/script-src[^;]*'nonce-/u.test(csp), 'the help pages carry the nonce CSP of the site')
  check(!/unsafe-eval/u.test(csp), 'no unsafe-eval')
  check(!/script-src[^;]*'unsafe-inline'/u.test(csp.replace(/'nonce-[^']+'[^;]*/u, '')) || /'nonce-/u.test(csp), 'inline scripts need the nonce')
  const enlaces = new Set()
  for (const slug of [...slugs, 'prestadores']) {
    const pagina = await get(`/ayuda/${slug}`)
    check(pagina.status === 200, `/ayuda/${slug} answers 200 (${pagina.status})`)
    check(/<h1[^>]*>[^<]+<\/h1>/u.test(pagina.html), `/ayuda/${slug} has a title`)
    // Public HTML: nothing about any account. The personal status is added later, in the browser.
    check(!/Tu teléfono ya está verificado|Tu WhatsApp ya está vinculado|todavía no está verificado|persona@example\.com|\+549379/u.test(pagina.html), `/ayuda/${slug}: no private state in the HTML`)
    check(!/set-cookie/iu.test([...pagina.headers.keys()].join(' ')), `/ayuda/${slug} sets no cookie`)
    const cuerpo = /<article[\s\S]*<\/article>/u.exec(pagina.html)?.[0] ?? ''
    check(cuerpo.length > 200, `/ayuda/${slug} renders its article`)
    check(!/<script|<iframe|<style|\son[a-z]+=|javascript:/iu.test(cuerpo), `/ayuda/${slug}: the article has no script, frame, handler or javascript: URL`)
    for (const match of cuerpo.matchAll(/href="(\/[^"#]*)(?:#[^"]*)?"/gu)) enlaces.add(match[1].replaceAll('&amp;', '&'))
  }
  for (const enlace of [...enlaces].sort()) {
    const destino = await get(enlace)
    // A private screen answers 200 (it asks for the session in the browser) or redirects to sign in.
    check([200, 307, 308].includes(destino.status), `link ${enlace} exists (${destino.status})`)
  }
  for (const path of ['/ayuda/no-existe', '/ayuda/prestadores/no-existe', '/ayuda/..%2F..%2F.env', '/ayuda/%2e%2e/%2e%2e/package.json', '/ayuda/operacion-soporte-interno', '/ayuda/cobros-prestador', '/ayuda/pagos/extra']) {
    const pagina = await get(path)
    // An encoded ".." is resolved by the client before the request: it never reaches the Help
    // Center (it is another path of the site, which answers whatever that path answers, never a file).
    check(path.includes('%2e') ? pagina.status !== 200 : pagina.status === 404, `${path} answers 404 (${pagina.status})`)
    check(!/DATABASE_URL|"dependencies"|internal-admin/u.test(pagina.html), `${path} leaks nothing`)
  }
  const hostil = await get(`/ayuda?q=${encodeURIComponent('<script>alert(1)</script>"><img src=x onerror=alert(2)>')}`)
  check(hostil.status === 200, 'a hostile query is just a query')
  check(!hostil.html.includes('<script>alert(1)</script>') && !/<img src=x/u.test(hostil.html), 'the query is escaped in the HTML')
  check(/name="robots" content="noindex/u.test(hostil.html), 'a results page is not indexed')
  check(!/name="robots" content="noindex/u.test(portada.html), 'the cover is indexable')
  return enlaces.size
}

async function run(browser, viewport, sessionName, totals) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch && viewport.width < 768 })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  await page.addInitScript(installApiFixtures, { session: SESSIONS[sessionName] })
  const errors = []
  const dialogs = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' && !/favicon|Failed to load resource/u.test(message.text())) errors.push(message.text()) })
  page.on('dialog', (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss() })
  const label = `${viewport.name}/${sessionName}`
  const check = checker(totals, label)
  const sinDesborde = async (donde) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(overflow <= 1, `${donde}: no horizontal overflow (${overflow}px)`)
  }
  try {
    // Cover.
    await page.goto(`${baseUrl}/ayuda`, { waitUntil: 'networkidle' })
    check(await page.getByRole('heading', { level: 1, name: '¿Cómo podemos ayudarte?' }).isVisible(), 'cover title')
    check(await page.getByRole('searchbox', { name: 'Buscar en Ayuda' }).isVisible(), 'search field')
    check(await page.getByRole('link', { name: /Manual del prestador/u }).first().isVisible(), 'the provider manual is reachable from the cover')
    await sinDesborde('/ayuda')
    await page.screenshot({ path: join(artifacts, `${viewport.name}-${sessionName}-portada.png`), fullPage: true })

    // Search: typed and submitted like a person would.
    await page.getByRole('searchbox', { name: 'Buscar en Ayuda' }).fill('verificar celular')
    await page.getByRole('button', { name: 'Buscar' }).click()
    await page.waitForURL(/\/ayuda\?q=verificar/u)
    const primero = page.locator('section[aria-labelledby="ayuda-resultados"] a').first()
    check((await primero.getAttribute('href')) === '/ayuda/verificar-celular', 'the search finds the guide')
    await sinDesborde('/ayuda?q=')
    await page.goto(`${baseUrl}/ayuda?q=${encodeURIComponent('<script>alert(1)</script><img src=x onerror=alert(2)>')}`, { waitUntil: 'networkidle' })
    check((await page.locator('#ayuda-resultados').innerText()).includes('<script>alert(1)</script>'), 'a hostile query is shown as text')
    check(await page.locator('#ayuda-resultados img, #ayuda-resultados script').count() === 0, 'and creates no element')
    await sinDesborde('/ayuda?q=<script>')

    // Every guide.
    for (const slug of [...slugs, 'prestadores']) {
      await page.goto(`${baseUrl}/ayuda/${slug}`, { waitUntil: 'domcontentloaded' })
      check(await page.locator('article h1').isVisible(), `/ayuda/${slug}: title`)
      check(await page.getByRole('navigation', { name: 'Ruta de navegación' }).isVisible(), `/ayuda/${slug}: breadcrumbs`)
      await sinDesborde(`/ayuda/${slug}`)
      const ancho = await page.locator('article').evaluate((element) => element.getBoundingClientRect().right)
      check(ancho <= viewport.width + 1, `/ayuda/${slug}: the article fits the viewport`)
    }

    // The personal status of the two account guides: only for whoever is signed in.
    await page.goto(`${baseUrl}/ayuda/vincular-whatsapp`, { waitUntil: 'networkidle' })
    const estado = page.locator('article p[role="status"]')
    if (sessionName === 'visitante') {
      check(await estado.count() === 0, 'a visitor sees no account status')
      check(!(await page.evaluate(() => window.__tusSmoke.calls)).includes('GET /auth/phone'), 'and the phone API is not even called')
    } else {
      await estado.waitFor()
      const texto = await estado.innerText()
      check(sessionName === 'prestador' ? texto.includes('Tu WhatsApp ya está vinculado') : texto.includes('tu WhatsApp todavía no está vinculado'), `the status is the one the API reports (${texto})`)
      check(!texto.includes('+549379') && !texto.includes('persona@example.com'), 'never the number or the email')
      if (sessionName === 'cliente') check((await estado.getByRole('link').getAttribute('href')) === '/mi-perfil?accion=vincular-whatsapp', 'the action goes to the real screen')
    }
    await page.screenshot({ path: join(artifacts, `${viewport.name}-${sessionName}-guia.png`), fullPage: true })
    // An anchor of the table of contents exists in the page.
    await page.goto(`${baseUrl}/ayuda/pagos`, { waitUntil: 'networkidle' })
    const indice = page.getByRole('navigation', { name: 'En esta página' }).getByRole('link')
    check(await indice.count() >= 3, 'table of contents')
    for (const ancla of await indice.all()) check(await page.locator(`[id="${(await ancla.getAttribute('href')).slice(1)}"]`).count() === 1, `anchor ${await ancla.getAttribute('href')} exists`)

    // Navigation: the "Ayuda" menu (desktop) or the plain links of the mobile menu.
    await page.goto(`${baseUrl}/ayuda`, { waitUntil: 'networkidle' })
    const boton = page.getByRole('button', { name: 'Ayuda', exact: true })
    const escritorio = await boton.isVisible()
    check(escritorio === (viewport.width >= 1280), escritorio ? 'desktop navigation' : 'mobile menu')
    const solicitudes = sessionName === 'visitante' ? '/publicar' : sessionName === 'prestador' ? '/prestador/solicitudes' : '/mis-solicitudes'
    if (escritorio) {
      check((await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Solicitudes' }).getAttribute('href')) === solicitudes, `"Solicitudes" goes to ${solicitudes}`)
      check((await boton.getAttribute('aria-expanded')) === 'false', 'the menu starts closed')
      await boton.focus()
      await page.keyboard.press('Enter')
      check((await boton.getAttribute('aria-expanded')) === 'true', 'Enter opens it')
      const entradas = await page.locator('#menu-ayuda a').evaluateAll((items) => items.map((item) => [item.getAttribute('href'), item.textContent]))
      check(entradas[0][0] === '/ayuda' && entradas.at(-1)[0] === '/asistente', 'Help Center first, the assistant last')
      check(entradas.some((entrada) => entrada[0] === '/ayuda/prestadores') === (sessionName === 'prestador'), 'the provider manual only for a provider')
      check(!entradas.some((entrada) => /admin|\/tus\//u.test(entrada[0])), 'no administration entry')
      await sinDesborde('menu open')
      const caja = await page.locator('#menu-ayuda').boundingBox()
      check(Boolean(caja && caja.x >= 0 && caja.x + caja.width <= viewport.width), 'the menu is inside the viewport')
      await page.screenshot({ path: join(artifacts, `${viewport.name}-${sessionName}-menu.png`) })
      await page.keyboard.press('Tab')
      check(await page.evaluate(() => document.activeElement?.closest('#menu-ayuda') !== null), 'Tab moves into the menu')
      await page.keyboard.press('Escape')
      check((await boton.getAttribute('aria-expanded')) === 'false', 'Escape closes it')
      check(await page.evaluate(() => document.activeElement?.getAttribute('aria-controls') === 'menu-ayuda'), 'and the focus goes back to the button')
      await boton.click()
      await page.locator('article, main').first().click({ position: { x: 5, y: 5 }, force: true })
      check((await boton.getAttribute('aria-expanded')) === 'false', 'a click outside closes it')
      await boton.click()
      await page.locator('#menu-ayuda a[href="/ayuda/pagos"]').click()
      await page.waitForURL(/\/ayuda\/pagos$/u)
      check(await page.locator('article h1').isVisible(), 'an entry of the menu opens its guide')
    } else {
      await page.getByRole('button', { name: 'Menú' }).click()
      const menu = page.locator('#menu-movil')
      check((await menu.getByRole('link', { name: 'Solicitudes', exact: true }).getAttribute('href')) === solicitudes, `"Solicitudes" goes to ${solicitudes}`)
      check((await menu.getByRole('link', { name: 'Ayuda', exact: true }).getAttribute('href')) === '/ayuda', 'Ayuda is a plain link')
      check((await menu.getByRole('link', { name: 'Asistente', exact: true }).getAttribute('href')) === '/asistente', 'the assistant is a plain link')
      check((await menu.getByRole('link', { name: 'Manual del prestador' }).count() === 1) === (sessionName === 'prestador'), 'the provider manual only for a provider')
      check(await menu.locator('a[href*="/tus/admin"]').count() === 0, 'no administration entry')
      await sinDesborde('mobile menu open')
      for (const enlace of await menu.getByRole('link').all()) {
        const rect = await enlace.boundingBox()
        if (rect) check(rect.height >= 36, `"${(await enlace.innerText()).trim()}" is comfortable to tap (${Math.round(rect.height)}px)`)
      }
      await page.screenshot({ path: join(artifacts, `${viewport.name}-${sessionName}-menu.png`), fullPage: true })
    }
    check(dialogs.length === 0, `no alert/confirm/prompt ever ran: ${dialogs.join(' | ')}`)
    check(errors.length === 0, `console/page errors: ${errors.join(' | ')}`)
  } catch (error) {
    await page.screenshot({ path: join(artifacts, `${viewport.name}-${sessionName}-failed.png`), fullPage: true }).catch(() => undefined)
    console.error(`${label} url=${page.url()} api=${JSON.stringify(await page.evaluate(() => window.__tusSmoke?.calls).catch(() => null))} errors=${errors.join(' | ')}`)
    throw error
  } finally {
    await context.close()
  }
}

async function main() {
  assert.ok(existsSync(join(webRoot, '.next/routes-manifest.json')), 'Run the Web build before the browser smoke')
  assert.ok(slugs.length >= 15, 'the guides were found')
  mkdirSync(artifacts, { recursive: true })
  const stdout = openSync(join(artifacts, 'next.stdout.log'), 'a')
  const stderr = openSync(join(artifacts, 'next.stderr.log'), 'a')
  const child = spawn(process.execPath, [join(webRoot, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: webRoot, env: { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'http://localhost:3101' }, detached: false, windowsHide: true, stdio: ['ignore', stdout, stderr],
  })
  let browser
  let enlaces = 0
  const totals = { total: 0, pass: 0, fail: 0 }
  try {
    await waitForServer(child)
    enlaces = await http(totals)
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
    for (const viewport of viewports) for (const session of Object.keys(SESSIONS)) await run(browser, viewport, session, totals)
  } catch (error) {
    totals.fail += 1
    throw error
  } finally {
    await browser?.close()
    await stop(child)
    closeSync(stdout)
    closeSync(stderr)
    console.log(`AYUDA total=${totals.total} pass=${totals.pass} fail=${totals.fail} guias=${slugs.length} enlaces=${enlaces} viewports=${viewports.map((item) => item.width).join(',')} artifacts=${artifacts}`)
  }
}

await main()
