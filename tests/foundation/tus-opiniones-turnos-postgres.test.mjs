import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// OPINIONES-TURNOS-01. A turno that was really attended, closed and fully paid reaches the state a
// review needs; nothing else does. On a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL): the real closing, finance, work and ratings services, wired as the
// composition wires them.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

test('OPINIONES de turnos PostgreSQL: deposit, service, closing confirmed, balance paid -> the work is completed and its client rates it once; paid in total and confirmed (by the client or by the window) -> the same; with only the deposit, before the closing, or cancelled -> not completed and not rateable; the money is released exactly as before', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${turnosPagosSetup(url)}
    const { AlmacenCalificacionesPrisma, ServicioCalificaciones } = await import('./apps/api/src/tus/reputacion/calificaciones.ts')
    const out = {}
    try {
      const store = new PrismaTrabajoStore(prisma)
      const calificaciones = new ServicioCalificaciones({ almacen: new AlmacenCalificacionesPrisma(prisma), trabajos: { buscarAccesible: (i) => store.findAccessible(i) } })
      const p = await prestador('opina', 'Opiniones De Turnos', [['Masaje', 30000]])
      let pagos = 5000000 + Math.floor(Math.random() * 900000) * 10
      const aprobar = async (preferencia) => { pagos += 1; mpPayment(String(pagos), preferencia); return ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-op-' + pagos })) }
      const checkoutDe = async (t, cuenta, tramo) => {
        let checkout = null
        for (let i = 0; !checkout; i += 1) { try { checkout = await turnos.pagarTurno({ clienteId: cuenta.id, reservaId: t.pedido.id, correlationId: 'c', tramo }) } catch (e) { if (e?.code !== 'IN_PROGRESS' || i >= 40) throw e; await new Promise((resolve) => setTimeout(resolve, 250)) } }
        const obligacion = await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: t.trabajoId, tramo } })
        const pago = await prisma.intencionPago.findFirst({ where: { obligacionId: obligacion.obligacionId }, orderBy: { fechaCreacion: 'desc' } })
        return mp.preferences.find((item) => item.body.external_reference === pago.pagoId)
      }
      const ctxCliente = (cuenta) => ({ tenantId: cuenta.tenantId, actorId: cuenta.id, correlationId: 'c-cli' })
      const estado = async (t) => { const w = await prisma.trabajo.findFirst({ where: { trabajoId: t.trabajoId } }); const res = await prisma.reserva.findUnique({ where: { id: t.pedido.id } }); return [w.estado, res.estado] }
      const opinar = (cuenta, t, score = 5) => codeOf(() => calificaciones.calificar({ tenantId: cuenta.tenantId, cuentaId: cuenta.id, trabajoId: t.trabajoId, score, comment: 'Muy buena atención' }))
      const dinero = async (t) => (await prisma.liquidacionServicio.findMany({ where: { trabajoId: t.trabajoId }, orderBy: { obligacionId: 'asc' } })).map((l) => [l.estado, l.liberadaEn !== null])
      const EVIDENCIA = 'Sesión de masaje realizada completa, 60 minutos.'
      const ana = await cliente('ana'); const beto = await cliente('beto'); const caro = await cliente('caro'); const dani = await cliente('dani'); const eva = await cliente('eva')

      // ---- A. Deposit -> service -> closing confirmed -> balance: completed, rateable once.
      const a1 = await turnoConCheckout(p, ana, 0, '10:00', 'Masaje'); await aprobar(a1.preferencia)
      // ---- B. Paid in TOTAL in advance, confirmed by the client.
      const b1 = await turnoConCheckout(p, beto, 0, '11:00', 'Masaje'); await aprobar(await checkoutDe(b1, beto, 'total'))
      // ---- C. Paid in total, confirmed by the 72 hour window.
      const c1 = await turnoConCheckout(p, caro, 0, '12:00', 'Masaje'); await aprobar(await checkoutDe(c1, caro, 'total'))
      // ---- D. Only the deposit: confirmed but not fully paid.
      const d1 = await turnoConCheckout(p, dani, 0, '13:00', 'Masaje'); await aprobar(d1.preferencia)
      // ---- E. Confirmed and then cancelled by the client before it happens.
      const e1 = await turnoConCheckout(p, eva, 0, '14:00', 'Masaje'); await aprobar(e1.preferencia)
      await turnos.cancelarTurnoCliente({ clienteId: eva.id, reservaId: e1.pedido.id, confirmaPerdida: true })
      out.antes = { estados: [await estado(a1), await estado(b1)], opinar: [await opinar(ana, a1), await opinar(beto, b1)] }

      adelantar(9 * 24 * 3600_000)
      for (const t of [a1, b1, c1, d1]) await cierre.finalizar(p.ctx, t.trabajoId, { evidence: EVIDENCIA })
      out.finalizado = { estados: [await estado(a1), await estado(b1)], opinar: [await opinar(ana, a1), await opinar(beto, b1)] }

      await cierre.confirmar(ctxCliente(ana), a1.trabajoId)
      out.aSoloSena = [await estado(a1), await opinar(ana, a1)]
      await aprobar(await checkoutDe(a1, ana, 'saldo'))
      out.aCompleto = [await estado(a1), await dinero(a1), await opinar(beto, a1), await opinar(ana, a1, 9), await opinar(ana, a1), await opinar(ana, a1)]

      const confirmadoB = await cierre.confirmar(ctxCliente(beto), b1.trabajoId)
      out.bCompleto = [confirmadoB.pagos, await estado(b1), await dinero(b1), await opinar(beto, b1)]
      // Confirming again changes nothing.
      out.bRepite = [await codeOf(() => cierre.confirmar(ctxCliente(beto), b1.trabajoId)), await estado(b1), (await prisma.transicionTrabajo.count({ where: { trabajoId: b1.trabajoId, estadoNuevo: 'completed' } }))]

      await cierre.confirmar(ctxCliente(dani), d1.trabajoId)
      out.dSoloSena = [await estado(d1), await dinero(d1), await opinar(dani, d1)]

      adelantar(80 * 3600_000)
      const vencidos = await cierre.procesarVencidos()
      out.cPorVentana = [vencidos.confirmados.includes(c1.trabajoId), await estado(c1), await dinero(c1), await opinar(caro, c1)]

      out.eCancelado = [(await estado(e1))[0] !== 'completed', (await estado(e1))[1].startsWith('cancelled'), await opinar(eva, e1)]
      out.opiniones = (await prisma.calificacionTrabajo.findMany({ where: { prestadorTenantId: p.tenantId }, orderBy: { fechaCreacion: 'asc' } })).map((x) => [x.puntuacion, x.trabajoId === a1.trabajoId ? 'a' : x.trabajoId === b1.trabajoId ? 'b' : x.trabajoId === c1.trabajoId ? 'c' : '?'])
      out.transiciones = (await prisma.transicionTrabajo.findMany({ where: { trabajoId: a1.trabajoId }, orderBy: { version: 'asc' } })).map((x) => [x.estadoAnterior, x.estadoNuevo, x.motivo])
      out.saldo = (await saldo(p)).disponible
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.antes, { estados: [['accepted', 'confirmed'], ['accepted', 'confirmed']], opinar: ['WORK_NOT_COMPLETED', 'WORK_NOT_COMPLETED'] }, 'a confirmed turno that did not happen yet cannot be rated')
  assert.deepEqual(r.finalizado.opinar, ['WORK_NOT_COMPLETED', 'WORK_NOT_COMPLETED'], 'finished by the provider but not confirmed: not yet')
  assert.deepEqual(r.aSoloSena, [['accepted', 'completed'], 'WORK_NOT_COMPLETED'], 'confirmed with the balance still owed: the work is not completed')
  assert.deepEqual(r.aCompleto, [['completed', 'completed'], [['eligible', true], ['eligible', true]], 'NOT_FOUND', 'INVALID_SCORE', 'none', 'ALREADY_RATED'], 'the balance paid completes the work; only its client rates it (for anybody else it does not exist), once; deposit and balance are released')
  assert.deepEqual(r.bCompleto, [{ released: 1, pending: null }, ['completed', 'completed'], [['eligible', true]], 'none'], 'paid in total: the confirmed closing completes the work and releases the money')
  assert.deepEqual(r.bRepite.slice(1), [['completed', 'completed'], 1], 'confirming twice completes once')
  assert.deepEqual(r.dSoloSena, [['accepted', 'completed'], [['held', false]], 'WORK_NOT_COMPLETED'], 'only the deposit paid: nothing released, not rateable')
  assert.deepEqual(r.cPorVentana, [true, ['completed', 'completed'], [['eligible', true]], 'none'], 'the 72 hour window confirms and completes a fully paid turno')
  assert.deepEqual(r.eCancelado, [true, true, r.eCancelado[2]])
  assert.ok(['WORK_CANCELLED', 'WORK_NOT_COMPLETED'].includes(r.eCancelado[2]), `a cancelled turno cannot be rated (${r.eCancelado[2]})`)
  assert.deepEqual(r.opiniones, [[5, 'a'], [5, 'b'], [5, 'c']])
  assert.deepEqual(r.transiciones.at(-1).slice(0, 2), ['accepted', 'completed'], 'the work of a turno goes from accepted to completed, recorded as a transition')
  assert.equal(r.transiciones.at(-1)[2], 'work.completed_after_final_payment')
})

test('OPINIONES de turnos, código: only the work of a turno is completed from accepted, and only through the path of the confirmed, fully paid closing; a rating still needs a completed work', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const work = read('apps/api/src/tus/work/index.ts')
  const metodo = /async completarPorPagoFinal\([\s\S]*?\n  \}\n/u.exec(work)[0]
  assert.match(metodo, /const turnoCerrado = work\.origin === 'turno' && work\.status === ESTADOS_TRABAJO\.ACEPTADO\n\s+if \(work\.status !== ESTADOS_TRABAJO\.EN_PROGRESO && !turnoCerrado\) return 'not_in_progress'/u)
  // Its two callers: the confirmed closing when everything is paid, and the approved balance.
  const composicion = read('apps/api/src/tus/composition/index.ts')
  assert.match(composicion, /completarSiPagado: async \(\{ trabajo, correlationId, at \}\) => \{\n\s+if \(!\(await serviceFinance\.estadoEconomico\(\{ tenantId: trabajo\.tenantId, trabajoId: trabajo\.trabajoId \}\)\)\.fullyPaid\) return false/u)
  assert.match(read('apps/api/src/tus/finance/servicios/servicio.ts'), /if \(obligation\.part === 'saldo' && repositories\.cierreTrabajo\) \{\n\s+const closed = await repositories\.cierreTrabajo\.completarPorPagoFinal\(/u)
  const calificaciones = read('apps/api/src/tus/reputacion/calificaciones.ts')
  assert.match(calificaciones, /if \(work\.status !== 'completed'\) throw new ErrorCalificacion\(409, 'WORK_NOT_COMPLETED'/u)
})
