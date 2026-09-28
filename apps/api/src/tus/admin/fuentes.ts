import type { IdentityStore } from '../../auth-security/ports/identity-store.ts'
import type { CuentaAdmin, EventoActividad, FuenteActividadAdmin, FuenteCuentasAdmin } from './http.ts'

// Accounts for the admin panel, read from the existing identity tables (Account + User +
// PasswordCredential). Never the password hash, tokens or sessions.

type Fila = Record<string, unknown>

interface ClienteCuentas {
  account: {
    findMany(input: { where?: Fila; include?: Fila; orderBy?: Fila; take?: number }): Promise<Fila[]>
    count(input?: { where?: Fila }): Promise<number>
  }
}

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === 'number' ? new Date(value).toISOString() : '')

export class CuentasAdminPrisma implements FuenteCuentasAdmin {
  constructor(private readonly client: ClienteCuentas) {}

  async listar(input: { q: string; limite: number }): Promise<CuentaAdmin[]> {
    const q = input.q
    const filas = await this.client.account.findMany({
      ...(q ? { where: { user: { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } } } : {}),
      include: { user: true, credentials: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
      take: input.limite,
    })
    return filas.map((fila) => {
      const user = (fila['user'] ?? {}) as Fila
      const credentials = (fila['credentials'] ?? []) as Fila[]
      return {
        id: String(fila['id']),
        tenantId: String(fila['tenantId']),
        nombre: String(user['displayName'] ?? ''),
        email: String(user['email'] ?? ''),
        estado: String(fila['status'] ?? ''),
        verificado: fila['emailVerifiedAt'] != null,
        conContrasena: credentials.some((credential) => credential['status'] === 'active'),
        creadaEn: iso(fila['createdAt']),
      }
    })
  }

  async contar(): Promise<number> {
    return this.client.account.count()
  }
}

// In memory (tests / local): the same fields from the in-memory identity store.
export class CuentasAdminEnMemoria implements FuenteCuentasAdmin {
  constructor(private readonly store: IdentityStore) {}

  async listar(input: { q: string; limite: number }): Promise<CuentaAdmin[]> {
    const q = input.q.toLowerCase()
    const cuentas = [...(this.store.accounts?.values() ?? [])]
      .filter((cuenta) => !q || cuenta.normalizedEmail.includes(q) || cuenta.displayName.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, input.limite)
    return Promise.all(cuentas.map(async (cuenta) => ({
      id: cuenta.id,
      tenantId: cuenta.tenantId,
      nombre: cuenta.displayName,
      email: cuenta.email,
      estado: cuenta.status,
      verificado: cuenta.emailVerifiedAt !== null,
      conContrasena: (await this.store.findPasswordCredential(cuenta.id))?.status === 'active',
      creadaEn: new Date(cuenta.createdAt).toISOString(),
    })))
  }

  async contar(): Promise<number> {
    return this.store.accounts?.size ?? 0
  }
}

// Recent security events (AuditEvent): kind, outcome and date only — never metadata, emails or ids.
const TIPOS = new Set([
  'auth.signed_in', 'auth.failed', 'account.registered', 'account.verified', 'recovery.completed', 'credential.password_changed',
  'session.revoked', 'session.rotated', 'email.delivery_failed', 'mfa.enrollment_confirmed', 'mfa.challenge_verified',
  'mfa.recovery_used', 'mfa.recovery_codes_regenerated', 'mfa.disabled', 'mfa.operation_denied',
])

interface ClienteAuditoria {
  auditEvent?: { findMany(input: { where: Fila; orderBy: Fila; take: number }): Promise<Fila[]> }
}

export class ActividadAdminPrisma implements FuenteActividadAdmin {
  constructor(private readonly client: ClienteAuditoria) {}

  async recientes(limite: number): Promise<EventoActividad[]> {
    if (!this.client.auditEvent) return []
    const filas = await this.client.auditEvent.findMany({ where: { eventType: { in: [...TIPOS] } }, orderBy: { occurredAt: 'desc' }, take: limite })
    return filas.map((fila) => ({ tipo: String(fila['eventType']), resultado: String(fila['outcome']), fecha: iso(fila['occurredAt']) }))
  }
}
