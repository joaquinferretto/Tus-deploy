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
  visibles(input: { oficio?: OficioId; limite: number }): Promise<PerfilPublico[]>
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
  ubicacionIdentidadVerificada?(tenantId: string): Promise<AreaDomicilioFallback | null>
  // Lo que la administración necesita de una página de perfiles, en lecturas por lote (una por
  // fuente, nunca una por prestador).
  resumenAdmin(tenantIds: readonly string[]): Promise<Map<string, ResumenAdminPrestador>>
}

export interface ResumenAdminPrestador {
  prestador: { prestadorId: string; aprobado: boolean } | null
  verificado: boolean
  ubicacionVerificada: AreaDomicilioFallback | null
}
