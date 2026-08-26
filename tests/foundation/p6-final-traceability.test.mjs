import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const finalTraceabilityPath = join(root, 'docs', 'evidence', 'final-traceability.md')
const { PAID_LIVE_ACTIVATION_TARGETS } = await import('../../scripts/activation/index.mjs')

const SPEC_DIRECTORIES = [
  'ai-capability-catalog',
  'data-platform-crud',
  'durable-langgraph-runtime',
  'identity-tenancy',
  'neutral-reference-app',
  'operational-hardening',
  'platform-foundation',
  'provider-adapters',
  'rag-knowledge',
  'traceability',
]

const REQUIRED_TRACEABILITY_FIELDS = [
  'implementation',
  'fake',
  'test',
  'owner / config',
  'evidence',
  'rollback',
]

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function readFinalTraceability() {
  return readFileSync(finalTraceabilityPath, 'utf8')
}

function readSpecScenarios() {
  return SPEC_DIRECTORIES.flatMap((domain) => {
    const source = readFileSync(
      join(root, 'openspec', 'changes', 'archive', '2026-08-25-product-factory-core', 'specs', domain, 'spec.md'),
      'utf8'
    )

    return [...source.matchAll(/^#{3,4} Scenario: (.+)$/gm)].map(
      (match) => `${domain}:${slug(match[1])}`
    )
  })
}

function readCapabilityRows() {
  const source = readFileSync(join(root, 'docs', 'architecture', 'capability-ledger.md'), 'utf8')
  const governanceTable = source.slice(
    source.indexOf('| Capability row |'),
    source.indexOf('## P2.11 Traceability Ledger')
  )

  return [...governanceTable.matchAll(/^\| ([^|]+) \|/gm)]
    .map((match) => match[1].trim())
    .filter((value) => value !== 'Capability row' && value !== '---')
    .map((value) => `capability:${slug(value)}`)
}

function readAiRows() {
  const source = readFileSync(join(root, 'docs', 'ai', 'catalog-ledger.md'), 'utf8')

  return [...source.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => `ai:${match[1]}`)
}

function readLedgerIds() {
  const source = readFileSync(
    join(root, 'packages', 'contracts', 'traceability', 'index.ts'),
    'utf8'
  )

  return [...source.matchAll(/^    id: '([^']+)'/gm)].map((match) => `p2:${match[1]}`)
}

function readActivationTargets() {
  return [...PAID_LIVE_ACTIVATION_TARGETS]
}

function sectionRows(source, heading, nextHeading) {
  const start = source.indexOf(heading)
  const end = nextHeading ? source.indexOf(nextHeading, start) : source.length
  assert.notEqual(start, -1, `missing final traceability section: ${heading}`)
  const section = source.slice(start, end === -1 ? source.length : end)

  return section
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
      assert.equal(cells.length, 7, `traceability row must have seven fields: ${line}`)

      return {
        id: cells[0].slice(1, -1),
        implementation: cells[1],
        fake: cells[2],
        test: cells[3],
        'owner / config': cells[4],
        evidence: cells[5],
        rollback: cells[6],
      }
    })
}

function assertCompleteRows(rows, expectedIds, label) {
  assert.deepEqual(
    [...new Set(rows.map((row) => row.id))].sort(),
    [...new Set(expectedIds)].sort(),
    `${label} IDs must match their source ledger exactly`
  )

  for (const row of rows) {
    for (const field of REQUIRED_TRACEABILITY_FIELDS) {
      assert.ok(row[field], `${label} ${row.id} is missing ${field}`)
      assert.doesNotMatch(
        row[field],
        /\b(?:TODO|TBD|N\/A|not mapped|unknown)\b/i,
        `${label} ${row.id} has an unresolved ${field}`
      )
      assert.match(
        row[field],
        /`[^`]+`/,
        `${label} ${row.id} ${field} must name a stable artifact or boundary`
      )
    }
  }
}

test('P6.9 maps every spec scenario to implementation, fake, test, owner/config, evidence, and rollback', () => {
  const source = readFinalTraceability()
  const rows = sectionRows(source, '## Scenario traceability', '## Governance ledger traceability')

  assertCompleteRows(rows, readSpecScenarios(), 'scenario')
})

test('P6.9 maps every capability, P2.11, and AI ledger row without hiding deferred work', () => {
  const source = readFinalTraceability()
  const capabilityRows = sectionRows(
    source,
    '### Capability ledger rows',
    '### P2.11 machine ledger rows'
  )
  const p2Rows = sectionRows(source, '### P2.11 machine ledger rows', '### AI catalog ledger rows')
  const aiRows = sectionRows(source, '### AI catalog ledger rows', '### Activation target coverage')

  assertCompleteRows(capabilityRows, readCapabilityRows(), 'capability ledger')
  assertCompleteRows(p2Rows, readLedgerIds(), 'P2.11 ledger')
  assertCompleteRows(aiRows, readAiRows(), 'AI ledger')
  assert.match(source, /P0\.6b.*deferred/i)
  assert.match(source, /P2\.L1[–-]P2\.L14.*deferred/i)
  assert.match(source, /P4\.16\+.*deferred/i)
})

test('P6.9 records every activation target and preserves truthful live-conformance boundaries', () => {
  const source = readFinalTraceability()
  const activationRows = sectionRows(
    source,
    '### Activation target coverage',
    '## Evidence and non-claims'
  )
  const activationIds = activationRows.map((row) => row.id.replace(/^activation:/, ''))

  assert.deepEqual([...activationIds].sort(), [...readActivationTargets()].sort())
  assert.match(source, /liveConformance: false/)
  assert.match(
    source,
    /No live\s+cloud, provider, database, credential, secret, or `\.env` access/i
  )
  assert.match(source, /authorized cloud smoke/i)
  assert.match(source, /unavailable-deferred/i)
})
