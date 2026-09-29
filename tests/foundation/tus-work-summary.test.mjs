import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario, SERVICE_SETUP } from './fixtures/web-09-servicio.mjs'

const SETUP = `${SERVICE_SETUP}
  const { ServicioResumenTrabajo, PrismaWorkSummarySource, accionesTrabajo } = await import('./apps/api/src/tus/work/resumen.ts')
  const perms = ['tus:marketplace:read', 'tus:marketplace:write', 'tus:work:accept']
  const requests = [], profiles = [], budgets = [], calls = []
  const db = {
    solicitudServicio: { findMany: async (q) => { calls.push(['requests', q]); return requests.filter(r => q.where.id.in.includes(r.id)) } },
    perfilPublicoPrestador: { findMany: async (q) => { calls.push(['profiles', q]); return profiles } },
    presupuesto: { findMany: async (q) => { calls.push(['budgets', q]); return budgets } },
  }
  const source = new PrismaWorkSummarySource(db)
  const summary = new ServicioResumenTrabajo(workStore, source, clock)
  async function add(i, tenant = customer.tenantId, providerTenant = provider.tenantId) {
    const { work: w } = await work.crearDesdeSolicitudEnTransaccion({ tenantId: tenant, actorId: 'actor', correlationId: 'corr', solicitudId: 's-' + i, prestadorTenantId: providerTenant, prestadorId: 'p-' + i, createdAt: '2026-09-23T09:00:00.000Z' })
    requests.push({ id: 's-' + i, titulo: 'Arreglar canilla ' + i, descripcion: 'Pierde agua', categoria: 'plomeria', zona: 'Centro', nombrePublico: 'Laura M.', imagenes: [{ orden: 1 }] })
    profiles.push({ tenantId: providerTenant, prestadorId: 'p-' + i, nombrePublico: 'Juan ' + i, oficio: 'plomeria' })
    return w
  }
`

test('FASE5 linked request lists batch profiles and applications without per-request reads', () => {
  const r = runTypeScriptScenario(`
    const { AlmacenSolicitudesEnMemoria } = await import('./apps/api/src/tus/solicitudes/almacenes.ts')
    const { ServicioSolicitudes } = await import('./apps/api/src/tus/solicitudes/servicio.ts')
    const store = new AlmacenSolicitudesEnMemoria()
    let profileReads = 0, requestReads = 0
    const batch = store.obtenerMuchas.bind(store)
    store.obtenerMuchas = async ids => {requestReads++; return batch(ids)}
    store.obtener = async () => {throw new Error('N+1 request lookup')}
    const perfiles = new Map()
    for(let i=0;i<30;i++) {
      const id='s'+i, provider='provider'+i
      await store.guardar({id,cuentaId:'account',categoria:'plomeria',titulo:'Canilla '+i,descripcion:'Reparar',nombrePublico:'Laura M.',zona:'Centro',latitud:0,longitud:0,presupuestoMaximo:null,urgencia:'sin_apuro',estado:'abierta',creadaEn:1000,actualizadaEn:1000,expiraEn:9999999999999,origen:'web_publica',visibilidad:'dirigida',prestadorTenantId:provider,prestadorId:provider,estadoAsignacion:'aceptada',respondidaEn:1000,canceladaEn:null,canceladaPor:null,imagenes:[],trabajoId:null})
      store.trabajoPorSolicitud.set(id,'w'+i)
      perfiles.set(provider,{id:provider,nombrePublico:'Prestador '+i})
      await store.guardarPostulacion({id:'p'+i,solicitudId:id,prestadorTenantId:provider,prestadorId:provider,mensaje:null,estado:'aceptada',creadaEn:1000,actualizadaEn:1000})
    }
    const service=new ServicioSolicitudes({almacen:store,cuentas:{},destinos:{perfilesPorTenants:async ids=>{profileReads++;return perfiles},perfilPorTenant:async()=>{throw new Error('N+1 profile lookup')}}})
    const own=await service.mias('account')
    const applications=await service.misPostulaciones('provider0')
    console.log(JSON.stringify({profileReads,requestReads,count:own.length,linked:own.every(s=>s.workId&&s.provider),application:applications[0].request.workId}))
  `)
  assert.equal(r.profileReads, 1)
  assert.equal(r.requestReads, 1)
  assert.equal(r.count, 30)
  assert.equal(r.linked, true)
  assert.equal(r.application, 'w0')
})

test('FASE5 list and summary authorize real participants, batch enrich and redact authority', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const a = await add(1), b = await add(2), other = await add(3, 'foreign', 'foreign-provider')
    const client = await summary.listar(customer.tenantId, perms)
    const providerList = await summary.listar(provider.tenantId, perms)
    const empty = await summary.listar(stranger.tenantId, perms)
    const detail = await summary.obtener(provider.tenantId, a.trabajoId, perms)
    const denied = await codeOf(() => summary.obtener(stranger.tenantId, a.trabajoId, perms))
    console.log(JSON.stringify({ client, providerList, empty, detail, denied }))
  `)
  assert.equal(r.client.items.length, 2)
  assert.equal(r.providerList.items.length, 2)
  assert.deepEqual(r.empty.items, [])
  assert.equal(r.denied, 'NOT_FOUND')
  assert.equal(r.client.items[0].role, 'cliente')
  assert.equal(r.providerList.items[0].role, 'prestador')
  assert.equal(r.detail.counterpart.displayName, 'Laura M.')
  assert.match(r.client.items[0].counterpart.displayName, /^Juan/)
  assert.equal(r.detail.actions.canCreateBudget, true)
  assert.equal(r.detail.actions.canStart, false)
  // FASE 8: the client of a request-born work cancels it before the start (with a reason).
  assert.equal(r.client.items[0].actions.canCancel, true)
  assert.doesNotMatch(JSON.stringify(r), /tenantId|actorId|correlationId|email|creadoPor/)
})

test('FASE5 query budget is constant for 1 and 40 works; uses scoped IN/OR batches', () => {
  const r = runTypeScriptScenario(`${SETUP}
    let workReads = 0
    const list = workStore.listAccessible.bind(workStore)
    workStore.listAccessible = async t => { workReads++; return list(t) }
    await add(0)
    await summary.listar(customer.tenantId, perms)
    const one = [workReads, calls.length]
    for (let i = 1; i < 40; i++) await add(i)
    calls.length = 0; workReads = 0
    await summary.listar(customer.tenantId, perms)
    const many = [workReads, calls.length]
    const sizes = calls.map(([name, q]) => [name, q.where.id?.in.length ?? q.where.OR.length])
    calls.length = 0
    await summary.obtener(customer.tenantId, 'trabajo-solicitud-s-0', perms)
    console.log(JSON.stringify({ one, many, sizes, detail: calls.length }))
  `)
  assert.deepEqual(r.one, [1, 3])
  assert.deepEqual(r.many, [1, 3])
  assert.deepEqual(r.sizes, [
    ['requests', 40],
    ['profiles', 40],
    ['budgets', 40],
  ])
  assert.equal(r.detail, 3)
  // Prisma's nested image selection is one additional batched SQL read, never N image queries.
})

test('FASE5 actions mirror transitions, budget expiry, role and session permissions', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const w = await add(1)
    const b = { presupuestoId: 'b', version: 1, status: 'issued', currency: 'ARS', totalMinor: '10000', scope: 'Reparar', validUntil: null }
    const states = ['requested', 'in_diagnosis', 'budget_pending', 'accepted', 'in_progress', 'completed', 'cancelled']
    const matrix = states.map(status => ({ status, p: accionesTrabajo({...w,status}, 'prestador', b, perms, clock()), c: accionesTrabajo({...w,status}, 'cliente', b, perms, clock()) }))
    const expired = accionesTrabajo({...w,status:'budget_pending'}, 'cliente', {...b,validUntil:'2020-01-01T00:00:00Z'}, perms, clock())
    const readonly = accionesTrabajo({...w,status:'accepted'}, 'prestador', b, ['tus:work:read'], clock())
    const noBudget = accionesTrabajo({...w,budgetRequired:false}, 'prestador', null, perms, clock())
    console.log(JSON.stringify({matrix, expired, readonly, noBudget}))
  `)
  for (const { status, p, c } of r.matrix) {
    assert.equal(p.canStart, status === 'accepted')
    assert.equal(p.canComplete, status === 'in_progress')
    assert.equal(p.canCancel, !['completed', 'cancelled'].includes(status))
    assert.equal(
      p.canCreateBudget,
      ['requested', 'in_diagnosis', 'budget_pending'].includes(status)
    )
    assert.equal(c.canStart || c.canComplete || c.canCreateBudget, false)
    // FASE 8: client cancels before the start; once started it can only request the cancellation.
    assert.equal(c.canCancel, ['requested', 'in_diagnosis', 'budget_pending', 'accepted'].includes(status))
    assert.equal(c.canRequestCancellation, status === 'in_progress')
    assert.equal(c.canAcceptBudget, status === 'budget_pending')
    assert.equal(c.canRejectBudget, c.canAcceptBudget)
    assert.equal(p.canAcceptBudget, false)
  }
  assert.equal(r.expired.canAcceptBudget, false)
  assert.equal(Object.values(r.readonly).some(Boolean), false)
  assert.equal(r.noBudget.canStart, true)
})

test('FASE5 latest budget is projected without internal records or draft leakage', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const w = await add(1)
    budgets.push({ tenantId:w.tenantId, trabajoId:w.trabajoId, presupuestoId:'b', version:2, estado:'issued', moneda:'ARS', montoTotal:12345n, alcance:'Reparar', fechaValidez:null })
    budgets.push({...budgets[0],version:1,estado:'rejected'})
    const latest = await summary.obtener(customer.tenantId, w.trabajoId, perms)
    budgets[0].estado='draft'
    const draft = await summary.obtener(customer.tenantId, w.trabajoId, perms)
    console.log(JSON.stringify({ latest:latest.budget, draft:draft.budget }))
  `)
  assert.equal(r.latest.version, 2)
  assert.equal(r.latest.totalMinor, '12345')
  assert.equal(r.draft, null)
})

test('FASE5 HTTP ignores spoofed tenant and role; private no-store, unauthenticated and third party denied', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const w = await add(1)
    const { createRequire } = await import('node:module')
    const express = createRequire(process.cwd() + '/apps/api/package.json')('express')
    const { crearRouterResumenTrabajo } = await import('./apps/api/src/tus/work/http-resumen.ts')
    const sessions = { resolve: async token => token === 'invalid' ? null : { tenantId: token, subjectId:'a', permissions:token === 'no-permission' ? [] : perms, roles:[], sessionId:'s', correlationId:'c' } }
    const app = express(); app.use(crearRouterResumenTrabajo({servicio:summary,sessions}))
    const server = app.listen(0); await new Promise(r => server.once('listening',r))
    try {
      const base = 'http://127.0.0.1:' + server.address().port
      const get = (path, token) => fetch(base+path,{headers:token?{authorization:'Bearer '+token,'x-correlation-id':'c'}:{},signal:AbortSignal.timeout(4000)})
      const list = '/tus/v1/mis-trabajos', detail = '/tus/v1/trabajos/'+w.trabajoId+'/resumen'
      const noSession = (await get(list)).status
      const noPermission = (await get(list,'no-permission')).status
      const strangerStatus = (await get(detail,stranger.tenantId)).status
      const spoof = await (await get(list+'?tenantId='+customer.tenantId+'&role=cliente',stranger.tenantId)).json()
      const cli = await get(detail,customer.tenantId), prov = await get(detail,provider.tenantId)
      console.log(JSON.stringify({noSession,noPermission,strangerStatus,spoof,cli:await cli.json(),prov:await prov.json(),cache:cli.headers.get('cache-control')}))
    } finally { await new Promise(r => server.close(r)) }
  `)
  assert.equal(r.noSession, 401)
  assert.equal(r.noPermission, 403)
  assert.equal(r.strangerStatus, 404)
  assert.deepEqual(r.spoof.items, [])
  assert.equal(r.cli.role, 'cliente')
  assert.equal(r.prov.role, 'prestador')
  assert.equal(r.cache, 'no-store')
})
