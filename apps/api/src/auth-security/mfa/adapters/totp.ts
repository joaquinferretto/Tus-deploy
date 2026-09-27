import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { MfaCodeVerifier, MfaRecoveryCodeGenerator, MfaSecretGenerator } from '../ports.js'

// RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s): the parameters every authenticator app supports
// (Google Authenticator, Microsoft Authenticator, 1Password, Authy...).
const STEP_MS = 30_000
const DIGITS = 6
// One step of clock drift on each side.
const WINDOW = 1
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31]
  return output
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/gu, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index < 0) throw new Error('invalid base32 secret')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1]! & 15
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS
  return String(binary).padStart(DIGITS, '0')
}

export class TotpCodeVerifier implements MfaCodeVerifier {
  async verify(secret: string, code: string, now: number): Promise<boolean> {
    return (await this.matchStep(secret, code, now)) !== null
  }

  async matchStep(secret: string, code: string, now: number): Promise<number | null> {
    const candidate = code.replace(/\s/gu, '')
    if (!/^\d{6}$/u.test(candidate)) return null
    const current = Math.floor(now / STEP_MS)
    let matched: number | null = null
    // Every window step is evaluated (constant work) and compared in constant time.
    for (let step = current - WINDOW; step <= current + WINDOW; step += 1) {
      if (timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(candidate)) && matched === null) matched = step
    }
    return matched
  }
}

// 160-bit secret (RFC 4226 recommendation), base32 as authenticator apps expect.
export class TotpSecretGenerator implements MfaSecretGenerator {
  next(): string {
    return base32Encode(randomBytes(20))
  }
}

// XXXX-XXXX-XXXX (60 bits of entropy); only its hash is stored.
export class RandomRecoveryCodeGenerator implements MfaRecoveryCodeGenerator {
  next(): string {
    const text = base32Encode(randomBytes(8)).slice(0, 12)
    return `${text.slice(0, 4)}-${text.slice(4, 8)}-${text.slice(8, 12)}`
  }
}

// Recovery codes are compared case- and separator-insensitively.
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/gu, '').toUpperCase()
}

export function otpauthUri(input: { issuer: string; accountName: string; secret: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`
  const params = new URLSearchParams({ secret: input.secret, issuer: input.issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_MS / 1000) })
  return `otpauth://totp/${label}?${params.toString()}`
}
