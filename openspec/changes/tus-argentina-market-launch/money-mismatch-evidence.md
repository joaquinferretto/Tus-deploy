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
  transaction: "One read-only repeatable-read metadata transaction was attempted; no metadata receipt was accepted and the redacted failure was not retried."
  authorized_metadata_shapes: 5
  row_values_read: 0
  row_values_emitted: 0
  outcome: "The single bounded attempt ended in a redacted connection-or-query failure. No DDL, DML, migration, seed, provider, service, or application process was run."

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
  authorized_query_count: 5

psql_path: "C:\\Users\\mmmau\\Tools\\postgresql-client-16.2\\bin\\psql.exe"

live_columns:
  status: unavailable
  result: not-returned
  reason: "The current single attempt returned no accepted metadata receipt; no table names, column names, types, precision, scale, nullability, constraints, or indexes were read or invented."
  scope_requested: "All public columns with monetary names or numeric/float types, including table, column, type, precision, scale, and nullability metadata."
  row_values_read: 0
  row_values_emitted: 0

ledger:
  status: unavailable
  prisma_migrations_exists: unavailable
  public_table_count: unavailable
  reason: "The current single attempt returned no accepted ledger metadata receipt; the prior psql-absent probe also did not execute its ledger query."
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
  classification: live-database
  confidence: prior-bounded-preflight
  exact_live_identity: unresolved
  evidence: "The prior bounded development preflight recorded exact-money-type-mismatch before DDL in database-evidence.md and apply-progress.md. This single fresh metadata transaction produced no accepted receipt, so the exact live table and column remain unresolved."
  repository_schema: "not the mismatch source; static contract uses BigInt"
  selected_sql: "not the mismatch source; static launch and repair SQL use BIGINT"
  verifier_code: "the verifier is the fail-closed detector, not the live mismatch source; it rejects any present required money type other than bigint/int8"
  live_database: "prior preflight indicates an existing incompatible monetary column, but this run cannot identify it without a successful metadata receipt"
  historical_migration_replay: prohibited

safe_correction:
  status: blocked-until-exact-identity-and-approval
  minimum_lossless_shape: "After a separately authorized successful metadata-only diagnosis, use an additive BIGINT minor-unit shadow/cutover for the exact live table and column; do not rewrite or drop the source."
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
  psql_invocations: 0
  metadata_transaction_writes: 0

cleanup_state:
  status: verified
  owned_processes_remaining: 0
  database_cleanup: not-applicable-no-write-started
  backup: preserved-not-modified
  repository_files_changed: 1
  changed_file: openspec/changes/tus-argentina-market-launch/money-mismatch-evidence.md

risks:
  - "The current single metadata-only attempt ended in a redacted connection-or-query failure, so no fresh metadata receipt was possible."
  - "The prior exact requested PostgreSQL client executable was absent; that timeout/psql evidence is preserved above."
  - "Fresh live columns, constraint/index metadata, and ledger status remain unavailable."
  - "The prior mismatch classification is actionable evidence, but its exact live table and column identity remains unresolved."
  - "Losslessness cannot be asserted without values; no values were read by this diagnosis."
  - "Historical floating-point migrations remain prohibited from replay."
  - "The pre-existing dirty worktree was preserved; no application code was edited."

next_recommended: "Stop this probe. Do not retry in this run and do not run DDL or backfill. Resolve the redacted connection/query prerequisite in a separately authorized bounded metadata-only window, then identify the exact live column before designing any correction."

skill_resolution:
  apply: C:\Users\mmmau\.config\opencode\skills\sdd-apply\SKILL.md
  shared: C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md
  typescript: C:\Users\mmmau\.config\opencode\skills\curated\typescript\SKILL.md
  loaded: true
  code_edits: none
  probe: "one custom metadata-only Python/psycopg attempt; no repository probe script, service, provider, migration, seed, or application process"
