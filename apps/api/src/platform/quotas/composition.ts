import { QuotaService } from './application/quota-service.js'
import {
  DeterministicQuotaClock,
  DeterministicQuotaIdGenerator,
  InMemoryQuotaLedgerStore,
  InMemoryQuotaPolicyStore,
} from './adapters/in-memory.js'
import type { QuotaClock, QuotaIdGenerator, QuotaLedgerStore, QuotaPolicyStore } from './ports.js'

export interface QuotaServiceFactoryOptions {
  policies?: QuotaPolicyStore
  ledger?: QuotaLedgerStore
  clock?: QuotaClock
  ids?: QuotaIdGenerator
  now?: () => number
  reservationTtlMs?: number
}

export function createQuotaService(options: QuotaServiceFactoryOptions = {}) {
  const policies = options.policies ?? new InMemoryQuotaPolicyStore()
  const ledger = options.ledger ?? new InMemoryQuotaLedgerStore()
  const clock = options.clock ?? new DeterministicQuotaClock(options.now?.() ?? 0)
  const ids = options.ids ?? new DeterministicQuotaIdGenerator()
  const service = new QuotaService(
    { policies, ledger, clock, ids },
    { reservationTtlMs: options.reservationTtlMs }
  )
  return {
    service,
    policies,
    ledger,
    publishPolicy: service.publishPolicy.bind(service),
    resolvePolicy: service.resolvePolicy.bind(service),
    rollbackPolicy: service.rollbackPolicy.bind(service),
    reserve: service.reserve.bind(service),
    commit: service.commit.bind(service),
    consume: service.consume.bind(service),
    recordUsage: service.recordUsage.bind(service),
    release: service.release.bind(service),
    usage: service.usage.bind(service),
    queryUsage: service.queryUsage.bind(service),
  }
}

export function createInMemoryQuotaService(
  options: Omit<QuotaServiceFactoryOptions, 'policies' | 'ledger'> = {}
) {
  return createQuotaService(options)
}

export { QuotaService } from './application/quota-service.js'
export {
  DeterministicQuotaClock,
  DeterministicQuotaIdGenerator,
  InMemoryQuotaLedgerStore,
  InMemoryQuotaPolicyStore,
} from './adapters/in-memory.js'
export {
  ActivationGatedQuotaAdapter,
  QuotaProviderUnavailableError,
} from './adapters/activation-gated.js'
export type * from './domain.js'
export type * from './ports.js'

export default { createQuotaService, createInMemoryQuotaService }
