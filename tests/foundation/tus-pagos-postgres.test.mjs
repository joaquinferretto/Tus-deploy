import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Runs only against a DISPOSABLE PostgreSQL 16 database with every migration applied:
//   TUS_PAYMENTS_PG_URL=postgresql://user@127.0.0.1:55471/tus_fresh node --test <this file>
// Never point it to a shared or real database: it writes fictitious rows (unique run prefix).
// Real Prisma adapters: deposit + balance of a request-born work, concurrent checkouts and
// duplicated notifications in parallel, and the approved balance completing the work in the SAME
// transaction as the payment.
const url = process.env.TUS_PAYMENTS_PG_URL

test(
  'FASE7 PostgreSQL: deposit and balance with real adapters; concurrent checkouts create one obligation per part; parallel duplicate notifications complete the work once',
  { skip: !url && 'TUS_PAYMENTS_PG_URL not set (disposable PostgreSQL only)', timeout: 120000 },
  () => {
    const result = runTypeScriptScenario(`
      const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
      const { PrismaTrabajoTransaction, PrismaTrabajoStore, PrismaTrabajoOutboxStore } = await import('./apps/api/src/tus/adapters/prisma-work.ts')
      const { TransaccionFinanzasServicioPrisma } = await import('./apps/api/src/tus/adapters/prisma-finanzas-servicios.ts')
      const { ServicioTrabajo } = await import('./apps/api/src/tus/work/index.ts')
      const { ServicioFinanzasServicios } = await import('./apps/api/src/tus/finance/servicios/servicio.ts')
      const { ProveedorPagosServicioDeterminista } = await import('./apps/api/src/tus/finance/servicios/pagos.ts')
      const { pagosTrabajo } = await import('./apps/api/src/tus/composition/index.ts')
      const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, log: [], errorFormat: 'minimal' })
      const run = 'r' + Date.now().toString(36)
      const T = (s) => run + '-' + s
      try {
        const sql = (q) => prisma.$executeRawUnsafe(q)
        await sql("INSERT INTO \\"TusTenant\\"(id, slug, name, status, \\"createdAt\\", \\"updatedAt\\") VALUES ('" + T('cli') + "','" + T('cli') + "','c','active',now(),now()), ('" + T('pre') + "','" + T('pre') + "','p','active',now(),now())")
        await sql("INSERT INTO \\"User\\"(id, email, \\"normalizedEmail\\", \\"displayName\\", \\"updatedAt\\") VALUES ('" + T('u') + "','" + T('u') + "@t.invalid','" + T('u') + "@t.invalid','A',now())")
        await sql("INSERT INTO \\"Account\\"(id, \\"userId\\", \\"tenantId\\", status, \\"createdAt\\", \\"updatedAt\\") VALUES ('" + T('acc') + "','" + T('u') + "','" + T('cli') + "','active',now(),now())")
        await sql("INSERT INTO prestadores(id, tenant_id, prestador_id, cohorte, ubicacion_id, zona_horaria, roles_personal, version_politica_operativa, estado, fecha_creacion, fecha_actualizacion) VALUES ('" + T('pr') + "','" + T('pre') + "','p-1','repairs-trades','loc','America/Argentina/Buenos_Aires',ARRAY['owner'],'v1','active',now(),now())")
        await sql("INSERT INTO solicitudes_servicio(id, cuenta_id, categoria, titulo, nombre_publico, zona, latitud, longitud, urgencia, estado, fecha_creacion, fecha_actualizacion, expira_en, visibilidad, prestador_tenant_id, prestador_id, estado_asignacion, origen) VALUES ('" + T('sol') + "','" + T('acc') + "','plomeria','Pierde la canilla','A','Centro',-27.4,-58.8,'esta_semana','abierta',now(),now(),now() + interval '7 days','dirigida','" + T('pre') + "','p-1','aceptada','web_directory')")
        let now = Date.parse('2026-09-29T12:00:00.000Z')
        const clock = () => now
        const work = new ServicioTrabajo(new PrismaTrabajoTransaction(prisma), clock)
        const proveedor = new ProveedorPagosServicioDeterminista('pg-secret')
        const politica = { reglaComision: async () => ({ politicaId: null, rateBps: 1000, ruleVersion: 'pg-10', pspFeeBearer: 'provider' }), disponibilidad: async () => ({ available: true, reason: null }) }
        const fin = new ServicioFinanzasServicios(new TransaccionFinanzasServicioPrisma(prisma, (tx) => ({ completarPorPagoFinal: (input) => work.completarPorPagoFinal({ work: new PrismaTrabajoStore(tx), outbox: new PrismaTrabajoOutboxStore(tx) }, input) })), clock, proveedor, undefined, politica)
        work.conPagos(pagosTrabajo(fin))
        const customer = { tenantId: T('cli'), actorId: 'actor-cli', correlationId: 'c' }
        const provider = { tenantId: T('pre'), actorId: 'actor-pre', correlationId: 'c' }
        const codeOf = async (op) => { try { await op(); return 'none' } catch (e) { return e?.code ?? String(e) } }
        let seq = 0
        const at = () => new Date(now + (++seq) * 1000).toISOString()
        const { work: w0 } = await work.crearDesdeSolicitudEnTransaccion({ ...customer, solicitudId: T('sol'), prestadorTenantId: T('pre'), prestadorId: 'p-1', createdAt: at() })
        const id = w0.trabajoId
        const k = (s) => T(s)
        const budget = await work.createBudget({ ...provider, trabajoId: id, currency: 'ARS', scope: 'Cambio de cuerito', totalMinor: '100001', lines: [{ lineId: 'l1', description: 'mano de obra', quantity: 1, unitAmountMinor: '100001', totalAmountMinor: '100001' }], idempotencyKey: k('b'), requestHash: 'h', createdAt: at() })
        await work.decideBudget({ ...customer, trabajoId: id, presupuestoId: budget.budget.presupuestoId, presupuestoVersion: budget.budget.version, decision: 'accepted', idempotencyKey: k('d'), requestHash: 'h', createdAt: at() })
        const cur = async () => (await work.getWork(provider, id)).work
        const step = async (op) => { const w = await cur(); return work[op]({ ...provider, trabajoId: id, expectedVersion: w.version, idempotencyKey: k(op + seq), requestHash: 'h' + seq, createdAt: at() }) }
        const startBlocked = await codeOf(() => step('startWork'))
        // Double click + two tabs: four concurrent checkouts of the deposit.
        const senaRuns = await Promise.allSettled([1, 1, 2, 3].map((n) => fin.iniciarCheckout({ ...customer, trabajoId: id, idempotencyKey: k('sena-' + n) })))
        const senaOk = senaRuns.filter((r) => r.status === 'fulfilled').map((r) => r.value)
        const senaPaymentIds = [...new Set(senaOk.map((r) => r.payment.paymentId))]
        const notify = (paymentId, status, amount, eventId) => { const raw = JSON.stringify({ id: eventId, data: { id: 'fake-mp-' + paymentId, external_reference: paymentId, status, currency_id: 'ARS', transaction_amount: amount, date_last_updated: at() } }); return fin.ingerirEventoProveedor({ rawBody: raw, signature: proveedor.firmar(raw), receivedAt: at() }) }
        const senaEvents = await Promise.allSettled([notify(senaPaymentIds[0], 'approved', '500.01', k('evt-sena')), notify(senaPaymentIds[0], 'approved', '500.01', k('evt-sena'))])
        await step('startWork')
        await step('completeWork')
        const finished = await cur()
        const saldoRuns = await Promise.allSettled([1, 2].map((n) => fin.iniciarCheckout({ ...customer, trabajoId: id, idempotencyKey: k('saldo-' + n) })))
        const saldoOk = saldoRuns.filter((r) => r.status === 'fulfilled').map((r) => r.value)
        const saldoPaymentIds = [...new Set(saldoOk.map((r) => r.payment.paymentId))]
        const saldoEvents = await Promise.allSettled([notify(saldoPaymentIds[0], 'approved', '500.00', k('evt-saldo')), notify(saldoPaymentIds[0], 'approved', '500.00', k('evt-saldo')), notify(saldoPaymentIds[0], 'approved', '500.00', k('evt-saldo'))])
        const done = await cur()
        const obligations = await prisma.obligacionPagoServicio.findMany({ where: { trabajoId: id }, orderBy: { tramo: 'asc' } })
        const intents = await prisma.intencionPago.count({ where: { tenantId: T('cli') } })
        const completions = await prisma.transicionTrabajo.count({ where: { trabajoId: id, estadoNuevo: 'completed' } })
        const snapshots = await prisma.instantaneaComision.findMany({ where: { tenantId: T('cli') } })
        const row = await prisma.trabajo.findFirst({ where: { trabajoId: id } })
        console.log(JSON.stringify({ startBlocked, senaFulfilled: senaOk.length, senaRejected: senaRuns.filter((r) => r.status === 'rejected').map((r) => r.reason?.code), senaPaymentIds: senaPaymentIds.length, senaEvents: senaEvents.map((r) => r.status === 'fulfilled' ? r.value.status + ':' + (r.value.result ?? '') : 'rejected:' + r.reason?.code), finished: [finished.status, Boolean(finished.finishedAt)], saldoPaymentIds: saldoPaymentIds.length, saldoEvents: saldoEvents.map((r) => r.status === 'fulfilled' ? r.value.status + ':' + (r.value.result ?? '') : 'rejected:' + r.reason?.code), done: done.status, obligations: obligations.map((o) => [o.tramo, String(o.monto), o.estado, o.publicacionId]), intents, completions, commissions: snapshots.map((s) => String(s.montoComision)).sort(), terminadoEn: Boolean(row.terminadoEn) }))
      } finally {
        await prisma.$disconnect()
      }
    `)
    assert.equal(result.startBlocked, 'DEPOSIT_REQUIRED')
    // Concurrent checkouts converge on ONE deposit payment (retries may report a conflict).
    assert.ok(result.senaFulfilled >= 1)
    for (const code of result.senaRejected) assert.ok(['CONCURRENT_MODIFICATION', 'IN_PROGRESS', 'IDEMPOTENCY_CONFLICT'].includes(code), code)
    assert.equal(result.senaPaymentIds, 1)
    assert.equal(result.senaEvents.filter((e) => e === 'recorded:applied').length, 1)
    assert.deepEqual(result.finished, ['in_progress', true])
    assert.equal(result.saldoPaymentIds, 1)
    assert.equal(result.saldoEvents.filter((e) => e === 'recorded:applied').length, 1)
    assert.equal(result.done, 'completed')
    assert.deepEqual(result.obligations, [['saldo', '50000', 'paid', null], ['sena', '50001', 'paid', null]])
    assert.equal(result.intents, 2)
    assert.equal(result.completions, 1)
    assert.deepEqual(result.commissions, ['5000', '5000'])
    assert.equal(result.terminadoEn, true)
  }
)
