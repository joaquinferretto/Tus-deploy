import { createHmac } from 'node:crypto'

type MessagingContext = {
  tenantId: string
  actorId: string
  correlationId: string
}

type MessagingPolicy = {
  tenantId: string
  phoneNumberId: string
  allowedSenders: string[]
}

type MessagingEvent = {
  eventId: string
  requestId: string
  timestamp: number
  phoneNumberId: string
  messageId: string
  from: string
  to: string
  messageType: 'text'
  text: string
}

const MESSAGING_CAPABILITY_STATUS = {
  DELIVERED: 'delivered',
  REPLAY: 'replay',
  RETRYABLE: 'retryable',
} as const

type MessagingCapabilityStatus =
  (typeof MESSAGING_CAPABILITY_STATUS)[keyof typeof MESSAGING_CAPABILITY_STATUS]

interface MessagingCapabilityContext {
  tenantId: string
  actorId: string
  correlationId: string
}

interface MessagingCapabilityContextOptions {
  tenantId?: string
  actorId?: string
  correlationId?: string
}

interface MessagingDelivery {
  messageId: string
  tenantId: string
  status: Extract<MessagingCapabilityStatus, 'delivered'>
  attempt: number
}

interface MessagingReplay {
  status: Extract<MessagingCapabilityStatus, 'replay'>
  effectApplied: false
}

interface MessagingRetry {
  status: Extract<MessagingCapabilityStatus, 'retryable'>
  attempt: number
  nextAttempt: number
}

export interface MessagingCapabilityFixture {
  context: MessagingCapabilityContext
  delivery: MessagingDelivery
  replay: MessagingReplay
  retry: MessagingRetry
  foreignRecordVisible: boolean
}

export type MessagingFallbackFixture = {
  secret: string
  context: MessagingContext
  policy: MessagingPolicy
  event: MessagingEvent & { signature: string }
}

function sign(secret: string, event: MessagingEvent): string {
  const manifest = `id:${event.eventId};request-id:${event.requestId};ts:${event.timestamp};`
  return `ts=${event.timestamp},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`
}

export function createMessagingFallbackFixture(): MessagingFallbackFixture {
  const secret = 'fixture-whatsapp-secret-only'
  const context = {
    tenantId: 'fixture-tenant',
    actorId: 'fixture-whatsapp-gateway',
    correlationId: 'fixture-correlation',
  }
  const policy = {
    tenantId: 'fixture-tenant',
    phoneNumberId: 'fixture-phone-number',
    allowedSenders: ['5491100000000'],
  }
  const event = {
    eventId: 'fixture-whatsapp-event',
    requestId: 'fixture-whatsapp-request',
    timestamp: 1_700_000_100,
    phoneNumberId: 'fixture-phone-number',
    messageId: 'fixture-whatsapp-message',
    from: '5491100000000',
    to: '5491100000001',
    messageType: 'text' as const,
    text: 'hello from local fixture',
  }
  return {
    secret,
    context,
    policy,
    event: {
      ...event,
      signature: sign(secret, event),
    },
  }
}

export function createMessagingCapabilityFixture(
  options: MessagingCapabilityContextOptions = {}
): MessagingCapabilityFixture {
  const context = {
    tenantId: options.tenantId ?? 'fixture-tenant',
    actorId: options.actorId ?? 'fixture-messaging-actor',
    correlationId: options.correlationId ?? 'fixture-messaging-correlation',
  }

  return {
    context,
    delivery: {
      messageId: 'fixture-message',
      tenantId: context.tenantId,
      status: MESSAGING_CAPABILITY_STATUS.DELIVERED,
      attempt: 1,
    },
    replay: { status: MESSAGING_CAPABILITY_STATUS.REPLAY, effectApplied: false },
    retry: { status: MESSAGING_CAPABILITY_STATUS.RETRYABLE, attempt: 1, nextAttempt: 2 },
    foreignRecordVisible: false,
  }
}

export default { createMessagingCapabilityFixture, createMessagingFallbackFixture }
