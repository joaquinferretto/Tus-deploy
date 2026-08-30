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

test('P0.7 traceability rows are complete and profile-scoped', () => {
  const ledger = readFileSync(join(root, 'docs', 'architecture', 'capability-ledger.md'), 'utf8')
  const ownership = readFileSync(join(root, 'docs', 'architecture', 'ownership-matrix.md'), 'utf8')
  const contamination = readFileSync(join(root, 'docs', 'architecture', 'contamination-map.md'), 'utf8')
  const profiles = readFileSync(join(root, 'docs', 'architecture', 'profile-matrix.md'), 'utf8')

  for (const required of [
    'Native local',
    'Render-native',
    'AWS Terraform',
    'managed boundary',
    'activation gate',
    'profile-specific evidence',
    'unavailable-deferred',
    'deferred',
    'unchecked',
  ]) {
    assert.match(ledger + ownership + contamination + profiles, new RegExp(required, 'i'), required)
  }

  const ledgerRows = ledger
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.startsWith('|---') && !line.includes('Capability row'))
  assert.ok(ledgerRows.length >= 20, 'ledger must retain independent capability rows')
  for (const row of ledgerRows) {
    assert.equal(row.split('|').length - 2, 11, `ledger row has incomplete evidence cells: ${row}`)
    assert.doesNotMatch(row, /TBD|TODO|later|unknown/i, `ledger row has unresolved placeholder: ${row}`)
  }

  for (const boundary of ['PostgreSQL', 'MongoDB', 'Redis', 'object storage', 'queues']) {
    assert.match(ownership, new RegExp(boundary, 'i'), `ownership: ${boundary}`)
    assert.match(profiles, new RegExp(boundary, 'i'), `profiles: ${boundary}`)
  }

  assert.match(contamination, /no vertical (?:code|behavior|imports) in core/i)
  assert.match(contamination, /scan/i)
  assert.match(profiles, /must not silently fall back to Compose/i)
  assert.match(profiles, /native local/i)
  assert.match(profiles, /Local Compose.*deferred|Deferred Compose/i)
})

test('P0.7 governance uses redacted references and preserves isolation boundaries', () => {
  const documents = ['capability-ledger', 'ownership-matrix', 'contamination-map', 'profile-matrix'].map((name) =>
    readFileSync(join(root, 'docs', 'architecture', `${name}.md`), 'utf8'),
  )
  const content = documents.join('\n')

  assert.match(content, /synthetic names only|fictitious references|secret values are never included/i)
  assert.doesNotMatch(content, /AKIA[0-9A-Z]{16}|sk-(?:live|prod)-|postgres(?:ql)?:\/\/[^`\s]+:[^`\s]+@/i)
  assert.match(content, /isolated reference boundary/i)
  assert.match(content, /zero vertical contamination/i)
  assert.match(content, /no active completion claim/i)
})
