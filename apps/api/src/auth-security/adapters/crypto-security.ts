import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as nodeScrypt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import type { IdGenerator, PasswordHasher, TokenIssuer } from '../ports/security.js'

const scrypt = promisify(nodeScrypt)
const DUMMY_SALT = 'neutral-auth-dummy-salt'
const DUMMY_HASH = `scrypt$${DUMMY_SALT}$${scryptSync('neutral-auth-dummy-password', DUMMY_SALT, 64).toString('hex')}`

export class ScryptPasswordHasher implements PasswordHasher {
  readonly dummyHash = DUMMY_HASH

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex')
    const derived = (await scrypt(password, salt, 64)) as Buffer
    return `scrypt$${salt}$${derived.toString('hex')}`
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const [algorithm, salt, encodedDerived] = encodedHash.split('$')
    if (
      algorithm !== 'scrypt' ||
      !salt ||
      !encodedDerived ||
      !/^[0-9a-f]+$/i.test(encodedDerived)
    ) {
      return false
    }

    const expected = Buffer.from(encodedDerived, 'hex')
    const actual = (await scrypt(password, salt, expected.length)) as Buffer
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }
}

export class OpaqueTokenIssuer implements TokenIssuer {
  issue(): string {
    return randomBytes(32).toString('base64url')
  }

  digest(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}

export class RandomIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID()
  }
}
