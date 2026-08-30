import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import {
  validateBootstrapPolicy,
  validateSecurityPolicy,
} from '../../scripts/security/validate-policy.mjs'

const root = join(import.meta.dirname, '..', '..')
const scanner = join(root, 'scripts', 'security', 'scan-secrets.mjs')

function runFailingScan(args, cwd) {
  assert.throws(
    () => execFileSync(process.execPath, [scanner, ...args], { cwd, encoding: 'utf8' }),
    (error) => error.status === 1
  )
}

test('staged-secret scanning blocks synthetic credentials without printing their values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-p6-staged-'))
  const credential = ['AKIA', '1234567890ABCDEF'].join('')

  execFileSync('git', ['init', '--quiet'], { cwd: directory })
  writeFileSync(join(directory, 'candidate.txt'), `AWS_ACCESS_KEY_ID=${credential}\n`)
  execFileSync('git', ['add', 'candidate.txt'], { cwd: directory })

  assert.throws(
    () =>
      execFileSync(process.execPath, [scanner, '--staged'], { cwd: directory, encoding: 'utf8' }),
    (error) => {
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
      assert.doesNotMatch(output, new RegExp(credential))
      assert.match(output, /candidate\.txt/)
      return error.status === 1
    }
  )
})

test('tracked-secret scanning catches committed synthetic credentials without reading .env', () => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-p6-tracked-'))
  const credential = ['ghp_', 'x'.repeat(36)].join('')

  execFileSync('git', ['init', '--quiet'], { cwd: directory })
  writeFileSync(join(directory, 'candidate.txt'), `TOKEN=${credential}\n`)
  execFileSync('git', ['add', 'candidate.txt'], { cwd: directory })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: directory }
  )

  runFailingScan(['--tracked'], directory)
})

test('security policy blocks credential printing and enforces secret-store-only bootstrap', () => {
  const policy = validateSecurityPolicy({
    securityWorkflow: readFileSync(join(root, '.github', 'workflows', 'security.yml'), 'utf8'),
    ciWorkflow: readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8'),
    incidentResponse: readFileSync(join(root, 'docs', 'security', 'incident-response.md'), 'utf8'),
    renderBlueprint: readFileSync(join(root, 'render.yaml'), 'utf8'),
  })

  assert.deepEqual(policy, { ok: true, findings: [] })
  assert.deepEqual(
    validateBootstrapPolicy({
      credentialSource: 'secret-store-reference',
      allowedActions: ['sts:AssumeRole'],
      roleSessionDurationSeconds: 900,
    }),
    { ok: true, findings: [] }
  )
  assert.equal(
    validateBootstrapPolicy({
      credentialSource: 'inline-value',
      allowedActions: ['sts:AssumeRole', 'iam:CreateRole'],
      roleSessionDurationSeconds: 7200,
    }).ok,
    false
  )
})

test('security policy rejects a workflow that prints a secret or embeds a provider value', () => {
  const securityWorkflow = readFileSync(join(root, '.github', 'workflows', 'security.yml'), 'utf8')
  const ciWorkflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
  const incidentResponse = readFileSync(
    join(root, 'docs', 'security', 'incident-response.md'),
    'utf8'
  )
  const renderBlueprint = readFileSync(join(root, 'render.yaml'), 'utf8')

  const result = validateSecurityPolicy({
    securityWorkflow,
    ciWorkflow: ciWorkflow.replace('pnpm test', 'echo ${{ secrets.PROD_TOKEN }}'),
    incidentResponse,
    renderBlueprint: renderBlueprint.replace(
      'key: DATABASE_URL\n         sync: false',
      'key: DATABASE_URL\n         value: embedded-provider-value'
    ),
  })

  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /print credentials|DATABASE_URL/)
})
