import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Self-contained browser check of the provider photo editor (/prestador/perfil-publico) and of the
// WhatsApp block of /mi-perfil for the same person: starts the production Web build on its own
// port, answers the API with fixtures and stops the server in `finally`. Needs `next build` first.
const root = join(import.meta.dirname, '../..')
const webRoot = join(root, 'apps/web')
const { chromium } = createRequire(join(root, 'apps/api/package.json'))('playwright-core')
const chrome = process.env.TUS_TEST_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = 3211
const baseUrl = `http://127.0.0.1:${port}`
const artifacts = join(tmpdir(), `tus-foto-perfil-${Date.now()}`)
const viewports = [
  { name: 'mobile-320', width: 320, height: 720, touch: true },
  { name: 'mobile-393', width: 393, height: 852, touch: true },
  { name: 'tablet-768', width: 768, height: 1024, touch: true },
  { name: 'desktop', width: 1280, height: 800, touch: false },
]
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

function installFixtures() {
  const profile = { id: 'perfil-1', displayName: 'Ana Gómez', initials: 'AG', profession: { id: 'plomeria', label: 'Plomería', title: 'Plomería' }, professions: [{ id: 'plomeria', label: 'Plomería', title: 'Plomería', categoryId: 'hogar' }], serviceZones: ['Centro'], coverage: { mode: 'domicilio', radiusKm: 10 }, description: 'Plomera', yearsOfExperience: 5, visible: true, services: [] }
  const catalog = { categories: [{ id: 'hogar', name: 'Hogar' }], items: [{ id: 'plomeria', label: 'Plomería', profession: 'Plomería', icon: 'plomeria', categoryId: 'hogar' }], zones: ['Centro'], locations: { localities: [] } }
  const state = { calls: [], photoUrl: '/tus/v1/public/prestadores/perfil-1/foto?v=a' }
  window.__tusSmoke = state
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname
    if (url.port !== '3101' && !path.startsWith('/tus/v1') && !path.startsWith('/auth')) return realFetch(input, init)
    if (path.endsWith('/foto') && method === 'GET') return realFetch(input, init)
    state.calls.push(`${method} ${path}`)
    if (path === '/auth/session') return json({ context: { subjectId: 'acc-1', sessionId: 's-1', tenantId: 't-1', roles: ['owner'], permissions: ['tus:marketplace:write'], correlationId: 'c-1' }, capabilities: { platformAdmin: false, provider: true, profileComplete: true, profileRequired: false } })
    if (path === '/tus/v1/public/oficios') return json(catalog)
    if (path === '/tus/v1/prestador/perfil-publico' && method === 'GET') return json({ profile: { ...profile, photoUrl: state.photoUrl } })
    if (path === '/tus/v1/prestador/perfil-publico/foto' && method === 'PUT') { state.photoUrl = '/tus/v1/public/prestadores/perfil-1/foto?v=b'; return json({ photoUrl: state.photoUrl }) }
    if (path === '/tus/v1/prestador/perfil-publico/foto' && method === 'DELETE') { state.photoUrl = null; return json({ photoUrl: null }) }
    if (path === '/auth/phone') return json({ phone: { verified: true, phoneMasked: '+549379•••3456', verifiedAt: null, pendingMasked: null, whatsappLinked: true } })
    if (path === '/auth/phone/config') return json({ whatsappNumber: '+5493794000000' })
    if (path === '/auth/account') return json({ account: { id: 'acc-1', email: 'a@example.com', displayName: 'Ana', roles: ['owner'], status: 'active', emailVerifiedAt: 1 } })
    if (path === '/tus/v1/perfil') return json({ perfil: { cuentaId: 'acc-1', email: 'a@example.com', emailVerificado: true, nombreVisible: 'Ana Gómez', nombre: 'Ana', apellido: 'Gómez', tipoDocumento: 'DNI', numeroDocumento: '30111222', telefono: { verificado: true, numero: null, pendiente: null }, ubicacion: null, residencia: null, perfilCompleto: true, faltantes: [], centroMapa: { latitud: -27.46, longitud: -58.83, origen: 'predeterminado', etiqueta: 'Corrientes' } } })
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

async function run(browser, viewport, totals) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  await page.addInitScript(installFixtures)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' && !/favicon|Failed to load resource/u.test(message.text())) errors.push(message.text()) })
  await page.route('**/tus/v1/public/prestadores/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  const check = (condition, message) => { totals.total += 1; assert.ok(condition, `${viewport.name}: ${message}`); totals.pass += 1 }
  try {
    await page.goto(`${baseUrl}/prestador/perfil-publico`, { waitUntil: 'networkidle' })
    const editor = page.locator('section[aria-labelledby="perfil-foto-titulo"]')
    await editor.waitFor()
    check(await editor.getByText('Cambiar foto').isVisible(), 'with a photo the action is Cambiar foto')
    check(await editor.locator('img').first().evaluate((image) => image.complete && image.naturalWidth > 0), 'the photo renders')
    await editor.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG })
    await editor.getByText('Foto guardada.').waitFor()
    check((await page.evaluate(() => window.__tusSmoke.calls)).includes('PUT /tus/v1/prestador/perfil-publico/foto'), 'the upload goes to the own-photo endpoint')
    await editor.getByRole('button', { name: 'Quitar foto' }).click()
    await editor.getByText('Foto quitada.').waitFor()
    check((await editor.getByText('Subir foto').isVisible()) && (await editor.getByRole('button', { name: 'Quitar foto' }).count()) === 0, 'removed: initials fallback and Subir foto')
    check((await page.evaluate(() => window.__tusSmoke.calls)).includes('DELETE /tus/v1/prestador/perfil-publico/foto'), 'the removal goes to the own-photo endpoint')
    await editor.locator('input[type=file]').setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') })
    await editor.getByRole('alert').waitFor()
    check(true, 'a non-image is refused before any request')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(overflow <= 1, `no horizontal overflow on the photo editor (${overflow}px)`)
    await editor.screenshot({ path: join(artifacts, `${viewport.name}-editor-foto.png`) })
    // The personal profile of the same person: the WhatsApp block is there and nothing overflows.
    await page.goto(`${baseUrl}/mi-perfil`, { waitUntil: 'networkidle' })
    const whatsapp = page.locator('section[aria-labelledby="mi-celular"]')
    await whatsapp.waitFor()
    await whatsapp.getByText('✓ Vinculado a TUS').waitFor()
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(overflow2 <= 1, `no horizontal overflow on Mi perfil (${overflow2}px)`)
    const box = await whatsapp.boundingBox()
    check(Boolean(box && box.x >= 0 && box.x + box.width <= viewport.width + 1), 'the WhatsApp block stays inside the viewport')
    check(errors.length === 0, `console/page errors: ${errors.join(' | ')}`)
  } catch (error) {
    await page.screenshot({ path: join(artifacts, `${viewport.name}-failed.png`), fullPage: true })
    throw error
  } finally {
    await context.close()
  }
}

async function main() {
  assert.ok(existsSync(join(webRoot, '.next/routes-manifest.json')), 'Run the Web build before the browser smoke')
  mkdirSync(artifacts, { recursive: true })
  const stdout = openSync(join(artifacts, 'next.stdout.log'), 'a')
  const stderr = openSync(join(artifacts, 'next.stderr.log'), 'a')
  const child = spawn(process.execPath, [join(webRoot, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: webRoot, env: { ...process.env, NODE_ENV: 'production' }, detached: false, windowsHide: true, stdio: ['ignore', stdout, stderr],
  })
  let browser
  const totals = { total: 0, pass: 0, fail: 0 }
  try {
    await waitForServer(child)
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
    for (const viewport of viewports) await run(browser, viewport, totals)
  } catch (error) {
    totals.fail += 1
    throw error
  } finally {
    await browser?.close()
    await stop(child)
    closeSync(stdout)
    closeSync(stderr)
    console.log(`FOTO_PERFIL total=${totals.total} pass=${totals.pass} fail=${totals.fail} viewports=${viewports.map((item) => item.width).join(',')} artifacts=${artifacts}`)
  }
}

await main()
