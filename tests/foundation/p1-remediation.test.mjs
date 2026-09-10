import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const nodePath = process.execPath
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(nodePath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

test('injected TUS routers are mounted for isolated HTTP contract harnesses', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
    })
    const address = server.address()
    const response = await fetch('http://127.0.0.1:' + address.port + '/tus/v1/marketplace/discovery')
    const body = await response.json()
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ status: response.status, body }))
  `)

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, {
    contractVersion: '1.0.0',
    evidence: 'local-deterministic',
    items: [],
  })
})

test('delivery status guards accept only statuses valid for each transition', async () => {
  const { isCancellableDeliveryStatus, isTerminalDeliveryStatus } = await import('../../apps/api/src/tus/delivery/index.ts')

  assert.equal(isCancellableDeliveryStatus('queued'), true)
  assert.equal(isCancellableDeliveryStatus('delivered'), false)
  assert.equal(isTerminalDeliveryStatus('delivered'), true)
  assert.equal(isTerminalDeliveryStatus('accepted'), false)
})

test('Mercado Pago package declares browser fetch and Node built-in type libraries', () => {
  const config = JSON.parse(readFileSync(join(root, 'packages/mercado-pago/tsconfig.json'), 'utf8'))
  assert.deepEqual(config.compilerOptions.lib, ['ES2022', 'DOM'])
  assert.deepEqual(config.compilerOptions.types, ['node'])
})

test('Mercado Pago package is represented in the workspace lockfile', () => {
  const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lockfile, /  packages\/mercado-pago:\n/u)
})

test('Mercado Pago package uses the workspace TypeScript config package name', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'packages/mercado-pago/package.json'), 'utf8'))
  assert.equal(packageJson.devDependencies['@factory/typescript-config'], 'workspace:*')
  assert.equal(packageJson.devDependencies['@repo/typescript-config'], undefined)
})

test('tracked security scan accepts the documented test-only placeholders', () => {
  execFileSync(nodePath, [
    'scripts/security/scan-secrets.mjs',
    'apps/mobile/tests/unit/tus-pos.test.ts',
    'packages/mercado-pago/tests/mercado-pago.test.cjs',
  ], {
    cwd: root,
    stdio: 'pipe',
  })
})

test('API package exposes root-env Prisma validation without a package-local URL', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8'))
  assert.equal(packageJson.scripts['prisma:validate'], 'node ../../scripts/prisma-validate.mjs')
})

test('Next build traces from the repository workspace root', () => {
  const nextConfig = readFileSync(join(root, 'apps/web/next.config.js'), 'utf8')
  assert.match(nextConfig, /outputFileTracingRoot/u)
})
