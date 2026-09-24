import {
  TUS_CONTRACT_VERSION,
  parseMinorUnits,
  type EstadoObligacionPagoServicio,
  type EstadoPresupuesto,
  type OrigenImporteObligacionServicio,
  type Trabajo,
} from '@factory/contracts'
import {
  ErrorFinanzasServicio,
  type ObligacionServicio,
  type RegistroIdempotenciaFinanciera,
} from '../finance/servicios/modelo.ts'
import type {
  PuertoIdempotenciaFinanciera,
  PuertoIdentidadServicio,
  PuertoObligacionesServicio,
  PuertoTransaccionFinanzasServicio,
  RepositoriosFinanzasServicio,
} from '../finance/servicios/servicio.ts'
import { isSerializationFailure, isUniqueConstraint, mapTrabajo } from './prisma-work.ts'

type Fila = Record<string, unknown>

export interface DelegadoPrismaFinanzasServicio {
  findFirst(input: { where: Fila; orderBy?: Fila }): Promise<Fila | null>
  findMany(input: { where: Fila; orderBy?: Fila }): Promise<Fila[]>
  create(input: { data: Fila }): Promise<Fila>
  updateMany(input: { where: Fila; data: Fila }): Promise<{ count: number }>
}

export interface ClientePrismaFinanzasServicio {
  trabajo: DelegadoPrismaFinanzasServicio
  compromisoMercadoServicios: DelegadoPrismaFinanzasServicio
  publicacion: DelegadoPrismaFinanzasServicio
  presupuesto: DelegadoPrismaFinanzasServicio
  obligacionPagoServicio: DelegadoPrismaFinanzasServicio
  idempotenciaFinanciera: DelegadoPrismaFinanzasServicio
  $transaction<T>(
    callback: (client: ClientePrismaFinanzasServicio) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' }
  ): Promise<T>
}

export class IdentidadServicioPrisma implements PuertoIdentidadServicio {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async buscarTrabajoAccesible(input: {
    tenantId: string
    trabajoId: string
  }): Promise<Trabajo | null> {
    const row = await this.client.trabajo.findFirst({
      where: {
        trabajoId: input.trabajoId,
        OR: [{ tenantId: input.tenantId }, { prestadorTenantId: input.tenantId }],
      },
    })
    return row ? mapTrabajo(row) : null
  }

  async buscarCompromiso(input: { tenantId: string; commitmentId: string }) {
    const row = await this.client.compromisoMercadoServicios.findFirst({
      where: { tenantId: input.tenantId, compromisoId: input.commitmentId },
    })
    if (!row) return null
    return {
      tenantId: texto(row, 'tenantId'),
      commitmentId: texto(row, 'compromisoId'),
      prestadorTenantId: texto(row, 'prestadorTenantId'),
      prestadorId: texto(row, 'prestadorId'),
      publicacionId: texto(row, 'publicacionId'),
      context: texto(row, 'contexto'),
      status: texto(row, 'estado'),
      amountMinor: parseMinorUnits(row['monto']),
      currency: texto(row, 'moneda').toUpperCase(),
    }
  }

  async buscarPublicacion(input: { prestadorTenantId: string; publicacionId: string }) {
    const row = await this.client.publicacion.findFirst({
      where: { tenantId: input.prestadorTenantId, id: input.publicacionId },
    })
    if (!row) return null
    return {
      tenantId: texto(row, 'tenantId'),
      publicacionId: texto(row, 'id'),
      prestadorId: texto(row, 'prestadorId'),
      kind: texto(row, 'tipo'),
      priceMode: textoNullable(row, 'modalidadPrecio'),
    }
  }

  async buscarPresupuesto(input: {
    tenantId: string
    trabajoId: string
    presupuestoId: string
    version: number
  }) {
    const row = await this.client.presupuesto.findFirst({
      where: {
        tenantId: input.tenantId,
        trabajoId: input.trabajoId,
        presupuestoId: input.presupuestoId,
        version: input.version,
      },
    })
    if (!row) return null
    return {
      tenantId: texto(row, 'tenantId'),
      prestadorTenantId: texto(row, 'prestadorTenantId'),
      trabajoId: texto(row, 'trabajoId'),
      presupuestoId: texto(row, 'presupuestoId'),
      version: Number(row['version']),
      status: texto(row, 'estado') as EstadoPresupuesto,
      currency: texto(row, 'moneda').toUpperCase(),
      totalMinor: parseMinorUnits(row['montoTotal']),
    }
  }
}

export class ObligacionesServicioPrisma implements PuertoObligacionesServicio {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async buscarPorTrabajo(input: {
    tenantId: string
    trabajoId: string
  }): Promise<ObligacionServicio | null> {
    const row = await this.client.obligacionPagoServicio.findFirst({
      where: { tenantId: input.tenantId, trabajoId: input.trabajoId },
    })
    return row ? mapearObligacion(row) : null
  }

  async crear(obligacion: ObligacionServicio): Promise<void> {
    await this.client.obligacionPagoServicio.create({ data: filaObligacion(obligacion) })
  }

  async actualizar(input: {
    obligacion: ObligacionServicio
    expectedVersion: number
  }): Promise<ObligacionServicio | null> {
    const { obligacion } = input
    const result = await this.client.obligacionPagoServicio.updateMany({
      where: {
        tenantId: obligacion.tenantId,
        obligacionId: obligacion.obligacionId,
        version: input.expectedVersion,
      },
      data: {
        estado: obligacion.status,
        version: obligacion.version,
        fechaActualizacion: new Date(obligacion.updatedAt),
      },
    })
    return result.count === 1 ? obligacion : null
  }
}

export class IdempotenciaFinancieraPrisma implements PuertoIdempotenciaFinanciera {
  constructor(private readonly client: ClientePrismaFinanzasServicio) {}

  async buscar(input: {
    tenantId: string
    key: string
  }): Promise<RegistroIdempotenciaFinanciera | null> {
    const row = await this.client.idempotenciaFinanciera.findFirst({
      where: { tenantId: input.tenantId, claveIdempotencia: input.key },
    })
    if (!row) return null
    const response = row['respuesta']
    if (!response || typeof response !== 'object' || Array.isArray(response))
      throw new ErrorFinanzasServicio(
        500,
        'INVALID_REPLAY',
        'financial idempotency replay is invalid'
      )
    return {
      requestHash: texto(row, 'hashSolicitud'),
      response: response as Record<string, unknown>,
    }
  }

  // Insert-only: a concurrent claim of the same key fails with P2002 and the whole
  // transaction is retried, where it observes the committed record as replay or conflict.
  async registrar(input: {
    tenantId: string
    key: string
    record: RegistroIdempotenciaFinanciera
  }): Promise<void> {
    await this.client.idempotenciaFinanciera.create({
      data: {
        id: `finanzas-servicio-${input.tenantId}-${input.key}`,
        tenantId: input.tenantId,
        claveIdempotencia: input.key,
        hashSolicitud: input.record.requestHash,
        respuesta: input.record.response,
      },
    })
  }
}

export class TransaccionFinanzasServicioPrisma implements PuertoTransaccionFinanzasServicio {
  constructor(protected readonly client: ClientePrismaFinanzasServicio) {}

  async ejecutar<T>(
    operation: (repositories: RepositoriosFinanzasServicio) => Promise<T>
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.client.$transaction((client) => operation(this.repositorios(client)), {
          isolationLevel: 'Serializable',
        })
      } catch (error) {
        if (!isSerializationFailure(error) && !isUniqueConstraint(error)) throw error
        if (attempt === 2)
          throw new ErrorFinanzasServicio(
            409,
            'CONCURRENT_MODIFICATION',
            'financial state changed concurrently; retry the request'
          )
      }
    }
    throw new Error('financial transaction retry limit exceeded')
  }

  protected repositorios(client: ClientePrismaFinanzasServicio): RepositoriosFinanzasServicio {
    return {
      identidad: new IdentidadServicioPrisma(client),
      obligaciones: new ObligacionesServicioPrisma(client),
      idempotencia: new IdempotenciaFinancieraPrisma(client),
    }
  }
}

export function filaObligacion(obligacion: ObligacionServicio): Fila {
  return {
    id: obligacion.obligacionId,
    versionContrato: TUS_CONTRACT_VERSION,
    obligacionId: obligacion.obligacionId,
    tenantId: obligacion.tenantId,
    clienteId: obligacion.clienteId,
    prestadorTenantId: obligacion.prestadorTenantId,
    prestadorId: obligacion.prestadorId,
    publicacionId: obligacion.publicacionId,
    compromisoId: obligacion.commitmentId,
    trabajoId: obligacion.trabajoId,
    origenImporte: obligacion.amountSource,
    presupuestoId: obligacion.budgetId,
    presupuestoVersion: obligacion.budgetVersion,
    monto: obligacion.amountMinor,
    moneda: obligacion.currency,
    estado: obligacion.status,
    version: obligacion.version,
    actorId: obligacion.actorId,
    correlacionId: obligacion.correlationId,
    fechaCreacion: new Date(obligacion.createdAt),
    fechaActualizacion: new Date(obligacion.updatedAt),
  }
}

export function mapearObligacion(row: Fila): ObligacionServicio {
  return {
    obligacionId: texto(row, 'obligacionId'),
    tenantId: texto(row, 'tenantId'),
    clienteId: texto(row, 'clienteId'),
    prestadorTenantId: texto(row, 'prestadorTenantId'),
    prestadorId: texto(row, 'prestadorId'),
    publicacionId: texto(row, 'publicacionId'),
    commitmentId: texto(row, 'compromisoId'),
    trabajoId: texto(row, 'trabajoId'),
    amountSource: texto(row, 'origenImporte') as OrigenImporteObligacionServicio,
    budgetId: textoNullable(row, 'presupuestoId'),
    budgetVersion:
      row['presupuestoVersion'] === null || row['presupuestoVersion'] === undefined
        ? null
        : Number(row['presupuestoVersion']),
    amountMinor: parseMinorUnits(row['monto']),
    currency: texto(row, 'moneda'),
    status: texto(row, 'estado') as EstadoObligacionPagoServicio,
    version: Number(row['version']),
    actorId: texto(row, 'actorId'),
    correlationId: texto(row, 'correlacionId'),
    createdAt: fecha(row, 'fechaCreacion'),
    updatedAt: fecha(row, 'fechaActualizacion'),
  }
}

export function texto(row: Fila, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`finance persistence field ${key} is invalid`)
  return value
}

export function textoNullable(row: Fila, key: string): string | null {
  return row[key] === null || row[key] === undefined ? null : texto(row, key)
}

export function fecha(row: Fila, key: string): string {
  const value = row[key]
  const date = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(date.getTime()))
    throw new Error(`finance persistence date ${key} is invalid`)
  return date.toISOString()
}

export default { TransaccionFinanzasServicioPrisma }
