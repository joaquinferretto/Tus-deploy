import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'

// Browser smoke of SERVICIO-URGENTE-01 (docs/SERVICIO_URGENTE_TUS.md) against the REAL local API
// and the production Web build, on a disposable PostgreSQL 16 with every migration, on desktop
// (1280) and mobile (390). The three new screens:
// - the provider block of /prestador/solicitudes: "Aceptar servicios urgentes" on and off, the
//   coverage it declared, "toda la ciudad", an offer with its address, taking it, giving it back;
// - /urgente: the client asks for an urgent service and reads its real state;
// - Admin -> Solicitudes: the request with its candidates, who took it and who gave it back.
// Requests, offers and notices are made by the real API (no Meta credentials: the module records
// what it would send, nothing leaves). Every process is a child of this script and is stopped in
// `finally`; the cluster is removed. Needs PostgreSQL 16 binaries (TUS_PG_BIN) and `next build`
// with NEXT_PUBLIC_API_URL=http://localhost:3101.
const root = join(import.meta.dirname, '../..')
const webRoot = join(root, 'apps/web')
const apiRoot = join(root, 'apps/api')
const { chromium } = createRequire(join(apiRoot, 'package.json'))('playwright-core')
const chrome = process.env.TUS_TEST_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PG_BIN = process.env.TUS_PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\16\\bin'
const exe = (name) => join(PG_BIN, process.platform === 'win32' ? `${name}.exe` : name)
const API_PORT = 3101
const WEB_PORT = 3220
const PG_PORT = String(57600 + Math.floor(Math.random() * 400))
const api = `http://localhost:${API_PORT}`
const web = `http://localhost:${WEB_PORT}`
const artifacts = join(tmpdir(), `tus-servicio-urgente-${Date.now()}`)
const CLAVE = 'una frase larga y segura 2026'
const CLIENTE = { email: 'cliente-smoke@example.com', password: CLAVE, displayName: 'Ana Cliente' }
const PRESTADOR = { email: 'prestador-smoke@example.com', password: CLAVE, displayName: 'Prestador Smoke' }
const ADMIN = { email: 'admin-smoke@example.com', password: CLAVE, displayName: 'Admin Smoke' }
const BOOTSTRAP = 'codigo-bootstrap-solo-para-este-smoke'
let oficioId = ''

// RFC 6238 (the authenticator app of the administrator).
function totp(secret, at = Date.now()) {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const letra of secret.replace(/=+$/u, '').toUpperCase()) bits += alfabeto.indexOf(letra).toString(2).padStart(5, '0')
  const clave = Buffer.from((bits.match(/.{8}/gu) ?? []).map((byte) => parseInt(byte, 2)))
  const contador = Buffer.alloc(8)
  contador.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const hmac = createHmac('sha1', clave).update(contador).digest()
  const desde = hmac[hmac.length - 1] & 0x0f
  return String((hmac.readUInt32BE(desde) & 0x7fffffff) % 1_000_000).padStart(6, '0')
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

const GABRIELA = { email: 'gabriela-smoke@example.com', password: CLAVE, displayName: 'Gabriela Lopez' }
const FLOR = { email: 'flor-smoke@example.com', password: CLAVE, displayName: 'Flor Perez' }
const DIRECCION = { 'desktop-1280': 'Av. 3 de Abril 1850', 'mobile-390': 'Junin 1234' }

async function main() {
  assert.ok(existsSync(join(webRoot, '.next/routes-manifest.json')), 'Run the Web build first (NEXT_PUBLIC_API_URL=http://localhost:3101)')
  mkdirSync(artifacts, { recursive: true })
  const data = mkdtempSync(join(tmpdir(), 'tus-pg16-urgente-'))
  const raiz = mkdtempSync(join(tmpdir(), 'tus-raiz-urgente-'))
  const abrir = (nombre) => openSync(join(artifacts, nombre), 'a')
  const logs = { api: abrir('api.log'), web: abrir('web.log') }
  let pgIniciado = false
  let apiChild
  let webChild
  let browser
  const psql = (sql) => spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'tus_urgente', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })
  try {
    const init = spawnSync(exe('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { encoding: 'utf8' })
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`)
    const start = spawnSync(exe('pg_ctl'), ['-D', data, '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c fsync=off -c lc_messages=C`, '-l', join(data, 'server.log'), '-w', 'start'], { encoding: 'utf8', timeout: 120_000 })
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stdout}${start.stderr}`)
    pgIniciado = true
    const creada = spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE tus_urgente'], { encoding: 'utf8' })
    if (creada.status !== 0) throw new Error(`create database: ${creada.stderr}`)
    const databaseUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/tus_urgente`
    const migrate = spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl }, timeout: 600_000 })
    if (migrate.status !== 0) throw new Error(`migrate-deploy failed: ${(migrate.stdout + migrate.stderr).slice(-800)}`)

    const entorno = {
      ...process.env,
      NODE_ENV: 'development', FACTORY_PROFILE: 'local', NATIVE_PROFILE: '1',
      DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, API_PORT: String(API_PORT), PORT: String(API_PORT),
      CORS_ORIGINS: web, TUS_ROUTES_ENABLED: 'true', TUS_PROVIDER_ACTIONS_ENABLED: 'false',
      TUS_PLATFORM_ADMIN_EMAILS: ADMIN.email, TUS_ADMIN_BOOTSTRAP_CODE: BOOTSTRAP,
      TUS_MFA_ENCRYPTION_KEY: process.env.TUS_MFA_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64'),
      // Nothing external: no Meta credentials (the module records what it would send), no model.
      WHATSAPP_ENABLED: 'false', WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '', WHATSAPP_AI_ENABLED: 'false', GROQ_API_KEY: '', RAG_EMBEDDING_PROVIDER: 'none',
    }
    writeFileSync(join(raiz, '.env'), `DATABASE_URL="${databaseUrl}"\nDIRECT_URL="${databaseUrl}"\n`)
    copyFileSync(join(root, 'pnpm-workspace.yaml'), join(raiz, 'pnpm-workspace.yaml'))
    apiChild = spawn(process.execPath, [join(apiRoot, 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', join(apiRoot, 'tsconfig.json'), join(apiRoot, 'src/index.ts')], { cwd: raiz, env: entorno, detached: false, windowsHide: true, stdio: ['ignore', logs.api, logs.api] })
    await esperar(`${api}/health`, apiChild, 'API')
    webChild = spawn(process.execPath, [join(webRoot, 'node_modules/next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(WEB_PORT)], { cwd: webRoot, env: { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_API_URL: api }, detached: false, windowsHide: true, stdio: ['ignore', logs.web, logs.web] })
    await esperar(web, webChild, 'Web')

    // Two providers and a client, registered through the API; their provider profile, service and
    // linked WhatsApp (window open) are written in the disposable database.
    const cuentas = {}
    for (const [clave, cuenta] of [['gabriela', GABRIELA], ['flor', FLOR], ['cliente', CLIENTE]]) {
      const registro = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': `smoke-${clave}` }, body: JSON.stringify(cuenta) })
      check(registro.status === 201, `the account of ${clave} registers (${registro.status})`)
      const fila = psql(`UPDATE public."Account" a SET "emailVerifiedAt" = now() FROM public."User" u WHERE a."userId" = u."id" AND u."normalizedEmail" = '${cuenta.email}' RETURNING a."tenantId" || '|' || a."id"`)
      const [tenantId = '', cuentaId = ''] = fila.stdout.split(/\r?\n/u)[0].trim().split('|')
      check(/\S/u.test(tenantId), `the API is using the disposable database (${fila.stderr.trim()})`)
      cuentas[clave] = { tenantId, cuentaId }
    }
    const siembra = spawnSync(process.execPath, [join(apiRoot, 'node_modules/tsx/dist/cli.mjs'), '-'], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
      input: `(async () => {
        const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
        const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(databaseUrl)} })
        try {
          const ahora = new Date()
          const oficio = await prisma.oficioServicio.findFirst({ where: { activo: true }, orderBy: { orden: 'asc' } })
          const barrio = await prisma.barrio.findFirst({ where: { nombre: 'Centro' } })
          for (const [clave, nombre, wa] of [['gabriela', 'Gabriela Lopez', '5493794555022'], ['flor', 'Flor Perez', '5493794555033']]) {
            const { tenantId, cuentaId } = ${JSON.stringify(cuentas)}[clave]
            await prisma.tusTenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, slug: tenantId, name: nombre, status: 'active', createdAt: ahora, updatedAt: ahora } })
            await prisma.prestador.create({ data: { id: 'smoke-p-' + clave, tenantId, prestadorId: 'smoke-prestador-' + clave, cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', cuentaId, fechaCreacion: ahora, fechaActualizacion: ahora } })
            await prisma.perfilPublicoPrestador.create({ data: { id: 'smoke-perfil-' + clave, tenantId, prestadorId: 'smoke-prestador-' + clave, nombrePublico: nombre, oficio: oficio.id, zona: 'Centro', zonasCobertura: ['Centro'], visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 15000n }] } } })
            await prisma.contactoWhatsapp.create({ data: { id: 'smoke-contacto-' + clave, canal: 'whatsapp', waId: wa, nombrePerfil: nombre, cuentaVinculadaId: cuentaId, tenantVinculadoId: tenantId, vinculadoEn: ahora, fechaCreacion: ahora } })
            await prisma.conversacionWhatsapp.create({ data: { id: 'smoke-conversacion-' + clave, contactoId: 'smoke-contacto-' + clave, canal: 'whatsapp', estado: 'active', modo: 'bot', abiertaEn: ahora, ultimoMensajeEn: ahora, ultimoEntranteEn: new Date(Date.now() - 3600_000), estadoConversacional: {} } })
          }
          console.log('SEMBRADO ' + oficio.id + ' ' + (barrio ? 'barrio' : 'sin-barrio'))
        } finally { await prisma.$disconnect() }
      })()`,
    })
    oficioId = (siembra.stdout.match(/SEMBRADO (\S+)/u) ?? [])[1] ?? ''
    check(/SEMBRADO \S+ barrio/u.test(siembra.stdout), `the providers get a profile, a service and a linked WhatsApp (${(siembra.stderr || siembra.stdout).slice(-1600)})`)

    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
    const estado = { psql, perfiles: false }
    for (const viewport of [{ name: 'desktop-1280', width: 1280, height: 900 }, { name: 'mobile-390', width: 390, height: 844 }]) await recorrer(browser, viewport, estado)
  } finally {
    await browser?.close()
    await stop(webChild)
    await stop(apiChild)
    closeSync(logs.api)
    closeSync(logs.web)
    if (pgIniciado) spawnSync(exe('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf8', timeout: 60_000 })
    rmSync(data, { recursive: true, force: true })
    rmSync(raiz, { recursive: true, force: true })
    console.log(`SERVICIO_URGENTE_SMOKE total=${totals.total} pass=${totals.pass} api_pid=${apiChild?.pid ?? '-'} web_pid=${webChild?.pid ?? '-'} artifacts=${artifacts}`)
  }
}

let secretoAdmin = null

async function recorrer(browser, viewport, estado) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const e = viewport.name
  const direccion = DIRECCION[e]
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
  const entrar = async (cuenta, quien, modo) => {
    check((await llamar('POST', '/auth/sign-in', { email: cuenta.email, password: cuenta.password })).status === 200, `${e}: ${quien} signs in`)
    if (modo) check((await llamar('POST', '/auth/session/mode', { mode: modo })).status === 200, `${e}: ${quien} works as ${modo}`)
  }
  // The page is left first: a screen that refreshes itself must not fire with the NEXT account's
  // session while this script swaps accounts under it.
  const salir = async (quien) => {
    await page.goto(`${web}/ayuda`, { waitUntil: 'domcontentloaded' })
    check((await llamar('POST', '/auth/sign-out')).status < 300, `${e}: ${quien} signs out`)
  }
  const completarPerfil = async (nombre, apellido, documento) => {
    const pais = (await llamar('GET', '/tus/v1/geografia/paises')).body.items[0]
    const provincia = (await llamar('GET', `/tus/v1/geografia/provincias?paisId=${encodeURIComponent(pais.id)}`)).body.items[0]
    const localidad = (await llamar('GET', `/tus/v1/geografia/localidades?provinciaId=${encodeURIComponent(provincia.id)}`)).body.items[0]
    check((await llamar('PUT', '/tus/v1/perfil', { nombre, apellido, tipoDocumento: 'DNI', numeroDocumento: documento, localidadId: localidad.id, calle: 'San Martín', numero: '1234', codigoPostal: '3400' })).status === 200, `the personal profile of ${nombre} is complete`)
  }
  const bloque = page.locator('[data-urgentes-prestador]')
  const oferta = () => bloque.locator('li').filter({ hasText: direccion })
  const aviso = bloque.locator('[data-urgente-aviso]')
  // The switches are saved by the API before they show their new state: click, then wait for it.
  const marcar = async (selector, valor) => { await page.locator(selector).click(); await page.waitForFunction(({ selector, valor }) => document.querySelector(selector)?.checked === valor, { selector, valor }) }
  const comoPrestador = async (cuenta, quien) => {
    await entrar(cuenta, quien, 'PROVIDER')
    await page.goto(`${web}/prestador/solicitudes`, { waitUntil: 'networkidle' })
    await bloque.locator('[data-acepta-urgencias]').waitFor()
  }
  try {
    await page.goto(`${web}/ayuda`, { waitUntil: 'domcontentloaded' })
    if (!estado.perfiles) {
      for (const [cuenta, nombre, apellido, documento] of [[GABRIELA, 'Gabriela', 'Lopez', '30111222'], [FLOR, 'Flor', 'Perez', '30111444'], [CLIENTE, 'Ana', 'Cliente', '30111333']]) {
        await entrar(cuenta, nombre)
        await completarPerfil(nombre, apellido, documento)
        await salir(nombre)
      }
      estado.perfiles = true
    }

    // ---- 0 (once). Nobody takes urgent requests yet: the client gets a clear answer, not an error.
    if (!estado.sinPrestadores) {
      await entrar(CLIENTE, 'the client')
      await page.goto(`${web}/urgente`, { waitUntil: 'networkidle' })
      await page.waitForFunction((id) => [...document.querySelectorAll('#urgente-servicio option')].some((option) => option.value === id), oficioId)
      await page.selectOption('#urgente-servicio', oficioId)
      await page.fill('#urgente-direccion', 'Belgrano 100')
      await page.selectOption('#urgente-barrio', 'Centro')
      await page.fill('#urgente-motivo', 'Pierde agua el tanque')
      await page.locator('[data-urgente-form]').getByRole('button', { name: /Pedir servicio urgente/u }).click()
      const respuesta = page.locator('[data-urgente-enviado="sin-prestadores"]')
      await respuesta.waitFor()
      const texto = (await respuesta.innerText()).replace(/\s+/gu, ' ')
      check(/no hay prestadores de .+ que tomen servicios urgentes en Centro/u.test(texto) && texto.includes('No se envió tu dirección a nadie') && texto.includes('buscar un profesional'), `${e}: with no provider taking urgent requests the client is told so, with what to do next (${texto})`)
      // (Next keeps an empty route announcer with role="alert": only alerts that say something count.)
      check((await page.evaluate(() => [...document.querySelectorAll('main [role="alert"], [data-urgente-form] [role="alert"]')].filter((el) => el.textContent.trim()).length)) === 0, `${e}: it is not shown as an error`)
      const cerrada = page.locator('[data-urgentes-propios] li').filter({ hasText: 'Belgrano 100' })
      await cerrada.waitFor()
      check((await cerrada.getAttribute('data-urgente-estado')) === 'sin_candidatos' && (await cerrada.innerText()).includes('Sin prestadores disponibles'), `${e}: the request is closed at once, and another one can be asked`)
      check(await page.locator('[data-urgente-form]').getByRole('button', { name: /Pedir servicio urgente/u }).isEnabled(), `${e}: it does not block the next request`)
      await page.screenshot({ path: join(artifacts, `${e}-cliente-sin-prestadores.png`), fullPage: true })
      await salir('the client')
      estado.sinPrestadores = true
    }

    // ---- 1. The provider turns "Aceptar servicios urgentes" on and off, and reads its coverage.
    await comoPrestador(GABRIELA, 'Gabriela')
    const acepta = bloque.locator('[data-acepta-urgencias]')
    if (await acepta.isChecked()) {
      await marcar('[data-acepta-urgencias]', false)
      await page.waitForFunction(() => !document.querySelector('[data-cobertura-urgencias]'))
      check(!(await acepta.isChecked()) && (await llamar('GET', '/tus/v1/prestador/urgentes/preferencia')).body.acceptsUrgent === false, `${e}: the switch turns off, and the API says so`)
    } else check((await llamar('GET', '/tus/v1/prestador/urgentes/preferencia')).body.acceptsUrgent === false, `${e}: urgent requests are off by default`)
    check((await bloque.innerText()).includes('Aceptar servicios urgentes') && (await bloque.innerText()).includes('dirección'), `${e}: the switch explains what turning it on means`)
    await marcar('[data-acepta-urgencias]', true)
    const cobertura = bloque.locator('[data-cobertura-urgencias]')
    await cobertura.waitFor()
    check((await cobertura.getAttribute('data-cobertura-urgencias')) === 'zonas' && (await cobertura.innerText()).includes('Centro'), `${e}: on, with the neighbourhoods it declared (${await cobertura.innerText()})`)
    await marcar('[data-toda-la-ciudad]', true)
    await page.waitForFunction(() => document.querySelector('[data-cobertura-urgencias]')?.getAttribute('data-cobertura-urgencias') === 'ciudad')
    check((await llamar('GET', '/tus/v1/prestador/urgentes/preferencia')).body.wholeCity === true, `${e}: "toda la ciudad" is an explicit switch the API stores`)
    await marcar('[data-toda-la-ciudad]', false)
    await page.waitForFunction(() => document.querySelector('[data-cobertura-urgencias]')?.getAttribute('data-cobertura-urgencias') === 'zonas')
    check((await llamar('GET', '/tus/v1/prestador/urgentes/preferencia')).body.acceptsUrgent === true, `${e}: the switch stays on`)
    await sinDesborde('the provider block')
    await page.screenshot({ path: join(artifacts, `${e}-prestador-preferencia.png`), fullPage: true })
    await salir('Gabriela')
    await entrar(FLOR, 'Flor', 'PROVIDER')
    check((await llamar('PUT', '/tus/v1/prestador/urgentes/preferencia', { acceptsUrgent: true })).status === 200, `${e}: Flor takes urgent requests too`)
    await salir('Flor')

    // ---- 2. The client asks for an urgent service.
    await entrar(CLIENTE, 'the client')
    await page.goto(`${web}/urgente`, { waitUntil: 'networkidle' })
    const formulario = page.locator('[data-urgente-form]')
    await formulario.waitFor()
    check((await formulario.innerText()).includes('tu dirección y tu barrio'), `${e}: the form says the address travels to the providers`)
    await formulario.getByRole('button', { name: /Pedir servicio urgente/u }).click()
    check((await formulario.locator('[role="alert"], [id$="-error"]').count()) >= 3, `${e}: an empty form is not sent`)
    await page.waitForFunction((id) => [...document.querySelectorAll('#urgente-servicio option')].some((option) => option.value === id), oficioId)
    await page.selectOption('#urgente-servicio', oficioId)
    await page.fill('#urgente-direccion', direccion)
    await page.selectOption('#urgente-barrio', 'Centro')
    await page.fill('#urgente-motivo', 'Se cortó toda la luz y está saltando la térmica')
    await formulario.getByRole('button', { name: /Pedir servicio urgente/u }).click()
    const enviado = page.locator('[data-urgente-enviado="difundido"]')
    await enviado.waitFor()
    check(/Envié tu pedido urgente de .+ a 2 prestadores/u.test(await enviado.innerText()), `${e}: the request was offered to the two providers (${await enviado.innerText()})`)
    const propia = page.locator('[data-urgentes-propios] li').filter({ hasText: direccion })
    await propia.waitFor()
    check((await propia.getAttribute('data-urgente-estado')) === 'pendiente' && (await propia.innerText()).includes('Buscando un prestador'), `${e}: the client sees it searching`)
    check(await page.getByRole('button', { name: /Ya tenés un pedido urgente en curso/u }).isDisabled(), `${e}: a second one cannot be asked while this one waits`)
    await sinDesborde('the urgent request page')
    await page.screenshot({ path: join(artifacts, `${e}-cliente-pendiente.png`), fullPage: true })
    await salir('the client')

    // ---- 3. Gabriela sees the offer with the address and takes it.
    await comoPrestador(GABRIELA, 'Gabriela')
    await oferta().waitFor()
    const textoOferta = (await oferta().innerText()).replace(/\s+/gu, ' ')
    check(textoOferta.includes(direccion) && textoOferta.includes('Centro') && textoOferta.includes('Se cortó toda la luz') && textoOferta.includes('Esperando tu respuesta'), `${e}: the offer shows the address, the zone and the reason (${textoOferta.slice(0, 200)})`)
    await page.screenshot({ path: join(artifacts, `${e}-prestador-oferta.png`), fullPage: true })
    await oferta().getByRole('button', { name: 'Puedo asistir' }).click()
    await aviso.waitFor()
    check((await aviso.innerText()).includes('es tuya'), `${e}: Gabriela is assigned (${await aviso.innerText()})`)
    await page.waitForFunction((direccion) => [...document.querySelectorAll('[data-urgentes-prestador] li')].some((li) => li.textContent.includes(direccion) && li.getAttribute('data-urgente-oferta') === 'acepto'), direccion)
    check((await oferta().innerText()).includes('Es tuya') && (await oferta().getByRole('link', { name: 'Ver trabajo' }).count()) === 1, `${e}: the offer becomes hers, with its work`)
    await sinDesborde('the offer taken')
    await salir('Gabriela')
    // Flor arrives second.
    await comoPrestador(FLOR, 'Flor')
    await oferta().waitFor()
    check((await oferta().innerText()).includes('La tomó otro prestador') && (await oferta().getByRole('button', { name: 'Puedo asistir' }).count()) === 0, `${e}: Flor sees it was taken and cannot take it`)
    await salir('Flor')

    // ---- 4. The client sees who took it.
    await entrar(CLIENTE, 'the client')
    await page.goto(`${web}/urgente`, { waitUntil: 'networkidle' })
    await propia.waitFor()
    check((await propia.getAttribute('data-urgente-estado')) === 'tomada' && (await propia.innerText()).includes('Gabriela Lopez aceptó'), `${e}: the client sees Gabriela accepted (${(await propia.innerText()).replace(/\s+/gu, ' ').slice(0, 160)})`)
    await salir('the client')

    // ---- 5. Gabriela cannot go after all: the request is offered again and Flor takes it.
    await comoPrestador(GABRIELA, 'Gabriela')
    await oferta().waitFor()
    await oferta().getByRole('button', { name: 'No puedo asistir' }).click()
    await aviso.waitFor()
    check((await aviso.innerText()).includes('finalmente no podés asistir'), `${e}: the resignation is recorded (${await aviso.innerText()})`)
    await page.waitForFunction((direccion) => [...document.querySelectorAll('[data-urgentes-prestador] li')].some((li) => li.textContent.includes(direccion) && li.getAttribute('data-urgente-oferta') === 'renuncio'), direccion)
    check((await oferta().innerText()).includes('Avisaste que no podías asistir') && (await oferta().getByRole('button').count()) === 0, `${e}: it cannot be taken again by who gave it back`)
    await page.screenshot({ path: join(artifacts, `${e}-prestador-renuncia.png`), fullPage: true })
    await salir('Gabriela')
    await entrar(CLIENTE, 'the client')
    await page.goto(`${web}/urgente`, { waitUntil: 'networkidle' })
    await propia.waitFor()
    check((await propia.getAttribute('data-urgente-estado')) === 'pendiente' && (await propia.innerText()).includes('avisó que no podía asistir'), `${e}: the client sees it is searching again`)
    await salir('the client')
    await comoPrestador(FLOR, 'Flor')
    await oferta().waitFor()
    await oferta().getByRole('button', { name: 'Puedo asistir' }).click()
    await aviso.waitFor()
    check((await aviso.innerText()).includes('es tuya'), `${e}: Flor takes the request Gabriela gave back`)
    await salir('Flor')
    const trabajos = estado.psql(`SELECT count(*) || '|' || string_agg(t."estado", ',') FROM public."trabajos" t JOIN public."solicitudes_servicio" s ON s."id" = t."solicitud_id" WHERE s."direccion" = '${direccion}'`).stdout.trim()
    check(trabajos === '1|requested', `${e}: still ONE work for the request, requested again (${trabajos})`)

    // ---- 6. Admin: the request, its candidates, who took it and who gave it back.
    if (!secretoAdmin) {
      check((await llamar('POST', '/auth/register', ADMIN)).status < 300, 'the administrator registers')
      check((await llamar('POST', '/auth/admin/bootstrap-verify', { email: ADMIN.email, code: BOOTSTRAP })).status === 204, 'the bootstrap code verifies the administrator email')
    }
    await entrar(ADMIN, 'the administrator')
    if (!secretoAdmin) {
      const alta = await llamar('POST', '/auth/mfa/enroll')
      check(alta.status === 201 && typeof alta.body?.secret === 'string', `MFA enrollment starts (${alta.status})`)
      secretoAdmin = alta.body.secret
      check((await llamar('POST', '/auth/mfa/enroll/confirm', { enrollmentId: alta.body.enrollmentId, code: totp(secretoAdmin) })).status < 300, 'MFA is confirmed and the session elevated')
    } else {
      await new Promise((resolve) => setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500))
      check((await llamar('POST', '/auth/mfa/verify', { code: totp(secretoAdmin) })).status < 300, `${e}: MFA step-up`)
    }
    await page.goto(`${web}/tus/admin/solicitudes`, { waitUntil: 'networkidle' })
    const seccion = page.locator('[data-admin-urgentes]')
    const fila = seccion.locator('tr').filter({ hasText: direccion })
    await fila.waitFor()
    const textoFila = (await fila.innerText()).replace(/\s+/gu, ' ')
    check((await fila.getAttribute('data-urgente-admin')) === 'tomada' && textoFila.includes('Flor Perez') && textoFila.includes('Centro') && textoFila.includes('Ana C.'), `${e}: Admin sees the request, its address, its client and who has it (${textoFila.slice(0, 260)})`)
    check(textoFila.includes('2 encontrados') && textoFila.includes('2 notificados') && textoFila.includes('1 renunció') && textoFila.includes('Reabierta 1 vez'), `${e}: Admin sees the counts and the reopening (${textoFila.slice(0, 320)})`)
    await fila.locator('summary').click()
    const detalle = (await fila.locator('details').innerText()).replace(/\s+/gu, ' ')
    check(detalle.includes('Gabriela Lopez') && detalle.includes('Aceptó y después renunció') && detalle.includes('Aceptó (asignado)') && detalle.includes('Avisado por WhatsApp') && detalle.includes('••••'), `${e}: each provider with its notice (masked number), acceptance and resignation (${detalle.slice(0, 320)})`)
    check(!detalle.includes('5493794555022'), `${e}: no whole phone number in the administration`)
    await sinDesborde('Admin -> Solicitudes')
    await page.screenshot({ path: join(artifacts, `${e}-admin-urgentes.png`), fullPage: true })
    await salir('the administrator')

    const fallidas = http.filter((linea) => /\s(4\d\d|5\d\d)$/u.test(linea) && !ESPERADOS.some((esperado) => esperado.test(linea)))
    check(fallidas.length === 0, `${e}: unexpected HTTP errors: ${fallidas.join(' | ')}`)
    check(errores.length === 0, `${e}: console/page errors: ${errores.join(' | ')}`)
  } catch (error) {
    await page.screenshot({ path: join(artifacts, `${e}-failed.png`), fullPage: true }).catch(() => undefined)
    console.error(`${e} url=${page.url()} http=${http.slice(-10).join(' | ')} errors=${errores.join(' | ')}`)
    throw error
  } finally {
    await context.close()
  }
}

const ESPERADOS = [/\/auth\/session 401$/u, /\/auth\/refresh 401$/u]

await main()
