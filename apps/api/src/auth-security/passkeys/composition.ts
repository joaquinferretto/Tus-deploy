import { PasskeyService } from './application/passkey-service.js'
import {
  DeterministicPasskeyChallengeGenerator,
  DeterministicPasskeyIdGenerator,
  DeterministicPasskeyVerifier,
  InMemoryPasskeyStore,
} from './adapters/in-memory.js'
import type { PasskeyStore, WebAuthnVerifier } from './ports.js'

export function createPasskeyService(options: {
  store: PasskeyStore
  verifier?: WebAuthnVerifier
  now?: () => number
}) {
  const service = new PasskeyService({
    store: options.store,
    verifier: options.verifier ?? new DeterministicPasskeyVerifier(),
    ids: new DeterministicPasskeyIdGenerator(),
    challenges: new DeterministicPasskeyChallengeGenerator(),
    now: options.now ?? (() => Date.now()),
  })
  return {
    service,
    store: options.store,
    beginRegistration: service.beginRegistration.bind(service),
    finishRegistration: service.finishRegistration.bind(service),
  }
}

export function createInMemoryPasskeyService(options: { now?: () => number } = {}) {
  return createPasskeyService({ store: new InMemoryPasskeyStore(), ...options })
}

export { PasskeyService } from './application/passkey-service.js'
export { InMemoryPasskeyStore } from './adapters/in-memory.js'
export type * from './domain.js'
export type * from './ports.js'
