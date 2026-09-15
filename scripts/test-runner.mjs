import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_TEST_TIMEOUT_MS,
  createFailureRecord,
  discoverTestFiles,
  selectTestFiles,
} from './test-runner-lib.mjs'

export { DEFAULT_TEST_TIMEOUT_MS, createFailureRecord, discoverTestFiles, selectTestFiles }

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
      [
        '--experimental-strip-types',
        '--experimental-transform-types',
        '--experimental-loader',
        './scripts/node-strip-types-loader.mjs',
        '--test',
        '--test-concurrency=1',
        file,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs(),
        killSignal: 'SIGTERM',
      }
    )

    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)

    if (result.status !== 0) {
      exitCode = 1
      const timedOut = result.error?.code === 'ETIMEDOUT'
      const record = createFailureRecord({
        file,
        output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
        exitCode: result.status ?? 1,
        timedOut,
      })
      console.error(`Validation failure: ${JSON.stringify(record)}`)
    }
  }

  return exitCode
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = run()
