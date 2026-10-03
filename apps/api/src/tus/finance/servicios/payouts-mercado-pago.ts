import { createPrivateKey, sign, type KeyObject } from 'node:crypto'
import { minorUnitsToMajorDecimal } from '@factory/contracts'
import { ErrorProveedorPagos } from './pagos.ts'
import type { EstadoTransferencia, PuertoEjecucionLiquidacion } from './ganancias.ts'

// TUS-GANANCIAS-01: payouts of provider earnings through Mercado Pago Payouts ("money-out"), the
// official account-to-account transfer API (Argentina):
//   POST https://api.mercadopago.com/v1/payouts                                  create (202)
//   GET  https://api.mercadopago.com/v1/payouts/{payout_id}/transactions/{id}     transfer state
// https://www.mercadopago.com.ar/developers/es/docs/payouts/integration-configuration/money-transfers
//
// TUS's own account (platform access token) sends the money to the provider's Mercado Pago
// account, identified by its email (type "account"). Headers:
//   Authorization: Bearer <platform access token>, X-Idempotency-Key (the request id: a retry never
//   creates a second transfer), X-test-token: true in sandbox, and in production X-enforce-signature:
//   true + X-signature: the body signed with TUS's Ed25519 private key, base64 (the public key is
//   registered with Mercado Pago's Integrations team).
// The result is never taken from the creation answer or from a notification: only the transfer
// queried from Mercado Pago says whether it was accredited.
//
// TUS-GANANCIAS-02: this contract could not be verified against Mercado Pago's documentation from
// the development environment, and no official Mercado Pago SDK ships a Payouts client. It stays
// behind PuertoEjecucionLiquidacion and is composed only with TUS_MERCADOPAGO_PAYOUTS_ENABLED=true;
// the account owner confirms it with Mercado Pago and in sandbox before enabling it (see
// docs/PRODUCCION_TUS.md). A wrong contract fails safe: a 4xx releases the funds, nothing is paid
// without Mercado Pago reporting success/accredited.

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface ConfiguracionPayoutsMercadoPago {
  environment: 'sandbox' | 'production'
  accessToken: string
  // Ed25519 private key (PEM). Required in production, where Mercado Pago enforces signatures.
  signingKey: KeyObject | null
  notificationUrl: string | null
  apiBaseUrl?: string
  fetch?: FetchLike
  timeoutMs?: number
}

const ID = /^[A-Za-z0-9_-]{1,64}$/u

// Mercado Pago transfer status (status, status_detail) -> what it means for the payout request.
// Documented states: created, approved, processed, transaction_in_process, success (in_progress |
// accredited), rejected (by_bank, by_provider, high_risk, insufficient_funds, other_reason,
// review_manual), error (failed), canceled, refunded.
export function resultadoDeTransferencia(status: string, statusDetail: string | null): EstadoTransferencia['resultado'] {
  if (status === 'success' && statusDetail === 'accredited') return 'paid'
  if (status === 'rejected' || status === 'error' || status === 'canceled' || status === 'cancelled' || status === 'refunded') return 'failed'
  return 'processing'
}

// The private key from its PEM text (environment variables may carry "\n" escaped).
export function clavePrivadaPayouts(pem: string): KeyObject {
  const key = createPrivateKey(pem.includes('\\n') ? pem.replace(/\\n/gu, '\n') : pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Mercado Pago Payouts signing key must be Ed25519')
  return key
}

export class EjecucionLiquidacionMercadoPago implements PuertoEjecucionLiquidacion {
  readonly disponible = true

  constructor(private readonly config: ConfiguracionPayoutsMercadoPago) {
    if (!config.accessToken.trim()) throw new Error('Mercado Pago Payouts needs the platform access token')
    if (config.environment === 'production' && !config.signingKey) throw new Error('Mercado Pago Payouts needs the request signing key in production')
    if (config.notificationUrl !== null && !/^https:\/\//u.test(config.notificationUrl)) throw new Error('Mercado Pago Payouts notification URL must use HTTPS')
  }

  async enviar(input: { solicitudId: string; amountMinor: bigint; destinationEmail: string; description: string }): Promise<{ payoutId: string; transactionId: string; status: string }> {
    if (!ID.test(input.solicitudId)) throw new ErrorProveedorPagos('PROVIDER_REJECTED', 'payout reference is not valid for Mercado Pago')
    if (input.amountMinor < 100n) throw new ErrorProveedorPagos('PROVIDER_REJECTED', 'Mercado Pago Payouts transfers at least 1 ARS')
    const description = input.description.slice(0, 100)
    const body = JSON.stringify({
      external_reference: input.solicitudId,
      description,
      ...(this.config.notificationUrl ? { config: { notification_url: this.config.notificationUrl } } : {}),
      transactions: [
        {
          type: 'account',
          description,
          account: { email: input.destinationEmail },
          amount: { currency: 'ARS', value: Number(minorUnitsToMajorDecimal(input.amountMinor, 'ARS')) },
          external_reference: input.solicitudId,
        },
      ],
    })
    const signed: Record<string, string> = this.config.environment === 'production' ? { 'x-enforce-signature': 'true', 'x-signature': sign(null, Buffer.from(body, 'utf8'), this.config.signingKey!).toString('base64') } : {}
    const payload = await this.request('POST', '/v1/payouts', body, { 'x-idempotency-key': input.solicitudId, ...signed })
    const transactions = Array.isArray(payload['transactions']) ? (payload['transactions'] as Record<string, unknown>[]) : []
    const payoutId = String(payload['id'] ?? '')
    const transactionId = String(transactions[0]?.['id'] ?? '')
    if (!ID.test(payoutId) || !ID.test(transactionId)) throw new ErrorProveedorPagos('PROVIDER_UNAVAILABLE', 'Mercado Pago answered without the payout and transaction ids')
    return { payoutId, transactionId, status: String(payload['status'] ?? 'created') }
  }

  async consultar(input: { payoutId: string; transactionId: string }): Promise<EstadoTransferencia> {
    if (!ID.test(input.payoutId) || !ID.test(input.transactionId)) throw new ErrorProveedorPagos('PROVIDER_REJECTED', 'payout ids are not valid')
    const payload = await this.request('GET', `/v1/payouts/${encodeURIComponent(input.payoutId)}/transactions/${encodeURIComponent(input.transactionId)}`)
    const status = String(payload['status'] ?? '').toLowerCase()
    if (!status) throw new ErrorProveedorPagos('PROVIDER_UNAVAILABLE', 'Mercado Pago answered a transfer without status')
    const statusDetail = payload['status_detail'] === undefined || payload['status_detail'] === null ? null : String(payload['status_detail']).toLowerCase()
    return { status, statusDetail, resultado: resultadoDeTransferencia(status, statusDetail) }
  }

  // The token only travels in the Authorization header; error bodies are reduced to a safe code.
  // 4xx (invalid destination, no funds, forbidden, invalid signature): definitive rejection.
  // 5xx, timeouts and network errors: ambiguous (the transfer may exist; resend with the same key).
  private async request(method: 'GET' | 'POST', path: string, body?: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const fetchImpl = this.config.fetch ?? (globalThis.fetch as unknown as FetchLike)
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await fetchImpl(`${this.config.apiBaseUrl ?? 'https://api.mercadopago.com'}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.config.accessToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.config.environment === 'sandbox' ? { 'x-test-token': 'true' } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      })
    } catch (error) {
      throw new ErrorProveedorPagos(error instanceof Error && error.name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE', 'Mercado Pago Payouts is unreachable')
    }
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (response.ok && payload && typeof payload === 'object') return payload
    if (response.status >= 500 || response.ok) throw new ErrorProveedorPagos('PROVIDER_UNAVAILABLE', `Mercado Pago Payouts HTTP ${response.status}`)
    throw new ErrorProveedorPagos('PROVIDER_REJECTED', `Mercado Pago Payouts rejected the request (HTTP ${response.status})`)
  }
}
