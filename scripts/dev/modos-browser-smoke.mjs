import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Browser smoke of MODOS-01 (docs/MODOS_CLIENTE_PRESTADOR_TUS.md) against the REAL local API and
// the production Web build, on a disposable PostgreSQL 16 with every migration, on desktop and
// mobile: a plain client; an approved provider that is asked how to use TUS, switches both ways
// without signing out and keeps its mode after a reload; the provider surface closed to who cannot
// be a provider; and a provider suspended by the administration while it is working.
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
const WEB_PORT = 3216
const PG_PORT = String(56800 + Math.floor(Math.random() * 400))
const api = `http://localhost:${API_PORT}`
const web = `http://localhost:${WEB_PORT}`
const artifacts = join(tmpdir(), `tus-modos-${Date.now()}`)
const CLAVE = 'una frase larga y segura 2026'
const CLIENTE = { email: 'cliente-smoke@example.com', password: CLAVE, displayName: 'Cliente Smoke' }
const PRESTADOR = { email: 'prestador-smoke@example.com', password: CLAVE, displayName: 'Prestador Smoke' }

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
  const data = mkdtempSync(join(tmpdir(), 'tus-pg16-modos-'))
  const raiz = mkdtempSync(join(tmpdir(), 'tus-raiz-modos-'))
  const abrir = (nombre) => openSync(join(artifacts, nombre), 'a')
  const logs = { api: abrir('api.log'), web: abrir('web.log') }
  let pgIniciado = false
  let apiChild
  let webChild
  let browser
  const psql = (sql) => spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'tus_modos', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })
  try {
    const init = spawnSync(exe('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { encoding: 'utf8' })
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`)
    const start = spawnSync(exe('pg_ctl'), ['-D', data, '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c fsync=off -c lc_messages=C`, '-l', join(data, 'server.log'), '-w', 'start'], { encoding: 'utf8', timeout: 120_000 })
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stdout}${start.stderr}`)
    pgIniciado = true
    const creada = spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE tus_modos'], { encoding: 'utf8' })
    if (creada.status !== 0) throw new Error(`create database: ${creada.stderr}`)
    const databaseUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/tus_modos`
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
          await prisma.perfilPublicoPrestador.create({ data: { id: 'smoke-perfil', tenantId, prestadorId: 'smoke-prestador', nombrePublico: 'Prestador Smoke', tipoPrestador: 'empresa', oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 15000n }] } } })
          console.log('SEMBRADO ' + oficio.id)
        } finally { await prisma.$disconnect() }
      })()`,
    })
    check(/SEMBRADO /u.test(siembra.stdout), `the provider gets a profile with one service (${(siembra.stderr || siembra.stdout).slice(-300)})`)

    const altaCliente = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'smoke-cliente' }, body: JSON.stringify(CLIENTE) })
    check(altaCliente.status === 201, `the client account registers (${altaCliente.status})`)
    psql(`UPDATE public."Account" a SET "emailVerifiedAt" = now() FROM public."User" u WHERE a."userId" = u."id" AND u."normalizedEmail" = '${CLIENTE.email}'`)
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
    for (const viewport of [{ name: 'desktop-1280', width: 1280, height: 900 }, { name: 'mobile-390', width: 390, height: 844 }]) await recorrer(browser, viewport, psql)
  } finally {
    await browser?.close()
    await stop(webChild)
    await stop(apiChild)
    closeSync(logs.api)
    closeSync(logs.web)
    if (pgIniciado) spawnSync(exe('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf8', timeout: 60_000 })
    rmSync(data, { recursive: true, force: true })
    rmSync(raiz, { recursive: true, force: true })
    console.log(`MODOS_SMOKE total=${totals.total} pass=${totals.pass} api_pid=${apiChild?.pid ?? '-'} web_pid=${webChild?.pid ?? '-'} artifacts=${artifacts}`)
  }
}

let primeraVez = true

async function recorrer(browser, viewport, psql) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const e = viewport.name
  const movil = viewport.width < 700
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
  // The account menu: a dropdown on desktop, part of the menu on mobile. One click away.
  const menu = movil ? '[data-menu-cuenta="movil"]' : '[data-menu-cuenta="escritorio"]'
  const abrirMenu = async () => {
    if (movil) await page.getByRole('button', { name: 'Menú', exact: true }).click()
    else await page.locator(`${menu} > button`).click()
    await page.locator(`${menu} [data-cuenta="salir"]`).waitFor()
  }
  const modoVisible = () => page.locator(`${menu} [data-modo-activo]`).first().getAttribute('data-modo-activo')
  const completarPerfil = async (documento) => {
    const pais = (await llamar('GET', '/tus/v1/geografia/paises')).body.items[0]
    const provincia = (await llamar('GET', `/tus/v1/geografia/provincias?paisId=${encodeURIComponent(pais.id)}`)).body.items[0]
    const localidad = (await llamar('GET', `/tus/v1/geografia/localidades?provinciaId=${encodeURIComponent(provincia.id)}`)).body.items[0]
    const guardado = await llamar('PUT', '/tus/v1/perfil', { nombre: 'Persona', apellido: 'Smoke', tipoDocumento: 'DNI', numeroDocumento: documento, localidadId: localidad.id, calle: 'San Martín', numero: '1234', codigoPostal: '3400' })
    check(guardado.status === 200, `${e}: the personal profile is complete (${guardado.status})`)
  }
  try {
    // ---- 1. A plain client.
    await page.goto(`${web}/ayuda`, { waitUntil: 'domcontentloaded' })
    check((await llamar('POST', '/auth/sign-in', { email: CLIENTE.email, password: CLIENTE.password })).status === 200, `${e}: the client signs in`)
    await completarPerfil('30.111.201')
    const sesionCliente = (await llamar('GET', '/auth/session')).body.capabilities
    check(JSON.stringify(sesionCliente.availableModes) === '["CLIENT"]' && sesionCliente.activeMode === 'CLIENT', `${e}: the API gives a client only the client mode (${JSON.stringify(sesionCliente.availableModes)} ${sesionCliente.activeMode})`)
    const forzado = await llamar('POST', '/auth/session/mode', { mode: 'PROVIDER' })
    check(forzado.status === 403 && forzado.body?.error?.code === 'MODE_NOT_AVAILABLE', `${e}: asking for the provider mode by hand is refused (${forzado.status})`)
    await page.goto(`${web}/`, { waitUntil: 'networkidle' })
    await abrirMenu()
    check((await modoVisible()) === 'CLIENT', `${e}: the account menu says Cliente`)
    check((await page.locator('[data-cambiar-modo]').count()) === 0, `${e}: a client has no switch to the provider mode`)
    check((await page.locator('a[href="/prestador/solicitudes"], a[href="/prestador/turnos"]').count()) === 0, `${e}: a client sees no provider navigation`)
    await sinDesborde('the home of a client with the account menu open')
    await page.goto(`${web}/prestador/turnos`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 })
    check(true, `${e}: /prestador/* sends a client back to the client home`)
    check((await page.locator('[data-nav-prestador]').count()) === 0, `${e}: no provider screen was drawn for a client`)
    check((await llamar('POST', '/auth/sign-out')).status < 300, `${e}: the client signs out`)

    // ---- 2. An approved provider.
    psql(`UPDATE public."prestadores" SET "estado" = 'approved' WHERE "id" = 'smoke-p'`)
    await page.goto(`${web}/ayuda`, { waitUntil: 'domcontentloaded' })
    check((await llamar('POST', '/auth/sign-in', { email: PRESTADOR.email, password: PRESTADOR.password })).status === 200, `${e}: the provider signs in`)
    await completarPerfil('30.111.202')
    const sesion = (await llamar('GET', '/auth/session')).body.capabilities
    check(JSON.stringify(sesion.availableModes) === '["CLIENT","PROVIDER"]', `${e}: an approved provider has both modes (${JSON.stringify(sesion.availableModes)})`)
    if (primeraVez) {
      // No previous mode: "¿Cómo querés usar TUS?", without asking for the password again.
      check(sesion.activeMode === null, `${e}: without a previous mode the session has not chosen (${sesion.activeMode})`)
      await page.goto(`${web}/elegir-modo`, { waitUntil: 'networkidle' })
      await page.locator('[data-elegir="CLIENT"]').waitFor()
      check((await page.locator('input[type="password"]').count()) === 0, `${e}: the choice does not ask for the password`)
      await sinDesborde('the mode choice')
      await page.locator('[data-elegir="PROVIDER"]').click()
      await page.waitForURL((url) => url.pathname === '/prestador/solicitudes')
    } else {
      // The last mode of the account (provider) is still valid: straight in.
      check(sesion.activeMode === 'PROVIDER', `${e}: a new sign-in reuses the last valid mode (${sesion.activeMode})`)
      await page.goto(`${web}/prestador/solicitudes`, { waitUntil: 'networkidle' })
    }
    await page.locator('[data-nav-prestador]').waitFor()
    check((await page.locator('[data-nav-prestador] a').count()) >= 6, `${e}: the provider navigation is shown`)
    await abrirMenu()
    check((await modoVisible()) === 'PROVIDER', `${e}: the account menu says Prestador`)
    check((await page.locator(`${menu} [data-cambiar-modo="CLIENT"]`).count()) === 1, `${e}: "Cambiar a modo cliente" is one click away`)
    await sinDesborde('the provider home with the account menu open')
    // A reload keeps the mode (it lives in the session, on the server).
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('[data-nav-prestador]').waitFor()
    check((await llamar('GET', '/auth/session')).body.capabilities.activeMode === 'PROVIDER', `${e}: a reload keeps the provider mode`)

    // ---- 3. Provider -> client, without signing out.
    await abrirMenu()
    await page.locator(`${menu} [data-cambiar-modo="CLIENT"]`).click()
    await page.waitForURL((url) => url.pathname === '/')
    await page.waitForLoadState('networkidle')
    check((await llamar('GET', '/auth/session')).body.capabilities.activeMode === 'CLIENT', `${e}: the session is now in client mode, still open`)
    await abrirMenu()
    check((await modoVisible()) === 'CLIENT', `${e}: the account menu says Cliente after the switch`)
    check((await page.locator(`${menu} [data-cambiar-modo="PROVIDER"]`).count()) === 1, `${e}: "Cambiar a modo prestador" is one click away`)
    check((await page.locator('a[href="/prestador/turnos"]').count()) === 0, `${e}: in client mode the provider navigation is gone`)
    // As a client it can look for professionals (the directory answers).
    const directorio = await llamar('GET', '/tus/v1/public/prestadores')
    check(directorio.status === 200, `${e}: as a client it can search professionals (${directorio.status})`)
    await page.reload({ waitUntil: 'networkidle' })
    check((await llamar('GET', '/auth/session')).body.capabilities.activeMode === 'CLIENT', `${e}: a reload keeps the client mode`)

    // ---- 4. Client -> provider again.
    await abrirMenu()
    await page.locator(`${menu} [data-cambiar-modo="PROVIDER"]`).click()
    await page.waitForURL((url) => url.pathname === '/prestador/solicitudes')
    await page.locator('[data-nav-prestador]').waitFor()
    check((await llamar('GET', '/auth/session')).body.capabilities.activeMode === 'PROVIDER', `${e}: back in provider mode with the same session`)

    // ---- 5. The administration suspends the provider while it is working as one.
    const suspension = psql(`UPDATE public."prestadores" SET "estado" = 'suspended' WHERE "id" = 'smoke-p' RETURNING "estado"`)
    check(/suspended/u.test(suspension.stdout), `${e}: the provider is suspended in the database (${suspension.stdout.trim()} ${suspension.stderr.trim()} / session: ${JSON.stringify((await llamar('GET', '/auth/session')).body.capabilities.providerStatus)})`)
    const escritura = await llamar('POST', '/tus/v1/prestador/turnos/bloquear', { inicio: new Date(Date.now() + 86_400_000).toISOString(), fin: new Date(Date.now() + 90_000_000).toISOString() })
    check(escritura.status === 403 && escritura.body?.code === 'PROVIDER_SUSPENDED', `${e}: a suspended provider cannot operate (${escritura.status} ${escritura.body?.code})`)
    await page.goto(`${web}/prestador/solicitudes`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL((url) => url.pathname === '/' && url.search.includes('prestador-suspendido'))
    await page.locator('[data-aviso-suspension]').waitFor()
    check((await page.locator('[data-nav-prestador]').count()) === 0, `${e}: the provider surface is not shown to a suspended provider`)
    const suspendida = (await llamar('GET', '/auth/session')).body.capabilities
    check(JSON.stringify(suspendida.availableModes) === '["CLIENT"]' && suspendida.activeMode === 'CLIENT' && suspendida.providerStatus === 'suspended', `${e}: the session fell back to client (${JSON.stringify(suspendida.availableModes)} ${suspendida.activeMode} ${suspendida.providerStatus})`)
    await abrirMenu()
    check((await page.locator(`${menu} [data-prestador-suspendido]`).count()) === 1, `${e}: the account menu says the provider profile is suspended`)
    check((await page.locator(`${menu} [data-cambiar-modo]`).count()) === 0, `${e}: no switch to the provider mode while suspended`)
    await sinDesborde('the home of a suspended provider')
    // The same person keeps working as a client.
    check((await llamar('GET', '/tus/v1/perfil')).status === 200 && (await llamar('GET', '/tus/v1/public/prestadores')).status === 200, `${e}: the account keeps working as a client`)
    check((await llamar('POST', '/auth/session/mode', { mode: 'PROVIDER' })).status === 403, `${e}: the provider mode cannot be forced while suspended`)
    // Reactivated: the provider mode is available again, same account.
    psql(`UPDATE public."prestadores" SET "estado" = 'approved' WHERE "id" = 'smoke-p'`)
    const reactivada = await llamar('POST', '/auth/session/mode', { mode: 'PROVIDER' })
    check(reactivada.status === 200 && reactivada.body?.activeMode === 'PROVIDER', `${e}: approved again, the provider mode is back (${reactivada.status})`)
    check((await llamar('POST', '/auth/sign-out')).status < 300, `${e}: the provider signs out`)

    const inesperados = http.filter((linea) => / 5\d\d$/u.test(linea))
    check(inesperados.length === 0, `${e}: no request answered 5xx (${inesperados.join(', ')})`)
    check(errores.length === 0, `${e}: no console or page error (${errores.slice(0, 3).join(' | ')})`)
    primeraVez = false
  } catch (error) {
    await page.screenshot({ path: join(artifacts, `fallo-${e}.png`), fullPage: true }).catch(() => {})
    console.error(`HTTP ${e}: ${http.slice(-12).join(' | ')}`)
    throw error
  } finally {
    await context.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
