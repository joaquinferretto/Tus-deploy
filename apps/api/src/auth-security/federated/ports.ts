import type { FederatedIdentity, LoginCode } from './domain.js'

export interface FederatedIdentityStore {
  find(providerId: string, issuer: string, subject: string): Promise<FederatedIdentity | undefined>
  // Throws a unique violation (code P2002) if the identity is already linked.
  save(identity: FederatedIdentity): Promise<void>
  listForAccount(accountId: string): Promise<FederatedIdentity[]>
}

export interface LoginCodeStore {
  save(code: LoginCode): Promise<void>
  // Read without consuming (previews); expired or used codes return undefined.
  peek(codeHash: string, now: number): Promise<LoginCode | undefined>
  // Atomic single use: only one caller can consume a code.
  consume(codeHash: string, now: number): Promise<LoginCode | undefined>
}
