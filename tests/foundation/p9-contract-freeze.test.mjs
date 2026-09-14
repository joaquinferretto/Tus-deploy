import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { TUS_CONTRACT_VERSION } from '../../packages/contracts/src/index.ts'
import { MARKETPLACE_OUTBOX_EVENT_TYPES } from '../../apps/api/src/tus/catalog/index.ts'
import { TUS_OUTBOX_EVENT_TYPES } from '../../apps/api/src/tus/ports/index.ts'
import { SUPPORT_OUTBOX_EVENT_TYPES } from '../../apps/api/src/tus/support/index.ts'

const root = join(import.meta.dirname, '..', '..')
const schemaDir = join(root, 'packages', 'contracts', 'schemas', 'tus')

function loadSchema(name) {
  return JSON.parse(readFileSync(join(schemaDir, name), 'utf8'))
}

function assertKeys(schema, keys) {
  const required = new Set(schema.required ?? [])
  const properties = schema.properties ?? {}
  for (const key of keys) {
    assert.ok(
      required.has(key) || Object.hasOwn(properties, key),
      `schema "${schema.$id ?? schema.title}" must keep JSON key "${key}"`,
    )
  }
}

function assertSchemaContractVersion(name) {
  const schema = loadSchema(name)
  const version = schema.properties?.contractVersion
  assert.ok(version !== undefined, `schema "${name}" must declare contractVersion`)
  if (version.const !== undefined) {
    assert.equal(version.const, '1.0.0', `schema "${name}" must keep contractVersion const "1.0.0"`)
  }
}

test('TUS contractVersion permanece congelado en 1.0.0', () => {
  assert.equal(TUS_CONTRACT_VERSION, '1.0.0')
  for (const name of [
    'marketplace-listing.v1.schema.json',
    'marketplace-checkout.v1.schema.json',
    'marketplace-discovery.v1.schema.json',
    'financial-payment-intent.v1.schema.json',
    'commission-snapshot.v1.schema.json',
    'delivery-task.v1.schema.json',
    'support-case.v1.schema.json',
  ]) {
    assertSchemaContractVersion(name)
  }
})

test('keys JSON de Mercado permanecen estables', () => {
  const listing = loadSchema('marketplace-listing.v1.schema.json')
  assertKeys(listing, ['listingId', 'merchantId', 'availabilityVersion', 'tenantId', 'contractVersion', 'kind', 'cohort', 'workingHours'])
  const checkout = loadSchema('marketplace-checkout.v1.schema.json')
  assertKeys(checkout, ['cartId', 'requestHash', 'idempotencyKey', 'lines', 'contractVersion'])
  assertKeys(checkout.properties.lines.items, ['lineId', 'listingId', 'quantity', 'availabilityVersion', 'context'])
})

test('keys JSON de Finanzas permanecen estables', () => {
  const intent = loadSchema('financial-payment-intent.v1.schema.json')
  assertKeys(intent, ['paymentId', 'providerReference', 'amount', 'currency', 'commitmentId', 'provider', 'providerStatus', 'credentialsCollected', 'source', 'tenantId'])
  const snapshot = loadSchema('commission-snapshot.v1.schema.json')
  assertKeys(snapshot, ['rateBps', 'commissionAmount', 'netAmount', 'grossAmount', 'deductions', 'commissionableBase', 'providerReference', 'evidenceId', 'ledgerStatus', 'snapshotId', 'commitmentId'])
})

test('keys JSON de Entrega y Soporte permanecen estables', () => {
  const delivery = loadSchema('delivery-task.v1.schema.json')
  assertKeys(delivery, ['taskId', 'operatorId', 'settlementClaim', 'commitmentId', 'merchantId', 'zoneId', 'shiftId', 'tenantId'])
  const support = loadSchema('support-case.v1.schema.json')
  assertKeys(support, ['caseId', 'commitmentId', 'category', 'status', 'tenantId', 'actorId', 'correlationId'])
})

test('event types centrales de Marketplace/Checkout/Compromiso permanecen estables', () => {
  assert.equal(MARKETPLACE_OUTBOX_EVENT_TYPES.MERCHANT_ONBOARDED, 'tus.marketplace.merchant.onboarded')
  assert.equal(MARKETPLACE_OUTBOX_EVENT_TYPES.LISTING_CREATED, 'tus.marketplace.listing.created')
  assert.equal(MARKETPLACE_OUTBOX_EVENT_TYPES.LISTING_PUBLISHED, 'tus.marketplace.listing.published')
  assert.equal(MARKETPLACE_OUTBOX_EVENT_TYPES.COMMITMENTS_CREATED, 'tus.marketplace.commitments.created')
  assert.equal(TUS_OUTBOX_EVENT_TYPES.CHECKOUT_CREATED, 'tus.checkout.created')
  assert.equal(TUS_OUTBOX_EVENT_TYPES.STATUS_CHANGED, 'tus.commitment.status_changed')
  assert.equal(TUS_OUTBOX_EVENT_TYPES.COMPENSATED, 'tus.commitment.compensated')
})

test('event types de Soporte permanecen estables', () => {
  assert.equal(SUPPORT_OUTBOX_EVENT_TYPES.CASE_OPENED, 'support.case.opened')
  assert.equal(SUPPORT_OUTBOX_EVENT_TYPES.EVIDENCE_SUBMITTED, 'support.evidence.submitted')
  assert.equal(SUPPORT_OUTBOX_EVENT_TYPES.CASE_RESOLVED, 'support.case.resolved')
})

test('el prefijo tus.marketplace. sigue gobernando la consulta de outbox persistido', () => {
  const source = readFileSync(join(root, 'apps', 'api', 'src', 'tus', 'adapters', 'prisma-marketplace.ts'), 'utf8')
  assert.ok(source.includes("startsWith: 'tus.marketplace.'"), 'prisma-marketplace debe seguir consultando outbox por el prefijo tus.marketplace.')
})
