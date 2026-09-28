import type { IdentityStore } from '../../auth-security/ports/identity-store.ts'
import type { CuentaAdmin, EventoActividad, FuenteActividadAdmin, FuenteCuentasAdmin } from './http.ts'

// Accounts for the admin panel, read from the existing identity tables (Account + User +
// PasswordCredential). Never the password hash, tokens or sessions.

type Fila = Record<string, unknown>

interface ClienteCuentas {
  account: {
    findMany(input: { where?: Fila; include?: Fila; orderBy?: Fila | Fila[]; skip?: number; take?: number }): Promise<Fila[]>
    count(input?: { where?: Fila }): Promise<number>
  }
}

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === 'number' ? new Date(value).toISOString() : '')

export class CuentasAdminPrisma implements FuenteCuentasAdmin {
  constructor(private readonly client: ClienteCuentas) {}

  async listar(input: { q: string; pagina: number; tamano: number; estado: string; rol: string; adminEmails: readonly string[]; prestadorTenants: readonly string[] }): Promise<{ items: CuentaAdmin[]; total: number }> {
    const q = input.q
    const rolWhere = input.rol === 'admin' ? { user: { email: { in: [...input.adminEmails] } } }
      : input.rol === 'prestador' ? { tenantId: { in: [...input.prestadorTenants] } }
        : input.rol === 'cliente' ? { tenantId: { notIn: [...input.prestadorTenants] }, user: { email: { notIn: [...input.adminEmails] } } } : null
    const where: Fila = { AND: [
      ...(q ? [{ user: { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } }] : []),
      ...(input.estado ? [{ status: input.estado }] : []),
      ...(rolWhere ? [rolWhere] : []),
    ] }
    const total = await this.client.account.count({ where })
    const filas = await this.client.account.findMany({
      where,
      include: { user: true, credentials: { select: { status: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (input.pagina - 1) * input.tamano,
      take: input.tamano,
    })
    const items = filas.map((fila) => {
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
    return { items, total }
  }

  async contar(): Promise<number> {
    return this.client.account.count()
  }
}

// In memory (tests / local): the same fields from the in-memory identity store.
export class CuentasAdminEnMemoria implements FuenteCuentasAdmin {
  constructor(private readonly store: IdentityStore) {}

  async listar(input: { q: string; pagina: number; tamano: number; estado: string; rol: string; adminEmails: readonly string[]; prestadorTenants: readonly string[] }): Promise<{ items: CuentaAdmin[]; total: number }> {
    const q = input.q.toLowerCase()
    const cuentas = [...(this.store.accounts?.values() ?? [])]
      .filter((cuenta) => !q || cuenta.normalizedEmail.includes(q) || cuenta.displayName.toLowerCase().includes(q))
      .filter((cuenta) => !input.estado || cuenta.status === input.estado)
      .filter((cuenta) => input.rol === 'admin' ? input.adminEmails.includes(cuenta.normalizedEmail)
        : input.rol === 'prestador' ? input.prestadorTenants.includes(cuenta.tenantId)
          : input.rol === 'cliente' ? !input.adminEmails.includes(cuenta.normalizedEmail) && !input.prestadorTenants.includes(cuenta.tenantId) : true)
      .sort((a, b) => b.createdAt - a.createdAt)
    const pagina = cuentas.slice((input.pagina - 1) * input.tamano, input.pagina * input.tamano)
    const items = await Promise.all(pagina.map(async (cuenta) => ({
      id: cuenta.id,
      tenantId: cuenta.tenantId,
      nombre: cuenta.displayName,
      email: cuenta.email,
      estado: cuenta.status,
      verificado: cuenta.emailVerifiedAt !== null,
      conContrasena: (await this.store.findPasswordCredential(cuenta.id))?.status === 'active',
      creadaEn: new Date(cuenta.createdAt).toISOString(),
    })))
    return { items, total: cuentas.length }
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

// Account changes made by a platform admin from the Users panel (actor = the admin).
const TIPOS_USUARIOS = ['account.admin_created', 'account.admin_updated', 'account.admin_suspended', 'account.admin_reactivated']

interface ClienteAuditoria {
  auditEvent?: {
    findMany(input: { where: Fila; orderBy: Fila | Fila[]; take: number; skip?: number }): Promise<Fila[]>
    count(input: { where: Fila }): Promise<number>
  }
}

const filtroActividad = (tipo: string): Fila =>
  tipo === 'seguridad' ? { eventType: { in: [...TIPOS] } }
    : tipo === 'catalogo' ? { eventType: { startsWith: 'catalog.' } }
      : tipo === 'usuarios' ? { eventType: { in: TIPOS_USUARIOS } }
        : { OR: [{ eventType: { in: [...TIPOS, ...TIPOS_USUARIOS] } }, { eventType: { startsWith: 'catalog.' } }] }

export class ActividadAdminPrisma implements FuenteActividadAdmin {
  constructor(private readonly client: ClienteAuditoria) {}

  async recientes(limite: number): Promise<EventoActividad[]> {
    if (!this.client.auditEvent) return []
    const filas = await this.client.auditEvent.findMany({ where: filtroActividad(''), orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: limite })
    return filas.map(evento)
  }

  async pagina(input: { pagina: number; tamano: number; tipo: string }): Promise<{ items: EventoActividad[]; total: number }> {
    if (!this.client.auditEvent) return { items: [], total: 0 }
    const where = filtroActividad(input.tipo)
    const [filas, total] = await Promise.all([
      this.client.auditEvent.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip: (input.pagina - 1) * input.tamano, take: input.tamano }),
      this.client.auditEvent.count({ where }),
    ])
    return { items: filas.map(evento), total }
  }
}

const evento = (fila: Fila): EventoActividad => ({ tipo: String(fila['eventType']), resultado: String(fila['outcome']), fecha: iso(fila['occurredAt']) })

// In memory (tests / local): events from the in-memory audit sink, same filter and order.
export class ActividadAdminEnMemoria implements FuenteActividadAdmin {
  constructor(private readonly events: () => readonly { kind: string; outcome: string; occurredAt: string }[]) {}

  private filtrados(tipo: string) {
    const incluido = (kind: string) => tipo === 'seguridad' ? TIPOS.has(kind)
      : tipo === 'catalogo' ? kind.startsWith('catalog.')
        : tipo === 'usuarios' ? TIPOS_USUARIOS.includes(kind)
          : TIPOS.has(kind) || TIPOS_USUARIOS.includes(kind) || kind.startsWith('catalog.')
    return this.events().filter((item) => incluido(item.kind)).map((item) => ({ tipo: item.kind, resultado: item.outcome, fecha: item.occurredAt })).reverse()
  }

  async recientes(limite: number) {
    return this.filtrados('').slice(0, limite)
  }

  async pagina(input: { pagina: number; tamano: number; tipo: string }) {
    const todos = this.filtrados(input.tipo)
    return { items: todos.slice((input.pagina - 1) * input.tamano, input.pagina * input.tamano), total: todos.length }
  }
}
