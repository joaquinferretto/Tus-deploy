import type { TusApplicationService } from '../application/tus-application-service.ts'
import {
  AlmacenPerfilesEnMemoria,
  AlmacenPerfilesPrisma,
  FuentesDirectorioTus,
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
  now?: () => number
  newId?: () => string
}): ServicioDirectorio {
  const contar = input.contarCompletados ?? (input.prisma ? contarCompletadosPrisma(input.prisma) : async () => 0)
  return new ServicioDirectorio({
    perfiles: input.prisma ? new AlmacenPerfilesPrisma(input.prisma) : new AlmacenPerfilesEnMemoria(),
    fuentes: new FuentesDirectorioTus(input.application, contar),
    ...(input.now ? { now: input.now } : {}),
    ...(input.newId ? { newId: input.newId } : {}),
  })
}
