import { PrismaTrabajoOutboxStore, PrismaTrabajoStore } from '../adapters/prisma-work.ts'
import type { TusPrismaClient } from '../adapters/prisma.ts'
import type { ComandoCrearTrabajoDesdeSolicitud, ServicioTrabajo } from '../work/index.ts'
import { AlmacenUrgentesPrisma, type ClientePrismaUrgentes } from './almacen.ts'
import { VIGENCIA_URGENTE_MINUTOS } from './modelo.ts'
import type { CandidatosUrgentes, CuentasUrgentes, DatosTrabajoUrgente, NotificadorUrgentes, TrabajosUrgentes } from './puertos.ts'
import { ServicioUrgentes } from './servicio.ts'

const comando = (datos: DatosTrabajoUrgente): ComandoCrearTrabajoDesdeSolicitud => ({
  tenantId: datos.cliente.tenantId,
  actorId: datos.actorId,
  correlationId: datos.correlationId,
  solicitudId: datos.solicitudId,
  prestadorTenantId: datos.prestadorTenantId,
  prestadorId: datos.prestadorId,
  createdAt: new Date(datos.ahora).toISOString(),
})

// The ONE work of an urgent request, written by the work service with the SAME transactional
// client that assigns the request: both commit or roll back together.
export function trabajosUrgentesPrisma(work: ServicioTrabajo): TrabajosUrgentes {
  const repos = (tx: unknown) => ({ work: new PrismaTrabajoStore(tx as TusPrismaClient), outbox: new PrismaTrabajoOutboxStore(tx as TusPrismaClient) })
  return {
    async crear(tx, datos) {
      return { trabajoId: (await work.crearDesdeSolicitud(repos(tx), comando(datos))).work.trabajoId }
    },
    async reasignar(tx, datos) {
      return { trabajoId: (await work.reasignarDesdeSolicitud(repos(tx), comando(datos))).work.trabajoId }
    },
    async liberar(tx, datos) {
      const base = comando(datos)
      return (await work.liberarPorRenuncia(repos(tx), { tenantId: base.tenantId, actorId: base.actorId, correlationId: base.correlationId, createdAt: base.createdAt, solicitudId: datos.solicitudId, prestadorTenantId: datos.prestadorTenantId, reason: datos.motivo ?? '' })).resultado
    },
  }
}

// TUS_URGENTE_VIGENCIA_MINUTOS: how long an urgent request waits to be taken (1..1440).
export function vigenciaUrgenteDesdeEnv(env: Record<string, string | undefined>): number {
  const valor = Number.parseInt(env['TUS_URGENTE_VIGENCIA_MINUTOS'] ?? '', 10)
  return Number.isInteger(valor) && valor >= 1 && valor <= 24 * 60 ? valor : VIGENCIA_URGENTE_MINUTOS
}

export function crearServicioUrgentes(input: {
  prisma: ClientePrismaUrgentes
  cuentas: CuentasUrgentes
  candidatos: CandidatosUrgentes
  trabajos?: ServicioTrabajo
  notificador?: NotificadorUrgentes | null
  publicadasDesde?: (cuentaId: string, desde: number) => Promise<number>
  env?: Record<string, string | undefined>
  now?: () => number
  newId?: () => string
  log?: (evento: string, campos: Record<string, unknown>) => void
}): ServicioUrgentes {
  return new ServicioUrgentes({
    almacen: new AlmacenUrgentesPrisma(input.prisma, input.trabajos ? trabajosUrgentesPrisma(input.trabajos) : null),
    cuentas: input.cuentas,
    candidatos: input.candidatos,
    notificador: input.notificador ?? null,
    ...(input.publicadasDesde ? { publicadasDesde: input.publicadasDesde } : {}),
    vigenciaMinutos: vigenciaUrgenteDesdeEnv(input.env ?? process.env),
    ...(input.now ? { now: input.now } : {}),
    ...(input.newId ? { newId: input.newId } : {}),
    ...(input.log ? { log: input.log } : {}),
  })
}
