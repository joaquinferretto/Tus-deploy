import type { ObligacionPagoServicio, Trabajo } from '@factory/contracts'
import {
  ErrorFinanzasServicio,
  derivarObligacionServicio,
  huellaSolicitudFinanciera,
  proyectarObligacion,
  resolverIdempotenciaFinanciera,
  validarClaveIdempotencia,
  validarContextoFinanzasServicio,
  type CompromisoServicioFinanciero,
  type ContextoFinanzasServicio,
  type ObligacionServicio,
  type PresupuestoFinanciero,
  type PublicacionServicioFinanciera,
  type RegistroIdempotenciaFinanciera,
} from './modelo.ts'

// Reads the WEB-08 commercial chain inside the finance transaction. Every lookup is scoped:
// a work is visible only to its customer tenant or its provider tenant.
export interface PuertoIdentidadServicio {
  buscarTrabajoAccesible(input: { tenantId: string; trabajoId: string }): Promise<Trabajo | null>
  buscarCompromiso(input: {
    tenantId: string
    commitmentId: string
  }): Promise<CompromisoServicioFinanciero | null>
  buscarPublicacion(input: {
    prestadorTenantId: string
    publicacionId: string
  }): Promise<PublicacionServicioFinanciera | null>
  buscarPresupuesto(input: {
    tenantId: string
    trabajoId: string
    presupuestoId: string
    version: number
  }): Promise<PresupuestoFinanciero | null>
}

export interface PuertoObligacionesServicio {
  buscarPorTrabajo(input: {
    tenantId: string
    trabajoId: string
  }): Promise<ObligacionServicio | null>
  crear(obligacion: ObligacionServicio): Promise<void>
  actualizar(input: {
    obligacion: ObligacionServicio
    expectedVersion: number
  }): Promise<ObligacionServicio | null>
}

export interface PuertoIdempotenciaFinanciera {
  buscar(input: { tenantId: string; key: string }): Promise<RegistroIdempotenciaFinanciera | null>
  registrar(input: {
    tenantId: string
    key: string
    record: RegistroIdempotenciaFinanciera
  }): Promise<void>
}

export interface RepositoriosFinanzasServicio {
  identidad: PuertoIdentidadServicio
  obligaciones: PuertoObligacionesServicio
  idempotencia: PuertoIdempotenciaFinanciera
}

// Implementations run the callback in one serializable transaction (Prisma) or one
// serialized critical section (in-memory) and retry bounded serialization conflicts.
export interface PuertoTransaccionFinanzasServicio {
  ejecutar<T>(operation: (repositories: RepositoriosFinanzasServicio) => Promise<T>): Promise<T>
}

export type ResultadoObligacion = {
  status: 'executed' | 'replay'
  obligation: ObligacionPagoServicio
}

export class ServicioFinanzasServicios {
  private readonly transaction: PuertoTransaccionFinanzasServicio
  private readonly now: () => number

  constructor(
    transaction: PuertoTransaccionFinanzasServicio,
    now: () => number = () => Date.now()
  ) {
    this.transaction = transaction
    this.now = now
  }

  // Customer command: fixes the payable amount of a work from persisted commercial facts.
  async prepararObligacion(
    input: ContextoFinanzasServicio & { trabajoId: string; idempotencyKey: string }
  ): Promise<ResultadoObligacion> {
    validarContextoFinanzasServicio(input)
    const key = validarClaveIdempotencia(input.idempotencyKey)
    const requestHash = huellaSolicitudFinanciera('service-obligation.prepare', {
      trabajoId: input.trabajoId,
      actorId: input.actorId,
    })
    return this.transaction.ejecutar(async (repositories) => {
      const idempotency = resolverIdempotenciaFinanciera(
        await repositories.idempotencia.buscar({ tenantId: input.tenantId, key }),
        requestHash
      )
      if (idempotency.status === 'replay')
        return {
          status: 'replay',
          obligation: idempotency.response['obligation'] as ObligacionPagoServicio,
        }
      const obligation = await this.asegurarObligacion(repositories, input, input.trabajoId)
      const response = { obligation: proyectarObligacion(obligation) }
      await repositories.idempotencia.registrar({
        tenantId: input.tenantId,
        key,
        record: { requestHash, response },
      })
      return { status: 'executed', ...response }
    })
  }

  // Customer or provider read; other tenants receive NOT_FOUND to avoid existence leaks.
  async consultarObligacion(
    input: ContextoFinanzasServicio & { trabajoId: string }
  ): Promise<ObligacionPagoServicio | null> {
    validarContextoFinanzasServicio(input)
    return this.transaction.ejecutar(async (repositories) => {
      const trabajo = await this.requerirTrabajo(repositories, input, input.trabajoId)
      const obligation = await repositories.obligaciones.buscarPorTrabajo({
        tenantId: trabajo.tenantId,
        trabajoId: trabajo.trabajoId,
      })
      return obligation ? proyectarObligacion(obligation) : null
    })
  }

  protected async requerirTrabajo(
    repositories: RepositoriosFinanzasServicio,
    context: ContextoFinanzasServicio,
    trabajoId: string
  ): Promise<Trabajo> {
    const trabajo = await repositories.identidad.buscarTrabajoAccesible({
      tenantId: context.tenantId,
      trabajoId,
    })
    if (!trabajo) throw new ErrorFinanzasServicio(404, 'NOT_FOUND', 'work was not found')
    return trabajo
  }

  protected async asegurarObligacion(
    repositories: RepositoriosFinanzasServicio,
    context: ContextoFinanzasServicio,
    trabajoId: string
  ): Promise<ObligacionServicio> {
    const trabajo = await this.requerirTrabajo(repositories, context, trabajoId)
    if (trabajo.tenantId !== context.tenantId)
      throw new ErrorFinanzasServicio(
        403,
        'FORBIDDEN',
        'only the customer tenant can prepare the payment obligation'
      )
    const existing = await repositories.obligaciones.buscarPorTrabajo({
      tenantId: trabajo.tenantId,
      trabajoId: trabajo.trabajoId,
    })
    if (existing) {
      if (
        existing.commitmentId !== trabajo.commitmentId ||
        existing.prestadorTenantId !== trabajo.prestadorTenantId ||
        existing.budgetId !== (trabajo.acceptedBudgetId ?? null) ||
        existing.budgetVersion !== (trabajo.acceptedBudgetVersion ?? null)
      )
        throw new ErrorFinanzasServicio(
          409,
          'OBLIGATION_STALE',
          'payment obligation no longer matches the work'
        )
      return existing
    }
    const compromiso = await repositories.identidad.buscarCompromiso({
      tenantId: trabajo.tenantId,
      commitmentId: trabajo.commitmentId,
    })
    const publicacion = await repositories.identidad.buscarPublicacion({
      prestadorTenantId: trabajo.prestadorTenantId,
      publicacionId: trabajo.publicacionId,
    })
    if (!compromiso || !publicacion)
      throw new ErrorFinanzasServicio(
        409,
        'INCONSISTENT_COMMERCIAL_CHAIN',
        'work commercial references were not found'
      )
    const presupuesto =
      trabajo.acceptedBudgetId && trabajo.acceptedBudgetVersion
        ? await repositories.identidad.buscarPresupuesto({
            tenantId: trabajo.tenantId,
            trabajoId: trabajo.trabajoId,
            presupuestoId: trabajo.acceptedBudgetId,
            version: trabajo.acceptedBudgetVersion,
          })
        : null
    const obligation = derivarObligacionServicio({
      context,
      trabajo,
      compromiso,
      publicacion,
      presupuesto,
      now: new Date(this.now()).toISOString(),
    })
    await repositories.obligaciones.crear(obligation)
    return obligation
  }
}

export default { ServicioFinanzasServicios }
