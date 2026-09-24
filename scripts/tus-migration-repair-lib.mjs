import { readFile, readdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONNECTION_TIMEOUT_MS = 60_000
export const RETRY_COUNT = 1
export const REPAIR_MIGRATION_NAME = '20260831180000_tus_additive_migration_repair'
export const LAUNCH_MIGRATION_NAME = '20260909090000_tus_argentina_market_launch'
export const PHYSICAL_SPANISH_MIGRATION_NAME = '20260914180000_tus_physical_spanish'
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
    && new RegExp(`(?:${REPAIR_MIGRATION_NAME}|${LAUNCH_MIGRATION_NAME})`, 'u').test(executable)) return 'additive'
  if (/\b(?:_prisma_migrations|migration_name|finished_at|rolled_back_at)\b/iu.test(executable)
    && !/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"_prisma_migrations"/iu.test(executable)
    && !new RegExp(`(?:${REPAIR_MIGRATION_NAME}|${LAUNCH_MIGRATION_NAME})`, 'u').test(executable)) return 'ambiguous'
  if (MUTATING_PATTERN.test(executable)) return 'ambiguous'
  if (/^CREATE\s+TABLE\b/iu.test(executable)) return 'additive'
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/iu.test(executable)) return 'additive'
  if (/^ALTER\s+TABLE[\s\S]*\bADD\s+(?:COLUMN|CONSTRAINT)\b/iu.test(executable)) return 'additive'
  if (/^DO\s+\$\$[\s\S]*\bALTER\s+TABLE\b[\s\S]*\bADD\s+CONSTRAINT\b/iu.test(executable)) return 'additive'
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

export async function inventoryMigrations({ migrationsDirectory, repairMigrationName = REPAIR_MIGRATION_NAME, repairMigrationNames } = {}) {
  const directory = migrationsDirectory ?? join(ROOT_DIRECTORY, 'apps', 'api', 'prisma', 'migrations')
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))
  const migrations = []
  const nonHistoricalNames = new Set(repairMigrationNames ?? [repairMigrationName, LAUNCH_MIGRATION_NAME, PHYSICAL_SPANISH_MIGRATION_NAME])
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
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--confirm-development-target') {
      confirmed = true
    } else if (argument === '--backup-id' && args[index + 1] && !args[index + 1].startsWith('-')) {
      backupId = args[index + 1]
      index += 1
    } else {
      invalidArguments.push(argument)
    }
  }
  return { intent, confirmed, backupId, invalidArguments }
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

export function verifySchemaSnapshot(snapshot = {}) {
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
  const markerCount = Number(snapshot.ledger?.repairMarkerCount ?? 0)
  return {
    status: missingTables.length === 0 && mismatchedTables.length === 0 && fixtureReady && markerCount === 1 && validateMoneyTypes(snapshot) ? 'passed' : 'blocked',
    requiredTableCount: requiredTables.length,
    presentTableCount: requiredTables.length - missingTables.length,
    missingTables,
    mismatchedTables,
    fixtureReady,
    repairMarkerCount: markerCount,
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
  selectedMigrationSql,
  operations = {},
} = {}) {
  const configuredMigrations = join(rootDirectory, 'apps', 'api', 'prisma', 'migrations')
  const inventory = await inventoryMigrations({ migrationsDirectory: existsSync(configuredMigrations) ? configuredMigrations : join(ROOT_DIRECTORY, 'apps', 'api', 'prisma', 'migrations') })
  const migrationRoot = existsSync(join(rootDirectory, LAUNCH_MIGRATION_PATH)) ? rootDirectory : ROOT_DIRECTORY
  const migrationSql = selectedMigrationSql ?? await readFile(join(migrationRoot, LAUNCH_MIGRATION_PATH), 'utf8')
  const staticGate = gateInventory({ statements: splitSqlStatements(migrationSql) })
  const sideEffects = { connections: 0, writes: 0, deletes: 0, migrationInvocations: 0, providerCalls: 0 }
  const base = { inventory, staticGate, sideEffects, connectionAttempts: [], cleanupState: 'not-started' }
  if (staticGate.status !== 'passed') return { ...base, status: 'blocked', safetyGate: 'static-sql-gate', reason: staticGate.reason }

  const target = resolveRepairTarget({ rootDirectory, environment, confirmed })
  if (target.status !== 'ready') return { ...base, status: 'blocked', safetyGate: 'target-gate', reason: target.reason, target: redactTarget(target) }
  const backup = validateBackupHandle(backupId)
  if (backup.status !== 'ready') return { ...base, status: 'blocked', safetyGate: 'backup-gate', reason: backup.reason, target: redactTarget(target), backup }

  const runtime = {
    connect: defaultConnect,
    inspect: defaultInspect,
    applyBaseline: defaultApplyBaseline,
    recordLedger: async () => undefined,
    verifySchema: async (pool) => verifySchemaSnapshot(await runtime.inspect(pool)),
    verifyDurablePos: async () => ({ status: 'external-blocked', providerCalls: 0, reason: 'runtime-harness-prohibited-in-this-phase' }),
    close: defaultClose,
    backup: {
      assertRestorable: async () => undefined,
      verifyRestore: async () => { throw new Error('backup verification unavailable; restorable backup is required before DDL') },
    },
    ...operations,
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
    const inspected = await runtime.inspect(pool)
    if (isPhysicalSpanishSnapshot(inspected)) {
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
    preflight = validatePreflight(inspected)
    if (preflight.status !== 'ready') {
      resultToReturn = buildRunResult(base, { status: 'blocked', safetyGate: 'preflight-gate', reason: preflight.reason, target: redactTarget(target), backup, preflight })
      return resultToReturn
    }
    sideEffects.writes += 1
    sideEffects.migrationInvocations += 1
    await runtime.applyBaseline(pool, migrationSql)
    await runtime.recordLedger(pool, createLedgerMarker('launch-migration-checksum', LAUNCH_MIGRATION_NAME))
    migrationResult = { status: 'passed', appliedCount: 1, marker: LAUNCH_MIGRATION_NAME }
    schemaVerification = await runtime.verifySchema(pool)
    if (schemaVerification.status !== 'passed') {
      resultToReturn = buildRunResult(base, { status: 'blocked', safetyGate: 'schema-verification', reason: 'schema-verification-failed', target: redactTarget(target), backup, preflight, migrationResult, schemaVerification })
      return resultToReturn
    }
    posVerification = await runtime.verifyDurablePos()
    resultToReturn = buildRunResult(base, {
      status: posVerification.status === 'passed' ? 'success' : 'partial',
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
    resultToReturn = buildRunResult(base, {
      status: 'blocked',
      safetyGate: 'runtime-gate',
      reason: error?.name === 'BoundedRetryError' ? 'connection-retry-exhausted' : 'repair-operation-failed-restore-required',
      target: redactTarget(target),
      backup,
      preflight,
      migrationResult,
      schemaVerification,
      rollback: { status: 'restore-required', metadataOnly: true },
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
    || /^DO\s+\$\$[\s\S]*\bALTER\s+TABLE\b[\s\S]*\bADD\s+CONSTRAINT\b/iu.test(executable)
    || (/INSERT\s+INTO\s+"_prisma_migrations"/iu.test(executable)
      && new RegExp(`(?:${REPAIR_MIGRATION_NAME}|${LAUNCH_MIGRATION_NAME})`, 'u').test(executable))
}

function sameMembers(left = [], right = []) {
  return Array.isArray(left) && left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index])
}

function includesMembers(left = [], right = []) {
  return Array.isArray(left) && right.every((value) => left.includes(value))
}

function validateMoneyTypes(snapshot) {
  const tables = snapshot.tables ?? {}
  for (const [table, columns] of Object.entries(REQUIRED_MONEY_TYPES)) {
    const observed = tables[table]
    if (!observed?.types && !observed?.columnTypes) continue
    const types = observed.types ?? observed.columnTypes
    for (const column of columns) {
      if (!['bigint', 'int8'].includes(String(types[column]).toLowerCase())) return false
    }
  }
  return true
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

async function defaultInspect(pool) {
  const tableRows = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1', ['public'])
  const columnRows = await pool.query('SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = $1', ['public'])
  const primaryRows = await pool.query("SELECT tc.table_name FROM information_schema.table_constraints tc WHERE tc.table_schema = $1 AND tc.constraint_type = 'PRIMARY KEY'", ['public'])
  const indexRows = await pool.query('SELECT tablename AS table_name, indexname FROM pg_indexes WHERE schemaname = $1', ['public'])
  const constraintRows = await pool.query("SELECT c.relname AS table_name, con.conname AS constraint_name FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1", ['public'])
  const ledgerRows = await pool.query('SELECT migration_name FROM "_prisma_migrations" WHERE migration_name IN ($1, $2)', [REPAIR_MIGRATION_NAME, LAUNCH_MIGRATION_NAME]).catch(() => ({ rows: [] }))
  const schemaColumns = { ...REQUIRED_LAUNCH_SCHEMA_COLUMNS, ...REQUIRED_SCHEMA_COLUMNS }
  const physicalSpanish = tableRows.rows.some((row) => row.table_name === 'prestadores')
  const allTables = [...new Set([...REQUIRED_LAUNCH_TABLES, 'TusHardeningFixture'])]
  const tables = Object.fromEntries(allTables.map((table) => [table, {
    present: tableRows.rows.some((row) => row.table_name === table),
    columns: columnRows.rows.filter((row) => row.table_name === table).map((row) => row.column_name),
    types: Object.fromEntries(columnRows.rows.filter((row) => row.table_name === table).map((row) => [row.column_name, row.udt_name])),
    primaryKey: primaryRows.rows.some((row) => row.table_name === table),
    requiredIndexes: (REQUIRED_SCHEMA_INDEXES[table] ?? []).every((index) => indexRows.rows.some((row) => row.table_name === table && row.indexname === index)),
    requiredConstraints: (REQUIRED_CONSTRAINTS[table] ?? []).every((constraint) => constraintRows.rows.some((row) => row.table_name === table && row.constraint_name === constraint)),
    expectedColumns: schemaColumns[table] ?? [],
  }]))
  return { physicalSpanish, tables, rowCounts: await readRowCounts(pool, allTables), orphans: await readOrphanCount(pool), ledger: { present: tableRows.rows.some((row) => row.table_name === '_prisma_migrations'), repairMarkerCount: ledgerRows.rows.length } }
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
