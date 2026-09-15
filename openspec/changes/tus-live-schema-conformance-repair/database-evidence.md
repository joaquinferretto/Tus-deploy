# TUS Live Schema Conformance Repair Database Evidence

## Bounded Completion Session: 2026-09-14

```yaml
status: blocked
target_source: repository-root .env DATABASE_URL only
node_env: development
explicit_confirmation: --confirm-development-target
static_gate: passed
backup_gate: passed
isolated_restore_gate: blocked
preflight: not-run
migration: {status: not-started, selected: 20260911130000_tus_live_schema_conformance_repair, current_target_writes: 0, historical_replays: 0}
schema_acceptance: {status: not-run, expected: {tables: 62, money: 26, primary_keys: 68, indexes: 22, constraints: 3}, rowValuesRead: 0, liveConformance: false, noGo: true}
seed: not-run
pos_runtime: not-run
current_target_mutation: none
scratch_restore: {status: blocked, identifier: lscr-ba813eed404b, metadata_only_table_count: 59, owner_cleanup_required: true}
cleanup_state: probe clients and PostgreSQL client processes closed; scratch intentionally retained
```

The root target was not inspected by the repair runner after the isolated restore
gate failed. The only target-side operation beyond the approved backup read was
creation of the isolated scratch database. No current-target DDL, DML, marker,
seed, provider, durable POS, browser/device, Docker, deployment, or production
operation occurred.

## Current Fresh Isolated Restore Session: 2026-09-14 (Authoritative)

```yaml
status: blocked
restore_attempts: 1
restore_error_category: missing-dbname-or-file-option
restore_sqlstate: null
restore_sanitized_stderr: "pg_restore: error: una de las opciones -d/--dbname y -f/--file debe especificarse"
scratch_database_created: 1
scratch_retained: true
scratch_metadata_verification: not-run
current_target_control_connection: scratch-database-creation-only
current_target_schema_writes: 0
current_target_data_writes: 0
historical_migrations_invoked: 0
rowValuesRead: 0
cleanup_state: official-client-processes-closed; no-pool-opened; owner-cleanup-required
```

This current session is authoritative for this task. The one restore invocation
stopped at `pg_restore` argument validation, and the explicit no-retry rule then
halted the workflow before current-target preflight, repair, metadata acceptance,
seed, and POS evidence.

## Fresh Corrected Restore Gate: 2026-09-14 (Authoritative Correction)

```yaml
status: blocked
source: repository-root .env DATABASE_URL only
backup_gate: {status: passed, nonzero_size: true, custom_format: true, pg_restore_list_exit_code: 0}
isolated_restore_gate:
  status: blocked
  scratch_created: 1
  attempts: 1
  command_shape: pg_restore --dbname=<redacted-scratch-URL> --no-owner --no-acl --exit-on-error --single-transaction <backup_path>
  outcome: timeout_after_60_seconds
  sanitized_stderr: empty
  retry_performed: false
preflight: not-run
migration: {status: not-started, current_target_schema_writes: 0, current_target_data_writes: 0, historical_migrations_invoked: 0}
schema_acceptance: {status: not-run, expected_tables: 62, expected_money_columns: 26, expected_primary_keys: 68, expected_indexes: 22, expected_constraints: 3, rowValuesRead: 0, liveConformance: false, noGo: true}
seed: not-run
pos_evidence: not-run
current_target_repair_reached: false
cleanup_state: clients_and_restore_process_closed; scratch_retained_for_owner_cleanup
```

The corrected isolated proof stopped at the one allowed restore attempt. No
current-target preflight, repair transaction, acceptance, seed, POS, provider,
deployment, browser/device, Docker, or review lifecycle operation followed.

## Bounded Data-Only Restore Attempt: 2026-09-14 (Authoritative Failure)

```yaml
status: blocked
target_source: repository-root .env DATABASE_URL only
scratch_handle: opencode_restore_20260914_a0480be71c32
data_restore_mode: data-only
restore_attempts: 1
restore_exit_code: 1
restore_error_category: schema-conflict
restore_sqlstate: null
restore_sanitized_error: pg_restore emitted stderr classified as schema-conflict; raw stderr was not retained
restore_progress_redacted: captured-and-redacted
metadata_after: not-run-after-restore-failure
rowValuesRead: 0
current_target_touched: false
current_target_schema_writes: 0
current_target_data_writes: 0
persistent_side_effects:
  new_scratch_database_created: 0
  scratch_successful_restore_commit: not-established
  providers_called: 0
cleanup_state: official-client-processes-closed; scratch-retained; no-drop; no-retry
safe_next_action: Do not retry automatically; owner-authorized investigation of the resolved scratch handle is required.
risks:
  - Isolated data restore proof remains unavailable after the sole permitted attempt.
  - Post-failure metadata was not queried, preserving the read-only evidence boundary.
```

The exact prior scratch handle resolved without creating another database. The
single official data-only restore attempt failed before a successful restore
commit was established. The current target was not connected to or modified;
no migration, seed, provider, deployment, browser/device, Docker, or review
lifecycle action followed, and the retained scratch was not dropped.

## Authoritative Fresh Proof and Target Preflight: 2026-09-15

```yaml
status: blocked
target_source: repository-root .env DATABASE_URL only
node_env: development
explicit_confirmation: --confirm-development-target
static_gate: passed
backup_gate: passed
isolated_restore_gate: passed
restore_proof: {version: 1, mode: schema-only, tool_version: PostgreSQL 16.2, restore_exit_code: 0, metadata_table_count: 59, migration_table_present: true, rowValuesRead: 0}
scratch_restore: {status: passed, identifier: lscr-7e1bc950ec2c, retained_for_owner_cleanup: true}
preflight: {status: blocked, reason: missing-money-table}
migration: {status: not-started, selected: 20260911130000_tus_live_schema_conformance_repair, target_connections: 1, current_target_writes: 0, historical_replays: 0}
schema_acceptance: {status: not-run, expected: {tables: 62, money: 26, primary_keys: 68, indexes: 22, constraints: 3}, rowValuesRead: 0, liveConformance: false, noGo: true}
seed: not-run
pos_runtime: not-run
provider_calls: 0
cleanup_state: official-client-processes-closed; scratch-retained; owner-cleanup-required
launch_verdict: NO-GO
```

The accepted proof allowed the runner to reach the target preflight. The missing
money table blocked the repair before DDL, DML, marker insertion, acceptance,
seed, POS, provider, deployment, browser/device, Docker, or production activity.
Target schema and data writes remained zero.

## Fresh Bounded Read-Only Metadata Diagnosis: 2026-09-15

```yaml
status: blocked
target_source: repository-root .env DATABASE_URL only
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
pg_client: existing pg; one Client session
session: {isolation: REPEATABLE READ, read_only: true, timeout_seconds: 60, retry: false}
connection_attempts: 1
table_check: {expected_entries: 62, present_entries: 62, missing_entries: 0, unique_expected: 58, present_unique: 58, missing_unique: 0}
money_check: {expected: 26, present: 23, missing: 3, incorrect: 0, missing_tables: [TusSubscriptionPlan, TusBillingRefund, TusBillingLedger]}
primary_key_check: {expected: 68, present: 58, missing: 10, incorrect: 0, missing_tables: [TusBillingAccount, TusSubscriptionPlan, TusBillingRefund, TusBillingLedger, TusBillingIdempotency, TusBillingAudit, TusBillingOutbox, TusBillingDunning, TusBillingNumberSequence, TusAccountingExport]}
index_check: {expected: 22, present: 22, missing: 0, incorrect: 0}
constraint_check: {expected: 3, present: 3, missing: 0, incorrect: 0}
ledger_check:
  baseline_marker: {name: 20260909090000_tus_argentina_market_launch, count: 1}
  pos_repair_marker: {name: 20260911120000_tus_pos_index_constraint_repair, count: 1}
  conformance_marker: {name: 20260911130000_tus_live_schema_conformance_repair, count: 0}
  historical_marker: {name: 20260831180000_tus_additive_migration_repair, count: 0, intentionally_absent: true}
affected_table_counts:
  TusSubscriptionPlan: {status: table-missing, row_count: not-readable}
  TusBillingRefund: {status: table-missing, row_count: not-readable}
  TusBillingLedger: {status: table-missing, row_count: not-readable}
id_aggregates:
  status: permitted aggregate checks were not executable because all ten tables were absent
  row_values_read: 0
preflight_condition:
  source: scripts/tus-migration-repair-lib.mjs:1016-1024
  exact_condition: observed?.present !== true
  emitted_reason: missing-money-table
  first_contract: TusSubscriptionPlan.amountMinor
rowValuesRead: 0
persistent_side_effects: {current_target_schema_writes: 0, current_target_data_writes: 0, marker_writes: 0, ddl: 0, dml: 0}
cleanup_state: client-closed-transaction-rolled-back
liveConformance: false
noGo: true
```

The fresh session queried only public catalog metadata, known marker counts, the
three affected-table aggregate targets (which were absent), and the permitted PK
aggregate targets (also absent). It read no domain row values and performed no
DDL, DML, migration, seed, POS, provider, deployment, browser/device, Docker, or
review operation.

The `62/62` result is not contradictory: `REQUIRED_LIVE_SCHEMA_TABLE_ENTRIES`
contains the 62 launch/POS entries and four duplicate POS names, but it does not
contain the billing tables. The billing tables are introduced separately by the
conformance money and PK contracts. The prior `23/26` wording accurately showed
three failed money declarations but described them as missing columns; this fresh
catalog diagnosis shows the stronger underlying condition: the three table
objects themselves are absent. The source preflight checks table presence before
column presence, so it returns `missing-money-table` rather than
`exact-money-column-gate`.

No repair is safe to run from this receipt. The smallest safe next step is an
owner-authorized source/migration inventory reconciliation for the absent billing
tables, followed by a new read-only preflight; do not replay the historical
billing migration or infer money values.
