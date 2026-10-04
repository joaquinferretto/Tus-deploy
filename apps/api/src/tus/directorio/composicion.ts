import type { GeocodificadorInverso } from '../geo/resolucion.ts'
import type { TusApplicationService } from '../application/tus-application-service.ts'
import {
  AlmacenPerfilesEnMemoria,
  AlmacenPerfilesPrisma,
  FuentesDirectorioTus,
  contarCompletadosLotePrisma,
  contarCompletadosPrisma,
  type ClientePrismaDirectorio,
} from './almacenes.ts'
import { AlmacenFotosPerfilEnMemoria, AlmacenFotosPerfilPrisma, type ClientePrismaFotosPerfil } from './foto.ts'
import { ServicioDirectorio } from './servicio.ts'

// Producción: perfiles en PostgreSQL y trabajos completados con un count de Prisma. Tests/local:
// perfiles en memoria y conteo inyectado.
export function crearServicioDirectorio(input: {
  application: TusApplicationService
  prisma?: ClientePrismaDirectorio
  contarCompletados?: (tenantId: string) => Promise<number>
  // Completed works of a whole page in one read (Prisma: a GROUP BY).
  contarCompletadosLote?: (tenantIds: readonly string[]) => Promise<Map<string, number>>
  // Ratings in one grouped read (reputation module).
  calificaciones?: (tenantIds: readonly string[]) => Promise<Map<string, { average: number; count: number }>>
  // Admin columns: Mercado Pago status + completed works (batched).
  operacionAdmin?: (tenantIds: readonly string[]) => Promise<Map<string, { mercadoPago: string; completados: number }>>
  now?: () => number
  newId?: () => string
  // Reverse geocoder used only when a saved point falls in no stored polygon.
  geocodificador?: GeocodificadorInverso | null
}): ServicioDirectorio {
  const contar = input.contarCompletados ?? (input.prisma ? contarCompletadosPrisma(input.prisma) : async () => 0)
  const memoria = input.prisma ? null : new AlmacenPerfilesEnMemoria()
  // Profile photos live next to the profiles: PostgreSQL in production, memory in tests. A legacy
  // Prisma double without the photo delegate simply has no photos.
  const conFotos = input.prisma && 'fotoPerfilPrestador' in input.prisma && '$transaction' in input.prisma
  const fotos = memoria
    ? new AlmacenFotosPerfilEnMemoria((perfilId, sha256) => {
        const perfil = memoria.perfiles.get(perfilId)
        if (perfil) memoria.perfiles.set(perfilId, { ...perfil, fotoSha256: sha256 })
      })
    : conFotos
      ? new AlmacenFotosPerfilPrisma(input.prisma as unknown as ClientePrismaFotosPerfil)
      : null
  return new ServicioDirectorio({
    perfiles: memoria ?? new AlmacenPerfilesPrisma(input.prisma!),
    fotos,
    fuentes: new FuentesDirectorioTus(
      input.application,
      contar,
      input.calificaciones,
      input.operacionAdmin,
      input.contarCompletadosLote ?? (!input.contarCompletados && input.prisma ? contarCompletadosLotePrisma(input.prisma) : undefined)
    ),
    ...(input.now ? { now: input.now } : {}),
    ...(input.newId ? { newId: input.newId } : {}),
    geocodificador: input.geocodificador ?? null,
  })
}
