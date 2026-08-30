import { randomBytes, randomUUID } from 'node:crypto'
import type {
  PasskeyCeremony,
  PasskeyCredential,
  WebAuthnExpected,
  WebAuthnRegistrationResponse,
  WebAuthnVerification,
} from '../domain.js'
import type {
  PasskeyChallengeGenerator,
  PasskeyIdGenerator,
  PasskeyStore,
  WebAuthnVerifier,
} from '../ports.js'

export class InMemoryPasskeyStore implements PasskeyStore {
  readonly ceremonies = new Map<string, PasskeyCeremony>()
  readonly credentials = new Map<string, PasskeyCredential>()

  async saveCeremony(ceremony: PasskeyCeremony): Promise<void> {
    this.ceremonies.set(ceremony.id, ceremony)
  }

  async findCeremony(ceremonyId: string): Promise<PasskeyCeremony | undefined> {
    return this.ceremonies.get(ceremonyId)
  }

  async saveCredential(credential: PasskeyCredential): Promise<void> {
    this.credentials.set(credential.id, credential)
  }
}

export class DeterministicPasskeyVerifier implements WebAuthnVerifier {
  async verifyRegistration(
    response: WebAuthnRegistrationResponse,
    expected: WebAuthnExpected
  ): Promise<WebAuthnVerification | undefined> {
    if (response.proof !== 'fake-proof') return undefined
    if (
      response.challenge !== expected.challenge ||
      response.origin !== expected.origin ||
      response.rpId !== expected.rpId ||
      response.type !== expected.type ||
      !response.userVerification
    ) {
      return undefined
    }
    return {
      credentialId: response.credentialId,
      publicKey: `fake-public-key:${response.credentialId}`,
      signCount: 0,
    }
  }
}

export class DeterministicPasskeyIdGenerator implements PasskeyIdGenerator {
  private sequence = 0

  next(): string {
    this.sequence += 1
    return `passkey-id-${this.sequence}`
  }
}

export class DeterministicPasskeyChallengeGenerator implements PasskeyChallengeGenerator {
  private sequence = 0

  next(): string {
    this.sequence += 1
    return `passkey-challenge-${this.sequence}`
  }
}

export class RandomPasskeyIdGenerator implements PasskeyIdGenerator {
  next(): string {
    return randomUUID()
  }
}

export class RandomPasskeyChallengeGenerator implements PasskeyChallengeGenerator {
  next(): string {
    return randomBytes(32).toString('base64url')
  }
}
