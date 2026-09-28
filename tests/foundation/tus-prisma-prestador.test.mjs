import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// `prestadores` has no unique index on tenant_id alone (uq is tenant + prestador): the adapter must
// upsert by row id and look up by tenant with findFirst, or Prisma rejects the call at runtime.
test('Prisma merchant store upserts by row id and finds by tenant without a non-unique where', () => {
  const result = runTypeScriptScenario(`
    const module = await import('./apps/api/src/tus/adapters/prisma-marketplace.ts')
    const { PrismaMarketplaceStore } = module.default ?? module
    const rows = new Map()
    const calls = []
    const prestador = {
      upsert: async ({ where, create, update }) => { calls.push(['upsert', Object.keys(where)]); rows.set(where.id, rows.has(where.id) ? { ...rows.get(where.id), ...update } : create); return rows.get(where.id) },
      findFirst: async ({ where }) => { calls.push(['findFirst', Object.keys(where)]); return [...rows.values()].find(row => row.tenantId === where.tenantId) ?? null },
      findUnique: async () => { throw new Error('findUnique needs a unique key') },
    }
    const store = new PrismaMarketplaceStore({ prestador })
    const profile = { merchantId: 'm-1', tenantId: 't-1', cohort: 'tus', locationId: 'l', timezone: 'America/Argentina/Cordoba', staffRoles: [], operatingPolicyVersion: 'v1', status: 'active', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }
    await store.merchant.save(profile)
    await store.merchant.save({ ...profile, status: 'paused' })
    const found = await store.merchant.find('t-1')
    const missing = await store.merchant.find('t-2')
    console.log(JSON.stringify({ calls, count: rows.size, found: found?.merchantId ?? null, status: found?.status ?? null, missing }))
  `)
  assert.deepEqual(result.calls, [['upsert', ['id']], ['upsert', ['id']], ['findFirst', ['tenantId']], ['findFirst', ['tenantId']]])
  assert.equal(result.count, 1)
  assert.equal(result.found, 'm-1')
  assert.equal(result.missing, null)
})
