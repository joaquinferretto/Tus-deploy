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
  // The checkout of another part of the same turno ('total' instead of the deposit, or its balance).
  async function checkoutDe(t, cuenta, tramo) {
    let checkout = null
    for (let i = 0; !checkout; i += 1) {
      try { checkout = await turnos.pagarTurno({ clienteId: cuenta.id, reservaId: t.pedido.id, correlationId: 'c', tramo }) } catch (e) { if (e?.code !== 'IN_PROGRESS' || i >= 40) throw e; await new Promise((resolve) => setTimeout(resolve, 250)) }
    }
    const obligacion = await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: t.trabajoId, tramo } })
    const pago = await prisma.intencionPago.findFirst({ where: { obligacionId: obligacion.obligacionId }, orderBy: { fechaCreacion: 'desc' } })
    return { checkout, obligacion, pago, preferencia: mp.preferences.find((item) => item.body.external_reference === pago.pagoId) }
  }
  const aprobar = async (preferencia) => { pagos += 1; mpPayment(String(pagos), preferencia); return ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-n-' + pagos })) }
  const tramos = async (t) => (await prisma.obligacionPagoServicio.findMany({ where: { trabajoId: t.trabajoId }, orderBy: { tramo: 'asc' } })).map((o) => [o.tramo, o.estado, String(o.monto)])
  const liquidaciones = async (t) => (await prisma.liquidacionServicio.findMany({ where: { trabajoId: t.trabajoId }, orderBy: { obligacionId: 'asc' } })).map((l) => [l.estado, l.liberadaEn !== null, String(l.montoComision)])
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

// PAGOS-MODALIDAD-01 for turnos. The balance is the price minus what was paid, payable only after
// the turno was delivered and its closing confirmed; everything is released together when the
// total is covered. The total at once needs no balance.
test('MODALIDAD turnos PostgreSQL seña + saldo: the balance is refused until the turno is delivered and confirmed; then its checkout exists once, its approval (and only it) covers the total and releases deposit and balance together; the provider can withdraw; nothing more can be charged', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('saldo', 'Saldo ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const t = await turnoPagado(p, ana, 0, '10:00')
      out.conSena = [await tramos(t), await liquidaciones(t), (await saldo(p)).disponible]
      // The balance cannot be paid before the service, nor before the closing is confirmed.
      out.saldoAntes = [await codeOf(() => turnos.pagarTurno({ clienteId: ana.id, reservaId: t.pedido.id, correlationId: 'c', tramo: 'saldo' })), await codeOf(() => turnos.pagarTurno({ clienteId: ana.id, reservaId: t.pedido.id, correlationId: 'c', tramo: 'total' }))]
      adelantar(9 * 24 * HORA)
      await cierre.finalizar(p.ctx, t.trabajoId, { evidence: EVIDENCIA })
      out.saldoSinConfirmar = await codeOf(() => turnos.pagarTurno({ clienteId: ana.id, reservaId: t.pedido.id, correlationId: 'c', tramo: 'saldo' }))
      const confirmado = await cierre.confirmar(ctxCliente(ana), t.trabajoId)
      out.confirmado = [confirmado.pagos, await tramos(t), await liquidaciones(t)]
      // The second checkout: the balance, computed from what is left.
      const s1 = await checkoutDe(t, ana, 'saldo')
      const s2 = await checkoutDe(t, ana, 'saldo')
      out.checkoutSaldo = [s1.checkout.monto, s1.checkout.checkoutUrl === s2.checkout.checkoutUrl, s1.pago.pagoId === s2.pago.pagoId, s1.pago.modoCobro, s1.preferencia.body.items[0].unit_price, await tramos(t), (await saldo(p)).disponible]
      const aprobado = await aprobar(s1.preferencia)
      const repetido = await ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-n-' + pagos }))
      out.saldoAprobado = [aprobado.result, repetido.status, await tramos(t), await liquidaciones(t), await filas(p), await estadoTurno(t)]
      out.economia = await fin.estadoEconomico({ tenantId: ana.tenantId, trabajoId: t.trabajoId }).then((e) => [String(e.totalMinor), String(e.paidMinor), String(e.pendingMinor), e.fullyPaid, e.modality])
      out.nadaMas = [await codeOf(() => turnos.pagarTurno({ clienteId: ana.id, reservaId: t.pedido.id, correlationId: 'c', tramo: 'saldo' })), await codeOf(() => turnos.pagarTurno({ clienteId: ana.id, reservaId: t.pedido.id, correlationId: 'c', tramo: 'total' })), await prisma.obligacionPagoServicio.count({ where: { trabajoId: t.trabajoId } })]
      // The provider links its Mercado Pago account and withdraws what was released.
      await conectarMercadoPago(p, '881')
      const disponible = await saldo(p)
      const retiro = await ganancias.solicitar(p.ctx, run + '-retiro-saldo', { destinationEmail: 'prestador@example.test' })
      out.retiro = [disponible.disponible, disponible.puede, retiro.status, retiro.payout.amountMinor, (await saldo(p)).disponible]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.conSena, [[['sena', 'paid', '1500000']], [['held', false, '150000']], '0'])
  assert.deepEqual(r.saldoAntes, ['BALANCE_NOT_AVAILABLE', 'PAYMENT_MODALITY_FIXED'], 'no balance before the service, and the deposit fixed the way of paying')
  assert.equal(r.saldoSinConfirmar, 'BALANCE_NOT_AVAILABLE', 'finished by the provider is not enough: the closing must be confirmed')
  assert.deepEqual(r.confirmado, [{ released: 0, pending: 'not_fully_paid' }, [['sena', 'paid', '1500000']], [['held', false, '150000']]], 'confirmed with the deposit only: nothing released, no balance obligation is invented')
  assert.deepEqual(r.checkoutSaldo, [15000, true, true, 'plataforma', 15000, [['saldo', 'pending_payment', '1500000'], ['sena', 'paid', '1500000']], '0'], 'the balance is the price minus what was paid, collected by TUS, one checkout however many times it is asked')
  assert.deepEqual(r.saldoAprobado, ['applied', 'duplicate', [['saldo', 'paid', '1500000'], ['sena', 'paid', '1500000']], [['eligible', true, '150000'], ['eligible', true, '150000']], [['earning_credit', '1350000'], ['earning_credit', '1350000']], 'completed'], 'the approved balance covers the total: deposit and balance are released together, each commission once')
  assert.deepEqual(r.economia, ['3000000', '3000000', '0', true, 'sena'])
  assert.deepEqual(r.nadaMas, ['ALREADY_PAID', 'ALREADY_PAID', 2], 'nothing above the price can be charged')
  assert.deepEqual(r.retiro, ['2700000', true, 'created', '2700000', '0'], 'after closing and full payment the provider withdraws the net of both payments')
})

test('MODALIDAD turnos PostgreSQL pago total: the client pays the whole price instead of the deposit (switching before paying voids the other); it confirms the turno and stays held; no balance ever exists; the automatic confirmation of a turno paid in total releases it, the one of a turno with only its deposit does not', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('total', 'Total ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      // The checkout of the deposit exists (the acceptance prepared it); the client chooses the total.
      const t = await turnoConCheckout(p, ana, 0, '10:00', 'Masaje')
      const total = await checkoutDe(t, ana, 'total')
      out.elegido = [total.checkout.monto, total.pago.modoCobro, total.preferencia.body.items[0].unit_price, await tramos(t), (await prisma.intencionPago.findMany({ where: { obligacionId: { startsWith: 'obligacion-' + t.trabajoId } }, orderBy: { monto: 'asc' } })).map((i) => [String(i.monto), i.estadoProveedor])]
      // The link of the deposit that was replaced is paid anyway: quarantined, the turno is not confirmed by it.
      pagos += 1
      mpPayment(String(pagos), t.preferencia)
      const anulado = await ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-anulado' }))
      out.pagoDeLaSenaAnulada = [anulado.result, anulado.reason, await estadoTurno(t), await filas(p)]
      const aprobado = await aprobar(total.preferencia)
      out.totalAprobado = [aprobado.result, await estadoTurno(t), await tramos(t), await liquidaciones(t), await filas(p), (await saldo(p)).disponible]
      out.sinSaldo = [await codeOf(() => turnos.pagarTurno({ clienteId: ana.id, reservaId: t.pedido.id, correlationId: 'c', tramo: 'saldo' })), await codeOf(() => turnos.pagarSena({ clienteId: ana.id, reservaId: t.pedido.id, correlationId: 'c' }))]
      // A second turno with only its deposit, to compare the automatic confirmation.
      const soloSena = await turnoPagado(p, ana, 0, '11:00')
      adelantar(9 * 24 * HORA)
      await cierre.finalizar(p.ctx, t.trabajoId, { evidence: EVIDENCIA })
      await cierre.finalizar(p.ctx, soloSena.trabajoId, { evidence: EVIDENCIA })
      out.antesDeConfirmar = [await liquidaciones(t), await codeOf(() => turnos.pagarTurno({ clienteId: ana.id, reservaId: t.pedido.id, correlationId: 'c', tramo: 'saldo' }))]
      adelantar(73 * HORA)
      const corrida = await cierre.procesarVencidos()
      out.autoConfirmacion = [corrida.confirmados.length, await estadoTurno(t), await liquidaciones(t), await tramos(t), await estadoTurno(soloSena), await liquidaciones(soloSena), (await saldo(p)).disponible]
      const otra = await cierre.procesarVencidos()
      out.repetida = [otra.confirmados.length, (await saldo(p)).disponible, await prisma.obligacionPagoServicio.count({ where: { trabajoId: t.trabajoId, tramo: 'saldo' } })]
      await conectarMercadoPago(p, '882')
      const retiro = await ganancias.solicitar(p.ctx, run + '-retiro-total', { destinationEmail: 'prestador@example.test' })
      out.retiro = [retiro.status, retiro.payout.amountMinor]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.elegido, [30000, 'plataforma', 30000, [['sena', 'voided', '1500000'], ['total', 'pending_payment', '3000000']], [['1500000', 'cancelled'], ['3000000', 'pending']]], 'the total replaces the unpaid deposit: one way of paying at a time')
  assert.deepEqual(r.pagoDeLaSenaAnulada, ['quarantined', 'obligation_voided', 'awaiting_payment', []], 'the replaced link confirms nothing and books nothing')
  assert.deepEqual(r.totalAprobado, ['applied', 'confirmed', [['sena', 'voided', '1500000'], ['total', 'paid', '3000000']], [['held', false, '300000']], [['earning_credit', '2700000']], '0'], 'the total confirms the turno; one commission, for the total; paid in advance it is held')
  assert.deepEqual(r.sinSaldo, ['ALREADY_PAID', 'DEPOSIT_NOT_PAYABLE'], 'a turno paid in total has no balance, and its deposit can no longer be paid')
  assert.deepEqual(r.antesDeConfirmar, [[['held', false, '300000']], 'ALREADY_PAID'], 'finished and not confirmed: still held')
  assert.deepEqual(r.autoConfirmacion, [2, 'completed', [['eligible', true, '300000']], [['sena', 'voided', '1500000'], ['total', 'paid', '3000000']], 'completed', [['held', false, '150000']], '2700000'], 'the window confirms both; only the one paid in total is released, and no balance is created for it')
  assert.deepEqual(r.repetida, [0, '2700000', 0])
  assert.deepEqual(r.retiro, ['created', '2700000'])
})

// The same flow through HTTP: the routes a client and a provider really call, and what the turno
// tells them about its money.
const HTTP = `${SETUP}
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { crearRouterTurnos } = await import('./apps/api/src/tus/calendar/turnos-http.ts')
  const { crearRouterCierres } = await import('./apps/api/src/tus/work/cierre-http.ts')
  const app = express()
  app.use(express.json())
  const sesiones = {}
  const sesion = (token, subjectId, tenantId) => { sesiones[token] = { subjectId, sessionId: 's', tenantId, roles: ['owner'], permissions: [], correlationId: 'c-' + token } }
  const sessions = { resolve: async (token) => sesiones[token] ?? null }
  app.use(crearRouterTurnos({ servicio: turnos, sessions }))
  app.use(crearRouterCierres({ cierre, sessions, ordenDeTurno: async ({ reservaId, tenantId }) => (await prisma.trabajo.findFirst({ where: { OR: [{ tenantId }, { prestadorTenantId: tenantId }], reserva: { id: reservaId } }, select: { trabajoId: true } }).catch(() => null))?.trabajoId ?? (await ordenPorReserva(reservaId, tenantId)) }))
  // The order of a turno by the id the client sees (the row id of the reservation).
  async function ordenPorReserva(id, tenantId) {
    const reserva = await prisma.reserva.findFirst({ where: { OR: [{ id }, { reservaId: id }] } })
    if (!reserva) return null
    const orden = await prisma.trabajo.findFirst({ where: { origen: 'turno', reservaTenantId: reserva.tenantId, reservaId: reserva.reservaId, OR: [{ tenantId }, { prestadorTenantId: tenantId }] } })
    return orden?.trabajoId ?? null
  }
  const servidor = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)) })
  const call = async (method, path, token, body) => {
    const response = await fetch('http://127.0.0.1:' + servidor.address().port + path, { method, headers: { 'content-type': 'application/json', 'x-correlation-id': 'c', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const cerrarTodo = async () => { await new Promise((resolve) => servidor.close(resolve)); await cerrar() }
  const turnoDe = async (token, t) => (await call('GET', '/tus/v1/cliente/turnos', token)).body.items.find((item) => item.id === t.pedido.id)
  const checkout = async (token, t, body) => { for (let i = 0; ; i += 1) { const r = await call('POST', '/tus/v1/cliente/turnos/' + t.pedido.id + '/pago/checkout', token, body); if (r.body?.code !== 'IN_PROGRESS' || i >= 40) return r; await new Promise((resolve) => setTimeout(resolve, 250)) } }
  const preferenciaDe = async (t, tramo) => { const o = await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: t.trabajoId, tramo } }); const pago = await prisma.intencionPago.findFirst({ where: { obligacionId: o.obligacionId }, orderBy: { fechaCreacion: 'desc' } }); return mp.preferences.find((item) => item.body.external_reference === pago.pagoId) }
`

test('HTTP turnos: the client chooses deposit or total on one checkout route (only that choice travels in the body); the turno tells its whole financial state; a turno paid in total is never shown as a pending deposit; the provider finishes with evidence, the client confirms or observes, the balance is paid on the same route', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${HTTP}
    const out = {}
    try {
      const p = await prestador('http', 'Http ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const beto = await cliente('beto')
      sesion('tok-ana', ana.id, ana.tenantId); sesion('tok-beto', beto.id, beto.tenantId); sesion('tok-p', 'u-' + p.tenantId, p.tenantId)

      // ---- A. Paid in total.
      const t = await turnoConCheckout(p, ana, 0, '10:00', 'Masaje')
      const antes = await turnoDe('tok-ana', t)
      out.antes = [antes.estado, antes.sena, antes.pago]
      out.rechazos = [
        (await call('POST', '/tus/v1/cliente/turnos/' + t.pedido.id + '/pago/checkout', null, { tramo: 'total' })).status,
        (await checkout('tok-beto', t, { tramo: 'total' })).status,
        (await checkout('tok-ana', t, { tramo: 'total', monto: 1 })).body,
        (await checkout('tok-ana', t, { tramo: 'mitad' })).body.code,
        (await checkout('tok-ana', t, { tramo: 'saldo' })).body.code,
      ]
      const total = await checkout('tok-ana', t, { tramo: 'total' })
      const elegido = await turnoDe('tok-ana', t)
      out.total = [total.status, total.body.tramo, total.body.monto, total.body.checkoutUrl.startsWith('https://') && total.body.checkoutUrl.includes('mercadopago.com'), elegido.sena?.estado, elegido.pago.modalidad, elegido.pago.proximo, elegido.pago.opciones]
      // The client changes its mind and back: the deposit, then the total again.
      const aSena = await checkout('tok-ana', t, { tramo: 'sena' })
      const otraVez = await checkout('tok-ana', t, { tramo: 'total' })
      out.cambio = [aSena.status, aSena.body.monto, otraVez.status, otraVez.body.monto, (await turnoDe('tok-ana', t)).pago.modalidad]
      await aprobar(await preferenciaDe(t, 'total'))
      const pagado = await turnoDe('tok-ana', t)
      out.pagadoEnTotal = [pagado.estado, pagado.sena ?? null, pagado.pago]
      out.yaPagado = [(await checkout('tok-ana', t, { tramo: 'sena' })).body.code, (await checkout('tok-ana', t, { tramo: 'saldo' })).body.code, (await checkout('tok-ana', t, { tramo: 'total' })).body.code]
      // The provider finishes it, the client confirms.
      adelantar(9 * 24 * HORA)
      out.finalizar = [
        (await call('POST', '/tus/v1/prestador/turnos/' + t.pedido.id + '/finalizar', 'tok-ana', { evidence: EVIDENCIA })).status,
        (await call('POST', '/tus/v1/prestador/turnos/' + t.pedido.id + '/finalizar', 'tok-p', { evidence: EVIDENCIA, confirmedAt: 'ahora' })).body.code,
        (await call('POST', '/tus/v1/prestador/turnos/' + t.pedido.id + '/finalizar', 'tok-p', {})).body.code,
      ]
      const fin1 = await call('POST', '/tus/v1/prestador/turnos/' + t.pedido.id + '/finalizar', 'tok-p', { evidence: EVIDENCIA })
      const visto = await turnoDe('tok-ana', t)
      out.finalizado = [fin1.status, fin1.body.status, fin1.body.closing.evidence === EVIDENCIA, visto.pago.cierre.confirmadoEn, visto.pago.cierre.observacionAbierta, visto.pago.fondos]
      out.confirmaAjeno = [(await call('POST', '/tus/v1/cliente/turnos/' + t.pedido.id + '/confirmar', 'tok-beto')).status, (await call('POST', '/tus/v1/cliente/turnos/' + t.pedido.id + '/confirmar', 'tok-p')).status]
      const conf = await call('POST', '/tus/v1/cliente/turnos/' + t.pedido.id + '/confirmar', 'tok-ana')
      const cerrado = await turnoDe('tok-ana', t)
      out.confirmado = [conf.status, conf.body.status, conf.body.payments, cerrado.estado, cerrado.pago.cierre.confirmacionOrigen, cerrado.pago.fondos, cerrado.pago.proximo]

      // ---- B. Deposit, observation, balance.
      const s = await turnoPagado(p, ana, 0, '11:00')
      const conSena = await turnoDe('tok-ana', s)
      out.conSena = [conSena.estado, conSena.sena.estado, conSena.pago.modalidad, conSena.pago.pagado, conSena.pago.saldoPendiente, conSena.pago.proximo, conSena.pago.opciones, conSena.pago.fondos]
      await call('POST', '/tus/v1/prestador/turnos/' + s.pedido.id + '/finalizar', 'tok-p', { evidence: EVIDENCIA })
      const obs = await call('POST', '/tus/v1/cliente/turnos/' + s.pedido.id + '/observar', 'tok-ana', { reason: 'El masaje terminó veinte minutos antes.' })
      const observado = await turnoDe('tok-ana', s)
      out.observado = [obs.status, obs.body.status, observado.pago.cierre.observacionAbierta, observado.pago.cierre.observacionMotivo, (await call('POST', '/tus/v1/cliente/turnos/' + s.pedido.id + '/confirmar', 'tok-ana')).body.code, (await call('POST', '/tus/v1/cliente/turnos/' + s.pedido.id + '/observar', 'tok-ana', { reason: 'corta' })).body.code]
      // The platform sees it and settles it.
      const abiertas = await cierre.observacionesAbiertas()
      out.admin = [abiertas.filter((x) => x.trabajoId === s.trabajoId).map((x) => [x.observationReason, x.evidence === EVIDENCIA]), (await cierre.resolverObservacion(admin, { tenantId: ana.tenantId, trabajoId: s.trabajoId })).pagos, (await cierre.observacionesAbiertas()).some((x) => x.trabajoId === s.trabajoId)]
      const conf2 = await call('POST', '/tus/v1/cliente/turnos/' + s.pedido.id + '/confirmar', 'tok-ana')
      const conSaldo = await turnoDe('tok-ana', s)
      out.saldoHabilitado = [conf2.body.payments, conSaldo.estado, conSaldo.pago.proximo, conSaldo.pago.fondos]
      const saldoCheckout = await checkout('tok-ana', s, { tramo: 'saldo' })
      out.checkoutSaldo = [saldoCheckout.status, saldoCheckout.body.tramo, saldoCheckout.body.monto]
      await aprobar(await preferenciaDe(s, 'saldo'))
      const final = await turnoDe('tok-ana', s)
      out.final = [final.pago.pagado, final.pago.saldoPendiente, final.pago.proximo, final.pago.fondos, final.sena.estado]
      // The provider reads the same state of its turnos.
      const delPrestador = (await call('GET', '/tus/v1/prestador/turnos', 'tok-p')).body.items
      out.prestador = delPrestador.filter((x) => [t.pedido.id, s.pedido.id].includes(x.id)).map((x) => [x.pago.modalidad, x.pago.pagado, x.pago.fondos]).sort()
    } finally { await cerrarTodo() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.antes, ['awaiting_payment', { monto: 15000, moneda: 'ARS', estado: 'pending' }, { moneda: 'ARS', modalidad: 'sena', total: 30000, pagado: 0, saldoPendiente: 30000, proximo: { tramo: 'sena', monto: 15000 }, opciones: ['sena', 'total'], cierre: null, fondos: null }], 'accepted: the deposit is the default, both ways of paying are offered')
  assert.deepEqual(r.rechazos.slice(0, 2), [401, 404], 'no session, and somebody else\'s turno')
  assert.deepEqual([r.rechazos[2].code, r.rechazos[2].fields, r.rechazos[3], r.rechazos[4]], ['UNTRUSTED_PAYMENT_FIELDS', ['monto'], 'INVALID_PARAMS', 'BALANCE_NOT_AVAILABLE'], 'the body carries only the choice; no amount, no unknown part, no balance before the service')
  assert.deepEqual(r.total, [200, 'total', 30000, true, 'pending', 'total', { tramo: 'total', monto: 30000 }, ['sena', 'total']], 'the total is chosen: the next payment is the whole price')
  assert.deepEqual(r.cambio, [200, 15000, 200, 30000, 'total'], 'before paying the client may switch as often as it wants')
  assert.deepEqual(r.pagadoEnTotal, ['confirmed', null, { moneda: 'ARS', modalidad: 'total', total: 30000, pagado: 30000, saldoPendiente: 0, proximo: null, opciones: [], cierre: null, fondos: 'retenidos' }], 'paid in total: confirmed, NO deposit shown, nothing pending, the money held')
  assert.deepEqual(r.yaPagado, ['DEPOSIT_NOT_PAYABLE', 'ALREADY_PAID', 'ALREADY_PAID'])
  assert.deepEqual(r.finalizar, [403, 'UNTRUSTED_FIELDS', 'EVIDENCE_REQUIRED'], 'only the provider finishes it, with evidence and nothing else in the body')
  assert.deepEqual(r.finalizado, [201, 'created', true, null, false, 'retenidos'], 'finished: the client sees it waits for its confirmation, the money still held')
  assert.deepEqual(r.confirmaAjeno, [404, 403])
  assert.deepEqual(r.confirmado, [200, 'confirmed', { released: 1, pending: null }, 'completed', 'cliente', 'liberados', null], 'confirmed and fully paid: released')
  assert.deepEqual(r.conSena, ['confirmed', 'paid', 'sena', 15000, 15000, null, [], 'retenidos'], 'a deposit: half paid, half pending, nothing payable yet, the way of paying fixed')
  assert.deepEqual(r.observado, [200, 'observed', true, 'El masaje terminó veinte minutos antes.', 'OBSERVATION_OPEN', 'REASON_REQUIRED'])
  assert.deepEqual(r.admin, [[['El masaje terminó veinte minutos antes.', true]], { released: 0, pending: 'work_not_completed' }, false], 'the platform lists the open observation with its evidence and settles it')
  assert.deepEqual(r.saldoHabilitado, [{ released: 0, pending: 'not_fully_paid' }, 'completed', { tramo: 'saldo', monto: 15000 }, 'retenidos'], 'confirmed with the deposit only: the balance is what can be paid now, everything still held')
  assert.deepEqual(r.checkoutSaldo, [200, 'saldo', 15000])
  assert.deepEqual(r.final, [30000, 0, null, 'liberados', 'paid'], 'the balance approved: fully paid and released')
  assert.deepEqual(r.prestador, [['sena', 30000, 'liberados'], ['total', 30000, 'liberados']], 'the provider reads the same financial state')
})
