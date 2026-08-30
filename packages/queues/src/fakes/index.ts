import {
  assertQueueMessage,
  cloneQueueMessage,
  QUEUE_STATUS,
  retryBackoffMs,
  type QueueAcknowledgeInput,
  type QueueAcknowledgeResult,
  type QueueCancelInput,
  type QueueCancelResult,
  type QueueClaim,
  type QueueClaimInput,
  type QueueClaimResult,
  type QueueEnqueueResult,
  type QueueMessage,
  type QueueMessageInput,
  type QueueReconcileInput,
  type QueueReconcileResult,
  type QueueRetryInput,
  type QueueRetryResult,
  type QueueTransportPort,
} from '../ports/index.js'

interface QueueOptions {
  baseBackoffMs?: number
  maxBackoffMs?: number
}

function cloneClaim(claim: QueueClaim): QueueClaim {
  return { ...claim, message: cloneQueueMessage(claim.message) }
}

export class InMemoryQueueTransport implements QueueTransportPort {
  private readonly pending = new Map<string, QueueMessage>()
  private readonly claims = new Map<string, QueueClaim>()
  private readonly quarantined = new Map<string, QueueMessage>()
  private readonly baseBackoffMs: number
  private readonly maxBackoffMs: number

  constructor(options: QueueOptions = {}) {
    this.baseBackoffMs = options.baseBackoffMs ?? 100
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000
  }

  async enqueue(input: QueueMessageInput): Promise<QueueEnqueueResult> {
    assertQueueMessage(input)
    const existing =
      this.pending.get(input.messageId) ??
      [...this.claims.values()].find((claim) => claim.message.messageId === input.messageId)
        ?.message
    if (existing) return { status: QUEUE_STATUS.QUEUED, message: cloneQueueMessage(existing) }
    const message: QueueMessage = {
      ...structuredClone(input),
      availableAt: input.availableAt ?? input.createdAt,
      deliveryCount: 0,
      lastError: null,
    }
    this.pending.set(message.messageId, message)
    return { status: QUEUE_STATUS.QUEUED, message: cloneQueueMessage(message) }
  }

  async claim(input: QueueClaimInput): Promise<QueueClaimResult> {
    if (!input.tenantId.trim() || !input.workerId.trim())
      throw new Error('Queue claim context is required')
    const candidate = [...this.pending.values()].find(
      (message) => message.tenantId === input.tenantId && message.availableAt <= input.now
    )
    if (!candidate) return { status: QUEUE_STATUS.EMPTY }
    if (!Number.isInteger(input.visibilityTimeoutMs) || input.visibilityTimeoutMs <= 0)
      throw new Error('Queue visibility timeout must be positive')
    this.pending.delete(candidate.messageId)
    candidate.deliveryCount += 1
    const claim: QueueClaim = {
      status: QUEUE_STATUS.CLAIMED,
      receiptId: `receipt-${candidate.messageId}-${candidate.deliveryCount}`,
      workerId: input.workerId,
      attempt: candidate.deliveryCount,
      visibilityUntil: input.now + input.visibilityTimeoutMs,
      message: cloneQueueMessage(candidate),
    }
    this.claims.set(claim.receiptId, claim)
    return cloneClaim(claim)
  }

  async acknowledge(input: QueueAcknowledgeInput): Promise<QueueAcknowledgeResult> {
    const claim = this.claims.get(input.receiptId)
    if (!claim) return { status: QUEUE_STATUS.EMPTY }
    if (claim.message.tenantId !== input.tenantId || claim.workerId !== input.workerId)
      return { status: QUEUE_STATUS.FORBIDDEN }
    this.claims.delete(input.receiptId)
    return { status: QUEUE_STATUS.ACKNOWLEDGED, message: cloneQueueMessage(claim.message) }
  }

  async retry(input: QueueRetryInput): Promise<QueueRetryResult> {
    const claim = this.claims.get(input.receiptId)
    if (!claim) return { status: QUEUE_STATUS.EMPTY }
    if (claim.message.tenantId !== input.tenantId || claim.workerId !== input.workerId)
      return { status: QUEUE_STATUS.FORBIDDEN }
    if (!input.error.trim()) throw new Error('Queue retry error is required')
    this.claims.delete(input.receiptId)
    const message = cloneQueueMessage(claim.message)
    message.lastError = input.error
    if (message.deliveryCount >= message.maxAttempts) {
      this.quarantined.set(message.messageId, message)
      return { status: QUEUE_STATUS.DEAD_LETTER, message, error: input.error }
    }
    const delayMs =
      input.delayMs ?? retryBackoffMs(message.deliveryCount, this.baseBackoffMs, this.maxBackoffMs)
    message.availableAt = input.now + delayMs
    this.pending.set(message.messageId, message)
    return {
      status: QUEUE_STATUS.RETRYABLE,
      message,
      availableAt: message.availableAt,
      error: input.error,
    }
  }

  async cancel(input: QueueCancelInput): Promise<QueueCancelResult> {
    if (!input.reason.trim()) throw new Error('Queue cancellation reason is required')
    const pending = [...this.pending.values()].find(
      (message) => message.tenantId === input.tenantId && message.jobId === input.jobId
    )
    if (pending) {
      this.pending.delete(pending.messageId)
      pending.lastError = `cancelled: ${input.reason}`
      return { status: QUEUE_STATUS.CANCELLED, message: pending, queueOwnsBusinessState: false }
    }
    const claim = [...this.claims.entries()].find(
      ([, value]) =>
        value.message.tenantId === input.tenantId && value.message.jobId === input.jobId
    )
    if (!claim) return { status: QUEUE_STATUS.EMPTY, queueOwnsBusinessState: false }
    this.claims.delete(claim[0])
    const message = cloneQueueMessage(claim[1].message)
    message.lastError = `cancelled: ${input.reason}`
    return { status: QUEUE_STATUS.CANCELLED, message, queueOwnsBusinessState: false }
  }

  async reconcile(input: QueueReconcileInput): Promise<QueueReconcileResult> {
    const knownRuns = new Set(input.knownRunIds)
    let expiredClaims = 0
    for (const [receiptId, claim] of [...this.claims.entries()]) {
      if (claim.message.tenantId !== input.tenantId || claim.visibilityUntil > input.now) continue
      this.claims.delete(receiptId)
      const recovered = cloneQueueMessage(claim.message)
      recovered.availableAt = input.now
      this.pending.set(recovered.messageId, recovered)
      expiredClaims += 1
    }
    const tenantPending = [...this.pending.values()].filter(
      (message) => message.tenantId === input.tenantId
    )
    const orphanedMessages = tenantPending.filter((message) => !knownRuns.has(message.runId)).length
    const deadLetterMessages = [...this.quarantined.values()].filter(
      (message) => message.tenantId === input.tenantId
    ).length
    return {
      status: expiredClaims ? 'recovered' : orphanedMessages ? 'attention' : 'clean',
      expiredClaims,
      orphanedMessages,
      pendingMessages: tenantPending.length,
      deadLetterMessages,
      queueOwnsBusinessState: false,
    }
  }

  async deadLetters(tenantId: string): Promise<readonly QueueMessage[]> {
    return [...this.quarantined.values()]
      .filter((message) => message.tenantId === tenantId)
      .map(cloneQueueMessage)
  }
}

export class FakeQueueTransport extends InMemoryQueueTransport {}

export default { InMemoryQueueTransport, FakeQueueTransport }
