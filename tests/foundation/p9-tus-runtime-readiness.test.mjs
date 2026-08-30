import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import express from '../../apps/api/node_modules/express/index.js'

import {
  createReadinessEvidence,
  InMemoryTusReadinessPort,
  InMemoryTusReadinessAuditStore,
  TusReadinessBlockedError,
  TusReadinessGuard,
} from '../../apps/api/src/tus/readiness/index.ts'
import { createTusApplication } from '../../apps/api/src/tus/composition/index.ts'
import { createTusHttpRouter } from '../../apps/api/src/tus/http/router.ts'
import { InMemoryTusSessionResolver } from '../../apps/api/src/tus/adapters/in-memory.ts'
import { InMemoryJobTransport } from '../../apps/api/src/platform/jobs/adapters/in-memory.ts'
import { ActivationGatedJobTransport } from '../../apps/api/src/platform/jobs/adapters/activation-gated.ts'
import { createInMemoryDurableJobPlatform, DurableJobService } from '../../apps/api/src/platform/jobs/index.ts'

const NOW = '2026-08-28T12:00:00.000Z'
const BASE = {
  tenantId: 'tenant-a',
  capability: 'publication',
  owner: 'owner-a',
  scope: 'argentina-stage-1',
  evidenceType: 'approval-record',
  policyVersion: 'tus-readiness-v2',
  issuedAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
  revoked: false,
  source: 'authorized-external',
}

function evidence(gate, overrides = {}) {
  return createReadinessEvidence({
    ...BASE,
    gate,
    evidenceId: `evidence-${gate}`,
    evidenceRef: `ref-${gate}`,
    ...overrides,
  })
}

function guardFor(records, legacy) {
  return new TusReadinessGuard(
    new InMemoryTusReadinessPort({ evidence: records, legacy }),
    new InMemoryTusReadinessAuditStore(),
  )
}

test('runtime readiness denies every invalid evidence state before the caller effect', async () => {
  for (const invalid of [
    [],
    [evidence('legal', { expiresAt: '2026-01-01T00:00:00.000Z' })],
    [evidence('legal', { revoked: true })],
    [{ ...evidence('legal'), evidenceRef: '' }],
    [evidence('legal'), evidence('legal', { evidenceId: 'evidence-legal-2', evidenceRef: 'ref-2' })],
    [evidence('legal', { scope: 'foreign-scope' })],
  ]) {
    const guard = guardFor(invalid)
    let effects = 0
    await assert.rejects(
      guard.require({
        tenantId: 'tenant-a',
        actorId: 'actor-a',
        correlationId: 'corr-a',
        capability: 'publication',
        profile: 'native-local',
        scope: 'argentina-stage-1',
      }),
      (error) => {
        effects += 1
        return error instanceof TusReadinessBlockedError && error.status === 409 && error.code === 'TUS_READINESS_BLOCKED'
      },
    )
    assert.equal(effects, 1)
  }
})

test('a direct service or HTTP route cannot bypass the injected guard', async () => {
  const guard = guardFor([])
  const application = createTusApplication({ readinessGuard: guard })
  const outboxBefore = application.marketplace.store.outbox.list('tenant-a').length
  const context = {
    subjectId: 'actor-a',
    sessionId: 'session-a',
    tenantId: 'tenant-a',
    roles: ['merchant-admin'],
    permissions: ['tus:marketplace:write', 'tus:checkout'],
    correlationId: 'corr-a',
  }

  await assert.rejects(
    application.marketplace.onboard(context, {
      merchantId: 'merchant-a',
      cohort: 'beauty-personal-care',
      locationId: 'location-a',
      timezone: 'America/Argentina/Buenos_Aires',
      staffRoles: ['owner'],
      operatingPolicyVersion: 'stage-1-v1',
    }),
    (error) => error instanceof TusReadinessBlockedError,
  )
  assert.equal(application.marketplace.store.outbox.list('tenant-a').length, outboxBefore)

  const sessions = new InMemoryTusSessionResolver()
  sessions.add('token-a', context)
  const router = createTusHttpRouter({ application, sessions })
  assert.equal(typeof router, 'function')

  const server = http.createServer(express().use(express.json()).use(router))
  await new Promise((resolve) => server.listen(0, resolve))
  try {
    const port = server.address().port
    const response = await fetch(`http://127.0.0.1:${port}/tus/checkout`, {
      method: 'POST',
      headers: { authorization: 'Bearer token-a', 'x-correlation-id': 'corr-http', 'idempotency-key': 'idem-http', 'content-type': 'application/json' },
      body: JSON.stringify({
        cartId: 'cart-a',
        requestHash: 'hash-a',
        createdAt: NOW,
        expiresAt: Date.parse(NOW) + 300000,
        lines: [{ lineId: 'line-a', context: 'product', merchantId: 'merchant-a', currency: 'ARS', amount: 100 }],
      }),
    })
    const responseBody = await response.text()
    assert.equal(response.status, 409, responseBody)
    assert.equal(JSON.parse(responseBody).code, 'TUS_READINESS_BLOCKED')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('denied job intake has no queue side effect and approved scope is auditable', async () => {
  const delegate = new InMemoryJobTransport()
  const denied = new ActivationGatedJobTransport(delegate, { readinessGuard: guardFor([]) })
  denied.activate()
  await assert.rejects(
    denied.enqueue({ tenantId: 'tenant-a', jobId: 'job-a' }),
    (error) => error instanceof TusReadinessBlockedError,
  )
  assert.deepEqual(delegate.queued, [])

  const durablePlatform = createInMemoryDurableJobPlatform()
  const durableService = new DurableJobService(durablePlatform, { readinessGuard: guardFor([]) })
  await assert.rejects(
    durableService.submit({
      tenantId: 'tenant-a',
      jobId: 'job-durable-a',
      runId: 'run-durable-a',
      idempotencyKey: 'idem-durable-a',
      requestHash: 'hash-durable-a',
      runType: 'tus.release',
      jobType: 'tus.release',
      input: {},
      maxAttempts: 3,
      now: Date.parse(NOW),
    }),
    (error) => error instanceof TusReadinessBlockedError,
  )
  assert.deepEqual(durablePlatform.jobs.list('tenant-a'), [])
  assert.deepEqual(durablePlatform.runs.list('tenant-a'), [])

  const approved = guardFor(['legal', 'kyb', 'tax', 'runtimeProvider'].map((gate) => evidence(gate)))
  const decision = await approved.require({
    tenantId: 'tenant-a',
    actorId: 'actor-a',
    correlationId: 'corr-approved',
    capability: 'publication',
    profile: 'native-local',
    scope: 'argentina-stage-1',
  })
  assert.equal(decision.enabled, true)
  assert.equal(decision.profile, 'native-local')
  assert.equal(decision.scope, 'argentina-stage-1')
  assert.equal(approved.audit.list('tenant-a')[0].actorId, 'actor-a')
  assert.equal(approved.audit.list('tenant-a')[0].correlationId, 'corr-approved')
})
