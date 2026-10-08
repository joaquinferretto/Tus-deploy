import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { pathToFileURL } from 'node:url'

// Browser smoke of the service payments flow (docs/PAGOS_SERVICIOS_TUS.md) against the REAL local
// API and the production Web build, on a disposable PostgreSQL 16 with every migration, on desktop
// (1280) and mobile (390):
// - /mis-turnos: choose deposit or total, pay, pay the balance, confirm or report a problem;
// - /prestador/turnos: funds retained, "Finalizar turno" with evidence, funds released;
// - Admin -> Pagos: the problem a client reported, and its resolution;
// - a profile whose service has no price: "se presupuesta", no turno request.
// NO REAL MONEY: the API runs with a stand-in for the Mercado Pago HTTP API at the `fetch`
// boundary (nothing leaves this machine), fictitious sandbox credentials and its own webhook
// secret. The stand-in lives only in this script: no production code knows about it.
// Every process is a child of this script and is stopped in `finally`; the cluster is removed.
// Needs PostgreSQL 16 binaries (TUS_PG_BIN) and `next build` with
// NEXT_PUBLIC_API_URL=http://localhost:3101.
const root = join(import.meta.dirname, '../..')
const webRoot = join(root, 'apps/web')
const apiRoot = join(root, 'apps/api')
const { chromium } = createRequire(join(apiRoot, 'package.json'))('playwright-core')
const chrome = process.env.TUS_TEST_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PG_BIN = process.env.TUS_PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\16\\bin'
const exe = (name) => join(PG_BIN, process.platform === 'win32' ? `${name}.exe` : name)
const API_PORT = 3101
const WEB_PORT = 3220
const CONTROL_PORT = 3103
const PG_PORT = String(57600 + Math.floor(Math.random() * 400))
const api = `http://localhost:${API_PORT}`
const web = `http://localhost:${WEB_PORT}`
const control = `http://127.0.0.1:${CONTROL_PORT}`
const artifacts = join(tmpdir(), `tus-pagos-servicios-${Date.now()}`)
const CLAVE = 'una frase larga y segura 2026'
const CLIENTE = { email: 'cliente-smoke@example.com', password: CLAVE, displayName: 'Ana Cliente' }
const PRESTADOR = { email: 'prestador-smoke@example.com', password: CLAVE, displayName: 'Prestador Smoke' }
const ADMIN = { email: 'admin-smoke@example.com', password: CLAVE, displayName: 'Admin Smoke' }
const BOOTSTRAP = 'codigo-bootstrap-solo-para-este-smoke'
const WEBHOOK_SECRET = 'secreto-de-webhook-solo-para-este-smoke'
const PLATFORM_TOKEN = 'token-de-plataforma-ficticio'
let oficioId = ''

// The API entry point behind a stand-in of the Mercado Pago HTTP API: preferences and payments are
// kept in memory, and a control port (loopback only) lets this script "pay" a preference and get
// the notification Mercado Pago would send, signed with the smoke's own webhook secret.
const ARRANQUE = `
import { createServer } from 'node:http'
const real = globalThis.fetch
const preferencias = []
const pagos = new Map()
const responder = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = async (entrada, init = {}) => {
  const url = new URL(typeof entrada === 'string' ? entrada : entrada.url)
  if (!url.hostname.endsWith('mercadopago.com')) return real(entrada, init)
  const cabeceras = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  if (String(cabeceras.authorization ?? '') !== 'Bearer ${PLATFORM_TOKEN}') return responder(401, { message: 'invalid token' })
  const metodo = (init.method ?? 'GET').toUpperCase()
  if (url.pathname === '/checkout/preferences' && metodo === 'POST') {
    const body = JSON.parse(init.body)
    const id = 'pref-smoke-' + (preferencias.length + 1)
    preferencias.push({ id, body })
    return responder(201, { id, init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=' + id, sandbox_init_point: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=' + id })
  }
  if (url.pathname === '/v1/payments/search') {
    const referencia = url.searchParams.get('external_reference')
    const results = [...pagos.values()].filter((pago) => pago.external_reference === referencia)
    return responder(200, { paging: { total: results.length, limit: 10, offset: 0 }, results })
  }
  const pago = url.pathname.match(/^\\/v1\\/payments\\/([^/]+)$/u)
  if (pago) return pagos.has(pago[1]) ? responder(200, pagos.get(pago[1])) : responder(404, { message: 'payment not found' })
  return responder(404, { message: 'not found' })
}
const { firmarManifiestoMercadoPago } = await import(${JSON.stringify(pathToFileURL(join(apiRoot, 'src/tus/finance/servicios/mercado-pago.ts')).href)})
let secuencia = 0
createServer((request, response) => {
  // "Pay" the preference of the checkout the client was sent to: an approved payment of exactly its amount.
  const pedida = new URL(request.url, 'http://control').searchParams.get('pref')
  const preferencia = preferencias.find((item) => item.id === pedida)
  if (request.method !== 'POST' || !request.url.startsWith('/pagar') || !preferencia) { response.writeHead(404).end('{}'); return }
  secuencia += 1
  const id = String(Date.now() % 1_000_000_000 + secuencia)
  pagos.set(id, { id: Number(id), status: 'approved', status_detail: 'accredited', transaction_amount: preferencia.body.items[0].unit_price, currency_id: 'ARS', external_reference: preferencia.body.external_reference, collector_id: 555, ...(preferencia.body.marketplace_fee !== undefined ? { marketplace_fee: preferencia.body.marketplace_fee } : {}), date_created: new Date().toISOString(), date_last_updated: new Date().toISOString(), fee_details: [] })
  const requestId = 'req-smoke-' + secuencia
  const ts = Date.now()
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, monto: preferencia.body.items[0].unit_price, preferencia: preferencia.id, requestId, signature: firmarManifiestoMercadoPago({ secret: ${JSON.stringify(WEBHOOK_SECRET)}, dataId: id, requestId, ts }), body: { id: 'notif-smoke-' + secuencia, type: 'payment', action: 'payment.updated', data: { id }, user_id: 555 } }))
}).listen(${CONTROL_PORT}, '127.0.0.1')
await import(${JSON.stringify(pathToFileURL(join(apiRoot, 'src/index.ts')).href)})
`

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

// Calendar dates in Argentina: the Monday of next week.
const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
const sumar = (fecha, dias) => new Date(Date.parse(`${fecha}T00:00:00.000Z`) + dias * 86_400_000).toISOString().slice(0, 10)
const lunes = sumar(hoy, ((8 - new Date(`${hoy}T12:00:00.000Z`).getUTCDay()) % 7) + 7)

async function esperar(url, child, nombre, ms = 90_000) {
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
  const data = mkdtempSync(join(tmpdir(), 'tus-pg16-pagos-'))
  const raiz = mkdtempSync(join(tmpdir(), 'tus-raiz-pagos-'))
  const abrir = (nombre) => openSync(join(artifacts, nombre), 'a')
  const logs = { api: abrir('api.log'), web: abrir('web.log') }
  let pgIniciado = false
  let apiChild
  let webChild
  let browser
  const psql = (sql) => spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'tus_pagos', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })
  try {
    const init = spawnSync(exe('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { encoding: 'utf8' })
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`)
    const start = spawnSync(exe('pg_ctl'), ['-D', data, '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c fsync=off -c lc_messages=C`, '-l', join(data, 'server.log'), '-w', 'start'], { encoding: 'utf8', timeout: 120_000 })
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stdout}${start.stderr}`)
    pgIniciado = true
    const creada = spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE tus_pagos'], { encoding: 'utf8' })
    if (creada.status !== 0) throw new Error(`create database: ${creada.stderr}`)
    const databaseUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/tus_pagos`
    const migrate = spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl }, timeout: 600_000 })
    if (migrate.status !== 0) throw new Error(`migrate-deploy failed: ${(migrate.stdout + migrate.stderr).slice(-800)}`)

    const entorno = {
      ...process.env,
      NODE_ENV: 'development', FACTORY_PROFILE: 'local', NATIVE_PROFILE: '1',
      DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, API_PORT: String(API_PORT), PORT: String(API_PORT),
      CORS_ORIGINS: web, TUS_ROUTES_ENABLED: 'true', TUS_PROVIDER_ACTIONS_ENABLED: 'false',
      TUS_PLATFORM_ADMIN_EMAILS: ADMIN.email, TUS_ADMIN_BOOTSTRAP_CODE: BOOTSTRAP,
      TUS_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      // Fictitious sandbox credentials: every call to Mercado Pago is answered by the stand-in.
      TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'sandbox', MERCADO_PAGO_CLIENT_ID: 'app-smoke', MERCADO_PAGO_CLIENT_SECRET: 'secreto-ficticio-del-smoke',
      MERCADO_PAGO_WEBHOOK_SECRET: WEBHOOK_SECRET, MERCADO_PAGO_OAUTH_REDIRECT_URI: `${api}/tus/v1/integrations/mercado-pago/oauth/callback`, MERCADO_PAGO_NOTIFICATION_URL: 'https://api.tus.test/tus/v1/integrations/mercado-pago/webhooks',
      TUS_PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString('base64'), TUS_WEB_BASE_URL: web,
      MERCADO_PAGO_PLATFORM_ACCESS_TOKEN: PLATFORM_TOKEN, MERCADO_PAGO_PLATFORM_USER_ID: '555', TUS_MERCADOPAGO_PAYOUTS_ENABLED: 'false',
      // Nothing else external: no Meta credentials, no model.
      WHATSAPP_ENABLED: 'false', WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '', WHATSAPP_AI_ENABLED: 'false', GROQ_API_KEY: '', RAG_EMBEDDING_PROVIDER: 'none',
    }
    writeFileSync(join(raiz, '.env'), `DATABASE_URL="${databaseUrl}"\nDIRECT_URL="${databaseUrl}"\n`)
    copyFileSync(join(root, 'pnpm-workspace.yaml'), join(raiz, 'pnpm-workspace.yaml'))
    writeFileSync(join(raiz, 'arranque.mts'), ARRANQUE)
    apiChild = spawn(process.execPath, [join(apiRoot, 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', join(apiRoot, 'tsconfig.json'), join(raiz, 'arranque.mts')], { cwd: raiz, env: entorno, detached: false, windowsHide: true, stdio: ['ignore', logs.api, logs.api] })
    await esperar(`${api}/health`, apiChild, 'API')
    webChild = spawn(process.execPath, [join(webRoot, 'node_modules/next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(WEB_PORT)], { cwd: webRoot, env: { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_API_URL: api }, detached: false, windowsHide: true, stdio: ['ignore', logs.web, logs.web] })
    await esperar(web, webChild, 'Web')

    const cuentas = {}
    for (const [clave, cuenta] of [['prestador', PRESTADOR], ['cliente', CLIENTE]]) {
      const registro = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': `smoke-${clave}` }, body: JSON.stringify(cuenta) })
      check(registro.status === 201, `the account of ${clave} registers (${registro.status})`)
      const fila = psql(`UPDATE public."Account" a SET "emailVerifiedAt" = now() FROM public."User" u WHERE a."userId" = u."id" AND u."normalizedEmail" = '${cuenta.email}' RETURNING a."tenantId" || '|' || a."id" || '|' || u."id"`)
      const [tenantId = '', cuentaId = '', usuarioId = ''] = fila.stdout.split(/\r?\n/u)[0].trim().split('|')
      check(/\S/u.test(tenantId), `the API is using the disposable database (${fila.stderr.trim()})`)
      cuentas[clave] = { tenantId, cuentaId, usuarioId }
    }
    // The provider: a priced service (fixed price), a verified identity, and a second public
    // profile whose service has NO price (it is priced by a budget).
    const siembra = spawnSync(process.execPath, [join(apiRoot, 'node_modules/tsx/dist/cli.mjs'), '-'], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
      input: `(async () => {
        const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
        const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(databaseUrl)} })
        try {
          const ahora = new Date()
          const { tenantId, cuentaId, usuarioId } = ${JSON.stringify(cuentas)}.prestador
          const oficio = await prisma.oficioServicio.findFirst({ where: { activo: true }, orderBy: { orden: 'asc' } })
          await prisma.tusTenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, slug: tenantId, name: 'Prestador Smoke', status: 'active', createdAt: ahora, updatedAt: ahora } })
          await prisma.prestador.create({ data: { id: 'smoke-p', tenantId, prestadorId: 'smoke-prestador', cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', cuentaId, fechaCreacion: ahora, fechaActualizacion: ahora } })
          await prisma.perfilPublicoPrestador.create({ data: { id: 'smoke-perfil', tenantId, prestadorId: 'smoke-prestador', nombrePublico: 'Prestador Smoke', oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 20000n }] } } })
          await prisma.verificacionIdentidad.create({ data: { id: 'smoke-verificacion', tenantId, usuarioId, proveedorId: 'smoke', numeroDocumento: '30111222', metodoVerificacion: 'manual', estado: 'verified', fechaCreacion: ahora, verificadaEn: ahora, fechaActualizacion: ahora } })
          await prisma.tusTenant.create({ data: { id: 'smoke-presupuesta', slug: 'smoke-presupuesta', name: 'A Presupuestar', status: 'active', createdAt: ahora, updatedAt: ahora } })
          await prisma.prestador.create({ data: { id: 'smoke-p2', tenantId: 'smoke-presupuesta', prestadorId: 'smoke-prestador-2', cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
          await prisma.perfilPublicoPrestador.create({ data: { id: 'smoke-perfil-2', tenantId: 'smoke-presupuesta', prestadorId: 'smoke-prestador-2', nombrePublico: 'Marta A Presupuestar', oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60 }] } } })
          await prisma.verificacionIdentidad.create({ data: { id: 'smoke-verificacion-2', tenantId: 'smoke-presupuesta', usuarioId, proveedorId: 'smoke', numeroDocumento: '30111555', metodoVerificacion: 'manual', estado: 'verified', fechaCreacion: ahora, verificadaEn: ahora, fechaActualizacion: ahora } })
          console.log('SEMBRADO ' + oficio.id)
        } finally { await prisma.$disconnect() }
      })()`,
    })
    oficioId = (siembra.stdout.match(/SEMBRADO (\S+)/u) ?? [])[1] ?? ''
    check(Boolean(oficioId), `the provider gets a priced service, a verified identity and a price-less profile (${(siembra.stderr || siembra.stdout).slice(-1600)})`)

    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
    const estado = { psql, listo: false }
    let indice = 0
    for (const viewport of [{ name: 'desktop-1280', width: 1280, height: 900 }, { name: 'mobile-390', width: 390, height: 844 }]) await recorrer(browser, viewport, estado, indice++)
  } finally {
    await browser?.close()
    await stop(webChild)
    await stop(apiChild)
    closeSync(logs.api)
    closeSync(logs.web)
    if (pgIniciado) spawnSync(exe('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf8', timeout: 60_000 })
    rmSync(data, { recursive: true, force: true })
    rmSync(raiz, { recursive: true, force: true })
    console.log(`PAGOS_SERVICIOS_SMOKE total=${totals.total} pass=${totals.pass} api_pid=${apiChild?.pid ?? '-'} web_pid=${webChild?.pid ?? '-'} artifacts=${artifacts}`)
  }
}

let secretoAdmin = null

async function recorrer(browser, viewport, estado, indice) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const e = viewport.name
  const errores = []
  const http = []
  const checkouts = []
  page.on('pageerror', (error) => errores.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/u.test(message.text())) errores.push(message.text()) })
  page.on('response', (response) => { if (response.url().startsWith(api)) http.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`) })
  // The hosted checkout is never opened: the address the Web sends the client to is recorded and
  // answered here, so nothing leaves this machine.
  await context.route(/mercadopago\.com/u, async (route) => { checkouts.push(route.request().url()); await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>checkout</title><p id="checkout-simulado">Checkout simulado</p>' }) })
  const sinDesborde = async (donde) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${e}: ${donde} does not scroll sideways`)
  const llamar = (method, path, body) => page.evaluate(async ({ api, method, path, body }) => {
    const response = await fetch(api + path, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }, { api, method, path, body })
  const entrar = async (cuenta, quien, modo) => {
    check((await llamar('POST', '/auth/sign-in', { email: cuenta.email, password: cuenta.password })).status === 200, `${e}: ${quien} signs in`)
    if (modo) check((await llamar('POST', '/auth/session/mode', { mode: modo })).status === 200, `${e}: ${quien} works as ${modo}`)
  }
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
  const inicio = (hora) => new Date(`${sumar(lunes, indice)}T${hora}:00.000-03:00`).toISOString()
  const texto = async (locator) => (await locator.innerText()).replace(/\s+/gu, ' ')
  // Mercado Pago approves the payment of the checkout that was just opened and notifies the API.
  const aprobar = async (quePago) => {
    const pago = await (await fetch(`${control}/pagar?pref=${encodeURIComponent(new URL(checkouts.at(-1)).searchParams.get('pref_id'))}`, { method: 'POST' })).json()
    const aviso = await fetch(`${api}/tus/v1/integrations/mercado-pago/webhooks?data.id=${pago.id}&type=payment`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': pago.signature, 'x-request-id': pago.requestId }, body: JSON.stringify(pago.body) })
    const resultado = await aviso.text()
    check(aviso.status === 200 && /"result":"applied"/u.test(resultado), `${e}: the verified notification of ${quePago} is applied (${aviso.status} ${resultado.slice(0, 200)})`)
    return pago
  }
  const elTurno = (id) => page.locator(`[data-turno-id="${id}"]`)
  const misTurnos = async (id) => { await page.goto(`${web}/mis-turnos`, { waitUntil: 'networkidle' }); await elTurno(id).waitFor() }
  const comoPrestador = async () => { await entrar(PRESTADOR, 'the provider', 'PROVIDER'); await page.goto(`${web}/prestador/turnos`, { waitUntil: 'networkidle' }) }
  const filaPrestador = (hora) => page.locator('li, article, div').filter({ has: page.locator('[data-turno-cobro]') }).filter({ hasText: hora }).last()
  // The turno already happened (a turno can only be requested in the future): its time is moved
  // back in the disposable database, as if the day had come.
  const yaOcurrio = (id) => check(estado.psql(`UPDATE public."reservas" SET "fecha_inicio" = "fecha_inicio" - interval '21 days', "fecha_fin" = "fecha_fin" - interval '21 days' WHERE "id" = '${id}' RETURNING 'ok'`).stdout.includes('ok'), `${e}: the day of the turno arrives`)
  try {
    await page.goto(`${web}/ayuda`, { waitUntil: 'domcontentloaded' })
    if (!estado.listo) {
      await entrar(PRESTADOR, 'the provider'); await completarPerfil('Gabriela', 'Lopez', '30111222'); await salir('the provider')
      await entrar(CLIENTE, 'the client'); await completarPerfil('Ana', 'Cliente', '30111333'); await salir('the client')
      // The administrator turns online payments on.
      check((await llamar('POST', '/auth/register', ADMIN)).status < 300, 'the administrator registers')
      check((await llamar('POST', '/auth/admin/bootstrap-verify', { email: ADMIN.email, code: BOOTSTRAP })).status === 204, 'the bootstrap code verifies the administrator email')
      await entrar(ADMIN, 'the administrator')
      const alta = await llamar('POST', '/auth/mfa/enroll')
      check(alta.status === 201 && typeof alta.body?.secret === 'string', `MFA enrollment starts (${alta.status})`)
      secretoAdmin = alta.body.secret
      check((await llamar('POST', '/auth/mfa/enroll/confirm', { enrollmentId: alta.body.enrollmentId, code: totp(secretoAdmin) })).status < 300, 'MFA is confirmed and the session elevated')
      const encendido = await llamar('POST', '/tus/v1/admin/payments/configuration', { paymentsEnabled: true, reason: 'smoke de pagos de servicios', expectedVersion: 0 })
      check(encendido.status === 201, `online payments are turned on (${encendido.status} ${JSON.stringify(encendido.body).slice(0, 200)})`)
      await salir('the administrator')
      estado.listo = true
    }

    // ---- 1. A service without a price: it is priced by a budget, no turno can be requested.
    await entrar(CLIENTE, 'the client')
    await page.goto(`${web}/trabajadores/smoke-perfil-2`, { waitUntil: 'networkidle' })
    const pedirTurno = page.getByRole('button', { name: /turno/iu }).first()
    if (await pedirTurno.count()) await pedirTurno.click()
    const aviso = page.locator('[data-servicio-a-presupuestar]')
    await aviso.waitFor()
    check((await texto(aviso)).includes('se presupuesta') && (await texto(aviso)).includes('Solicitar servicio'), `${e}: the price-less service says it is priced by a budget and where to ask for it (${await texto(aviso)})`)
    check((await page.getByText('$', { exact: false }).locator('visible=true').filter({ hasText: /Seña|Precio:/u }).count()) === 0, `${e}: no price or deposit is invented for it`)
    const directo = await llamar('POST', '/tus/v1/prestadores/smoke-perfil-2/turnos/solicitudes', { oficioId, inicio: inicio('09:00') })
    check(directo.status === 409 && directo.body.code === 'SERVICE_REQUIRES_BUDGET', `${e}: the API refuses the turno and sends to the budget flow (${directo.status} ${directo.body?.code})`)
    await sinDesborde('the price-less profile')
    await page.screenshot({ path: join(artifacts, `${e}-servicio-a-presupuestar.png`), fullPage: true })

    // ---- 2. Two turnos of the priced service; the provider accepts both.
    const pedidos = {}
    for (const [clave, hora] of [['total', '10:00'], ['sena', '11:00']]) {
      const pedido = await llamar('POST', '/tus/v1/prestadores/smoke-perfil/turnos/solicitudes', { oficioId, inicio: inicio(hora) })
      check(pedido.status === 201 && pedido.body.estado === 'pending', `${e}: the request of ${hora} is pending (${pedido.status} ${pedido.body?.code ?? ''})`)
      pedidos[clave] = pedido.body.id
    }
    await salir('the client')
    await entrar(PRESTADOR, 'the provider', 'PROVIDER')
    for (const id of Object.values(pedidos)) {
      const acepto = await llamar('POST', `/tus/v1/prestador/turnos/${id}/aceptar`)
      check(acepto.status === 200 && acepto.body.estado === 'awaiting_payment', `${e}: accepting opens the payment (${acepto.status} ${acepto.body?.estado ?? acepto.body?.code})`)
    }
    await salir('the provider')

    // ---- 3. The client chooses: the total for one, the deposit for the other.
    await entrar(CLIENTE, 'the client')
    await misTurnos(pedidos.total)
    const modalidad = elTurno(pedidos.total).locator('[data-turno-modalidad]')
    await modalidad.waitFor()
    const opciones = await texto(modalidad)
    check(opciones.includes('Pagar seña') && opciones.includes('10.000') && opciones.includes('Pagar total') && opciones.includes('20.000'), `${e}: deposit or total, with the amounts of the API (${opciones})`)
    await sinDesborde('Mis turnos with the choice')
    await page.screenshot({ path: join(artifacts, `${e}-cliente-elige.png`), fullPage: true })
    await modalidad.getByLabel(/Pagar total/u).check()
    await elTurno(pedidos.total).locator('[data-pagar="total"]').click()
    await page.locator('#checkout-simulado').waitFor()
    check(checkouts.length === 1 && /pref_id=pref-smoke-/u.test(checkouts[0]), `${e}: the Web sends to the hosted checkout (${checkouts.at(-1)})`)
    const pagoTotal = await aprobar('the total')
    check(pagoTotal.monto === 20000, `${e}: the checkout of the total charges the whole price (${pagoTotal.monto})`)
    await misTurnos(pedidos.total)
    await elTurno(pedidos.total).locator('[data-turno-pago="total"]').waitFor()
    check((await elTurno(pedidos.total).getAttribute('data-turno')) === 'confirmed' && (await elTurno(pedidos.total).locator('[data-turno-modalidad]').count()) === 0, `${e}: paid in total: confirmed, and the choice is closed`)
    check(!(await texto(elTurno(pedidos.total))).includes('Saldo pendiente'), `${e}: a turno paid in total has no balance`)
    await elTurno(pedidos.sena).locator('[data-pagar="sena"]').click()
    await page.locator('#checkout-simulado').waitFor()
    const pagoSena = await aprobar('the deposit')
    check(pagoSena.monto === 10000, `${e}: the checkout of the deposit charges half (${pagoSena.monto})`)
    await misTurnos(pedidos.sena)
    await elTurno(pedidos.sena).locator('[data-turno-pago="sena"]').waitFor()
    const conSena = await texto(elTurno(pedidos.sena))
    check((await elTurno(pedidos.sena).getAttribute('data-turno')) === 'confirmed' && conSena.includes('Saldo pendiente') && conSena.includes('10.000'), `${e}: paid the deposit: confirmed, with its balance (${conSena.slice(0, 220)})`)
    await sinDesborde('Mis turnos paid')
    await page.screenshot({ path: join(artifacts, `${e}-cliente-pagado.png`), fullPage: true })
    await salir('the client')

    // ---- 4. The provider: money retained, and "Finalizar turno" with evidence.
    yaOcurrio(pedidos.total)
    yaOcurrio(pedidos.sena)
    await comoPrestador()
    await page.locator('[data-turno-cobro="retenidos"]').first().waitFor()
    check((await page.locator('[data-turno-cobro="retenidos"]').count()) >= 2 && (await texto(page.locator('[data-turno-cobro="retenidos"]').first())).includes('Retenido hasta que el turno se cierre'), `${e}: the provider sees the money collected and retained`)
    const manual = await llamar('PATCH', `/tus/v1/prestador/turnos/${pedidos.total}/estado`, { estado: 'completed' })
    check(manual.status === 409 && manual.body.code === 'FINALIZATION_REQUIRED', `${e}: a turno paid through TUS cannot be completed by hand (${manual.status} ${manual.body?.code})`)
    // (Turnos of a previous viewport may already be waiting for their client.)
    const yaFinalizados = await page.locator('[data-turno-cierre]').count()
    for (const _ of [0, 1]) {
      await page.locator('[data-finalizar]').first().click()
      const evidencia = page.locator('textarea').first()
      check(await page.getByRole('button', { name: 'Confirmar finalización' }).isDisabled(), `${e}: finishing asks for what was done`)
      await evidencia.fill('Se realizó el servicio completo en el domicilio.')
      await page.getByRole('button', { name: 'Confirmar finalización' }).click()
      await page.waitForFunction((n) => document.querySelectorAll('[data-turno-cierre]').length >= n && !document.querySelector('textarea'), yaFinalizados + _ + 1)
    }
    check((await page.locator('[data-finalizar]').count()) === 0 && (await page.getByRole('button', { name: 'Cancelar', exact: true }).count()) === 0, `${e}: a finished turno is not finished twice nor cancelled from the list`)
    check((await texto(page.locator('[data-turno-cierre="esperando"]').first())).includes('Esperando la confirmación del cliente'), `${e}: finished, waiting for the client (with the date it confirms itself)`)
    check((await page.locator('[data-turno-cobro="liberados"]').count()) === indice, `${e}: finishing releases nothing by itself`)
    await sinDesborde('the provider turnos')
    await page.screenshot({ path: join(artifacts, `${e}-prestador-finalizado.png`), fullPage: true })
    await salir('the provider')

    // ---- 5. The client confirms the one paid with a deposit and pays its balance; reports a
    // problem on the one paid in total. (The balance is payable once the closing is confirmed.)
    await entrar(CLIENTE, 'the client')
    await misTurnos(pedidos.sena)
    await elTurno(pedidos.sena).locator('[data-turno-cierre="por-confirmar"]').waitFor()
    check((await texto(elTurno(pedidos.sena).locator('[data-turno-cierre="por-confirmar"]'))).includes('se confirma automáticamente'), `${e}: the client is told it confirms itself after the deadline`)
    check((await elTurno(pedidos.sena).locator('[data-pagar="saldo"]').count()) === 0, `${e}: the balance is not asked before the closing is confirmed`)
    await page.screenshot({ path: join(artifacts, `${e}-cliente-por-confirmar.png`), fullPage: true })
    await elTurno(pedidos.sena).getByRole('button', { name: 'Confirmar que se realizó' }).click()
    await elTurno(pedidos.sena).locator('[data-turno-cierre="confirmado"]').waitFor()
    check((await texto(elTurno(pedidos.sena))).includes('Confirmaste que el turno se realizó'), `${e}: the client confirmed`)
    await elTurno(pedidos.sena).locator('[data-pagar="saldo"]').waitFor()
    check((await texto(elTurno(pedidos.sena).locator('[data-pagar="saldo"]'))).includes('10.000'), `${e}: the balance is what is left`)
    await page.screenshot({ path: join(artifacts, `${e}-cliente-saldo.png`), fullPage: true })
    await elTurno(pedidos.sena).locator('[data-pagar="saldo"]').click()
    await page.locator('#checkout-simulado').waitFor()
    const pagoSaldo = await aprobar('the balance')
    check(pagoSaldo.monto === 10000, `${e}: the balance checkout charges what is left, never more (${pagoSaldo.monto})`)
    await misTurnos(pedidos.sena)
    await page.waitForFunction((id) => !document.querySelector(`[data-turno-id="${id}"] [data-pagar="saldo"]`), pedidos.sena)
    check(!(await texto(elTurno(pedidos.sena))).includes('Saldo pendiente'), `${e}: with the balance paid nothing is left to pay`)
    await elTurno(pedidos.total).getByRole('button', { name: 'Reportar un problema' }).click()
    check(await elTurno(pedidos.total).getByRole('button', { name: 'Enviar el problema' }).isDisabled(), `${e}: a problem needs its description`)
    await elTurno(pedidos.total).locator('textarea').fill(`El trabajo quedó incompleto (${e}).`)
    await elTurno(pedidos.total).getByRole('button', { name: 'Enviar el problema' }).click()
    await page.waitForFunction((id) => !document.querySelector(`[data-turno-id="${id}"] [data-turno-cierre="por-confirmar"]`), pedidos.total)
    await sinDesborde('Mis turnos after the closing')
    await page.screenshot({ path: join(artifacts, `${e}-cliente-cierre.png`), fullPage: true })
    await salir('the client')

    // ---- 6. The provider: one released, the other observed and still retained.
    await comoPrestador()
    await page.locator('[data-turno-cobro="liberados"]').first().waitFor()
    // (Each previous viewport left one turno released and one, reported and resolved, still retained.)
    check((await page.locator('[data-turno-cobro="liberados"]').count()) === indice + 1 && (await texto(page.locator('[data-turno-cobro="liberados"]').first())).includes('20.000'), `${e}: the confirmed turno, paid deposit plus balance, is released`)
    const observado = page.locator('[data-turno-cierre="observado"]')
    check((await observado.count()) === 1 && (await texto(observado)).includes('los fondos siguen retenidos') && (await page.locator('[data-turno-cobro="retenidos"]').count()) === indice + 1, `${e}: the reported turno stays retained although it is fully paid`)
    await page.screenshot({ path: join(artifacts, `${e}-prestador-liberado-y-observado.png`), fullPage: true })
    await salir('the provider')

    // ---- 7. Admin -> Pagos: the problem, and its resolution.
    await entrar(ADMIN, 'the administrator')
    await new Promise((resolve) => setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500))
    check((await llamar('POST', '/auth/mfa/verify', { code: totp(secretoAdmin) })).status < 300, `${e}: MFA step-up`)
    await page.goto(`${web}/tus/admin/pagos`, { waitUntil: 'networkidle' })
    const problemas = page.locator('[data-observaciones]')
    const fila = problemas.locator('tr').filter({ hasText: `(${e})` })
    await fila.waitFor()
    check((await texto(fila)).includes('El trabajo quedó incompleto') && (await texto(fila)).includes('Se realizó el servicio completo'), `${e}: Admin reads the problem and what the provider said (${(await texto(fila)).slice(0, 220)})`)
    await sinDesborde('Admin -> Pagos')
    await page.screenshot({ path: join(artifacts, `${e}-admin-observaciones.png`), fullPage: true })
    await fila.getByRole('button', { name: 'Marcar como resuelto' }).click()
    await page.waitForFunction((marca) => ![...document.querySelectorAll('[data-observaciones] tr')].some((tr) => tr.textContent.includes(marca)), `(${e})`)
    await salir('the administrator')
    const cierres = estado.psql(`SELECT count(*) FILTER (WHERE "confirmado_en" IS NOT NULL) || '/' || count(*) FROM public."cierres_trabajo"`).stdout.trim()
    const liquidaciones = estado.psql(`SELECT count(*) FILTER (WHERE "liberada_en" IS NOT NULL) || '/' || count(*) FROM public."liquidaciones_servicio"`).stdout.trim()
    console.log(`${e}: cierres confirmados ${cierres}, liquidaciones liberadas ${liquidaciones}`)

    const fallidas = http.filter((linea) => /\s(4\d\d|5\d\d)$/u.test(linea) && !ESPERADOS.some((esperado) => esperado.test(linea)))
    check(fallidas.length === 0, `${e}: unexpected HTTP errors: ${fallidas.join(' | ')}`)
    check(errores.length === 0, `${e}: console/page errors: ${errores.join(' | ')}`)
  } catch (error) {
    await page.screenshot({ path: join(artifacts, `${e}-failed.png`), fullPage: true }).catch(() => undefined)
    console.error(`${e} url=${page.url()} http=${http.slice(-12).join(' | ')} errors=${errores.join(' | ')}`)
    throw error
  } finally {
    await context.close()
  }
}

// Refusals this smoke asks for on purpose.
const ESPERADOS = [/\/auth\/session 401$/u, /\/auth\/refresh 401$/u, /smoke-perfil-2\/turnos\/solicitudes 409$/u, /\/turnos\/[^/]+\/estado 4\d\d$/u]

await main()
