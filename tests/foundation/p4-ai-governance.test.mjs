import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()

test('P4.5 publishes strict AI governance contracts for safety, review, consent, retention, and deletion', () => {
  const names = [
    'guardrail-outcome.v1.schema.json',
    'human-review.v1.schema.json',
    'consent.v1.schema.json',
    'data-record.v1.schema.json',
    'deletion-propagation.v1.schema.json',
  ]
  const schemas = names.map((name) =>
    JSON.parse(readFileSync(join(root, 'packages/contracts/schemas/ai-governance', name), 'utf8'))
  )

  assert.deepEqual(
    schemas.map((schema) => schema.$id),
    names.map((name) => `https://golden-boilerplate.dev/contracts/ai-governance/${name}`)
  )
  assert.ok(
    schemas.every((schema) => schema.type === 'object' && schema.additionalProperties === false)
  )
  assert.ok(schemas.every((schema) => schema.properties.contractVersion.const === '1.0.0'))
  assert.ok(schemas.every((schema) => schema.required.includes('tenantId')))
})

test('P4.5 governance schemas participate in canonical contract validation', () => {
  const output = execFileSync('node', ['packages/contracts/scripts/validate-schemas.mjs'], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.match(output, /Validated 98 JSON Schema contract\(s\)/)
})
