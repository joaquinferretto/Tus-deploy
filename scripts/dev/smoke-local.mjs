import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createServiceDefinition,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_PORT_PROBE_TIMEOUT_MS,
  probePort,
} from './detached-common.mjs'

export const DEFAULT_SMOKE_TIMEOUT_MS = 30_000
export const DEFAULT_SMOKE_SHUTDOWN_TIMEOUT_MS = 10_000
export const DEFAULT_SMOKE_SPAWN_TIMEOUT_MS = 5_000
export const WEB_SMOKE_PATHS = Object.freeze(['/', '/tus/mercado', '/tus/pos', '/tus/soporte', '/tus/prestador'])

export class SmokeError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'SmokeError'
    this.details = details
  }
}

export async function runSmoke(service, {
  definition = createServiceDefinition(service),
  timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
  shutdownTimeoutMs = DEFAULT_SMOKE_SHUTDOWN_TIMEOUT_MS,
  spawnTimeoutMs = DEFAULT_SMOKE_SPAWN_TIMEOUT_MS,
  httpTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  expectations = defaultExpectations(service),
} = {}) {
  const smokeTimeout = boundedTimeout(timeoutMs, DEFAULT_SMOKE_TIMEOUT_MS, DEFAULT_SMOKE_TIMEOUT_MS)
  const shutdownTimeout = boundedTimeout(shutdownTimeoutMs, DEFAULT_SMOKE_SHUTDOWN_TIMEOUT_MS, DEFAULT_SMOKE_SHUTDOWN_TIMEOUT_MS)
  const spawnTimeout = boundedTimeout(spawnTimeoutMs, DEFAULT_SMOKE_SPAWN_TIMEOUT_MS, DEFAULT_SMOKE_SPAWN_TIMEOUT_MS)
  const httpTimeout = boundedTimeout(httpTimeoutMs, DEFAULT_HTTP_TIMEOUT_MS, DEFAULT_HTTP_TIMEOUT_MS)
  const temporaryDirectory = await fs.mkdtemp(join(tmpdir(), 'tus-local-smoke-'))
  const stdoutPath = join(temporaryDirectory, 'stdout.log')
  const stderrPath = join(temporaryDirectory, 'stderr.log')
  let stdoutFd
  let stderrFd
  let child
  let checks = []
  let result
  let failure
  let cleanupFailure
  let portFree

  try {
    if (await probePort(definition.host, definition.port)) {
      throw new SmokeError(`Smoke ${service} refused to start because port ${definition.port} is occupied`, {
        service,
        port: definition.port,
        reason: 'port-occupied',
      })
    }

    stdoutFd = openSync(stdoutPath, 'a')
    stderrFd = openSync(stderrPath, 'a')
    child = spawn(definition.command, definition.args, {
      cwd: definition.cwd,
      env: definition.env,
      detached: false,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', stdoutFd, stderrFd],
    })
    await waitForSpawn(child, spawnTimeout)

    checks = await waitForExpectations({
      child,
      definition,
      expectations,
      timeoutMs: smokeTimeout,
      httpTimeoutMs: httpTimeout,
    })
    result = {
      status: 'PASS',
      service,
      pid: child.pid,
      port: definition.port,
      checks,
    }
  } catch (error) {
    failure = error instanceof Error ? error : new SmokeError('Local smoke failed')
  } finally {
    if (child) {
      try {
        await stopChild(child, shutdownTimeout)
        portFree = await waitForPortFree(definition.host, definition.port, shutdownTimeout)
        if (!portFree) {
          cleanupFailure = new SmokeError(`Smoke ${service} left port ${definition.port} occupied`, {
            service,
            port: definition.port,
            reason: 'port-not-free-after-cleanup',
          })
        }
      } catch (error) {
        cleanupFailure = error instanceof Error ? error : new SmokeError('Smoke cleanup failed')
      }
    }

    if (stdoutFd !== undefined) closeSync(stdoutFd)
    if (stderrFd !== undefined) closeSync(stderrFd)

    const logs = await readLogs(stdoutPath, stderrPath)
    if (result) result = { ...result, logs }
    if (failure instanceof SmokeError) failure.details = { ...failure.details, checks, logs, pid: child?.pid, portFree }
    else if (failure) failure = new SmokeError(failure.message, { checks, logs })
    if (!failure && cleanupFailure) failure = cleanupFailure
    if (failure instanceof SmokeError && cleanupFailure && failure !== cleanupFailure) {
      failure.details = { ...failure.details, cleanup: cleanupFailure.message }
    }

    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }

  if (failure) throw failure
  return result
}

function defaultExpectations(service) {
  if (service === 'api') {
    return [
      { path: '/health', expectedStatus: 200 },
      { path: '/ready', expectedStatus: 200, parseJson: true, bodyCheck: (body) => body?.ready === true },
    ]
  }
  if (service === 'web') return WEB_SMOKE_PATHS.map((path) => ({ path, expectedStatus: 200 }))
  throw new SmokeError('Local smoke service must be api or web')
}

async function waitForExpectations({ child, definition, expectations, timeoutMs, httpTimeoutMs }) {
  const deadline = Date.now() + timeoutMs
  let lastChecks = []
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new SmokeError(`Smoke process exited before readiness with code ${child.exitCode ?? 'unknown'}`, { checks: lastChecks })
    }

    const remaining = deadline - Date.now()
    if (await probePort(definition.host, definition.port, Math.min(DEFAULT_PORT_PROBE_TIMEOUT_MS, remaining))) {
      lastChecks = []
      for (const expectation of expectations) {
        const checkRemaining = deadline - Date.now()
        if (checkRemaining <= 0) break
        lastChecks.push(await requestExpectation(definition, expectation, Math.min(httpTimeoutMs, checkRemaining)))
      }
      if (lastChecks.length === expectations.length && lastChecks.every((check) => check.ok)) return lastChecks
      if (lastChecks.some((check) => check.status >= 400 && check.status < 500 && check.status !== 429)) {
        throw new SmokeError('Local smoke HTTP assertion failed', { checks: lastChecks })
      }
    }

    await delay(Math.min(100, Math.max(deadline - Date.now(), 1)))
  }

  throw new SmokeError(`Local smoke did not become ready within ${timeoutMs} ms`, { checks: lastChecks })
}

async function requestExpectation(definition, expectation, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`http://${definition.host}:${definition.port}${expectation.path}`, {
      signal: controller.signal,
      redirect: 'manual',
    })
    let body
    if (expectation.parseJson) {
      try {
        body = await response.json()
      } catch {
        return { path: expectation.path, status: response.status, ok: false, error: 'invalid-json' }
      }
    } else {
      await response.body?.cancel()
    }
    return {
      path: expectation.path,
      status: response.status,
      ok: response.status === expectation.expectedStatus && (!expectation.bodyCheck || expectation.bodyCheck(body)),
    }
  } catch (error) {
    return {
      path: expectation.path,
      ok: false,
      error: error?.name === 'AbortError' ? 'timeout' : 'unreachable',
    }
  } finally {
    clearTimeout(timer)
  }
}

async function waitForSpawn(child, timeoutMs) {
  await new Promise((resolveSpawn, rejectSpawn) => {
    let settled = false
    const timer = setTimeout(() => finish(new SmokeError('Smoke child did not spawn within the deadline')), timeoutMs)
    const onSpawn = () => finish()
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

async function stopChild(child, timeoutMs) {
  if (!child.pid || child.exitCode !== null) return
  try { child.kill('SIGTERM') } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
  if (await waitForChildExit(child, timeoutMs)) return
  try { child.kill('SIGKILL') } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
  if (!(await waitForChildExit(child, timeoutMs))) throw new SmokeError(`Smoke child ${child.pid} did not terminate`)
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise((resolveExit) => {
    let settled = false
    const timer = setTimeout(() => finish(false), timeoutMs)
    const finish = (exited) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      child.removeListener('close', onClose)
      resolveExit(exited)
    }
    const onExit = () => finish(true)
    const onClose = () => finish(true)
    child.once('exit', onExit)
    child.once('close', onClose)
  })
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

async function readLogs(stdoutPath, stderrPath) {
  const read = async (path) => {
    try {
      const content = await fs.readFile(path, 'utf8')
      return content.slice(-4_000)
    } catch {
      return ''
    }
  }
  return { stdout: await read(stdoutPath), stderr: await read(stderrPath) }
}

function boundedTimeout(value, fallback, maximum) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

function delay(durationMs) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs))
}

async function main() {
  const service = process.argv[2]
  const result = await runSmoke(service)
  const checks = result.checks.map((check) => `${check.path}:${check.status}`).join(',')
  console.log(`SMOKE ${result.service} PASS pid=${result.pid} port=${result.port} checks=${checks}`)
}

if (process.argv[1]?.endsWith('smoke-local.mjs')) {
  try {
    await main()
  } catch (error) {
    const details = error?.details || {}
    const checks = details.checks?.map((check) => `${check.path}:${check.status ?? check.error ?? 'failed'}`).join(',')
    console.error(`SMOKE ${process.argv[2] || 'unknown'} FAIL${checks ? ` checks=${checks}` : ''}${error instanceof Error ? ` reason=${error.message}` : ''}`)
    process.exitCode = 1
  }
}
