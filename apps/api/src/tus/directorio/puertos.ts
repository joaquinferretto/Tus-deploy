import type { HechosPrestador, PerfilPublico } from './modelo.ts'
import type { AreaDomicilioFallback } from './ubicacion.ts'
import type { OficioId } from './oficios.ts'

export interface AlmacenPerfiles {
  // Crea o reemplaza el perfil del prestador del tenant (uno por prestador).
  guardar(perfil: PerfilPublico): Promise<void>
  porTenant(tenantId: string): Promise<PerfilPublico | null>
  porTenants(tenantIds: readonly string[]): Promise<PerfilPublico[]>
  porId(id: string): Promise<PerfilPublico | null>
  // Visibles, opcionalmente de un oficio; como máximo `limite`.
  // `oficios`: providers offering ANY of them (a category filter passes all its services).
  visibles(input: { oficio?: OficioId; oficios?: readonly OficioId[]; limite: number }): Promise<PerfilPublico[]>
  // Todos (visibles u ocultos), para la administración de la plataforma.
  todos(input: { limite: number }): Promise<PerfilPublico[]>
  // Ids de tenant con perfil (distintos), sin traer perfiles.
  tenants(): Promise<string[]>
  paginaAdmin(input: { pagina: number; tamano: number; q: string; oficio: string; zona: string; visible: boolean | null; verificado: boolean | null }): Promise<{ items: PerfilPublico[]; total: number }>
}

// Hechos que el directorio lee de los módulos existentes (marketplace, identidad, trabajos).
export interface FuentesDirectorio {
  // El prestador (merchant) del tenant: id y si está aprobado para operar.
  prestador(tenantId: string): Promise<{ prestadorId: string; aprobado: boolean } | null>
  hechos(tenantId: string): Promise<HechosPrestador>
  // FASE 10 admin: Mercado Pago link status (never tokens) and completed works of many providers,
  // one read per source.
  operacionAdmin?(tenantIds: readonly string[]): Promise<Map<string, { mercadoPago: string; completados: number }>>
  // Ratings of many providers in ONE grouped read (never one per profile).
  calificaciones?(tenantIds: readonly string[]): Promise<Map<string, { average: number; count: number }>>
  ubicacionIdentidadVerificada?(tenantId: string): Promise<AreaDomicilioFallback | null>
  // Public map/list: the facts of MANY providers in a fixed number of batched reads (merchants,
  // listings, identity, completed works), whatever the number of profiles.
  hechosLote?(tenantIds: readonly string[]): Promise<Map<string, { hechos: HechosPrestador; ubicacionVerificada: AreaDomicilioFallback | null }>>
  // Lo que la administración necesita de una página de perfiles, en lecturas por lote (una por
  // fuente, nunca una por prestador).
  resumenAdmin(tenantIds: readonly string[]): Promise<Map<string, ResumenAdminPrestador>>
}

export interface ResumenAdminPrestador {
  prestador: { prestadorId: string; aprobado: boolean } | null
  verificado: boolean
  ubicacionVerificada: AreaDomicilioFallback | null
}
