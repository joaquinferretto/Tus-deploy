import { AlmacenSolicitudesEnMemoria, AlmacenSolicitudesPrisma, type ClientePrismaSolicitudes } from './almacenes.ts'
import type { CreadorTrabajoSolicitud, CuentasSolicitudes, DatosTrabajoDeSolicitud, DestinosSolicitud } from './puertos.ts'
import { ServicioSolicitudes } from './servicio.ts'
import { PrismaTrabajoOutboxStore, PrismaTrabajoStore } from '../adapters/prisma-work.ts'
import type { TusPrismaClient } from '../adapters/prisma.ts'
import type { ComandoCrearTrabajoDesdeSolicitud, ServicioTrabajo } from '../work/index.ts'

const comando = (datos: DatosTrabajoDeSolicitud): ComandoCrearTrabajoDesdeSolicitud => ({
  tenantId: datos.cliente.tenantId,
  actorId: datos.actorId,
  correlationId: datos.correlationId,
  solicitudId: datos.solicitudId,
  prestadorTenantId: datos.prestadorTenantId,
  prestadorId: datos.prestadorId,
  createdAt: new Date(datos.ahora).toISOString(),
})

// PostgreSQL: the work (and its transition, audit and outbox) is written with the SAME
// transactional client that assigns the request, so both commit or roll back together.
export function creadorTrabajoPrisma(work: ServicioTrabajo): CreadorTrabajoSolicitud {
  return {
    async crear(tx, datos) {
      const client = tx as TusPrismaClient
      const { work: creado } = await work.crearDesdeSolicitud(
        { work: new PrismaTrabajoStore(client), outbox: new PrismaTrabajoOutboxStore(client) },
        comando(datos)
      )
      return { trabajoId: creado.trabajoId }
    },
  }
}

// In-memory compositions (tests, local): the store reverts the assignment if this throws.
export function creadorTrabajoEnMemoria(work: ServicioTrabajo): CreadorTrabajoSolicitud {
  return {
    async crear(_tx, datos) {
      const { work: creado } = await work.crearDesdeSolicitudEnTransaccion(comando(datos))
      return { trabajoId: creado.trabajoId }
    },
  }
}

export function crearServicioSolicitudes(input: {
  cuentas: CuentasSolicitudes
  destinos?: DestinosSolicitud
  prisma?: ClientePrismaSolicitudes
  // Creates the work of every match (client picks an application / provider accepts a direct
  // request). Without it requests are only assigned (legacy compositions).
  trabajos?: ServicioTrabajo
  now?: () => number
  newId?: () => string
}): ServicioSolicitudes {
  const almacen = input.prisma
    ? new AlmacenSolicitudesPrisma(input.prisma, input.trabajos ? creadorTrabajoPrisma(input.trabajos) : null)
    : new AlmacenSolicitudesEnMemoria(input.trabajos ? creadorTrabajoEnMemoria(input.trabajos) : null)
  return new ServicioSolicitudes({
    almacen,
    cuentas: input.cuentas,
    ...(input.destinos ? { destinos: input.destinos } : {}),
    ...(input.now ? { now: input.now } : {}),
    ...(input.newId ? { newId: input.newId } : {}),
  })
}
