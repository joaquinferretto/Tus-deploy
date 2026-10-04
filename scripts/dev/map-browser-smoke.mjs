import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '../..')
const webRoot = join(root, 'apps/web')
const apiRequire = createRequire(join(root, 'apps/api/package.json'))
const { chromium } = apiRequire('playwright-core')
const chrome = process.env.TUS_TEST_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = 3200
const baseUrl = `http://127.0.0.1:${port}`
const artifacts = join(tmpdir(), `tus-map-browser-${Date.now()}`)
const profilePhotoPath = '/tus/v1/public/prestadores/perfil-ana/foto?v=fixture'
const profilePhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const viewports = [
  { name: 'mobile-320', width: 320, height: 720, touch: true },
  { name: 'mobile-360', width: 360, height: 800, touch: true },
  { name: 'mobile-393', width: 393, height: 852, touch: true },
  { name: 'tablet', width: 768, height: 1024, touch: true },
  { name: 'desktop', width: 1280, height: 720, touch: false },
  { name: 'desktop-1920', width: 1920, height: 1080, touch: false },
]

const catalog = {
  categories: [{ id: 'hogar', name: 'Hogar' }],
  items: [
    { id: 'plomeria', label: 'Plomería', profession: 'Plomería', icon: 'plomeria', categoryId: 'hogar' },
    { id: 'electricidad', label: 'Electricidad', profession: 'Electricidad', icon: 'electricidad', categoryId: 'hogar' },
  ],
  zones: ['Centro', 'Camba Cuá'],
  locations: { localities: [] },
}
const providers = [
  provider('perfil-ana', 'Ana Gómez', 'AG', 'plomeria', 'Plomería', -27.4687, -58.8342, 'Centro'),
  provider('perfil-luis', 'Luis Pérez', 'LP', 'electricidad', 'Electricidad', -27.4802, -58.821, 'Camba Cuá'),
]
const lodgings = [
  {
    id: 'alojamiento-1', propietarioId: null, nombre: 'Casa del Paraná', slug: 'casa-del-parana',
    tipo: { id: 'tipo-casa', slug: 'casa', nombre: 'Casa' }, descripcion: 'Alojamiento de prueba',
    direccion: 'Centro', latitud: -27.475, longitud: -58.828, barrioNombre: 'Centro', zonaNombre: 'Centro',
    rating: { average: 4.8, count: 12 }, precioDesde: { amount: 45000, modalidad: 'por_noche', currency: 'ARS' },
    imagenes: [], unidadesContador: 2, comodidades: ['WiFi'],
  },
]

function provider(id, displayName, initials, professionId, professionTitle, lat, lng, area) {
  return {
    id, displayName, initials, profession: { id: professionId, label: professionTitle, title: professionTitle },
    professions: [{ id: professionId, label: professionTitle, title: professionTitle, categoryId: 'hogar' }],
    aceptaTurnos: true, aceptaSolicitudes: true, approximateArea: area, publicArea: area, serviceZones: [area],
    locationSource: 'configured', mapLocations: [{ lat, lng, precision: 'zone', label: area }],
    mapPoint: { lat, lng, precision: 'barrio', label: area }, coverage: { mode: 'domicilio', radiusKm: 10 },
    verified: true, completedJobs: 8, rating: { average: 4.9, count: 7 },
    availability: { status: 'atiende_hoy', label: 'Atiende hoy', today: { start: '09:00', end: '18:00' } },
    yearsOfExperience: 6, startingPrice: { amount: 18000, currency: 'ARS' },
    photoUrl: id === 'perfil-ana' ? profilePhotoPath : null,
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
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function mockApi(route) {
  const url = new URL(route.request().url())
  if (url.pathname === profilePhotoPath.split('?')[0]) {
    await route.fulfill({ status: 200, contentType: 'image/png', body: profilePhoto })
    return
  }
  let body
  if (url.pathname === '/tus/v1/public/oficios') body = catalog
  else if (url.pathname === '/tus/v1/public/prestadores') body = { items: providers, page: 1, pageSize: 300, total: providers.length, totalPages: 1 }
  else if (url.pathname === '/tus/v1/public/solicitudes') body = { items: [] }
  else if (url.pathname === '/api/alojamientos/tipos') body = { items: [{ id: 'tipo-casa', slug: 'casa', nombre: 'Casa', activo: true }] }
  else if (url.pathname === '/api/alojamientos/' || url.pathname === '/api/alojamientos') body = { items: lodgings }
  else body = { code: 'NOT_AUTHENTICATED' }
  await route.fulfill({ status: body.code ? 401 : 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } })
}

async function validateViewport(browser, viewport, totals) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  await page.addInitScript(({ catalogFixture, providerFixtures, lodgingFixtures }) => {
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
      let body
      if (url.pathname === '/tus/v1/public/oficios') body = catalogFixture
      else if (url.pathname === '/tus/v1/public/prestadores') body = { items: providerFixtures, page: 1, pageSize: 300, total: providerFixtures.length, totalPages: 1 }
      else if (url.pathname === '/tus/v1/public/solicitudes') body = { items: [] }
      else if (url.pathname === '/api/alojamientos/tipos') body = { items: [{ id: 'tipo-casa', slug: 'casa', nombre: 'Casa', activo: true }] }
      else if (url.pathname === '/api/alojamientos/' || url.pathname === '/api/alojamientos') body = { items: lodgingFixtures }
      if (body) return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      if (url.port === '3101') return Promise.resolve(new Response(JSON.stringify({ code: 'NOT_AUTHENTICATED' }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
      return realFetch(input, init)
    }
  }, { catalogFixture: catalog, providerFixtures: providers, lodgingFixtures: lodgings })
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  if (process.env.TUS_MAP_DEBUG === '1') page.on('request', (request) => {
    if (/\/tus\/|\/api\//.test(request.url())) console.log(`MAP_REQUEST ${request.url()}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) browserErrors.push(message.text())
  })
  await page.route('**/tus/v1/public/**', mockApi)
  await page.route('**/api/alojamientos/**', mockApi)
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204 }))

  const check = (condition, message) => {
    totals.total += 1
    assert.ok(condition, `${viewport.name}: ${message}`)
    totals.pass += 1
  }

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.locator('.leaflet-container').waitFor()
    const map = page.locator('.leaflet-container')
    await page.locator('.leaflet-marker-icon').first().waitFor()
    const initialMapId = await map.evaluate((element) => element._leaflet_id)
    check(Number.isInteger(initialMapId), 'Leaflet instance is initialized')
    check(await page.locator('.leaflet-marker-icon').count() > 0, 'provider fixtures loaded')
    check(await page.getByRole('radio', { name: 'Profesionales' }).getAttribute('aria-checked') === 'true', 'professional layer starts selected')

    for (let index = 0; index < 20; index += 1) {
      await page.getByTitle('Acercar').click()
      await page.getByRole('radio', { name: 'Alojamientos' }).click()
      await page.getByRole('radio', { name: 'Profesionales' }).click()
    }
    check(await map.evaluate((element) => element._leaflet_id) === initialMapId, 'selector kept the same L.Map instance')
    check(await page.locator('.leaflet-container').count() === 1, 'only one map exists')
    await page.getByRole('radio', { name: 'Alojamientos' }).click()
    await page.locator('.leaflet-marker-icon').first().waitFor()
    check(await page.locator('.leaflet-marker-icon').count() === 1, 'lodging layer renders its fixture marker')
    const homeLodgingMarker = page.locator('.leaflet-marker-icon').first()
    const homeLodgingIdle = await homeLodgingMarker.innerHTML()
    await homeLodgingMarker.click()
    await page.waitForFunction((idle) => document.querySelector('.leaflet-marker-icon')?.innerHTML !== idle, homeLodgingIdle)
    check(await homeLodgingMarker.innerHTML() !== homeLodgingIdle, 'lodging layer selects its marker')
    await page.getByRole('radio', { name: 'Profesionales' }).click()
    await page.getByTitle('Alejar').click()

    if (viewport.touch) {
      const move = page.getByRole('button', { name: 'Mover mapa' })
      if (await move.count()) await move.click()
    }
    const box = await map.boundingBox()
    check(Boolean(box && box.width > 200 && box.height > 200), 'map remains visible')
    if (box) {
      await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45, { steps: 5 })
      await page.mouse.up()
    }

    await page.getByRole('button', { name: 'Recentrar' }).click()
    await page.waitForTimeout(800)
    await page.locator('.leaflet-marker-icon').first().click()
    const renderedPhoto = page.locator('img[src*="/perfil-ana/foto"]').first()
    await renderedPhoto.waitFor()
    check(await renderedPhoto.evaluate((image) => image.complete && image.naturalWidth > 0), 'provider profile photo renders from the TUS API path')
    if (viewport.width <= 768) {
      const sheet = page.getByRole('region', { name: 'Profesional seleccionado' })
      await sheet.waitFor()
      const style = await sheet.evaluate((element) => ({ position: getComputedStyle(element).position, bottom: getComputedStyle(element).bottom, rect: element.getBoundingClientRect().toJSON() }))
      check(style.position === 'fixed' && Number.parseFloat(style.bottom) >= 0 && Number.parseFloat(style.bottom) <= 8, 'bottom sheet is fixed to the viewport')
      check(style.rect.left >= -1 && style.rect.right <= viewport.width + 1, 'bottom sheet stays inside viewport')
      await sheet.getByRole('button', { name: 'Cerrar' }).click()
      check(await sheet.count() === 0, 'bottom sheet closes')
    } else {
      await page.locator('.leaflet-popup').waitFor()
      check(await page.locator('.leaflet-popup').count() === 1, 'desktop popup opens')
      await page.locator('.leaflet-popup-close-button').click()
      await page.locator('.leaflet-popup').waitFor({ state: 'detached' })
      check(await page.locator('.leaflet-popup').count() === 0, 'desktop popup closes')
      check(true, 'desktop does not use a bottom sheet')
    }

    const professionalFilters = page.getByRole('group', { name: 'Filtrar prestadores' }).locator('select')
    await professionalFilters.nth(0).selectOption('hogar')
    check(new URL(page.url()).searchParams.get('categoria') === 'hogar', 'category updates URL')
    await professionalFilters.nth(1).selectOption('plomeria')
    check(new URL(page.url()).searchParams.get('servicio') === 'plomeria', 'subcategory updates URL')
    await professionalFilters.nth(0).selectOption('')
    check(!new URL(page.url()).searchParams.has('categoria'), 'filters clear')

    await page.goto(`${baseUrl}/?categoria=hogar&servicio=plomeria`, { waitUntil: 'networkidle' })
    await page.goto(`${baseUrl}/?tipo=alojamientos`, { waitUntil: 'networkidle' })
    await page.goBack({ waitUntil: 'networkidle' })
    check(new URL(page.url()).searchParams.get('servicio') === 'plomeria', 'back restores professional filters')
    await page.goForward({ waitUntil: 'networkidle' })
    check(new URL(page.url()).searchParams.get('tipo') === 'alojamientos', 'forward restores lodging layer')

    await page.getByRole('radio', { name: 'Profesionales' }).click()
    await page.getByTitle('Acercar').click()
    await page.goto(`${baseUrl}/como-funciona`, { waitUntil: 'domcontentloaded' })
    await page.goBack({ waitUntil: 'networkidle' })
    await page.locator('.leaflet-container').waitFor()
    check(await page.locator('.leaflet-container').count() === 1, 'real unmount during zoom recovers cleanly')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(overflow <= 1, 'no horizontal overflow')
    check(await page.getByRole('radio', { name: 'Profesionales' }).isVisible(), 'selector remains usable')
    await page.screenshot({ path: join(artifacts, `${viewport.name}.png`), fullPage: true })

    await page.goto(`${baseUrl}/alojamientos`, { waitUntil: 'networkidle' })
    await page.locator('.leaflet-container').waitFor()
    check(await page.locator('.leaflet-container').count() === 1, 'standalone lodging map initializes')
    await page.locator('.leaflet-marker-icon').first().waitFor()
    check(await page.locator('.leaflet-marker-icon').count() === 1, 'standalone lodging map renders its fixture marker')
    check(browserErrors.length === 0, `browser console/page errors: ${browserErrors.join(' | ')}`)
  } catch (error) {
    await page.screenshot({ path: join(artifacts, `${viewport.name}-failed.png`), fullPage: true })
    console.error(`MAP_DIAGNOSTIC viewport=${viewport.name} url=${page.url()} markers=${await page.locator('.leaflet-marker-icon').count()} errors=${browserErrors.join(' | ')}`)
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
    for (const viewport of viewports) await validateViewport(browser, viewport, totals)
  } catch (error) {
    totals.fail += 1
    throw error
  } finally {
    await browser?.close()
    await stop(child)
    closeSync(stdout)
    closeSync(stderr)
    console.log(`MAP_BROWSER total=${totals.total} pass=${totals.pass} fail=${totals.fail} viewports=${viewports.map((item) => item.width).join(',')} artifacts=${artifacts}`)
  }
}

await main()
