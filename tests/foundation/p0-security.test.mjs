import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

test('secret policy ignores local values while preserving only the example template', () => {
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8')
  const example = readFileSync(join(root, '.env.example'), 'utf8')

  assert.match(gitignore, /\.env\*/) 
  assert.match(gitignore, /!\.env\.example/)
  assert.match(gitignore, /\.tfstate/)
  assert.doesNotMatch(example, /AKIA[0-9A-Z]{16}/)
  assert.doesNotMatch(example, /-----BEGIN [A-Z ]+PRIVATE KEY-----/)
  assert.match(example, /FACTORY_PROFILE=local/)
})

test('security controls and rotation procedure are versioned without reading .env', () => {
  assert.ok(existsSync(join(root, '.husky', 'pre-commit')))
  assert.ok(existsSync(join(root, 'scripts', 'security', 'scan-secrets.mjs')))
  assert.ok(existsSync(join(root, 'docs', 'security', 'incident-response.md')))
  assert.match(readFileSync(join(root, '.github', 'workflows', 'security.yml'), 'utf8'), /scan-secrets/)
  assert.ok(existsSync(join(root, '.env')))
})

test('secret scanner does not join an empty assignment with a quoted string on the next line', () => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-secret-scan-'))
  const benign = join(directory, 'benign.mjs')
  // An empty env placeholder followed by an unrelated quoted string on the next line.
  writeFileSync(benign, ["const files = [{ content: 'GROQ_API_KEY=' },", "  { path: 'docs/conocimiento/secreto.md', content: 'otro' }]"].join('\n'))
  execFileSync(process.execPath, ['scripts/security/scan-secrets.mjs', '--paths', benign], { encoding: 'utf8' })

  // A real single-line inline credential is still detected.
  const real = join(directory, 'real.mjs')
  const syntheticSecret = ['s3cr3t', 'Value', 'ABCDEFGHIJ', '1234'].join('')
  writeFileSync(real, ['const config = { client', `_secret: '${syntheticSecret}' }`].join(''))
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/security/scan-secrets.mjs', '--paths', real], { encoding: 'utf8' }),
    (error) => {
      assert.doesNotMatch(`${error.stdout ?? ''}${error.stderr ?? ''}`, new RegExp(syntheticSecret))
      return error.status === 1
    },
  )
})

test('secret scanner blocks a staged-like credential without printing its value', () => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-secret-scan-'))
  const file = join(directory, 'candidate.txt')
  const syntheticKey = ['AKIA', '1234567890ABCDEF'].join('')
  writeFileSync(file, `candidate=${syntheticKey}`)

  assert.throws(
    () => execFileSync(process.execPath, ['scripts/security/scan-secrets.mjs', '--paths', file], { encoding: 'utf8' }),
    (error) => {
      assert.doesNotMatch(`${error.stdout ?? ''}${error.stderr ?? ''}`, new RegExp(syntheticKey))
      return error.status === 1
    },
  )
})
