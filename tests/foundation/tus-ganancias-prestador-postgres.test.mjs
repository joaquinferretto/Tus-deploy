import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { MERCADO_PAGO_API_SETUP } from './fixtures/mercado-pago-api.mjs'

// TUS-GANANCIAS-01 end to end on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). Never a shared or production database. Everything is real except the
// Mercado Pago HTTP API, replaced at the `fetch` boundary by an offline stand-in of its documented
// contract: the real payments module (Checkout Pro, Split 1:1 with the seller's OAuth token,
// platform collection with TUS's token, signed notifications looked up server-side, refunds), the
// real Mercado Pago Payouts adapter, the real turnos with their 50% deposit, the real work and
// finance services, the real earnings ledger and the persisted payment configuration.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

const SETUP = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
  const pg = (await import('./apps/api/node_modules/pg/lib/index.js')).default
  const db = new pg.Client({ connectionString: ${JSON.stringify(url ?? '')} })
  await db.connect()
  const { createPrismaAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
  const { ServicioSenaTurnos, pagosSenaDeAplicacion } = await import('./apps/api/src/tus/calendar/turnos-sena.ts')
  const { PrismaTrabajoTransaction, PrismaTrabajoStore, PrismaTrabajoOutboxStore } = await import('./apps/api/src/tus/adapters/prisma-work.ts')
  const { TransaccionFinanzasServicioPrisma, confirmarReservaPorPagoPrisma } = await import('./apps/api/src/tus/adapters/prisma-finanzas-servicios.ts')
  const { AlmacenSolicitudesLiquidacionPrisma } = await import('./apps/api/src/tus/adapters/prisma-ganancias.ts')
  const { ConfiguracionPagosPrisma, CuentasCobroPrisma } = await import('./apps/api/src/tus/adapters/prisma-configuracion-pagos.ts')
  const { ServicioGananciasPrestador } = await import('./apps/api/src/tus/finance/servicios/ganancias.ts')
  const { crearModuloPagosServicio } = await import('./apps/api/src/tus/finance/servicios/composicion-pagos.ts')
  const { ClienteOAuthMercadoPagoHttp } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
  const { ServicioTrabajo } = await import('./apps/api/src/tus/work/index.ts')
  const { ServicioFinanzasServicios } = await import('./apps/api/src/tus/finance/servicios/servicio.ts')
  const c = await import('./packages/contracts/src/tus-turnos.ts')
  ${MERCADO_PAGO_API_SETUP}
  const run = 'e' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  mp.idRun = 'r' + Math.random().toString(36).slice(2, 8)
  const auth = createPrismaAuthService(prisma)
  const PLATFORM_TOKEN = 'platform-token-555'
  mp.sellers.set(PLATFORM_TOKEN, '555')
  const env = { TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'sandbox', MERCADO_PAGO_CLIENT_ID: 'app-123', MERCADO_PAGO_CLIENT_SECRET: 'fictitious-client-secret', MERCADO_PAGO_WEBHOOK_SECRET: WEBHOOK_SECRET, MERCADO_PAGO_OAUTH_REDIRECT_URI: 'https://api.tus.test/tus/v1/integrations/mercado-pago/oauth/callback', MERCADO_PAGO_NOTIFICATION_URL: 'https://api.tus.test/tus/v1/integrations/mercado-pago/webhooks', TUS_PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString('base64'), TUS_WEB_BASE_URL: 'https://web.tus.test', MERCADO_PAGO_PLATFORM_ACCESS_TOKEN: PLATFORM_TOKEN, MERCADO_PAGO_PLATFORM_USER_ID: '555', TUS_MERCADOPAGO_PAYOUTS_ENABLED: 'true', MERCADO_PAGO_PAYOUTS_NOTIFICATION_URL: 'https://api.tus.test/tus/v1/integrations/mercado-pago/payouts/webhooks' }
  const verificados = new Set()
  const modulo = crearModuloPagosServicio({ env, configuracion: new ConfiguracionPagosPrisma(prisma), cuentas: new CuentasCobroPrisma(prisma), mercadoPago: { fetch: mpFetch }, payouts: { fetch: mpFetch }, oauth: new ClienteOAuthMercadoPagoHttp({ clientId: 'app-123', clientSecret: env.MERCADO_PAGO_CLIENT_SECRET, testToken: true, fetch: mpFetch }), identidadVerificada: async (tenant) => verificados.has(tenant) })
  const admin = { tenantId: 'platform', actorId: 'u-admin', correlationId: 'c-admin' }
  const actual = await modulo.configuracion.configuracionActual()
  await modulo.configuracion.registrarConfiguracion(admin, { paymentsEnabled: true, reason: 'pagos e2e', expectedVersion: actual.configuration?.version ?? 0, minimumPayoutMinor: '1000000' })
  const work = new ServicioTrabajo(new PrismaTrabajoTransaction(prisma), () => Date.now())
  const fin = new ServicioFinanzasServicios(
    new TransaccionFinanzasServicioPrisma(prisma, (tx) => ({ completarPorPagoFinal: (input) => work.completarPorPagoFinal({ work: new PrismaTrabajoStore(tx), outbox: new PrismaTrabajoOutboxStore(tx) }, input), confirmarReservaPorPago: (input) => confirmarReservaPorPagoPrisma(tx, input) })),
    () => Date.now(), modulo.proveedor, undefined, modulo.politica)
  const turnos = new ServicioTurnos(prisma, { solicitudRecibida: async () => {}, solicitudRespondida: async () => {}, turnoConfirmado: async () => {} })
  turnos.conSenas(new ServicioSenaTurnos(prisma, pagosSenaDeAplicacion({ work, serviceFinance: fin })))
  // As the composition wires it: minimum from the persisted configuration, strict account check.
  const ganancias = new ServicioGananciasPrestador(new AlmacenSolicitudesLiquidacionPrisma(prisma), modulo.liquidaciones, async (tenant) => verificados.has(tenant), () => Date.now(), {
    minimoLiquidacion: () => modulo.configuracion.minimoLiquidacion(),
    cuentaHabilitada: async (tenantId) => { await modulo.cuentas.estadoCuenta({ tenantId }); await modulo.cuentas.tokenVigente(tenantId); return true },
  })

  const [oficio] = await prisma.oficioServicio.findMany({ where: { activo: true }, orderBy: { orden: 'asc' }, take: 1 })
  async function prestador(tag, nombre, variantes) {
    const tenantId = run + '-tenant-' + tag
    const prestadorId = run + '-prestador-' + tag
    const ahora = new Date()
    await prisma.tusTenant.create({ data: { id: tenantId, slug: tenantId, name: nombre, status: 'active', createdAt: ahora, updatedAt: ahora } })
    await prisma.prestador.create({ data: { id: run + '-p-' + tag, tenantId, prestadorId, cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
    const perfil = await prisma.perfilPublicoPrestador.create({ data: { id: run + '-perfil-' + tag, tenantId, prestadorId, nombrePublico: nombre, oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, orden: 0, duracionMinutos: 60, precioBase: null }] } } })
    const tarifas = {}
    let orden = 0
    for (const [nombreTarifa, precio] of variantes) {
      const id = run + '-tarifa-' + tag + '-' + orden
      await prisma.tarifaServicioPrestador.create({ data: { id, tenantId, perfilId: perfil.id, oficioId: oficio.id, nombre: nombreTarifa, duracionMinutos: 60, precio: BigInt(precio), activo: true, orden } })
      tarifas[nombreTarifa] = id
      orden += 1
    }
    verificados.add(tenantId)
    return { tenantId, prestadorId, perfilId: perfil.id, tarifas, ctx: { tenantId, actorId: 'u-' + tag, correlationId: 'c-' + tag } }
  }
  const cliente = async (tag) => (await auth.service.registerAccount({ email: run + '-' + tag + '@example.com', password: 'una frase larga y segura 2026', displayName: 'Cliente ' + tag })).created.account
  // OAuth with Mercado Pago (authorization URL with state, callback with the code).
  const conectarMercadoPago = async (p, userId) => { const s = await modulo.cuentas.iniciarConexion({ tenantId: p.tenantId, actorId: 'u', correlationId: 'c' }); return modulo.cuentas.completarConexion({ code: 'TG-code-' + userId, state: new URL(s.authorizationUrl).searchParams.get('state'), correlationId: 'c' }) }
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  const lunes = c.sumarDias(c.lunesDe(hoy), 7)
  const a = (indice, hora) => new Date(c.sumarDias(lunes, indice) + 'T' + hora + ':00.000-03:00').toISOString()
  const codeOf = async (op) => { try { await op(); return 'none' } catch (e) { return e?.code ?? String(e) } }
  const sqlError = async (sql, params = []) => { try { await db.query(sql, params); return 'ok' } catch (e) { return e.constraint ?? (String(e.message).includes('append-only') ? 'append-only' : e.code) } }
  // Mercado Pago retries a notification TUS answered with an error (here: a serialization retry).
  const ingerir = async (notice) => { for (let i = 0; ; i += 1) { try { return await fin.ingerirEventoProveedor(notice) } catch (e) { if (e?.code !== 'CONCURRENT_MODIFICATION' || i >= 5) throw e } } }
  // A client requests a turno, the provider accepts, the client opens the deposit checkout.
  async function turnoConCheckout(p, cuenta, indice, hora, variante) {
    const pedido = await turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(indice, hora), tarifaId: p.tarifas[variante], clienteId: cuenta.id, clienteTenantId: cuenta.tenantId })
    await turnos.aceptarSolicitud({ prestadorTenantId: p.tenantId, reservaId: pedido.id })
    // Accepting prepares the checkout in the background (for the notice); while it is being
    // prepared the client is told to retry in a few seconds, as the Web does.
    let checkout = null
    for (let i = 0; !checkout; i += 1) {
      try { checkout = await turnos.pagarSena({ clienteId: cuenta.id, reservaId: pedido.id, correlationId: 'c' }) } catch (e) { if (e?.code !== 'IN_PROGRESS' || i >= 40) throw e; await new Promise((resolve) => setTimeout(resolve, 250)) }
    }
    const trabajo = await prisma.trabajo.findFirst({ where: { origen: 'turno', reservaId: pedido.reservaId } })
    const obligacion = await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: trabajo.trabajoId, tramo: 'sena' } })
    const pago = await prisma.intencionPago.findFirst({ where: { obligacionId: obligacion.obligacionId } })
    const preferencia = mp.preferences.find((item) => item.body.external_reference === pago.pagoId)
    return { pedido, checkout, obligacion, pago, preferencia }
  }
  const estadoTurno = async (t) => (await prisma.reserva.findUnique({ where: { id: t.pedido.id } })).estado
  const filas = async (p) => (await db.query('SELECT tipo, monto::text AS monto FROM movimientos_ganancia_prestador WHERE prestador_tenant_id = $1 ORDER BY fecha_creacion, movimiento_id', [p.tenantId])).rows.map((x) => [x.tipo, x.monto])
  const saldo = async (p) => { const r = await ganancias.resumen(p.ctx); return { disponible: r.availableMinor, negativo: r.negativeMinor, reservado: r.reservedMinor, proceso: r.processingMinor, pagado: r.paidMinor, tarifas: r.feesMinor, puede: r.canRequest, motivo: r.blockedReason } }
  const cerrar = async () => { await db.end(); await prisma.$disconnect() }
`

test('GANANCIAS E2E PostgreSQL + real Mercado Pago adapters: platform collection and Split; deposits confirm turnos only by the verified notification; earnings accumulate net of commission and the reported fee; payouts reserve, fail and release, are sent through Mercado Pago Payouts idempotently and paid only by Mercado Pago\'s answer; refunds, chargebacks, negative balance and its netting; concurrency, invalid and duplicate notifications, wrong amount and currency, tenant and provider isolation', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const sin = await prestador('sin', 'Sin MP ' + run, [['Masaje', 30000], ['Largo', 40000], ['Corto', 20000]])
      const con = await prestador('con', 'Con MP ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const beto = await cliente('beto')

      // CASE 2: provider WITH Mercado Pago: OAuth, Split 1:1 with the seller's token and the
      // marketplace fee; the verified notification confirms the turno; no earning in TUS.
      out.oauth = (await conectarMercadoPago(con, '777')).status
      const t0 = await turnoConCheckout(con, ana, 0, '10:00', 'Masaje')
      out.splitAntes = [t0.pago.modoCobro, t0.preferencia.seller, t0.preferencia.body.marketplace_fee, t0.preferencia.body.items[0].unit_price, await estadoTurno(t0)]
      mpPayment('5001', t0.preferencia, { fee_details: [{ type: 'mercadopago_fee', amount: 900, fee_payer: 'collector' }] })
      // CASE 15: a forged notification changes nothing.
      const falsa = notification('5001', { userId: '777', secret: 'otro-secreto' })
      out.invalida = [(await ingerir(falsa)).reason, await estadoTurno(t0)]
      const ok0 = notification('5001', { userId: '777', notificationId: run + '-n0' })
      const aprobado0 = await ingerir(ok0)
      // CASE 14: the same notification again is a duplicate.
      const duplicado0 = await ingerir(ok0)
      out.split = [aprobado0.result, duplicado0.status, await estadoTurno(t0), (await filas(con)).length, String((await prisma.instantaneaComision.findFirst({ where: { obligacionId: t0.obligacion.obligacionId } })).comisionProveedorPago)]

      // CASES 16 and 17: wrong amount and wrong currency are quarantined, nothing confirmed.
      const t1 = await turnoConCheckout(con, ana, 0, '11:00', 'Masaje')
      mpPayment('5002', t1.preferencia, { transaction_amount: 1 })
      out.montoIncorrecto = [(await ingerir(notification('5002', { userId: '777' }))).reason, await estadoTurno(t1)]
      mpPayment('5003', t1.preferencia, { currency_id: 'USD', date_last_updated: new Date(Date.now() + 60_000).toISOString() })
      out.monedaIncorrecta = [(await ingerir(notification('5003', { userId: '777' }))).reason, await estadoTurno(t1)]

      // CASE 1: provider WITHOUT Mercado Pago: TUS collects with its own account (no split, no
      // marketplace fee); a redirect or a checkout confirms nothing; the verified notification
      // confirms the turno and books the earning (15.000 - 10% = 13.500).
      const p1 = await turnoConCheckout(sin, ana, 1, '10:00', 'Masaje')
      out.plataformaAntes = [p1.pago.modoCobro, p1.preferencia.seller, 'marketplace_fee' in p1.preferencia.body, p1.preferencia.body.items[0].unit_price, await estadoTurno(p1)]
      mpPayment('6001', p1.preferencia)
      const n1 = await ingerir(notification('6001', { userId: '555' }))
      out.caso1 = [n1.result, await estadoTurno(p1), await filas(sin), (await saldo(sin)).disponible]
      out.consultaConTokenTus = mp.requests.filter((x) => x.path === '/v1/payments/6001').every((x) => x.headers.authorization === 'Bearer ' + PLATFORM_TOKEN)

      // CASE 3: a second turno accumulates (20.000 - 10% = 18.000, fee 1.000 reported at once).
      const p2 = await turnoConCheckout(sin, beto, 1, '11:00', 'Largo')
      mpPayment('6002', p2.preferencia, { fee_details: [{ type: 'mercadopago_fee', amount: 1000, fee_payer: 'collector' }] })
      await ingerir(notification('6002', { userId: '555' }))
      out.caso3 = [await estadoTurno(p2), (await saldo(sin)).disponible]
      // The fee of the first payment reported later is debited then (never estimated).
      mp.payments.set('6001', { ...mp.payments.get('6001'), fee_details: [{ type: 'mercadopago_fee', amount: 750, fee_payer: 'collector' }], date_last_updated: new Date(Date.now() + 120_000).toISOString() })
      out.tarifaTardia = (await ingerir(notification('6001', { userId: '555' }))).result
      out.acumulado = [await filas(sin), await saldo(sin)]

      // CASE 18: a client cannot pay someone else's turno.
      const t2 = await turnoConCheckout(sin, ana, 1, '12:00', 'Corto')
      out.otroCliente = await codeOf(() => turnos.pagarSena({ clienteId: beto.id, reservaId: t2.pedido.id, correlationId: 'c' }))

      // Without Mercado Pago nothing can be requested.
      out.sinMp = [(await saldo(sin)).motivo, await codeOf(() => ganancias.solicitar(sin.ctx, 'clave-sin-mp-1', { destinationEmail: 'sin@prestador.test' }))]

      // CASE 4: the provider connects Mercado Pago.
      out.conecta = (await conectarMercadoPago(sin, '888')).status

      // CASE 13: five requests at once: one request; CASE 6: its funds are reserved.
      const carrera = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => ganancias.solicitar(sin.ctx, 'clave-carrera-' + i, { destinationEmail: 'rechazada@prestador.test' })))
      const ok = carrera.filter((x) => x.status === 'fulfilled').map((x) => x.value)
      out.carrera = [ok.filter((x) => x.status === 'created').length, [...new Set(carrera.filter((x) => x.status === 'rejected').map((x) => x.reason?.code ?? String(x.reason)))]]
      const r1 = ok.find((x) => x.status === 'created').payout
      out.reservado = [r1.amountMinor, await saldo(sin), (await db.query("SELECT tipo, monto::text AS monto FROM movimientos_ganancia_prestador WHERE solicitud_id = $1", [r1.payoutId])).rows.map((x) => [x.tipo, x.monto]), (await db.query('SELECT count(*)::int AS n FROM items_solicitud_liquidacion WHERE solicitud_id = $1 AND activo', [r1.payoutId])).rows[0].n]

      // CASE 8a: Mercado Pago refuses the destination: failed, funds released.
      mp.payoutRejectEmails.add('rechazada@prestador.test')
      const f1 = await ganancias.procesar(admin, r1.payoutId, { mechanism: 'mercado_pago_payouts' })
      out.rechazada = [f1.status, f1.failureReason, (await saldo(sin)).disponible, (await db.query("SELECT tipo FROM movimientos_ganancia_prestador WHERE solicitud_id = $1 ORDER BY tipo", [r1.payoutId])).rows.map((x) => x.tipo)]

      // CASE 8b: Mercado Pago does not confirm the sending (it did create it): resending with the
      // same idempotency key returns the same transfer; then it is rejected for lack of funds.
      const r2 = (await ganancias.solicitar(sin.ctx, 'clave-segunda-1', { destinationEmail: 'sin@prestador.test' })).payout
      mp.payoutsDown = 1
      out.noConfirmada = await codeOf(() => ganancias.procesar(admin, r2.payoutId, { mechanism: 'mercado_pago_payouts' }))
      out.fallarEnviada = await codeOf(() => ganancias.marcarFallida(admin, r2.payoutId, { reason: 'intento manual' }))
      const reenviada = await ganancias.reenviar(admin, r2.payoutId)
      out.idempotente = [[...mp.payouts.values()].filter((x) => x.idempotencyKey === r2.payoutId).length, Boolean(reenviada.externalReference)]
      const enProceso = await ganancias.actualizarDesdeMercadoPago(admin, r2.payoutId)
      const pid2 = [...mp.payouts.values()].find((x) => x.idempotencyKey === r2.payoutId).id
      const aviso2 = procesarPayout(pid2, 'rejected', 'insufficient_funds')
      const n2 = await ganancias.notificacionPayout(aviso2)
      out.sinFondosMp = [enProceso.status, enProceso.providerStatus, n2, (await saldo(sin)).disponible]

      // CASE 5 + 7: a request paid through Mercado Pago Payouts: TUS's token, sandbox header,
      // idempotency key, the provider's email, the exact amount; paid only when Mercado Pago says
      // the transfer was accredited (a notification only names the payout).
      const r3 = (await ganancias.solicitar(sin.ctx, 'clave-tercera-1', { destinationEmail: 'Sin@Prestador.test' })).payout
      const enviada = await ganancias.procesar(admin, r3.payoutId, { mechanism: 'mercado_pago_payouts', note: 'Lote del día' })
      const post = mp.requests.filter((x) => x.path === '/v1/payouts').at(-1)
      out.post = [post.headers.authorization === 'Bearer ' + PLATFORM_TOKEN, post.headers['x-test-token'], post.headers['x-idempotency-key'] === r3.payoutId, post.body.transactions[0].type, post.body.transactions[0].account.email, post.body.transactions[0].amount, post.body.config.notification_url, enviada.status, enviada.mechanism]
      const pid3 = [...mp.payouts.values()].find((x) => x.idempotencyKey === r3.payoutId).id
      // A notification claiming success while Mercado Pago still says 'created' pays nothing.
      out.avisoFalso = [await ganancias.notificacionPayout({ id: 'x', status: 'approved', payout: { id: pid3 } }), (await ganancias.ver(sin.ctx, r3.payoutId)).status]
      out.marcarManualMp = await codeOf(() => ganancias.marcarPagada(admin, r3.payoutId, { externalReference: 'TRANSF-1' }))
      const n3 = await ganancias.notificacionPayout(procesarPayout(pid3, 'success', 'accredited'))
      const pagada = await ganancias.ver(sin.ctx, r3.payoutId)
      out.pagada = [n3, pagada.status, pagada.providerStatus, pagada.externalReference === pid3 + '/' + [...mp.payouts.values()].find((x) => x.id === pid3).transactionId, await saldo(sin)]
      out.ledgerPago = (await db.query("SELECT tipo, monto::text AS monto FROM movimientos_ganancia_prestador WHERE solicitud_id = $1 ORDER BY tipo", [r3.payoutId])).rows.map((x) => [x.tipo, x.monto])
      out.desconocido = await ganancias.notificacionPayout({ payout: { id: 'POP99999999' } })

      // CASE 9 and 10: a refund and a chargeback after the payout: new debits; CASE 11: the
      // balance is negative, visible to the administration and cannot be withdrawn.
      const reembolso = await fin.solicitarReembolso({ tenantId: ana.tenantId, paymentId: p1.pago.pagoId, actorId: 'u-admin', correlationId: 'r', idempotencyKey: run + '-refund-1', reason: 'servicio no prestado' })
      mp.payments.set('6001', { ...mp.payments.get('6001'), status: 'refunded', status_detail: 'refunded', date_last_updated: new Date(Date.now() + 180_000).toISOString() })
      const n9 = await ingerir(notification('6001', { userId: '555' }))
      mp.payments.set('6002', { ...mp.payments.get('6002'), status: 'charged_back', status_detail: 'settled', date_last_updated: new Date(Date.now() + 180_000).toISOString() })
      const n10 = await ingerir(notification('6002', { userId: '555' }))
      out.reversos = [reembolso.status, mp.refunds.at(-1).seller, n9.result, n10.result, (await filas(sin)).filter(([tipo]) => tipo === 'refund_debit' || tipo === 'chargeback_debit'), await saldo(sin)]
      out.negativos = (await ganancias.saldosNegativos()).filter((x) => x.providerTenantId === sin.tenantId).map((x) => x.availableMinor)
      out.retiroNegativo = await codeOf(() => ganancias.solicitar(sin.ctx, 'clave-negativo-1', { destinationEmail: 'sin@prestador.test' }))

      // CASE 12: future earnings net it. The provider unlinks Mercado Pago, so TUS collects again.
      await modulo.cuentas.desconectar({ tenantId: sin.tenantId, actorId: 'u', correlationId: 'c' })
      const compensa = []
      for (const [indice, hora, variante, numero] of [[2, '10:00', 'Largo', '6101'], [2, '11:00', 'Largo', '6102'], [2, '12:00', 'Masaje', '6103']]) {
        const t = await turnoConCheckout(sin, ana, indice, hora, variante)
        mpPayment(numero, t.preferencia)
        await ingerir(notification(numero, { userId: '555' }))
        const s = await saldo(sin)
        compensa.push([t.pago.modoCobro, s.disponible, s.negativo, s.motivo])
      }
      out.compensa = compensa
      out.negativosDespues = (await ganancias.saldosNegativos()).filter((x) => x.providerTenantId === sin.tenantId).length

      // CASE 19: another provider sees nothing of these earnings or requests.
      out.otroPrestador = [await saldo(con), await codeOf(() => ganancias.ver(con.ctx, r3.payoutId)), await codeOf(() => ganancias.cancelar(con.ctx, r3.payoutId)), (await ganancias.liquidaciones(con.ctx)).length]

      // History for the provider: types, services, turnos; nothing internal.
      const historial = await ganancias.historial(sin.ctx)
      out.historial = [[...new Set(historial.map((h) => h.kind))].sort(), historial.filter((h) => h.kind === 'earning').every((h) => h.service && h.appointmentAt), new RegExp(run).test(JSON.stringify([await ganancias.resumen(sin.ctx), historial, await ganancias.liquidaciones(sin.ctx)]))]
      // Administration: the list, the detail with the earnings it paid, the reconciliation.
      const lista = await ganancias.listar({ status: '', providerTenantId: sin.tenantId })
      const detalle = await ganancias.detalle(r3.payoutId)
      out.admin = [lista.total, lista.items.map((x) => x.status).sort(), detalle.items.map((x) => x.kind).sort(), detalle.movements.map((x) => x.kind).sort(), detalle.payout.note, detalle.automaticAvailable]
      out.cuentaSolicitud = detalle.account.requestAccountId
      out.conciliacion = (await ganancias.conciliacion(sin.tenantId)).slice(0, 2).map((x) => [x.grossMinor, x.commissionMinor, x.mercadoPagoFeeMinor, x.earningMinor, x.refundedMinor, x.chargedBackMinor, x.payoutStatus])

      // The database by itself.
      const reserva = (await db.query("SELECT * FROM movimientos_ganancia_prestador WHERE solicitud_id = $1 AND tipo = 'payout_reserve'", [r3.payoutId])).rows[0]
      const copia = (cambios) => { const fila = { ...reserva, id: run + '-x-' + Math.random(), movimiento_id: 'x:' + Math.random(), ...cambios }; const cols = Object.keys(fila); return sqlError('INSERT INTO movimientos_ganancia_prestador(' + cols.map((k) => '"' + k + '"').join(',') + ') VALUES (' + cols.map((_, i) => '$' + (i + 1)).join(',') + ')', cols.map((k) => fila[k])) }
      out.base = {
        update: await sqlError('UPDATE movimientos_ganancia_prestador SET monto = 1 WHERE id = $1', [reserva.id]),
        delete: await sqlError('DELETE FROM movimientos_ganancia_prestador WHERE id = $1', [reserva.id]),
        segundaReserva: await copia({}),
        segundoPago: await copia({ tipo: 'payout_completed' }),
        reservaSinSolicitud: await copia({ solicitud_id: null }),
        pagadaSinReferencia: await sqlError("UPDATE solicitudes_liquidacion SET referencia_externa = NULL WHERE solicitud_id = $1", [r3.payoutId]),
        pagadaSinMecanismo: await sqlError("UPDATE solicitudes_liquidacion SET mecanismo = NULL WHERE solicitud_id = $1", [r3.payoutId]),
        payoutRepetido: await sqlError("UPDATE solicitudes_liquidacion SET payout_proveedor_id = $1, transaccion_proveedor_id = 'T' WHERE solicitud_id = $2", [pid3, r2.payoutId]),
        emailInvalido: await sqlError("UPDATE solicitudes_liquidacion SET email_destino = 'no-es-email' WHERE solicitud_id = $1", [r3.payoutId]),
      }
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  // Split
  assert.equal(r.oauth, 'connected')
  assert.deepEqual(r.splitAntes, ['split', '777', 1500, 15000, 'awaiting_payment'], 'Split 1:1: the seller collects 15.000 and TUS keeps its 1.500 as marketplace_fee')
  assert.deepEqual(r.invalida, ['INVALID_SIGNATURE', 'awaiting_payment'])
  assert.deepEqual(r.split, ['applied', 'duplicate', 'confirmed', 0, '90000'], 'confirmed by the verified notification; the real fee recorded; no earning in TUS')
  assert.deepEqual(r.montoIncorrecto, ['amount_mismatch', 'awaiting_payment'])
  assert.deepEqual(r.monedaIncorrecta, ['currency_mismatch', 'awaiting_payment'])
  // Platform
  assert.deepEqual(r.plataformaAntes, ['plataforma', '555', false, 15000, 'awaiting_payment'], 'TUS own checkout, no split; the checkout confirms nothing')
  assert.deepEqual(r.caso1, ['applied', 'confirmed', [['earning_credit', '1350000']], '1350000'], 'Ganancias disponibles $13.500')
  assert.equal(r.consultaConTokenTus, true)
  assert.deepEqual(r.caso3, ['confirmed', '3050000'], '13.500 + (18.000 - 1.000 Mercado Pago fee)')
  assert.equal(r.tarifaTardia, 'no_op')
  assert.deepEqual(r.acumulado[0], [['earning_credit', '1350000'], ['earning_credit', '1800000'], ['psp_fee_debit', '100000'], ['psp_fee_debit', '75000']])
  assert.deepEqual(r.acumulado[1], { disponible: '2975000', negativo: '0', reservado: '0', proceso: '0', pagado: '0', tarifas: '175000', puede: false, motivo: 'PAYMENT_ACCOUNT_REQUIRED' })
  assert.notEqual(r.otroCliente, 'none', 'another client cannot pay this turno')
  assert.deepEqual(r.sinMp, ['PAYMENT_ACCOUNT_REQUIRED', 'PAYMENT_ACCOUNT_REQUIRED'])
  assert.equal(r.conecta, 'connected')
  // Payouts
  assert.deepEqual(r.carrera, [1, ['PAYOUT_ALREADY_OPEN']])
  assert.deepEqual(r.reservado, ['2975000', { disponible: '0', negativo: '0', reservado: '2975000', proceso: '0', pagado: '0', tarifas: '175000', puede: false, motivo: 'PAYOUT_IN_PROGRESS' }, [['payout_reserve', '2975000']], 4])
  assert.deepEqual(r.rechazada, ['failed', 'mercado_pago_rejected', '2975000', ['payout_release', 'payout_reserve']], 'refused by Mercado Pago: released')
  assert.equal(r.noConfirmada, 'PAYOUT_SEND_UNCONFIRMED')
  assert.equal(r.fallarEnviada, 'PAYOUT_SENT_TO_PROVIDER', 'money that may have left is never released by hand')
  assert.deepEqual(r.idempotente, [1, true], 'resending never creates a second transfer')
  assert.deepEqual(r.sinFondosMp, ['processing', 'created', { status: 'applied', payoutStatus: 'failed' }, '2975000'])
  assert.deepEqual(r.post, [true, 'true', true, 'account', 'sin@prestador.test', { currency: 'ARS', value: 29750 }, 'https://api.tus.test/tus/v1/integrations/mercado-pago/payouts/webhooks', 'processing', 'mercado_pago_payouts'])
  assert.deepEqual(r.avisoFalso, [{ status: 'applied', payoutStatus: 'processing' }, 'processing'], 'the notification content is never trusted')
  assert.equal(r.marcarManualMp, 'INVALID_TRANSITION')
  assert.deepEqual(r.pagada, [{ status: 'applied', payoutStatus: 'paid' }, 'paid', 'success:accredited', true, { disponible: '0', negativo: '0', reservado: '0', proceso: '0', pagado: '2975000', tarifas: '175000', puede: false, motivo: 'NO_FUNDS' }])
  assert.deepEqual(r.ledgerPago, [['payout_completed', '2975000'], ['payout_reserve', '2975000']])
  assert.deepEqual(r.desconocido, { status: 'ignored' })
  // Reversals and negative balance
  assert.deepEqual(r.reversos, ['submitted', '555', 'applied', 'applied', [['refund_debit', '1350000'], ['chargeback_debit', '1800000']], { disponible: '-3150000', negativo: '3150000', reservado: '0', proceso: '0', pagado: '2975000', tarifas: '175000', puede: false, motivo: 'NO_FUNDS' }])
  assert.deepEqual(r.negativos, ['-3150000'])
  assert.equal(r.retiroNegativo, 'PAYOUT_NO_FUNDS')
  assert.deepEqual(r.compensa, [
    ['plataforma', '-1350000', '1350000', 'PAYMENT_ACCOUNT_REQUIRED'],
    ['plataforma', '450000', '0', 'PAYMENT_ACCOUNT_REQUIRED'],
    ['plataforma', '1800000', '0', 'PAYMENT_ACCOUNT_REQUIRED'],
  ], 'future earnings net the negative balance automatically')
  assert.equal(r.negativosDespues, 0)
  // Isolation, history, administration
  assert.deepEqual(r.otroPrestador, [{ disponible: '0', negativo: '0', reservado: '0', proceso: '0', pagado: '0', tarifas: '0', puede: false, motivo: 'NO_FUNDS' }, 'NOT_FOUND', 'NOT_FOUND', 0])
  assert.deepEqual(r.historial, [['chargeback', 'earning', 'mercado_pago_fee', 'payout_completed', 'payout_release', 'payout_reserve', 'refund'], true, false])
  assert.deepEqual(r.admin, [3, ['failed', 'failed', 'paid'], ['earning', 'earning', 'mercado_pago_fee', 'mercado_pago_fee'], ['payout_completed', 'payout_reserve'], 'Lote del día', true])
  assert.equal(r.cuentaSolicitud, '888', 'the linked Mercado Pago account recorded on the request')
  assert.deepEqual(r.conciliacion, [['1500000', '150000', '75000', '1350000', '1350000', '0', 'paid'], ['2000000', '200000', '100000', '1800000', '0', '1800000', 'paid']])
  assert.deepEqual(r.base, {
    update: 'append-only',
    delete: 'append-only',
    segundaReserva: 'uq_movimientos_ganancia_solicitud_tipo',
    segundoPago: 'uq_movimientos_ganancia_solicitud_tipo',
    reservaSinSolicitud: 'ck_movimientos_ganancia_origen',
    pagadaSinReferencia: 'ck_solicitudes_liquidacion_pagada',
    pagadaSinMecanismo: 'ck_solicitudes_liquidacion_mecanismo_estado',
    payoutRepetido: 'uq_solicitudes_liquidacion_payout_proveedor',
    emailInvalido: 'ck_solicitudes_liquidacion_email',
  })
})

test('GANANCIAS-02 PostgreSQL: the collecting account must match the mode frozen on the intent; one Mercado Pago account per provider; one reversal per earning; payout requests are idempotent, retried safely after a failure, paid by another means only with its reference, and fully audited in an append-only trail', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const m = await prestador('m', 'Modo ' + run, [['Masaje', 30000]])
      const s1 = await prestador('s1', 'Split uno ' + run, [['Masaje', 30000]])
      const s2 = await prestador('s2', 'Split dos ' + run, [['Masaje', 30000]])
      const rp = await prestador('rp', 'Reintento ' + run, [['Masaje', 30000], ['Largo', 40000]])
      const dup = await prestador('dup', 'Duplicado ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')

      // A payment in the provider's OWN account carrying the reference of an intent TUS collects:
      // quarantined, the turno is not confirmed and no earning is booked.
      const pm = await turnoConCheckout(m, ana, 3, '10:00', 'Masaje')
      out.conecta = (await conectarMercadoPago(m, '901')).status
      mpPayment('7201', { ...pm.preferencia, seller: '901' })
      const nm = await ingerir(notification('7201', { userId: '901' }))
      out.modo = [pm.pago.modoCobro, nm.result, nm.reason, await estadoTurno(pm), (await filas(m)).length]

      // A payment collected by ANOTHER provider's account for a Split intent: quarantined.
      await conectarMercadoPago(s1, '902')
      await conectarMercadoPago(s2, '903')
      const ps = await turnoConCheckout(s1, ana, 3, '11:00', 'Masaje')
      mpPayment('7301', { ...ps.preferencia, seller: '903' })
      const ns = await ingerir(notification('7301', { userId: '903' }))
      out.cobrador = [ps.pago.modoCobro, ns.result, ns.reason, await estadoTurno(ps)]
      // The real payment in its own account still confirms it.
      mpPayment('7302', ps.preferencia)
      out.cobradorReal = [(await ingerir(notification('7302', { userId: '902' }))).result, await estadoTurno(ps)]

      // One Mercado Pago account belongs to one provider.
      out.duplicada = await conectarMercadoPago(dup, '902')
      out.duplicadaEstado = (await modulo.cuentas.estadoCuenta({ tenantId: dup.tenantId })).status

      // Earnings of a provider without Mercado Pago, then it connects and asks to be paid.
      const p1 = await turnoConCheckout(rp, ana, 4, '10:00', 'Masaje')
      mpPayment('7401', p1.preferencia)
      await ingerir(notification('7401', { userId: '555' }))
      const p2 = await turnoConCheckout(rp, ana, 4, '11:00', 'Largo')
      mpPayment('7402', p2.preferencia)
      await ingerir(notification('7402', { userId: '555' }))
      out.acumulado = [await filas(rp), (await saldo(rp)).disponible, (await saldo(rp)).motivo, (await ganancias.resumen(rp.ctx)).paymentAccountStatus]
      await conectarMercadoPago(rp, '904')
      out.conectado = [(await ganancias.resumen(rp.ctx)).paymentAccountStatus, (await saldo(rp)).puede]

      // Idempotency: the same key returns the same request; a different key is a second open
      // request and is refused.
      const k1 = await ganancias.solicitar(rp.ctx, 'clave-reintento-1', { destinationEmail: 'rp@prestador.test' })
      const k1bis = await ganancias.solicitar(rp.ctx, 'clave-reintento-1', { destinationEmail: 'rp@prestador.test' })
      out.idempotencia = [k1.status, k1bis.status, k1bis.payout.payoutId === k1.payout.payoutId, k1.payout.status, await codeOf(() => ganancias.solicitar(rp.ctx, 'clave-reintento-x', { destinationEmail: 'rp@prestador.test' }))]

      // Paid by another means: never without its reference; a failure releases the funds.
      await ganancias.procesar(admin, k1.payout.payoutId, { mechanism: 'manual' })
      out.sinReferencia = await codeOf(() => ganancias.marcarPagada(admin, k1.payout.payoutId, {}))
      const fallida = await ganancias.marcarFallida(admin, k1.payout.payoutId, { reason: 'la transferencia rebotó' })
      out.fallida = [fallida.status, fallida.failureReason, (await saldo(rp)).disponible, (await saldo(rp)).puede, await codeOf(() => ganancias.marcarFallida(admin, k1.payout.payoutId, { reason: 'otra vez' }))]

      // The safe retry is a new request: it takes the same released earnings.
      const k2 = await ganancias.solicitar(rp.ctx, 'clave-reintento-2', { destinationEmail: 'rp@prestador.test' })
      await ganancias.procesar(admin, k2.payout.payoutId, { mechanism: 'manual', note: 'transferencia bancaria' })
      const pagada = await ganancias.marcarPagada(admin, k2.payout.payoutId, { externalReference: 'TRANSF-77' })
      out.reintento = [k2.status, k2.payout.amountMinor === k1.payout.amountMinor, pagada.status, pagada.externalReference, await saldo(rp), await codeOf(() => ganancias.marcarPagada(admin, k2.payout.payoutId, { externalReference: 'TRANSF-78' }))]
      const items = async (id) => (await db.query('SELECT activo FROM items_solicitud_liquidacion WHERE solicitud_id = $1 ORDER BY movimiento_id', [id])).rows.map((x) => x.activo)
      out.items = [await items(k1.payout.payoutId), await items(k2.payout.payoutId)]

      // The audit trail: one entry per version, in order, written with each change.
      const auditoria = async (id) => (await db.query('SELECT version, accion, estado_anterior, estado_nuevo, actor_id, detalle FROM auditoria_liquidaciones WHERE solicitud_id = $1 ORDER BY version', [id])).rows.map((x) => [x.version, x.accion, x.estado_anterior, x.estado_nuevo, x.actor_id, x.detalle])
      out.auditoria1 = await auditoria(k1.payout.payoutId)
      out.auditoria2 = await auditoria(k2.payout.payoutId)
      const dto = await ganancias.auditoriaDe(k2.payout.payoutId)
      out.auditoriaDto = [dto.map((x) => x.action), (await ganancias.detalle(k2.payout.payoutId)).audit.length]
      out.auditoriaOtro = await codeOf(() => ganancias.auditoriaDe('liq-no-existe'))

      // A refund and then a chargeback of the SAME payment debit the provider once.
      await fin.solicitarReembolso({ tenantId: ana.tenantId, paymentId: p1.pago.pagoId, actorId: 'u-admin', correlationId: 'r', idempotencyKey: run + '-refund-7401', reason: 'servicio no prestado' })
      mp.payments.set('7401', { ...mp.payments.get('7401'), status: 'refunded', status_detail: 'refunded', date_last_updated: new Date(Date.now() + 180_000).toISOString() })
      await ingerir(notification('7401', { userId: '555' }))
      mp.payments.set('7401', { ...mp.payments.get('7401'), status: 'charged_back', status_detail: 'settled', date_last_updated: new Date(Date.now() + 240_000).toISOString() })
      await ingerir(notification('7401', { userId: '555' }))
      out.unReverso = [(await filas(rp)).filter(([tipo]) => tipo === 'refund_debit' || tipo === 'chargeback_debit'), (await saldo(rp)).disponible, (await saldo(rp)).negativo]

      // The database by itself.
      const fila = (await db.query('SELECT * FROM auditoria_liquidaciones WHERE solicitud_id = $1 AND version = 1', [k2.payout.payoutId])).rows[0]
      const ganancia = (await db.query("SELECT * FROM movimientos_ganancia_prestador WHERE prestador_tenant_id = $1 AND tipo = 'refund_debit'", [rp.tenantId])).rows[0]
      out.base = {
        auditoriaUpdate: await sqlError('UPDATE auditoria_liquidaciones SET accion = $1 WHERE id = $2', ['paid', fila.id]),
        auditoriaDelete: await sqlError('DELETE FROM auditoria_liquidaciones WHERE id = $1', [fila.id]),
        auditoriaVersionRepetida: await sqlError('INSERT INTO auditoria_liquidaciones (id, prestador_tenant_id, solicitud_id, version, accion, estado_anterior, estado_nuevo, actor_id, correlacion_id, detalle, fecha_creacion) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, now())', [run + '-a1', fila.prestador_tenant_id, fila.solicitud_id, 'paid', 'processing', 'paid', 'x', 'x', '{}']),
        creacionConAnterior: await sqlError('INSERT INTO auditoria_liquidaciones (id, prestador_tenant_id, solicitud_id, version, accion, estado_anterior, estado_nuevo, actor_id, correlacion_id, detalle, fecha_creacion) VALUES ($1, $2, $3, 99, $4, $5, $6, $7, $8, $9, now())', [run + '-a2', fila.prestador_tenant_id, fila.solicitud_id, 'requested', 'processing', 'requested', 'x', 'x', '{}']),
        detalleNoObjeto: await sqlError('INSERT INTO auditoria_liquidaciones (id, prestador_tenant_id, solicitud_id, version, accion, estado_anterior, estado_nuevo, actor_id, correlacion_id, detalle, fecha_creacion) VALUES ($1, $2, $3, 98, $4, $5, $6, $7, $8, $9, now())', [run + '-a3', fila.prestador_tenant_id, fila.solicitud_id, 'paid', 'processing', 'paid', 'x', 'x', '[]']),
        auditoriaSinSolicitud: await sqlError('INSERT INTO auditoria_liquidaciones (id, prestador_tenant_id, solicitud_id, version, accion, estado_anterior, estado_nuevo, actor_id, correlacion_id, detalle, fecha_creacion) VALUES ($1, $2, $3, 1, $4, NULL, $5, $6, $7, $8, now())', [run + '-a4', fila.prestador_tenant_id, 'liq-no-existe', 'requested', 'requested', 'x', 'x', '{}']),
        estadoViejo: await sqlError("UPDATE solicitudes_liquidacion SET estado = 'pending' WHERE solicitud_id = $1", [k2.payout.payoutId]),
        segundoReverso: await sqlError('INSERT INTO movimientos_ganancia_prestador (id, movimiento_id, prestador_tenant_id, prestador_id, tipo, monto, moneda, obligacion_tenant_id, obligacion_id, trabajo_id, motivo, actor_id, correlacion_id, fecha_creacion) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())', [run + '-m1', 'chargeback-x:' + run, ganancia.prestador_tenant_id, ganancia.prestador_id, 'chargeback_debit', ganancia.monto, 'ARS', ganancia.obligacion_tenant_id, ganancia.obligacion_id, ganancia.trabajo_id, 'x', 'x', 'x']),
      }
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  // The collecting account decides nothing by itself: it must be the one of the intent.
  assert.equal(r.conecta, 'connected')
  assert.deepEqual(r.modo, ['plataforma', 'quarantined', 'collection_mode_mismatch', 'awaiting_payment', 0], 'money in the provider\'s own account never becomes an earning TUS owes')
  assert.deepEqual(r.cobrador, ['split', 'quarantined', 'collector_mismatch', 'awaiting_payment'], 'another provider\'s account never confirms this turno')
  assert.deepEqual(r.cobradorReal, ['applied', 'confirmed'])
  assert.deepEqual(r.duplicada, { status: 'error', reason: 'ACCOUNT_ALREADY_LINKED', redirectUrl: 'https://web.tus.test/prestador/pagos?mercadoPago=error&reason=ACCOUNT_ALREADY_LINKED' })
  assert.notEqual(r.duplicadaEstado, 'connected')
  // Accumulation without Mercado Pago, blocked with a clear reason.
  assert.deepEqual(r.acumulado, [[['earning_credit', '1350000'], ['earning_credit', '1800000']], '3150000', 'PAYMENT_ACCOUNT_REQUIRED', 'not_connected'])
  assert.deepEqual(r.conectado, ['connected', true])
  // Idempotency, failure, retry.
  assert.deepEqual(r.idempotencia, ['created', 'existing', true, 'requested', 'PAYOUT_ALREADY_OPEN'])
  assert.equal(r.sinReferencia, 'INVALID')
  assert.deepEqual(r.fallida, ['failed', 'la transferencia rebotó', '3150000', true, 'INVALID_TRANSITION'], 'a failure gives the money back and cannot be applied twice')
  assert.deepEqual(r.reintento, ['created', true, 'paid', 'TRANSF-77', { disponible: '0', negativo: '0', reservado: '0', proceso: '0', pagado: '3150000', tarifas: '0', puede: false, motivo: 'NO_FUNDS' }, 'INVALID_TRANSITION'])
  assert.deepEqual(r.items, [[false, false], [true, true]], 'the failed request released its earnings; the retry holds them')
  // Audit trail.
  assert.deepEqual(r.auditoria1, [
    [1, 'requested', null, 'requested', 'u-rp', { amountMinor: '3150000', movements: '2' }],
    [2, 'processing', 'requested', 'processing', 'u-admin', { mechanism: 'manual' }],
    [3, 'failed', 'processing', 'failed', 'u-admin', { mechanism: 'manual', reason: 'la transferencia rebotó', releasedMinor: '3150000' }],
  ])
  assert.deepEqual(r.auditoria2, [
    [1, 'requested', null, 'requested', 'u-rp', { amountMinor: '3150000', movements: '2' }],
    [2, 'processing', 'requested', 'processing', 'u-admin', { mechanism: 'manual', note: 'transferencia bancaria' }],
    [3, 'paid', 'processing', 'paid', 'u-admin', { mechanism: 'manual', externalReference: 'TRANSF-77', note: 'transferencia bancaria' }],
  ])
  assert.deepEqual(r.auditoriaDto, [['requested', 'processing', 'paid'], 3])
  assert.equal(r.auditoriaOtro, 'NOT_FOUND')
  // One reversal per earning; the balance goes negative after the payout and is visible.
  assert.deepEqual(r.unReverso, [[['refund_debit', '1350000']], '-1350000', '1350000'])
  assert.deepEqual(r.base, {
    auditoriaUpdate: 'append-only',
    auditoriaDelete: 'append-only',
    auditoriaVersionRepetida: 'uq_auditoria_liquidaciones_solicitud_version',
    creacionConAnterior: 'ck_auditoria_liquidaciones_creacion',
    detalleNoObjeto: 'ck_auditoria_liquidaciones_detalle',
    auditoriaSinSolicitud: 'fk_auditoria_liquidaciones_solicitud',
    estadoViejo: 'ck_solicitudes_liquidacion_estado',
    segundoReverso: 'uq_movimientos_ganancia_reverso_unico',
  })
})
