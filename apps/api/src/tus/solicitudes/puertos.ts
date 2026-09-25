import type { CategoriaSolicitud, EstadoAsignacion, ImagenSolicitud, PostulacionSolicitud, SolicitudServicio } from './modelo.ts'

export interface AlmacenSolicitudes {
  guardar(solicitud: SolicitudServicio): Promise<void>
  obtener(id: string): Promise<SolicitudServicio | null>
  // Públicas, abiertas y vigentes, más recientes primero (nunca las dirigidas).
  listarAbiertas(input: { ahora: number; categoria?: CategoriaSolicitud; limite: number }): Promise<SolicitudServicio[]>
  listarDeCuenta(cuentaId: string): Promise<SolicitudServicio[]>
  // Dirigidas al prestador del tenant, más recientes primero.
  listarDirigidasA(prestadorTenantId: string): Promise<SolicitudServicio[]>
  contarPublicadasDesde(cuentaId: string, desde: number): Promise<number>
  contarAbiertas(cuentaId: string, ahora: number): Promise<number>
  // Solo la dueña puede cerrar; una dirigida pendiente pasa a 'cancelada'. false si no existe,
  // no es suya o ya estaba cerrada.
  cerrar(input: { id: string; cuentaId: string; ahora: number }): Promise<boolean>
  // Transición condicional pendiente -> aceptada|rechazada, solo del prestador destino.
  responder(input: { id: string; prestadorTenantId: string; decision: Extract<EstadoAsignacion, 'aceptada' | 'rechazada'>; ahora: number }): Promise<boolean>
  // Lanza { code: 'P2002' } si ese orden ya existe.
  guardarImagen(imagen: ImagenSolicitud): Promise<void>
  imagen(solicitudId: string, orden: number): Promise<ImagenSolicitud | null>

  // ---- postulaciones a solicitudes públicas ----
  // Lanza { code: 'P2002' } si ese prestador ya se postuló a la solicitud.
  guardarPostulacion(postulacion: PostulacionSolicitud): Promise<void>
  postulacionesDe(solicitudId: string): Promise<PostulacionSolicitud[]>
  postulacionesDePrestador(prestadorTenantId: string): Promise<PostulacionSolicitud[]>
  // Atómico: la solicitud (de la cuenta, pública, abierta y vigente) pasa a dirigida y 'aceptada'
  // para el postulante; esa postulación pendiente queda 'aceptada' y el resto de las pendientes
  // 'rechazada'. false (sin cambios) si alguna condición no se cumple.
  aceptarPostulacion(input: { solicitudId: string; cuentaId: string; postulacionId: string; ahora: number }): Promise<boolean>
  // Transición condicional pendiente -> rechazada|retirada. `prestadorTenantId` limita al dueño
  // de la postulación (retirar); `solicitudId` a la solicitud del cliente (rechazar).
  cerrarPostulacion(input: { postulacionId: string; estado: 'rechazada' | 'retirada'; solicitudId?: string; prestadorTenantId?: string; ahora: number }): Promise<boolean>
}

export interface CuentasSolicitudes {
  getAccount(accountId: string): Promise<{ displayName: string; status: string; emailVerifiedAt: number | null; tenantId: string } | undefined>
}

// Resuelve el prestador elegido por el cliente (directorio). Solo visibles y aprobados.
export interface DestinosSolicitud {
  destino(providerId: unknown): Promise<{ perfil: { id: string; tenantId: string; prestadorId: string; nombrePublico: string } } | null>
  perfilPorTenant(tenantId: string): Promise<{ id: string; nombrePublico: string } | null>
  // Prestador que puede postularse: perfil visible y prestador aprobado (de cualquier oficio).
  postulante(tenantId: string): Promise<{ perfil: { id: string; tenantId: string; prestadorId: string; nombrePublico: string } } | null>
  // Perfil público para mostrarle al cliente quién se postuló.
  perfilPublicoDe(tenantId: string): Promise<{ id: string; nombrePublico: string; oficio: string; zona: string } | null>
}
