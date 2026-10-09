import { resolveWebApiBaseUrl } from './api-url'
import type { DetalleLiquidacionAdminDTO, FiltrosUsuariosAdmin, LiquidacionAdminDTO, PaginaUsuariosAdmin, PerfilUsuarioAdminDTO, UsuarioAdminDTO } from '@factory/contracts'
import type { UbicacionPrestadorWeb } from '@/features/directory/directory-client'

import { fetchWithSession } from './session-credentials'

// Client of the platform administration read views (/tus/v1/admin/*). The HttpOnly session cookie
// authenticates; the API authorizes every call (allowlist + verified email + MFA of this session).

export class AdminApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly fields: string[] = []) {
    super(code)
  }
}

async function call<T>(path: string, body?: unknown, method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE', extraHeaders: Record<string, string> = {}): Promise<T> {
  const baseUrl = resolveWebApiBaseUrl({ canonicalUrl: process.env['NEXT_PUBLIC_API_URL'], legacyUrl: process.env['API_BASE_URL'], nodeEnv: process.env['NODE_ENV'] })
  const response = await fetchWithSession(`${baseUrl}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID(), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    // Two error shapes exist in the API: { error: { code, fields } } and the flat { code, fields }.
    const payload = (await response.json().catch(() => null)) as { code?: unknown; fields?: unknown; error?: { code?: unknown; fields?: unknown } | string } | null
    const anidado = typeof payload?.error === 'object' && payload.error !== null ? payload.error : null
    const lista = anidado?.fields ?? payload?.fields
    const fields = Array.isArray(lista) ? lista.filter((item): item is string => typeof item === 'string') : []
    const code = typeof anidado?.code === 'string' ? anidado.code : typeof payload?.code === 'string' ? payload.code : 'ERROR'
    throw new AdminApiError(response.status, code, fields)
  }
  return (await response.json()) as T
}

export interface AdminObservacion {
  clientTenantId: string
  workId: string
  providerTenantId: string
  finishedAt: string
  evidence: string
  observedAt: string | null
  reason: string | null
}

export interface AdminEvidenciaHabilitacion {
  evidenceId: string
  capability: string
  gate: string
  owner: string
  scope: string
  evidenceType: string
  evidenceRef: string
  policyVersion: string
  issuedAt: string
  expiresAt: string | null
  revoked: boolean
  status: 'current' | 'revoked' | 'expired' | 'not_yet_valid'
  recordedAt: string
}

export interface AdminEvidenciasHabilitacion {
  scope: string
  // `notRequired`: conditional requirements that do not apply to this runtime or flow, and why.
  capabilities: { capability: string; requiredGates: string[]; notRequired?: { gate: string; reason: string }[]; evidence: AdminEvidenciaHabilitacion[] }[]
}

export interface AdminResumen {
  usuarios: number
  prestadores: { total: number; enMapa: number }
  solicitudes: { publicadas: number; sinPostulantes: number }
  whatsappPendientes: number | null
}

// One row of the users list (shared contract with the API).
export type AdminUsuario = UsuarioAdminDTO

// Identity phone as the panel shows it: masked numbers and dates (never codes or hashes).
export interface AdminTelefono {
  verificado: boolean
  numero: string | null
  verificadoEn: string | null
  pendiente: string | null
  // A verified phone and a linked WhatsApp are different facts.
  whatsappVinculado?: boolean
}

// One account in the admin detail: business fields only (never hashes, tokens or MFA data).
export interface AdminUsuarioDetalle {
  id: string
  nombre: string
  email: string
  estado: 'active' | 'suspended'
  verificado: boolean
  verificadoEn: string | null
  conContrasena: boolean
  creadaEn: string
  actualizadaEn: string
  roles: ('admin' | 'prestador' | 'cliente')[]
  // Admin authority comes from the server allowlist: not editable from the panel.
  administradorPlataforma: boolean
  prestador: { id: string; displayName: string; visible: boolean } | null
  telefono: AdminTelefono
  // Personal profile (names, document, residence): private data, admin only.
  perfil: PerfilUsuarioAdminDTO | null
}

// Same view the provider sees on its own location page.
export type AdminUbicacionPrestador = UbicacionPrestadorWeb

// PRESTADOR-CUENTA-01: the account behind a provider profile, as the API resolved it by ids.
export type DestinoWhatsappPrestador = 'listo' | 'plantilla' | 'ventana_cerrada' | 'no_vinculado' | 'sin_cuenta'
export interface AdminCuentaPrestador {
  cuentaId: string
  usuarioId: string
  nombre: string
  email: string
  estado: string
  emailVerificado: boolean
  documento: { tipo: string; numero: string } | null
  telefono: { numero: string | null; verificado: boolean; pendiente: string | null }
  whatsapp: { vinculado: boolean; vinculadoEn: string | null; ultimoMensajeEn: string | null; ventanaAbierta: boolean; destino: DestinoWhatsappPrestador }
  identidad: string | null
  cuentasEnTenant: number
}

// PAGOS-MP-VINCULADO-01. The link of a provider with Mercado Pago, as the administration reads it
// (the status is the API's; never a token nor an account id).
export type VinculoMercadoPago = 'no_vinculado' | 'vinculado' | 'requiere_reconexion'
export function vinculoMercadoPago(status: string | null | undefined): { estado: VinculoMercadoPago; texto: string; tono: 'ok' | 'warn' | 'off' } {
  if (status === 'connected') return { estado: 'vinculado', texto: 'Vinculado', tono: 'ok' }
  if (status === 'expired' || status === 'error') return { estado: 'requiere_reconexion', texto: 'Requiere reconexión', tono: 'warn' }
  return { estado: 'no_vinculado', texto: 'No vinculado', tono: 'off' }
}

// Whether the deposit of a provider's turnos can be charged, and why not.
export interface AdminCobroSena { disponible: boolean; motivo: string | null; modo: 'plataforma' | 'split' | null }
export function textoCobroSena(cobro: AdminCobroSena | null | undefined): { texto: string; detalle: string; tono: 'ok' | 'warn' | 'danger' } {
  if (!cobro) return { texto: 'Sin dato', detalle: 'No se pudo consultar el estado de cobro.', tono: 'warn' }
  if (cobro.disponible) return cobro.modo === 'split'
    ? { texto: 'Con su cuenta', detalle: 'El prestador vinculó su Mercado Pago: el pago se cobra con su cuenta.', tono: 'ok' }
    : { texto: 'Habilitado', detalle: 'El prestador vinculó su Mercado Pago. La seña la cobra y la retiene TUS hasta que el servicio se completa; después su parte queda en su saldo.', tono: 'ok' }
  const motivos: Record<string, [string, string]> = {
    PAYMENTS_DISABLED: ['Pagos apagados', 'El interruptor de pagos de la plataforma está apagado: los turnos se confirman sin seña.'],
    PROVIDER_NOT_CONFIGURED: ['Mercado Pago sin configurar', 'Faltan las credenciales de Mercado Pago de TUS en el servidor.'],
    PRODUCTION_NOT_AUTHORIZED: ['Falta habilitación', 'Falta la habilitación productiva de pagos de servicios: no se pueden aceptar turnos con seña.'],
    PLATFORM_ACCOUNT_REQUIRED: ['Falta cuenta de TUS', 'Una seña o un pago anticipado se cobra con la cuenta de TUS para poder retenerlo hasta que el servicio se complete. Falta configurar MERCADO_PAGO_PLATFORM_ACCESS_TOKEN y MERCADO_PAGO_PLATFORM_USER_ID; no se envía a la cuenta del prestador.'],
    PROVIDER_ACCOUNT_NOT_CONNECTED: ['Falta vincular Mercado Pago', 'El prestador todavía no vinculó su Mercado Pago. Es lo único que necesita para cobrar: lo hace desde su panel, en Cobros.'],
    PSP_FEE_POLICY_UNDECIDED: ['Comisión sin definir', 'Falta definir quién paga la comisión de Mercado Pago en la política de comisiones.'],
    PSP_FEE_POLICY_UNSUPPORTED: ['Comisión no soportada', 'La política de comisiones actual no se puede cobrar.'],
  }
  const [texto, detalle] = motivos[cobro.motivo ?? ''] ?? ['No disponible', `No se puede cobrar la seña (${cobro.motivo ?? 'sin motivo'}).`]
  return { texto, detalle, tono: cobro.motivo === 'PAYMENTS_DISABLED' ? 'warn' : 'danger' }
}

// Why a provider shows no account (reconciled by hand; TUS never picks one).
export interface AdminProblemaCuentaPrestador { motivo: 'sin_vincular' | 'ambiguo' | 'cuenta_invalida'; cuentasEnTenant: number }
export const PROBLEMA_CUENTA: Record<AdminProblemaCuentaPrestador['motivo'], string> = {
  sin_vincular: 'Este prestador no tiene una cuenta vinculada. TUS no elige una por su cuenta: hay que asociarla.',
  ambiguo: 'Este prestador figura vinculado a más de una cuenta. Hay que dejar una sola.',
  cuenta_invalida: 'La cuenta vinculada a este prestador no existe, no está activa o es de otro titular.',
}

// What Admin reads at a glance: can this provider receive a request of turno on WhatsApp?
export const DESTINO_WHATSAPP: Record<DestinoWhatsappPrestador, { texto: string; detalle: string; tono: 'ok' | 'warn' | 'danger' }> = {
  listo: { texto: 'Listo', detalle: 'WhatsApp vinculado y con conversación abierta: recibe las solicitudes con sus botones.', tono: 'ok' },
  plantilla: { texto: 'Por plantilla', detalle: 'WhatsApp vinculado; fuera de las 24 horas recibe la solicitud como plantilla aprobada.', tono: 'ok' },
  ventana_cerrada: { texto: 'No recibe ahora', detalle: 'WhatsApp vinculado, pero pasaron más de 24 horas de su último mensaje y la plantilla de solicitudes no está aprobada en Meta: no se le puede escribir hasta que escriba.', tono: 'warn' },
  no_vinculado: { texto: 'No vinculado', detalle: 'La cuenta no tiene un WhatsApp vinculado (tener teléfono no alcanza).', tono: 'danger' },
  sin_cuenta: { texto: 'Sin cuenta', detalle: 'Este perfil no tiene una cuenta activa detrás: nadie puede operarlo ni recibir sus avisos.', tono: 'danger' },
}

export interface AdminPrestadorDetalle {
  // Present when the API resolves the account behind the profile.
  cuentaAsociada?: AdminCuentaPrestador | null
  cobroSena?: AdminCobroSena | null
  cuentaProblema?: AdminProblemaCuentaPrestador | null
  tenantId?: string
  perfil: {
    id: string
    displayName: string
    profession: string
    professions: string[]
    zone: string | null
    serviceZones: string[]
    serviceMode: 'local' | 'domicilio' | 'mixto'
    coverageRadiusKm: number | null
    description: string | null
    yearsOfExperience: number | null
    visible: boolean
    createdAt: string
    updatedAt: string
  }
  prestador: { estado: string; aprobado: boolean } | null
  cuenta: { id: string; nombre: string; email: string; estado: string; verificado: boolean; telefonoVerificado?: boolean; telefono?: string | null } | null
  ubicacion: AdminUbicacionPrestador | null
}

export type CambiosPrestador = Partial<Omit<AdminPrestadorDetalle['perfil'], 'id' | 'createdAt' | 'updatedAt'>> & { providerStatus?: 'approved' | 'suspended' }

export interface AdminPage<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AdminPrestador {
  cobroSena?: AdminCobroSena | null
  cuenta?: AdminCuentaPrestador | null
  cuentaProblema?: AdminProblemaCuentaPrestador | null
  whatsappDestino?: DestinoWhatsappPrestador
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
export interface AdminLocalidad { id: string; nombre: string; provincia: string; activo: boolean; orden: number; lat?: number | null; lng?: number | null }
export type AdminPoligono = { type: 'Polygon'; coordinates: [number, number][][] }
export interface AdminZona { id: string; localidadId: string; nombre: string; slug: string; activo: boolean; orden: number; barrios: number; prestadores: number; poligono: AdminPoligono | null; lat: number | null; lng: number | null }
export interface AdminBarrio { id: string; localidadId: string; zonaId: string | null; nombre: string; slug: string; lat: number | null; lng: number | null; poligono: AdminPoligono | null; activo: boolean; orden: number; prestadores: number; solicitudes: number }

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

// SERVICIO-URGENTE-01: an urgent request with every provider it was offered to.
export interface AdminUrgente {
  id: string
  status: 'pendiente' | 'tomada' | 'sin_candidatos' | 'todos_rechazaron' | 'vencida' | 'cancelada'
  client: string
  service: string
  description: string | null
  address: string
  zone: string
  origin: string
  createdAt: string
  expiresAt: string
  reopenings: number
  workId: string | null
  winner: { name: string; acceptedAt: string | null } | null
  counts: { candidates: number; notified: number; rejected: number; resigned: number; unanswered: number; deliveryFailed: number }
  candidates: {
    provider: { id: string | null; name: string }
    status: string
    round: number
    notSentReason: string | null
    notifiedAt: string | null
    answeredAt: string | null
    answerChannel: string | null
    acceptedAt: string | null
    resignedAt: string | null
    resignationReason: string | null
    delivery: { status: string; at: string; error: string | null; waIdMasked: string | null } | null
  }[]
}

export const adminApi = {
  resumen: () => call<AdminResumen>('/tus/v1/admin/resumen'),
  // Search, filters and pagination run in the API (never over a downloaded list).
  usuarios: (input: FiltrosUsuariosAdmin) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') params.set(key, String(value))
    return call<PaginaUsuariosAdmin>(`/tus/v1/admin/usuarios?${params.toString()}`)
  },
  telefonoUsuario: (id: string, body: { accion: 'pendiente'; telefono: string } | { accion: 'quitar' }) => call<{ done: true }>(`/tus/v1/admin/usuarios/${encodeURIComponent(id)}/telefono`, body),
  // Identity (names + document) loaded or corrected by the administrator. Only these fields; the
  // API validates again, keeps the document unique and audits.
  // ADMIN-IDENTIDAD-MANUAL-01: the verification of the identity of the provider behind an account,
  // and the manual decision of the administrator (only the action and its note travel).
  verificacionIdentidad: (id: string) => call<{ verificacion: VerificacionIdentidadAdmin }>(`/tus/v1/admin/usuarios/${encodeURIComponent(id)}/identidad/verificacion`),
  decidirIdentidad: (id: string, accion: 'verificar' | 'rechazar' | 'revocar' | 'pendiente', motivo: string) => call<{ verificacion: VerificacionIdentidadAdmin }>(`/tus/v1/admin/usuarios/${encodeURIComponent(id)}/identidad/verificacion`, { accion, motivo }),
  identidadUsuario: (id: string, body: { nombre: string; apellido: string; tipoDocumento: string; numeroDocumento: string; motivo?: string }) =>
    call<{ perfil: PerfilUsuarioAdminDTO }>(`/tus/v1/admin/usuarios/${encodeURIComponent(id)}/identidad`, body, 'PUT'),
  // Explicit administrative operations: the request only names the action (never a state or a
  // date) and the API answers the updated phone identity.
  // The contact of an account, by explicit actions (the administration certifies it). Only the
  // three that save a number carry it; the API answers the updated phone identity.
  contactoUsuario: (id: string, body: { accion: 'pendiente' | 'guardar_verificar' | 'guardar_verificar_vincular'; telefono: string } | { accion: 'verificar' | 'verificar_vincular' | 'desverificar' | 'vincular_whatsapp' | 'desvincular_whatsapp' | 'quitar' }) =>
    call<{ done: true; telefono?: AdminTelefono }>(`/tus/v1/admin/usuarios/${encodeURIComponent(id)}/telefono`, body),
  verificacionTelefonoUsuario: (id: string, accion: 'verificar' | 'desverificar') => call<{ done: true; telefono: AdminTelefono }>(`/tus/v1/admin/usuarios/${encodeURIComponent(id)}/telefono`, { accion }),
  crearUsuario: (body: { displayName: string; email: string; password: string; role: 'cliente' }) => call<{ created: true }>('/tus/v1/admin/usuarios', body),
  actualizarUsuario: (id: string, body: { displayName?: string; status?: 'active' | 'suspended'; reason?: string; email?: string; emailVerified?: boolean }) => call<{ updated: true }>(`/tus/v1/admin/usuarios/${encodeURIComponent(id)}`, body, 'PATCH'),
  usuario: (id: string) => call<AdminUsuarioDetalle>(`/tus/v1/admin/usuarios/${encodeURIComponent(id)}`),
  accionUsuario: (id: string, action: 'revoke_sessions' | 'password_reset') => call<{ done: true }>(`/tus/v1/admin/usuarios/${encodeURIComponent(id)}/acciones`, { action }),
  prestador: (id: string) => call<AdminPrestadorDetalle>(`/tus/v1/admin/prestadores/${encodeURIComponent(id)}`),
  editarPrestador: (id: string, body: CambiosPrestador) => call<AdminPrestadorDetalle>(`/tus/v1/admin/prestadores/${encodeURIComponent(id)}`, body, 'PUT'),
  ubicacionPrestador: (id: string) => call<{ location: AdminUbicacionPrestador }>(`/tus/v1/admin/prestadores/${encodeURIComponent(id)}/ubicacion`),
  guardarUbicacionPrestador: (id: string, input: { lat: number; lng: number; showExact: boolean }) => call<{ location: AdminUbicacionPrestador }>(`/tus/v1/admin/prestadores/${encodeURIComponent(id)}/ubicacion`, input, 'PUT'),
  quitarUbicacionPrestador: (id: string) => call<{ location: AdminUbicacionPrestador }>(`/tus/v1/admin/prestadores/${encodeURIComponent(id)}/ubicacion`, undefined, 'DELETE'),
  prestadores: (input: { q: string; oficio: string; zona: string; visibilidad: string; verificacion: string; page: number; pageSize: number }) => call<AdminPage<AdminPrestador>>(`/tus/v1/admin/prestadores?${new URLSearchParams({ q: input.q, oficio: input.oficio, zona: input.zona, visibilidad: input.visibilidad, verificacion: input.verificacion, page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
  visibilidad: (id: string, visible: boolean) => call<{ id: string; visible: boolean }>(`/tus/v1/admin/prestadores/${encodeURIComponent(id)}/visibilidad`, { visible }),
  urgentes: (input: { page: number; pageSize: number }) => call<AdminPage<AdminUrgente>>(`/tus/v1/admin/urgentes?${new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
  solicitudes: (input: { q: string; estado: string; categoria: string; page: number; pageSize: number }) => call<AdminPage<AdminSolicitud>>(`/tus/v1/admin/solicitudes?${new URLSearchParams({ q: input.q, estado: input.estado, categoria: input.categoria, page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
  catalogo: () => call<AdminCatalogo>('/tus/v1/admin/catalogo'),
  // FASE 10: end-to-end service operations (read-only, plus the support cancellation).
  trabajos: (input: { q: string; estado: string; page: number; pageSize: number }) => call<AdminPage<AdminTrabajo>>(`/tus/v1/admin/trabajos?${new URLSearchParams({ q: input.q, estado: input.estado, page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
  trabajo: (id: string) => call<AdminTrabajoDetalle>(`/tus/v1/admin/trabajos/${encodeURIComponent(id)}`),
  // Readiness of online payments: booleans and missing items only, never secret values.
  pagosEstado: () => call<{ productEnabled: boolean; blockers: string[]; operational: { environment: string }; globalPolicy: { rateBps: number; persisted: boolean; pspFeeBearer?: string; version?: number; since?: string | null; actorId?: string | null; reason?: string | null; previousRateBps?: number | null }; readiness?: { gate: string; requiredNow: boolean; servicePayments: { authorized: boolean; blockers: string[] }; settlement: { authorized: boolean; blockers: string[] } }; technicallyEnabled?: boolean; publicLaunchReadiness?: { capability: string; ready: boolean; gates: { gate: string; status: string }[] } }>('/tus/v1/admin/payments/status'),
  // CIERRE-TRABAJO-01: problems reported by clients on finished works, and settling one.
  // COMISION-TRABAJO-01: a new version of the global commission (basis points). `expectedVersion`
  // is the one this screen read: if somebody else changed it meanwhile the API refuses (409).
  cambiarComisionGlobal: (input: { rateBps: number; expectedVersion: number; reason: string; pspFeeBearer: string }) => call<{ rateBps: number; version: number }>('/tus/v1/admin/payments/commission-policies', { scope: 'global', ...input }),
  observaciones: () => call<{ observations: AdminObservacion[] }>('/tus/v1/admin/payments/observations'),
  resolverObservacion: (clientTenantId: string, workId: string) => call<{ status: string; payments: { released: number; pending: string | null } | null }>('/tus/v1/admin/payments/observations/resolve', { clientTenantId, workId }),
  // Readiness evidence of the platform: tenant, actor, scope and status are decided by the API.
  evidenciasHabilitacion: () => call<AdminEvidenciasHabilitacion>('/tus/v1/admin/payments/readiness/evidence'),
  registrarEvidenciaHabilitacion: (input: { capability: string; gate: string; owner: string; evidenceType: string; evidenceRef: string; policyVersion: string; expiresAt?: string }) =>
    call<{ evidence: AdminEvidenciaHabilitacion }>('/tus/v1/admin/payments/readiness/evidence', input),
  revocarEvidenciaHabilitacion: (evidenceId: string, reason: string) =>
    call<{ evidence: AdminEvidenciaHabilitacion }>(`/tus/v1/admin/payments/readiness/evidence/${encodeURIComponent(evidenceId)}/revoke`, { reason }),
  // TUS-GANANCIAS-01: provider payout requests. The API decides amounts and states; the page only
  // sends the action, the mechanism and what the administrator types.
  liquidaciones: (input: { status: string; page: number; pageSize: number }) => call<{ items: LiquidacionAdminDTO[]; total: number; page: number; pageSize: number; automaticAvailable: boolean }>(`/tus/v1/admin/payments/payouts?${new URLSearchParams({ status: input.status, page: String(input.page), pageSize: String(input.pageSize) }).toString()}`),
  liquidacion: (id: string) => call<DetalleLiquidacionAdminDTO>(`/tus/v1/admin/payments/payouts/${encodeURIComponent(id)}`),
  accionLiquidacion: (id: string, action: 'process' | 'resend' | 'refresh' | 'paid' | 'failed' | 'cancel', body: Record<string, string> = {}) => call<{ payout: LiquidacionAdminDTO }>(`/tus/v1/admin/payments/payouts/${encodeURIComponent(id)}/${action}`, body),
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

// ADMIN-IDENTIDAD-MANUAL-01
export interface VerificacionIdentidadAdmin {
  estado: 'pendiente' | 'verificada' | 'rechazada'
  estadoInterno: string | null
  metodo: string | null
  documento: string | null
  verificadaEn: string | null
  rechazadaEn: string | null
  nota: string | null
  decididaPor: string | null
  actualizadaEn: string | null
}
