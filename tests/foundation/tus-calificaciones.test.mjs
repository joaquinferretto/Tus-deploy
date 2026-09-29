import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// FASE 9: the client of a COMPLETED work rates its provider once (1-5 + optional comment). Only
// the client of that work; never the provider, a third party, a cancelled or unfinished work.
// Averages are server-side, in one grouped read, and appear on the public profile.
const SETUP = `${SERVICE_SETUP}
  const { AlmacenCalificacionesEnMemoria, ServicioCalificaciones } = await import('./apps/api/src/tus/reputacion/calificaciones.ts')
  const almacen = new AlmacenCalificacionesEnMemoria(async (tenantId, trabajoId) => (await workStore.findAccessible({ tenantId, trabajoId }))?.status ?? null)
  const calificaciones = new ServicioCalificaciones({ almacen, trabajos: { buscarAccesible: (i) => workStore.findAccessible(i) }, now: clock })
  let seq = 0
  const act = async (who, op, id, extra = {}) => { const w = (await work.getWork(who, id)).work; seq += 1; return work[op]({ ...who, trabajoId: id, expectedVersion: w.version, idempotencyKey: op + seq, requestHash: 'h' + seq, createdAt: '2026-09-23T10:00:' + String(seq % 60).padStart(2, '0') + '.000Z', ...extra }) }
  async function requestWork(id, who = customer, prov = provider) {
    const { work: created } = await work.crearDesdeSolicitudEnTransaccion({ ...who, solicitudId: 'sol-' + id, prestadorTenantId: prov.tenantId, prestadorId: 'provider-1', createdAt: '2026-09-23T09:00:00.000Z' })
    return created.trabajoId
  }
  async function completedWork(id, who = customer, prov = provider) {
    const trabajoId = await requestWork(id, who, prov)
    const budget = await work.createBudget({ ...prov, trabajoId, currency: 'ARS', scope: 's', totalMinor: '1000', lines: [{ lineId: 'l', description: 'd', quantity: 1, unitAmountMinor: '1000', totalAmountMinor: '1000' }], idempotencyKey: 'b-' + id, requestHash: 'h', createdAt: '2026-09-23T09:10:00.000Z' })
    await work.decideBudget({ ...who, trabajoId, presupuestoId: budget.budget.presupuestoId, presupuestoVersion: budget.budget.version, decision: 'accepted', idempotencyKey: 'd-' + id, requestHash: 'h', createdAt: '2026-09-23T09:11:00.000Z' })
    await act(prov, 'startWork', trabajoId)
    await act(prov, 'completeWork', trabajoId)
    return trabajoId
  }
  const rate = (who, trabajoId, score, comment) => calificaciones.calificar({ tenantId: who.tenantId, cuentaId: who.actorId, trabajoId, score, comment })
`

test('FASE9 only the client of a completed work rates it, once, 1 to 5', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const done = await completedWork('a')
    const provider1 = await codeOf(() => rate(provider, done, 5))
    const strangerRate = await codeOf(() => rate(stranger, done, 5))
    const invalid = await Promise.all([0, 6, 4.5, '5', null].map((score) => codeOf(() => rate(customer, done, score))))
    const tooLong = await codeOf(() => rate(customer, done, 5, 'x'.repeat(501)))
    const ok = await rate(customer, done, 5, '  Excelente, puntual  ')
    const twice = await codeOf(() => rate(customer, done, 4))
    const open = await requestWork('open')
    const notCompleted = await codeOf(() => rate(customer, open, 5))
    const cancelled = await requestWork('cx')
    await act(customer, 'cancelWork', cancelled, { reason: 'Ya no lo necesito' })
    const onCancelled = await codeOf(() => rate(customer, cancelled, 5))
    // The store refuses a rating of a non-completed work even if the service were bypassed (DB trigger parity).
    const bypass = await codeOf(() => almacen.crear({ id: 'x', tenantId: customer.tenantId, trabajoId: open, prestadorTenantId: provider.tenantId, prestadorId: 'provider-1', autorCuentaId: 'a', puntuacion: 5, comentario: null, creadaEn: '2026-09-23T10:00:00.000Z' }))
    const stored = [...almacen.items.values()]
    console.log(JSON.stringify({ provider1, strangerRate, invalid, tooLong, ok, twice, notCompleted, onCancelled, bypass, stored: stored.map((s) => [s.tenantId, s.prestadorTenantId, s.prestadorId, s.puntuacion, s.comentario]) }))
  `)
  assert.equal(r.provider1, 'FORBIDDEN')
  assert.equal(r.strangerRate, 'NOT_FOUND')
  assert.deepEqual(r.invalid, ['INVALID_SCORE', 'INVALID_SCORE', 'INVALID_SCORE', 'INVALID_SCORE', 'INVALID_SCORE'])
  assert.equal(r.tooLong, 'INVALID')
  assert.deepEqual([r.ok.score, r.ok.comment], [5, 'Excelente, puntual'])
  assert.equal(r.twice, 'ALREADY_RATED')
  assert.equal(r.notCompleted, 'WORK_NOT_COMPLETED')
  assert.equal(r.onCancelled, 'WORK_CANCELLED')
  assert.equal(r.bypass, 'WORK_NOT_COMPLETED')
  // Provider ids come from the persisted work, never from the request.
  assert.deepEqual(r.stored, [['customer-tenant', 'provider-tenant', 'provider-1', 5, 'Excelente, puntual']])
})

test('FASE9 averages are exact per provider and isolated between tenants; the summary exposes canRate and the rating', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const other = { tenantId: 'provider-2-tenant', actorId: 'provider-2-user', correlationId: 'c2' }
    const client2 = { tenantId: 'customer-2-tenant', actorId: 'customer-2-user', correlationId: 'c3' }
    const w1 = await completedWork('p1a')
    const w2 = await completedWork('p1b', client2)
    const w3 = await completedWork('p2a', customer, other)
    await rate(customer, w1, 5)
    await rate(client2, w2, 4)
    await rate(customer, w3, 3)
    const resumen = Object.fromEntries(await calificaciones.resumen([provider.tenantId, other.tenantId, 'sin-calificaciones']))
    const { ServicioResumenTrabajo } = await import('./apps/api/src/tus/work/resumen.ts')
    const source = { batch: async (works) => new Map(works.map((w) => [w.trabajoId, { request: null, budget: null, provider: { displayName: 'P', profession: null }, customerName: 'C' }])) }
    const summary = new ServicioResumenTrabajo(workStore, source, clock, null, calificaciones)
    const unrated = await completedWork('p1c')
    const before = await summary.obtener(customer.tenantId, unrated, ['tus:checkout'])
    const providerView = await summary.obtener(provider.tenantId, unrated, ['tus:marketplace:write'])
    await rate(customer, unrated, 4, 'Bien')
    const after = await summary.obtener(customer.tenantId, unrated, ['tus:checkout'])
    console.log(JSON.stringify({ resumen, before: [before.actions.canRate, before.rating], providerCanRate: providerView.actions.canRate, after: [after.actions.canRate, after.rating?.score, after.rating?.comment] }))
  `)
  assert.deepEqual(r.resumen['provider-tenant'], { average: 4.5, count: 2 })
  assert.deepEqual(r.resumen['provider-2-tenant'], { average: 3, count: 1 })
  assert.equal(r.resumen['sin-calificaciones'], undefined)
  assert.deepEqual(r.before, [true, null])
  assert.equal(r.providerCanRate, false)
  assert.deepEqual(r.after, [false, 4, 'Bien'])
})

test('FASE9 public profile shows the real average and count, read in ONE grouped query for a whole directory page', () => {
  const r = runTypeScriptScenario(`
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const contratos = await import('./packages/contracts/src/tus-directorio.ts')
    const merchants = new Map()
    const application = { marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null }, listings: { forTenant: async () => [] } } }, identity: { identidadVerificada: async () => false } }
    const calls = []
    const ratings = new Map([['t-1', { average: 4.7, count: 3 }]])
    let seq = 0
    const directorio = crearServicioDirectorio({ application, contarCompletados: async () => 0, calificaciones: async (ids) => { calls.push([...ids]); return new Map([...ratings].filter(([k]) => ids.includes(k))) }, now: () => Date.parse('2026-09-28T13:00:00.000Z'), newId: () => 'perfil-' + String(++seq).padStart(8, '0') })
    const ctx = (tenantId) => ({ tenantId, subjectId: 'a-' + tenantId, sessionId: 's', roles: ['merchant'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
    for (const t of ['t-1', 't-2', 't-3']) { merchants.set(t, { merchantId: 'm-' + t, status: 'approved' }); await directorio.guardarPerfil(ctx(t), { displayName: 'Prestador ' + t, profession: 'plomeria', zone: 'Centro', description: 'Plomero con experiencia' }) }
    calls.length = 0
    const page = await directorio.listar({})
    const listCalls = calls.length
    const withRating = page.items.find((item) => item.rating)
    const profile = await directorio.perfil(withRating.id)
    console.log(JSON.stringify({ listCalls, idsInCall: calls[0].length, ratings: page.items.map((item) => item.rating), valid: page.items.every(contratos.esPrestadorPublico), profileRating: profile.rating, invalidShape: contratos.esPrestadorPublico({ ...page.items[0], rating: { average: 9, count: 1 } }) }))
  `)
  assert.equal(r.listCalls, 1)
  assert.equal(r.idsInCall, 3)
  assert.deepEqual(r.ratings.filter(Boolean), [{ average: 4.7, count: 3 }])
  assert.equal(r.ratings.filter((item) => item === null).length, 2)
  assert.equal(r.valid, true)
  assert.deepEqual(r.profileRating, { average: 4.7, count: 3 })
  assert.equal(r.invalidShape, false)
})

test('FASE9 HTTP: only the session tenant rates; tenant or provider in the body are ignored', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const { crearRouterCalificaciones } = await import('./apps/api/src/tus/reputacion/http.ts')
    const { InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('customer-token', { sessionId: 's-c', subjectId: customer.actorId, tenantId: customer.tenantId, roles: ['customer'], permissions: ['tus:checkout'] })
    sessions.add('provider-token', { sessionId: 's-p', subjectId: provider.actorId, tenantId: provider.tenantId, roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:work:accept'] })
    const app = express(); app.use(express.json()); app.use(crearRouterCalificaciones({ servicio: calificaciones, sessions }))
    const server = app.listen(0)
    const post = async (token, id, body) => { const res = await fetch('http://127.0.0.1:' + server.address().port + '/tus/v1/trabajos/' + id + '/calificacion', { method: 'POST', headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-correlation-id': 'c', 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json().catch(() => null) } }
    try {
      const id = await completedWork('http')
      const anonymous = await post(null, id, { score: 5 })
      const byProvider = await post('provider-token', id, { score: 5 })
      const ok = await post('customer-token', id, { score: 4, comment: 'Muy bien', tenantId: 'otro', prestadorTenantId: 'otro' })
      const again = await post('customer-token', id, { score: 1 })
      const stored = [...almacen.items.values()][0]
      console.log(JSON.stringify({ anonymous: anonymous.status, byProvider: [byProvider.status, byProvider.body?.code], ok: [ok.status, ok.body?.score], again: [again.status, again.body?.code], stored: [stored.tenantId, stored.prestadorTenantId] }))
    } finally { server.close() }
  `)
  assert.equal(r.anonymous, 401)
  assert.deepEqual(r.byProvider, [403, 'FORBIDDEN'])
  assert.deepEqual(r.ok, [201, 4])
  assert.deepEqual(r.again, [409, 'ALREADY_RATED'])
  assert.deepEqual(r.stored, ['customer-tenant', 'provider-tenant'])
})

test('FASE9 migration: one append-only rating per work, bound to the work and its provider, only for completed works', () => {
  const sql = readFileSync(join(root, 'apps/api/prisma/migrations/20261014100000_tus_calificaciones_trabajo/migration.sql'), 'utf8')
  assert.match(sql, /CHECK \("puntuacion" BETWEEN 1 AND 5\)/u)
  assert.match(sql, /uq_calificaciones_trabajo_tenant_trabajo[^;]+\("tenant_id", "trabajo_id"\)/u)
  assert.match(sql, /REFERENCES public\."trabajos"\("tenant_id", "trabajo_id", "prestador_tenant_id", "prestador_id"\)/u)
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\."calificaciones_trabajo"/u)
  assert.match(sql, /"estado" = 'completed'/u)
  assert.doesNotMatch(sql, /DROP |DELETE FROM|ALTER TABLE/iu)
})
