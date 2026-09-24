import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export const root = join(import.meta.dirname, '..', '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

export function runTypeScriptScenario(source) {
  const output = execFileSync(
    process.execPath,
    [tsxCli, '--eval', `(async () => {\n${source}\n})()`],
    {
      cwd: root,
      encoding: 'utf8',
    }
  )
  return JSON.parse(output.trim())
}

// Builds a WEB-08 service chain in memory: publication -> commitment -> Trabajo (-> budget).
export const SERVICE_SETUP = `
  const { TUS_CONTRACT_VERSION } = await import('./packages/contracts/src/tus.ts')
  const { InMemoryMarketplaceStore } = await import('./apps/api/src/tus/catalog/index.ts')
  const { InMemoryTrabajoStore, InMemoryTrabajoIdempotencyStore, InMemoryTrabajoOutboxStore, InMemoryTrabajoTransaction, ServicioTrabajo } = await import('./apps/api/src/tus/work/index.ts')
  const { ServicioFinanzasServicios } = await import('./apps/api/src/tus/finance/servicios/servicio.ts')
  const { AlmacenFinanzasServicioEnMemoria, IdentidadServicioEnMemoria, TransaccionFinanzasServicioEnMemoria } = await import('./apps/api/src/tus/finance/servicios/memoria.ts')
  const { ErrorFinanzasServicio } = await import('./apps/api/src/tus/finance/servicios/modelo.ts')
  const { ProveedorPagosServicioDeterminista } = await import('./apps/api/src/tus/finance/servicios/pagos.ts')
  const proveedorPagos = new ProveedorPagosServicioDeterminista('fake-provider-secret')
  const clock = () => Date.parse('2026-09-23T10:00:00.000Z')
  const marketplace = new InMemoryMarketplaceStore()
  const workStore = new InMemoryTrabajoStore()
  const work = new ServicioTrabajo(new InMemoryTrabajoTransaction({ work: workStore, idempotency: new InMemoryTrabajoIdempotencyStore(), outbox: new InMemoryTrabajoOutboxStore() }), clock)
  const financeStore = new AlmacenFinanzasServicioEnMemoria()
  const finance = new ServicioFinanzasServicios(new TransaccionFinanzasServicioEnMemoria(financeStore, new IdentidadServicioEnMemoria(workStore, marketplace)), clock, proveedorPagos)
  const provider = { tenantId: 'provider-tenant', actorId: 'provider-user', correlationId: 'corr-provider' }
  const customer = { tenantId: 'customer-tenant', actorId: 'customer-user', correlationId: 'corr-customer' }
  const stranger = { tenantId: 'other-tenant', actorId: 'other-user', correlationId: 'corr-other' }
  const codeOf = async (operation) => { try { await operation(); return 'none' } catch (error) { return error?.code ?? String(error) } }
  function listing(id, overrides = {}) {
    return { contractVersion: TUS_CONTRACT_VERSION, listingId: id, tenantId: provider.tenantId, merchantId: 'provider-1', kind: 'service', name: 'Service ' + id, description: 'Service', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1500, priceMinor: 150000n, priceSnapshot: { currency: 'ARS', minor: 150000n }, availabilityVersion: 1, published: true, policyVersion: 'policy-1', stock: null, durationMinutes: 60, capacity: 1, workingHours: [], createdAt: '2026-09-23T09:00:00.000Z', updatedAt: '2026-09-23T09:00:00.000Z', ...overrides }
  }
  function commitmentFor(id, publication, quantity = 1) {
    return { contractVersion: TUS_CONTRACT_VERSION, commitmentId: id, cartId: 'cart-' + id, tenantId: customer.tenantId, merchantId: publication.merchantId, context: 'service', amount: Number(publication.priceMinor) * quantity / 100, currency: 'ARS', status: 'confirmed', lineIds: ['line-' + id], version: 1, createdAt: '2026-09-23T09:00:00.000Z', listingId: publication.listingId, quantity, availabilityVersion: 1, policyVersion: 'policy-1', priceSnapshot: { currency: 'ARS', minor: publication.priceMinor } }
  }
  async function serviceWork(id, listingOverrides = {}, quantity = 1) {
    const publication = listing('listing-' + id, listingOverrides)
    await marketplace.listings.save(publication)
    const commitment = commitmentFor('commitment-' + id, publication, quantity)
    await marketplace.commitments.saveMany([commitment])
    const accepted = await work.acceptCommitment({ ...provider, commitment, publication, idempotencyKey: 'accept-' + id, requestHash: 'hash-accept-' + id, createdAt: '2026-09-23T09:30:00.000Z' })
    return { publication, commitment, work: accepted.work }
  }
  async function acceptBudget(trabajoId, totalMinor, currency = 'ARS') {
    const diagnosis = await work.createDiagnosis({ ...provider, trabajoId, descripcionOriginal: 'diagnosis', idempotencyKey: 'diag-' + trabajoId, requestHash: 'h-diag-' + trabajoId, createdAt: '2026-09-23T09:31:00.000Z' })
    await work.confirmDiagnosis({ ...provider, trabajoId, diagnosticoId: diagnosis.diagnosis.diagnosticoId, expectedVersion: 1, idempotencyKey: 'confirm-' + trabajoId, requestHash: 'h-confirm-' + trabajoId, createdAt: '2026-09-23T09:32:00.000Z' })
    const budget = await work.createBudget({ ...provider, trabajoId, currency, scope: 'scope', totalMinor, lines: [{ lineId: 'l1', description: 'labour', quantity: 1, unitAmountMinor: totalMinor, totalAmountMinor: totalMinor }], idempotencyKey: 'budget-' + trabajoId, requestHash: 'h-budget-' + trabajoId, createdAt: '2026-09-23T09:33:00.000Z' })
    return work.decideBudget({ ...customer, trabajoId, presupuestoId: budget.budget.presupuestoId, presupuestoVersion: budget.budget.version, decision: 'accepted', idempotencyKey: 'decide-' + trabajoId, requestHash: 'h-decide-' + trabajoId, createdAt: '2026-09-23T09:34:00.000Z' })
  }
  async function finishWork(trabajoId) {
    const current = (await work.getWork(provider, trabajoId)).work
    const started = await work.startWork({ ...provider, trabajoId, expectedVersion: current.version, idempotencyKey: 'start-' + trabajoId, requestHash: 'h-start-' + trabajoId, createdAt: '2026-09-23T09:35:00.000Z' })
    return (await work.completeWork({ ...provider, trabajoId, expectedVersion: started.work.version, idempotencyKey: 'complete-' + trabajoId, requestHash: 'h-complete-' + trabajoId, createdAt: '2026-09-23T09:36:00.000Z' })).work
  }
  // WEB-09D: a service is payable only when completed with an accepted budget.
  async function payableWork(id, totalMinor = '150000', listingOverrides = {}) {
    const service = await serviceWork(id, { priceMode: 'requires_budget', bookingMode: 'requiere_presupuesto', ...listingOverrides })
    await acceptBudget(service.work.trabajoId, totalMinor)
    return { ...service, work: await finishWork(service.work.trabajoId) }
  }
`
