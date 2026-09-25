import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()

test('P4.1 publishes strict versioned AI contracts for LLM, chat, structured output, and tools', () => {
  const schemaRoot = join(root, 'packages', 'ai-contracts', 'schemas')
  const schemaPaths = ['llm', 'chat', 'structured-output', 'tools'].flatMap((directory) =>
    readdirSync(join(schemaRoot, directory))
      .filter((file) => file.endsWith('.schema.json'))
      .map((file) => join(schemaRoot, directory, file))
  )

  assert.equal(schemaPaths.length, 9)
  for (const schemaPath of schemaPaths) {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    assert.equal(schema.type, 'object')
    assert.equal(schema.additionalProperties, false)
    assert.equal(schema.properties.contractVersion.const, '1.0.0')
    assert.ok(schema.required.includes('tenantId'))
    assert.ok(schema.required.includes('actorId'))
  }
})

test('P4.1 AI contracts are included in canonical validation', () => {
  const output = execFileSync(
    process.execPath,
    ['packages/contracts/scripts/validate-schemas.mjs'],
    {
      cwd: root,
      encoding: 'utf8',
    }
  )

  assert.match(output, /Validated 107 JSON Schema contract\(s\)\./)
})
