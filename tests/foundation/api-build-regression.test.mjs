import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

test('API TypeScript build remains deterministic', () => {
  const result = spawnSync(packageManager, ['--filter', '@factory/api...', 'build'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  assert.equal(
    result.status,
    0,
    `API build failed with exit ${result.status}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
  )
})
