# Database Evidence: TUS Argentina Market Launch

## Scope

This evidence covers static implementation checks only. No live database, seed, migration, provider, or deployment operation was executed.

## Checks

| Check | Result |
|---|---|
| Launch migration inventory | 30 migration directories with `migration.sql` present; 28 historical pending entries, including the selected launch migration and repair baseline as non-historical paths |
| Required table declarations | 56 required launch/POS tables found in the launch migration |
| Destructive SQL scan | Passed; no `DROP`, `TRUNCATE`, `CASCADE`, or `DELETE FROM` tokens in the launch migration |
| Exact money scan | Passed; monetary migration columns use `BIGINT`; commission rate uses integer basis points |
| Prisma money scan | Passed statically; no `Float` fields remain in `apps/api/prisma/schema.prisma` |
| Formatting | `git diff --check` passed |
| Historical destructive replay refusal | Passed; 19 executable destructive statements are rejected before connection; comment-only forbidden tokens are excluded; historical files remain untouched |
| Exact-money conversion/backfill gate | Passed deterministically; decimal-only conversion supports explicit reject/half-up policy; additive `BIGINT` backfill emits SQL only with an approval identifier and still requires backup/restore plus development confirmation |
| Focused tests | Passed: pinned NVM Node runner, migration-repair suite 18/18 |
| Restorable backup | Not verified; `pg_dump`, `pg_restore`, and `psql` are unavailable |

## Safety Boundary

The database gate remains closed until a real focused test run, target/schema/data preflight, and restorable backup verification are available. Historical migrations are inventory input only and were not replayed or modified.

## Open Decision

Existing historical tables such as `TusListing`, `TusMarketplaceCommitment`, and related financial records may have legacy floating-point columns. An approved additive backfill/conversion policy is still required before claiming runtime compatibility for those existing rows.

## Foundation Recovery Evidence

| Evidence | Result |
|---|---|
| Static migration inventory/classification | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe --experimental-strip-types --experimental-loader ./scripts/node-strip-types-loader.mjs --test tests/integration/tus/migration-repair.test.mjs` — exit 0; 18 passed, 0 failed; 28 historical pending entries, 19 destructive executable statements, no replay |
| Backup/restore gate | Blocked before connection because `pg_dump`/`pg_restore` are unavailable; no fake dump, restore, connection, DDL, or database write was attempted |
| Root target and confirmation | Gate accepts only repository-root `.env` `DATABASE_URL` with `NODE_ENV=development` and explicit `--confirm-development-target`; alternate URLs are ignored/rejected and output is redacted |
| Retry contract | Deterministic contract records at most two attempts of 60,000 ms each, with exactly one retry and no third attempt |
| Database effects | None; `connections=0`, `writes=0`, `deletes=0`, `migrationInvocations=0`, `providerCalls=0` |

The database gate remains closed. The next valid live action is a separately authorized, backup-equipped development pass using the existing additive-only runner; historical migrations must not be replayed.

## Current Database State

```yaml
status: external-blocked
inspection_basis: previously recorded live inventory
application_tables_present: false
observed_tables:
  - TusHardeningFixture
exact_money_mismatch: not-applicable-to-observed-fixture-only-state
database_effects:
  connections: 0
  writes: 0
  deletes: 0
  ddl: 0
  dml: 0
```

The current evidence records no application monetary tables or rows in the
target, so there is no live historical amount column to convert in this pass.
The implementation now prevents the mismatch from being introduced by the
additive baselines: selected monetary columns are `BIGINT`, currency columns
are checked as uppercase ISO-4217 codes, and historical floating-point columns
remain inventory-only until an approved, lossless backfill is authorized.

The earlier remote-development repair record is retained as historical audit
context, not as fresh runtime evidence. It must not be used to claim that a
backup was verified, a connection is currently available, or launch readiness
has been established.

## Cross-Reference: Latest POS Repair Attempt

- The external custom-format backup gate now passed using the official
  PostgreSQL 16.2 client; `pg_restore --format=custom --list` exited `0` and
  backup contents were not read.
- The bounded repair used only the repository-root `.env` `DATABASE_URL`,
  `NODE_ENV=development`, the exact confirmation flag, one 60-second-bounded
  connection, and no retry. The launch/baseline ledger marker was confirmed
  before applying only `20260911120000_tus_pos_index_constraint_repair`.
- The additive transaction committed the repair marker, but metadata-only schema
  verification remained blocked: 62/62 required tables were present and exact
  money types passed, while 14 of 22 expected indexes and 2 of 3 expected
  constraints were still missing. No row values were read.
- No restore-over-current operation or destructive down rollback was issued after
  the post-commit verifier failure. Seed and durable POS remain deferred;
`liveConformance: false` and NO-GO remain authoritative.

## Latest Exact-Money-Reconciled Retry

```yaml
status: external-blocked
backup_state:
  status: passed
  handle: file:tus-argentina-market-launch-backup.dump
  nonzero_size: true
  pg_restore_list_exit: 0
  preserved: true
sql_gate:
  selected_file: apps/api/prisma/migrations/20260909090000_tus_argentina_market_launch/migration.sql
  files_scanned: 1
  statements_scanned: 125
  destructive_statements: 0
  ambiguous_statements: 0
  forbidden_destructive_tokens: false
  unsafe_alter: false
  exact_money_sql: passed
target:
  node_env: development
  confirmation_flag: --confirm-development-target
  source: repository-root .env DATABASE_URL only
connection_attempts:
  count: 1
  timeout_ms_per_attempt: 60000
  retry_count_allowed: 1
  retries_used: 0
  third_attempt: prohibited
migration_result:
  status: not-started
  reason: exact-money-type-mismatch
  ddl: 0
  dml: 0
  historical_migrations_invoked: 0
  ledger_mutations: 0
schema_verification:
  status: deferred
  reason: preflight-failed-before-ddl
durable_pos:
  status: external-blocked
  reason: schema-proof-not-reached
  provider_calls: 0
database_effects:
  aggregate_catalog_preflight_reads: 1
  writes: 0
  deletes: 0
  ddl: 0
  dml: 0
  row_data_emitted: 0
cleanup_state:
  status: verified
  pools_closed: 1
  owned_children_remaining: 0
```

The backup and selected SQL gates passed. The bounded development connection
reached aggregate preflight, which still found an existing monetary column with
an incompatible type. Because the target-specific exact-money shape remains
unreconciled, the runner stopped before DDL; no additive baseline, marker,
historical migration, seed, or POS harness was executed. An explicitly
approved lossless conversion/backfill identifier is still required; no
conversion SQL was generated or run.

## Fresh Database Repair Gate Retry

```yaml
status: blocked
scope: bounded-database-repair-slice
static_sql_gate:
  selected_file: apps/api/prisma/migrations/20260909090000_tus_argentina_market_launch/migration.sql
  statements_scanned: 125
  destructive_statements: 0
  ambiguous_statements: 0
  unsafe_alter: false
  forbidden_destructive_tokens: false
  exact_money_sql: passed
  classification: additive-only-baseline
backup_gate:
  status: passed
  handle: file:tus-argentina-market-launch-backup.dump
  nonzero_size: true
  pg_restore_format: custom
  pg_restore_list_exit: 0
  contents_read: false
target:
  node_env: development
  confirmation_flag: --confirm-development-target
  source: repository-root .env DATABASE_URL only
preflight:
  status: blocked
  verifier: scripts/tus-migration-repair-lib.mjs:validatePreflight
  reason: exact-money-type-mismatch
  result_classification: verifier-reported; not mapped to a current live column
  connection_attempts: 1
  timeout_ms_per_attempt: 60000
  retry_count_allowed: 1
  retries_used: 0
  third_attempt: prohibited
migration:
  status: not-started
  ddl: 0
  dml: 0
  historical_migrations_invoked: 0
  ledger_mutations: 0
schema_verification:
  status: deferred
  reason: preflight-failed-before-ddl
seed:
  status: deferred
  reason: schema-verification-not-reached
database_effects:
  writes: 0
  deletes: 0
  ddl: 0
  dml: 0
  row_values_read: 0
  row_values_emitted: 0
cleanup_state:
  status: verified
  pool_closed: true
  owned_processes_remaining: 0
```

The static launch SQL gate and preserved custom-format backup gate passed. The
safe repair CLI then made one successful bounded connection and stopped before
DDL with the exact redacted verifier result `exact-money-type-mismatch`.
This result is recorded as a verifier classification only: the fresh
metadata-only receipt in `money-mismatch-evidence.md` found no current public
monetary-looking column, so no live mismatch is inferred or corrected. No
historical migration, reset, `db push`, destructive SQL, seed, provider, or
row-value read was performed.

## Corrective Retry: Absent Monetary Columns

```yaml
status: blocked
operation: one-and-only-corrective-retry
source_correction: scripts/tus-migration-repair-lib.mjs:validateMoneyTypes
static_sql_gate:
  selected_file: apps/api/prisma/migrations/20260909090000_tus_argentina_market_launch/migration.sql
  statements_scanned: 125
  destructive_statements: 0
  ambiguous_statements: 0
  unsafe_alter: false
  forbidden_destructive_tokens: false
  exact_money_sql: passed
backup_gate:
  status: passed
  handle: file:tus-argentina-market-launch-backup.dump
  nonzero_size: true
  pg_restore_format: custom
  pg_restore_list_exit: 0
  contents_read: false
target:
  node_env: development
  confirmation_flag: --confirm-development-target
  source: repository-root .env DATABASE_URL only
preflight:
  status: passed
  verifier: scripts/tus-migration-repair-lib.mjs:validatePreflight
  reason: preflight-passed
  connection_attempts: 1
  timeout_seconds: 60
  retry_count: 0
  third_attempt: prohibited
migration:
  status: blocked
  selected_migration_invocations: 1
  transaction: attempted and failed with redacted reason repair-operation-failed-restore-required
  persistent_ddl_after_failure: 0
  historical_migrations_invoked: 0
  ledger_mutations: 0
schema_verification:
  status: deferred
  reason: migration-transaction-failed
post_failure_metadata:
  status: passed
  public_table_count: 1
  launch_table_count: 1
  application_launch_tables_present: false
  current_public_money_column_count: 0
  prisma_migrations_present: false
  row_values_read: 0
seed:
  status: deferred
  reason: migration-and-schema-verification-not-passed
database_effects:
  repair_connections: 1
  metadata_connections: 1
  write_phase_entries: 1
  ddl_persisted: 0
  dml: 0
  deletes: 0
  row_values_read: 0
  row_values_emitted: 0
cleanup_state:
  status: verified
  pool_closed: true
  owned_processes_remaining: 0
```

The verifier bug was confirmed and corrected: `validateMoneyTypes` now ignores
required money tables whose metadata says `present: false`, while a present
table still requires every required money column to have `bigint`/`int8` metadata
and remains fail-closed for missing or incompatible types. The corrected repair
run passed preflight, entered the selected additive transaction, and failed with
the existing redacted restore-required runtime classification. A separate
metadata-only check found no persisted launch DDL or migration marker, so no
seed or further retry was attempted. `liveConformance: false` remains unchanged.

## Sequential Additive Failure Diagnosis

```yaml
status: blocked
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
connection_attempts:
  count: 1
  retry_count: 0
  connection_timeout_ms: 60000
  statement_timeout_ms: 60000
  query_timeout_ms: 60000
static_gate:
  status: passed
  selected_file: apps/api/prisma/migrations/20260909090000_tus_argentina_market_launch/migration.sql
  statements: 125
  destructive_statements: 0
  ambiguous_statements: 0
  unsafe_alter: false
  transaction_incompatible_statements: 0
  forbidden_destructive_tokens: false
  exact_money_sql: passed
transaction_attempt:
  status: failed
  statements_started: 60
  statements_completed: 59
failed_statement_index: 60
sanitized_sqlstate: '42703'
sanitized_error_category: schema-reference
sanitized_error: "PostgreSQL schema reference error; identifiers and connection details redacted"
rollback:
  attempted: true
  status: passed
  executed_in_finally: true
post_rollback_metadata:
  status: passed
  public_tables:
    count: 1
    names: [TusHardeningFixture]
  public_columns:
    count: 10
    names:
      - TusHardeningFixture.actorId
      - TusHardeningFixture.createdAt
      - TusHardeningFixture.id
      - TusHardeningFixture.productListingId
      - TusHardeningFixture.runId
      - TusHardeningFixture.serviceListingId
      - TusHardeningFixture.tag
      - TusHardeningFixture.tenantId
      - TusHardeningFixture.updatedAt
      - TusHardeningFixture.version
  ledger:
    table_count: 0
    table_names: []
    column_count: 0
    column_names: []
    row_count: 0
    selected_marker_count: 0
  row_values_read: 0
  row_values_emitted: 0
mismatch_location: statement
root_cause: "The selected launch baseline's statement 60, the dynamic currency-check constraint block, raised SQLSTATE 42703 before rollback."
  ddl: 0
  dml: 0
  deletes: 0
  ledger_mutations: 0
  row_values_read: 0
  row_values_emitted: 0
cleanup_state: verified-one-session-closed
risks:
  - "The trial intentionally never committed and did not invoke the production repair CLI, runRepair, seed, provider, service, browser, Docker, migration, or deployment paths."
  - "runRepair collapses apply, rollback, ledger-recording, and schema-verification errors into the same generic runtime reason; this trial reproduced the failure in statement execution, while rollback and post-rollback metadata verification passed."
  - "The exact failing identifier is not recorded because diagnostics are sanitized; no row values or connection details were emitted."
skill_resolution:
  shared: C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md
  typescript: C:\Users\mmmau\.config\opencode\skills\curated\typescript\SKILL.md
  loaded: true
  codegraph: fallback-after-two-malformed-index-errors
```

The trial used the repository-root `.env` `DATABASE_URL` only. It opened one
PostgreSQL client session, entered a real transaction, executed statements
sequentially, rejected transaction-incompatible/destructive statements before
execution, and issued `ROLLBACK` in `finally`. Statement 60 failed with the
sanitized schema-reference result; the rollback and metadata-only verification
then passed. Comparing this path with `runRepair` shows the generic prior
`repair-operation-failed-restore-required` was reached in the statement phase,
not rollback, ledger recording, or post-apply verification. `runRepair` applies
the same selected SQL before its later ledger/verifier stages, and its default
ledger recorder is a no-op. No persistent DDL/DML or ledger mutation remains.

## Cross-Reference: Narrow Currency-Check Repair

The `tus-additive-migration-repair` change removed only `TusReconciliationRecord`
from the selected launch migration's dynamic currency-check table list after
the prior statement-60 SQLSTATE `42703` diagnosis. `providerAmount` remains
`BIGINT`; no currency column was added and no money value was altered. The
focused regression passed `21/21`, the selected static SQL gate passed with
`125` statements and zero destructive/ambiguous statements, and the preserved
custom backup passed `pg_restore --format=custom --list` with exit `0`.

The one bounded development apply committed the selected additive baseline and
launch ledger marker, then metadata-only schema verification blocked on missing
POS indexes/constraints. Required tables and columns were present, money types
matched, and row values read/emitted were `0`. No seed or provider call was
made; `liveConformance: false` remains unchanged. See the detailed receipt in
`openspec/changes/tus-additive-migration-repair/apply-progress.md`.

## Cross-Reference: POS Index / Constraint Repair

The later accepted live receipt supersedes the earlier preflight-only
classification for the current target: the launch baseline committed its
required tables/columns and exact money types and recorded the launch marker.
Metadata-only verification then found exactly `22` required indexes and `3`
required constraints missing, with zero row values read. The additive repair
unit is implemented separately at
`apps/api/prisma/migrations/20260911120000_tus_pos_index_constraint_repair/migration.sql`;
it does not alter money types, replay historical migrations, or replace the
launch marker.

The bounded repair attempt passed static SQL safety but stopped at the backup
gate before connection because the restorable backup artifact was unavailable.
No new DDL/DML, seed, provider, or POS runtime effect occurred. The current
schema remains `liveConformance: false` and not production-ready.

## Cross-Reference: Live Schema Conformance Repair

The separate `tus-live-schema-conformance-repair` unit now has a forward-only
SQL migration, exact Prisma-derived catalog contracts, metadata-only acceptance,
and redacted fail-closed runner evidence. Its focused migration-repair suite is
`32/32` passing. It does not reconstruct the absent historical marker
`20260831180000_tus_additive_migration_repair`.

The available custom-format backup archives passed `pg_restore --format=custom
--list`, but archive listing is not isolated restore verification. The default
repair adapter therefore stops before connection unless an explicit isolated
restore verifier is supplied. No new live database effect is claimed;
`liveConformance: false` and NO-GO remain in force until the accepted metadata
receipt proves the complete catalog and marker lineage.

## Latest Read-Only POS Metadata Comparison

```yaml
status: blocked
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
connection_attempts: 1
retry_count: 0
node_env: development
explicit_confirmation_context: --confirm-development-target
source: repository-root .env DATABASE_URL only
query_scope: information_schema.tables and pg_catalog.pg_index/pg_constraint only
expected_indexes: 22
present_indexes: 22
missing_indexes: []
expected_constraints: 3
present_constraints_exact: [TusPosConflict_tenant_operation_fk]
missing_constraints_under_verifier_contract:
  - identifier: TusPosOperation_amount_non_negative_check
    expected: CHECK ((amount >= 0))
    observed: CHECK (amount >= 0)
  - identifier: TusPosVersion_version_non_negative_check
    expected: CHECK ((version >= 0))
    observed: CHECK (version >= 0)
catalog_present_nonmatching_constraints: 2
repair_sql_coverage:
  migration: 20260911120000_tus_pos_index_constraint_repair
  index_statements: 22/22 present in source
  constraint_statements: 3/3 present in source
  marker_insert_statement: present in source
  skipped: none proven
  incorrect: two check constraints are catalog-present but do not match the verifier's exact text shape
ledger_marker: not-read-by-design; current _prisma_migrations row value was not queried
row_values_read: 0
persistent_side_effects: {writes: 0, ddl: 0, dml: 0, seed: 0, provider_calls: 0}
cleanup_state: verified
```

The prior `62/62` result is supported as a table-presence result, not as proof
that the independent index/constraint catalog contract passed. The earlier
`14/22` and `2/3` receipt is retained as historical evidence from a different
snapshot; this comparison does not infer an unrecorded actor or claim when the
indexes became present. `liveConformance: false` and NO-GO remain authoritative.

## Cross-Reference: Verifier-Only Parenthesis Correction

- The repair verifier now removes only redundant outer parentheses and whitespace inside PostgreSQL `CHECK` definitions before comparing them. Constraint names, operators, operands, and predicate structure remain exact; materially different predicates remain rejected.
- Strict-TDD focused coverage is green: migration-repair `26/26`; migration-repair plus finance regression set `48/48`. API typecheck and lint passed; `git diff --check` and Prisma schema validation passed.
- One metadata-only verification attempt used only the root `.env` `DATABASE_URL`, `NODE_ENV=development`, explicit confirmation, one read-only transaction, and no retry. It returned a redacted blocked result; rollback/client cleanup was verified. No row values were read.
- No migration replay, DDL, DML, seed, restore, provider, browser/device, Docker, deployment, or review command was run. `liveConformance: false` and NO-GO remain authoritative.

## Fresh Integrated Schema-Verifier Diagnosis

One fresh bounded Node/`pg` session used only the root `.env` `DATABASE_URL`,
`NODE_ENV=development`, explicit confirmation, one connection, and no retry.
The catalog stages were attempted in one repeatable-read read-only transaction,
then rolled back and cleaned up. The diagnostic wrapper failed locally while
resolving its in-memory snapshot contract after the transaction because it looked
for a `const` declaration where the current library has `export const`.

```yaml
status: blocked
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
connection_attempts: 1
failed_stage: diagnostic_contract_resolution
sqlstate: null
sanitized_error_category: diagnostic-contract-resolution-failed
sanitized_error: "No PostgreSQL failure was captured; the local wrapper exception was redacted."
table_check: attempted-no-stage-receipt
money_check: attempted-no-stage-receipt
index_check: attempted-no-stage-receipt
constraint_check: attempted-no-stage-receipt
ledger_check: attempted-no-stage-receipt
pos_check: attempted-no-stage-receipt
integrated_verifier_cause: {category: diagnostic-contract-resolution-failed, status: not-invoked}
row_values_read: 0
persistent_side_effects: {database_writes: 0, ddl: 0, dml: 0, migration_invocations: 0, seed_invocations: 0, provider_calls: 0, row_values_read: 0}
cleanup_state: {transaction_rolled_back: true, client_released: true, pool_closed: true, owned_processes_remaining: 0}
safe_next_action: "Do not infer schema state or retry this run; use a separately authorized corrected metadata-only pass before any mutation."
risks:
  - "No accepted fresh metadata receipt exists for the current table, money, index, constraint, ledger, or POS completeness stages."
 - "Prior live receipts remain historical and liveConformance remains false."
 ```

## Single Bounded Live Schema Verification: Blocked Local Scope

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
  - "This pass confirms the 62-entry table/column/PK dimension only; it does not establish the three omitted source money tables."
  - "No accepted fresh index, constraint, marker-count, integrated-verifier, row-data, or production-readiness claim exists from this pass."
safe_next_action: "Do not retry or mutate the database; authorize a separately corrected metadata-only pass if fresh proof is required."
skill_resolution: {shared: loaded, typescript: loaded, codegraph: fallback-after-upstream-cli-unavailable}
```

The one direct PostgreSQL session used only read-only catalog queries and
rolled back before client close. The receipt builder stopped locally after the
62-entry table result because the current repair-source money map also names
three billing tables that were not included in the metadata query. This is not
evidence of a live money mismatch, and no second session was opened under the
requested one-session/no-retry boundary.

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
table_check: {status: passed, expected: 62 source-derived entries, present: 62 source-derived entries, missing: [], incorrect: []}
money_check: {status: failed, expected: 26 source-derived columns, present: 23, missing: [TusSubscriptionPlan.amountMinor, TusBillingRefund.amountMinor, TusBillingLedger.amountMinor], incorrect: []}
primary_key_check: {status: failed, expected: 68 source-derived tables, present: 58, missing: [TusBillingAccount, TusSubscriptionPlan, TusBillingRefund, TusBillingLedger, TusBillingIdempotency, TusBillingAudit, TusBillingOutbox, TusBillingDunning, TusBillingNumberSequence, TusAccountingExport], incorrect: []}
index_check: {status: failed, expected: 22 source-derived indexes, present: 8 exact, missing: [], incorrect: [TusDeliveryZone_tenantId_active_idx, TusDeliveryShift_tenantId_zoneId_status_idx, TusDeliveryTask_tenantId_shiftId_status_idx, TusDeliveryTask_tenantId_commitmentId_status_idx, TusDeliveryIncident_tenantId_taskId_status_idx, TusPosOperation_tenantId_context_kind_idx, TusPosDevice_tenantId_status_idx, TusPosSession_tenantId_deviceId_shiftId_status_idx, TusPosConflict_tenantId_operationId_status_idx, TusPosConflict_tenantId_status_createdAt_idx, TusPosVersion_tenantId_shiftId_version_idx, TusDeliveryOutbox_tenantId_status_createdAt_idx, TusPosOutbox_tenantId_status_createdAt_idx, TusPosOutbox_tenantId_aggregateId_status_idx]}
constraint_check: {status: passed, expected: [TusPosConflict_tenant_operation_fk, TusPosOperation_amount_non_negative_check, TusPosVersion_version_non_negative_check], present: [TusPosConflict_tenant_operation_fk, TusPosOperation_amount_non_negative_check, TusPosVersion_version_non_negative_check], missing: [], incorrect: []}
ledger_check: {status: failed, expected: [20260831180000_tus_additive_migration_repair, 20260909090000_tus_argentina_market_launch, 20260911120000_tus_pos_index_constraint_repair], present: [20260909090000_tus_argentina_market_launch, 20260911120000_tus_pos_index_constraint_repair], missing: [20260831180000_tus_additive_migration_repair], incorrect: [], counts_only: true}
row_values_read: 0
overall_schema_conformance: {status: failed, verdict: non-conformant, metadata_only: true}
integrated_verifier_exercised: {status: failed, verifier: verifySchemaSnapshot, repair_marker_count: 1, missing_indexes: 14, missing_constraints: 0}
persistent_side_effects: {database_writes: 0, ddl: 0, dml: 0, migration_invocations: 0, seed_invocations: 0, provider_calls: 0, row_values_read: 0}
cleanup_state: {transaction_rolled_back: true, client_closed: true, session_closed: true, owned_processes_remaining: 0}
risks: [three billing money columns absent, ten billing PK tables absent, 14 index definitions have incorrect ordered columns, baseline marker count is zero, metadata-only evidence does not prove runtime behavior]
safe_next_action: Do not run repair/apply or any DDL/DML; remediate the reported metadata gaps in a separately authorized change, then request a new bounded receipt.
skill_resolution: {shared: loaded, typescript: loaded, codegraph: fallback-after-upstream-cli-unavailable}
```

This supersedes neither prior evidence nor the earlier blocked local-scope
attempt. It is the complete current point-in-time receipt; its conformance
verdict is non-conformant and no production-readiness claim is made.
