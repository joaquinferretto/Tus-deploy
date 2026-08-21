import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..', '..')

const sources = [
  {
    name: 'auth-kit-standalone',
    root: 'C:\\Users\\mmmau\\auth-kit-standalone',
    evidence: [
      'README.md',
      'openspec/specs/auth-security/spec.md',
      'packages/core/__tests__/runtime-boundaries.test.js',
      'packages/core/__tests__/neutrality.test.js',
    ],
  },
  {
    name: 'vialovers-integrated-auth-kit',
    root: 'C:\\Users\\mmmau\\vialovers-worktrees\\alqui-full-product\\apps\\server\\auth-kit',
    evidence: [
      'README.md',
      'core/adapters/__tests__/postgres-rotation.transaction.test.js',
      'core/controllers/__tests__/security.integration.test.js',
      'core/shield/csrf.js',
      'core/controllers/authController.js',
    ],
  },
]

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function readExternal(sourceRoot, relativePath) {
  return readFileSync(join(sourceRoot, relativePath), 'utf8')
}

function fingerprint(path) {
  const file = readFileSync(path)
  const stat = statSync(path)
  return {
    mode: stat.mode,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: createHash('sha256').update(file).digest('hex'),
  }
}

function sourceSnapshot() {
  return sources.flatMap(({ name, root: sourceRoot, evidence }) => evidence.map((file) => ({
    name,
    file,
    fingerprint: fingerprint(join(sourceRoot, file)),
  })))
}

function sourceIsOutsideFactory(sourceRoot) {
  const pathFromFactory = relative(root, sourceRoot)
  return pathFromFactory === '..' || pathFromFactory.startsWith('..\\') || pathFromFactory.startsWith('../')
}

function runtimeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !['.git', 'dist', 'node_modules'].includes(entry.name)) return runtimeFiles(path)
    return entry.isFile() && /\.(?:js|mjs|ts|tsx|json)$/iu.test(entry.name) ? [path] : []
  })
}

test('auth provenance records both sources as read-only evidence without copying their code', () => {
  const provenance = read('docs/security/auth-provenance.md')

  assert.match(provenance, /auth-kit-standalone/)
  assert.match(provenance, /vialovers-worktrees[\\/]alqui-full-product[\\/]apps[\\/]server[\\/]auth-kit/)
  assert.match(provenance, /read-only/iu)
  assert.match(provenance, /must not (?:copy|modify|import)/iu)
  assert.match(provenance, /structural|package boundaries/iu)
  assert.match(provenance, /atomic refresh rotation/iu)
  assert.match(provenance, /token hash|family checks/iu)
  assert.match(provenance, /both sources remain unchanged/iu)
  assert.doesNotMatch(provenance, /```(?:js|ts|javascript|sql)/iu)
})

test('provenance inspection keeps the external evidence files and paths immutable', () => {
  const before = sourceSnapshot()

  for (const { name, root: sourceRoot, evidence } of sources) {
    assert.equal(existsSync(sourceRoot), true, `${name} evidence root must exist`)
    assert.equal(sourceIsOutsideFactory(sourceRoot), true, `${name} must remain outside the factory`)
    for (const file of evidence) {
      assert.equal(existsSync(join(sourceRoot, file)), true, `${name}/${file} must exist`)
    }
  }

  const after = sourceSnapshot()
  assert.deepEqual(after, before)
})

test('provenance records regression controls before any successor auth implementation', () => {
  const provenance = read('docs/security/auth-provenance.md')
  const standaloneRoot = sources[0].root
  const integratedRoot = sources[1].root
  const standaloneRuntime = readExternal(standaloneRoot, 'packages/core/__tests__/runtime-boundaries.test.js')
  const standaloneNeutrality = readExternal(standaloneRoot, 'packages/core/__tests__/neutrality.test.js')
  const integratedRotation = readExternal(integratedRoot, 'core/adapters/__tests__/postgres-rotation.transaction.test.js')
  const integratedSecurity = readExternal(integratedRoot, 'core/controllers/__tests__/security.integration.test.js')
  const integratedCsrf = readExternal(integratedRoot, 'core/shield/csrf.js')

  for (const regression of [
    'privilege escalation',
    'access-token revocation blindness',
    'CSRF/cookie inconsistency',
    'unauthenticated MFA',
    'incomplete reset/verification',
    'migration/adapter mismatch',
    'stale dist',
    'DNI/host/guest/Alqui coupling',
  ]) {
    assert.match(provenance, new RegExp(regression.replaceAll('/', '\\/'), 'iu'))
  }

  assert.match(standaloneRuntime, /environment secrets|injected JWT secret/iu)
  assert.match(standaloneNeutrality, /provenance identifiers|concrete secret assignments/iu)
  assert.match(integratedRotation, /BEGIN[\s\S]*UPDATE refresh_tokens[\s\S]*INSERT INTO refresh_tokens[\s\S]*COMMIT/iu)
  assert.match(integratedRotation, /ROLLBACK/iu)
  assert.match(integratedSecurity, /WEAK_PASSWORD[\s\S]*totp/iu)
  assert.match(integratedCsrf, /timingSafeEqual[\s\S]*CSRF_TOKEN_INVALID/iu)
})

test('factory runtime paths contain no external auth-source import or copy marker', () => {
  const runtimeRoots = ['apps', 'packages', 'backend', 'frontend', 'scripts']
    .map((directory) => join(root, directory))
    .filter(existsSync)
  const forbidden = /auth-kit-standalone|vialovers-worktrees[\\/]alqui-full-product|@vialovers[\\/]auth-kit|copyFileSync[\s\S]{0,120}auth-kit/iu

  for (const file of runtimeRoots.flatMap(runtimeFiles)) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), forbidden, file)
  }
})
