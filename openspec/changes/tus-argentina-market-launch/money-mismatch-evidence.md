# Exact Money Mismatch Evidence

prior_failures:
  - status: connection-or-query-failed
    connection_attempts: 1
    timeout_seconds: 60
    retry_count: 0
    authorized_query_count: 2
    row_values_read: 0
    row_values_emitted: 0
    outcome: "Preserved prior redacted connection-or-query failure; no retry was performed."

status: connection-or-query-failed

current_attempt:
  status: connection-or-query-failed
  connection_attempts: 1
  timeout_seconds: 60
  retry_count: 0
  third_attempt: prohibited
  node_env: development
  explicit_development_confirmation: true
  source: repository-root .env DATABASE_URL only
  transaction: "One psql read-only repeatable-read metadata transaction was attempted; no metadata receipt was accepted and the redacted failure was not retried."
  query_scope: "information_schema.columns for public columns matching amount|total|price|fee|tax|balance|credit|debit|value|money|currency, plus _prisma_migrations existence/count only"
  authorized_query_count: 1
  metadata_query_attempts: 1
  psql_invocations: 2
  local_setup_note: "One option-rejected psql invocation opened no connection; the single valid metadata query then made the only connection attempt."
  row_values_read: 0
  row_values_emitted: 0
  failure_category: connection-unavailable
  outcome: "The single bounded psql attempt ended in the redacted connection-unavailable category before a metadata receipt. No DDL, DML, migration, seed, provider, service, or application process was run."

prior_psql_probe:
  status: psql-absent
  connection_attempts: 0
  timeout_seconds: 60
  retry_count: 0
  psql_path: "C:\\Users\\mmmau\\Tools\\postgresql-client-16.2\\bin\\psql.exe"
  outcome: "Preserved prior evidence: the exact requested executable was absent and that probe stopped before connection."

connection_attempts:
  count: 1
  timeout_seconds: 60
  retry_count: 0
  node_env: development
  explicit_development_confirmation: true
  source: repository-root .env DATABASE_URL only
  outcome: "One read-only metadata attempt ended in a redacted connection-or-query failure; no retry or third attempt."
  authorized_query_count: 1

psql_path: "C:\\Users\\mmmau\\AppData\\Local\\Temp\\opencode\\postgresql-client-16.2\\pgsql\\bin\\psql.exe"
psql_client_source: official-postgresql-16.2-windows-x64-binaries
psql_client_lifecycle: "Extracted for this session, used once, and removed during verified cleanup."

live_columns:
  status: unavailable
  result: not-returned
  reason: "The current single psql attempt returned no accepted metadata receipt; no table names, column names, types, precision, scale, or nullability were read or invented."
  scope_requested: "Public columns whose names match amount|total|price|fee|tax|balance|credit|debit|value|money|currency, returning table, column, type, precision, scale, and nullability only."
  row_values_read: 0
  row_values_emitted: 0

ledger:
  status: unavailable
  prisma_migrations_exists: unavailable
  prisma_migrations_count: unavailable
  reason: "The current single psql attempt returned no accepted ledger existence/count receipt; the prior psql-absent probe also did not execute its ledger query."
  row_values_read: 0
  row_values_emitted: 0

preflight_rule:
  verifier: "scripts/tus-migration-repair-lib.mjs:validatePreflight"
  exact_money_check: "If validateMoneyTypes(snapshot) is false, return status=blocked, writesAllowed=false, reason=exact-money-type-mismatch before any DDL."
  expected_postgresql_types: [bigint, int8]
  expected_prisma_types: "BigInt for monetary Prisma fields; no monetary Float fields"
  expected_sql_types: "BIGINT for launch and repair monetary declarations; integer rateBps for commission rates"
  live_input_required: "The verifier needs metadata snapshot types for every present required monetary column; this run did not obtain that snapshot."

static_expected_exact_money:
  prisma_schema: "apps/api/prisma/schema.prisma uses BigInt for price, amount, grossAmount, deductions, commissionableBase, commissionAmount, netAmount, providerAmount, invoice money, and minor-unit billing fields."
  repair_library: "REQUIRED_MONEY_TYPES in scripts/tus-migration-repair-lib.mjs requires bigint/int8 for the listed launch, POS, finance, and billing monetary columns."
  selected_launch_sql: "apps/api/prisma/migrations/20260909090000_tus_argentina_market_launch/migration.sql declares monetary columns as BIGINT."
  selected_repair_sql: "apps/api/prisma/migrations/20260831180000_tus_additive_migration_repair/migration.sql declares POS amount columns as BIGINT."
  historical_float_inventory: "Older historical migrations still contain DOUBLE PRECISION monetary declarations; they remain inventory-only and must not be replayed."

mismatch_location:
  classification: unresolved-redacted
  current_failure_category: connection-unavailable
  confidence: none-current-attempt
  exact_live_identity: unavailable
  evidence: "The single psql metadata attempt failed before a receipt, so this run cannot distinguish live schema, repository/repair verifier, or no mismatch. Prior bounded preflight evidence recorded exact-money-type-mismatch before DDL, but it is not fresh live-column identity evidence."
  repository_schema: "static contract expects BigInt; not attributable by this failed live probe"
  selected_sql: "static launch and repair SQL use BIGINT; not attributable by this failed live probe"
  verifier_code: "validatePreflight is the fail-closed detector and rejects present required money types other than bigint/int8; no fresh snapshot was obtained"
  live_database: "unresolved because the redacted connection-unavailable category occurred before metadata"
  historical_migration_replay: prohibited

safe_correction:
  status: blocked-until-successful-metadata-diagnosis-and-approval
  minimum_lossless_shape: "Do not correct from this redacted failure. After a separately authorized successful metadata-only diagnosis, use an additive BIGINT minor-unit shadow/cutover for the exact live table and column; do not rewrite or drop the source."
  required_validation:
    - currency scale and supported currency
    - fractional precision rejection
    - NaN, Infinity, and invalid-number rejection
    - signed-64-bit overflow bounds
    - restorable backup verification
    - explicit development confirmation
    - explicit approval identifier
  existing_rows_or_values: "Not determined; this probe read no data values."

side_effects:
  database_writes: 0
  ddl: 0
  dml: 0
  deletes: 0
  migrations_invoked: 0
  seeds_invoked: 0
  provider_calls: 0
  services_started: 0
  row_values_read: 0
  row_values_emitted: 0
  successful_fresh_connection: not-confirmed
  metadata_query_attempts: 1
  psql_invocations: 2
  metadata_transaction_writes: 0

cleanup_state:
  status: verified
  owned_processes_remaining: 0
  installer_directory_removed: true
  installer_archive_removed: true
  query_output_files_removed: true
  database_cleanup: not-applicable-no-write-started
  backup: preserved-not-modified
  repository_files_changed: 1
  changed_file: openspec/changes/tus-argentina-market-launch/money-mismatch-evidence.md

risks:
  - "The current single psql metadata attempt ended in the redacted connection-unavailable category, so no fresh metadata receipt was possible."
  - "The official PostgreSQL 16.2 client was session-local and was removed after the attempt; no persistent tool directory was changed."
  - "Fresh live columns and ledger existence/count remain unavailable."
  - "The prior mismatch classification is historical evidence only; its exact live table and column identity remains unresolved."
  - "Losslessness cannot be asserted without values; no values were read by this diagnosis."
  - "Historical floating-point migrations remain prohibited from replay."
  - "The pre-existing dirty worktree was preserved; no application code was edited."

next_recommended: "Stop this probe. Do not retry in this run and do not run DDL or backfill. Resolve the redacted connection-unavailable prerequisite in a separately authorized bounded metadata-only window, then identify the exact live column before designing any correction."

skill_resolution:
  shared: C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md
  loaded: true
  current_session: "shared instructions loaded; no implementation skill required"
  code_edits: none
  probe: "one official psql metadata-only attempt; no repository probe script, service, provider, migration, seed, or application process"

final_node_probe:
  status: failed
  runtime_path: "C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe"
  connection_attempts: 1
  timeout_seconds: 60
  retry_count: 0
  node_env: development
  explicit_development_confirmation: true
  source: repository-root .env DATABASE_URL only
  client: "installed pg dependency resolved from apps/api"
  query_scope: "information_schema.columns for public columns matching amount|total|price|fee|tax|balance|credit|debit|value|money|currency, including table/column names, data_type, udt_name, numeric precision/scale, nullability, plus _prisma_migrations existence/count only"
  error_category: query
  live_columns:
    status: unavailable
    result: not-returned
    reason: "The single Node pg metadata query failed after connection; no metadata receipt was accepted and no columns were invented."
    row_values_read: 0
    row_values_emitted: 0
  ledger:
    status: unavailable
    prisma_migrations_exists: unavailable
    prisma_migrations_count: unavailable
    reason: "The single metadata query failed before returning its metadata result."
  mismatch_location:
    status: unresolved
    expected_types: [bigint, int8]
    exact_live_identity: unavailable
    evidence: "This failed query-only probe cannot distinguish live schema, verifier/repository, or no mismatch; no live column/type mismatch is asserted."
  safe_correction:
    status: blocked
    rule: "Do not correct or infer a live mismatch from this failure. No DDL, DML, migration, or backfill is authorized."
  side_effects:
    database_writes: 0
    ddl: 0
    dml: 0
    migrations_invoked: 0
    seeds_invoked: 0
    provider_calls: 0
    services_started: 0
    browser_or_docker_started: 0
    row_values_read: 0
    row_values_emitted: 0
    retries: 0
    metadata_query_attempts: 1
    connection_client_ended: true
  cleanup_state:
    status: verified
    temporary_probe_file_removed: true
    owned_processes_remaining: 0
    database_cleanup: not-applicable-no-write-started
    backup: preserved-not-modified
    repository_files_changed: 1
    changed_file: openspec/changes/tus-argentina-market-launch/money-mismatch-evidence.md
  risks:
    - "The single Node metadata query failed with redacted category query after connection; no live metadata receipt exists."
    - "The failed probe cannot identify the live money column or establish value losslessness."
    - "Prior exact-money mismatch evidence remains historical and is not promoted to fresh live-column identity."
    - "Historical floating-point migrations remain prohibited from replay."
  next_recommended: "Stop this probe. Resolve the redacted query prerequisite in a separately authorized metadata-only window; do not run DDL, DML, migration, seed, or backfill."
  skill_resolution:
    shared: C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md
    loaded: true
    code_edits: none

## Corrective Retry: Verifier Absence Handling

```yaml
status: blocked
retry: one-and-only-corrective-retry
root_cause: validateMoneyTypes treated every metadata placeholder for an absent required table as an existing money table and rejected undefined column types
correction: only present:true required money tables are type-checked; present tables still fail closed when a required type is missing or not bigint/int8
regression_tests:
  absent_current_money_columns: passed
  incompatible_existing_money_column: passed
static_sql_gate:
  statements: 125
  destructive: 0
  ambiguous: 0
  unsafe_alter: false
  exact_money: passed
backup_gate:
  status: passed
  handle: file:tus-argentina-market-launch-backup.dump
  pg_restore_list_exit: 0
  contents_read: false
target:
  node_env: development
  explicit_development_confirmation: true
  source: repository-root .env DATABASE_URL only
preflight:
  status: passed
  connection_attempts: 1
  timeout_seconds: 60
  retry_count: 0
migration:
  status: blocked
  transaction_attempted: true
  failure: repair-operation-failed-restore-required
  persistent_ddl_after_failure: 0
  historical_migrations_invoked: 0
post_failure_metadata:
  public_table_count: 1
  current_public_money_column_count: 0
  prisma_migrations_present: false
  row_values_read: 0
seed: deferred
side_effects:
  database_writes: 0
  ddl_persisted: 0
  dml: 0
  provider_calls: 0
  row_values_read: 0
  row_values_emitted: 0
cleanup_state: verified
next_recommended: resolve-blockers
liveConformance: false
```

The preflight classification is corrected without weakening the incompatible
type guard or hardcoding a target. The selected launch SQL was not persisted by
the failed transaction, and no seed or second repair retry was attempted. The
runtime failure remains redacted because the repair CLI intentionally does not
emit connection or database error details.

## Fresh Repair Preflight Classification

```yaml
status: blocked
operation: existing-safe-migration-repair-preflight
static_sql_gate:
  selected_file: apps/api/prisma/migrations/20260909090000_tus_argentina_market_launch/migration.sql
  statements_scanned: 125
  destructive_statements: 0
  ambiguous_statements: 0
  unsafe_alter: false
  exact_money_sql: passed
  classification: additive-only-baseline
backup_gate:
  status: passed
  handle: file:tus-argentina-market-launch-backup.dump
  nonzero_size: true
  pg_restore_format: custom
  pg_restore_list_exit: 0
target:
  node_env: development
  explicit_development_confirmation: true
  source: repository-root .env DATABASE_URL only
preflight:
  status: blocked
  verifier: scripts/tus-migration-repair-lib.mjs:validatePreflight
  reason: exact-money-type-mismatch
  connection_attempts: 1
  timeout_seconds: 60
  retry_count: 0
  third_attempt: prohibited
comparison_to_fresh_metadata:
  live_public_column_count: 10
  current_public_money_matching_columns: 0
  prisma_migrations_exists: false
  public_table_count: 1
  row_values_read: 0
  conclusion: prior_or_verifier_classification_not_mapped_to_current_live_column
```

The repair tool classified preflight as `exact-money-type-mismatch` after one
bounded connection, but the current metadata-only receipt has no matching live
monetary-looking column. This is not treated as proof of a live mismatch and no
source correction, conversion plan, DDL, DML, migration, or backfill was run.
The operation stopped before schema verification and seed.

final_bounded_node_diagnostic:
  status: success
  runtime_path: "C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe"
  connection_attempts: 1
  failed_step: null
  sqlstate: null
  sanitized_error: null
  connectivity: success
  node_env: development
  explicit_confirmation_context: "explicit-development-read-only-metadata-diagnostic"
  source: repository-root .env DATABASE_URL only
  session: "one pg Client connection; sequential A, B, C, D; no retry"
  column_count: 10
  live_columns: []
  live_columns_result: "No public column names matched amount|total|price|fee|tax|balance|credit|debit|value|money|currency; no table, column, type, precision, scale, or nullability row values were emitted."
  ledger:
    has_prisma_migrations: false
    public_table_count: 1
  mismatch_location:
    status: no-matching-money-columns
    expected_types: [bigint, int8]
    exact_live_money_columns: []
    comparison: "C and D succeeded; no live matching money column was available for a bigint/int8 mismatch. The prior mismatch remains historical and is not attributed to a live column by this receipt."
  safe_correction: "No correction indicated by this metadata comparison; keep fail-closed launch gates and do not run DDL, DML, migration, or backfill from this receipt."
  side_effects:
    database_writes: 0
    ddl: 0
    dml: 0
    migrations: 0
    seeds: 0
    providers: 0
    services: 0
    browser: 0
    docker: 0
    deployment: 0
    row_values_read: 0
    row_values_emitted: 0
    retries: 0
  cleanup_state: "verified; one client session ended; no temporary files or owned processes created"
  risks:
    - "Metadata-only evidence does not prove row-value losslessness or application behavior."
    - "The live public schema currently exposes no matching money column, so the historical mismatch cannot be mapped to a current live column."
  next_recommended: "Preserve this receipt; do not run migrations, DDL, DML, seed, providers, services, browser, Docker, deployment, or review commands in this diagnostic."
  skill_resolution:
    shared: C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md
    loaded: true
    code_edits: none
