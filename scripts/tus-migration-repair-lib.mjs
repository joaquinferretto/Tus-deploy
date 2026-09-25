import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONNECTION_TIMEOUT_MS = 60_000
export const RETRY_COUNT = 1
export const RESTORE_PROOF_VERSION = 1
export const RESTORE_PROOF_MODE = Object.freeze({ SCHEMA_ONLY: 'schema-only' })
export const EXACT_MONEY_BACKFILL_APPROVAL = 'exact-money-backfill-approval-required'
export const EXACT_MONEY_BACKFILL_TAG = 'repair:exact-money-backfill'
export const EXACT_MONEY_CURRENCY_SCALES = Object.freeze({ ARS: 2, USD: 2, EUR: 2 })
export const REPAIR_MIGRATION_NAME = '20260831180000_tus_additive_migration_repair'
export const LAUNCH_MIGRATION_NAME = '20260909090000_tus_argentina_market_launch'
export const PHYSICAL_SPANISH_MIGRATION_NAME = '20260914180000_tus_physical_spanish'
export const POS_INDEX_CONSTRAINT_REPAIR_NAME = '20260911120000_tus_pos_index_constraint_repair'
export const LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME = '20260911130000_tus_live_schema_conformance_repair'
export const REPAIR_UNIT = Object.freeze({
  LIVE_SCHEMA_CONFORMANCE: 'live-schema-conformance',
})
export const REPAIR_MIGRATION_PATH = join(
  'apps',
  'api',
  'prisma',
  'migrations',
  REPAIR_MIGRATION_NAME,
  'migration.sql',
)
export const LAUNCH_MIGRATION_PATH = join(
  'apps',
  'api',
  'prisma',
  'migrations',
  LAUNCH_MIGRATION_NAME,
  'migration.sql',
)
export const PHYSICAL_SPANISH_MIGRATION_PATH = join(
  'apps',
  'api',
  'prisma',
  'migrations',
  PHYSICAL_SPANISH_MIGRATION_NAME,
  'migration.sql',
)
export const POS_INDEX_CONSTRAINT_REPAIR_PATH = join(
  'apps',
  'api',
  'prisma',
  'migrations',
  POS_INDEX_CONSTRAINT_REPAIR_NAME,
  'migration.sql',
)
export const LIVE_SCHEMA_CONFORMANCE_REPAIR_PATH = join(
  'apps',
  'api',
  'prisma',
  'migrations',
  LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME,
  'migration.sql',
)

export const REQUIRED_POS_TABLES = Object.freeze([
  'TusDeliveryZone',
  'TusDeliveryShift',
  'TusDeliveryTask',
  'TusDeliveryProof',
  'TusDeliveryIncident',
  'TusDeliveryAudit',
  'TusPosOperation',
  'TusPosReceipt',
  'TusPosDevice',
  'TusPosSession',
  'TusPosConflict',
  'TusPosVersion',
  'TusDeliveryOutbox',
  'TusPosOutbox',
  'TusPosAudit',
])

export const REQUIRED_LAUNCH_TABLES = Object.freeze([
  'TusTenant', 'User', 'Account', 'Session', 'Membership', 'TenantRole',
  'TusMerchant', 'TusProduct', 'TusService', 'TusListing', 'TusInventory',
  'TusCalendar', 'TusCalendarRule', 'TusCalendarException', 'TusBooking',
  'TusCommitment', 'TusCommitmentTransition', 'TusCommitmentCompensation', 'TusMarketplaceCommitment',
  'TusPaymentIntent', 'TusPaymentWebhookEvent', 'TusCommissionSnapshot', 'TusLedgerEntry',
  'TusFinancialEvidence', 'TusFinancialConfirmation', 'TusFinancialFreeze', 'TusReconciliationRecord',
  'TusWhatsAppConsent', 'TusWhatsAppMessage', 'TusWhatsAppWebhookEvent',
  'TusInvoice', 'TusInvoiceLine', 'TusCreditNote', 'TusSubscription', 'TusTaxProfile',
  'AuditEvent', 'TusMarketplaceAudit', 'TusDeliveryAudit', 'TusPosAudit', 'TusWhatsAppAudit',
  'OutboxEvent', 'TusDeliveryOutbox', 'TusPosOutbox', 'TusSupportOutbox', 'TusJob', 'TusDeadLetter',
  'TusHardeningFixture',
  ...REQUIRED_POS_TABLES,
])

export const REQUIRED_LIVE_SCHEMA_TABLE_ENTRIES = Object.freeze([...REQUIRED_LAUNCH_TABLES])

const REQUIRED_BILLING_PRIMARY_KEY_TABLES = Object.freeze([
  'TusBillingAccount',
  'TusSubscriptionPlan',
  'TusBillingRefund',
  'TusBillingLedger',
  'TusBillingIdempotency',
  'TusBillingAudit',
  'TusBillingOutbox',
  'TusBillingDunning',
  'TusBillingNumberSequence',
  'TusAccountingExport',
])

export const REQUIRED_MONEY_COLUMNS = Object.freeze([
  'amount', 'price', 'grossAmount', 'deductions', 'commissionableBase',
  'commissionAmount', 'netAmount', 'providerAmount', 'taxAmount', 'feeAmount',
  'amountMinor', 'unitMinor', 'taxMinor', 'totalMinor',
])

export const REQUIRED_LAUNCH_SCHEMA_COLUMNS = Object.freeze({
  TusTenant: ['id', 'slug', 'name', 'status', 'createdAt', 'updatedAt'],
  User: ['id', 'email', 'normalizedEmail', 'displayName', 'createdAt', 'updatedAt'],
  Account: ['id', 'userId', 'tenantId', 'roles', 'status', 'createdAt', 'updatedAt'],
  Session: ['id', 'accountId', 'tenantId', 'deviceId', 'accessTokenDigest', 'roles', 'permissions', 'createdAt', 'expiresAt', 'revokedAt'],
  Membership: ['id', 'organizationId', 'workspaceId', 'userId', 'role', 'roleIds', 'status', 'createdAt', 'updatedAt'],
  TenantRole: ['id', 'tenantId', 'name', 'permissions', 'resourceScopes', 'createdAt'],
  TusMerchant: ['id', 'tenantId', 'merchantId', 'locationId', 'timezone', 'status'],
  TusProduct: ['id', 'tenantId', 'sku', 'name', 'status', 'createdAt', 'updatedAt'],
  TusService: ['id', 'tenantId', 'serviceCode', 'name', 'durationMinutes', 'capacity', 'status', 'createdAt', 'updatedAt'],
  TusListing: ['id', 'tenantId', 'kind', 'currency', 'price', 'availabilityVersion', 'published'],
  TusInventory: ['id', 'tenantId', 'productId', 'quantity', 'reserved', 'version'],
  TusCalendar: ['id', 'tenantId', 'serviceId', 'timezone', 'status'],
  TusCalendarRule: ['id', 'tenantId', 'calendarId', 'weekday', 'startsAt', 'endsAt', 'capacity'],
  TusCalendarException: ['id', 'tenantId', 'calendarId', 'startsAt', 'endsAt', 'status'],
  TusBooking: ['id', 'tenantId', 'bookingId', 'serviceId', 'calendarId', 'customerId', 'startsAt', 'endsAt', 'status', 'version'],
  TusCommitment: ['id', 'tenantId', 'commitmentId', 'amount', 'currency', 'status', 'version'],
  TusCommitmentTransition: ['id', 'tenantId', 'commitmentId', 'version', 'actorId', 'correlationId'],
  TusCommitmentCompensation: ['id', 'tenantId', 'compensationId', 'commitmentId', 'amount', 'currency'],
  TusMarketplaceCommitment: ['id', 'tenantId', 'commitmentId', 'listingId', 'amount', 'currency', 'status'],
  TusPaymentIntent: ['id', 'tenantId', 'paymentId', 'commitmentId', 'amount', 'currency', 'idempotencyKey'],
  TusPaymentWebhookEvent: ['id', 'tenantId', 'provider', 'providerEventId', 'signature', 'status'],
  TusCommissionSnapshot: ['id', 'tenantId', 'snapshotId', 'commitmentId', 'grossAmount', 'commissionAmount', 'netAmount', 'rateBps'],
  TusLedgerEntry: ['id', 'tenantId', 'entryId', 'commitmentId', 'amount', 'currency', 'immutable', 'createdAt'],
  TusFinancialEvidence: ['id', 'tenantId', 'evidenceId', 'commitmentId', 'correlationId', 'kind'],
  TusFinancialConfirmation: ['id', 'tenantId', 'confirmationId', 'commitmentId', 'correlationId'],
  TusFinancialFreeze: ['id', 'tenantId', 'freezeId', 'commitmentId', 'active'],
  TusReconciliationRecord: ['id', 'tenantId', 'reconciliationId', 'commitmentId', 'providerAmount', 'status'],
  TusWhatsAppConsent: ['id', 'tenantId', 'recipientId', 'status', 'grantedAt'],
  TusWhatsAppMessage: ['id', 'tenantId', 'messageId', 'recipientId', 'consentId', 'status'],
  TusWhatsAppWebhookEvent: ['id', 'tenantId', 'providerEventId', 'signature', 'status'],
  TusWhatsAppAudit: ['id', 'tenantId', 'correlationId', 'action', 'outcome'],
  TusInvoice: ['id', 'tenantId', 'invoiceId', 'commitmentId', 'subtotal', 'taxAmount', 'feeAmount', 'total', 'currency', 'status'],
  TusInvoiceLine: ['id', 'tenantId', 'invoiceId', 'unitMinor', 'taxMinor', 'totalMinor'],
  TusCreditNote: ['id', 'tenantId', 'creditNoteId', 'invoiceId', 'amountMinor', 'currency', 'status'],
  TusSubscription: ['id', 'tenantId', 'subscriptionId', 'customerId', 'amountMinor', 'currency', 'status'],
  TusTaxProfile: ['id', 'tenantId', 'partyId', 'taxIdentity', 'taxCategory', 'status'],
  TusBillingAccount: ['id', 'tenantId', 'billingAccountId', 'partyId', 'role', 'status'],
  TusSubscriptionPlan: ['id', 'tenantId', 'planId', 'amountMinor', 'currency', 'interval', 'status'],
  TusBillingRefund: ['id', 'tenantId', 'refundId', 'invoiceId', 'paymentId', 'orderId', 'amountMinor', 'currency', 'status'],
  TusBillingLedger: ['id', 'tenantId', 'entryId', 'invoiceId', 'entryType', 'amountMinor', 'currency', 'immutable'],
  TusBillingIdempotency: ['id', 'tenantId', 'key', 'requestHash', 'response'],
  TusBillingAudit: ['id', 'tenantId', 'auditId', 'actorId', 'correlationId', 'action', 'outcome'],
  TusBillingOutbox: ['id', 'tenantId', 'eventId', 'correlationId', 'eventType', 'aggregateId', 'status', 'payload'],
  TusBillingDunning: ['id', 'tenantId', 'dunningId', 'subscriptionId', 'attempt', 'status'],
  TusBillingNumberSequence: ['id', 'tenantId', 'nextNumber'],
  TusAccountingExport: ['id', 'tenantId', 'exportId', 'invoiceIds', 'ledgerEntryIds', 'externalApprovalReference', 'status'],
  AuditEvent: ['id', 'tenantId', 'correlationId', 'eventType', 'outcome', 'metadata', 'occurredAt'],
  TusMarketplaceAudit: ['id', 'tenantId', 'actorId', 'correlationId', 'action', 'outcome'],
  OutboxEvent: ['id', 'tenantId', 'aggregateType', 'aggregateId', 'eventType', 'status', 'payload'],
  TusSupportOutbox: ['id', 'tenantId', 'eventId', 'correlationId', 'eventType', 'status'],
  TusJob: ['id', 'tenantId', 'jobId', 'jobType', 'status', 'attempts', 'availableAt', 'payload'],
  TusDeadLetter: ['id', 'tenantId', 'jobId', 'reason', 'correlationId', 'payload'],
})

export const REQUIRED_MONEY_TYPES = Object.freeze({
  TusListing: ['price'],
  TusCommitment: ['amount'],
  TusCommitmentCompensation: ['amount'],
  TusMarketplaceCommitment: ['amount'],
  TusPaymentIntent: ['amount'],
  TusCommissionSnapshot: ['grossAmount', 'deductions', 'commissionableBase', 'commissionAmount', 'netAmount'],
  TusLedgerEntry: ['amount'],
  TusReconciliationRecord: ['providerAmount'],
  TusPosOperation: ['amount'],
  TusPosReceipt: ['amount'],
  TusInvoice: ['subtotal', 'taxAmount', 'feeAmount', 'total'],
  TusInvoiceLine: ['unitMinor', 'taxMinor', 'totalMinor'],
  TusCreditNote: ['amountMinor'],
  TusSubscription: ['amountMinor'],
  TusSubscriptionPlan: ['amountMinor'],
  TusBillingRefund: ['amountMinor'],
  TusBillingLedger: ['amountMinor'],
})

export const REQUIRED_CONFORMANCE_MONEY_COLUMNS = Object.freeze(
  Object.entries(REQUIRED_MONEY_TYPES).flatMap(([table, columns]) => columns.map((column) => ({
    table,
    column,
    udtName: 'int8',
    nullable: false,
    defaultValue: null,
  }))),
)

export const REQUIRED_CONFORMANCE_PRIMARY_KEYS = Object.freeze([
  ...[...new Set(REQUIRED_LIVE_SCHEMA_TABLE_ENTRIES)].map((table) => ({ table, columns: ['id'] })),
  ...REQUIRED_BILLING_PRIMARY_KEY_TABLES.map((table) => ({ table, columns: ['id'] })),
])

export const REQUIRED_SCHEMA_COLUMNS = Object.freeze({
  TusDeliveryZone: ['id', 'tenantId', 'zoneId', 'name', 'postalCodes', 'active', 'createdAt', 'updatedAt'],
  TusDeliveryShift: ['id', 'tenantId', 'shiftId', 'zoneId', 'startsAt', 'endsAt', 'operatorIds', 'status', 'createdAt', 'updatedAt'],
  TusDeliveryTask: ['id', 'tenantId', 'taskId', 'commitmentId', 'merchantId', 'context', 'zoneId', 'shiftId', 'operatorId', 'status', 'version', 'proof', 'incident', 'settlementClaim', 'createdAt', 'updatedAt'],
  TusDeliveryProof: ['id', 'tenantId', 'proofId', 'taskId', 'commitmentId', 'recipientName', 'capturedAt', 'evidenceSource', 'createdAt'],
  TusDeliveryIncident: ['id', 'tenantId', 'incidentId', 'taskId', 'reason', 'status', 'createdAt'],
  TusDeliveryAudit: ['id', 'tenantId', 'auditId', 'actorId', 'correlationId', 'action', 'resourceType', 'resourceId', 'outcome', 'createdAt'],
  TusPosOperation: ['id', 'tenantId', 'operationId', 'idempotencyKey', 'schemaVersion', 'actorId', 'deviceId', 'shiftId', 'createdAt', 'expectedVersion', 'kind', 'context', 'amount', 'currency', 'response'],
  TusPosReceipt: ['id', 'tenantId', 'receiptId', 'operationId', 'kind', 'context', 'amount', 'currency', 'status', 'source', 'providerCapture', 'settlement', 'integrityHash', 'createdAt'],
  TusPosDevice: ['id', 'tenantId', 'deviceId', 'label', 'fingerprint', 'status', 'createdAt', 'updatedAt'],
  TusPosSession: ['id', 'tenantId', 'sessionId', 'deviceId', 'actorId', 'shiftId', 'status', 'openedAt', 'closedAt'],
  TusPosConflict: ['id', 'tenantId', 'conflictId', 'operationId', 'reason', 'expectedVersion', 'actualVersion', 'status', 'createdAt'],
  TusPosVersion: ['id', 'tenantId', 'shiftId', 'version', 'createdAt', 'updatedAt'],
  TusDeliveryOutbox: ['id', 'tenantId', 'eventId', 'correlationId', 'eventType', 'aggregateId', 'payload', 'status', 'attempts', 'createdAt'],
  TusPosOutbox: ['id', 'tenantId', 'eventId', 'eventType', 'aggregateId', 'payload', 'status', 'attempts', 'availableAt', 'lastError', 'claimId', 'claimUntil', 'publishedAt', 'createdAt'],
  TusPosAudit: ['id', 'tenantId', 'auditId', 'actorId', 'correlationId', 'action', 'operationId', 'outcome', 'createdAt'],
})

export const REQUIRED_SCHEMA_INDEXES = Object.freeze({
  TusDeliveryZone: ['TusDeliveryZone_tenantId_zoneId_key', 'TusDeliveryZone_tenantId_active_idx'],
  TusDeliveryShift: ['TusDeliveryShift_tenantId_shiftId_key', 'TusDeliveryShift_tenantId_zoneId_status_idx'],
  TusDeliveryTask: ['TusDeliveryTask_tenantId_taskId_key', 'TusDeliveryTask_tenantId_commitmentId_idx', 'TusDeliveryTask_tenantId_shiftId_status_idx', 'TusDeliveryTask_tenantId_commitmentId_status_idx'],
  TusDeliveryProof: ['TusDeliveryProof_tenantId_proofId_key', 'TusDeliveryProof_tenantId_taskId_idx'],
  TusDeliveryIncident: ['TusDeliveryIncident_tenantId_incidentId_key', 'TusDeliveryIncident_tenantId_taskId_status_idx'],
  TusDeliveryAudit: ['TusDeliveryAudit_tenantId_auditId_key', 'TusDeliveryAudit_tenantId_createdAt_idx'],
  TusPosOperation: ['TusPosOperation_tenantId_operationId_key', 'TusPosOperation_tenantId_idempotencyKey_key', 'TusPosOperation_tenantId_shiftId_createdAt_idx', 'TusPosOperation_tenantId_context_kind_idx'],
  TusPosReceipt: ['TusPosReceipt_tenantId_receiptId_key', 'TusPosReceipt_tenantId_operationId_idx', 'TusPosReceipt_tenantId_operationId_createdAt_idx'],
  TusPosDevice: ['TusPosDevice_tenantId_deviceId_key', 'TusPosDevice_tenantId_status_idx'],
  TusPosSession: ['TusPosSession_tenantId_sessionId_key', 'TusPosSession_tenantId_deviceId_shiftId_status_idx'],
  TusPosConflict: ['TusPosConflict_tenantId_conflictId_key', 'TusPosConflict_tenantId_operationId_status_idx', 'TusPosConflict_tenantId_status_createdAt_idx'],
  TusPosVersion: ['TusPosVersion_tenantId_shiftId_key', 'TusPosVersion_tenantId_shiftId_version_idx'],
  TusDeliveryOutbox: ['TusDeliveryOutbox_tenantId_eventId_key', 'TusDeliveryOutbox_tenantId_status_createdAt_idx'],
  TusPosOutbox: ['TusPosOutbox_tenantId_eventId_key', 'TusPosOutbox_tenantId_status_createdAt_idx', 'TusPosOutbox_tenantId_aggregateId_status_idx'],
  TusPosAudit: ['TusPosAudit_tenantId_auditId_key', 'TusPosAudit_tenantId_operationId_createdAt_idx'],
  TusHardeningFixture: ['TusHardeningFixture_tag_version_runId_key', 'TusHardeningFixture_tenantId_idx', 'TusHardeningFixture_tenantId_tag_version_idx'],
})

const REQUIRED_CONSTRAINTS = Object.freeze({
  TusDeliveryShift: ['TusDeliveryShift_tenant_zone_fk'],
  TusDeliveryTask: ['TusDeliveryTask_tenant_shift_fk'],
  TusDeliveryProof: ['TusDeliveryProof_tenant_task_fk'],
  TusDeliveryIncident: ['TusDeliveryIncident_tenant_task_fk'],
  TusPosSession: ['TusPosSession_tenant_device_fk'],
  TusPosReceipt: ['TusPosReceipt_tenant_operation_fk'],
  TusPosConflict: ['TusPosConflict_tenant_operation_fk'],
  TusPosOperation: ['TusPosOperation_amount_non_negative_check'],
  TusPosVersion: ['TusPosVersion_version_non_negative_check'],
})

export const REQUIRED_POS_REPAIR_INDEXES = Object.freeze([
  { name: 'TusDeliveryZone_tenantId_active_idx', table: 'TusDeliveryZone', columns: ['tenantId', 'active'], unique: false },
  { name: 'TusDeliveryShift_tenantId_zoneId_status_idx', table: 'TusDeliveryShift', columns: ['tenantId', 'zoneId', 'status'], unique: false },
  { name: 'TusDeliveryTask_tenantId_commitmentId_idx', table: 'TusDeliveryTask', columns: ['tenantId', 'commitmentId'], unique: false },
  { name: 'TusDeliveryTask_tenantId_shiftId_status_idx', table: 'TusDeliveryTask', columns: ['tenantId', 'shiftId', 'status'], unique: false },
  { name: 'TusDeliveryTask_tenantId_commitmentId_status_idx', table: 'TusDeliveryTask', columns: ['tenantId', 'commitmentId', 'status'], unique: false },
  { name: 'TusDeliveryProof_tenantId_taskId_idx', table: 'TusDeliveryProof', columns: ['tenantId', 'taskId'], unique: false },
  { name: 'TusDeliveryIncident_tenantId_taskId_status_idx', table: 'TusDeliveryIncident', columns: ['tenantId', 'taskId', 'status'], unique: false },
  { name: 'TusDeliveryAudit_tenantId_auditId_key', table: 'TusDeliveryAudit', columns: ['tenantId', 'auditId'], unique: true },
  { name: 'TusDeliveryAudit_tenantId_createdAt_idx', table: 'TusDeliveryAudit', columns: ['tenantId', 'createdAt'], unique: false },
  { name: 'TusPosOperation_tenantId_shiftId_createdAt_idx', table: 'TusPosOperation', columns: ['tenantId', 'shiftId', 'createdAt'], unique: false },
  { name: 'TusPosOperation_tenantId_context_kind_idx', table: 'TusPosOperation', columns: ['tenantId', 'context', 'kind'], unique: false },
  { name: 'TusPosReceipt_tenantId_operationId_idx', table: 'TusPosReceipt', columns: ['tenantId', 'operationId'], unique: false },
  { name: 'TusPosReceipt_tenantId_operationId_createdAt_idx', table: 'TusPosReceipt', columns: ['tenantId', 'operationId', 'createdAt'], unique: false },
  { name: 'TusPosDevice_tenantId_status_idx', table: 'TusPosDevice', columns: ['tenantId', 'status'], unique: false },
  { name: 'TusPosSession_tenantId_deviceId_shiftId_status_idx', table: 'TusPosSession', columns: ['tenantId', 'deviceId', 'shiftId', 'status'], unique: false },
  { name: 'TusPosConflict_tenantId_operationId_status_idx', table: 'TusPosConflict', columns: ['tenantId', 'operationId', 'status'], unique: false },
  { name: 'TusPosConflict_tenantId_status_createdAt_idx', table: 'TusPosConflict', columns: ['tenantId', 'status', 'createdAt'], unique: false },
  { name: 'TusPosVersion_tenantId_shiftId_version_idx', table: 'TusPosVersion', columns: ['tenantId', 'shiftId', 'version'], unique: false },
  { name: 'TusDeliveryOutbox_tenantId_status_createdAt_idx', table: 'TusDeliveryOutbox', columns: ['tenantId', 'status', 'createdAt'], unique: false },
  { name: 'TusPosOutbox_tenantId_status_createdAt_idx', table: 'TusPosOutbox', columns: ['tenantId', 'status', 'createdAt'], unique: false },
  { name: 'TusPosOutbox_tenantId_aggregateId_status_idx', table: 'TusPosOutbox', columns: ['tenantId', 'aggregateId', 'status'], unique: false },
  { name: 'TusPosAudit_tenantId_operationId_createdAt_idx', table: 'TusPosAudit', columns: ['tenantId', 'operationId', 'createdAt'], unique: false },
])

const LIVE_SCHEMA_LEGACY_ALIASES = Object.freeze({
  TusDeliveryZone_tenantId_active_idx: 'tus_lscr_legacy_01',
  TusDeliveryShift_tenantId_zoneId_status_idx: 'tus_lscr_legacy_02',
  TusDeliveryTask_tenantId_shiftId_status_idx: 'tus_lscr_legacy_03',
  TusDeliveryTask_tenantId_commitmentId_status_idx: 'tus_lscr_legacy_04',
  TusDeliveryIncident_tenantId_taskId_status_idx: 'tus_lscr_legacy_05',
  TusPosOperation_tenantId_context_kind_idx: 'tus_lscr_legacy_06',
  TusPosDevice_tenantId_status_idx: 'tus_lscr_legacy_07',
  TusPosSession_tenantId_deviceId_shiftId_status_idx: 'tus_lscr_legacy_08',
  TusPosConflict_tenantId_operationId_status_idx: 'tus_lscr_legacy_09',
  TusPosConflict_tenantId_status_createdAt_idx: 'tus_lscr_legacy_10',
  TusPosVersion_tenantId_shiftId_version_idx: 'tus_lscr_legacy_11',
  TusDeliveryOutbox_tenantId_status_createdAt_idx: 'tus_lscr_legacy_12',
  TusPosOutbox_tenantId_status_createdAt_idx: 'tus_lscr_legacy_13',
  TusPosOutbox_tenantId_aggregateId_status_idx: 'tus_lscr_legacy_14',
})

export const REQUIRED_LIVE_SCHEMA_REPAIR_INDEXES = Object.freeze(
  REQUIRED_POS_REPAIR_INDEXES.map((index) => ({
    ...index,
    predicate: null,
    legacyAlias: LIVE_SCHEMA_LEGACY_ALIASES[index.name] ?? null,
  })),
)

export const REQUIRED_POS_REPAIR_CONSTRAINTS = Object.freeze([
  { name: 'TusPosConflict_tenant_operation_fk', table: 'TusPosConflict', type: 'f', definition: 'FOREIGN KEY ("tenantId", "operationId") REFERENCES "TusPosOperation" ("tenantId", "operationId") NOT VALID' },
  { name: 'TusPosOperation_amount_non_negative_check', table: 'TusPosOperation', type: 'c', definition: 'CHECK ((amount >= 0))' },
  { name: 'TusPosVersion_version_non_negative_check', table: 'TusPosVersion', type: 'c', definition: 'CHECK ((version >= 0))' },
])

const ROOT_DIRECTORY = resolve(fileURLToPath(new URL('..', import.meta.url)))
const MIGRATION_FILE_PATTERN = /migration\.sql$/u
const DATA_LOSS_TOKEN_PATTERN = /\b(?:TRUNCATE|CASCADE)\b/iu
const DROP_TOKEN_PATTERN = /\bDROP\b/iu
const DELETE_PATTERN = /\bDELETE\s+FROM\b/iu
const MUTATING_PATTERN = /^(?:UPDATE|INSERT)\b/iu
const TAGGED_CLEANUP_PATTERN = /repair:(?:tagged-cleanup|evidence-cleanup)/iu
const SQL_IDENTIFIER = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`
const ALTER_TABLE_PATTERN = new RegExp(
  String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${SQL_IDENTIFIER}(?:\.${SQL_IDENTIFIER})?\s+([\s\S]+?)\s*;?\s*$`,
  'iu'
)
// The only relaxation accepted by name: one column loses NOT NULL; no data or column is removed.
const DROP_NOT_NULL_ACTION = new RegExp(String.raw`^ALTER\s+(?:COLUMN\s+)?${SQL_IDENTIFIER}\s+DROP\s+NOT\s+NULL$`, 'iu')
const SEVERITY = Object.freeze({
  'comment-only': 0,
  additive: 1,
  constraint_relaxation: 2,
  ambiguous: 3,
  high_risk: 4,
  destructive: 5,
})

export function stripSqlComments(sql) {
  const input = String(sql ?? '')
  let output = ''
  let state = 'code'
  let dollarTag = ''
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    const next = input[index + 1]
    if (state === 'line-comment') {
      if (character === '\n') {
        output += character
        state = 'code'
      }
      continue
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        index += 1
        state = 'code'
      } else if (character === '\n') {
        output += '\n'
      }
      continue
    }
    if (state === 'single-quote') {
      output += character
      if (character === "'" && next === "'") {
        output += next
        index += 1
      } else if (character === "'") {
        state = 'code'
      }
      continue
    }
    if (state === 'double-quote') {
      output += character
      if (character === '"' && next === '"') {
        output += next
        index += 1
      } else if (character === '"') {
        state = 'code'
      }
      continue
    }
    if (state === 'dollar-quote') {
      output += character
      if (input.startsWith(dollarTag, index)) {
        const suffix = dollarTag.slice(1)
        output += suffix
        index += suffix.length
        state = 'code'
        dollarTag = ''
      }
      continue
    }
    if (character === '-' && next === '-') {
      index += 1
      state = 'line-comment'
      continue
    }
    if (character === '/' && next === '*') {
      index += 1
      state = 'block-comment'
      continue
    }
    if (character === "'") {
      output += character
      state = 'single-quote'
      continue
    }
    if (character === '"') {
      output += character
      state = 'double-quote'
      continue
    }
    if (character === '$') {
      const match = input.slice(index).match(/^\$[A-Za-z_0-9]*\$/u)
      if (match) {
        dollarTag = match[0]
        output += dollarTag
        index += dollarTag.length - 1
        state = 'dollar-quote'
        continue
      }
    }
    output += character
  }
  return output
}

export function splitSqlStatements(sql) {
  const input = String(sql ?? '')
  const statements = []
  let start = 0
  let state = 'code'
  let dollarTag = ''
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    const next = input[index + 1]
    if (state === 'line-comment') {
      if (character === '\n') state = 'code'
      continue
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        index += 1
        state = 'code'
      }
      continue
    }
    if (state === 'single-quote') {
      if (character === "'" && next === "'") index += 1
      else if (character === "'") state = 'code'
      continue
    }
    if (state === 'double-quote') {
      if (character === '"' && next === '"') index += 1
      else if (character === '"') state = 'code'
      continue
    }
    if (state === 'dollar-quote') {
      if (input.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1
        state = 'code'
        dollarTag = ''
      }
      continue
    }
    if (character === '-' && next === '-') {
      index += 1
      state = 'line-comment'
      continue
    }
    if (character === '/' && next === '*') {
      index += 1
      state = 'block-comment'
      continue
    }
    if (character === "'") {
      state = 'single-quote'
      continue
    }
    if (character === '"') {
      state = 'double-quote'
      continue
    }
    if (character === '$') {
      const match = input.slice(index).match(/^\$[A-Za-z_0-9]*\$/u)
      if (match) {
        dollarTag = match[0]
        index += dollarTag.length - 1
        state = 'dollar-quote'
        continue
      }
    }
    if (character === ';') {
      const statement = input.slice(start, index + 1).trim()
      if (statement) statements.push(statement)
      start = index + 1
    }
  }
  const remainder = input.slice(start).trim()
  if (remainder) statements.push(remainder)
  return statements
}

export function classifySqlStatement(sql) {
  const original = String(sql ?? '')
  const executable = stripSqlComments(original).trim()
  if (!executable) return 'comment-only'
  if (DATA_LOSS_TOKEN_PATTERN.test(executable)) return 'destructive'
  if (DELETE_PATTERN.test(executable) && !TAGGED_CLEANUP_PATTERN.test(original)) return 'destructive'
  const alterTable = ALTER_TABLE_PATTERN.exec(executable)
  if (alterTable) return classifyAlterTableActions(alterTable[1])
  if (DROP_TOKEN_PATTERN.test(executable)) return classifyDropStatement(executable)
  if (/INSERT\s+INTO\s+"_prisma_migrations"/iu.test(executable)
    && new RegExp(`(?:${REPAIR_MIGRATION_NAME}|${LAUNCH_MIGRATION_NAME}|${POS_INDEX_CONSTRAINT_REPAIR_NAME}|${LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME})`, 'u').test(executable)) return 'additive'
  if (/\b(?:_prisma_migrations|migration_name|finished_at|rolled_back_at)\b/iu.test(executable)
    && !/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"_prisma_migrations"/iu.test(executable)
    && !new RegExp(`(?:${REPAIR_MIGRATION_NAME}|${LAUNCH_MIGRATION_NAME}|${POS_INDEX_CONSTRAINT_REPAIR_NAME}|${LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME})`, 'u').test(executable)) return 'ambiguous'
  if (MUTATING_PATTERN.test(executable)) return 'ambiguous'
  if (/^CREATE\s+TABLE\b/iu.test(executable)) return 'additive'
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/iu.test(executable)) return 'additive'
  if (/^ALTER\s+TABLE[\s\S]*\bADD\s+(?:COLUMN|CONSTRAINT)\b/iu.test(executable)) return 'additive'
  if (/^DO\s+\$\$[\s\S]*\b(?:ALTER\s+TABLE[\s\S]*\bADD\s+(?:COLUMN|CONSTRAINT)|ALTER\s+INDEX[\s\S]*\bRENAME\s+TO\b|CREATE\s+(?:UNIQUE\s+)?INDEX)\b/iu.test(executable)) return 'additive'
  if (/^DO\s+\$\$[\s\S]*tus-live-schema-conformance-/iu.test(executable)) return 'additive'
  return 'ambiguous'
}

// Each ALTER TABLE action is classified on its own and the statement takes the most severe
// result, so `DROP NOT NULL` can never whitelist a `DROP COLUMN` in the same statement.
function classifyAlterTableActions(actionsSql) {
  const actions = splitTopLevelCommas(actionsSql)
  if (actions.length === 0) return 'ambiguous'
  return actions.map(classifyAlterTableAction).reduce((worst, current) => (SEVERITY[current] > SEVERITY[worst] ? current : worst), 'additive')
}

function classifyAlterTableAction(action) {
  const normalized = action.trim().replace(/\s+/gu, ' ')
  if (DROP_NOT_NULL_ACTION.test(normalized)) return 'constraint_relaxation'
  if (/^DROP\s+(?:COLUMN\b|IF\s+EXISTS\b)/iu.test(normalized)) return 'destructive'
  if (/^DROP\s+CONSTRAINT\b/iu.test(normalized)) return 'high_risk'
  if (new RegExp(String.raw`^ALTER\s+(?:COLUMN\s+)?${SQL_IDENTIFIER}\s+DROP\s+DEFAULT$`, 'iu').test(normalized)) return 'high_risk'
  if (DROP_TOKEN_PATTERN.test(normalized.replace(/'(?:[^']|'')*'/gu, "''"))) return 'destructive'
  if (/^ADD\s+(?:COLUMN|CONSTRAINT)\b/iu.test(normalized)) return 'additive'
  if (/^VALIDATE\s+CONSTRAINT\s+\S+$/iu.test(normalized)) return 'additive'
  return 'ambiguous'
}

function classifyDropStatement(executable) {
  if (/^DROP\s+(?:TABLE|SCHEMA|TYPE|DATABASE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|DOMAIN|EXTENSION|COLUMN)\b/iu.test(executable)) return 'destructive'
  if (/^DROP\s+(?:INDEX|TRIGGER|FUNCTION|PROCEDURE|POLICY|RULE|CONSTRAINT)\b/iu.test(executable)) return 'high_risk'
  // DROP inside DO blocks, function bodies or unknown forms is not reviewable by pattern.
  return 'destructive'
}

function splitTopLevelCommas(sql) {
  const parts = []
  let depth = 0
  let quote = null
  let start = 0
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"') quote = character
    else if (character === '(') depth += 1
    else if (character === ')') depth = Math.max(0, depth - 1)
    else if (character === ',' && depth === 0) {
      parts.push(sql.slice(start, index))
      start = index + 1
    }
  }
  parts.push(sql.slice(start))
  return parts.map((part) => part.trim()).filter(Boolean)
}

// Append-only guard DDL (DB-09-GATE). Recognized structurally, never by keyword:
// - a function whose whole body is `RAISE EXCEPTION '<literal>'` and returns trigger;
//   `OR REPLACE` is accepted only when no earlier migration defined that function;
// - a plain `CREATE TRIGGER ... BEFORE UPDATE OR DELETE ... FOR EACH ROW` executing a guard
//   function already recognized in the migration chain.
// Anything else involving functions or triggers stays ambiguous (fail-closed).
const GUARD_FUNCTION_PATTERN = new RegExp(
  String.raw`^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(${SQL_IDENTIFIER}(?:\.${SQL_IDENTIFIER})?)\s*\(\s*\)\s+RETURNS\s+trigger\s+LANGUAGE\s+plpgsql\s+AS\s+(\$[A-Za-z_]*\$)\s*BEGIN\s+RAISE\s+EXCEPTION\s+'(?:[^']|'')*'\s*;\s*END\s*;?\s*\3\s*;?$`,
  'iu'
)
const GUARD_TRIGGER_PATTERN = new RegExp(
  String.raw`^CREATE\s+TRIGGER\s+${SQL_IDENTIFIER}\s+BEFORE\s+(?:UPDATE\s+OR\s+DELETE|DELETE\s+OR\s+UPDATE)\s+ON\s+${SQL_IDENTIFIER}(?:\.${SQL_IDENTIFIER})?\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(${SQL_IDENTIFIER}(?:\.${SQL_IDENTIFIER})?)\s*\(\s*\)\s*;?$`,
  'iu'
)
const FUNCTION_DEFINITION_PATTERN = new RegExp(
  String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(${SQL_IDENTIFIER}(?:\.${SQL_IDENTIFIER})?)\s*\(`,
  'iu'
)

// Individually reviewed statements of historical migrations. Keyed by migration and by the
// sha256 of the comment-free, whitespace-normalized SQL: any edit invalidates the review.
export const REVIEWED_MIGRATION_STATEMENTS = Object.freeze([
  {
    migration: '20260917100000_tus_work_budget',
    classification: 'ambiguous',
    sha256: '00ed05da8d50065f153ee9ad42f426300032415816a561181f5f46ee0c623a15',
    reason: 'Deterministic backfill of the new prestador_tenant_id column from publicaciones.tenant_id; the next statement sets NOT NULL, so any unmatched row aborts the migration instead of guessing.',
  },
  {
    migration: '20260917100000_tus_work_budget',
    classification: 'high_risk',
    sha256: '38880b2172369b71ca4f2d142b039d4add71ca52010e7bdeb65cb428de61c0d1',
    reason: 'Replaces fk_compromisos_mercado_servicios_publicaciones in the same statement with the tenant-scoped (prestador_tenant_id, publicacion_id) FK; RESTRICT, no data removed.',
  },
  {
    migration: '20260917100000_tus_work_budget',
    classification: 'destructive',
    sha256: 'eddacfc3677b9ed32f2806f32afedc4df3670fe8145a4cb760bbdd831deb24b9',
    reason: 'ON DELETE CASCADE only from lineas_presupuesto (strict children of one budget version) to presupuestos, matching the Prisma relation; budget versions are never deleted by the application and are restricted by trabajos.',
  },
])

export function normalizedStatementHash(sql) {
  return createHash('sha256').update(stripSqlComments(sql).trim().replace(/\s+/gu, ' ')).digest('hex')
}

function nombreFuncion(identifier) {
  const parts = identifier.split('.').map((part) => part.replace(/^"|"$/gu, '').toLowerCase())
  return parts.length === 1 ? `public.${parts[0]}` : parts.join('.')
}

export function createMigrationContext() {
  return { definedFunctions: new Set(), guardFunctions: new Set() }
}

// Classifies with chain context and records the functions a statement defines.
export function classifyStatementInContext(sql, context = createMigrationContext()) {
  const executable = stripSqlComments(sql).trim()
  let classification = classifySqlStatement(sql)
  if (classification === 'ambiguous') {
    const guardFunction = GUARD_FUNCTION_PATTERN.exec(executable)
    if (guardFunction) {
      const name = nombreFuncion(guardFunction[2])
      if (!guardFunction[1] || !context.definedFunctions.has(name)) {
        classification = 'append_only_guard'
        context.guardFunctions.add(name)
      }
    }
    const guardTrigger = GUARD_TRIGGER_PATTERN.exec(executable)
    if (guardTrigger && context.guardFunctions.has(nombreFuncion(guardTrigger[1]))) classification = 'append_only_guard'
  }
  const defined = FUNCTION_DEFINITION_PATTERN.exec(executable)
  if (defined) context.definedFunctions.add(nombreFuncion(defined[1]))
  return classification
}

const ACCEPTED_CLASSIFICATIONS = new Set(['comment-only', 'additive', 'constraint_relaxation', 'append_only_guard'])

// Reviews a known migration chain in order. A migration is accepted only when every statement
// is safe by classification or matches an individually reviewed statement hash.
export async function reviewMigrationChain({ migrationsDirectory, names } = {}) {
  const directory = migrationsDirectory ?? join(ROOT_DIRECTORY, 'apps', 'api', 'prisma', 'migrations')
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
  const context = createMigrationContext()
  const selected = new Set(names ?? entries)
  const reviews = []
  for (const name of entries) {
    const path = join(directory, name, 'migration.sql')
    if (!existsSync(path)) continue
    const statements = splitSqlStatements(await readFile(path, 'utf8')).map((sql) => {
      const classification = classifyStatementInContext(sql, context)
      const sha256 = normalizedStatementHash(sql)
      const reviewed = REVIEWED_MIGRATION_STATEMENTS.find((entry) => entry.migration === name && entry.sha256 === sha256 && entry.classification === classification)
      return { classification, sha256, reviewed: reviewed?.reason ?? null, sql: redactText(sql) }
    })
    if (!selected.has(name)) continue
    const blocking = statements.filter((statement) => !ACCEPTED_CLASSIFICATIONS.has(statement.classification) && !statement.reviewed)
    reviews.push({ name, accepted: blocking.length === 0, blocking, statements })
  }
  const missing = [...selected].filter((name) => !reviews.some((review) => review.name === name))
  return { accepted: missing.length === 0 && reviews.every((review) => review.accepted), missing, reviews }
}

export async function inventoryMigrations({ migrationsDirectory, repairMigrationName = REPAIR_MIGRATION_NAME, repairMigrationNames } = {}) {
  const directory = migrationsDirectory ?? join(ROOT_DIRECTORY, 'apps', 'api', 'prisma', 'migrations')
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))
  const migrations = []
  const nonHistoricalNames = new Set(repairMigrationNames ?? [
    repairMigrationName,
    LAUNCH_MIGRATION_NAME,
    POS_INDEX_CONSTRAINT_REPAIR_NAME,
    LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME,
    PHYSICAL_SPANISH_MIGRATION_NAME,
  ])
  let destructiveStatementCount = 0
  let ambiguousStatementCount = 0
  let highRiskStatementCount = 0
  const constraintRelaxations = []
  let commentOnlyTokenCount = 0
  const destructiveTokens = new Set()
  for (const entry of entries) {
    const path = join(directory, entry.name, 'migration.sql')
    if (!MIGRATION_FILE_PATTERN.test(path)) continue
    if (!existsSync(path)) {
      migrations.push({ name: entry.name, historical: !nonHistoricalNames.has(entry.name), statements: [{ classification: 'ambiguous', sql: '<missing migration.sql>' }] })
      ambiguousStatementCount += 1
      continue
    }
    const sql = await readFile(path, 'utf8')
    commentOnlyTokenCount += [...sql.matchAll(/(?:--[^\r\n]*|\/\*[\s\S]*?\*\/)/gu)]
      .filter((match) => /\b(?:DROP|TRUNCATE|CASCADE)\b/iu.test(match[0])).length
    const statements = splitSqlStatements(sql).map((statement) => {
      const classification = classifySqlStatement(statement)
      if (classification === 'destructive') {
        destructiveStatementCount += 1
        for (const token of stripSqlComments(statement).match(/\b(?:DROP|TRUNCATE|CASCADE)\b/giu) ?? []) destructiveTokens.add(token.toUpperCase())
      }
      if (classification === 'ambiguous') ambiguousStatementCount += 1
      if (classification === 'high_risk') highRiskStatementCount += 1
      if (classification === 'constraint_relaxation') constraintRelaxations.push({ migration: entry.name, sql: redactText(statement) })
      if (classification === 'comment-only') commentOnlyTokenCount += 1
      return { classification, sql: redactText(statement) }
    })
    migrations.push({ name: entry.name, historical: !nonHistoricalNames.has(entry.name), statements })
  }
  const pendingMigrations = migrations.filter((migration) => migration.historical)
  return {
    migrations,
    pendingMigrations,
    destructiveStatementCount,
    ambiguousStatementCount,
    highRiskStatementCount,
    constraintRelaxationCount: constraintRelaxations.length,
    constraintRelaxations,
    commentOnlyTokenCount,
    destructiveTokens: [...destructiveTokens].sort(),
  }
}

export function gateInventory({ statements = [], destructiveStatementCount = 0, ambiguousStatementCount = 0, highRiskStatementCount = 0 } = {}) {
  const classified = statements.map((statement) => {
    const sql = typeof statement === 'string' ? statement : statement.sql
    const initialClassification = classifySqlStatement(sql)
    const classification = initialClassification === 'additive' && !isExplicitlySafeAdditive(sql) ? 'ambiguous' : initialClassification
    return { classification, sql: redactText(sql) }
  })
  const destructive = classified.filter((statement) => statement.classification === 'destructive')
  const ambiguous = classified.filter((statement) => statement.classification === 'ambiguous')
  const highRisk = classified.filter((statement) => statement.classification === 'high_risk')
  const relaxations = classified.filter((statement) => statement.classification === 'constraint_relaxation')
  const totalDestructive = destructive.length + Number(destructiveStatementCount)
  const totalAmbiguous = ambiguous.length + Number(ambiguousStatementCount)
  const totalHighRisk = highRisk.length + Number(highRiskStatementCount)
  return {
    status: totalDestructive === 0 && totalAmbiguous === 0 && totalHighRisk === 0 ? 'passed' : 'rejected',
    destructiveStatementCount: totalDestructive,
    ambiguousStatementCount: totalAmbiguous,
    highRiskStatementCount: totalHighRisk,
    constraintRelaxationCount: relaxations.length,
    statements: classified,
    reason: totalDestructive > 0
      ? 'destructive-sql-rejected'
      : totalHighRisk > 0
        ? 'high-risk-sql-rejected'
        : totalAmbiguous > 0
          ? 'ambiguous-sql-rejected'
          : relaxations.length > 0
            ? 'safe-additive-sql-with-constraint-relaxation'
            : 'safe-additive-sql',
  }
}

export function parseRepairArguments(argumentsList = []) {
  const args = [...argumentsList]
  const intent = args.shift()
  const invalidArguments = []
  let confirmed = false
  let backupId = null
  let restoreProofPath = null
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--confirm-development-target') {
      confirmed = true
    } else if (argument === '--backup-id' && args[index + 1] && !args[index + 1].startsWith('-')) {
      backupId = args[index + 1]
      index += 1
    } else if (argument === '--restore-proof' && args[index + 1] && !args[index + 1].startsWith('-')) {
      restoreProofPath = args[index + 1]
      index += 1
    } else {
      invalidArguments.push(argument)
    }
  }
  return { intent, confirmed, backupId, restoreProofPath, invalidArguments }
}

export function redactText(value) {
  return String(value ?? '')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, 'postgresql://<redacted>')
    .replace(/(password|secret|token|credential|database_url)\s*[=:]\s*[^\s,;]+/giu, '$1=<redacted>')
    .replace(/(postgres(?:ql)?:\/\/[^:@\s]+):[^@\s]+@/giu, '$1:<redacted>@')
}

export function resolveRepairTarget({ rootDirectory = ROOT_DIRECTORY, environment = process.env, confirmed = false } = {}) {
  const rootEnvironment = readRootEnvironment(rootDirectory)
  const databaseUrl = rootEnvironment.DATABASE_URL
  const base = {
    source: databaseUrl ? 'root-dotenv-DATABASE_URL' : null,
    redactedTarget: databaseUrl ? 'postgresql://<redacted-host>/<redacted-database>' : null,
    classification: 'database-target-not-configured',
    proof: { nonProduction: false, attestation: null },
  }
  if (environment?.NODE_ENV !== 'development') return { ...base, status: 'blocked', reason: 'development-environment-required' }
  if (!databaseUrl) return { ...base, status: 'blocked', reason: 'no-database-url' }
  if (isProductionProfile(environment, rootEnvironment)) return { ...base, status: 'blocked', reason: 'production-target-refused' }
  const parsed = parsePostgresUrl(databaseUrl)
  if (!parsed) return { ...base, status: 'blocked', reason: 'invalid-postgresql-url' }
  if (isSharedHost(parsed.hostname)) return { ...base, status: 'blocked', reason: 'shared-or-production-host' }
  if (!confirmed) return { ...base, status: 'blocked', reason: 'explicit-development-confirmation-required' }
  return {
    ...base,
    status: 'ready',
    classification: isLocalHost(parsed.hostname) ? 'local-development-attested' : 'remote-development-attested',
    proof: { nonProduction: true, attestation: 'operator-confirmed' },
    reason: 'operator-confirmed-development-target',
  }
}

export function validateBackupHandle(backupId) {
  if (typeof backupId !== 'string' || backupId.trim().length === 0) return { status: 'blocked', reason: 'restorable-backup-required' }
  if (/postgres(?:ql)?:\/\/|password|secret|token/iu.test(backupId)) return { status: 'blocked', reason: 'backup-handle-redacted-or-invalid' }
  return { status: 'ready', handle: '<redacted>' }
}

export function validateExactMoneySql(sql) {
  const executable = stripSqlComments(sql)
  const forbiddenMoneyType = /(?:DOUBLE\s+PRECISION|REAL|FLOAT(?:\s*\(\s*\d+\s*\))?)/iu
  const monetaryDeclaration = new RegExp(`(?:^|,)\\s*(?:"(?:${REQUIRED_MONEY_COLUMNS.join('|')})"|\\b(?:${REQUIRED_MONEY_COLUMNS.join('|')})\\b)\\s+(?:BIGINT|DOUBLE\\s+PRECISION|REAL|FLOAT(?:\\s*\\(\\s*\\d+\\s*\\))?|NUMERIC(?:\\s*\\([^)]*\\))?)`, 'imu')
  if (forbiddenMoneyType.test(executable) && monetaryDeclaration.test(executable)) {
    return { status: 'rejected', reason: 'exact-money-floating-type', writesAllowed: false }
  }
  if (monetaryDeclaration.test(executable) && !/\bBIGINT\b/iu.test(executable) && !/\bNUMERIC\s*\(/iu.test(executable)) {
    return { status: 'rejected', reason: 'exact-money-type-missing', writesAllowed: false }
  }
  return { status: 'passed', reason: 'exact-money-sql-compatible', writesAllowed: true }
}

export function inspectBackupTooling() {
  return {
    pgDump: locateExecutable('pg_dump'),
    pgRestore: locateExecutable('pg_restore'),
  }
}

export function createDefaultBackupOperations({ pgRestorePath = locateExecutablePath('pg_restore'), restoreProofPath = null, scratchRootUrl = null, inspectScratch = defaultInspectScratch, spawn = spawnSync } = {}) {
  return {
    assertRestorable: async (backupId) => {
      const backupPath = resolveBackupPath(backupId)
      if (!backupPath) throw new Error('backup-handle-invalid')
      let metadata
      try {
        metadata = statSync(backupPath)
      } catch {
        throw new Error('backup-file-unavailable')
      }
      if (!metadata.isFile() || metadata.size <= 0) throw new Error('backup-file-empty')
      if (!pgRestorePath) throw new Error('backup-tooling-unavailable')

      const result = spawn(pgRestorePath, ['--format=custom', '--list', backupPath], {
        stdio: 'ignore',
        timeout: CONNECTION_TIMEOUT_MS,
        windowsHide: true,
      })
      if (result?.error || result?.status !== 0) throw new Error('backup-archive-list-verification-failed')
    },
    verifyRestore: async (backupId) => {
      await validateRestoreProof({ backupId, proofPath: restoreProofPath, rootUrl: scratchRootUrl, inspectScratch })
    },
  }
}

export async function generateIsolatedRestoreProof({
  rootDirectory = ROOT_DIRECTORY,
  environment = process.env,
  confirmed = false,
  backupId,
  proofPath,
  operations = {},
} = {}) {
  const target = resolveRepairTarget({ rootDirectory, environment, confirmed })
  const base = {
    status: 'blocked',
    target: redactTarget(target),
    backup: null,
    restore: null,
    sideEffects: { currentTargetConnections: 0, currentTargetWrites: 0, scratchDatabasesCreated: 0, rowValuesRead: 0 },
    cleanupState: 'not-started',
  }
  if (target.status !== 'ready') return { ...base, safetyGate: 'target-gate', reason: target.reason }
  const backup = validateBackupHandle(backupId)
  if (backup.status !== 'ready') return { ...base, safetyGate: 'backup-gate', reason: backup.reason }
  if (!isSafeRestoreProofPath(proofPath)) return { ...base, safetyGate: 'proof-output-gate', reason: 'restore-proof-path-required' }

  const backupPath = resolveBackupPath(backupId)
  const metadata = readBackupMetadata(backupPath)
  if (!metadata || !metadata.isFile() || metadata.size <= 0) return { ...base, safetyGate: 'backup-gate', reason: 'backup-file-empty' }
  const fingerprint = await fingerprintBackup(backupPath)
  const pgRestorePath = operations.pgRestorePath ?? locateExecutablePath('pg_restore')
  if (!pgRestorePath) return { ...base, safetyGate: 'restore-tool-gate', reason: 'backup-tooling-unavailable' }

  const toolVersion = await (operations.toolVersion ?? (() => readPgRestoreVersion(pgRestorePath)))()
  if (toolVersion !== '16.2') return { ...base, safetyGate: 'restore-tool-gate', reason: 'postgresql-16.2-required' }
  const archiveList = await (operations.archiveList ?? defaultArchiveList)({ executable: pgRestorePath, backupPath, timeoutMs: CONNECTION_TIMEOUT_MS })
  if (archiveList?.error || archiveList?.status !== 0) return { ...base, safetyGate: 'backup-gate', reason: 'backup-archive-list-verification-failed' }

  const scratchIdentifier = `lscr-${randomUUID().replaceAll('-', '').slice(0, 12)}`
  let scratchTarget
  try {
    scratchTarget = await (operations.createScratch ?? defaultCreateScratch)({
      rootUrl: readRootEnvironment(rootDirectory).DATABASE_URL,
      identifier: scratchIdentifier,
      timeoutMs: CONNECTION_TIMEOUT_MS,
    })
    base.sideEffects.scratchDatabasesCreated = 1
    const restore = await (operations.restore ?? defaultRestore)({
      executable: pgRestorePath,
      scratchTarget,
      backupPath,
      timeoutMs: CONNECTION_TIMEOUT_MS,
    })
    if (restore?.error || restore?.status !== 0) return { ...base, safetyGate: 'restore-proof-gate', reason: restore?.error?.code === 'ETIMEDOUT' ? 'isolated-restore-timeout' : 'isolated-restore-failed', restore: { mode: RESTORE_PROOF_MODE.SCHEMA_ONLY, exitCode: Number.isInteger(restore?.status) ? restore.status : null }, cleanupState: 'scratch-retained-for-owner-cleanup' }
    const metadataVerification = await (operations.inspectScratch ?? defaultInspectScratch)(scratchTarget, CONNECTION_TIMEOUT_MS)
    if (!isValidMetadataOnlyVerification(metadataVerification)) return { ...base, safetyGate: 'restore-proof-gate', reason: 'isolated-restore-metadata-verification-failed', restore: { mode: RESTORE_PROOF_MODE.SCHEMA_ONLY, exitCode: 0, metadataOnlyVerification: sanitizeMetadataVerification(metadataVerification) }, cleanupState: 'scratch-retained-for-owner-cleanup' }

    const proof = {
      proofVersion: RESTORE_PROOF_VERSION,
      proofType: 'tus-isolated-restore-proof',
      generatedBy: 'tus-migration-repair',
      operationId: `restore-proof-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      backup: { ...fingerprint, format: 'custom', archiveListExitCode: 0 },
      restore: {
        mode: RESTORE_PROOF_MODE.SCHEMA_ONLY,
        scratchTarget: { type: 'postgresql-database', identifier: scratchIdentifier },
        tool: { name: 'pg_restore', version: toolVersion },
        invocation: {
          executable: 'pg_restore',
          arguments: ['--format=custom', '--dbname=<isolated-scratch>', '--schema-only', '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '<backup-file>'],
        },
        exitStatus: 'success',
        exitCode: 0,
        metadataOnlyVerification: sanitizeMetadataVerification(metadataVerification),
      },
    }
    await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await validateRestoreProof({ backupId, proofPath, rootUrl: readRootEnvironment(rootDirectory).DATABASE_URL, inspectScratch: operations.inspectScratch ?? defaultInspectScratch })
    return { ...base, status: 'passed', proof, restore: proof.restore, cleanupState: 'scratch-retained-for-owner-cleanup' }
  } catch (error) {
    return { ...base, safetyGate: 'restore-proof-gate', reason: classifyRestoreProofFailure(error), restore: scratchTarget ? { mode: RESTORE_PROOF_MODE.SCHEMA_ONLY, scratchTarget: { type: 'postgresql-database', identifier: scratchIdentifier } } : null, cleanupState: scratchTarget ? 'scratch-retained-for-owner-cleanup' : 'verified' }
  }
}

export async function validateRestoreProof({ backupId, proofPath, rootUrl, inspectScratch = defaultInspectScratch } = {}) {
  const handle = validateBackupHandle(backupId)
  if (handle.status !== 'ready') throw new Error(handle.reason)
  if (!isSafeRestoreProofPath(proofPath)) throw new Error('backup-restore-proof-required')
  const backupPath = resolveBackupPath(backupId)
  let proof
  try {
    proof = JSON.parse(await readFile(proofPath, 'utf8'))
  } catch {
    throw new Error('backup-restore-proof-invalid')
  }
  if (!isRestoreProofShapeValid(proof)) throw new Error('backup-restore-proof-invalid')
  const fingerprint = await fingerprintBackup(backupPath)
  if (proof.backup.sha256 !== fingerprint.sha256 || proof.backup.sizeBytes !== fingerprint.sizeBytes) throw new Error('backup-restore-proof-backup-mismatch')
  if (proof.restore.mode !== RESTORE_PROOF_MODE.SCHEMA_ONLY) throw new Error('backup-restore-proof-mode-mismatch')
  if (proof.restore.exitStatus !== 'success' || proof.restore.exitCode !== 0 || !isValidMetadataOnlyVerification(proof.restore.metadataOnlyVerification)) throw new Error('backup-restore-proof-incomplete')
  if (typeof rootUrl !== 'string') throw new Error('backup-restore-proof-scratch-required')
  const scratchTarget = buildScratchTarget(rootUrl, proof.restore.scratchTarget.identifier)
  const scratchVerification = await inspectScratch(scratchTarget, CONNECTION_TIMEOUT_MS)
  if (!isValidMetadataOnlyVerification(scratchVerification)
    || scratchVerification.tableCount !== proof.restore.metadataOnlyVerification.tableCount
    || scratchVerification.migrationTablePresent !== proof.restore.metadataOnlyVerification.migrationTablePresent) {
    throw new Error('backup-restore-proof-scratch-mismatch')
  }
  return { status: 'passed', handle: '<redacted>', restoreVerified: true }
}

function isSafeRestoreProofPath(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && !/postgres(?:ql)?:\/\/|password|secret|token/iu.test(value)
}

function readBackupMetadata(backupPath) {
  try {
    return statSync(backupPath)
  } catch {
    return null
  }
}

async function fingerprintBackup(backupPath) {
  const metadata = readBackupMetadata(backupPath)
  if (!metadata?.isFile() || metadata.size <= 0) throw new Error('backup-file-unavailable')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(backupPath)) hash.update(chunk)
  return { sha256: hash.digest('hex'), sizeBytes: metadata.size }
}

function readPgRestoreVersion(pgRestorePath) {
  const result = spawnSync(pgRestorePath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 1_000,
    windowsHide: true,
  })
  if (result?.error || result?.status !== 0) return null
  const match = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.match(/PostgreSQL\)?\s+(\d+\.\d+)/iu)
  return match?.[1] ?? null
}

async function defaultCreateScratch({ rootUrl, identifier, timeoutMs }) {
  const require = createRequire(join(ROOT_DIRECTORY, 'apps', 'api', 'package.json'))
  const { Client } = require('pg')
  const maintenanceUrl = new URL(rootUrl)
  maintenanceUrl.pathname = '/postgres'
  const client = new Client({ connectionString: maintenanceUrl.toString(), connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs })
  await client.connect()
  try {
    await client.query(`CREATE DATABASE ${quoteIdentifier(identifier)}`)
  } finally {
    await client.end().catch(() => undefined)
  }
  return buildScratchTarget(rootUrl, identifier)
}

function buildScratchTarget(rootUrl, identifier) {
  const scratchUrl = new URL(rootUrl)
  scratchUrl.pathname = `/${identifier}`
  return { type: 'postgresql-database', identifier, url: scratchUrl.toString() }
}

function defaultArchiveList({ executable, backupPath, timeoutMs }) {
  return spawnSync(executable, ['--format=custom', '--list', backupPath], {
    stdio: 'ignore',
    timeout: timeoutMs,
    windowsHide: true,
  })
}

function defaultRestore({ executable, scratchTarget, backupPath, timeoutMs }) {
  if (typeof scratchTarget?.url !== 'string') throw new Error('scratch-target-unavailable')
  return spawnSync(executable, [
    '--format=custom',
    `--dbname=${scratchTarget.url}`,
    '--schema-only',
    '--no-owner',
    '--no-acl',
    '--exit-on-error',
    '--single-transaction',
    backupPath,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    windowsHide: true,
  })
}

async function defaultInspectScratch(scratchTarget, timeoutMs) {
  const require = createRequire(join(ROOT_DIRECTORY, 'apps', 'api', 'package.json'))
  const { Client } = require('pg')
  const client = new Client({ connectionString: scratchTarget.url, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs })
  await client.connect()
  try {
    const result = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    return {
      status: 'passed',
      tableCount: result.rows.length,
      migrationTablePresent: result.rows.some((row) => row.table_name === '_prisma_migrations'),
      rowValuesRead: 0,
    }
  } finally {
    await client.end().catch(() => undefined)
  }
}

function isValidMetadataOnlyVerification(value) {
  return value?.status === 'passed'
    && Number.isInteger(Number(value.tableCount))
    && Number(value.tableCount) > 0
    && value.migrationTablePresent === true
    && Number(value.rowValuesRead) === 0
}

function sanitizeMetadataVerification(value) {
  return {
    status: value?.status === 'passed' ? 'passed' : 'blocked',
    tableCount: Number.isInteger(Number(value?.tableCount)) ? Number(value.tableCount) : null,
    migrationTablePresent: value?.migrationTablePresent === true,
    rowValuesRead: Number(value?.rowValuesRead ?? 0),
  }
}

function isRestoreProofShapeValid(value) {
  const expectedInvocation = ['--format=custom', '--dbname=<isolated-scratch>', '--schema-only', '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '<backup-file>']
  return value?.proofVersion === RESTORE_PROOF_VERSION
    && value.proofType === 'tus-isolated-restore-proof'
    && value.generatedBy === 'tus-migration-repair'
    && typeof value.operationId === 'string'
    && value.operationId.length > 0
    && typeof value.createdAt === 'string'
    && Number.isFinite(Date.parse(value.createdAt))
    && value.backup?.format === 'custom'
    && value.backup.archiveListExitCode === 0
    && /^[a-f0-9]{64}$/u.test(value.backup.sha256)
    && Number.isInteger(value.backup.sizeBytes)
    && value.backup.sizeBytes > 0
    && typeof value.restore?.mode === 'string'
    && value.restore.scratchTarget?.type === 'postgresql-database'
    && /^lscr-[a-f0-9]{12}$/u.test(value.restore.scratchTarget.identifier)
    && value.restore.tool?.name === 'pg_restore'
    && value.restore.tool.version === '16.2'
    && value.restore.invocation?.executable === 'pg_restore'
    && JSON.stringify(value.restore.invocation.arguments) === JSON.stringify(expectedInvocation)
}

function classifyRestoreProofFailure(error) {
  if (error?.code === 'ETIMEDOUT') return 'isolated-restore-timeout'
  if (error?.code === 'EEXIST') return 'restore-proof-path-exists'
  if (error?.message === 'backup-file-unavailable') return 'backup-file-unavailable'
  if (error?.message === 'scratch-target-unavailable') return 'scratch-target-unavailable'
  return 'isolated-restore-failed'
}

export function createExactMoneyBackfillPlan({
  table,
  sourceColumn,
  targetColumn,
  currencyColumn,
  currency = 'ARS',
  scale = 2,
  approved = false,
  approvalId,
} = {}) {
  if (!approved) return { status: 'blocked', reason: EXACT_MONEY_BACKFILL_APPROVAL }
  if (typeof approvalId !== 'string' || approvalId.trim().length === 0) return { status: 'blocked', reason: EXACT_MONEY_BACKFILL_APPROVAL }
  for (const identifier of [table, sourceColumn, targetColumn, currencyColumn]) {
    if (!isSafeSqlIdentifier(identifier)) throw new Error('exact-money backfill identifier is invalid')
  }
  const normalizedCurrency = String(currency).trim().toUpperCase()
  if (!(normalizedCurrency in EXACT_MONEY_CURRENCY_SCALES) || scale !== EXACT_MONEY_CURRENCY_SCALES[normalizedCurrency]) throw new Error('exact-money backfill policy is invalid')

  const factor = 10n ** BigInt(scale)
  const maxBigInt = '9223372036854775807'
  const minBigInt = '-9223372036854775808'
  const escapedCurrency = normalizedCurrency.replaceAll("'", "''")
  const quotedTable = quoteIdentifier(table)
  const quotedSource = quoteIdentifier(sourceColumn)
  const quotedTarget = quoteIdentifier(targetColumn)
  const quotedCurrency = quoteIdentifier(currencyColumn)
  return {
    status: 'ready',
    approvalId: approvalId.trim(),
    currency: normalizedCurrency,
    scale,
    requiresBackupRestore: true,
    requiresDevelopmentConfirmation: true,
    sql: [
      `-- ${EXACT_MONEY_BACKFILL_TAG}`,
      `DO $$ BEGIN`,
      `  IF EXISTS (SELECT 1 FROM ${quotedTable} WHERE ${quotedCurrency} IS NULL OR UPPER(${quotedCurrency}) <> '${escapedCurrency}') THEN RAISE EXCEPTION 'exact-money-backfill-unknown-currency'; END IF;`,
      `  IF EXISTS (SELECT 1 FROM ${quotedTable} WHERE ${quotedSource} IS NULL OR ${quotedSource}::text IN ('NaN', 'Infinity', '-Infinity')) THEN RAISE EXCEPTION 'exact-money-backfill-invalid-number'; END IF;`,
      `  IF EXISTS (SELECT 1 FROM ${quotedTable} WHERE ${quotedSource}::numeric <> trunc(${quotedSource}::numeric, ${scale}) OR ${quotedSource}::numeric * ${factor} < ${minBigInt}::numeric OR ${quotedSource}::numeric * ${factor} > ${maxBigInt}::numeric) THEN RAISE EXCEPTION 'exact-money-backfill-fractional-or-overflow'; END IF;`,
      `END $$;`,
      `ALTER TABLE ${quotedTable} ADD COLUMN IF NOT EXISTS ${quotedTarget} BIGINT;`,
      `UPDATE ${quotedTable} SET ${quotedTarget} = (${quotedSource}::numeric * ${factor})::BIGINT WHERE ${quotedTarget} IS NULL AND UPPER(${quotedCurrency}) = '${escapedCurrency}';`,
    ].join('\n'),
  }
}

export async function verifyRestorableBackup({ backupId, operations = {} } = {}) {
  const handle = validateBackupHandle(backupId)
  if (handle.status !== 'ready') throw new Error(handle.reason)
  if (typeof operations.assertRestorable !== 'function' || typeof operations.verifyRestore !== 'function') {
    throw new Error('backup verification unavailable; restorable backup is required before DDL')
  }
  await operations.assertRestorable(backupId)
  if (typeof operations.restoreToScratch === 'function') await operations.restoreToScratch(backupId)
  await operations.verifyRestore(backupId)
  return { status: 'passed', handle: '<redacted>', restoreVerified: true }
}

export function validatePreflight(snapshot = {}) {
  if (snapshot.reason || Number(snapshot.orphans ?? 0) > 0) return { status: 'blocked', writesAllowed: false, reason: 'preflight-mismatch' }
  if (snapshot.ledger?.repairMarkerCount > 1) return { status: 'blocked', writesAllowed: false, reason: 'preflight-mismatch' }
  if (!validateMoneyTypes(snapshot)) return { status: 'blocked', writesAllowed: false, reason: 'exact-money-type-mismatch' }
  for (const table of REQUIRED_POS_TABLES) {
    const observed = snapshot.tables?.[table]
    if (!observed || observed.present === false) continue
    const expected = REQUIRED_SCHEMA_COLUMNS[table]
    if (!sameMembers(observed.columns, expected) || observed.primaryKey !== true) return { status: 'blocked', writesAllowed: false, reason: 'preflight-mismatch' }
  }
  return { status: 'ready', writesAllowed: true, reason: 'preflight-passed' }
}

export function validatePosIndexConstraintRepairPreflight(snapshot = {}) {
  const base = validatePreflight(snapshot)
  if (base.status !== 'ready') return base
  const ledger = snapshot.ledger ?? {}
  const launchMarkerCount = Number(ledger.launchMarkerCount ?? (ledger.names ?? []).filter((name) => name === LAUNCH_MIGRATION_NAME).length)
  const repairMarkerCount = Number(ledger.posIndexConstraintRepairMarkerCount ?? (ledger.names ?? []).filter((name) => name === POS_INDEX_CONSTRAINT_REPAIR_NAME).length)
  if (launchMarkerCount !== 1 || repairMarkerCount !== 0) {
    return { status: 'blocked', writesAllowed: false, reason: 'repair-preflight-mismatch' }
  }
  return { status: 'ready', writesAllowed: true, reason: 'repair-preflight-passed' }
}

export function validateConformancePreflight(snapshot = {}) {
  const ledger = snapshot.ledger ?? {}
  const markerLineage = getConformanceMarkerLineage(ledger)
  if (markerLineage.launch !== 1 || markerLineage.pos !== 1 || markerLineage.historicalAdditiveRepair !== 0 || markerLineage.conformance > 1) {
    return { status: 'blocked', writesAllowed: false, reason: 'marker-lineage-gate', markerLineage }
  }

  for (const expected of REQUIRED_CONFORMANCE_MONEY_COLUMNS) {
    const observed = snapshot.tables?.[expected.table]
    if (observed?.present !== true) return { status: 'blocked', writesAllowed: false, reason: 'missing-money-table', table: expected.table }
    const shape = getColumnShape(observed, expected.column)
    const hasColumn = Array.isArray(observed.columns) && observed.columns.includes(expected.column)
    if (!hasColumn) {
      if (!isApprovedMissingMoneyColumn(expected) || Number(snapshot.rowCounts?.[expected.table]) !== 0) {
        return { status: 'blocked', writesAllowed: false, reason: 'exact-money-column-gate', table: expected.table, column: expected.column }
      }
      continue
    }
    if (!columnShapeMatches(shape, expected)) return { status: 'blocked', writesAllowed: false, reason: 'exact-money-column-gate', table: expected.table, column: expected.column }
  }

  for (const expected of REQUIRED_CONFORMANCE_PRIMARY_KEYS) {
    const observed = snapshot.tables?.[expected.table]
    if (observed?.present !== true) return { status: 'blocked', writesAllowed: false, reason: 'missing-primary-key-table', table: expected.table }
    const idShape = getColumnShape(observed, 'id')
    if (!columnShapeMatches(idShape, { column: 'id', udtName: 'text', nullable: false, defaultValue: null })) {
      return { status: 'blocked', writesAllowed: false, reason: 'primary-key-column-gate', table: expected.table }
    }
    const aggregate = snapshot.idAggregates?.[expected.table]
    if (!aggregate || Number(aggregate.nullCount) !== 0 || Number(aggregate.duplicateCount) !== 0 || Number(aggregate.rowCount) !== Number(snapshot.rowCounts?.[expected.table] ?? aggregate.rowCount)) {
      return { status: 'blocked', writesAllowed: false, reason: 'primary-key-data-gate', table: expected.table }
    }
    const primaryKey = snapshot.primaryKeys?.[expected.table] ?? (observed.primaryKey ? ['id'] : [])
    if (primaryKey.length > 0 && !sameOrderedMembers(primaryKey, expected.columns)) {
      return { status: 'blocked', writesAllowed: false, reason: 'primary-key-compatibility-gate', table: expected.table }
    }
  }

  for (const expected of REQUIRED_LIVE_SCHEMA_REPAIR_INDEXES) {
    const exact = (snapshot.indexes ?? []).some((observed) => indexContractMatches(observed, expected))
    if (exact) continue
    const canonical = (snapshot.indexes ?? []).find((observed) => observed?.name === expected.name)
    if (canonical && canonical.table !== expected.table) return { status: 'blocked', writesAllowed: false, reason: 'index-name-collision-gate', index: expected.name }
    const aliasOccupied = expected.legacyAlias && (snapshot.indexes ?? []).some((observed) => observed?.name === expected.legacyAlias)
    if (aliasOccupied) return { status: 'blocked', writesAllowed: false, reason: 'index-alias-collision-gate', index: expected.name, alias: expected.legacyAlias }
  }

  if (markerLineage.conformance === 1) return { status: 'ready', writesAllowed: true, alreadyApplied: true, reason: 'conformance-repair-already-applied', markerLineage }
  return { status: 'ready', writesAllowed: true, alreadyApplied: false, reason: 'conformance-preflight-passed', markerLineage }
}

export function verifyLiveSchemaSnapshot(snapshot = {}) {
  const missingTables = REQUIRED_LIVE_SCHEMA_TABLE_ENTRIES.filter((table) => snapshot.tables?.[table]?.present !== true)
  const missingMoney = []
  const incorrectMoney = []
  for (const expected of REQUIRED_CONFORMANCE_MONEY_COLUMNS) {
    const observed = snapshot.tables?.[expected.table]
    const shape = getColumnShape(observed, expected.column)
    if (observed?.present !== true || !(observed.columns ?? []).includes(expected.column)) missingMoney.push(`${expected.table}.${expected.column}`)
    else if (!columnShapeMatches(shape, expected)) incorrectMoney.push(`${expected.table}.${expected.column}`)
  }

  const missingPrimaryKeys = REQUIRED_CONFORMANCE_PRIMARY_KEYS
    .filter((expected) => !sameOrderedMembers(snapshot.primaryKeys?.[expected.table], expected.columns))
    .map(({ table }) => table)
  const missingIndexes = REQUIRED_LIVE_SCHEMA_REPAIR_INDEXES
    .filter((expected) => !(snapshot.indexes ?? []).some((observed) => indexContractMatches(observed, expected)))
    .map(({ name }) => name)
  const missingConstraints = REQUIRED_POS_REPAIR_CONSTRAINTS
    .filter((expected) => !(snapshot.constraints ?? []).some((observed) => constraintContractMatches(observed, expected)))
    .map(({ name }) => name)
  const markerLineage = getConformanceMarkerLineage(snapshot.ledger)
  const rowValuesRead = Number(snapshot.rowValuesRead ?? 0)
  const runtimeActivity = {
    seedInvocations: Number(snapshot.runtimeActivity?.seedInvocations ?? 0),
    providerCalls: Number(snapshot.runtimeActivity?.providerCalls ?? 0),
    posInvocations: Number(snapshot.runtimeActivity?.posInvocations ?? 0),
  }
  const passed = missingTables.length === 0
    && missingMoney.length === 0
    && incorrectMoney.length === 0
    && missingPrimaryKeys.length === 0
    && missingIndexes.length === 0
    && missingConstraints.length === 0
    && markerLineage.launch === 1
    && markerLineage.pos === 1
    && markerLineage.conformance === 1
    && markerLineage.historicalAdditiveRepair === 0
    && rowValuesRead === 0
    && Object.values(runtimeActivity).every((value) => value === 0)

  return {
    status: passed ? 'passed' : 'blocked',
    tableCheck: { expected: REQUIRED_LIVE_SCHEMA_TABLE_ENTRIES.length, present: REQUIRED_LIVE_SCHEMA_TABLE_ENTRIES.length - missingTables.length, missing: missingTables },
    moneyCheck: { expected: REQUIRED_CONFORMANCE_MONEY_COLUMNS.length, present: REQUIRED_CONFORMANCE_MONEY_COLUMNS.length - missingMoney.length - incorrectMoney.length, missing: missingMoney, incorrect: incorrectMoney },
    primaryKeyCheck: { expected: REQUIRED_CONFORMANCE_PRIMARY_KEYS.length, present: REQUIRED_CONFORMANCE_PRIMARY_KEYS.length - missingPrimaryKeys.length, missing: missingPrimaryKeys },
    indexCheck: { expected: REQUIRED_LIVE_SCHEMA_REPAIR_INDEXES.length, present: REQUIRED_LIVE_SCHEMA_REPAIR_INDEXES.length - missingIndexes.length, missing: missingIndexes },
    constraintCheck: { expected: REQUIRED_POS_REPAIR_CONSTRAINTS.length, present: REQUIRED_POS_REPAIR_CONSTRAINTS.length - missingConstraints.length, missing: missingConstraints },
    markerLineage,
    historicalMarkerIntentionallyAbsent: markerLineage.historicalAdditiveRepair === 0,
    rowValuesRead,
    runtimeActivity,
    liveConformance: passed,
    noGo: !passed,
  }
}

export function verifySchemaSnapshot(snapshot = {}, { markerName } = {}) {
  if (isPhysicalSpanishSnapshot(snapshot)) {
    return {
      status: 'blocked',
      reason: 'physical-spanish-schema-not-supported-by-additive-repair',
      requiredTableCount: 0,
      presentTableCount: 0,
      missingTables: [],
      mismatchedTables: [],
      fixtureReady: false,
      repairMarkerCount: Number(snapshot.ledger?.repairMarkerCount ?? 0),
    }
  }
  if (markerName === LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME) return verifyLiveSchemaSnapshot(snapshot)
  const launchSnapshot = Object.keys(snapshot.tables ?? {}).some((table) => table !== 'TusHardeningFixture' && !REQUIRED_POS_TABLES.includes(table))
  const requiredTables = launchSnapshot ? REQUIRED_LAUNCH_TABLES : REQUIRED_POS_TABLES
  const missingTables = requiredTables.filter((table) => snapshot.tables?.[table]?.present !== true)
  const mismatchedTables = requiredTables.filter((table) => {
    const observed = snapshot.tables?.[table]
    const expectedColumns = launchSnapshot ? (REQUIRED_LAUNCH_SCHEMA_COLUMNS[table] ?? REQUIRED_SCHEMA_COLUMNS[table] ?? []) : REQUIRED_SCHEMA_COLUMNS[table]
    const columnsMatch = launchSnapshot ? includesMembers(observed?.columns, expectedColumns) : sameMembers(observed?.columns, expectedColumns)
    return observed?.present === true && (!columnsMatch || observed.primaryKey !== true || observed.requiredIndexes !== true || observed.requiredConstraints !== true)
  })
  const fixture = snapshot.tables?.TusHardeningFixture
  const fixtureReady = fixture?.present === true && sameMembers(fixture.columns, ['id', 'tag', 'version', 'runId', 'tenantId', 'actorId', 'productListingId', 'serviceListingId', 'createdAt', 'updatedAt']) && fixture.primaryKey === true
  const markerCount = Number(markerName
    ? snapshot.ledger?.markerCounts?.[markerName] ?? 0
    : snapshot.ledger?.repairMarkerCount ?? 0)
  const missingIndexes = Array.isArray(snapshot.indexes)
    ? REQUIRED_POS_REPAIR_INDEXES.filter((expected) => !snapshot.indexes.some((observed) => indexContractMatches(observed, expected))).map((expected) => expected.name)
    : []
  const missingConstraints = Array.isArray(snapshot.constraints)
    ? REQUIRED_POS_REPAIR_CONSTRAINTS.filter((expected) => !snapshot.constraints.some((observed) => constraintContractMatches(observed, expected))).map((expected) => expected.name)
    : []
  const repairCatalogReady = missingIndexes.length === 0 && missingConstraints.length === 0
  return {
    status: missingTables.length === 0 && mismatchedTables.length === 0 && fixtureReady && markerCount === 1 && validateMoneyTypes(snapshot) && repairCatalogReady ? 'passed' : 'blocked',
    requiredTableCount: requiredTables.length,
    presentTableCount: requiredTables.length - missingTables.length,
    missingTables,
    mismatchedTables,
    fixtureReady,
    repairMarkerCount: markerCount,
    missingIndexes,
    missingConstraints,
  }
}

export function createLedgerMarker(checksum, migrationName = REPAIR_MIGRATION_NAME) {
  return {
    id: migrationName === REPAIR_MIGRATION_NAME ? 'tus-additive-repair-marker' : `${migrationName}-marker`,
    checksum: String(checksum ?? ''),
    migration_name: migrationName,
    logs: null,
    rolled_back_at: null,
    started_at: 'CURRENT_TIMESTAMP',
    finished_at: 'CURRENT_TIMESTAMP',
    applied_steps_count: 1,
  }
}

export async function withBoundedRetry(operation, { attemptTimeoutMs = CONNECTION_TIMEOUT_MS, backoffMs = 0, sleep = defaultSleep, onAttemptFailure = async () => undefined } = {}) {
  if (typeof operation !== 'function') throw new TypeError('bounded operation is required')
  const timeoutMs = Math.min(Math.max(Number(attemptTimeoutMs) || CONNECTION_TIMEOUT_MS, 1), CONNECTION_TIMEOUT_MS)
  const diagnostics = []
  let lastError
  for (let attempt = 1; attempt <= RETRY_COUNT + 1; attempt += 1) {
    try {
      const value = await withTimeout(Promise.resolve().then(() => operation({ attempt, timeoutMs })), timeoutMs)
      diagnostics.push({ attempt, timeoutMs, status: 'passed' })
      return { value, diagnostics }
    } catch (error) {
      lastError = error
      diagnostics.push({ attempt, timeoutMs, status: 'failed' })
      await Promise.resolve(onAttemptFailure({ attempt, timeoutMs })).catch(() => undefined)
      if (attempt <= RETRY_COUNT) await sleep(Math.min(Math.max(Number(backoffMs) || 0, 0), 1_000))
    }
  }
  const error = new Error('bounded operation failed after two attempts; diagnostics redacted')
  error.name = 'BoundedRetryError'
  error.attempts = diagnostics.length
  error.diagnostics = diagnostics
  error.cause = lastError ? 'redacted' : undefined
  throw error
}

export async function runRepair({
  rootDirectory = ROOT_DIRECTORY,
  environment = process.env,
  confirmed = false,
  backupId,
  restoreProofPath,
  repairUnit = 'launch-baseline',
  selectedMigrationSql,
  operations = {},
} = {}) {
  const isLiveSchemaConformanceRepair = repairUnit === REPAIR_UNIT.LIVE_SCHEMA_CONFORMANCE
  const isPosIndexConstraintRepair = repairUnit === 'pos-index-constraint'
  const selectedMigrationName = isLiveSchemaConformanceRepair
    ? LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME
    : isPosIndexConstraintRepair ? POS_INDEX_CONSTRAINT_REPAIR_NAME : LAUNCH_MIGRATION_NAME
  const selectedMigrationPath = isLiveSchemaConformanceRepair
    ? LIVE_SCHEMA_CONFORMANCE_REPAIR_PATH
    : isPosIndexConstraintRepair ? POS_INDEX_CONSTRAINT_REPAIR_PATH : LAUNCH_MIGRATION_PATH
  const configuredMigrations = join(rootDirectory, 'apps', 'api', 'prisma', 'migrations')
  const inventory = await inventoryMigrations({ migrationsDirectory: existsSync(configuredMigrations) ? configuredMigrations : join(ROOT_DIRECTORY, 'apps', 'api', 'prisma', 'migrations') })
  const migrationRoot = existsSync(join(rootDirectory, selectedMigrationPath)) ? rootDirectory : ROOT_DIRECTORY
  const migrationSql = selectedMigrationSql ?? await readFile(join(migrationRoot, selectedMigrationPath), 'utf8')
  const staticGate = gateInventory({ statements: splitSqlStatements(migrationSql) })
  const exactMoneyGate = validateExactMoneySql(migrationSql)
  const sideEffects = { connections: 0, writes: 0, deletes: 0, migrationInvocations: 0, providerCalls: 0 }
  const base = { inventory, staticGate, exactMoneyGate, sideEffects, connectionAttempts: [], cleanupState: 'not-started' }
  if (staticGate.status !== 'passed') return { ...base, status: 'blocked', safetyGate: 'static-sql-gate', reason: staticGate.reason }
  if (exactMoneyGate.status !== 'passed') return { ...base, status: 'blocked', safetyGate: 'exact-money-sql-gate', reason: exactMoneyGate.reason }

  const target = resolveRepairTarget({ rootDirectory, environment, confirmed })
  if (target.status !== 'ready') return { ...base, status: 'blocked', safetyGate: 'target-gate', reason: target.reason, target: redactTarget(target) }
  const backup = validateBackupHandle(backupId)
  if (backup.status !== 'ready') return { ...base, status: 'blocked', safetyGate: 'backup-gate', reason: backup.reason, target: redactTarget(target), backup }

  const defaultBackupOperations = createDefaultBackupOperations({
    restoreProofPath,
    scratchRootUrl: readRootEnvironment(rootDirectory).DATABASE_URL,
  })
  const runtime = {
    connect: defaultConnect,
    inspect: defaultInspect,
    applyBaseline: defaultApplyBaseline,
    recordLedger: async () => undefined,
    verifySchema: async (pool) => verifySchemaSnapshot(await runtime.inspect(pool, { readOnly: true }), { markerName: selectedMigrationName }),
    verifyDurablePos: async () => ({ status: 'external-blocked', providerCalls: 0, reason: 'runtime-harness-prohibited-in-this-phase' }),
    close: defaultClose,
    ...operations,
    backup: { ...defaultBackupOperations, ...(operations.backup ?? {}) },
  }
  let pool
  let resultToReturn
  let preflight
  let migrationResult = { status: 'not-started', appliedCount: 0 }
  let schemaVerification = { status: 'not-started' }
  let posVerification = { status: 'not-started', providerCalls: 0 }
  try {
    await verifyRestorableBackup({ backupId, operations: runtime.backup })
    const connection = await withBoundedRetry(
      async ({ attempt, timeoutMs }) => {
        sideEffects.connections += 1
        return runtime.connect(readRootEnvironment(rootDirectory).DATABASE_URL, timeoutMs, attempt)
      },
      { onAttemptFailure: async () => undefined },
    )
    pool = connection.value
    base.connectionAttempts = connection.diagnostics
    const snapshot = await runtime.inspect(pool)
    if (isPhysicalSpanishSnapshot(snapshot)) {
      resultToReturn = buildRunResult(base, {
        status: 'blocked',
        safetyGate: 'phase-gate',
        reason: 'physical-spanish-schema-not-supported-by-additive-repair',
        target: redactTarget(target),
        backup,
        rollback: { status: 'not-started', metadataOnly: true },
      })
      return resultToReturn
    }
    preflight = isLiveSchemaConformanceRepair
      ? validateConformancePreflight(snapshot)
      : isPosIndexConstraintRepair
        ? validatePosIndexConstraintRepairPreflight(snapshot)
        : validatePreflight(snapshot)
    if (preflight.status !== 'ready') {
      resultToReturn = buildRunResult(base, { status: 'blocked', safetyGate: 'preflight-gate', reason: preflight.reason, target: redactTarget(target), backup, preflight })
      return resultToReturn
    }
    if (preflight.alreadyApplied) {
      migrationResult = { status: 'idempotent', appliedCount: 0, idempotent: true, marker: selectedMigrationName }
    } else {
      sideEffects.writes += 1
      sideEffects.migrationInvocations += 1
      await runtime.applyBaseline(pool, migrationSql)
      if (!isLiveSchemaConformanceRepair) {
        await runtime.recordLedger(pool, createLedgerMarker(
          isPosIndexConstraintRepair ? 'pos-index-constraint-repair-checksum' : 'launch-migration-checksum',
          selectedMigrationName,
        ))
      }
      migrationResult = { status: 'passed', appliedCount: 1, marker: selectedMigrationName }
    }
    schemaVerification = await runtime.verifySchema(pool)
    if (schemaVerification.status !== 'passed') {
      resultToReturn = buildRunResult(base, { status: 'blocked', safetyGate: 'schema-verification', reason: 'schema-verification-failed', target: redactTarget(target), backup, preflight, migrationResult, schemaVerification })
      return resultToReturn
    }
    posVerification = await runtime.verifyDurablePos()
    resultToReturn = buildRunResult(base, {
      status: isLiveSchemaConformanceRepair
        ? schemaVerification.liveConformance ? 'success' : 'blocked'
        : posVerification.status === 'passed' ? 'success' : 'partial',
      safetyGate: 'passed',
      target: redactTarget(target),
      backup,
      preflight,
      migrationResult,
      schemaVerification,
      posVerification,
    })
    return resultToReturn
  } catch (error) {
    const errorReason = sanitizeBackupErrorReason(error)
    const sqlstate = sanitizeSqlState(error?.code ?? error?.sqlstate)
    if (!pool && errorReason) base.cleanupState = 'verified'
    resultToReturn = buildRunResult(base, {
      status: 'blocked',
      safetyGate: errorReason ? 'backup-gate' : 'runtime-gate',
      reason: errorReason ?? (error?.name === 'BoundedRetryError' ? 'connection-retry-exhausted' : 'repair-operation-failed-restore-required'),
      target: redactTarget(target),
      backup,
      preflight,
      migrationResult,
      schemaVerification,
      rollback: { status: 'restore-required', metadataOnly: true, sqlstate },
      sqlstate,
    })
    return resultToReturn
  } finally {
    if (pool) {
      await Promise.resolve(runtime.close(pool)).catch(() => undefined)
      base.cleanupState = 'verified'
      if (resultToReturn) resultToReturn.cleanupState = 'verified'
    }
  }
}

function readRootEnvironment(rootDirectory) {
  const path = join(rootDirectory, '.env')
  if (!existsSync(path)) return {}
  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u)
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2').trim()
  }
  return values
}

function parsePostgresUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:' ? parsed : null
  } catch {
    return null
  }
}

function isProductionProfile(environment, rootEnvironment) {
  return [environment.NODE_ENV, environment.FACTORY_PROFILE, rootEnvironment.NODE_ENV, rootEnvironment.FACTORY_PROFILE]
    .filter(Boolean)
    .some((value) => /^(?:prod|production|render|aws|staging|stage)$/iu.test(value))
}

function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

function isSharedHost(hostname) {
  return /(?:^|[-_.])(?:prod|production|shared|staging|stage)(?:[-_.]|$)/iu.test(hostname)
}

function isExplicitlySafeAdditive(sql) {
  const executable = stripSqlComments(sql).trim()
  return /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/iu.test(executable)
    || /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/iu.test(executable)
    || /^ALTER\s+TABLE[\s\S]*\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/iu.test(executable)
    || /^DO\s+\$\$[\s\S]*\b(?:ALTER\s+TABLE[\s\S]*\bADD\s+(?:COLUMN|CONSTRAINT)|ALTER\s+INDEX[\s\S]*\bRENAME\s+TO\b|CREATE\s+(?:UNIQUE\s+)?INDEX)\b/iu.test(executable)
    || /^DO\s+\$\$[\s\S]*tus-live-schema-conformance-/iu.test(executable)
    || (/INSERT\s+INTO\s+"_prisma_migrations"/iu.test(executable)
      && new RegExp(`(?:${REPAIR_MIGRATION_NAME}|${LAUNCH_MIGRATION_NAME}|${POS_INDEX_CONSTRAINT_REPAIR_NAME}|${LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME})`, 'u').test(executable))
}

function sameMembers(left = [], right = []) {
  return Array.isArray(left) && left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index])
}

function sanitizeSqlState(value) {
  return /^[0-9A-Z]{5}$/u.test(String(value ?? '')) ? String(value) : null
}

function sanitizeBackupErrorReason(error) {
  const message = String(error?.message ?? '')
  const reasons = [
    'backup-tooling-unavailable',
    'backup-restore-verification-required',
    'backup-handle-invalid',
    'backup-file-unavailable',
    'backup-file-empty',
    'backup-archive-list-verification-failed',
    'backup-restore-proof-required',
    'backup-restore-proof-invalid',
    'backup-restore-proof-backup-mismatch',
    'backup-restore-proof-mode-mismatch',
    'backup-restore-proof-incomplete',
    'backup-restore-proof-scratch-required',
    'backup-restore-proof-scratch-mismatch',
    'isolated-restore-timeout',
    'isolated-restore-failed',
    'restore-proof-path-required',
  ]
  return reasons.find((reason) => message.includes(reason)) ?? null
}

function sameOrderedMembers(left = [], right = []) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index])
}

function getColumnShape(observed, column) {
  const explicit = observed?.columnShapes?.[column]
  if (explicit) return explicit
  const type = observed?.types?.[column] ?? observed?.columnTypes?.[column]
  if (type === undefined) return null
  return {
    udtName: type,
    nullable: observed?.nullable?.[column] === undefined ? false : observed.nullable[column],
    defaultValue: observed?.defaults?.[column] ?? null,
  }
}

function columnShapeMatches(observed, expected) {
  return Boolean(observed)
    && String(observed.udtName ?? observed.type ?? '').toLowerCase() === String(expected.udtName).toLowerCase()
    && normalizeNullable(observed.nullable) === Boolean(expected.nullable)
    && (observed.defaultValue ?? observed.default ?? null) === expected.defaultValue
}

function normalizeNullable(value) {
  return value === true || String(value).toUpperCase() === 'YES'
}

function isApprovedMissingMoneyColumn(expected) {
  return expected.table === 'TusSubscriptionPlan'
    || expected.table === 'TusBillingRefund'
    || expected.table === 'TusBillingLedger'
}

function getConformanceMarkerLineage(ledger = {}) {
  const markerCounts = ledger.markerCounts ?? {}
  return {
    launch: Number(ledger.launchMarkerCount ?? markerCounts[LAUNCH_MIGRATION_NAME] ?? 0),
    pos: Number(ledger.posIndexConstraintRepairMarkerCount ?? markerCounts[POS_INDEX_CONSTRAINT_REPAIR_NAME] ?? 0),
    conformance: Number(ledger.liveSchemaConformanceRepairMarkerCount ?? markerCounts[LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME] ?? 0),
    historicalAdditiveRepair: Number(ledger.historicalAdditiveRepairMarkerCount ?? markerCounts[REPAIR_MIGRATION_NAME] ?? 0),
  }
}

function locateExecutable(name) {
  return locateExecutablePath(name) ? '<available>' : '<unavailable>'
}

function locateExecutablePath(name) {
  const pathEntries = String(process.env.PATH ?? process.env.Path ?? '')
    .split(delimiter)
    .filter(Boolean)
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']
  for (const directory of pathEntries) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${name}${suffix}`)
      if (existsSync(candidate)) return candidate
    }
  }
  if (process.platform === 'win32') {
    const result = spawnSync('where.exe', [name], { encoding: 'utf8', timeout: 1_000, windowsHide: true })
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim().split(/\r?\n/u)[0]
  }
  return null
}

function resolveBackupPath(backupId) {
  if (typeof backupId !== 'string' || backupId.trim().length === 0) return null
  if (/^(?:postgres(?:ql)?:\/\/|file:)/iu.test(backupId)) return null
  if (/password|secret|token/iu.test(backupId)) return null
  return backupId
}

function isSafeSqlIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}` + '"'
}

function includesMembers(left = [], right = []) {
  return Array.isArray(left) && right.every((value) => left.includes(value))
}

function indexContractMatches(observed, expected) {
  return observed?.table === expected.table
    && observed?.name === expected.name
    && observed?.unique === expected.unique
    && (observed?.predicate ?? null) === (expected?.predicate ?? null)
    && JSON.stringify(observed?.columns) === JSON.stringify(expected.columns)
}

function constraintContractMatches(observed, expected) {
  if (observed?.table !== expected.table || observed?.name !== expected.name || observed?.type !== expected.type) return false
  return normalizeConstraintDefinition(observed.definition) === normalizeConstraintDefinition(expected.definition)
}

function normalizeConstraintDefinition(value) {
  const compact = String(value ?? '').replaceAll('"', '').replaceAll(/\s+/gu, '').toLowerCase()
  const checkMatch = compact.match(/^check\((.*)\)$/u)
  if (!checkMatch) return compact
  return `check(${unwrapRedundantOuterParentheses(checkMatch[1])})`
}

function unwrapRedundantOuterParentheses(value) {
  let expression = value
  while (isWrappedBySingleParentheses(expression)) expression = expression.slice(1, -1)
  return expression
}

function isWrappedBySingleParentheses(value) {
  if (!value.startsWith('(') || !value.endsWith(')')) return false
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1
    if (value[index] === ')') depth -= 1
    if (depth === 0 && index < value.length - 1) return false
  }
  return depth === 0
}

function parseIndexCatalogRow(row) {
  const definition = String(row?.indexdef ?? '')
  const columnsMatch = definition.match(/\(([^()]*)\)\s*$/u)
  const columns = columnsMatch
    ? [...columnsMatch[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1])
    : []
  return {
    table: row?.table_name,
    name: row?.indexname,
    columns,
    unique: /^CREATE UNIQUE INDEX\b/iu.test(definition),
    predicate: /\sWHERE\s/iu.test(definition) ? definition.slice(definition.search(/\sWHERE\s/iu)).trim() : null,
  }
}

function validateMoneyTypes(snapshot) {
  const tables = snapshot.tables ?? {}
  let presentMoneyTable = false
  for (const [table, columns] of Object.entries(REQUIRED_MONEY_TYPES)) {
    const observed = tables[table]
    if (observed?.present !== true) continue
    presentMoneyTable = true
    const types = observed.types ?? observed.columnTypes
    if (!types || typeof types !== 'object') return false
    for (const column of columns) {
      if (!['bigint', 'int8'].includes(String(types[column]).toLowerCase())) return false
    }
  }
  const currencies = snapshot.money?.currencies ?? []
  if (currencies.some((currency) => !/^[A-Z]{3}$/u.test(String(currency)))) return false
  return presentMoneyTable ? currencies.every((currency) => String(currency) === String(currency).toUpperCase()) : true
}

function redactTarget(target) {
  const { postgresUrl: _postgresUrl, ...redacted } = target
  return redacted
}

function defaultSleep(durationMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, durationMs))
}

function withTimeout(promise, timeoutMs) {
  let timer
  const guarded = Promise.resolve(promise)
  guarded.catch(() => undefined)
  return new Promise((resolvePromise, rejectPromise) => {
    timer = setTimeout(() => rejectPromise(new Error('bounded operation timed out')), timeoutMs)
    guarded.then(
      (value) => { clearTimeout(timer); resolvePromise(value) },
      () => { clearTimeout(timer); rejectPromise(new Error('bounded operation failed')) },
    )
  })
}

async function defaultConnect(postgresUrl, timeoutMs) {
  const require = createRequire(join(ROOT_DIRECTORY, 'apps', 'api', 'package.json'))
  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: postgresUrl, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, max: 1 })
  try {
    await pool.query('SELECT 1')
    return pool
  } catch (error) {
    await pool.end().catch(() => undefined)
    throw error
  }
}

async function defaultInspect(pool, { readOnly = false } = {}) {
  const client = readOnly && typeof pool.connect === 'function' ? await pool.connect() : pool
  let transactionStarted = false
  try {
    if (client !== pool) {
      await client.query('BEGIN')
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      transactionStarted = true
    }
    const tableRows = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1', ['public'])
    const columnRows = await client.query('SELECT table_name, column_name, udt_name, is_nullable, column_default, data_type FROM information_schema.columns WHERE table_schema = $1', ['public'])
    const primaryRows = await client.query("SELECT tc.table_name, kcu.column_name, kcu.ordinal_position FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name WHERE tc.table_schema = $1 AND tc.constraint_type = 'PRIMARY KEY' ORDER BY tc.table_name, kcu.ordinal_position", ['public'])
    const indexRows = await client.query('SELECT tablename AS table_name, indexname, indexdef FROM pg_indexes WHERE schemaname = $1', ['public'])
    const constraintRows = await client.query("SELECT c.relname AS table_name, con.conname AS constraint_name, con.contype, pg_get_constraintdef(con.oid, true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1", ['public'])
    const ledgerRows = await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE migration_name IN ($1, $2, $3, $4)', [REPAIR_MIGRATION_NAME, LAUNCH_MIGRATION_NAME, POS_INDEX_CONSTRAINT_REPAIR_NAME, LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME]).catch(() => ({ rows: [] }))
    const schemaColumns = { ...REQUIRED_LAUNCH_SCHEMA_COLUMNS, ...REQUIRED_SCHEMA_COLUMNS }
    const allTables = [...new Set([...REQUIRED_LIVE_SCHEMA_TABLE_ENTRIES, ...REQUIRED_BILLING_PRIMARY_KEY_TABLES, 'TusHardeningFixture'])]
    const primaryKeys = Object.fromEntries([...new Set(primaryRows.rows.map((row) => row.table_name))].map((table) => [table, primaryRows.rows.filter((row) => row.table_name === table).sort((left, right) => left.ordinal_position - right.ordinal_position).map((row) => row.column_name)]))
    const tables = Object.fromEntries(allTables.map((table) => {
      const columns = columnRows.rows.filter((row) => row.table_name === table)
      return [table, {
        present: tableRows.rows.some((row) => row.table_name === table),
        columns: columns.map((row) => row.column_name),
        types: Object.fromEntries(columns.map((row) => [row.column_name, row.udt_name])),
        columnShapes: Object.fromEntries(columns.map((row) => [row.column_name, { udtName: row.udt_name, nullable: row.is_nullable === 'YES', defaultValue: row.column_default }])),
        primaryKey: primaryKeys[table]?.length > 0,
        requiredIndexes: (REQUIRED_SCHEMA_INDEXES[table] ?? []).every((index) => indexRows.rows.some((row) => row.table_name === table && row.indexname === index))
          && REQUIRED_POS_REPAIR_INDEXES.filter((index) => index.table === table).every((expected) => indexRows.rows.some((row) => row.table_name === table && indexContractMatches(parseIndexCatalogRow(row), expected))),
        requiredConstraints: (REQUIRED_CONSTRAINTS[table] ?? []).every((constraint) => constraintRows.rows.some((row) => row.table_name === table && row.constraint_name === constraint)),
        indexes: indexRows.rows.filter((row) => row.table_name === table).map(parseIndexCatalogRow),
        constraints: constraintRows.rows.filter((row) => row.table_name === table).map((row) => ({ table: row.table_name, name: row.constraint_name, type: row.contype, definition: row.definition })),
        expectedColumns: schemaColumns[table] ?? [],
      }]
    }))
    const ledgerNames = ledgerRows.rows.map((row) => row.migration_name)
    const markerCounts = Object.fromEntries([REPAIR_MIGRATION_NAME, LAUNCH_MIGRATION_NAME, POS_INDEX_CONSTRAINT_REPAIR_NAME, LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME].map((name) => [name, ledgerNames.filter((value) => value === name).length]))
    return {
      physicalSpanish: tableRows.rows.some((row) => row.table_name === 'prestadores'),
      tables,
      indexes: Object.values(tables).flatMap((table) => table.indexes ?? []),
      constraints: Object.values(tables).flatMap((table) => table.constraints ?? []),
      primaryKeys,
      rowCounts: await readRowCounts(client, allTables),
      idAggregates: await readIdAggregates(client, REQUIRED_CONFORMANCE_PRIMARY_KEYS.map(({ table }) => table)),
      orphans: await readOrphanCount(client),
      rowValuesRead: 0,
      ledger: {
        present: tableRows.rows.some((row) => row.table_name === '_prisma_migrations'),
        names: ledgerNames,
        markerCounts,
        repairMarkerCount: ledgerNames.filter((name) => name === REPAIR_MIGRATION_NAME || name === LAUNCH_MIGRATION_NAME).length,
        launchMarkerCount: markerCounts[LAUNCH_MIGRATION_NAME],
        posIndexConstraintRepairMarkerCount: markerCounts[POS_INDEX_CONSTRAINT_REPAIR_NAME],
        liveSchemaConformanceRepairMarkerCount: markerCounts[LIVE_SCHEMA_CONFORMANCE_REPAIR_NAME],
        historicalAdditiveRepairMarkerCount: markerCounts[REPAIR_MIGRATION_NAME],
      },
    }
  } finally {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined)
    if (client !== pool) client.release?.()
  }
}

function isPhysicalSpanishSnapshot(snapshot = {}) {
  if (snapshot.physicalSpanish === true) return true
  const tables = snapshot.tables ?? {}
  return tables.prestadores?.present === true && tables.TusMerchant?.present !== true
}

async function readRowCounts(pool, tables) {
  const counts = {}
  for (const table of tables) {
    counts[table] = await pool.query(`SELECT COUNT(*)::int AS count FROM "${table}"`).then((result) => Number(result.rows[0]?.count ?? 0)).catch(() => 0)
  }
  return counts
}

async function readIdAggregates(pool, tables) {
  const aggregates = {}
  for (const table of tables) {
    aggregates[table] = await pool.query(`SELECT COUNT(*)::int AS row_count, COUNT("id")::int AS non_null_count, (COUNT(*) - COUNT(DISTINCT "id"))::int AS duplicate_count FROM "${table}"`).then((result) => {
      const row = result.rows[0] ?? {}
      return {
        rowCount: Number(row.row_count ?? 0),
        nullCount: Number(row.row_count ?? 0) - Number(row.non_null_count ?? 0),
        duplicateCount: Number(row.duplicate_count ?? 0),
      }
    }).catch(() => null)
  }
  return aggregates
}

async function readOrphanCount(pool) {
  const checks = [
    ['TusDeliveryShift', 'TusDeliveryZone', 'zoneId', 'zoneId'],
    ['TusDeliveryTask', 'TusDeliveryShift', 'shiftId', 'shiftId'],
    ['TusDeliveryProof', 'TusDeliveryTask', 'taskId', 'taskId'],
    ['TusDeliveryIncident', 'TusDeliveryTask', 'taskId', 'taskId'],
    ['TusPosSession', 'TusPosDevice', 'deviceId', 'deviceId'],
    ['TusPosReceipt', 'TusPosOperation', 'operationId', 'operationId'],
    ['TusPosConflict', 'TusPosOperation', 'operationId', 'operationId'],
  ]
  let total = 0
  for (const [child, parent, childKey, parentKey] of checks) {
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM "${child}" child WHERE NOT EXISTS (SELECT 1 FROM "${parent}" parent WHERE parent."tenantId" = child."tenantId" AND parent."${parentKey}" = child."${childKey}")`).then((result) => Number(result.rows[0]?.count ?? 0)).catch(() => 0)
    total += count
  }
  return total
}

async function defaultApplyBaseline(pool, sql) {
  await pool.query('BEGIN')
  try {
    await pool.query(sql)
    await pool.query('COMMIT')
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function defaultClose(pool) {
  await pool.end?.()
}

function buildRunResult(base, result) {
  return { ...base, ...result, sideEffects: base.sideEffects, cleanupState: base.cleanupState }
}
