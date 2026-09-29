import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { reviewMigrationChain } from '../../scripts/tus-migration-repair-lib.mjs'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

const root = join(import.meta.dirname, '..', '..')
const MIGRATION = '20261009100000_tus_trabajo_desde_solicitud'

test('work origin migration is additive: accepted by the migration gate and never drops data', async () => {
  const review = await reviewMigrationChain({ names: [MIGRATION] })
  assert.equal(review.accepted, true, JSON.stringify(review.reviews?.[0]?.blocking ?? []))
  const sql = await readFile(join(root, 'apps/api/prisma/migrations', MIGRATION, 'migration.sql'), 'utf8')
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)\b/iu)
  assert.doesNotMatch(sql, /^\s*(DELETE\s+FROM|TRUNCATE)\b/imu)
  assert.match(sql, /"ck_trabajos_origen_coherente"/u)
  assert.match(sql, /CREATE UNIQUE INDEX "uq_trabajos_solicitud" ON public\."trabajos"\("solicitud_id"\) WHERE "solicitud_id" IS NOT NULL/u)
  assert.match(sql, /"fk_trabajos_solicitud_asignada"[\s\S]*\("solicitud_id", "prestador_tenant_id", "prestador_id"\)[\s\S]*REFERENCES public\."solicitudes_servicio"\("id", "prestador_tenant_id", "prestador_id"\)/u)
})

test('work contract accepts both origins and rejects inconsistent references', () => {
  const result = runTypeScriptScenario(`
    const { validarTrabajo, TUS_CONTRACT_VERSION } = await import('./packages/contracts/src/tus.ts')
    const base = { contractVersion: TUS_CONTRACT_VERSION, trabajoId: 'w', tenantId: 't', prestadorTenantId: 'p', prestadorId: 'm', status: 'requested', version: 1, budgetRequired: true, createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z' }
    const check = (value) => { try { validarTrabajo(value); return 'ok' } catch (error) { return error.message } }
    console.log(JSON.stringify({
      legacyMarketplace: check({ ...base, commitmentId: 'c', publicacionId: 'l' }),
      marketplace: check({ ...base, origin: 'marketplace', commitmentId: 'c', publicacionId: 'l', solicitudId: null }),
      solicitud: check({ ...base, origin: 'solicitud', commitmentId: null, publicacionId: null, solicitudId: 's' }),
      solicitudWithCommitment: check({ ...base, origin: 'solicitud', commitmentId: 'c', publicacionId: null, solicitudId: 's' }),
      solicitudWithoutId: check({ ...base, origin: 'solicitud', commitmentId: null, publicacionId: null }),
      marketplaceWithoutCommitment: check({ ...base, origin: 'marketplace', commitmentId: null, publicacionId: 'l' }),
      unknownOrigin: check({ ...base, origin: 'otro', solicitudId: 's' }),
    }))
  `)
  assert.equal(result.legacyMarketplace, 'ok')
  assert.equal(result.marketplace, 'ok')
  assert.equal(result.solicitud, 'ok')
  assert.match(result.solicitudWithCommitment, /inconsistent/u)
  assert.match(result.solicitudWithoutId, /inconsistent/u)
  assert.match(result.marketplaceWithoutCommitment, /inconsistent/u)
  assert.match(result.unknownOrigin, /origin is invalid/u)
})

test('Prisma work mapping round-trips both origins', () => {
  const result = runTypeScriptScenario(`
    const { mapTrabajo, PrismaTrabajoStore } = await import('./apps/api/src/tus/adapters/prisma-work.ts')
    const created = []
    const store = new PrismaTrabajoStore({ trabajo: { create: async ({ data }) => { created.push(data); return data } } })
    const work = { contractVersion: '1.0.0', trabajoId: 'trabajo-solicitud-s1', tenantId: 't-cli', prestadorTenantId: 't-prov', origin: 'solicitud', commitmentId: null, prestadorId: 'm-prov', publicacionId: null, solicitudId: 's1', clienteId: 't-cli', status: 'requested', version: 1, budgetRequired: true, acceptedBudgetId: null, acceptedBudgetVersion: null, createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z' }
    await store.createWork(work)
    const row = created[0]
    const mapped = mapTrabajo({ ...row, fechaCreacion: new Date(work.createdAt), fechaActualizacion: new Date(work.updatedAt) })
    const legacy = mapTrabajo({ versionContrato: '1.0.0', trabajoId: 'w', tenantId: 't', prestadorTenantId: 'p', compromisoId: 'c', prestadorId: 'm', publicacionId: 'l', estado: 'requested', version: 1, requierePresupuesto: false, fechaCreacion: new Date(0), fechaActualizacion: new Date(0) })
    console.log(JSON.stringify({ row: { origen: row.origen, compromisoId: row.compromisoId, publicacionId: row.publicacionId, solicitudId: row.solicitudId }, mapped, legacy: { origin: legacy.origin, commitmentId: legacy.commitmentId, solicitudId: legacy.solicitudId } }))
  `)
  assert.deepEqual(result.row, { origen: 'solicitud', compromisoId: null, publicacionId: null, solicitudId: 's1' })
  assert.equal(result.mapped.origin, 'solicitud')
  assert.equal(result.mapped.solicitudId, 's1')
  assert.equal(result.mapped.commitmentId, null)
  assert.deepEqual(result.legacy, { origin: 'marketplace', commitmentId: 'c', solicitudId: null })
})
