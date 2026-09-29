import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// FASES 11-12: end-to-end service flow and adversarial scenarios on a DISPOSABLE PostgreSQL 16
// database with every migration applied, with the REAL Prisma adapters of requests, atomic match,
// work, finance (deposit/balance), private chat, ratings and the admin views:
//   TUS_E2E_PG_URL=postgresql://user@127.0.0.1:55471/tus_fresh node --test <this file>
// Only the directory lookup and the account lookup are minimal doubles backed by real rows. Never
// point it to a shared or real database: it writes fictitious rows (unique run prefix).
const url = process.env.TUS_E2E_PG_URL ?? process.env.TUS_PAYMENTS_PG_URL

test(
  'FASE11-12 PostgreSQL: client A, providers B and C; concurrent choice, one work, chat, budget, deposit, start, finish, balance, completed, rating, admin; every attack fails safely',
  { skip: !url && 'TUS_E2E_PG_URL not set (disposable PostgreSQL only)', timeout: 240000 },
  () => {
    const r = runTypeScriptScenario(`
      const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
      const { PrismaTrabajoTransaction, PrismaTrabajoStore, PrismaTrabajoOutboxStore } = await import('./apps/api/src/tus/adapters/prisma-work.ts')
      const { TransaccionFinanzasServicioPrisma } = await import('./apps/api/src/tus/adapters/prisma-finanzas-servicios.ts')
      const { ServicioTrabajo } = await import('./apps/api/src/tus/work/index.ts')
      const { ServicioResumenTrabajo, PrismaWorkSummarySource } = await import('./apps/api/src/tus/work/resumen.ts')
      const { AlmacenMensajesTrabajoPrisma, ServicioMensajesTrabajo } = await import('./apps/api/src/tus/work/mensajes.ts')
      const { ServicioFinanzasServicios } = await import('./apps/api/src/tus/finance/servicios/servicio.ts')
      const { ProveedorPagosServicioDeterminista } = await import('./apps/api/src/tus/finance/servicios/pagos.ts')
      const { crearServicioSolicitudes } = await import('./apps/api/src/tus/solicitudes/composicion.ts')
      const { AlmacenCalificacionesPrisma, ServicioCalificaciones } = await import('./apps/api/src/tus/reputacion/calificaciones.ts')
      const { FuenteTrabajosAdminPrisma } = await import('./apps/api/src/tus/admin/trabajos-fuente.ts')
      const { operacionAdminPrisma } = await import('./apps/api/src/tus/directorio/almacenes.ts')
      const { pagosTrabajo } = await import('./apps/api/src/tus/composition/index.ts')
      const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, log: [], errorFormat: 'minimal' })
      const run = 'e' + Date.now().toString(36)
      const T = (s) => run + '-' + s
      const out = {}
      const codeOf = async (op) => { try { const v = await op(); return v && v.ok === false ? v.code : 'ok' } catch (e) { return e?.code ?? String(e).slice(0, 80) } }
      try {
        // ---- real rows: tenants, accounts, providers -------------------------------------------
        const sql = (q) => prisma.$executeRawUnsafe(q)
        for (const who of ['a', 'b', 'c', 'd']) {
          await sql("INSERT INTO \\"TusTenant\\"(id, slug, name, status, \\"createdAt\\", \\"updatedAt\\") VALUES ('" + T(who) + "','" + T(who) + "','" + who + "','active',now(),now())")
          await sql("INSERT INTO \\"User\\"(id, email, \\"normalizedEmail\\", \\"displayName\\", \\"updatedAt\\") VALUES ('" + T('u' + who) + "','" + T(who) + "@t.invalid','" + T(who) + "@t.invalid','" + who.toUpperCase() + "',now())")
          await sql("INSERT INTO \\"Account\\"(id, \\"userId\\", \\"tenantId\\", status, \\"createdAt\\", \\"updatedAt\\", \\"emailVerifiedAt\\") VALUES ('" + T('acc' + who) + "','" + T('u' + who) + "','" + T(who) + "','active',now(),now(),now())")
        }
        for (const who of ['b', 'c'])
          await sql("INSERT INTO prestadores(id, tenant_id, prestador_id, cohorte, ubicacion_id, zona_horaria, roles_personal, version_politica_operativa, estado, fecha_creacion, fecha_actualizacion) VALUES ('" + T('pr' + who) + "','" + T(who) + "','p-" + who + "','repairs-trades','loc','America/Argentina/Buenos_Aires',ARRAY['owner'],'v1','active',now(),now())")
        const account = { a: T('acca'), b: T('accb'), c: T('accc'), d: T('accd') }
        const tenant = { a: T('a'), b: T('b'), c: T('c'), d: T('d') }
        const cuentas = { getAccount: async (id) => { const who = Object.keys(account).find((k) => account[k] === id); return who ? { displayName: who.toUpperCase(), status: 'active', emailVerifiedAt: 1, tenantId: tenant[who] } : undefined } }
        const perfil = (t) => ({ id: 'perfil-' + t, tenantId: t, prestadorId: 'p-' + t.slice(-1), nombrePublico: 'Prestador ' + t.slice(-1).toUpperCase() })
        const destinos = { destino: async () => null, perfilPorTenant: async (t) => ({ id: 'perfil-' + t, nombrePublico: perfil(t).nombrePublico }), perfilesPorTenants: async (ids) => new Map(ids.map((t) => [t, { id: 'perfil-' + t, nombrePublico: perfil(t).nombrePublico }])), postulante: async (t) => ([tenant.b, tenant.c].includes(t) ? { perfil: perfil(t) } : null), perfilPublicoDe: async (t) => ({ id: 'perfil-' + t, nombrePublico: perfil(t).nombrePublico, oficio: 'plomeria', zona: 'Centro' }) }

        // ---- real services on PostgreSQL ------------------------------------------------------
        let now = Date.now()
        const clock = () => now
        const work = new ServicioTrabajo(new PrismaTrabajoTransaction(prisma), clock)
        const proveedor = new ProveedorPagosServicioDeterminista('e2e-secret')
        const politica = { reglaComision: async () => ({ politicaId: null, rateBps: 1000, ruleVersion: 'e2e-10', pspFeeBearer: 'provider' }), disponibilidad: async () => ({ available: true, reason: null }) }
        const fin = new ServicioFinanzasServicios(new TransaccionFinanzasServicioPrisma(prisma, (tx) => ({ completarPorPagoFinal: (i) => work.completarPorPagoFinal({ work: new PrismaTrabajoStore(tx), outbox: new PrismaTrabajoOutboxStore(tx) }, i) })), clock, proveedor, undefined, politica)
        work.conPagos(pagosTrabajo(fin))
        const solicitudes = crearServicioSolicitudes({ cuentas, destinos, prisma, trabajos: work, now: clock })
        const store = new PrismaTrabajoStore(prisma)
        const chat = new ServicioMensajesTrabajo({ mensajes: new AlmacenMensajesTrabajoPrisma(prisma), trabajos: { buscarAccesible: (i) => store.findAccessible(i) } })
        const calificaciones = new ServicioCalificaciones({ almacen: new AlmacenCalificacionesPrisma(prisma), trabajos: { buscarAccesible: (i) => store.findAccessible(i) } })
        const resumen = new ServicioResumenTrabajo(store, new PrismaWorkSummarySource(prisma), clock, fin, calificaciones)
        const ctx = (who) => ({ tenantId: tenant[who], actorId: account[who], correlationId: 'c-' + who })
        let seq = 0
        const at = () => new Date(now + (++seq) * 1000).toISOString()
        const act = async (who, op, id, extra = {}) => { const w = (await work.getWork(ctx(who), id)).work; return work[op]({ ...ctx(who), trabajoId: id, expectedVersion: w.version, idempotencyKey: T(op + (++seq)), requestHash: 'h', createdAt: at(), ...extra }) }

        // ---- 1. A publishes, B and C apply ----------------------------------------------------
        const pub = await solicitudes.publicar(account.a, { category: 'plomeria', title: 'Pierde agua la canilla de la cocina', description: 'Gotea todo el dia.', zone: 'Centro', budgetMax: 25000, urgency: 'hoy_manana' })
        out.publish = pub.ok ? 'ok' : pub.code + ':' + JSON.stringify(pub.fields ?? null)
        const solicitudId = pub.solicitud.id
        const pb = await solicitudes.postular({ tenantId: tenant.b, cuentaId: account.b }, solicitudId, { message: 'Voy hoy a la tarde.' })
        const pc = await solicitudes.postular({ tenantId: tenant.c, cuentaId: account.c }, solicitudId, {})
        out.applied = [pb.ok, pc.ok]
        // ---- 2. A chooses B and C at the same time + double click + retry --------------------
        const race = await Promise.allSettled([
          solicitudes.elegirPostulante(account.a, solicitudId, pb.postulacion.id),
          solicitudes.elegirPostulante(account.a, solicitudId, pc.postulacion.id),
          solicitudes.elegirPostulante(account.a, solicitudId, pb.postulacion.id),
        ])
        out.race = race.map((x) => x.status === 'fulfilled' ? (x.value.ok ? 'ok' : x.value.code) : 'throw:' + (x.reason?.code ?? '')).sort()
        const retry = await solicitudes.elegirPostulante(account.a, solicitudId, pb.postulacion.id)
        const winner = (await prisma.postulacionSolicitud.findMany({ where: { solicitudId } })).map((p) => [p.prestadorTenantId === tenant.b ? 'B' : 'C', p.estado]).sort()
        out.applications = winner
        const works = await prisma.trabajo.findMany({ where: { solicitudId } })
        out.works = works.length
        const id = works[0].trabajoId
        const chosen = works[0].prestadorTenantId === tenant.b ? 'b' : 'c'
        const other = chosen === 'b' ? 'c' : 'b'
        out.retry = { chosen, result: retry.ok ? (retry.workId === id && retry.replay ? 'same-work-replay' : 'other:' + retry.workId) : retry.code }
        // ---- 3. Access: the other provider and a third client see nothing ---------------------
        out.otherProviderReads = await codeOf(() => work.getWork(ctx(other), id))
        out.thirdClientSummary = await codeOf(() => resumen.obtener(tenant.d, id, ['tus:checkout']))
        out.otherProviderChat = await codeOf(() => chat.enviar(ctx(other), id, { text: 'hola', clientMessageId: T('m-x') }))
        out.thirdClientChat = await codeOf(() => chat.listar(ctx('d'), id))
        out.cancelMatchedRequest = await codeOf(() => solicitudes.cancelar(account.a, solicitudId))
        // ---- 4. Chat A <-> chosen provider (contact data allowed) ----------------------------
        await chat.enviar(ctx('a'), id, { text: 'Mi WhatsApp es 379 4000000', clientMessageId: T('m1') })
        await chat.enviar(ctx(chosen), id, { text: 'Perfecto, paso a las 17', clientMessageId: T('m2') })
        await chat.enviar(ctx(chosen), id, { text: 'Perfecto, paso a las 17', clientMessageId: T('m2') })
        out.messages = (await chat.listar(ctx('a'), id)).items.length
        // ---- 5. Budget and acceptance --------------------------------------------------------
        const budget = await work.createBudget({ ...ctx(chosen), trabajoId: id, currency: 'ARS', scope: 'Cambio de cuerito y sellado', totalMinor: '100001', lines: [{ lineId: 'l1', description: 'mano de obra', quantity: 1, unitAmountMinor: '100001', totalAmountMinor: '100001' }], idempotencyKey: T('budget'), requestHash: 'h', createdAt: at() })
        out.otherClientDecides = await codeOf(() => work.decideBudget({ ...ctx('d'), trabajoId: id, presupuestoId: budget.budget.presupuestoId, presupuestoVersion: budget.budget.version, decision: 'accepted', idempotencyKey: T('dd'), requestHash: 'h', createdAt: at() }))
        await work.decideBudget({ ...ctx('a'), trabajoId: id, presupuestoId: budget.budget.presupuestoId, presupuestoVersion: budget.budget.version, decision: 'accepted', idempotencyKey: T('decide'), requestHash: 'h', createdAt: at() })
        // ---- 6. Deposit: attacks, then the real payment -------------------------------------
        out.startBeforeDeposit = await codeOf(() => act(chosen, 'startWork', id))
        out.providerCheckout = await codeOf(() => fin.iniciarCheckout({ ...ctx(chosen), trabajoId: id, idempotencyKey: T('pk') }))
        out.thirdCheckout = await codeOf(() => fin.iniciarCheckout({ ...ctx('d'), trabajoId: id, idempotencyKey: T('dk') }))
        const senaRuns = await Promise.allSettled([T('s1'), T('s1'), T('s2')].map((key) => fin.iniciarCheckout({ ...ctx('a'), trabajoId: id, idempotencyKey: key })))
        const sena = senaRuns.find((x) => x.status === 'fulfilled').value
        out.senaPayments = new Set(senaRuns.filter((x) => x.status === 'fulfilled').map((x) => x.value.payment.paymentId)).size
        out.senaAmount = sena.payment.amountMinor
        let ev = 0
        const notify = (paymentId, amount, extra = {}) => { const raw = JSON.stringify({ id: extra.eventId ?? T('evt' + (++ev)), data: { id: 'fake-mp-' + paymentId, external_reference: paymentId, status: 'approved', currency_id: extra.currency ?? 'ARS', transaction_amount: amount, date_last_updated: at() } }); return fin.ingerirEventoProveedor({ rawBody: raw, signature: extra.signature ?? proveedor.firmar(raw), receivedAt: at() }) }
        out.forged = (await notify(sena.payment.paymentId, '500.01', { signature: 'sha256=00' })).status
        out.wrongAmount = (await notify(sena.payment.paymentId, '1.00')).result
        out.wrongCurrency = (await notify(sena.payment.paymentId, '500.01', { currency: 'USD' })).result
        out.unknownPayment = (await notify(T('no-existe'), '500.01')).status
        out.stillNotStarted = await codeOf(() => act(chosen, 'startWork', id))
        const senaEvents = await Promise.allSettled([notify(sena.payment.paymentId, '500.01', { eventId: T('evt-sena') }), notify(sena.payment.paymentId, '500.01', { eventId: T('evt-sena') })])
        out.senaApplied = senaEvents.filter((x) => x.status === 'fulfilled' && x.value.status === 'recorded' && x.value.result === 'applied').length
        // ---- 7. Start, cancel attempts, finish -------------------------------------------------
        await act(chosen, 'startWork', id)
        out.clientCancelStarted = await codeOf(() => act('a', 'cancelWork', id, { reason: 'me arrepentí' }))
        out.providerCancelPaid = await codeOf(() => act(chosen, 'cancelWork', id, { reason: 'no puedo' }))
        out.rateBeforeCompleted = await codeOf(() => calificaciones.calificar({ tenantId: tenant.a, cuentaId: account.a, trabajoId: id, score: 5 }))
        await act(chosen, 'completeWork', id)
        out.afterFinish = (await work.getWork(ctx('a'), id)).work.status
        // ---- 8. Balance, parallel duplicate approvals ----------------------------------------
        const saldoRuns = await Promise.allSettled([T('b1'), T('b2')].map((key) => fin.iniciarCheckout({ ...ctx('a'), trabajoId: id, idempotencyKey: key })))
        const saldo = saldoRuns.find((x) => x.status === 'fulfilled').value
        out.saldoPayments = new Set(saldoRuns.filter((x) => x.status === 'fulfilled').map((x) => x.value.payment.paymentId)).size
        out.saldoAmount = saldo.payment.amountMinor
        const saldoEvents = await Promise.allSettled([1, 2, 3].map(() => notify(saldo.payment.paymentId, '500.00', { eventId: T('evt-saldo') })))
        out.saldoApplied = saldoEvents.filter((x) => x.status === 'fulfilled' && x.value.status === 'recorded' && x.value.result === 'applied').length
        out.final = (await work.getWork(ctx('a'), id)).work.status
        out.thirdPayment = await codeOf(() => fin.iniciarCheckout({ ...ctx('a'), trabajoId: id, idempotencyKey: T('b3') }))
        // ---- 9. Ratings -----------------------------------------------------------------------
        out.providerRates = await codeOf(() => calificaciones.calificar({ tenantId: tenant[chosen], cuentaId: account[chosen], trabajoId: id, score: 5 }))
        out.thirdRates = await codeOf(() => calificaciones.calificar({ tenantId: tenant.d, cuentaId: account.d, trabajoId: id, score: 1 }))
        const rates = await Promise.allSettled([5, 4].map((score) => calificaciones.calificar({ tenantId: tenant.a, cuentaId: account.a, trabajoId: id, score, comment: 'Excelente' })))
        out.rates = rates.map((x) => x.status === 'fulfilled' ? 'ok' : x.reason?.code).sort()
        const summary = await resumen.obtener(tenant.a, id, ['tus:checkout'])
        out.summary = [summary.status, summary.payment?.deposit.status, summary.payment?.balance.status, Boolean(summary.rating), summary.actions.canRate]
        // ---- 10. Admin -------------------------------------------------------------------------
        const admin = new FuenteTrabajosAdminPrisma(prisma)
        const detail = await admin.detalle(id)
        out.admin = { estado: detail.estado, pagos: detail.pagos.map((p) => [p.parte, p.estado]), pagosDetalle: detail.pagosDetalle.length, liquidaciones: detail.liquidaciones.length, calificacion: detail.calificacion, transiciones: detail.transiciones.map((t) => t.a) }
        out.adminLeaks = /379 4000000|fake-mp-|secret|token/iu.test(JSON.stringify(detail))
        out.providerOps = (await operacionAdminPrisma(prisma)([tenant[chosen]])).get(tenant[chosen])
        // ---- 11. Database state ------------------------------------------------------------------
        out.db = {
          solicitud: [await prisma.trabajo.count({ where: { solicitudId } }), (await prisma.solicitudServicio.findFirst({ where: { id: solicitudId }, select: { estadoAsignacion: true } }))?.estadoAsignacion ?? null],
          obligaciones: (await prisma.obligacionPagoServicio.findMany({ where: { trabajoId: id } })).map((o) => [o.tramo, String(o.monto), o.estado]).sort(),
          intentsApproved: await prisma.intencionPago.count({ where: { tenantId: tenant.a, estadoProveedor: 'approved' } }),
          snapshots: (await prisma.instantaneaComision.findMany({ where: { tenantId: tenant.a } })).map((s) => String(s.montoComision)).sort(),
          completions: await prisma.transicionTrabajo.count({ where: { trabajoId: id, estadoNuevo: 'completed' } }),
          ratings: await prisma.calificacionTrabajo.count({ where: { trabajoId: id } }),
          messages: await prisma.mensajeTrabajo.count({ where: { trabajoId: id } }),
        }
        // ---- 12. Concurrent cancellations on another work --------------------------------------
        const pub2 = await solicitudes.publicar(account.a, { category: 'plomeria', title: 'Cambiar el flotante del tanque', description: 'No corta.', zone: 'Centro', budgetMax: 10000, urgency: 'esta_semana' })
        const p2 = await solicitudes.postular({ tenantId: tenant.b, cuentaId: account.b }, pub2.solicitud.id, {})
        const m2 = await solicitudes.elegirPostulante(account.a, pub2.solicitud.id, p2.postulacion.id)
        const w2 = (await work.getWork(ctx('a'), m2.workId)).work
        const cancels = await Promise.allSettled([
          work.cancelWork({ ...ctx('a'), trabajoId: m2.workId, expectedVersion: w2.version, idempotencyKey: T('cx1'), requestHash: 'h', createdAt: at(), reason: 'cliente' }),
          work.cancelWork({ ...ctx('b'), trabajoId: m2.workId, expectedVersion: w2.version, idempotencyKey: T('cx2'), requestHash: 'h', createdAt: at(), reason: 'prestador' }),
        ])
        out.cancels = cancels.map((x) => x.status === 'fulfilled' ? 'ok' : x.reason?.code).sort()
        const w2Final = await prisma.trabajo.findFirst({ where: { trabajoId: m2.workId } })
        out.cancelFinal = [w2Final.estado, w2Final.canceladoPorRol !== null, await prisma.transicionTrabajo.count({ where: { trabajoId: m2.workId, estadoNuevo: 'cancelled' } })]
        out.payCancelled = await codeOf(() => fin.iniciarCheckout({ ...ctx('a'), trabajoId: m2.workId, idempotencyKey: T('pc') }))
        out.rateCancelled = await codeOf(() => calificaciones.calificar({ tenantId: tenant.a, cuentaId: account.a, trabajoId: m2.workId, score: 5 }))
        console.log(JSON.stringify(out))
      } finally {
        await prisma.$disconnect()
      }
    `)
    assert.equal(r.publish, 'ok')
    assert.deepEqual(r.applied, [true, true])
    // Concurrent choice of B and C (plus a double click): exactly one provider, one work.
    assert.equal(r.race.filter((x) => x === 'ok').length >= 1, true)
    assert.equal(r.applications.filter(([, estado]) => estado === 'aceptada').length, 1)
    assert.equal(r.applications.filter(([, estado]) => estado === 'rechazada').length, 1)
    assert.equal(r.works, 1)
    // Retrying the choice of B: the same work when B won; B lost the race otherwise (no second work).
    assert.equal(r.retry.result, r.retry.chosen === 'b' ? 'same-work-replay' : 'NOT_FOUND', JSON.stringify(r.retry))
    assert.equal(r.otherProviderReads, 'NOT_FOUND')
    assert.equal(r.thirdClientSummary, 'NOT_FOUND')
    assert.notEqual(r.otherProviderChat, 'ok')
    assert.notEqual(r.thirdClientChat, 'ok')
    assert.equal(r.cancelMatchedRequest, 'WORK_ACTIVE')
    assert.equal(r.messages, 2)
    assert.notEqual(r.otherClientDecides, 'ok')
    assert.equal(r.startBeforeDeposit, 'DEPOSIT_REQUIRED')
    assert.equal(r.providerCheckout, 'FORBIDDEN')
    assert.ok(['FORBIDDEN', 'NOT_FOUND'].includes(r.thirdCheckout))
    assert.equal(r.senaPayments, 1)
    assert.equal(r.senaAmount, '50001')
    assert.equal(r.forged, 'invalid')
    assert.equal(r.wrongAmount, 'quarantined')
    assert.equal(r.wrongCurrency, 'quarantined')
    assert.equal(r.unknownPayment, 'unmatched')
    assert.equal(r.stillNotStarted, 'DEPOSIT_REQUIRED')
    assert.equal(r.senaApplied, 1)
    assert.equal(r.clientCancelStarted, 'CLIENT_CANCEL_NOT_ALLOWED')
    assert.equal(r.providerCancelPaid, 'PAYMENT_REQUIRES_SUPPORT')
    assert.equal(r.rateBeforeCompleted, 'WORK_NOT_COMPLETED')
    assert.equal(r.afterFinish, 'in_progress')
    assert.equal(r.saldoPayments, 1)
    assert.equal(r.saldoAmount, '50000')
    assert.equal(r.saldoApplied, 1)
    assert.equal(r.final, 'completed')
    assert.equal(r.thirdPayment, 'ALREADY_PAID')
    assert.equal(r.providerRates, 'FORBIDDEN')
    assert.equal(r.thirdRates, 'NOT_FOUND')
    assert.deepEqual(r.rates, ['ALREADY_RATED', 'ok'])
    assert.deepEqual(r.summary, ['completed', 'paid', 'paid', true, false])
    assert.equal(r.admin.estado, 'completed')
    assert.deepEqual(r.admin.pagos, [['sena', 'paid'], ['saldo', 'paid']])
    assert.equal(r.admin.pagosDetalle, 2)
    assert.equal(r.admin.liquidaciones, 2)
    assert.ok(r.admin.calificacion >= 4)
    assert.equal(r.admin.transiciones.at(-1), 'completed')
    assert.equal(r.adminLeaks, false)
    assert.deepEqual(r.providerOps, { mercadoPago: 'not_connected', completados: 1 })
    // The request keeps exactly one work (unique per request).
    assert.equal(r.db.solicitud[0], 1)
    assert.deepEqual(r.db.obligaciones, [['saldo', '50000', 'paid'], ['sena', '50001', 'paid']])
    assert.equal(r.db.intentsApproved, 2)
    assert.deepEqual(r.db.snapshots, ['5000', '5000'])
    assert.equal(r.db.completions, 1)
    assert.equal(r.db.ratings, 1)
    assert.equal(r.db.messages, 2)
    assert.equal(r.cancels.filter((x) => x === 'ok').length, 1)
    assert.ok(r.cancels.every((x) => ['ok', 'VERSION_CONFLICT', 'INVALID_STATE', 'CONCURRENT_MODIFICATION', 'IN_PROGRESS'].includes(x)), r.cancels.join())
    assert.deepEqual(r.cancelFinal, ['cancelled', true, 1])
    assert.equal(r.payCancelled, 'WORK_CANCELLED')
    assert.equal(r.rateCancelled, 'WORK_CANCELLED')
  }
)
