import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Self-contained browser check of the WhatsApp block of /mi-perfil: starts the production Web
// build on its own port, answers the API with fixtures, drives the three states and stops the
// server in `finally`. Needs `next build` first. Never talks to a real API.
const root = join(import.meta.dirname, '../..')
const webRoot = join(root, 'apps/web')
const { chromium } = createRequire(join(root, 'apps/api/package.json'))('playwright-core')
const chrome = process.env.TUS_TEST_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = 3210
const baseUrl = `http://127.0.0.1:${port}`
const artifacts = join(tmpdir(), `tus-perfil-whatsapp-${Date.now()}`)
const viewports = [
  { name: 'mobile-320', width: 320, height: 720, touch: true },
  { name: 'mobile-360', width: 360, height: 800, touch: true },
  { name: 'mobile-393', width: 393, height: 852, touch: true },
  { name: 'desktop', width: 1280, height: 800, touch: false },
]

// The state of the phone the API would report in each scenario.
const SCENARIOS = {
  'no-verificado': { verified: false, phoneMasked: null, verifiedAt: null, pendingMasked: null, whatsappLinked: false },
  'verificado-sin-vincular': { verified: true, phoneMasked: '+549379•••3456', verifiedAt: '2026-10-01T10:00:00.000Z', pendingMasked: null, whatsappLinked: false },
  vinculado: { verified: true, phoneMasked: '+549379•••3456', verifiedAt: '2026-10-01T10:00:00.000Z', pendingMasked: null, whatsappLinked: true },
}

function installApiFixtures({ scenarios, scenario }) {
  const perfil = {
    cuentaId: 'acc-1', email: 'persona@example.com', emailVerificado: true, nombreVisible: 'Persona Prueba', nombre: 'Persona', apellido: 'Prueba',
    tipoDocumento: 'DNI', numeroDocumento: '30111222', telefono: { verificado: false, numero: null, pendiente: null }, ubicacion: null, residencia: null,
    perfilCompleto: true, faltantes: [], centroMapa: { latitud: -27.46, longitud: -58.83, origen: 'predeterminado', etiqueta: 'Corrientes' },
  }
  const state = { linked: scenarios[scenario].whatsappLinked, calls: [] }
  window.__tusSmoke = state
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname
    if (url.port !== '3101' && !path.startsWith('/tus/v1') && !path.startsWith('/auth')) return realFetch(input, init)
    state.calls.push(`${method} ${path}`)
    if (path === '/auth/session') return json({ context: { subjectId: 'acc-1', sessionId: 's-1', tenantId: 't-1', roles: ['owner'], permissions: [], correlationId: 'c-1' }, capabilities: { platformAdmin: false, provider: false, profileComplete: true, profileRequired: false } })
    if (path === '/auth/account') return json({ account: { id: 'acc-1', email: 'persona@example.com', displayName: 'Persona Prueba', roles: ['owner'], status: 'active', emailVerifiedAt: 1 } })
    if (path === '/tus/v1/perfil') return json({ perfil })
    if (path.startsWith('/tus/v1/geografia') || path.includes('/paises') || path.includes('/provincias') || path.includes('/localidades')) return json({ items: [] })
    if (path === '/auth/phone' && method === 'GET') return json({ phone: { ...scenarios[scenario], whatsappLinked: state.linked } })
    if (path === '/auth/phone/config') return json({ whatsappNumber: '+5493794000000' })
    if (path === '/auth/phone/whatsapp-link' && method === 'POST') {
      return json({ challenge: { challengeId: 'desafio-1', code: '7K4M9QXR', purpose: 'verificar_telefono', phoneMasked: '+549379•••3456', expiresAt: new Date(Date.now() + 600_000).toISOString(), whatsappUrl: 'https://wa.me/5493794000000?text=VERIFICAR%20TUS%207K4M9QXR', message: 'VERIFICAR TUS 7K4M9QXR' } }, 201)
    }
    if (path.startsWith('/auth/phone/challenges/')) return json({ status: state.linked ? 'verified' : 'pending', purpose: 'verificar_telefono', phoneMasked: '+549379•••3456' })
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

async function run(browser, viewport, scenario, totals) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  await page.addInitScript(installApiFixtures, { scenarios: SCENARIOS, scenario })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' && !/favicon|Failed to load resource/u.test(message.text())) errors.push(message.text()) })
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204 }))
  const label = `${viewport.name}/${scenario}`
  const check = (condition, message) => {
    totals.total += 1
    assert.ok(condition, `${label}: ${message}`)
    totals.pass += 1
  }
  try {
    await page.goto(`${baseUrl}/mi-perfil`, { waitUntil: 'networkidle' })
    const section = page.locator('section[aria-labelledby="mi-celular"]')
    await section.waitFor()
    await page.waitForFunction((expected) => {
      const text = document.querySelector('section[aria-labelledby="mi-celular"]')?.textContent ?? ''
      return expected.some((item) => text.includes(item))
    }, ['Verificar mi número', 'Vincular este WhatsApp', 'Vinculado a TUS'])
    const text = await section.innerText()
    if (scenario === 'no-verificado') {
      check(text.includes('Para usar TUS desde WhatsApp, primero verificá tu número de celular.'), 'unverified copy')
      check(await section.getByRole('button', { name: 'Verificar mi número' }).isVisible(), 'primary action: Verificar mi número')
      check(text.includes('Te vamos a abrir WhatsApp para confirmar que este número es tuyo.'), 'short hint')
      check(!text.includes('Vincular este WhatsApp'), 'no link action before the number is verified')
    } else if (scenario === 'verificado-sin-vincular') {
      check(await section.getByRole('heading', { name: 'Vincular WhatsApp' }).isVisible(), 'heading Vincular WhatsApp')
      check(text.includes('✓ Número verificado') && text.includes('+549379•••3456'), 'masked verified number badge')
      check(text.includes('falta vincular este WhatsApp con tu cuenta'), 'explains the missing link')
      check(await section.getByRole('button', { name: 'Vincular este WhatsApp' }).isVisible(), 'primary action: Vincular este WhatsApp')
      check(text.includes('Al tocar el botón vamos a abrir WhatsApp con un mensaje de verificación listo para enviar.'), 'secondary text')
      check(await section.locator('input').count() === 0, 'no "Nuevo número" form while linking')
      check(!text.includes('Nuevo número') && !text.includes('Verificar nuevo número'), 'no change-number wording as protagonist')
      const color = await section.getByRole('button', { name: 'Vincular este WhatsApp' }).evaluate((element) => getComputedStyle(element).backgroundColor)
      check(/^rgb\((2[0-5]\d|1[89]\d), (\d{2,3}), (\d{1,3})\)$/u.test(color), `TUS orange primary button (${color})`)
      await section.screenshot({ path: join(artifacts, `${viewport.name}-${scenario}-inicial.png`) })
      const popup = page.waitForEvent('popup')
      await section.getByRole('button', { name: 'Vincular este WhatsApp' }).click()
      const opened = await popup
      check(opened.url().startsWith('https://wa.me/5493794000000?text=VERIFICAR%20TUS%20') || (await page.evaluate(() => window.__tusSmoke.calls)).includes('POST /auth/phone/whatsapp-link'), 'creates the challenge and opens the official WhatsApp with the message written')
      await opened.close().catch(() => undefined)
      await section.getByText('VERIFICAR TUS 7K4M9QXR').waitFor()
      // The message arrives: the page notices on its own.
      await page.evaluate(() => { window.__tusSmoke.linked = true })
      await section.getByText('Este WhatsApp está listo para usar TUS.').waitFor({ timeout: 8_000 })
    } else {
      check(text.includes('✓ Verificado') && text.includes('✓ Vinculado a TUS'), 'both badges')
      check(text.includes('Este WhatsApp está listo para usar TUS.'), 'ready copy')
      check(await section.getByText('Abrir TUS en WhatsApp').isVisible(), 'secondary: open TUS in WhatsApp')
      check(!text.includes('Vincular este WhatsApp'), 'the link step is not shown again')
      check(await section.locator('input').count() === 0, 'no number form')
      await section.getByRole('button', { name: 'Cambiar número de celular' }).click()
      check(await section.getByLabel('Nuevo número').isVisible(), 'changing the number is a separate step')
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(overflow <= 1, `no horizontal overflow (${overflow}px)`)
    const box = await section.boundingBox()
    check(Boolean(box && box.x >= 0 && box.x + box.width <= viewport.width + 1), 'section inside the viewport')
    for (const button of await section.getByRole('button').all()) {
      const rect = await button.boundingBox()
      if (rect) check(rect.height >= 40, `button "${(await button.innerText()).trim()}" is comfortable (${Math.round(rect.height)}px)`)
    }
    await section.screenshot({ path: join(artifacts, `${viewport.name}-${scenario}.png`) })
    check(errors.length === 0, `console/page errors: ${errors.join(' | ')}`)
  } catch (error) {
    await page.screenshot({ path: join(artifacts, `${viewport.name}-${scenario}-failed.png`), fullPage: true })
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
    for (const viewport of viewports) for (const scenario of Object.keys(SCENARIOS)) await run(browser, viewport, scenario, totals)
  } catch (error) {
    totals.fail += 1
    throw error
  } finally {
    await browser?.close()
    await stop(child)
    closeSync(stdout)
    closeSync(stderr)
    console.log(`PERFIL_WHATSAPP total=${totals.total} pass=${totals.pass} fail=${totals.fail} viewports=${viewports.map((item) => item.width).join(',')} artifacts=${artifacts}`)
  }
}

await main()
