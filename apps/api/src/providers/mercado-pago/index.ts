import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const PAYMENT_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
} as const

type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS]

const RECEIPT_STATUS = {
  RECEIVED: 'received',
  PROCESSED: 'processed',
  REJECTED: 'rejected',
  FAILED: 'failed',
} as const

type ReceiptStatus = (typeof RECEIPT_STATUS)[keyof typeof RECEIPT_STATUS]

const DELIVERY_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  DEAD_LETTER: 'dead_letter',
} as const

type DeliveryStatus = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS]

const SAGA_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  COMPENSATED: 'compensated',
} as const

type SagaStatus = (typeof SAGA_STATUS)[keyof typeof SAGA_STATUS]

const ACTION_TO_STATUS: Record<string, PaymentStatus> = {
  'payment.created': PAYMENT_STATUS.PENDING,
  'payment.updated': PAYMENT_STATUS.PENDING,
  'payment.pending': PAYMENT_STATUS.PENDING,
  'payment.approved': PAYMENT_STATUS.APPROVED,
  'payment.authorized': PAYMENT_STATUS.APPROVED,
  'payment.rejected': PAYMENT_STATUS.REJECTED,
  'payment.refunded': PAYMENT_STATUS.REFUNDED,
  'payment.cancelled': PAYMENT_STATUS.CANCELLED,
}

type PaymentContext = {
  tenantId: string
  actorId: string
  correlationId: string
}

type MercadoPagoWebhookEvent = {
  eventId: string
  requestId: string
  timestamp: number
  externalPaymentId: string
  action: string
  payload: {
    data: { id: string }
    type: 'payment'
    action: string
  }
  context: PaymentContext
  signature: string
}

type MercadoPagoWebhookRequest = Omit<MercadoPagoWebhookEvent, 'context' | 'signature'> & {
  context: PaymentContext
  signature: string
}

type PaymentProviderRecord = {
  externalPaymentId: string
  amount: number
  currency: string
  status: PaymentStatus
}

type PaymentIntent = PaymentProviderRecord & {
  contractVersion: '1.0.0'
  paymentId: string
  tenantId: string
  idempotencyKey: string
  correlationId: string
  updatedAt: number
  sourceEventId: string
}

type PaymentReceipt = {
  contractVersion: '1.0.0'
  receiptId: string
  tenantId: string
  provider: 'mercado-pago'
  eventId: string
  requestId: string
  externalPaymentId: string
  signatureDigest: string
  receivedAt: number
  status: ReceiptStatus
  reason: string | null
  processedAt: number | null
}

type PaymentOutboxRecord = {
  contractVersion: '1.0.0'
  eventId: string
  tenantId: string
  aggregateType: 'payment'
  aggregateId: string
  eventType: string
  payload: { paymentId: string; externalPaymentId: string; status: PaymentStatus }
  createdAt: number
  published: boolean
}

type PaymentSaga = {
  sagaId: string
  tenantId: string
  eventId: string
  status: SagaStatus
  steps: Array<{ name: string; status: 'pending' | 'completed' | 'compensated' }>
  updatedAt: number
  compensationReason: string | null
}

type PaymentDeliveryJob = {
  jobId: string
  tenantId: string
  event: MercadoPagoWebhookRequest
  attempts: number
  maxAttempts: number
  nextAttemptAt: number
  status: DeliveryStatus
  lastError: string | null
}

type PaymentDeadLetter = PaymentDeliveryJob & {
  status: typeof DELIVERY_STATUS.DEAD_LETTER
  quarantinedAt: number
}

type IdempotencyRecord = {
  tenantId: string
  key: string
  requestHash: string
  response: { paymentId: string; status: PaymentStatus } | null
}

type PaymentStateSnapshot = {
  payments: Map<string, PaymentIntent>
  outbox: Map<string, PaymentOutboxRecord>
  sagas: Map<string, PaymentSaga>
  idempotency: Map<string, IdempotencyRecord>
}

export type MercadoPagoWebhookResult =
  | { status: 'processed'; receipt: PaymentReceipt; payment: PaymentIntent }
  | { status: 'replay'; receipt: PaymentReceipt; payment: PaymentIntent | null }
  | { status: 'rejected'; reason: 'invalid_signature' | 'invalid_request'; receipt: PaymentReceipt }
  | { status: 'retryable'; reason: string; receipt: PaymentReceipt }
  | { status: 'dead_letter'; reason: string; receipt: PaymentReceipt }

export type MercadoPagoReconciliation = {
  status: 'clean' | 'recovered'
  tenantId: string
  failedReceipts: number
  pendingDeliveries: number
  deadLetters: number
  pendingOutbox: number
}

export interface MercadoPagoProviderPort {
  lookupPayment(externalPaymentId: string): Promise<PaymentProviderRecord>
}

export interface MercadoPagoProviderTransport {
  lookupPayment(externalPaymentId: string): Promise<PaymentProviderRecord>
}

export interface MercadoPagoPaymentIntentInput {
  tenantId: string
  commitmentId: string
  amount: number
  currency: string
  correlationId: string
  idempotencyKey: string
}

export interface MercadoPagoPaymentIntentResult {
  providerReference: string
  status: Extract<PaymentStatus, 'pending' | 'approved' | 'rejected'>
}

export interface MercadoPagoPaymentIntentTransport {
  createPaymentIntent(input: MercadoPagoPaymentIntentInput): Promise<MercadoPagoPaymentIntentResult>
}

export type MercadoPagoAdapterOptions = {
  secret: string
  store: InMemoryMercadoPagoStore
  provider: MercadoPagoProviderPort
  maxAttempts?: number
  retryDelayMs?: number
}

function tenantKey(tenantId: string, id: string): string {
  return `${tenantId}:${id}`
}

function validContext(context: PaymentContext): boolean {
  return Boolean(context.tenantId.trim() && context.actorId.trim() && context.correlationId.trim())
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function requestHash(event: MercadoPagoWebhookRequest): string {
  return digest(
    JSON.stringify({
      eventId: event.eventId,
      externalPaymentId: event.externalPaymentId,
      action: event.action,
      payload: event.payload,
    })
  )
}

function safeProviderError(error: unknown): string {
  if (error instanceof MercadoPagoTimeoutError) return 'provider_timeout'
  if (error instanceof MercadoPagoProviderUnavailableError) return 'provider_unavailable'
  return 'provider_request_failed'
}

function clone<TValue>(value: TValue): TValue {
  return structuredClone(value)
}

export function createMercadoPagoSignature(
  secret: string,
  eventId: string,
  requestId: string,
  timestamp: number
): string {
  const manifest = `id:${eventId};request-id:${requestId};ts:${timestamp};`
  const signature = createHmac('sha256', secret).update(manifest).digest('hex')
  return `ts=${timestamp},v1=${signature}`
}

export function verifyMercadoPagoSignature(
  secret: string,
  eventId: string,
  requestId: string,
  timestamp: number,
  signatureHeader: string
): boolean {
  const fields = new Map(
    signatureHeader.split(',').map((part) => {
      const [key, ...value] = part.trim().split('=')
      return [key, value.join('=')]
    })
  )
  const suppliedTimestamp = Number(fields.get('ts'))
  const suppliedSignature = fields.get('v1') ?? ''
  if (!Number.isSafeInteger(suppliedTimestamp) || suppliedTimestamp !== timestamp) return false
  const expected =
    createMercadoPagoSignature(secret, eventId, requestId, timestamp).split('v1=')[1] ?? ''
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const suppliedBuffer = Buffer.from(suppliedSignature, 'utf8')
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  )
}

export class MercadoPagoProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE'

  constructor() {
    super('Mercado Pago provider is unavailable')
    this.name = 'MercadoPagoProviderUnavailableError'
  }
}

export class MercadoPagoTimeoutError extends Error {
  readonly code = 'PROVIDER_TIMEOUT'

  constructor() {
    super('Mercado Pago provider request timed out')
    this.name = 'MercadoPagoTimeoutError'
  }
}

export class MercadoPagoProviderAdapter implements MercadoPagoProviderPort {
  private readonly transport: MercadoPagoProviderTransport

  constructor(transport: MercadoPagoProviderTransport) {
    this.transport = transport
  }

  async lookupPayment(externalPaymentId: string): Promise<PaymentProviderRecord> {
    if (!externalPaymentId.trim()) throw new Error('external payment id is required')
    return this.transport.lookupPayment(externalPaymentId)
  }
}

/** Provider boundary only; credentials and live execution remain outside this slice. */
export class MercadoPagoPaymentIntentAdapter {
  readonly source = 'authorized' as const
  private readonly transport: MercadoPagoPaymentIntentTransport

  constructor(transport: MercadoPagoPaymentIntentTransport) {
    this.transport = transport
  }

  async createPaymentIntent(input: MercadoPagoPaymentIntentInput): Promise<MercadoPagoPaymentIntentResult> {
    if (!input.tenantId.trim() || !input.commitmentId.trim() || !input.correlationId.trim() || !input.idempotencyKey.trim()) {
      throw new Error('Mercado Pago payment intent context is required')
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0 || !input.currency.trim()) {
      throw new Error('Mercado Pago payment intent amount is invalid')
    }
    return this.transport.createPaymentIntent(input)
  }
}

export class DeterministicMercadoPagoProvider implements MercadoPagoProviderPort {
  private readonly payments = new Map<string, PaymentProviderRecord>()
  failNext = 0
  timeoutNext = 0
  lookupCalls = 0

  setPayment(
    externalPaymentId: string,
    value: Omit<PaymentProviderRecord, 'externalPaymentId'>
  ): void {
    this.payments.set(externalPaymentId, { externalPaymentId, ...value })
  }

  async lookupPayment(externalPaymentId: string): Promise<PaymentProviderRecord> {
    this.lookupCalls += 1
    if (this.timeoutNext > 0) {
      this.timeoutNext -= 1
      throw new MercadoPagoTimeoutError()
    }
    if (this.failNext > 0) {
      this.failNext -= 1
      throw new MercadoPagoProviderUnavailableError()
    }
    return clone(
      this.payments.get(externalPaymentId) ?? {
        externalPaymentId,
        amount: 0,
        currency: 'XXX',
        status: PAYMENT_STATUS.PENDING,
      }
    )
  }
}

export class InMemoryMercadoPagoStore {
  private readonly receipts = new Map<string, PaymentReceipt>()
  private readonly requests = new Map<string, MercadoPagoWebhookRequest>()
  private readonly payments = new Map<string, PaymentIntent>()
  private readonly outbox = new Map<string, PaymentOutboxRecord>()
  private readonly sagas = new Map<string, PaymentSaga>()
  private readonly idempotency = new Map<string, IdempotencyRecord>()
  private readonly jobs = new Map<string, PaymentDeliveryJob>()
  private readonly deadLetters = new Map<string, PaymentDeadLetter>()

  recordReceipt(
    input: MercadoPagoWebhookRequest,
    now: number
  ): { fresh: boolean; receipt: PaymentReceipt } {
    const key = tenantKey(input.context.tenantId, input.eventId)
    const existing = this.receipts.get(key)
    if (existing) return { fresh: false, receipt: clone(existing) }
    const receipt: PaymentReceipt = {
      contractVersion: '1.0.0',
      receiptId: `receipt-${input.eventId}`,
      tenantId: input.context.tenantId,
      provider: 'mercado-pago',
      eventId: input.eventId,
      requestId: input.requestId,
      externalPaymentId: input.externalPaymentId,
      signatureDigest: digest(input.signature),
      receivedAt: now,
      status: RECEIPT_STATUS.RECEIVED,
      reason: null,
      processedAt: null,
    }
    this.receipts.set(key, receipt)
    this.requests.set(key, clone(input))
    return { fresh: true, receipt: clone(receipt) }
  }

  getReceipt(tenantId: string, eventId: string): PaymentReceipt | null {
    const value = this.receipts.get(tenantKey(tenantId, eventId))
    return value ? clone(value) : null
  }

  getRequest(tenantId: string, eventId: string): MercadoPagoWebhookRequest | null {
    const value = this.requests.get(tenantKey(tenantId, eventId))
    return value ? clone(value) : null
  }

  markReceipt(tenantId: string, eventId: string, patch: Partial<PaymentReceipt>): PaymentReceipt {
    const key = tenantKey(tenantId, eventId)
    const current = this.receipts.get(key)
    if (!current) throw new Error('payment receipt not found')
    const updated = { ...current, ...clone(patch) }
    this.receipts.set(key, updated)
    return clone(updated)
  }

  transaction<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    const snapshot: PaymentStateSnapshot = {
      payments: new Map([...this.payments].map(([key, value]) => [key, clone(value)])),
      outbox: new Map([...this.outbox].map(([key, value]) => [key, clone(value)])),
      sagas: new Map([...this.sagas].map(([key, value]) => [key, clone(value)])),
      idempotency: new Map([...this.idempotency].map(([key, value]) => [key, clone(value)])),
    }
    return operation().catch((error: unknown) => {
      this.payments.clear()
      this.outbox.clear()
      this.sagas.clear()
      this.idempotency.clear()
      for (const [key, value] of snapshot.payments) this.payments.set(key, value)
      for (const [key, value] of snapshot.outbox) this.outbox.set(key, value)
      for (const [key, value] of snapshot.sagas) this.sagas.set(key, value)
      for (const [key, value] of snapshot.idempotency) this.idempotency.set(key, value)
      throw error
    })
  }

  claimIdempotency(tenantId: string, key: string, hash: string): 'claimed' | 'replay' | 'conflict' {
    const mapKey = tenantKey(tenantId, key)
    const current = this.idempotency.get(mapKey)
    if (!current) {
      this.idempotency.set(mapKey, { tenantId, key, requestHash: hash, response: null })
      return 'claimed'
    }
    if (current.requestHash !== hash) return 'conflict'
    return current.response ? 'replay' : 'claimed'
  }

  completeIdempotency(
    tenantId: string,
    key: string,
    response: { paymentId: string; status: PaymentStatus }
  ): void {
    const record = this.idempotency.get(tenantKey(tenantId, key))
    if (!record) throw new Error('payment idempotency record not found')
    record.response = clone(response)
  }

  upsertPayment(payment: PaymentIntent): PaymentIntent {
    const key = tenantKey(payment.tenantId, payment.paymentId)
    const existing = this.payments.get(key)
    const next = existing && existing.updatedAt > payment.updatedAt ? existing : payment
    this.payments.set(key, clone(next))
    return clone(next)
  }

  appendOutbox(event: PaymentOutboxRecord): PaymentOutboxRecord {
    const key = tenantKey(event.tenantId, event.eventId)
    const existing = this.outbox.get(key)
    if (existing) return clone(existing)
    this.outbox.set(key, clone(event))
    return clone(event)
  }

  ensureSaga(tenantId: string, eventId: string, now: number): PaymentSaga {
    const key = tenantKey(tenantId, eventId)
    const existing = this.sagas.get(key)
    if (existing) return clone(existing)
    const saga: PaymentSaga = {
      sagaId: `payment-saga-${eventId}`,
      tenantId,
      eventId,
      status: SAGA_STATUS.PENDING,
      steps: [
        { name: 'verify-receipt', status: 'pending' },
        { name: 'synchronize-payment', status: 'pending' },
        { name: 'publish-outbox', status: 'pending' },
      ],
      updatedAt: now,
      compensationReason: null,
    }
    this.sagas.set(key, saga)
    return clone(saga)
  }

  completeSaga(tenantId: string, eventId: string, now: number): PaymentSaga {
    const saga = this.requireSaga(tenantId, eventId)
    saga.status = SAGA_STATUS.COMPLETED
    saga.updatedAt = now
    saga.steps = saga.steps.map((step) => ({ ...step, status: 'completed' }))
    this.sagas.set(tenantKey(tenantId, eventId), saga)
    return clone(saga)
  }

  compensateSaga(tenantId: string, eventId: string, reason: string, now: number): PaymentSaga {
    const saga = this.requireSaga(tenantId, eventId)
    saga.status = SAGA_STATUS.COMPENSATED
    saga.updatedAt = now
    saga.compensationReason = reason
    saga.steps = saga.steps.map((step) => ({ ...step, status: 'compensated' }))
    this.sagas.set(tenantKey(tenantId, eventId), saga)
    return clone(saga)
  }

  enqueueJob(input: PaymentDeliveryJob): PaymentDeliveryJob {
    const key = tenantKey(input.tenantId, input.event.eventId)
    this.jobs.set(key, clone(input))
    return clone(input)
  }

  nextJob(tenantId: string, now: number): PaymentDeliveryJob | null {
    const candidate = [...this.jobs.values()]
      .filter(
        (job) =>
          job.tenantId === tenantId &&
          job.status === DELIVERY_STATUS.PENDING &&
          job.nextAttemptAt <= now
      )
      .sort(
        (left, right) =>
          left.nextAttemptAt - right.nextAttemptAt || left.jobId.localeCompare(right.jobId)
      )[0]
    return candidate ? clone(candidate) : null
  }

  updateJob(
    tenantId: string,
    eventId: string,
    patch: Partial<PaymentDeliveryJob>
  ): PaymentDeliveryJob {
    const key = tenantKey(tenantId, eventId)
    const current = this.jobs.get(key)
    if (!current) throw new Error('payment delivery job not found')
    const updated = { ...current, ...clone(patch) }
    this.jobs.set(key, updated)
    return clone(updated)
  }

  removeJob(tenantId: string, eventId: string): void {
    this.jobs.delete(tenantKey(tenantId, eventId))
  }

  quarantineJob(tenantId: string, eventId: string, now: number): PaymentDeadLetter {
    const job = this.jobs.get(tenantKey(tenantId, eventId))
    if (!job) throw new Error('payment delivery job not found')
    const deadLetter: PaymentDeadLetter = {
      ...clone(job),
      status: DELIVERY_STATUS.DEAD_LETTER,
      quarantinedAt: now,
    }
    this.deadLetters.set(tenantKey(tenantId, eventId), deadLetter)
    this.jobs.delete(tenantKey(tenantId, eventId))
    return clone(deadLetter)
  }

  getPayment(tenantId: string, paymentId: string): PaymentIntent | null {
    const value = this.payments.get(tenantKey(tenantId, paymentId))
    return value ? clone(value) : null
  }

  getSaga(tenantId: string, eventId: string): PaymentSaga | null {
    const value = this.sagas.get(tenantKey(tenantId, eventId))
    return value ? clone(value) : null
  }

  listReceipts(tenantId: string): PaymentReceipt[] {
    return [...this.receipts.values()].filter((value) => value.tenantId === tenantId).map(clone)
  }

  listPayments(tenantId: string): PaymentIntent[] {
    return [...this.payments.values()].filter((value) => value.tenantId === tenantId).map(clone)
  }

  listOutbox(tenantId: string): PaymentOutboxRecord[] {
    return [...this.outbox.values()].filter((value) => value.tenantId === tenantId).map(clone)
  }

  listDeadLetters(tenantId: string): PaymentDeadLetter[] {
    return [...this.deadLetters.values()].filter((value) => value.tenantId === tenantId).map(clone)
  }

  listJobs(tenantId: string): PaymentDeliveryJob[] {
    return [...this.jobs.values()].filter((value) => value.tenantId === tenantId).map(clone)
  }

  private requireSaga(tenantId: string, eventId: string): PaymentSaga {
    const saga = this.sagas.get(tenantKey(tenantId, eventId))
    if (!saga) throw new Error('payment saga not found')
    return clone(saga)
  }
}

export class MercadoPagoAdapter {
  private readonly maxAttempts: number
  private readonly retryDelayMs: number
  private readonly options: MercadoPagoAdapterOptions

  constructor(options: MercadoPagoAdapterOptions) {
    this.options = options
    if (!options.secret.trim())
      throw new Error('Mercado Pago signature secret reference is required')
    this.maxAttempts = options.maxAttempts ?? 3
    this.retryDelayMs = options.retryDelayMs ?? 1_000
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1)
      throw new Error('Mercado Pago maxAttempts must be positive')
  }

  async receiveWebhook(input: MercadoPagoWebhookRequest): Promise<MercadoPagoWebhookResult> {
    const now = input.timestamp * 1_000
    if (!validWebhook(input)) {
      const receipt = this.options.store.recordReceipt(input, now).receipt
      return {
        status: 'rejected',
        reason: 'invalid_request',
        receipt: this.options.store.markReceipt(input.context.tenantId, input.eventId, {
          status: RECEIPT_STATUS.REJECTED,
          reason: 'invalid_request',
        }),
      }
    }
    const recorded = this.options.store.recordReceipt(input, now)
    if (!recorded.fresh) {
      const payment = this.options.store.getPayment(input.context.tenantId, input.externalPaymentId)
      return { status: 'replay', receipt: recorded.receipt, payment }
    }
    if (
      !verifyMercadoPagoSignature(
        this.options.secret,
        input.eventId,
        input.requestId,
        input.timestamp,
        input.signature
      )
    ) {
      return {
        status: 'rejected',
        reason: 'invalid_signature',
        receipt: this.options.store.markReceipt(input.context.tenantId, input.eventId, {
          status: RECEIPT_STATUS.REJECTED,
          reason: 'invalid_signature',
        }),
      }
    }
    return this.process(input, recorded.receipt, 1)
  }

  async retryNext(now: number, tenantId: string): Promise<MercadoPagoWebhookResult | null> {
    const job = this.options.store.nextJob(tenantId, now)
    if (!job) return null
    const nextAttempt = job.attempts + 1
    this.options.store.updateJob(tenantId, job.event.eventId, {
      attempts: nextAttempt,
      status: DELIVERY_STATUS.PROCESSING,
    })
    const receipt = this.options.store.getReceipt(tenantId, job.event.eventId)
    if (!receipt) return null
    return this.process(job.event, receipt, nextAttempt, job)
  }

  async reconcile(now: number, tenantId: string): Promise<MercadoPagoReconciliation> {
    const receipts = this.options.store.listReceipts(tenantId)
    const jobs = this.options.store.listJobs(tenantId)
    const deadLetters = this.options.store.listDeadLetters(tenantId)
    const pendingOutbox = this.options.store
      .listOutbox(tenantId)
      .filter((event) => !event.published).length
    const recovered =
      receipts.some((receipt) => receipt.status === RECEIPT_STATUS.FAILED) || deadLetters.length > 0
    void now
    return {
      status: recovered ? 'recovered' : 'clean',
      tenantId,
      failedReceipts: receipts.filter((receipt) => receipt.status === RECEIPT_STATUS.FAILED).length,
      pendingDeliveries: jobs.length,
      deadLetters: deadLetters.length,
      pendingOutbox,
    }
  }

  async getPayment(input: { tenantId: string; paymentId: string }): Promise<PaymentIntent | null> {
    return this.options.store.getPayment(input.tenantId, input.paymentId)
  }

  private async process(
    input: MercadoPagoWebhookRequest,
    receipt: PaymentReceipt,
    attempt: number,
    existingJob?: PaymentDeliveryJob
  ): Promise<MercadoPagoWebhookResult> {
    const now = input.timestamp * 1_000 + attempt
    this.options.store.ensureSaga(input.context.tenantId, input.eventId, now)
    try {
      const providerPayment = await this.options.provider.lookupPayment(input.externalPaymentId)
      const payment = await this.options.store.transaction(async () => {
        const idempotencyKey = `mercado-pago:webhook:${input.eventId}`
        const claim = this.options.store.claimIdempotency(
          input.context.tenantId,
          idempotencyKey,
          requestHash(input)
        )
        if (claim === 'conflict') throw new PaymentIdempotencyConflictError()
        if (claim === 'replay') {
          const replay = this.options.store.getPayment(
            input.context.tenantId,
            input.externalPaymentId
          )
          if (!replay) throw new Error('payment replay record missing')
          return replay
        }
        const next: PaymentIntent = {
          contractVersion: '1.0.0',
          paymentId: input.externalPaymentId,
          tenantId: input.context.tenantId,
          externalPaymentId: providerPayment.externalPaymentId,
          amount: providerPayment.amount,
          currency: providerPayment.currency,
          status: ACTION_TO_STATUS[input.action] ?? providerPayment.status,
          idempotencyKey,
          correlationId: input.context.correlationId,
          updatedAt: now,
          sourceEventId: input.eventId,
        }
        this.options.store.upsertPayment(next)
        this.options.store.appendOutbox({
          contractVersion: '1.0.0',
          eventId: `payment-event-${input.eventId}`,
          tenantId: input.context.tenantId,
          aggregateType: 'payment',
          aggregateId: next.paymentId,
          eventType: input.action,
          payload: {
            paymentId: next.paymentId,
            externalPaymentId: next.externalPaymentId,
            status: next.status,
          },
          createdAt: now,
          published: false,
        })
        this.options.store.completeIdempotency(input.context.tenantId, idempotencyKey, {
          paymentId: next.paymentId,
          status: next.status,
        })
        this.options.store.completeSaga(input.context.tenantId, input.eventId, now)
        return next
      })
      this.options.store.removeJob(input.context.tenantId, input.eventId)
      const processedReceipt = this.options.store.markReceipt(
        input.context.tenantId,
        input.eventId,
        {
          status: RECEIPT_STATUS.PROCESSED,
          reason: null,
          processedAt: now,
        }
      )
      return { status: 'processed', receipt: processedReceipt, payment }
    } catch (error) {
      const reason =
        error instanceof PaymentIdempotencyConflictError
          ? 'idempotency_conflict'
          : safeProviderError(error)
      const failed = this.options.store.markReceipt(input.context.tenantId, input.eventId, {
        status: RECEIPT_STATUS.FAILED,
        reason,
      })
      const job = existingJob ?? {
        jobId: `payment-delivery-${input.eventId}`,
        tenantId: input.context.tenantId,
        event: clone(input),
        attempts: attempt,
        maxAttempts: this.maxAttempts,
        nextAttemptAt: now + this.retryDelayMs,
        status: DELIVERY_STATUS.PENDING,
        lastError: reason,
      }
      if (attempt >= this.maxAttempts) {
        this.options.store.enqueueJob({
          ...job,
          attempts: attempt,
          status: DELIVERY_STATUS.PROCESSING,
          lastError: reason,
        })
        this.options.store.quarantineJob(input.context.tenantId, input.eventId, now)
        this.options.store.compensateSaga(input.context.tenantId, input.eventId, reason, now)
        return { status: 'dead_letter', reason, receipt: failed }
      }
      this.options.store.enqueueJob({
        ...job,
        attempts: attempt,
        status: DELIVERY_STATUS.PENDING,
        lastError: reason,
      })
      return { status: 'retryable', reason, receipt: failed }
    }
  }
}

export class PaymentIdempotencyConflictError extends Error {
  readonly code = 'PAYMENT_IDEMPOTENCY_CONFLICT'

  constructor() {
    super('Payment webhook idempotency conflict')
    this.name = 'PaymentIdempotencyConflictError'
  }
}

function validWebhook(input: MercadoPagoWebhookRequest): boolean {
  return Boolean(
    validContext(input.context) &&
    input.eventId.trim() &&
    input.requestId.trim() &&
    input.externalPaymentId.trim() &&
    input.payload.type === 'payment' &&
    input.payload.data.id === input.externalPaymentId &&
    input.payload.action === input.action &&
    Number.isSafeInteger(input.timestamp) &&
    input.timestamp > 0
  )
}

export {
  DELIVERY_STATUS,
  PAYMENT_STATUS,
  RECEIPT_STATUS,
  SAGA_STATUS,
  type MercadoPagoWebhookEvent,
  type MercadoPagoWebhookRequest,
  type PaymentContext,
  type PaymentDeadLetter,
  type PaymentDeliveryJob,
  type PaymentIntent,
  type PaymentOutboxRecord,
  type PaymentReceipt,
  type PaymentSaga,
  type PaymentStatus,
}

export default {
  MercadoPagoAdapter,
  MercadoPagoPaymentIntentAdapter,
  MercadoPagoProviderAdapter,
  DeterministicMercadoPagoProvider,
  InMemoryMercadoPagoStore,
  createMercadoPagoSignature,
  verifyMercadoPagoSignature,
}
