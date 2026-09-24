import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  majorDecimalToMinorUnits,
  minorUnitsToMajorDecimal,
  normalizeCurrency,
  type EstadoProveedorPagoServicio,
} from '@factory/contracts'
import { ErrorFinanzasServicio } from './modelo.ts'
import {
  ErrorProveedorPagos,
  type EntradaEventoProveedor,
  type EventoPagoNormalizado,
  type PuertoProveedorPagosServicio,
  type ResultadoCheckout,
  type SolicitudCheckout,
} from './pagos.ts'

// WEB-09E: real Mercado Pago adapter for Split de Pagos 1:1 with Checkout Pro.
// - The preference is created with the SELLER access token (OAuth) and TUS's commission as
//   `marketplace_fee` (a fixed amount). The customer pays exactly the accepted budget.
// - Notifications are trusted only after verifying `x-signature` (HMAC-SHA256 over the manifest
//   `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, `ts` in MILLISECONDS) and then reading the
//   payment server-to-server; the notification body itself is never trusted for money.
// Official docs (2026-09): developers/es/docs/split-payments/split-1-1/integration-configuration/
// integrate-marketplace, checkout-pro-preferences/payment-notifications, reference create-preference,
// create-refund.

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface PuertoCuentasVendedor {
  tokenVigente(
    prestadorTenantId: string
  ): Promise<{ accessToken: string; externalAccountId: string }>
  cuentaPorExterna(
    externalAccountId: string
  ): Promise<{ prestadorTenantId: string; externalAccountId: string | null } | null>
}

export interface ConfiguracionProveedorMercadoPago {
  environment: 'sandbox' | 'production'
  webhookSecret: string
  notificationUrl: string
  webBaseUrl: string
  marketplace?: string | null
  apiBaseUrl?: string
  fetch?: FetchLike
  timeoutMs?: number
  signatureToleranceMs?: number
  now?: () => number
}

// Largest minor amount rendered exactly as a JSON number with two decimals.
const MAXIMO_MINOR_EXACTO = 900_719_925_474_099n
export const TOLERANCIA_FIRMA_MS = 5 * 60 * 1000

export class ProveedorPagosMercadoPago implements PuertoProveedorPagosServicio {
  readonly provider = 'mercado-pago' as const
  readonly source = 'authorized' as const
  readonly environment: 'sandbox' | 'production'

  constructor(
    private readonly config: ConfiguracionProveedorMercadoPago,
    private readonly cuentas: PuertoCuentasVendedor
  ) {
    if (!config.webhookSecret.trim()) throw new Error('Mercado Pago webhook secret is required')
    if (!/^https:\/\//u.test(config.notificationUrl))
      throw new Error('Mercado Pago notification URL must use HTTPS')
    this.environment = config.environment
  }

  async crearPago(input: SolicitudCheckout): Promise<ResultadoCheckout> {
    if (
      !input.prestadorTenantId ||
      input.commissionMinor === null ||
      input.commissionMinor === undefined
    )
      throw new ErrorProveedorPagos(
        'PROVIDER_REJECTED',
        'checkout requires the seller and a frozen commission'
      )
    if (input.amountMinor <= 0n || input.amountMinor > MAXIMO_MINOR_EXACTO)
      throw new ErrorProveedorPagos('PROVIDER_REJECTED', 'amount is outside the supported range')
    if (input.commissionMinor < 0n || input.commissionMinor > input.amountMinor)
      throw new ErrorProveedorPagos('PROVIDER_REJECTED', 'marketplace fee is outside the amount')
    const token = await this.tokenVendedor(input.prestadorTenantId)
    const back = `${this.config.webBaseUrl.replace(/\/+$/u, '')}/tus/compromisos?pago=retorno&trabajo=${encodeURIComponent(input.trabajoId ?? '')}`
    const body = {
      items: [
        {
          id: input.paymentId,
          title: (input.title ?? 'Servicio TUS').slice(0, 250),
          quantity: 1,
          currency_id: input.currency,
          unit_price: aNumeroExacto(input.amountMinor, input.currency),
        },
      ],
      external_reference: input.paymentId,
      marketplace_fee: aNumeroExacto(input.commissionMinor, input.currency),
      ...(this.config.marketplace ? { marketplace: this.config.marketplace } : {}),
      notification_url: this.config.notificationUrl,
      back_urls: { success: back, pending: back, failure: back },
      auto_return: 'approved',
      metadata: { tus_payment_id: input.paymentId },
    }
    const response = await this.request('POST', '/checkout/preferences', token.accessToken, body, {
      'X-Idempotency-Key': input.idempotencyKey,
    })
    const id = typeof response['id'] === 'string' ? response['id'] : ''
    const initPoint = typeof response['init_point'] === 'string' ? response['init_point'] : ''
    const sandboxPoint =
      typeof response['sandbox_init_point'] === 'string' ? response['sandbox_init_point'] : ''
    const checkoutUrl = this.environment === 'sandbox' ? sandboxPoint || initPoint : initPoint
    if (!id || !esUrlMercadoPago(checkoutUrl))
      throw new ErrorProveedorPagos(
        'PROVIDER_REJECTED',
        'Mercado Pago returned an invalid preference'
      )
    return { providerReference: null, checkoutReference: id, checkoutUrl, checkoutExpiresAt: null }
  }

  async verificarEvento(input: EntradaEventoProveedor): Promise<EventoPagoNormalizado> {
    verificarFirmaMercadoPago({
      secret: this.config.webhookSecret,
      signatureHeader: input.signature,
      requestId: input.requestId,
      dataId: input.dataId,
      nowMs: this.now(),
      toleranceMs: this.config.signatureToleranceMs ?? TOLERANCIA_FIRMA_MS,
    })
    let body: Record<string, unknown>
    try {
      body = JSON.parse(input.rawBody) as Record<string, unknown>
    } catch {
      throw new ErrorFinanzasServicio(400, 'INVALID_EVENT', 'notification body is not JSON')
    }
    const topic = String(body['type'] ?? body['topic'] ?? '')
    if (topic !== 'payment')
      throw new ErrorFinanzasServicio(
        202,
        'UNSUPPORTED_TOPIC',
        `notification topic ${topic || 'unknown'} is ignored`
      )
    const dataId = String(input.dataId ?? '')
    const bodyDataId = String((body['data'] as Record<string, unknown> | undefined)?.['id'] ?? '')
    // The signature covers the query `data.id`; a body pointing elsewhere is tampered.
    if (!dataId || bodyDataId.toLowerCase() !== dataId.toLowerCase())
      throw new ErrorFinanzasServicio(
        400,
        'INVALID_EVENT',
        'notification data id does not match the signature'
      )
    const collector = String(body['user_id'] ?? '')
    const cuenta = collector ? await this.cuentas.cuentaPorExterna(collector) : null
    if (!cuenta)
      throw new ErrorFinanzasServicio(
        202,
        'UNKNOWN_COLLECTOR',
        'notification belongs to no linked seller'
      )
    const token = await this.tokenVendedor(cuenta.prestadorTenantId)
    let payment: Record<string, unknown>
    try {
      payment = await this.request(
        'GET',
        `/v1/payments/${encodeURIComponent(dataId)}`,
        token.accessToken
      )
    } catch (error) {
      throw new ErrorFinanzasServicio(
        503,
        'PROVIDER_UNAVAILABLE',
        error instanceof ErrorProveedorPagos ? error.code : 'payment lookup failed'
      )
    }
    return normalizarPagoMercadoPago(payment, {
      expectedCollector: token.externalAccountId,
      notificationId: body['id'] === undefined ? null : String(body['id']),
    })
  }

  async reembolsar(input: {
    prestadorTenantId: string
    providerReference: string
    idempotencyKey: string
  }): Promise<{ providerRefundId: string }> {
    const token = await this.tokenVendedor(input.prestadorTenantId)
    // Total refund: official docs require an empty body.
    const response = await this.request(
      'POST',
      `/v1/payments/${encodeURIComponent(input.providerReference)}/refunds`,
      token.accessToken,
      undefined,
      { 'X-Idempotency-Key': input.idempotencyKey }
    )
    const id = response['id']
    if (typeof id !== 'string' && typeof id !== 'number')
      throw new ErrorProveedorPagos('PROVIDER_REJECTED', 'Mercado Pago returned no refund id')
    return { providerRefundId: String(id) }
  }

  private async tokenVendedor(prestadorTenantId: string) {
    try {
      return await this.cuentas.tokenVigente(prestadorTenantId)
    } catch {
      throw new ErrorProveedorPagos(
        'PROVIDER_ACCOUNT_NOT_CONNECTED',
        'seller account is not connected'
      )
    }
  }

  private now(): number {
    return this.config.now?.() ?? Date.now()
  }

  // Tokens only travel in the Authorization header; error bodies are reduced to a safe code.
  private async request(
    method: 'GET' | 'POST',
    path: string,
    accessToken: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<Record<string, unknown>> {
    const fetchImpl = this.config.fetch ?? (globalThis.fetch as unknown as FetchLike)
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await fetchImpl(
        `${this.config.apiBaseUrl ?? 'https://api.mercadopago.com'}${path}`,
        {
          method,
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${accessToken}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
        }
      )
    } catch (error) {
      throw new ErrorProveedorPagos(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'PROVIDER_TIMEOUT'
          : 'PROVIDER_UNAVAILABLE',
        'Mercado Pago is unreachable'
      )
    }
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (response.ok && payload && typeof payload === 'object') return payload
    if (response.status === 401 || response.status === 403)
      throw new ErrorProveedorPagos('PROVIDER_ACCOUNT_NOT_CONNECTED', 'seller token was rejected')
    if (response.status >= 500 || response.ok)
      throw new ErrorProveedorPagos('PROVIDER_UNAVAILABLE', `Mercado Pago HTTP ${response.status}`)
    throw new ErrorProveedorPagos(
      pareceSinFondos(payload) ? 'INSUFFICIENT_SELLER_FUNDS' : 'PROVIDER_REJECTED',
      `Mercado Pago rejected the request (HTTP ${response.status})`
    )
  }
}

// Split 1:1 refunds fail when the seller has no balance; Mercado Pago reports it in the error
// message/cause. The match is deliberately broad and only moves the refund to manual review.
function pareceSinFondos(payload: Record<string, unknown> | null): boolean {
  if (!payload) return false
  const text = JSON.stringify([
    payload['message'],
    payload['error'],
    payload['cause'],
  ]).toLowerCase()
  return /insufficient|saldo|fondos|balance|not enough money|without money/u.test(text)
}

export function verificarFirmaMercadoPago(input: {
  secret: string
  signatureHeader: string | undefined
  requestId: string | undefined
  dataId: string | undefined
  nowMs: number
  toleranceMs?: number
}): { timestampMs: number } {
  const parts = new Map<string, string>()
  for (const part of String(input.signatureHeader ?? '').split(',')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    parts.set(part.slice(0, index).trim(), part.slice(index + 1).trim())
  }
  const ts = parts.get('ts') ?? ''
  const v1 = parts.get('v1') ?? ''
  const timestampMs = Number(ts)
  if (!/^\d+$/u.test(ts) || !Number.isSafeInteger(timestampMs) || !/^[0-9a-f]{64}$/iu.test(v1))
    throw new ErrorFinanzasServicio(401, 'INVALID_SIGNATURE', 'x-signature header is malformed')
  // `ts` is in milliseconds (official docs); a seconds value is simply far in the past.
  if (Math.abs(input.nowMs - timestampMs) > (input.toleranceMs ?? TOLERANCIA_FIRMA_MS))
    throw new ErrorFinanzasServicio(
      401,
      'EXPIRED_SIGNATURE',
      'x-signature timestamp is outside tolerance'
    )
  const expected = createHmac('sha256', input.secret)
    .update(manifiestoMercadoPago({ dataId: input.dataId, requestId: input.requestId, ts }))
    .digest()
  const supplied = Buffer.from(v1, 'hex')
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied))
    throw new ErrorFinanzasServicio(401, 'INVALID_SIGNATURE', 'x-signature does not match')
  return { timestampMs }
}

// Official template: `id:[data.id_url];request-id:[x-request-id_header];ts:[ts_header];` with
// absent values removed and alphanumeric ids lower-cased.
export function manifiestoMercadoPago(input: {
  dataId?: string
  requestId?: string
  ts: string
}): string {
  return [
    input.dataId ? `id:${input.dataId.toLowerCase()};` : '',
    input.requestId ? `request-id:${input.requestId};` : '',
    `ts:${input.ts};`,
  ].join('')
}

export function firmarManifiestoMercadoPago(input: {
  secret: string
  dataId?: string
  requestId?: string
  ts: number
}): string {
  const v1 = createHmac('sha256', input.secret)
    .update(
      manifiestoMercadoPago({
        dataId: input.dataId,
        requestId: input.requestId,
        ts: String(input.ts),
      })
    )
    .digest('hex')
  return `ts=${input.ts},v1=${v1}`
}

const ESTADOS_MERCADO_PAGO: Readonly<Record<string, EstadoProveedorPagoServicio>> = {
  approved: 'approved',
  // `authorized` means authorized but not captured: money is not collected yet.
  authorized: 'pending',
  pending: 'pending',
  in_process: 'pending',
  in_mediation: 'pending',
  rejected: 'rejected',
  cancelled: 'cancelled',
  refunded: 'refunded',
  charged_back: 'charged_back',
}

// Maps the payment read from Mercado Pago. Partial refunds keep `approved` with
// `status_detail=partially_refunded`; TUS only models total refunds (documented limitation).
export function normalizarPagoMercadoPago(
  payment: Record<string, unknown>,
  options: { expectedCollector: string; notificationId: string | null }
): EventoPagoNormalizado {
  const providerReference = String(payment['id'] ?? '')
  const paymentId = String(payment['external_reference'] ?? '')
  const collector = String(payment['collector_id'] ?? '')
  const rawStatus = String(payment['status'] ?? '')
  const detail = String(payment['status_detail'] ?? '')
  const occurred = String(payment['date_last_updated'] ?? payment['date_created'] ?? '')
  if (!providerReference || !paymentId || !Number.isFinite(Date.parse(occurred)))
    throw new ErrorFinanzasServicio(400, 'INVALID_EVENT', 'payment identity is incomplete')
  if (collector !== options.expectedCollector)
    throw new ErrorFinanzasServicio(409, 'COLLECTOR_MISMATCH', 'payment belongs to another seller')
  const currency = normalizeCurrency(String(payment['currency_id'] ?? ''))
  const minor = (value: unknown) => majorDecimalToMinorUnits(String(value), currency)
  const fees = Array.isArray(payment['fee_details'])
    ? (payment['fee_details'] as Record<string, unknown>[])
    : null
  // A fee type is only known when Mercado Pago lists it; absence means "not reported yet".
  const sumFees = (type: string) => {
    const entries = (fees ?? []).filter(
      (fee) => fee['type'] === type && fee['amount'] !== undefined
    )
    return entries.length === 0
      ? null
      : entries.reduce((total, fee) => total + minor(fee['amount']), 0n)
  }
  const marketplaceFee =
    payment['marketplace_fee'] !== undefined && payment['marketplace_fee'] !== null
      ? minor(payment['marketplace_fee'])
      : fees && fees.some((fee) => fee['type'] === 'application_fee')
        ? sumFees('application_fee')
        : null
  let status: EstadoProveedorPagoServicio | 'unknown' = ESTADOS_MERCADO_PAGO[rawStatus] ?? 'unknown'
  if (rawStatus === 'cancelled' && detail === 'expired') status = 'expired'
  return {
    eventId: options.notificationId
      ? `mp-notification-${options.notificationId}`
      : `mp-${providerReference}-${rawStatus}-${new Date(occurred).toISOString()}`,
    providerReference,
    paymentId,
    status,
    rawStatus: detail ? `${rawStatus}:${detail}` : rawStatus,
    amountMinor: minor(payment['transaction_amount']),
    currency,
    occurredAt: new Date(occurred).toISOString(),
    pspFeeMinor: status === 'approved' || status === 'refunded' ? sumFees('mercadopago_fee') : null,
    marketplaceFeeMinor: marketplaceFee,
    collectorId: collector,
  }
}

function aNumeroExacto(minor: bigint, currency: string): number {
  // Decimal string -> JSON number; exact for the bounded range above (no float arithmetic).
  return Number(minorUnitsToMajorDecimal(minor, currency))
}

export function esUrlMercadoPago(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && /(^|\.)mercadopago\.com(\.[a-z]{2})?$/u.test(url.hostname)
  } catch {
    return false
  }
}
