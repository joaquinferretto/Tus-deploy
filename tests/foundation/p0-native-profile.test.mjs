import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const nativeProfile = await import('../../scripts/dev/native-profile.mjs')
const { OwnedChild } = await import('../../scripts/test-runner-lib.mjs')

function temporaryRoot(envContents) {
  const directory = mkdtempSync(join(tmpdir(), 'native-profile-'))
  writeFileSync(join(directory, '.env'), envContents)
  return directory
}

test('native wrappers are source-free and delegate to the intended app scripts', () => {
  const backend = JSON.parse(readFileSync(join(root, 'backend/package.json'), 'utf8'))
  const frontend = JSON.parse(readFileSync(join(root, 'frontend/package.json'), 'utf8'))

  assert.match(backend.scripts.dev, /native-profile\.mjs\s+api/)
  assert.match(frontend.scripts.dev, /native-profile\.mjs\s+web/)
  assert.equal(existsSync(join(root, 'backend/src')), false)
  assert.equal(existsSync(join(root, 'frontend/src')), false)
  assert.equal(existsSync(join(root, 'backend/.env')), false)
  assert.equal(existsSync(join(root, 'frontend/.env')), false)
})

test('root env resolution consumes only DATABASE_URL and root file wins over ambient process values', () => {
  const rootDirectory = temporaryRoot('DATABASE_URL=file-value\nAPI_PORT=3999\nOTHER_SECRET=do-not-consume\n')

  assert.equal(nativeProfile.readRootDatabaseUrl(rootDirectory), 'file-value')
  assert.equal(nativeProfile.resolveDatabaseUrl({ rootDirectory, processEnv: { DATABASE_URL: 'process-value' } }), 'file-value')
  assert.equal(nativeProfile.resolveDatabaseUrl({ rootDirectory, processEnv: { DATABASE_URL: '   ' } }), 'file-value')
  assert.equal(nativeProfile.resolveDatabaseUrl({ rootDirectory, processEnv: {} }), 'file-value')
})

test('file-only and missing database configuration are explicit', () => {
  const fileOnlyRoot = temporaryRoot('DATABASE_URL=file-only\n')
  const emptyRoot = temporaryRoot('OTHER=value\n')

  assert.equal(nativeProfile.resolveDatabaseUrl({ rootDirectory: emptyRoot, processEnv: { DATABASE_URL: 'process-only' } }), undefined)
  assert.equal(nativeProfile.resolveDatabaseUrl({ rootDirectory: fileOnlyRoot, processEnv: {} }), 'file-only')
  assert.equal(nativeProfile.resolveDatabaseUrl({ rootDirectory: emptyRoot, processEnv: {} }), undefined)
})

test('native diagnostics redact values and child exit codes propagate', async () => {
  const secret = 'postgresql://user:password@host/db'
  const diagnostic = nativeProfile.formatNativeDiagnostic({ databaseConfigured: true, databaseUrl: secret })

  assert.doesNotMatch(diagnostic, /password|host\/db/)
  assert.match(diagnostic, /configured=true/)

  const result = await nativeProfile.runChild(process.execPath, ['-e', 'process.exit(17)'], { cwd: root })
  assert.equal(result, 17)
})

test('native child execution is bounded and cleans up a timed-out process', async () => {
  const startedAt = Date.now()
  const result = await nativeProfile.runChild(process.execPath, ['-e', 'while (true) {}'], {
    cwd: root,
    env: nativeProfile.buildNativeChildEnvironment({ baseEnvironment: process.env }),
    requestMs: 25,
    shutdownMs: 25,
  })

  assert.equal(result, 124)
  assert.equal(Date.now() - startedAt < 500, true)
})

test('owned child treats Windows close as termination and escalates only the owned PID', async () => {
  const signals = []
  let closeHandler
  const child = {
    pid: 43,
    spawncwd: process.cwd(),
    spawnargs: ['node', '-e', 'while (true) {}'],
    exitCode: null,
    once: (event, callback) => {
      if (event === 'close') closeHandler = callback
    },
    kill: (signal) => {
      signals.push(signal)
      if (signal === 'SIGKILL') {
        child.exitCode = null
        closeHandler?.(null, signal)
      }
      return true
    },
  }
  const owned = new OwnedChild({
    child,
    command: 'node',
    args: ['-e', 'while (true) {}'],
    cwd: process.cwd(),
    shutdownMs: 25,
  })

  await owned.stop()

  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
})
