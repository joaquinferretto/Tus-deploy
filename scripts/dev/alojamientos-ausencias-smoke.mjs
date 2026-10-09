import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

// Browser smoke of ALOJAMIENTOS-GESTION-01 and AUSENCIAS-01 (docs/ALOJAMIENTOS_TUS.md,
// docs/AGENDA_PRESTADOR_TUS.md) against the REAL local API and the production Web build, on a
// disposable PostgreSQL 16 with every migration, on desktop and mobile:
// - an owner publishes its alojamiento (form, photo, edit, publish, blocked dates);
// - a guest searches, filters, opens the detail, picks dates, reserves, sees and cancels it;
// - a provider marks a whole day, some hours and a vacation as absences, the slots go, an absence
//   is removed and the slots come back.
// Every process is a child of this script and is stopped in `finally`; the cluster is removed.
// Needs PostgreSQL 16 binaries (TUS_PG_BIN) and `next build` with
// NEXT_PUBLIC_API_URL=http://localhost:3101. It creates its own database, never a shared one.
const root = join(import.meta.dirname, '../..')
const webRoot = join(root, 'apps/web')
const apiRoot = join(root, 'apps/api')
const { chromium } = createRequire(join(apiRoot, 'package.json'))('playwright-core')
const chrome = process.env.TUS_TEST_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PG_BIN = process.env.TUS_PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\16\\bin'
const exe = (name) => join(PG_BIN, process.platform === 'win32' ? `${name}.exe` : name)
const API_PORT = 3101
const WEB_PORT = 3217
const PG_PORT = String(57200 + Math.floor(Math.random() * 400))
const api = `http://localhost:${API_PORT}`
const web = `http://localhost:${WEB_PORT}`
const artifacts = join(tmpdir(), `tus-alojamientos-${Date.now()}`)
const CLAVE = 'una frase larga y segura 2026'
const CLIENTE = { email: 'cliente-smoke@example.com', password: CLAVE, displayName: 'Cliente Smoke' }
// The same TUS account owns an alojamiento and is a provider with an agenda.
const PRESTADOR = { email: 'prestador-smoke@example.com', password: CLAVE, displayName: 'Prestador Smoke' }
let oficioId = ''

// A real PNG (decodable by the browser), built here: one flat colour.
function png(ancho, alto) {
  const trozo = (tipo, datos) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos])
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length)
    const suma = Buffer.alloc(4); suma.writeUInt32BE(crc32(cuerpo) >>> 0)
    return Buffer.concat([largo, cuerpo, suma])
  }
  const cabecera = Buffer.alloc(13); cabecera.writeUInt32BE(ancho, 0); cabecera.writeUInt32BE(alto, 4); cabecera[8] = 8; cabecera[9] = 2
  const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(ancho * 3, 0xb4)])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo('IHDR', cabecera), trozo('IDAT', deflateSync(Buffer.concat(Array.from({ length: alto }, () => fila)))), trozo('IEND', Buffer.alloc(0))])
}

// Calendar dates in Argentina: n days from today, and the Monday of next week.
const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
const sumar = (fecha, dias) => new Date(Date.parse(`${fecha}T00:00:00.000Z`) + dias * 86_400_000).toISOString().slice(0, 10)
const dia = (n) => sumar(hoy, n)
const lunes = sumar(hoy, ((8 - new Date(`${hoy}T12:00:00.000Z`).getUTCDay()) % 7) + 7)

async function esperar(url, child, nombre, ms = 60_000) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (child.exitCode !== null) throw new Error(`${nombre} exited with code ${child.exitCode}`)
    try {
      const response = await fetch(url)
      await response.body?.cancel()
      if (response.status < 500) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`${nombre} did not become ready`)
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 10_000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

const totals = { total: 0, pass: 0 }
const check = (condition, message) => {
  totals.total += 1
  assert.ok(condition, message)
  totals.pass += 1
}

async function main() {
  assert.ok(existsSync(join(webRoot, '.next/routes-manifest.json')), 'Run the Web build first (NEXT_PUBLIC_API_URL=http://localhost:3101)')
  mkdirSync(artifacts, { recursive: true })
  const data = mkdtempSync(join(tmpdir(), 'tus-pg16-aloj-'))
  const raiz = mkdtempSync(join(tmpdir(), 'tus-raiz-aloj-'))
  const abrir = (nombre) => openSync(join(artifacts, nombre), 'a')
  const logs = { api: abrir('api.log'), web: abrir('web.log') }
  let pgIniciado = false
  let apiChild
  let webChild
  let browser
  const psql = (sql) => spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'tus_aloj', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })
  try {
    const init = spawnSync(exe('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { encoding: 'utf8' })
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`)
    const start = spawnSync(exe('pg_ctl'), ['-D', data, '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c fsync=off -c lc_messages=C`, '-l', join(data, 'server.log'), '-w', 'start'], { encoding: 'utf8', timeout: 120_000 })
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stdout}${start.stderr}`)
    pgIniciado = true
    const creada = spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE tus_aloj'], { encoding: 'utf8' })
    if (creada.status !== 0) throw new Error(`create database: ${creada.stderr}`)
    const databaseUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/tus_aloj`
    const migrate = spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl }, timeout: 600_000 })
    if (migrate.status !== 0) throw new Error(`migrate-deploy failed: ${(migrate.stdout + migrate.stderr).slice(-800)}`)

    const entorno = {
      ...process.env,
      NODE_ENV: 'development', FACTORY_PROFILE: 'local', NATIVE_PROFILE: '1',
      DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, API_PORT: String(API_PORT), PORT: String(API_PORT),
      CORS_ORIGINS: web, TUS_ROUTES_ENABLED: 'true', TUS_PROVIDER_ACTIONS_ENABLED: 'false',
      // Nothing external: no WhatsApp, no model, no payments.
      WHATSAPP_AI_ENABLED: 'false', GROQ_API_KEY: '', RAG_EMBEDDING_PROVIDER: 'none',
    }
    // The API reads DATABASE_URL from the .env of the root it finds from its working directory: it
    // runs from a scratch root whose .env is the disposable database.
    writeFileSync(join(raiz, '.env'), `DATABASE_URL="${databaseUrl}"\nDIRECT_URL="${databaseUrl}"\n`)
    copyFileSync(join(root, 'pnpm-workspace.yaml'), join(raiz, 'pnpm-workspace.yaml'))
    apiChild = spawn(process.execPath, [join(apiRoot, 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', join(apiRoot, 'tsconfig.json'), join(apiRoot, 'src/index.ts')], { cwd: raiz, env: entorno, detached: false, windowsHide: true, stdio: ['ignore', logs.api, logs.api] })
    await esperar(`${api}/health`, apiChild, 'API')
    webChild = spawn(process.execPath, [join(webRoot, 'node_modules/next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(WEB_PORT)], { cwd: webRoot, env: { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_API_URL: api }, detached: false, windowsHide: true, stdio: ['ignore', logs.web, logs.web] })
    await esperar(web, webChild, 'Web')

    // ---- a provider with a real agenda: registered through the API, verified and given a public
    // profile with one service directly in the disposable database.
    const registro = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'smoke-prestador' }, body: JSON.stringify(PRESTADOR) })
    check(registro.status === 201, `the provider account registers (${registro.status})`)
    const cuenta = psql(`UPDATE public."Account" a SET "emailVerifiedAt" = now() FROM public."User" u WHERE a."userId" = u."id" AND u."normalizedEmail" = '${PRESTADOR.email}' RETURNING a."tenantId"`)
    // psql on Windows ends its lines with CRLF: the id is the first line, without the carriage return.
    const tenantId = cuenta.stdout.split(/\r?\n/u)[0].trim()
    check(/\S/u.test(tenantId), `the API is using the disposable database (${cuenta.stderr.trim()})`)
    const siembra = spawnSync(process.execPath, [join(apiRoot, 'node_modules/tsx/dist/cli.mjs'), '-'], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
      input: `(async () => {
        const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
        const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(databaseUrl)} })
        try {
          const ahora = new Date(); const tenantId = ${JSON.stringify(tenantId)}
          const oficio = await prisma.oficioServicio.findFirst({ where: { activo: true }, orderBy: { orden: 'asc' } })
          await prisma.tusTenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, slug: tenantId, name: 'Prestador Smoke', status: 'active', createdAt: ahora, updatedAt: ahora } })
          await prisma.prestador.create({ data: { id: 'smoke-p', tenantId, prestadorId: 'smoke-prestador', cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
          await prisma.perfilPublicoPrestador.create({ data: { id: 'smoke-perfil', tenantId, prestadorId: 'smoke-prestador', nombrePublico: 'Prestador Smoke', oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 15000n }] } } })
          console.log('SEMBRADO ' + oficio.id)
        } finally { await prisma.$disconnect() }
      })()`,
    })
    oficioId = (siembra.stdout.match(/SEMBRADO (\S+)/u) ?? [])[1] ?? ''
    check(/SEMBRADO /u.test(siembra.stdout), `the provider gets a profile with one service (${(siembra.stderr || siembra.stdout).slice(-300)})`)

    const altaCliente = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'smoke-cliente' }, body: JSON.stringify(CLIENTE) })
    check(altaCliente.status === 201, `the client account registers (${altaCliente.status})`)
    psql(`UPDATE public."Account" a SET "emailVerifiedAt" = now() FROM public."User" u WHERE a."userId" = u."id" AND u."normalizedEmail" = '${CLIENTE.email}'`)
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
    for (const viewport of [{ name: 'desktop-1280', width: 1280, height: 900 }, { name: 'mobile-390', width: 390, height: 844 }]) await recorrer(browser, viewport)
  } finally {
    await browser?.close()
    await stop(webChild)
    await stop(apiChild)
    closeSync(logs.api)
    closeSync(logs.web)
    if (pgIniciado) spawnSync(exe('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf8', timeout: 60_000 })
    rmSync(data, { recursive: true, force: true })
    rmSync(raiz, { recursive: true, force: true })
    console.log(`ALOJAMIENTOS_AUSENCIAS_SMOKE total=${totals.total} pass=${totals.pass} api_pid=${apiChild?.pid ?? '-'} web_pid=${webChild?.pid ?? '-'} artifacts=${artifacts}`)
  }
}

async function recorrer(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const e = viewport.name
  const errores = []
  const http = []
  page.on('pageerror', (error) => errores.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/u.test(message.text())) errores.push(message.text()) })
  page.on('response', (response) => { if (response.url().startsWith(api)) http.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`) })
  const sinDesborde = async (donde) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${e}: ${donde} does not scroll sideways`)
  const llamar = (method, path, body) => page.evaluate(async ({ api, method, path, body }) => {
    const response = await fetch(api + path, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }, { api, method, path, body })
  const entrar = async (cuenta, quien) => check((await llamar('POST', '/auth/sign-in', { email: cuenta.email, password: cuenta.password })).status === 200, `${e}: ${quien} signs in`)
  const salir = async (quien) => check((await llamar('POST', '/auth/sign-out')).status < 300, `${e}: ${quien} signs out`)
  // A signed-in account completes its personal profile before using TUS (once per account).
  const completarPerfil = async (documento) => {
    if (!primeraVez) return
    const pais = (await llamar('GET', '/tus/v1/geografia/paises')).body.items[0]
    const provincia = (await llamar('GET', `/tus/v1/geografia/provincias?paisId=${encodeURIComponent(pais.id)}`)).body.items[0]
    const localidad = (await llamar('GET', `/tus/v1/geografia/localidades?provinciaId=${encodeURIComponent(provincia.id)}`)).body.items[0]
    const perfil = await llamar('PUT', '/tus/v1/perfil', { nombre: 'Persona', apellido: 'Smoke', tipoDocumento: 'DNI', numeroDocumento: documento, localidadId: localidad.id, calle: 'San Martín', numero: '1234', codigoPostal: '3400' })
    check(perfil.status === 200, `the personal profile is complete (${perfil.status})`)
  }
  const nombre = `Casa Smoke ${e}`
  const editado = `${nombre} editada`
  try {
    await page.goto(`${web}/ayuda`, { waitUntil: 'domcontentloaded' })

    // ---- 1. Without a session: the owner panel and "Mis reservas" ask to sign in.
    await page.goto(`${web}/propietario/alojamientos`, { waitUntil: 'networkidle' })
    await page.getByText('Iniciá sesión con tu cuenta de TUS para publicar y administrar alojamientos.').waitFor()
    await page.goto(`${web}/alojamientos/reservas`, { waitUntil: 'networkidle' })
    await page.getByText('Iniciá sesión para ver tus reservas.').waitFor()
    check(true, `${e}: without a session the owner panel and "Mis reservas" ask to sign in`)

    // ---- 2. The owner creates its alojamiento.
    await entrar(PRESTADOR, 'the owner')
    await completarPerfil('30111222')
    await page.goto(`${web}/propietario/alojamientos`, { waitUntil: 'networkidle' })
    await page.locator('[data-propietario="vacio"] button, [data-accion="nuevo"]').first().click()
    const form = page.locator('[data-alojamiento-form]')
    await form.waitFor()
    await form.locator('[data-campo="tipoId"]').selectOption({ index: 1 })
    await form.locator('[data-campo="nombre"]').fill(nombre)
    await form.locator('[data-campo="descripcion"]').fill('Casa luminosa con patio y parrilla.')
    await form.locator('[data-campo="barrioId"]').selectOption({ index: 1 })
    await form.locator('[data-campo="direccion"]').fill('Calle Smoke 123')
    await form.locator('[data-campo="capacidadPersonas"]').fill('4')
    await form.locator('[data-campo="comodidades"]').fill('Wifi, Parrilla')
    // An invalid price is explained next to its field and nothing is sent.
    await form.locator('[data-campo="precioNoche"]').fill('gratis')
    const antes = http.filter((linea) => linea.startsWith('POST ') && linea.includes('/alojamientos/mios')).length
    await form.locator('[data-accion="guardar"]').click()
    await form.locator('[data-error="precioNoche"]').waitFor()
    check(http.filter((linea) => linea.startsWith('POST ') && linea.includes('/alojamientos/mios')).length === antes, `${e}: an invalid price is not sent`)
    await sinDesborde('the form of a new alojamiento')
    await form.locator('[data-campo="precioNoche"]').fill('50000')
    await form.locator('[data-accion="guardar"]').click()
    await page.getByText('Alojamiento creado como borrador. Sumale fotos y publicalo cuando esté listo.').waitFor()
    check((await page.locator('[data-publicacion]').getAttribute('data-publicacion')) === 'borrador', `${e}: the new alojamiento is a draft`)
    const borrador = await llamar('GET', `/api/alojamientos/?q=${encodeURIComponent(nombre)}`)
    check(borrador.status === 200 && borrador.body.items.length === 0, `${e}: a draft is not in the public search`)

    // ---- 3. A photo.
    await page.locator('[data-seccion="fotos"]').waitFor()
    await page.locator('[data-foto="archivo"]').setInputFiles({ name: 'frente.png', mimeType: 'image/png', buffer: png(320, 240) })
    await page.getByText('Foto agregada.').waitFor()
    check((await page.locator('figure[data-foto]').count()) === 1, `${e}: the photo is in the gallery`)
    check(await page.locator('figure[data-foto] img').first().evaluate((img) => img.complete && img.naturalWidth === 320), `${e}: the photo is served by the API and decoded by the browser`)
    // A file that is not an image is refused by the API, whatever its name says.
    await page.locator('[data-foto="archivo"]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') })
    await page.locator('[data-propietario="error"]').waitFor()
    check((await page.locator('figure[data-foto]').count()) === 1, `${e}: a file that is not an image is refused`)

    // ---- 4. Edit and publish.
    await page.locator('[data-pestana="datos"]').click()
    await form.locator('[data-campo="nombre"]').fill(editado)
    await form.locator('[data-accion="guardar"]').click()
    await page.getByText('Cambios guardados.').waitFor()
    await page.locator('[data-accion="publicar"]').click()
    await page.getByText('Alojamiento publicado.').waitFor()
    check((await page.locator('[data-publicacion]').getAttribute('data-publicacion')) === 'publicado', `${e}: the alojamiento is published`)

    // ---- 5. Blocked dates.
    await page.locator('[data-pestana="disponibilidad"]').click()
    await page.locator('[data-bloqueo="desde"]').fill(dia(20))
    await page.locator('[data-bloqueo="hasta"]').fill(dia(22))
    await page.locator('[data-bloqueo="motivo"]').selectOption('Mantenimiento')
    await page.locator('[data-bloqueo="guardar"]').click()
    await page.getByText('Fechas bloqueadas.').waitFor()
    await page.locator('li[data-bloqueo-id]').first().waitFor()
    check((await page.locator('li[data-bloqueo-id]').count()) === 1, `${e}: the block is listed (${await page.locator('li[data-bloqueo-id]').count()})`)
    const bloqueada = await llamar('GET', `/api/alojamientos/?q=${encodeURIComponent(editado)}&checkIn=${dia(21)}&checkOut=${dia(23)}`)
    const libre = await llamar('GET', `/api/alojamientos/?q=${encodeURIComponent(editado)}&checkIn=${dia(23)}&checkOut=${dia(25)}`)
    check(bloqueada.body.items.length === 0 && libre.body.items.length === 1, `${e}: blocked dates leave the search; the day after the block is free (${bloqueada.body.items.length}/${libre.body.items.length})`)
    await sinDesborde('the owner panel')
    await page.screenshot({ path: join(artifacts, `${e}-propietario.png`), fullPage: true })
    await salir('the owner')

    // ---- 6. A guest searches and filters.
    await entrar(CLIENTE, 'the guest')
    await completarPerfil('30111333')
    primeraVez = false
    await page.goto(`${web}/alojamientos`, { waitUntil: 'networkidle' })
    const busqueda = page.locator('form').filter({ has: page.locator('#busqueda-destino') })
    await page.locator('#busqueda-destino').fill(editado)
    // Only the arrival: the form says what is missing.
    await page.locator('#busqueda-entrada').fill(dia(5))
    await busqueda.locator('button[type="submit"]').click()
    await page.locator('[data-busqueda="aviso"]').waitFor()
    await page.locator('#busqueda-salida').fill(dia(8))
    await busqueda.locator('button[type="submit"]').click()
    const tarjeta = page.locator('a[href^="/alojamientos/"]').filter({ hasText: editado }).first()
    await tarjeta.waitFor()
    // The card is already there from the search without dates: wait for the one with dates to
    // redraw it with the total before reading it.
    await tarjeta.filter({ hasText: '150.000' }).waitFor({ timeout: 10_000 }).catch(() => undefined)
    check(/150\.000/u.test(await tarjeta.innerText()), `${e}: the search shows the total of the three nights`)
    check(!(await page.locator('body').innerText()).includes('Calle Smoke'), `${e}: the search does not show the exact address`)
    // Filter: more guests than the place takes.
    await busqueda.locator('select').last().selectOption('5')
    await busqueda.locator('button[type="submit"]').click()
    await page.getByText('No se encontraron alojamientos para los criterios seleccionados.').waitFor()
    check(true, `${e}: the guests filter is decided by the API`)
    await busqueda.locator('select').last().selectOption('2')
    await busqueda.locator('button[type="submit"]').click()
    await tarjeta.waitFor()
    await sinDesborde('the search')
    await page.screenshot({ path: join(artifacts, `${e}-busqueda.png`) })

    // ---- 7. Detail, dates and reservation.
    await tarjeta.click()
    await page.waitForURL((url) => /^\/alojamientos\/[^/]+$/u.test(url.pathname) && !url.pathname.endsWith('/reservas'))
    await page.getByRole('heading', { level: 1, name: editado }).waitFor()
    check((await page.locator('img').count()) >= 1, `${e}: the detail shows the photo`)
    check(!(await page.locator('body').innerText()).includes('Calle Smoke'), `${e}: the detail does not show the exact address`)
    // Reserving without dates is explained, not an alert of the browser.
    await page.getByRole('button', { name: 'Reservar', exact: true }).first().click()
    await page.locator('[data-estadia="aviso"]').waitFor()
    await page.locator('#estadia-entrada').fill(dia(5))
    await page.locator('#estadia-salida').fill(dia(8))
    await page.getByText(/150\.000/u).first().waitFor()
    await page.getByRole('button', { name: 'Reservar', exact: true }).first().click()
    await page.getByPlaceholder('Ej. Juan Pérez').fill('Cliente Smoke')
    await sinDesborde('the reservation dialog')
    await page.getByRole('button', { name: 'Confirmar reserva' }).click()
    await page.getByText('Tu estadía está confirmada').waitFor()
    check((await page.getByText(/Total a pagar en el alojamiento/u).count()) === 1, `${e}: the reservation is confirmed and paid at the place`)
    // The dates are taken now: the same search no longer finds it.
    const ocupada = await llamar('GET', `/api/alojamientos/?q=${encodeURIComponent(editado)}&checkIn=${dia(6)}&checkOut=${dia(7)}`)
    check(ocupada.body.items.length === 0, `${e}: reserved dates leave the search`)

    // ---- 8. Mis reservas: the reservation, its address and its cancellation.
    await page.locator('[data-reserva="ver"]').click()
    await page.waitForURL((url) => url.pathname === '/alojamientos/reservas')
    const mia = page.locator('article[data-reserva-estado="confirmed"]').filter({ hasText: editado })
    await mia.waitFor()
    const texto = await mia.innerText()
    check(texto.includes('Calle Smoke 123') && /150\.000/u.test(texto) && texto.includes('3 noches') && texto.includes('Confirmada'), `${e}: "Mis reservas" shows the stay, its total and, now, the address (${texto.replace(/\s+/gu, ' ').slice(0, 200)})`)
    await sinDesborde('"Mis reservas"')
    await page.screenshot({ path: join(artifacts, `${e}-mis-reservas.png`), fullPage: true })
    await mia.locator('[data-reserva-accion="cancelar"]').click()
    await page.getByRole('dialog').waitFor()
    await page.locator('[data-reserva-accion="confirmar-cancelacion"]').click()
    await page.getByText('Reserva cancelada.').waitFor()
    const cancelada = page.locator('article[data-reserva-estado="cancelled"]').filter({ hasText: editado })
    await cancelada.waitFor()
    check(!(await cancelada.innerText()).includes('Calle Smoke'), `${e}: a cancelled reservation no longer shows the address`)
    const devuelta = await llamar('GET', `/api/alojamientos/?q=${encodeURIComponent(editado)}&checkIn=${dia(6)}&checkOut=${dia(7)}`)
    check(devuelta.body.items.length === 1, `${e}: the dates of a cancelled reservation are free again`)
    await salir('the guest')

    // ---- 9. The owner sees the reservation of its alojamiento, cancelled by the guest.
    await entrar(PRESTADOR, 'the owner')
    await page.goto(`${web}/propietario/alojamientos`, { waitUntil: 'networkidle' })
    await page.locator('li[data-alojamiento-tarjeta]').filter({ hasText: editado }).locator('[data-accion="gestionar"]').click()
    await page.locator('[data-pestana="reservas"]').click()
    await page.locator('[data-seccion="reservas"] article[data-reserva-estado="cancelled"]').waitFor()
    check((await page.locator('[data-seccion="reservas"] article').count()) === 1, `${e}: the owner sees the reservation of its alojamiento and its state`)

    // ---- 10. The same account as a provider: absences in its agenda.
    check((await llamar('POST', '/auth/session/mode', { mode: 'PROVIDER' })).status === 200, `${e}: the account works as a provider`)
    await page.goto(`${web}/prestador/turnos`, { waitUntil: 'networkidle' })
    const ausencias = page.locator('[data-ausencias]')
    await ausencias.waitFor()
    await ausencias.locator('[data-ausencias-lista="vacia"]').waitFor()
    const agenda = async (desde = lunes) => (await llamar('GET', `/tus/v1/prestador/turnos/agenda?oficioId=${encodeURIComponent(oficioId)}&desde=${desde}`)).body
    const libres = (semana, indice) => semana.dias[indice].franjas.filter((f) => f.estado === 'disponible').map((f) => f.hora)
    const habitual = await agenda()
    check(libres(habitual, 1).length === 9 && libres(habitual, 2)[0] === '09:00', `${e}: the usual week offers its slots (${libres(habitual, 1).join()})`)
    const guardar = async (tipo, llenar, esperado) => {
      await ausencias.locator('[data-ausencia-accion="agregar"]').click()
      await ausencias.locator(`[data-ausencia-tipo="${tipo}"]`).check()
      await llenar()
      await ausencias.locator('[data-ausencia-accion="guardar"]').click()
      await ausencias.locator('[data-ausencia]').filter({ hasText: esperado }).waitFor()
    }
    // A form that is not complete says so and sends nothing.
    await ausencias.locator('[data-ausencia-accion="agregar"]').click()
    await ausencias.locator('[data-ausencia-accion="guardar"]').click()
    await ausencias.locator('[data-ausencias-error]').waitFor()
    await ausencias.getByRole('button', { name: 'Cancelar' }).click()
    // Whole day: Tuesday.
    await guardar('dia', async () => { await ausencias.locator('[data-ausencia="desde"]').fill(sumar(lunes, 1)); await ausencias.locator('[data-ausencia="motivo"]').selectOption('Médico') }, 'No disponible todo el día')
    // Some hours: Wednesday 09:00 to 12:00.
    await guardar('horas', async () => { await ausencias.locator('[data-ausencia="desde"]').fill(sumar(lunes, 2)); await ausencias.locator('[data-ausencia="hora-desde"]').fill('09:00'); await ausencias.locator('[data-ausencia="hora-hasta"]').fill('12:00') }, '09:00 a 12:00')
    // Vacation: the whole following week.
    await guardar('rango', async () => { await ausencias.locator('[data-ausencia="desde"]').fill(sumar(lunes, 7)); await ausencias.locator('[data-ausencia="hasta"]').fill(sumar(lunes, 13)); await ausencias.locator('[data-ausencia="motivo"]').selectOption('Vacaciones') }, '→')
    check((await ausencias.locator('[data-ausencia]').count()) === 3, `${e}: the three absences are listed`)
    const conAusencias = await agenda()
    const vacaciones = await agenda(sumar(lunes, 7))
    check(libres(conAusencias, 1).length === 0, `${e}: no slots on the day off`)
    check(libres(conAusencias, 2).join() === '12:00,13:00,14:00,15:00,16:00,17:00', `${e}: the blocked hours are gone and the rest of the day stays (${libres(conAusencias, 2).join()})`)
    check(libres(conAusencias, 0).length === 9 && libres(conAusencias, 3).length === 9, `${e}: the other days keep their usual slots`)
    check(vacaciones.dias.every((d) => d.franjas.every((f) => f.estado !== 'disponible')), `${e}: no slots during the vacation`)
    // What a client is offered (the public agenda): the same, and never the reason.
    const publica = await llamar('GET', `/tus/v1/public/prestadores/smoke-perfil/turnos/agenda?oficioId=${encodeURIComponent(oficioId)}&desde=${lunes}`)
    check(publica.status === 200 && libres(publica.body, 1).length === 0 && !JSON.stringify(publica.body).includes('Médico'), `${e}: clients are offered nothing on the day off and never read the reason (${publica.status})`)
    await sinDesborde('the agenda of the provider')
    await page.screenshot({ path: join(artifacts, `${e}-ausencias.png`), fullPage: true })
    // Remove the day off: its slots come back; then the rest, for the next viewport.
    await ausencias.locator('[data-ausencia]').filter({ hasText: 'No disponible todo el día' }).locator('[data-ausencia-accion="quitar"]').click()
    await ausencias.getByText('Ausencia quitada: tus horarios habituales vuelven a ofrecerse.').waitFor()
    await page.waitForFunction(() => document.querySelectorAll('[data-ausencia]').length === 2)
    check(libres(await agenda(), 1).length === 9, `${e}: removing the absence gives the slots back`)
    for (let quedan = 2; quedan > 0; quedan -= 1) {
      await ausencias.locator('[data-ausencia-accion="quitar"]').first().click()
      await page.waitForFunction((n) => document.querySelectorAll('[data-ausencia]').length === n, quedan - 1)
    }
    await salir('the provider')

    const fallidas = http.filter((linea) => /\s(4\d\d|5\d\d)$/u.test(linea) && !ESPERADOS.some((esperado) => esperado.test(linea)))
    check(fallidas.length === 0, `${e}: unexpected HTTP errors: ${fallidas.join(' | ')}`)
    check(!http.some((linea) => /\s5\d\d$/u.test(linea)), `${e}: no request answered 5xx`)
    check(errores.length === 0, `${e}: console/page errors: ${errores.join(' | ')}`)
  } catch (error) {
    await page.screenshot({ path: join(artifacts, `${e}-failed.png`), fullPage: true }).catch(() => undefined)
    console.error(`${e} url=${page.url()} http=${http.slice(-10).join(' | ')} errors=${errores.join(' | ')}`)
    throw error
  } finally {
    await context.close()
  }
}

// What the smoke provokes on purpose: pages opened without a session and a file that is not an image.
const ESPERADOS = [/\/alojamientos\/mios 401$/u, /\/alojamientos\/reservas\/mias 401$/u, /\/fotos 415$/u, /\/auth\/session 401$/u, /\/auth\/refresh 401$/u]

let primeraVez = true

await main()
