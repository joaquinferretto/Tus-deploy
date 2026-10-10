import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'

// Browser smoke of TURNOS-WHATSAPP-01 and PRESTADOR-CUENTA-01 (docs/TURNOS_WHATSAPP_TUS.md,
// docs/ADMIN_CONTACTO_WHATSAPP_TUS.md) against the REAL local API and the production Web build, on
// a disposable PostgreSQL 16 with every migration, on desktop and mobile:
// - Admin: the table of providers (public name, linked account, phone, WhatsApp) and the sheet
//   ("Cuenta asociada" / "Perfil profesional"), for a provider that is ready and for one nobody
//   linked to an account;
// - Turnos: requests with 0, 1 and 2 pictures, the refusal of a third and of a file that is not a
//   picture, the pictures as the client and the provider see them, and the states of the turno.
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
const WEB_PORT = 3218
const PG_PORT = String(57600 + Math.floor(Math.random() * 400))
const api = `http://localhost:${API_PORT}`
const web = `http://localhost:${WEB_PORT}`
const artifacts = join(tmpdir(), `tus-turnos-admin-${Date.now()}`)
const CLAVE = 'una frase larga y segura 2026'
const CLIENTE = { email: 'cliente-smoke@example.com', password: CLAVE, displayName: 'Cliente Smoke' }
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
  const data = mkdtempSync(join(tmpdir(), 'tus-pg16-turnos-'))
  const raiz = mkdtempSync(join(tmpdir(), 'tus-raiz-turnos-'))
  const abrir = (nombre) => openSync(join(artifacts, nombre), 'a')
  const logs = { api: abrir('api.log'), web: abrir('web.log') }
  let pgIniciado = false
  let apiChild
  let webChild
  let browser
  const psql = (sql) => spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'tus_turnos_admin', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })
  try {
    const init = spawnSync(exe('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { encoding: 'utf8' })
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`)
    const start = spawnSync(exe('pg_ctl'), ['-D', data, '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c fsync=off -c lc_messages=C`, '-l', join(data, 'server.log'), '-w', 'start'], { encoding: 'utf8', timeout: 120_000 })
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stdout}${start.stderr}`)
    pgIniciado = true
    const creada = spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE tus_turnos_admin'], { encoding: 'utf8' })
    if (creada.status !== 0) throw new Error(`create database: ${creada.stderr}`)
    const databaseUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/tus_turnos_admin`
    const migrate = spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl }, timeout: 600_000 })
    if (migrate.status !== 0) throw new Error(`migrate-deploy failed: ${(migrate.stdout + migrate.stderr).slice(-800)}`)

    const entorno = {
      ...process.env,
      NODE_ENV: 'development', FACTORY_PROFILE: 'local', NATIVE_PROFILE: '1',
      DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, API_PORT: String(API_PORT), PORT: String(API_PORT),
      CORS_ORIGINS: web, TUS_ROUTES_ENABLED: 'true', TUS_PROVIDER_ACTIONS_ENABLED: 'false',
      TUS_PLATFORM_ADMIN_EMAILS: ADMIN.email, TUS_ADMIN_BOOTSTRAP_CODE: BOOTSTRAP,
      TUS_MFA_ENCRYPTION_KEY: process.env.TUS_MFA_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64'),
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
    const cuenta = psql(`UPDATE public."Account" a SET "emailVerifiedAt" = now() FROM public."User" u WHERE a."userId" = u."id" AND u."normalizedEmail" = '${PRESTADOR.email}' RETURNING a."tenantId" || '|' || a."id"`)
    // psql on Windows ends its lines with CRLF: the id is the first line, without the carriage return.
    const [tenantId = '', cuentaId = ''] = cuenta.stdout.split(/\r?\n/u)[0].trim().split('|')
    check(/\S/u.test(tenantId), `the API is using the disposable database (${cuenta.stderr.trim()})`)
    const siembra = spawnSync(process.execPath, [join(apiRoot, 'node_modules/tsx/dist/cli.mjs'), '-'], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
      input: `(async () => {
        const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
        const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(databaseUrl)} })
        try {
          const ahora = new Date(); const tenantId = ${JSON.stringify(tenantId)}; const cuentaId = ${JSON.stringify(cuentaId)}
          const oficio = await prisma.oficioServicio.findFirst({ where: { activo: true }, orderBy: { orden: 'asc' } })
          await prisma.tusTenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, slug: tenantId, name: 'Prestador Smoke', status: 'active', createdAt: ahora, updatedAt: ahora } })
          await prisma.prestador.create({ data: { id: 'smoke-p', tenantId, prestadorId: 'smoke-prestador', cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', cuentaId, fechaCreacion: ahora, fechaActualizacion: ahora } })
          await prisma.perfilPublicoPrestador.create({ data: { id: 'smoke-perfil', tenantId, prestadorId: 'smoke-prestador', nombrePublico: 'Prestador Smoke', tipoPrestador: 'empresa', oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 15000n }] } } })
          // The provider's account: a verified phone and its WhatsApp linked, with a message an hour ago.
          const cuenta = await prisma.account.findUnique({ where: { id: cuentaId } })
          await prisma.user.update({ where: { id: cuenta.userId }, data: { phoneNumber: '+5493794551234', phoneVerifiedAt: ahora } })
          await prisma.contactoWhatsapp.create({ data: { id: 'smoke-contacto', canal: 'whatsapp', waId: '5493794551234', cuentaVinculadaId: cuentaId, tenantVinculadoId: tenantId, vinculadoEn: ahora, fechaCreacion: ahora } })
          await prisma.conversacionWhatsapp.create({ data: { id: 'smoke-conversacion', contactoId: 'smoke-contacto', canal: 'whatsapp', estado: 'active', modo: 'bot', abiertaEn: ahora, ultimoMensajeEn: ahora, ultimoEntranteEn: new Date(Date.now() - 3600_000), estadoConversacional: {} } })
          // A second provider nobody linked to an account (an old row): Admin has to say so.
          await prisma.tusTenant.create({ data: { id: 'smoke-huerfano', slug: 'smoke-huerfano', name: 'Huérfano', status: 'active', createdAt: ahora, updatedAt: ahora } })
          await prisma.prestador.create({ data: { id: 'smoke-p2', tenantId: 'smoke-huerfano', prestadorId: 'smoke-prestador-2', cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
          await prisma.perfilPublicoPrestador.create({ data: { id: 'smoke-perfil-2', tenantId: 'smoke-huerfano', prestadorId: 'smoke-prestador-2', nombrePublico: 'Perfil Sin Cuenta', oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 15000n }] } } })
          console.log('SEMBRADO ' + oficio.id)
        } finally { await prisma.$disconnect() }
      })()`,
    })
    oficioId = (siembra.stdout.match(/SEMBRADO (\S+)/u) ?? [])[1] ?? ''
    check(/SEMBRADO /u.test(siembra.stdout), `the provider gets a profile with one service (${(siembra.stderr || siembra.stdout).slice(-1600)})`)

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
    console.log(`TURNOS_ADMIN_SMOKE total=${totals.total} pass=${totals.pass} api_pid=${apiChild?.pid ?? '-'} web_pid=${webChild?.pid ?? '-'} artifacts=${artifacts}`)
  }
}

let secretoAdmin = null
let perfilesCompletos = false

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
  // A raw file, as the Web sends a picture.
  const subirCrudo = (path, bytes) => page.evaluate(async ({ api, path, bytes }) => {
    const response = await fetch(api + path, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream', 'X-Correlation-Id': crypto.randomUUID() }, body: new Uint8Array(bytes) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }, { api, path, bytes: [...bytes] })
  const entrar = async (cuenta, quien) => check((await llamar('POST', '/auth/sign-in', { email: cuenta.email, password: cuenta.password })).status === 200, `${e}: ${quien} signs in`)
  const salir = async (quien) => check((await llamar('POST', '/auth/sign-out')).status < 300, `${e}: ${quien} signs out`)
  const completarPerfil = async (documento) => {
    if (perfilesCompletos) return
    const pais = (await llamar('GET', '/tus/v1/geografia/paises')).body.items[0]
    const provincia = (await llamar('GET', `/tus/v1/geografia/provincias?paisId=${encodeURIComponent(pais.id)}`)).body.items[0]
    const localidad = (await llamar('GET', `/tus/v1/geografia/localidades?provinciaId=${encodeURIComponent(provincia.id)}`)).body.items[0]
    const perfil = await llamar('PUT', '/tus/v1/perfil', { nombre: documento === '30111222' ? 'Gabriela' : 'Carla', apellido: documento === '30111222' ? 'López' : 'Cliente', tipoDocumento: 'DNI', numeroDocumento: documento, localidadId: localidad.id, calle: 'San Martín', numero: '1234', codigoPostal: '3400' })
    check(perfil.status === 200, `the personal profile is complete (${perfil.status})`)
  }
  // Each viewport uses its own day of next week, so its three requests do not collide.
  const indice = viewport.width < 700 ? 1 : 0
  const inicio = (hora) => new Date(`${sumar(lunes, indice)}T${hora}:00.000-03:00`).toISOString()
  try {
    await page.goto(`${web}/ayuda`, { waitUntil: 'domcontentloaded' })

    // ---- 0. The accounts have a personal profile (the real name Admin shows).
    await entrar(PRESTADOR, 'the provider')
    await completarPerfil('30111222')
    await salir('the provider')
    await entrar(CLIENTE, 'the client')
    await completarPerfil('30111333')
    perfilesCompletos = true

    // ---- 1. The client requests three turnos and adds 0, 1 and 2 pictures.
    const pedidos = []
    for (const hora of ['10:00', '11:00', '12:00']) {
      const pedido = await llamar('POST', '/tus/v1/prestadores/smoke-perfil/turnos/solicitudes', { oficioId, inicio: inicio(hora) })
      check(pedido.status === 201 && pedido.body.estado === 'pending', `${e}: the request of ${hora} is pending (${pedido.status} ${pedido.body?.code ?? ''})`)
      pedidos.push(pedido.body.id)
    }
    await page.goto(`${web}/mis-turnos`, { waitUntil: 'networkidle' })
    const tarjeta = (id) => page.locator(`li[data-turno-id="${id}"]`)
    for (const id of pedidos) await tarjeta(id).waitFor()
    check((await tarjeta(pedidos[0]).locator('[data-foto-turno]').count()) === 0 && (await tarjeta(pedidos[0]).locator('[data-fotos-turno-agregar]').count()) === 1, `${e}: a request without pictures offers to add one`)
    const agregar = async (id, bytes, nombre = 'foto.png') => tarjeta(id).locator('[data-fotos-turno-archivo]').setInputFiles({ name: nombre, mimeType: 'image/png', buffer: bytes })
    const cargadas = (id, n) => page.waitForFunction(({ id, n }) => { const fotos = [...document.querySelectorAll(`li[data-turno-id="${id}"] img[data-foto-turno]`)]; return fotos.length === n && fotos.every((img) => img.complete && img.naturalWidth > 0) }, { id, n })
    await agregar(pedidos[1], png(300, 220))
    await cargadas(pedidos[1], 1)
    check((await tarjeta(pedidos[1]).locator('[data-fotos-turno]').getAttribute('data-fotos-turno')) === '1', `${e}: one picture is attached and shown`)
    await agregar(pedidos[2], png(320, 240))
    await cargadas(pedidos[2], 1)
    await agregar(pedidos[2], png(360, 240))
    await cargadas(pedidos[2], 2)
    check((await tarjeta(pedidos[2]).locator('[data-fotos-turno-agregar]').count()) === 0, `${e}: with two pictures there is nothing more to add`)
    // A third picture and a file that is not a picture are refused by the API.
    const tercera = await subirCrudo(`/tus/v1/cliente/turnos/${pedidos[2]}/imagenes`, png(400, 240))
    check(tercera.status === 409 && (tercera.body?.code ?? tercera.body?.error?.code) === 'TOO_MANY_IMAGES', `${e}: a third picture is refused (${tercera.status} ${JSON.stringify(tercera.body).slice(0, 80)})`)
    await agregar(pedidos[0], Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'dibujo.png')
    await tarjeta(pedidos[0]).getByRole('alert').waitFor()
    check((await tarjeta(pedidos[0]).locator('[data-foto-turno]').count()) === 0, `${e}: a file that is not a picture is refused and explained`)
    const reales = await llamar('GET', '/tus/v1/cliente/turnos')
    check(JSON.stringify(pedidos.map((id) => reales.body.items.find((t) => t.id === id)?.imagenes)) === '[0,1,2]', `${e}: the API holds 0, 1 and 2 pictures`)
    await sinDesborde('"Mis turnos" with pictures')
    await page.screenshot({ path: join(artifacts, `${e}-mis-turnos-fotos.png`), fullPage: true })
    await salir('the client')

    // ---- 2. The provider sees the requests with their pictures and answers them.
    await entrar(PRESTADOR, 'the provider')
    check((await llamar('POST', '/auth/session/mode', { mode: 'PROVIDER' })).status === 200, `${e}: the account works as a provider`)
    await page.goto(`${web}/prestador/turnos`, { waitUntil: 'networkidle' })
    for (const [posicion, id] of pedidos.entries()) {
      await page.locator(`[data-solicitud="${id}"]`).waitFor()
      await page.waitForFunction(({ id, n }) => { const fotos = [...document.querySelectorAll(`[data-solicitud="${id}"] img[data-foto-turno]`)]; return fotos.length === n && fotos.every((img) => img.complete && img.naturalWidth > 0) }, { id, n: posicion })
    }
    check(true, `${e}: the provider sees each request with its 0, 1 and 2 pictures`)
    await sinDesborde('"Solicitudes de reserva" with pictures')
    await page.screenshot({ path: join(artifacts, `${e}-solicitudes-fotos.png`), fullPage: true })
    // Somebody else cannot read a picture: the client's session was closed, this is the provider;
    // an anonymous request gets nothing.
    const anonima = await fetch(`${api}/tus/v1/turnos/${pedidos[1]}/imagenes/0`, { headers: { 'x-correlation-id': 'smoke-anon' } })
    check(anonima.status === 401, `${e}: a picture is not served without a session (${anonima.status})`)
    const rechazo = await llamar('POST', `/tus/v1/prestador/turnos/${pedidos[0]}/rechazar`)
    const acepto = await llamar('POST', `/tus/v1/prestador/turnos/${pedidos[2]}/aceptar`)
    check(rechazo.status === 200 && rechazo.body.estado === 'rejected', `${e}: the provider rejects one (${rechazo.status})`)
    check(acepto.status === 200 && ['confirmed', 'awaiting_payment'].includes(acepto.body.estado), `${e}: the provider accepts another (${acepto.status} ${acepto.body?.estado ?? acepto.body?.code})`)
    await salir('the provider')

    // ---- 3. The client reads the three states in "Mis turnos".
    await entrar(CLIENTE, 'the client')
    await page.goto(`${web}/mis-turnos`, { waitUntil: 'networkidle' })
    await tarjeta(pedidos[1]).waitFor()
    const estados = await Promise.all(pedidos.map((id) => tarjeta(id).getAttribute('data-turno')))
    check(estados[0] === 'rejected' && estados[1] === 'pending' && estados[2] === acepto.body.estado, `${e}: "Mis turnos" shows rejected, pending and accepted (${estados.join()})`)
    check((await tarjeta(pedidos[0]).locator('[data-fotos-turno-agregar]').count()) === 0, `${e}: a request that was answered takes no more pictures`)
    await cargadas(pedidos[2], 2)
    await sinDesborde('"Mis turnos" with the three states')
    await page.screenshot({ path: join(artifacts, `${e}-mis-turnos-estados.png`), fullPage: true })
    // The request left waiting is withdrawn: one client cannot keep an agenda waiting, and the
    // next viewport asks again.
    check((await llamar('POST', `/tus/v1/cliente/turnos/${pedidos[1]}/cancelar`)).status === 200, `${e}: the client withdraws the request that was still waiting`)
    await salir('the client')

    // ---- 4. Admin: the table of providers and the sheet.
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
      // A code is single use: wait for the next 30 second window.
      await new Promise((resolve) => setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500))
      check((await llamar('POST', '/auth/mfa/verify', { code: totp(secretoAdmin) })).status < 300, `${e}: MFA step-up`)
    }
    await page.goto(`${web}/tus/admin/prestadores`, { waitUntil: 'networkidle' })
    const fila = page.locator('tr').filter({ hasText: 'Prestador Smoke' })
    await fila.waitFor()
    const cabecera = await page.locator('thead').innerText().catch(() => '')
    const textoFila = (await fila.innerText()).replace(/\s+/gu, ' ')
    check(['Nombre público', 'Cuenta', 'Teléfono', 'WhatsApp'].every((titulo) => cabecera.toLowerCase().includes(titulo.toLowerCase()) || viewport.width < 700), `${e}: the table has the new columns (${cabecera.replace(/\s+/gu, ' ')})`)
    check(textoFila.includes('Gabriela López') && textoFila.includes(PRESTADOR.email), `${e}: the row shows the real name and email of the linked account (${textoFila.slice(0, 220)})`)
    check(textoFila.includes('Verificado') && /\+549379/u.test(textoFila) && !textoFila.includes('+5493794551234'), `${e}: the phone is shown masked and verified`)
    check((await fila.locator('[data-whatsapp-destino]').getAttribute('data-whatsapp-destino')) === 'listo', `${e}: the provider is ready to receive requests on WhatsApp`)
    const huerfana = page.locator('tr').filter({ hasText: 'Perfil Sin Cuenta' })
    check((await huerfana.locator('[data-cuenta-problema]').getAttribute('data-cuenta-problema')) === 'sin_vincular' && (await huerfana.locator('[data-whatsapp-destino]').getAttribute('data-whatsapp-destino')) === 'sin_cuenta', `${e}: a provider nobody linked to an account is flagged`)
    await sinDesborde('the table of providers')
    await page.screenshot({ path: join(artifacts, `${e}-admin-prestadores.png`), fullPage: true })
    // The sheet: account and professional profile, apart.
    await page.goto(`${web}/tus/admin/prestadores/smoke-perfil`, { waitUntil: 'networkidle' })
    const asociada = page.locator('section[aria-labelledby="prestador-cuenta"]')
    await asociada.getByText('Nombre real').waitFor()
    const textoCuenta = (await asociada.innerText()).replace(/\s+/gu, ' ')
    check(['Cuenta asociada', 'Gabriela López', PRESTADOR.email, 'DNI 30111222', 'Verificado', 'Vinculado', 'Listo', 'Activa', 'Diagnóstico'].every((dato) => textoCuenta.includes(dato)), `${e}: "Cuenta asociada" shows name, email, document, phone, WhatsApp and state (${textoCuenta.slice(0, 400)})`)
    check((await asociada.locator('[data-whatsapp-destino]').getAttribute('data-whatsapp-destino')) === 'listo', `${e}: the sheet says the provider is ready on WhatsApp`)
    const cuerpo = (await page.locator('main').innerText()).replace(/\s+/gu, ' ')
    check(cuerpo.includes('Perfil profesional') && cuerpo.includes('Nombre público'), `${e}: the professional profile is a separate section and its name is labelled as public`)
    await sinDesborde('the sheet of a provider')
    await page.screenshot({ path: join(artifacts, `${e}-admin-prestador-ficha.png`), fullPage: true })
    await page.goto(`${web}/tus/admin/prestadores/smoke-perfil-2`, { waitUntil: 'networkidle' })
    await page.locator('[data-cuenta-problema="sin_vincular"]').waitFor()
    check((await page.locator('section[aria-labelledby="prestador-cuenta"]').innerText()).includes('no tiene una cuenta vinculada'), `${e}: the sheet of an unlinked provider warns about it`)
    await sinDesborde('the sheet of an unlinked provider')
    await salir('the administrator')

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

// What the smoke provokes on purpose: a third picture and a file that is not one.
const ESPERADOS = [/\/imagenes 409$/u, /\/imagenes 415$/u, /\/auth\/session 401$/u, /\/auth\/refresh 401$/u]

await main()
