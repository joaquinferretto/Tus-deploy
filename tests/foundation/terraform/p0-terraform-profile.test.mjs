import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..', '..')
const terraformRoot = join(root, 'infra', 'terraform')
const capabilityModules = [
  'network',
  'compute',
  'data',
  'cache',
  'storage',
  'edge',
  'queue',
  'observability',
  'security',
  'backup',
  'governance',
]
const contractInputs = [
  'enabled',
  'region',
  'tags',
  'encryption_enabled',
  'retention_days',
  'quota_units',
]

function readTerraformFile(...segments) {
  return readFileSync(join(terraformRoot, ...segments), 'utf8')
}

test('every capability module exposes the explicit profile contract without resources', () => {
  for (const moduleName of capabilityModules) {
    const modulePath = join(terraformRoot, 'modules', moduleName, 'main.tf')
    assert.equal(existsSync(modulePath), true, `${moduleName} module must exist`)

    const content = readFileSync(modulePath, 'utf8')
    for (const input of contractInputs) {
      assert.match(content, new RegExp(`variable\\s+"${input}"`), `${moduleName}: ${input}`)
    }
    assert.match(content, new RegExp(`name\\s*=\\s*"${moduleName}"`), `${moduleName}: capability name`)
    assert.match(content, /encryption_enabled\s*=\s*var\.encryption_enabled/)
    assert.match(content, /retention_days\s*=\s*var\.retention_days/)
    assert.match(content, /quota_units\s*=\s*var\.quota_units/)
    assert.doesNotMatch(content, /\b(resource|provider)\s+"/i, `${moduleName}: no provisioning`)
  }
})

test('AWS and Render environments wire every capability and governance control', () => {
  for (const environment of ['aws', 'render']) {
    const content = readTerraformFile('environments', environment, 'main.tf')
    const variables = readTerraformFile('environments', environment, 'variables.tf')

    for (const moduleName of capabilityModules) {
      assert.match(content, new RegExp(`module\\s+"${moduleName}"`), `${environment}: ${moduleName}`)
      assert.match(content, new RegExp(`enabled\\s*=\\s*local\\.capabilities\\.${moduleName}`), `${environment}: ${moduleName} flag`)
    }
    for (const input of ['region', 'tags', 'encryption_enabled', 'retention_days', 'quota_units']) {
      assert.match(variables, new RegExp(`variable\\s+"${input}"`), `${environment}: ${input} variable`)
      assert.match(content, new RegExp(`\\b${input}\\b`), `${environment}: ${input} wiring`)
    }
    assert.match(variables, /variable\s+"enabled_capabilities"/)
    assert.match(content, /merge\(local\.default_capabilities, var\.enabled_capabilities\)/)
    assert.doesNotMatch(content + variables, /\b(resource|provider|backend)\s+"/i, `${environment}: no provisioning`)
  }
})

test('profile defaults are safe and control inputs reject invalid values', () => {
  for (const moduleName of capabilityModules) {
    const content = readFileSync(join(terraformRoot, 'modules', moduleName, 'main.tf'), 'utf8')
    assert.match(content, /condition\s*=\s*var\.retention_days\s*>=\s*0/)
    assert.match(content, /condition\s*=\s*var\.quota_units\s*>=\s*0/)
    assert.match(content, /retention_days must be non-negative/i)
    assert.match(content, /quota_units must be non-negative/i)
  }

  for (const environment of ['aws', 'render']) {
    const variables = readTerraformFile('environments', environment, 'variables.tf')
    const content = readTerraformFile('environments', environment, 'main.tf')
    assert.match(variables, /variable\s+"encryption_enabled"[\s\S]*default\s*=\s*true/)
    assert.match(variables, /variable\s+"retention_days"[\s\S]*default\s*=\s*30/)
    assert.match(variables, /variable\s+"quota_units"[\s\S]*default\s*=\s*100/)
    for (const moduleName of capabilityModules) {
      assert.match(content, new RegExp(`${moduleName}\\s*=\\s*false`), `${environment}: safe ${moduleName} default`)
    }
  }
})

test('profiles retain Terraform-only authority and redacted, deterministic controls', () => {
  const allFiles = [
    readTerraformFile('environments', 'aws', 'main.tf'),
    readTerraformFile('environments', 'aws', 'variables.tf'),
    readTerraformFile('environments', 'render', 'main.tf'),
    readTerraformFile('environments', 'render', 'variables.tf'),
  ].join('\n')

  assert.doesNotMatch(allFiles, /cdk/i)
  assert.match(allFiles, /retention_days/)
  assert.match(allFiles, /quota_units/)
  assert.match(allFiles, /encryption_enabled/)
  assert.match(allFiles, /managed_by\s*=\s*"terraform"/)
  assert.doesNotMatch(allFiles, /AKIA[0-9A-Z]{16}|sk-(?:live|prod)-|postgres(?:ql)?:\/\/[^`\s]+:[^`\s]+@/i)
})
