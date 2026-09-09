import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const MESSAGE_TYPE = { TEXT: 'text' } as const
export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE]

export const RECEIPT_STATUS = {
  RECEIVED: 'received',
  PROCESSED: 'processed',
  REJECTED: 'rejected',
  FAILED: 'failed',
} as const
export type ReceiptStatus = (typeof RECEIPT_STATUS)[keyof typeof RECEIPT_STATUS]

export const DELIVERY_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  DEAD_LETTER: 'dead_letter',
} as const
export type DeliveryStatus = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS]

export const SAGA_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  COMPENSATED: 'compensated',
} as const
export type SagaStatus = (typeof SAGA_STATUS)[keyof typeof SAGA_STATUS]

export interface WhatsAppMessageContext {
  tenantId: string
  actorId: string
  correlationId: string
}

export interface WhatsAppWebhookEvent {
  eventId: string
  requestId: string
  timestamp: number
  phoneNumberId: string
  messageId: string
  from: string
  to: string
  messageType: MessageType
  text: string
}

export interface WhatsAppWebhookRequest extends WhatsAppWebhookEvent {
  context: WhatsAppMessageContext
  signature: string
}

export interface WhatsAppTenantPolicy {
  tenantId: string
  phoneNumberId: string
  allowedSenders: readonly string[]
  allowedMessageTypes?: readonly MessageType[]
  enabled?: boolean
}

export interface WhatsAppMessage {
  contractVersion: '1.0.0'
  tenantId: string
  messageId: string
  provider: 'whatsapp'
  phoneNumberId: string
  from: string
  to: string
  messageType: MessageType
  text: string
  correlationId: string
  sourceEventId: string
  receivedAt: number
}

export interface WhatsAppReceipt {
  contractVersion: '1.0.0'
  receiptId: string
  tenantId: string
  provider: 'whatsapp'
  eventId: string
  requestId: string
  messageId: string
  phoneNumberId: string
  signatureDigest: string
  receivedAt: number
  status: ReceiptStatus
  reason: string | null
  processedAt: number | null
}

export interface WhatsAppOutboxPayload {
  messageId: string
  phoneNumberId: string
  from: string
  to: string
  messageType: MessageType
  text: string
}

export interface WhatsAppOutboxRecord {
  contractVersion: '1.0.0'
  eventId: string
  tenantId: string
  aggregateType: 'message'
  aggregateId: string
  eventType: 'message.received'
  payload: WhatsAppOutboxPayload
  createdAt: number
  published: boolean
}

export interface WhatsAppSagaStep {
  name: string
  status: 'pending' | 'completed' | 'compensated'
}

export interface WhatsAppSaga {
  sagaId: string
  tenantId: string
  eventId: string
  status: SagaStatus
  steps: WhatsAppSagaStep[]
  updatedAt: number
  compensationReason: string | null
}

export interface WhatsAppDeliveryJob {
  jobId: string
  tenantId: string
  event: WhatsAppWebhookRequest
  attempts: number
  maxAttempts: number
  nextAttemptAt: number
  status: DeliveryStatus
  lastError: string | null
}

export interface WhatsAppDeadLetter extends WhatsAppDeliveryJob {
  status: typeof DELIVERY_STATUS.DEAD_LETTER
  quarantinedAt: number
}

export interface WhatsAppProviderMessage {
  providerMessageId: string
  status: 'sent'
}

export interface WhatsAppSendMessageInput {
  tenantId: string
  to: string
  text: string
  correlationId: string
  sourceEventId: string
}

export interface WhatsAppProviderPort {
  sendMessage(input: WhatsAppSendMessageInput): Promise<WhatsAppProviderMessage>
}

export interface WhatsAppProviderTransport {
  sendMessage(input: WhatsAppSendMessageInput): Promise<WhatsAppProviderMessage>
}

export type WhatsAppAdapterOptions = {
  secret: string
  store: InMemoryWhatsAppStore
  provider: WhatsAppProviderPort
  policies: readonly WhatsAppTenantPolicy[]
  maxAttempts?: number
  retryDelayMs?: number
  clock?: () => number
  freshnessMs?: number
  providerEnabled?: boolean
  rateLimit?: { maxPerWindow: number; windowMs: number }
}

export type WhatsAppWebhookResult =
  | { status: 'processed'; receipt: WhatsAppReceipt; message: WhatsAppMessage }
  | { status: 'replay'; receipt: WhatsAppReceipt; message: WhatsAppMessage | null }
  | {
      status: 'rejected'
      reason: 'invalid_signature' | 'invalid_request' | 'tenant_policy_denied' | 'stale_signature' | 'provider_disabled' | 'rate_limited'
      receipt: WhatsAppReceipt
    }
  | { status: 'retryable'; reason: string; receipt: WhatsAppReceipt }
  | { status: 'dead_letter'; reason: string; receipt: WhatsAppReceipt }

export type WhatsAppReconciliation = {
  status: 'clean' | 'recovered'
  tenantId: string
  failedReceipts: number
  pendingDeliveries: number
  deadLetters: number
  pendingOutbox: number
}

type WhatsAppIdempotencyRecord = {
  tenantId: string
  key: string
  requestHash: string
  response: { messageId: string } | null
}

type WhatsAppStoreSnapshot = {
  messages: Map<string, WhatsAppMessage>
  outbox: Map<string, WhatsAppOutboxRecord>
  sagas: Map<string, WhatsAppSaga>
  idempotency: Map<string, WhatsAppIdempotencyRecord>
}

function tenantKey(tenantId: string, id: string): string {
  return `${tenantId}:${id}`
}

function clone<TValue>(value: TValue): TValue {
  return structuredClone(value)
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function requestHash(input: WhatsAppWebhookRequest): string {
  return digest(
    JSON.stringify({
      eventId: input.eventId,
      messageId: input.messageId,
      phoneNumberId: input.phoneNumberId,
      from: input.from,
      to: input.to,
      messageType: input.messageType,
      text: input.text,
    })
  )
}

function validContext(context: WhatsAppMessageContext): boolean {
  return Boolean(context.tenantId.trim() && context.actorId.trim() && context.correlationId.trim())
}

function validWebhook(input: WhatsAppWebhookRequest): boolean {
  return Boolean(
    validContext(input.context) &&
    input.eventId.trim() &&
    input.requestId.trim() &&
    input.phoneNumberId.trim() &&
    input.messageId.trim() &&
    input.from.trim() &&
    input.to.trim() &&
    input.messageType === MESSAGE_TYPE.TEXT &&
    input.text.trim() &&
    input.text.length <= 4096 &&
    Number.isSafeInteger(input.timestamp) &&
    input.timestamp > 0 &&
    input.signature.trim()
  )
}

function policyAllows(
  policies: readonly WhatsAppTenantPolicy[],
  input: WhatsAppWebhookRequest
): boolean {
  const policy = policies.find((candidate) => candidate.phoneNumberId === input.phoneNumberId)
  return Boolean(
    policy &&
    policy.enabled !== false &&
    policy.tenantId === input.context.tenantId &&
    policy.allowedSenders.includes(input.from) &&
    (policy.allowedMessageTypes ?? [MESSAGE_TYPE.TEXT]).includes(input.messageType)
  )
}

function safeProviderError(error: unknown): string {
  if (error instanceof WhatsAppTimeoutError) return 'provider_timeout'
  if (error instanceof WhatsAppProviderUnavailableError) return 'provider_unavailable'
  return 'provider_request_failed'
}

export function createWhatsAppSignature(
  secret: string,
  eventId: string,
  requestId: string,
  timestamp: number
): string {
  const manifest = `id:${eventId};request-id:${requestId};ts:${timestamp};`
  return `ts=${timestamp},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`
}

export function verifyWhatsAppSignature(
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
    createWhatsAppSignature(secret, eventId, requestId, timestamp).split('v1=')[1] ?? ''
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const suppliedBuffer = Buffer.from(suppliedSignature, 'utf8')
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  )
}

export class WhatsAppProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE'

  constructor() {
    super('WhatsApp provider is unavailable')
    this.name = 'WhatsAppProviderUnavailableError'
  }
}

export class WhatsAppTimeoutError extends Error {
  readonly code = 'PROVIDER_TIMEOUT'

  constructor() {
    super('WhatsApp provider request timed out')
    this.name = 'WhatsAppTimeoutError'
  }
}

export class WhatsAppProviderAdapter implements WhatsAppProviderPort {
  private readonly transport: WhatsAppProviderTransport

  constructor(transport: WhatsAppProviderTransport) {
    this.transport = transport
  }

  sendMessage(input: WhatsAppSendMessageInput): Promise<WhatsAppProviderMessage> {
    if (!input.tenantId.trim() || !input.to.trim() || !input.text.trim())
      return Promise.reject(new Error('WhatsApp message fields are required'))
    return this.transport.sendMessage(input)
  }
}

export class DeterministicWhatsAppProvider implements WhatsAppProviderPort {
  failNext = 0
  timeoutNext = 0
  sendCalls = 0
  readonly sent: WhatsAppSendMessageInput[] = []

  async sendMessage(input: WhatsAppSendMessageInput): Promise<WhatsAppProviderMessage> {
    this.sendCalls += 1
    if (this.timeoutNext > 0) {
      this.timeoutNext -= 1
      throw new WhatsAppTimeoutError()
    }
    if (this.failNext > 0) {
      this.failNext -= 1
      throw new WhatsAppProviderUnavailableError()
    }
    this.sent.push(clone(input))
    return { providerMessageId: `whatsapp-message-${input.sourceEventId}`, status: 'sent' }
  }
}

export class InMemoryWhatsAppStore {
  private readonly receipts = new Map<string, WhatsAppReceipt>()
  private readonly requests = new Map<string, WhatsAppWebhookRequest>()
  private readonly messages = new Map<string, WhatsAppMessage>()
  private readonly outbox = new Map<string, WhatsAppOutboxRecord>()
  private readonly sagas = new Map<string, WhatsAppSaga>()
  private readonly idempotency = new Map<string, WhatsAppIdempotencyRecord>()
  private readonly jobs = new Map<string, WhatsAppDeliveryJob>()
  private readonly deadLetters = new Map<string, WhatsAppDeadLetter>()

  recordReceipt(
    input: WhatsAppWebhookRequest,
    now: number
  ): { fresh: boolean; receipt: WhatsAppReceipt } {
    const key = tenantKey(input.context.tenantId, input.eventId)
    const existing = this.receipts.get(key)
    if (existing) return { fresh: false, receipt: clone(existing) }
    const receipt: WhatsAppReceipt = {
      contractVersion: '1.0.0',
      receiptId: `receipt-${input.eventId}`,
      tenantId: input.context.tenantId,
      provider: 'whatsapp',
      eventId: input.eventId,
      requestId: input.requestId,
      messageId: input.messageId,
      phoneNumberId: input.phoneNumberId,
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

  getReceipt(tenantId: string, eventId: string): WhatsAppReceipt | null {
    const value = this.receipts.get(tenantKey(tenantId, eventId))
    return value ? clone(value) : null
  }

  markReceipt(tenantId: string, eventId: string, patch: Partial<WhatsAppReceipt>): WhatsAppReceipt {
    const key = tenantKey(tenantId, eventId)
    const current = this.receipts.get(key)
    if (!current) throw new Error('WhatsApp receipt not found')
    const updated = { ...current, ...clone(patch) }
    this.receipts.set(key, updated)
    return clone(updated)
  }

  transaction<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    const snapshot: WhatsAppStoreSnapshot = {
      messages: new Map([...this.messages].map(([key, value]) => [key, clone(value)])),
      outbox: new Map([...this.outbox].map(([key, value]) => [key, clone(value)])),
      sagas: new Map([...this.sagas].map(([key, value]) => [key, clone(value)])),
      idempotency: new Map([...this.idempotency].map(([key, value]) => [key, clone(value)])),
    }
    return operation().catch((error: unknown) => {
      this.messages.clear()
      this.outbox.clear()
      this.sagas.clear()
      this.idempotency.clear()
      for (const [key, value] of snapshot.messages) this.messages.set(key, value)
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

  completeIdempotency(tenantId: string, key: string, response: { messageId: string }): void {
    const record = this.idempotency.get(tenantKey(tenantId, key))
    if (!record) throw new Error('WhatsApp idempotency record not found')
    record.response = clone(response)
  }

  upsertMessage(message: WhatsAppMessage): WhatsAppMessage {
    const key = tenantKey(message.tenantId, message.messageId)
    const existing = this.messages.get(key)
    const next = existing && existing.receivedAt > message.receivedAt ? existing : message
    this.messages.set(key, clone(next))
    return clone(next)
  }

  appendOutbox(event: WhatsAppOutboxRecord): WhatsAppOutboxRecord {
    const key = tenantKey(event.tenantId, event.eventId)
    const existing = this.outbox.get(key)
    if (existing) return clone(existing)
    this.outbox.set(key, clone(event))
    return clone(event)
  }

  ensureSaga(tenantId: string, eventId: string, now: number): WhatsAppSaga {
    const key = tenantKey(tenantId, eventId)
    const existing = this.sagas.get(key)
    if (existing) return clone(existing)
    const saga: WhatsAppSaga = {
      sagaId: `whatsapp-saga-${eventId}`,
      tenantId,
      eventId,
      status: SAGA_STATUS.PENDING,
      steps: [
        { name: 'verify-receipt', status: 'pending' },
        { name: 'normalize-message', status: 'pending' },
        { name: 'publish-outbox', status: 'pending' },
        { name: 'deliver-message', status: 'pending' },
      ],
      updatedAt: now,
      compensationReason: null,
    }
    this.sagas.set(key, saga)
    return clone(saga)
  }

  completeSaga(tenantId: string, eventId: string, now: number): WhatsAppSaga {
    const saga = this.requireSaga(tenantId, eventId)
    saga.status = SAGA_STATUS.COMPLETED
    saga.updatedAt = now
    saga.steps = saga.steps.map((step) => ({ ...step, status: 'completed' }))
    this.sagas.set(tenantKey(tenantId, eventId), saga)
    return clone(saga)
  }

  compensateSaga(tenantId: string, eventId: string, reason: string, now: number): WhatsAppSaga {
    const saga = this.requireSaga(tenantId, eventId)
    saga.status = SAGA_STATUS.COMPENSATED
    saga.updatedAt = now
    saga.compensationReason = reason
    saga.steps = saga.steps.map((step) => ({ ...step, status: 'compensated' }))
    this.sagas.set(tenantKey(tenantId, eventId), saga)
    return clone(saga)
  }

  enqueueJob(input: WhatsAppDeliveryJob): WhatsAppDeliveryJob {
    this.jobs.set(tenantKey(input.tenantId, input.event.eventId), clone(input))
    return clone(input)
  }

  nextJob(tenantId: string, now: number): WhatsAppDeliveryJob | null {
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
    patch: Partial<WhatsAppDeliveryJob>
  ): WhatsAppDeliveryJob {
    const key = tenantKey(tenantId, eventId)
    const current = this.jobs.get(key)
    if (!current) throw new Error('WhatsApp delivery job not found')
    const updated = { ...current, ...clone(patch) }
    this.jobs.set(key, updated)
    return clone(updated)
  }

  removeJob(tenantId: string, eventId: string): void {
    this.jobs.delete(tenantKey(tenantId, eventId))
  }

  quarantineJob(tenantId: string, eventId: string, now: number): WhatsAppDeadLetter {
    const key = tenantKey(tenantId, eventId)
    const job = this.jobs.get(key)
    if (!job) throw new Error('WhatsApp delivery job not found')
    const deadLetter: WhatsAppDeadLetter = {
      ...clone(job),
      status: DELIVERY_STATUS.DEAD_LETTER,
      quarantinedAt: now,
    }
    this.deadLetters.set(key, deadLetter)
    this.jobs.delete(key)
    return clone(deadLetter)
  }

  getMessage(tenantId: string, messageId: string): WhatsAppMessage | null {
    const value = this.messages.get(tenantKey(tenantId, messageId))
    return value ? clone(value) : null
  }

  getSaga(tenantId: string, eventId: string): WhatsAppSaga | null {
    const value = this.sagas.get(tenantKey(tenantId, eventId))
    return value ? clone(value) : null
  }

  listReceipts(tenantId: string): WhatsAppReceipt[] {
    return [...this.receipts.values()].filter((value) => value.tenantId === tenantId).map(clone)
  }

  listMessages(tenantId: string): WhatsAppMessage[] {
    return [...this.messages.values()].filter((value) => value.tenantId === tenantId).map(clone)
  }

  listOutbox(tenantId: string): WhatsAppOutboxRecord[] {
    return [...this.outbox.values()].filter((value) => value.tenantId === tenantId).map(clone)
  }

  listDeadLetters(tenantId: string): WhatsAppDeadLetter[] {
    return [...this.deadLetters.values()].filter((value) => value.tenantId === tenantId).map(clone)
  }

  listJobs(tenantId: string): WhatsAppDeliveryJob[] {
    return [...this.jobs.values()].filter((value) => value.tenantId === tenantId).map(clone)
  }

  private requireSaga(tenantId: string, eventId: string): WhatsAppSaga {
    const saga = this.sagas.get(tenantKey(tenantId, eventId))
    if (!saga) throw new Error('WhatsApp saga not found')
    return clone(saga)
  }
}

export class WhatsAppAdapter {
  private readonly maxAttempts: number
  private readonly retryDelayMs: number
  private readonly options: WhatsAppAdapterOptions
  private readonly clock?: () => number
  private readonly freshnessMs?: number
  private readonly providerEnabled: boolean
  private readonly rateLimit?: { maxPerWindow: number; windowMs: number }
  private readonly requestWindows = new Map<string, number[]>()

  constructor(options: WhatsAppAdapterOptions) {
    this.options = options
    if (!options.secret.trim()) throw new Error('WhatsApp signature secret reference is required')
    this.maxAttempts = options.maxAttempts ?? 3
    this.retryDelayMs = options.retryDelayMs ?? 1_000
    this.clock = options.clock
    this.freshnessMs = options.freshnessMs
    this.providerEnabled = options.providerEnabled ?? true
    this.rateLimit = options.rateLimit
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1)
      throw new Error('WhatsApp maxAttempts must be positive')
    if (options.policies.length === 0) throw new Error('WhatsApp tenant policy is required')
    if (this.freshnessMs !== undefined && (!Number.isFinite(this.freshnessMs) || this.freshnessMs <= 0)) throw new Error('WhatsApp freshnessMs must be positive')
    if (this.rateLimit && (!Number.isInteger(this.rateLimit.maxPerWindow) || this.rateLimit.maxPerWindow < 1 || !Number.isFinite(this.rateLimit.windowMs) || this.rateLimit.windowMs <= 0)) throw new Error('WhatsApp rate limit must be positive')
  }

  async receiveWebhook(input: WhatsAppWebhookRequest): Promise<WhatsAppWebhookResult> {
    const now = input.timestamp * 1_000
    const recorded = this.options.store.recordReceipt(input, now)
    const reject = (reason: Extract<WhatsAppWebhookResult, { status: 'rejected' }>['reason']): WhatsAppWebhookResult => ({
      status: 'rejected',
      reason,
      receipt: recorded.fresh ? this.options.store.markReceipt(input.context.tenantId, input.eventId, { status: RECEIPT_STATUS.REJECTED, reason }) : recorded.receipt,
    })
    if (!validWebhook(input)) {
      return reject('invalid_request')
    }
    if (!policyAllows(this.options.policies, input)) {
      return reject('tenant_policy_denied')
    }
    if (this.clock && this.freshnessMs !== undefined && Math.abs(this.clock() - input.timestamp * 1_000) > this.freshnessMs) {
      return reject('stale_signature')
    }
    if (
      !verifyWhatsAppSignature(
        this.options.secret,
        input.eventId,
        input.requestId,
        input.timestamp,
        input.signature
      )
    ) {
      return reject('invalid_signature')
    }
    if (!recorded.fresh) {
      return {
        status: 'replay',
        receipt: recorded.receipt,
        message: this.options.store.getMessage(input.context.tenantId, input.messageId),
      }
    }
    if (!this.providerEnabled) {
      return reject('provider_disabled')
    }
    if (!this.allowRate(input.context.tenantId)) {
      return reject('rate_limited')
    }
    return this.process(input, recorded.receipt, 1)
  }

  async retryNext(now: number, tenantId: string): Promise<WhatsAppWebhookResult | null> {
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

  async reconcile(now: number, tenantId: string): Promise<WhatsAppReconciliation> {
    const receipts = this.options.store.listReceipts(tenantId)
    const jobs = this.options.store.listJobs(tenantId)
    const deadLetters = this.options.store.listDeadLetters(tenantId)
    const pendingOutbox = this.options.store
      .listOutbox(tenantId)
      .filter((event) => !event.published).length
    void now
    return {
      status:
        receipts.some((receipt) => receipt.status === RECEIPT_STATUS.FAILED) ||
        deadLetters.length > 0
          ? 'recovered'
          : 'clean',
      tenantId,
      failedReceipts: receipts.filter((receipt) => receipt.status === RECEIPT_STATUS.FAILED).length,
      pendingDeliveries: jobs.length,
      deadLetters: deadLetters.length,
      pendingOutbox,
    }
  }

  async getMessage(input: {
    tenantId: string
    messageId: string
  }): Promise<WhatsAppMessage | null> {
    return this.options.store.getMessage(input.tenantId, input.messageId)
  }

  private async process(
    input: WhatsAppWebhookRequest,
    receipt: WhatsAppReceipt,
    attempt: number,
    existingJob?: WhatsAppDeliveryJob
  ): Promise<WhatsAppWebhookResult> {
    const now = input.timestamp * 1_000 + attempt
    this.options.store.ensureSaga(input.context.tenantId, input.eventId, now)
    try {
      await this.options.provider.sendMessage({
        tenantId: input.context.tenantId,
        to: input.from,
        text: input.text,
        correlationId: input.context.correlationId,
        sourceEventId: input.eventId,
      })
      const message = await this.options.store.transaction(async () => {
        const idempotencyKey = `whatsapp:webhook:${input.eventId}`
        const claim = this.options.store.claimIdempotency(
          input.context.tenantId,
          idempotencyKey,
          requestHash(input)
        )
        if (claim === 'conflict') throw new WhatsAppIdempotencyConflictError()
        if (claim === 'replay') {
          const replay = this.options.store.getMessage(input.context.tenantId, input.messageId)
          if (!replay) throw new Error('WhatsApp replay record missing')
          return replay
        }
        const next: WhatsAppMessage = {
          contractVersion: '1.0.0',
          tenantId: input.context.tenantId,
          messageId: input.messageId,
          provider: 'whatsapp',
          phoneNumberId: input.phoneNumberId,
          from: input.from,
          to: input.to,
          messageType: input.messageType,
          text: input.text,
          correlationId: input.context.correlationId,
          sourceEventId: input.eventId,
          receivedAt: now,
        }
        this.options.store.upsertMessage(next)
        this.options.store.appendOutbox({
          contractVersion: '1.0.0',
          eventId: `messaging-event-${input.eventId}`,
          tenantId: input.context.tenantId,
          aggregateType: 'message',
          aggregateId: next.messageId,
          eventType: 'message.received',
          payload: {
            messageId: next.messageId,
            phoneNumberId: next.phoneNumberId,
            from: next.from,
            to: next.to,
            messageType: next.messageType,
            text: next.text,
          },
          createdAt: now,
          published: false,
        })
        this.options.store.completeIdempotency(input.context.tenantId, idempotencyKey, {
          messageId: next.messageId,
        })
        this.options.store.completeSaga(input.context.tenantId, input.eventId, now)
        return next
      })
      this.options.store.removeJob(input.context.tenantId, input.eventId)
      const processedReceipt = this.options.store.markReceipt(
        input.context.tenantId,
        input.eventId,
        { status: RECEIPT_STATUS.PROCESSED, reason: null, processedAt: now }
      )
      return { status: 'processed', receipt: processedReceipt, message }
    } catch (error) {
      const reason =
        error instanceof WhatsAppIdempotencyConflictError
          ? 'idempotency_conflict'
          : safeProviderError(error)
      const failed = this.options.store.markReceipt(input.context.tenantId, input.eventId, {
        status: RECEIPT_STATUS.FAILED,
        reason,
      })
      const job = existingJob ?? {
        jobId: `whatsapp-delivery-${input.eventId}`,
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

  private allowRate(tenantId: string): boolean {
    if (!this.rateLimit) return true
    const now = this.clock?.() ?? Date.now()
    const cutoff = now - this.rateLimit.windowMs
    const current = (this.requestWindows.get(tenantId) ?? []).filter((value) => value > cutoff)
    if (current.length >= this.rateLimit.maxPerWindow) {
      this.requestWindows.set(tenantId, current)
      return false
    }
    current.push(now)
    this.requestWindows.set(tenantId, current)
    return true
  }
}

export class WhatsAppIdempotencyConflictError extends Error {
  readonly code = 'WHATSAPP_IDEMPOTENCY_CONFLICT'

  constructor() {
    super('WhatsApp webhook idempotency conflict')
    this.name = 'WhatsAppIdempotencyConflictError'
  }
}

export default {
  WhatsAppAdapter,
  WhatsAppProviderAdapter,
  DeterministicWhatsAppProvider,
  InMemoryWhatsAppStore,
  createWhatsAppSignature,
  verifyWhatsAppSignature,
}
