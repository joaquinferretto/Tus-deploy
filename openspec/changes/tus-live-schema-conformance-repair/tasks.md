# Tasks: TUS Live Schema Conformance Repair

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated authored lines | 1,000–1,500 (tests, repair code, SQL, runbooks) |
| Review budget | 99,999 lines |
| 400-line budget risk | Low (configured budget governs) |
| Chained PRs recommended | No |
| Delivery strategy / current slice | single-pr / PR 1 full correction |
| Chain strategy | not-applicable |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: not-applicable
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 1 / PR 1 | Full bounded repair and evidence contract | `pnpm test -- migration-repair` | Later: one confirmed root `.env` test-DB run; N/A during planning | New migration, repair-unit code, tests, and runbook edits only |

## Phase 1: RED Static and Regression Contracts

- [x] 1.1 In `tests/integration/tus/migration-repair.test.mjs`, add RED assertions for source-derived SQL: exactly three `BIGINT NOT NULL` columns (`TusSubscriptionPlan.amountMinor`, `TusBillingRefund.amountMinor`, `TusBillingLedger.amountMinor`), no default/backfill, no destructive token, historical replay, or `20260831180000_tus_additive_migration_repair` marker.
- [x] 1.2 Add RED tests for all ten `id TEXT NOT NULL`, no-default PK contracts: `TusBillingAccount`, `TusSubscriptionPlan`, `TusBillingRefund`, `TusBillingLedger`, `TusBillingIdempotency`, `TusBillingAudit`, `TusBillingOutbox`, `TusBillingDunning`, `TusBillingNumberSequence`, `TusAccountingExport`; each is `CONSTRAINT "<Table>_pkey" PRIMARY KEY ("id")`.
- [x] 1.3 Add RED fixture tests for empty-money, null/duplicate-id, incompatible-PK, alias/cross-table collision, launch/POS marker exactly-once, new-marker-absent, zero-write refusal, timeout/one-retry, and redaction/argv-only restore gates.
- [x] 1.4 Add RED receipt tests requiring 62 tables, 26 money, 68 PK, 22 indexes, 3 constraints, marker counts, `rowValuesRead=0`, `liveConformance`/NO-GO truth, and no provider/POS/seed activity.

## Phase 2: Source-Derived Correction

- [x] 2.1 Create `apps/api/prisma/migrations/20260911130000_tus_live_schema_conformance_repair/migration.sql` with only additive DDL, ten PKs, fourteen guarded renames/creates, and exact marker `20260911130000_tus_live_schema_conformance_repair`.
- [x] 2.2 Modify `scripts/tus-migration-repair-lib.mjs` with exact Prisma catalog shapes, marker/alias constants, metadata queries, and transaction receipt; modify `scripts/tus-migration-repair.mjs` to expose only the explicit unit.
- [x] 2.3 Implement these fourteen non-unique mappings; exact table, ordered columns, and alias are mandatory:

| # | Canonical name | Table / ordered columns | Unique | Alias |
|---:|---|---|---|---|
| 01 | `TusDeliveryZone_tenantId_active_idx` | `TusDeliveryZone(tenantId,active)` | false | `tus_lscr_legacy_01` |
| 02 | `TusDeliveryShift_tenantId_zoneId_status_idx` | `TusDeliveryShift(tenantId,zoneId,status)` | false | `tus_lscr_legacy_02` |
| 03 | `TusDeliveryTask_tenantId_shiftId_status_idx` | `TusDeliveryTask(tenantId,shiftId,status)` | false | `tus_lscr_legacy_03` |
| 04 | `TusDeliveryTask_tenantId_commitmentId_status_idx` | `TusDeliveryTask(tenantId,commitmentId,status)` | false | `tus_lscr_legacy_04` |
| 05 | `TusDeliveryIncident_tenantId_taskId_status_idx` | `TusDeliveryIncident(tenantId,taskId,status)` | false | `tus_lscr_legacy_05` |
| 06 | `TusPosOperation_tenantId_context_kind_idx` | `TusPosOperation(tenantId,context,kind)` | false | `tus_lscr_legacy_06` |
| 07 | `TusPosDevice_tenantId_status_idx` | `TusPosDevice(tenantId,status)` | false | `tus_lscr_legacy_07` |
| 08 | `TusPosSession_tenantId_deviceId_shiftId_status_idx` | `TusPosSession(tenantId,deviceId,shiftId,status)` | false | `tus_lscr_legacy_08` |
| 09 | `TusPosConflict_tenantId_operationId_status_idx` | `TusPosConflict(tenantId,operationId,status)` | false | `tus_lscr_legacy_09` |
| 10 | `TusPosConflict_tenantId_status_createdAt_idx` | `TusPosConflict(tenantId,status,createdAt)` | false | `tus_lscr_legacy_10` |
| 11 | `TusPosVersion_tenantId_shiftId_version_idx` | `TusPosVersion(tenantId,shiftId,version)` | false | `tus_lscr_legacy_11` |
| 12 | `TusDeliveryOutbox_tenantId_status_createdAt_idx` | `TusDeliveryOutbox(tenantId,status,createdAt)` | false | `tus_lscr_legacy_12` |
| 13 | `TusPosOutbox_tenantId_status_createdAt_idx` | `TusPosOutbox(tenantId,status,createdAt)` | false | `tus_lscr_legacy_13` |
| 14 | `TusPosOutbox_tenantId_aggregateId_status_idx` | `TusPosOutbox(tenantId,aggregateId,status)` | false | `tus_lscr_legacy_14` |

## Phase 3: Gates and Bounded Apply

- [x] 3.1 Enforce root `.env` `DATABASE_URL`, `NODE_ENV=development`, `--confirm-development-target`, a generated hash-bound schema-only isolated restore proof, and scratch metadata revalidation before connection/DDL; require launch `20260909090000_tus_argentina_market_launch` and POS `20260911120000_tus_pos_index_constraint_repair` exactly once, new marker absent, historical marker intentionally absent.
- [x] 3.2 Enforce empty counts before each money addition; aggregate `COUNT(id)=COUNT(*)=COUNT(DISTINCT id)`, exact `TEXT NOT NULL`, and absent-or-compatible PK before each PK; reject occupied aliases/cross-table collisions.
- [x] 3.3 Apply one 60-second bounded transaction, at most one cleaned retry, canonical ordered/unique index checks, and marker insert; never default, backfill, replay history, drop, rebuild, or restore over current.

## Phase 4: Acceptance and Operations

- [x] 4.1 Add metadata-only `REPEATABLE READ` acceptance and redacted receipt: 62/62 tables, 26/26 money, 68/68 PK, 22/22 indexes, 3/3 constraints, all marker counts, historical absence, `rowValuesRead=0`; incomplete proof stays `liveConformance=false`/NO-GO.
- [x] 4.2 Update `docs/runbooks/backup-restore.md`, `docs/runbooks/migration-rollback.md`, and `docs/runbooks/tus-deployment-operations.md` with isolated-restore-only rollback and evidence boundaries; durable POS evidence is permitted only after acceptance, while external/deployment/browser/provider gates remain separate and NO-GO until proven.
