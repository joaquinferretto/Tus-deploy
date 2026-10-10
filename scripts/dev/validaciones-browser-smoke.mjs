import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Browser smoke of the forms whose validation was corrected (docs/VALIDACIONES_DATOS_TUS.md),
// against the REAL local API and the production Web build, on a disposable PostgreSQL 16 with
// every migration: sign-up, personal profile, manual turno and agenda block, on desktop and
// mobile. An invalid value shows its message next to the field (or names the field), a valid one
// is saved, nothing answers 5xx, the console stays clean and no page scrolls sideways.
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
const WEB_PORT = 3215
const PG_PORT = String(56400 + Math.floor(Math.random() * 400))
const api = `http://localhost:${API_PORT}`
const web = `http://localhost:${WEB_PORT}`
const artifacts = join(tmpdir(), `tus-validaciones-${Date.now()}`)
const CLAVE = 'una frase larga y segura 2026'
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
  const data = mkdtempSync(join(tmpdir(), 'tus-pg16-validaciones-'))
  const raiz = mkdtempSync(join(tmpdir(), 'tus-raiz-validaciones-'))
  const abrir = (nombre) => openSync(join(artifacts, nombre), 'a')
  const logs = { api: abrir('api.log'), web: abrir('web.log') }
  let pgIniciado = false
  let apiChild
  let webChild
  let browser
  const psql = (sql) => spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'tus_validaciones', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })
  try {
    const init = spawnSync(exe('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { encoding: 'utf8' })
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`)
    const start = spawnSync(exe('pg_ctl'), ['-D', data, '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c fsync=off -c lc_messages=C`, '-l', join(data, 'server.log'), '-w', 'start'], { encoding: 'utf8', timeout: 120_000 })
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stdout}${start.stderr}`)
    pgIniciado = true
    const creada = spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE tus_validaciones'], { encoding: 'utf8' })
    if (creada.status !== 0) throw new Error(`create database: ${creada.stderr}`)
    const databaseUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/tus_validaciones`
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
    console.log(`VALIDACIONES_SMOKE total=${totals.total} pass=${totals.pass} api_pid=${apiChild?.pid ?? '-'} web_pid=${webChild?.pid ?? '-'} artifacts=${artifacts}`)
  }
}

async function recorrer(browser, viewport, psql) {
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
  try {
    // ---- 1. Sign-up: an invalid name is marked next to its field; a valid form creates the account.
    const sufijo = e.startsWith('desktop') ? 'd' : 'm'
    await page.goto(`${web}/registro`, { waitUntil: 'networkidle' })
    await page.fill('#registro-nombre', 'Mar1a')
    await page.fill('#registro-apellido', 'Pérez--Gómez')
    await page.fill('#registro-telefono', sufijo === 'd' ? '3794 500101' : '3794 500102')
    await page.fill('#registro-email', `registro-${sufijo}@example.com`)
    await page.fill('#registro-password', CLAVE)
    await page.fill('#registro-confirmacion', CLAVE)
    await page.locator('input[type="checkbox"]').first().check()
    const antesRegistro = http.length
    await page.locator('form button[type="submit"]').first().click()
    await page.waitForSelector('#registro-nombre-error')
    check((await page.textContent('#registro-nombre-error')).startsWith('Nombre:'), `${e}: the invalid first name is explained next to its field`)
    check((await page.textContent('#registro-apellido-error')).startsWith('Apellido:'), `${e}: the invalid last name is explained next to its field`)
    check(http.slice(antesRegistro).every((linea) => !linea.includes('/auth/register')), `${e}: an invalid sign-up is not sent`)
    await sinDesborde('the sign-up form with errors')
    await page.fill('#registro-nombre', 'María José')
    await page.fill('#registro-apellido', 'O\u2019Connor')
    await page.locator('form button[type="submit"]').first().click()
    await page.waitForResponse((response) => response.url().endsWith('/auth/register'))
    check(http.some((linea) => linea === 'POST /auth/register 201'), `${e}: a valid sign-up (accents, space, phone apostrophe) is accepted (${http.filter((l) => l.includes('register')).join(', ')})`)
    const guardado = psql(`SELECT "displayName" FROM public."User" WHERE "normalizedEmail" = 'registro-${sufijo}@example.com'`).stdout.trim()
    check(guardado === "María José O'Connor", `${e}: the name is stored normalized (${guardado})`)

    // ---- the provider signs in (the session cookie travels like in the Web)
    await page.goto(`${web}/ayuda`, { waitUntil: 'domcontentloaded' })
    const entrada = await llamar('POST', '/auth/sign-in', { email: PRESTADOR.email, password: PRESTADOR.password })
    check(entrada.status === 200, `${e}: the provider signs in (${entrada.status})`)
    const sesion = await llamar('GET', '/auth/session')
    const sembrado = psql(`SELECT "tenant_id" FROM public."perfiles_publicos_prestador" WHERE "id" = 'smoke-perfil'`).stdout.trim()
    check(sesion.body?.context?.tenantId === sembrado, `${e}: the seeded profile belongs to the tenant of the session (${sesion.body?.context?.tenantId} / ${sembrado})`)

    // ---- 2. Personal profile: an invalid name and document are marked next to their fields.
    await page.goto(`${web}/mi-perfil`, { waitUntil: 'networkidle' })
    const nombre = page.locator('label:has(> span:text-is("Nombre")) input')
    await nombre.waitFor()
    await nombre.fill('R2D2')
    await page.locator('label:has(> span:text-is("Apellido")) input').fill('Muñoz')
    await page.locator('label:has(> span:text-is("Número de documento")) input').fill('12AB')
    const antesPerfil = http.length
    await page.getByRole('button', { name: /^Guardar/u }).first().click()
    await page.waitForSelector('#perfil-nombre-error')
    check((await page.textContent('#perfil-nombre-error')).includes('nombre'), `${e}: the invalid profile name is explained next to its field`)
    check(await page.locator('#perfil-numeroDocumento-error').count() === 1, `${e}: the invalid document is explained next to its field`)
    check(await page.locator('#perfil-apellido-error').count() === 0, `${e}: a valid last name (ñ) has no error`)
    check(http.slice(antesPerfil).every((linea) => !linea.startsWith('PUT /tus/v1/perfil')), `${e}: an invalid profile is not sent`)
    await sinDesborde('the profile form with errors')

    // A valid profile is saved by the API (the agenda asks for a complete personal profile).
    const pais = (await llamar('GET', '/tus/v1/geografia/paises')).body.items[0]
    const provincia = (await llamar('GET', `/tus/v1/geografia/provincias?paisId=${encodeURIComponent(pais.id)}`)).body.items[0]
    const localidad = (await llamar('GET', `/tus/v1/geografia/localidades?provinciaId=${encodeURIComponent(provincia.id)}`)).body.items[0]
    const perfilValido = { nombre: 'Sofía', apellido: 'O’Connor', tipoDocumento: 'DNI', numeroDocumento: '30.111.222', localidadId: localidad.id, calle: 'San Martín', numero: '1234', codigoPostal: '3400' }
    const guardadoPerfil = await llamar('PUT', '/tus/v1/perfil', perfilValido)
    check(guardadoPerfil.status === 200 && guardadoPerfil.body?.perfil?.apellido === "O'Connor", `${e}: a valid profile is saved normalized (${guardadoPerfil.status} ${JSON.stringify(guardadoPerfil.body?.error ?? '')})`)
    const perfilAjeno = await llamar('PUT', '/tus/v1/perfil', { ...perfilValido, role: 'admin' })
    check(perfilAjeno.status === 422, `${e}: a profile with a field that is not of the form is a 422 (${perfilAjeno.status})`)

    // ---- 3. Manual turno and agenda block.
    const servicios = await llamar('GET', '/tus/v1/prestador/turnos/servicios')
    check(servicios.status === 200 && servicios.body.items.length === 1, `${e}: the provider has its service (${servicios.status} ${JSON.stringify(servicios.body).slice(0, 300)})`)
    await page.goto(`${web}/prestador/turnos`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '+ Turno manual' }).click()
    const manual = page.locator('form').filter({ has: page.locator('input[placeholder="Nombre y apellido"]') })
    await manual.locator('select').first().selectOption({ index: 1 })
    const dia = new Date(Date.now() + (e.startsWith('desktop') ? 3 : 4) * 86_400_000).toISOString().slice(0, 10)
    await manual.locator('input[type="datetime-local"]').fill(`${dia}T10:00`)
    await manual.locator('input[placeholder="Nombre y apellido"]').fill('Sofía Ñandú')
    await manual.locator('input[type="tel"]').fill('12')
    await manual.locator('input[inputmode="numeric"]').fill('1500.75')
    check((await manual.locator('input[inputmode="numeric"]').inputValue()) === '150075', `${e}: the price field only keeps digits (no decimals, no sign)`)
    const antesManual = http.length
    await manual.locator('button[type="submit"]').click()
    await page.getByText('Teléfono: ingresalo con código de área', { exact: false }).waitFor()
    check(http.slice(antesManual).every((linea) => !linea.includes('/turnos/manual')), `${e}: a turno with an invalid phone is not sent, and the message names the field`)
    await sinDesborde('the manual turno form with an error')
    await manual.locator('input[type="tel"]').fill('3794 123456')
    await manual.locator('input[inputmode="numeric"]').fill('25000')
    await manual.locator('button[type="submit"]').click()
    await page.waitForResponse((response) => response.url().endsWith('/tus/v1/prestador/turnos/manual'))
    check(http.includes('POST /tus/v1/prestador/turnos/manual 201'), `${e}: a valid manual turno is created (${http.filter((l) => l.includes('manual')).join(', ')})`)
    // The API as a direct caller: what the form can no longer send is refused with its field.
    const directo = await llamar('POST', '/tus/v1/prestador/turnos/manual', { oficioId: 'x', inicio: `${dia}T12:00:00.000Z`, clienteNombre: 'Directo', precioFinal: 10.5 })
    check(directo.status === 400 && directo.body?.fields?.[0] === 'precioFinal', `${e}: a decimal price sent straight to the API is a 400 on precioFinal (${directo.status})`)

    await page.getByRole('button', { name: 'Bloquear horario' }).click()
    const bloqueo = page.locator('form').filter({ has: page.locator('input[placeholder^="ej. Médico"]') })
    const fechas = bloqueo.locator('input[type="datetime-local"]')
    await fechas.nth(0).fill(`${dia}T16:00`)
    await fechas.nth(1).fill(`${dia}T15:00`)
    const antesBloqueo = http.length
    await bloqueo.locator('button[type="submit"]').click()
    await page.getByText('Fin: debe ser posterior al inicio.').waitFor()
    check(http.slice(antesBloqueo).every((linea) => !linea.includes('/turnos/bloquear')), `${e}: a block that ends before it starts is not sent, and the message names the field`)
    await fechas.nth(1).fill(`${dia}T18:00`)
    await bloqueo.locator('button[type="submit"]').click()
    await page.waitForResponse((response) => response.url().endsWith('/tus/v1/prestador/turnos/bloquear'))
    check(http.includes('POST /tus/v1/prestador/turnos/bloquear 201'), `${e}: a valid block is created (${http.filter((l) => l.includes('bloquear')).join(', ')})`)
    await sinDesborde('the agenda page')

    check(!http.some((linea) => / 5\d\d$/u.test(linea)), `${e}: no request answered 5xx (${http.filter((l) => / 5\d\d$/u.test(l)).join(', ')})`)
    check(errores.length === 0, `${e}: no console or page error (${errores.slice(0, 3).join(' | ')})`)
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
