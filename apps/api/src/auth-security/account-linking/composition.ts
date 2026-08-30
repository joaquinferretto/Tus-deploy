import { AccountLinkingService } from './application/account-linking-service.js'
import {
  InMemoryAccountLinkingAuditSink,
  InMemoryAccountLinkingStore,
} from './adapters/in-memory.js'
import type { AccountLinkingStore } from './ports.js'

export function createAccountLinkingService(options: {
  store: AccountLinkingStore
  now?: () => number
}) {
  const audit = new InMemoryAccountLinkingAuditSink()
  const service = new AccountLinkingService({
    store: options.store,
    audit,
    clock: { now: options.now ?? (() => Date.now()) },
  })
  return {
    service,
    store: options.store,
    audit,
    seedAccount: options.store.seedAccount.bind(options.store),
    link: service.link.bind(service),
    unlink: service.unlink.bind(service),
  }
}

export function createInMemoryAccountLinkingService(options: { now?: () => number } = {}) {
  return createAccountLinkingService({ store: new InMemoryAccountLinkingStore(), ...options })
}

export { AccountLinkingService } from './application/account-linking-service.js'
export { InMemoryAccountLinkingStore } from './adapters/in-memory.js'
export type * from './domain.js'
export type * from './ports.js'
