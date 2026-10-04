import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const requireFromApi = createRequire(resolve(ROOT, 'apps', 'api', 'package.json'))
const { config } = requireFromApi('dotenv')
const { Client } = requireFromApi('pg')

config({ path: resolve(ROOT, '.env') })

const args = process.argv.slice(2)
const dockerMode = args.includes('--docker')
const embeddedMode = args.includes('--embedded')
const tests = args.filter((item) => item !== '--docker' && item !== '--embedded')
const selectedTests = tests.length > 0
  ? tests
  : [
      'tests/foundation/tus-turnos-agenda-postgres.test.mjs',
      'tests/foundation/tus-integridad-astra-postgres.test.mjs',
    ]

function execute(command, commandArgs, { timeoutMs, capture = false, allowFailure = false, environment = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, env: environment, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true })
    let stdout = ''
    let stderr = ''
    if (capture) {
      child.stdout.on('data', (chunk) => { stdout += String(chunk) })
      child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${command} exceeded ${timeoutMs} ms`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      const result = { code, stdout, stderr }
      if (code === 0 || allowFailure) resolvePromise(result)
      else reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown'}${capture && stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ''}`))
    })
  })
}

const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => error ? reject(error) : resolvePromise(port))
    })
  })
}

async function waitForPostgres(url) {
  let lastError = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new Client({ connectionString: url })
    try {
      await client.connect()
      await client.query('SELECT 1')
      await client.end()
      return
    } catch (error) {
      lastError = error
      await client.end().catch(() => undefined)
      await wait(1_000)
    }
  }
  throw new Error(`PostgreSQL did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

let source = process.env['DATABASE_URL'] ?? ''
let container = null
let desktopStarted = false
let disposableDatabase = null
let admin = null
let cluster = null
let embeddedRunning = false

try {
  if (embeddedMode) {
    const postgresBin = 'C:\\Program Files\\PostgreSQL\\16\\bin'
    cluster = mkdtempSync(join(tmpdir(), 'tus-pg16-'))
    const port = await freePort()
    await execute(join(postgresBin, 'initdb.exe'), ['--pgdata', cluster, '--username', 'postgres', '--auth', 'trust', '--encoding', 'UTF8', '--no-locale'], { timeoutMs: 180_000 })
    await execute(join(postgresBin, 'pg_ctl.exe'), ['--pgdata', cluster, '--log', join(cluster, 'postgres.log'), '--options', `-h 127.0.0.1 -p ${port}`, '--wait', 'start'], { timeoutMs: 120_000 })
    embeddedRunning = true
    source = `postgresql://postgres@127.0.0.1:${port}/postgres?schema=public`
    await waitForPostgres(source)
    console.log(`[disposable-pg] isolated PostgreSQL 16 cluster ready on local port ${port}`)
  } else if (dockerMode) {
    const status = await execute('docker', ['desktop', 'status'], { timeoutMs: 30_000, capture: true, allowFailure: true })
    if (status.code !== 0) {
      await execute('docker', ['desktop', 'start'], { timeoutMs: 180_000 })
      desktopStarted = true
    }
    container = `tus-pg16-${process.pid}-${Date.now()}`.toLowerCase()
    const password = 'fictitious-disposable-pg-2026'
    await execute('docker', ['run', '--detach', '--rm', '--name', container, '--env', `POSTGRES_PASSWORD=${password}`, '--publish', '127.0.0.1::5432', 'postgres:16-alpine'], { timeoutMs: 300_000, capture: true })
    const portResult = await execute('docker', ['port', container, '5432/tcp'], { timeoutMs: 30_000, capture: true })
    const port = /:(\d+)\s*$/u.exec(portResult.stdout.trim())?.[1]
    if (!port) throw new Error('Docker did not publish the PostgreSQL port')
    source = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres?schema=public`
    await waitForPostgres(source)
    console.log(`[disposable-pg] PostgreSQL 16 container ready on local port ${port}`)
  } else {
    if (!source) throw new Error('DATABASE_URL is required to reach the local PostgreSQL 16 server')
    const parsed = new URL(source)
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('DATABASE_URL must use PostgreSQL')
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) throw new Error('Refusing to create a disposable database on a non-local PostgreSQL server')
    disposableDatabase = `tus_turnos_test_${process.pid}_${Date.now()}`.toLowerCase()
    if (!/^tus_turnos_test_[a-z0-9_]+$/u.test(disposableDatabase)) throw new Error('Unsafe disposable database name')
    const adminUrl = new URL(source)
    adminUrl.pathname = '/postgres'
    adminUrl.searchParams.delete('schema')
    admin = new Client({ connectionString: adminUrl.toString() })
    await admin.connect()
    await admin.query(`CREATE DATABASE "${disposableDatabase}"`)
    const testUrl = new URL(source)
    testUrl.pathname = `/${disposableDatabase}`
    testUrl.searchParams.set('schema', 'public')
    source = testUrl.toString()
    console.log(`[disposable-pg] created ${disposableDatabase} on local PostgreSQL 16`)
  }

  const probe = new Client({ connectionString: source })
  await probe.connect()
  const version = await probe.query('SHOW server_version_num')
  await probe.end()
  const versionNumber = Number(version.rows[0]?.server_version_num)
  if (versionNumber < 160000 || versionNumber >= 170000) throw new Error(`PostgreSQL 16 is required; server reported ${versionNumber || 'unknown'}`)

  const environment = {
    ...process.env,
    DATABASE_URL: source,
    DIRECT_URL: source,
    TUS_PERFIL_TURNOS_PG_URL: source,
  }
  await execute(process.execPath, ['scripts/db/migrate-deploy.mjs'], { timeoutMs: 15 * 60_000, environment })
  await execute(process.execPath, ['--test', ...selectedTests], { timeoutMs: 15 * 60_000, environment })
  console.log(`[disposable-pg] PASS ${selectedTests.length} test file(s)`)
} finally {
  if (admin && disposableDatabase) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [disposableDatabase]).catch(() => undefined)
    await admin.query(`DROP DATABASE IF EXISTS "${disposableDatabase}"`).catch((error) => {
      console.error(`[disposable-pg] cleanup failed for ${disposableDatabase}: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    })
    console.log(`[disposable-pg] removed ${disposableDatabase}`)
  }
  await admin?.end().catch(() => undefined)
  if (embeddedRunning && cluster) {
    const postgresBin = 'C:\\Program Files\\PostgreSQL\\16\\bin'
    await execute(join(postgresBin, 'pg_ctl.exe'), ['--pgdata', cluster, '--wait', '--mode', 'fast', 'stop'], { timeoutMs: 120_000, capture: true, allowFailure: true })
    embeddedRunning = false
    console.log('[disposable-pg] stopped isolated PostgreSQL 16 cluster')
  }
  if (cluster) {
    rmSync(cluster, { recursive: true, force: true })
    console.log('[disposable-pg] removed isolated PostgreSQL data')
  }
  if (container) {
    await execute('docker', ['rm', '--force', container], { timeoutMs: 60_000, capture: true, allowFailure: true })
    console.log(`[disposable-pg] removed container ${container}`)
  }
  if (desktopStarted) {
    await execute('docker', ['desktop', 'stop'], { timeoutMs: 120_000, capture: true, allowFailure: true })
    console.log('[disposable-pg] stopped Docker Desktop started by this run')
  }
}
