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
  return new ServicioDirectorio({
    perfiles: input.prisma ? new AlmacenPerfilesPrisma(input.prisma) : new AlmacenPerfilesEnMemoria(),
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
