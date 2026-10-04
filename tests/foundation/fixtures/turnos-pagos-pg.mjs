import { MERCADO_PAGO_API_SETUP } from './mercado-pago-api.mjs'

// Shared by the PostgreSQL scenarios of earnings and of WhatsApp payment checks: the REAL payments
// module (offline Mercado Pago at the `fetch` boundary), finance, work, turnos with deposit and
// earnings over a DISPOSABLE PostgreSQL 16 with every migration applied.
export const turnosPagosSetup = (url) => `
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
  const turnos = new ServicioTurnos(prisma, { solicitudRecibida: async () => {}, solicitudRespondida: async () => {}, turnoConfirmado: async () => {}, turnoCancelado: async () => {} })
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
