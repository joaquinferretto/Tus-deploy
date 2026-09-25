import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CONTRACT_VERSION,
  TUS_CONTRACT_VERSION,
  validateTusCommitment,
  validarInstantaneaLiquidacion,
} from '../../packages/contracts/src/index.ts'
import {
  authorizeCommitmentAccess,
  crearDisputa,
  crearEvidenciaCumplimiento,
  createMercadoPagoHandoff,
  crearInstantaneaLiquidacion,
  createSupportCase,
  evaluarRequisitosHabilitacion,
  evaluateStage1Publication,
  esElegibleParaLiberacion,
  isSupportedWhatsAppAction,
  splitCartIntoCommitments,
} from '../../apps/api/src/tus/domain/index.ts'
import { createTusApplication } from '../../apps/api/src/tus/composition/index.ts'
import {
  createTusIntegrationRouter,
  TusActivationController,
} from '../../apps/api/src/tus/integration/index.ts'
import { createApp } from '../../apps/api/src/server.ts'
import {
  MercadoPagoAdapter,
  DeterministicMercadoPagoProvider,
  InMemoryMercadoPagoStore,
  createMercadoPagoSignature,
} from '../../apps/api/src/providers/mercado-pago/index.ts'
import {
  WhatsAppAdapter,
  DeterministicWhatsAppProvider,
  InMemoryWhatsAppStore,
  createWhatsAppSignature,
} from '../../apps/api/src/providers/whatsapp/index.ts'
import { createTusWebClient } from '../../apps/web/src/lib/tus-client.ts'
import {
  MOBILE_POS_POLICY,
  createTusMobileClient,
} from '../../apps/mobile/src/application/tus-client.ts'

const tenantContext = {
  tenantId: 'tenant-a',
  actorId: 'actor-a',
  correlationId: 'corr-a',
  idempotencyKey: 'idempotency-a',
}

test('Stage 1 publication accepts approved cohorts and rejects regulated healthcare', () => {
  assert.deepEqual(
    evaluateStage1Publication({ cohort: 'beauty-personal-care', regulatedHealthcare: false }),
    { allowed: true, reason: 'approved_stage_1_cohort' }
  )
  assert.deepEqual(
    evaluateStage1Publication({ cohort: 'beauty-personal-care', regulatedHealthcare: true }),
    { allowed: false, reason: 'regulated_vertical_excluded' }
  )
  assert.deepEqual(evaluateStage1Publication({ cohort: 'rentals', regulatedHealthcare: false }), {
    allowed: false,
    reason: 'cohort_not_enabled',
  })
})

test('mixed carts create independent product and service commitments', () => {
  const commitments = splitCartIntoCommitments({
    ...tenantContext,
    cartId: 'cart-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    lines: [
      {
        lineId: 'line-product',
        context: 'product',
        merchantId: 'merchant-a',
        amount: 1200,
        currency: 'ARS',
      },
      {
        lineId: 'line-service',
        context: 'service',
        merchantId: 'merchant-a',
        amount: 800,
        currency: 'ARS',
      },
    ],
  })

  assert.deepEqual(
    commitments.map((commitment) => commitment.context),
    ['product', 'service']
  )
  assert.notEqual(commitments[0].commitmentId, commitments[1].commitmentId)
  assert.ok(commitments.every((commitment) => commitment.status === 'pending'))
  assert.equal(commitments[0].tenantId, 'tenant-a')
  assert.equal(commitments[0].contractVersion, TUS_CONTRACT_VERSION)
  assert.deepEqual(validateTusCommitment(commitments[0]), commitments[0])
})

test('tenant authorization denies foreign commitments without exposing them', () => {
  const [commitment] = splitCartIntoCommitments({
    ...tenantContext,
    cartId: 'cart-2',
    createdAt: '2026-01-01T00:00:00.000Z',
    lines: [
      {
        lineId: 'line-1',
        context: 'product',
        merchantId: 'merchant-a',
        amount: 100,
        currency: 'ARS',
      },
    ],
  })

  assert.deepEqual(authorizeCommitmentAccess(tenantContext, commitment), { allowed: true })
  assert.deepEqual(
    authorizeCommitmentAccess({ ...tenantContext, tenantId: 'tenant-b' }, commitment),
    { allowed: false, reason: 'tenant_mismatch' }
  )
})

test('release requires completion evidence, supports confirmation, and rejects check-in alone', () => {
  const evidence = crearEvidenciaCumplimiento({
    ...tenantContext,
    commitmentId: 'commitment-service',
    evidenceId: 'evidence-service',
    occurredAt: '2026-01-01T00:00:00.000Z',
    kind: 'completion',
  })

  assert.deepEqual(
    esElegibleParaLiberacion({
      commitmentContext: 'service',
      completionEvidence: evidence,
      now: '2026-01-01T11:59:59.000Z',
    }),
    { eligible: false, reason: 'service_release_window_pending' }
  )
  assert.deepEqual(
    esElegibleParaLiberacion({
      commitmentContext: 'service',
      completionEvidence: evidence,
      now: '2026-01-01T12:00:00.000Z',
    }),
    { eligible: true, reason: 'service_release_window_elapsed' }
  )
  assert.deepEqual(
    esElegibleParaLiberacion({
      commitmentContext: 'service',
      completionEvidence: { ...evidence, kind: 'check-in' },
      now: '2026-01-02T00:00:00.000Z',
    }),
    { eligible: false, reason: 'completion_evidence_required' }
  )
  assert.deepEqual(
    esElegibleParaLiberacion({
      commitmentContext: 'service',
      completionEvidence: evidence,
      customerConfirmedAt: '2026-01-01T01:00:00.000Z',
      now: '2026-01-01T01:00:01.000Z',
    }),
    { eligible: true, reason: 'customer_confirmed' }
  )
})

test('disputes and risk holds freeze release regardless of elapsed time', () => {
  const evidence = crearEvidenciaCumplimiento({
    ...tenantContext,
    commitmentId: 'commitment-product',
    evidenceId: 'evidence-product',
    occurredAt: '2026-01-01T00:00:00.000Z',
    kind: 'delivery-accepted',
  })
  const dispute = crearDisputa({
    ...tenantContext,
    disputeId: 'dispute-1',
    commitmentId: evidence.commitmentId,
    reason: 'item_not_received',
  })

  assert.equal(dispute.status, 'open')
  assert.equal(dispute.commitmentId, evidence.commitmentId)
  assert.deepEqual(
    esElegibleParaLiberacion({
      commitmentContext: 'product',
      deliveryMode: 'online',
      completionEvidence: evidence,
      dispute,
      now: '2026-01-03T00:00:00.000Z',
    }),
    { eligible: false, reason: 'absolute_freeze' }
  )
  assert.deepEqual(
    esElegibleParaLiberacion({
      commitmentContext: 'product',
      deliveryMode: 'online',
      completionEvidence: evidence,
      riskHold: true,
      now: '2026-01-03T00:00:00.000Z',
    }),
    { eligible: false, reason: 'absolute_freeze' }
  )
})

test('support cases retain the affected commitment linkage and open incident state', () => {
  const supportCase = createSupportCase({
    tenantId: 'tenant-a',
    actorId: 'support-agent',
    correlationId: 'corr-support',
    caseId: 'case-1',
    commitmentId: 'commitment-product',
    category: 'delivery_incident',
  })

  assert.deepEqual(
    {
      caseId: supportCase.caseId,
      commitmentId: supportCase.commitmentId,
      tenantId: supportCase.tenantId,
      status: supportCase.status,
    },
    {
      caseId: 'case-1',
      commitmentId: 'commitment-product',
      tenantId: 'tenant-a',
      status: 'open',
    }
  )
})

test('settlement snapshots preserve immutable commission inputs', () => {
  const snapshot = crearInstantaneaLiquidacion({
    commitmentId: 'commitment-service',
    context: 'service',
    commissionableBase: 2500,
    evidenceId: 'evidence-service',
    ruleVersion: 'mvp-10-percent-v1',
  })

  assert.equal(snapshot.contractVersion, CONTRACT_VERSION)
  assert.equal(snapshot.rateBps, 1000)
  assert.equal(snapshot.commissionAmount, 250)
  assert.equal(Object.isFrozen(snapshot), true)
  assert.deepEqual(validarInstantaneaLiquidacion(snapshot), snapshot)
})

test('WhatsApp allows discovery and secure payment handoff but rejects unsupported actions', () => {
  assert.equal(isSupportedWhatsAppAction({ type: 'search', tenantId: 'tenant-a' }), true)
  assert.equal(isSupportedWhatsAppAction({ type: 'handoff', tenantId: 'tenant-a' }), true)
  assert.equal(isSupportedWhatsAppAction({ type: 'refund', tenantId: 'tenant-a' }), false)

  const handoff = createMercadoPagoHandoff({
    tenantId: 'tenant-a',
    checkoutUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect',
  })
  assert.deepEqual(handoff, {
    contractVersion: TUS_CONTRACT_VERSION,
    provider: 'mercado-pago',
    tenantId: 'tenant-a',
    redirectUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect',
    credentialsCollected: false,
  })
  assert.throws(
    () => createMercadoPagoHandoff({ tenantId: 'tenant-a', checkoutUrl: 'not-a-url' }),
    /HTTPS|redirect|URL/i
  )
})

test('readiness gates fail closed until every required production gate is ready', () => {
  assert.deepEqual(
    evaluarRequisitosHabilitacion({
      legal: true,
      kyc: true,
      kyb: true,
      tax: true,
      mercadoPago: true,
      posPilot: false,
      aws: true,
      groqMigration: true,
    }),
    { enabled: false, failedGates: ['posPilot'] }
  )
  assert.deepEqual(
    evaluarRequisitosHabilitacion({
      legal: true,
      kyc: true,
      kyb: true,
      tax: true,
      mercadoPago: true,
      posPilot: true,
      aws: true,
      groqMigration: true,
    }),
    { enabled: true, failedGates: [] }
  )
})

test('readiness gates require the AWS target and Groq migration backlog before activation', () => {
  assert.deepEqual(
    evaluarRequisitosHabilitacion({
      legal: true,
      kyc: true,
      kyb: true,
      tax: true,
      mercadoPago: true,
      posPilot: true,
      aws: true,
      groqMigration: false,
    }),
    { enabled: false, failedGates: ['groqMigration'] }
  )
})

test('provider adapters map signed webhook state into tenant-scoped audit/outbox records', async () => {
  const paymentStore = new InMemoryMercadoPagoStore()
  const paymentProvider = new DeterministicMercadoPagoProvider()
  paymentProvider.setPayment('payment-1', { amount: 1200, currency: 'ARS', status: 'approved' })
  const mercadoPago = new MercadoPagoAdapter({
    secret: 'mp-secret',
    store: paymentStore,
    provider: paymentProvider,
  })
  const paymentTimestamp = 1_735_689_600
  const paymentEvent = {
    eventId: 'mp-event-1',
    requestId: 'mp-request-1',
    timestamp: paymentTimestamp,
    externalPaymentId: 'payment-1',
    action: 'payment.approved',
    payload: { data: { id: 'payment-1' }, type: 'payment', action: 'payment.approved' },
    context: { tenantId: 'tenant-a', actorId: 'provider', correlationId: 'corr-mp' },
    signature: createMercadoPagoSignature(
      'mp-secret',
      'mp-event-1',
      'mp-request-1',
      paymentTimestamp
    ),
  }
  const paymentResult = await mercadoPago.receiveWebhook(paymentEvent)

  assert.equal(paymentResult.status, 'processed')
  assert.equal(paymentResult.payment.status, 'approved')
  assert.equal(paymentStore.getReceipt('tenant-a', 'mp-event-1').tenantId, 'tenant-a')
  assert.notEqual(paymentStore.getReceipt('tenant-a', 'mp-event-1').signatureDigest, '')
  assert.equal(paymentStore.listOutbox('tenant-a')[0].payload.status, 'approved')
  assert.equal(paymentStore.getSaga('tenant-a', 'mp-event-1').status, 'completed')

  const whatsappStore = new InMemoryWhatsAppStore()
  const whatsapp = new WhatsAppAdapter({
    secret: 'wa-secret',
    store: whatsappStore,
    provider: new DeterministicWhatsAppProvider(),
    policies: [{ tenantId: 'tenant-a', phoneNumberId: 'phone-1', allowedSenders: ['+549111'] }],
  })
  const whatsappTimestamp = 1_735_689_601
  const whatsappEvent = {
    eventId: 'wa-event-1',
    requestId: 'wa-request-1',
    timestamp: whatsappTimestamp,
    phoneNumberId: 'phone-1',
    messageId: 'message-1',
    from: '+549111',
    to: '+549222',
    messageType: 'text',
    text: 'search beauty',
    context: { tenantId: 'tenant-a', actorId: 'whatsapp', correlationId: 'corr-wa' },
    signature: createWhatsAppSignature(
      'wa-secret',
      'wa-event-1',
      'wa-request-1',
      whatsappTimestamp
    ),
  }
  const whatsappResult = await whatsapp.receiveWebhook(whatsappEvent)

  assert.equal(whatsappResult.status, 'processed')
  assert.equal(whatsappStore.getMessage('tenant-a', 'message-1').text, 'search beauty')
  assert.equal(whatsappStore.getReceipt('tenant-a', 'wa-event-1').tenantId, 'tenant-a')
  assert.notEqual(whatsappStore.getReceipt('tenant-a', 'wa-event-1').signatureDigest, '')
  assert.equal(whatsappStore.listOutbox('tenant-a')[0].tenantId, 'tenant-a')

  const deniedEvent = {
    ...whatsappEvent,
    eventId: 'wa-event-denied',
    requestId: 'wa-request-denied',
    from: '+549999',
    signature: createWhatsAppSignature(
      'wa-secret',
      'wa-event-denied',
      'wa-request-denied',
      whatsappTimestamp
    ),
  }
  const deniedResult = await whatsapp.receiveWebhook(deniedEvent)

  assert.equal(deniedResult.status, 'rejected')
  assert.equal(deniedResult.reason, 'tenant_policy_denied')
  assert.equal(deniedResult.receipt.status, 'rejected')
  assert.equal(deniedResult.receipt.reason, 'tenant_policy_denied')
  assert.equal(whatsappStore.getMessage('tenant-a', 'message-1').from, '+549111')
})

test('activation gates guard release jobs and rollback emits a compensating entry without discarding evidence', async () => {
  const delegate = {
    queued: [],
    async enqueue(input) {
      delegate.queued.push(input)
      return { status: 'queued', ...input }
    },
  }
  const activation = new TusActivationController(delegate, () => 1_735_689_602_000)
  const releaseJob = { tenantId: 'tenant-a', jobId: 'release-1' }

  await assert.rejects(
    activation.enqueueReleaseJob(releaseJob),
    (error) => error.code === 'TUS_ACTIVATION_BLOCKED'
  )
  assert.deepEqual(activation.status(), {
    enabled: false,
    failedGates: ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'posPilot', 'aws', 'groqMigration'],
  })

  assert.deepEqual(
    activation.evaluate({
      legal: true,
      kyc: true,
      kyb: true,
      tax: true,
      mercadoPago: true,
      posPilot: true,
      aws: true,
      groqMigration: true,
    }),
    { enabled: true, failedGates: [] }
  )
  assert.deepEqual(await activation.enqueueReleaseJob(releaseJob), {
    status: 'queued',
    ...releaseJob,
  })

  const compensation = activation.rollback('provider-readiness-regressed')
  assert.deepEqual(compensation, {
    entryId: 'tus-compensation-1735689602000-1',
    reason: 'provider-readiness-regressed',
    createdAt: 1_735_689_602_000,
    evidencePreserved: true,
    auditPreserved: true,
    neutralContractsUntouched: true,
  })
  await assert.rejects(activation.enqueueReleaseJob({ tenantId: 'tenant-a', jobId: 'release-2' }))
})

test('server mounts signed provider webhook routes and keeps invalid requests fail-closed', async () => {
  const paymentStore = new InMemoryMercadoPagoStore()
  const paymentProvider = new DeterministicMercadoPagoProvider()
  paymentProvider.setPayment('payment-route', { amount: 500, currency: 'ARS', status: 'approved' })
  const mercadoPago = new MercadoPagoAdapter({
    secret: 'route-secret',
    store: paymentStore,
    provider: paymentProvider,
  })
  const router = createTusIntegrationRouter({ mercadoPago, providerActionsEnabled: true })
  const app = createApp({ tusRouter: router })
  const server = app.listen(0)

  try {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const timestamp = 1_735_689_603
    const response = await fetch(`http://127.0.0.1:${port}/tus/providers/mercado-pago/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId: 'route-event',
        requestId: 'route-request',
        timestamp,
        externalPaymentId: 'payment-route',
        action: 'payment.approved',
        payload: { data: { id: 'payment-route' }, type: 'payment', action: 'payment.approved' },
        context: { tenantId: 'tenant-a', actorId: 'provider', correlationId: 'route-corr' },
        signature: 'invalid',
      }),
    })

    assert.equal(response.status, 422)
    assert.deepEqual(await response.json(), { status: 'rejected', reason: 'invalid_signature' })
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('TUS application orchestrates mixed checkout with tenant-scoped audit and outbox references', async () => {
  const application = createTusApplication()
  const input = {
    ...tenantContext,
    cartId: 'cart-application-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    requestHash: 'hash-cart-application-1',
    recordId: 'idempotency-cart-application-1',
    expiresAt: Date.parse('2026-01-01T00:05:00.000Z'),
    lines: [
      {
        lineId: 'product-1',
        context: 'product',
        merchantId: 'merchant-a',
        amount: 1500,
        currency: 'ARS',
      },
      {
        lineId: 'service-1',
        context: 'service',
        merchantId: 'merchant-a',
        amount: 2200,
        currency: 'ARS',
      },
    ],
  }

  const result = await application.checkout(input)

  assert.equal(result.status, 'executed')
  assert.deepEqual(
    result.commitments.map((commitment) => commitment.context),
    ['product', 'service']
  )
  assert.ok(
    result.commitments.every((commitment) => commitment.tenantId === tenantContext.tenantId)
  )
  assert.ok(
    result.auditReferences.every((reference) => reference.tenantId === tenantContext.tenantId)
  )
  assert.equal(application.outbox.list(tenantContext.tenantId).length, 1)
})

test('TUS application replays an idempotent checkout without duplicating commitments or events', async () => {
  const application = createTusApplication()
  const input = {
    ...tenantContext,
    cartId: 'cart-application-retry',
    createdAt: '2026-01-01T00:00:00.000Z',
    requestHash: 'hash-cart-application-retry',
    recordId: 'idempotency-cart-application-retry',
    expiresAt: Date.parse('2026-01-01T00:05:00.000Z'),
    lines: [
      {
        lineId: 'product-retry',
        context: 'product',
        merchantId: 'merchant-a',
        amount: 300,
        currency: 'ARS',
      },
    ],
  }

  const first = await application.checkout(input)
  const replay = await application.checkout(input)

  assert.equal(first.status, 'executed')
  assert.equal(replay.status, 'replay')
  assert.deepEqual(replay.commitments, first.commitments)
  assert.equal(application.outbox.list(tenantContext.tenantId).length, 1)
})

test('TUS application enforces tenant isolation for commitment reads and configurable release policy', async () => {
  const application = createTusApplication({
    releasePolicy: { localReleaseAfterMs: 90 * 60 * 1000 },
  })
  const input = {
    ...tenantContext,
    cartId: 'cart-application-isolation',
    createdAt: '2026-01-01T00:00:00.000Z',
    requestHash: 'hash-cart-application-isolation',
    recordId: 'idempotency-cart-application-isolation',
    expiresAt: Date.parse('2026-01-01T00:05:00.000Z'),
    lines: [
      {
        lineId: 'local-product',
        context: 'product',
        merchantId: 'merchant-a',
        amount: 500,
        currency: 'ARS',
      },
    ],
  }

  const created = await application.checkout(input)
  const commitmentId = created.commitments[0].commitmentId

  assert.deepEqual(
    await application.getCommitment(
      { tenantId: 'tenant-b', actorId: 'actor-b', correlationId: 'corr-b' },
      commitmentId
    ),
    { status: 'forbidden' }
  )
  assert.deepEqual(
    application.evaluateRelease({
      commitmentContext: 'product',
      deliveryMode: 'local',
      completionEvidence: crearEvidenciaCumplimiento({
        ...tenantContext,
        commitmentId,
        evidenceId: 'evidence-local',
        occurredAt: '2026-01-01T00:00:00.000Z',
        kind: 'delivery-accepted',
      }),
      now: '2026-01-01T01:30:00.000Z',
    }),
    { eligible: true, reason: 'local_policy_elapsed' }
  )
  assert.deepEqual(
    application.evaluateRelease({
      commitmentContext: 'product',
      deliveryMode: 'local',
      completionEvidence: crearEvidenciaCumplimiento({
        ...tenantContext,
        commitmentId,
        evidenceId: 'evidence-local',
        occurredAt: '2026-01-01T00:00:00.000Z',
        kind: 'delivery-accepted',
      }),
      riskHold: true,
      now: '2026-01-02T00:00:00.000Z',
    }),
    { eligible: false, reason: 'absolute_freeze' }
  )
})

test('TUS application rejects idempotency hash conflicts and returns only authorized commitments', async () => {
  const application = createTusApplication()
  const input = {
    ...tenantContext,
    cartId: 'cart-application-conflict',
    createdAt: '2026-01-01T00:00:00.000Z',
    requestHash: 'hash-cart-application-conflict',
    recordId: 'idempotency-cart-application-conflict',
    expiresAt: Date.parse('2026-01-01T00:05:00.000Z'),
    lines: [
      {
        lineId: 'service-conflict',
        context: 'service',
        merchantId: 'merchant-a',
        amount: 700,
        currency: 'ARS',
      },
    ],
  }

  const created = await application.checkout(input)
  const conflict = await application.checkout({ ...input, requestHash: 'different-request' })

  assert.equal(conflict.status, 'conflict')
  assert.deepEqual(
    await application.getCommitment(tenantContext, created.commitments[0].commitmentId),
    { status: 'found', commitment: created.commitments[0] }
  )
})

test('TUS composition exposes the bounded contexts without moving policy into the neutral platform', () => {
  const application = createTusApplication()

  assert.deepEqual(application.contexts, [
    'discovery',
    'merchant-catalog',
    'appointments-services',
    'delivery',
    'pos',
    'settlement',
    'disputes',
    'support',
    'reporting-seo',
    'mixed-checkout',
  ])
  assert.equal(application.isContextEnabled('mixed-checkout'), true)
  assert.equal(application.isContextEnabled('warehouse-automation'), false)
})

test('web client keeps discovery, merchant, customer, and WhatsApp handoff requests tenant-scoped', async () => {
  const requests = []
  const client = createTusWebClient({
    async request(input) {
      requests.push(input)
      if (input.path.endsWith('/handoff')) {
        return {
          contractVersion: TUS_CONTRACT_VERSION,
          provider: 'mercado-pago',
          tenantId: input.tenantId,
          redirectUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect',
          credentialsCollected: false,
        }
      }
      return { items: [], commitments: [] }
    },
  })

  await client.discover({
    tenantId: 'tenant-a',
    actorId: 'customer-a',
    correlationId: 'corr-discovery',
  })
  await client.merchantOperations({
    tenantId: 'tenant-a',
    actorId: 'merchant-a',
    correlationId: 'corr-merchant',
  })
  await client.customerCommitments({
    tenantId: 'tenant-a',
    actorId: 'customer-a',
    correlationId: 'corr-commitments',
  })
  const handoff = await client.whatsappPaymentHandoff({
    tenantId: 'tenant-a',
    actorId: 'customer-a',
    correlationId: 'corr-handoff',
    commitmentId: 'commitment-1',
    confirmationId: 'confirmation-1',
  })

  assert.deepEqual(
    requests.map(({ method, path, tenantId }) => ({ method, path, tenantId })),
    [
      { method: 'GET', path: '/tus/v1/mercado-servicios/discovery', tenantId: 'tenant-a' },
      {
        method: 'GET',
        path: '/tus/v1/mercado-servicios/merchant/operations',
        tenantId: 'tenant-a',
      },
      {
        method: 'GET',
        path: '/tus/v1/mercado-servicios/customer/commitments',
        tenantId: 'tenant-a',
      },
      { method: 'POST', path: '/tus/v1/whatsapp/handoff', tenantId: 'tenant-a' },
    ]
  )
  assert.equal(requests[3].body.commitmentId, 'commitment-1')
  assert.equal(handoff.credentialsCollected, false)
})

test('mobile POS queues manual operations offline and preserves conflicts for explicit resolution', async () => {
  let online = false
  const sent = []
  const client = createTusMobileClient(
    {
      async request(input) {
        sent.push(input)
        return {
          status: 'conflict',
          operationId: input.operation.operationId,
          reason: 'server_version_changed',
        }
      },
    },
    { isOnline: () => online }
  )

  const queued = await client.recordManualOperation({
    operationId: 'pos-op-1',
    tenantId: 'tenant-a',
    actorId: 'staff-a',
    correlationId: 'corr-pos-1',
    idempotencyKey: 'pos-idempotency-1',
    kind: 'manual-sale',
    amount: 1200,
    currency: 'ARS',
  })

  assert.deepEqual(queued, { status: 'queued-offline', operationId: 'pos-op-1' })
  assert.equal(client.pendingOperations()[0].operationId, 'pos-op-1')
  assert.deepEqual(MOBILE_POS_POLICY, {
    offline: 'queue-manual-operations',
    conflict: 'preserve-local-and-report',
  })

  online = true
  const sync = await client.syncPendingOperations()
  assert.deepEqual(sync, [
    { status: 'conflict', operationId: 'pos-op-1', reason: 'server_version_changed' },
  ])
  assert.equal(client.pendingOperations()[0].operationId, 'pos-op-1')
  assert.equal(sent[0].path, '/tus/v1/pos/manual-operations')

  assert.deepEqual(await client.resolveConflict('pos-op-1', 'discard'), {
    status: 'discarded',
    operationId: 'pos-op-1',
  })
  assert.deepEqual(client.pendingOperations(), [])
})

test('web fetch transport keeps authority in the bearer session and never accepts payment credentials', async () => {
  const originalFetch = globalThis.fetch
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(
      JSON.stringify({
        contractVersion: TUS_CONTRACT_VERSION,
        provider: 'mercado-pago',
        tenantId: 'tenant-a',
        redirectUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect',
        credentialsCollected: false,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }

  try {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3101'
    const { createTusWebFetchTransport } = await import('../../apps/web/src/lib/tus-client.ts')
    const response = await createTusWebFetchTransport().request({
      method: 'POST',
      path: '/tus/v1/whatsapp/handoff',
      tenantId: 'tenant-a',
      actorId: 'customer-a',
      correlationId: 'corr-fetch',
      body: { type: 'handoff', commitmentId: 'commitment-1' },
    })

    assert.equal(response.credentialsCollected, false)
    assert.equal(calls[0].url, 'http://localhost:3101/tus/v1/whatsapp/handoff')
    assert.equal(calls[0].options.headers['X-Tenant-Id'], undefined)
    assert.equal(calls[0].options.headers['X-Actor-Id'], undefined)
    assert.equal(calls[0].options.headers.Authorization, undefined)
  } finally {
    globalThis.fetch = originalFetch
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl
  }
})

test('mobile POS accepts online operations and removes them from the pending queue', async () => {
  const client = createTusMobileClient({
    async request({ operation }) {
      return { status: 'accepted', operationId: operation.operationId }
    },
  })

  const result = await client.recordManualOperation({
    operationId: 'pos-op-online',
    tenantId: 'tenant-a',
    actorId: 'staff-a',
    correlationId: 'corr-pos-online',
    idempotencyKey: 'pos-idempotency-online',
    kind: 'manual-service',
    amount: 800,
    currency: 'ARS',
  })

  assert.deepEqual(result, { status: 'accepted', operationId: 'pos-op-online' })
  assert.deepEqual(client.pendingOperations(), [])
})
