import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  buildNativeChildEnvironment,
  NATIVE_API_PORT,
  NATIVE_WEB_PORT,
  repositoryRoot,
  resolveDatabaseUrl,
  resolveNativeSafeTarget,
} from './native-profile.mjs'

export const MAX_DETACHED_DEADLINE_MS = 120_000
export const DEFAULT_CHECK_TIMEOUT_MS = 30_000
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000
export const DEFAULT_SPAWN_TIMEOUT_MS = 5_000
export const DEFAULT_PORT_PROBE_TIMEOUT_MS = 750
export const DEFAULT_HTTP_TIMEOUT_MS = 3_000
export const DEFAULT_STATE_DIRECTORY = join(tmpdir(), 'tus-dev-launcher')

const SERVICE_NAMES = new Set(['api', 'web'])

export function getStateDirectory(stateDirectory = process.env.TUS_DEV_LAUNCHER_DIR || DEFAULT_STATE_DIRECTORY) {
  return resolve(stateDirectory)
}

export function getStatePaths(service, stateDirectory) {
  const normalizedService = normalizeServiceName(service)
  const directory = getStateDirectory(stateDirectory)
  return {
    directory,
    metadata: join(directory, `${normalizedService}.json`),
    stdout: join(directory, `${normalizedService}.stdout.log`),
    stderr: join(directory, `${normalizedService}.stderr.log`),
  }
}

export function createServiceDefinition(service, {
  rootDirectory = repositoryRoot,
  environment = process.env,
  includeEnvironment = true,
} = {}) {
  const normalizedService = normalizeServiceName(service)
  const root = resolve(rootDirectory)
  const appRoot = join(root, 'apps', normalizedService)
  const port = normalizedService === 'api'
    ? parsePort(environment.API_PORT || NATIVE_API_PORT, 'API_PORT')
    : parsePort(environment.WEB_PORT || environment.PORT || NATIVE_WEB_PORT, 'WEB_PORT')
  const host = '127.0.0.1'
  const apiPort = parsePort(environment.API_PORT || NATIVE_API_PORT, 'API_PORT')
  const webPort = parsePort(environment.WEB_PORT || environment.PORT || NATIVE_WEB_PORT, 'WEB_PORT')

  if (normalizedService === 'api') {
    const entrypoint = join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    assertEntrypoint(entrypoint, 'API dev entrypoint')
    return {
      service: normalizedService,
      cwd: appRoot,
      host,
      port,
      command: process.execPath,
      args: [entrypoint, 'watch', 'src/index.ts'],
      healthPaths: ['/health', '/ready'],
      ...(includeEnvironment ? { env: buildServiceEnvironment(normalizedService, { rootDirectory: root, environment, apiPort, webPort }) } : {}),
    }
  }

  const entrypoint = join(appRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
  assertEntrypoint(entrypoint, 'Web dev entrypoint')
  return {
    service: normalizedService,
    cwd: appRoot,
    host,
    port,
    command: process.execPath,
    args: [entrypoint, 'dev', '--hostname', host, '--port', String(port)],
    healthPaths: ['/'],
    ...(includeEnvironment ? { env: buildServiceEnvironment(normalizedService, { rootDirectory: root, environment, apiPort, webPort }) } : {}),
  }
}

function buildServiceEnvironment(service, { rootDirectory, environment, apiPort, webPort }) {
  const effectiveEnvironment = {
    ...environment,
    FACTORY_PROFILE: environment.FACTORY_PROFILE || 'local',
    NODE_ENV: environment.NODE_ENV || 'development',
  }
  const databaseUrl = resolveDatabaseUrl({ rootDirectory, processEnv: environment })
  const target = resolveNativeSafeTarget({ rootDirectory, processEnv: effectiveEnvironment })
  if (databaseUrl && target.status !== 'ready') {
    throw new Error(`Native profile database target rejected: ${target.reason}`)
  }

  const env = buildNativeChildEnvironment({
    baseEnvironment: effectiveEnvironment,
    databaseUrl,
    webApiUrl: service === 'web'
      ? effectiveEnvironment.NEXT_PUBLIC_API_URL || `http://localhost:${apiPort}`
      : undefined,
  })
  env.FACTORY_PROFILE = effectiveEnvironment.FACTORY_PROFILE
  env.NODE_ENV = effectiveEnvironment.NODE_ENV
  env.NATIVE_PROFILE = '1'
  env.TUS_ROUTES_ENABLED = effectiveEnvironment.TUS_ROUTES_ENABLED || 'true'
  env.TUS_PROVIDER_ACTIONS_ENABLED = effectiveEnvironment.TUS_PROVIDER_ACTIONS_ENABLED || 'false'
  if (service === 'api') env.CORS_ORIGINS = effectiveEnvironment.CORS_ORIGINS || `http://localhost:${webPort}`
  return env
}

function assertEntrypoint(entrypoint, label) {
  if (!existsSync(entrypoint)) throw new Error(`${label} not found at ${entrypoint}`)
}

function parsePort(value, name) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid ${name} configuration`)
  return port
}

function normalizeServiceName(service) {
  const normalized = String(service || '').trim().toLowerCase()
  if (!SERVICE_NAMES.has(normalized)) throw new Error('Detached service must be api or web')
  return normalized
}

function normalizePid(pid) {
  const normalized = Number(pid)
  if (!Number.isInteger(normalized) || normalized <= 0) throw new Error('Invalid detached process PID')
  return normalized
}

function boundedTimeout(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_DETACHED_DEADLINE_MS)
    : fallback
}

export function isProcessAlive(pid) {
  const normalizedPid = Number(pid)
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) return false
  try {
    process.kill(normalizedPid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function probePort(host, port, timeoutMs = DEFAULT_PORT_PROBE_TIMEOUT_MS) {
  const bounded = boundedTimeout(timeoutMs, DEFAULT_PORT_PROBE_TIMEOUT_MS)
  return new Promise((resolveProbe) => {
    let settled = false
    const socket = createConnection({ host, port })
    const timer = setTimeout(() => finish(false), bounded)
    const finish = (listening) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolveProbe(listening)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

export async function requestHttp(url, { timeoutMs = DEFAULT_HTTP_TIMEOUT_MS } = {}) {
  const bounded = boundedTimeout(timeoutMs, DEFAULT_HTTP_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), bounded)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'manual' })
    return { ok: response.status >= 200 && response.status < 300, status: response.status }
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'AbortError' ? 'timeout' : 'unreachable',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function launchDetached(definition, {
  stateDirectory,
  spawnTimeoutMs = DEFAULT_SPAWN_TIMEOUT_MS,
} = {}) {
  validateDefinition(definition)
  const paths = getStatePaths(definition.service, stateDirectory)
  await fs.mkdir(paths.directory, { recursive: true })

  const existing = await readMetadata(paths.metadata)
  if (await probePort(definition.host, definition.port)) {
    return { status: 'ALREADY_RUNNING', service: definition.service, port: definition.port, pid: existing?.pid }
  }
  if (existing && isProcessAlive(existing.pid)) {
    return { status: 'STARTING', service: definition.service, port: existing.port, pid: existing.pid }
  }
  if (existing) await removeMetadata(paths.metadata)

  const stdoutFd = openSync(paths.stdout, 'a')
  const stderrFd = openSync(paths.stderr, 'a')
  let child
  try {
    child = spawn(definition.command, definition.args, {
      cwd: definition.cwd,
      env: definition.env,
      detached: true,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', stdoutFd, stderrFd],
    })
    child.unref()
    await waitForSpawn(child, boundedTimeout(spawnTimeoutMs, DEFAULT_SPAWN_TIMEOUT_MS))
    await delay(25)
    if (!isProcessAlive(child.pid)) throw new Error('Detached child exited before metadata was written')

    const metadata = {
      version: 1,
      service: definition.service,
      pid: normalizePid(child.pid),
      host: definition.host,
      port: definition.port,
      cwd: definition.cwd,
      command: definition.command,
      args: definition.args,
      healthPaths: definition.healthPaths,
      startedAt: new Date().toISOString(),
      stdout: paths.stdout,
      stderr: paths.stderr,
    }
    await writeMetadata(paths.metadata, metadata)
    return { status: 'STARTED', service: definition.service, port: definition.port, pid: metadata.pid, metadata }
  } catch (error) {
    if (child?.pid && isProcessAlive(child.pid)) {
      try { process.kill(child.pid, 'SIGTERM') } catch {}
    }
    await removeMetadata(paths.metadata)
    throw error
  } finally {
    closeSync(stdoutFd)
    closeSync(stderrFd)
  }
}

async function waitForSpawn(child, timeoutMs) {
  await new Promise((resolveSpawn, rejectSpawn) => {
    let settled = false
    const timer = setTimeout(() => finish(new Error('Detached child did not spawn within the deadline')), timeoutMs)
    const onSpawn = () => finish(undefined)
    const onError = (error) => finish(error)
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('spawn', onSpawn)
      child.removeListener('error', onError)
      if (error) rejectSpawn(error)
      else resolveSpawn()
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })
}

export async function checkDetached(service, {
  stateDirectory,
  timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
  definition = createServiceDefinition(service, { includeEnvironment: false }),
} = {}) {
  const paths = getStatePaths(service, stateDirectory)
  const metadata = await readMetadata(paths.metadata)
  if (!metadata) {
    const listening = await probePort(definition.host, definition.port)
    return listening
      ? { status: 'UNHEALTHY', service, port: definition.port, reason: 'unmanaged-listener' }
      : { status: 'NOT_RUNNING', service, port: definition.port }
  }

  const metadataPid = normalizePid(metadata.pid)
  const port = parsePort(metadata.port, 'detached metadata port')
  const host = metadata.host || definition.host
  if (!isProcessAlive(metadataPid)) {
    await removeMetadata(paths.metadata)
    const listening = await probePort(host, port)
    return listening
      ? { status: 'UNHEALTHY', service, port, reason: 'registered-process-exited-port-occupied' }
      : { status: 'NOT_RUNNING', service, port }
  }

  const listening = await probePort(host, port)
  if (!listening) return { status: 'STARTING', service, port, pid: metadataPid }

  const deadline = Date.now() + boundedTimeout(timeoutMs, DEFAULT_CHECK_TIMEOUT_MS)
  const checks = []
  for (const path of metadata.healthPaths || definition.healthPaths) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      checks.push({ path, ok: false, error: 'timeout' })
      break
    }
    const result = await requestHttp(`http://${host}:${port}${path}`, {
      timeoutMs: Math.min(DEFAULT_HTTP_TIMEOUT_MS, remaining),
    })
    checks.push({ path, ...result })
  }
  const ready = checks.length === (metadata.healthPaths || definition.healthPaths).length && checks.every((check) => check.ok)
  return {
    status: ready ? 'READY' : 'UNHEALTHY',
    service,
    port,
    pid: metadataPid,
    checks,
  }
}

export async function stopDetached(service, {
  stateDirectory,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
} = {}) {
  const paths = getStatePaths(service, stateDirectory)
  const metadata = await readMetadata(paths.metadata)
  if (!metadata) return { status: 'NOT_RUNNING', service }

  const pid = normalizePid(metadata.pid)
  if (pid === process.pid) throw new Error('Refusing to stop the launcher process')
  if (isProcessAlive(pid)) {
    sendSignal(pid, 'SIGTERM')
    let stopped = await waitForProcessExit(pid, boundedTimeout(shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS))
    if (!stopped) {
      sendSignal(pid, 'SIGKILL')
      stopped = await waitForProcessExit(pid, boundedTimeout(shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS))
    }
    if (!stopped) return { status: 'STOP_FAILED', service, port: metadata.port, pid, reason: 'registered-process-did-not-exit' }
  }

  await removeMetadata(paths.metadata)
  const host = metadata.host || '127.0.0.1'
  const port = parsePort(metadata.port, 'detached metadata port')
  const listening = !(await waitForPortFree(host, port, boundedTimeout(shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS)))
  return {
    status: listening ? 'STOPPED_PORT_OCCUPIED' : 'STOPPED',
    service,
    port: metadata.port,
    pid,
  }
}

function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true
    await delay(50)
  }
  return !isProcessAlive(pid)
}

async function waitForPortFree(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    if (!(await probePort(host, port, Math.min(DEFAULT_PORT_PROBE_TIMEOUT_MS, remaining)))) return true
    await delay(50)
  }
  return !(await probePort(host, port, DEFAULT_PORT_PROBE_TIMEOUT_MS))
}

export function formatResult(result) {
  const fields = [result.status, result.service]
  if (result.pid !== undefined) fields.push(`pid=${result.pid}`)
  if (result.port !== undefined) fields.push(`port=${result.port}`)
  if (result.checks) fields.push(`checks=${result.checks.map((check) => `${check.path}:${check.status ?? check.error ?? 'failed'}`).join(',')}`)
  if (result.reason) fields.push(`reason=${result.reason}`)
  if (result.metadata?.stdout) fields.push(`stdout=${result.metadata.stdout}`)
  if (result.metadata?.stderr) fields.push(`stderr=${result.metadata.stderr}`)
  return fields.join(' ')
}

function validateDefinition(definition) {
  if (!definition || typeof definition !== 'object') throw new TypeError('Detached service definition is required')
  normalizeServiceName(definition.service)
  parsePort(definition.port, 'detached service port')
  if (!definition.cwd || !definition.command || !Array.isArray(definition.args)) throw new TypeError('Detached service definition is incomplete')
  if (!Array.isArray(definition.healthPaths) || definition.healthPaths.length === 0) throw new TypeError('Detached health paths are required')
}

async function readMetadata(metadataPath) {
  try {
    const content = await fs.readFile(metadataPath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw new Error(`Unable to read detached metadata: ${metadataPath}`)
  }
}

async function writeMetadata(metadataPath, metadata) {
  const temporaryPath = `${metadataPath}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  await fs.rename(temporaryPath, metadataPath)
}

async function removeMetadata(metadataPath) {
  try {
    await fs.unlink(metadataPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function delay(durationMs) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs))
}
