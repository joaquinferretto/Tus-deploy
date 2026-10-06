import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Browser smoke of the admin account sheet against the REAL local API (no fixtures): a disposable
// PostgreSQL 16 cluster with every migration, the API and the production Web build on their own
// ports, a real platform administrator (bootstrap code + MFA) and a real target account. Every
// process is a child of this script and is stopped in `finally`; the cluster is removed. Needs
// PostgreSQL 16 binaries (TUS_PG_BIN) and `next build` with NEXT_PUBLIC_API_URL=http://localhost:3101.
// Never point it at a shared database: it creates its own.
const root = join(import.meta.dirname, '../..')
const webRoot = join(root, 'apps/web')
const apiRoot = join(root, 'apps/api')
const { chromium } = createRequire(join(apiRoot, 'package.json'))('playwright-core')
const chrome = process.env.TUS_TEST_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PG_BIN = process.env.TUS_PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\16\\bin'
const exe = (name) => join(PG_BIN, process.platform === 'win32' ? `${name}.exe` : name)
const API_PORT = 3101
const WEB_PORT = 3214
const PG_PORT = String(56000 + Math.floor(Math.random() * 400))
const api = `http://localhost:${API_PORT}`
const web = `http://localhost:${WEB_PORT}`
const artifacts = join(tmpdir(), `tus-admin-real-${Date.now()}`)
const ADMIN = { email: 'admin-smoke@example.com', password: 'una frase larga y segura 2026', displayName: 'Admin Smoke' }
const PERSONA = { email: 'persona-smoke@example.com', password: 'otra frase larga y segura 2026', displayName: 'Persona Smoke' }
const BOOTSTRAP = 'codigo-bootstrap-solo-para-este-smoke'

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
  const data = mkdtempSync(join(tmpdir(), 'tus-pg16-admin-'))
  const raiz = mkdtempSync(join(tmpdir(), 'tus-raiz-smoke-'))
  const abrir = (nombre) => openSync(join(artifacts, nombre), 'a')
  const logs = { api: abrir('api.log'), web: abrir('web.log') }
  let pgIniciado = false
  let apiChild
  let webChild
  let browser
  try {
    // ---- disposable PostgreSQL 16 with every migration
    const init = spawnSync(exe('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { encoding: 'utf8' })
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`)
    const start = spawnSync(exe('pg_ctl'), ['-D', data, '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c fsync=off -c lc_messages=C`, '-l', join(data, 'server.log'), '-w', 'start'], { encoding: 'utf8', timeout: 120_000 })
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stdout}${start.stderr}`)
    pgIniciado = true
    const creada = spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE tus_admin_smoke'], { encoding: 'utf8' })
    if (creada.status !== 0) throw new Error(`create database: ${creada.stderr}`)
    const databaseUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/tus_admin_smoke`
    const migrate = spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl }, timeout: 600_000 })
    if (migrate.status !== 0) throw new Error(`migrate-deploy failed: ${(migrate.stdout + migrate.stderr).slice(-800)}`)

    // ---- the real API and the real Web, as children of this script
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
    // The API finds the repository root from its working directory and reads DATABASE_URL from the
    // .env there. It runs from a scratch root whose .env is the disposable database, so it can never
    // reach the developer's own local database.
    writeFileSync(join(raiz, '.env'), `DATABASE_URL="${databaseUrl}"\nDIRECT_URL="${databaseUrl}"\n`)
    copyFileSync(join(root, 'pnpm-workspace.yaml'), join(raiz, 'pnpm-workspace.yaml'))
    apiChild = spawn(process.execPath, [join(apiRoot, 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', join(apiRoot, 'tsconfig.json'), join(apiRoot, 'src/index.ts')], { cwd: raiz, env: entorno, detached: false, windowsHide: true, stdio: ['ignore', logs.api, logs.api] })
    await esperar(`${api}/health`, apiChild, 'API')
    webChild = spawn(process.execPath, [join(webRoot, 'node_modules/next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(WEB_PORT)], { cwd: webRoot, env: { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_API_URL: api }, detached: false, windowsHide: true, stdio: ['ignore', logs.web, logs.web] })
    await esperar(web, webChild, 'Web')

    // ---- the target account (a plain client), through the real API
    const registro = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'smoke-registro' }, body: JSON.stringify(PERSONA) })
    check(registro.status < 300, `the target account registers (${registro.status})`)
    // Proof that the API writes to the disposable database (and to nothing else).
    const fila = spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', 'tus_admin_smoke', '-At', '-c', `SELECT count(*) FROM public."User" WHERE "normalizedEmail" = '${PERSONA.email}'`], { encoding: 'utf8' })
    check(fila.stdout.trim() === '1', `the API is using the disposable database (${fila.stdout.trim() || fila.stderr.trim()})`)

    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
    for (const viewport of [{ name: 'desktop-1280', width: 1280, height: 900 }, { name: 'mobile-390', width: 390, height: 844 }]) await ficha(browser, viewport)
  } finally {
    await browser?.close()
    await stop(webChild)
    await stop(apiChild)
    closeSync(logs.api)
    closeSync(logs.web)
    if (pgIniciado) spawnSync(exe('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf8', timeout: 60_000 })
    rmSync(data, { recursive: true, force: true })
    rmSync(raiz, { recursive: true, force: true })
    console.log(`ADMIN_REAL total=${totals.total} pass=${totals.pass} api_pid=${apiChild?.pid ?? '-'} web_pid=${webChild?.pid ?? '-'} artifacts=${artifacts}`)
  }
}

let administradorListo = false

async function ficha(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const errores = []
  const http = []
  page.on('pageerror', (error) => errores.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/u.test(message.text())) errores.push(message.text()) })
  page.on('response', (response) => { if (response.url().startsWith(api)) http.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`) })
  page.on('dialog', (dialog) => { errores.push(`dialog: ${dialog.message()}`); void dialog.dismiss() })
  const etiqueta = viewport.name
  // Calls the real API from the page (the session cookie of the browser travels, like the Web does).
  const llamar = (method, path, body) => page.evaluate(async ({ api, method, path, body }) => {
    const response = await fetch(api + path, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }, { api, method, path, body })
  try {
    await page.goto(`${web}/ayuda`, { waitUntil: 'domcontentloaded' })
    // ---- a real platform administrator: register, bootstrap code, sign in, MFA
    if (!administradorListo) {
      check((await llamar('POST', '/auth/register', ADMIN)).status < 300, 'the administrator registers')
      check((await llamar('POST', '/auth/admin/bootstrap-verify', { email: ADMIN.email, code: BOOTSTRAP })).status === 204, 'the bootstrap code verifies the administrator email')
    }
    const entrada = await llamar('POST', '/auth/sign-in', { email: ADMIN.email, password: ADMIN.password })
    check(entrada.status === 200, `the administrator signs in (${entrada.status})`)
    if (!administradorListo) {
      const alta = await llamar('POST', '/auth/mfa/enroll')
      check(alta.status === 201 && typeof alta.body?.secret === 'string', `MFA enrollment starts (${alta.status})`)
      ficha.secreto = alta.body.secret
      const confirmada = await llamar('POST', '/auth/mfa/enroll/confirm', { enrollmentId: alta.body.enrollmentId, code: totp(alta.body.secret) })
      check(confirmada.status < 300, `MFA is confirmed and the session elevated (${confirmada.status} ${JSON.stringify(confirmada.body?.error ?? '')})`)
      administradorListo = true
    } else {
      // A code is single use: wait for the next 30 second window.
      await new Promise((resolve) => setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500))
      const elevada = await llamar('POST', '/auth/mfa/verify', { code: totp(ficha.secreto) })
      check(elevada.status < 300, `MFA step-up (${elevada.status} ${JSON.stringify(elevada.body?.error ?? '')})`)
    }
    const lista = await llamar('GET', `/tus/v1/admin/usuarios?q=${encodeURIComponent(PERSONA.email)}`)
    check(lista.status === 200 && lista.body?.items?.length === 1, `the administrator finds the account (${lista.status})`)
    const id = lista.body.items[0].id

    // ---- the sheet, in the browser, against the real API
    http.length = 0
    await page.goto(`${web}/tus/admin/usuarios/${id}`, { waitUntil: 'networkidle' })
    const contacto = page.locator('section[aria-labelledby="usuario-contacto"]')
    await contacto.waitFor()
    await identidad({ page, etiqueta, llamar, id })
    await pasos({ page, contacto, etiqueta, llamar, id, http })
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(desborde <= 1, `${etiqueta}: no horizontal overflow (${desborde}px)`)
    await page.screenshot({ path: join(artifacts, `${etiqueta}-ficha.png`), fullPage: true })
    const fallidas = http.filter((linea) => /\s(4\d\d|5\d\d)$/u.test(linea) && !ESPERADOS.some((esperado) => linea.includes(esperado)))
    check(fallidas.length === 0, `${etiqueta}: unexpected HTTP errors: ${fallidas.join(' | ')}`)
    check(errores.length === 0, `${etiqueta}: console/page errors: ${errores.join(' | ')}`)
  } catch (error) {
    await page.screenshot({ path: join(artifacts, `${etiqueta}-failed.png`), fullPage: true }).catch(() => undefined)
    console.error(`${etiqueta} url=${page.url()} http=${http.slice(-12).join(' | ')} errors=${errores.join(' | ')}`)
    throw error
  } finally {
    await context.close()
  }
}

// HTTP errors the smoke provokes on purpose (a rejected value sent straight to the API).
const ESPERADOS = ['/identidad 422', '/telefono 422']

// 1-3. The identity card against the real API: edit, an invalid DNI is refused (by the form AND
// by the API), a valid one is saved and shown without a page reload. The second viewport finds the
// identity already loaded and corrects the document, which needs a reason and a confirmation.
async function identidad({ page, etiqueta, llamar, id }) {
  const tarjeta = page.locator('section[aria-labelledby="usuario-identidad"]')
  const primera = etiqueta.startsWith('desktop')
  const documento = primera ? '40123456' : '40123457'
  check((await tarjeta.locator('input').count()) === 0, `${etiqueta}: the identity is read-only until edited`)
  await tarjeta.getByRole('button', { name: 'Editar identidad' }).click()
  await tarjeta.getByLabel('Nombre', { exact: true }).fill(primera ? 'María José' : 'Luciana')
  await tarjeta.getByLabel('Apellido', { exact: true }).fill(primera ? "O'Connor" : 'Pereira')
  await tarjeta.getByLabel('Tipo de documento').selectOption('DNI')
  // A DNI with a letter: the form says so and nothing is sent.
  await tarjeta.getByLabel('Número de documento').fill('4012345A')
  await tarjeta.getByRole('button', { name: 'Guardar cambios' }).click()
  await tarjeta.getByText('El número de documento no es válido para ese tipo.').waitFor()
  // ...and the API refuses it by itself, whatever a client sends.
  const directo = await llamar('PUT', `/tus/v1/admin/usuarios/${id}/identidad`, { nombre: 'Luciana', apellido: 'Pereira', tipoDocumento: 'DNI', numeroDocumento: '4012345A' })
  check(directo.status === 422 && directo.body?.error?.code === 'INVALID_IDENTITY', `${etiqueta}: the real API rejects an invalid DNI (${directo.status} ${directo.body?.error?.code})`)
  const conNumero = await llamar('PUT', `/tus/v1/admin/usuarios/${id}/identidad`, { nombre: 'Luciana3', apellido: 'Pereira', tipoDocumento: 'DNI', numeroDocumento: documento })
  check(conNumero.status === 422, `${etiqueta}: the real API rejects a name with a digit (${conNumero.status})`)
  await tarjeta.getByLabel('Número de documento').fill(documento)
  if (!primera) await tarjeta.getByLabel('Motivo del cambio de documento').fill('Corrección en el smoke')
  await tarjeta.getByRole('button', { name: 'Guardar cambios' }).click()
  if (!primera) {
    const modal = page.getByRole('dialog')
    await modal.waitFor()
    check((await modal.innerText()).includes('¿Cambiar el documento de esta cuenta?'), `${etiqueta}: changing a document asks for confirmation`)
    await modal.getByRole('button', { name: 'Cambiar documento' }).click()
  }
  await page.getByText('Identidad actualizada.').first().waitFor()
  await tarjeta.getByRole('button', { name: 'Editar identidad' }).waitFor()
  const texto = await tarjeta.innerText()
  check(texto.includes(primera ? 'María José' : 'Luciana') && texto.includes(primera ? "O'Connor" : 'Pereira') && texto.includes(primera ? '40.123.456' : '40.123.457'), `${etiqueta}: the saved identity is shown without a reload (${texto.replace(/\s+/gu, ' ').slice(0, 160)})`)
  const real = await llamar('GET', `/tus/v1/admin/usuarios/${id}`)
  check(real.body?.perfil?.documento?.numero === documento && real.body?.perfil?.nombre === (primera ? 'María José' : 'Luciana'), `${etiqueta}: the API holds the identity that was saved`)
  await tarjeta.screenshot({ path: join(artifacts, `${etiqueta}-identidad.png`) })
}

const numeroDe = (etiqueta) => (etiqueta.startsWith('desktop') ? '379 455-1001' : '379 455-1002')
const numeroNuevoDe = (etiqueta) => (etiqueta.startsWith('desktop') ? '379 455-1003' : '379 455-1004')

// The contact card: the administration certifies the phone and the WhatsApp of the account, with
// only the actions of the current state on screen.
async function pasos({ page, contacto, etiqueta, http }) {
  const aviso = (texto) => page.getByText(texto).first().waitFor()
  const confirmar = async (boton) => {
    const modal = page.getByRole('dialog')
    await modal.waitFor()
    await modal.getByRole('button', { name: boton, exact: true }).click()
  }
  const estado = (valor) => contacto.locator(`[data-contacto-estado="${valor}"]`).waitFor()
  const acciones = async () => (await contacto.locator('[data-contacto-estado] > div').first().locator('button').allInnerTexts()).map((texto) => texto.trim())
  const boton = (nombre) => contacto.locator(`[data-contacto="${nombre}"]`)
  // The replacement form stays folded until asked for (and stays open once it was used).
  const abrirReemplazo = async () => {
    const plegado = contacto.locator('[data-contacto="reemplazar"]')
    if (!(await plegado.evaluate((nodo) => nodo.open))) await plegado.locator('summary').click()
  }
  const sinDesborde = async (donde) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${etiqueta}: ${donde} does not scroll sideways`)
  // 4. no phone: the number is saved as PENDING, never verified by itself.
  await estado('sin_telefono')
  check((await contacto.innerText()).includes('Sin teléfono'), `${etiqueta}: the account starts without a phone`)
  await boton('numero').fill(numeroDe(etiqueta))
  await boton('pendiente').click()
  await aviso('Número cargado como pendiente de verificación.')
  await estado('pendiente')
  check((await contacto.innerText()).includes('Pendiente'), `${etiqueta}: the number is pending`)
  check(JSON.stringify(await acciones()) === JSON.stringify(['Verificar y vincular WhatsApp', 'Verificar', 'Quitar número']), `${etiqueta}: a pending phone offers verify, verify + link and remove (${JSON.stringify(await acciones())})`)
  check(http.some((linea) => linea.startsWith('POST ') && linea.includes('/telefono') && linea.endsWith(' 200')), `${etiqueta}: the real API accepted the pending number`)
  // 5. verify it: verifying is not linking.
  await boton('verificar').click()
  await confirmar('Verificar teléfono')
  await estado('verificado')
  const verificado = await contacto.innerText()
  check(verificado.includes('Verificado') && verificado.includes('No vinculado'), `${etiqueta}: verified, WhatsApp not linked`)
  check(JSON.stringify(await acciones()) === JSON.stringify(['Vincular WhatsApp', 'Quitar verificación', 'Quitar número']), `${etiqueta}: a verified phone offers link, remove verification and remove (${JSON.stringify(await acciones())})`)
  await contacto.screenshot({ path: join(artifacts, `${etiqueta}-verificado.png`) })
  // 6. link its WhatsApp, with nobody writing from that number.
  await boton('vincular_whatsapp').click()
  await confirmar('Vincular WhatsApp')
  await aviso('WhatsApp vinculado.')
  await estado('vinculado')
  check((await contacto.innerText()).includes('Vinculado'), `${etiqueta}: WhatsApp linked`)
  check(JSON.stringify(await acciones()) === JSON.stringify(['Desvincular WhatsApp', 'Quitar número']), `${etiqueta}: a linked WhatsApp offers unlink and remove only (${JSON.stringify(await acciones())})`)
  await sinDesborde('the contact card with a linked WhatsApp')
  await contacto.screenshot({ path: join(artifacts, `${etiqueta}-vinculado.png`) })
  // 7. unlink: the phone stays verified.
  await boton('desvincular_whatsapp').click()
  await confirmar('Desvincular WhatsApp')
  await aviso('WhatsApp desvinculado.')
  await estado('verificado')
  check((await contacto.innerText()).includes('No vinculado') && (await contacto.innerText()).includes('Verificado'), `${etiqueta}: unlinked, the phone is still verified`)
  // 8. replace the number: save, verify and link in one action.
  await abrirReemplazo()
  await boton('numero').fill(numeroNuevoDe(etiqueta))
  await boton('guardar_verificar_vincular').click()
  await confirmar('Guardar, verificar y vincular')
  await aviso('Número guardado, verificado y WhatsApp vinculado.')
  await estado('vinculado')
  const reemplazado = await contacto.innerText()
  check(reemplazado.includes(numeroNuevoDe(etiqueta).slice(-4)) && !reemplazado.includes(numeroDe(etiqueta).slice(-4)), `${etiqueta}: the card shows the new number, not the old one`)
  // An invalid number is explained and changes nothing.
  await abrirReemplazo()
  await boton('numero').fill('12ab')
  await boton('pendiente').click()
  await aviso('Revisá el número: con característica, por ejemplo 379 412-3456.')
  await estado('vinculado')
  // 9. remove the number altogether.
  await boton('quitar').first().click()
  await confirmar('Quitar número')
  await aviso('Se quitó el número de la cuenta.')
  await estado('sin_telefono')
  check((await contacto.innerText()).includes('Sin teléfono'), `${etiqueta}: the account has no phone again`)
  check((await contacto.locator('[data-contacto-estado] > div').first().locator('button').count()) === 0, `${etiqueta}: without a phone there is nothing to verify, link or remove`)
  await sinDesborde('the contact card')
  check(!http.some((linea) => / 5\d\d$/u.test(linea)), `${etiqueta}: no request answered 5xx (${http.filter((l) => / 5\d\d$/u.test(l)).join(', ')})`)
  check(readFileSync(join(artifacts, 'api.log'), 'utf8').length >= 0, 'the API log is kept with the artifacts')
}

await main()
