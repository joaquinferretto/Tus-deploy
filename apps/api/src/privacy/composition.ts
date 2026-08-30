import { InMemoryAuditSink } from '../audit/adapters/in-memory.js'
import { PrivacyService } from './application/privacy-service.js'
import {
  DeterministicPrivacyIdGenerator,
  InMemoryPrivacyPropagationAdapter,
  InMemoryPrivacyStore,
  SystemPrivacyClock,
} from './adapters/in-memory.js'
import type { PrivacyClock, PrivacyPropagationPort, PrivacyStore } from './ports.js'

export interface InMemoryPrivacyServiceOptions {
  now?: () => number
  propagation?: PrivacyPropagationPort
}

export interface PrivacyServiceFactoryOptions {
  store: PrivacyStore
  propagation: PrivacyPropagationPort
  clock?: PrivacyClock
}

export function createPrivacyService(options: PrivacyServiceFactoryOptions) {
  const audit = new InMemoryAuditSink()
  const service = new PrivacyService({
    store: options.store,
    audit,
    ids: new DeterministicPrivacyIdGenerator(),
    clock: options.clock ?? new SystemPrivacyClock(),
    propagation: options.propagation,
  })
  return {
    service,
    store: options.store,
    audit,
    propagation: options.propagation,
    registerRecord: service.registerRecord.bind(service),
    recordConsent: service.recordConsent.bind(service),
    withdrawConsent: service.withdrawConsent.bind(service),
    requestExport: service.requestExport.bind(service),
    requestAccess: service.requestAccess.bind(service),
    requestDeletion: service.requestDeletion.bind(service),
    rectify: service.rectify.bind(service),
    setRetentionSchedule: service.setRetentionSchedule.bind(service),
    addLegalHold: service.addLegalHold.bind(service),
    releaseLegalHold: service.releaseLegalHold.bind(service),
    runRetention: service.runRetention.bind(service),
  }
}

export function createInMemoryPrivacyService(options: InMemoryPrivacyServiceOptions = {}) {
  return createPrivacyService({
    store: new InMemoryPrivacyStore(),
    propagation: options.propagation ?? new InMemoryPrivacyPropagationAdapter(),
    clock: options.now ? { now: options.now } : undefined,
  })
}

export { PrivacyService } from './application/privacy-service.js'
export {
  DeterministicPrivacyIdGenerator,
  InMemoryPrivacyPropagationAdapter,
  InMemoryPrivacyStore,
  SystemPrivacyClock,
  UnavailablePrivacyPropagationAdapter,
} from './adapters/in-memory.js'
export * from './domain.js'
export type * from './ports.js'
