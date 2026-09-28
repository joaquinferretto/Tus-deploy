import { resolveWebApiBaseUrl } from './api-url'
import { fetchWithSession } from './session-credentials'

// Client of the platform administration read views (/tus/v1/admin/*). The HttpOnly session cookie
// authenticates; the API authorizes every call (allowlist + verified email + MFA of this session).

export class AdminApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const baseUrl = resolveWebApiBaseUrl({ canonicalUrl: process.env['NEXT_PUBLIC_API_URL'], legacyUrl: process.env['API_BASE_URL'], nodeEnv: process.env['NODE_ENV'] })
  const response = await fetchWithSession(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null
    throw new AdminApiError(response.status, typeof payload?.error?.code === 'string' ? payload.error.code : 'ERROR')
  }
  return (await response.json()) as T
}

export interface AdminResumen {
  usuarios: number
  prestadores: { total: number; enMapa: number }
  solicitudes: { publicadas: number; sinPostulantes: number }
  whatsappPendientes: number | null
}

export interface AdminUsuario {
  id: string
  nombre: string
  email: string
  estado: string
  verificado: boolean
  administrada: boolean
  roles: ('admin' | 'prestador' | 'cliente')[]
  creadaEn: string
}

export interface AdminPrestador {
  id: string
  tenantId: string
  nombre: string
  oficio: string
  oficioLabel: string
  zona: string | null
  zonasCobertura: string[]
  visible: boolean
  aprobado: boolean
  registrado: boolean
  verificado: boolean
  ubicaciones: number
  enMapa: boolean
  motivos: string[]
  creadoEn: string
  actualizadoEn: string
}

export interface AdminSolicitud {
  id: string
  cliente: string
  categoria: string
  titulo: string
  zona: string
  origen: string
  visibilidad: string
  estado: 'publicada' | 'asignada' | 'vencida' | 'cerrada'
  creadaEn: string
  postulantes: number
}

export interface AdminCatalogo {
  oficios: { id: string; label: string; profesion: string; palabrasClave: string[]; prestadores: number; enMapa: number }[]
  zonas: { nombre: string; prestadores: number }[]
}

export interface AdminEvento {
  tipo: string
  resultado: string
  fecha: string
}

export const adminApi = {
  resumen: () => call<AdminResumen>('/tus/v1/admin/resumen'),
  usuarios: (q: string, rol: string) => call<{ items: AdminUsuario[] }>(`/tus/v1/admin/usuarios?${new URLSearchParams({ q, rol }).toString()}`),
  prestadores: () => call<{ items: AdminPrestador[] }>('/tus/v1/admin/prestadores'),
  visibilidad: (id: string, visible: boolean) => call<{ id: string; visible: boolean }>(`/tus/v1/admin/prestadores/${encodeURIComponent(id)}/visibilidad`, { visible }),
  solicitudes: () => call<{ items: AdminSolicitud[] }>('/tus/v1/admin/solicitudes'),
  catalogo: () => call<AdminCatalogo>('/tus/v1/admin/catalogo'),
  actividad: () => call<{ items: AdminEvento[] }>('/tus/v1/admin/actividad'),
}

export function adminErrorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.status === 401) return 'Tu sesión venció. Ingresá de nuevo.'
    if (error.status === 403) return 'Confirmá tu segundo factor en Seguridad para ver esta sección.'
    if (error.status === 404) return 'Esta sección todavía no está disponible en el servidor.'
  }
  return 'No pudimos cargar los datos. Probá de nuevo en unos minutos.'
}

export const formatFecha = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

const EVENTOS: Record<string, string> = {
  'auth.signed_in': 'Inicio de sesión',
  'auth.failed': 'Intento de acceso rechazado',
  'account.registered': 'Cuenta creada',
  'account.verified': 'Email confirmado',
  'recovery.completed': 'Contraseña restablecida',
  'credential.password_changed': 'Contraseña cambiada',
  'session.revoked': 'Sesión cerrada',
  'session.rotated': 'Sesión renovada tras MFA',
  'email.delivery_failed': 'Email no entregado',
  'mfa.enrollment_confirmed': 'Autenticador activado',
  'mfa.challenge_verified': 'Código MFA verificado',
  'mfa.recovery_used': 'Código de recuperación usado',
  'mfa.recovery_codes_regenerated': 'Códigos de recuperación regenerados',
  'mfa.disabled': 'MFA desactivado',
  'mfa.operation_denied': 'Operación MFA rechazada',
}

export const eventoLabel = (tipo: string) => EVENTOS[tipo] ?? tipo
