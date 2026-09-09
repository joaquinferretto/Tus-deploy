import {
  AUTO_RETURN_VALUES,
  MERCADO_PAGO_DEFAULT_API_BASE_URL,
  type CreateMoneyOutInput,
  type CreatePreferenceInput,
  type CreateRefundInput,
  type DestinationAccount,
  type MercadoPagoClientOptions,
  type MercadoPagoFetch,
  type MercadoPagoHttpResponse,
  type MercadoPagoRequestInit,
  type MoneyOutTransaction,
  type Payment,
  type Preference,
  type Refund,
} from './types'
import {
  normalizeMoneyOutTransaction,
  normalizePayment,
  normalizePreference,
  normalizeRefund,
} from './normalizers'

export class MercadoPagoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MercadoPagoError'
  }
}

export class MercadoPagoApiError extends MercadoPagoError {
  readonly status: number

  constructor(status: number) {
    super(`Mercado Pago API request failed with status ${status}`)
    this.name = 'MercadoPagoApiError'
    this.status = status
  }
}

export class MercadoPagoClient {
  private readonly api: MercadoPagoApi

  constructor(options: MercadoPagoClientOptions) {
    this.api = new MercadoPagoApi(options)
  }

  async createPreference(input: CreatePreferenceInput): Promise<Preference> {
    validatePreferenceInput(input)

    const payload: Record<string, unknown> = {
      external_reference: input.externalReference,
      items: input.items.map((item) => ({
        ...(item.id ? { id: item.id } : {}),
        title: item.title,
        ...(item.description ? { description: item.description } : {}),
        quantity: item.quantity,
        currency_id: item.currencyId,
        unit_price: item.unitPrice,
      })),
      ...(input.payer ? { payer: input.payer } : {}),
      ...(input.backUrls ? { back_urls: compact(input.backUrls) } : {}),
      ...(input.backUrls && input.autoReturn
        ? { auto_return: input.autoReturn }
        : input.backUrls
          ? { auto_return: AUTO_RETURN_VALUES.APPROVED }
          : {}),
      ...(input.notificationUrl ? { notification_url: input.notificationUrl } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.statementDescriptor
        ? { statement_descriptor: input.statementDescriptor }
        : {}),
    }

    const response = await this.api.request('/checkout/preferences', 'POST', payload, {
      ...(input.idempotencyKey ? { 'X-Idempotency-Key': input.idempotencyKey } : {}),
    })

    return normalizePreference(response, input.externalReference)
  }

  async getPayment(paymentId: string | number): Promise<Payment> {
    const id = requireIdentifier(paymentId, 'paymentId')
    const response = await this.api.request(`/v1/payments/${encodePath(id)}`, 'GET')
    return normalizePayment(response)
  }

  async createRefund(paymentId: string | number, input: CreateRefundInput = {}): Promise<Refund> {
    const id = requireIdentifier(paymentId, 'paymentId')
    validateRefundInput(input)
    const body = input.amount === undefined ? undefined : { amount: input.amount }
    const response = await this.api.request(
      `/v1/payments/${encodePath(id)}/refunds`,
      'POST',
      body,
      input.idempotencyKey ? { 'X-Idempotency-Key': input.idempotencyKey } : {},
    )

    return normalizeRefund(response, id)
  }

  async getRefund(paymentId: string | number, refundId: string | number): Promise<Refund> {
    const payment = requireIdentifier(paymentId, 'paymentId')
    const refund = requireIdentifier(refundId, 'refundId')
    const response = await this.api.request(
      `/v1/payments/${encodePath(payment)}/refunds/${encodePath(refund)}`,
      'GET',
    )

    return normalizeRefund(response, payment)
  }

  async listRefunds(paymentId: string | number): Promise<Refund[]> {
    const id = requireIdentifier(paymentId, 'paymentId')
    const response = await this.api.request<unknown>(
      `/v1/payments/${encodePath(id)}/refunds`,
      'GET',
    )
    const records = Array.isArray(response)
      ? response
      : isRecord(response) && Array.isArray(response['results'])
        ? response['results']
        : []

    return records.map((refund) => normalizeRefund(refund, id))
  }
}

export class MercadoPagoMoneyOutClient {
  private readonly api: MercadoPagoApi

  constructor(options: MercadoPagoClientOptions) {
    this.api = new MercadoPagoApi(options)
  }

  async createTransactionIntent(input: CreateMoneyOutInput): Promise<MoneyOutTransaction> {
    validateMoneyOutInput(input)

    const destination = mapDestinationAccount(input.destinationAccount, input.amount)
    const payload: Record<string, unknown> = {
      external_reference: input.externalReference,
      point_of_interaction: { type: 'PSP_TRANSFER' },
      ...(input.notificationUrl
        ? {
            seller_configuration: {
              notification_info: { notification_url: input.notificationUrl },
            },
          }
        : {}),
      transaction: {
        from: { accounts: [{ amount: input.amount }] },
        to: { total_amount: input.amount, accounts: [destination] },
        total_amount: input.amount,
      },
    }

    const response = await this.api.request(
      '/v1/transaction-intents/process',
      'POST',
      payload,
      {
        'X-Idempotency-Key': input.idempotencyKey,
        ...(input.providerSignature ? { 'X-Signature': input.providerSignature } : {}),
        ...(input.enforceSignature === undefined
          ? {}
          : { 'X-Enforce-Signature': String(input.enforceSignature) }),
      },
    )

    return normalizeMoneyOutTransaction(response)
  }

  async getTransactionIntent(transactionId: string | number): Promise<MoneyOutTransaction> {
    const id = requireIdentifier(transactionId, 'transactionId')
    const response = await this.api.request(
      `/v1/transaction-intents/${encodePath(id)}`,
      'GET',
    )
    return normalizeMoneyOutTransaction(response)
  }
}

class MercadoPagoApi {
  private readonly baseUrl: string
  private readonly accessToken: string
  private readonly fetcher: MercadoPagoFetch

  constructor(options: MercadoPagoClientOptions) {
    if (!options.accessToken.trim()) {
      throw new MercadoPagoError('Mercado Pago access token is required')
    }

    this.accessToken = options.accessToken
    this.baseUrl = normalizeBaseUrl(options.apiBaseUrl)
    this.fetcher = options.fetch ?? defaultFetch
  }

  async request<T = unknown>(
    path: string,
    method: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const init: MercadoPagoRequestInit = {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...extraHeaders,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }

    let response: MercadoPagoHttpResponse

    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, init)
    } catch {
      throw new MercadoPagoError('Mercado Pago request could not be sent')
    }

    let responseBody: unknown

    try {
      responseBody = await response.json()
    } catch {
      throw new MercadoPagoApiError(response.status)
    }

    if (!response.ok) {
      throw new MercadoPagoApiError(response.status)
    }

    return responseBody as T
  }
}

async function defaultFetch(
  url: string,
  init: MercadoPagoRequestInit,
): Promise<MercadoPagoHttpResponse> {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  })

  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<unknown>,
  }
}

function validatePreferenceInput(input: CreatePreferenceInput): void {
  requireNonEmpty(input.externalReference, 'externalReference')

  if (input.items.length === 0) {
    throw new MercadoPagoError('At least one preference item is required')
  }

  for (const item of input.items) {
    requireNonEmpty(item.title, 'item.title')
    requireNonEmpty(item.currencyId, 'item.currencyId')

    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new MercadoPagoError('item.quantity must be a positive integer')
    }

    if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
      throw new MercadoPagoError('item.unitPrice must be a positive number')
    }
  }

  if (input.idempotencyKey !== undefined) {
    requireNonEmpty(input.idempotencyKey, 'idempotencyKey')
  }
}

function validateRefundInput(input: CreateRefundInput): void {
  if (input.amount !== undefined && (!Number.isFinite(input.amount) || input.amount <= 0)) {
    throw new MercadoPagoError('refund amount must be a positive number')
  }

  if (input.idempotencyKey !== undefined) {
    requireNonEmpty(input.idempotencyKey, 'idempotencyKey')
  }
}

function validateMoneyOutInput(input: CreateMoneyOutInput): void {
  requireNonEmpty(input.externalReference, 'externalReference')
  requireNonEmpty(input.idempotencyKey, 'idempotencyKey')

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new MercadoPagoError('Money Out amount must be a positive number')
  }

  requireNonEmpty(input.destinationAccount.accountType, 'destinationAccount.accountType')

  if (!input.destinationAccount.number && !input.destinationAccount.key) {
    throw new MercadoPagoError('destinationAccount.number or destinationAccount.key is required')
  }
}

function mapDestinationAccount(account: DestinationAccount, amount: number): Record<string, unknown> {
  return compact({
    type: account.accountType,
    amount,
    bank_id: account.bankId,
    branch: account.branch,
    number: account.number,
    holder: account.holder,
    provider_id: account.providerId,
    currency_id: account.currencyId,
    description: account.description,
    chave: account.key
      ? { type: account.key.type, value: account.key.value }
      : undefined,
    owner: account.holderIdentification
      ? {
          identification: {
            type: account.holderIdentification.type,
            number: account.holderIdentification.number,
          },
        }
      : undefined,
  })
}

function compact(record: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record as Record<string, unknown>).filter(([, value]) => value !== undefined),
  )
}

function requireIdentifier(value: string | number, name: string): string {
  const identifier = String(value).trim()

  if (!identifier) {
    throw new MercadoPagoError(`${name} is required`)
  }

  return identifier
}

function requireNonEmpty(value: string, name: string): void {
  if (!value.trim()) {
    throw new MercadoPagoError(`${name} is required`)
  }
}

function encodePath(value: string): string {
  return encodeURIComponent(value)
}

function normalizeBaseUrl(value: string | undefined): string {
  const candidate = (value ?? MERCADO_PAGO_DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '')

  try {
    const parsed = new URL(candidate)

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('unsupported protocol')
    }
  } catch {
    throw new MercadoPagoError('Mercado Pago API base URL is invalid')
  }

  return candidate
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
