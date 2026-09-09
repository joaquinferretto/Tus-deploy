# `@repo/mercado-pago`

Portable TypeScript/Node.js HTTP adapter for Mercado Pago. The package has no Mercado Pago SDK dependency and uses injected `fetch` in tests or Node 20+ native `fetch` in production.

## Capabilities

- Create Checkout Pro preferences with generic `externalReference` values.
- Retrieve and normalize payments.
- Create, retrieve, and list refunds.
- Normalize provider statuses without leaking provider response bodies through errors.
- Verify Mercado Pago webhook signatures with raw request bytes, timestamp tolerance, and constant-time comparison.
- Map authoritative payment events after retrieving the payment from Mercado Pago. The returned `externalReference` is the only application correlation value.
- Provide an explicitly separate, optional Money Out client for transaction intents.

Money Out is not enabled by `MercadoPagoClient`. Consumers must deliberately instantiate `MercadoPagoMoneyOutClient` and obtain commercial authorization from Mercado Pago before using the capability. Production Money Out requests can also require Mercado Pago's end-to-end request signature configuration.

## Environment

Keep secrets in the deployment secret manager. Do not commit real values.

```dotenv
MERCADOPAGO_ACCESS_TOKEN=<inject-from-secret-manager>
MERCADOPAGO_WEBHOOK_SECRET=<inject-from-secret-manager>
MERCADOPAGO_API_BASE_URL=https://api.mercadopago.com
```

The package does not read `.env` files or mutate process configuration. Pass the token explicitly at the composition boundary:

```ts
import { MercadoPagoClient } from '@repo/mercado-pago'

const mercadoPago = new MercadoPagoClient({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN ?? '',
  apiBaseUrl: process.env.MERCADOPAGO_API_BASE_URL,
})
```

## Checkout, payment, and refunds

```ts
const preference = await mercadoPago.createPreference({
  externalReference: 'order-123',
  items: [
    {
      title: 'Example item',
      quantity: 1,
      currencyId: 'ARS',
      unitPrice: 100,
    },
  ],
  backUrls: {
    success: 'https://example.invalid/checkout/success',
    failure: 'https://example.invalid/checkout/failure',
    pending: 'https://example.invalid/checkout/pending',
  },
  notificationUrl: 'https://example.invalid/webhooks/mercado-pago',
})

const payment = await mercadoPago.getPayment('payment-id-from-provider')
const refund = await mercadoPago.createRefund(payment.id, { amount: 25 })
const refundDetails = await mercadoPago.getRefund(payment.id, refund.id)
```

The adapter uses the following provider endpoints:

- `POST /checkout/preferences`
- `GET /v1/payments/{paymentId}`
- `POST /v1/payments/{paymentId}/refunds`
- `GET /v1/payments/{paymentId}/refunds/{refundId}`
- `GET /v1/payments/{paymentId}/refunds`

## Webhooks

Mercado Pago's documented `x-signature` uses an HMAC-SHA256 over the manifest `id;request-id;ts`. The package accepts the untouched request body as `Uint8Array` so an Express parser cannot change the bytes before verification. The body is parsed only after verification.

Register the webhook route before global `express.json()` middleware, or use an equivalent raw-body middleware:

```ts
import express from 'express'
import {
  MercadoPagoClient,
  mapPaymentEvent,
  parseWebhookNotification,
  verifyWebhookSignature,
} from '@repo/mercado-pago'

const app = express()
const mercadoPago = new MercadoPagoClient({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN ?? '',
})

app.post(
  '/webhooks/mercado-pago',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    const rawBody = req.body as Buffer
    const verification = verifyWebhookSignature({
      rawBody,
      secret: process.env.MERCADOPAGO_WEBHOOK_SECRET ?? '',
      signatureHeader: req.header('x-signature'),
      requestId: req.header('x-request-id') ?? undefined,
      dataId: req.query['data.id']?.toString(),
    })

    if (!verification.valid) {
      res.sendStatus(401)
      return
    }

    const notification = parseWebhookNotification(rawBody)

    if (notification.type === 'payment' && notification.dataId) {
      // Fetch the provider resource. Do not trust status data from the notification.
      const payment = await mercadoPago.getPayment(notification.dataId)
      const event = mapPaymentEvent(notification, payment)
      if (event) {
        // Persist or dispatch this generic event in the host application.
        console.log(event.externalReference, event.status)
      }
    }

    res.sendStatus(200)
  },
)
```

`WEBHOOK_SIGNATURE_MODES.RAW_BODY` is available when a host needs the explicit raw-body HMAC compatibility mode. Its message is `${timestamp}.${rawBody}` and it must not be substituted for Mercado Pago's documented manifest mode unless the provider contract requires it.

## Optional Money Out

```ts
import { MercadoPagoMoneyOutClient } from '@repo/mercado-pago'

const moneyOut = new MercadoPagoMoneyOutClient({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN ?? '',
})

const transaction = await moneyOut.createTransactionIntent({
  externalReference: 'transfer-123',
  amount: 100,
  idempotencyKey: 'unique-request-key',
  notificationUrl: 'https://example.invalid/webhooks/money-out',
  destinationAccount: {
    accountType: 'current',
    bankId: 'bank-code',
    number: 'account-number',
    holder: 'Account Holder',
    currencyId: 'ARS',
  },
})

const currentTransaction = await moneyOut.getTransactionIntent(transaction.id)
```

The Money Out adapter maps generic application names to the provider's transaction-intent payload and uses:

- `POST /v1/transaction-intents/process`
- `GET /v1/transaction-intents/{transactionId}`

The host application must validate authorization, country-specific account requirements, idempotency, and settlement policy. This package does not contain application-specific lifecycle or database rules.

## Testing

Tests use Node's built-in test runner and an injected fake `fetch`; they never call Mercado Pago:

```bash
pnpm --filter @repo/mercado-pago test
```

The focused package test covers preference payloads, payment/refund normalization, official and raw-body signature rejection cases, authoritative event mapping, Money Out payload/status behavior, and access-token non-disclosure in errors.
