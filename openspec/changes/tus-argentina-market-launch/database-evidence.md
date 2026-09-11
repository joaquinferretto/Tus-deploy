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
