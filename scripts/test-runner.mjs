import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_TEST_TIMEOUT_MS,
  discoverTestFiles,
  selectTestFiles,
} from './test-runner-lib.mjs'

export { DEFAULT_TEST_TIMEOUT_MS, discoverTestFiles, selectTestFiles }

function timeoutMs() {
  const value = Number(process.env.TEST_FILE_TIMEOUT_MS ?? DEFAULT_TEST_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TEST_TIMEOUT_MS
}

function run() {
  let files
  try {
    files = selectTestFiles(process.cwd(), process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }

  if (files.length === 0) {
    console.error('No test files were discovered')
    return 1
  }

  let exitCode = 0
  for (const file of files) {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--test', '--test-concurrency=1', file],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: timeoutMs(),
        killSignal: 'SIGTERM',
      }
    )

    if (result.status !== 0) {
      exitCode = 1
      const reason = result.error?.code === 'ETIMEDOUT' ? `timeout after ${timeoutMs()}ms` : `exit ${result.status ?? 'unknown'}`
      console.error(`Validation file failed: ${file} (${reason})`)
    }
  }

  return exitCode
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = run()
