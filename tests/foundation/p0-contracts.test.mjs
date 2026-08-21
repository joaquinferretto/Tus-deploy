import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const contracts = await import('../../packages/contracts/src/index.ts')

test('canonical contracts validate valid payloads and reject unsupported versions', () => {
  const validJob = {
    contractVersion: '1.0.0',
    jobId: 'job-1',
    workflowId: 'workflow-1',
    runId: 'run-1',
    kind: 'ingest',
    status: 'pending',
    priority: 50,
    createdAt: '2026-01-01T00:00:00Z',
    trace: { traceId: '0123456789abcdef', correlationId: 'correlation-1' },
    payload: { assetId: 'asset-1', inputUri: 'https://example.invalid/input' },
  }

  assert.deepEqual(contracts.validateWorkflowJob(validJob), validJob)
  assert.throws(
    () => contracts.validateWorkflowJob({ ...validJob, contractVersion: '9.0.0' }),
    /unsupported|invalid|contract/i,
  )
})

test('python compatibility fixtures use the same canonical version and fields', () => {
  const fixture = contracts.createWorkflowJobFixture()
  assert.equal(fixture.contractVersion, '1.0.0')
  assert.equal(fixture.trace.correlationId, 'correlation-fixture')
})

test('schema validation command accepts the canonical draft version', () => {
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
  const output = execFileSync(process.execPath, ['packages/contracts/scripts/validate-schemas.mjs'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })

  assert.match(output, /Validated \d+ JSON Schema contract\(s\)/)
})
