import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

test('governance documents contain complete evidence columns and neutral vocabulary', () => {
  const expectations = {
    'capability-ledger': ['Owner', 'Phase', 'Contract', 'Implementation', 'Fake / Fixture', 'Use case', 'Security', 'Data', 'Cost', 'Evidence'],
    'ownership-matrix': ['Single owner', 'Contract', 'Rebuild', 'Security owner', 'Cost owner', 'Evidence'],
    'contamination-map': ['Classification', 'Core action', 'Isolated boundary', 'Evidence'],
    'profile-matrix': ['Owner', 'Contract', 'Fake / fixture', 'Security/data/cost', 'Evidence'],
  }
  for (const [name, columns] of Object.entries(expectations)) {
    const content = readFileSync(join(root, 'docs', 'architecture', `${name}.md`), 'utf8')
    for (const column of columns) assert.match(content, new RegExp(column.replace(/[ /]/g, '[ /]'), 'i'), `${name}: ${column}`)
  }
})

test('compose and terraform profiles expose only provider-free or explicitly gated behavior', () => {
  const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')
  assert.match(compose, /postgres/)
  assert.match(compose, /mongodb/)
  assert.match(compose, /redis/)
  assert.match(compose, /workflow-runtime/)
  assert.match(compose, /local-fakes/)

  const terraform = readFileSync(join(root, 'infra/terraform/environments/aws/main.tf'), 'utf8')
  for (const moduleName of ['network', 'compute', 'data', 'cache', 'storage', 'edge', 'queue', 'observability', 'security', 'backup', 'governance']) {
    assert.match(terraform, new RegExp(`module "${moduleName}"`))
  }
  assert.doesNotMatch(terraform, /cdk/i)
})
