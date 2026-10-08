import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// PAGOS-RETENCION-01. An approved payment is not money the provider can withdraw.
//
// A payment TUS collects with its own account books the earning of the provider at once (the
// ledger keeps its trace) and leaves its settlement HELD. Nothing of a held settlement is part of
// the withdrawable balance or of a payout. It is released, once, when the work reaches its release
// milestone: closed, with nothing of it still to be paid. A payment refunded before that never
// becomes withdrawable.
//
// The real finance service, the real earnings service and the real payout request, in memory.
const SETUP = `${SERVICE_SETUP}
  const { InMemoryTrabajoOutboxStore: Outbox } = await import('./apps/api/src/tus/work/index.ts')
  const g = await import('./apps/api/src/tus/finance/servicios/ganancias.ts')
  const { liquidacionRetenida } = await import('./apps/api/src/tus/finance/servicios/liquidacion.ts')
  // 'plataforma': TUS collects (it can hold the money). 'split': Mercado Pago pays the provider.
  let modo = 'plataforma'
  const politica = {
    reglaComision: async () => ({ politicaId: 'pol-1', rateBps: 1000, ruleVersion: 'test-10', pspFeeBearer: 'provider' }),
    disponibilidad: async () => ({ available: true, reason: null, mode: modo }),
  }
  const store = new AlmacenFinanzasServicioEnMemoria()
  const fin = new ServicioFinanzasServicios(
    new TransaccionFinanzasServicioEnMemoria(store, new IdentidadServicioEnMemoria(workStore, marketplace), {
      completarPorPagoFinal: (input) => work.completarPorPagoFinal({ work: workStore, outbox: new Outbox() }, input),
    }),
    clock, proveedorPagos, undefined, politica
  )
  const { pagosTrabajo } = await import('./apps/api/src/tus/composition/index.ts')
  work.conPagos(pagosTrabajo(fin))
  // The earnings service over the SAME ledger the finance service writes, told which settlements
  // are held by the finance store itself.
  const libro = new g.LedgerGananciasEnMemoria()
  const payouts = new g.AlmacenSolicitudesLiquidacionEnMemoria(libro)
  // What the finance service booked since the last look (in PostgreSQL it is one table).
  const alDia = () => { for (const m of store.state.ganancias.values()) if (!libro.movimientos.some((x) => x.movimientoId === m.movimientoId)) libro.movimientos.push(structuredClone(m)) }
  const liquidacionDe = (tenantId, obligacionId) => [...store.state.liquidaciones.values()].find((s) => s.tenantId === tenantId && s.obligacionId === obligacionId)
  payouts.retenida = (tenantId, obligacionId) => { const s = liquidacionDe(tenantId, obligacionId); return Boolean(s && liquidacionRetenida(s)) }
  payouts.prestadores.set(provider.tenantId, 'provider-1')
  payouts.cuentas.set(provider.tenantId, 'cuenta-1')
  const ganancias = new g.ServicioGananciasPrestador(payouts, { disponible: false, enviar: async () => { throw new Error('no payout is executed here') }, consultar: async () => { throw new Error('no') } }, async () => true, clock, { minimoLiquidacion: async () => 100000n })
  const prestador = { tenantId: provider.tenantId, actorId: 'provider-user', correlationId: 'c-prov' }
  const saldo = async () => { alDia(); const r = await ganancias.resumen(prestador); return { ganado: r.earnedMinor, disponible: r.availableMinor, retenido: r.heldMinor, negativo: r.negativeMinor, puede: r.canRequest, motivo: r.blockedReason } }
  const retirar = (clave) => (alDia(), ganancias.solicitar(prestador, clave, { destinationEmail: 'prestador@example.test' }).then((r) => [r.status, r.payout.amountMinor], (e) => e.code))
  const liquidaciones = () => [...store.state.liquidaciones.values()].map((s) => [s.status, s.retained === true, Boolean(s.releasedAt), s.netMinor.toString()])
  const movimientos = () => [...store.state.ganancias.values()].map((m) => m.tipo).sort()
  let seq = 0
  async function requestWork(id, total) {
    const { work: created } = await work.crearDesdeSolicitudEnTransaccion({ ...customer, solicitudId: 'sol-' + id, prestadorTenantId: provider.tenantId, prestadorId: 'provider-1', createdAt: '2026-09-23T09:00:00.000Z' })
    await acceptBudget(created.trabajoId, total)
    return created.trabajoId
  }
  const current = async (id) => (await work.getWork(provider, id)).work
  const step = async (op, id) => { const w = await current(id); seq += 1; return work[op]({ ...provider, trabajoId: id, expectedVersion: w.version, idempotencyKey: op + '-' + id + '-' + seq, requestHash: 'h' + seq, createdAt: '2026-09-23T10:0' + (seq % 10) + ':00.000Z', reason: 'motivo de prueba' }) }
  let eventSeq = 0
  async function notify(paymentId, status, amount, eventId) {
    eventSeq += 1
    const raw = JSON.stringify({ id: eventId ?? 'evt-' + eventSeq, data: { id: 'fake-mp-' + paymentId, external_reference: paymentId, status, currency_id: 'ARS', transaction_amount: amount, date_last_updated: new Date(Date.parse('2026-09-23T11:00:00.000Z') + eventSeq * 1000).toISOString() } })
    return fin.ingerirEventoProveedor({ rawBody: raw, signature: proveedorPagos.firmar(raw), receivedAt: '2026-09-23T11:00:00.000Z' })
  }
  const pagar = async (id, clave, monto, evento) => { const c = await fin.iniciarCheckout({ ...customer, trabajoId: id, idempotencyKey: clave }); const r = await notify(c.payment.paymentId, 'approved', monto, evento); return { pago: c.payment, resultado: r } }
`

test('RETENCION deposit + balance: the approved deposit books the earning and leaves it held (not withdrawable, not in a payout); finishing the work does not release; the approved balance closes the work and releases both, once; repeating the webhook or the release changes nothing', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const id = await requestWork('a', '2000000')
    // 1. The deposit (an advance payment) is approved.
    const sena = await pagar(id, 'k-sena', '10000.00', 'evt-sena')
    out.sena = { modo: sena.pago.collectionMode ?? [...store.state.intenciones.values()][0].collectionMode, resultado: sena.resultado.result, movimientos: movimientos(), liquidaciones: liquidaciones(), saldo: await saldo() }
    // 3. The provider cannot withdraw it: nothing to request, whatever it sends.
    out.retiroRetenido = [await retirar('retiro-1'), payouts.solicitudesGuardadas.length, payouts.itemsGuardados.length]
    // 9. The same notification again: no second earning.
    const repetida = await notify(sena.pago.paymentId, 'approved', '10000.00', 'evt-sena')
    out.webhookDuplicado = [repetida.status, movimientos(), (await saldo()).retenido]
    // 4. The work starts and the provider finishes it: the client has not closed it, still held.
    await step('startWork', id)
    await step('completeWork', id)
    const forzada = await fin.liberarLiquidacionesDelTrabajo({ tenantId: customer.tenantId, trabajoId: id, correlationId: 'forzar' })
    out.terminadoSinCerrar = [(await current(id)).status, forzada.map((x) => [x.status, x.reason]), liquidaciones(), (await saldo()).disponible]
    // 11. The balance is approved: it closes the work, and both payments are released together.
    const balance = await pagar(id, 'k-saldo', '10000.00', 'evt-saldo')
    out.cierre = { trabajo: (await current(id)).status, resultado: balance.resultado.result, liquidaciones: liquidaciones(), movimientos: movimientos(), saldo: await saldo() }
    // 10. The release repeated (the closing event again, the webhook again): nothing moves twice.
    const versiones = () => [...store.state.liquidaciones.values()].map((s) => [s.version, s.releasedAt])
    const antes = versiones()
    const otra = await fin.liberarLiquidacionesDelTrabajo({ tenantId: customer.tenantId, trabajoId: id, correlationId: 'otra-vez' })
    const saldoRepetido = await notify(balance.pago.paymentId, 'approved', '10000.00', 'evt-saldo')
    out.liberacionRepetida = [otra.map((x) => [x.status, x.reason]), saldoRepetido.status, JSON.stringify(versiones()) === JSON.stringify(antes), (await saldo()).disponible, movimientos().length]
    out.eventosLiberacion = store.state.auditoria.filter((a) => a.action === 'settlement.eligible').length
    // Now, and only now, it can be withdrawn: the whole net of both payments, each earning once.
    out.retiro = [await retirar('retiro-2'), payouts.itemsGuardados.filter((i) => i.activo).map((i) => i.movimientoId).sort(), await saldo()]
    out.retiroRepetido = await retirar('retiro-2')
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.sena.modo, 'plataforma', 'an advance payment is collected by TUS')
  assert.equal(r.sena.resultado, 'applied')
  assert.deepEqual(r.sena.movimientos, ['earning_credit'], 'the earning is booked when the payment is approved')
  assert.deepEqual(r.sena.liquidaciones, [['held', true, false, '900000']], 'its settlement is held, under retention, not released')
  assert.deepEqual(r.sena.saldo, { ganado: '900000', disponible: '0', retenido: '900000', negativo: '0', puede: false, motivo: 'NO_FUNDS' }, 'registered, and not withdrawable')
  assert.deepEqual(r.retiroRetenido, ['PAYOUT_NO_FUNDS', 0, 0], 'the backend refuses the payout: no request, no item')
  assert.deepEqual(r.webhookDuplicado, ['duplicate', ['earning_credit'], '900000'], 'a repeated notification books nothing')
  assert.deepEqual(r.terminadoSinCerrar, ['in_progress', [['unchanged', 'work_not_completed']], [['held', true, false, '900000']], '0'], 'finished by the provider and not closed: still held, even when the release is asked for')
  assert.equal(r.cierre.trabajo, 'completed')
  assert.deepEqual(r.cierre.liquidaciones, [['eligible', true, true, '900000'], ['eligible', true, true, '900000']], 'both payments are released by the closing')
  assert.deepEqual(r.cierre.movimientos, ['earning_credit', 'earning_credit'], 'one earning per payment')
  assert.deepEqual(r.cierre.saldo, { ganado: '1800000', disponible: '1800000', retenido: '0', negativo: '0', puede: true, motivo: null })
  assert.deepEqual(r.liberacionRepetida, [[['unchanged', 'settlement_eligible'], ['unchanged', 'settlement_eligible']], 'duplicate', true, '1800000', 2], 'the release is idempotent: no settlement moves, no balance is added twice')
  assert.equal(r.eventosLiberacion, 2, 'one release per obligation, ever')
  assert.deepEqual(r.retiro[0], ['created', '1800000'])
  assert.deepEqual(r.retiro[1].length, 2, 'the payout takes each released earning once')
  assert.equal(r.retiro[2].disponible, '0')
  assert.deepEqual(r.retiroRepetido, ['existing', '1800000'], 'the same payout request is the same payout')
})

test('RETENCION refund before the release: the settlement is reversed and never released; the earning and its reversal stay out of the withdrawable balance (no negative balance, no double compensation), also when the release is asked for afterwards', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const id = await requestWork('r', '2000000')
    const sena = await pagar(id, 'k-sena-r', '10000.00', 'evt-sena-r')
    out.antes = await saldo()
    const reembolso = await notify(sena.pago.paymentId, 'refunded', '10000.00', 'evt-reembolso')
    out.reembolso = { resultado: reembolso.result, liquidaciones: liquidaciones(), movimientos: movimientos(), saldo: await saldo(), retiro: await retirar('retiro-r') }
    const repetido = await notify(sena.pago.paymentId, 'refunded', '10000.00', 'evt-reembolso')
    out.reembolsoRepetido = [repetido.status, movimientos().length]
    const forzada = await fin.liberarLiquidacionesDelTrabajo({ tenantId: customer.tenantId, trabajoId: id, correlationId: 'forzar-r' })
    out.liberarDespues = [forzada.map((x) => x.status), liquidaciones(), await saldo()]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.antes, { ganado: '900000', disponible: '0', retenido: '900000', negativo: '0', puede: false, motivo: 'NO_FUNDS' })
  assert.equal(r.reembolso.resultado, 'applied')
  assert.deepEqual(r.reembolso.liquidaciones, [['reversed', true, false, '900000']], 'reversed, and never released')
  assert.deepEqual(r.reembolso.movimientos, ['earning_credit', 'refund_debit'], 'the existing compensation: a debit movement, nothing edited')
  assert.deepEqual(r.reembolso.saldo, { ganado: '900000', disponible: '0', retenido: '0', negativo: '0', puede: false, motivo: 'NO_FUNDS' }, 'nothing withdrawable and nothing owed back')
  assert.equal(r.reembolso.retiro, 'PAYOUT_NO_FUNDS')
  assert.deepEqual(r.reembolsoRepetido, ['duplicate', 2], 'the refund is compensated once')
  assert.deepEqual(r.liberarDespues, [['unchanged'], [['reversed', true, false, '900000']], { ganado: '900000', disponible: '0', retenido: '0', negativo: '0', puede: false, motivo: 'NO_FUNDS' }], 'a refunded payment can never be released')
})

test('RETENCION withdrawable balance: with one work closed and another only paid in advance, the balance and the payout take the released money and nothing of what is held; a refund AFTER the release is debited from the withdrawable balance as before', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    // Work 1: deposit and balance approved -> closed and released.
    const uno = await requestWork('uno', '2000000')
    await pagar(uno, 'k1-sena', '10000.00', 'evt-1-sena')
    await step('startWork', uno)
    await step('completeWork', uno)
    const saldoUno = await pagar(uno, 'k1-saldo', '10000.00', 'evt-1-saldo')
    // Work 2: only its deposit, paid in advance.
    const dos = await requestWork('dos', '600000')
    await pagar(dos, 'k2-sena', '3000.00', 'evt-2-sena')
    out.mixto = [await saldo(), liquidaciones().map((l) => l[0] + ':' + l[2])]
    const retiro = await retirar('retiro-mixto')
    const tomados = payouts.itemsGuardados.filter((i) => i.activo).map((i) => i.movimientoId)
    const retenido = [...store.state.ganancias.values()].find((m) => m.trabajoId === dos).movimientoId
    out.retiro = [retiro, tomados.length, tomados.includes(retenido), await saldo()]
    // A refund of a payment that was ALREADY released: it is debited from what can be withdrawn.
    await notify(saldoUno.pago.paymentId, 'refunded', '10000.00', 'evt-1-reembolso')
    out.reembolsoPosterior = await saldo()
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.mixto, [{ ganado: '2070000', disponible: '1800000', retenido: '270000', negativo: '0', puede: true, motivo: null }, ['eligible:true', 'eligible:true', 'held:false']])
  assert.deepEqual(r.retiro.slice(0, 3), [['created', '1800000'], 2, false], 'the payout is the released money: the held earning is neither in its amount nor among its items')
  assert.deepEqual([r.retiro[3].disponible, r.retiro[3].retenido], ['0', '270000'])
  assert.deepEqual([r.reembolsoPosterior.disponible, r.reembolsoPosterior.negativo, r.reembolsoPosterior.retenido], ['-900000', '900000', '270000'], 'released money that is refunded afterwards is owed back, as before; what is held is untouched')
})

test('RETENCION split: a payment Mercado Pago pays straight to the provider is not under retention (TUS never has that money) and books no earning; the policy sends every advance payment to the account of TUS when it has one', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const { AlmacenConfiguracionPagosEnMemoria, PoliticaCobroPersistida, ServicioConfiguracionPagos, leerEstadoOperativoPagos } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    const out = {}
    modo = 'split'
    const id = await requestWork('s', '2000000')
    const sena = await pagar(id, 'k-split', '10000.00', 'evt-split')
    out.split = [[...store.state.intenciones.values()].find((i) => i.paymentId === sena.pago.paymentId).collectionMode, liquidaciones(), movimientos(), await saldo()]
    // The real policy: who collects, for an advance payment and for one made after the work.
    const listo = () => leerEstadoOperativoPagos({ TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'production', MERCADO_PAGO_CLIENT_ID: 'a', MERCADO_PAGO_CLIENT_SECRET: 'b', MERCADO_PAGO_WEBHOOK_SECRET: 'c', MERCADO_PAGO_OAUTH_REDIRECT_URI: 'https://api.example.test/cb', TUS_PAYMENT_CREDENTIALS_KEY: 'k', TUS_WEB_BASE_URL: 'https://web.example.test', MERCADO_PAGO_NOTIFICATION_URL: 'https://api.example.test/wh' }, true)
    const config = new AlmacenConfiguracionPagosEnMemoria()
    const admin = new ServicioConfiguracionPagos(config, listo, clock)
    await admin.registrarConfiguracion({ actorId: 'admin', correlationId: 'c' }, { paymentsEnabled: true, reason: 'x', expectedVersion: 0 })
    await admin.registrarPolitica({ actorId: 'admin', correlationId: 'c' }, { scope: 'global', rateBps: 1000, pspFeeBearer: 'provider', reason: 'x', expectedVersion: 0 })
    const quien = async (conectado, plataforma, anticipado) => (await new PoliticaCobroPersistida(config, listo, async () => conectado, async () => false, async () => true, () => plataforma).disponibilidad({ prestadorTenantId: provider.tenantId, prestadorId: 'provider-1', categoria: null, anticipado })).mode ?? 'ninguno'
    out.quienCobra = { anticipoConCuentaYPlataforma: await quien(true, true, true), anticipoSinCuenta: await quien(false, true, true), anticipoSinPlataforma: await quien(true, false, true), posteriorConCuenta: await quien(true, true, false), nadie: await quien(false, false, true) }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.split, ['split', [['held', false, false, '900000']], [], { ganado: '0', disponible: '0', retenido: '0', negativo: '0', puede: false, motivo: 'NO_FUNDS' }], 'split: TUS holds nothing and owes nothing; the settlement is a record, not a retention')
  assert.deepEqual(r.quienCobra, { anticipoConCuentaYPlataforma: 'plataforma', anticipoSinCuenta: 'plataforma', anticipoSinPlataforma: 'split', posteriorConCuenta: 'split', nadie: 'ninguno' }, 'an advance payment goes to the account of TUS whenever it has one, also for a provider with its own')
})

test('RETENCION storage and compatibility: the migration is additive and keeps what already existed withdrawable; the PostgreSQL store reads the held settlements inside the transaction of a payout', () => {
  const sql = readFileSync(join(root, 'apps/api/prisma/migrations/20261113100000_tus_pagos_retencion_liberacion/migration.sql'), 'utf8')
  assert.match(sql, /ADD COLUMN "retencion_activa" boolean NOT NULL DEFAULT false/u, 'existing settlements are not put under retention')
  assert.match(sql, /ADD COLUMN "liberada_en" timestamp\(3\)/u)
  assert.doesNotMatch(sql.replace(/^--.*$/gmu, ''), /\b(DROP|DELETE|UPDATE|TRUNCATE)\b/u, 'nothing existing is rewritten')
  const almacen = readFileSync(join(root, 'apps/api/src/tus/adapters/prisma-ganancias.ts'), 'utf8')
  assert.match(almacen, /where: \{ prestadorTenantId, retencionActiva: true, liberadaEn: null \}/u, 'held = under retention and never released')
  assert.match(almacen, /const retenidas = await this\.retenidas\(tx, prestadorTenantId\)/u, 'decided with what the transaction of the payout reads')
  const dominio = readFileSync(join(root, 'apps/api/src/tus/finance/servicios/ganancias.ts'), 'utf8')
  assert.match(dominio, /!movimiento\.retenido && !tomados\.has\(movimiento\.movimientoId\)/u, 'a held movement is never an item of a payout')
})
