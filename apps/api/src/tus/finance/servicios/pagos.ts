import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  TUS_CONTRACT_VERSION,
  formatMinorUnits,
  majorDecimalToMinorUnits,
  minorUnitsToMajorDecimal,
  normalizeCurrency,
  type EstadoDespachoPagoServicio,
  type EstadoProveedorPagoServicio,
  type IntencionPagoServicio,
  type OrigenIntencionPagoServicio,
} from '@factory/contracts'
import { ErrorFinanzasServicio } from './modelo.ts'

// WEB-09B payment intent: local, durable record of the intention to collect an obligation.
// It never claims provider approval; provider state only changes through verified events.
export interface IntencionPagoServicioDominio {
  paymentId: string
  obligacionId: string
  trabajoId: string
  tenantId: string
  prestadorTenantId: string
  attempt: number
  amountMinor: bigint
  currency: string
  providerStatus: EstadoProveedorPagoServicio
  dispatchStatus: EstadoDespachoPagoServicio
  source: OrigenIntencionPagoServicio
  providerReference: string | null
  providerError: string | null
  providerEventAt: string | null
  idempotencyKey: string
  correlationId: string
  createdAt: string
  updatedAt: string
}

const TRANSICIONES_PROVEEDOR: Readonly<
  Record<EstadoProveedorPagoServicio, readonly EstadoProveedorPagoServicio[]>
> = {
  pending: ['approved', 'rejected', 'expired', 'cancelled'],
  approved: ['refunded', 'charged_back'],
  rejected: [],
  expired: [],
  cancelled: [],
  refunded: [],
  charged_back: [],
}

export function esTransicionProveedorPermitida(
  desde: EstadoProveedorPagoServicio,
  hacia: EstadoProveedorPagoServicio
): boolean {
  return (TRANSICIONES_PROVEEDOR[desde] ?? []).includes(hacia)
}

export function identificadorPago(obligacionId: string, attempt: number): string {
  return `pago-${obligacionId}-${attempt}`
}

export function proyectarIntencionPago(
  intent: IntencionPagoServicioDominio
): IntencionPagoServicio {
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    paymentId: intent.paymentId,
    obligacionId: intent.obligacionId,
    trabajoId: intent.trabajoId,
    tenantId: intent.tenantId,
    attempt: intent.attempt,
    provider: 'mercado-pago',
    amountMinor: formatMinorUnits(intent.amountMinor),
    currency: intent.currency,
    providerStatus: intent.providerStatus,
    dispatchStatus: intent.dispatchStatus,
    source: intent.source,
    providerReference: intent.providerReference,
    providerError: intent.providerError,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  }
}

// Provider-neutral view of a verified provider notification. Amounts are exact minor units.
export interface EventoPagoNormalizado {
  eventId: string
  providerReference: string
  paymentId: string
  status: EstadoProveedorPagoServicio | 'unknown'
  rawStatus: string
  amountMinor: bigint
  currency: string
  occurredAt: string
  // WEB-09D: PSP fee reported by the provider for an approval (exact minor units), if any.
  pspFeeMinor?: bigint | null
}

export interface EntradaEventoProveedor {
  rawBody: string
  signature: string
  receivedAt: string
}

// Canonical TUS payment provider boundary used by WEB-09B/C. The real Mercado Pago adapter
// (WEB-09E) must implement this port on top of `packages/mercado-pago`; tests use the fake.
export interface PuertoProveedorPagosServicio {
  readonly provider: 'mercado-pago'
  readonly source: OrigenIntencionPagoServicio
  crearPago(input: {
    paymentId: string
    idempotencyKey: string
    amountMinor: bigint
    currency: string
  }): Promise<{ providerReference: string }>
  verificarEvento(input: EntradaEventoProveedor): EventoPagoNormalizado
}

export class ErrorProveedorPagos extends Error {
  readonly code: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_REJECTED'

  constructor(code: ErrorProveedorPagos['code'], message: string) {
    super(message)
    this.name = 'ErrorProveedorPagos'
    this.code = code
  }
}

// Production default until WEB-09E: no network, no credentials, never approves anything.
export class ProveedorPagosServicioNoDisponible implements PuertoProveedorPagosServicio {
  readonly provider = 'mercado-pago' as const
  readonly source = 'held-no-provider' as const

  async crearPago(): Promise<{ providerReference: string }> {
    throw new ErrorProveedorPagos('PROVIDER_UNAVAILABLE', 'payment provider is not enabled')
  }

  verificarEvento(): EventoPagoNormalizado {
    throw new ErrorFinanzasServicio(
      503,
      'PROVIDER_UNAVAILABLE',
      'payment provider events are not enabled'
    )
  }
}

const MAPA_ESTADOS_FAKE: Readonly<Record<string, EstadoProveedorPagoServicio>> = {
  pending: 'pending',
  in_process: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  cancelled: 'cancelled',
  expired: 'expired',
  refunded: 'refunded',
  charged_back: 'charged_back',
}

// Deterministic, offline provider for tests and local fixtures. Its payload mimics the
// provider shape (major-unit decimal amount) so the boundary conversion is exercised.
export class ProveedorPagosServicioDeterminista implements PuertoProveedorPagosServicio {
  readonly provider = 'mercado-pago' as const
  readonly source = 'deterministic-test-only' as const
  readonly llamadas: string[] = []
  private fallasPendientes: ErrorProveedorPagos['code'][] = []

  constructor(private readonly secret: string) {
    if (!secret.trim()) throw new Error('deterministic provider requires a signing secret')
  }

  fallarProximas(...codes: ErrorProveedorPagos['code'][]): void {
    this.fallasPendientes.push(...codes)
  }

  async crearPago(input: {
    paymentId: string
    idempotencyKey: string
    amountMinor: bigint
    currency: string
  }): Promise<{ providerReference: string }> {
    this.llamadas.push(input.idempotencyKey)
    const falla = this.fallasPendientes.shift()
    if (falla) throw new ErrorProveedorPagos(falla, `deterministic provider ${falla}`)
    minorUnitsToMajorDecimal(input.amountMinor, input.currency)
    return { providerReference: `fake-mp-${input.paymentId}` }
  }

  firmar(rawBody: string): string {
    return firmarCuerpo(this.secret, rawBody)
  }

  verificarEvento(input: EntradaEventoProveedor): EventoPagoNormalizado {
    const expected = Buffer.from(firmarCuerpo(this.secret, input.rawBody), 'utf8')
    const supplied = Buffer.from(String(input.signature ?? ''), 'utf8')
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      throw new ErrorFinanzasServicio(
        401,
        'INVALID_SIGNATURE',
        'provider event signature is invalid'
      )
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(input.rawBody) as Record<string, unknown>
    } catch {
      throw new ErrorFinanzasServicio(400, 'INVALID_EVENT', 'provider event body is not JSON')
    }
    const data = (payload['data'] ?? {}) as Record<string, unknown>
    const eventId = String(payload['id'] ?? '')
    const providerReference = String(data['id'] ?? '')
    const paymentId = String(data['external_reference'] ?? '')
    const rawStatus = String(data['status'] ?? '')
    const currency = normalizeCurrency(String(data['currency_id'] ?? ''))
    const occurredAt = String(data['date_last_updated'] ?? '')
    if (!eventId || !providerReference || !paymentId || !Number.isFinite(Date.parse(occurredAt)))
      throw new ErrorFinanzasServicio(400, 'INVALID_EVENT', 'provider event identity is incomplete')
    return {
      eventId,
      providerReference,
      paymentId,
      rawStatus,
      status: MAPA_ESTADOS_FAKE[rawStatus] ?? 'unknown',
      amountMinor: majorDecimalToMinorUnits(String(data['transaction_amount'] ?? ''), currency),
      currency,
      pspFeeMinor:
        data['fee_amount'] === undefined
          ? null
          : majorDecimalToMinorUnits(String(data['fee_amount']), currency),
      occurredAt: new Date(occurredAt).toISOString(),
    }
  }
}

function firmarCuerpo(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
}
