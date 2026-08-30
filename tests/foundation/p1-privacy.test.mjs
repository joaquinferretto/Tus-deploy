import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })

  return JSON.parse(output.trim())
}

function privacyContext(tenantId, actorId, permissions = []) {
  return { tenantId, actorId, correlationId: `${tenantId}-${actorId}`, permissions }
}

test('privacy contracts expose explicit consent, request, and record schemas', () => {
  const names = ['consent', 'request', 'record']
  const schemas = names.map((name) =>
    JSON.parse(
      readFileSync(join(root, `packages/contracts/schemas/privacy/${name}.schema.json`), 'utf8')
    )
  )

  assert.deepEqual(
    schemas.map((schema) => schema.$id),
    names.map((name) => `https://golden-boilerplate.dev/contracts/privacy/${name}.v1.schema.json`)
  )
  assert.ok(schemas.every((schema) => schema.type === 'object' && schema.additionalProperties === false))
})

test('privacy classification minimizes unknown fields and redacts secrets by default', () => {
  const result = runTypeScriptScenario(`
    const { classifyFields, redactFields } = (await import('./apps/api/src/privacy/domain.ts')).default
    const classified = classifyFields(
      { displayName: 'Synthetic User', role: 'viewer', apiSecret: 'never-store', unknown: 'drop-me' },
      [
        { name: 'displayName', classification: 'personal' },
        { name: 'role', classification: 'internal' },
        { name: 'apiSecret', classification: 'secret' },
      ]
    )
    console.log(JSON.stringify({
      stored: classified.values,
      omitted: classified.omittedFields,
      exported: redactFields(classified.values, classified.classifications),
    }))
  `)

  assert.equal(result.stored.displayName, 'Synthetic User')
  assert.equal(result.stored.role, 'viewer')
  assert.equal(result.omitted.includes('unknown'), true)
  assert.equal(JSON.stringify(result.stored).includes('never-store'), false)
  assert.equal(result.exported.displayName, 'Synthetic User')
  assert.equal(result.exported.apiSecret, '[REDACTED]')
})

test('purpose tracking denies processing without consent and honors withdrawal', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryPrivacyService } = (await import('./apps/api/src/privacy/composition.ts')).default
    const service = createInMemoryPrivacyService({ now: () => 1_700_000_000_000 })
    const context = ${JSON.stringify(privacyContext('tenant-a', 'user-a'))}
    const denied = await service.registerRecord({
      context,
      recordId: 'ai-1',
      subjectUserId: 'user-a',
      resourceType: 'prompt',
      purpose: 'ai_improvement',
      fields: { prompt: 'synthetic prompt' },
      fieldDefinitions: [{ name: 'prompt', classification: 'personal' }],
    })
    const granted = await service.recordConsent({ context, subjectUserId: 'user-a', purpose: 'ai_improvement', version: 'v1', granted: true })
    const accepted = await service.registerRecord({
      context,
      recordId: 'ai-2',
      subjectUserId: 'user-a',
      resourceType: 'prompt',
      purpose: 'ai_improvement',
      fields: { prompt: 'synthetic prompt 2' },
      fieldDefinitions: [{ name: 'prompt', classification: 'personal' }],
    })
    const withdrawn = await service.withdrawConsent({ context, subjectUserId: 'user-a', purpose: 'ai_improvement', version: 'v1' })
    const deniedAfterWithdrawal = await service.registerRecord({
      context,
      recordId: 'ai-3',
      subjectUserId: 'user-a',
      resourceType: 'prompt',
      purpose: 'ai_improvement',
      fields: { prompt: 'synthetic prompt 3' },
      fieldDefinitions: [{ name: 'prompt', classification: 'personal' }],
    })
    console.log(JSON.stringify({ denied: denied.code, granted: granted.ok, accepted: accepted.ok, withdrawn: withdrawn.ok, deniedAfterWithdrawal: deniedAfterWithdrawal.code, priorDataRemoved: service.store.records.get('ai-2').deletedAt !== null }))
  `)

  assert.deepEqual(result, {
    denied: 'CONSENT_REQUIRED',
    granted: true,
    accepted: true,
    withdrawn: true,
    deniedAfterWithdrawal: 'CONSENT_REQUIRED',
    priorDataRemoved: true,
  })
})

test('export, access, rectification, and deletion are tenant-scoped and idempotent', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryPrivacyService } = (await import('./apps/api/src/privacy/composition.ts')).default
    const service = createInMemoryPrivacyService({ now: () => 1_700_000_000_000 })
    const context = ${JSON.stringify(privacyContext('tenant-a', 'user-a'))}
    await service.registerRecord({
      context,
      recordId: 'profile-a',
      subjectUserId: 'user-a',
      resourceType: 'profile',
      purpose: 'service_delivery',
      fields: { displayName: 'Synthetic User', email: 'synthetic@example.test', password: 'never-store' },
      fieldDefinitions: [
        { name: 'displayName', classification: 'personal' },
        { name: 'email', classification: 'personal' },
        { name: 'password', classification: 'secret' },
      ],
    })
    const exported = await service.requestExport({ context, subjectUserId: 'user-a', idempotencyKey: 'export-1' })
    const accessed = await service.requestAccess({ context, subjectUserId: 'user-a', idempotencyKey: 'access-1' })
    const corrected = await service.rectify({ context, recordId: 'profile-a', values: { displayName: 'Corrected User' }, idempotencyKey: 'rectify-1' })
    const deleted = await service.requestDeletion({ context, subjectUserId: 'user-a', idempotencyKey: 'delete-1' })
    const replay = await service.requestDeletion({ context, subjectUserId: 'user-a', idempotencyKey: 'delete-1' })
    console.log(JSON.stringify({
      exported: exported.ok && exported.data.records[0].values,
      accessed: accessed.ok,
      corrected: corrected.ok,
      deleted: deleted.ok && deleted.request.status,
      replay: replay.ok && replay.idempotent,
      propagation: service.propagation.actions.map((action) => action.action),
      tombstone: service.store.records.get('profile-a').deletedAt !== null,
    }))
  `)

  assert.equal(result.exported.displayName, 'Synthetic User')
  assert.equal(result.exported.email, 'synthetic@example.test')
  assert.equal(result.exported.password, '[REDACTED]')
  assert.equal(result.accessed, true)
  assert.equal(result.corrected, true)
  assert.equal(result.deleted, 'completed')
  assert.equal(result.replay, true)
  assert.deepEqual(result.propagation, ['delete'])
  assert.equal(result.tombstone, true)
})

test('retention purges due records, anonymizes configured records, and respects legal holds', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryPrivacyService } = (await import('./apps/api/src/privacy/composition.ts')).default
    let now = 1_700_000_000_000
    const service = createInMemoryPrivacyService({ now: () => now })
    const context = ${JSON.stringify(privacyContext('tenant-a', 'admin-a', ['privacy:consent', 'privacy:hold', 'privacy:retention']))}
    await service.setRetentionSchedule({ context, resourceType: 'event', purpose: 'analytics', retentionMs: 1000, action: 'delete' })
    await service.setRetentionSchedule({ context, resourceType: 'memory', purpose: 'analytics', retentionMs: 1000, action: 'anonymize' })
    await service.recordConsent({ context, subjectUserId: 'user-a', purpose: 'analytics', version: 'v1', granted: true })
    await service.registerRecord({ context, recordId: 'held-event', subjectUserId: 'user-a', resourceType: 'event', purpose: 'analytics', fields: { note: 'held note' }, fieldDefinitions: [{ name: 'note', classification: 'personal' }] })
    await service.registerRecord({ context, recordId: 'free-memory', subjectUserId: 'user-a', resourceType: 'memory', purpose: 'analytics', fields: { note: 'memory note' }, fieldDefinitions: [{ name: 'note', classification: 'personal' }] })
    await service.addLegalHold({ context, subjectUserId: 'user-a', reason: 'synthetic litigation hold' })
    now += 2_000
    const held = await service.runRetention({ context, now })
    const release = await service.releaseLegalHold({ context, subjectUserId: 'user-a' })
    const purged = await service.runRetention({ context, now })
    console.log(JSON.stringify({ held: held.held, heldPurged: held.purged, release: release.ok, purged: purged.purged, anonymized: purged.anonymized, eventDeleted: service.store.records.get('held-event').deletedAt !== null, memoryValue: service.store.records.get('free-memory').values.note }))
  `)

  assert.equal(result.held, 2)
  assert.equal(result.heldPurged, 0)
  assert.equal(result.release, true)
  assert.equal(result.purged, 1)
  assert.equal(result.anonymized, 1)
  assert.equal(result.eventDeleted, true)
  assert.equal(result.memoryValue, '[ANONYMIZED]')
})

test('privacy audit is correlated, tenant-safe, and excludes raw personal data', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryPrivacyService } = (await import('./apps/api/src/privacy/composition.ts')).default
    const service = createInMemoryPrivacyService({ now: () => 1_700_000_000_000 })
    const owner = ${JSON.stringify(privacyContext('tenant-a', 'user-a'))}
    await service.registerRecord({ context: owner, recordId: 'private-a', subjectUserId: 'user-a', resourceType: 'profile', purpose: 'service_delivery', fields: { email: 'synthetic@example.test', secret: 'top-secret' }, fieldDefinitions: [{ name: 'email', classification: 'personal' }, { name: 'secret', classification: 'secret' }] })
    const outsider = await service.requestExport({ context: ${JSON.stringify(privacyContext('tenant-b', 'user-b', ['privacy:export']))}, subjectUserId: 'user-a', idempotencyKey: 'cross-tenant' })
    const events = service.audit.events
    console.log(JSON.stringify({ outsider: outsider.code, tenantIds: events.map((event) => event.tenantId), correlations: events.map((event) => event.correlationId), leaks: events.some((event) => JSON.stringify(event).includes('synthetic@example.test') || JSON.stringify(event).includes('top-secret')), denied: events.some((event) => event.outcome === 'denied') }))
  `)

  assert.equal(result.outsider, 'NOT_FOUND')
  assert.equal(result.tenantIds.includes('tenant-b'), true)
  assert.equal(result.correlations.includes('tenant-b-user-b'), true)
  assert.equal(result.leaks, false)
  assert.equal(result.denied, true)
})

test('cross-tenant rectification and deletion return non-disclosing not-found results', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryPrivacyService } = (await import('./apps/api/src/privacy/composition.ts')).default
    const service = createInMemoryPrivacyService({ now: () => 1_700_000_000_000 })
    const owner = ${JSON.stringify(privacyContext('tenant-a', 'user-a'))}
    await service.registerRecord({ context: owner, recordId: 'isolated-a', subjectUserId: 'user-a', resourceType: 'profile', purpose: 'service_delivery', fields: { displayName: 'Synthetic' }, fieldDefinitions: [{ name: 'displayName', classification: 'personal' }] })
    const outsider = ${JSON.stringify(privacyContext('tenant-b', 'user-b', ['privacy:delete', 'privacy:rectify']))}
    const deleted = await service.requestDeletion({ context: outsider, subjectUserId: 'user-a', idempotencyKey: 'cross-delete' })
    const rectified = await service.rectify({ context: outsider, recordId: 'isolated-a', values: { displayName: 'Tampered' }, idempotencyKey: 'cross-rectify' })
    console.log(JSON.stringify({ deleted: deleted.code, rectified: rectified.code, value: service.store.records.get('isolated-a').values.displayName }))
  `)

  assert.deepEqual(result, { deleted: 'NOT_FOUND', rectified: 'NOT_FOUND', value: 'Synthetic' })
})

test('failed propagation is recoverable through the same idempotency key', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryPrivacyService } = (await import('./apps/api/src/privacy/composition.ts')).default
    const service = createInMemoryPrivacyService({ now: () => 1_700_000_000_000 })
    const context = ${JSON.stringify(privacyContext('tenant-a', 'user-a'))}
    await service.registerRecord({ context, recordId: 'recover-a', subjectUserId: 'user-a', resourceType: 'profile', purpose: 'service_delivery', fields: { displayName: 'Synthetic' }, fieldDefinitions: [{ name: 'displayName', classification: 'personal' }] })
    service.propagation.failNext = true
    const failed = await service.requestDeletion({ context, subjectUserId: 'user-a', idempotencyKey: 'recover-delete' })
    const recovered = await service.requestDeletion({ context, subjectUserId: 'user-a', idempotencyKey: 'recover-delete' })
    console.log(JSON.stringify({ failed: failed.ok, failedStatus: failed.request.status, recovered: recovered.ok, recoveredStatus: recovered.request.status, deleted: service.store.records.get('recover-a').deletedAt !== null }))
  `)

  assert.equal(result.failed, false)
  assert.equal(result.failedStatus, 'failed')
  assert.equal(result.recovered, true)
  assert.equal(result.recoveredStatus, 'completed')
  assert.equal(result.deleted, true)
})
