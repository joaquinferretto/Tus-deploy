# TUS Live Schema Conformance Repair Specification

## Purpose

Define one bounded, forward-only correction that makes the confirmed development catalog match the Prisma contract without replaying history or asserting production readiness.

## Requirements

### Requirement: Authorized target and recoverability

The repair MUST use only the repository-root `.env` `DATABASE_URL` as its development test target, require `NODE_ENV=development` and explicit `--confirm-development-target`, and pass a verified restorable custom-format backup plus an isolated restore verification before any DDL. URLs, credentials, and restore handles MUST be redacted.

#### Scenario: Unsafe target or missing restore proof
- GIVEN an alternate URL, missing development confirmation, or unverified/non-isolated restore
- WHEN the repair is requested
- THEN it stops before connection/DDL and records redacted NO-GO evidence with zero writes

#### Scenario: Authorized target
- GIVEN the root target, explicit development confirmation, and verified isolated restore all pass
- WHEN preflight completes
- THEN the repair may enter its single bounded transaction

### Requirement: Exact additive catalog correction

The transaction MUST add only these three columns, each `BIGINT NOT NULL` with no default and no backfill: `TusSubscriptionPlan.amountMinor`, `TusBillingRefund.amountMinor`, and `TusBillingLedger.amountMinor`; all three tables MUST be empty. It MUST add `CONSTRAINT "<Table>_pkey" PRIMARY KEY ("id")` for exactly these ten `TEXT NOT NULL`, no-default `id` contracts: `TusBillingAccount`, `TusSubscriptionPlan`, `TusBillingRefund`, `TusBillingLedger`, `TusBillingIdempotency`, `TusBillingAudit`, `TusBillingOutbox`, `TusBillingDunning`, `TusBillingNumberSequence`, and `TusAccountingExport`. Each PK requires aggregate null/duplicate checks and compatible absence of an existing PK.

The complete catalog proof MUST cover exactly 62 tables, 26 money declarations, 68 PK contracts, 22 index shapes, and 3 constraints. The 26 money declarations are `TusListing.price`, `TusCommitment.amount`, `TusCommitmentCompensation.amount`, `TusMarketplaceCommitment.amount`, `TusPaymentIntent.amount`, `TusCommissionSnapshot.grossAmount/deductions/commissionableBase/commissionAmount/netAmount`, `TusLedgerEntry.amount`, `TusReconciliationRecord.providerAmount`, `TusPosOperation.amount`, `TusPosReceipt.amount`, `TusInvoice.subtotal/taxAmount/feeAmount/total`, `TusInvoiceLine.unitMinor/taxMinor/totalMinor`, `TusCreditNote.amountMinor`, `TusSubscription.amountMinor`, `TusSubscriptionPlan.amountMinor`, `TusBillingRefund.amountMinor`, and `TusBillingLedger.amountMinor`. The 22 repair indexes MUST match exact name, table, uniqueness, and ordered columns: `TusDeliveryZone_tenantId_active_idx`=`TusDeliveryZone(tenantId,active)`, `TusDeliveryShift_tenantId_zoneId_status_idx`=`TusDeliveryShift(tenantId,zoneId,status)`, `TusDeliveryTask_tenantId_commitmentId_idx`=`TusDeliveryTask(tenantId,commitmentId)`, `TusDeliveryTask_tenantId_shiftId_status_idx`=`TusDeliveryTask(tenantId,shiftId,status)`, `TusDeliveryTask_tenantId_commitmentId_status_idx`=`TusDeliveryTask(tenantId,commitmentId,status)`, `TusDeliveryProof_tenantId_taskId_idx`=`TusDeliveryProof(tenantId,taskId)`, `TusDeliveryIncident_tenantId_taskId_status_idx`=`TusDeliveryIncident(tenantId,taskId,status)`, `TusDeliveryAudit_tenantId_auditId_key`=`TusDeliveryAudit(tenantId,auditId)` unique, `TusDeliveryAudit_tenantId_createdAt_idx`=`TusDeliveryAudit(tenantId,createdAt)`, `TusPosOperation_tenantId_shiftId_createdAt_idx`=`TusPosOperation(tenantId,shiftId,createdAt)`, `TusPosOperation_tenantId_context_kind_idx`=`TusPosOperation(tenantId,context,kind)`, `TusPosReceipt_tenantId_operationId_idx`=`TusPosReceipt(tenantId,operationId)`, `TusPosReceipt_tenantId_operationId_createdAt_idx`=`TusPosReceipt(tenantId,operationId,createdAt)`, `TusPosDevice_tenantId_status_idx`=`TusPosDevice(tenantId,status)`, `TusPosSession_tenantId_deviceId_shiftId_status_idx`=`TusPosSession(tenantId,deviceId,shiftId,status)`, `TusPosConflict_tenantId_operationId_status_idx`=`TusPosConflict(tenantId,operationId,status)`, `TusPosConflict_tenantId_status_createdAt_idx`=`TusPosConflict(tenantId,status,createdAt)`, `TusPosVersion_tenantId_shiftId_version_idx`=`TusPosVersion(tenantId,shiftId,version)`, `TusDeliveryOutbox_tenantId_status_createdAt_idx`=`TusDeliveryOutbox(tenantId,status,createdAt)`, `TusPosOutbox_tenantId_status_createdAt_idx`=`TusPosOutbox(tenantId,status,createdAt)`, `TusPosOutbox_tenantId_aggregateId_status_idx`=`TusPosOutbox(tenantId,aggregateId,status)`, and `TusPosAudit_tenantId_operationId_createdAt_idx`=`TusPosAudit(tenantId,operationId,createdAt)`; only the named `_key` index is unique. The exact constraints are `TusPosConflict_tenant_operation_fk` (foreign key, `NOT VALID`), `TusPosOperation_amount_non_negative_check` (`CHECK ((amount >= 0))`), and `TusPosVersion_version_non_negative_check` (`CHECK ((version >= 0))`).

#### Scenario: Data or catalog gate fails
- GIVEN any affected money table is non-empty, an `id` is null/duplicated, an incompatible PK exists, or an alias is occupied
- WHEN preflight runs
- THEN it stops before DDL and reports the specific gate with zero writes

#### Scenario: Conforming repair
- GIVEN all gates pass
- WHEN the transaction runs
- THEN only the missing additive objects and safe index corrections are applied; no value is invented

### Requirement: Safe index replacement and lineage

For exactly these fourteen same-name incorrect indexes—`TusDeliveryZone_tenantId_active_idx`, `TusDeliveryShift_tenantId_zoneId_status_idx`, `TusDeliveryTask_tenantId_shiftId_status_idx`, `TusDeliveryTask_tenantId_commitmentId_status_idx`, `TusDeliveryIncident_tenantId_taskId_status_idx`, `TusPosOperation_tenantId_context_kind_idx`, `TusPosDevice_tenantId_status_idx`, `TusPosSession_tenantId_deviceId_shiftId_status_idx`, `TusPosConflict_tenantId_operationId_status_idx`, `TusPosConflict_tenantId_status_createdAt_idx`, `TusPosVersion_tenantId_shiftId_version_idx`, `TusDeliveryOutbox_tenantId_status_createdAt_idx`, `TusPosOutbox_tenantId_status_createdAt_idx`, and `TusPosOutbox_tenantId_aggregateId_status_idx`—the repair MUST use guarded deterministic aliases `tus_lscr_legacy_01` through `tus_lscr_legacy_14`, renaming before creating the canonical shape, and MUST NOT drop indexes/tables or replay historical migrations. Existing exact indexes and completed new work MUST be no-ops.

The ledger MUST contain launch marker `20260909090000_tus_argentina_market_launch` exactly once, POS marker `20260911120000_tus_pos_index_constraint_repair` exactly once, and new marker `20260911130000_tus_live_schema_conformance_repair` exactly once after commit. Historical marker `20260831180000_tus_additive_migration_repair` MUST remain intentionally absent.

#### Scenario: Marker or index collision
- GIVEN either prerequisite marker is not exactly once, the new marker already exists more than once, or a deterministic alias is occupied
- WHEN lineage/index preflight runs
- THEN the repair stops without writes and preserves the historical marker's intentional absence

#### Scenario: Retry after success
- GIVEN the new marker and canonical definitions already exist
- WHEN the explicit repair unit is retried
- THEN it performs no duplicate DDL or marker insert and returns an idempotent result

### Requirement: Bounded evidence and acceptance

The repair MUST use one transaction, a 60-second operation bound, and at most one retry after cleanup. Failures MUST roll back the transaction; post-commit metadata mismatch MUST require owner-approved restore into an isolated target, never restore-over-current or a down migration. Evidence MUST be redacted and report `rowValuesRead=0`; no seed, provider, POS runtime, historical replay, or migration backlog execution may occur before acceptance.

#### Scenario: Accepted metadata receipt
- GIVEN an authorized fresh read-only `REPEATABLE READ` receipt proves all exact counts/shapes, marker lineage, zero row-value reads, and no runtime activity
- WHEN acceptance evaluates it
- THEN `liveConformance=true` and launch may leave NO-GO only for this metadata gate; this is not a production-readiness claim

#### Scenario: Any incomplete proof
- GIVEN any count, shape, marker, timeout/retry, redaction, rollback, or runtime condition fails
- WHEN acceptance is finalized
- THEN `liveConformance=false`, NO-GO remains, and no production readiness is claimed
