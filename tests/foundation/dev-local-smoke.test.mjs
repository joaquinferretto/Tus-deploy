import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { isProcessAlive, probePort } from '../../scripts/dev/detached-common.mjs'
import { runSmoke, SmokeError } from '../../scripts/dev/smoke-local.mjs'

const root = resolve(import.meta.dirname, '..', '..')

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const port = server.address().port
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

function fakeDefinition(port, responseStatus = 200) {
  const source = [
    "const http = require('node:http');",
    `const server = http.createServer((request, response) => { response.statusCode = ${responseStatus}; response.end('ok'); });`,
    "server.listen(Number(process.env.FAKE_PORT), '127.0.0.1');",
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join('')
  return {
    service: 'web',
    cwd: root,
    host: '127.0.0.1',
    port,
    command: process.execPath,
    args: ['-e', source],
    env: { ...process.env, FAKE_PORT: String(port) },
  }
}

test('local smoke owns a temporary server and cleans it after successful HTTP checks', async () => {
  const port = await freePort()
  const definition = fakeDefinition(port)
  const result = await runSmoke('web', {
    definition,
    expectations: [{ path: '/', expectedStatus: 200 }],
    timeoutMs: 2_000,
    shutdownTimeoutMs: 2_000,
  })

  assert.equal(result.status, 'PASS')
  assert.equal(result.checks[0].status, 200)
  assert.equal(isProcessAlive(result.pid), false)
  assert.equal(await probePort('127.0.0.1', port), false)
})

test('local smoke cleans the child and port after an HTTP assertion failure', async () => {
  const port = await freePort()
  const definition = fakeDefinition(port, 404)

  await assert.rejects(
    () => runSmoke('web', {
      definition,
      expectations: [{ path: '/missing', expectedStatus: 200 }],
      timeoutMs: 2_000,
      shutdownTimeoutMs: 2_000,
    }),
    (error) => error instanceof SmokeError && /HTTP assertion failed/.test(error.message) && error.details.portFree === true,
  )

  assert.equal(await probePort('127.0.0.1', port), false)
})

test('local smoke enforces a bounded HTTP timeout and does not use detached handles', async () => {
  const port = await freePort()
  const source = [
    "const http = require('node:http');",
    "const server = http.createServer(() => {});",
    "server.listen(Number(process.env.FAKE_PORT), '127.0.0.1');",
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join('')
  const definition = {
    service: 'web',
    cwd: root,
    host: '127.0.0.1',
    port,
    command: process.execPath,
    args: ['-e', source],
    env: { ...process.env, FAKE_PORT: String(port) },
  }
  const smokeSource = readFileSync(join(root, 'scripts/dev/smoke-local.mjs'), 'utf8')

  await assert.rejects(
    () => runSmoke('web', {
      definition,
      expectations: [{ path: '/hang', expectedStatus: 200 }],
      timeoutMs: 250,
      httpTimeoutMs: 50,
      shutdownTimeoutMs: 2_000,
    }),
    (error) => error instanceof SmokeError && /did not become ready|timeout/.test(error.message) && error.details.portFree === true,
  )

  assert.equal(await probePort('127.0.0.1', port), false)
  assert.doesNotMatch(smokeSource, /detached:\s*true/)
  assert.doesNotMatch(smokeSource, /\.unref\(\)/)
})
