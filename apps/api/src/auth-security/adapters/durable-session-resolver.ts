import { createHash } from 'node:crypto'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../../tus/ports/index.ts'
import type { IdentityStore } from '../ports/identity-store.js'

export class DurableIdentitySessionResolver implements TusSessionResolverPort {
  private readonly store: IdentityStore
  private readonly now: () => number

  constructor(
    store: IdentityStore,
    now: () => number = () => Date.now(),
    // ADMIN-CONTRASENA-TEMPORAL-01. 'bloquear' (every router of TUS): an account that must choose
    // its password resolves to NOTHING, so it reaches no data until it does. 'solo-pendientes' (the
    // authentication router only): resolves ONLY such an account, with no role and no permission,
    // so it can choose its password, read its session and sign out, and nothing else.
    private readonly cambioPendiente: 'bloquear' | 'solo-pendientes' = 'bloquear'
  ) {
    this.store = store
    this.now = now
  }

  async resolve(
    accessToken: string,
    correlationId: string
  ): Promise<TusAuthenticatedTenantContext | null> {
    const normalizedToken = accessToken.trim()
    const normalizedCorrelationId = correlationId.trim()
    if (!normalizedToken || !normalizedCorrelationId) return null

    const digest = createHash('sha256').update(normalizedToken).digest('hex')
    const session = await this.store.findSessionByAccessTokenDigest(digest)
    if (!session || session.revokedAt !== null || session.expiresAt <= this.now()) return null

    const account = await this.store.getAccount(session.accountId)
    if (!account || account.status !== 'active' || account.tenantId !== session.tenantId) return null
    if (!await this.store.hasActiveMembership(account.id, session.tenantId)) return null
    const pendiente = account.mustChangePassword === true
    if (this.cambioPendiente === 'solo-pendientes')
      return pendiente ? { subjectId: account.id, sessionId: session.id, tenantId: session.tenantId, roles: [], permissions: [], correlationId: normalizedCorrelationId, passwordChangeRequired: true } : null
    if (pendiente) return null

    return {
      subjectId: account.id,
      sessionId: session.id,
      tenantId: session.tenantId,
      roles: [...session.scope.roles],
      permissions: [...session.scope.permissions],
      correlationId: normalizedCorrelationId,
    }
  }
}

export default { DurableIdentitySessionResolver }
