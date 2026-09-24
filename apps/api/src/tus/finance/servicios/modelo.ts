import { createHash } from 'node:crypto'
import {
  ESTADOS_OBLIGACION_PAGO_SERVICIO,
  ESTADOS_PRESUPUESTO,
  ESTADOS_TRABAJO,
  ORIGENES_IMPORTE_OBLIGACION_SERVICIO,
  TUS_CONTRACT_VERSION,
  createNonNegativeMoney,
  formatMinorUnits,
  type EstadoObligacionPagoServicio,
  type EstadoPresupuesto,
  type ObligacionPagoServicio,
  type OrigenImporteObligacionServicio,
  type Trabajo,
} from '@factory/contracts'

// Domain model for WEB-09 service finance. Money is always `bigint` minor units plus an
// explicit ISO currency; contracts/HTTP receive decimal strings through the projections below.

export interface ContextoFinanzasServicio {
  tenantId: string
  actorId: string
  correlationId: string
}

export class ErrorFinanzasServicio extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ErrorFinanzasServicio'
    this.status = status
    this.code = code
  }
}

// Commercial facts read from persistence, never from the HTTP payload.
export interface CompromisoServicioFinanciero {
  tenantId: string
  commitmentId: string
  prestadorTenantId: string
  prestadorId: string
  publicacionId: string
  context: string
  status: string
  amountMinor: bigint
  currency: string
}

export interface PublicacionServicioFinanciera {
  tenantId: string
  publicacionId: string
  prestadorId: string
  kind: string
  priceMode: string | null
  // WEB-09D display name and category (commission policy scope); optional for legacy callers.
  nombre?: string | null
  categoria?: string | null
}

export interface PresupuestoFinanciero {
  tenantId: string
  prestadorTenantId: string
  trabajoId: string
  presupuestoId: string
  version: number
  status: EstadoPresupuesto
  currency: string
  totalMinor: bigint
}

export interface ObligacionServicio {
  obligacionId: string
  tenantId: string
  clienteId: string
  prestadorTenantId: string
  prestadorId: string
  publicacionId: string
  commitmentId: string
  trabajoId: string
  amountSource: OrigenImporteObligacionServicio
  budgetId: string | null
  budgetVersion: number | null
  amountMinor: bigint
  currency: string
  status: EstadoObligacionPagoServicio
  version: number
  actorId: string
  correlationId: string
  createdAt: string
  updatedAt: string
}

// Price modes whose published price is final. `precio_desde` and `por_hora` only state a
// starting point; their payable amount needs an accepted budget (pending product decision).
const MODOS_PRECIO_FINAL = new Set<string | null>([null, 'fixed', 'precio_fijo'])
const ESTADOS_COMPROMISO_COBRABLES = new Set(['pending', 'confirmed', 'fulfilled'])
const ESTADOS_TRABAJO_CON_PRESUPUESTO_ACEPTADO = new Set<string>([
  ESTADOS_TRABAJO.ACEPTADO,
  ESTADOS_TRABAJO.EN_PROGRESO,
  ESTADOS_TRABAJO.COMPLETADO,
])
const ESTADOS_TRABAJO_PRECIO_FIJO = new Set<string>([
  ESTADOS_TRABAJO.SOLICITADO,
  ESTADOS_TRABAJO.EN_DIAGNOSTICO,
  ESTADOS_TRABAJO.EN_PROGRESO,
  ESTADOS_TRABAJO.COMPLETADO,
])

export function identificadorObligacion(trabajoId: string): string {
  return `obligacion-${trabajoId}`
}

// Validates the whole chain Publicacion -> CompromisoMercadoServicios -> Trabajo -> Presupuesto
// and derives the payable amount. Throws instead of guessing when the chain is inconsistent.
export function derivarObligacionServicio(input: {
  context: ContextoFinanzasServicio
  trabajo: Trabajo
  compromiso: CompromisoServicioFinanciero
  publicacion: PublicacionServicioFinanciera
  presupuesto: PresupuestoFinanciero | null
  now: string
}): ObligacionServicio {
  const { trabajo, compromiso, publicacion, presupuesto } = input
  const cadenaConsistente =
    compromiso.tenantId === trabajo.tenantId &&
    compromiso.commitmentId === trabajo.commitmentId &&
    compromiso.prestadorTenantId === trabajo.prestadorTenantId &&
    compromiso.prestadorId === trabajo.prestadorId &&
    compromiso.publicacionId === trabajo.publicacionId &&
    publicacion.tenantId === trabajo.prestadorTenantId &&
    publicacion.prestadorId === trabajo.prestadorId &&
    publicacion.publicacionId === trabajo.publicacionId
  if (!cadenaConsistente)
    throw new ErrorFinanzasServicio(
      409,
      'INCONSISTENT_COMMERCIAL_CHAIN',
      'work, commitment and publication do not describe the same service'
    )
  if (compromiso.context !== 'service' || publicacion.kind !== 'service')
    throw new ErrorFinanzasServicio(
      409,
      'INVALID_COMMITMENT',
      'only service commitments produce a service payment obligation'
    )
  if (!ESTADOS_COMPROMISO_COBRABLES.has(compromiso.status))
    throw new ErrorFinanzasServicio(
      409,
      'INVALID_COMMITMENT_STATUS',
      'commitment is not payable in its current state'
    )
  if (trabajo.status === ESTADOS_TRABAJO.CANCELADO)
    throw new ErrorFinanzasServicio(
      409,
      'WORK_CANCELLED',
      'cancelled work cannot produce a payment obligation'
    )

  const clienteId = trabajo.clienteId ?? trabajo.tenantId
  const base = {
    obligacionId: identificadorObligacion(trabajo.trabajoId),
    tenantId: trabajo.tenantId,
    clienteId,
    prestadorTenantId: trabajo.prestadorTenantId,
    prestadorId: trabajo.prestadorId,
    publicacionId: trabajo.publicacionId,
    commitmentId: trabajo.commitmentId,
    trabajoId: trabajo.trabajoId,
    status: ESTADOS_OBLIGACION_PAGO_SERVICIO.PENDIENTE_PAGO,
    version: 1,
    actorId: input.context.actorId,
    correlationId: input.context.correlationId,
    createdAt: input.now,
    updatedAt: input.now,
  }

  if (trabajo.acceptedBudgetId || trabajo.budgetRequired) {
    if (
      !trabajo.acceptedBudgetId ||
      !trabajo.acceptedBudgetVersion ||
      !ESTADOS_TRABAJO_CON_PRESUPUESTO_ACEPTADO.has(trabajo.status)
    )
      throw new ErrorFinanzasServicio(
        409,
        'BUDGET_NOT_ACCEPTED',
        'an accepted budget is required before a payment obligation exists'
      )
    if (
      !presupuesto ||
      presupuesto.presupuestoId !== trabajo.acceptedBudgetId ||
      presupuesto.version !== trabajo.acceptedBudgetVersion ||
      presupuesto.trabajoId !== trabajo.trabajoId ||
      presupuesto.tenantId !== trabajo.tenantId ||
      presupuesto.prestadorTenantId !== trabajo.prestadorTenantId ||
      presupuesto.status !== ESTADOS_PRESUPUESTO.ACEPTADO
    )
      throw new ErrorFinanzasServicio(
        409,
        'INCONSISTENT_BUDGET',
        'accepted budget does not match the work'
      )
    const money = createNonNegativeMoney(presupuesto.currency, presupuesto.totalMinor)
    return {
      ...base,
      amountSource: ORIGENES_IMPORTE_OBLIGACION_SERVICIO.PRESUPUESTO_ACEPTADO,
      budgetId: presupuesto.presupuestoId,
      budgetVersion: presupuesto.version,
      amountMinor: money.minor,
      currency: money.currency,
    }
  }

  if (!MODOS_PRECIO_FINAL.has(publicacion.priceMode))
    throw new ErrorFinanzasServicio(
      409,
      'AMOUNT_NOT_FINAL',
      'publication price is not final; an accepted budget is required'
    )
  if (!ESTADOS_TRABAJO_PRECIO_FIJO.has(trabajo.status))
    throw new ErrorFinanzasServicio(409, 'AMOUNT_NOT_FINAL', 'work is negotiating a budget')
  const money = createNonNegativeMoney(compromiso.currency, compromiso.amountMinor)
  return {
    ...base,
    amountSource: ORIGENES_IMPORTE_OBLIGACION_SERVICIO.PRECIO_FIJO_COMPROMISO,
    budgetId: null,
    budgetVersion: null,
    amountMinor: money.minor,
    currency: money.currency,
  }
}

// Only transitions backed by a real capability (provider events processed in WEB-09B).
const TRANSICIONES_OBLIGACION: Readonly<
  Record<EstadoObligacionPagoServicio, readonly EstadoObligacionPagoServicio[]>
> = {
  pending_payment: ['paid'],
  paid: ['refunded', 'charged_back'],
  refunded: [],
  charged_back: [],
}

export function esTransicionObligacionPermitida(
  desde: EstadoObligacionPagoServicio,
  hacia: EstadoObligacionPagoServicio
): boolean {
  return (TRANSICIONES_OBLIGACION[desde] ?? []).includes(hacia)
}

export function transicionarObligacion(
  obligacion: ObligacionServicio,
  hacia: EstadoObligacionPagoServicio,
  now: string
): ObligacionServicio {
  if (!esTransicionObligacionPermitida(obligacion.status, hacia))
    throw new ErrorFinanzasServicio(
      409,
      'INVALID_TRANSITION',
      `obligation cannot move from ${obligacion.status} to ${hacia}`
    )
  return { ...obligacion, status: hacia, version: obligacion.version + 1, updatedAt: now }
}

export function proyectarObligacion(obligacion: ObligacionServicio): ObligacionPagoServicio {
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    obligacionId: obligacion.obligacionId,
    tenantId: obligacion.tenantId,
    clienteId: obligacion.clienteId,
    prestadorTenantId: obligacion.prestadorTenantId,
    prestadorId: obligacion.prestadorId,
    publicacionId: obligacion.publicacionId,
    commitmentId: obligacion.commitmentId,
    trabajoId: obligacion.trabajoId,
    amountSource: obligacion.amountSource,
    budgetId: obligacion.budgetId,
    budgetVersion: obligacion.budgetVersion,
    amountMinor: formatMinorUnits(obligacion.amountMinor),
    currency: obligacion.currency,
    status: obligacion.status,
    version: obligacion.version,
    createdAt: obligacion.createdAt,
    updatedAt: obligacion.updatedAt,
  }
}

// Financial idempotency: tenant-scoped key; the request fingerprint is computed server-side
// from the canonical command so a client cannot replay a key with a different intent.
export interface RegistroIdempotenciaFinanciera {
  requestHash: string
  response: Record<string, unknown>
}

export function huellaSolicitudFinanciera(
  operation: string,
  payload: Record<string, unknown>
): string {
  return createHash('sha256')
    .update(JSON.stringify([operation, ordenarClaves(payload)]))
    .digest('hex')
}

export function resolverIdempotenciaFinanciera(
  existing: RegistroIdempotenciaFinanciera | null,
  requestHash: string
): { status: 'new' } | { status: 'replay'; response: Record<string, unknown> } {
  if (!existing) return { status: 'new' }
  if (existing.requestHash !== requestHash)
    throw new ErrorFinanzasServicio(
      409,
      'IDEMPOTENCY_CONFLICT',
      'idempotency key was already used for another financial request'
    )
  return { status: 'replay', response: structuredClone(existing.response) }
}

export function validarContextoFinanzasServicio(context: ContextoFinanzasServicio): void {
  if (!context.tenantId?.trim() || !context.actorId?.trim() || !context.correlationId?.trim())
    throw new ErrorFinanzasServicio(
      400,
      'INVALID_CONTEXT',
      'financial authorization context is required'
    )
}

export function validarClaveIdempotencia(key: string): string {
  const normalized = typeof key === 'string' ? key.trim() : ''
  if (!normalized || normalized.length > 200)
    throw new ErrorFinanzasServicio(400, 'INVALID', 'idempotency key is required')
  return normalized
}

function ordenarClaves(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordenarClaves)
  if (typeof value === 'bigint') return value.toString(10)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, ordenarClaves(entry)])
    )
  return value
}
