import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  return JSON.parse(
    execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  )
}

const moduleImport =
  "const registryModule = (await import('./apps/api/src/ai/registry/index.ts')).default"

test('P4.3 Prisma catalog is tenant-scoped and version/audit capable', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(
    join(root, 'apps/api/prisma/migrations/20260824160000_p4_ai_registry/migration.sql'),
    'utf8'
  )

  for (const model of [
    'PromptDefinition',
    'PromptVersion',
    'ModelDefinition',
    'ModelAvailability',
    'Rollout',
    'Approval',
    'RegistryAudit',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`))
    assert.match(migration, new RegExp(`CREATE TABLE "${model}"`))
  }
  assert.match(schema, /@@unique\(\[tenantId, key\]\)/)
  assert.match(schema, /@@unique\(\[tenantId, promptId, version\]\)/)
  assert.match(schema, /@@unique\(\[tenantId, modelId\]\)/)
  assert.match(migration, /PromptVersion_tenantId_promptId_version_key/)
  assert.match(migration, /RegistryAudit_tenantId_occurredAt_idx/)
})

test('P4.3 models versioned registry records and tenant-safe reads', () => {
  const result = runTypeScriptScenario(`
    ${moduleImport}
    const { InMemoryAIRegistry, RegistryStateError } = registryModule
    const context = { tenantId: 'tenant-a', actorId: 'owner', correlationId: 'corr-a' }
    const registry = new InMemoryAIRegistry()
    const prompt = registry.registerPrompt(context, { key: 'welcome', owner: 'team-a' })
    const version = registry.createPromptVersion(context, { promptId: prompt.id, template: 'Hello {{name}}', version: 1 })
    let immutable = false
    try { registry.createPromptVersion(context, { promptId: prompt.id, template: 'Changed', version: 1 }) } catch (error) { immutable = error instanceof RegistryStateError }
    let isolated = false
    try { registry.getPromptVersion({ ...context, tenantId: 'tenant-b' }, version.id) } catch (error) { isolated = /tenant/.test(error.message) }
    console.log(JSON.stringify({ version: version.version, checksum: Boolean(version.checksum), immutable, isolated }))
  `)
  assert.deepEqual(result, { version: 1, checksum: true, immutable: true, isolated: true })
})

test('approval and model availability gate rollout activation', () => {
  const result = runTypeScriptScenario(`
    ${moduleImport}
    const { InMemoryAIRegistry, MODEL_AVAILABILITY_STATUS, APPROVAL_STATUS, ROLLOUT_STATE } = registryModule
    const context = { tenantId: 'tenant-a', actorId: 'owner', correlationId: 'corr-a' }
    const registry = new InMemoryAIRegistry()
    const prompt = registry.registerPrompt(context, { key: 'welcome', owner: 'team-a' })
    const version = registry.createPromptVersion(context, { promptId: prompt.id, template: 'Hello {{name}}', version: 1 })
    const approval = registry.requestApproval(context, { resourceType: 'prompt_version', resourceId: version.id })
    registry.approve({ ...context, actorId: 'reviewer' }, approval.id)
    const model = registry.registerModel(context, { key: 'local-fake', provider: 'fake', modelName: 'deterministic-v1', owner: 'team-a' })
    registry.setModelAvailability(context, model.id, { status: MODEL_AVAILABILITY_STATUS.AVAILABLE, reason: 'deterministic' })
    const rollout = registry.createRollout(context, { promptId: prompt.id, promptVersion: 1, modelId: model.id, percentage: 100 })
    const rolloutApproval = registry.requestApproval(context, { resourceType: 'rollout', resourceId: rollout.id }); registry.approve({ ...context, actorId: 'reviewer' }, rolloutApproval.id)
    const active = registry.activateRollout(context, rollout.id)
    console.log(JSON.stringify({ approval: registry.listApprovals(context)[0].status, draft: rollout.state, active: active.state, expected: { approval: APPROVAL_STATUS.APPROVED, draft: ROLLOUT_STATE.DRAFT, active: ROLLOUT_STATE.ACTIVE } }))
  `)
  assert.deepEqual(result, {
    approval: 'approved',
    draft: 'draft',
    active: 'active',
    expected: { approval: 'approved', draft: 'draft', active: 'active' },
  })
})

test('rollout approval is required and runtime validation fails closed', () => {
  const result = runTypeScriptScenario(`
    ${moduleImport}
    const { InMemoryAIRegistry, MODEL_AVAILABILITY_STATUS } = registryModule
    const context = { tenantId: 'tenant-a', actorId: 'owner', correlationId: 'corr-a' }
    const reviewer = { ...context, actorId: 'reviewer' }
    const registry = new InMemoryAIRegistry()
    const prompt = registry.registerPrompt(context, { key: 'welcome', owner: 'team-a' })
    const version = registry.createPromptVersion(context, { promptId: prompt.id, template: 'Hello', version: 1 })
    const versionApproval = registry.requestApproval(context, { resourceType: 'prompt_version', resourceId: version.id })
    registry.approve(reviewer, versionApproval.id)
    const model = registry.registerModel(context, { key: 'local-fake', provider: 'fake', modelName: 'deterministic-v1', owner: 'team-a' })
    registry.setModelAvailability(context, model.id, { status: MODEL_AVAILABILITY_STATUS.AVAILABLE, reason: 'deterministic' })
    const rollout = registry.createRollout(context, { promptId: prompt.id, promptVersion: 1, modelId: model.id, percentage: 100 })
    const rolloutApproval = registry.requestApproval(context, { resourceType: 'rollout', resourceId: rollout.id })
    let blocked = false
    try { registry.activateRollout(context, rollout.id) } catch (error) { blocked = /approval/.test(error.message) }
    registry.approve(reviewer, rolloutApproval.id)
    const active = registry.activateRollout(context, rollout.id)
    let invalid = false
    try { registry.evaluate(context, rollout.id, null) } catch (error) { invalid = /payload/.test(error.message) }
    console.log(JSON.stringify({ blocked, active: active.state, invalid }))
  `)
  assert.deepEqual(result, { blocked: true, active: 'active', invalid: true })
})

test('deprecation, provider failure, and rollback are explicit and fail closed', () => {
  const result = runTypeScriptScenario(`
    ${moduleImport}
    const { InMemoryAIRegistry, MODEL_AVAILABILITY_STATUS, ROLLOUT_STATE } = registryModule
    const context = { tenantId: 'tenant-a', actorId: 'owner', correlationId: 'corr-a' }
    const reviewer = { ...context, actorId: 'reviewer' }
    const registry = new InMemoryAIRegistry()
    const prompt = registry.registerPrompt(context, { key: 'welcome', owner: 'team-a' })
    const first = registry.createPromptVersion(context, { promptId: prompt.id, template: 'Hello', version: 1 })
    const second = registry.createPromptVersion(context, { promptId: prompt.id, template: 'Hi', version: 2 })
    for (const version of [first, second]) { const approval = registry.requestApproval(context, { resourceType: 'prompt_version', resourceId: version.id }); registry.approve(reviewer, approval.id) }
    const model = registry.registerModel(context, { key: 'local-fake', provider: 'fake', modelName: 'deterministic-v1', owner: 'team-a' })
    registry.setModelAvailability(context, model.id, { status: MODEL_AVAILABILITY_STATUS.AVAILABLE, reason: 'deterministic' })
    const rollout = registry.createRollout(context, { promptId: prompt.id, promptVersion: 2, modelId: model.id, percentage: 100 })
    const rolloutApproval = registry.requestApproval(context, { resourceType: 'rollout', resourceId: rollout.id }); registry.approve(reviewer, rolloutApproval.id)
    registry.activateRollout(context, rollout.id)
    registry.deprecatePromptVersion(context, { promptId: prompt.id, version: 2, reason: 'bad copy' })
    let deprecated = false
    try { registry.evaluate(context, rollout.id, { name: 'Ada' }) } catch (error) { deprecated = /deprecated/.test(error.message) }
    registry.rollbackRollout(context, rollout.id, { targetVersion: 1, reason: 'restore' })
    const restored = registry.getActiveRollout(context, prompt.id)
    registry.recordProviderFailure(context, model.id, 'fake timeout')
    let unavailable = false
    try { registry.evaluate(context, restored.id, { name: 'Ada' }) } catch (error) { unavailable = /unavailable/.test(error.message) }
    console.log(JSON.stringify({ deprecated, restored: restored.promptVersion, paused: registry.getRollout(context, rollout.id).state, unavailable, expected: ROLLOUT_STATE.PAUSED }))
  `)
  assert.deepEqual(result, {
    deprecated: true,
    restored: 1,
    paused: 'paused',
    unavailable: true,
    expected: 'paused',
  })
})

test('fake evaluator is deterministic and registry audit is tenant-scoped and redacted', () => {
  const result = runTypeScriptScenario(`
    ${moduleImport}
    const { InMemoryAIRegistry, MODEL_AVAILABILITY_STATUS } = registryModule
    const context = { tenantId: 'tenant-a', actorId: 'owner', correlationId: 'corr-a' }
    const registry = new InMemoryAIRegistry()
    const prompt = registry.registerPrompt(context, { key: 'welcome', owner: 'team-a' })
    const version = registry.createPromptVersion(context, { promptId: prompt.id, template: 'Hello', version: 1 })
    const approval = registry.requestApproval(context, { resourceType: 'prompt_version', resourceId: version.id }); registry.approve({ ...context, actorId: 'reviewer' }, approval.id)
    const model = registry.registerModel(context, { key: 'local-fake', provider: 'fake', modelName: 'deterministic-v1', owner: 'team-a' }); registry.setModelAvailability(context, model.id, { status: MODEL_AVAILABILITY_STATUS.AVAILABLE, reason: 'deterministic' })
    const rollout = registry.createRollout(context, { promptId: prompt.id, promptVersion: 1, modelId: model.id, percentage: 100 }); const rolloutApproval = registry.requestApproval(context, { resourceType: 'rollout', resourceId: rollout.id }); registry.approve({ ...context, actorId: 'reviewer' }, rolloutApproval.id); registry.activateRollout(context, rollout.id)
    const first = registry.evaluate(context, rollout.id, { name: 'Ada', secret: 'do-not-log' }); const second = registry.evaluate(context, rollout.id, { name: 'Ada', secret: 'do-not-log' })
    console.log(JSON.stringify({ same: JSON.stringify(first) === JSON.stringify(second), quality: first.quality, latencyMs: first.latencyMs, redacted: registry.auditLog(context).every((event) => !JSON.stringify(event.metadata).includes('secret')), otherTenant: registry.auditLog({ ...context, tenantId: 'tenant-b' }).length }))
  `)
  assert.deepEqual(result, {
    same: true,
    quality: 1,
    latencyMs: 17,
    redacted: true,
    otherTenant: 0,
  })
})

test('fake evaluator canonicalizes nested input order', () => {
  const result = runTypeScriptScenario(`
    ${moduleImport}
    const { InMemoryAIRegistry, MODEL_AVAILABILITY_STATUS } = registryModule
    const context = { tenantId: 'tenant-a', actorId: 'owner', correlationId: 'corr-a' }
    const registry = new InMemoryAIRegistry()
    const prompt = registry.registerPrompt(context, { key: 'welcome', owner: 'team-a' })
    const version = registry.createPromptVersion(context, { promptId: prompt.id, template: 'Hello', version: 1 })
    const approval = registry.requestApproval(context, { resourceType: 'prompt_version', resourceId: version.id }); registry.approve({ ...context, actorId: 'reviewer' }, approval.id)
    const model = registry.registerModel(context, { key: 'local-fake', provider: 'fake', modelName: 'deterministic-v1', owner: 'team-a' }); registry.setModelAvailability(context, model.id, { status: MODEL_AVAILABILITY_STATUS.AVAILABLE, reason: 'deterministic' })
    const rollout = registry.createRollout(context, { promptId: prompt.id, promptVersion: 1, modelId: model.id, percentage: 100 })
    const rolloutApproval = registry.requestApproval(context, { resourceType: 'rollout', resourceId: rollout.id }); registry.approve({ ...context, actorId: 'reviewer' }, rolloutApproval.id); registry.activateRollout(context, rollout.id)
    const first = registry.evaluate(context, rollout.id, { nested: { a: 1, b: 2 } })
    const second = registry.evaluate(context, rollout.id, { nested: { b: 2, a: 1 } })
    console.log(JSON.stringify({ same: first.output === second.output }))
  `)
  assert.deepEqual(result, { same: true })
})
