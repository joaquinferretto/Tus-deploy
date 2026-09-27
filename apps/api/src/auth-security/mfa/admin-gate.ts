import { PLATFORM_ADMIN_PERMISSIONS } from '../application/auth-service.js'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../../tus/ports/index.ts'
import type { AuthenticatedSubject } from './domain.js'

export interface MfaElevationCheck {
  isElevated(subject: AuthenticatedSubject): Promise<boolean>
}

const ADMIN_PERMISSIONS: readonly string[] = PLATFORM_ADMIN_PERMISSIONS

export function hasPlatformAdminPermission(context: Pick<TusAuthenticatedTenantContext, 'permissions'>): boolean {
  return context.permissions.some((permission) => ADMIN_PERMISSIONS.includes(permission))
}

// Platform administration requires the second factor, enforced on the backend for EVERY request:
// the session scope may carry the admin permissions (minted at sign-in for an allowlisted verified
// email), but they are honored only while THIS session has a live MFA elevation. Otherwise they
// are removed from the resolved context, so every admin check in the API sees a regular session.
// Sessions created before MFA existed have no elevation and lose admin access. Without the MFA
// service configured (no TUS_MFA_ENCRYPTION_KEY) nobody is admin: fail closed.
export class MfaAdminSessionResolver implements TusSessionResolverPort {
  constructor(
    private readonly inner: TusSessionResolverPort,
    private readonly mfa: MfaElevationCheck | null
  ) {}

  async resolve(accessToken: string, correlationId: string): Promise<TusAuthenticatedTenantContext | null> {
    const context = await this.inner.resolve(accessToken, correlationId)
    if (!context || !hasPlatformAdminPermission(context)) return context
    if (this.mfa && (await this.mfa.isElevated({ accountId: context.subjectId, sessionId: context.sessionId }))) return context
    return { ...context, permissions: context.permissions.filter((permission) => !ADMIN_PERMISSIONS.includes(permission)) }
  }
}
