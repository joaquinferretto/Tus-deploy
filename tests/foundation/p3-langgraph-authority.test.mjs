import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const langgraphRoot = join(root, 'apps/workflow-runtime-python/src/worker/langgraph')

function pythonSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return pythonSources(path)
    return entry.name.endsWith('.py') ? [readFileSync(path, 'utf8')] : []
  })
}

test('P3.2 production registry has no competing provider orchestration imports', () => {
  const source = pythonSources(langgraphRoot).join('\n')

  assert.match(source, /python-langgraph/)
  assert.doesNotMatch(source, /langchain_openai|langchain_aws|boto3\.client\(['"]bedrock/)
  assert.doesNotMatch(source, /from\s+.*(?:agents|flows)\s+import/i)
})

test('P3.2 registry exposes explicit denial for excluded orchestration authorities', () => {
  const source = pythonSources(langgraphRoot).join('\n')

  assert.match(source, /bedrock-agents/)
  assert.match(source, /bedrock-flows/)
  assert.match(source, /AuthorityViolation/)
})
