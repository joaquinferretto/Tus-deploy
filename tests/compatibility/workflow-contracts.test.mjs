import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')
const fixtureDir = join(root, 'packages/contracts/fixtures/workflows')
const schemaDir = join(root, 'packages/contracts/schemas/workflows')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

function readWorkflowFixtures() {
  return readdirSync(fixtureDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(fixtureDir, file), 'utf8')))
}

test('P3.1 JSON workflow fixtures carry the complete versioned envelope', () => {
  const fixtures = readWorkflowFixtures()

  assert.deepEqual(
    fixtures.map((fixture) => fixture.messageType),
    ['workflow.progress', 'workflow.request', 'workflow.result']
  )
  for (const fixture of fixtures) {
    assert.equal(fixture.contractVersion, '1.0.0')
    assert.match(fixture.occurredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    assert.equal(typeof fixture.tenantId, 'string')
    assert.equal(typeof fixture.actorId, 'string')
    assert.equal(typeof fixture.correlationId, 'string')
    assert.equal(typeof fixture.idempotencyKey, 'string')
    assert.equal(typeof fixture.lineage.rootMessageId, 'string')
    assert.equal(typeof fixture.lineage.source, 'string')
  }
})

test('P3.1 TypeScript validates every JSON fixture and rejects drift', () => {
  const fixtures = readWorkflowFixtures()
  const result = runTypeScriptScenario(`
    const { validateWorkflowMessage } = await import('./packages/contracts/src/workflows.ts')
    const fixtures = ${JSON.stringify(fixtures)}
    const valid = fixtures.map((fixture) => validateWorkflowMessage(fixture).messageType)
    const invalid = []
    for (const [field, value] of [
      ['tenantId', ''],
      ['actorId', ''],
      ['correlationId', ''],
      ['idempotencyKey', ''],
    ]) {
      const candidate = { ...fixtures[0], [field]: value }
      try { validateWorkflowMessage(candidate) } catch (error) { invalid.push(error.message) }
    }
    const unsupported = { ...fixtures[0], contractVersion: '2.0.0' }
    try { validateWorkflowMessage(unsupported) } catch (error) { invalid.push(error.message) }
    const nonCanonicalTime = { ...fixtures[0], occurredAt: '2026-01-01T00:00:00Z' }
    try { validateWorkflowMessage(nonCanonicalTime) } catch (error) { invalid.push(error.message) }
    console.log(JSON.stringify({ valid, invalid }))
  `)

  assert.deepEqual(result.valid, ['workflow.progress', 'workflow.request', 'workflow.result'])
  assert.equal(result.invalid.length, 6)
  assert.ok(result.invalid.every((message) => message.includes('workflow')))
})

test('P3.1 schemas require identical cross-runtime metadata and canonical timestamps', () => {
  const schemas = readdirSync(schemaDir)
    .filter((file) => file.endsWith('.schema.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(schemaDir, file), 'utf8')))

  assert.deepEqual(
    schemas.map((schema) => schema.title),
    ['WorkflowProgressV1', 'WorkflowRequestV1', 'WorkflowResultV1']
  )
  for (const schema of schemas) {
    for (const field of [
      'contractVersion',
      'messageId',
      'messageType',
      'tenantId',
      'actorId',
      'correlationId',
      'idempotencyKey',
      'lineage',
      'occurredAt',
      'payload',
    ]) {
      assert.ok(schema.required.includes(field), `${schema.title} must require ${field}`)
    }
    assert.equal(
      schema.properties.occurredAt.pattern,
      '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
    )
    assert.equal(schema.properties.occurredAt.type, 'string')
    assert.equal(schema.properties.lineage.required.includes('rootMessageId'), true)
    assert.equal(schema.properties.lineage.required.includes('source'), true)
  }
})
