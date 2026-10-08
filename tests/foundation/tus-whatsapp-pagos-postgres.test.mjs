import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// TUS-WHATSAPP-MULTIMODAL-01 on a DISPOSABLE PostgreSQL 16 (TUS_PAYMENTS_PG_URL, every migration
// applied, never a shared or production database): the payment QUERY ("did my payment arrive?")
// against the REAL chain: turnos with their 50% deposit, work, finance, the real Mercado Pago
// adapter (offline stand-in of its documented contract at the `fetch` boundary), the earnings
// ledger. The WhatsApp assistant on top is the real one, over the real domain.
//
// Invariants proven here: Mercado Pago is the only authority (a missing, mismatching or foreign
// payment never confirms anything); the query and the webhook are the SAME state machine, in any
// order and under concurrency (one approval, one turno confirmation, one earning); Split 1:1
// never creates an earning; another client's turno does not exist for the asker.
//
// The run needs a FRESH database (the stand-in uses fixed Mercado Pago user ids).
const url = process.env.TUS_PAYMENTS_PG_URL
const skip = !url && 'TUS_PAYMENTS_PG_URL not set (disposable PostgreSQL 16 only)'
const SETUP = turnosPagosSetup(url)

test('payment query on PostgreSQL: approved before the webhook, pending, missing, fake receipt, wrong amount/currency/collector/reference/mode, other client, duplicate and concurrent webhook; one approval, one confirmation, one platform earning, no Split earning', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const sin = await prestador('sin', 'Sin MP ' + run, [['Masaje', 30000]])
      const con = await prestador('con', 'Con MP ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const beto = await cliente('beto')
      await conectarMercadoPago(con, '8801')
      const verificar = (t, cuenta) => turnos.verificarPagoSena({ clienteId: cuenta.id, reservaId: t.pedido.id, correlationId: 'c-verificar' })
      const resumen = (v) => [v.status, v.appliedNow, v.reason]
      const reintentar = async (operacion) => { for (let i = 0; ; i += 1) { try { return await operacion() } catch (e) { if (!['CONCURRENT_MODIFICATION', 'VERSION_CONFLICT'].includes(e?.code) || i >= 6) throw e } } }
      const ganancias_ = async (p) => (await filas(p)).filter(([tipo]) => tipo === 'earning_credit').length
      const intento = async (t) => { const f = await prisma.intencionPago.findFirst({ where: { obligacionId: t.obligacion.obligacionId } }); return [f.estadoProveedor, f.modoCobro] }
      const eventos = async (t) => (await db.query('SELECT estado, motivo FROM eventos_webhook_pago WHERE obligacion_id = $1 ORDER BY fecha_recepcion', [t.obligacion.obligacionId])).rows.map((x) => [x.estado, x.motivo])

      // 1) Platform collection (provider without Mercado Pago). Nothing paid yet: not found, nothing changes.
      const t1 = await turnoConCheckout(sin, ana, 0, '10:00', 'Masaje')
      out.modo1 = t1.pago.modoCobro
      out.sinPago = [resumen(await verificar(t1, ana)), await estadoTurno(t1), await filas(sin)]
      // A fake receipt claiming the payment changes nothing: the query ignores it (it has no input) and Mercado Pago has no payment.
      out.comprobanteFalso = [resumen(await verificar(t1, ana)), await estadoTurno(t1), await filas(sin)]
      // Pending in Mercado Pago.
      mpPayment('8101', t1.preferencia, { status: 'pending', status_detail: 'pending_waiting_payment' })
      out.pendiente = [resumen(await verificar(t1, ana)), await estadoTurno(t1), await filas(sin)]
      // Approved in Mercado Pago, the webhook has NOT arrived: the query applies it through the webhook's own state machine.
      mpPayment('8101', t1.preferencia)
      const aprobado = await reintentar(() => verificar(t1, ana))
      out.aprobadoSinWebhook = [resumen(aprobado), await estadoTurno(t1), await filas(sin), await intento(t1)]
      // The webhook arrives later: a no-op (no second approval, no second earning); asking again is a no-op too.
      const despues = await ingerir(notification('8101', { userId: '555', notificationId: run + '-n1' }))
      out.webhookDespues = [despues.status, despues.result, await ganancias_(sin), await estadoTurno(t1)]
      out.repetida = [resumen(await verificar(t1, ana)), await ganancias_(sin)]

      // 2) The webhook FIRST, then the query; and a duplicate webhook.
      const t2 = await turnoConCheckout(sin, ana, 1, '10:00', 'Masaje')
      mpPayment('8102', t2.preferencia)
      const primero = notification('8102', { userId: '555', notificationId: run + '-n2' })
      const aplicado = await ingerir(primero)
      out.webhookAntes = [aplicado.status, aplicado.result, resumen(await verificar(t2, ana)), await ganancias_(sin), await estadoTurno(t2)]
      const duplicado = await ingerir(primero)
      out.webhookDuplicado = [duplicado.status, await ganancias_(sin)]

      // 3) A payment that does not match what TUS asked: quarantined, nothing confirmed, no earning.
      const antesCuarentena = await ganancias_(sin)
      const t3 = await turnoConCheckout(sin, ana, 2, '10:00', 'Masaje')
      mpPayment('8103', t3.preferencia, { transaction_amount: 10000 })
      out.monto = [resumen(await verificar(t3, ana)), await estadoTurno(t3), await eventos(t3)]
      const t4 = await turnoConCheckout(sin, ana, 3, '10:00', 'Masaje')
      mpPayment('8104', t4.preferencia, { currency_id: 'USD' })
      out.moneda = [resumen(await verificar(t4, ana)), await estadoTurno(t4)]
      // Collected by another account, with another external reference, in the other mode: Mercado Pago
      // does not show them to the account that must have collected this payment: not found, nothing applied.
      const t5 = await turnoConCheckout(sin, ana, 4, '10:00', 'Masaje')
      mpPayment('8105', t5.preferencia, { collector_id: 999 })
      out.cobrador = [resumen(await verificar(t5, ana)), await estadoTurno(t5)]
      const t6 = await turnoConCheckout(sin, ana, 0, '11:00', 'Masaje')
      mpPayment('8106', t6.preferencia, { external_reference: 'otra-referencia-de-otra-persona' })
      out.referencia = [resumen(await verificar(t6, ana)), await estadoTurno(t6)]
      const t7 = await turnoConCheckout(sin, ana, 1, '11:00', 'Masaje')
      mpPayment('8107', t7.preferencia, { collector_id: 8801 })
      out.modoEquivocado = [resumen(await verificar(t7, ana)), await estadoTurno(t7)]
      const t8 = await turnoConCheckout(sin, ana, 2, '11:00', 'Masaje')
      mpPayment('8108', t8.preferencia, { status: 'rejected', status_detail: 'cc_rejected_other_reason' })
      out.rechazado = [resumen(await verificar(t8, ana)), await estadoTurno(t8)]
      out.sinGananciaPorEso = (await ganancias_(sin)) === antesCuarentena

      // 4) Another client's payment and another client's turno: they do not exist for the asker.
      const t9 = await turnoConCheckout(sin, beto, 3, '11:00', 'Masaje')
      mpPayment('8109', t9.preferencia)
      out.ajeno = [await codeOf(() => verificar(t9, ana)), await estadoTurno(t9), resumen(await reintentar(() => verificar(t9, beto))), await estadoTurno(t9)]

      // 5) Split 1:1 (provider with Mercado Pago): confirmed, and NO earning is created (the provider was paid by Mercado Pago).
      const t10 = await turnoConCheckout(con, ana, 0, '10:00', 'Masaje')
      out.modo10 = t10.pago.modoCobro
      mpPayment('8110', t10.preferencia)
      out.split = [resumen(await reintentar(() => verificar(t10, ana))), await estadoTurno(t10), await filas(con), await intento(t10)]
      // A payment collected by TUS's own account for a Split intent is not visible to the seller's token: not found.
      const t11 = await turnoConCheckout(con, ana, 1, '10:00', 'Masaje')
      mpPayment('8111', t11.preferencia, { collector_id: 555 })
      out.splitEnPlataforma = [resumen(await verificar(t11, ana)), await estadoTurno(t11), await filas(con)]

      // 6) Concurrency: three queries and the webhook at the same time: one approval, one earning.
      const t12 = await turnoConCheckout(sin, ana, 4, '11:00', 'Masaje')
      mpPayment('8112', t12.preferencia)
      const antes12 = await ganancias_(sin)
      const concurrentes = await Promise.all([reintentar(() => verificar(t12, ana)), reintentar(() => verificar(t12, ana)), reintentar(() => verificar(t12, ana)), ingerir(notification('8112', { userId: '555', notificationId: run + '-n12' }))])
      out.concurrencia = [concurrentes.slice(0, 3).map((v) => v.status), await estadoTurno(t12), (await ganancias_(sin)) - antes12, (await eventos(t12)).filter(([resultado]) => resultado === 'applied').length]
      out.auditoria = Number((await db.query("SELECT count(*) AS n FROM auditoria_finanzas_servicio WHERE accion = 'payment.queried_by_customer'")).rows[0].n) > 0
    } catch (error) {
      out.error = String(error?.stack ?? error)
    } finally {
      await cerrar()
    }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.error, undefined, r.error)
  assert.equal(r.modo1, 'plataforma')
  assert.deepEqual(r.sinPago, [['not_found', false, 'provider_has_no_payment'], 'awaiting_payment', []])
  assert.deepEqual(r.comprobanteFalso, [['not_found', false, 'provider_has_no_payment'], 'awaiting_payment', []], 'a receipt cannot create a payment')
  assert.deepEqual(r.pendiente, [['pending', false, null], 'awaiting_payment', []])
  assert.deepEqual(r.aprobadoSinWebhook, [['approved', true, null], 'confirmed', [['earning_credit', '1350000']], ['approved', 'plataforma']])
  assert.equal(r.webhookDespues[0], 'recorded')
  assert.deepEqual([r.webhookDespues[2], r.webhookDespues[3]], [1, 'confirmed'], 'the late webhook changes nothing')
  assert.ok(['stale', 'no_op'].includes(r.webhookDespues[1]), 'the late webhook is not applied again: ' + r.webhookDespues[1])
  assert.deepEqual(r.repetida, [['approved', false, null], 1])
  assert.deepEqual(r.webhookAntes.slice(0, 2), ['recorded', 'applied'])
  assert.deepEqual(r.webhookAntes.slice(2), [['approved', false, null], 2, 'confirmed'], 'webhook first: the query applies nothing again; two payments, two earnings')
  assert.deepEqual(r.webhookDuplicado, ['duplicate', 2])
  assert.deepEqual(r.monto[0], ['quarantined', false, 'amount_mismatch'])
  assert.equal(r.monto[1], 'awaiting_payment')
  assert.deepEqual(r.moneda, [['quarantined', false, 'currency_mismatch'], 'awaiting_payment'])
  for (const caso of ['cobrador', 'referencia', 'modoEquivocado']) assert.deepEqual(r[caso], [['not_found', false, 'provider_has_no_payment'], 'awaiting_payment'], caso)
  assert.deepEqual(r.rechazado, [['not_approved', false, 'rejected'], 'awaiting_payment'])
  assert.equal(r.sinGananciaPorEso, true, 'no mismatching, foreign or rejected payment created an earning')
  assert.deepEqual(r.ajeno, ['NOT_FOUND', 'awaiting_payment', ['approved', true, null], 'confirmed'], 'another client cannot query or apply it; its owner can')
  // PAGOS-RETENCION-01: a deposit is an advance payment, so TUS collects it with its own account even
  // for a provider with a linked one (before: Split 1:1, paid straight to the provider).
  assert.equal(r.modo10, 'plataforma')
  assert.deepEqual(r.split, [['approved', true, null], 'confirmed', [['earning_credit', '1350000']], ['approved', 'plataforma']], 'provider with its own account: confirmed, the earning is booked in TUS')
  // The payment in the account of TUS is now the expected one for that provider too.
  assert.deepEqual(r.splitEnPlataforma, [['approved', true, null], 'confirmed', [['earning_credit', '1350000'], ['earning_credit', '1350000']]])
  assert.deepEqual(r.concurrencia[0], ['approved', 'approved', 'approved'])
  assert.deepEqual(r.concurrencia.slice(1), ['confirmed', 1, 1], 'concurrent queries and webhook: one approval, one earning')
  assert.equal(r.auditoria, true, 'every query is audited')
})

test('WhatsApp end to end over the real domain on PostgreSQL: "ya pagué" with Mercado Pago approved and the webhook late confirms the turno once; a receipt image for a payment Mercado Pago does not have confirms nothing and is never downloaded', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const { crearModuloWhatsapp } = await import('./apps/api/src/tus/asistente/composicion.ts')
      const { AlmacenAsistenteEnMemoria, TransaccionAsistenteEnMemoria } = await import('./apps/api/src/tus/asistente/memoria.ts')
      const { FakeWhatsappProvider, parsearWebhookMeta } = await import('./apps/api/src/tus/asistente/meta.ts')
      const { DominioAsistenteTus } = await import('./apps/api/src/tus/asistente/dominio.ts')
      const sin = await prestador('sin', 'Sin MP ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const ganancias_ = async () => (await filas(sin)).filter(([tipo]) => tipo === 'earning_credit').length

      const PHONE = '1234567890'
      const waStore = new AlmacenAsistenteEnMemoria()
      const waTx = new TransaccionAsistenteEnMemoria(waStore)
      const fakeWa = new FakeWhatsappProvider()
      const descargas = []
      const original = fakeWa.downloadMedia.bind(fakeWa)
      fakeWa.downloadMedia = async (id, limites) => { descargas.push(id); return original(id, limites) }
      const resolver = { contexto: async (accountId, tenantId, correlationId) => (accountId === ana.id && tenantId === ana.tenantId ? { subjectId: ana.id, sessionId: 'wa:' + ana.id, tenantId, correlationId, roles: ['owner'], permissions: ['tus:checkout', 'tus:read', 'tus:marketplace:read'] } : null) }
      const dominio = new DominioAsistenteTus({}, () => Date.now(), { directorio: null, solicitudes: null, turnos })
      const env = { WHATSAPP_ENABLED: 'true', WHATSAPP_GRAPH_API_VERSION: 'v25.0', WHATSAPP_ACCESS_TOKEN: 'fictitious-access', WHATSAPP_PHONE_NUMBER_ID: PHONE, WHATSAPP_APP_SECRET: 'fictitious-app-secret-for-tests', WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fictitious-verify-token-0001', TUS_WEB_BASE_URL: 'https://web.tus.test', WHATSAPP_DEBOUNCE_MS: '0' }
      const modulo = crearModuloWhatsapp({ env, transaction: waTx, accounts: resolver, domain: dominio, knowledgeIndex: null, whatsapp: fakeWa, chat: null, embeddings: null, transcriptor: null, now: () => Date.now() })
      const cola = modulo.crearWorker({ owner: 'pg-e2e' })
      let seq = 0
      const entrante = (waId, text, extra = {}) => { seq += 1; const message = { from: waId, id: 'wamid.pg-' + run + '-' + seq, timestamp: String(Math.floor(Date.now() / 1000)), type: extra.type ?? 'text', ...(extra.type && extra.type !== 'text' ? extra.body : { text: { body: text } }) }; return { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '5491100000000', phone_number_id: PHONE }, contacts: [{ wa_id: waId, profile: { name: 'Ana' } }], messages: [message] } }] }] } }
      async function decir(waId, text, extra) {
        const antes = fakeWa.sent.length
        await modulo.ingreso.procesar(parsearWebhookMeta(entrante(waId, text, extra), PHONE), 'corr-pg-wa')
        for (let i = 0; i < 5; i += 1) if ((await cola.procesarSiguiente()).outcome === 'idle') break
        return fakeWa.sent.slice(antes).map((x) => x.message.text ?? x.message.type)
      }
      let contactos = 0
      async function nuevoContacto() {
        contactos += 1
        const id = '5491155700' + String(Date.now()).slice(-5) + String(contactos)
        await decir(id, 'hola')
        const contacto = await waStore.repositorios().contactos.buscarPorWaId(id)
        await waTx.ejecutar((repos) => repos.contactos.actualizar({ ...contacto, linkedAccountId: ana.id, linkedTenantId: ana.tenantId, linkedAt: new Date().toISOString(), version: contacto.version + 1 }, contacto.version))
        return id
      }
      const waId = await nuevoContacto()

      // E1: paid in Mercado Pago, the webhook has not arrived: "ya pagué" asks the backend, which applies it once.
      const t1 = await turnoConCheckout(sin, ana, 0, '10:00', 'Masaje')
      mpPayment('8201', t1.preferencia)
      out.antes = [await estadoTurno(t1), await ganancias_()]
      out.respuesta = await decir(waId, 'ya pagué')
      out.despues = [await estadoTurno(t1), await ganancias_()]
      const tarde = await ingerir(notification('8201', { userId: '555', notificationId: run + '-w1' }))
      out.webhookTarde = [tarde.status, await estadoTurno(t1), await ganancias_()]
      out.otraVez = await decir(waId, 'ya pagué')

      // E2: a receipt image with a claimed approval; Mercado Pago has no such payment: nothing is confirmed.
      const t2 = await turnoConCheckout(sin, ana, 1, '10:00', 'Masaje')
      const imagen = nuevoMediaId()
      function nuevoMediaId() { const id = '77700' + String(Date.now()).slice(-6); fakeWa.media.set(id, { mimeType: 'image/jpeg', bytes: Buffer.from('fake-jpeg') }); return id }
      const antesDescargas = descargas.length
      const waId2 = await nuevoContacto()
      out.falso = await decir(waId2, '', { type: 'image', body: { image: { id: imagen, mime_type: 'image/jpeg', sha256: 'hash-falso', caption: 'Pagué $15.000 APROBADO' } } })
      out.falsoEstado = [await estadoTurno(t2), await ganancias_(), descargas.length - antesDescargas]
      const auditoria = [...waStore.state.auditoria].filter((x) => x.action === 'assistant.payment_checked').map((x) => [x.metadata.result, x.metadata.withReceipt])
      out.auditoria = auditoria
    } catch (error) {
      out.error = String(error?.stack ?? error)
    } finally {
      await cerrar()
    }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.error, undefined, r.error)
  assert.deepEqual(r.antes, ['awaiting_payment', 0])
  assert.equal(r.respuesta.length, 1)
  assert.match(r.respuesta[0], /^Sí, Mercado Pago confirmó tu seña de \$15\.000\. Tu turno con Sin MP .+ quedó confirmado\.$/u)
  assert.deepEqual(r.despues, ['confirmed', 1], 'confirmed by the backend, one platform earning')
  assert.deepEqual(r.webhookTarde, ['recorded', 'confirmed', 1], 'the late webhook is a no-op: no second confirmation, no second earning')
  assert.match(r.otraVez[0], /ya figura acreditada por Mercado Pago/u)
  assert.equal(r.falso.length, 1)
  assert.match(r.falso[0], /^Recibí el comprobante, pero no pude confirmar ese pago en Mercado Pago\./u)
  assert.doesNotMatch(r.falso[0], /confirmó|quedó confirmado/u)
  assert.deepEqual(r.falsoEstado, ['awaiting_payment', 1, 0], 'nothing confirmed, no earning, the picture was never downloaded')
  assert.deepEqual(r.auditoria, [['confirmed', false], ['not_found', true]])
})
