import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

const require = createRequire(import.meta.url)
const { Client } = require('../../apps/api/node_modules/pg')
const root = join(import.meta.dirname, '..', '..')

// TURNOS-SENA-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). Never a shared or production database. Real Prisma, real
// constraints, the real turnos router, the real work and finance services; only Mercado Pago is
// replaced by the deterministic provider (signed events, no network).
//
// A client requests a turno of a priced service; the provider accepts; the deposit (half of the
// price stored on the reservation) becomes payable; only the verified provider notification
// marks it as paid. Nothing of the deposit is stored on the reservation.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const adminUrl = process.env.TUS_MIGRATIONS_PG_ADMIN_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'
const MIGRACION = '20261027100000_tus_turnos_sena'

const SETUP = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
  const { createPrismaAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
  const { ServicioSenaTurnos, pagosSenaDeAplicacion, senaDePrecio } = await import('./apps/api/src/tus/calendar/turnos-sena.ts')
  const { crearRouterTurnos } = await import('./apps/api/src/tus/calendar/turnos-http.ts')
  const { PrismaTrabajoTransaction, PrismaTrabajoStore, PrismaTrabajoOutboxStore } = await import('./apps/api/src/tus/adapters/prisma-work.ts')
  const { TransaccionFinanzasServicioPrisma, confirmarReservaPorPagoPrisma } = await import('./apps/api/src/tus/adapters/prisma-finanzas-servicios.ts')
  const { ServicioTrabajo } = await import('./apps/api/src/tus/work/index.ts')
  const { ServicioFinanzasServicios } = await import('./apps/api/src/tus/finance/servicios/servicio.ts')
  const { ProveedorPagosServicioDeterminista } = await import('./apps/api/src/tus/finance/servicios/pagos.ts')
  const { FuenteTrabajosAdminPrisma } = await import('./apps/api/src/tus/admin/trabajos-fuente.ts')
  const c = await import('./packages/contracts/src/tus-turnos.ts')
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const run = 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  const auth = createPrismaAuthService(prisma)

  // The deterministic provider, answering like the hosted checkout does: a Mercado Pago address
  // and no payment reference until somebody pays.
  class Proveedor extends ProveedorPagosServicioDeterminista {
    async crearPago(input) {
      const creado = await super.crearPago(input)
      return { ...creado, providerReference: null, checkoutUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=' + creado.checkoutReference }
    }
  }
  const proveedor = new Proveedor('sena-secret')
  // Online payment is a fact of each provider (platform switch + linked account + identity).
  const conCobro = new Set()
  let plataformaSinPagos = false
  const politica = {
    reglaComision: async () => ({ politicaId: null, rateBps: 1000, ruleVersion: 'sena-10', pspFeeBearer: 'provider' }),
    // plataformaSinPagos: the switch of the whole platform is off (no deposit exists anywhere).
    disponibilidad: async (input) => (plataformaSinPagos ? { available: false, reason: 'PAYMENTS_DISABLED' } : conCobro.has(input.prestadorTenantId) ? { available: true, reason: null } : { available: false, reason: 'PROVIDER_ACCOUNT_NOT_CONNECTED' }),
  }
  const work = new ServicioTrabajo(new PrismaTrabajoTransaction(prisma), () => Date.now())
  const fin = new ServicioFinanzasServicios(
    new TransaccionFinanzasServicioPrisma(prisma, (tx) => ({ completarPorPagoFinal: (input) => work.completarPorPagoFinal({ work: new PrismaTrabajoStore(tx), outbox: new PrismaTrabajoOutboxStore(tx) }, input), confirmarReservaPorPago: (input) => confirmarReservaPorPagoPrisma(tx, input) })),
    () => Date.now(), proveedor, undefined, politica)

  // Outbound notices are recorded: who was told what.
  const avisos = []
  const confirmados = []
  const turnos = new ServicioTurnos(prisma, {
    solicitudRecibida: async () => {},
    solicitudRespondida: async (aviso) => { avisos.push({ reservaId: aviso.reservaId, cuenta: aviso.clienteCuentaId, resultado: aviso.resultado, sena: aviso.sena ?? null }) },
    turnoConfirmado: async (aviso) => { confirmados.push({ reservaId: aviso.reservaId, cuenta: aviso.clienteCuentaId, prestador: aviso.prestadorTenantId, cliente: aviso.clienteNombre, servicio: aviso.servicio }) },
  })
  const senas = new ServicioSenaTurnos(prisma, pagosSenaDeAplicacion({ work, serviceFinance: fin }))
  turnos.conSenas(senas)
  const avisoDe = async (reservaId) => { for (let i = 0; i < 100; i += 1) { const a = avisos.find((x) => x.reservaId === reservaId); if (a) return a; await new Promise((r) => setTimeout(r, 50)) } return null }

  const [oficio] = await prisma.oficioServicio.findMany({ where: { activo: true }, orderBy: { orden: 'asc' }, take: 1 })
  async function cuenta(tag, nombre) {
    const outcome = await auth.service.registerAccount({ email: run + '-' + tag + '@example.com', password: 'una frase larga y segura 2026', displayName: nombre })
    return outcome.created.account
  }
  // A provider with its service and its priced variants (pesos).
  async function prestador(tag, nombre, variantes, precioBase = null) {
    const tenantId = run + '-tenant-' + tag
    const prestadorId = run + '-prestador-' + tag
    const ahora = new Date()
    await prisma.tusTenant.create({ data: { id: tenantId, slug: tenantId, name: nombre, status: 'active', createdAt: ahora, updatedAt: ahora } })
    await prisma.prestador.create({ data: { id: run + '-p-' + tag, tenantId, prestadorId, cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
    const perfil = await prisma.perfilPublicoPrestador.create({
      data: { id: run + '-perfil-' + tag, tenantId, prestadorId, nombrePublico: nombre, oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, orden: 0, duracionMinutos: 60, precioBase }] } },
    })
    const tarifas = {}
    let orden = 0
    for (const [nombreTarifa, precio] of variantes) {
      const id = run + '-tarifa-' + tag + '-' + orden
      await prisma.tarifaServicioPrestador.create({ data: { id, tenantId, perfilId: perfil.id, oficioId: oficio.id, nombre: nombreTarifa, duracionMinutos: 60, precio: BigInt(precio), activo: true, orden } })
      tarifas[nombreTarifa] = id
      orden += 1
    }
    return { tenantId, prestadorId, perfilId: perfil.id, tarifas }
  }
  // Monday of NEXT week in Argentina time (default agenda: Monday to Friday, 9 to 18).
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  const lunes = c.sumarDias(c.lunesDe(hoy), 7)
  const a = (indice, hora) => new Date(c.sumarDias(lunes, indice) + 'T' + hora + ':00.000-03:00').toISOString()
  // Name of the constraint the database rejected the write with (Prisma reports a unique or a
  // foreign key violation by its own code: P2002 / P2003).
  const restriccion = async (op) => { try { await op(); return 'ok' } catch (e) { return String(e?.message ?? e).match(/(ck_[a-z_]+|uq_[a-z_]+|fk_[a-z_]+)/u)?.[1] ?? (e?.code === 'P2002' ? 'unique:' + [e.meta?.target].flat().join(',') : e?.code === 'P2003' ? 'foreign_key' : e?.code ?? String(e?.message ?? e).slice(0, 80)) } }
  const codeOf = async (op) => { try { await op(); return 'none' } catch (e) { return e?.code ?? String(e) } }
  const app = express()
  app.use(express.json())
  const sesiones = {}
  const sesion = (token, subjectId, tenantId) => { sesiones[token] = { subjectId, sessionId: 's', tenantId, roles: ['owner'], permissions: ['tus:marketplace:write'], correlationId: 'c-' + token } }
  app.use(crearRouterTurnos({ servicio: turnos, sessions: { resolve: async (token) => sesiones[token] ?? null } }))
  const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const call = async (method, path, token, body) => {
    const response = await fetch('http://127.0.0.1:' + servidor.address().port + path, { method, headers: { 'content-type': 'application/json', 'x-correlation-id': 'c', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const cerrar = async () => { await new Promise((resolve) => servidor.close(resolve)); await prisma.$disconnect() }

  const p = await prestador('masajes', 'Bongio ' + run, [['Masaje base', 20000], ['Espalda completa', 25000], ['Cuerpo completo', 30000], ['Cuello', 2501]])
  conCobro.add(p.tenantId)
  const ana = await cuenta('ana', 'Ana Cuenta')
  const beto = await cuenta('beto', 'Beto Cuenta')
  sesion('tok-ana', ana.id, ana.tenantId); sesion('tok-beto', beto.id, beto.tenantId); sesion('tok-p', 'u-' + p.tenantId, p.tenantId)
  const solicitar = (token, prestadorDe, indice, hora, variante, extra = {}) => call('POST', '/tus/v1/prestadores/' + prestadorDe.perfilId + '/turnos/solicitudes', token, { oficioId: oficio.id, inicio: a(indice, hora), ...(variante ? { tarifaId: prestadorDe.tarifas[variante] } : {}), ...extra })
  const aceptar = (token, id) => call('POST', '/tus/v1/prestador/turnos/' + id + '/aceptar', token)
  const pagar = (token, id, body) => call('POST', '/tus/v1/cliente/turnos/' + id + '/sena/checkout', token, body)
  const misTurnos = async (token) => (await call('GET', '/tus/v1/cliente/turnos', token)).body.items
  const senaDe = async (token, id) => (await misTurnos(token)).find((t) => t.id === id)?.sena ?? null
  const fila = (id) => prisma.reserva.findUnique({ where: { id } })
  const orden = (reservaId) => prisma.trabajo.findFirst({ where: { origen: 'turno', reservaId } })
  const obligacionDe = async (reservaId) => { const o = await orden(reservaId); return o ? prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: o.trabajoId, tramo: 'sena' } }) : null }
  const pagoDe = async (reservaId) => { const o = await obligacionDe(reservaId); return o ? prisma.intencionPago.findFirst({ where: { obligacionId: o.obligacionId } }) : null }
  let secuencia = 0
  // A provider notification about one payment attempt of a checkout, signed like the real ones.
  const notificar = (pagoId, intento, status, monto, eventId) => {
    const raw = JSON.stringify({ id: eventId, data: { id: intento, external_reference: pagoId, status, currency_id: 'ARS', transaction_amount: monto, date_last_updated: new Date(Date.now() + (secuencia += 1) * 1000).toISOString() } })
    return fin.ingerirEventoProveedor({ rawBody: raw, signature: proveedor.firmar(raw), receivedAt: new Date().toISOString() })
  }
  const resultadoDe = (r) => r.status + (r.result ? ':' + r.result : '') + (r.reason ? ':' + r.reason : '')
`

test('TURNOS seña PostgreSQL: the deposit is half of the price of the chosen service (20.000 -> 10.000, 25.000 -> 12.500, 30.000 -> 15.000), is asked only once the provider accepts, and only the verified Mercado Pago notification marks it as paid', { skip, timeout: 300000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // 1. The same rule everywhere: half of the price, with cents when the price is odd.
      out.regla = [20000, 25000, 30000, 2501, 1].map((precio) => senaDePrecio(precio))

      // 2. Three requests, one per variant. The body tries to dictate the money: it is ignored.
      const pedidos = {}
      const horas = { 'Masaje base': '10:00', 'Espalda completa': '11:00', 'Cuerpo completo': '12:00' }
      for (const [variante, hora] of Object.entries(horas)) {
        const pedido = await solicitar('tok-ana', p, 0, hora, variante)
        pedidos[variante] = pedido.body
      }
      out.pedidos = Object.entries(pedidos).map(([variante, t]) => [variante, t.estado, t.tarifaNombre, t.precioFinal, t.sena])
      const espalda = pedidos['Espalda completa']
      out.enBase = await fila(espalda.id).then((f) => [f.estado, String(f.precioFinal), f.tarifaNombre, Object.keys(f).filter((k) => /sena|deposit|pago/iu.test(k))])

      // 3. Still a request: nothing to pay, no order, no obligation.
      const antes = await pagar('tok-ana', espalda.id)
      out.antesDeAceptar = [antes.status, antes.body.code, await orden(espalda.reservaId)]

      // 4. The provider accepts: the deposit becomes payable and its checkout is prepared for the notice.
      const aceptada = await aceptar('tok-p', espalda.id)
      out.aceptada = [aceptada.status, aceptada.body.estado, aceptada.body.sena]
      const aviso = await avisoDe(espalda.id)
      out.aviso = [aviso.resultado, aviso.cuenta === ana.id, aviso.sena.monto, aviso.sena.pagable, /^https:\\/\\/www\\.mercadopago\\.com\\.ar\\//u.test(aviso.sena.url)]
      const o = await orden(espalda.reservaId)
      const ob = await obligacionDe(espalda.reservaId)
      out.orden = [o.origen, o.estado, o.tenantId === ana.tenantId, o.prestadorTenantId === p.tenantId, o.reservaTenantId === p.tenantId, o.requierePresupuesto, o.compromisoId, o.solicitudId]
      out.obligacion = [ob.tramo, ob.origenImporte, String(ob.monto), ob.moneda, ob.estado, ob.presupuestoId]

      // 5. Payment authority fields are rejected; an empty request gets the SAME checkout.
      const checkoutManipulado = await pagar('tok-ana', espalda.id, { monto: 1, precio: 1, clienteId: beto.id, tenantId: beto.tenantId, estado: 'paid' })
      out.checkoutManipulado = [checkoutManipulado.status, checkoutManipulado.body.code]
      const checkout = await pagar('tok-ana', espalda.id)
      out.checkout = [checkout.status, checkout.body.monto, checkout.body.moneda, checkout.body.checkoutUrl === aviso.sena.url]
      out.otraVez = (await pagar('tok-ana', espalda.id)).body.checkoutUrl === checkout.body.checkoutUrl
      out.pagos = await prisma.intencionPago.count({ where: { obligacionId: ob.obligacionId } })
      out.linkAbierto = [(await senaDe('tok-ana', espalda.id)).estado, (await obligacionDe(espalda.reservaId)).estado]
      const pago = await pagoDe(espalda.reservaId)
      out.montoDelPago = [String(pago.monto), String(pago.comisionMarketplace)]

      // 6. A forged notification, a wrong amount and a rejected attempt change nothing.
      const falsa = JSON.stringify({ id: run + '-falsa', data: { id: 'mp-x', external_reference: pago.pagoId, status: 'approved', currency_id: 'ARS', transaction_amount: '12500.00', date_last_updated: new Date().toISOString() } })
      out.firmaInvalida = resultadoDe(await fin.ingerirEventoProveedor({ rawBody: falsa, signature: 'firma-inventada', receivedAt: new Date().toISOString() }))
      out.montoDistinto = resultadoDe(await notificar(pago.pagoId, 'mp-' + run + '-1', 'approved', '1.00', run + '-evt-monto'))
      out.rechazado = resultadoDe(await notificar(pago.pagoId, 'mp-' + run + '-2', 'rejected', '12500.00', run + '-evt-rechazo'))
      out.sigueSinPagar = [(await senaDe('tok-ana', espalda.id)).estado, (await obligacionDe(espalda.reservaId)).estado]
      out.antesDelWebhook = (await fila(espalda.id)).estado

      // 7. The approval, and the same notification again.
      out.aprobado = resultadoDe(await notificar(pago.pagoId, 'mp-' + run + '-3', 'approved', '12500.00', run + '-evt-ok'))
      out.repetido = resultadoDe(await notificar(pago.pagoId, 'mp-' + run + '-3', 'approved', '12500.00', run + '-evt-ok'))
      const versionAntes = (await fila(espalda.id)).version
      out.pagada = [(await senaDe('tok-ana', espalda.id)), (await obligacionDe(espalda.reservaId)).estado]
      const paraPrestador = (await call('GET', '/tus/v1/prestador/turnos', 'tok-p')).body.items.find((t) => t.id === espalda.id)
      out.prestadorVe = [paraPrestador.estado, paraPrestador.sena, paraPrestador.tarifaNombre, paraPrestador.precioFinal]
      // The reservation itself was not touched by the payment.
      const despues = await fila(espalda.id)
      out.reservaIntacta = [despues.estado, despues.version === versionAntes, String(despues.precioFinal)]
      out.contabilidad = [await prisma.instantaneaComision.count({ where: { obligacionId: ob.obligacionId } }), String((await prisma.instantaneaComision.findFirst({ where: { obligacionId: ob.obligacionId } })).montoComision), await prisma.liquidacionServicio.count({ where: { obligacionId: ob.obligacionId } }), await prisma.eventoWebhookPago.count({ where: { obligacionId: ob.obligacionId } })]

      // 8. Already paid: no second payment; and its price can no longer change.
      const dePago = await pagar('tok-ana', espalda.id)
      out.yaPagada = [dePago.status, dePago.body.code, await prisma.intencionPago.count({ where: { obligacionId: ob.obligacionId } })]
      out.precioFijo = await codeOf(() => turnos.adminModificarPrecio({ reservaId: espalda.id, nuevoPrecio: 1n, motivo: 'prueba de cambio', adminId: 'admin-1' }))

      // 9. The other two variants, accepted: each one its own half.
      for (const variante of ['Masaje base', 'Cuerpo completo']) await aceptar('tok-p', pedidos[variante].id)
      const lista = await misTurnos('tok-ana')
      out.variantes = ['Masaje base', 'Espalda completa', 'Cuerpo completo'].map((variante) => { const t = lista.find((x) => x.id === pedidos[variante].id); return [variante, t.precioFinal, t.sena.monto, t.sena.estado] })
      for (const variante of ['Masaje base', 'Cuerpo completo']) await pagar('tok-ana', pedidos[variante].id)
      out.obligaciones = await Promise.all(['Masaje base', 'Cuerpo completo'].map(async (variante) => String((await obligacionDe(pedidos[variante].reservaId)).monto)))

      // 10. An odd price keeps its cents (half of 2.501 is 1.250,50).
      const cuello = await solicitar('tok-ana', p, 0, '13:00', 'Cuello')
      await aceptar('tok-p', cuello.body.id)
      const pagoCuello = await pagar('tok-ana', cuello.body.id)
      out.impar = [cuello.body.sena.monto, pagoCuello.body.monto, String((await obligacionDe(cuello.body.reservaId)).monto), c.formatearPesos(pagoCuello.body.monto), c.formatearPesos(12500), c.formatearPesos(25000)]

      // 11. The client cancels a turno whose deposit is paid: it stays visible as paid (the refund
      //     is a platform decision, never automatic).
      const cancelada = await call('POST', '/tus/v1/cliente/turnos/' + espalda.id + '/cancelar', 'tok-ana')
      out.canceladaPagada = [cancelada.body.estado, (await senaDe('tok-ana', espalda.id))?.estado ?? null]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.regla, [10000, 12500, 15000, 1250.5, 0.5], 'one rule: half of the price')
  assert.deepEqual(r.pedidos, [
    ['Masaje base', 'pending', 'Masaje base', 20000, { monto: 10000, moneda: 'ARS', estado: 'not_due' }],
    ['Espalda completa', 'pending', 'Espalda completa', 25000, { monto: 12500, moneda: 'ARS', estado: 'not_due' }],
    ['Cuerpo completo', 'pending', 'Cuerpo completo', 30000, { monto: 15000, moneda: 'ARS', estado: 'not_due' }],
  ], 'the price is the one of the variant in the database; the money fields of the body are ignored')
  assert.deepEqual(r.enBase, ['pending', '25000', 'Espalda completa', []], 'the reservation stores its price and nothing about the deposit')
  assert.deepEqual(r.antesDeAceptar, [409, 'DEPOSIT_NOT_PAYABLE', null], 'a request has no deposit to pay and no payment order')
  assert.deepEqual(r.aceptada, [200, 'awaiting_payment', { monto: 12500, moneda: 'ARS', estado: 'pending' }])
  assert.deepEqual(r.aviso, ['awaiting_payment', true, 12500, true, true], 'the notice of the acceptance carries the amount and the real checkout')
  assert.deepEqual(r.orden, ['turno', 'accepted', true, true, true, false, null, null], 'the payment order of the turno: its client, its provider, its reservation')
  assert.deepEqual(r.obligacion, ['sena', 'booked_price', '1250000', 'ARS', 'pending_payment', null], '12.500,00 in cents, from the booked price')
  assert.deepEqual(r.checkoutManipulado, [400, 'UNTRUSTED_PAYMENT_FIELDS'])
  assert.deepEqual(r.checkout, [200, 12500, 'ARS', true], 'the client gets the same checkout using the reservation and session only')
  assert.equal(r.otraVez, true)
  assert.equal(r.pagos, 1, 'asking for the payment again never creates a second payment')
  assert.deepEqual(r.linkAbierto, ['pending', 'pending_payment'], 'generating or opening the link pays nothing')
  assert.deepEqual(r.montoDelPago, ['1250000', '125000'], 'amount and commission frozen by the backend')
  assert.equal(r.firmaInvalida, 'invalid:INVALID_SIGNATURE')
  assert.equal(r.montoDistinto, 'recorded:quarantined:amount_mismatch')
  assert.equal(r.rechazado, 'recorded:no_op:hosted_checkout_attempt_rejected')
  assert.deepEqual(r.sigueSinPagar, ['pending', 'pending_payment'], 'a rejected attempt leaves the deposit payable')
  assert.equal(r.antesDelWebhook, 'awaiting_payment', 'provider acceptance and a checkout never confirm the reservation')
  assert.equal(r.aprobado, 'recorded:applied')
  assert.match(r.repetido, /^duplicate/u, 'the same notification twice is applied once')
  assert.deepEqual(r.pagada, [{ monto: 12500, moneda: 'ARS', estado: 'paid' }, 'paid'])
  assert.deepEqual(r.prestadorVe, ['confirmed', { monto: 12500, moneda: 'ARS', estado: 'paid' }, 'Espalda completa', 25000])
  assert.deepEqual(r.reservaIntacta, ['confirmed', true, '25000'], 'a duplicate webhook does not rewrite the reservation or the price')
  assert.deepEqual(r.contabilidad, [1, '125000', 1, 3], 'one commission snapshot, one settlement; the three signed notifications are kept in the inbox (the forged one and the repetition are not)')
  assert.deepEqual(r.yaPagada, [409, 'DEPOSIT_ALREADY_PAID', 1])
  assert.equal(r.precioFijo, 'DEPOSIT_ALREADY_ISSUED')
  assert.deepEqual(r.variantes, [['Masaje base', 20000, 10000, 'pending'], ['Espalda completa', 25000, 12500, 'paid'], ['Cuerpo completo', 30000, 15000, 'pending']])
  assert.deepEqual(r.obligaciones, ['1000000', '1500000'])
  assert.deepEqual(r.impar, [1250.5, 1250.5, '125050', '$1.250,50', '$12.500', '$25.000'])
  assert.deepEqual(r.canceladaPagada, ['cancelled', 'paid'])
})

test('TURNOS seña PostgreSQL seguridad: only the client of the turno gets its checkout; no body field moves the client, the price, the deposit, the state, the provider or the tenant; a provider without online payment charges nothing; the order is not a work; the database enforces the shape', { skip, timeout: 300000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // 1. Ana requests; the body tries everything.
      const trampa = { clienteId: beto.id, userId: beto.id, clienteTenantId: beto.tenantId, tenantId: beto.tenantId, prestadorId: 'otro', precio: 1, precioFinal: 1, precioLista: 1, sena: 1, 'seña': 1, estado: 'confirmed', esInvitado: true }
      const intento = await solicitar('tok-ana', p, 1, '09:00', 'Espalda completa', trampa)
      out.inyeccion = [intento.status, intento.body.code, await prisma.reserva.count({ where: { clienteId: beto.id } })]
      const pedido = await solicitar('tok-ana', p, 1, '10:00', 'Espalda completa')
      const f = await fila(pedido.body.id)
      out.pedido = [pedido.status, f.estado, f.clienteId === ana.id, f.clienteTenantId === ana.tenantId, f.tenantId === p.tenantId, String(f.precioFinal), f.esInvitado]
      out.deBeto = (await misTurnos('tok-beto')).length
      // A variant of ANOTHER provider is not a price of this one.
      const otro = await prestador('otro', 'Otro ' + run, [['Barato', 1]])
      const ajena = await call('POST', '/tus/v1/prestadores/' + p.perfilId + '/turnos/solicitudes', 'tok-beto', { oficioId: oficio.id, inicio: a(1, '15:00'), tarifaId: otro.tarifas['Barato'] })
      out.tarifaAjena = [ajena.status, ajena.body.code, await prisma.reserva.count({ where: { clienteId: beto.id, fechaInicio: new Date(a(1, '15:00')) } })]

      // 2. Accepted. Who can ask for the checkout of Ana's deposit?
      await aceptar('tok-p', pedido.body.id)
      await avisoDe(pedido.body.id)
      const pagosAntesDeManipular = await prisma.intencionPago.count()
      const pagoManipulado = await pagar('tok-ana', pedido.body.id, trampa)
      out.pagoManipulado = [pagoManipulado.status, pagoManipulado.body.code, (await prisma.intencionPago.count()) === pagosAntesDeManipular]
      out.accesos = []
      for (const [quien, token] of [['visitante', null], ['otro cliente', 'tok-beto'], ['el prestador', 'tok-p'], ['la clienta', 'tok-ana']]) {
        const respuesta = await pagar(token, pedido.body.id)
        out.accesos.push([quien, respuesta.status, respuesta.body?.code ?? null, respuesta.body?.monto ?? null])
      }
      const o = await orden(pedido.body.reservaId)
      const ob = await obligacionDe(pedido.body.reservaId)
      out.unaSola = [await prisma.trabajo.count({ where: { reservaId: pedido.body.reservaId } }), await prisma.obligacionPagoServicio.count({ where: { trabajoId: o.trabajoId } }), await prisma.intencionPago.count({ where: { obligacionId: ob.obligacionId } }), o.tenantId === ana.tenantId, ob.clienteId === ana.tenantId, String(ob.monto)]
      // Beto cannot pay Ana's order through finance either: it is not his work.
      out.finanzasAjenas = await codeOf(() => fin.iniciarCheckout({ tenantId: beto.tenantId, actorId: beto.id, correlationId: 'c', trabajoId: o.trabajoId, idempotencyKey: run + '-robo' }))
      // The provider cannot create a payment for its own client either.
      out.finanzasPrestador = await codeOf(() => fin.iniciarCheckout({ tenantId: p.tenantId, actorId: 'u', correlationId: 'c', trabajoId: o.trabajoId, idempotencyKey: run + '-prov' }))

      // 3. The order of a turno is not a work of the parties.
      const comoCliente = { tenantId: ana.tenantId, actorId: ana.id, correlationId: 'c' }
      const comoPrestador = { tenantId: p.tenantId, actorId: 'u', correlationId: 'c' }
      out.noEsTrabajo = [
        (await work.listWorks(comoCliente)).length, (await work.listWorks(comoPrestador)).length,
        await codeOf(() => work.getWork(comoCliente, o.trabajoId)),
        await codeOf(() => work.startWork({ ...comoPrestador, trabajoId: o.trabajoId, expectedVersion: 1, idempotencyKey: run + '-start', requestHash: 'h', createdAt: new Date().toISOString() })),
        await codeOf(() => work.cancelWork({ ...comoCliente, trabajoId: o.trabajoId, expectedVersion: 1, idempotencyKey: run + '-cancel', requestHash: 'h', createdAt: new Date().toISOString() })),
        (await new FuenteTrabajosAdminPrisma(prisma).pagina({ pagina: 1, tamano: 50, q: o.trabajoId, estado: '' })).total,
        (await prisma.trabajo.findFirst({ where: { trabajoId: o.trabajoId } })).estado,
      ]

      // 4. Online payments are on but this provider cannot charge (no Mercado Pago account): it
      //    cannot accept. The turno is never confirmed for free and never left waiting for a
      //    payment nobody can make; the request stays pending.
      const sinCobro = await prestador('sincobro', 'Sin Cobro ' + run, [['Consulta', 8000]])
      sesion('tok-sc', 'u-' + sinCobro.tenantId, sinCobro.tenantId)
      const t2 = await solicitar('tok-ana', sinCobro, 1, '10:00', 'Consulta')
      const a2 = await aceptar('tok-sc', t2.body.id)
      const p2 = await pagar('tok-ana', t2.body.id)
      out.sinCobro = [t2.body.sena, a2.status, a2.body.code, (await fila(t2.body.id)).estado, p2.status, p2.body.code, await orden(t2.body.reservaId), avisos.filter((x) => x.reservaId === t2.body.id).length]
      // Once it connects its account the same request can be accepted, and payment opens.
      conCobro.add(sinCobro.tenantId)
      const a2b = await aceptar('tok-sc', t2.body.id)
      out.luegoConectado = [a2b.status, a2b.body.estado, a2b.body.sena]

      // 4b. Online payments off for the WHOLE platform: no deposit exists, a price-less service can
      //     be requested, and accepting confirms as it did before the deposit existed.
      // What a client is told BEFORE requesting (the form and the assistant read this): the real
      // price of the chosen variant and the deposit the backend computes from it.
      const antesDePedir = async (prestadorDe, variante) => {
        const agenda = await turnos.agendaSemanal({ prestadorId: prestadorDe.perfilId, oficioId: oficio.id, desde: lunes, ...(variante ? { tarifaId: prestadorDe.tarifas[variante] } : {}) })
        const [servicio] = await turnos.serviciosDePrestador({ perfilId: prestadorDe.perfilId })
        return [agenda.precio ?? null, agenda.sena ?? null, servicio.senaRequerida]
      }
      out.anunciado = [await antesDePedir(p, 'Masaje base'), await antesDePedir(p, 'Espalda completa'), await antesDePedir(p, 'Cuerpo completo'), await antesDePedir(p, 'Cuello')]
      plataformaSinPagos = true
      out.anunciadoSinPagos = await antesDePedir(p, 'Espalda completa')
      const apagada = await prestador('apagada', 'Sin Pagos ' + run, [['Consulta', 8000]])
      const sinPrecio = await prestador('sinprecio', 'A Convenir ' + run, [])
      sesion('tok-ap', 'u-' + apagada.tenantId, apagada.tenantId); sesion('tok-sp', 'u-' + sinPrecio.tenantId, sinPrecio.tenantId)
      const t5 = await solicitar('tok-ana', apagada, 1, '10:00', 'Consulta')
      const a5 = await aceptar('tok-ap', t5.body.id)
      const aviso5 = await avisoDe(t5.body.id)
      const p5 = await pagar('tok-ana', t5.body.id)
      const t6 = await solicitar('tok-ana', sinPrecio, 1, '10:00', null)
      const a6 = await aceptar('tok-sp', t6.body.id)
      out.plataformaApagada = [t5.body.sena ?? null, a5.body.estado, a5.body.sena ?? null, aviso5.resultado, aviso5.sena, p5.status, p5.body.code, await orden(t5.body.reservaId), t6.status, a6.body.estado, (await fila(t5.body.id)).solicitudExpiraEn !== null]
      plataformaSinPagos = false

      // 5. No price, a guest and a rejected request have no deposit at all.
      const gratis = await prestador('gratis', 'A Convenir ' + run, [])
      conCobro.add(gratis.tenantId)
      sesion('tok-g', 'u-' + gratis.tenantId, gratis.tenantId)
      const t3 = await solicitar('tok-ana', gratis, 1, '10:00', null)
      const manual = await turnos.crearTurnoManual({ prestadorTenantId: p.tenantId, oficioId: oficio.id, tarifaId: p.tarifas['Masaje base'], inicio: a(1, '16:00'), clienteNombre: 'Cliente de mostrador' })
      const t4 = await solicitar('tok-beto', p, 1, '12:00', 'Masaje base')
      const rechazada = await call('POST', '/tus/v1/prestador/turnos/' + t4.body.id + '/rechazar', 'tok-p')
      out.sinSena = [t3.status, t3.body.code, manual.sena ?? null, t4.body.sena.estado, rechazada.body.sena ?? null, (await senaDe('tok-beto', t4.body.id))]

      // 6. The database itself: an order needs its reservation, one order per reservation, a turno
      //    only has a deposit, and the identified account of a conversation must exist.
      const ahora = new Date()
      const trabajo = (id, extra) => prisma.trabajo.create({ data: { id, versionContrato: '1.0.0', trabajoId: id, tenantId: ana.tenantId, prestadorTenantId: p.tenantId, prestadorId: p.prestadorId, origen: 'turno', estado: 'accepted', version: 1, requierePresupuesto: false, fechaCreacion: ahora, fechaActualizacion: ahora, ...extra } })
      const obligacion = (id, extra) => prisma.obligacionPagoServicio.create({ data: { id, versionContrato: '1.0.0', obligacionId: id, tenantId: o.tenantId, clienteId: o.tenantId, prestadorTenantId: o.prestadorTenantId, prestadorId: o.prestadorId, trabajoId: o.trabajoId, origenImporte: 'booked_price', monto: 100n, moneda: 'ARS', estado: 'pending_payment', actorId: 'x', correlacionId: 'x', fechaCreacion: ahora, fechaActualizacion: ahora, ...extra } })
      const contacto = await prisma.contactoWhatsapp.create({ data: { id: run + '-contacto', waId: '549379' + String(Date.now()).slice(-7), version: 1, fechaCreacion: ahora } })
      const conversacion = (id, extra) => prisma.conversacionWhatsapp.create({ data: { id, contactoId: contacto.id, estado: 'closed', modo: 'bot', abiertaEn: ahora, ultimoMensajeEn: ahora, estadoConversacional: {}, ...extra } })
      out.base = {
        sinReserva: await restriccion(() => trabajo(run + '-sin-reserva', {})),
        segundaOrden: await restriccion(() => trabajo(run + '-segunda', { reservaTenantId: p.tenantId, reservaId: pedido.body.reservaId })),
        reservaDeOtroPrestador: await restriccion(() => trabajo(run + '-cruzada', { reservaTenantId: sinCobro.tenantId, reservaId: t2.body.reservaId })),
        conPresupuesto: await restriccion(() => trabajo(run + '-presu', { reservaTenantId: sinCobro.tenantId, prestadorTenantId: sinCobro.tenantId, prestadorId: sinCobro.prestadorId, reservaId: t2.body.reservaId, requierePresupuesto: true })),
        saldoDeTurno: await restriccion(() => obligacion(run + '-saldo', { tramo: 'saldo' })),
        totalDeTurno: await restriccion(() => obligacion(run + '-total', { tramo: 'total' })),
        senaConPresupuesto: await restriccion(() => obligacion(run + '-sena2', { tramo: 'sena', origenImporte: 'accepted_budget' })),
        cuentaInexistente: await restriccion(() => conversacion(run + '-conv-1', { cuentaIdentificadaId: 'cuenta-que-no-existe', identificadaEn: ahora })),
        sinFecha: await restriccion(() => conversacion(run + '-conv-2', { cuentaIdentificadaId: ana.id })),
        valida: await restriccion(() => conversacion(run + '-conv-3', { cuentaIdentificadaId: ana.id, identificadaEn: ahora })),
      }
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.inyeccion, [400, 'UNTRUSTED_BOOKING_FIELDS', 0], 'client, provider, price, deposit and state fields are rejected before creating anything')
  assert.deepEqual(r.pedido, [201, 'pending', true, true, true, '25000', false], 'client = session, provider = path, price = database')
  assert.equal(r.deBeto, 0, 'nothing was requested in the name of the account the body named')
  assert.deepEqual(r.tarifaAjena, [400, 'INVALID_PARAMS', 0], "another provider's variant is rejected and creates nothing")
  assert.deepEqual(r.pagoManipulado, [400, 'UNTRUSTED_PAYMENT_FIELDS', true], 'payment authority fields are rejected without creating another payment')
  assert.deepEqual(r.accesos, [
    ['visitante', 401, 'UNAUTHORIZED', null],
    ['otro cliente', 404, 'NOT_FOUND', null],
    ['el prestador', 404, 'NOT_FOUND', null],
    ['la clienta', 200, null, 12500],
  ])
  assert.deepEqual(r.unaSola, [1, 1, 1, true, true, '1250000'], 'one order, one obligation, one payment, of the real client and for the real amount')
  assert.equal(r.finanzasAjenas, 'NOT_FOUND', "another tenant cannot even see the order")
  assert.equal(r.finanzasPrestador, 'FORBIDDEN', 'only the client pays its deposit')
  assert.deepEqual(r.noEsTrabajo, [0, 0, 'NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 0, 'accepted'], 'the order is invisible to the work screens and accepts no work command')
  assert.deepEqual(r.sinCobro, [{ monto: 4000, moneda: 'ARS', estado: 'not_due' }, 409, 'PROVIDER_PAYMENT_ACCOUNT_REQUIRED', 'pending', 409, 'DEPOSIT_NOT_PAYABLE', null, 0], 'a provider that cannot charge cannot accept: nothing is confirmed, charged, created or announced')
  assert.deepEqual(r.luegoConectado, [200, 'awaiting_payment', { monto: 4000, moneda: 'ARS', estado: 'pending' }])
  assert.deepEqual(r.anunciado, [[20000, 10000, true], [25000, 12500, true], [30000, 15000, true], [2501, 1250.5, true]], 'price and deposit shown before requesting are the backend\'s')
  assert.deepEqual(r.anunciadoSinPagos, [25000, null, false], 'with online payments off the price is shown and no deposit is announced')
  assert.deepEqual(r.plataformaApagada, [null, 'confirmed', null, 'confirmed', null, 409, 'DEPOSIT_NOT_PAYABLE', null, 201, 'confirmed', true], 'payments off for the platform: no deposit is announced or charged and accepting confirms, as before')
  assert.deepEqual(r.sinSena, [409, 'SERVICE_PRICE_REQUIRED', null, 'not_due', null, null])
  assert.deepEqual(r.base, {
    sinReserva: 'ck_trabajos_origen_coherente',
    segundaOrden: 'unique:reserva_tenant_id,reserva_id',
    reservaDeOtroPrestador: 'ck_trabajos_origen_coherente',
    conPresupuesto: 'ck_trabajos_origen_coherente',
    saldoDeTurno: 'ck_obligaciones_pago_tramo_cadena',
    totalDeTurno: 'ck_obligaciones_pago_tramo_cadena',
    senaConPresupuesto: 'ck_obligaciones_pago_origen_importe',
    cuentaInexistente: 'foreign_key',
    sinFecha: 'ck_conversaciones_whatsapp_identificacion',
    valida: 'ok',
  })
})

test('TURNOS seña PostgreSQL concurrencia: two clients asking for the same time -> one request; several checkouts of the same deposit at once -> one order, one obligation, one payment; the same approval several times at once -> applied once', { skip, timeout: 300000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // 1. Ana and Beto ask for the same time at once.
      const mismos = await Promise.all([solicitar('tok-ana', p, 2, '10:00', 'Cuerpo completo'), solicitar('tok-beto', p, 2, '10:00', 'Cuerpo completo')])
      out.mismoHorario = [mismos.map((m) => m.status).sort(), mismos.filter((m) => m.status !== 201).map((m) => m.body.code), await prisma.reserva.count({ where: { tenantId: p.tenantId, fechaInicio: new Date(a(2, '10:00')), estado: 'pending' } })]
      const ganador = mismos.find((m) => m.status === 201)
      const token = ganador.body.clienteCuentaId === ana.id ? 'tok-ana' : 'tok-beto'

      // 2. The provider answers twice at once: one confirmation, one notice, one prepared checkout.
      const respuestas = await Promise.all([aceptar('tok-p', ganador.body.id), aceptar('tok-p', ganador.body.id)])
      out.aceptadas = respuestas.map((x) => [x.status, x.body.estado])
      await avisoDe(ganador.body.id)
      await new Promise((resolve) => setTimeout(resolve, 400))
      out.avisos = avisos.filter((x) => x.reservaId === ganador.body.id).length

      // 3. Double click, two tabs, the assistant and the Web at once.
      const pedidos = await Promise.all(Array.from({ length: 6 }, () => pagar(token, ganador.body.id)))
      out.checkouts = [[...new Set(pedidos.map((x) => x.status))].sort(), [...new Set(pedidos.filter((x) => x.status === 200).map((x) => x.body.checkoutUrl))].length, [...new Set(pedidos.filter((x) => x.status !== 200).map((x) => x.body.code))]]
      const o = await orden(ganador.body.reservaId)
      const ob = await obligacionDe(ganador.body.reservaId)
      out.unicos = [await prisma.trabajo.count({ where: { reservaId: ganador.body.reservaId } }), await prisma.obligacionPagoServicio.count({ where: { trabajoId: o.trabajoId } }), await prisma.intencionPago.count({ where: { obligacionId: ob.obligacionId } }), proveedor.checkouts.filter((x) => x.trabajoId === o.trabajoId).length]

      // 4. Mercado Pago delivers the same approval five times at once.
      const pago = await pagoDe(ganador.body.reservaId)
      const eventos = await Promise.allSettled(Array.from({ length: 5 }, () => notificar(pago.pagoId, 'mp-' + run + '-c', 'approved', '15000.00', run + '-evt-c')))
      const estados = eventos.map((e) => (e.status === 'fulfilled' ? e.value.status + (e.value.result ? ':' + e.value.result : '') : 'error:' + (e.reason?.code ?? '')))
      out.aprobaciones = [estados.filter((e) => e === 'recorded:applied').length, estados.every((e) => e === 'recorded:applied' || e.startsWith('duplicate') || e.startsWith('error:'))]
      // A provider retries a notification that failed: it is settled now.
      out.reintento = resultadoDe(await notificar(pago.pagoId, 'mp-' + run + '-c', 'approved', '15000.00', run + '-evt-c'))
      out.final = [(await obligacionDe(ganador.body.reservaId)).estado, await prisma.instantaneaComision.count({ where: { obligacionId: ob.obligacionId } }), await prisma.liquidacionServicio.count({ where: { obligacionId: ob.obligacionId } }), (await senaDe(token, ganador.body.id)).estado]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.mismoHorario, [[201, 409], ['SLOT_OCCUPIED'], 1], 'one request holds the time; the other client is told it was taken')
  assert.deepEqual(r.aceptadas, [[200, 'awaiting_payment'], [200, 'awaiting_payment']], 'the same answer twice is the same result')
  assert.equal(r.avisos, 1, 'the client is told once')
  assert.ok(r.checkouts[0].includes(200), 'at least one request gets the checkout')
  assert.equal(r.checkouts[1], 1, 'every request that got a checkout got the SAME one')
  for (const code of r.checkouts[2]) assert.ok(['IN_PROGRESS', 'PAYMENT_NOT_AVAILABLE'].includes(code), `a request that lost the race is told to retry: ${code}`)
  assert.deepEqual(r.unicos, [1, 1, 1, 1], 'one order, one obligation, one payment, one call to the provider')
  assert.deepEqual(r.aprobaciones, [1, true], 'the approval is applied exactly once')
  assert.match(r.reintento, /^duplicate/u)
  assert.deepEqual(r.final, ['paid', 1, 1, 'paid'])
})

test('TURNOS seña upgrade PG16: the migration runs over existing works, obligations and conversations without touching them and only widens what is accepted', { skip: !adminUrl && 'TUS_MIGRATIONS_PG_ADMIN_URL not set (disposable PostgreSQL 16 only)', timeout: 600000 }, async () => {
  const database = `tus_sena_${Date.now().toString(36)}`
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${database}`)
  const target = new URL(adminUrl)
  target.pathname = `/${database}`
  const db = new Client({ connectionString: target.toString() })
  const migrar = () => spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, env: { ...process.env, DATABASE_URL: target.toString(), DIRECT_URL: target.toString() }, encoding: 'utf8', timeout: 480000 })
  const def = async (name) => (await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = $1`, [name])).rows[0]?.d ?? null
  const intento = async (sql, params = []) => { try { await db.query(sql, params); return 'ok' } catch (error) { return error.constraint ?? error.code } }
  try {
    const primera = migrar()
    assert.equal(primera.status, 0, `migrate-deploy failed:\n${(primera.stdout + primera.stderr).slice(-1500)}`)
    await db.connect()

    // 1. Back to the database of today: the four CHECKs as the previous migrations left them, the
    //    conversation without the new columns, and this migration not applied.
    await db.query('BEGIN')
    await db.query(`DROP INDEX public."ix_reservas_esperando_pago"`)
    await db.query(`ALTER TABLE public."reservas" DROP CONSTRAINT "ck_reservas_estado", DROP CONSTRAINT "ck_reservas_solicitud_vigencia"`)
    await db.query(`ALTER TABLE public."reservas" ADD CONSTRAINT "ck_reservas_estado" CHECK ("estado" IN ('pending', 'confirmed', 'rejected', 'expired', 'cancelled', 'cancelled-late', 'no-show', 'completed')) NOT VALID`)
    await db.query(`ALTER TABLE public."reservas" ADD CONSTRAINT "ck_reservas_solicitud_vigencia" CHECK ("estado" <> 'pending' OR "solicitud_expira_en" IS NOT NULL) NOT VALID`)
    await db.query(`DROP INDEX public."ix_conversaciones_whatsapp_cuenta_identificada"`)
    await db.query(`ALTER TABLE public."conversaciones_whatsapp" DROP CONSTRAINT "ck_conversaciones_whatsapp_identificacion", DROP CONSTRAINT "fk_conversaciones_whatsapp_cuenta_identificada", DROP COLUMN "cuenta_identificada_id", DROP COLUMN "identificada_en"`)
    await db.query(`ALTER TABLE public."trabajos" DROP CONSTRAINT "ck_trabajos_origen", DROP CONSTRAINT "ck_trabajos_origen_coherente"`)
    await db.query(`ALTER TABLE public."trabajos" ADD CONSTRAINT "ck_trabajos_origen" CHECK ("origen" IN ('marketplace', 'solicitud'))`)
    await db.query(`ALTER TABLE public."trabajos" ADD CONSTRAINT "ck_trabajos_origen_coherente" CHECK (("origen" = 'marketplace' AND "compromiso_id" IS NOT NULL AND "publicacion_id" IS NOT NULL AND "solicitud_id" IS NULL) OR ("origen" = 'solicitud' AND "solicitud_id" IS NOT NULL AND "compromiso_id" IS NULL AND "publicacion_id" IS NULL))`)
    await db.query(`ALTER TABLE public."obligaciones_pago_servicio" DROP CONSTRAINT "ck_obligaciones_pago_origen_importe", DROP CONSTRAINT "ck_obligaciones_pago_tramo_cadena"`)
    await db.query(`ALTER TABLE public."obligaciones_pago_servicio" ADD CONSTRAINT "ck_obligaciones_pago_origen_importe" CHECK (("origen_importe" = 'accepted_budget' AND "presupuesto_id" IS NOT NULL AND "presupuesto_version" IS NOT NULL) OR ("origen_importe" = 'fixed_price_commitment' AND "presupuesto_id" IS NULL AND "presupuesto_version" IS NULL))`)
    await db.query(`ALTER TABLE public."obligaciones_pago_servicio" ADD CONSTRAINT "ck_obligaciones_pago_tramo_cadena" CHECK (("tramo" = 'total' AND "publicacion_id" IS NOT NULL AND "compromiso_id" IS NOT NULL) OR ("tramo" IN ('sena', 'saldo') AND "publicacion_id" IS NULL AND "compromiso_id" IS NULL AND "origen_importe" = 'accepted_budget'))`)
    await db.query(`DELETE FROM _prisma_migrations WHERE migration_name = $1`, [MIGRACION])
    await db.query('COMMIT')
    assert.doesNotMatch(await def('ck_trabajos_origen'), /turno/u, 'the previous rule')

    // 2. Rows as production has them: a request-born work with its accepted budget, its deposit
    //    and its balance, and a conversation of the assistant.
    await db.query(`INSERT INTO "TusTenant"(id, slug, name, status, "createdAt", "updatedAt") VALUES ('t-cli', 't-cli', 'Cliente', 'active', now(), now()), ('t-pre', 't-pre', 'Prestador', 'active', now(), now())`)
    await db.query(`INSERT INTO "User"(id, email, "normalizedEmail", "displayName", "updatedAt") VALUES ('u-up', 'up@t.invalid', 'up@t.invalid', 'Persona', now())`)
    await db.query(`INSERT INTO "Account"(id, "userId", "tenantId", status, "createdAt", "updatedAt") VALUES ('acc-up', 'u-up', 't-cli', 'active', now(), now())`)
    await db.query(`INSERT INTO prestadores(id, tenant_id, prestador_id, cohorte, ubicacion_id, zona_horaria, roles_personal, version_politica_operativa, estado, fecha_creacion, fecha_actualizacion) VALUES ('pr-up', 't-pre', 'p-up', 'repairs-trades', 'loc', 'America/Argentina/Buenos_Aires', ARRAY['owner'], 'v1', 'active', now(), now())`)
    await db.query(`INSERT INTO solicitudes_servicio(id, cuenta_id, categoria, titulo, nombre_publico, zona, latitud, longitud, urgencia, estado, fecha_creacion, fecha_actualizacion, expira_en, visibilidad, prestador_tenant_id, prestador_id, estado_asignacion, origen) VALUES ('sol-up', 'acc-up', 'plomeria', 'Pierde agua la canilla', 'Persona', 'Centro', -27.47, -58.83, 'esta_semana', 'abierta', now(), now(), now() + interval '7 days', 'dirigida', 't-pre', 'p-up', 'aceptada', 'web_directory')`)
    await db.query(`INSERT INTO trabajos(id, version_contrato, trabajo_id, tenant_id, prestador_tenant_id, origen, prestador_id, solicitud_id, cliente_id, estado, version, requiere_presupuesto, presupuesto_aceptado_id, presupuesto_aceptado_version, fecha_creacion, fecha_actualizacion) VALUES ('tr-up', '1.0.0', 'tr-up', 't-cli', 't-pre', 'solicitud', 'p-up', 'sol-up', 't-cli', 'accepted', 1, true, NULL, NULL, now(), now())`)
    await db.query(`INSERT INTO presupuestos(id, version_contrato, presupuesto_id, trabajo_id, tenant_id, prestador_tenant_id, version, estado, moneda, monto_total, alcance, creado_por, correlacion_id, fecha_creacion, fecha_actualizacion) VALUES ('pre-up', '1.0.0', 'pre-up', 'tr-up', 't-cli', 't-pre', 1, 'accepted', 'ARS', 100000, 'Cambio de cuerito', 'u', 'c', now(), now())`)
    for (const [tramo, monto] of [['sena', 50000], ['saldo', 50000]])
      await db.query(`INSERT INTO obligaciones_pago_servicio(id, version_contrato, obligacion_id, tenant_id, cliente_id, prestador_tenant_id, prestador_id, trabajo_id, tramo, origen_importe, presupuesto_id, presupuesto_version, monto, moneda, estado, version, actor_id, correlacion_id, fecha_creacion, fecha_actualizacion) VALUES ($1, '1.0.0', $1, 't-cli', 't-cli', 't-pre', 'p-up', 'tr-up', $2, 'accepted_budget', 'pre-up', 1, $3, 'ARS', 'pending_payment', 1, 'u', 'c', now(), now())`, [`ob-up-${tramo}`, tramo, monto])
    await db.query(`INSERT INTO contactos_whatsapp(id, wa_id, version, fecha_creacion) VALUES ('co-up', '5493794000000', 1, now())`)
    await db.query(`INSERT INTO conversaciones_whatsapp(id, contacto_id, estado, modo, abierta_en, ultimo_mensaje_en, estado_conversacional) VALUES ('cv-up', 'co-up', 'active', 'bot', now(), now(), '{"currentIntent":"reserva"}')`)
    const foto = async () => ({
      trabajos: (await db.query(`SELECT id, origen, estado, version, solicitud_id FROM trabajos ORDER BY id`)).rows,
      obligaciones: (await db.query(`SELECT id, tramo, origen_importe, monto::text, estado, version FROM obligaciones_pago_servicio ORDER BY id`)).rows,
      conversaciones: (await db.query(`SELECT id, estado, modo, estado_conversacional, version FROM conversaciones_whatsapp ORDER BY id`)).rows,
    })
    const antes = await foto()
    // The database of today refuses what this migration introduces.
    assert.equal(await intento(`UPDATE trabajos SET origen = 'turno' WHERE id = 'tr-up'`), 'ck_trabajos_origen')

    // 3. Upgrade: only this migration is pending.
    const segunda = migrar()
    assert.equal(segunda.status, 0, `upgrade failed:\n${(segunda.stdout + segunda.stderr).slice(-1500)}`)
    assert.deepEqual((await db.query(`SELECT finished_at IS NOT NULL AS ok FROM _prisma_migrations WHERE migration_name = $1 AND rolled_back_at IS NULL`, [MIGRACION])).rows, [{ ok: true }])

    // 4. Nothing existing was rewritten; the new columns are empty.
    assert.deepEqual(await foto(), antes, 'existing works, obligations and conversations are untouched')
    assert.deepEqual((await db.query(`SELECT cuenta_identificada_id, identificada_en FROM conversaciones_whatsapp`)).rows, [{ cuenta_identificada_id: null, identificada_en: null }])

    // 5. What was valid stays valid, what was invalid stays invalid, and the new shapes exist.
    assert.match(await def('ck_trabajos_origen'), /turno/u)
    assert.match(await def('ck_obligaciones_pago_origen_importe'), /booked_price/u)
    assert.equal(await intento(`UPDATE trabajos SET origen = 'otro' WHERE id = 'tr-up'`), 'ck_trabajos_origen', 'an unknown origin is still refused')
    assert.equal(await intento(`UPDATE trabajos SET solicitud_id = NULL WHERE id = 'tr-up'`), 'ck_trabajos_origen_coherente', 'a request-born work still needs its request')
    assert.equal(await intento(`UPDATE obligaciones_pago_servicio SET origen_importe = 'fixed_price_commitment', presupuesto_id = NULL, presupuesto_version = NULL WHERE id = 'ob-up-saldo'`), 'ck_obligaciones_pago_tramo_cadena', 'a balance still comes from an accepted budget')
    assert.equal(await intento(`UPDATE obligaciones_pago_servicio SET origen_importe = 'booked_price', presupuesto_id = NULL, presupuesto_version = NULL WHERE id = 'ob-up-saldo'`), 'ck_obligaciones_pago_tramo_cadena', 'a turno has no balance')
    assert.equal(await intento(`UPDATE conversaciones_whatsapp SET cuenta_identificada_id = 'acc-up', identificada_en = now() WHERE id = 'cv-up'`), 'ok')
    assert.equal(await intento(`UPDATE conversaciones_whatsapp SET cuenta_identificada_id = 'nadie' WHERE id = 'cv-up'`), 'fk_conversaciones_whatsapp_cuenta_identificada')
    // Deleting the account forgets the identification instead of blocking or orphaning it.
    await db.query(`DELETE FROM solicitudes_servicio WHERE id = 'sol-up'`).catch(() => undefined)
    assert.equal((await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_conversaciones_whatsapp_cuenta_identificada'`)).rows.length, 1)
  } finally {
    await db.end().catch(() => undefined)
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => undefined)
    await admin.end()
  }
})

test('TURNOS seña PostgreSQL estados: pending -> awaiting_payment -> confirmed only by the verified payment; awaiting_payment holds the time and hides the contact; nobody can write confirmed by hand; a pending payment confirms nothing; an overdue payment window frees the time and a late payment is booked without confirming; cancelling frees the time', { skip, timeout: 300000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const estadoPrestador = (id, nuevo) => call('PATCH', '/tus/v1/prestador/turnos/' + id + '/estado', 'tok-p', { estado: nuevo })
      const paraPrestador = async (id) => (await call('GET', '/tus/v1/prestador/turnos', 'tok-p')).body.items.find((t) => t.id === id)
      const agenda = async (indice, hora) => (await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: lunes })).dias[indice].franjas.find((f) => f.hora === hora)?.estado

      // 1. Requested and accepted: awaiting_payment, with its own payment window.
      const pedido = await solicitar('tok-ana', p, 3, '10:00', 'Espalda completa')
      const aceptada = await aceptar('tok-p', pedido.body.id)
      await avisoDe(pedido.body.id)
      const f1 = await fila(pedido.body.id)
      out.aceptada = [aceptada.body.estado, f1.estado, f1.solicitudExpiraEn > new Date(), f1.solicitudExpiraEn <= f1.fechaInicio, Math.round((f1.solicitudExpiraEn - f1.fechaActualizacion) / 3_600_000)]
      // It holds its time against everybody, and the provider still does not see the contact.
      const otro = await solicitar('tok-beto', p, 3, '10:00', 'Masaje base')
      const visto = await paraPrestador(pedido.body.id)
      out.retiene = [otro.status, otro.body.code, await agenda(3, '10:00'), visto.estado, Boolean(visto.clienteNombre), visto.clienteTelefono, visto.clienteEmail]
      // Nobody writes confirmed (or completed) by hand: not the provider, not the client.
      out.aMano = [(await estadoPrestador(pedido.body.id, 'confirmed')).body.code, (await estadoPrestador(pedido.body.id, 'completed')).body.code, (await estadoPrestador(pedido.body.id, 'awaiting_payment')).body.code, (await aceptar('tok-ana', pedido.body.id)).status, (await fila(pedido.body.id)).estado]
      // Accepting again is the same answer, not a second window.
      const otraVez = await aceptar('tok-p', pedido.body.id)
      out.repetida = [otraVez.status, otraVez.body.estado, (await fila(pedido.body.id)).version === f1.version]

      // 2. A payment that is still pending at Mercado Pago confirms nothing.
      await pagar('tok-ana', pedido.body.id)
      const pago = await pagoDe(pedido.body.reservaId)
      out.pagoPendiente = [resultadoDe(await notificar(pago.pagoId, 'mp-' + run + '-e1', 'pending', '12500.00', run + '-evt-e1')), (await fila(pedido.body.id)).estado, (await obligacionDe(pedido.body.reservaId)).estado, confirmados.length]
      // 3. The verified approval: confirmed, in the same transaction; both parties are told once.
      out.aprobado = resultadoDe(await notificar(pago.pagoId, 'mp-' + run + '-e1', 'approved', '12500.00', run + '-evt-e2'))
      const f2 = await fila(pedido.body.id)
      const o = await orden(pedido.body.reservaId)
      await turnos.avisarTurnoConfirmado(o.trabajoId)
      await new Promise((resolve) => setTimeout(resolve, 300))
      const visto2 = await paraPrestador(pedido.body.id)
      out.confirmada = [f2.estado, f2.solicitudExpiraEn, f2.version === f1.version + 1, visto2.estado, visto2.sena.estado, Boolean(visto2.clienteEmail)]
      out.avisosDeConfirmacion = confirmados.map((x) => [x.reservaId === pedido.body.id, x.cuenta === ana.id, x.prestador === p.tenantId, x.cliente, x.servicio])
      out.eventos = (await prisma.outboxEvent.findMany({ where: { eventType: { startsWith: 'tus.turno.' }, aggregateId: pedido.body.reservaId } })).map((e) => e.eventType)
      out.auditoria = (await prisma.auditoriaFinanzasServicio.findMany({ where: { recursoId: o.trabajoId, accion: { startsWith: 'appointment.' } } })).map((x) => [x.accion, x.estadoNuevo])
      // A confirmed turno follows the normal flow.
      out.luego = (await estadoPrestador(pedido.body.id, 'completed')).body.estado

      // 4. The payment window runs out: the turno reads expired, cannot be paid, frees its time.
      const tarde = await solicitar('tok-ana', p, 3, '11:00', 'Masaje base')
      await aceptar('tok-p', tarde.body.id)
      await avisoDe(tarde.body.id)
      await pagar('tok-ana', tarde.body.id)
      const pagoTarde = await pagoDe(tarde.body.reservaId)
      await prisma.reserva.update({ where: { id: tarde.body.id }, data: { solicitudExpiraEn: new Date(Date.now() - 60_000) } })
      const vencido = (await misTurnos('tok-ana')).find((t) => t.id === tarde.body.id)
      const noPaga = await pagar('tok-ana', tarde.body.id)
      out.vencida = [vencido.estado, vencido.sena ?? null, noPaga.status, noPaga.body.code, await agenda(3, '11:00')]
      const nuevo = await solicitar('tok-beto', p, 3, '11:00', 'Masaje base')
      out.liberada = [nuevo.status, nuevo.body.estado, (await fila(tarde.body.id)).estado]
      // Mercado Pago approves it anyway (the client paid at the last minute): the money is booked,
      // nothing is confirmed, the time stays with who has it now, and the case is left for a refund.
      const antes = confirmados.length
      out.pagoTardio = resultadoDe(await notificar(pagoTarde.pagoId, 'mp-' + run + '-e3', 'approved', '10000.00', run + '-evt-e3'))
      const oTarde = await orden(tarde.body.reservaId)
      await turnos.avisarTurnoConfirmado(oTarde.trabajoId)
      await new Promise((resolve) => setTimeout(resolve, 200))
      out.trasPagoTardio = [(await fila(tarde.body.id)).estado, (await obligacionDe(tarde.body.reservaId)).estado, (await fila(nuevo.body.id)).estado, confirmados.length - antes,
        (await prisma.auditoriaFinanzasServicio.findMany({ where: { recursoId: oTarde.trabajoId, accion: { startsWith: 'appointment.' } } })).map((x) => [x.accion, x.estadoNuevo]),
        (await prisma.outboxEvent.findMany({ where: { eventType: { startsWith: 'tus.turno.' }, aggregateId: tarde.body.reservaId } })).map((e) => e.eventType),
        (await misTurnos('tok-ana')).find((t) => t.id === tarde.body.id).sena]
      // The same late notification again is still applied once.
      out.tardioRepetido = resultadoDe(await notificar(pagoTarde.pagoId, 'mp-' + run + '-e3', 'approved', '10000.00', run + '-evt-e3'))

      // 5. Cancelling while the deposit is due frees the time (client or provider).
      const c1 = await solicitar('tok-ana', p, 3, '12:00', 'Masaje base')
      await aceptar('tok-p', c1.body.id)
      const cancelaCliente = await call('POST', '/tus/v1/cliente/turnos/' + c1.body.id + '/cancelar', 'tok-ana')
      const c2 = await solicitar('tok-ana', p, 3, '13:00', 'Masaje base')
      await aceptar('tok-p', c2.body.id)
      const cancelaPrestador = await estadoPrestador(c2.body.id, 'cancelled')
      const pagarCancelado = await pagar('tok-ana', c1.body.id)
      out.canceladas = [cancelaCliente.body.estado, cancelaPrestador.body.estado, await agenda(3, '12:00'), await agenda(3, '13:00'), pagarCancelado.status, pagarCancelado.body.code]
      // The database refuses an unknown state and an accepted turno without its window.
      out.base = [
        await restriccion(() => prisma.reserva.update({ where: { id: c1.body.id }, data: { estado: 'paid' } })),
        await restriccion(() => prisma.reserva.update({ where: { id: c1.body.id }, data: { estado: 'awaiting_payment', solicitudExpiraEn: null } })),
      ]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.aceptada, ['awaiting_payment', 'awaiting_payment', true, true, 24], 'accepting opens a 24-hour payment window, never beyond the turno')
  assert.deepEqual(r.retiene, [409, 'SLOT_OCCUPIED', 'ocupado', 'awaiting_payment', true, null, null], 'the time is held and the contact stays private until the turno is confirmed')
  assert.deepEqual(r.aMano, ['INVALID_STATUS', 'INVALID_TRANSITION', 'INVALID_STATUS', 404, 'awaiting_payment'], 'no hand-written confirmation: the route refuses confirmed and awaiting_payment as a value, and an unpaid turno cannot be completed')
  assert.deepEqual(r.repetida, [200, 'awaiting_payment', true])
  assert.deepEqual(r.pagoPendiente, ['recorded:no_op:same_status', 'awaiting_payment', 'pending_payment', 0], 'a payment still pending at the provider confirms nothing')
  assert.equal(r.aprobado, 'recorded:applied')
  assert.deepEqual(r.confirmada, ['confirmed', null, true, 'confirmed', 'paid', true], 'the verified payment confirms, once, and only then the contact is shown')
  assert.deepEqual(r.avisosDeConfirmacion, [[true, true, true, 'Ana Cuenta', 'Espalda completa']], 'client and provider are told about the confirmation, once')
  assert.deepEqual(r.eventos, ['tus.turno.confirmed'])
  assert.deepEqual(r.auditoria, [['appointment.confirmed_by_deposit', 'confirmed']])
  assert.equal(r.luego, 'completed')
  assert.deepEqual(r.vencida, ['expired', null, 409, 'DEPOSIT_NOT_PAYABLE', 'disponible'], 'an overdue payment window: expired, not payable, its time offered again')
  assert.deepEqual(r.liberada, [201, 'pending', 'expired'], 'another client takes the time; the overdue turno is stored as expired')
  assert.equal(r.pagoTardio, 'recorded:applied', 'the money was collected: the approval is booked, never lost')
  assert.deepEqual(r.trasPagoTardio, ['expired', 'paid', 'pending', 0, [['appointment.deposit_without_turno', 'requires_refund_review']], ['tus.turno.deposit_without_turno'], { monto: 10000, moneda: 'ARS', estado: 'paid' }], 'a late payment confirms nothing, takes nobody\'s time, tells nobody "confirmed" and is left on record for a refund')
  assert.match(r.tardioRepetido, /^duplicate/u)
  assert.deepEqual(r.canceladas, ['cancelled', 'cancelled', 'disponible', 'disponible', 409, 'DEPOSIT_NOT_PAYABLE'])
  assert.deepEqual(r.base, ['ck_reservas_estado', 'ck_reservas_solicitud_vigencia'])
})

test('TURNOS seña PostgreSQL habilitación: the deposit depends on the service-payments readiness gate, never on settlement; in production without it a priced turno cannot be accepted (never confirmed without its deposit) and no checkout exists; with it, and in sandbox, accepting opens the payment and only the verified notification confirms', { skip, timeout: 300000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const { PoliticaCobroPersistida, AlmacenConfiguracionPagosEnMemoria } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    const { crearHabilitacionPagosServicio } = await import('./apps/api/src/tus/finance/servicios/habilitacion-pagos.ts')
    const { EvaluadorHabilitacion, crearEvidenciaHabilitacion } = await import('./apps/api/src/tus/readiness/index.ts')
    const out = {}
    try {
      // The REAL runtime policy, in production mode with everything of Mercado Pago configured and
      // the payments switch on: what is left is the evidence-based readiness gate, over records
      // this scenario adds and revokes.
      const evidencia = []
      const registrar = (capability, gates) => { for (const gate of gates) evidencia.push(crearEvidenciaHabilitacion({ tenantId: 'tus-platform', capability, gate, owner: 'owner', scope: 'argentina-stage-1', evidenceType: 'approval-record', evidenceRef: capability + '-' + gate, evidenceId: capability + '-' + gate, policyVersion: 'v1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: null, revoked: false, source: 'authorized-external', profile: 'render-native' })) }
      const gate = crearHabilitacionPagosServicio(new EvaluadorHabilitacion({ listEvidence: (tenantId, capability) => evidencia.filter((item) => item.tenantId === tenantId && item.capability === capability) }), { tenantId: 'tus-platform', profile: 'render-native' })
      const configuracion = new AlmacenConfiguracionPagosEnMemoria()
      await configuracion.agregarConfiguracion({ configuracionId: run + '-config', version: 1, paymentsEnabled: true, provider: 'mercado-pago', currency: 'ARS', reason: 'test', actorId: 'admin', correlationId: 'c', createdAt: new Date().toISOString() })
      let entorno = 'production'
      const operativo = () => ({ mercadoPagoEnabled: true, environment: entorno, clientIdConfigured: true, clientSecretConfigured: true, webhookSecretConfigured: true, redirectUriConfigured: true, credentialsKeyConfigured: true, webBaseUrlConfigured: true, notificationUrlConfigured: true, realProviderAdapterAvailable: true })
      const real = new PoliticaCobroPersistida(configuracion, operativo, async (tenantId) => conCobro.has(tenantId), gate.autorizada, async () => true)
      politica.disponibilidad = (input) => real.disponibilidad(input)
      const gates = async () => { const estado = await gate.estado(); return [estado.servicePayments.authorized, estado.settlement.authorized] }

      // 0. The store production uses (PostgreSQL): with no evidence recorded both gates are
      //    blocked requirement by requirement, and each evaluation leaves its audited decision.
      const { AlmacenPrismaEvidenciaHabilitacion } = await import('./apps/api/src/tus/adapters/prisma.ts')
      const plataforma = run + '-plataforma'
      const persistido = await crearHabilitacionPagosServicio(new EvaluadorHabilitacion(new AlmacenPrismaEvidenciaHabilitacion(prisma)), { tenantId: plataforma, profile: 'render-native' }).estado()
      const decisiones = await prisma.decisionHabilitacion.findMany({ where: { tenantId: plataforma }, orderBy: { capability: 'asc' } })
      out.persistido = [persistido.servicePayments.blockers, persistido.settlement.blockers.length, decisiones.map((d) => [d.capability, d.enabled, d.outcome, d.actorId, d.scope]), await prisma.evidenciaHabilitacion.count({ where: { tenantId: plataforma } })]
      const anunciada = async () => (await turnos.serviciosDePrestador({ perfilId: p.perfilId }))[0].senaRequerida

      // 1. Production, settlement fully evidenced and service-payments not. The provider is
      //    connected and verified; it is the platform that may not charge. A priced turno can be
      //    requested, but nobody can accept it: it is never confirmed without its deposit.
      registrar('settlement', ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'posPilot', 'aws', 'groqMigration', 'runtimeProvider'])
      out.soloSettlement = [await gates(), await real.disponibilidad({ prestadorTenantId: p.tenantId, prestadorId: p.prestadorId, categoria: null }), await anunciada()]
      const pagosAlEmpezar = await prisma.intencionPago.count()
      const t1 = await solicitar('tok-ana', p, 2, '10:00', 'Espalda completa')
      const a1 = await aceptar('tok-p', t1.body.id)
      const p1 = await pagar('tok-ana', t1.body.id)
      out.sinGate = [t1.status, t1.body.sena ?? null, a1.status, a1.body.code, (await fila(t1.body.id)).estado, p1.status, p1.body.code, await orden(t1.body.reservaId), (await prisma.intencionPago.count()) === pagosAlEmpezar, avisos.filter((x) => x.reservaId === t1.body.id).length]
      // If the check itself cannot be made, the acceptance fails; it never falls back to "no deposit".
      politica.disponibilidad = async () => { throw new Error('database unavailable') }
      const aRoto = await aceptar('tok-p', t1.body.id)
      out.sinVerificar = [aRoto.status, aRoto.body.code, (await fila(t1.body.id)).estado]
      politica.disponibilidad = (input) => real.disponibilidad(input)
      // A service WITHOUT a price has no deposit: it keeps working as it always did.
      const sinPrecio = await prestador('gatesinprecio', 'A Convenir Gate ' + run, [])
      conCobro.add(sinPrecio.tenantId)
      sesion('tok-gsp', 'u-' + sinPrecio.tenantId, sinPrecio.tenantId)
      const t0 = await solicitar('tok-ana', sinPrecio, 2, '10:00', null)
      const a0 = await aceptar('tok-gsp', t0.body.id)
      out.sinPrecio = [t0.status, t0.body.sena ?? null, a0.status, a0.body.estado, a0.body.sena ?? null, await orden(t0.body.reservaId)]

      // 1b. SANDBOX with the same missing authorization: no real money moves, the gate does not
      //     block, and the whole circuit can be exercised.
      entorno = 'sandbox'
      const ts = await solicitar('tok-beto', p, 2, '15:00', 'Masaje base')
      const as = await aceptar('tok-p', ts.body.id)
      await avisoDe(ts.body.id)
      const cs = await pagar('tok-beto', ts.body.id)
      const pagoSandbox = await pagoDe(ts.body.reservaId)
      out.sandbox = [await gates(), await real.disponibilidad({ prestadorTenantId: p.tenantId, prestadorId: p.prestadorId, categoria: null }), as.status, as.body.estado, cs.status, cs.body.monto, (await fila(ts.body.id)).estado]
      out.sandboxAprobado = [resultadoDe(await notificar(pagoSandbox.pagoId, 'mp-' + run + '-sbx', 'approved', '10000.00', run + '-evt-sbx')), (await fila(ts.body.id)).estado]
      entorno = 'production'

      // 2. The six records of service-payments, and nothing of posPilot, aws or groqMigration.
      evidencia.length = 0
      registrar('service-payments', ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider'])
      out.soloServicios = [await gates(), await real.disponibilidad({ prestadorTenantId: p.tenantId, prestadorId: p.prestadorId, categoria: null }), await anunciada()]
      // The request that could not be accepted before can be accepted now, and it waits for its deposit.
      const a1b = await aceptar('tok-p', t1.body.id)
      out.luegoHabilitado = [a1b.status, a1b.body.estado, a1b.body.sena]
      const t2 = await solicitar('tok-beto', p, 2, '11:00', 'Masaje base')
      const a2 = await aceptar('tok-p', t2.body.id)
      await avisoDe(t2.body.id)
      // The client cannot hand over an authorization.
      const manipulado = await pagar('tok-beto', t2.body.id, { authorized: true, capability: 'settlement', servicePayments: { authorized: true }, readiness: 'authorized' })
      const c2 = await pagar('tok-beto', t2.body.id)
      out.conGate = [t2.body.sena, a2.body.estado, a2.body.sena, manipulado.status, manipulado.body.code, c2.status, c2.body.monto, c2.body.checkoutUrl.startsWith('https://www.mercadopago.com.ar/')]
      out.checkoutNoConfirma = (await fila(t2.body.id)).estado
      // The same gate with a provider that is not connected: it is the provider that is missing.
      const sinCuenta = await prestador('sincuenta', 'Sin Cuenta ' + run, [['Consulta', 8000]])
      out.prestadorSinCuenta = await real.disponibilidad({ prestadorTenantId: sinCuenta.tenantId, prestadorId: sinCuenta.prestadorId, categoria: null })
      // A second turno accepted while authorized, still unpaid.
      const t3 = await solicitar('tok-ana', p, 2, '12:00', 'Cuerpo completo')
      await aceptar('tok-p', t3.body.id)
      await avisoDe(t3.body.id)

      // 3. The authorization is lost (one record is revoked): no checkout is handed out, nothing
      //    is created, and the turno waiting for its deposit is NOT confirmed.
      const mp = evidencia.findIndex((item) => item.gate === 'mercadoPago')
      evidencia[mp] = { ...evidencia[mp], revoked: true }
      const pagosAntes = await prisma.intencionPago.count()
      const p3 = await pagar('tok-ana', t3.body.id)
      const o2 = await orden(t2.body.reservaId)
      out.revocada = [
        await gates(), p3.status, p3.body.code, (await prisma.intencionPago.count()) === pagosAntes, (await fila(t3.body.id)).estado, (await senaDe('tok-ana', t3.body.id)).estado,
        await codeOf(() => fin.iniciarCheckout({ tenantId: beto.tenantId, actorId: beto.id, correlationId: 'c', trabajoId: o2.trabajoId, idempotencyKey: run + '-otra-clave' })),
      ]

      // 4. Authorized again. Coming back from the checkout confirms nothing, a forged notification
      //    neither; only the verified approval does.
      evidencia[mp] = { ...evidencia[mp], revoked: false }
      const pago = await pagoDe(t2.body.reservaId)
      const vuelta = await call('GET', '/tus/v1/cliente/turnos?pago=retorno&status=approved&payment_id=123', 'tok-beto')
      out.vuelta = [vuelta.status, (await fila(t2.body.id)).estado]
      const falsa = JSON.stringify({ id: run + '-falsa-gate', data: { id: 'mp-gate', external_reference: pago.pagoId, status: 'approved', currency_id: 'ARS', transaction_amount: '10000.00', date_last_updated: new Date().toISOString() } })
      out.firmaInvalida = [resultadoDe(await fin.ingerirEventoProveedor({ rawBody: falsa, signature: 'firma-inventada', receivedAt: new Date().toISOString() })), (await fila(t2.body.id)).estado]
      out.aprobado = [resultadoDe(await notificar(pago.pagoId, 'mp-' + run + '-gate', 'approved', '10000.00', run + '-evt-gate')), (await fila(t2.body.id)).estado, (await senaDe('tok-beto', t2.body.id)).estado]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.persistido, [
    ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider'].map((gate) => gate + ':evidence_missing'), 9,
    [['service-payments', false, 'blocked', 'system:service-payments', 'argentina-stage-1'], ['settlement', false, 'blocked', 'system:service-payments', 'argentina-stage-1']], 0,
  ], 'the persisted evaluator blocks both gates without evidence, audits each decision and writes no evidence')
  assert.deepEqual(r.soloSettlement, [[false, true], { available: false, reason: 'PRODUCTION_NOT_AUTHORIZED' }, true], 'settlement evidence does not authorize a service payment; the deposit is still what confirms a priced turno')
  assert.deepEqual(r.sinGate, [201, { monto: 12500, moneda: 'ARS', estado: 'not_due' }, 409, 'SERVICE_PAYMENTS_NOT_AUTHORIZED', 'pending', 409, 'DEPOSIT_NOT_PAYABLE', null, true, 0], 'production without the authorization: the priced request cannot be accepted, stays pending, and nothing is confirmed, charged, created or announced')
  assert.deepEqual(r.sinVerificar, [503, 'PAYMENT_NOT_AVAILABLE', 'pending'], 'an unavailable check never turns into a confirmation')
  assert.deepEqual(r.sinPrecio, [201, null, 200, 'confirmed', null, null], 'a price-less service has no deposit and keeps its rule: accepting confirms')
  assert.deepEqual(r.sandbox, [[false, true], { available: true, reason: null, mode: 'split' }, 200, 'awaiting_payment', 200, 10000, 'awaiting_payment'], 'sandbox does not ask for the production authorization; accepting and the checkout still do not confirm')
  assert.deepEqual(r.sandboxAprobado, ['recorded:applied', 'confirmed'], 'in sandbox too, only the verified notification confirms')
  assert.deepEqual(r.luegoHabilitado, [200, 'awaiting_payment', { monto: 12500, moneda: 'ARS', estado: 'pending' }], 'production with the authorization: the provider can accept, and accepting opens the payment instead of confirming')
  assert.deepEqual(r.soloServicios, [[true, false], { available: true, reason: null, mode: 'split' }, true], 'service-payments is authorized without posPilot, aws or groqMigration, while settlement stays blocked')
  assert.deepEqual(r.conGate, [{ monto: 10000, moneda: 'ARS', estado: 'not_due' }, 'awaiting_payment', { monto: 10000, moneda: 'ARS', estado: 'pending' }, 400, 'UNTRUSTED_PAYMENT_FIELDS', 200, 10000, true])
  assert.equal(r.checkoutNoConfirma, 'awaiting_payment', 'creating the checkout does not confirm the turno')
  assert.deepEqual(r.prestadorSinCuenta, { available: false, reason: 'PROVIDER_ACCOUNT_NOT_CONNECTED' })
  assert.deepEqual(r.revocada, [[false, false], 503, 'PAYMENT_NOT_AVAILABLE', true, 'awaiting_payment', 'unavailable', 'PRODUCTION_NOT_AUTHORIZED'], 'authorization lost: a clear domain error, nothing created, the turno is not confirmed')
  assert.deepEqual(r.vuelta, [200, 'awaiting_payment'], 'coming back from Mercado Pago confirms nothing')
  assert.deepEqual(r.firmaInvalida, ['invalid:INVALID_SIGNATURE', 'awaiting_payment'])
  assert.deepEqual(r.aprobado, ['recorded:applied', 'confirmed', 'paid'], 'only the verified notification confirms')
})
