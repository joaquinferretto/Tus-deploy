import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const files = readdirSync('tests/foundation')
  .filter((file) => file.endsWith('.test.mjs'))
  .map((file) => `tests/foundation/${file}`)

const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files], {
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
