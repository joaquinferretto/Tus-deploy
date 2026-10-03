import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// FASE 10: platform support follows request -> provider -> work -> budget -> deposit -> balance ->
// cancellations -> rating. Read-only views (plus the support cancellation), MFA admin only, no
// tokens / secrets / chat, and a fixed number of reads per page.

test('FASE10 HTTP: work and payment views need the MFA admin permission and never leak full provider ids', () => {
  const r = runTypeScriptScenario(`
    const { crearRouterAdminTrabajos } = await import('./apps/api/src/tus/admin/trabajos.ts')
    const { referenciaParcial } = await import('./apps/api/src/tus/admin/trabajos-fuente.ts')
    const { InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('admin', { sessionId: 'a', subjectId: 'admin-1', tenantId: 'platform', roles: ['admin'], permissions: ['tus:payments:admin'] })
    sessions.add('provider-admin-only', { sessionId: 'p', subjectId: 'x', tenantId: 't', roles: ['admin'], permissions: ['tus:providers:admin'] })
    sessions.add('client', { sessionId: 'c', subjectId: 'c', tenantId: 'c', roles: ['customer'], permissions: ['tus:checkout'] })
    const fuente = {
      pagina: async (input) => ({ items: [{ id: 'w1', estado: 'in_progress', input }], total: 1 }),
      detalle: async (id) => (id === 'w1' ? { id: 'w1', transiciones: [] } : null),
      pagos: async () => ({ items: [{ pagoId: 'p1', referencia: referenciaParcial('123456789012') }], total: 1 }),
    }
    const app = express(); app.use(express.json()); app.use(crearRouterAdminTrabajos({ sessions, trabajos: {}, fuente }))
    const server = app.listen(0)
    const get = async (path, token) => { const res = await fetch('http://127.0.0.1:' + server.address().port + path, { headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-correlation-id': 'c' } }); return { status: res.status, body: await res.json().catch(() => null), cache: res.headers.get('cache-control') } }
    try {
      const anonymous = await get('/tus/v1/admin/trabajos')
      const client = await get('/tus/v1/admin/trabajos', 'client')
      const narrow = await get('/tus/v1/admin/pagos', 'provider-admin-only')
      const list = await get('/tus/v1/admin/trabajos?q=canilla&estado=in_progress&pageSize=10', 'admin')
      const detail = await get('/tus/v1/admin/trabajos/w1', 'admin')
      const missing = await get('/tus/v1/admin/trabajos/nope', 'admin')
      const pagos = await get('/tus/v1/admin/pagos', 'admin')
      console.log(JSON.stringify({ anonymous: anonymous.status, client: client.status, narrow: narrow.status, list: [list.status, list.body.items[0].input, list.body.totalPages, list.cache], detail: detail.status, missing: missing.status, ref: pagos.body.items[0].referencia, shortRef: referenciaParcial('12'), none: referenciaParcial(null) }))
    } finally { server.close() }
  `)
  assert.equal(r.anonymous, 401)
  assert.equal(r.client, 403)
  assert.equal(r.narrow, 403)
  assert.deepEqual(r.list, [200, { pagina: 1, tamano: 10, q: 'canilla', estado: 'in_progress' }, 1, 'no-store'])
  assert.equal(r.detail, 200)
  assert.equal(r.missing, 404)
  assert.equal(r.ref, '•••• 9012')
  assert.equal(r.shortRef, '••••')
  assert.equal(r.none, null)
})

test('FASE10 providers admin shows Mercado Pago status, reputation and completed works from batched reads', () => {
  const r = runTypeScriptScenario(`
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const merchants = new Map()
    const application = { marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null, findMany: async (ids) => ids.map((t) => merchants.get(t)).filter(Boolean) }, listings: { forTenant: async () => [] } } }, identity: { identidadVerificada: async () => false, resumenDeTenants: async () => new Map() } }
    const calls = { ratings: 0, operacion: 0 }
    let seq = 0
    const directorio = crearServicioDirectorio({
      application,
      contarCompletados: async () => 0,
      calificaciones: async (ids) => { calls.ratings += 1; return new Map(ids.includes('t-1') ? [['t-1', { average: 4, count: 2 }]] : []) },
      operacionAdmin: async (ids) => { calls.operacion += 1; return new Map(ids.map((id) => [id, { mercadoPago: id === 't-1' ? 'connected' : 'not_connected', completados: id === 't-1' ? 5 : 0 }])) },
      now: () => Date.parse('2026-09-28T13:00:00.000Z'),
      newId: () => 'perfil-' + String(++seq).padStart(8, '0'),
    })
    const ctx = (tenantId) => ({ tenantId, subjectId: 'a-' + tenantId, sessionId: 's', roles: ['merchant'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
    for (const t of ['t-1', 't-2', 't-3']) { merchants.set(t, { tenantId: t, merchantId: 'm-' + t, status: 'approved' }); await directorio.guardarPerfil(ctx(t), { displayName: 'Prestador ' + t, profession: 'plomeria', zone: 'Centro', description: 'Plomero con experiencia' }) }
    calls.ratings = 0; calls.operacion = 0
    const page = await directorio.paginaParaAdmin({ pagina: 1, tamano: 25, q: '', oficio: '', zona: '', visible: null, verificado: null })
    const rows = page.items.map((item) => ({ t: item.tenantId, mp: item.mercadoPago, rating: item.rating, done: item.trabajosCompletados }))
    console.log(JSON.stringify({ calls, rows, text: JSON.stringify(page) }))
  `)
  assert.deepEqual(r.calls, { ratings: 1, operacion: 1 })
  const t1 = r.rows.find((row) => row.t === 't-1')
  assert.deepEqual(t1, { t: 't-1', mp: 'connected', rating: { average: 4, count: 2 }, done: 5 })
  assert.equal(r.rows.filter((row) => row.mp === 'not_connected' && row.rating === null).length, 2)
  assert.doesNotMatch(r.text, /accessToken|refreshToken|clientSecret|credencial|cifrad/iu)
})

test('FASE10 Web: admin navigation, request -> work link, providers columns and payment views without secrets', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8')
  const layout = read('apps/web/src/components/admin/admin-layout.tsx')
  assert.match(layout, /\/tus\/admin\/trabajos', label: 'Trabajos'/u)
  assert.match(layout, /\/tus\/admin\/pagos', label: 'Pagos'/u)
  assert.match(read('apps/web/src/components/admin/admin-solicitudes.tsx'), /\/tus\/admin\/trabajos\?id=\$\{encodeURIComponent\(item\.trabajoId\)\}/u)
  const prestadores = read('apps/web/src/components/admin/admin-prestadores-lista.tsx')
  assert.match(prestadores, /Mercado Pago<\/th>/u)
  assert.match(prestadores, /item\.rating/u)
  const trabajos = read('apps/web/src/components/admin/admin-trabajos.tsx')
  for (const label of ['Comisión TUS', 'Neto Prestador', 'Referencia MP', 'Historial', 'Calificación', 'Cancelación de soporte'])
    assert.ok(trabajos.includes(label), label)
  // No chat, tokens or secrets in the admin views.
  assert.doesNotMatch(trabajos + prestadores, /mensajes|accessToken|refreshToken|clientSecret|client_secret/iu)
})

// Real Prisma on a DISPOSABLE PostgreSQL 16 with every migration applied (see tus-pagos-postgres).
const url = process.env.TUS_PAYMENTS_PG_URL
test(
  'FASE10 PostgreSQL: the admin work page, detail and payments use a fixed number of queries and expose no secrets',
  { skip: !url && 'TUS_PAYMENTS_PG_URL not set (disposable PostgreSQL only)', timeout: 120000 },
  () => {
    const r = runTypeScriptScenario(`
      const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
      const { FuenteTrabajosAdminPrisma } = await import('./apps/api/src/tus/admin/trabajos-fuente.ts')
      const { operacionAdminPrisma } = await import('./apps/api/src/tus/directorio/almacenes.ts')
      const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, log: [{ emit: 'event', level: 'query' }], errorFormat: 'minimal' })
      let queries = 0
      prisma.$on('query', () => { queries += 1 })
      try {
        // Its own request-born work with a paid deposit (fictitious rows, unique run prefix), so the
        // test does not depend on another file having written that database first.
        const { PrismaTrabajoTransaction, PrismaTrabajoStore, PrismaTrabajoOutboxStore } = await import('./apps/api/src/tus/adapters/prisma-work.ts')
        const { TransaccionFinanzasServicioPrisma } = await import('./apps/api/src/tus/adapters/prisma-finanzas-servicios.ts')
        const { ServicioTrabajo } = await import('./apps/api/src/tus/work/index.ts')
        const { ServicioFinanzasServicios } = await import('./apps/api/src/tus/finance/servicios/servicio.ts')
        const { ProveedorPagosServicioDeterminista } = await import('./apps/api/src/tus/finance/servicios/pagos.ts')
        const { pagosTrabajo } = await import('./apps/api/src/tus/composition/index.ts')
        const T = (s) => 'f10' + Date.now().toString(36) + '-' + s
        const run = T('')
        const R = (s) => run + s
        const sql = (q) => prisma.$executeRawUnsafe(q)
        await sql("INSERT INTO \\"TusTenant\\"(id, slug, name, status, \\"createdAt\\", \\"updatedAt\\") VALUES ('" + R('cli') + "','" + R('cli') + "','c','active',now(),now()), ('" + R('pre') + "','" + R('pre') + "','p','active',now(),now())")
        await sql("INSERT INTO \\"User\\"(id, email, \\"normalizedEmail\\", \\"displayName\\", \\"updatedAt\\") VALUES ('" + R('u') + "','" + R('u') + "@t.invalid','" + R('u') + "@t.invalid','A',now())")
        await sql("INSERT INTO \\"Account\\"(id, \\"userId\\", \\"tenantId\\", status, \\"createdAt\\", \\"updatedAt\\") VALUES ('" + R('acc') + "','" + R('u') + "','" + R('cli') + "','active',now(),now())")
        await sql("INSERT INTO prestadores(id, tenant_id, prestador_id, cohorte, ubicacion_id, zona_horaria, roles_personal, version_politica_operativa, estado, fecha_creacion, fecha_actualizacion) VALUES ('" + R('pr') + "','" + R('pre') + "','p-1','repairs-trades','loc','America/Argentina/Buenos_Aires',ARRAY['owner'],'v1','active',now(),now())")
        await sql("INSERT INTO solicitudes_servicio(id, cuenta_id, categoria, titulo, nombre_publico, zona, latitud, longitud, urgencia, estado, fecha_creacion, fecha_actualizacion, expira_en, visibilidad, prestador_tenant_id, prestador_id, estado_asignacion, origen) VALUES ('" + R('sol') + "','" + R('acc') + "','plomeria','Pierde la canilla','A','Centro',-27.4,-58.8,'esta_semana','abierta',now(),now(),now() + interval '7 days','dirigida','" + R('pre') + "','p-1','aceptada','web_directory')")
        let seedNow = Date.parse('2026-09-29T12:00:00.000Z')
        const work = new ServicioTrabajo(new PrismaTrabajoTransaction(prisma), () => seedNow)
        const proveedor = new ProveedorPagosServicioDeterminista('f10-secret')
        const politica = { reglaComision: async () => ({ politicaId: null, rateBps: 1000, ruleVersion: 'f10-10', pspFeeBearer: 'provider' }), disponibilidad: async () => ({ available: true, reason: null }) }
        const fin = new ServicioFinanzasServicios(new TransaccionFinanzasServicioPrisma(prisma, (tx) => ({ completarPorPagoFinal: (input) => work.completarPorPagoFinal({ work: new PrismaTrabajoStore(tx), outbox: new PrismaTrabajoOutboxStore(tx) }, input) })), () => seedNow, proveedor, undefined, politica)
        work.conPagos(pagosTrabajo(fin))
        const customer = { tenantId: R('cli'), actorId: 'actor-cli', correlationId: 'c' }
        const provider = { tenantId: R('pre'), actorId: 'actor-pre', correlationId: 'c' }
        const at = () => new Date(seedNow += 1000).toISOString()
        const { work: w0 } = await work.crearDesdeSolicitudEnTransaccion({ ...customer, solicitudId: R('sol'), prestadorTenantId: R('pre'), prestadorId: 'p-1', createdAt: at() })
        const budget = await work.createBudget({ ...provider, trabajoId: w0.trabajoId, currency: 'ARS', scope: 'Cambio de cuerito', totalMinor: '100000', lines: [{ lineId: 'l1', description: 'mano de obra', quantity: 1, unitAmountMinor: '100000', totalAmountMinor: '100000' }], idempotencyKey: R('b'), requestHash: 'h', createdAt: at() })
        await work.decideBudget({ ...customer, trabajoId: w0.trabajoId, presupuestoId: budget.budget.presupuestoId, presupuestoVersion: budget.budget.version, decision: 'accepted', idempotencyKey: R('d'), requestHash: 'h', createdAt: at() })
        const sena = await fin.iniciarCheckout({ ...customer, trabajoId: w0.trabajoId, idempotencyKey: R('sena') })
        const raw = JSON.stringify({ id: R('evt'), data: { id: 'fake-mp-' + sena.payment.paymentId, external_reference: sena.payment.paymentId, status: 'approved', currency_id: 'ARS', transaction_amount: '500.00', date_last_updated: at() } })
        await fin.ingerirEventoProveedor({ rawBody: raw, signature: proveedor.firmar(raw), receivedAt: at() })
        const fuente = new FuenteTrabajosAdminPrisma(prisma)
        const count = async (op) => { queries = 0; const value = await op(); return { value, queries } }
        const small = await count(() => fuente.pagina({ pagina: 1, tamano: 10, q: '', estado: '' }))
        const large = await count(() => fuente.pagina({ pagina: 1, tamano: 50, q: '', estado: '' }))
        const withPayments = large.value.items.find((item) => item.pagos.length > 0) ?? large.value.items[0]
        const detail = await count(() => fuente.detalle(withPayments.id))
        const pagos = await count(() => fuente.pagos({ pagina: 1, tamano: 50, estado: '' }))
        const operacion = await count(() => operacionAdminPrisma(prisma)(large.value.items.map((item) => item.id)))
        console.log(JSON.stringify({ total: large.value.total, sizes: [small.value.items.length, large.value.items.length], queries: [small.queries, large.queries, detail.queries, pagos.queries, operacion.queries], payments: pagos.value.items.length, refs: pagos.value.items.map((p) => p.referencia).filter(Boolean), text: JSON.stringify([detail.value, pagos.value]) }))
      } finally { await prisma.$disconnect() }
    `)
    assert.ok(r.total >= 1)
    // Same number of queries for 10 or 50 rows: no per-row reads.
    assert.equal(r.queries[0], r.queries[1])
    assert.ok(r.queries[1] <= 8, `page queries: ${r.queries[1]}`)
    assert.ok(r.queries[2] <= 12, `detail queries: ${r.queries[2]}`)
    assert.ok(r.queries[3] <= 4, `payments queries: ${r.queries[3]}`)
    assert.ok(r.queries[4] <= 2, `admin provider columns: ${r.queries[4]}`)
    for (const ref of r.refs) assert.match(ref, /^•••• .{4}$/u)
    assert.doesNotMatch(r.text, /fake-mp-|access_token|refresh|secret|cifrad|texto/iu)
  }
)
