import { resolveWebApiBaseUrl } from './api-url'
import { fetchWithSession } from './session-credentials'

// Client of the platform administration read views (/tus/v1/admin/*). The HttpOnly session cookie
// authenticates; the API authorizes every call (allowlist + verified email + MFA of this session).

export class AdminApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

async function call<T>(path: string, body?: unknown, method?: 'POST' | 'PATCH', extraHeaders: Record<string, string> = {}): Promise<T> {
  const baseUrl = resolveWebApiBaseUrl({ canonicalUrl: process.env['NEXT_PUBLIC_API_URL'], legacyUrl: process.env['API_BASE_URL'], nodeEnv: process.env['NODE_ENV'] })
  const response = await fetchWithSession(`${baseUrl}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID(), ...extraHeaders },
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

export interface AdminPage<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
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
  // Mercado Pago link STATUS only (connected / not_connected / expired / revoked / error).
  mercadoPago: string
  rating: { average: number; count: number } | null
  trabajosCompletados: number
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
  trabajoId: string | null
  canceladaEn: string | null
}

export interface AdminPagoParte { parte: 'total' | 'sena' | 'saldo'; montoMinor: string; moneda: string; estado: string }
export interface AdminTrabajo {
  id: string
  origen: 'marketplace' | 'solicitud'
  solicitudId: string | null
  titulo: string
  cliente: string
  prestador: string
  estado: string
  version: number
  presupuesto: { totalMinor: string; moneda: string } | null
  pagos: AdminPagoParte[]
  cancelacion: { rol: string; motivo: string } | null
  cancelacionSolicitada: { fecha: string; motivo: string } | null
  calificacion: number | null
  terminadoEn: string | null
  creadoEn: string
  actualizadoEn: string
}
export interface AdminPago {
  pagoId: string
  trabajoId: string
  parte: 'total' | 'sena' | 'saldo'
  montoMinor: string
  moneda: string
  estado: string
  comisionMinor: string | null
  netoPrestadorMinor: string | null
  feeMercadoPagoMinor: string | null
  referencia: string | null
  error: string | null
  creadoEn: string
  actualizadoEn: string
}
export interface AdminTrabajoDetalle extends AdminTrabajo {
  transiciones: { de: string | null; a: string; motivo: string; fecha: string }[]
  pagosDetalle: AdminPago[]
  calificacionDetalle: { puntuacion: number; comentario: string | null; fecha: string } | null
  liquidaciones: { parte: string; estado: string; brutoMinor: string; comisionMinor: string; netoMinor: string }[]
}

export interface AdminCategoria { id: string; nombre: string; slug: string; descripcion: string | null; activo: boolean; orden: number; oficios: number }
export interface AdminOficio { id: string; categoriaId: string | null; nombre: string; profesion: string; slug: string; descripcion: string | null; icono: string; activo: boolean; orden: number; sinonimos: string[]; prestadores: number; enMapa: number }
export interface AdminLocalidad { id: string; nombre: string; provincia: string; activo: boolean; orden: number }
export interface AdminZona { id: string; localidadId: string; nombre: string; slug: string; activo: boolean; orden: number; barrios: number; prestadores: number }
export interface AdminBarrio { id: string; localidadId: string; zonaId: string | null; nombre: string; slug: string; lat: number | null; lng: number | null; poligono: { type: 'Polygon'; coordinates: [number, number][][] }; activo: boolean; orden: number; prestadores: number; solicitudes: number }

export interface AdminCatalogo {
  categorias: AdminCategoria[]
  oficios: AdminOficio[]
  localidades: AdminLocalidad[]
  zonas: AdminZona[]
  barrios: AdminBarrio[]
}

export type EntidadCatalogo = 'categorias' | 'oficios' | 'localidades' | 'zonas' | 'barrios'

export interface ItemCatalogo {
  categorias: AdminCategoria
  oficios: AdminOficio
  localidades: AdminLocalidad
  zonas: AdminZona
  barrios: AdminBarrio
}

export interface FiltroCatalogo {
  q: string
  estado: '' | 'activo' | 'inactivo'
  categoria?: string
  localidad?: string
  zona?: string
  page: number
  pageSize: number
}

// Catalog changes answer 422 with the invalid fields, 409 on duplicates or renaming a
// neighbourhood that is in use.
export class CatalogoError extends Error {
  constructor(readonly status: number, readonly code: string, readonly campos: string[]) {
    super(code)
  }
}

async function guardarCatalogo(entidad: EntidadCatalogo, id: string | null, body: Record<string, unknown>) {
  const baseUrl = resolveWebApiBaseUrl({ canonicalUrl: process.env['NEXT_PUBLIC_API_URL'], legacyUrl: process.env['API_BASE_URL'], nodeEnv: process.env['NODE_ENV'] })
  const response = await fetchWithSession(`${baseUrl}/tus/v1/admin/catalogo/${entidad}${id ? `/${encodeURIComponent(id)}` : ''}`, {
    method: id ? 'PUT' : 'POST',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID() },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as { item?: unknown; error?: { code?: string; campos?: string[] } } | null
  if (!response.ok) throw new CatalogoError(response.status, payload?.error?.code ?? 'ERROR', payload?.error?.campos ?? [])
  return payload?.item
}

export function catalogoErrorMessage(error: unknown): string {
  if (error instanceof CatalogoError) {
    if (error.code === 'DUPLICATE') return 'Ya existe uno con ese nombre.'
    if (error.code === 'IN_USE_RENAME') return 'Ese barrio ya lo usan prestadores o solicitudes: no se puede renombrar (podés desactivarlo y crear otro).'
    if (error.code === 'INVALID') return `Revisá: ${error.campos.map((campo) => CAMPOS[campo] ?? campo).join(', ')}.`
    if (error.status === 403) return 'Confirmá tu segundo factor en Seguridad.'
  }
  return adminErrorMessage(error)
}

const CAMPOS: Record<string, string> = {
  nombre: 'nombre (2 a 60 caracteres)', descripcion: 'descripción (hasta 200)', orden: 'orden (0 a 999)', categoriaId: 'categoría',
  icono: 'ícono', sinonimos: 'sinónimos (2 a 40 caracteres cada uno, hasta 80)', profesion: 'nombre de la profesión', provincia: 'provincia',
  localidadId: 'localidad', zonaId: 'zona (de la misma localidad)', ubicacion: 'ubicación en el mapa', activo: 'estado',
  poligono: 'área de cobertura (mínimo 3 puntos)',
}

export interface AdminEvento {
  tipo: string
  resultado: string
  fecha: string
}

export const adminApi = {
  resumen: () => call<AdminResumen>('/tus/v1/admin/resumen'),
  usuarios: (input: { q: string; rol: string; estado: string; page: number; pageSize: number }) => call<AdminPage<AdminUsuario>>(`/tus/v1/admin/usuarios?${new URLSearchParams({ q: input.q, rol: input.rol, estado: input.estado, page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
  crearUsuario: (body: { displayName: string; email: string; password: string; role: 'cliente' }) => call<{ created: true }>('/tus/v1/admin/usuarios', body),
  actualizarUsuario: (id: string, body: { displayName: string; status: 'active' | 'suspended'; reason?: string }) => call<{ updated: true }>(`/tus/v1/admin/usuarios/${encodeURIComponent(id)}`, body, 'PATCH'),
  prestadores: (input: { q: string; oficio: string; zona: string; visibilidad: string; verificacion: string; page: number; pageSize: number }) => call<AdminPage<AdminPrestador>>(`/tus/v1/admin/prestadores?${new URLSearchParams({ q: input.q, oficio: input.oficio, zona: input.zona, visibilidad: input.visibilidad, verificacion: input.verificacion, page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
  visibilidad: (id: string, visible: boolean) => call<{ id: string; visible: boolean }>(`/tus/v1/admin/prestadores/${encodeURIComponent(id)}/visibilidad`, { visible }),
  solicitudes: (input: { q: string; estado: string; categoria: string; page: number; pageSize: number }) => call<AdminPage<AdminSolicitud>>(`/tus/v1/admin/solicitudes?${new URLSearchParams({ q: input.q, estado: input.estado, categoria: input.categoria, page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
  catalogo: () => call<AdminCatalogo>('/tus/v1/admin/catalogo'),
  // FASE 10: end-to-end service operations (read-only, plus the support cancellation).
  trabajos: (input: { q: string; estado: string; page: number; pageSize: number }) => call<AdminPage<AdminTrabajo>>(`/tus/v1/admin/trabajos?${new URLSearchParams({ q: input.q, estado: input.estado, page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
  trabajo: (id: string) => call<AdminTrabajoDetalle>(`/tus/v1/admin/trabajos/${encodeURIComponent(id)}`),
  // Readiness of online payments: booleans and missing items only, never secret values.
  pagosEstado: () => call<{ productEnabled: boolean; blockers: string[]; operational: { environment: string }; globalPolicy: { rateBps: number; persisted: boolean } }>('/tus/v1/admin/payments/status'),
  pagos: (input: { estado: string; page: number; pageSize: number }) => call<AdminPage<AdminPago>>(`/tus/v1/admin/pagos?${new URLSearchParams({ estado: input.estado, page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
  cancelarTrabajo: (id: string, expectedVersion: number, reason: string, idempotencyKey: string) => call<{ status: string }>(`/tus/v1/admin/trabajos/${encodeURIComponent(id)}/cancelar`, { expectedVersion, reason }, 'POST', { 'Idempotency-Key': idempotencyKey }),
  // One page of an entity (server-side filters and pagination) with its usage counts.
  listaCatalogo: <E extends EntidadCatalogo>(entidad: E, input: FiltroCatalogo) =>
    call<AdminPage<ItemCatalogo[E]>>(`/tus/v1/admin/catalogo/${entidad}?${new URLSearchParams({ q: input.q, estado: input.estado, categoria: input.categoria ?? '', localidad: input.localidad ?? '', zona: input.zona ?? '', page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
  guardar: guardarCatalogo,
  actividad: (input: { tipo: string; page: number; pageSize: number }) => call<AdminPage<AdminEvento>>(`/tus/v1/admin/actividad?${new URLSearchParams({ tipo: input.tipo, page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
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
  'account.admin_created': 'Usuario creado por un administrador',
  'account.admin_updated': 'Usuario editado por un administrador',
  'account.admin_suspended': 'Usuario suspendido por un administrador',
  'account.admin_reactivated': 'Usuario reactivado por un administrador',
}

const ENTIDADES: Record<string, string> = { categoria: 'Categoría', oficio: 'Servicio', localidad: 'Localidad', zona: 'Zona', barrio: 'Barrio' }

// catalog.<entity>_<action> (catalog changes made from the panel).
export const eventoLabel = (tipo: string) => {
  const catalogo = /^catalog\.([a-z]+)_([a-z_]+)$/u.exec(tipo)
  if (catalogo) return `${ENTIDADES[catalogo[1]!] ?? catalogo[1]} ${catalogo[2]!.replace(/_/gu, ' ')}`
  return EVENTOS[tipo] ?? tipo
}
