import { PLATFORM_ADMIN_PERMISSIONS } from '../application/auth-service.js'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../../tus/ports/index.ts'
import type { AuthenticatedSubject } from './domain.js'

export interface MfaElevationCheck {
  isElevated(subject: AuthenticatedSubject): Promise<boolean>
}

export interface AdminAccountLookup {
  getAccount(accountId: string): Promise<{ email: string; normalizedEmail?: string; emailVerifiedAt: number | null; status: string } | undefined>
}

const ADMIN_PERMISSIONS: readonly string[] = PLATFORM_ADMIN_PERMISSIONS

export function hasPlatformAdminPermission(context: Pick<TusAuthenticatedTenantContext, 'permissions'>): boolean {
  return context.permissions.some((permission) => ADMIN_PERMISSIONS.includes(permission))
}

// Platform administration is decided on the backend for EVERY request. The session scope may
// carry the admin permissions (minted only at an email + password sign-in of an allowlisted
// verified email), but they are honored only while, right now:
//  1. the account email is still verified and still in TUS_PLATFORM_ADMIN_EMAILS (read live:
//     removing an email, or changing the account email, ends admin access on the next request,
//     even for old sessions), and
//  2. THIS session passed the second factor (live MFA elevation).
// Otherwise they are removed from the resolved context, so every admin check sees a regular
// session. Without the MFA service configured (no TUS_MFA_ENCRYPTION_KEY) nobody is admin.
export class MfaAdminSessionResolver implements TusSessionResolverPort {
  constructor(
    private readonly inner: TusSessionResolverPort,
    private readonly mfa: MfaElevationCheck | null,
    private readonly accounts?: AdminAccountLookup,
    private readonly adminEmails?: () => readonly string[]
  ) {}

  async resolve(accessToken: string, correlationId: string): Promise<TusAuthenticatedTenantContext | null> {
    const context = await this.inner.resolve(accessToken, correlationId)
    if (!context || !hasPlatformAdminPermission(context)) return context
    if ((await this.stillAllowlisted(context.subjectId)) && this.mfa && (await this.mfa.isElevated({ accountId: context.subjectId, sessionId: context.sessionId })))
      return context
    return { ...context, permissions: context.permissions.filter((permission) => !ADMIN_PERMISSIONS.includes(permission)) }
  }

  // Admin candidate NOW (allowlist and verified email), independent of MFA. Used by the MFA routes.
  async isAdminCandidate(context: TusAuthenticatedTenantContext): Promise<boolean> {
    return hasPlatformAdminPermission(context) && (await this.stillAllowlisted(context.subjectId))
  }

  private async stillAllowlisted(accountId: string): Promise<boolean> {
    if (!this.accounts || !this.adminEmails) return true
    const account = await this.accounts.getAccount(accountId)
    if (!account || account.status !== 'active' || !account.emailVerifiedAt) return false
    return this.adminEmails().includes((account.normalizedEmail ?? account.email).trim().toLowerCase())
  }
}
