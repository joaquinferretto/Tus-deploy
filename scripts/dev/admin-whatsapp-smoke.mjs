import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'

// Browser smoke of ADMIN-WHATSAPP-AVISOS-01 (docs/ADMIN_CONTACTO_WHATSAPP_TUS.md) against the REAL
// local API and the production Web build, on a disposable PostgreSQL 16 with every migration, on
// desktop (1280) and mobile (390):
// - the inbox: the list takes the height, its pagination is a compact footer of the panel (one row
//   on desktop, at most two at 390 px) and really pages (pages, page size, filter, total), keeping
//   the open conversation;
// - the notice to the provider of each request a conversation made: who, which masked number, how
//   far it got, why it was not sent, what the provider answered; and the provider's own
//   conversation with the message as it left.
// The requests and their notices are made by the real API (no Meta credentials: the module records
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
const WEB_PORT = 3219
const PG_PORT = String(57600 + Math.floor(Math.random() * 400))
const api = `http://localhost:${API_PORT}`
const web = `http://localhost:${WEB_PORT}`
const artifacts = join(tmpdir(), `tus-admin-whatsapp-${Date.now()}`)
const CLAVE = 'una frase larga y segura 2026'
const CLIENTE = { email: 'cliente-smoke@example.com', password: CLAVE, displayName: 'Ana Cliente' }
const PRESTADOR = { email: 'prestador-smoke@example.com', password: CLAVE, displayName: 'Gabriela Lopez' }
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

const EXTRA = 30
const HUMANAS = 4

async function main() {
  assert.ok(existsSync(join(webRoot, '.next/routes-manifest.json')), 'Run the Web build first (NEXT_PUBLIC_API_URL=http://localhost:3101)')
  mkdirSync(artifacts, { recursive: true })
  const data = mkdtempSync(join(tmpdir(), 'tus-pg16-adminwa-'))
  const raiz = mkdtempSync(join(tmpdir(), 'tus-raiz-adminwa-'))
  const abrir = (nombre) => openSync(join(artifacts, nombre), 'a')
  const logs = { api: abrir('api.log'), web: abrir('web.log') }
  let pgIniciado = false
  let apiChild
  let webChild
  let browser
  const psql = (sql) => spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'tus_admin_wa', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })
  try {
    const init = spawnSync(exe('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { encoding: 'utf8' })
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`)
    const start = spawnSync(exe('pg_ctl'), ['-D', data, '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c fsync=off -c lc_messages=C`, '-l', join(data, 'server.log'), '-w', 'start'], { encoding: 'utf8', timeout: 120_000 })
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stdout}${start.stderr}`)
    pgIniciado = true
    const creada = spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE tus_admin_wa'], { encoding: 'utf8' })
    if (creada.status !== 0) throw new Error(`create database: ${creada.stderr}`)
    const databaseUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/tus_admin_wa`
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
      WHATSAPP_ENABLED: 'false', WHATSAPP_APPROVED_TEMPLATES: 'continuar_atencion_tus', WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '', WHATSAPP_AI_ENABLED: 'false', GROQ_API_KEY: '', RAG_EMBEDDING_PROVIDER: 'none',
    }
    writeFileSync(join(raiz, '.env'), `DATABASE_URL="${databaseUrl}"\nDIRECT_URL="${databaseUrl}"\n`)
    copyFileSync(join(root, 'pnpm-workspace.yaml'), join(raiz, 'pnpm-workspace.yaml'))
    apiChild = spawn(process.execPath, [join(apiRoot, 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', join(apiRoot, 'tsconfig.json'), join(apiRoot, 'src/index.ts')], { cwd: raiz, env: entorno, detached: false, windowsHide: true, stdio: ['ignore', logs.api, logs.api] })
    await esperar(`${api}/health`, apiChild, 'API')
    webChild = spawn(process.execPath, [join(webRoot, 'node_modules/next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(WEB_PORT)], { cwd: webRoot, env: { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_API_URL: api }, detached: false, windowsHide: true, stdio: ['ignore', logs.web, logs.web] })
    await esperar(web, webChild, 'Web')

    const registro = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'smoke-prestador' }, body: JSON.stringify(PRESTADOR) })
    check(registro.status === 201, `the provider account registers (${registro.status})`)
    const cuenta = psql(`UPDATE public."Account" a SET "emailVerifiedAt" = now() FROM public."User" u WHERE a."userId" = u."id" AND u."normalizedEmail" = '${PRESTADOR.email}' RETURNING a."tenantId" || '|' || a."id"`)
    const [tenantId = '', cuentaId = ''] = cuenta.stdout.split(/\r?\n/u)[0].trim().split('|')
    check(/\S/u.test(tenantId), `the API is using the disposable database (${cuenta.stderr.trim()})`)
    const altaCliente = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'smoke-cliente' }, body: JSON.stringify(CLIENTE) })
    check(altaCliente.status === 201, `the client account registers (${altaCliente.status})`)
    psql(`UPDATE public."Account" a SET "emailVerifiedAt" = now() FROM public."User" u WHERE a."userId" = u."id" AND u."normalizedEmail" = '${CLIENTE.email}'`)

    // tsx scripts over the disposable database (never the API's own state by hand, except what
    // only Meta or a WhatsApp conversation would write: a status callback, the client's chat).
    const sembrar = (cuerpo) => spawnSync(process.execPath, [join(apiRoot, 'node_modules/tsx/dist/cli.mjs'), '-'], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
      input: `(async () => {
        const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
        const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(databaseUrl)} })
        try { const ahora = new Date(); const tenantId = ${JSON.stringify(tenantId)}; const cuentaId = ${JSON.stringify(cuentaId)}
          ${cuerpo}
        } finally { await prisma.$disconnect() }
      })()`,
    })
    const siembra = sembrar(`
      const oficio = await prisma.oficioServicio.findFirst({ where: { activo: true }, orderBy: { orden: 'asc' } })
      await prisma.tusTenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, slug: tenantId, name: 'Gabriela Lopez', status: 'active', createdAt: ahora, updatedAt: ahora } })
      await prisma.prestador.create({ data: { id: 'smoke-p', tenantId, prestadorId: 'smoke-prestador', cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', cuentaId, fechaCreacion: ahora, fechaActualizacion: ahora } })
      await prisma.perfilPublicoPrestador.create({ data: { id: 'smoke-perfil', tenantId, prestadorId: 'smoke-prestador', nombrePublico: 'Gabriela Lopez', oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 15000n }] } } })
      // Gabriela's WhatsApp, linked, with a message an hour ago (its 24 hour window is open).
      await prisma.contactoWhatsapp.create({ data: { id: 'smoke-contacto', canal: 'whatsapp', waId: '5493794555022', nombrePerfil: 'Gabriela Lopez', cuentaVinculadaId: cuentaId, tenantVinculadoId: tenantId, vinculadoEn: ahora, fechaCreacion: ahora } })
      await prisma.conversacionWhatsapp.create({ data: { id: 'smoke-conversacion', contactoId: 'smoke-contacto', canal: 'whatsapp', estado: 'active', modo: 'bot', abiertaEn: ahora, ultimoMensajeEn: ahora, ultimoEntranteEn: new Date(Date.now() - 3600_000), estadoConversacional: {} } })
      // A provider nobody linked to an account: nothing can be written to it.
      await prisma.tusTenant.create({ data: { id: 'smoke-huerfano', slug: 'smoke-huerfano', name: 'Huérfano', status: 'active', createdAt: ahora, updatedAt: ahora } })
      await prisma.prestador.create({ data: { id: 'smoke-p2', tenantId: 'smoke-huerfano', prestadorId: 'smoke-prestador-2', cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
      await prisma.perfilPublicoPrestador.create({ data: { id: 'smoke-perfil-2', tenantId: 'smoke-huerfano', prestadorId: 'smoke-prestador-2', nombrePublico: 'Perfil Sin Cuenta', oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 15000n }] } } })
      console.log('SEMBRADO ' + oficio.id)
    `)
    oficioId = (siembra.stdout.match(/SEMBRADO (\S+)/u) ?? [])[1] ?? ''
    check(/SEMBRADO /u.test(siembra.stdout), `the providers get a profile with one service (${(siembra.stderr || siembra.stdout).slice(-1600)})`)

    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
    const estado = { sembrar, psql, pedidos: null }
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
    console.log(`ADMIN_WHATSAPP_SMOKE total=${totals.total} pass=${totals.pass} api_pid=${apiChild?.pid ?? '-'} web_pid=${webChild?.pid ?? '-'} artifacts=${artifacts}`)
  }
}

let secretoAdmin = null

async function recorrer(browser, viewport, estado) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const e = viewport.name
  const movil = viewport.width < 700
  const errores = []
  const http = []
  page.on('pageerror', (error) => errores.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/u.test(message.text())) errores.push(message.text()) })
  page.on('response', (response) => { if (response.url().startsWith(api)) http.push(`${response.request().method()} ${new URL(response.url()).pathname}${new URL(response.url()).search} ${response.status()}`) })
  const sinDesborde = async (donde) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${e}: ${donde} does not scroll sideways`)
  const llamar = (method, path, body) => page.evaluate(async ({ api, method, path, body }) => {
    const response = await fetch(api + path, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }, { api, method, path, body })
  const entrar = async (cuenta, quien) => check((await llamar('POST', '/auth/sign-in', { email: cuenta.email, password: cuenta.password })).status === 200, `${e}: ${quien} signs in`)
  const salir = async (quien) => check((await llamar('POST', '/auth/sign-out')).status < 300, `${e}: ${quien} signs out`)
  const completarPerfil = async (nombre, apellido, documento) => {
    const pais = (await llamar('GET', '/tus/v1/geografia/paises')).body.items[0]
    const provincia = (await llamar('GET', `/tus/v1/geografia/provincias?paisId=${encodeURIComponent(pais.id)}`)).body.items[0]
    const localidad = (await llamar('GET', `/tus/v1/geografia/localidades?provinciaId=${encodeURIComponent(provincia.id)}`)).body.items[0]
    check((await llamar('PUT', '/tus/v1/perfil', { nombre, apellido, tipoDocumento: 'DNI', numeroDocumento: documento, localidadId: localidad.id, calle: 'San Martín', numero: '1234', codigoPostal: '3400' })).status === 200, `the personal profile of ${nombre} is complete`)
  }
  const inicio = (hora) => new Date(`${lunes}T${hora}:00.000-03:00`).toISOString()
  try {
    await page.goto(`${web}/ayuda`, { waitUntil: 'domcontentloaded' })

    // ---- 0 (once). The REAL road: the client asks for three turnos through the API; the outbox
    // of notices and the WhatsApp notifier of the API tell (or cannot tell) each provider.
    if (!estado.pedidos) {
      await entrar(PRESTADOR, 'the provider')
      await completarPerfil('Gabriela', 'Lopez', '30111222')
      await salir('the provider')
      await entrar(CLIENTE, 'the client')
      await completarPerfil('Ana', 'Cliente', '30111333')
      const pedidos = []
      for (const [perfil, hora] of [['smoke-perfil', '10:00'], ['smoke-perfil', '11:00'], ['smoke-perfil-2', '12:00']]) {
        const pedido = await llamar('POST', `/tus/v1/prestadores/${perfil}/turnos/solicitudes`, { oficioId, inicio: inicio(hora) })
        check(pedido.status === 201 && pedido.body.estado === 'pending', `the request of ${hora} is pending (${pedido.status} ${pedido.body?.code ?? ''})`)
        pedidos.push(pedido.body.id)
      }
      await salir('the client')
      // The notices leave on their own (outbox); nothing is written by hand for them.
      const limite = Date.now() + 30_000
      let avisos = ''
      while (Date.now() < limite) {
        avisos = estado.psql(`SELECT (SELECT count(*) FROM public."mensajes_conversacion_whatsapp" WHERE "correlacion_id" IN ('turno-solicitado:${pedidos[0]}', 'turno-solicitado:${pedidos[1]}')) || '|' || (SELECT count(*) FROM public."auditoria_asistente" WHERE "accion" = 'whatsapp.appointment_notice_not_sent' AND "correlacion_id" = 'turno-solicitado:${pedidos[2]}')`).stdout.trim()
        if (avisos === '2|1') break
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      check(avisos === '2|1', `the API sent two notices to Gabriela and recorded the one it could not send (${avisos})`)
      // The provider rejects the second request from its panel (the real use case).
      await entrar(PRESTADOR, 'the provider')
      const rechazo = await llamar('POST', `/tus/v1/prestador/turnos/${pedidos[1]}/rechazar`, {})
      check(rechazo.status === 200, `the provider rejects the second request (${rechazo.status} ${rechazo.body?.code ?? ''})`)
      await salir('the provider')
      // What only Meta and a WhatsApp chat write: the "read" callback of the first notice, the
      // client's conversation with its three requests, and enough conversations to page through.
      const sembrado = estado.sembrar(`
        const pedidos = ${JSON.stringify(pedidos)}
        await prisma.mensajeConversacionWhatsapp.updateMany({ where: { correlacionId: 'turno-solicitado:' + pedidos[0] }, data: { estado: 'read', estadoEn: new Date() } })
        await prisma.mensajeConversacionWhatsapp.updateMany({ where: { correlacionId: 'turno-solicitado:' + pedidos[1] }, data: { estado: 'delivered', estadoEn: new Date() } })
        const despues = new Date(Date.now() + 60_000)
        await prisma.contactoWhatsapp.create({ data: { id: 'smoke-ana', canal: 'whatsapp', waId: '5493794550001', nombrePerfil: 'Ana Cliente', fechaCreacion: ahora } })
        await prisma.conversacionWhatsapp.create({ data: { id: 'smoke-conv-ana', contactoId: 'smoke-ana', canal: 'whatsapp', estado: 'active', modo: 'bot', abiertaEn: ahora, ultimoMensajeEn: despues, ultimoEntranteEn: ahora, noLeidos: 2, estadoConversacional: {} } })
        const mensaje = (id, conversacionId, contactoId, direccion, texto, cuando) => prisma.mensajeConversacionWhatsapp.create({ data: { id, conversacionId, contactoId, direccion, tipo: 'text', texto, estado: direccion === 'inbound' ? 'processed' : 'delivered', estadoEn: direccion === 'inbound' ? null : cuando, actor: direccion === 'inbound' ? 'user' : 'assistant', metadata: {}, correlacionId: 'smoke-' + id, fechaCreacion: cuando } })
        await mensaje('smoke-m1', 'smoke-conv-ana', 'smoke-ana', 'inbound', 'Quiero un turno con Gabriela el lunes', ahora)
        await mensaje('smoke-m2', 'smoke-conv-ana', 'smoke-ana', 'outbound', 'Solicitud enviada. Gabriela Lopez tiene que aceptarla.', despues)
        for (const [i, id] of pedidos.entries())
          await prisma.confirmacionAsistente.create({ data: { id: 'smoke-conf-' + i, conversacionId: 'smoke-conv-ana', contactoId: 'smoke-ana', cuentaId: 'cuenta', tenantId: 'tenant', herramienta: 'book_appointment', argumentos: {}, hashArgumentos: 'h', resumen: 's', estado: 'executed', resultado: { appointment: { id } }, expiraEn: ahora, fechaCreacion: new Date(Date.now() + i * 1000), decididaEn: ahora } })
        for (let i = 0; i < ${EXTRA}; i += 1) {
          const cuando = new Date(Date.now() - (i + 1) * 60_000)
          const n = String(i + 1).padStart(2, '0')
          await prisma.contactoWhatsapp.create({ data: { id: 'smoke-c' + n, canal: 'whatsapp', waId: '54937940010' + n, nombrePerfil: 'Contacto ' + n, fechaCreacion: cuando } })
          await prisma.conversacionWhatsapp.create({ data: { id: 'smoke-v' + n, contactoId: 'smoke-c' + n, canal: 'whatsapp', estado: 'active', modo: i < ${HUMANAS} ? 'human' : 'bot', ...(i < ${HUMANAS} ? { motivoDerivacion: 'user_request', derivadaEn: cuando } : {}), abiertaEn: cuando, ultimoMensajeEn: cuando, ultimoEntranteEn: cuando, estadoConversacional: {} } })
          await mensaje('smoke-x' + n, 'smoke-v' + n, 'smoke-c' + n, 'inbound', 'Hola, necesito ayuda con mi turno número ' + n + ' por favor', cuando)
        }
        console.log('LISTO')
      `)
      check(/LISTO/u.test(sembrado.stdout), `the conversations are seeded (${(sembrado.stderr || sembrado.stdout).slice(-1500)})`)
      estado.pedidos = pedidos
    }

    // ---- 1. Admin signs in (MFA).
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

    // ---- 2. The inbox: the list and its pagination footer.
    const TOTAL = EXTRA + 2
    await page.goto(`${web}/tus/admin/whatsapp`, { waitUntil: 'networkidle' })
    const lista = page.locator('ul[aria-label^="Conversaciones"]')
    const filas = lista.locator('li')
    const pie = page.locator('[aria-label="Paginación"]')
    const anterior = pie.getByRole('button', { name: /Anterior/u })
    const siguiente = pie.getByRole('button', { name: /Siguiente/u })
    const selector = pie.locator('select')
    const paginaDice = async (pagina, de) => page.waitForFunction(({ pagina, de }) => { const texto = document.querySelector('[aria-label="Paginación"]')?.textContent ?? ''; return texto.includes(`Página ${pagina} de ${de}`) && texto.includes(`${pagina} / ${de}`) }, { pagina, de })
    await filas.first().waitFor()
    await paginaDice(1, 2)
    check((await filas.count()) === 25, `${e}: the first page lists 25 conversations (${await filas.count()})`)
    check((await lista.getAttribute('aria-label')) === `Conversaciones (${TOTAL})`, `${e}: the total is the real one (${await lista.getAttribute('aria-label')})`)
    check((await pie.count()) === 1 && (await lista.locator('[aria-label="Paginación"]').count()) === 0, `${e}: the pagination is a footer of the panel, not an item of the list`)
    check((await anterior.isDisabled()) && !(await siguiente.isDisabled()), `${e}: on the first page "Anterior" is disabled and "Siguiente" is not`)
    // Layout: one row on desktop, at most two tidy rows at 390 px; nothing floats at another height.
    const cajas = await page.evaluate(() => {
      const pie = document.querySelector('[aria-label="Paginación"]')
      const caja = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, centro: r.y + r.height / 2, derecha: r.right } }
      const lista = document.querySelector('ul[aria-label^="Conversaciones"]')
      const botones = [...pie.querySelectorAll('button')]
      const etiqueta = [...pie.querySelectorAll('span')].find((span) => span.getAttribute('aria-live') === 'polite')
      return { pie: caja(pie), selector: caja(pie.querySelector('select')), botones: botones.map(caja), etiqueta: caja(etiqueta), lista: caja(lista), panel: caja(pie.parentElement), visibles: { larga: getComputedStyle(pie.querySelector('span span')).display !== 'none', corta: getComputedStyle(pie.querySelectorAll('span span')[1]).display !== 'none' } }
    })
    const centros = [cajas.selector.centro, ...cajas.botones.map((b) => b.centro), cajas.etiqueta.centro]
    const filasPie = new Set(centros.map((centro) => Math.round(centro / 8))).size
    if (!movil) {
      check(Math.max(...centros) - Math.min(...centros) <= 3, `${e}: page size, Anterior, page and Siguiente share one row (${centros.map(Math.round).join(', ')})`)
      check(cajas.pie.h <= 56, `${e}: the footer is one compact row (${Math.round(cajas.pie.h)} px high)`)
      check(cajas.selector.x < cajas.botones[0].x && cajas.botones[0].x < cajas.etiqueta.x && cajas.etiqueta.x < cajas.botones[1].x, `${e}: the page size is on the left and the pages on the right, in order`)
      check(cajas.visibles.larga && !cajas.visibles.corta, `${e}: the page is told as "Página 1 de 2"`)
      check(cajas.lista.h >= 500, `${e}: the list takes the height of the panel (${Math.round(cajas.lista.h)} px)`)
    } else {
      const controles = [...cajas.botones.map((b) => b.centro), cajas.etiqueta.centro]
      check(Math.max(...controles) - Math.min(...controles) <= 3, `${e}: Anterior, page and Siguiente share one row (${controles.map(Math.round).join(', ')})`)
      check(filasPie <= 2 && cajas.pie.h <= 112, `${e}: the footer takes at most two rows (${filasPie} rows, ${Math.round(cajas.pie.h)} px)`)
      check(!cajas.visibles.larga && cajas.visibles.corta, `${e}: the page is told as "1 / 2"`)
      check(cajas.botones.every((b) => b.h >= 44) && cajas.selector.h >= 44, `${e}: the controls keep a 44 px touch target`)
    }
    check(cajas.pie.derecha <= cajas.panel.derecha + 1 && cajas.botones[1].derecha <= cajas.pie.derecha + 1 && cajas.pie.w <= cajas.panel.w + 1, `${e}: the footer stays inside the panel`)
    check(cajas.botones.every((b) => b.h >= 36), `${e}: the buttons keep a usable height`)
    await sinDesborde('the inbox')
    await page.screenshot({ path: join(artifacts, `${e}-bandeja.png`), fullPage: true })

    // ---- 3. The notice to the provider, in the client's conversation.
    await lista.locator('li button').filter({ hasText: /^Ana Cliente/u }).click()
    const avisos = page.locator('ul[aria-label="Avisos a prestadores"] li')
    await avisos.first().waitFor()
    const textos = (await avisos.allInnerTexts()).map((texto) => texto.replace(/\s+/gu, ' '))
    check(textos.length === 3, `${e}: one notice per request of the conversation (${textos.length})`)
    check(textos[0].includes('Prestador: Gabriela Lopez') && textos[0].includes('••••5022') && textos[0].includes('Leído') && !textos[0].includes('Respondió'), `${e}: the first notice names the provider, its masked number and that it was read (${textos[0]})`)
    check(textos[1].includes('Respondió: Rechazó') && textos[1].includes('desde el panel') && textos[1].includes('Entregado'), `${e}: the second says the provider rejected, and how far the notice got (${textos[1]})`)
    check(textos[2].includes('Prestador: Perfil Sin Cuenta') && textos[2].includes('No enviado: el prestador no tiene una cuenta asociada'), `${e}: the third says nothing was sent and why (${textos[2]})`)
    check(!(await page.locator('main').innerText()).includes('5493794555022'), `${e}: the whole number of the provider is never shown`)
    await sinDesborde('the conversation with its notices')
    await page.screenshot({ path: join(artifacts, `${e}-avisos.png`), fullPage: true })

    // ---- 4. Paging really pages, and keeps the conversation that is open.
    const abierta = page.locator('section[aria-label="Conversación seleccionada"] header strong')
    await siguiente.click()
    await paginaDice(2, 2)
    await page.waitForFunction((n) => document.querySelectorAll('ul[aria-label^="Conversaciones"] li').length === n, TOTAL - 25)
    check((await siguiente.isDisabled()) && !(await anterior.isDisabled()), `${e}: on the last page "Siguiente" is disabled and "Anterior" is not`)
    check((await abierta.innerText()) === 'Ana Cliente' && (await avisos.count()) === 3, `${e}: changing the page keeps the open conversation`)
    check(http.some((linea) => /GET \/tus\/v1\/admin\/whatsapp\/conversations\?.*page=2.*pageSize=25.* 200$/u.test(linea)), `${e}: the second page was asked to the API`)
    await anterior.click()
    await paginaDice(1, 2)
    // Another page size: back to the first page, with that many rows.
    await selector.selectOption('10')
    await paginaDice(1, 4)
    await page.waitForFunction(() => document.querySelectorAll('ul[aria-label^="Conversaciones"] li').length === 10)
    check((await anterior.isDisabled()) && (await abierta.innerText()) === 'Ana Cliente', `${e}: 10 per page shows 10 rows of 4 pages and keeps the conversation`)
    await siguiente.click()
    await paginaDice(2, 4)
    // A filter goes back to the first page, keeps the page size and the open conversation.
    await page.getByRole('button', { name: 'Requieren intervención' }).click()
    await paginaDice(1, 1)
    await page.waitForFunction((n) => document.querySelectorAll('ul[aria-label^="Conversaciones"] li').length === n, HUMANAS)
    check((await anterior.isDisabled()) && (await siguiente.isDisabled()), `${e}: one page: both buttons are disabled`)
    check((await selector.inputValue()) === '10' && (await abierta.innerText()) === 'Ana Cliente', `${e}: the filter keeps the page size and the open conversation`)
    check((await lista.innerText()).includes('Requiere intervención') && !(await lista.innerText()).includes('Asistente'), `${e}: only the conversations that need a person are listed`)
    check(http.some((linea) => /GET \/tus\/v1\/admin\/whatsapp\/conversations\?.*mode=human.*page=1.*pageSize=10.* 200$/u.test(linea)), `${e}: the filter travels with the page and the page size`)
    await page.screenshot({ path: join(artifacts, `${e}-filtro.png`), fullPage: true })
    await page.getByRole('button', { name: 'Todas' }).click()
    await paginaDice(1, 4)

    // ---- 5. From the notice to what was really sent to the provider.
    await avisos.first().getByRole('button', { name: /Ver los mensajes enviados a Gabriela Lopez/u }).click()
    await page.waitForFunction(() => document.querySelector('section[aria-label="Conversación seleccionada"] header strong')?.textContent === 'Gabriela Lopez')
    const chat = (await page.locator('section[aria-label="Conversación seleccionada"]').innerText()).replace(/\s+/gu, ' ')
    check(/Cliente|solicit/iu.test(chat) && chat.includes('Leído') && chat.includes('Entregado'), `${e}: the messages sent to the provider are readable, each with its status (${chat.slice(0, 320)})`)
    check((await page.locator('ul[aria-label="Avisos a prestadores"]').count()) === 0, `${e}: the provider's own conversation has no notice block`)
    await sinDesborde('the conversation of the provider')
    await page.screenshot({ path: join(artifacts, `${e}-prestador.png`), fullPage: true })

    // ---- 6. Search by name or number: on the server, with the filter and the pages.
    const buscador = page.locator('#admin-whatsapp-search')
    const filasSon = (n) => page.waitForFunction((n) => document.querySelectorAll('ul[aria-label^="Conversaciones"] li').length === n, n)
    const conBusqueda = () => http.filter((linea) => /conversations\?.*search=/u.test(linea)).length
    await siguiente.click()
    await paginaDice(2, 4)
    let antesDeBuscar = conBusqueda()
    await buscador.pressSequentially('contacto 0', { delay: 25 })
    await filasSon(9)
    await paginaDice(1, 1)
    await page.waitForTimeout(500)
    check(conBusqueda() - antesDeBuscar === 1, `${e}: typing asks the server once, after the pause (${conBusqueda() - antesDeBuscar} requests)`)
    check(http.some((linea) => /conversations\?.*search=contacto\+0.*page=1.*pageSize=10.* 200$/u.test(linea)), `${e}: the search goes to the API, back on the first page, with the page size`)
    check((await lista.innerText()).includes('Contacto 09') && !(await lista.innerText()).includes('Contacto 10'), `${e}: a piece of the name, in any case, finds its conversations`)
    // The number as people write it in Argentina (national 0 and the local 15).
    await buscador.fill('0379 15 4001007')
    await filasSon(1)
    check((await filas.first().innerText()).includes('Contacto 07'), `${e}: "0379 15 4001007" finds the conversation of 5493794001007`)
    await buscador.fill('+54 9 379 400-1007')
    await page.waitForResponse((response) => response.url().includes('search=%2B54+9+379+400-1007') && response.status() === 200)
    await filasSon(1)
    check((await filas.first().innerText()).includes('Contacto 07') && (await buscador.inputValue()) === '+54 9 379 400-1007', `${e}: the international way finds it too, and the field keeps what was typed`)
    // With "Requieren intervención".
    await buscador.fill('Contacto')
    await filasSon(10)
    await page.getByRole('button', { name: 'Requieren intervención' }).click()
    await filasSon(HUMANAS)
    check((await buscador.inputValue()) === 'Contacto' && http.some((linea) => /conversations\?.*mode=human.*search=Contacto.*page=1.* 200$/u.test(linea)), `${e}: the search combines with the filter`)
    await page.getByRole('button', { name: 'Todas' }).click()
    await filasSon(10)
    // No result: a message, not an error; the layout and the field stay.
    await buscador.fill('zzzz nadie')
    const sinResultados = page.getByText('No encontramos conversaciones con ese nombre o celular.')
    await sinResultados.waitFor()
    check((await filas.count()) === 0 && (await page.locator('main [role="alert"]').count()) === 0 && (await buscador.isVisible()) && (await page.locator('section[aria-label="Conversación seleccionada"]').isVisible()), `${e}: no result is told plainly, without an error and without breaking the layout`)
    await sinDesborde('the empty search')
    await page.screenshot({ path: join(artifacts, `${e}-busqueda-vacia.png`), fullPage: true })
    await page.getByRole('button', { name: 'Limpiar la búsqueda' }).click()
    await filasSon(10)
    await paginaDice(1, 4)
    check((await buscador.inputValue()) === '' && (await sinResultados.count()) === 0, `${e}: the X clears the search and the normal list is back`)

    // ---- 7. Manual answer. What only WhatsApp writes is seeded once: a conversation whose 24
    // hour window closed and a message Meta could not deliver.
    if (!estado.respuesta) {
      const sembrado = estado.sembrar(`
        await prisma.conversacionWhatsapp.update({ where: { id: 'smoke-v02' }, data: { ultimoEntranteEn: new Date(Date.now() - 48 * 3600_000) } })
        await prisma.mensajeConversacionWhatsapp.create({ data: { id: 'smoke-fallido', conversacionId: 'smoke-v01', contactoId: 'smoke-c01', wamid: 'wamid.smoke-fallido', direccion: 'outbound', tipo: 'text', texto: 'Mensaje que Meta no pudo entregar', estado: 'failed', estadoEn: ahora, actor: 'operator:alguien', metadata: { sentTo: '5493794001001', metaErrorCode: 131026 }, correlacionId: 'smoke-fallido', fechaCreacion: ahora } })
        console.log('LISTO')
      `)
      check(/LISTO/u.test(sembrado.stdout), `the closed window and the failed message are seeded (${(sembrado.stderr || sembrado.stdout).slice(-900)})`)
      estado.respuesta = true
    }
    const panel = page.locator('section[aria-label="Conversación seleccionada"]')
    const cabecera = panel.locator('header')
    const abrir = async (nombre) => {
      await buscador.fill(nombre)
      await page.waitForFunction((nombre) => { const filas = document.querySelectorAll('ul[aria-label^="Conversaciones"] li'); return filas.length === 1 && filas[0].textContent.includes(nombre) }, nombre)
      await filas.first().locator('button').click()
      await page.waitForFunction((nombre) => document.querySelector('section[aria-label="Conversación seleccionada"] header strong')?.textContent === nombre, nombre)
    }
    await abrir('Contacto 01')
    // Taken by this administrator: persisted, with the name.
    if (await panel.getByRole('button', { name: 'Devolver al asistente' }).count()) {
      await panel.getByRole('button', { name: 'Devolver al asistente' }).click()
      await panel.getByRole('button', { name: 'Tomar conversación' }).waitFor()
      check((await cabecera.innerText()).includes('Asistente · Ventana abierta') && (await panel.locator('textarea').count()) === 0, `${e}: with the assistant attending there is nothing to write in (${(await cabecera.innerText()).replace(/\s+/gu, ' ')})`)
    }
    await panel.getByRole('button', { name: 'Tomar conversación' }).click()
    await panel.getByRole('button', { name: 'Devolver al asistente' }).waitFor()
    check((await cabecera.innerText()).includes(`Atendida por ${ADMIN.displayName} · Ventana abierta`), `${e}: the header says who attends it and that the window is open (${(await cabecera.innerText()).replace(/\s+/gu, ' ')})`)
    check((await cabecera.innerText()).includes('••••1001') && !(await panel.innerText()).includes('5493794001001'), `${e}: the number the answer goes to is shown masked`)
    check((await panel.innerText()).replace(/\s+/gu, ' ').includes('Falló: Meta aceptó el mensaje pero no pudo entregarlo (código de Meta 131026)'), `${e}: a message Meta could not deliver says so, with Meta's number`)
    // Shift+Enter is a new line; Enter sends.
    const texto = panel.locator('#admin-whatsapp-reply')
    const burbujas = panel.locator('[class*="bubbleAdmin"]')
    const enviadas = await burbujas.count()
    await texto.click()
    await texto.pressSequentially(`Hola ${e}`)
    await texto.press('Shift+Enter')
    await texto.pressSequentially('segunda línea')
    check((await texto.inputValue()) === `Hola ${e}\nsegunda línea` && (await burbujas.count()) === enviadas, `${e}: Shift+Enter adds a line and sends nothing`)
    check(await texto.evaluate((el) => { const caja = el.getBoundingClientRect(); return caja.left >= 0 && caja.right <= window.innerWidth && caja.width >= 180 }), `${e}: the field fits the screen`)
    await page.screenshot({ path: join(artifacts, `${e}-respuesta.png`), fullPage: true })
    await texto.press('Enter')
    await page.waitForFunction((n) => document.querySelectorAll('section[aria-label="Conversación seleccionada"] [class*="bubbleAdmin"]').length === n, enviadas + 1)
    const ultima = (await burbujas.last().innerText())
    check(ultima.includes(`Hola ${e}\nsegunda línea`) && /Admin · .* · Enviado/u.test(ultima.replace(/\s+/gu, ' ')), `${e}: Enter sends; the message shows its lines, who sent it, when and its state (${ultima.replace(/\s+/gu, ' ')})`)
    check((await texto.inputValue()) === '', `${e}: the field is cleared once it was sent`)
    check(http.some((linea) => /POST \/tus\/v1\/admin\/whatsapp\/conversations\/smoke-v01\/reply 202$/u.test(linea)), `${e}: the answer went through the support API`)
    // Meta refuses (its answer is stood in for here; the real refusal is covered over HTTP in
    // tus-admin-whatsapp-entrega.test.mjs): the reason is shown and the text stays to retry.
    await page.route('**/conversations/smoke-v01/reply', (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 502, contentType: 'application/json', headers: { 'access-control-allow-origin': web, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: 'WHATSAPP_INVALID_REQUEST', error: 'WhatsApp did not accept the message (WHATSAPP_INVALID_REQUEST, Meta 131030)' }) })
      : route.fallback())
    await texto.fill(`Reintento ${e}`)
    await texto.press('Enter')
    const aviso = panel.locator('[role="alert"]')
    await aviso.waitFor()
    check((await aviso.innerText()) === 'No se envió: Meta rechazó el mensaje (código de Meta 131030). Podés reintentar.', `${e}: the real reason of the refusal is shown (${await aviso.innerText()})`)
    check((await texto.inputValue()) === `Reintento ${e}` && (await burbujas.count()) === enviadas + 1, `${e}: nothing is drawn as sent and the text stays to try again`)
    await page.screenshot({ path: join(artifacts, `${e}-error-meta.png`), fullPage: true })
    await page.unroute('**/conversations/smoke-v01/reply')
    await texto.press('Enter')
    await page.waitForFunction((n) => document.querySelectorAll('section[aria-label="Conversación seleccionada"] [class*="bubbleAdmin"]').length === n, enviadas + 2)
    check((await aviso.count()) === 0 && (await burbujas.last().innerText()).includes(`Reintento ${e}`), `${e}: the retry sends it and the error goes away`)
    // Reloading: the state is the server's (taken, by whom, and the messages).
    await page.goto(`${web}/tus/admin/whatsapp`, { waitUntil: 'networkidle' })
    await filas.first().waitFor()
    await abrir('Contacto 01')
    check((await cabecera.innerText()).includes(`Atendida por ${ADMIN.displayName}`) && (await panel.innerText()).includes(`Reintento ${e}`), `${e}: after reloading the conversation is still taken by the same person, with its messages`)

    // The window closed: no free text, only the approved template.
    await abrir('Contacto 02')
    const cerrada = panel.locator('[data-ventana="cerrada"]')
    await cerrada.waitFor()
    check((await cabecera.innerText()).includes('Ventana cerrada') && (await panel.locator('textarea').count()) === 0, `${e}: with the window closed there is no free text (${(await cabecera.innerText()).replace(/\s+/gu, ' ')})`)
    const plantillas = cerrada.getByRole('button', { name: 'Contactar con plantilla' })
    check((await plantillas.count()) === 1 && (await plantillas.first().getAttribute('data-plantilla')) === 'continuar_atencion_tus', `${e}: only the approved template is offered`)
    check((await cerrada.innerText()).replace(/\s+/gu, ' ').includes('Hola, Contacto. Queremos continuar con tu solicitud en TUS. Respondé este mensaje y seguimos con la atención por acá. [Continuar atención]'), `${e}: the template is shown as the person will read it`)
    await sinDesborde('the closed window')
    await page.screenshot({ path: join(artifacts, `${e}-ventana-cerrada.png`), fullPage: true })
    const conPlantilla = await burbujas.count()
    await plantillas.first().click()
    await page.waitForFunction((n) => document.querySelectorAll('section[aria-label="Conversación seleccionada"] [class*="bubbleAdmin"]').length === n, conPlantilla + 1)
    check((await burbujas.last().innerText()).includes('[plantilla continuar_atencion_tus]') && (await cerrada.count()) === 1, `${e}: the template is sent and recorded; the window stays closed until the person answers`)
    check(http.some((linea) => /POST \/tus\/v1\/admin\/whatsapp\/conversations\/smoke-v02\/template 202$/u.test(linea)), `${e}: the template went through the support API`)
    await buscador.fill('')
    await filasSon(25)
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

const ESPERADOS = [/\/auth\/session 401$/u, /\/auth\/refresh 401$/u, /\/smoke-v01\/reply 502$/u]

await main()
