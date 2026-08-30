import {
  PASSKEY_RESULT_CODE,
  type PasskeyFailure,
  type PasskeyCeremony,
  type PasskeySubject,
  type WebAuthnRegistrationResponse,
} from '../domain.js'
import type {
  PasskeyChallengeGenerator,
  PasskeyIdGenerator,
  PasskeyStore,
  WebAuthnVerifier,
} from '../ports.js'

const CEREMONY_TTL_MS = 5 * 60 * 1000

export interface PasskeyServiceDependencies {
  store: PasskeyStore
  verifier: WebAuthnVerifier
  ids: PasskeyIdGenerator
  challenges: PasskeyChallengeGenerator
  now: () => number
}

export type PasskeyOptionsResult =
  | { ok: true; ceremonyId: string; challenge: string; options: Record<string, unknown> }
  | PasskeyFailure

export type PasskeyRegistrationResult = { ok: true; credentialId: string } | PasskeyFailure

export class PasskeyService {
  private readonly dependencies: PasskeyServiceDependencies

  constructor(dependencies: PasskeyServiceDependencies) {
    this.dependencies = dependencies
  }

  async beginRegistration(input: {
    subject: PasskeySubject['subject'] | undefined
    rpId: string
    origin: string
  }): Promise<PasskeyOptionsResult> {
    if (!input.subject?.accountId || !input.subject.sessionId) {
      return {
        ok: false,
        code: PASSKEY_RESULT_CODE.FORBIDDEN,
        message: 'Passkey enrollment is not permitted',
      }
    }
    if (!this.isAllowedOrigin(input.origin, input.rpId)) {
      return {
        ok: false,
        code: PASSKEY_RESULT_CODE.PHISHING_RESISTANCE_FAILED,
        message: 'Passkey origin is not permitted',
      }
    }
    const challenge = this.dependencies.challenges.next()
    const now = this.dependencies.now()
    const ceremony: PasskeyCeremony = {
      id: this.dependencies.ids.next(),
      accountId: input.subject.accountId,
      challenge,
      rpId: input.rpId,
      origin: input.origin,
      expiresAt: now + CEREMONY_TTL_MS,
      consumedAt: null,
    }
    await this.dependencies.store.saveCeremony(ceremony)
    return {
      ok: true,
      ceremonyId: ceremony.id,
      challenge,
      options: {
        challenge,
        rp: { id: input.rpId, name: 'Neutral Product Factory' },
        userVerification: 'required',
        attestation: 'none',
      },
    }
  }

  async finishRegistration(input: {
    subject: PasskeySubject['subject'] | undefined
    ceremonyId: string
    response: WebAuthnRegistrationResponse
  }): Promise<PasskeyRegistrationResult> {
    const ceremony = await this.dependencies.store.findCeremony(input.ceremonyId)
    if (
      !ceremony ||
      !input.subject ||
      input.subject.accountId !== ceremony.accountId ||
      !input.subject.sessionId
    ) {
      return {
        ok: false,
        code: PASSKEY_RESULT_CODE.FORBIDDEN,
        message: 'Passkey enrollment is not permitted',
      }
    }
    const now = this.dependencies.now()
    if (ceremony.consumedAt !== null)
      return {
        ok: false,
        code: PASSKEY_RESULT_CODE.REPLAYED,
        message: 'Passkey ceremony was already used',
      }
    if (ceremony.expiresAt <= now)
      return { ok: false, code: PASSKEY_RESULT_CODE.EXPIRED, message: 'Passkey ceremony expired' }
    if (
      input.response.challenge !== ceremony.challenge ||
      input.response.origin !== ceremony.origin ||
      input.response.rpId !== ceremony.rpId ||
      input.response.type !== 'webauthn.create' ||
      !input.response.userVerification
    ) {
      return {
        ok: false,
        code: PASSKEY_RESULT_CODE.PHISHING_RESISTANCE_FAILED,
        message: 'Passkey ceremony checks failed',
      }
    }
    const verification = await this.dependencies.verifier.verifyRegistration(input.response, {
      challenge: ceremony.challenge,
      origin: ceremony.origin,
      rpId: ceremony.rpId,
      type: 'webauthn.create',
    })
    if (!verification)
      return {
        ok: false,
        code: PASSKEY_RESULT_CODE.PHISHING_RESISTANCE_FAILED,
        message: 'Passkey proof was not verified',
      }
    ceremony.consumedAt = now
    await this.dependencies.store.saveCeremony(ceremony)
    await this.dependencies.store.saveCredential({
      id: this.dependencies.ids.next(),
      accountId: ceremony.accountId,
      credentialId: verification.credentialId,
      publicKey: verification.publicKey,
      signCount: verification.signCount,
      createdAt: now,
    })
    return { ok: true, credentialId: verification.credentialId }
  }

  private isAllowedOrigin(origin: string, rpId: string): boolean {
    try {
      const url = new URL(origin)
      return (
        url.protocol === 'https:' && (url.hostname === rpId || url.hostname.endsWith(`.${rpId}`))
      )
    } catch {
      return false
    }
  }
}
