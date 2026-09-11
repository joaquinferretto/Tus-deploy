# Apply Progress: TUS Additive Migration Repair

## Work Unit

- Change: `tus-additive-migration-repair`
- Artifact store: Hybrid (OpenSpec + Engram)
- Mode: Strict TDD
- Delivery: single PR with approved `size:exception`
- Scope: inventory, fail-closed gates, additive baseline, bounded runner, and schema/POS evidence contract
- Historical migrations: unchanged
- Current status: the narrow currency-check repair and dedicated missing-index/constraint repair path are implemented; the latest bounded repair passed backup/preflight, committed the repair marker, and stopped at metadata verification with 14 indexes and 2 constraints still missing, so runtime proof remains blocked

## Cumulative Task Status

### Phase 1: RED Contracts

- [x] 1.1 Inventory tests cover 25 pending migration entries, 19 executable destructive statements, comment-safe tokens, and zero DB calls on rejected selection.
- [x] 1.2 Target, confirmation, production/shared refusal, redaction, backup, 60-second bound, one retry, and no-third-attempt tests are present.
- [x] 1.3 Preflight, ledger, schema/index/constraint, rollback metadata, cleanup, and provider-zero contracts are present.

### Phase 2: GREEN Repair

- [x] 2.1 Added pure inventory/classification and a selected-SQL static gate. Historical files are inventory-only; destructive or ambiguous selected SQL is rejected.
- [x] 2.2 Added root `.env` target resolution, exact development confirmation, backup gate, redacted diagnostics, bounded connection retry, and fail-closed preflight.
- [x] 2.3 Added `20260831180000_tus_additive_migration_repair`, an idempotent additive baseline for the 15 required POS/delivery tables, fixture table, indexes, tenant constraints, and one repair marker.
- [x] 2.4 Added transactional apply, marker handling, schema receipt, rollback metadata, and `finally` pool cleanup. No Prisma migration command is called.
- [x] 2.5 Added the explicit `apply --confirm-development-target --backup-id <handle>` CLI with root-target-only resolution and redacted JSON.

### Phase 3: GREEN Verification / REFACTOR

- [x] 3.1 Focused RED tests pass for required table columns, primary keys, tenant uniqueness, indexes, marker identity, and POS deferral/provider-zero behavior.
- [ ] 3.2 Remote-development apply and live schema verification — blocked by missing operator-supplied restorable backup handle; no connection or write was attempted.
- [ ] 3.3 Durable POS rerun and live evidence — intentionally deferred until schema proof; API/web/mobile/browser/Docker/watchers were not started.

## Migration Inventory

```yaml
total_migration_entries: 26
pending_historical_entries: 25
executable_destructive_statements: 19
destructive_tokens: [CASCADE, DROP]
comment_only_forbidden_tokens: 6
selected_repair_sql_gate: passed
historical_files_changed: 0
```

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/integration/tus/migration-repair.test.mjs` | Unit | N/A (new) | Import/classification contract failed before library | `10/10` passed | Backlog, comments, and unsafe selected SQL | Lexer and inventory helpers are pure |
| 1.2 | `tests/integration/tus/migration-repair.test.mjs` | Unit | N/A (new) | Target/CLI/retry contracts failed before library | `10/10` passed | Root-only URL, remote confirmation, refusal, redaction, retry | Shared bounded retry and target resolver |
| 1.3 | `tests/integration/tus/migration-repair.test.mjs` | Integration contract/unit mocks | N/A (new) | Preflight/ledger/apply contracts failed before library | `10/10` passed | Shape, orphan, marker, schema, cleanup, provider-zero paths | Redacted result builders and immutable constants |
| 2.1 | `tests/integration/tus/migration-repair.test.mjs` | Unit | N/A (new) | Static gate import failed before implementation | `10/10` passed | DROP/CASCADE, comments, missing migration, safe repair SQL | Separate inventory from selected-path gate |
| 2.2 | `tests/integration/tus/migration-repair.test.mjs` | Unit | N/A (new) | Target and bounded retry contracts failed before implementation | `10/10` passed | Production/shared/missing confirmation and two failures | Root URL remains internal only |
| 2.3 | `tests/integration/tus/migration-repair.test.mjs` | Integration contract | N/A (new) | Baseline file and marker assertions failed before migration | `10/10` passed | All 15 required table declarations and replay-safe SQL | Dependency order and IF NOT EXISTS DDL |
| 2.4 | `tests/integration/tus/migration-repair.test.mjs` | Integration contract/unit mocks | N/A (new) | Apply orchestration failed before runner | `10/10` passed | Preflight block and successful additive deferral | `finally` cleanup and redacted rollback metadata |
| 2.5 | `tests/integration/tus/migration-repair.test.mjs` | Unit | N/A (new) | CLI parser contract failed before CLI | `10/10` passed | Invalid intent, unsupported URL argument, and exact confirmation | Finite standard JSON output |
| 3.1 | `tests/integration/tus/migration-repair.test.mjs` | Integration contract/unit mocks | N/A (new) | Schema snapshot contract failed before verifier | `10/10` passed | Full required-table snapshot plus fixture and marker | Aggregate schema receipt |

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/integration/tus/migration-repair.test.mjs` — exit 0; `10` passed, `0` failed, `0` skipped. |
| Runtime harness command/scenario | `NODE_ENV=development pnpm exec node scripts/tus-migration-repair.mjs apply --confirm-development-target` — exit 1; static repair SQL gate and development target gate passed, then backup gate stopped with `restorable-backup-required`; `0` connections and `0` writes. |
| Rollback boundary | Revert only `scripts/tus-migration-repair-lib.mjs`, `scripts/tus-migration-repair.mjs`, `tests/integration/tus/migration-repair.test.mjs`, and `apps/api/prisma/migrations/20260831180000_tus_additive_migration_repair/migration.sql`; historical migration files and unrelated dirty-tree work remain untouched. |
| Cleanup state | `not-started`; no pool, child process, listener, service, browser, Docker process, or watcher was created. |

## Deviations and Issues

- Live apply could not be performed because no operator-supplied restorable backup handle was provided. The runner intentionally does not invent or infer one.
- Durable POS remains deferred until schema proof and a separate bounded runtime phase. No provider calls are claimed.
- The repository contains an empty historical migration directory without `migration.sql`; it is retained as an ambiguous inventory entry and is not rewritten.

## Status

8/11 implementation tasks complete in this change. Tasks `3.2` and `3.3` remain blocked/deferred by the backup gate and the explicit no-runtime-process constraint.

## Current Authorized Remote-Development Attempt

- The preserved external custom-format backup passed nonzero-file and `pg_restore --format=custom --list` verification before DDL.
- The selected launch baseline passed the static gate: one SQL file, 124 statements, zero destructive/ambiguous/non-additive statements.
- The pinned CLI used `NODE_ENV=development`, the exact `--confirm-development-target` flag, and only root `.env` `DATABASE_URL`.
- One bounded connection succeeded and aggregate preflight stopped before DDL with `exact-money-type-mismatch`; no retry was needed and no third attempt occurred.
- Migration result is `not-started`: zero DDL, zero DML, zero historical migration invocations, zero ledger mutations, and zero provider calls. Schema verification and durable POS are deferred.
- Cleanup is verified: the pool closed; no API, POS, provider, browser, mobile, Docker, deployment, or worker runtime was started.
- Task `3.2` remains unchecked because the target-specific preflight gate failed. Task `3.3` remains unchecked because schema proof did not run and the explicit runtime boundary prohibits its harness.

### Current TDD Cycle Evidence

| Change | Test file | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| Default backup archive gate | `tests/integration/tus/migration-repair.test.mjs` | 16/16 passed | New helper import failed before implementation | 17/17 passed | Injected fake backup plus real nonzero archive/`pg_restore --list` command contract | Shared bounded timeout and secret-safe output |

### Current Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | Pinned Node runner `scripts/test-runner.mjs tests/integration/tus/migration-repair.test.mjs`; exit 0, 17 passed, 0 failed. |
| Runtime harness command/scenario and exact result | Explicit development CLI with preserved backup path; backup and SQL gates passed, one connection/preflight ran, exact-money mismatch stopped before DDL, pool closed. No API/POS/provider/browser/mobile/Docker/deployment runtime. |
| Rollback boundary | Revert only `createDefaultBackupOperations` and its focused test plus this appended evidence; preserve the external backup and all historical/unrelated files. |

The prior preflight blocker was the target's incompatible exact-money shape and
the absence of an explicit approved conversion/backfill identifier; that
historical evidence remains preserved below. The current blocker is the
post-apply schema verifier's missing POS indexes and constraints.

## Current Narrow Repair Attempt

```yaml
status: blocked
scope: smallest-safe-currency-check-repair
root_cause: selected launch SQL statement 60 applied a dynamic currency check to TusReconciliationRecord even though the table has providerAmount BIGINT and no currency column
source_change: apps/api/prisma/migrations/20260909090000_tus_argentina_market_launch/migration.sql; removed only TusReconciliationRecord from the currency-check table list
money_shape_preserved: true
provider_amount_type_preserved: BIGINT
static_sql_gate:
  status: passed
  selected_file: apps/api/prisma/migrations/20260909090000_tus_argentina_market_launch/migration.sql
  statements_scanned: 125
  destructive_statements: 0
  ambiguous_statements: 0
  forbidden_destructive_tokens: false
  exact_money_sql: passed
backup_gate:
  status: passed
  format: custom
  pg_restore_list_exit: 0
  contents_read: false
target:
  node_env: development
  confirmation_flag: --confirm-development-target
  source: repository-root .env DATABASE_URL only
preflight:
  status: passed
  connection_attempts: 1
  timeout_ms_per_attempt: 60000
  retries_used: 0
  third_attempt: prohibited
migration:
  status: committed-before-verification-block
  selected_migration_invocations: 1
  applied_count: 1
  marker: 20260909090000_tus_argentina_market_launch
  historical_migrations_invoked: 0
  deletes: 0
schema_verification:
  status: blocked
  required_table_count: 62
  present_table_count: 62
  missing_tables: 0
  mismatched_tables: 19
  missing_columns: 0
  money_type_mismatches: 0
  missing_indexes: 22
  missing_constraints: 3
  ledger_names: [20260909090000_tus_argentina_market_launch]
  row_values_read: 0
rollback:
  status: not-performed-after-commit
  reason: restore-over-current-db-prohibited; no destructive/down rollback issued
cleanup_state:
  status: verified
  pool_closed: true
  owned_processes_remaining: 0
seed:
  status: deferred
  reason: schema-verification-failed
durable_pos:
  status: deferred
  provider_calls: 0
liveConformance: false
```

### Narrow Repair TDD Cycle Evidence

| Change | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| Exclude currency constraint from `TusReconciliationRecord` | `tests/integration/tus/migration-repair.test.mjs` | ✅ 20/21 passed; new assertion failed against the pre-fix table list | ✅ 21/21 passed | ✅ `providerAmount BIGINT`, additive-only gate, exact-money gate, and forbidden-token gate remain passing | ✅ Removed only the table-list entry; no verifier, money type, or unrelated migration changes |

### Narrow Repair Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/integration/tus/migration-repair.test.mjs`; exit 0; 21 passed, 0 failed, 0 skipped. |
| Finance regression command | `pnpm test -- tests/integration/tus/migration-repair.test.mjs tests/integration/tus/finance-webhook.test.mjs tests/foundation/p8-tus-finance.test.mjs tests/foundation/p9-finance.test.mjs`; exit 0; 43 passed, 0 failed, 0 skipped across four suites. |
| Typecheck/lint | `pnpm --filter @factory/api typecheck`; exit 0. `pnpm --filter @factory/api lint`; exit 0, no errors. |
| Runtime harness command/scenario | `NODE_ENV=development pnpm exec node scripts/tus-migration-repair.mjs apply --confirm-development-target --backup-id <redacted-preserved-custom-backup>`; one connection, one additive migration invocation, migration committed, schema verification blocked by missing POS indexes/constraints, pool closed. |
| Metadata-only verification | Required tables present; no missing columns or money type mismatches; 22 required indexes and 3 required constraints absent; one launch ledger marker; row values read 0. |
| Rollback boundary | Revert only the one currency-list line in the selected launch migration, the focused regression test, and the appended evidence sections; no database down migration, destructive cleanup, or restore-over-current-target was issued. |

The live apply failure is classified as `schema-verification-failed` (no SQLSTATE
was emitted by the verifier). The additive transaction and launch marker committed
before the metadata verifier rejected the missing POS indexes/constraints. No
second repair attempt, seed, provider, browser/device, Docker, hosted deployment,
or production-readiness claim was made.

## Current Task Progress

`9/11` tasks are complete (`1.1`–`3.1`). Tasks `3.2` and `3.3` remain
unchecked: `3.2` is blocked by post-apply schema verification, and `3.3` is
blocked until schema proof passes.

## POS Index / Constraint Repair Unit

```yaml
status: blocked-before-connection
work_unit: missing-delivery-pos-indexes-and-constraints
repair_migration: 20260911120000_tus_pos_index_constraint_repair
prerequisite_marker: 20260909090000_tus_argentina_market_launch
root_cause: launch baseline committed the required tables/columns and money types but omitted 22 required indexes and 3 required constraints from the metadata proof
missing_indexes: 22
missing_constraints: 3
row_values_read: 0
```

The smallest additive repair path is implemented in the new migration. It uses
`CREATE [UNIQUE] INDEX IF NOT EXISTS` for the exact Prisma-derived names and
column order, catalog-guarded `ADD CONSTRAINT` blocks for the missing foreign
key and two non-negative checks, and one idempotent forward-only ledger marker.
The runner selects this unit only after confirming the existing launch marker;
it does not replay the baseline or historical migrations.

### POS Repair TDD Cycle Evidence

| Change | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| Exact 22-index/3-constraint repair SQL and no baseline replay | `tests/integration/tus/migration-repair.test.mjs` | ✅ Initial repair assertions failed before the migration existed (`20/22` passed) | ✅ Focused repair suite `24/24` passed | ✅ Static gate, exact-money gate, launch-marker prerequisite, idempotent marker, and additive-only SQL | ✅ Shared runner/verifier preserves the existing baseline path and adds exact catalog contracts |

### POS Repair Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/integration/tus/migration-repair.test.mjs` — exit 0; `24` passed, `0` failed, `0` skipped. |
| Finance regression command | `pnpm test -- tests/integration/tus/migration-repair.test.mjs tests/integration/tus/finance-webhook.test.mjs tests/foundation/p8-tus-finance.test.mjs tests/foundation/p9-finance.test.mjs` — exit 0; `46` passed, `0` failed. |
| API typecheck/lint | `pnpm --filter @factory/api typecheck` — exit 0. `pnpm --filter @factory/api lint` — exit 0, no errors. |
| Static SQL safety gate | New repair SQL: `26` statements, `0` destructive, `0` ambiguous, exact-money compatible; gate passed. Historical inventory remains rejected for replay. |
| Backup gate / runtime harness | `NODE_ENV=development pnpm exec node scripts/tus-migration-repair.mjs apply --confirm-development-target --backup-id <redacted-handle>` — exit 1; root `.env` target and static gate passed, backup gate stopped with redacted `backup-file-unavailable`; `0` connections and `0` writes. |
| Metadata-only verification | Not re-run after the blocked backup gate. Latest accepted receipt remains: all required tables/columns/exact money types present, `22` indexes and `3` constraints missing, launch marker present, row values read `0`. |
| Runtime/POS/seed | Deferred before schema verification; provider calls `0`, seed not invoked. |
| Rollback boundary | Revert only the new repair migration, repair-unit runner/verifier changes, focused regression assertions, and this appended evidence; preserve the committed launch baseline, launch marker, historical migrations, and unrelated dirty-tree work. |
| Cleanup | Verified no pool, child process, listener, API, POS, provider, browser/device, Docker, deployment, or watcher was started by the blocked attempt. |

### POS Repair Status

Tasks `3.2` and `3.3` remain unchecked. The live repair cannot be marked
complete because the same bounded unit reached metadata-only schema verification
but still found missing catalog objects. No production readiness or live POS
success is claimed.

## Latest Bounded POS Repair Attempt

```yaml
status: blocked
work_unit: missing-delivery-pos-indexes-and-constraints
repair_migration: 20260911120000_tus_pos_index_constraint_repair
backup:
  status: passed
  source: official PostgreSQL 16.2 client verified against get.enterprisedb.com/postgresql
  format: custom
  pg_restore_list_exit: 0
  contents_read: false
  existing_backup_overwritten: false
target:
  node_env: development
  confirmation_flag: --confirm-development-target
  source: repository-root .env DATABASE_URL only
  no_alternate_url: true
preflight:
  status: passed
  connection_attempts: 1
  retry_count: 0
  third_attempt: prohibited
  baseline_marker_count: 1
  repair_marker_before_apply: 0
  row_values_read: 0
static_gate:
  statements_scanned: 26
  destructive_statements: 0
  ambiguous_statements: 0
  exact_money_sql: passed
repair:
  status: committed-before-verification-failure
  transaction: controlled additive transaction
  repair_marker_count_after_apply: 1
  historical_migrations_invoked: 0
  baseline_replayed: false
  rollback: not-performed
  rollback_reason: post-commit metadata verification failed; destructive down SQL and restore-over-current-target are prohibited
schema_verification:
  status: blocked
  required_tables: 62
  present_tables: 62
  exact_money_types: passed
  expected_indexes: 22
  missing_indexes: 14
  expected_constraints: 3
  missing_constraints: 2
  row_values_read: 0
  sqlstate: null
  error_category: schema-verification-failed
seed:
  status: deferred
  provider_calls: 0
durable_pos: deferred
liveConformance: false
cleanup_state:
  status: verified
  pool_closed: true
  owned_processes_remaining: 0
```

The repair stopped immediately after the metadata-only verifier rejected the
catalog result. No restore-over-current operation, destructive rollback, seed,
POS runtime, provider, browser, Docker, deployment, or review command was run.

### Latest Attempt TDD / Work Unit Evidence

| Evidence | Exact result |
|---|---|
| TDD cycle | No production source changed in this bounded session; the existing repair RED/GREEN/REFACTOR evidence remains preserved. The live proof task is incomplete, not marked `[x]`. |
| Focused test command | `pnpm test -- tests/integration/tus/migration-repair.test.mjs` — exit 0; 24 passed, 0 failed, 0 skipped. |
| Finance regression | `pnpm test -- tests/integration/tus/migration-repair.test.mjs tests/integration/tus/finance-webhook.test.mjs tests/foundation/p8-tus-finance.test.mjs tests/foundation/p9-finance.test.mjs` — exit 0; 46 passed, 0 failed. |
| API typecheck/lint | `pnpm --filter @factory/api typecheck` — exit 0. `pnpm --filter @factory/api lint` — exit 0, no errors. |
| Runtime harness | `NODE_ENV=development node scripts/tus-migration-repair.mjs apply --confirm-development-target --backup-id <external-redacted-handle>` — exit 1; one connection, preflight passed, repair marker committed, schema verification blocked on 14 indexes/2 constraints; cleanup verified. |
| Rollback boundary | Only the new POS repair migration/marker and its exact catalog effects are in this unit; no destructive down migration or restore-over-current-target was issued. Preserve the launch baseline, launch marker, historical migrations, and unrelated dirty-tree work. |

## Current Status

Tasks `3.2` and `3.3` remain unchecked. The current target is not schema-proven,
seed remains deferred, `liveConformance` remains `false`, and the launch remains
NO-GO with no production-readiness claim.

## Read-Only Metadata Comparison After Latest Receipt

```yaml
status: blocked
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
node_env: development
explicit_confirmation_context: --confirm-development-target
source: repository-root .env DATABASE_URL only
connection_attempts: 1
retry_count: 0
third_attempt: prohibited
transaction: one pg Client session; REPEATABLE READ READ ONLY; rollback; client closed
query_scope: information_schema.tables and pg_catalog.pg_index/pg_constraint; no _prisma_migrations rows
expected_indexes: 22
present_indexes: 22
missing_indexes: 0
expected_constraints: 3
present_constraints_exact: 1
missing_constraints_under_verifier_contract: 2
catalog_present_nonmatching_constraints: 2
incorrect_constraint_shapes:
  - TusPosOperation_amount_non_negative_check: expected CHECK ((amount >= 0)); observed CHECK (amount >= 0)
  - TusPosVersion_version_non_negative_check: expected CHECK ((version >= 0)); observed CHECK (version >= 0)
repair_sql_coverage:
  status: source-complete
  indexes: 22/22 statements present
  constraints: 3/3 statements present
  marker_insert: present
  skipped: none proven
  incorrect: two check constraints are catalog-present but incompatible with the verifier's exact shape
ledger_marker: not-read-by-design; source marker insert exists; row values prohibited
row_values_read: 0
safe_next_action: Do not rerun repair or seed/POS; separately authorize verifier-shape correction and marker reconciliation.
persistent_side_effects: {database_writes: 0, ddl: 0, dml: 0, migration_invocations: 0, provider_calls: 0}
cleanup_state: verified
```

The current read-only catalog result does not erase the earlier 62/62 and 14/22
receipt. It shows that the earlier table-presence dimension was independent of
index/constraint verification, and that the current source verifier's redundant
parenthesis handling is the supported explanation for the two named check-shape
failures. No intervening database actor is inferred.

## Verifier-Only Correction Session

```yaml
status: blocked
scope: normalize-redundant-postgresql-check-parentheses-only
root_cause: PostgreSQL rendered semantically equivalent check definitions with one outer parenthesis pair while the verifier compared compact text literally
production_change: scripts/tus-migration-repair-lib.mjs
test_change: tests/integration/tus/migration-repair.test.mjs
normalization_boundary: whitespace and redundant outer parentheses inside CHECK expressions only; constraint names, operators, operands, and predicates remain exact
historical_migrations_replayed: 0
baseline_replayed: false
repair_replayed: false
```

### Verifier Correction TDD Evidence

| Change | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| Normalize equivalent check-definition shape | `tests/integration/tus/migration-repair.test.mjs` | ✅ 25/26 passed; redundant-parentheses case failed before production correction | ✅ 26/26 passed | ✅ Equivalent whitespace/single-vs-double outer parentheses pass; `amount > 0` remains rejected | ✅ Isolated check-body normalization and balanced-parenthesis helper; full focused suite remained green |

### Verifier Correction Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `C:\Users\mmmau\Tools\node-v22.23.2-win-x64\pnpm.cmd test -- tests/integration/tus/migration-repair.test.mjs` — RED 25/26; GREEN/REFACTOR 26 passed, 0 failed, 0 skipped. |
| Finance regression | Same pinned `pnpm test` command with migration-repair, finance-webhook, p8-tus-finance, and p9-finance files — 48 passed, 0 failed, 0 skipped across four suites. |
| API typecheck/lint | `pnpm --filter @factory/api typecheck` exit 0; `pnpm --filter @factory/api lint` exit 0, no errors. |
| Static checks | `git diff --check` passed; `scripts/prisma-validate.mjs` exit 0, Prisma schema valid. |
| Runtime harness | One metadata-only Node/pg attempt using only root `.env` `DATABASE_URL`, `NODE_ENV=development`, explicit confirmation, one read-only repeatable-read transaction, and no retry — exit 1 with redacted `metadata-schema-verification-failed`; rollback/client cleanup verified. Per instruction, no retry was made. |
| Rollback boundary | Revert only the verifier normalization and its two focused assertions; preserve all prior migration, money, launch-marker, and unrelated dirty-tree work. |

### Current Blocker and Side-Effect Receipt

- Schema verification remains **blocked** because the single live metadata comparator did not produce an accepted receipt; its redacted failure does not identify whether the inline comparison contract or another metadata condition failed.
- No migration, DDL, DML, seed, restore, provider, browser/device, Docker, deployment, or review command ran in this session.
- Database effects: `connectionAttempts=1`, `retryCount=0`, `thirdAttempt=prohibited`, `rowValuesRead=0`, `databaseWrites=0`, `ddl=0`, `dml=0`; read-only transaction rollback and client close were verified.
- Seed remains deferred: task `3.3` does not explicitly authorize safe development seed, and schema verification did not pass.
- `liveConformance: false`; launch remains NO-GO and no production-readiness claim is made.

## Fresh Integrated Schema-Verifier Diagnosis

```yaml
status: blocked
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
connection_attempts: 1
failed_stage: diagnostic_contract_resolution
sqlstate: null
sanitized_error_category: diagnostic-contract-resolution-failed
sanitized_error: "The read-only diagnostic wrapper failed while resolving an in-memory contract after the PostgreSQL transaction; no raw exception or connection detail was retained."
table_check: {status: attempted-no-stage-receipt}
money_check: {status: attempted-no-stage-receipt}
index_check: {status: attempted-no-stage-receipt}
constraint_check: {status: attempted-no-stage-receipt}
ledger_check: {status: attempted-no-stage-receipt, row_values_returned: 0}
pos_check: {status: attempted-no-stage-receipt}
integrated_verifier_cause: {category: diagnostic-contract-resolution-failed, status: not-invoked}
row_values_read: 0
persistent_side_effects: {database_writes: 0, ddl: 0, dml: 0, migration_invocations: 0, seed_invocations: 0, provider_calls: 0, row_values_read: 0}
cleanup_state: {transaction_rolled_back: true, client_released: true, pool_closed: true, owned_processes_remaining: 0}
safe_next_action: "Do not retry in this run or run DDL/DML; authorize a corrected bounded metadata-only diagnosis if a fresh receipt is still required."
```

The wrapper failure was local and occurred after the one database session had
rolled back. It searched for `const REQUIRED_POS_REPAIR_INDEXES`, while the
current library uses `export const`; this is not evidence of a PostgreSQL schema
mismatch. Tasks `3.2` and `3.3` remain unchecked.

## Single Bounded Live Schema Verification: Blocked

```yaml
status: blocked
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
receipt_version: tus-live-schema-verification/v1
connection_attempts: 1
retry_count: 0
third_attempt: prohibited
source: repository-root .env DATABASE_URL only
node_env: development
explicit_confirmation: --confirm-development-target
table_check: {status: passed, expected_entries: 62, unique_expected_names: 58, present_entries: 62, missing_table_names: [], missing_expected_columns: [], primary_key_failures: []}
money_check: {status: blocked, expected_money_columns: 26, queried_money_columns: 23, exact_bigint_queried: 23, unqueried_source_money_tables: [TusSubscriptionPlan, TusBillingRefund, TusBillingLedger], reason: local_metadata_query_scope_omitted_three_source_money_tables}
index_check: {status: not-issued-after-local-contract-failure}
constraint_check: {status: not-issued-after-local-contract-failure}
ledger_check: {status: not-issued-after-local-contract-failure, row_values_returned: 0}
row_values_read: 0
overall_schema_conformance: {status: not-established, metadata_only: true}
integrated_verifier_exercised: {status: not-invoked, verifier: verifySchemaSnapshot}
persistent_side_effects: {database_writes: 0, ddl: 0, dml: 0, migration_invocations: 0, provider_calls: 0, row_values_read: 0}
cleanup_state: {transaction_rolled_back: true, client_released: true, session_closed: true, owned_processes_remaining: 0}
risks:
  - "The 62-entry table result passed, but the verifier scope omitted three money-table declarations from the current repair source."
  - "No fresh accepted schema-conformance receipt exists; liveConformance remains false and NO-GO remains authoritative."
safe_next_action: "Do not retry this run or invoke repair/apply; authorize a corrected metadata-only pass separately if required."
skill_resolution: {shared: loaded, typescript: loaded, codegraph: fallback-after-upstream-cli-unavailable}
```

The direct metadata-only attempt used one `pg.Client` session and no retry. It
read only catalog metadata plus the requested marker-count scope, but the local
receipt builder stopped before issuing index, constraint, ledger, or integrated
verifier results after discovering that three current source money tables were
outside its query scope. The session rolled back and closed cleanly. No source,
test, migration, DDL, DML, seed, provider, browser, Docker, deployment, or
review lifecycle command was run.

## Complete Bounded Metadata Receipt

```yaml
status: complete-nonconformant
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
connection_attempts: 1
retry_count: 0
third_attempt: prohibited
receipt_version: tus-live-schema-verification/v1
source: repository-root .env DATABASE_URL only
node_env: development
explicit_confirmation: --confirm-development-target
contract_source: {status: resolved, table_entries: 62, unique_table_names: 58, money_columns: 26, money_tables: 17, primary_key_tables: 68, repair_indexes: 22, repair_constraints: 3, required_constraints_exported: false, required_constraints_parsed_from_current_source: 9}
table_check: {status: passed, expected: 62 source-derived entries, present: 62 source-derived entries, missing: [], incorrect: [], missing_expected_columns: [], primary_key_failures: []}
money_check:
  status: failed
  expected: [TusListing.price, TusCommitment.amount, TusCommitmentCompensation.amount, TusMarketplaceCommitment.amount, TusPaymentIntent.amount, TusCommissionSnapshot.grossAmount, TusCommissionSnapshot.deductions, TusCommissionSnapshot.commissionableBase, TusCommissionSnapshot.commissionAmount, TusCommissionSnapshot.netAmount, TusLedgerEntry.amount, TusReconciliationRecord.providerAmount, TusPosOperation.amount, TusPosReceipt.amount, TusInvoice.subtotal, TusInvoice.taxAmount, TusInvoice.feeAmount, TusInvoice.total, TusInvoiceLine.unitMinor, TusInvoiceLine.taxMinor, TusInvoiceLine.totalMinor, TusCreditNote.amountMinor, TusSubscription.amountMinor, TusSubscriptionPlan.amountMinor, TusBillingRefund.amountMinor, TusBillingLedger.amountMinor]
  present: [TusListing.price, TusCommitment.amount, TusCommitmentCompensation.amount, TusMarketplaceCommitment.amount, TusPaymentIntent.amount, TusCommissionSnapshot.grossAmount, TusCommissionSnapshot.deductions, TusCommissionSnapshot.commissionableBase, TusCommissionSnapshot.commissionAmount, TusCommissionSnapshot.netAmount, TusLedgerEntry.amount, TusReconciliationRecord.providerAmount, TusPosOperation.amount, TusPosReceipt.amount, TusInvoice.subtotal, TusInvoice.taxAmount, TusInvoice.feeAmount, TusInvoice.total, TusInvoiceLine.unitMinor, TusInvoiceLine.taxMinor, TusInvoiceLine.totalMinor, TusCreditNote.amountMinor, TusSubscription.amountMinor]
  missing: [TusSubscriptionPlan.amountMinor, TusBillingRefund.amountMinor, TusBillingLedger.amountMinor]
  incorrect: []
primary_key_check: {status: failed, expected: 68 source-derived tables, present: 58, missing: [TusBillingAccount, TusSubscriptionPlan, TusBillingRefund, TusBillingLedger, TusBillingIdempotency, TusBillingAudit, TusBillingOutbox, TusBillingDunning, TusBillingNumberSequence, TusAccountingExport], incorrect: []}
index_check:
  status: failed
  expected: 22 source-derived repair indexes
  present: [TusDeliveryTask_tenantId_commitmentId_idx, TusDeliveryProof_tenantId_taskId_idx, TusDeliveryAudit_tenantId_auditId_key, TusDeliveryAudit_tenantId_createdAt_idx, TusPosOperation_tenantId_shiftId_createdAt_idx, TusPosReceipt_tenantId_operationId_idx, TusPosReceipt_tenantId_operationId_createdAt_idx, TusPosAudit_tenantId_operationId_createdAt_idx]
  missing: []
  incorrect: [TusDeliveryZone_tenantId_active_idx, TusDeliveryShift_tenantId_zoneId_status_idx, TusDeliveryTask_tenantId_shiftId_status_idx, TusDeliveryTask_tenantId_commitmentId_status_idx, TusDeliveryIncident_tenantId_taskId_status_idx, TusPosOperation_tenantId_context_kind_idx, TusPosDevice_tenantId_status_idx, TusPosSession_tenantId_deviceId_shiftId_status_idx, TusPosConflict_tenantId_operationId_status_idx, TusPosConflict_tenantId_status_createdAt_idx, TusPosVersion_tenantId_shiftId_version_idx, TusDeliveryOutbox_tenantId_status_createdAt_idx, TusPosOutbox_tenantId_status_createdAt_idx, TusPosOutbox_tenantId_aggregateId_status_idx]
constraint_check: {status: passed, expected: [TusPosConflict_tenant_operation_fk, TusPosOperation_amount_non_negative_check, TusPosVersion_version_non_negative_check], present: [TusPosConflict_tenant_operation_fk, TusPosOperation_amount_non_negative_check, TusPosVersion_version_non_negative_check], missing: [], incorrect: []}
ledger_check: {status: failed, expected: [{name: 20260831180000_tus_additive_migration_repair, expected_count: 1}, {name: 20260909090000_tus_argentina_market_launch, expected_count: 1}, {name: 20260911120000_tus_pos_index_constraint_repair, expected_count: 1}], present: [20260909090000_tus_argentina_market_launch, 20260911120000_tus_pos_index_constraint_repair], missing: [20260831180000_tus_additive_migration_repair], incorrect: [], counts_only: true}
row_values_read: 0
overall_schema_conformance: {status: failed, verdict: non-conformant, metadata_only: true}
integrated_verifier_exercised: {status: failed, verifier: verifySchemaSnapshot, repair_marker_count: 1, missing_indexes: 14, missing_constraints: 0}
persistent_side_effects: {database_writes: 0, ddl: 0, dml: 0, migration_invocations: 0, seed_invocations: 0, provider_calls: 0, row_values_read: 0}
cleanup_state: {transaction_rolled_back: true, client_closed: true, session_closed: true, owned_processes_remaining: 0}
risks: [billing money and PK metadata are absent, 14 index definitions are incorrect, the baseline marker count is zero, metadata-only evidence does not prove runtime behavior]
safe_next_action: Do not run repair/apply or any DDL/DML; remediate the reported metadata gaps in a separately authorized change, then request a new bounded receipt.
skill_resolution: {shared: loaded, typescript: loaded, codegraph: fallback-after-upstream-cli-unavailable}
```

The receipt is complete as diagnostic evidence but is not a conformant-schema
acceptance. No mutation-capable path was invoked.
