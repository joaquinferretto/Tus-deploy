import { createHmac } from 'node:crypto'

type PaymentContext = {
  tenantId: string
  actorId: string
  correlationId: string
}

type PaymentEvent = {
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
}

export type PaymentFallbackFixture = {
  secret: string
  context: PaymentContext
  event: PaymentEvent & { signature: string }
}

function sign(secret: string, event: PaymentEvent): string {
  const manifest = `id:${event.eventId};request-id:${event.requestId};ts:${event.timestamp};`
  return `ts=${event.timestamp},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`
}

export function createPaymentFallbackFixture(): PaymentFallbackFixture {
  const secret = 'fixture-secret-only'
  const context = {
    tenantId: 'fixture-tenant',
    actorId: 'fixture-actor',
    correlationId: 'fixture-correlation',
  }
  const event = {
    eventId: 'fixture-payment-event',
    requestId: 'fixture-payment-request',
    timestamp: 1_700_000_100,
    externalPaymentId: 'fixture-payment',
    action: 'payment.approved',
    payload: {
      data: { id: 'fixture-payment' },
      type: 'payment' as const,
      action: 'payment.approved',
    },
  }
  return {
    secret,
    context,
    event: {
      ...event,
      signature: sign(secret, event),
    },
  }
}

export default { createPaymentFallbackFixture }
