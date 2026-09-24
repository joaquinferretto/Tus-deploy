import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

test('identity persistence schema models tenant-scoped account lifecycle records', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')

  for (const model of [
    'model User',
    'model Account',
    'model PasswordCredential',
    'model VerificationToken',
    'model RecoveryToken',
    'model Device',
    'model Session',
  ]) {
    assert.match(schema, new RegExp(`^${model} \\{`, 'm'))
  }
  assert.match(schema, /@@unique\(\[userId, tenantId\]\)/)
  assert.match(schema, /normalizedEmail\s+String\s+@unique/)
  assert.match(schema, /tokenDigest\s+String\s+@unique/)
  assert.match(schema, /accountId_deviceId/)
})

test('identity migration is explicit and enforces database uniqueness and foreign keys', () => {
  const migration = join(
    root,
    'apps/api/prisma/migrations/20260823120000_identity_persistence/migration.sql'
  )
  assert.equal(existsSync(migration), true)
  const sql = readFileSync(migration, 'utf8')
  assert.match(sql, /CREATE TABLE "User"/)
  assert.match(sql, /CREATE UNIQUE INDEX .*normalizedEmail/i)
  assert.match(sql, /FOREIGN KEY \("accountId"\)/)
  assert.match(sql, /ON DELETE CASCADE/)
  assert.match(sql, /CREATE UNIQUE INDEX .*tenantId/i)
})

test('Prisma identity mapping preserves dates, scope, and token digests without leaking hashes', () => {
  const result = runTypeScriptScenario(`
    const { mapAccountRow, mapCredentialRow, mapTokenRow, mapSessionRow } = (await import('./apps/api/src/auth-security/adapters/postgres/mappers.ts')).default
    const account = mapAccountRow({
      id: 'account-a',
      tenantId: 'tenant-a',
      roles: ['member'],
      status: 'active',
      emailVerifiedAt: new Date(1700000000123),
      createdAt: new Date(1700000000000),
      updatedAt: new Date(1700000000001),
      user: { id: 'user-a', email: 'member@example.com', normalizedEmail: 'member@example.com', displayName: 'Member' },
    })
    const credential = mapCredentialRow({ id: 'credential-a', accountId: 'account-a', passwordHash: 'scrypt-hash', status: 'active', createdAt: new Date(1700000000000), updatedAt: new Date(1700000000001), lastUsedAt: null })
    const verification = mapTokenRow({ id: 'verification-a', accountId: 'account-a', tokenDigest: 'digest-a', expiresAt: new Date(1700003600000), consumedAt: null })
    const session = mapSessionRow({ id: 'session-a', accountId: 'account-a', tenantId: 'tenant-a', deviceId: 'device-a', accessTokenDigest: 'access-digest', roles: ['member'], permissions: [], createdAt: new Date(1700000000000), expiresAt: new Date(1700003600000), revokedAt: null })
    console.log(JSON.stringify({ account, credential, verification, session }))
  `)

  assert.deepEqual(result, {
    account: {
      id: 'account-a',
      email: 'member@example.com',
      normalizedEmail: 'member@example.com',
      displayName: 'Member',
      tenantId: 'tenant-a',
      roles: ['member'],
      status: 'active',
      emailVerifiedAt: 1700000000123,
      createdAt: 1700000000000,
      updatedAt: 1700000000001,
    },
    credential: {
      id: 'credential-a',
      accountId: 'account-a',
      passwordHash: 'scrypt-hash',
      status: 'active',
      createdAt: 1700000000000,
      updatedAt: 1700000000001,
      lastUsedAt: null,
    },
    verification: {
      id: 'verification-a',
      accountId: 'account-a',
      tokenDigest: 'digest-a',
      expiresAt: 1700003600000,
      consumedAt: null,
    },
    session: {
      id: 'session-a',
      accountId: 'account-a',
      tenantId: 'tenant-a',
      deviceId: 'device-a',
      accessTokenDigest: 'access-digest',
      scope: { tenantId: 'tenant-a', roles: ['member'], permissions: [] },
      createdAt: 1700000000000,
      expiresAt: 1700003600000,
      revokedAt: null,
    },
  })
})

test('Prisma adapter scopes credential, token, session, and device operations to account identity', () => {
  const result = runTypeScriptScenario(`
    const { PrismaIdentityStore } = (await import('./apps/api/src/auth-security/adapters/postgres/prisma-identity-store.ts')).default
    const calls = []
    const client = {
      user: { findUnique: async () => null, create: async ({ data }) => ({ ...data, user: { email: data.email, normalizedEmail: data.normalizedEmail, displayName: data.displayName } }) },
      account: { findUnique: async () => null, create: async ({ data }) => ({ ...data, user: { email: 'member@example.com', normalizedEmail: 'member@example.com', displayName: data.displayName } }) },
      passwordCredential: { findUnique: async ({ where }) => (calls.push(['credential', where]), null), create: async ({ data }) => (calls.push(['credential-create', data]), data) },
      verificationToken: { findUnique: async ({ where }) => (calls.push(['verification', where]), null), create: async ({ data }) => (calls.push(['verification-create', data]), data) },
      recoveryToken: { findUnique: async ({ where }) => (calls.push(['recovery', where]), null), create: async ({ data }) => (calls.push(['recovery-create', data]), data) },
      session: { create: async ({ data }) => (calls.push(['session-create', data]), data), updateMany: async ({ where, data }) => (calls.push(['session-revoke', where, data]), { count: 1 }) },
      device: { upsert: async ({ where, create, update }) => (calls.push(['device', where, create, update]), create) },
      $transaction: async (callback) => callback(client),
    }
    const store = new PrismaIdentityStore(client)
    await store.findPasswordCredential('account-a')
    await store.findVerificationToken('verification-digest')
    await store.findRecoveryToken('recovery-digest')
    await store.revokeSessions('account-a', 1700000000000)
    await store.saveDevice('account-a', { deviceId: 'device-a', label: 'Browser', firstSeenAt: 1700000000000, lastSeenAt: 1700000000001 })
    console.log(JSON.stringify(calls))
  `)

  assert.deepEqual(result[0], ['credential', { accountId: 'account-a' }])
  assert.deepEqual(result[1], ['verification', { tokenDigest: 'verification-digest' }])
  assert.deepEqual(result[2], ['recovery', { tokenDigest: 'recovery-digest' }])
  assert.deepEqual(result[3], [
    'session-revoke',
    { accountId: 'account-a', revokedAt: null },
    { revokedAt: '2023-11-14T22:13:20.000Z' },
  ])
  assert.equal(result[4][0], 'device')
  assert.deepEqual(result[4][1], {
    accountId_deviceId: { accountId: 'account-a', deviceId: 'device-a' },
  })
})

test('Prisma membership checks resolve the account foreign key to the user identity', () => {
  const result = runTypeScriptScenario(`
    const { PrismaIdentityStore } = (await import('./apps/api/src/auth-security/adapters/postgres/prisma-identity-store.ts')).default
    const calls = []
    const client = {
      account: { findUnique: async ({ where, include }) => (calls.push(['account', where, include]), { user: { id: 'user-a' } }) },
      membership: { findFirst: async ({ where, select }) => (calls.push(['membership', where, select]), { id: 'membership-a' }) },
    }
    const store = new PrismaIdentityStore(client)
    const active = await store.hasActiveMembership('account-a', 'tenant-a')
    console.log(JSON.stringify({ active, calls }))
  `)

  assert.equal(result.active, true)
  assert.deepEqual(result.calls, [
    ['account', { id: 'account-a' }, { user: true }],
    ['membership', { organizationId: 'tenant-a', userId: 'user-a', status: 'active' }, { id: true }],
  ])
})

test('Prisma registration bootstrap creates the generated tenant structure before the account', () => {
  const result = runTypeScriptScenario(`
    const { PrismaIdentityStore } = (await import('./apps/api/src/auth-security/adapters/postgres/prisma-identity-store.ts')).default
    const calls = []
    const delegate = (name) => ({ create: async ({ data }) => (calls.push([name, data]), data) })
    const client = {
      user: {
        findUnique: async () => null,
        create: async ({ data }) => (calls.push(['user', data]), data),
      },
      account: {
        findUnique: async () => null,
        create: async ({ data }) => (calls.push(['account', data]), data),
      },
      tusTenant: delegate('tenant'),
      organization: delegate('organization'),
      workspace: delegate('workspace'),
      tenantRole: delegate('role'),
      membership: delegate('membership'),
    }
    const store = new PrismaIdentityStore(client)
    await store.saveAccount({
      id: 'user-a', email: 'member@example.com', normalizedEmail: 'member@example.com', displayName: 'Member',
      tenantId: 'tenant-a', roles: ['member'], status: 'active', emailVerifiedAt: null,
      createdAt: 1700000000000, updatedAt: 1700000000000,
    }, { bootstrapTenant: true })
    console.log(JSON.stringify(calls))
  `)

  assert.deepEqual(result.map(([name]) => name), [
    'user', 'tenant', 'organization', 'workspace', 'role', 'membership', 'account',
  ])
  assert.equal(result[5][1].organizationId, 'tenant-a')
  assert.equal(result[5][1].workspaceId, 'tenant-a:default')
  assert.equal(result[5][1].userId, 'user-a')
  assert.ok(result[4][1].permissions.includes('tus:marketplace:write'))
})

test('seed plan is deterministic, idempotent, and contains no usable credential material', () => {
  const result = runTypeScriptScenario(`
    const { buildIdentitySeed, seedIdentity } = (await import('./apps/api/prisma/seed.ts')).default
    const first = buildIdentitySeed()
    const second = buildIdentitySeed()
    const calls = []
    const client = { user: { upsert: async (args) => (calls.push(args), args.create) }, $disconnect: async () => calls.push('disconnect') }
    await seedIdentity(client)
    console.log(JSON.stringify({ same: JSON.stringify(first) === JSON.stringify(second), seed: first, calls }))
  `)

  assert.equal(result.same, true)
  assert.equal(result.seed.length, 0)
  assert.deepEqual(result.calls, [])
})

test('unavailable identity persistence fails explicitly without falling back to in-memory state', () => {
  const result = runTypeScriptScenario(`
    const { UnavailableIdentityStore } = (await import('./apps/api/src/auth-security/adapters/postgres/unavailable-identity-store.ts')).default
    const store = new UnavailableIdentityStore('PostgreSQL is unavailable')
    let error
    try { await store.getAccount('account-a') } catch (caught) { error = caught }
    console.log(JSON.stringify({ code: error?.code, message: error?.message, hasMaps: 'accounts' in store }))
  `)

  assert.deepEqual(result, {
    code: 'IDENTITY_PERSISTENCE_UNAVAILABLE',
    message: 'Identity persistence is unavailable',
    hasMaps: false,
  })
})
