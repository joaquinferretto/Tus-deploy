import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const nativeProfile = await import('../../scripts/dev/native-profile.mjs')

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

test('root env resolution consumes only DATABASE_URL and process env wins when non-empty', () => {
  const rootDirectory = temporaryRoot('DATABASE_URL=file-value\nAPI_PORT=3999\nOTHER_SECRET=do-not-consume\n')

  assert.equal(nativeProfile.readRootDatabaseUrl(rootDirectory), 'file-value')
  assert.equal(nativeProfile.resolveDatabaseUrl({ rootDirectory, processEnv: { DATABASE_URL: 'process-value' } }), 'process-value')
  assert.equal(nativeProfile.resolveDatabaseUrl({ rootDirectory, processEnv: { DATABASE_URL: '   ' } }), 'file-value')
  assert.equal(nativeProfile.resolveDatabaseUrl({ rootDirectory, processEnv: {} }), 'file-value')
})

test('process-only, file-only, and missing database configuration are explicit', () => {
  const fileOnlyRoot = temporaryRoot('DATABASE_URL=file-only\n')
  const emptyRoot = temporaryRoot('OTHER=value\n')

  assert.equal(nativeProfile.resolveDatabaseUrl({ rootDirectory: emptyRoot, processEnv: { DATABASE_URL: 'process-only' } }), 'process-only')
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
