import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// VALIDACIONES-01, works (docs/VALIDACIONES_DATOS_TUS.md): a diagnosis, a budget and an evidence
// as the service accepts them, whoever calls it. In memory.

test('VALIDACIONES trabajos: a budget is in a supported currency, with bounded amounts, lines and texts, and stores only the fields of a line; a diagnosis and an evidence are bounded and an evidence cannot happen in the future', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}
    const out = {}
    const { LIMITES_TRABAJO } = await import('./apps/api/src/tus/work/index.ts')
    const servicio = await serviceWork('val', { priceMode: 'requires_budget', bookingMode: 'requiere_presupuesto' })
    const trabajoId = servicio.work.trabajoId
    let n = 0
    const mutacion = () => ({ idempotencyKey: 'val-' + (n += 1), requestHash: 'h-val-' + n, createdAt: '2026-09-23T09:40:00.000Z' })
    const linea = (extra = {}) => ({ lineId: 'l1', description: 'Mano de obra', quantity: 2, unitAmountMinor: '50000', totalAmountMinor: '100000', ...extra })
    const presupuesto = (extra = {}) => codeOf(() => work.createBudget({ ...provider, trabajoId, currency: 'ARS', scope: 'Reparación de la cocina', totalMinor: '100000', lines: [linea()], ...mutacion(), ...extra }))
    const diagnostico = (extra = {}) => codeOf(() => work.createDiagnosis({ ...provider, trabajoId, descripcionOriginal: 'Pérdida en la canilla', ...mutacion(), ...extra }))

    out.diagnostico = [
      await diagnostico({ descripcionOriginal: '   ' }),
      await diagnostico({ descripcionOriginal: 'x'.repeat(LIMITES_TRABAJO.descripcionDiagnostico + 1) }),
      await diagnostico({ datosEstructurados: { nota: 'x'.repeat(LIMITES_TRABAJO.datosEstructurados) } }),
      await diagnostico({ datosEstructurados: ['una', 'lista'] }),
      await diagnostico({ datosEstructurados: 'texto' }),
      await diagnostico({ descripcionOriginal: 'Pérdida en la canilla — señal de óxido 🔧', datosEstructurados: { ambiente: 'cocina' } }),
    ]
    out.presupuestoInvalido = {
      monedaLibre: await presupuesto({ currency: 'USD' }),
      monedaMinuscula: await presupuesto({ currency: 'ars' }),
      alcanceLargo: await presupuesto({ scope: 'x'.repeat(LIMITES_TRABAJO.alcance + 1) }),
      totalNegativo: await presupuesto({ totalMinor: '-100000' }),
      totalDecimal: await presupuesto({ totalMinor: '1000.50' }),
      totalNumero: await presupuesto({ totalMinor: 100000 }),
      totalEnorme: await presupuesto({ totalMinor: '9'.repeat(30), lines: [linea({ quantity: 1, unitAmountMinor: '9'.repeat(30), totalAmountMinor: '9'.repeat(30) })] }),
      sinLineas: await presupuesto({ lines: [] }),
      demasiadasLineas: await presupuesto({ totalMinor: String(51 * 100), lines: Array.from({ length: 51 }, (_, i) => linea({ lineId: 'l' + i, quantity: 1, unitAmountMinor: '100', totalAmountMinor: '100' })) }),
      cantidadCero: await presupuesto({ lines: [linea({ quantity: 0 })] }),
      cantidadDecimal: await presupuesto({ lines: [linea({ quantity: 1.5 })] }),
      cantidadEnorme: await presupuesto({ totalMinor: '100001', lines: [linea({ quantity: 100001, unitAmountMinor: '1', totalAmountMinor: '100001' })] }),
      descripcionLarga: await presupuesto({ lines: [linea({ description: 'x'.repeat(LIMITES_TRABAJO.descripcionLinea + 1) })] }),
      descripcionObjeto: await presupuesto({ lines: [linea({ description: { $gt: '' } })] }),
      lineaNula: await presupuesto({ lines: [null] }),
      idDeLineaRaro: await presupuesto({ lines: [linea({ lineId: '<script>' })] }),
      totalNoCoincide: await presupuesto({ totalMinor: '99999' }),
      lineaNoCoincide: await presupuesto({ lines: [linea({ totalAmountMinor: '99999' })], totalMinor: '99999' }),
      vencido: await presupuesto({ validUntil: '2020-01-01T00:00:00.000Z' }),
      deOtro: await codeOf(() => work.createBudget({ ...stranger, trabajoId, currency: 'ARS', scope: 'x', totalMinor: '100000', lines: [linea()], ...mutacion() })),
    }
    // A valid budget, with fields a caller added to a line: only the fields of a line are stored.
    const emitido = await work.createBudget({ ...provider, trabajoId, currency: 'ARS', scope: '  Reparación de la cocina  ', totalMinor: '100000', lines: [linea({ description: '  Mano de obra  ', aprobado: true, prestadorTenantId: 'otro', descuentoOculto: '999' })], ...mutacion() })
    out.presupuesto = [emitido.budget.status, emitido.budget.totalMinor, Object.keys(emitido.budget.lines[0]).sort(), emitido.budget.lines[0].description, emitido.budget.createdBy]

    const evidencia = (extra = {}) => codeOf(() => work.recordEvidence({ ...provider, trabajoId, evidenceId: 'ev-' + (n + 1), phase: 'antes', reference: 'foto-1', metadata: {}, occurredAt: '2026-09-23T09:00:00.000Z', ...mutacion(), ...extra }))
    const { FASES_EVIDENCIA_TRABAJO } = await import('./packages/contracts/src/tus.ts').then((m) => m, () => ({}))
    const fase = Object.values(FASES_EVIDENCIA_TRABAJO ?? {})[0] ?? 'antes'
    out.evidencia = [
      await evidencia({ phase: fase }),
      await evidencia({ phase: 'inventada' }),
      await evidencia({ phase: fase, reference: 'x'.repeat(LIMITES_TRABAJO.referenciaEvidencia + 1) }),
      await evidencia({ phase: fase, metadata: { nota: 'x'.repeat(LIMITES_TRABAJO.metadataEvidencia) } }),
      await evidencia({ phase: fase, metadata: ['x'] }),
      await evidencia({ phase: fase, evidenceId: 'ev con espacios' }),
      await evidencia({ phase: fase, occurredAt: '2026-09-25T10:00:00.000Z' }),
      await evidencia({ phase: fase, occurredAt: 'ayer' }),
    ]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.diagnostico, ['INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID', 'none'], 'a diagnosis needs a bounded description and, at most, a bounded object of structured data; Unicode is fine')
  for (const [caso, codigo] of Object.entries(r.presupuestoInvalido)) assert.equal(codigo, caso === 'deOtro' ? 'NOT_FOUND' : 'INVALID', `budget, ${caso}`)
  assert.deepEqual(r.presupuesto, ['issued', '100000', ['description', 'lineId', 'quantity', 'totalAmountMinor', 'unitAmountMinor'], 'Mano de obra', 'provider-user'], 'a line keeps only its own fields; the author is the session')
  assert.deepEqual(r.evidencia, ['none', 'INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID'], 'an evidence has a known phase, bounded reference and metadata, a clean id and a moment that already happened')
})

test('VALIDACIONES publicaciones: a publication has a bounded name and description and a real, bounded price', () => {
  const r = runTypeScriptScenario(`
    const { createTusApplication } = await import('./apps/api/src/tus/composition/index.ts')
    const application = createTusApplication()
    const provider = { sessionId: 's', subjectId: 'provider-user', tenantId: 'provider-tenant', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'], correlationId: 'c' }
    await application.marketplace.onboard(provider, { merchantId: 'provider-1', cohort: 'repairs-trades', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1' })
    const crear = async (extra = {}) => { try { await application.marketplace.createListing(provider, { merchantId: 'provider-1', kind: 'service', name: 'Plomería a domicilio', description: 'Reparación de pérdidas', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, bookingMode: 'requiere_presupuesto', priceMode: 'requires_budget', capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '12:00' }], ...extra }); return 'ok' } catch (error) { return error?.code ?? String(error?.message).slice(0, 40) } }
    console.log(JSON.stringify([await crear(), await crear({ name: 'x'.repeat(121) }), await crear({ description: 'x'.repeat(2001) }), await crear({ name: '   ' }), await crear({ name: { $ne: '' } }), await crear({ price: -1 }), await crear({ price: 0 }), await crear({ price: Number.NaN }), await crear({ price: Infinity }), await crear({ price: 100000001 }), await crear({ currency: 'pesos' }), await crear({ name: 'ñ'.repeat(120) })]))
  `)
  assert.deepEqual(r, ['ok', 'INVALID_LISTING', 'INVALID_LISTING', 'INVALID_LISTING', 'INVALID_LISTING', 'INVALID_LISTING', 'INVALID_LISTING', 'INVALID_LISTING', 'INVALID_LISTING', 'INVALID_LISTING', 'INVALID_LISTING', 'ok'])
})
