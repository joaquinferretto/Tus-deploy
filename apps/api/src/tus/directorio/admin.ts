import { randomUUID } from 'node:crypto'
import type { IdentityStore } from '../../auth-security/ports/identity-store.ts'
import type { TusApplicationService } from '../application/tus-application-service.ts'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import { validarPerfil } from './modelo.ts'
import type { ServicioDirectorio } from './servicio.ts'

export function crearAltaPrestadorAdmin(deps: {
  accounts: IdentityStore
  application: TusApplicationService
  directorio: ServicioDirectorio
  // Creates a password-less, unverified account that only owns the directory profile.
  createManagedAccount?: (input: { email: string; displayName: string }) => Promise<{ ok: true; accountId: string } | { ok: false; code: string }>
}) {
  return async (admin: TusAuthenticatedTenantContext, body: Record<string, unknown>) => {
    if (!admin.permissions.includes('tus:providers:admin')) return { status: 403, code: 'FORBIDDEN' }
    const allowed = new Set(['email', 'displayName', 'profession', 'zone', 'serviceZones', 'serviceMode', 'coverageRadiusKm', 'description', 'yearsOfExperience', 'visible'])
    if (Object.keys(body).some(key => !allowed.has(key))) return { status: 422, code: 'INVALID_PROFILE' }
    const validation = validarPerfil(body)
    if (!validation.ok) return { status: 422, code: 'INVALID_PROFILE', fields: validation.campos }
    const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : ''
    if (!email || email.length > 254) return { status: 422, code: 'INVALID_EMAIL' }
    let account = await deps.accounts.findAccountByEmail(email)
    // New email: the admin creates a managed provider (no password, nobody can sign in with it).
    if (!account && deps.createManagedAccount) {
      const created = await deps.createManagedAccount({ email, displayName: String(body['displayName'] ?? '') })
      if (!created.ok) return { status: 409, code: created.code }
      account = await deps.accounts.getAccount(created.accountId)
    }
    // An existing account must be verified, unless it is a managed one (no password credential):
    // an admin never takes over somebody else's pending sign-up.
    const managed = account && !account.emailVerifiedAt ? !(await deps.accounts.findPasswordCredential(account.id)) : false
    if (!account || account.status !== 'active' || (!account.emailVerifiedAt && !managed)) return { status: 409, code: 'VERIFIED_ACCOUNT_REQUIRED' }
    const marketplace = deps.application.marketplace
    if (!marketplace) return { status: 503, code: 'UNAVAILABLE' }
    // The admin is the audit actor; the target tenant is resolved from the account, never from input.
    const target = { ...admin, tenantId: account.tenantId, roles: ['owner'], permissions: ['tus:marketplace:write'] }
    const existing = await marketplace.store.merchant.find(account.tenantId)
    if (existing && existing.status !== 'approved') return { status: 409, code: 'PROVIDER_NOT_APPROVED' }
    if (!existing) await marketplace.onboard(target, {
      merchantId: randomUUID(), locationId: randomUUID(), cohort: 'repairs-trades',
      timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'],
      operatingPolicyVersion: 'admin-manual-v1',
    })
    const result = await deps.directorio.guardarPerfil(target, body)
    if (!result.ok) return { status: 422, code: result.code }
    await marketplace.store.audit.append([{
      auditId: randomUUID(), tenantId: account.tenantId, actorId: admin.subjectId,
      correlationId: admin.correlationId, action: 'provider.profile.admin_saved',
      resourceType: 'merchant', resourceId: result.perfil.id, outcome: 'allowed',
      createdAt: new Date().toISOString(),
    }])
    return { status: 200, profile: result.perfil }
  }
}
