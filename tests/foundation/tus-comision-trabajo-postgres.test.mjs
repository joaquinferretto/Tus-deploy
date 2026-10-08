import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// COMISION-TRABAJO-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL): the persisted, versioned commission policy of TUS (the one that
// already existed) and its snapshot per work. The real turnos, payments module (offline Mercado
// Pago at the `fetch` boundary), finance, closing and cancellation.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'
const root = join(import.meta.dirname, '../..')

test('COMISION por trabajo PostgreSQL: the administration changes the global commission (10% -> 7% -> 15%); a work contracted before keeps its own for its deposit AND its balance; a new work uses the new one, also paid in total; the cancellation and the refund use the commission of that work; the configuration survives a restart; two administrators at once leave one version; every change is audited; the range is 0% to 100% in whole basis points', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${turnosPagosSetup(url)}
    const out = {}
    const HORA = 3600_000
    const { resolverPoliticaComision } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    const { CODIGO_CANCELACION_TARDIA } = await import('./packages/contracts/src/tus-turnos.ts')
    const globales = async () => (await modulo.configuracion.listarPoliticas()).filter((x) => x.scope === 'global').sort((a, b) => a.version - b.version)
    const version = async () => (await globales()).at(-1)?.version ?? 0
    const cambiar = async (rateBps, actorId = 'admin-uno', expectedVersion) => modulo.configuracion.registrarPolitica({ actorId, correlationId: 'c-' + actorId }, { scope: 'global', rateBps, reason: 'cambio de comision ' + rateBps, expectedVersion: expectedVersion ?? (await version()), pspFeeBearer: 'provider' })
    const codigo = async (op) => { try { await op(); return 'ok' } catch (e) { return e?.code ?? String(e) } }
    try {
      const p = await prestador('com', 'Comision ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      let pagos = 400000 + Math.floor(Math.random() * 500000) * 10
      const aprobar = async (preferencia) => { pagos += 1; mpPayment(String(pagos), preferencia); return ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-c-' + pagos })) }
      const fijada = async (t) => { const c = await prisma.comisionTrabajo.findFirst({ where: { trabajoId: t.trabajoId } }); return c ? [c.tasaPuntosBase, Number(c.baseMinor), Number(c.comisionMinor), c.versionRegla, c.moneda] : null }
      const intentos = async (t) => { const ids = (await prisma.obligacionPagoServicio.findMany({ where: { trabajoId: t.trabajoId } })).map((o) => o.obligacionId); return (await prisma.intencionPago.findMany({ where: { obligacionId: { in: ids } }, orderBy: { fechaCreacion: 'asc' } })).map((i) => [i.tasaComisionBps, Number(i.comisionMarketplace)]) }
      const liquidadas = async (t) => (await prisma.liquidacionServicio.findMany({ where: { trabajoId: t.trabajoId }, orderBy: { obligacionId: 'asc' } })).map((l) => [Number(l.montoBruto), Number(l.montoComision), Number(l.montoNeto)])
      const checkoutDe = async (t, tramo) => {
        let checkout = null
        for (let i = 0; !checkout; i += 1) { try { checkout = await turnos.pagarTurno({ clienteId: ana.id, reservaId: t.pedido.id, correlationId: 'c', tramo }) } catch (e) { if (e?.code !== 'IN_PROGRESS' || i >= 40) throw e; await new Promise((resolve) => setTimeout(resolve, 250)) } }
        const obligacion = await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: t.trabajoId, tramo } })
        const pago = await prisma.intencionPago.findFirst({ where: { obligacionId: obligacion.obligacionId }, orderBy: { fechaCreacion: 'desc' } })
        return { obligacion, pago, preferencia: mp.preferences.find((item) => item.body.external_reference === pago.pagoId) }
      }

      // ---- The starting point of this run: 10%.
      await cambiar(1000)
      // A. Monday: a turno is contracted at 10% (accepted; nothing paid yet).
      const a = await turnoConCheckout(p, ana, 4, '09:00', 'Masaje')
      out.contratadoAl10 = await fijada(a)
      // B. Tuesday: the administration changes the global commission to 7%.
      const cambio = await cambiar(700, 'admin-dos')
      out.cambio = [cambio.rateBps, cambio.version === (await version()), cambio.actorId, cambio.reason]
      const b = await turnoConCheckout(p, ana, 4, '10:00', 'Masaje')
      out.nuevoAl7 = await fijada(b)
      out.elAnteriorSigue = await fijada(a)
      // The deposits of both are approved: each with the commission of its own work.
      await aprobar(a.preferencia)
      await aprobar(b.preferencia)
      out.senas = [await liquidadas(a), await liquidadas(b)]
      // A is delivered, confirmed and its balance is charged: still 10%, although 7% is in force.
      adelantar(12 * 24 * HORA)
      await cierre.finalizar(p.ctx, a.trabajoId, { evidence: 'Sesión de masaje realizada completa.' })
      await cierre.confirmar({ tenantId: ana.tenantId, actorId: ana.id, correlationId: 'c-cli' }, a.trabajoId)
      const saldo = await checkoutDe(a, 'saldo')
      await aprobar(saldo.preferencia)
      out.saldoDeA = [await intentos(a), await liquidadas(a), await fijada(a)]
      // C. A new turno paid in total, at 7%.
      const c = await turnoConCheckout(p, ana, 4, '11:00', 'Masaje')
      const total = await checkoutDe(c, 'total')
      await aprobar(total.preferencia)
      const pagoDeC = String(pagos)
      out.totalAl7 = [await fijada(c), (await liquidadas(c)).at(-1), (await intentos(c)).map((i) => i[0])]

      // ---- The administration changes it again, to 15%. Nothing of the works above moves.
      await cambiar(1500, 'admin-uno')
      // The cancellation of B (deposit paid at 7%) uses the commission of B.
      const d = await turnoConCheckout(p, ana, 4, '12:00', 'Masaje')
      out.nuevoAl15 = await fijada(d)
      let reloj = (await prisma.reserva.findUnique({ where: { id: b.pedido.id } })).fechaCreacion.getTime() + HORA
      turnos.conReloj(() => reloj)
      await turnos.cancelarTurnoCliente({ clienteId: ana.id, reservaId: b.pedido.id, confirmaPerdida: true, canal: 'web' })
      const cancelada = await prisma.cancelacionTurno.findUnique({ where: { reservaId: b.pedido.id } })
      out.cancelacionDeB = [cancelada.regla, Number(cancelada.pagadoMinor), Number(cancelada.cargoTusMinor), Number(cancelada.reembolsableMinor), Number(cancelada.penalizacionMinor)]
      // The refund of C (paid in total at 7%) reverses what was booked at 7%.
      const antesDelReembolso = await liquidadas(c)
      const reembolso = await fin.solicitarReembolso({ tenantId: ana.tenantId, paymentId: total.pago.pagoId, actorId: 'u-admin', correlationId: 'r', idempotencyKey: run + '-refund-com', reason: 'servicio no prestado' })
      // Mercado Pago confirms the refund with its notification.
      mp.payments.set(pagoDeC, { ...mp.payments.get(pagoDeC), status: 'refunded', status_detail: 'refunded', date_last_updated: new Date(Date.now() + 180_000).toISOString() })
      await ingerir(notification(pagoDeC, { userId: '555', notificationId: run + '-c-refund' }))
      const instantanea = await prisma.instantaneaComision.findFirst({ where: { obligacionId: total.obligacion.obligacionId } })
      out.reembolsoDeC = [reembolso.status ?? reembolso.refund?.status ?? null, (await prisma.obligacionPagoServicio.findFirst({ where: { obligacionId: total.obligacion.obligacionId } })).estado, antesDelReembolso, await liquidadas(c), [instantanea.tasaPuntosBase, Number(instantanea.montoComision)], await fijada(c)]

      // ---- Two administrators change it at the same moment, from the same version.
      const desde = await version()
      const carrera = await Promise.all([codigo(() => cambiar(800, 'admin-uno', desde)), codigo(() => cambiar(900, 'admin-dos', desde))])
      const trasCarrera = await globales()
      out.carrera = [carrera.slice().sort(), trasCarrera.filter((x) => x.version === desde + 1).length, trasCarrera.length === new Set(trasCarrera.map((x) => x.version)).size, await codigo(() => cambiar(600, 'admin-uno', desde))]
      // ---- A restart: another instance over the same database reads the same commission.
      const otraInstancia = resolverPoliticaComision(await new ConfiguracionPagosPrisma(prisma).listarPoliticas(), { prestadorId: '', categoria: null })
      const vigente = trasCarrera.at(-1)
      out.reinicio = [otraInstancia.rateBps === vigente.rateBps, otraInstancia.ruleVersion === vigente.ruleVersion, otraInstancia.politicaId === vigente.politicaId]
      // ---- The audit: every change with its value, the previous one, who and when.
      const historia = await globales()
      const mias = historia.slice(-4)
      out.auditoria = [mias.map((x) => x.rateBps).slice(0, 3), mias.slice(0, 3).map((x) => x.actorId), mias.every((x) => x.reason && !Number.isNaN(Date.parse(x.createdAt))), historia.every((x, i) => i === 0 || x.version === historia[i - 1].version + 1)]
      const estado = await modulo.configuracion.estado()
      out.estado = [estado.globalPolicy.rateBps === vigente.rateBps, estado.globalPolicy.version === vigente.version, estado.globalPolicy.actorId === vigente.actorId, estado.globalPolicy.since === vigente.createdAt, estado.globalPolicy.previousRateBps, estado.globalPolicy.persisted]
      // ---- The range: whole basis points from 0 to 10000.
      out.rango = [await codigo(() => cambiar(10001)), await codigo(() => cambiar(-1)), await codigo(() => cambiar(7.5)), await codigo(() => cambiar('700')), await codigo(() => cambiar(10000)), await codigo(() => cambiar(0))]
      const e = await turnoConCheckout(p, ana, 4, '13:00', 'Masaje')
      out.alCero = await fijada(e)
      // Back to 10% for whatever runs after this file on the same database.
      await cambiar(1000)
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  // [rate in basis points, base (the price, in centavos), commission of that base]
  assert.deepEqual(r.contratadoAl10.slice(0, 3), [1000, 3_000_000, 300_000], 'contracted at 10%: frozen when the provider accepted, before any charge')
  assert.equal(r.contratadoAl10[4], 'ARS')
  assert.deepEqual(r.cambio.slice(0, 3), [700, true, 'admin-dos'])
  assert.deepEqual(r.nuevoAl7.slice(0, 3), [700, 3_000_000, 210_000], 'a new work uses the new commission')
  assert.deepEqual(r.elAnteriorSigue, r.contratadoAl10, 'the work contracted before keeps its commission, untouched')
  assert.notEqual(r.nuevoAl7[3], r.contratadoAl10[3], 'each snapshot records the version of the rule it came from')
  // [gross, commission, net] of each settlement.
  assert.deepEqual(r.senas, [[[1_500_000, 150_000, 1_350_000]], [[1_500_000, 105_000, 1_395_000]]], 'each deposit with the commission of its own work')
  assert.deepEqual(r.saldoDeA[0].map((i) => i[0]), [1000, 1000], 'the balance is prepared with the same snapshot as the deposit')
  assert.deepEqual(r.saldoDeA[1], [[1_500_000, 150_000, 1_350_000], [1_500_000, 150_000, 1_350_000]], 'deposit + balance: 10% of the total, never the 7% in force')
  assert.deepEqual(r.saldoDeA[2], r.contratadoAl10)
  assert.deepEqual(r.totalAl7, [[700, 3_000_000, 210_000, r.nuevoAl7[3], 'ARS'], [3_000_000, 210_000, 2_790_000], [700, 700]], 'paid in total with its own snapshot (the replaced deposit carried the same rate)')
  assert.deepEqual(r.nuevoAl15.slice(0, 3), [1500, 3_000_000, 450_000])
  assert.deepEqual(r.cancelacionDeB, ['gracia', 1_500_000, 105_000, 1_395_000, 0], 'the cancellation uses the charge of TUS of that turno (7%), not the 15% in force')
  assert.equal(r.reembolsoDeC[1], 'refunded')
  assert.deepEqual(r.reembolsoDeC[2].map((l) => l.slice(0, 2)), [[3_000_000, 210_000]])
  assert.deepEqual(r.reembolsoDeC[3].map((l) => l.slice(0, 2)), [[3_000_000, 210_000]], 'the refund reverses what was booked at 7%: nothing is recomputed with the commission in force')
  assert.deepEqual(r.reembolsoDeC[4], [700, 210_000])
  assert.deepEqual(r.reembolsoDeC[5].slice(0, 3), [700, 3_000_000, 210_000])
  assert.deepEqual(r.carrera, [['VERSION_CONFLICT', 'ok'], 1, true, 'VERSION_CONFLICT'], 'two administrators at once: one change is stored, the other is told to reload; a stale version is refused')
  assert.deepEqual(r.reinicio, [true, true, true], 'another instance reads the same persisted commission')
  assert.deepEqual(r.auditoria.slice(0, 2), [[1000, 700, 1500], ['admin-uno', 'admin-dos', 'admin-uno']])
  assert.deepEqual(r.auditoria.slice(2), [true, true], 'every change keeps who, why and when, in consecutive versions (the previous value is the previous version)')
  assert.deepEqual([r.estado[0], r.estado[1], r.estado[2], r.estado[3], r.estado[4], r.estado[5]], [true, true, true, true, 1500, true], 'the administration reads the commission in force, since when, who set it and what it was before')
  assert.deepEqual(r.rango, ['INVALID_COMMISSION', 'INVALID_COMMISSION', 'INVALID_COMMISSION', 'INVALID_COMMISSION', 'ok', 'ok'], '0% to 100%, in whole basis points')
  assert.deepEqual(r.alCero.slice(0, 3), [0, 3_000_000, 0])
})

test('COMISION Admin: the screen has one simple section (percentage, save, who and since when, the text about new operations), converts what is typed to basis points without floating point and sends the version it read; the commission is never read from the environment; the migration is additive', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const pagina = read('apps/web/src/components/admin/admin-trabajos.tsx')
  const api = read('apps/web/src/lib/tus-admin-api.ts')
  const servicio = read('apps/api/src/tus/finance/servicios/servicio.ts')
  const migracion = read('apps/api/prisma/migrations/20261115100000_tus_comision_por_trabajo/migration.sql')
  assert.match(pagina, /<h3>Comisión TUS<\/h3>/u)
  assert.match(pagina, /Los cambios se aplican a nuevas operaciones\. Las operaciones existentes conservan la comisión con la que fueron contratadas\./u)
  assert.match(pagina, /desde \{politica\.since \? formatFecha\(politica\.since\) : '—'\} · la modificó \{politica\.actorId \?\? '—'\}/u)
  assert.match(pagina, /expectedVersion: politica\.version \?\? 0/u)
  assert.match(pagina, /bps > COMISION_ALTA_BPS \? <p data-comision-alta/u, 'an exceptionally high value is warned about')
  assert.match(pagina, /causa\.code === 'VERSION_CONFLICT' \? 'Otra persona cambió la comisión recién/u)
  // What is typed becomes basis points with integers only.
  const fuente = /export function porcentajeABps\(texto: string\): number \| null \{[\s\S]*?\n\}/u.exec(pagina)[0]
  assert.doesNotMatch(fuente, /parseFloat|Number\(texto|\* 100\)|toFixed/u)
  const porcentajeABps = new Function(`${fuente.replace('export function porcentajeABps(texto: string): number | null', 'function porcentajeABps(texto)')}; return porcentajeABps`)()
  assert.deepEqual(['5', '8', '10', '15', '7,5', '12.25', '0', '100', '0,07', ' 9 '].map(porcentajeABps), [500, 800, 1000, 1500, 750, 1225, 0, 10000, 7, 900])
  assert.deepEqual(['', 'diez', '7,555', '100,01', '101', '-5', '1e2', '7%'].map(porcentajeABps), [null, null, null, null, null, null, null, null])
  assert.match(api, /cambiarComisionGlobal: [\s\S]{0,260}'\/tus\/v1\/admin\/payments\/commission-policies', \{ scope: 'global', \.\.\.input \}\)/u)
  // One source: the persisted policy and its snapshot per work. Never an environment variable.
  assert.doesNotMatch(servicio + read('apps/api/src/tus/finance/servicios/configuracion.ts'), /env\[['"][A-Z_]*(COMISION|COMMISSION)[A-Z_]*['"]\]/u)
  assert.match(servicio, /const rule = await this\.comisionDelTrabajo\(repositories, obligation, publicacion\?\.categoria \?\? null\)/u, 'a payment is prepared with the commission of its work')
  assert.equal((servicio.match(/await this\.comisionDelTrabajo\(repositories, obligation, null\)/gu) ?? []).length, 3, 'frozen wherever an obligation is created')
  // No table, column or row is dropped or rewritten; the only things replaced are the two CHECKs
  // that capped the rate at 30%, by the same ones with the limit at 100%.
  assert.doesNotMatch(migracion, /\bDROP (TABLE|COLUMN|INDEX)\b|\bDELETE FROM\b|\bUPDATE public\b|\bINSERT INTO\b/u)
  assert.deepEqual((migracion.match(/DROP CONSTRAINT "[^"]+"/gu) ?? []).sort(), ['DROP CONSTRAINT "ck_intenciones_pago_checkout"', 'DROP CONSTRAINT "ck_politicas_comision_tasa"'])
  assert.equal((migracion.match(/<= 10000\)/gu) ?? []).length, 3)
  assert.match(migracion, /PRIMARY KEY \("tenant_id", "trabajo_id"\)/u)
  assert.match(migracion, /ENABLE ROW LEVEL SECURITY/u)
})
