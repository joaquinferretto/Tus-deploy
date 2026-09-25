# TUS Live Schema Conformance Repair Backup Evidence

## Bounded Completion Session: 2026-09-14

```yaml
status: blocked
source_used: repository-root .env DATABASE_URL only
node_env: development
confirmation: --confirm-development-target
backup:
  status: passed
  tool: official PostgreSQL 16.2 pg_dump/pg_restore
  format: custom
  no_owner: true
  no_acl: true
  nonzero_size: true
  archive_list_exit_code: 0
  contents_read: false
  location: unique user-temp archive outside repository
isolated_restore:
  status: blocked
  scratch_identifier: lscr-ba813eed404b
  database_created: true
  first_restore: no successful exit within bounded process window
  diagnostic_retry: exit_1_against_partial_scratch
  metadata_only_table_count: 59
  row_values_read: 0
  restore_over_current: false
  destructive_cleanup: false
  owner_cleanup_required: true
side_effects:
  current_target_writes: 0
  scratch_database_creation: 1
  provider_calls: 0
```

The archive is preserved. Its contents, connection string, host, credential,
database name, row values, and process diagnostics were not emitted. The
isolated scratch is intentionally retained for the owner because destructive
cleanup was not authorized.

## Boundary

The backup gate is not a successful isolated restore gate. Current-target repair,
preflight, schema acceptance, seed, POS runtime, and production launch remain
blocked until a successful isolated restore proof and a fresh metadata receipt
are available.

## Prior Reported Fresh Isolated Restore Proof: 2026-09-14 (Historical)

```yaml
status: passed
source_used: repository-root .env DATABASE_URL only
backup_path: C:\Users\mmmau\AppData\Local\Temp\opencode\tus-live-schema-conformance-repair-current.dump
backup:
  format: custom
  pg_restore_list_exit_code: 0
  pg_restore_list_toc_entries: 265
  contents_read: false
  physical_table_entries: 59
  unique_table_names: 59
  expected_physical_tables: 59
  expected_unique_source_tables: 58
  expected_migration_table: public._prisma_migrations
  discrepancy: none; 58 unique source tables plus _prisma_migrations equals 59 physical tables; the 62-entry source array has four duplicate POS entries
tools:
  pg_dump: PostgreSQL 16.2
  pg_restore: PostgreSQL 16.2
  node: v22.23.2
  pg: 8.16.3
scratch:
  scratch_database_handle: opencode_restore_20260914_a0480be71c32
  create_status: created
  create_outside_transaction: true
  target_schema_or_data_changed: false
restore:
  command_shape: pg_restore --dbname=<redacted-scratch-URL> --format=custom --no-owner --no-acl --exit-on-error --single-transaction <backup_path>
  attempts: 1
  exit_code: 0
  error_category: null
  sqlstate: null
  stderr: captured; empty
  retry_performed: false
metadata:
  read_only: true
  physical_table_count: 59
  prisma_migrations_exists: true
  archive_and_scratch_table_names_match: true
  row_values_read: 0
side_effects:
  current_target_touched: authorized control connection only for CREATE DATABASE; no target schema or data operation
  current_target_writes: 0
  scratch_database_creation: 1
  scratch_retained: true
  repository_files_changed: 0
  provider_calls: 0
cleanup:
  clients_closed: true
  child_processes_closed: true
  temporary_proof_files_removed: true
  destructive_drop_used: false
```

The supplied archive passed custom-format validation and restored successfully
once into the retained scratch. Metadata-only names matched the archive at 59
physical tables, including `public._prisma_migrations`; no row values,
connection details, credentials, current-target database identifier, or PII
were emitted. The prior blocked attempt above remains preserved as historical
evidence. This proof does not authorize current-target repair, seed, providers,
deployment, browser/device work, Docker, or review lifecycle commands.

## Current Fresh Isolated Restore Session: 2026-09-14 (Authoritative)

```yaml
status: blocked
source_used: repository-root .env DATABASE_URL only
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
tools:
  pg_restore: PostgreSQL 16.2
  createdb: PostgreSQL 16.2
  psql: PostgreSQL 16.2
backup:
  path: C:\Users\mmmau\AppData\Local\Temp\opencode\tus-live-schema-conformance-repair-current.dump
  format: custom
  nonzero_size: true
  pg_restore_list_exit_code: 0
scratch:
  database_created: true
  create_outside_transaction: true
  identifier: <redacted>
  retained_for_owner_cleanup: true
restore:
  attempts: 1
  command_shape: pg_restore --no-owner --no-acl --exit-on-error --single-transaction --dbname=<redacted-scratch> <backup_path>
  exit_code: 1
  error_category: missing-dbname-or-file-option
  sqlstate: null
  sanitized_stderr: "pg_restore: error: una de las opciones -d/--dbname y -f/--file debe especificarse"
  retry_performed: false
metadata:
  status: not-run
  rowValuesRead: 0
current_target:
  schema_writes: 0
  data_writes: 0
  repair_migration_invocations: 0
  seed_writes: 0
  provider_calls: 0
cleanup:
  official_client_processes_closed: true
  pool_opened: false
  scratch_cleanup: owner_required_no_destructive_cleanup_performed
```

The single restore process invocation failed before contacting PostgreSQL because
the required database destination option was omitted. Per the session rule, no
restore retry was performed. The scratch database was created solely for this
proof and remains intact; the current target received only the authorized control
connection needed for scratch database creation and no schema or data operation.
Current-target preflight, repair, acceptance, seed, POS, provider, deployment,
browser/device, and Docker activity were not run.

## Fresh Corrected Isolated Restore Attempt: 2026-09-14 (Authoritative Correction)

```yaml
status: blocked
source_used: repository-root .env DATABASE_URL only
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
backup:
  status: passed
  format: custom
  nonzero_size: true
  pg_restore_list_exit_code: 0
  contents_read: false
tools: PostgreSQL 16.2 client bundle
scratch:
  database_created: true
  create_outside_transaction: true
  identifier: <redacted>
  retained_for_owner_cleanup: true
restore:
  attempts: 1
  command_shape: pg_restore --dbname=<redacted-scratch-URL> --no-owner --no-acl --exit-on-error --single-transaction <backup_path>
  outcome: timeout_after_60_seconds
  exit_code: unavailable_after_timeout
  stderr: empty
  retry_performed: false
metadata:
  status: not-run_after_restore_failure
  rowValuesRead: 0
current_target:
  control_connection_for_scratch_creation: true
  schema_writes: 0
  data_writes: 0
cleanup:
  clients_closed: true
  restore_processes_remaining: 0
  temporary_stderr_files_remaining: 0
  scratch_cleanup: owner_required_no_destructive_cleanup_performed
```

This correction used the required explicit `--dbname` destination and the backup
as the positional final argument. The single bounded invocation timed out with
empty captured stderr; it was not retried. Current-target repair was not reached.

## Fresh Bounded Schema-Only Restore Diagnostic: 2026-09-14 (Authoritative)

```yaml
status: passed
source_used: repository-root .env DATABASE_URL only
backup:
  format: custom
  pg_restore_list_exit_code: 0
  toc_entries: 265
  contents_read: false
scratch:
  database_created: true
  create_outside_transaction: true
  identifier: <redacted>
  retained_for_owner_cleanup: true
restore:
  mode: schema-only
  command_shape: pg_restore --dbname=<redacted-scratch-connection> --schema-only --no-owner --no-acl --exit-on-error --verbose <backup>
  attempts: 1
  exit_code: 0
  timeout_seconds: 60
  last_progress_redacted: pg_restore emitted progress
  error_category: null
  sqlstate: null
  sanitized_error: null
  retry_performed: false
metadata:
  read_only: true
  table_count: 59
  column_count: 608
  primary_key_count: 59
  index_count: 126
  constraint_count: 95
  row_values_read: 0
current_target:
  touched: false
  maintenance_control_connection_only: true
side_effects:
  scratch_database_creation: 1
  scratch_database_retained: true
  source_tests_modified: 0
  current_target_schema_writes: 0
  current_target_data_writes: 0
  providers_called: 0
cleanup:
  temporary_diagnostic_logs_removed: true
  pg_restore_processes_remaining: 0
  psql_processes_remaining: 0
  destructive_drop_used: false
```

This fresh evidence proves one successful schema-only restore into a retained
scratch database and a read-only metadata receipt. Prior full-restore timeout
evidence remains unchanged. No current-target repair, migration, seed, provider,
deployment, browser/device, Docker, or review lifecycle activity was performed.

## Bounded Data-Only Restore Attempt: 2026-09-14 (Authoritative Failure)

```yaml
status: blocked
source_used: repository-root .env DATABASE_URL only
backup_path: C:\Users\mmmau\AppData\Local\Temp\opencode\tus-live-schema-conformance-repair-current.dump
scratch_handle: opencode_restore_20260914_a0480be71c32
data_restore_mode: data-only
attempts: 1
timeout_seconds: 60
command_shape: pg_restore --dbname=<redacted-scratch-connection> --data-only --no-owner --no-acl --exit-on-error --single-transaction <backup_path>
exit_code: 1
progress_redacted: captured-and-redacted
error_category: schema-conflict
sqlstate: null
sanitized_error: pg_restore emitted stderr classified as schema-conflict; raw stderr was not retained
metadata_after: not-run-after-restore-failure
row_values_read: 0
current_target_touched: false
persistent_side_effects:
  current_target_writes: 0
  scratch_successful_restore_commit: not-established
  new_database_created: 0
cleanup_state:
  official_client_processes_closed: true
  scratch_retained: true
  destructive_drop_used: false
  retry_performed: false
safe_next_action: Do not retry automatically; investigate the resolved scratch handle with owner authorization before any future attempt.
risks:
  - The data-only restore proof remains blocked because the single permitted attempt reported a schema conflict.
  - Metadata after the failed attempt was intentionally not queried.
```

The exact retained scratch handle resolved successfully before the one allowed
restore attempt. The attempt used only the backup archive and the scratch
connection derived from the repository-root `.env`; the current target was not
connected to, restored to, or otherwise modified. No retry, scratch creation,
drop, migration, seed, provider, deployment, browser/device, Docker, or review
lifecycle operation was performed.

## Authoritative Fresh Backup and Restore Proof: 2026-09-15

```yaml
status: passed_before_target_preflight_block
source_used: repository-root .env DATABASE_URL only
backup:
  path: C:\Users\mmmau\AppData\Local\Temp\opencode\tus-live-schema-conformance-repair-20260915.dump
  format: custom
  nonzero_size: true
  pg_restore_list_exit_code: 0
  contents_read: false
tools:
  pg_dump: PostgreSQL 16.2
  pg_restore: PostgreSQL 16.2
restore_proof:
  path: C:\Users\mmmau\AppData\Local\Temp\opencode\tus-live-schema-conformance-repair-20260915-proof.json
  version: 1
  mode: schema-only
  scratch_identifier: lscr-7e1bc950ec2c
  database_created: true
  restore_exit_code: 0
  metadata_table_count: 59
  migration_table_present: true
  rowValuesRead: 0
  retained_for_owner_cleanup: true
side_effects:
  current_target_schema_writes: 0
  current_target_data_writes: 0
  provider_calls: 0
  destructive_cleanup: false
```

This is the first successful hash-bound isolated restore proof for the current
repair session. The archive and proof are preserved outside the repository. No
connection string, host, credential, database name, row value, or PII was
emitted. A preliminary wrapper echoed a `DATABASE_URL` assignment; its value is
not recorded here and must not be repeated.

The subsequent repair used the accepted proof and stopped at target preflight
with `missing-money-table`. No target schema/data write or migration invocation
occurred; the scratch database remains for owner-directed cleanup.
