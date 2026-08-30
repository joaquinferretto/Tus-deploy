import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const {
  createInMemoryTelemetry,
  createOperationalEvidence,
  evaluateBudget,
  evaluateQuota,
  recordAudit,
} = await import('../../packages/observability/src/index.ts')

test('deterministic telemetry captures OTel-compatible trace and CloudWatch metric evidence', () => {
  const telemetry = createInMemoryTelemetry({
    idPrefix: 'fixture',
    now: () => '2026-08-25T00:00:00.000Z',
  })
  const span = telemetry.tracer.startSpan('workflow.run', {
    correlationId: 'corr-1',
    tenantId: 'tenant-a',
    actorId: 'actor-a',
  })

  logEventWithSecret(telemetry)
  telemetry.metrics.increment('workflow.completed', 1, { provider: 'fake' })
  span.setStatus('ok')
  span.end()

  assert.deepEqual(telemetry.traces, [
    {
      traceId: 'fixture-trace-1',
      spanId: 'fixture-span-1',
      name: 'workflow.run',
      status: 'ok',
      startedAt: '2026-08-25T00:00:00.000Z',
      endedAt: '2026-08-25T00:00:00.000Z',
      correlationId: 'corr-1',
      tenantId: 'tenant-a',
      actorId: 'actor-a',
    },
  ])
  assert.deepEqual(telemetry.metricSamples, [
    {
      name: 'workflow.completed',
      value: 1,
      attributes: { provider: 'fake' },
      timestamp: '2026-08-25T00:00:00.000Z',
    },
  ])
  assert.doesNotMatch(JSON.stringify(telemetry.logs), /Bearer fixture-secret/)
})

test('audit evidence is tenant-scoped and recursively redacted', () => {
  const audit = recordAudit({
    action: 'workflow.completed',
    outcome: 'success',
    correlationId: 'corr-2',
    tenantId: 'tenant-b',
    actorId: 'actor-b',
    details: {
      provider: 'fake',
      authorization: 'Bearer fixture-secret',
      nested: { apiKey: 'fixture-api-key' },
    },
  })

  assert.equal(audit.tenantId, 'tenant-b')
  assert.equal(audit.details.authorization, '[REDACTED]')
  assert.equal(audit.details.nested.apiKey, '[REDACTED]')
  assert.doesNotMatch(JSON.stringify(audit), /fixture-secret|fixture-api-key/)
})

test('budget and quota decisions emit deterministic threshold alerts', () => {
  assert.deepEqual(evaluateBudget({ name: 'monthly-ai', limit: 100, used: 85, warningAt: 80 }), {
    name: 'monthly-ai',
    limit: 100,
    used: 85,
    remaining: 15,
    status: 'warning',
    alert: 'budget.warning',
  })
  assert.deepEqual(evaluateQuota({ name: 'tenant-jobs', limit: 3, used: 3, warningAt: 2 }), {
    name: 'tenant-jobs',
    limit: 3,
    used: 3,
    remaining: 0,
    status: 'exhausted',
    alert: 'quota.exhausted',
  })
})

test('operational evidence joins traces, metrics, audit, findings, budgets, quotas, and alerts without live claims', () => {
  const evidence = createOperationalEvidence({
    profile: 'aws-terraform',
    evidenceKind: 'cloud-plan-validation',
    traces: [{ traceId: 'trace-1', spanId: 'span-1', name: 'plan', status: 'ok' }],
    metrics: [{ name: 'requests.total', value: 2, attributes: { profile: 'aws-terraform' } }],
    audits: [
      recordAudit({ action: 'terraform.validated', outcome: 'success', tenantId: 'platform' }),
    ],
    securityFindings: [
      {
        source: 'security-hub',
        findingId: 'finding-1',
        severity: 'low',
        status: 'resolved',
        summary: 'fixture finding',
      },
    ],
    budgets: [evaluateBudget({ name: 'monthly', limit: 100, used: 10, warningAt: 80 })],
    quotas: [evaluateQuota({ name: 'requests', limit: 50, used: 2, warningAt: 40 })],
    alerts: [{ name: 'telemetry.export', status: 'deferred', reason: 'provider-free fixture' }],
    liveConformance: false,
  })

  assert.equal(evidence.schemaVersion, 'factory.operations.v1')
  assert.equal(evidence.status, 'pass')
  assert.equal(evidence.liveConformance, false)
  assert.equal(evidence.traces[0].traceId, 'trace-1')
  assert.equal(evidence.securityFindings[0].source, 'security-hub')
  assert.equal(evidence.budgets[0].status, 'ok')
  assert.equal(evidence.quotas[0].status, 'ok')
  assert.equal(evidence.alerts[0].status, 'deferred')
})

test('Terraform and telemetry runbook declare provider-free controls and redacted evidence', () => {
  const terraform = ['observability', 'security', 'governance']
    .map((module) =>
      readFileSync(join(root, 'infra', 'terraform', 'modules', module, 'main.tf'), 'utf8')
    )
    .join('\n')
  const runbook = readFileSync(join(root, 'docs', 'operations', 'telemetry.md'), 'utf8')

  for (const required of [
    'cloudwatch',
    'otel',
    'cloudtrail',
    'security_hub',
    'budgets',
    'service_quotas',
    'alerts',
  ]) {
    assert.match(terraform.toLowerCase(), new RegExp(required.replace('_', '[-_]')))
  }
  assert.match(terraform, /disabled-until-approved/)
  assert.match(terraform, /contract-only-no-provisioning/)
  assert.match(runbook, /redact/i)
  assert.match(runbook, /live conformance/i)
  assert.match(runbook, /CloudTrail/)
})

function logEventWithSecret(telemetry) {
  telemetry.logger.emit({
    name: 'request.completed',
    level: 'info',
    timestamp: '2026-08-25T00:00:00.000Z',
    correlationId: 'corr-1',
    attributes: { authorization: 'Bearer fixture-secret', result: 'ok' },
  })
}
