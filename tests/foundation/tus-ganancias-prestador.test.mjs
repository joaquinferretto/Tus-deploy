import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SERVICE_SETUP, root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { MERCADO_PAGO_SANDBOX_SETUP } from './fixtures/mercado-pago-sandbox.mjs'
import { MERCADO_PAGO_API_SETUP } from './fixtures/mercado-pago-api.mjs'

// TUS-GANANCIAS-01. A provider without a linked Mercado Pago account can still be paid: TUS
// collects with its own account and the provider's share (gross minus the frozen commission, minus
// the Mercado Pago fee once reported, as in Split 1:1) becomes an earning in an append-only ledger.
// The provider asks for a payout of everything available (from the configured minimum) into its
// own Mercado Pago account; the request books a reserve; the administration sends it through
// Mercado Pago Payouts (POST /v1/payouts, its result read from Mercado Pago) or records a payment
// made by another means with its reference; failing or cancelling books a release, paying books a
// completion. A negative balance stays as the provider's obligation, netted by future earnings.

const DOMINIO = `
  const g = await import('./apps/api/src/tus/finance/servicios/ganancias.ts')
  const { resultadoDeTransferencia } = await import('./apps/api/src/tus/finance/servicios/payouts-mercado-pago.ts')
  const { ErrorProveedorPagos } = await import('./apps/api/src/tus/finance/servicios/pagos.ts')
  let now = Date.parse('2026-10-02T12:00:00.000Z')
  const store = new g.AlmacenSolicitudesLiquidacionEnMemoria()
  const verificados = new Set(['t-ana', 't-beto'])
  // Mercado Pago Payouts as the adapter would see it: transfers by idempotency key, a state per
  // transfer that the test moves, and injectable failures.
  const mp = { transferencias: new Map(), seq: 0, fallas: [] }
  const ejecucion = {
    disponible: true,
    async enviar(input) {
      const falla = mp.fallas.shift()
      if (falla === 'rechazo') throw new ErrorProveedorPagos('PROVIDER_REJECTED', 'rejected')
      if (!mp.transferencias.has(input.solicitudId)) { mp.seq += 1; mp.transferencias.set(input.solicitudId, { payoutId: 'POP' + mp.seq, transactionId: 'TOP' + mp.seq, status: 'created', detail: null, input }) }
      if (falla === 'caida') throw new ErrorProveedorPagos('PROVIDER_UNAVAILABLE', 'down')
      const t = mp.transferencias.get(input.solicitudId)
      return { payoutId: t.payoutId, transactionId: t.transactionId, status: t.status }
    },
    async consultar({ payoutId }) {
      const t = [...mp.transferencias.values()].find((x) => x.payoutId === payoutId)
      return { status: t.status, statusDetail: t.detail, resultado: resultadoDeTransferencia(t.status, t.detail) }
    },
  }
  const mover = (solicitudId, status, detail) => { const t = mp.transferencias.get(solicitudId); t.status = status; t.detail = detail; return t.payoutId }
  let minimo = 1000000n
  const service = new g.ServicioGananciasPrestador(store, ejecucion, async (tenant) => verificados.has(tenant), () => now, { minimoLiquidacion: async () => minimo })
  store.prestadores.set('t-ana', 'p-ana'); store.prestadores.set('t-beto', 'p-beto')
  const ana = { tenantId: 't-ana', actorId: 'u-ana', correlationId: 'c-ana' }
  const beto = { tenantId: 't-beto', actorId: 'u-beto', correlationId: 'c-beto' }
  const admin = { tenantId: 'platform', actorId: 'u-admin', correlationId: 'c-admin' }
  const destino = { destinationEmail: 'ana@prestadora.test' }
  let n = 0
  // An approved payment TUS collected: the earning (and its reported fee) the finance service books.
  const ganar = async (tenant, gross, commission, fee = null) => {
    n += 1
    const obligation = { tenantId: 'cliente', obligacionId: 'ob-' + n, prestadorTenantId: tenant, prestadorId: store.prestadores.get(tenant), trabajoId: 'tr-' + n, currency: 'ARS' }
    const m = g.gananciaDeAprobacion({ obligation, netMinor: gross - commission, paymentId: 'pago-' + n, eventId: 'evt-' + n, now: new Date(now += 1000).toISOString() })
    await store.ledger.registrar(m)
    if (fee !== null) await store.ledger.registrar(g.tarifaDeGanancia(m, fee, 'evt-' + n, new Date(now += 1000).toISOString()))
    store.desglosesGuardados.set(obligation.obligacionId, { grossMinor: gross, commissionMinor: commission, pspFeeMinor: fee })
    return m
  }
  const codeOf = async (op) => { try { await op(); return 'none' } catch (e) { return e?.code ?? String(e) } }
  const saldo = async (ctx) => { const r = await service.resumen(ctx); return [r.availableMinor, r.negativeMinor, r.reservedMinor, r.processingMinor, r.paidMinor, r.feesMinor, r.canRequest, r.blockedReason] }
  const tipos = (solicitudId) => store.ledger.movimientos.filter((m) => m.solicitudId === solicitudId).map((m) => m.tipo).sort()
`

test('domain: the owner\'s example (15.000 -> 13.500, +20.000 = 33.500); a payout needs Mercado Pago, identity and the minimum; reserve, release and completion are movements; Mercado Pago Payouts pays it only when Mercado Pago says so; another means needs its reference; refunds, chargebacks, adjustments and negative balance', () => {
  const r = runTypeScriptScenario(`${DOMINIO}
    const out = {}
    // 1. The owner's example: a 30.000 turno, 15.000 deposit, 10% commission -> 13.500; then +20.000.
    const e1 = await ganar('t-ana', 1500000n, 150000n)
    out.primera = (await saldo(ana))[0]
    await ganar('t-ana', 2200000n, 200000n)
    out.ejemplo = (await saldo(ana)).slice(0, 2)

    // 2. Without Mercado Pago, without identity, with a bad email or extra fields: nothing.
    out.sinCuenta = [(await saldo(ana)).slice(6), await codeOf(() => service.solicitar(ana, 'clave-sin-cuenta', destino))]
    store.cuentas.set('t-ana', 'cuenta-ana')
    // PRESTADOR-SIN-KYC-01 (owner's decision): an identity not verified by TUS blocks nothing of a payout.
    verificados.delete('t-ana')
    out.sinIdentidad = (await saldo(ana))[7]
    verificados.add('t-ana')
    out.entradas = [await codeOf(() => service.solicitar(ana, 'x', destino)), await codeOf(() => service.solicitar(ana, 'clave-email-1', { destinationEmail: 'no-es-un-email' })), await codeOf(() => service.solicitar(ana, 'clave-campos-1', { ...destino, amountMinor: '1' }))]

    // 3. The minimum: above the balance nothing; exactly the balance, yes.
    minimo = 4000000n
    out.bajoMinimo = [(await saldo(ana)).slice(6), await codeOf(() => service.solicitar(ana, 'clave-bajo-minimo', destino))]
    minimo = 3350000n

    // 4. Five requests at once: one; its reserve and its items; the same key returns it.
    const carrera = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => service.solicitar(ana, 'clave-carrera-' + i, destino)))
    out.carrera = [carrera.filter((x) => x.status === 'fulfilled').length, [...new Set(carrera.filter((x) => x.status === 'rejected').map((x) => x.reason.code))]]
    const r1 = carrera.find((x) => x.status === 'fulfilled').value.payout
    out.r1 = [r1.amountMinor, r1.status, r1.destinationEmail, r1.mechanism, tipos(r1.payoutId), store.itemsGuardados.filter((i) => i.activo).length, Object.keys(r1).sort()]
    out.repetida = [(await service.solicitar(ana, store.solicitudesGuardadas[0].idempotencyKey, destino)).status, store.solicitudesGuardadas.length]
    minimo = 1000000n
    out.segunda = await codeOf(() => service.solicitar(ana, 'clave-mientras-activa', destino))
    out.reservado = await saldo(ana)
    await ganar('t-ana', 1100000n, 110000n)
    out.conNueva = (await saldo(ana)).slice(0, 3)

    // 5. Mercado Pago Payouts: sent with the request as idempotency key; paid only when the
    //    transfer queried from Mercado Pago is accredited; the admin cannot mark it paid by hand.
    out.ajeno = [await codeOf(() => service.ver(beto, r1.payoutId)), await codeOf(() => service.cancelar(beto, r1.payoutId))]
    out.mecanismoInvalido = await codeOf(() => service.procesar(admin, r1.payoutId, { mechanism: 'otro' }))
    const enviada = await service.procesar(admin, r1.payoutId, { mechanism: 'mercado_pago_payouts', note: 'Lote 1' })
    out.enviada = [enviada.status, enviada.mechanism, enviada.providerStatus, mp.transferencias.get(r1.payoutId).input.amountMinor.toString(), mp.transferencias.get(r1.payoutId).input.destinationEmail]
    out.manualSobreMp = [await codeOf(() => service.marcarPagada(admin, r1.payoutId, { externalReference: 'TRANSF-1' })), await codeOf(() => service.marcarFallida(admin, r1.payoutId, { reason: 'probando' })), await codeOf(() => service.cancelarAdmin(admin, r1.payoutId, { reason: 'probando' }))]
    out.sigueCreada = (await service.actualizarDesdeMercadoPago(admin, r1.payoutId)).status
    mover(r1.payoutId, 'success', 'in_progress')
    out.acreditando = [(await service.actualizarDesdeMercadoPago(admin, r1.payoutId)).status, (await service.ver(ana, r1.payoutId)).providerStatus]
    mover(r1.payoutId, 'success', 'accredited')
    const pagada = await service.actualizarDesdeMercadoPago(admin, r1.payoutId)
    out.pagada = [pagada.status, pagada.externalReference, tipos(r1.payoutId), await saldo(ana)]

    // 6. Mercado Pago refuses the transfer when created: failed and released.
    await ganar('t-ana', 1000000n, 100000n)
    const r2 = (await service.solicitar(ana, 'clave-segunda', destino)).payout
    mp.fallas.push('rechazo')
    const rechazada = await service.procesar(admin, r2.payoutId, { mechanism: 'mercado_pago_payouts' })
    out.rechazada = [rechazada.status, rechazada.failureReason, tipos(r2.payoutId), (await saldo(ana))[0]]

    // 7. Sending not confirmed: kept being paid (never released by hand); resending reuses the key
    //    (one transfer); then Mercado Pago rejects it for lack of funds: released.
    const r3 = (await service.solicitar(ana, 'clave-tercera', destino)).payout
    mp.fallas.push('caida')
    out.noConfirmada = [await codeOf(() => service.procesar(admin, r3.payoutId, { mechanism: 'mercado_pago_payouts' })), (await service.ver(ana, r3.payoutId)).status, (await service.ver(ana, r3.payoutId)).providerStatus, await codeOf(() => service.marcarFallida(admin, r3.payoutId, { reason: 'manual' }))]
    const reenviada = await service.reenviar(admin, r3.payoutId)
    out.reenviada = [mp.transferencias.size, Boolean(reenviada.externalReference), await codeOf(() => service.reenviar(admin, r3.payoutId))]
    mover(r3.payoutId, 'rejected', 'insufficient_funds')
    const sinFondos = await service.actualizarDesdeMercadoPago(admin, r3.payoutId)
    out.sinFondos = [sinFondos.status, sinFondos.failureReason, tipos(r3.payoutId), (await saldo(ana))[0]]

    // 8. A notification only names the payout: unknown or malformed ones are ignored, a known one
    //    is applied with what Mercado Pago answers.
    const r4 = (await service.solicitar(ana, 'clave-cuarta', destino)).payout
    await service.procesar(admin, r4.payoutId, { mechanism: 'mercado_pago_payouts' })
    out.avisos = [await service.notificacionPayout({ payout: { id: 'POP999' } }), await service.notificacionPayout({ payout: { id: '../x' } }), await service.notificacionPayout('basura')]
    const pid4 = mover(r4.payoutId, 'success', 'accredited')
    out.aviso = [await service.notificacionPayout({ id: 'T', status: 'rejected', payout: { id: pid4 } }), tipos(r4.payoutId)]

    // 9. Paid by another means: only with the reference of that operation.
    await ganar('t-ana', 1200000n, 120000n)
    const r5 = (await service.solicitar(ana, 'clave-quinta', destino)).payout
    const manual = await service.procesar(admin, r5.payoutId, { mechanism: 'manual', note: 'Transferencia bancaria' })
    out.manual = [manual.status, manual.mechanism, await codeOf(() => service.marcarPagada(admin, r5.payoutId, {})), await codeOf(() => service.marcarPagada(admin, r5.payoutId, { externalReference: 'TR-1', amountMinor: '1' })), await codeOf(() => service.actualizarDesdeMercadoPago(admin, r5.payoutId))]
    const pagadaManual = await service.marcarPagada(admin, r5.payoutId, { externalReference: 'TRANSF-2026-10-03-001', note: 'Comprobante en Drive' })
    out.pagadaManual = [pagadaManual.status, pagadaManual.externalReference, tipos(r5.payoutId), await saldo(ana)]

    // 10. Cancelled by the provider (requested) and by the administration: released.
    await ganar('t-ana', 2000000n, 200000n)
    const r6 = (await service.solicitar(ana, 'clave-sexta', destino)).payout
    out.cancelada = [(await service.cancelar(ana, r6.payoutId)).status, tipos(r6.payoutId)]
    const r7 = (await service.solicitar(ana, 'clave-septima', destino)).payout
    out.canceladaAdmin = [(await service.cancelarAdmin(admin, r7.payoutId, { reason: 'Cuenta en revisión' })).status, tipos(r7.payoutId), (await saldo(ana))[0]]

    // 11. A refund after the payout leaves a negative balance: visible, cannot be withdrawn.
    await store.ledger.registrar(g.debitoDeGanancia(e1, 'refund_debit', 'evt-refund', new Date(now += 1000).toISOString()))
    out.reembolso = await saldo(ana)
    // 12. The owner's example: +5.000, adjustment -8.000 = -3.000; +10.000 -> 7.000 available.
    await ganar('t-beto', 555556n, 55556n)
    await service.ajustar(admin, { providerTenantId: 't-beto', kind: 'debit', amountMinor: '800000', reason: 'Contracargo fuera de término' }, 'ajuste-beto-1')
    store.cuentas.set('t-beto', 'cuenta-beto')
    out.betoNegativo = [await saldo(beto), await codeOf(() => service.solicitar(beto, 'clave-beto-1', { destinationEmail: 'beto@prestador.test' }))]
    out.negativos = (await service.saldosNegativos()).map((x) => [x.providerTenantId, x.availableMinor])
    await ganar('t-beto', 1111112n, 111112n)
    out.betoCompensado = (await saldo(beto)).slice(0, 2).concat((await saldo(beto)).slice(6))

    // 13. Chargeback and adjustments: explicit movements, idempotent.
    const e9 = await ganar('t-ana', 3000000n, 300000n, 50000n)
    await store.ledger.registrar(g.debitoDeGanancia(e9, 'chargeback_debit', 'evt-cb', new Date(now += 1000).toISOString()))
    out.contracargo = (await saldo(ana)).slice(0, 2)
    out.ajustes = [(await service.ajustar(admin, { providerTenantId: 't-ana', kind: 'credit', amountMinor: '100000', reason: 'Reintegro acordado' }, 'ajuste-ana-1')).status, (await service.ajustar(admin, { providerTenantId: 't-ana', kind: 'credit', amountMinor: '100000', reason: 'Reintegro acordado' }, 'ajuste-ana-1')).status, await codeOf(() => service.ajustar(admin, { providerTenantId: 't-ana', kind: 'credit', amountMinor: '5', reason: 'Otro monto' }, 'ajuste-ana-1')), await codeOf(() => service.ajustar(admin, { providerTenantId: 't-ana', kind: 'credit', amountMinor: '5', reason: 'Motivo', tenantId: 'x' }, 'ajuste-ana-2'))]

    // 14. History, administration views and isolation.
    const historial = await service.historial(ana)
    out.historialTipos = [...new Set(historial.map((h) => h.kind))].sort()
    out.liquidaciones = (await service.liquidaciones(ana)).map((x) => x.status)
    const lista = await service.listar({ status: 'paid' })
    out.lista = [lista.total, lista.items.every((x) => x.status === 'paid'), (await service.listar({ status: 'open' })).total, await codeOf(() => service.listar({ status: 'raro' }))]
    const detalle = await service.detalle(r1.payoutId)
    out.detalle = [detalle.items.length, detalle.movements.map((x) => x.kind).sort(), detalle.payout.note, detalle.payout.processedBy, detalle.payout.resolvedBy, detalle.automaticAvailable]
    out.sinIds = /t-ana|p-ana|cuenta-ana|ob-\\d|tr-\\d|earning:|payout-reserve:/u.test(JSON.stringify([await service.resumen(ana), historial, await service.liquidaciones(ana)]))
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.primera, '1350000', 'Ganancias disponibles $13.500')
  assert.deepEqual(r.ejemplo, ['3350000', '0'], 'Ganancias disponibles $33.500')
  assert.deepEqual(r.sinCuenta, [[false, 'PAYMENT_ACCOUNT_REQUIRED'], 'PAYMENT_ACCOUNT_REQUIRED'])
  assert.equal(r.sinIdentidad, null, 'with Mercado Pago linked, an unverified identity is not a reason')
  assert.deepEqual(r.entradas, ['IDEMPOTENCY_KEY_REQUIRED', 'INVALID_DESTINATION_EMAIL', 'UNTRUSTED_PAYOUT_FIELDS'])
  assert.deepEqual(r.bajoMinimo, [[false, 'BELOW_MINIMUM'], 'PAYOUT_BELOW_MINIMUM'])
  assert.deepEqual(r.carrera, [1, ['PAYOUT_ALREADY_OPEN']])
  assert.deepEqual(r.r1, ['3350000', 'requested', 'ana@prestadora.test', null, ['payout_reserve'], 2, ['amountMinor', 'createdAt', 'currency', 'destinationEmail', 'externalReference', 'failureReason', 'mechanism', 'paidAt', 'payoutId', 'processingAt', 'providerStatus', 'status', 'updatedAt']])
  assert.deepEqual(r.repetida, ['existing', 1])
  assert.equal(r.segunda, 'PAYOUT_ALREADY_OPEN')
  assert.deepEqual(r.reservado, ['0', '0', '3350000', '0', '0', '0', false, 'PAYOUT_IN_PROGRESS'])
  assert.deepEqual(r.conNueva, ['990000', '0', '3350000'])
  assert.deepEqual(r.ajeno, ['NOT_FOUND', 'NOT_FOUND'])
  assert.equal(r.mecanismoInvalido, 'INVALID')
  assert.deepEqual(r.enviada, ['processing', 'mercado_pago_payouts', 'created', '3350000', 'ana@prestadora.test'])
  assert.deepEqual(r.manualSobreMp, ['INVALID_TRANSITION', 'PAYOUT_SENT_TO_PROVIDER', 'PAYOUT_SENT_TO_PROVIDER'], 'a Mercado Pago transfer is resolved only by Mercado Pago')
  assert.equal(r.sigueCreada, 'processing')
  assert.deepEqual(r.acreditando, ['processing', 'success:in_progress'])
  assert.deepEqual(r.pagada, ['paid', 'POP1/TOP1', ['payout_completed', 'payout_reserve'], ['990000', '0', '0', '0', '3350000', '0', false, 'BELOW_MINIMUM']])
  assert.deepEqual(r.rechazada, ['failed', 'mercado_pago_rejected', ['payout_release', 'payout_reserve'], '1890000'])
  assert.deepEqual(r.noConfirmada, ['PAYOUT_SEND_UNCONFIRMED', 'processing', 'send_unconfirmed', 'PAYOUT_SENT_TO_PROVIDER'])
  assert.deepEqual(r.reenviada, [2, true, 'INVALID_TRANSITION'], 'resending reuses the transfer; once confirmed it cannot be resent')
  assert.deepEqual(r.sinFondos, ['failed', 'mercado_pago:rejected:insufficient_funds', ['payout_release', 'payout_reserve'], '1890000'])
  assert.deepEqual(r.avisos, [{ status: 'ignored' }, { status: 'ignored' }, { status: 'ignored' }])
  assert.deepEqual(r.aviso, [{ status: 'applied', payoutStatus: 'paid' }, ['payout_completed', 'payout_reserve']], 'the notification said rejected; Mercado Pago says accredited: paid')
  assert.deepEqual(r.manual, ['processing', 'manual', 'INVALID', 'UNTRUSTED_PAYOUT_FIELDS', 'NOT_A_MERCADO_PAGO_PAYOUT'])
  assert.deepEqual(r.pagadaManual, ['paid', 'TRANSF-2026-10-03-001', ['payout_completed', 'payout_reserve'], ['0', '0', '0', '0', '6320000', '0', false, 'NO_FUNDS']])
  assert.deepEqual(r.cancelada, ['cancelled', ['payout_release', 'payout_reserve']])
  assert.deepEqual(r.canceladaAdmin, ['cancelled', ['payout_release', 'payout_reserve'], '1800000'])
  assert.deepEqual(r.reembolso, ['450000', '0', '0', '0', '6320000', '0', false, 'BELOW_MINIMUM'])
  assert.deepEqual(r.betoNegativo, [['-300000', '300000', '0', '0', '0', '0', false, 'NO_FUNDS'], 'PAYOUT_NO_FUNDS'], '+5.000 - 8.000 = -3.000: cannot be withdrawn')
  assert.deepEqual(r.negativos, [['t-beto', '-300000']])
  assert.deepEqual(r.betoCompensado, ['700000', '0', false, 'BELOW_MINIMUM'], '-3.000 + 10.000 = 7.000 available')
  assert.deepEqual(r.contracargo, ['400000', '0'], 'the chargeback cancels its earning; its fee stays the provider\'s')
  assert.deepEqual(r.ajustes, ['created', 'existing', 'IDEMPOTENCY_CONFLICT', 'UNTRUSTED_ADJUSTMENT_FIELDS'])
  assert.deepEqual(r.historialTipos, ['adjustment', 'chargeback', 'earning', 'mercado_pago_fee', 'payout_completed', 'payout_release', 'payout_reserve', 'refund'])
  assert.deepEqual(r.liquidaciones, ['cancelled', 'cancelled', 'paid', 'paid', 'failed', 'failed', 'paid'])
  assert.deepEqual(r.lista, [3, true, 0, 'INVALID'])
  assert.deepEqual(r.detalle, [2, ['payout_completed', 'payout_reserve'], 'Lote 1', 'u-admin', 'u-admin', true])
  assert.equal(r.sinIds, false, 'no internal identifier reaches the provider')
})

test('Mercado Pago Payouts adapter (offline API with the documented contract): sandbox header, idempotency, exact amount, account by email, notification URL; production signs the body with Ed25519 (verified with the public key) and refuses to exist without the key; 4xx is a rejection, 5xx is ambiguous; states mapped as documented', () => {
  const r = runTypeScriptScenario(`
    ${MERCADO_PAGO_API_SETUP}
    const { EjecucionLiquidacionMercadoPago, clavePrivadaPayouts, resultadoDeTransferencia } = await import('./apps/api/src/tus/finance/servicios/payouts-mercado-pago.ts')
    const { crearModuloPagosServicio } = await import('./apps/api/src/tus/finance/servicios/composicion-pagos.ts')
    const { AlmacenConfiguracionPagosEnMemoria } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    const { AlmacenCuentasCobroEnMemoria } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
    mp.sellers.set('fictitious-platform-token-555', '555')
    const codeOf = async (op) => { try { await op(); return 'none' } catch (e) { return e?.code ?? e?.message ?? String(e) } }
    const out = {}
    const sandbox = new EjecucionLiquidacionMercadoPago({ environment: 'sandbox', accessToken: 'fictitious-platform-token-555', signingKey: null, notificationUrl: 'https://api.tus.test/payouts', fetch: mpFetch })
    const creada = await sandbox.enviar({ solicitudId: 'liq-abc-1', amountMinor: 1234567n, destinationEmail: 'prestador@test.com', description: 'Pago de ganancias TUS' })
    const otraVez = await sandbox.enviar({ solicitudId: 'liq-abc-1', amountMinor: 1234567n, destinationEmail: 'prestador@test.com', description: 'Pago de ganancias TUS' })
    const post = mp.requests.find((x) => x.path === '/v1/payouts')
    out.sandbox = [creada, otraVez.payoutId === creada.payoutId, mp.payouts.size, post.headers['x-test-token'], post.headers['x-idempotency-key'], 'x-signature' in post.headers, post.body]
    out.consulta = [await sandbox.consultar(creada)]
    mp.payouts.get(creada.payoutId).status = 'success'; mp.payouts.get(creada.payoutId).statusDetail = 'accredited'
    out.consulta.push(await sandbox.consultar(creada))
    out.consultaAjena = await codeOf(() => sandbox.consultar({ payoutId: creada.payoutId, transactionId: 'TOP99999999' }))
    out.idsInvalidos = await codeOf(() => sandbox.consultar({ payoutId: '../../v1/payments', transactionId: 'x' }))
    mp.payoutRejectEmails.add('noexiste@test.com')
    out.rechazo = await codeOf(() => sandbox.enviar({ solicitudId: 'liq-abc-2', amountMinor: 100000n, destinationEmail: 'noexiste@test.com', description: 'x' }))
    mp.payoutsDown = 1
    out.caida = await codeOf(() => sandbox.enviar({ solicitudId: 'liq-abc-3', amountMinor: 100000n, destinationEmail: 'prestador@test.com', description: 'x' }))
    out.reenvio = [(await sandbox.enviar({ solicitudId: 'liq-abc-3', amountMinor: 100000n, destinationEmail: 'prestador@test.com', description: 'x' })).payoutId, [...mp.payouts.values()].filter((x) => x.idempotencyKey === 'liq-abc-3').length]
    out.minimo = await codeOf(() => sandbox.enviar({ solicitudId: 'liq-abc-4', amountMinor: 99n, destinationEmail: 'prestador@test.com', description: 'x' }))

    // Production: Ed25519 signature of the exact body, verified by Mercado Pago with the public key.
    const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519')
    mp.payoutPublicKey = publicKey
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const produccion = new EjecucionLiquidacionMercadoPago({ environment: 'production', accessToken: 'fictitious-platform-token-555', signingKey: clavePrivadaPayouts(pem.replace(/\\n/g, '\\\\n')), notificationUrl: null, fetch: mpFetch })
    const firmada = await produccion.enviar({ solicitudId: 'liq-prod-1', amountMinor: 500000n, destinationEmail: 'prestador@test.com', description: 'x' })
    const postProd = mp.requests.filter((x) => x.path === '/v1/payouts').at(-1)
    out.produccion = [Boolean(firmada.payoutId), postProd.headers['x-enforce-signature'], 'x-test-token' in postProd.headers, nodeCrypto.verify(null, Buffer.from(postProd.raw, 'utf8'), publicKey, Buffer.from(postProd.headers['x-signature'], 'base64')), 'config' in postProd.body]
    const otraClave = nodeCrypto.generateKeyPairSync('ed25519').privateKey
    const malFirmada = new EjecucionLiquidacionMercadoPago({ environment: 'production', accessToken: 'fictitious-platform-token-555', signingKey: otraClave, notificationUrl: null, fetch: mpFetch })
    out.firmaInvalida = await codeOf(() => malFirmada.enviar({ solicitudId: 'liq-prod-2', amountMinor: 500000n, destinationEmail: 'prestador@test.com', description: 'x' }))
    out.sinClave = await codeOf(async () => new EjecucionLiquidacionMercadoPago({ environment: 'production', accessToken: 'fictitious-platform-token-555', signingKey: null, notificationUrl: null }))
    out.claveNoEd25519 = await codeOf(async () => clavePrivadaPayouts(nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()))

    // States as documented.
    out.estados = [['success', 'accredited'], ['success', 'in_progress'], ['created', null], ['approved', null], ['processed', 'approved'], ['transaction_in_process', 'pending_bank'], ['rejected', 'by_bank'], ['error', 'failed'], ['canceled', null], ['refunded', 'refunded']].map(([s, d]) => resultadoDeTransferencia(s, d))

    // Composition: payouts exist only when explicitly enabled and fully configured.
    const base = { TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'sandbox', MERCADO_PAGO_CLIENT_ID: 'app-1', MERCADO_PAGO_CLIENT_SECRET: 'fictitious-value', MERCADO_PAGO_WEBHOOK_SECRET: 'fictitious-value', MERCADO_PAGO_OAUTH_REDIRECT_URI: 'https://api.tus.test/cb', MERCADO_PAGO_NOTIFICATION_URL: 'https://api.tus.test/wh', TUS_PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString('base64'), TUS_WEB_BASE_URL: 'https://web.tus.test', MERCADO_PAGO_PLATFORM_ACCESS_TOKEN: 'fictitious-platform-token-555', MERCADO_PAGO_PLATFORM_USER_ID: '555' }
    const modulo = (env) => crearModuloPagosServicio({ env, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas: new AlmacenCuentasCobroEnMemoria() }).liquidaciones.disponible
    out.composicion = [
      modulo(base),
      modulo({ ...base, TUS_MERCADOPAGO_PAYOUTS_ENABLED: 'true' }),
      modulo({ ...base, TUS_MERCADOPAGO_PAYOUTS_ENABLED: 'true', MERCADO_PAGO_PLATFORM_ACCESS_TOKEN: '' }),
      modulo({ ...base, TUS_MERCADOPAGO_PAYOUTS_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'production' }),
      modulo({ ...base, TUS_MERCADOPAGO_PAYOUTS_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'production', MERCADO_PAGO_PAYOUTS_SIGNING_KEY: pem }),
      modulo({ ...base, TUS_MERCADOPAGO_PAYOUTS_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'production', MERCADO_PAGO_PAYOUTS_SIGNING_KEY: 'no-es-una-clave' }),
      modulo({ ...base, TUS_MERCADOPAGO_PAYOUTS_ENABLED: 'true', MERCADO_PAGO_PAYOUTS_NOTIFICATION_URL: 'http://inseguro.test' }),
    ]
    out.sinSecretos = /platform-token|PRIVATE KEY/u.test(JSON.stringify([out.sandbox[0], out.consulta]))
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.sandbox, [
    { payoutId: 'POP00000001', transactionId: 'TOP00000001', status: 'created' },
    true,
    1,
    'true',
    'liq-abc-1',
    false,
    { external_reference: 'liq-abc-1', description: 'Pago de ganancias TUS', config: { notification_url: 'https://api.tus.test/payouts' }, transactions: [{ type: 'account', description: 'Pago de ganancias TUS', account: { email: 'prestador@test.com' }, amount: { currency: 'ARS', value: 12345.67 }, external_reference: 'liq-abc-1' }] },
  ], 'the documented request: one account transaction, exact amount, the request id as idempotency key and reference')
  assert.deepEqual(r.consulta, [{ status: 'created', statusDetail: null, resultado: 'processing' }, { status: 'success', statusDetail: 'accredited', resultado: 'paid' }])
  assert.equal(r.consultaAjena, 'PROVIDER_REJECTED')
  assert.equal(r.idsInvalidos, 'PROVIDER_REJECTED', 'ids are validated before building a URL')
  assert.equal(r.rechazo, 'PROVIDER_REJECTED')
  assert.equal(r.caida, 'PROVIDER_UNAVAILABLE')
  assert.deepEqual(r.reenvio, ['POP00000002', 1], 'after an ambiguous failure, resending with the same key returns the same transfer')
  assert.equal(r.minimo, 'PROVIDER_REJECTED')
  assert.deepEqual(r.produccion, [true, 'true', false, true, false])
  assert.equal(r.firmaInvalida, 'PROVIDER_REJECTED')
  assert.match(r.sinClave, /signing key/u)
  assert.match(r.claveNoEd25519, /Ed25519/u)
  assert.deepEqual(r.estados, ['paid', 'processing', 'processing', 'processing', 'processing', 'processing', 'failed', 'failed', 'failed', 'failed'])
  assert.deepEqual(r.composicion, [false, true, false, false, true, false, false], 'disabled unless enabled, with the platform account, and in production with a valid signing key; an insecure notification URL is refused')
  assert.equal(r.sinSecretos, false)
})

test('administrative minimum: $10.000 by default, changed only by recording a payment configuration (versioned), validated, kept when not sent', () => {
  const r = runTypeScriptScenario(`
    const { ServicioConfiguracionPagos, AlmacenConfiguracionPagosEnMemoria, MONTO_MINIMO_LIQUIDACION_POR_DEFECTO_MINOR } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    const operativo = () => ({ mercadoPagoEnabled: false, environment: 'sandbox' })
    const config = new ServicioConfiguracionPagos(new AlmacenConfiguracionPagosEnMemoria(), operativo)
    const admin = { actorId: 'u-admin', correlationId: 'c' }
    const codeOf = async (op) => { try { await op(); return 'none' } catch (e) { return e?.code ?? String(e) } }
    const out = { defecto: [MONTO_MINIMO_LIQUIDACION_POR_DEFECTO_MINOR.toString(), (await config.minimoLiquidacion()).toString(), (await config.configuracionActual()).effective.minimumPayoutMinor] }
    const v1 = await config.registrarConfiguracion(admin, { paymentsEnabled: true, reason: 'activar', expectedVersion: 0 })
    out.v1 = [v1.minimumPayoutMinor, (await config.minimoLiquidacion()).toString()]
    out.invalidos = []
    for (const valor of ['0', '-1', '1e5', '10000.5', 10000, '', '1000000000000001']) out.invalidos.push(await codeOf(() => config.registrarConfiguracion(admin, { paymentsEnabled: true, reason: 'x', expectedVersion: 1, minimumPayoutMinor: valor })))
    const v2 = await config.registrarConfiguracion(admin, { paymentsEnabled: true, reason: 'subir mínimo', expectedVersion: 1, minimumPayoutMinor: '2500000' })
    out.v2 = [v2.version, v2.minimumPayoutMinor, (await config.minimoLiquidacion()).toString()]
    const v3 = await config.registrarConfiguracion(admin, { paymentsEnabled: false, reason: 'pausar', expectedVersion: 2 })
    out.v3 = [v3.minimumPayoutMinor, (await config.minimoLiquidacion()).toString()]
    out.conflicto = await codeOf(() => config.registrarConfiguracion(admin, { paymentsEnabled: true, reason: 'x', expectedVersion: 1, minimumPayoutMinor: '1' }))
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.defecto, ['1000000', '1000000', '1000000'], '$10.000,00 while nothing was configured')
  assert.deepEqual(r.v1, ['1000000', '1000000'])
  assert.deepEqual(r.invalidos, ['INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID'])
  assert.deepEqual(r.v2, [2, '2500000', '2500000'], 'the administration changes the minimum')
  assert.deepEqual(r.v3, ['2500000', '2500000'], 'a configuration without the field keeps the minimum in force')
  assert.equal(r.conflicto, 'VERSION_CONFLICT')
})

test('Mercado Pago platform collection (real adapter, offline API): without a linked account TUS collects with its own token and no marketplace_fee; the approval books the earning and the reported fee; a fee reported later is debited then; a refund goes from the TUS account and books a debit; once linked, Split 1:1 is unchanged and books nothing', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${MERCADO_PAGO_SANDBOX_SETUP}
    const PLATFORM_TOKEN = 'fictitious-platform-token-555'
    mp.sellers.set(PLATFORM_TOKEN, '555')
    const env = { ...mpEnv, MERCADO_PAGO_PLATFORM_ACCESS_TOKEN: PLATFORM_TOKEN, MERCADO_PAGO_PLATFORM_USER_ID: '555' }
    const modulo = crearModuloPagosServicio({ env, configuracion: paymentsConfig, cuentas: accountsStore, now: mpClock, mercadoPago: { fetch: mpFetch }, oauth: new ClienteOAuthMercadoPagoHttp({ clientId: 'app-123', clientSecret: mpEnv.MERCADO_PAGO_CLIENT_SECRET, testToken: true, fetch: mpFetch }) })
    const fin = new ServicioFinanzasServicios(new TransaccionFinanzasServicioEnMemoria(financeStore, new IdentidadServicioEnMemoria(workStore, marketplace)), mpClock, modulo.proveedor, undefined, modulo.politica)
    const conecta = async (tenantId, userId) => { const s = await modulo.cuentas.iniciarConexion({ tenantId, actorId: 'seller-user', correlationId: 'c' }); return modulo.cuentas.completarConexion({ code: 'TG-code-' + userId, state: new URL(s.authorizationUrl).searchParams.get('state'), correlationId: 'c' }) }
    const out = { cobroPlataforma: modulo.cobroPlataforma, sinVariables: paymentsWithOauth.cobroPlataforma }
    const ganancias = () => [...financeStore.state.ganancias.values()].map((m) => [m.tipo, m.amountMinor.toString(), m.prestadorTenantId])

    const a = await payableWork('sin-plataforma', '5000000')
    out.sinPlataforma = await codeOf(() => mpFinance.iniciarCheckout({ ...customer, trabajoId: a.work.trabajoId, idempotencyKey: 'k-a' }))

    const b = await payableWork('plataforma', '5000000')
    out.vista = (await fin.consultarVistaPreviaPago({ ...customer, trabajoId: b.work.trabajoId })).paymentAvailable
    const checkout = await fin.iniciarCheckout({ ...customer, trabajoId: b.work.trabajoId, idempotencyKey: 'k-b' })
    const pref = mp.preferences.find((p) => p.body.external_reference === checkout.payment.paymentId)
    const req = mp.requests.find((x) => x.path === '/checkout/preferences' && x.body.external_reference === checkout.payment.paymentId)
    out.preferencia = [pref.seller, 'marketplace_fee' in pref.body, 'marketplace' in pref.body, pref.body.items[0].unit_price, req.headers.authorization === 'Bearer ' + PLATFORM_TOKEN]
    const intent = [...financeStore.state.intenciones.values()].find((i) => i.paymentId === checkout.payment.paymentId)
    out.intencion = [intent.collectionMode, intent.commission.commissionMinor.toString()]

    mpPayment('7001', pref, { marketplace_fee: 5000 })
    const conFee = await fin.ingerirEventoProveedor(notification('7001', { userId: '555' }))
    out.conFee = [conFee.result, conFee.reason, ganancias().length]
    mpPayment('7002', pref, { date_last_updated: '2026-09-23T10:07:00.000Z' })
    const aprobado = await fin.ingerirEventoProveedor(notification('7002', { userId: '555', notificationId: 'n-ok' }))
    const repetido = await fin.ingerirEventoProveedor(notification('7002', { userId: '555', notificationId: 'n-ok' }))
    out.aprobado = [aprobado.result, aprobado.obligation.status, repetido.status, ganancias()]
    out.consulta = mp.requests.filter((x) => x.path === '/v1/payments/7002').every((x) => x.headers.authorization === 'Bearer ' + PLATFORM_TOKEN)
    out.liquidacion = [...financeStore.state.liquidaciones.values()].map((s) => [s.status, s.netMinor.toString()])

    const d = await payableWork('plataforma-diferida', '2000000')
    const diferido = await fin.iniciarCheckout({ ...customer, trabajoId: d.work.trabajoId, idempotencyKey: 'k-d' })
    const prefD = mp.preferences.find((p) => p.body.external_reference === diferido.payment.paymentId)
    mpPayment('7004', prefD, { fee_details: [], date_last_updated: '2026-09-23T10:08:00.000Z' })
    await fin.ingerirEventoProveedor(notification('7004', { userId: '555' }))
    const antesDeTarifa = [ganancias().some((m) => m[0] === 'earning_credit' && m[1] === '1800000'), ganancias().filter((m) => m[0] === 'psp_fee_debit').map((m) => m[1])]
    mp.payments.set('7004', { ...mp.payments.get('7004'), fee_details: [{ type: 'mercadopago_fee', amount: 1200, fee_payer: 'collector' }], date_last_updated: '2026-09-23T10:09:00.000Z' })
    const tarifaTardia = await fin.ingerirEventoProveedor(notification('7004', { userId: '555' }))
    await fin.ingerirEventoProveedor(notification('7004', { userId: '555' }))
    out.diferida = [antesDeTarifa, tarifaTardia.result, ganancias().filter((m) => m[0] === 'psp_fee_debit').map((m) => m[1])]

    const reembolso = await fin.solicitarReembolso({ tenantId: customer.tenantId, paymentId: checkout.payment.paymentId, actorId: 'platform-admin', correlationId: 'r', idempotencyKey: 'refund-plat', reason: 'servicio no prestado' })
    out.reembolso = [reembolso.status, mp.refunds.map((x) => [x.paymentId, x.seller])]
    mp.payments.set('7002', { ...mp.payments.get('7002'), status: 'refunded', status_detail: 'refunded', date_last_updated: '2026-09-23T11:00:00.000Z' })
    const reembolsado = await fin.ingerirEventoProveedor(notification('7002', { userId: '555' }))
    out.reembolsado = [reembolsado.result, ganancias().filter((m) => m[0] === 'refund_debit')]

    const antes = ganancias().length
    await conecta(provider.tenantId, '777')
    const c = await payableWork('split', '5000000')
    const split = await fin.iniciarCheckout({ ...customer, trabajoId: c.work.trabajoId, idempotencyKey: 'k-c' })
    const prefSplit = mp.preferences.find((p) => p.body.external_reference === split.payment.paymentId)
    mpPayment('7003', prefSplit)
    const aprobadoSplit = await fin.ingerirEventoProveedor(notification('7003', { userId: '555' }))
    out.split = [prefSplit.seller, prefSplit.body.marketplace_fee, [...financeStore.state.intenciones.values()].find((i) => i.paymentId === split.payment.paymentId).collectionMode, aprobadoSplit.result, ganancias().length - antes > 0]
    out.sinSecretos = /APP_USR|TG-refresh/u.test(JSON.stringify(plain([...financeStore.state.ganancias.values(), ...financeStore.state.intenciones.values()])))
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual([r.cobroPlataforma, r.sinVariables], [true, false], 'platform collection exists only with the platform token and user configured')
  assert.equal(r.sinPlataforma, 'PROVIDER_ACCOUNT_NOT_CONNECTED', 'unchanged without the platform account')
  assert.equal(r.vista, true)
  assert.deepEqual(r.preferencia, ['555', false, false, 50000, true], 'TUS own preference: no marketplace_fee, no split')
  assert.deepEqual(r.intencion, ['plataforma', '500000'], 'the mode and the commission are frozen on the payment')
  assert.deepEqual(r.conFee, ['quarantined', 'marketplace_fee_unexpected', 0])
  assert.deepEqual(r.aprobado, ['applied', 'paid', 'duplicate', [['earning_credit', '4500000', 'provider-tenant'], ['psp_fee_debit', '300000', 'provider-tenant']]], '50.000 - 5.000 TUS - 3.000 Mercado Pago = 42.000 for the provider, as in Split 1:1')
  assert.equal(r.consulta, true, 'the payment is read with the TUS account')
  // PAGOS-RETENCION-01: before, this settlement stayed 'held' for ever and the earning was withdrawable
  // anyway. Now the hold is real, and a payment TUS collects for a work that is ALREADY completed has
  // reached its release milestone: it is released by that same approval.
  assert.deepEqual(r.liquidacion, [['eligible', '4500000']], 'collected after the work was completed: released at once')
  assert.deepEqual(r.diferida, [[true, ['300000']], 'no_op', ['300000', '120000']], 'the late fee (1.200,00) is debited once, when reported')
  assert.deepEqual(r.reembolso[0], 'submitted')
  assert.deepEqual(r.reembolso[1], [['7002', '555']], 'refunded from the account that collected it')
  assert.deepEqual(r.reembolsado, ['applied', [['refund_debit', '4500000', 'provider-tenant']]])
  // COBRO-POR-PLATAFORMA-01 (owner's decision): once the provider linked Mercado Pago its payments are
  // STILL collected by TUS (before: Split 1:1 straight to the provider, booking no earning).
  assert.deepEqual(r.split, ['555', undefined, 'plataforma', 'applied', true].map((x) => x ?? null), 'linked or not: collected by TUS, no marketplace_fee, and the share is an earning in TUS')
  assert.equal(r.sinSecretos, false)
})

test('HTTP: provider earnings and payouts are the session provider\'s only; the body carries only the destination email; the administration (MFA) lists, details, processes, pays by another means with its reference, fails and cancels; the public Payouts notification is never trusted', () => {
  const r = runTypeScriptScenario(`
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { InMemoryTusCommitmentStore, InMemoryTusCompensationStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction, InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { AlmacenConfiguracionPagosEnMemoria } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    const { AlmacenCuentasCobroEnMemoria } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
    const { crearModuloPagosServicio } = await import('./apps/api/src/tus/finance/servicios/composicion-pagos.ts')
    const g = await import('./apps/api/src/tus/finance/servicios/ganancias.ts')
    const { MfaAdminSessionResolver } = await import('./apps/api/src/auth-security/mfa/admin-gate.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const TENANT = 'platform-tenant'
    const env = { TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'sandbox', MERCADO_PAGO_CLIENT_ID: 'fictitious-id', MERCADO_PAGO_CLIENT_SECRET: 'fictitious-value', MERCADO_PAGO_WEBHOOK_SECRET: 'fictitious-value', MERCADO_PAGO_OAUTH_REDIRECT_URI: 'https://api.tus.test/cb', MERCADO_PAGO_NOTIFICATION_URL: 'https://api.tus.test/wh', TUS_PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64'), TUS_WEB_BASE_URL: 'https://web.tus.test', TUS_PLATFORM_ADMIN_TENANT_ID: TENANT }
    const payments = crearModuloPagosServicio({ env, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas: new AlmacenCuentasCobroEnMemoria() })
    const store = new g.AlmacenSolicitudesLiquidacionEnMemoria()
    store.prestadores.set('provider-tenant', 'p-1'); store.prestadores.set('other-provider', 'p-2'); store.cuentas.set('provider-tenant', 'cuenta-1')
    const obligation = { tenantId: 'client-tenant', obligacionId: 'ob-1', prestadorTenantId: 'provider-tenant', prestadorId: 'p-1', trabajoId: 'tr-1', currency: 'ARS' }
    await store.ledger.registrar(g.gananciaDeAprobacion({ obligation, netMinor: 1125000n, paymentId: 'pago-1', eventId: 'e-1', now: '2026-10-02T10:00:00.000Z' }))
    // As the composition wires it: Payouts not configured here (payments.liquidaciones), the
    // minimum from the payment configuration.
    const providerEarnings = new g.ServicioGananciasPrestador(store, payments.liquidaciones, async () => true, () => Date.now(), { minimoLiquidacion: () => payments.configuracion.minimoLiquidacion() })
    const commitments = new InMemoryTusCommitmentStore(); const compensations = new InMemoryTusCompensationStore(); const audits = new AlmacenReferenciasAuditoriaEnMemoria(); const idempotency = new InMemoryTusIdempotencyStore(); const outbox = new InMemoryTusOutboxStore()
    const application = new TusApplicationService({ commitments, compensations, audits, idempotency, outbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, outbox, compensations }), servicePayments: payments, providerEarnings })
    const inner = new InMemoryTusSessionResolver()
    inner.add('admin-mfa', { sessionId: 's-mfa', subjectId: 'acc-admin', tenantId: TENANT, roles: ['owner'], permissions: ['tus:payments:admin'] })
    inner.add('admin-sin-mfa', { sessionId: 's-plain', subjectId: 'acc-admin', tenantId: TENANT, roles: ['owner'], permissions: ['tus:payments:admin'] })
    inner.add('cliente', { sessionId: 's-c', subjectId: 'acc-client', tenantId: 'client-tenant', roles: ['owner'], permissions: ['tus:checkout', 'tus:work:read'] })
    inner.add('prestador', { sessionId: 's-p', subjectId: 'acc-provider', tenantId: 'provider-tenant', roles: ['owner', 'merchant'], permissions: ['tus:marketplace:write'] })
    inner.add('otro', { sessionId: 's-o', subjectId: 'acc-other', tenantId: 'other-provider', roles: ['owner', 'merchant'], permissions: ['tus:marketplace:write'] })
    const sessions = new MfaAdminSessionResolver(inner, { isElevated: async (subject) => subject.sessionId === 's-mfa' }, { getAccount: async (id) => (id === 'acc-admin' ? { email: 'admin@tus.test', normalizedEmail: 'admin@tus.test', emailVerifiedAt: 1, status: 'active' } : undefined) }, () => ['admin@tus.test'])
    const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const call = async (method, path, token, body, headers = {}) => { const response = await fetch(base + path, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-correlation-id': 'corr-http', 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); const text = await response.text(); let parsed = null; try { parsed = JSON.parse(text) } catch {} return { status: response.status, body: parsed, text, cache: response.headers.get('cache-control') } }
    const destino = { destinationEmail: 'prestador@mp.test' }
    const out = {}
    try {
      out.acceso = []
      for (const token of [null, 'cliente']) out.acceso.push([token, (await call('GET', '/tus/v1/provider/earnings', token)).status, (await call('POST', '/tus/v1/provider/earnings/payouts', token, destino, { 'idempotency-key': 'clave-acceso-1' })).status, (await call('GET', '/tus/v1/provider/earnings/payouts', token)).status])
      const resumen = await call('GET', '/tus/v1/provider/earnings', 'prestador')
      out.resumen = [resumen.status, resumen.cache, resumen.body.availableMinor, resumen.body.minimumPayoutMinor, resumen.body.canRequest, resumen.body.negativeMinor]
      out.otro = (await call('GET', '/tus/v1/provider/earnings', 'otro')).body.availableMinor
      const conMonto = await call('POST', '/tus/v1/provider/earnings/payouts', 'prestador', { ...destino, amountMinor: '1' }, { 'idempotency-key': 'clave-monto-1' })
      const conTenant = await call('POST', '/tus/v1/provider/earnings/payouts', 'prestador', destino, { 'idempotency-key': 'clave-tenant-1', 'x-tenant-id': 'other-provider' })
      const sinClave = await call('POST', '/tus/v1/provider/earnings/payouts', 'prestador', destino)
      const sinEmail = await call('POST', '/tus/v1/provider/earnings/payouts', 'prestador', {}, { 'idempotency-key': 'clave-email-1' })
      out.rechazos = [[conMonto.status, conMonto.body.code], [conTenant.status, conTenant.body.code], [sinClave.status, sinClave.body.code], [sinEmail.status, sinEmail.body.code], store.solicitudesGuardadas.length]
      const creada = await call('POST', '/tus/v1/provider/earnings/payouts', 'prestador', destino, { 'idempotency-key': 'clave-http-1' })
      const repetida = await call('POST', '/tus/v1/provider/earnings/payouts', 'prestador', destino, { 'idempotency-key': 'clave-http-1' })
      const segunda = await call('POST', '/tus/v1/provider/earnings/payouts', 'prestador', destino, { 'idempotency-key': 'clave-http-2' })
      out.solicitud = [creada.status, creada.body.payout.amountMinor, creada.body.payout.destinationEmail, repetida.status, [segunda.status, segunda.body.code]]
      const id = creada.body.payout.payoutId
      out.ver = [(await call('GET', '/tus/v1/provider/earnings/payouts/' + id, 'prestador')).status, (await call('GET', '/tus/v1/provider/earnings/payouts/' + id, 'otro')).status, (await call('POST', '/tus/v1/provider/earnings/payouts/' + id + '/cancel', 'otro', {})).status, (await call('GET', '/tus/v1/provider/earnings/payouts', 'prestador')).body.items.length, (await call('GET', '/tus/v1/provider/earnings/payouts', 'otro')).body.items.length]
      out.historial = (await call('GET', '/tus/v1/provider/earnings/history', 'prestador')).body.items.map((h) => [h.kind, h.status]).sort()
      const RUTAS = [['GET', '/tus/v1/admin/payments/payouts'], ['GET', '/tus/v1/admin/payments/payouts/' + id], ['POST', '/tus/v1/admin/payments/payouts/' + id + '/process'], ['GET', '/tus/v1/admin/payments/earnings/negative-balances'], ['GET', '/tus/v1/admin/payments/earnings/reconciliation?providerTenantId=provider-tenant'], ['POST', '/tus/v1/admin/payments/earnings/adjustments'], ['GET', '/tus/v1/admin/payments/payouts/' + id + '/audit']]
      out.admin = []
      for (const token of [null, 'cliente', 'prestador', 'admin-sin-mfa']) out.admin.push([token, ...(await Promise.all(RUTAS.map(([method, path]) => call(method, path, token, method === 'POST' ? {} : undefined, { 'idempotency-key': 'clave-admin-1' }).then((x) => x.status))))])
      const lista = await call('GET', '/tus/v1/admin/payments/payouts?status=open', 'admin-mfa')
      const detalle = await call('GET', '/tus/v1/admin/payments/payouts/' + id, 'admin-mfa')
      out.lista = [lista.status, lista.body.total, lista.body.automaticAvailable, lista.body.items[0].providerTenantId, detalle.status, detalle.body.items.length, detalle.body.movements.map((x) => x.kind)]
      const auditoria = await call('GET', '/tus/v1/admin/payments/payouts/' + id + '/audit', 'admin-mfa')
      out.auditoria = [auditoria.status, auditoria.cache, auditoria.body.items.map((x) => [x.action, x.previousStatus, x.status, x.actorId]), detalle.body.audit.length, (await call('GET', '/tus/v1/admin/payments/payouts/liq-ajena/audit', 'admin-mfa')).status]
      const viaMp = await call('POST', '/tus/v1/admin/payments/payouts/' + id + '/process', 'admin-mfa', { mechanism: 'mercado_pago_payouts' })
      out.sinPayouts = [viaMp.status, viaMp.body.code]
      out.accionDesconocida = (await call('POST', '/tus/v1/admin/payments/payouts/' + id + '/approve', 'admin-mfa', {})).status
      out.autoridad = (await call('POST', '/tus/v1/admin/payments/payouts/' + id + '/process', 'admin-mfa', { mechanism: 'manual', tenantId: 'other' })).status
      const manual = await call('POST', '/tus/v1/admin/payments/payouts/' + id + '/process', 'admin-mfa', { mechanism: 'manual', note: 'Transferencia bancaria' })
      const sinRef = await call('POST', '/tus/v1/admin/payments/payouts/' + id + '/paid', 'admin-mfa', {})
      const pagada = await call('POST', '/tus/v1/admin/payments/payouts/' + id + '/paid', 'admin-mfa', { externalReference: 'TRANSF-0001', note: 'Comprobante archivado' })
      out.manual = [manual.body.payout.status, [sinRef.status, sinRef.body.code], pagada.status, pagada.body.payout.status, pagada.body.payout.externalReference, (await call('GET', '/tus/v1/provider/earnings', 'prestador')).body.paidMinor]
      // The public Payouts notification: no session needed, never trusted, always answered.
      const webhook = await call('POST', '/tus/v1/integrations/mercado-pago/payouts/webhooks', null, { id: 'T1', status: 'approved', payout: { id: 'POP-desconocido' } })
      out.webhook = [webhook.status, webhook.body]
      const ajuste = await call('POST', '/tus/v1/admin/payments/earnings/adjustments', 'admin-mfa', { providerTenantId: 'provider-tenant', kind: 'debit', amountMinor: '300000', reason: 'Contracargo fuera de término' }, { 'idempotency-key': 'ajuste-http-1' })
      const negativos = await call('GET', '/tus/v1/admin/payments/earnings/negative-balances', 'admin-mfa')
      out.ajuste = [ajuste.status, negativos.body.items.map((x) => [x.providerTenantId, x.availableMinor]), (await call('GET', '/tus/v1/provider/earnings', 'prestador')).body.negativeMinor]
      out.sinIds = /provider-tenant|p-1|cuenta-1|ob-1|tr-1/u.test(resumen.text + JSON.stringify(out.historial) + creada.text)
    } finally { await new Promise((resolve) => server.close(resolve)) }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.acceso, [[null, 403, 403, 403], ['cliente', 403, 403, 403]])
  assert.deepEqual(r.resumen, [200, 'private, no-store', '1125000', '1000000', true, '0'])
  assert.equal(r.otro, '0')
  assert.deepEqual(r.rechazos, [[400, 'UNTRUSTED_PAYOUT_FIELDS'], [403, 'FORBIDDEN'], [400, 'IDEMPOTENCY_KEY_REQUIRED'], [400, 'INVALID_DESTINATION_EMAIL'], 0])
  assert.deepEqual(r.solicitud, [201, '1125000', 'prestador@mp.test', 200, [409, 'PAYOUT_ALREADY_OPEN']])
  assert.deepEqual(r.ver, [200, 404, 404, 1, 0])
  assert.deepEqual(r.historial, [['earning', 'reserved'], ['payout_reserve', 'reserved']])
  assert.deepEqual(r.admin, [[null, 403, 403, 403, 403, 403, 403, 403], ['cliente', 403, 403, 403, 403, 403, 403, 403], ['prestador', 403, 403, 403, 403, 403, 403, 403], ['admin-sin-mfa', 403, 403, 403, 403, 403, 403, 403]])
  assert.deepEqual(r.auditoria, [200, 'no-store', [['requested', null, 'requested', 'acc-provider']], 1, 404], 'the audit trail is platform administration only (MFA), never cached')
  assert.deepEqual(r.lista, [200, 1, false, 'provider-tenant', 200, 1, ['payout_reserve']])
  assert.deepEqual(r.sinPayouts, [503, 'PAYOUTS_NOT_CONFIGURED'], 'without Mercado Pago Payouts configured nothing is pretended to be sent')
  assert.equal(r.accionDesconocida, 404)
  assert.equal(r.autoridad, 403)
  assert.deepEqual(r.manual, ['processing', [400, 'INVALID'], 200, 'paid', 'TRANSF-0001', '1125000'])
  assert.deepEqual(r.webhook, [200, { received: true, status: 'ignored' }])
  assert.deepEqual(r.ajuste, [201, [['provider-tenant', '-300000']], '300000'])
  assert.equal(r.sinIds, false)
})

test('Web: /prestador/pagos shows Total histórico cobrado, Ganancias disponibles, En liquidación, Pagadas, Saldo negativo, the minimum, the payout form with the Mercado Pago email, the pending-administration explanation and the history with service and turno; /tus/admin/liquidaciones lists, details and acts', () => {
  const panel = readFileSync(join(root, 'apps/web/src/features/provider/provider-earnings.tsx'), 'utf8')
  const client = readFileSync(join(root, 'apps/web/src/lib/tus-client.ts'), 'utf8')
  const pagos = readFileSync(join(root, 'apps/web/src/features/provider/provider-payments.tsx'), 'utf8')
  const contratos = readFileSync(join(root, 'packages/contracts/src/tus-ganancias.ts'), 'utf8')
  const adminPage = readFileSync(join(root, 'apps/web/src/components/admin/admin-liquidaciones.tsx'), 'utf8')
  const adminApi = readFileSync(join(root, 'apps/web/src/lib/tus-admin-api.ts'), 'utf8')
  const layout = readFileSync(join(root, 'apps/web/src/components/admin/admin-layout.tsx'), 'utf8')
  for (const texto of ['Total histórico cobrado', 'Ganancias disponibles', 'En liquidación', 'Pagadas', 'Saldo negativo', 'Tarifas de Mercado Pago', 'Mínimo para solicitar', 'Email de tu cuenta de Mercado Pago', 'Solicitar pago', 'Vincular Mercado Pago', 'Pendiente de procesamiento por TUS', 'Historial', 'Fecha', 'Tipo', 'Servicio', 'Turno', 'Importe', 'Estado', 'Solicitudes de pago'])
    assert.ok(panel.includes(texto), texto)
  assert.ok(contratos.includes('Vinculá tu cuenta de Mercado Pago para retirar tus ganancias.'))
  assert.match(panel, /mensajeMotivoSinLiquidacion\(summary\.blockedReason\)/u)
  assert.match(pagos, /<ProviderEarningsPanel session=\{auth\.session\} \/>/u)
  // The payout request carries an idempotency key and the destination email only.
  assert.match(client, /requestPayout: \(\{ idempotencyKey, destinationEmail, \.\.\.context \}\) =>\s*transport\.request<TusPayoutRequestResponse>\(\{ \.\.\.context, idempotencyKey, method: 'POST', path: '\/tus\/v1\/provider\/earnings\/payouts', body: \{ destinationEmail \} \}\)/u)
  assert.doesNotMatch(panel, /prestadorTenantId|tenantId:|localStorage/u)
  for (const texto of ['Pagar con Mercado Pago', 'Pagar por otro medio', 'Consultar estado en Mercado Pago', 'Reenviar a Mercado Pago', 'Comprobante de la operación realizada', 'Marcar como pagada', 'Marcar como fallida', 'Cancelar', 'Ganancias incluidas', 'Movimientos contables', 'Cuenta de Mercado Pago destino'])
    assert.ok(adminPage.includes(texto), texto)
  // "Marcar como pagada" needs the reference typed; the Mercado Pago button needs Payouts configured.
  assert.match(adminPage, /disabled=\{busy \|\| referencia\.trim\(\)\.length < 3\}/u)
  assert.match(adminPage, /disabled=\{busy \|\| !automaticAvailable\}/u)
  assert.match(adminApi, /\/tus\/v1\/admin\/payments\/payouts\/\$\{encodeURIComponent\(id\)\}\/\$\{action\}/u)
  assert.match(layout, /\{ href: '\/tus\/admin\/liquidaciones', label: 'Liquidaciones' \}/u)
})

test('GANANCIAS-02 domain: every action on a payout request is audited in order (requested, processing, send_rejected / send_unconfirmed / send_confirmed, provider_status, paid, failed, cancelled) with actor and correlation and no secrets; blocked reasons are explicit; concurrent requests open one; the provider sees whether Mercado Pago is connected', () => {
  const r = runTypeScriptScenario(`${DOMINIO}
    const out = {}
    const historia = async (tenant, id) => (await store.auditoria(tenant, id)).map((x) => [x.version, x.accion, x.estadoAnterior, x.estadoNuevo, x.actorId, x.correlationId, x.detalle])
    // Without Mercado Pago: earnings accumulate, the payout is blocked with a clear reason.
    await ganar('t-ana', 1500000n, 150000n)
    await ganar('t-ana', 2000000n, 200000n, 100000n)
    const sinCuenta = await service.resumen(ana)
    out.sinCuenta = [sinCuenta.availableMinor, sinCuenta.canRequest, sinCuenta.blockedReason, sinCuenta.paymentAccountStatus, await codeOf(() => service.solicitar(ana, 'clave-ana-0001', destino))]
    store.cuentas.set('t-ana', 'cuenta-ana')
    // PRESTADOR-SIN-KYC-01 (owner's decision): an identity not verified by TUS blocks nothing of a payout.
    verificados.delete('t-ana')
    out.sinIdentidad = (await service.resumen(ana)).blockedReason
    verificados.add('t-ana')
    minimo = 5000000n
    out.bajoMinimo = [(await service.resumen(ana)).blockedReason, await codeOf(() => service.solicitar(ana, 'clave-ana-0001', destino))]
    minimo = 1000000n
    out.habilitada = [(await service.resumen(ana)).canRequest, (await service.resumen(ana)).paymentAccountStatus]

    // Five requests at once with different keys: exactly one is opened.
    const carrera = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => service.solicitar(ana, 'clave-carrera-' + i, destino)))
    out.carrera = [carrera.filter((x) => x.status === 'fulfilled').length, [...new Set(carrera.filter((x) => x.status === 'rejected').map((x) => x.reason?.code))]]
    const r1 = carrera.find((x) => x.status === 'fulfilled').value.payout

    // Rejected by Mercado Pago on creation: failed, released, audited as send_rejected.
    mp.fallas.push('rechazo')
    await service.procesar(admin, r1.payoutId, { mechanism: 'mercado_pago_payouts' })
    out.rechazo = await historia('t-ana', r1.payoutId)

    // Not confirmed, resent with the same key, then Mercado Pago reports progress and payment.
    const r2 = (await service.solicitar(ana, 'clave-ana-0002', destino)).payout
    mp.fallas.push('caida')
    out.caida = await codeOf(() => service.procesar(admin, r2.payoutId, { mechanism: 'mercado_pago_payouts' }))
    await service.reenviar(admin, r2.payoutId)
    mover(r2.payoutId, 'success', 'in_progress')
    await service.actualizarDesdeMercadoPago(admin, r2.payoutId)
    // The same status read again adds nothing.
    await service.actualizarDesdeMercadoPago(admin, r2.payoutId)
    const pid = mover(r2.payoutId, 'success', 'accredited')
    await service.notificacionPayout({ payout: { id: pid } })
    out.pago = await historia('t-ana', r2.payoutId)
    out.saldoPago = (await service.resumen(ana)).paidMinor

    // Cancelled by the provider, cancelled by the administration.
    await ganar('t-ana', 2000000n, 200000n)
    const r3 = (await service.solicitar(ana, 'clave-ana-0003', destino)).payout
    await service.cancelar(ana, r3.payoutId)
    const r4 = (await service.solicitar(ana, 'clave-ana-0004', destino)).payout
    await service.cancelarAdmin(admin, r4.payoutId, { reason: 'Email equivocado' })
    out.cancelaciones = [(await historia('t-ana', r3.payoutId)).at(-1), (await historia('t-ana', r4.payoutId)).at(-1), (await service.resumen(ana)).availableMinor]
    // Nothing secret or internal reaches the audit.
    out.sinSecretos = /token|secret|Bearer|signature/iu.test(JSON.stringify(store.auditoriaGuardada))
    // The trail of another provider's request is not this provider's.
    out.aislada = (await store.auditoria('t-beto', r2.payoutId)).length
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.sinCuenta, ['3050000', false, 'PAYMENT_ACCOUNT_REQUIRED', 'not_connected', 'PAYMENT_ACCOUNT_REQUIRED'], 'without Mercado Pago the earnings accumulate and cannot be withdrawn')
  assert.equal(r.sinIdentidad, null, 'with Mercado Pago linked, an unverified identity is not a reason')
  assert.deepEqual(r.bajoMinimo, ['BELOW_MINIMUM', 'PAYOUT_BELOW_MINIMUM'])
  assert.deepEqual(r.habilitada, [true, 'connected'])
  assert.deepEqual(r.carrera, [1, ['PAYOUT_ALREADY_OPEN']])
  assert.deepEqual(r.rechazo, [
    [1, 'requested', null, 'requested', 'u-ana', 'c-ana', { amountMinor: '3050000', movements: '3' }],
    [2, 'processing', 'requested', 'processing', 'u-admin', 'c-admin', { mechanism: 'mercado_pago_payouts' }],
    [3, 'send_rejected', 'processing', 'failed', 'u-admin', 'c-admin', { mechanism: 'mercado_pago_payouts', providerStatus: 'rejected_on_create', reason: 'mercado_pago_rejected', releasedMinor: '3050000' }],
  ])
  assert.equal(r.caida, 'PAYOUT_SEND_UNCONFIRMED')
  assert.deepEqual(r.pago, [
    [1, 'requested', null, 'requested', 'u-ana', 'c-ana', { amountMinor: '3050000', movements: '3' }],
    [2, 'processing', 'requested', 'processing', 'u-admin', 'c-admin', { mechanism: 'mercado_pago_payouts' }],
    [3, 'send_unconfirmed', 'processing', 'processing', 'u-admin', 'c-admin', { error: 'PROVIDER_UNAVAILABLE' }],
    [4, 'send_confirmed', 'processing', 'processing', 'u-admin', 'c-admin', { providerPayoutId: 'POP1', providerTransactionId: 'TOP1', providerStatus: 'created' }],
    [5, 'provider_status', 'processing', 'processing', 'u-admin', 'c-admin', { providerStatus: 'success:in_progress' }],
    [6, 'paid', 'processing', 'paid', 'system:mercado-pago-payouts', 'mercado-pago-payouts-notification', { mechanism: 'mercado_pago_payouts', providerStatus: 'success:accredited' }],
  ], 'one entry per version; Mercado Pago\'s answer is recorded as the actor of the payment')
  assert.equal(r.saldoPago, '3050000')
  assert.deepEqual(r.cancelaciones, [
    [2, 'cancelled', 'requested', 'cancelled', 'u-ana', 'c-ana', { reason: 'cancelled-by-provider', releasedMinor: '1800000' }],
    [2, 'cancelled', 'requested', 'cancelled', 'u-admin', 'c-admin', { reason: 'Email equivocado', releasedMinor: '1800000' }],
    '1800000',
  ])
  assert.equal(r.sinSecretos, false)
  assert.equal(r.aislada, 0)
})

test('GANANCIAS-02 state machine: only requested -> processing -> paid, requested -> cancelled and processing -> failed exist; nothing skips a state, a paid or closed request never moves again; the historical total is derived from the ledger', () => {
  const r = runTypeScriptScenario(`${DOMINIO}
    const out = {}
    await ganar('t-ana', 1500000n, 150000n)
    await ganar('t-ana', 2000000n, 200000n, 100000n)
    store.cuentas.set('t-ana', 'cuenta-ana')
    verificados.add('t-ana')
    const vistos = []
    const resumen = async () => { const s = await service.resumen(ana); vistos.push(s); return [s.earnedMinor, s.availableMinor, s.reservedMinor, s.processingMinor, s.paidMinor, s.feesMinor] }
    out.inicial = await resumen()

    // requested: it cannot be failed (nobody tried to pay it) nor paid (nobody started paying it).
    const r1 = (await service.solicitar(ana, 'clave-maquina-1', destino)).payout
    out.requested = [
      await codeOf(() => service.marcarFallida(admin, r1.payoutId, { reason: 'sin intento de pago' })),
      await codeOf(() => service.marcarPagada(admin, r1.payoutId, { externalReference: 'TR-0001' })),
      (await service.ver(ana, r1.payoutId)).status,
      await resumen(),
    ]
    // processing (by another means): it cannot be cancelled by anybody, nor processed twice.
    await service.procesar(admin, r1.payoutId, { mechanism: 'manual' })
    out.processing = [
      await codeOf(() => service.cancelarAdmin(admin, r1.payoutId, { reason: 'ya no se paga' })),
      await codeOf(() => service.cancelar(ana, r1.payoutId)),
      await codeOf(() => service.procesar(admin, r1.payoutId, { mechanism: 'manual' })),
      (await service.ver(ana, r1.payoutId)).status,
      await resumen(),
    ]
    // processing -> failed: the money is back; a failed request never moves again.
    await service.marcarFallida(admin, r1.payoutId, { reason: 'la transferencia rebotó' })
    out.failed = [
      await codeOf(() => service.marcarPagada(admin, r1.payoutId, { externalReference: 'TR-0002' })),
      await codeOf(() => service.procesar(admin, r1.payoutId, { mechanism: 'manual' })),
      await codeOf(() => service.cancelar(ana, r1.payoutId)),
      await codeOf(() => service.marcarFallida(admin, r1.payoutId, { reason: 'otra vez' })),
      await resumen(),
    ]
    // The retry is a NEW request: processing -> paid; a paid request never moves and never gives its money back.
    const r2 = (await service.solicitar(ana, 'clave-maquina-2', destino)).payout
    await service.procesar(admin, r2.payoutId, { mechanism: 'manual' })
    await service.marcarPagada(admin, r2.payoutId, { externalReference: 'TR-0003' })
    out.paid = [
      await codeOf(() => service.marcarFallida(admin, r2.payoutId, { reason: 'ya estaba pagada' })),
      await codeOf(() => service.cancelarAdmin(admin, r2.payoutId, { reason: 'ya estaba pagada' })),
      await codeOf(() => service.cancelar(ana, r2.payoutId)),
      await codeOf(() => service.procesar(admin, r2.payoutId, { mechanism: 'manual' })),
      await codeOf(() => service.marcarPagada(admin, r2.payoutId, { externalReference: 'TR-0004' })),
      (await service.ver(ana, r2.payoutId)).status,
      await resumen(),
    ]
    // The control identity of the derived balances holds in every state: earned - fees - net adjustments = available + reserved + processing + paid.
    out.identidad = vistos.length > 4 && vistos.every((s) => BigInt(s.earnedMinor) - BigInt(s.feesMinor) - BigInt(s.adjustmentsMinor) === BigInt(s.availableMinor) + BigInt(s.reservedMinor) + BigInt(s.processingMinor) + BigInt(s.paidMinor))
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.identidad, true, 'the balances reconcile in every state of the request')
  assert.deepEqual(r.inicial, ['3150000', '3050000', '0', '0', '0', '100000'], 'earned is the sum of the earnings; available is net of the fee')
  assert.deepEqual(r.requested, ['INVALID_TRANSITION', 'INVALID_TRANSITION', 'requested', ['3150000', '0', '3050000', '0', '0', '100000']])
  assert.deepEqual(r.processing, ['INVALID_TRANSITION', 'INVALID_TRANSITION', 'INVALID_TRANSITION', 'processing', ['3150000', '0', '0', '3050000', '0', '100000']])
  assert.deepEqual(r.failed, ['INVALID_TRANSITION', 'INVALID_TRANSITION', 'INVALID_TRANSITION', 'INVALID_TRANSITION', ['3150000', '3050000', '0', '0', '0', '100000']], 'failed gives the money back and is final')
  assert.deepEqual(r.paid, ['INVALID_TRANSITION', 'INVALID_TRANSITION', 'INVALID_TRANSITION', 'INVALID_TRANSITION', 'INVALID_TRANSITION', 'paid', ['3150000', '0', '0', '0', '3050000', '100000']], 'paid is final: the money never becomes available again and the historical total never changes')
})
