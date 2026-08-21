import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'))
}

test('workspace metadata is deterministic and uses one neutral namespace', () => {
  const manifest = readJson('package.json')
  const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const turbo = readJson('turbo.json')

  assert.equal(manifest.packageManager, 'pnpm@9.15.9')
  assert.equal(manifest.engines.node, '>=20.11.0 <23')
  assert.match(workspace, /apps\/\*/) 
  assert.match(workspace, /packages\/\*/) 
  assert.equal(turbo.pipeline.test.dependsOn.length, 0)
  assert.ok(existsSync(join(root, 'pnpm-lock.yaml')))
})

test('every workspace package has the canonical namespace and lifecycle scripts', () => {
  const packagePaths = [
    'apps/api/package.json',
    'apps/web/package.json',
    'apps/mobile/package.json',
    'packages/asset-pipelines/package.json',
    'packages/config/package.json',
    'packages/contracts/package.json',
    'packages/errors/package.json',
    'packages/lifecycle/package.json',
    'packages/observability/package.json',
    'packages/workflows/package.json',
    'packages/zod-schemas/package.json',
  ]

  for (const packagePath of packagePaths) {
    const manifest = readJson(packagePath)
    assert.match(manifest.name, /^@factory\//, packagePath)
    assert.equal(typeof manifest.scripts?.test, 'string', packagePath)
  }
})
