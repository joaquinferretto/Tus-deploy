import type {
  PasskeyCeremony,
  PasskeyCredential,
  WebAuthnExpected,
  WebAuthnRegistrationResponse,
  WebAuthnVerification,
} from './domain.js'

export interface PasskeyStore {
  readonly ceremonies: Map<string, PasskeyCeremony>
  readonly credentials: Map<string, PasskeyCredential>
  saveCeremony(ceremony: PasskeyCeremony): Promise<void>
  findCeremony(ceremonyId: string): Promise<PasskeyCeremony | undefined>
  saveCredential(credential: PasskeyCredential): Promise<void>
}

export interface WebAuthnVerifier {
  verifyRegistration(
    response: WebAuthnRegistrationResponse,
    expected: WebAuthnExpected
  ): Promise<WebAuthnVerification | undefined>
}

export interface PasskeyIdGenerator {
  next(): string
}

export interface PasskeyChallengeGenerator {
  next(): string
}
