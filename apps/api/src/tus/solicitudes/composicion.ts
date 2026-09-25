import { AlmacenSolicitudesEnMemoria, AlmacenSolicitudesPrisma, type ClientePrismaSolicitudes } from './almacenes.ts'
import type { CuentasSolicitudes } from './puertos.ts'
import { ServicioSolicitudes } from './servicio.ts'

export function crearServicioSolicitudes(input: { cuentas: CuentasSolicitudes; prisma?: ClientePrismaSolicitudes; now?: () => number; newId?: () => string }): ServicioSolicitudes {
  return new ServicioSolicitudes({
    almacen: input.prisma ? new AlmacenSolicitudesPrisma(input.prisma) : new AlmacenSolicitudesEnMemoria(),
    cuentas: input.cuentas,
    ...(input.now ? { now: input.now } : {}),
    ...(input.newId ? { newId: input.newId } : {}),
  })
}
