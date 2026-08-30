import {
  QUEUE_ACTIVATION,
  QueueActivationError,
  type QueueActivation,
  type QueueAcknowledgeInput,
  type QueueAcknowledgeResult,
  type QueueCancelInput,
  type QueueCancelResult,
  type QueueClaimInput,
  type QueueClaimResult,
  type QueueEnqueueResult,
  type QueueMessageInput,
  type QueueReconcileInput,
  type QueueReconcileResult,
  type QueueRetryInput,
  type QueueRetryResult,
} from '../ports/index.js'
import { InMemoryQueueTransport } from '../fakes/index.js'

export interface SqsDlqOptions {
  queueUrlRef: string
  dlqUrlRef: string
  activation?: QueueActivation
}

export class SqsDlqQueueTransport extends InMemoryQueueTransport {
  readonly queueUrlRef: string
  readonly dlqUrlRef: string
  private _activation: QueueActivation

  constructor(options: SqsDlqOptions) {
    super()
    if (!options.queueUrlRef.trim() || !options.dlqUrlRef.trim())
      throw new Error('SQS queue references are required')
    this.queueUrlRef = options.queueUrlRef
    this.dlqUrlRef = options.dlqUrlRef
    this._activation = options.activation ?? QUEUE_ACTIVATION.DISABLED
  }

  get activation(): QueueActivation {
    return this._activation
  }

  activate(): void {
    this._activation = QUEUE_ACTIVATION.ENABLED
  }

  deactivate(): void {
    this._activation = QUEUE_ACTIVATION.DISABLED
  }

  override async enqueue(input: QueueMessageInput): Promise<QueueEnqueueResult> {
    this.assertEnabled()
    return super.enqueue(input)
  }

  override async claim(input: QueueClaimInput): Promise<QueueClaimResult> {
    this.assertEnabled()
    return super.claim(input)
  }

  override async acknowledge(input: QueueAcknowledgeInput): Promise<QueueAcknowledgeResult> {
    this.assertEnabled()
    return super.acknowledge(input)
  }

  override async retry(input: QueueRetryInput): Promise<QueueRetryResult> {
    this.assertEnabled()
    return super.retry(input)
  }

  override async cancel(input: QueueCancelInput): Promise<QueueCancelResult> {
    this.assertEnabled()
    return super.cancel(input)
  }

  override async reconcile(input: QueueReconcileInput): Promise<QueueReconcileResult> {
    this.assertEnabled()
    return super.reconcile(input)
  }

  override async deadLetters(tenantId: string) {
    this.assertEnabled()
    return super.deadLetters(tenantId)
  }

  private assertEnabled(): void {
    if (this._activation !== QUEUE_ACTIVATION.ENABLED) throw new QueueActivationError('SQS + DLQ')
  }
}

export const SqsDlqTransport = SqsDlqQueueTransport

export default { SqsDlqQueueTransport, SqsDlqTransport }
