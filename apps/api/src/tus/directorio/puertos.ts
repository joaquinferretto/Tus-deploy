import type { HechosPrestador, PerfilPublico } from './modelo.ts'
import type { OficioId } from './oficios.ts'

export interface AlmacenPerfiles {
  // Crea o reemplaza el perfil del prestador del tenant (uno por prestador).
  guardar(perfil: PerfilPublico): Promise<void>
  porTenant(tenantId: string): Promise<PerfilPublico | null>
  porId(id: string): Promise<PerfilPublico | null>
  // Visibles, opcionalmente de un oficio; como máximo `limite`.
  visibles(input: { oficio?: OficioId; limite: number }): Promise<PerfilPublico[]>
}

// Hechos que el directorio lee de los módulos existentes (marketplace, identidad, trabajos).
export interface FuentesDirectorio {
  // El prestador (merchant) del tenant: id y si está aprobado para operar.
  prestador(tenantId: string): Promise<{ prestadorId: string; aprobado: boolean } | null>
  hechos(tenantId: string): Promise<HechosPrestador>
}
