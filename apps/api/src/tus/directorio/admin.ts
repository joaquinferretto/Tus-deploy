import { randomUUID } from 'node:crypto'
import type { IdentityStore } from '../../auth-security/ports/identity-store.ts'
import type { TusApplicationService } from '../application/tus-application-service.ts'
import type { PerfilPrestador } from '../catalog/index.ts'
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
    const verified = Boolean(account?.emailVerifiedAt || account?.phoneVerifiedAt)
    const managed = account && !verified ? !(await deps.accounts.findPasswordCredential(account.id)) : false
    if (!account || account.status !== 'active' || (!verified && !managed)) return { status: 409, code: 'VERIFIED_ACCOUNT_REQUIRED' }
    const marketplace = deps.application.marketplace
    if (!marketplace) return { status: 503, code: 'UNAVAILABLE' }
    // Directory registration needs the prestador row for its FK, but is not commercial onboarding:
    // creating a listing or publishing one still calls marketplace.onboard/readiness separately.
    const prestador = await marketplace.store.transaction(async (store) => {
      const existing = await store.merchant.find(account.tenantId)
      if (existing) {
        // An administrator registering THIS account as the provider is an explicit decision: an
        // old provider row with no account gets it. A row already linked is never re-pointed here.
        if (existing.accountId === null) {
          const vinculado = { ...existing, accountId: account.id, updatedAt: new Date().toISOString() }
          await store.merchant.save(vinculado)
          return vinculado
        }
        return existing
      }
      const now = new Date().toISOString()
      const profile: PerfilPrestador = {
        tenantId: account.tenantId,
        merchantId: randomUUID(),
        cohort: 'repairs-trades',
        locationId: randomUUID(),
        timezone: 'America/Argentina/Buenos_Aires',
        staffRoles: ['owner'],
        operatingPolicyVersion: 'admin-manual-v1',
        status: 'approved',
        accountId: account.id,
        createdAt: now,
        updatedAt: now,
      }
      await store.merchant.save(profile)
      return profile
    })
    if (prestador.status !== 'approved') return { status: 409, code: 'PROVIDER_NOT_APPROVED' }
    // The target tenant is resolved from the verified account, never from input.
    const target = { ...admin, tenantId: account.tenantId, roles: ['owner'], permissions: ['tus:marketplace:write'] }
    const result = await deps.directorio.guardarPerfil(target, body)
    if (!result.ok) return { status: 422, code: result.code }
    await marketplace.store.audit.append([{
      auditId: randomUUID(), tenantId: account.tenantId, actorId: admin.subjectId,
      correlationId: admin.correlationId, action: 'provider.profile.admin_saved',
      resourceType: 'merchant', resourceId: prestador.merchantId, outcome: 'allowed',
      createdAt: new Date().toISOString(),
    }])
    return { status: 200, profile: result.perfil }
  }
}

// Admin edition of an existing provider (FASE directorio): every business field of the public
// profile, the services (N:M), coverage and the provider approval. Never the tenant, the internal
// ids or anything of the account's credentials (the account has its own safe operations).
export const CAMPOS_PERFIL_ADMIN = ['displayName', 'profession', 'professions', 'zone', 'serviceZones', 'serviceMode', 'coverageRadiusKm', 'description', 'yearsOfExperience', 'visible'] as const
export const ESTADOS_PRESTADOR_ADMIN = ['approved', 'suspended'] as const

export function crearEdicionPrestadorAdmin(deps: { application: TusApplicationService; directorio: ServicioDirectorio }) {
  const vista = (perfil: NonNullable<Awaited<ReturnType<ServicioDirectorio['perfilParaAdmin']>>>) => ({
    id: perfil.id,
    displayName: perfil.nombrePublico,
    profession: perfil.oficio,
    professions: [...perfil.oficios],
    zone: perfil.zona,
    serviceZones: [...perfil.zonasCobertura],
    serviceMode: perfil.modalidadAtencion,
    coverageRadiusKm: perfil.radioCoberturaKm,
    description: perfil.descripcion,
    yearsOfExperience: perfil.aniosExperiencia,
    visible: perfil.visible,
    createdAt: new Date(perfil.creadoEn).toISOString(),
    updatedAt: new Date(perfil.actualizadoEn).toISOString(),
  })

  return {
    async leer(id: string) {
      const perfil = await deps.directorio.perfilParaAdmin(id)
      if (!perfil) return null
      const merchant = await deps.application.marketplace?.store.merchant.find(perfil.tenantId)
      return { perfil: vista(perfil), tenantId: perfil.tenantId, prestador: merchant ? { estado: merchant.status as string, aprobado: merchant.status === 'approved' } : null }
    },

    async guardar(admin: TusAuthenticatedTenantContext, id: string, body: Record<string, unknown>) {
      if (!admin.permissions.includes('tus:providers:admin')) return { status: 403, code: 'FORBIDDEN' }
      const permitidos = new Set<string>([...CAMPOS_PERFIL_ADMIN, 'providerStatus'])
      if (Object.keys(body).some((key) => !permitidos.has(key))) return { status: 422, code: 'INVALID_PROFILE' }
      const estado = body['providerStatus']
      if (estado !== undefined && !ESTADOS_PRESTADOR_ADMIN.includes(estado as (typeof ESTADOS_PRESTADOR_ADMIN)[number])) return { status: 422, code: 'INVALID_PROVIDER_STATUS' }
      const perfil = await deps.directorio.perfilParaAdmin(id)
      if (!perfil) return { status: 404, code: 'NOT_FOUND' }
      const marketplace = deps.application.marketplace
      if (!marketplace) return { status: 503, code: 'UNAVAILABLE' }
      // Unchanged fields keep their stored value: the admin form may send only what changed.
      const actual = vista(perfil)
      const entrada: Record<string, unknown> = { ...actual, ...Object.fromEntries(CAMPOS_PERFIL_ADMIN.filter((key) => key in body).map((key) => [key, body[key]])) }
      if ('professions' in body && !('profession' in body)) entrada['profession'] = Array.isArray(body['professions']) ? body['professions'][0] : undefined
      delete entrada['id']; delete entrada['createdAt']; delete entrada['updatedAt']
      const resultado = await deps.directorio.guardarPerfilAdmin(id, entrada)
      if (!resultado.ok) return { status: resultado.code === 'NOT_FOUND' ? 404 : 422, code: resultado.code, ...('fields' in resultado ? { fields: resultado.fields } : {}) }
      const auditorias: Parameters<typeof marketplace.store.audit.append>[0][number][] = []
      const now = new Date().toISOString()
      const merchant = await marketplace.store.merchant.find(perfil.tenantId)
      if (estado !== undefined && merchant && merchant.status !== estado) {
        await marketplace.store.merchant.save({ ...merchant, status: estado as typeof merchant.status, updatedAt: now })
        auditorias.push({ auditId: randomUUID(), tenantId: perfil.tenantId, actorId: admin.subjectId, correlationId: admin.correlationId, action: estado === 'approved' ? 'provider.admin_approved' : 'provider.admin_suspended', resourceType: 'merchant', resourceId: merchant.merchantId, outcome: 'allowed', createdAt: now })
      }
      auditorias.push({ auditId: randomUUID(), tenantId: perfil.tenantId, actorId: admin.subjectId, correlationId: admin.correlationId, action: 'provider.profile.admin_updated', resourceType: 'merchant', resourceId: merchant?.merchantId ?? perfil.prestadorId, outcome: 'allowed', createdAt: now })
      await marketplace.store.audit.append(auditorias)
      return { status: 200, ...(await this.leer(id)) }
    },
  }
}
