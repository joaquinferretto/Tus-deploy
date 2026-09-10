const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  createWebhookSignature,
  mapMoneyOutEvent,
  mapPaymentEvent,
  MercadoPagoApiError,
  MercadoPagoClient,
  MercadoPagoMoneyOutClient,
  parseWebhookNotification,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_MODES,
} = require('../dist')

function fakeFetch(response, status = 200, requests = []) {
  return async (url, init) => {
    requests.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
    }
  }
}

test('creates a generic preference payload without provider-domain fields', async () => {
  const requests = []
  const client = new MercadoPagoClient({
    accessToken: 'token-fixture',
    fetch: fakeFetch(
      { id: 'preference-test', init_point: 'https://example.invalid/checkout' },
      201,
      requests,
    ),
  })

  const preference = await client.createPreference({
    externalReference: 'order-123',
    items: [
      {
        id: 'item-1',
        title: 'Synthetic item',
        quantity: 2,
        currencyId: 'ARS',
        unitPrice: 125,
      },
    ],
    backUrls: {
      success: 'https://example.invalid/success',
      failure: 'https://example.invalid/failure',
      pending: 'https://example.invalid/pending',
    },
    notificationUrl: 'https://example.invalid/webhooks/mercado-pago',
  })

  assert.equal(preference.id, 'preference-test')
  assert.equal(requests[0].url, 'https://api.mercadopago.com/checkout/preferences')
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    external_reference: 'order-123',
    items: [
      {
        id: 'item-1',
        title: 'Synthetic item',
        quantity: 2,
        currency_id: 'ARS',
        unit_price: 125,
      },
    ],
    back_urls: {
      success: 'https://example.invalid/success',
      failure: 'https://example.invalid/failure',
      pending: 'https://example.invalid/pending',
    },
    auto_return: 'approved',
    notification_url: 'https://example.invalid/webhooks/mercado-pago',
  })
})

test('normalizes payment and refund responses', async () => {
  const requests = []
  const client = new MercadoPagoClient({
    accessToken: 'token-fixture',
    fetch: async (url, init) => {
      requests.push({ url, init })

      if (url.endsWith('/refunds/refund-1')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'refund-1', status: 'approved', amount: 25 }),
        }
      }

      if (url.endsWith('/refunds')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'refund-1', status: 'pending', amount: 25 }),
        }
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'payment-1',
          status: 'in_process',
          status_detail: 'pending_review',
          transaction_amount: 25,
          currency_id: 'ARS',
          external_reference: 'order-123',
        }),
      }
    },
  })

  const payment = await client.getPayment('payment-1')
  const createdRefund = await client.createRefund('payment-1', { amount: 25 })
  const refund = await client.getRefund('payment-1', 'refund-1')

  assert.equal(payment.status, 'pending')
  assert.equal(payment.externalReference, 'order-123')
  assert.equal(createdRefund.status, 'pending')
  assert.equal(refund.status, 'approved')
  assert.equal(requests[1].init.body, JSON.stringify({ amount: 25 }))
})

test('rejects missing, expired, and mismatched webhook signatures', () => {
  const rawBody = Buffer.from('{"type":"payment","data":{"id":"payment-1"}}')
  const secret = 'secret-fixture'
  const requestId = 'request-1'
  const dataId = 'payment-1'
  const nowMs = 1_700_000_000_000
  const timestamp = Math.floor(nowMs / 1000)
  const signature = createWebhookSignature({
    rawBody,
    secret,
    timestamp,
    requestId,
    dataId,
  })

  assert.equal(
    verifyWebhookSignature({
      rawBody,
      secret,
      signatureHeader: signature,
      requestId,
      dataId,
      nowMs,
    }).valid,
    true,
  )
  assert.equal(
    verifyWebhookSignature({ rawBody, secret, nowMs }).reason,
    'malformed-signature',
  )
  assert.equal(
    verifyWebhookSignature({
      rawBody,
      secret,
      signatureHeader: signature,
      requestId,
      dataId,
      nowMs: nowMs + 301_000,
    }).reason,
    'expired-signature',
  )
  assert.equal(
    verifyWebhookSignature({
      rawBody,
      secret,
      signatureHeader: signature,
      requestId,
      dataId: 'payment-2',
      nowMs,
    }).reason,
    'mismatched-signature',
  )
})

test('raw-body mode signs exact bytes and parses only after verification', () => {
  const rawBody = Buffer.from('{"data":{"id":"payment-1"}}\n')
  const secret = 'secret-fixture'
  const timestamp = 1_700_000_000
  const signature = createWebhookSignature({
    rawBody,
    secret,
    timestamp,
    mode: WEBHOOK_SIGNATURE_MODES.RAW_BODY,
  })

  assert.equal(
    verifyWebhookSignature({
      rawBody,
      secret,
      signatureHeader: signature,
      mode: WEBHOOK_SIGNATURE_MODES.RAW_BODY,
      nowMs: timestamp * 1000,
    }).valid,
    true,
  )
  assert.notEqual(
    verifyWebhookSignature({
      rawBody: Buffer.from('{"data":{"id":"payment-1"}}'),
      secret,
      signatureHeader: signature,
      mode: WEBHOOK_SIGNATURE_MODES.RAW_BODY,
      nowMs: timestamp * 1000,
    }).valid,
    true,
  )
  assert.deepEqual(parseWebhookNotification(rawBody), {
    type: undefined,
    action: undefined,
    dataId: 'payment-1',
    eventId: undefined,
    status: undefined,
  })
})

test('maps authoritative payment and optional Money Out events by external reference', () => {
  const paymentEvent = mapPaymentEvent(
    {
      eventId: 'notification-1',
      type: 'payment',
      action: 'payment.updated',
      dataId: 'payment-1',
    },
    {
      id: 'payment-1',
      status: 'approved',
      externalReference: 'order-123',
    },
  )
  const moneyOutEvent = mapMoneyOutEvent(
    {
      eventId: 'notification-2',
      type: 'transaction_intent',
      action: 'transaction_intent.updated',
      dataId: 'transaction-1',
    },
    {
      id: 'transaction-1',
      status: 'processed',
      externalReference: 'transfer-123',
    },
  )

  assert.equal(paymentEvent.externalReference, 'order-123')
  assert.equal(paymentEvent.status, 'approved')
  assert.equal(moneyOutEvent.externalReference, 'transfer-123')
  assert.equal(moneyOutEvent.status, 'processed')
  assert.equal(
    mapPaymentEvent(
      { type: 'payment', dataId: 'different-payment' },
      { id: 'payment-1', status: 'approved' },
    ),
    undefined,
  )
})

test('creates and normalizes optional Money Out transaction intents', async () => {
  const requests = []
  const client = new MercadoPagoMoneyOutClient({
    accessToken: 'token-fixture',
    fetch: fakeFetch(
      {
        id: 'transaction-1',
        status: 'processed',
        external_reference: 'transfer-123',
        transaction: { total_amount: 100 },
      },
      202,
      requests,
    ),
  })

  const transaction = await client.createTransactionIntent({
    externalReference: 'transfer-123',
    amount: 100,
    idempotencyKey: 'idempotency-placeholder',
    notificationUrl: 'https://example.invalid/webhooks/money-out',
    destinationAccount: {
      accountType: 'current',
      bankId: 'bank-test',
      number: 'account-test',
      holder: 'Synthetic Holder',
      currencyId: 'ARS',
      holderIdentification: { type: 'generic', number: 'holder-test' },
    },
  })
  const currentTransaction = await client.getTransactionIntent('transaction-1')

  const body = JSON.parse(requests[0].init.body)
  assert.equal(requests[0].url, 'https://api.mercadopago.com/v1/transaction-intents/process')
  assert.equal(requests[1].url, 'https://api.mercadopago.com/v1/transaction-intents/transaction-1')
  assert.equal(body.external_reference, 'transfer-123')
  assert.equal(body.transaction.to.accounts[0].number, 'account-test')
  assert.equal(body.transaction.to.accounts[0].owner.identification.type, 'generic')
  assert.equal(transaction.status, 'processed')
  assert.equal(transaction.amount, 100)
  assert.equal(currentTransaction.status, 'processed')
})

test('never leaks the access token in provider errors', async () => {
  const accessToken = 'token-fixture'
  const client = new MercadoPagoClient({
    accessToken,
    fetch: fakeFetch({ error: 'synthetic failure' }, 500),
  })

  await assert.rejects(
    client.getPayment('payment-1'),
    (error) => {
      assert.ok(error instanceof MercadoPagoApiError)
      assert.equal(error.status, 500)
      assert.equal(error.message.includes(accessToken), false)
      assert.equal(JSON.stringify(error).includes(accessToken), false)
      return true
    },
  )
})
