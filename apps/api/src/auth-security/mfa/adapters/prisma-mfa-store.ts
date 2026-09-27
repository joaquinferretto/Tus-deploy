import { BovedaCredencialesAesGcm } from '../../../tus/finance/servicios/cuentas-cobro.ts'
import type {
  MfaChallenge,
  MfaElevationMethod,
  MfaEnrollment,
  MfaEnrollmentStatus,
  MfaRecoveryCode,
  MfaSessionElevation,
} from '../domain.js'
import type { MfaStore } from '../ports.js'

// Durable MFA store (tables mfa_*, migration 20261005100000_tus_admin_mfa). The TOTP secret only
// reaches the database as an AES-256-GCM envelope bound (AAD) to the enrollment and account, so a
// copied row cannot be decrypted for another account. Recovery codes and challenges are digests.

interface Delegate<Row> {
  findUnique(args: { where: Record<string, unknown> }): Promise<Row | null>
  findFirst(args: { where: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'> }): Promise<Row | null>
  upsert(args: { where: Record<string, unknown>; create: Row; update: Partial<Row> }): Promise<unknown>
  updateMany(args: { where: Record<string, unknown>; data: Partial<Row> }): Promise<unknown>
}

interface EnrollmentRow {
  id: string
  accountId: string
  label: string
  secretCiphertext: string
  status: string
  lastUsedStep: bigint | null
  createdAt: Date
  confirmedAt: Date | null
  disabledAt: Date | null
}

interface RecoveryCodeRow {
  id: string
  accountId: string
  enrollmentId: string
  codeDigest: string
  consumedAt: Date | null
  invalidatedAt: Date | null
  createdAt: Date
}

interface ChallengeRow {
  id: string
  accountId: string
  enrollmentId: string
  tokenDigest: string
  expiresAt: Date
  consumedAt: Date | null
}

interface ElevationRow {
  sessionId: string
  accountId: string
  method: string
  verifiedAt: Date
  expiresAt: Date
  revokedAt: Date | null
}

export interface PrismaMfaClient {
  mfaEnrollment: Delegate<EnrollmentRow>
  mfaRecoveryCode: Delegate<RecoveryCodeRow>
  mfaChallenge: Delegate<ChallengeRow>
  mfaSessionElevation: Delegate<ElevationRow>
}

export interface MfaSecretCipher {
  seal(secret: string, aad: string): string
  open(envelope: string, aad: string): string
}

// TUS_MFA_ENCRYPTION_KEY: 32 random bytes in base64. Its own key (not shared with payments or
// identity documents). Without it MFA is unavailable and platform administration stays closed.
export function createMfaSecretCipher(keyBase64: string | undefined): MfaSecretCipher | null {
  const key = (keyBase64 ?? '').trim()
  if (!key || Buffer.from(key, 'base64').length !== 32) return null
  const vault = new BovedaCredencialesAesGcm(key, 'v1')
  return { seal: (secret, aad) => vault.cifrar(secret, aad), open: (envelope, aad) => vault.descifrar(envelope, aad) }
}

const date = (value: number | null | undefined) => (value == null ? null : new Date(value))
const time = (value: Date | null) => (value ? value.getTime() : null)
const aadOf = (enrollment: { id: string; accountId: string }) => `tus-mfa:${enrollment.id}:${enrollment.accountId}`

export class PrismaMfaStore implements MfaStore {
  constructor(
    private readonly client: PrismaMfaClient,
    private readonly cipher: MfaSecretCipher
  ) {}

  async saveEnrollment(enrollment: MfaEnrollment): Promise<void> {
    const mutable = {
      status: enrollment.status,
      lastUsedStep: enrollment.lastUsedStep == null ? null : BigInt(enrollment.lastUsedStep),
      confirmedAt: date(enrollment.confirmedAt),
      disabledAt: date(enrollment.disabledAt),
    }
    await this.client.mfaEnrollment.upsert({
      where: { id: enrollment.id },
      create: {
        id: enrollment.id,
        accountId: enrollment.accountId,
        label: enrollment.label,
        secretCiphertext: this.cipher.seal(enrollment.secret, aadOf(enrollment)),
        createdAt: new Date(enrollment.createdAt),
        ...mutable,
      },
      // The secret never changes after creation: updates never rewrite it.
      update: mutable,
    })
  }

  async findEnrollment(enrollmentId: string): Promise<MfaEnrollment | undefined> {
    return this.toEnrollment(await this.client.mfaEnrollment.findUnique({ where: { id: enrollmentId } }))
  }

  async findEnrollmentForAccount(accountId: string, status: MfaEnrollmentStatus): Promise<MfaEnrollment | undefined> {
    return this.toEnrollment(await this.client.mfaEnrollment.findFirst({ where: { accountId, status }, orderBy: { createdAt: 'desc' } }))
  }

  async saveChallenge(challenge: MfaChallenge): Promise<void> {
    await this.client.mfaChallenge.upsert({
      where: { id: challenge.id },
      create: { ...challenge, expiresAt: new Date(challenge.expiresAt), consumedAt: date(challenge.consumedAt) },
      update: { consumedAt: date(challenge.consumedAt) },
    })
  }

  async findChallenge(tokenDigest: string): Promise<MfaChallenge | undefined> {
    const row = await this.client.mfaChallenge.findUnique({ where: { tokenDigest } })
    return row ? { ...row, expiresAt: row.expiresAt.getTime(), consumedAt: time(row.consumedAt) } : undefined
  }

  async saveRecoveryCode(code: MfaRecoveryCode): Promise<void> {
    if (!code.enrollmentId) throw new Error('recovery code requires its enrollment')
    await this.client.mfaRecoveryCode.upsert({
      where: { id: code.id },
      create: {
        id: code.id,
        accountId: code.accountId,
        enrollmentId: code.enrollmentId,
        codeDigest: code.codeDigest,
        consumedAt: date(code.consumedAt),
        invalidatedAt: date(code.invalidatedAt),
        createdAt: new Date(),
      },
      update: { consumedAt: date(code.consumedAt), invalidatedAt: date(code.invalidatedAt) },
    })
  }

  async findRecoveryCode(codeDigest: string): Promise<MfaRecoveryCode | undefined> {
    const row = await this.client.mfaRecoveryCode.findUnique({ where: { codeDigest } })
    return row
      ? { id: row.id, accountId: row.accountId, enrollmentId: row.enrollmentId, codeDigest: row.codeDigest, consumedAt: time(row.consumedAt), invalidatedAt: time(row.invalidatedAt) }
      : undefined
  }

  async invalidateRecoveryCodes(accountId: string, at: number): Promise<void> {
    await this.client.mfaRecoveryCode.updateMany({ where: { accountId, invalidatedAt: null }, data: { invalidatedAt: new Date(at) } })
  }

  async saveElevation(elevation: MfaSessionElevation): Promise<void> {
    const data = {
      accountId: elevation.accountId,
      method: elevation.method,
      verifiedAt: new Date(elevation.verifiedAt),
      expiresAt: new Date(elevation.expiresAt),
      revokedAt: date(elevation.revokedAt),
    }
    await this.client.mfaSessionElevation.upsert({ where: { sessionId: elevation.sessionId }, create: { sessionId: elevation.sessionId, ...data }, update: data })
  }

  async findElevation(sessionId: string): Promise<MfaSessionElevation | undefined> {
    const row = await this.client.mfaSessionElevation.findUnique({ where: { sessionId } })
    return row
      ? {
          sessionId: row.sessionId,
          accountId: row.accountId,
          method: row.method as MfaElevationMethod,
          verifiedAt: row.verifiedAt.getTime(),
          expiresAt: row.expiresAt.getTime(),
          revokedAt: time(row.revokedAt),
        }
      : undefined
  }

  async revokeElevations(accountId: string, at: number): Promise<void> {
    await this.client.mfaSessionElevation.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: new Date(at) } })
  }

  private toEnrollment(row: EnrollmentRow | null): MfaEnrollment | undefined {
    if (!row) return undefined
    return {
      id: row.id,
      accountId: row.accountId,
      label: row.label,
      secret: this.cipher.open(row.secretCiphertext, aadOf(row)),
      status: row.status as MfaEnrollmentStatus,
      createdAt: row.createdAt.getTime(),
      confirmedAt: time(row.confirmedAt),
      lastUsedStep: row.lastUsedStep == null ? null : Number(row.lastUsedStep),
      disabledAt: time(row.disabledAt),
    }
  }
}
