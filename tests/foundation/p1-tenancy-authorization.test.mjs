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

test('tenancy contracts cover context, organization, membership, and authorization decisions', () => {
  const names = ['context', 'organization', 'membership', 'authorization']
  const schemas = names.map((name) =>
    JSON.parse(
      readFileSync(join(root, `packages/contracts/schemas/tenancy/${name}.schema.json`), 'utf8')
    )
  )

  assert.deepEqual(
    schemas.map((schema) => schema.$id),
    names.map((name) => `https://golden-boilerplate.dev/contracts/tenancy/${name}.v1.schema.json`)
  )
  assert.ok(
    schemas.every((schema) => schema.type === 'object' && schema.additionalProperties === false)
  )
})

test('missing or invalid tenant context is denied and produces correlated redacted audit events', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryTenancyService } = (await import('./apps/api/src/tenancy/composition.ts')).default
    const tenancy = createInMemoryTenancyService({ now: () => 1_700_000_000_000 })
    const missing = await tenancy.authorize({ action: 'resource:read', resourceType: 'document', resourceId: 'doc-a' })
    const invalid = await tenancy.authorize({ context: { tenantId: '', actorId: 'actor-a', correlationId: 'corr-a' }, action: 'resource:read', resourceType: 'document', resourceId: 'doc-a' })

    console.log(JSON.stringify({
      missing: missing.code,
      invalid: invalid.code,
      denied: missing.allowed === false && invalid.allowed === false,
      audit: tenancy.audit.events.map((event) => ({ outcome: event.outcome, tenantId: event.tenantId, correlationId: event.correlationId, hasSecret: JSON.stringify(event).includes('token') })),
    }))
  `)

  assert.deepEqual(result, {
    missing: 'INVALID_TENANT_CONTEXT',
    invalid: 'INVALID_TENANT_CONTEXT',
    denied: true,
    audit: [
      { outcome: 'denied', tenantId: null, correlationId: 'missing-correlation', hasSecret: false },
      { outcome: 'denied', tenantId: null, correlationId: 'corr-a', hasSecret: false },
    ],
  })
})

test('organization bootstrap creates a default workspace, owner role, and active membership', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryTenancyService } = (await import('./apps/api/src/tenancy/composition.ts')).default
    const tenancy = createInMemoryTenancyService({ now: () => 1_700_000_000_000 })
    const created = await tenancy.createOrganization({ actorId: 'actor-a', name: 'Acme', slug: 'acme', correlationId: 'corr-1' })
    const context = { tenantId: created.organization.id, actorId: 'actor-a', correlationId: 'corr-2' }
    const decision = await tenancy.authorize({ context, action: 'workspace:write', resourceType: 'workspace', resourceId: created.workspace.id })

    console.log(JSON.stringify({
      ok: created.ok,
      workspace: created.workspace.slug,
      membership: created.membership.status,
      owner: created.role.permissions.sort(),
      allowed: decision.allowed,
    }))
  `)

  assert.deepEqual(result, {
    ok: true,
    workspace: 'default',
    membership: 'active',
    owner: [
      'membership:invite',
      'membership:revoke',
      'resource:read',
      'resource:write',
      'role:manage',
      'workspace:write',
    ],
    allowed: true,
  })
})

test('resource reads and writes stay tenant-scoped, including direct identifiers and list filters', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryTenancyService } = (await import('./apps/api/src/tenancy/composition.ts')).default
    const tenancy = createInMemoryTenancyService({ now: () => 1_700_000_000_000 })
    const a = await tenancy.createOrganization({ actorId: 'actor-a', name: 'A', slug: 'a', correlationId: 'corr-a' })
    const b = await tenancy.createOrganization({ actorId: 'actor-b', name: 'B', slug: 'b', correlationId: 'corr-b' })
    await tenancy.writeResource({ context: { tenantId: a.organization.id, actorId: 'actor-a', correlationId: 'corr-a1' }, resource: { id: 'doc-a', type: 'document', tenantId: a.organization.id, value: 'A' } })
    await tenancy.writeResource({ context: { tenantId: b.organization.id, actorId: 'actor-b', correlationId: 'corr-b1' }, resource: { id: 'doc-b', type: 'document', tenantId: b.organization.id, value: 'B' } })
    const crossRead = await tenancy.readResource({ context: { tenantId: a.organization.id, actorId: 'actor-a', correlationId: 'corr-a2' }, resourceType: 'document', resourceId: 'doc-b' })
    const crossWrite = await tenancy.writeResource({ context: { tenantId: a.organization.id, actorId: 'actor-a', correlationId: 'corr-a3' }, resource: { id: 'doc-b', type: 'document', tenantId: b.organization.id, value: 'tampered' } })
    const visible = await tenancy.listResources({ context: { tenantId: a.organization.id, actorId: 'actor-a', correlationId: 'corr-a4' }, resourceType: 'document' })
    const ownerRead = await tenancy.readResource({ context: { tenantId: a.organization.id, actorId: 'actor-a', correlationId: 'corr-a5' }, resourceType: 'document', resourceId: 'doc-a' })

    console.log(JSON.stringify({ crossRead: crossRead.code, crossWrite: crossWrite.code, visible: visible.resources.map((resource) => resource.id), ownerRead: ownerRead.resource?.value }))
  `)

  assert.deepEqual(result, {
    crossRead: 'NOT_FOUND',
    crossWrite: 'FORBIDDEN',
    visible: ['doc-a'],
    ownerRead: 'A',
  })
})

test('roles and permissions are evaluated with deny-by-default resource scopes', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryTenancyService } = (await import('./apps/api/src/tenancy/composition.ts')).default
    const tenancy = createInMemoryTenancyService()
    const created = await tenancy.createOrganization({ actorId: 'owner', name: 'Acme', slug: 'acme', correlationId: 'corr-1' })
    const viewer = await tenancy.createRole({ context: { tenantId: created.organization.id, actorId: 'owner', correlationId: 'corr-2' }, name: 'Viewer', permissions: ['resource:read'], resourceScopes: ['document:*'] })
    await tenancy.addMembership({ context: { tenantId: created.organization.id, actorId: 'owner', correlationId: 'corr-3' }, userId: 'viewer', roleIds: [viewer.role.id] })
    const context = { tenantId: created.organization.id, actorId: 'viewer', correlationId: 'corr-4' }
    const readAllowed = await tenancy.authorize({ context, action: 'resource:read', resourceType: 'document', resourceId: 'doc-1' })
    const writeDenied = await tenancy.authorize({ context, action: 'resource:write', resourceType: 'document', resourceId: 'doc-1' })
    const scopeDenied = await tenancy.authorize({ context, action: 'resource:read', resourceType: 'invoice', resourceId: 'invoice-1' })

    console.log(JSON.stringify({ readAllowed: readAllowed.allowed, writeDenied: writeDenied.code, scopeDenied: scopeDenied.code }))
  `)

  assert.deepEqual(result, {
    readAllowed: true,
    writeDenied: 'FORBIDDEN',
    scopeDenied: 'FORBIDDEN',
  })
})

test('membership revocation immediately denies future access and records the lifecycle outcome', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryTenancyService } = (await import('./apps/api/src/tenancy/composition.ts')).default
    const tenancy = createInMemoryTenancyService()
    const created = await tenancy.createOrganization({ actorId: 'owner', name: 'Acme', slug: 'acme', correlationId: 'corr-1' })
    const member = await tenancy.addMembership({ context: { tenantId: created.organization.id, actorId: 'owner', correlationId: 'corr-2' }, userId: 'member', roleIds: [created.role.id] })
    const revoked = await tenancy.revokeMembership({ context: { tenantId: created.organization.id, actorId: 'owner', correlationId: 'corr-3' }, membershipId: member.membership.id })
    const denied = await tenancy.authorize({ context: { tenantId: created.organization.id, actorId: 'member', correlationId: 'corr-4' }, action: 'resource:read', resourceType: 'document', resourceId: 'doc-1' })

    console.log(JSON.stringify({ revoked: revoked.ok, denied: denied.code, lifecycleAudit: tenancy.audit.events.filter((event) => event.action === 'membership:revoke').map((event) => event.outcome) }))
  `)

  assert.deepEqual(result, {
    revoked: true,
    denied: 'FORBIDDEN',
    lifecycleAudit: ['success', 'success'],
  })
})

test('invitations require tenant permission, bind to the invited email, expire, and cannot be replayed', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryTenancyService } = (await import('./apps/api/src/tenancy/composition.ts')).default
    let now = 1_700_000_000_000
    const tenancy = createInMemoryTenancyService({ now: () => now })
    const created = await tenancy.createOrganization({ actorId: 'owner', name: 'Acme', slug: 'acme', correlationId: 'corr-1' })
    const context = { tenantId: created.organization.id, actorId: 'owner', correlationId: 'corr-2' }
    const invitation = await tenancy.inviteMember({ context, email: 'member@example.test', roleIds: [created.role.id], ttlMs: 1000 })
    const wrongEmail = await tenancy.acceptInvitation({ token: invitation.token, userId: 'member', email: 'attacker@example.test', correlationId: 'corr-3' })
    now += 2_000
    const expired = await tenancy.acceptInvitation({ token: invitation.token, userId: 'member', email: 'member@example.test', correlationId: 'corr-4' })
    const fresh = await tenancy.inviteMember({ context, email: 'member@example.test', roleIds: [created.role.id], ttlMs: 10_000 })
    const accepted = await tenancy.acceptInvitation({ token: fresh.token, userId: 'member', email: 'member@example.test', correlationId: 'corr-5' })
    const replay = await tenancy.acceptInvitation({ token: fresh.token, userId: 'member', email: 'member@example.test', correlationId: 'corr-6' })

    console.log(JSON.stringify({ invited: invitation.ok, wrongEmail: wrongEmail.code, expired: expired.code, accepted: accepted.ok, replay: replay.code, auditSafe: tenancy.audit.events.every((event) => !JSON.stringify(event).includes('member@example.test') && !JSON.stringify(event).includes(fresh.token)) }))
  `)

  assert.deepEqual(result, {
    invited: true,
    wrongEmail: 'FORBIDDEN',
    expired: 'EXPIRED',
    accepted: true,
    replay: 'REPLAYED',
    auditSafe: true,
  })
})

test('tenant context propagation accepts only complete headers and never invents a tenant', () => {
  const result = runTypeScriptScenario(`
    const { tenantContextFromHeaders } = (await import('./apps/api/src/tenancy/http/tenant-context.ts')).default
    const valid = tenantContextFromHeaders({ 'x-tenant-id': 'tenant-a', 'x-actor-id': 'actor-a', 'x-correlation-id': 'corr-a' })
    const missing = tenantContextFromHeaders({ 'x-actor-id': 'actor-a', 'x-correlation-id': 'corr-b' })
    const whitespace = tenantContextFromHeaders({ 'x-tenant-id': '  ', 'x-actor-id': 'actor-a', 'x-correlation-id': 'corr-c' })
    console.log(JSON.stringify({ valid, missing, whitespace }))
  `)

  assert.deepEqual(result, {
    valid: { tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a' },
    missing: null,
    whitespace: null,
  })
})

test('audit events contain actor, tenant, correlation, outcome, and redacted metadata for denied access', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryTenancyService } = (await import('./apps/api/src/tenancy/composition.ts')).default
    const tenancy = createInMemoryTenancyService()
    const created = await tenancy.createOrganization({ actorId: 'owner', name: 'Acme', slug: 'acme', correlationId: 'corr-1' })
    await tenancy.authorize({ context: { tenantId: created.organization.id, actorId: 'member', correlationId: 'corr-denied' }, action: 'resource:delete', resourceType: 'document', resourceId: 'secret-doc' })
    const event = tenancy.audit.events.at(-1)
    console.log(JSON.stringify({ actorId: event.actorId, tenantRecorded: event.tenantId === created.organization.id, correlationId: event.correlationId, outcome: event.outcome, reason: event.reason, metadata: event.metadata, leaks: JSON.stringify(event).includes('secret-doc') }))
  `)

  assert.deepEqual(result, {
    actorId: 'member',
    tenantRecorded: true,
    correlationId: 'corr-denied',
    outcome: 'denied',
    reason: 'membership_not_found',
    metadata: { resourceType: 'document', action: 'resource:delete' },
    leaks: false,
  })
})
