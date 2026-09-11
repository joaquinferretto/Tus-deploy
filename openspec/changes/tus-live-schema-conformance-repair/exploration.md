# Exploration: TUS live schema conformance repair

status: success
executive_summary: The accepted metadata-only receipt proves that the development target is structurally incomplete despite having all 62 expected table entries. The smallest safe correction is a new forward-only, additive schema-conformance repair that adds only the three missing exact-money columns and ten missing primary-key constraints, reconciles the fourteen same-name index definitions without dropping data, and records a new correction marker without fabricating the missing historical marker.
artifacts:
  - `openspec/changes/tus-live-schema-conformance-repair/exploration.md`
  - `sdd/tus-live-schema-conformance-repair/explore`
next_recommended: `sdd-propose` after confirming the required backup/restore handle, target-table row-count policy, and the final timestamped migration/marker name.
risks:
  - Live schema is non-conformant; `liveConformance=false` and launch remains NO-GO.
  - Adding required `BIGINT NOT NULL` columns is unsafe when affected billing tables contain rows unless an explicitly approved exact-money backfill exists; this exploration does not authorize one.
  - Same-name indexes with wrong ordered columns cannot be repaired by `CREATE INDEX IF NOT EXISTS`; the correction must use a guarded metadata rename followed by creation of the canonical index, or stop if the rename target is occupied.
skill_resolution: paths-injected — loaded the three exact user-specified paths: `C:\Users\mmmau\.config\opencode\skills\sdd-explore\SKILL.md`, `C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md`, and `C:\Users\mmmau\.config\opencode\skills\typescript\SKILL.md`. CodeGraph was attempted first after confirming `.codegraph/`, but the upstream CLI was unavailable; targeted filesystem inspection was used as the documented fallback.

## Exploration: tus-live-schema-conformance-repair

### Current State

The repository is a hybrid OpenSpec/Engram project with a Prisma/PostgreSQL source of truth. The umbrella launch change (`tus-argentina-market-launch`) and the specific additive repair change (`tus-additive-migration-repair`) prohibit historical destructive replay, `prisma migrate deploy` for this repair path, reset, `db push`, destructive cleanup, and production claims without evidence.

The root `.env` `DATABASE_URL` is the user-confirmed development target. The launch baseline and POS index/constraint repair were already applied additively, with their current markers present. The accepted receipt was metadata-only, read zero row values, and caused zero persistent effects, but it is non-conformant:

- Tables: 62/62 expected entries present.
- Money: 23/26 exact declarations observed. Missing `TusSubscriptionPlan.amountMinor`, `TusBillingRefund.amountMinor`, and `TusBillingLedger.amountMinor`.
- Primary keys: 58/68 source-derived expectations present. Missing on `TusBillingAccount`, `TusSubscriptionPlan`, `TusBillingRefund`, `TusBillingLedger`, `TusBillingIdempotency`, `TusBillingAudit`, `TusBillingOutbox`, `TusBillingDunning`, `TusBillingNumberSequence`, and `TusAccountingExport`.
- Repair indexes: all 22 names exist, but 14 have incorrect/incomplete ordered columns. Eight are already exact.
- Constraints: 3/3 exact.
- Markers: launch and POS repair markers are present; `20260831180000_tus_additive_migration_repair` is absent.
- Overall: `liveConformance=false`; launch is NO-GO.

### Findings

#### Exact affected Prisma contract

Prisma scalar mapping used by the correction must remain exact: `String` → `TEXT NOT NULL`, `BigInt` → `BIGINT NOT NULL`, `Int` → `INTEGER NOT NULL`, `Boolean` → `BOOLEAN NOT NULL`, `DateTime` → `TIMESTAMP(3) NOT NULL`, `Json` → `JSONB NOT NULL`, nullable scalars retain SQL nullability, and only explicit Prisma defaults become SQL defaults.

| Contract | Exact expected SQL shape |
|---|---|
| `TusSubscriptionPlan.amountMinor` | `BIGINT NOT NULL`, no default; source model has `amountMinor BigInt`. |
| `TusBillingRefund.amountMinor` | `BIGINT NOT NULL`, no default; source model has `amountMinor BigInt`. |
| `TusBillingLedger.amountMinor` | `BIGINT NOT NULL`, no default; source model has `amountMinor BigInt`. |
| All ten affected `id` columns | `TEXT NOT NULL`, no default, with `CONSTRAINT "<Table>_pkey" PRIMARY KEY ("id")`. |
| `TusBillingLedger.immutable` | Existing/source contract remains `BOOLEAN NOT NULL DEFAULT TRUE`; it is not a money repair target. |
| `TusBillingIdempotency.createdAt` | Existing/source contract remains `TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`; it is not a repair target. |
| `TusBillingNumberSequence.tenantId` | Existing/source contract remains `TEXT NOT NULL UNIQUE`; its `id` primary key is separate and missing. |
| `TusAccountingExport.postedExternally` | Existing/source contract remains `BOOLEAN NOT NULL DEFAULT FALSE`; it is not a repair target. |

The ten primary-key definitions are:

```text
TusBillingAccount       -> PRIMARY KEY (id)
TusSubscriptionPlan     -> PRIMARY KEY (id)
TusBillingRefund        -> PRIMARY KEY (id)
TusBillingLedger        -> PRIMARY KEY (id)
TusBillingIdempotency   -> PRIMARY KEY (id)
TusBillingAudit         -> PRIMARY KEY (id)
TusBillingOutbox        -> PRIMARY KEY (id)
TusBillingDunning       -> PRIMARY KEY (id)
TusBillingNumberSequence -> PRIMARY KEY (id)
TusAccountingExport     -> PRIMARY KEY (id)
```

The correction must not invent a default or value for any missing money column. A `BIGINT NOT NULL` addition is safe only when the affected table is empty, or when a separately approved exact-money conversion/backfill contract exists. The latter is outside this change.

#### Exact index contract

The source contract in `REQUIRED_POS_REPAIR_INDEXES` requires exact table, name, uniqueness, and ordered columns. The fourteen non-conforming names and their canonical definitions are:

| Index | Table | Ordered columns | Unique |
|---|---|---|---:|
| `TusDeliveryZone_tenantId_active_idx` | `TusDeliveryZone` | `tenantId, active` | false |
| `TusDeliveryShift_tenantId_zoneId_status_idx` | `TusDeliveryShift` | `tenantId, zoneId, status` | false |
| `TusDeliveryTask_tenantId_shiftId_status_idx` | `TusDeliveryTask` | `tenantId, shiftId, status` | false |
| `TusDeliveryTask_tenantId_commitmentId_status_idx` | `TusDeliveryTask` | `tenantId, commitmentId, status` | false |
| `TusDeliveryIncident_tenantId_taskId_status_idx` | `TusDeliveryIncident` | `tenantId, taskId, status` | false |
| `TusPosOperation_tenantId_context_kind_idx` | `TusPosOperation` | `tenantId, context, kind` | false |
| `TusPosDevice_tenantId_status_idx` | `TusPosDevice` | `tenantId, status` | false |
| `TusPosSession_tenantId_deviceId_shiftId_status_idx` | `TusPosSession` | `tenantId, deviceId, shiftId, status` | false |
| `TusPosConflict_tenantId_operationId_status_idx` | `TusPosConflict` | `tenantId, operationId, status` | false |
| `TusPosConflict_tenantId_status_createdAt_idx` | `TusPosConflict` | `tenantId, status, createdAt` | false |
| `TusPosVersion_tenantId_shiftId_version_idx` | `TusPosVersion` | `tenantId, shiftId, version` | false |
| `TusDeliveryOutbox_tenantId_status_createdAt_idx` | `TusDeliveryOutbox` | `tenantId, status, createdAt` | false |
| `TusPosOutbox_tenantId_status_createdAt_idx` | `TusPosOutbox` | `tenantId, status, createdAt` | false |
| `TusPosOutbox_tenantId_aggregateId_status_idx` | `TusPosOutbox` | `tenantId, aggregateId, status` | false |

The eight already exact indexes are `TusDeliveryTask_tenantId_commitmentId_idx`, `TusDeliveryProof_tenantId_taskId_idx`, `TusDeliveryAudit_tenantId_auditId_key` (unique), `TusDeliveryAudit_tenantId_createdAt_idx`, `TusPosOperation_tenantId_shiftId_createdAt_idx`, `TusPosReceipt_tenantId_operationId_idx`, `TusPosReceipt_tenantId_operationId_createdAt_idx`, and `TusPosAudit_tenantId_operationId_createdAt_idx` (all other listed exact indexes are non-unique).

#### Why prior additive paths produced a partial schema

1. `CREATE TABLE IF NOT EXISTS` is table-granular. If a billing table already existed with an incomplete shape, the body of `20260909170000_tus_billing` did not add missing columns or reconcile its primary key.
2. `CREATE INDEX IF NOT EXISTS` is name-granular. The POS repair migration considered a same-name index complete even when PostgreSQL's catalog definition had the wrong order or uniqueness, so the 14 incorrect indexes remained.
3. The current default inspector originally reduced metadata to names/booleans for some checks. The new contract must compare column type, nullability, default, exact primary-key columns, ordered index columns, and uniqueness rather than only object presence.
4. The existing migration runner selected the launch/POS units and their markers, while the billing migration is a separate historical file. A partial table shape can therefore coexist with successful launch/POS markers without proving the current Prisma billing contract.
5. The migration transaction can commit before post-commit schema verification rejects the result. The existing evidence correctly preserved the marker and stopped runtime proof; it did not attempt an unsafe down migration or restore-over-current operation.

### Affected Areas

- `apps/api/prisma/schema.prisma` — source contract for billing nullability/defaults/PKs and all 22 index definitions; read-only reference, not to be edited in exploration.
- `apps/api/prisma/migrations/20260909170000_tus_billing/migration.sql` — proves the intended billing table shapes but must not be replayed as historical migration.
- `apps/api/prisma/migrations/20260911120000_tus_pos_index_constraint_repair/migration.sql` — demonstrates the `IF NOT EXISTS` same-name index limitation and is the immediate predecessor.
- `scripts/tus-migration-repair-lib.mjs` — add a distinct correction unit, exact billing column/PK contracts, catalog metadata for nullability/defaults/PK columns, index replacement safety, marker handling, and preflight gates.
- `scripts/tus-migration-repair.mjs` — expose only the explicit new correction unit through the existing fail-closed CLI; never replay historical migration files.
- `tests/integration/tus/migration-repair.test.mjs` — regression coverage for exact contracts, idempotency, index-shape repair, marker lineage, data gates, and zero-side-effect refusal.
- `docs/runbooks/tus-deployment-operations.md`, `docs/runbooks/backup-restore.md`, `docs/runbooks/migration-rollback.md` — operational constraints for root target, verified backup/restore, additive-only release, isolated restore, and truthful evidence.
- `openspec/changes/tus-argentina-market-launch/{proposal.md,design.md,tasks.md,apply-progress.md}` — umbrella intent, current NO-GO evidence, and accepted live receipt.
- `openspec/changes/tus-additive-migration-repair/{proposal.md,specs/tus-additive-migration-repair/spec.md,design.md,tasks.md,apply-progress.md}` — predecessor repair contracts and incomplete live proof.

### Approaches

1. **New forward-only conformance correction (recommended)** — Add missing billing columns/PK constraints only after exact preflight; rename conflicting same-name indexes to a deterministic legacy name and create the canonical ordered index; record one new correction marker after the existing launch/POS markers.
   - Pros: preserves rows and historical files; fixes the actual catalog definitions; idempotent; keeps tenant-leading index order; preserves exact money semantics; bounded to one transaction.
   - Cons: index rename/rebuild can acquire locks; non-empty billing tables require an explicit stop or separately approved backfill; the runner and verifier need a new contract surface.
   - Effort: Medium.

2. **Replay `20260909170000_tus_billing` or the historical backlog** — Re-run existing SQL to try to restore billing shape.
   - Pros: reuses existing DDL.
   - Cons: violates the no-historical-replay boundary; `IF NOT EXISTS` still cannot repair existing partial objects; does not solve wrong same-name indexes; makes lineage/evidence less truthful.
   - Effort: Low implementation, unacceptable safety risk.

3. **Drop/recreate indexes or rebuild affected tables** — Replace wrong catalog objects directly.
   - Pros: technically straightforward.
   - Cons: destructive/prohibited for this change; creates unnecessary lock/data risk; table rebuild risks tenant and ledger integrity.
   - Effort: Medium, rejected.

4. **Verifier-only relaxation** — Accept incomplete money/PK/index contracts or alternate definitions.
   - Pros: small code change.
   - Cons: leaves the live database incompatible with Prisma and can hide tenant/query correctness defects; cannot establish conformance.
   - Effort: Low, rejected.

### Recommendation

Proceed to proposal with a new timestamped migration/marker named for `tus-live-schema-conformance-repair`. Require the existing launch and POS repair markers as prerequisites, but do **not** create `20260831180000_tus_additive_migration_repair`: inserting it would falsely claim that a historical/additive migration ran on this target. The new marker supersedes the missing marker's operational purpose only by recording the explicit correction; it does not rewrite or reconcile historical lineage.

The migration should run as one bounded transaction and use catalog-guarded operations:

1. Verify the target is the root `.env` development target and that launch/POS markers are exactly once while the new marker is absent.
2. Require affected billing tables to be empty before adding `BIGINT NOT NULL` amount columns; if not empty, stop before DDL with an exact-money-backfill-required result.
3. Verify each affected `id` is `TEXT NOT NULL`, with no null/duplicate aggregate result and no incompatible existing PK before adding the named `*_pkey` constraint.
4. For each incorrect index, verify the catalog definition. If absent, create the canonical index. If same-name but wrong, rename it to a deterministic noncanonical legacy name only when that name is free, then create the canonical index. If already exact, do nothing. Never drop an index or table.
5. Insert exactly one new correction marker in the same transaction, then commit. A failed statement rolls back the transaction; a post-commit verification mismatch remains a restore-required blocked state.

The runner must not invent money values, use `DEFAULT 0` for missing money, rewrite rows, replay historical migrations, seed, call providers, or run POS until metadata proof passes.

### Proposed Scope

- Add one new additive-only correction migration for the three missing `amountMinor` columns, ten `id` primary keys, and fourteen exact index definitions.
- Extend the repair library with exact column metadata, primary-key column definitions, all-22 ordered index contracts, target-table emptiness/duplicate gates, index-collision handling, a distinct repair-unit/marker constant, and accurate inventory classification.
- Extend the CLI with the explicit correction unit while preserving root `.env`/development confirmation/backup/60-second-plus-one-retry/redaction boundaries.
- Add strict-TDD regression tests and a redacted metadata-only receipt contract.
- Add or update runbook/evidence instructions only if proposal/design confirms a documentation gap; do not execute them in this exploration.

### Non-goals

- No source, test, migration, database, or deployment execution in this phase.
- No replay or modification of historical migrations; no creation of the missing historical marker.
- No `DROP`, `TRUNCATE`, `CASCADE`, untagged `DELETE`, table rebuild, destructive update, or restore-over-current operation.
- No money backfill, inferred default, currency conversion, seed, POS runtime, provider call, browser/device smoke, cloud operation, or production activation.
- No claim of production readiness or live conformance before a fresh accepted receipt.

### Required Inputs

- Operator-provided restorable backup handle that passes the existing custom-format/restore verification contract and can be restored into an isolated target.
- Confirmation that the target remains the root `.env` `DATABASE_URL`, `NODE_ENV=development`, and the exact confirmation flag; no alternate URL is allowed.
- A fresh metadata preflight showing the three affected billing tables' aggregate row counts and no incompatible `id`/PK state. Non-empty affected tables require a separate exact-money policy and are not eligible for this change.
- Final timestamped migration and marker name, selected during proposal/design rather than inferred during apply.
- Acceptance that the missing `20260831180000_tus_additive_migration_repair` marker remains absent and is not reconstructed.

### Verification Plan

#### Static and regression tests

- Assert the new SQL contains no destructive tokens, no historical marker insert, no replay invocation, and passes the exact-money SQL gate.
- Assert all three missing amount columns are `BIGINT NOT NULL` with no default and that no `DEFAULT 0` or data update is generated.
- Assert all ten named PK constraints use exactly `PRIMARY KEY ("id")` and reject incompatible type/nullability, duplicate/null aggregate preflight, and pre-existing conflicting PKs.
- Assert all 22 repair index contracts by exact name, table, ordered columns, and uniqueness; include wrong-order, wrong-uniqueness, same-name collision, alias collision, absent-index, and already-exact idempotency cases.
- Assert marker prerequisites (launch and POS exactly once), new-marker idempotency, historical-marker absence, zero DB calls on unsafe gates, one transaction boundary, bounded retry behavior, redaction, and no provider calls.
- Keep finance/billing exact-money and migration-repair regression suites in the focused test set; verify typecheck/lint/build only in later phases according to OpenSpec rules.

#### Metadata-only live acceptance

After an authorized apply, run one fresh read-only `REPEATABLE READ` catalog session against only the root `.env` target. It may read aggregate counts and catalog metadata but no row values. Acceptance requires:

- 62/62 expected tables present.
- 26/26 money declarations exact, including the three billing `BIGINT NOT NULL` columns.
- 68/68 source-derived primary-key contracts present with exact `id` definitions.
- 22/22 named indexes exact in ordered columns and uniqueness.
- 3/3 constraints exact.
- Launch marker, POS repair marker, and new conformance-correction marker each present exactly once.
- Historical `20260831180000_tus_additive_migration_repair` marker remains absent and is reported as intentionally not reconstructed.
- `rowValuesRead=0`, no seed/POS/provider execution, and zero persistent effects attributable to the verification session.
- `liveConformance=true` only if every condition passes; otherwise retain `liveConformance=false` and NO-GO.

### Data Risk and Restore Requirement

This is schema correction, not a data migration. Missing required money columns cannot be populated safely from absence; adding a fabricated default would create false financial facts. Therefore a non-empty affected billing table is a hard preflight blocker, not an invitation to infer values. Primary-key addition also requires aggregate validation of null/duplicate identifiers and must stop on incompatible existing constraints. Index rename/rebuild does not rewrite rows but can lock tables and changes catalog identity, so it remains backup-gated. The only rollback authority after a committed schema mutation is an owner-approved restore into an isolated target, following the backup/restore and migration-rollback runbooks; no down migration or restore-over-current target is authorized here.

### Ready for Proposal

Yes, for a bounded proposal. The proposal must preserve the NO-GO verdict, explicitly select the final migration/marker name, define the index legacy-alias convention, and make empty affected billing tables plus verified isolated restore capability hard apply gates. No production-readiness claim is supported.
