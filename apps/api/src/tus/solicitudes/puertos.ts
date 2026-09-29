import type { CategoriaSolicitud, EstadoAsignacion, ImagenSolicitud, PostulacionSolicitud, SolicitudServicio } from './modelo.ts'

export interface AlmacenSolicitudes {
  guardar(solicitud: SolicitudServicio): Promise<void>
  obtener(id: string): Promise<SolicitudServicio | null>
  obtenerMuchas(ids: readonly string[]): Promise<SolicitudServicio[]>
  // Públicas, abiertas y vigentes, más recientes primero (nunca las dirigidas).
  listarAbiertas(input: { ahora: number; categoria?: CategoriaSolicitud; limite: number }): Promise<SolicitudServicio[]>
  listarDeCuenta(cuentaId: string): Promise<SolicitudServicio[]>
  // Las más recientes de todas las cuentas (administración de la plataforma).
  listarRecientes(limite: number): Promise<SolicitudServicio[]>
  listarAdmin(input: { ahora: number; pagina: number; tamano: number; q: string; estado: string; categoria: string }): Promise<{ items: { solicitud: SolicitudServicio; postulantes: number }[]; total: number }>
  // Dirigidas al prestador del tenant, más recientes primero.
  listarDirigidasA(prestadorTenantId: string): Promise<SolicitudServicio[]>
  contarPublicadasDesde(cuentaId: string, desde: number): Promise<number>
  contarAbiertas(cuentaId: string, ahora: number): Promise<number>
  // Cancelación de la dueña, en UNA sentencia condicional: solo abierta, sin prestador elegido
  // (pública, o dirigida todavía pendiente) y sin trabajo. Registra cuándo y quién; las
  // postulaciones pendientes pasan a 'rechazada'. Nunca borra. 'con_trabajo' = ya hubo match.
  cancelar(input: { id: string; cuentaId: string; ahora: number }): Promise<'cancelada' | 'no_encontrada' | 'cerrada' | 'con_trabajo'>
  // Transición condicional pendiente -> aceptada|rechazada, solo del prestador destino. Aceptar es
  // el match: en la MISMA transacción crea el trabajo (si hay creador). null = sin cambios.
  responder(input: { id: string; prestadorTenantId: string; decision: Extract<EstadoAsignacion, 'aceptada' | 'rechazada'>; ahora: number; cliente: ClienteDelMatch | null; correlationId: string; actorId: string }): Promise<{ trabajoId: string | null } | null>
  // Lanza { code: 'P2002' } si ese orden ya existe.
  guardarImagen(imagen: ImagenSolicitud): Promise<void>
  imagen(solicitudId: string, orden: number): Promise<ImagenSolicitud | null>

  // ---- postulaciones a solicitudes públicas ----
  // Lanza { code: 'P2002' } si ese prestador ya se postuló a la solicitud.
  guardarPostulacion(postulacion: PostulacionSolicitud): Promise<void>
  postulacionesDe(solicitudId: string): Promise<PostulacionSolicitud[]>
  postulacionesDePrestador(prestadorTenantId: string): Promise<PostulacionSolicitud[]>
  // Atómico: la solicitud (de la cuenta, pública, abierta y vigente) pasa a dirigida y 'aceptada'
  // para el postulante; esa postulación pendiente queda 'aceptada', el resto de las pendientes
  // 'rechazada' y se crea EL trabajo (si hay creador). Si algo falla, nada queda aplicado.
  // null (sin cambios) si alguna condición no se cumple.
  aceptarPostulacion(input: { solicitudId: string; cuentaId: string; postulacionId: string; ahora: number; cliente: ClienteDelMatch; correlationId: string }): Promise<{ trabajoId: string | null } | null>
  // Transición condicional pendiente -> rechazada|retirada. `prestadorTenantId` limita al dueño
  // de la postulación (retirar); `solicitudId` a la solicitud del cliente (rechazar).
  cerrarPostulacion(input: { postulacionId: string; estado: 'rechazada' | 'retirada'; solicitudId?: string; prestadorTenantId?: string; ahora: number }): Promise<boolean>
}

// Cliente del match, resuelto en servidor desde la cuenta dueña de la solicitud (nunca del body).
export interface ClienteDelMatch {
  tenantId: string
  actorId: string
}

export interface DatosTrabajoDeSolicitud {
  solicitudId: string
  cliente: ClienteDelMatch
  // Quién produjo el match (el cliente al elegir, o el prestador al aceptar una dirigida).
  actorId: string
  prestadorTenantId: string
  prestadorId: string
  correlationId: string
  ahora: number
}

// Crea el trabajo del match DENTRO de la transacción del almacén (`tx`: cliente transaccional de
// Prisma; undefined en memoria). Debe lanzar si no puede: el almacén revierte todo.
export interface CreadorTrabajoSolicitud {
  crear(tx: unknown, datos: DatosTrabajoDeSolicitud): Promise<{ trabajoId: string }>
}

export interface CuentasSolicitudes {
  getAccount(accountId: string): Promise<{ displayName: string; status: string; emailVerifiedAt: number | null; tenantId: string } | undefined>
}

// Resuelve el prestador elegido por el cliente (directorio). Solo visibles y aprobados.
export interface DestinosSolicitud {
  perfilesPorTenants?(tenantIds: readonly string[]): Promise<Map<string, { id: string; nombrePublico: string }>>
  destino(providerId: unknown): Promise<{ perfil: { id: string; tenantId: string; prestadorId: string; nombrePublico: string } } | null>
  perfilPorTenant(tenantId: string): Promise<{ id: string; nombrePublico: string } | null>
  // Prestador que puede postularse: perfil visible y prestador aprobado (de cualquier oficio).
  postulante(tenantId: string): Promise<{ perfil: { id: string; tenantId: string; prestadorId: string; nombrePublico: string } } | null>
  // Perfil público para mostrarle al cliente quién se postuló.
  perfilPublicoDe(tenantId: string): Promise<{ id: string; nombrePublico: string; oficio: string; zona: string } | null>
}
