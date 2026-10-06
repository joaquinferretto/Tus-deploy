import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// TUS-WHATSAPP-MULTIMODAL-02 on a DISPOSABLE PostgreSQL 16 (TUS_PAYMENTS_PG_URL, every migration
// applied, never a shared or production database): receipts (images) sent to the REAL WhatsApp
// assistant over the REAL domain (turnos with deposit, works with deposit and balance, finance, the
// real Mercado Pago adapter on an offline stand-in at the `fetch` boundary, the earnings ledger).
//
// The reader of the file is a double that returns what a real OCR would extract: what is proven here
// is everything AFTER it. The receipt only ranks the client's OWN pending payments; the amount,
// currency, collector, reference, mode and state are decided by the finance domain from what Mercado
// Pago says about TUS's own external reference. NO real OCR, vision provider or Meta media download
// is exercised (NO VERIFICADO CONTRA PROVEEDOR REAL).
//
// The run needs a FRESH database (the stand-in uses fixed Mercado Pago user ids).
const url = process.env.TUS_PAYMENTS_PG_URL
const skip = !url && 'TUS_PAYMENTS_PG_URL not set (disposable PostgreSQL 16 only)'
const SETUP = turnosPagosSetup(url)

// The assistant over the real domain, with a receipt reader double. Shared by both scenarios.
const ASISTENTE = `
  const { crearModuloWhatsapp } = await import('./apps/api/src/tus/asistente/composicion.ts')
  const { AlmacenAsistenteEnMemoria, TransaccionAsistenteEnMemoria } = await import('./apps/api/src/tus/asistente/memoria.ts')
  const { FakeWhatsappProvider, parsearWebhookMeta } = await import('./apps/api/src/tus/asistente/meta.ts')
  const { DominioAsistenteTus } = await import('./apps/api/src/tus/asistente/dominio.ts')
  const { ServicioComprobantes, leerLimitesComprobante, EVIDENCIA_VACIA } = await import('./apps/api/src/tus/asistente/comprobantes.ts')
  const { pagosTrabajo } = await import('./apps/api/src/tus/composition/index.ts')
  work.conPagos(pagosTrabajo(fin))
  const PHONE = '1234567890'
  const waStore = new AlmacenAsistenteEnMemoria()
  const waTx = new TransaccionAsistenteEnMemoria(waStore)
  const fakeWa = new FakeWhatsappProvider()
  const cuentas = new Map()
  const resolver = { contexto: async (accountId, tenantId, correlationId) => { const cuenta = cuentas.get(accountId); return cuenta && cuenta.tenantId === tenantId ? { subjectId: cuenta.id, sessionId: 'wa:' + cuenta.id, tenantId, correlationId, roles: ['owner'], permissions: ['tus:checkout', 'tus:read', 'tus:marketplace:read'] } : null } }
  const dominio = new DominioAsistenteTus({ work, serviceFinance: fin }, () => Date.now(), { directorio: null, solicitudes: null, turnos })
  const envWa = { WHATSAPP_ENABLED: 'true', WHATSAPP_GRAPH_API_VERSION: 'v25.0', WHATSAPP_ACCESS_TOKEN: 'fictitious-access', WHATSAPP_PHONE_NUMBER_ID: PHONE, WHATSAPP_APP_SECRET: 'fictitious-app-secret-for-tests', WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fictitious-verify-token-0001', TUS_WEB_BASE_URL: 'https://web.tus.test', WHATSAPP_DEBOUNCE_MS: '0', WHATSAPP_RECEIPT_ANALYSIS: 'true', WHATSAPP_RECEIPT_MAX_PER_HOUR: '20' }
  const lector = { llamadas: [], evidencia: null, analizar: async (archivo) => { lector.llamadas.push(archivo.mimeType); return { ...EVIDENCIA_VACIA, analyzer: 'ocr', ...(lector.evidencia ?? {}) } } }
  const comprobantes = new ServicioComprobantes(fakeWa, lector, leerLimitesComprobante(envWa))
  // Pacing between Mercado Pago queries is a protection of its own (tested elsewhere): the clock jumps over it.
  let reloj = Date.now()
  const modulo = crearModuloWhatsapp({ env: envWa, transaction: waTx, accounts: resolver, domain: dominio, knowledgeIndex: null, whatsapp: fakeWa, chat: null, embeddings: null, transcriptor: null, comprobantes, now: () => reloj })
  const cola = modulo.crearWorker({ owner: 'pg-e2e' })
  let seq = 0
  const entrante = (waId, text, extra) => { seq += 1; const message = { from: waId, id: 'wamid.rc-' + run + '-' + seq, timestamp: String(Math.floor(reloj / 1000)), type: extra ? extra.type : 'text', ...(extra ? extra.body : { text: { body: text } }) }; return { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '5491100000000', phone_number_id: PHONE }, contacts: [{ wa_id: waId, profile: { name: 'Cliente' } }], messages: [message] } }] }] } }
  async function decir(waId, text, extra) {
    const antes = fakeWa.sent.length
    await modulo.ingreso.procesar(parsearWebhookMeta(entrante(waId, text, extra), PHONE), 'corr-rc')
    for (let i = 0; i < 5; i += 1) if ((await cola.procesarSiguiente()).outcome === 'idle') break
    reloj += 40000
    return fakeWa.sent.slice(antes).map((x) => x.message.text ?? x.message.type)
  }
  let contactos = 0
  async function vincular(cuenta) {
    contactos += 1
    const id = '5491155800' + String(Date.now()).slice(-5) + String(contactos)
    await decir(id, 'hola')
    const contacto = await waStore.repositorios().contactos.buscarPorWaId(id)
    cuentas.set(cuenta.id, cuenta)
    await waTx.ejecutar((repos) => repos.contactos.actualizar({ ...contacto, linkedAccountId: cuenta.id, linkedTenantId: cuenta.tenantId, linkedAt: new Date().toISOString(), version: contacto.version + 1 }, contacto.version))
    return id
  }
  // A receipt picture (valid PNG header) with its own Meta hash; the reader double says what it "reads".
  let imagenes = 0
  const png = () => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(800, 16); b.writeUInt32BE(600, 20); b[24] = 8; b[25] = 2; return b }
  const comprobante = (evidencia, hash) => { imagenes += 1; lector.evidencia = evidencia; const id = '88800' + String(Date.now()).slice(-6) + imagenes; fakeWa.media.set(id, { mimeType: 'image/png', bytes: png() }); return { type: 'image', body: { image: { id, mime_type: 'image/png', sha256: hash ?? 'hash-' + id } } } }
  const ganancias_ = async (p) => (await filas(p)).filter(([tipo]) => tipo === 'earning_credit')
`

test('receipts on PostgreSQL, turnos: the image only ranks the client\'s own pending deposits; Mercado Pago approves one deposit and the backend confirms exactly that turno, once, with the right ledger; fake, foreign and mismatching receipts confirm nothing; duplicates and concurrency never double anything', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const sin = await prestador('sin', 'Sin MP ' + run, [['Masaje', 30000], ['Largo', 60000]])
      const con = await prestador('con', 'Con MP ' + run, [['Masaje', 30000], ['Largo', 60000]])
      await conectarMercadoPago(con, '8811')
      const ana = await cliente('ana')
      const beto = await cliente('beto')
      const carla = await cliente('carla')
      ${ASISTENTE}
      const waAna = await vincular(ana)
      const waCarla = await vincular(carla)
      const waBeto = await vincular(beto)

      // Ana has TWO pending deposits (15.000 and 30.000); only the 30.000 one is paid in Mercado Pago.
      const chico = await turnoConCheckout(sin, ana, 0, '10:00', 'Masaje')
      const grande = await turnoConCheckout(sin, ana, 1, '10:00', 'Largo')
      mpPayment('8301', grande.preferencia)
      out.antes = [await estadoTurno(chico), await estadoTurno(grande), (await ganancias_(sin)).length]

      // A fake receipt: it says 15.000, approved. Mercado Pago has no payment for that deposit: nothing changes.
      const falso = await decir(waAna, '', comprobante({ amountMinor: '1500000', currency: 'ARS', statusText: 'approved' }))
      out.falso = [falso, await estadoTurno(chico), await estadoTurno(grande), (await ganancias_(sin)).length]

      // The real one: the amount points at the 30.000 deposit. Only the backend, after asking Mercado Pago, confirms.
      const real = await decir(waAna, '', comprobante({ amountMinor: '3000000', currency: 'ARS', statusText: 'approved', operationId: '8301' }))
      out.real = [real, await estadoTurno(chico), await estadoTurno(grande), await filas(sin)]
      out.lecturas = lector.llamadas.length

      // The same picture again (same Meta hash): not read again, nothing doubles.
      const hash = 'hash-repetida'
      const repetida1 = await decir(waAna, '', comprobante({ amountMinor: '3000000', currency: 'ARS' }, hash))
      const lecturasAntes = lector.llamadas.length
      const repetida2 = await decir(waAna, '', comprobante({ amountMinor: '3000000', currency: 'ARS' }, hash))
      out.repetida = [repetida2.length, lector.llamadas.length - lecturasAntes, (await ganancias_(sin)).length]
      // The webhook arrives late: one approval, one confirmation, one earning in total.
      const tarde = await ingerir(notification('8301', { userId: '555', notificationId: run + '-rc1' }))
      out.webhookTarde = [tarde.status, await estadoTurno(grande), (await ganancias_(sin)).length]

      // Another client's payment: Beto paid in Mercado Pago, Carla (who has two pending deposits) sends a receipt that
      // names Beto's operation. It is not one of her candidates: nothing is applied, nothing of Beto is revealed.
      const deBeto = await turnoConCheckout(sin, beto, 2, '10:00', 'Masaje')
      mpPayment('8302', deBeto.preferencia)
      const c1 = await turnoConCheckout(sin, carla, 3, '10:00', 'Masaje')
      const c2 = await turnoConCheckout(sin, carla, 4, '10:00', 'Largo')
      const ajeno = await decir(waCarla, '', comprobante({ amountMinor: '1500000', currency: 'ARS', operationId: '8302' }))
      out.ajeno = [ajeno, await estadoTurno(deBeto), await estadoTurno(c1), await estadoTurno(c2)]
      // An arbitrary payment id typed as text is not a receipt and queries nothing outside her own candidates.
      const arbitrario = await decir(waCarla, 'ya pagué, el pago es 8302')
      out.arbitrario = [arbitrario.length, await estadoTurno(deBeto), await estadoTurno(c1), await estadoTurno(c2)]

      // Mismatching payments for the chosen candidate: wrong amount and wrong currency are quarantined, never confirmed.
      mpPayment('8303', c2.preferencia, { transaction_amount: 10000 })
      const monto = await decir(waCarla, '', comprobante({ amountMinor: '3000000', currency: 'ARS' }))
      out.monto = [monto, await estadoTurno(c2)]

      // Beto, with a single pending deposit, sends only a picture: the picture is not even read, the backend asks MP.
      const lecturasBeto = lector.llamadas.length
      const solo = await decir(waBeto, '', comprobante({ amountMinor: '1500000', currency: 'ARS' }))
      out.solo = [solo, await estadoTurno(deBeto), lector.llamadas.length - lecturasBeto, (await ganancias_(sin)).length]

      // Split 1:1: the provider is paid by Mercado Pago; confirmed, NO earning in TUS.
      const dana = await cliente('dana')
      const waDana = await vincular(dana)
      const enSplit = await turnoConCheckout(con, dana, 0, '10:00', 'Masaje')
      const enSplit2 = await turnoConCheckout(con, dana, 1, '10:00', 'Largo')
      out.modos = [enSplit.pago.modoCobro, enSplit2.pago.modoCobro]
      mpPayment('8304', enSplit.preferencia)
      const split = await decir(waDana, '', comprobante({ amountMinor: '1500000', currency: 'ARS', operationId: '8304' }))
      out.split = [split.length, await estadoTurno(enSplit), await estadoTurno(enSplit2), await filas(con)]

      // Concurrency: the same receipt twice and the webhook at the same time: one approval, one earning.
      const eva = await cliente('eva')
      const waEva = await vincular(eva)
      const e1 = await turnoConCheckout(sin, eva, 0, '12:00', 'Masaje')
      const e2 = await turnoConCheckout(sin, eva, 1, '12:00', 'Largo')
      mpPayment('8305', e2.preferencia)
      const antesEva = (await ganancias_(sin)).length
      const juntos = await Promise.allSettled([decir(waEva, '', comprobante({ amountMinor: '3000000', currency: 'ARS' })), ingerir(notification('8305', { userId: '555', notificationId: run + '-rc5' }))])
      await decir(waEva, 'ya pagué, el de 30000')
      out.concurrencia = [juntos.map((x) => x.status), await estadoTurno(e1), await estadoTurno(e2), (await ganancias_(sin)).length - antesEva]
      out.aprobados = Number((await db.query("SELECT count(*) AS n FROM eventos_webhook_pago WHERE obligacion_id = $1 AND estado = 'applied'", [e2.obligacion.obligacionId])).rows[0].n)
      out.persistido = JSON.stringify([...waStore.state.mensajes.values()]).includes('base64') || JSON.stringify([...waStore.state.conversaciones.values()]).includes('base64') || JSON.stringify([...waStore.state.mensajes.values()]).includes('iVBOR')
    } catch (error) {
      // With the failure behind a generic 503 (its code and where it came from), when there is one.
      out.error = String(error?.stack ?? error) + (error?.cause ? ' | CAUSE code=' + String(error.cause.code ?? '') + ' ' + String(error.cause.stack ?? error.cause).slice(0, 900) : '')
    } finally {
      await cerrar()
    }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.error, undefined, r.error)
  assert.deepEqual(r.antes, ['awaiting_payment', 'awaiting_payment', 0])
  assert.equal(r.falso[0].length, 1)
  assert.match(r.falso[0][0], /no pude confirmar ese pago en Mercado Pago/u)
  assert.doesNotMatch(r.falso[0][0], /confirmó|quedó confirmado|aprobad/u)
  assert.deepEqual([r.falso[1], r.falso[2], r.falso[3]], ['awaiting_payment', 'awaiting_payment', 0], 'a receipt that says approved confirms nothing')
  assert.equal(r.real[0].length, 1)
  assert.match(r.real[0][0], /^Sí, Mercado Pago confirmó tu seña de \$30\.000\./u)
  assert.deepEqual([r.real[1], r.real[2]], ['awaiting_payment', 'confirmed'], 'only the deposit the receipt and Mercado Pago agree on')
  assert.deepEqual(r.real[3], [['earning_credit', '2700000']], 'platform collection: one earning, 90% of the deposit')
  assert.equal(r.lecturas, 2, 'two receipts were read (the fake one and the real one)')
  assert.deepEqual(r.repetida.slice(1), [0, 1], 'the same picture is not read again and nothing doubles')
  assert.deepEqual(r.webhookTarde, ['recorded', 'confirmed', 1], 'late webhook: no second confirmation, no second earning')
  assert.equal(r.ajeno[0].length, 1)
  assert.doesNotMatch(r.ajeno[0][0], /Beto|8302/u, 'nothing of another client is revealed')
  assert.deepEqual(r.ajeno.slice(1), ['awaiting_payment', 'awaiting_payment', 'awaiting_payment'], 'another client\'s payment is never applied through someone else\'s receipt')
  assert.deepEqual(r.arbitrario.slice(1), ['awaiting_payment', 'awaiting_payment', 'awaiting_payment'])
  assert.equal(r.monto[1], 'awaiting_payment', 'a payment with another amount is quarantined, never confirmed')
  assert.doesNotMatch(r.monto[0][0], /quedó confirmado/u)
  assert.deepEqual([r.solo[1], r.solo[2], r.solo[3]], ['confirmed', 0, 2], 'one pending deposit: verified by the backend without reading the picture')
  assert.deepEqual(r.modos, ['split', 'split'])
  assert.deepEqual([r.split[1], r.split[2], r.split[3]], ['confirmed', 'awaiting_payment', []], 'Split 1:1: confirmed, no earning in TUS')
  assert.deepEqual(r.concurrencia.slice(1), ['awaiting_payment', 'confirmed', 1], 'receipt, retry and webhook together: one earning')
  assert.equal(r.aprobados, 1, 'one approval')
  assert.equal(r.persistido, false, 'no image content is persisted')
})

test('receipts on PostgreSQL, works: the receipt picks the deposit or the balance of a work among the client\'s own pending payments; the work moves only when the finance domain applies the verified payment; split and platform ledgers are right and never duplicated', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const sin = await prestador('sin', 'Sin MP ' + run, [['Masaje', 30000]])
      const con = await prestador('con', 'Con MP ' + run, [['Masaje', 30000]])
      await conectarMercadoPago(con, '8812')
      const ana = await cliente('ana')
      const beto = await cliente('beto')
      ${ASISTENTE}
      const waAna = await vincular(ana)
      const waBeto = await vincular(beto)
      let n = 0
      const proveedorCtx = (p) => ({ tenantId: p.tenantId, actorId: 'u-prov', correlationId: 'c-prov' })
      const clienteCtx = (cuenta) => ({ tenantId: cuenta.tenantId, actorId: cuenta.id, correlationId: 'c-cli' })
      // A work with an accepted budget and the deposit checkout open (pending payment).
      async function trabajoConSena(p, cuenta, totalMinor) {
        n += 1
        const solicitud = run + '-sol-' + n
        await db.query("INSERT INTO solicitudes_servicio(id, cuenta_id, categoria, titulo, nombre_publico, zona, latitud, longitud, urgencia, estado, fecha_creacion, fecha_actualizacion, expira_en, visibilidad, prestador_tenant_id, prestador_id, estado_asignacion, origen) VALUES ($1,$2,'plomeria','Pierde la canilla','A','Centro',-27.4,-58.8,'esta_semana','abierta',now(),now(),now() + interval '7 days','dirigida',$3,$4,'aceptada','web_directory')", [solicitud, cuenta.id, p.tenantId, p.prestadorId])
        const creado = await work.crearDesdeSolicitudEnTransaccion({ ...clienteCtx(cuenta), solicitudId: solicitud, prestadorTenantId: p.tenantId, prestadorId: p.prestadorId, createdAt: new Date().toISOString() })
        const id = creado.work.trabajoId
        const presupuesto = await work.createBudget({ ...proveedorCtx(p), trabajoId: id, currency: 'ARS', scope: 'Cambio de cuerito', totalMinor, lines: [{ lineId: 'l1', description: 'mano de obra', quantity: 1, unitAmountMinor: totalMinor, totalAmountMinor: totalMinor }], idempotencyKey: run + '-b' + n, requestHash: 'h', createdAt: new Date().toISOString() })
        await work.decideBudget({ ...clienteCtx(cuenta), trabajoId: id, presupuestoId: presupuesto.budget.presupuestoId, presupuestoVersion: presupuesto.budget.version, decision: 'accepted', idempotencyKey: run + '-d' + n, requestHash: 'h', createdAt: new Date().toISOString() })
        await abrirCheckout(id, cuenta, 'sena')
        return id
      }
      async function abrirCheckout(id, cuenta, tramo) {
        await fin.iniciarCheckout({ ...clienteCtx(cuenta), trabajoId: id, idempotencyKey: run + '-ck-' + tramo + '-' + id })
        const obligacion = await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: id, tramo } })
        const pago = await prisma.intencionPago.findFirst({ where: { obligacionId: obligacion.obligacionId }, orderBy: { fechaCreacion: 'desc' } })
        return { obligacion, pago, preferencia: mp.preferences.find((item) => item.body.external_reference === pago.pagoId) }
      }
      const paso = async (p, id, op) => { const w = (await work.getWork(proveedorCtx(p), id)).work; n += 1; return work[op]({ ...proveedorCtx(p), trabajoId: id, expectedVersion: w.version, idempotencyKey: run + '-' + op + n, requestHash: 'h' + n, createdAt: new Date().toISOString() }) }
      const estadoTrabajo = async (id) => (await prisma.trabajo.findFirst({ where: { trabajoId: id } })).estado ?? (await prisma.trabajo.findFirst({ where: { trabajoId: id } })).status
      const tramos = async (id) => (await prisma.obligacionPagoServicio.findMany({ where: { trabajoId: id }, orderBy: { tramo: 'asc' } })).map((o) => [o.tramo, String(o.montoMinor ?? o.monto ?? ''), o.estado ?? o.status])

      // ---- Platform collection: a work of 20.000 (deposit 10.000) next to a turno deposit of 15.000.
      const turno = await turnoConCheckout(sin, ana, 0, '10:00', 'Masaje')
      const t1 = await trabajoConSena(sin, ana, '2000000')
      const ck1 = (await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: t1, tramo: 'sena' } }))
      const pago1 = await prisma.intencionPago.findFirst({ where: { obligacionId: ck1.obligacionId } })
      const pref1 = mp.preferences.find((item) => item.body.external_reference === pago1.pagoId)
      out.modo1 = pago1.modoCobro
      mpPayment('8401', pref1)
      const sena = await decir(waAna, '', comprobante({ amountMinor: '1000000', currency: 'ARS', statusText: 'approved' }))
      out.sena = [sena, await estadoTurno(turno), await tramos(t1), await filas(sin)]

      // The balance: the provider starts and finishes; the client opens the balance checkout; the receipt of 10.000
      // (the same amount as the deposit already paid) can only be a candidate that is still pending: the balance.
      await paso(sin, t1, 'startWork')
      await paso(sin, t1, 'completeWork')
      const saldo = await abrirCheckout(t1, ana, 'saldo')
      mpPayment('8402', saldo.preferencia)
      const trasSaldo = await decir(waAna, '', comprobante({ amountMinor: '1000000', currency: 'ARS', statusText: 'approved' }))
      out.saldo = [trasSaldo, await estadoTurno(turno), await tramos(t1), await filas(sin)]
      // Asking again, a late webhook and a second image change nothing.
      const otra = await decir(waAna, 'ya pagué')
      const webhook = await ingerir(notification('8402', { userId: '555', notificationId: run + '-w2' }))
      out.sinDuplicar = [otra.length, webhook.status, await filas(sin), await tramos(t1)]

      // A work of another client is not visible, a receipt that names its operation applies nothing.
      const deBeto = await trabajoConSena(sin, beto, '2000000')
      const pb = await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: deBeto, tramo: 'sena' } })
      const pagoBeto = await prisma.intencionPago.findFirst({ where: { obligacionId: pb.obligacionId } })
      mpPayment('8403', mp.preferences.find((item) => item.body.external_reference === pagoBeto.pagoId))
      const t2 = await trabajoConSena(sin, ana, '4000000')
      const turno2 = await turnoConCheckout(sin, ana, 1, '10:00', 'Masaje')
      const ajeno = await decir(waAna, '', comprobante({ amountMinor: '1000000', currency: 'ARS', operationId: '8403' }))
      out.ajeno = [ajeno, await tramos(deBeto), await tramos(t2), await estadoTurno(turno2)]

      // Wrong amount for the work deposit (the work asked 20.000 of deposit, Mercado Pago shows 1.000): quarantined.
      const pago2 = await prisma.intencionPago.findFirst({ where: { obligacionId: (await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: t2, tramo: 'sena' } })).obligacionId } })
      mpPayment('8404', mp.preferences.find((item) => item.body.external_reference === pago2.pagoId), { transaction_amount: 10 })
      const monto = await decir(waAna, '', comprobante({ amountMinor: '2000000', currency: 'ARS' }))
      out.monto = [monto, await tramos(t2)]

      // ---- Split 1:1: deposit and balance go to the provider's Mercado Pago account: NO earnings in TUS.
      const dana = await cliente('dana')
      const waDana = await vincular(dana)
      const turnoDana = await turnoConCheckout(con, dana, 2, '10:00', 'Masaje')
      const t3 = await trabajoConSena(con, dana, '2000000')
      const pago3 = await prisma.intencionPago.findFirst({ where: { obligacionId: (await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: t3, tramo: 'sena' } })).obligacionId } })
      out.modo3 = pago3.modoCobro
      mpPayment('8405', mp.preferences.find((item) => item.body.external_reference === pago3.pagoId))
      const senaSplit = await decir(waDana, '', comprobante({ amountMinor: '1000000', currency: 'ARS' }))
      await paso(con, t3, 'startWork')
      await paso(con, t3, 'completeWork')
      const saldoSplit = await abrirCheckout(t3, dana, 'saldo')
      mpPayment('8406', saldoSplit.preferencia)
      const trasSplit = await decir(waDana, '', comprobante({ amountMinor: '1000000', currency: 'ARS' }))
      out.split = [senaSplit.length, trasSplit.length, await tramos(t3), await filas(con), await estadoTurno(turnoDana)]
      out.persistido = JSON.stringify([...waStore.state.mensajes.values()]).includes('base64') || JSON.stringify([...waStore.state.conversaciones.values()]).includes('base64') || JSON.stringify([...waStore.state.mensajes.values()]).includes('iVBOR')
    } catch (error) {
      // With the failure behind a generic 503 (its code and where it came from), when there is one.
      out.error = String(error?.stack ?? error) + (error?.cause ? ' | CAUSE code=' + String(error.cause.code ?? '') + ' ' + String(error.cause.stack ?? error.cause).slice(0, 900) : '')
    } finally {
      await cerrar()
    }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.error, undefined, r.error)
  assert.equal(r.modo1, 'plataforma')
  assert.equal(r.sena[0].length, 1)
  assert.match(r.sena[0][0], /^Sí, Mercado Pago confirmó la seña de \$10\.000 del trabajo/u)
  assert.equal(r.sena[1], 'awaiting_payment', 'the turno deposit stays pending')
  assert.deepEqual(r.sena[2].map((x) => x[0] + ':' + x[2]), ['sena:paid'])
  assert.deepEqual(r.sena[3], [['earning_credit', '900000']], 'deposit of the work: one platform earning (90%)')
  assert.match(r.saldo[0][0], /^Sí, Mercado Pago confirmó el saldo de \$10\.000 del trabajo/u)
  assert.equal(r.saldo[1], 'awaiting_payment')
  assert.deepEqual(r.saldo[2].map((x) => x[0] + ':' + x[2]), ['saldo:paid', 'sena:paid'])
  assert.deepEqual(r.saldo[3], [['earning_credit', '900000'], ['earning_credit', '900000']], 'balance: its own earning')
  assert.equal(r.sinDuplicar[1], 'recorded')
  assert.deepEqual(r.sinDuplicar[2], r.saldo[3], 'no ledger duplication by asking again or by the late webhook')
  assert.deepEqual(r.sinDuplicar[3], r.saldo[2])
  assert.doesNotMatch(r.ajeno[0][0], /Beto|8403/u)
  assert.deepEqual(r.ajeno[1].map((x) => x[2]), ['pending_payment'], 'the other client\'s work is untouched')
  assert.deepEqual(r.ajeno[2].map((x) => x[2]), ['pending_payment'])
  assert.equal(r.ajeno[3], 'awaiting_payment')
  assert.doesNotMatch(r.monto[0][0], /quedó confirmad|Sí, Mercado Pago confirmó/u)
  assert.deepEqual(r.monto[1].map((x) => x[2]), ['pending_payment'], 'a payment with another amount never marks the deposit paid')
  assert.equal(r.modo3, 'split')
  assert.deepEqual(r.split[2].map((x) => x[2]), ['paid', 'paid'])
  assert.deepEqual(r.split[3], [], 'Split 1:1: the provider was paid by Mercado Pago, TUS has no earning')
  assert.equal(r.split[4], 'awaiting_payment')
  assert.equal(r.persistido, false)
})
