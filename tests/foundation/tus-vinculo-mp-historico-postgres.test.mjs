import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// COBRO-POR-PLATAFORMA-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). The real turnos, payments module, finance, closing and earnings
// services; Mercado Pago is an offline stand-in at the `fetch` boundary (so this proves the code,
// not a real charge nor a real link). No payout is requested nor sent here.
//
// A provider with NO Mercado Pago linked is paid by its client through the account of TUS, the
// money follows its normal cycle (held, released at the closing, balance of the provider), and
// only THEN the provider links Mercado Pago. Linking must change nothing of what already happened:
// it only enables the destination of a future payout.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

test('VINCULO Mercado Pago después de cobrar PostgreSQL: a provider with no Mercado Pago is paid through the account of TUS and its share reaches its balance; linking Mercado Pago afterwards leaves the payment, its provider reference, the obligation, the work, the turno, the amounts, the frozen commission, the settlement with its release and the balance byte for byte as they were; it only makes a future payout possible, and none is requested or sent', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${turnosPagosSetup(url)}
    const out = {}
    try {
      // The turno is next week: the clock of the closing is moved past it.
      adelantar(60 * 24 * 3600_000)
      const p = await prestador('hist', 'Histórico ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const cuentaMp = async () => (await prisma.cuentaCobroPrestador.findFirst({ where: { prestadorTenantId: p.tenantId } }))?.estado ?? 'not_connected'
      const texto = (filas) => JSON.stringify(filas, (_clave, valor) => (typeof valor === 'bigint' ? valor.toString() : valor))

      // ---- 1-3. No Mercado Pago: the client pays the whole price, TUS collects, the payment is applied.
      out.sinMercadoPago = await cuentaMp()
      const t = await turnoConCheckout(p, ana, 0, '10:00', 'Masaje')
      let checkout = null
      for (let i = 0; !checkout; i += 1) { try { checkout = await turnos.pagarTurno({ clienteId: ana.id, reservaId: t.pedido.id, correlationId: 'c', tramo: 'total' }) } catch (e) { if (e?.code !== 'IN_PROGRESS' || i >= 40) throw e; await new Promise((resolve) => setTimeout(resolve, 250)) } }
      const obligacion = await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: t.trabajoId, tramo: 'total' } })
      const intencion = await prisma.intencionPago.findFirst({ where: { obligacionId: obligacion.obligacionId } })
      const preferencia = mp.preferences.find((item) => item.body.external_reference === intencion.pagoId)
      const numero = '77' + String(Math.floor(Math.random() * 9000000) + 1000000)
      mpPayment(numero, preferencia)
      const aplicado = await ingerir(notification(numero, { userId: '555', notificationId: run + '-hist' }))
      out.cobro = [preferencia.seller, 'marketplace_fee' in preferencia.body, aplicado.result, await estadoTurno(t), (await prisma.obligacionPagoServicio.findFirst({ where: { obligacionId: obligacion.obligacionId } })).estado]
      // ---- 4-5. The normal cycle: held until the closing; released to the balance of the provider.
      const liquidacionAntes = await prisma.liquidacionServicio.findFirst({ where: { obligacionId: obligacion.obligacionId } })
      out.retenido = [liquidacionAntes.retencionActiva, liquidacionAntes.liberadaEn === null, (await saldo(p)).disponible]
      await cierre.finalizar(p.ctx, t.trabajoId, { evidence: 'Servicio prestado completo en el turno acordado.' })
      await cierre.confirmar({ tenantId: ana.tenantId, actorId: ana.id, correlationId: 'c-cli' }, t.trabajoId)
      const liberada = await prisma.liquidacionServicio.findFirst({ where: { obligacionId: obligacion.obligacionId } })
      const saldoAntes = await saldo(p)
      out.liberado = [liberada.liberadaEn !== null, saldoAntes.disponible, saldoAntes.puede, saldoAntes.motivo, await codeOf(() => ganancias.solicitar(p.ctx, 'clave-historico-1', { destinationEmail: 'hist@prestador.test' }))]

      // ---- Everything that already happened, as it is stored (every column of every row).
      const historico = async () => {
        const trabajo = await prisma.trabajo.findMany({ where: { trabajoId: t.trabajoId } })
        const obligaciones = await prisma.obligacionPagoServicio.findMany({ where: { trabajoId: t.trabajoId }, orderBy: { obligacionId: 'asc' } })
        const ids = obligaciones.map((item) => item.obligacionId)
        return {
          reserva: await prisma.reserva.findMany({ where: { id: t.pedido.id } }),
          trabajo,
          cierre: await prisma.cierreTrabajo.findMany({ where: { trabajoId: t.trabajoId } }),
          obligaciones,
          intenciones: await prisma.intencionPago.findMany({ where: { obligacionId: { in: ids } }, orderBy: { pagoId: 'asc' } }),
          comisionDelPago: await prisma.instantaneaComision.findMany({ where: { obligacionId: { in: ids } }, orderBy: { obligacionId: 'asc' } }),
          comisionDelTrabajo: await prisma.comisionTrabajo.findMany({ where: { trabajoId: t.trabajoId } }),
          liquidaciones: await prisma.liquidacionServicio.findMany({ where: { trabajoId: t.trabajoId }, orderBy: { obligacionId: 'asc' } }),
          movimientos: await prisma.movimientoGananciaPrestador.findMany({ where: { prestadorTenantId: p.tenantId }, orderBy: { movimientoId: 'asc' } }),
          solicitudesDeRetiro: await prisma.solicitudLiquidacion.findMany({ where: { prestadorTenantId: p.tenantId } }),
        }
      }
      const antes = await historico()
      out.hayHistoria = [antes.reserva.length, antes.trabajo.length, antes.cierre.length, antes.obligaciones.filter((o) => o.estado === 'paid').length, antes.intenciones.length >= 1, antes.comisionDelPago.length >= 1, antes.comisionDelTrabajo.length, antes.liquidaciones.length >= 1, antes.movimientos.length >= 1, antes.solicitudesDeRetiro.length]
      const pagoAntes = antes.intenciones.find((item) => item.pagoId === intencion.pagoId)
      const llamadasAntes = mp.requests.length

      // ---- 6. The provider links Mercado Pago (the real OAuth flow).
      out.vincula = [(await conectarMercadoPago(p, '9911' + String(Math.floor(Math.random() * 90000) + 10000))).status, await cuentaMp()]

      // ---- 7. Nothing of what already happened changed.
      const despues = await historico()
      out.identico = Object.fromEntries(Object.keys(antes).map((clave) => [clave, texto(antes[clave]) === texto(despues[clave])]))
      const pagoDespues = despues.intenciones.find((item) => item.pagoId === intencion.pagoId)
      out.pago = [pagoDespues.pagoId === pagoAntes.pagoId, texto(pagoDespues) === texto(pagoAntes), [pagoAntes.modoCobro, pagoDespues.modoCobro], pagoDespues.referenciaProveedor !== null && pagoDespues.referenciaProveedor === pagoAntes.referenciaProveedor]
      const saldoDespues = await saldo(p)
      out.saldo = [saldoDespues.disponible === saldoAntes.disponible, saldoDespues.reservado, saldoDespues.proceso, saldoDespues.pagado, await estadoTurno(t)]
      // ---- 8. The link only enables the destination of a future payout; none was requested or sent.
      out.soloHabilitaRetiro = [saldoDespues.puede, saldoDespues.motivo, (await prisma.solicitudLiquidacion.count({ where: { prestadorTenantId: p.tenantId } })), mp.requests.slice(llamadasAntes).map((x) => x.path).filter((ruta) => !ruta.startsWith('/oauth/'))]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.sinMercadoPago, 'not_connected')
  assert.deepEqual(r.cobro, ['555', false, 'applied', 'confirmed', 'paid'], 'no Mercado Pago linked: the client pays, the account of TUS collects (no split, no marketplace_fee), the payment is applied and the turno confirmed')
  assert.deepEqual(r.retenido, [true, true, '0'], 'paid in advance: held, not withdrawable yet')
  assert.deepEqual(r.liberado, [true, '2700000', false, 'PAYMENT_ACCOUNT_REQUIRED', 'PAYMENT_ACCOUNT_REQUIRED'], 'closed and confirmed: 30.000 - 10% = 27.000 in the balance of the provider; with no Mercado Pago linked it cannot withdraw them')
  assert.deepEqual(r.hayHistoria, [1, 1, 1, 1, true, true, 1, true, true, 0], 'there is a turno, a work, its closing, a paid obligation, its payment, the frozen commission, its settlement and its earnings to compare')
  assert.deepEqual(r.vincula, ['connected', 'connected'])
  assert.deepEqual(r.identico, { reserva: true, trabajo: true, cierre: true, obligaciones: true, intenciones: true, comisionDelPago: true, comisionDelTrabajo: true, liquidaciones: true, movimientos: true, solicitudesDeRetiro: true }, 'linking Mercado Pago changed no column of any historical row')
  assert.deepEqual(r.pago, [true, true, ['plataforma', 'plataforma'], true], 'the same payment id, still collected by the account of TUS, with the same provider reference')
  assert.deepEqual(r.saldo, [true, '0', '0', '0', 'completed'], 'the same balance; nothing reserved, in process or paid out')
  assert.deepEqual(r.soloHabilitaRetiro, [true, null, 0, []], 'the link only makes a future payout possible: none was requested, and nothing but the OAuth exchange was sent to Mercado Pago')
})
