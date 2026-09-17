import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  checkDetached,
  createServiceDefinition,
  getStatePaths,
  isProcessAlive,
  launchDetached,
  requestHttp,
  stopDetached,
} from '../../scripts/dev/detached-common.mjs'

const root = resolve(import.meta.dirname, '..', '..')

function temporaryStateDirectory() {
  return mkdtempSync(join(tmpdir(), 'tus-detached-launcher-'))
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  const port = address.port
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

async function waitForReady(service, options) {
  const deadline = Date.now() + 2_000
  let result
  while (Date.now() < deadline) {
    result = await checkDetached(service, options)
    if (result.status === 'READY') return result
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
  }
  return result
}

function fakeServiceDefinition(port, service = 'api') {
  const source = [
    "const http = require('node:http');",
    "const server = http.createServer((request, response) => { response.statusCode = request.url === '/ready' ? 200 : 200; response.end('ok'); });",
    "server.listen(Number(process.env.FAKE_PORT), '127.0.0.1');",
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join('')
  return {
    service,
    cwd: root,
    host: '127.0.0.1',
    port,
    command: process.execPath,
    args: ['-e', source],
    env: { ...process.env, FAKE_PORT: String(port) },
    healthPaths: ['/health'],
  }
}

test('service definitions use the repository Web and API commands without a shell', () => {
  const api = createServiceDefinition('api', { rootDirectory: root, includeEnvironment: false })
  const web = createServiceDefinition('web', { rootDirectory: root, includeEnvironment: false })

  assert.equal(api.command, process.execPath)
  assert.deepEqual(api.args.slice(-2), ['watch', 'src/index.ts'])
  assert.equal(api.port, 3101)
  assert.equal(web.command, process.execPath)
  assert.equal(web.args.at(-4), '--hostname')
  assert.equal(web.args.at(-2), '--port')
  assert.equal(web.port, 3000)
  assert.equal(api.cwd, join(root, 'apps', 'api'))
  assert.equal(web.cwd, join(root, 'apps', 'web'))
})

test('detached launcher starts, reports readiness, refuses duplicates, and stops only its PID', async () => {
  const stateDirectory = temporaryStateDirectory()
  const definition = fakeServiceDefinition(await freePort())
  let started
  try {
    const launchStartedAt = Date.now()
    started = await launchDetached(definition, { stateDirectory })
    assert.equal(started.status, 'STARTED')
    assert.equal(Date.now() - launchStartedAt < 2_000, true)
    assert.equal(isProcessAlive(started.pid), true)

    const paths = getStatePaths(definition.service, stateDirectory)
    const metadata = JSON.parse(readFileSync(paths.metadata, 'utf8'))
    assert.equal(metadata.pid, started.pid)
    assert.equal(metadata.stdout, paths.stdout)
    assert.equal(metadata.stderr, paths.stderr)

    const ready = await waitForReady(definition.service, { stateDirectory, definition })
    assert.equal(ready.status, 'READY')

    const duplicate = await launchDetached(definition, { stateDirectory })
    assert.equal(duplicate.status, 'ALREADY_RUNNING')
    assert.equal(duplicate.pid, started.pid)

    const stopped = await stopDetached(definition.service, { stateDirectory, shutdownTimeoutMs: 2_000 })
    assert.equal(stopped.status, 'STOPPED')
    assert.equal(isProcessAlive(started.pid), false)

    const notRunning = await checkDetached(definition.service, { stateDirectory, definition })
    assert.equal(notRunning.status, 'NOT_RUNNING')
    assert.equal((await stopDetached(definition.service, { stateDirectory })).status, 'NOT_RUNNING')
  } finally {
    if (started?.pid && isProcessAlive(started.pid)) await stopDetached(definition.service, { stateDirectory, shutdownTimeoutMs: 2_000 })
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('detached launcher does not stop an unmanaged listener and cleans stale metadata', async () => {
  const stateDirectory = temporaryStateDirectory()
  const definition = fakeServiceDefinition(await freePort(), 'web')
  const foreignServer = createServer((request, response) => response.end('foreign'))
  let foreignListening = false
  try {
    await new Promise((resolveListen, reject) => {
      foreignServer.once('error', reject)
      foreignServer.listen(definition.port, definition.host, () => {
        foreignListening = true
        resolveListen()
      })
    })

    const duplicate = await launchDetached(definition, { stateDirectory })
    assert.equal(duplicate.status, 'ALREADY_RUNNING')
    assert.equal((await stopDetached(definition.service, { stateDirectory })).status, 'NOT_RUNNING')
    assert.equal(await new Promise((resolveProbe) => {
      foreignServer.getConnections((error, count) => resolveProbe(!error && count >= 0))
    }), true)
    await new Promise((resolveClose) => foreignServer.close(() => {
      foreignListening = false
      resolveClose()
    }))

    const paths = getStatePaths(definition.service, stateDirectory)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(paths.metadata, `${JSON.stringify({
      version: 1,
      service: definition.service,
      pid: 2_147_483_647,
      host: definition.host,
      port: definition.port,
      healthPaths: definition.healthPaths,
    })}\n`))
    const stale = await checkDetached(definition.service, { stateDirectory, definition })
    assert.equal(stale.status, 'NOT_RUNNING')
    assert.equal(existsSync(paths.metadata), false)
  } finally {
    if (foreignListening) await new Promise((resolveClose) => foreignServer.close(resolveClose))
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('HTTP checks are bounded by an abort timeout', async () => {
  const server = createServer(() => undefined)
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  try {
    const result = await requestHttp(`http://127.0.0.1:${address.port}/hang`, { timeoutMs: 50 })
    assert.deepEqual(result, { ok: false, error: 'timeout' })
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose))
  }
})
