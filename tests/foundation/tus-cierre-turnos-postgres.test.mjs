import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// CIERRE-TRABAJO-01 and PAGOS-RETENCION-01 on a DISPOSABLE PostgreSQL 16 with every migration
// applied (TUS_PERFIL_TURNOS_PG_URL). The real turnos with their deposit, the real payments module
// (offline Mercado Pago at the `fetch` boundary), the real finance, earnings and closing services.
//
// The provider finishes the turno with evidence; the client confirms or observes; with no answer
// TUS confirms when the stored window runs out, unless something blocks it. Confirming never
// releases money by itself: what was paid must cover the final total.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

const SETUP = `${turnosPagosSetup(url)}
  const HORA = 3600_000
  const ctxCliente = (cuenta) => ({ tenantId: cuenta.tenantId, actorId: cuenta.id, correlationId: 'c-cli' })
  // A turno with its deposit approved by the verified notification (collected by TUS).
  // Mercado Pago payment ids are unique for ever: never reuse one across scenarios of this database.
  let pagos = 100000 + Math.floor(Math.random() * 800000) * 10
  async function turnoPagado(p, cuenta, indice, hora) {
    const t = await turnoConCheckout(p, cuenta, indice, hora, 'Masaje')
    pagos += 1
    mpPayment(String(pagos), t.preferencia)
    const aplicado = await ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-n-' + pagos }))
    return { ...t, mp: String(pagos), aplicado: aplicado.result }
  }
  const liquidacion = async (t) => { const fila = await prisma.liquidacionServicio.findFirst({ where: { obligacionId: t.obligacion.obligacionId } }); return [fila.estado, fila.retencionActiva, fila.liberadaEn !== null] }
  const cierreDe = async (t) => { const fila = await prisma.cierreTrabajo.findFirst({ where: { trabajoId: t.trabajoId } }); return fila ? [fila.confirmacionOrigen, fila.confirmadoEn !== null, fila.observadoEn !== null && fila.observacionResueltaEn === null] : null }
  const EVIDENCIA = 'Sesión de masaje realizada completa, 60 minutos.'
`

test('CIERRE turnos PostgreSQL: the provider finishes a delivered turno with evidence; the client confirms, or observes (which blocks everything until it is resolved); a confirmation with only the deposit paid releases nothing; the absence of a balance obligation never counts as paid', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('cierre', 'Cierre ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const beto = await cliente('beto')
      const t = await turnoPagado(p, ana, 0, '10:00')
      out.pagado = [t.aplicado, await estadoTurno(t), await liquidacion(t), (await saldo(p)).disponible, await filas(p)]
      // The turno is next week: it cannot be finished before it starts.
      out.antesDeEmpezar = await codeOf(() => cierre.finalizar(p.ctx, t.trabajoId, { evidence: EVIDENCIA }))
      adelantar(9 * 24 * HORA)
      out.sinEvidencia = [await codeOf(() => cierre.finalizar(p.ctx, t.trabajoId, {})), await codeOf(() => cierre.finalizar(p.ctx, t.trabajoId, { evidence: 'listo' }))]
      out.clienteNoFinaliza = await codeOf(() => cierre.finalizar(ctxCliente(ana), t.trabajoId, { evidence: EVIDENCIA }))
      const fin1 = await cierre.finalizar(p.ctx, t.trabajoId, { evidence: EVIDENCIA })
      const fin2 = await cierre.finalizar(p.ctx, t.trabajoId, { evidence: 'Otra evidencia distinta, más tarde.' })
      out.finalizado = [fin1.status, fin2.status, fin2.cierre.evidence === EVIDENCIA, fin2.cierre.confirmationDueAt === fin1.cierre.confirmationDueAt, Date.parse(fin1.cierre.confirmationDueAt) - Date.parse(fin1.cierre.finishedAt) === VENTANA_CONFIRMACION_MS, await estadoTurno(t)]
      // Only the client of that turno confirms or observes it.
      out.ajenos = [await codeOf(() => cierre.confirmar(ctxCliente(beto), t.trabajoId)), await codeOf(() => cierre.confirmar(p.ctx, t.trabajoId)), await codeOf(() => cierre.observar(p.ctx, t.trabajoId, { reason: 'No corresponde que lo observe el prestador' }))]
      // The client observes: nothing confirms it, neither the client nor the window.
      out.observacionInvalida = await codeOf(() => cierre.observar(ctxCliente(ana), t.trabajoId, { reason: 'mal' }))
      const obs = await cierre.observar(ctxCliente(ana), t.trabajoId, { reason: 'El servicio duró la mitad del tiempo acordado.' })
      out.observado = [obs.status, await cierreDe(t), await codeOf(() => cierre.confirmar(ctxCliente(ana), t.trabajoId))]
      adelantar(80 * HORA)
      const conObservacion = await cierre.procesarVencidos()
      out.vencidoConObservacion = [conObservacion.confirmados.includes(t.trabajoId), await cierreDe(t), await estadoTurno(t), await liquidacion(t)]
      // The platform settles the observation; the client then confirms.
      out.resolver = [(await cierre.resolverObservacion(admin, { tenantId: ana.tenantId, trabajoId: t.trabajoId })).status, await codeOf(() => cierre.resolverObservacion(admin, { tenantId: ana.tenantId, trabajoId: t.trabajoId }))]
      const confirmado = await cierre.confirmar(ctxCliente(ana), t.trabajoId)
      out.confirmado = [confirmado.status, confirmado.pagos, await cierreDe(t), await estadoTurno(t)]
      // The deposit is half of the price. No balance obligation exists: that is NOT "all paid".
      out.soloSena = { obligaciones: (await prisma.obligacionPagoServicio.findMany({ where: { trabajoId: t.trabajoId } })).map((o) => [o.tramo, o.estado, String(o.monto)]), liquidacion: await liquidacion(t), saldo: (await saldo(p)).disponible, puede: (await saldo(p)).puede }
      // Confirming again, and evaluating again, changes nothing.
      const otraVez = await cierre.confirmar(ctxCliente(ana), t.trabajoId)
      const evaluacion = await fin.evaluarCierreEconomico({ tenantId: ana.tenantId, trabajoId: t.trabajoId, correlationId: 'otra' })
      out.repetido = [otraVez.status, otraVez.pagos, evaluacion, await liquidacion(t)]
      out.yaConfirmado = await codeOf(() => cierre.observar(ctxCliente(ana), t.trabajoId, { reason: 'Quiero observarlo después de confirmar.' }))
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.pagado, ['applied', 'confirmed', ['held', true, false], '0', [['earning_credit', '1350000']]], 'the deposit confirms the turno, books the earning and leaves it held')
  assert.equal(r.antesDeEmpezar, 'APPOINTMENT_NOT_STARTED')
  assert.deepEqual(r.sinEvidencia, ['EVIDENCE_REQUIRED', 'EVIDENCE_REQUIRED'], 'a minimum of evidence is required')
  assert.equal(r.clienteNoFinaliza, 'FORBIDDEN')
  assert.deepEqual(r.finalizado, ['created', 'existing', true, true, true, 'confirmed'], 'finishing stores the evidence and a 72 hour window, once: asking again never restarts it')
  assert.deepEqual(r.ajenos, ['NOT_FOUND', 'FORBIDDEN', 'FORBIDDEN'], 'another client does not learn it exists; the provider cannot confirm its own work')
  assert.equal(r.observacionInvalida, 'REASON_REQUIRED')
  assert.deepEqual(r.observado, ['observed', [null, false, true], 'OBSERVATION_OPEN'])
  assert.deepEqual(r.vencidoConObservacion, [false, [null, false, true], 'confirmed', ['held', true, false]], 'an open observation blocks the automatic confirmation and the release')
  assert.deepEqual(r.resolver, ['resolved', 'NO_OPEN_OBSERVATION'])
  assert.deepEqual(r.confirmado, ['confirmed', { released: 0, pending: 'not_fully_paid' }, ['cliente', true, false], 'completed'], 'the client confirms the delivery; with half paid nothing is released')
  assert.deepEqual(r.soloSena, { obligaciones: [['sena', 'paid', '1500000']], liquidacion: ['held', true, false], saldo: '0', puede: false }, 'confirmed with only the deposit: still held and not withdrawable; no missing obligation makes it "paid"')
  assert.deepEqual(r.repetido, ['already_confirmed', { released: 0, pending: 'not_fully_paid' }, { released: 0, pending: 'not_fully_paid' }, ['held', true, false]])
  assert.equal(r.yaConfirmado, 'ALREADY_CONFIRMED')
})

test('CIERRE turnos PostgreSQL automatic confirmation: nothing before the stored window runs out; after it, exactly one confirmation even from concurrent runs; with the balance unpaid it releases nothing; a reversed payment or an open observation is never confirmed automatically', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('auto', 'Auto ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const normal = await turnoPagado(p, ana, 0, '10:00')
      const reembolsado = await turnoPagado(p, ana, 0, '11:00')
      const observado = await turnoPagado(p, ana, 0, '12:00')
      adelantar(9 * 24 * HORA)
      for (const t of [normal, reembolsado, observado]) await cierre.finalizar(p.ctx, t.trabajoId, { evidence: EVIDENCIA })
      // The window is a stored instant.
      const fila = await prisma.cierreTrabajo.findFirst({ where: { trabajoId: normal.trabajoId } })
      out.ventana = [fila.confirmacionVenceEn.getTime() - fila.finalizadoEn.getTime() === VENTANA_CONFIRMACION_MS, fila.confirmadoEn]
      const antes = await cierre.procesarVencidos()
      adelantar(71 * HORA)
      const casi = await cierre.procesarVencidos()
      out.antesDeVencer = [antes.confirmados.length, casi.confirmados.length, await cierreDe(normal)]
      // One payment is refunded, another turno is observed by the client.
      mpPayment(reembolsado.mp, reembolsado.preferencia, { status: 'refunded', date_last_updated: new Date(Date.now() + 60_000).toISOString() })
      out.reembolso = (await ingerir(notification(reembolsado.mp, { userId: '555', notificationId: run + '-reembolso' }))).result
      await cierre.observar(ctxCliente(ana), observado.trabajoId, { reason: 'No se presentó a horario y se fue antes.' })
      adelantar(2 * HORA)
      // Three processes look at the same expired windows at once.
      const corridas = await Promise.all([cierre.procesarVencidos(), cierre.procesarVencidos(), cierre.procesarVencidos()])
      out.concurrente = [corridas.flatMap((x) => x.confirmados).filter((id) => id === normal.trabajoId).length, await cierreDe(normal), await estadoTurno(normal)]
      out.bloqueados = [corridas.some((x) => (x.bloqueados[reembolsado.trabajoId] ?? []).includes('payment_reversed')), await cierreDe(reembolsado), await estadoTurno(reembolsado), await cierreDe(observado), await estadoTurno(observado)]
      // Confirmed by its window with half paid: nothing is released, nothing is withdrawable.
      out.sinLiberar = [await liquidacion(normal), await liquidacion(reembolsado), await liquidacion(observado), (await saldo(p)).disponible, await fin.evaluarCierreEconomico({ tenantId: ana.tenantId, trabajoId: normal.trabajoId, correlationId: 'eval' })]
      // Running it again, any number of times, changes nothing.
      const despues = await cierre.procesarVencidos()
      const otra = await cierre.procesarVencidos()
      out.idempotente = [despues.confirmados.length, otra.confirmados.length, await prisma.cierreTrabajo.count({ where: { confirmacionOrigen: 'automatica', tenantId: ana.tenantId } })]
      // The database refuses an inconsistent closing row, whoever writes it.
      out.restricciones = [
        await sqlError('UPDATE cierres_trabajo SET confirmado_en = now() WHERE trabajo_id = $1', [observado.trabajoId]),
        await sqlError("UPDATE cierres_trabajo SET evidencia = 'x' WHERE trabajo_id = $1", [observado.trabajoId]),
        await sqlError('UPDATE liquidaciones_servicio SET retencion_activa = false, liberada_en = now() WHERE obligacion_id = $1', [normal.obligacion.obligacionId]),
      ]
      out.rls = (await db.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'cierres_trabajo'")).rows[0].relrowsecurity
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.ventana, [true, null], 'the window is persisted with the closing row')
  assert.deepEqual(r.antesDeVencer, [0, 0, [null, false, false]], 'nothing is confirmed before the window runs out')
  assert.equal(r.reembolso, 'applied')
  assert.deepEqual(r.concurrente, [1, ['automatica', true, false], 'completed'], 'concurrent runs confirm the work once')
  assert.deepEqual(r.bloqueados, [true, [null, false, false], 'confirmed', [null, false, true], 'confirmed'], 'a reversed payment and an open observation are never confirmed by the window')
  assert.deepEqual(r.sinLiberar, [['held', true, false], ['reversed', true, false], ['held', true, false], '0', { released: 0, pending: 'not_fully_paid' }], 'automatic confirmation with the balance unpaid releases nothing')
  assert.deepEqual(r.idempotente, [0, 0, 1], 'the automatic confirmation is idempotent')
  assert.deepEqual(r.restricciones, ['ck_cierres_trabajo_confirmacion', 'ck_cierres_trabajo_evidencia', 'ck_liquidaciones_servicio_liberacion'])
  assert.equal(r.rls, true, 'the table is not exposed outside the API')
})
