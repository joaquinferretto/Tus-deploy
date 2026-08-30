import type { JsonValue } from '../domain.js'
import {
  IDEMPOTENCY_CLAIM_STATUS,
  type IdempotencyClaimInput,
  type IdempotencyClaimResult,
} from '../domain.js'
import type { TransactionalPlatformPort } from '../../outbox/ports.js'
import type { OutboxEventInput } from '../../outbox/domain.js'

export interface IdempotentActionInput {
  request: IdempotencyClaimInput
  event: OutboxEventInput
}

export type IdempotentActionResult =
  | { status: 'executed'; response: JsonValue }
  | { status: 'replay'; response: JsonValue }
  | { status: 'in_progress' }
  | { status: 'conflict' }
  | { status: 'forbidden' }

export class IdempotentActionService {
  constructor(private readonly platform: TransactionalPlatformPort) {}

  async execute(
    input: IdempotentActionInput,
    action: () => Promise<JsonValue>
  ): Promise<IdempotentActionResult> {
    if (input.request.tenantId !== input.event.tenantId) return { status: 'forbidden' }
    return this.platform.transaction(async (transaction) => {
      const claim = await transaction.idempotency.claim(input.request)
      if (claim.status !== IDEMPOTENCY_CLAIM_STATUS.CLAIMED) return mapClaim(claim)
      const response = await action()
      await transaction.idempotency.complete({ ...input.request, response })
      await transaction.outbox.append(input.event)
      return { status: 'executed', response }
    })
  }
}

function mapClaim(claim: IdempotencyClaimResult): IdempotentActionResult {
  if (claim.status === IDEMPOTENCY_CLAIM_STATUS.REPLAY)
    return { status: 'replay', response: claim.response }
  if (claim.status === IDEMPOTENCY_CLAIM_STATUS.IN_PROGRESS) return { status: 'in_progress' }
  if (claim.status === IDEMPOTENCY_CLAIM_STATUS.CONFLICT) return { status: 'conflict' }
  return { status: 'forbidden' }
}

export default { IdempotentActionService }
