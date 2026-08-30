import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

function adminPermissions() {
  return [
    'break-glass:approve',
    'break-glass:request',
    'emergency:revoke',
    'policy:rollback',
    'policy:write',
    'support:access',
    'support:impersonate',
    'support:write',
  ]
}

test('product administration is deny-by-default and separate from tenant membership', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryProductSuperadminService } = (await import('./apps/api/src/admin/product-superadmin/composition.ts')).default
    const service = createInMemoryProductSuperadminService({ now: () => 1_700_000_000_000 })
    const denied = await service.authorize({ productId: 'product-a', actorId: 'unknown', action: 'support:access', correlationId: 'corr-denied' })
    const admin = await service.seedSuperadmin({ productId: 'product-a', actorId: 'admin-a', permissions: ['support:access'] })
    const tenantBoundary = await service.authorize({ productId: 'product-a', actorId: 'admin-a', action: 'tenant:role:grant', tenantId: 'tenant-a', correlationId: 'corr-boundary' })
    console.log(JSON.stringify({ denied: denied.code, admin: admin.ok, tenantBoundary: tenantBoundary.code }))
  `)

  assert.deepEqual(result, {
    denied: 'FORBIDDEN',
    admin: true,
    tenantBoundary: 'FORBIDDEN',
  })
})

test('break-glass requires an explicit reason, distinct approval, and expires deterministically', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryProductSuperadminService } = (await import('./apps/api/src/admin/product-superadmin/composition.ts')).default
    let now = 1_700_000_000_000
    const service = createInMemoryProductSuperadminService({ now: () => now })
    await service.seedSuperadmin({ productId: 'product-a', actorId: 'requester', permissions: ['break-glass:approve', 'break-glass:request', 'emergency:revoke', 'policy:rollback', 'policy:write', 'support:access', 'support:impersonate', 'support:write'] })
    await service.seedSuperadmin({ productId: 'product-a', actorId: 'approver', permissions: ['break-glass:approve'] })
    const tooLong = await service.requestBreakGlass({ productId: 'product-a', actorId: 'requester', reason: 'incident', approvedBy: 'approver', ttlMs: 16 * 60 * 1000, correlationId: 'corr-long' })
    const sameActor = await service.requestBreakGlass({ productId: 'product-a', actorId: 'requester', reason: 'incident', approvedBy: 'requester', ttlMs: 1_000, correlationId: 'corr-same' })
    const opened = await service.requestBreakGlass({ productId: 'product-a', actorId: 'requester', reason: 'incident', approvedBy: 'approver', ttlMs: 1_000, correlationId: 'corr-open' })
    now += 1_001
    const expired = await service.authorize({ productId: 'product-a', actorId: 'requester', action: 'support:write', breakGlassId: opened.breakGlassId, correlationId: 'corr-expired' })
    console.log(JSON.stringify({ tooLong: tooLong.code, sameActor: sameActor.code, opened: opened.ok, expired: expired.code }))
  `)

  assert.deepEqual(result, {
    tooLong: 'INVALID',
    sameActor: 'FORBIDDEN',
    opened: true,
    expired: 'EXPIRED',
  })
})

test('policy changes and rollback require dual control from distinct product admins', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryProductSuperadminService } = (await import('./apps/api/src/admin/product-superadmin/composition.ts')).default
    const service = createInMemoryProductSuperadminService({ now: () => 1_700_000_000_000 })
    await service.seedSuperadmin({ productId: 'product-a', actorId: 'admin-a', permissions: ['break-glass:approve', 'break-glass:request', 'emergency:revoke', 'policy:rollback', 'policy:write', 'support:access', 'support:impersonate', 'support:write'] })
    await service.seedSuperadmin({ productId: 'product-a', actorId: 'admin-b', permissions: ['policy:write', 'policy:rollback'] })
    const initial = await service.publishPolicy({ productId: 'product-a', actorId: 'admin-a', permissions: ['support:access'], approvedBy: 'admin-b', reason: 'initial', correlationId: 'corr-1' })
    const same = await service.publishPolicy({ productId: 'product-a', actorId: 'admin-a', permissions: ['support:access', 'support:write'], approvedBy: 'admin-a', reason: 'unsafe', correlationId: 'corr-2' })
    const changed = await service.publishPolicy({ productId: 'product-a', actorId: 'admin-a', permissions: ['support:access', 'support:write'], approvedBy: 'admin-b', reason: 'approved', correlationId: 'corr-3' })
    const rollbackSame = await service.rollbackPolicy({ productId: 'product-a', actorId: 'admin-a', version: initial.version.version, approvedBy: 'admin-a', reason: 'restore', correlationId: 'corr-4' })
    const rollback = await service.rollbackPolicy({ productId: 'product-a', actorId: 'admin-a', version: initial.version.version, approvedBy: 'admin-b', reason: 'restore', correlationId: 'corr-5' })
    console.log(JSON.stringify({ initial: initial.ok, same: same.code, changed: changed.ok, rollbackSame: rollbackSame.code, rollback: rollback.ok, active: service.store.policies.get('product-a').activeVersion }))
  `)

  assert.deepEqual(result, {
    initial: true,
    same: 'FORBIDDEN',
    changed: true,
    rollbackSame: 'FORBIDDEN',
    rollback: true,
    active: 1,
  })
})

test('support sessions are tenant-scoped and impersonation is explicitly audited', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryProductSuperadminService } = (await import('./apps/api/src/admin/product-superadmin/composition.ts')).default
    const service = createInMemoryProductSuperadminService({ now: () => 1_700_000_000_000 })
    await service.seedSuperadmin({ productId: 'product-a', actorId: 'admin-a', permissions: ['break-glass:approve', 'break-glass:request', 'emergency:revoke', 'policy:rollback', 'policy:write', 'support:access', 'support:impersonate', 'support:write'] })
    const session = await service.startSupportSession({ productId: 'product-a', actorId: 'admin-a', tenantId: 'tenant-a', targetActorId: 'user-a', reason: 'support ticket', approvedBy: 'admin-a', correlationId: 'corr-session' })
    const allowed = await service.authorizeSupportSession({ sessionId: session.sessionId, action: 'support:write', tenantId: 'tenant-a', correlationId: 'corr-a' })
    const crossTenant = await service.authorizeSupportSession({ sessionId: session.sessionId, action: 'support:write', tenantId: 'tenant-b', correlationId: 'corr-b' })
    const events = service.audit.events.map((event) => JSON.stringify(event))
    console.log(JSON.stringify({ allowed: allowed.ok, crossTenant: crossTenant.code, audited: events.some((event) => event.includes('support:session:start')), redacted: events.every((event) => !event.includes(session.sessionId) && !event.includes('support-session-token')) }))
  `)

  assert.deepEqual(result, {
    allowed: true,
    crossTenant: 'FORBIDDEN',
    audited: true,
    redacted: true,
  })
})

test('rollback restores only the product policy and cannot grant tenant authority', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryProductSuperadminService } = (await import('./apps/api/src/admin/product-superadmin/composition.ts')).default
    const service = createInMemoryProductSuperadminService({ now: () => 1_700_000_000_000 })
    await service.seedSuperadmin({ productId: 'product-a', actorId: 'admin-a', permissions: ['break-glass:approve', 'break-glass:request', 'emergency:revoke', 'policy:rollback', 'policy:write', 'support:access', 'support:impersonate', 'support:write'] })
    await service.seedSuperadmin({ productId: 'product-a', actorId: 'admin-b', permissions: ['policy:write', 'policy:rollback'] })
    const v1 = await service.publishPolicy({ productId: 'product-a', actorId: 'admin-a', permissions: ['support:access'], approvedBy: 'admin-b', reason: 'baseline', correlationId: 'corr-1' })
    await service.publishPolicy({ productId: 'product-a', actorId: 'admin-a', permissions: ['support:access', 'support:write'], approvedBy: 'admin-b', reason: 'temporary', correlationId: 'corr-2' })
    const before = await service.authorize({ productId: 'product-a', actorId: 'admin-a', action: 'support:write', correlationId: 'corr-3' })
    await service.rollbackPolicy({ productId: 'product-a', actorId: 'admin-a', version: v1.version.version, approvedBy: 'admin-b', reason: 'regression', correlationId: 'corr-4' })
    const after = await service.authorize({ productId: 'product-a', actorId: 'admin-a', action: 'support:write', correlationId: 'corr-5' })
    const nonEscalation = await service.authorize({ productId: 'product-a', actorId: 'admin-a', action: 'tenant:membership:grant', tenantId: 'tenant-a', correlationId: 'corr-6' })
    console.log(JSON.stringify({ before: before.ok, after: after.code, nonEscalation: nonEscalation.code, versions: service.store.policies.get('product-a').versions.length }))
  `)

  assert.deepEqual(result, {
    before: true,
    after: 'FORBIDDEN',
    nonEscalation: 'FORBIDDEN',
    versions: 2,
  })
})

test('emergency revocation disables sessions and product policy without deleting audit history', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryProductSuperadminService } = (await import('./apps/api/src/admin/product-superadmin/composition.ts')).default
    const service = createInMemoryProductSuperadminService({ now: () => 1_700_000_000_000 })
    await service.seedSuperadmin({ productId: 'product-a', actorId: 'admin-a', permissions: ['break-glass:approve', 'break-glass:request', 'emergency:revoke', 'policy:rollback', 'policy:write', 'support:access', 'support:impersonate', 'support:write'] })
    const session = await service.startSupportSession({ productId: 'product-a', actorId: 'admin-a', tenantId: 'tenant-a', reason: 'incident', correlationId: 'corr-session' })
    const revoked = await service.emergencyRevoke({ productId: 'product-a', actorId: 'admin-a', sessionId: session.sessionId, reason: 'containment', correlationId: 'corr-revoke' })
    const denied = await service.authorizeSupportSession({ sessionId: session.sessionId, action: 'support:access', tenantId: 'tenant-a', correlationId: 'corr-denied' })
    const disabled = await service.disableProduct({ productId: 'product-a', actorId: 'admin-a', reason: 'security incident', correlationId: 'corr-disable' })
    const productDenied = await service.authorize({ productId: 'product-a', actorId: 'admin-a', action: 'support:access', correlationId: 'corr-product-denied' })
    console.log(JSON.stringify({ revoked: revoked.ok, denied: denied.code, disabled: disabled.ok, productDenied: productDenied.code, auditCount: service.audit.events.length }))
  `)

  assert.deepEqual(result, {
    revoked: true,
    denied: 'REVOKED',
    disabled: true,
    productDenied: 'REVOKED',
    auditCount: 6,
  })
})
