import { createHash } from 'node:crypto'
import type { PasswordBreachChecker } from '../ports/security.js'

// Have I Been Pwned "Pwned Passwords" with k-anonymity: only the first 5 hex characters of the
// SHA-1 of the password leave the server; the comparison of the suffix happens here. Responses
// are padded (Add-Padding) so their size does not reveal the prefix. If the service is slow or
// down the check is skipped (fail open): availability of sign-up does not depend on a third party.
export class PwnedPasswordsChecker implements PasswordBreachChecker {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 2000
  ) {}

  async isBreached(password: string): Promise<boolean> {
    const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)
    try {
      const response = await this.fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'user-agent': 'TUS-auth' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!response.ok) return false
      const body = await response.text()
      return body.split('\n').some((line) => {
        const [candidate, count] = line.trim().split(':')
        return candidate === suffix && Number(count) > 0
      })
    } catch {
      return false
    }
  }
}
