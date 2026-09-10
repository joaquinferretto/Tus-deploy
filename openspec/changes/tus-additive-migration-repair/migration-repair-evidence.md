# Migration Repair Evidence

status: external-blocked
executive_summary: "The historical backlog was inventoried and the selected additive baseline passed static gating. The bounded apply stopped before database connection because an operator-supplied restorable backup handle was not available."

artifacts:
  - path: "apps/api/prisma/migrations/20260831180000_tus_additive_migration_repair/migration.sql"
    status: created
  - path: "scripts/tus-migration-repair-lib.mjs"
    status: created
  - path: "scripts/tus-migration-repair.mjs"
    status: created
  - path: "tests/integration/tus/migration-repair.test.mjs"
    status: created
  - path: "openspec/changes/tus-additive-migration-repair/apply-progress.md"
    status: updated

migration_inventory:
  tag: static-migration-inventory
  total_entries: 26
  pending_historical_entries: 25
  destructive_statement_count: 19
  destructive_tokens: [CASCADE, DROP]
  truncate_statements: 0
  untagged_delete_statements: 0
  ambiguous_entries: 12
  comment_only_forbidden_tokens: 6
  historical_files_rewritten: 0
  selected_apply_path: "20260831180000_tus_additive_migration_repair"
  focused_test_result: "10 passed, 0 failed, 0 skipped"

safety_gate:
  tag: static-sql-gate
  selected_repair_sql: passed
  historical_unsafe_sql: rejected_as_unselected
  target:
    tag: authorized-remote-development
    node_env: development
    confirmation_flag: "--confirm-development-target"
    source: "repository-root .env DATABASE_URL only"
    output: redacted
  backup:
    status: blocked
    reason: restorable-backup-required
    output: metadata-only
  production: refused
  alternate_urls: none
  provider_calls: 0

connection_attempts:
  timeout_ms_per_attempt: 60000
  retry_count: 1
  max_attempts: 2
  attempts_recorded: 0
  third_attempt: prohibited
  result: "Not reached because the backup gate failed before connection."

migration_result:
  status: not-started
  applied_count: 0
  historical_migration_invocations: 0
  repair_marker: not-written
  ledger_rewrites: 0
  ledger_deletes: 0

schema_verification:
  tag: real-postgres-schema
  status: deferred
  required_table_count: 15
  verified_table_count: 0
  reason: "No database connection was allowed without a restorable backup handle."

durable_pos:
  tag: durable-pos
  status: external-blocked
  reason: "Deferred until schema proof; no API, web, mobile, browser, Docker, or watcher process was started."
  provider_calls: 0

side_effects:
  connections: 0
  successful_connections: 0
  writes: 0
  deletes: 0
  migration_invocations: 0
  seed_invocations: 0
  provider_calls: 0
  owned_children_started: 0
  listeners_created: 0

cleanup_state:
  status: not-started
  resources_created: 0
  pools_closed: 0
  owned_children_remaining: 0
  unknown_processes_killed: 0
  protected_pids_touched: 0

rollback:
  status: restore-not-needed-before-write
  metadata_only: true
  required_on_partial_database_ddl: true
  historical_migrations_preserved: true

risks:
  - "The remote-development target is reachable only as an operator-attested classification; no backup handle was supplied for this pass."
  - "The historical backlog contains 19 executable CASCADE/DROP statements and remains prohibited from replay."
  - "All live schema, tenant, POS, outbox, audit, replay, and isolation proof remains pending."

next_recommended: "Provide an operator-supplied restorable backup handle, rerun the same bounded additive apply, then perform the separately bounded POS rerun."

## Current Authorized Repair Attempt

```yaml
status: external-blocked
backup_state: passed
backup_handle: file:tus-argentina-market-launch-backup.dump
sql_gate:
  selected_file: apps/api/prisma/migrations/20260909090000_tus_argentina_market_launch/migration.sql
  files_scanned: 1
  statements_scanned: 124
  destructive_statements: 0
  ambiguous_statements: 0
  non_additive_statements: 0
  result: passed
target:
  node_env: development
  confirmation_flag: --confirm-development-target
  source: repository-root .env DATABASE_URL only
connection_attempts:
  count: 1
  timeout_ms_per_attempt: 60000
  retry_count_allowed: 1
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
  reason: schema-proof-not-reached-and-runtime-boundary-prohibited
side_effects:
  aggregate_catalog_preflight: 1
  writes: 0
  deletes: 0
  provider_calls: 0
  row_data_emitted: 0
cleanup_state:
  status: verified
  pools_closed: 1
  owned_children_remaining: 0
```

The target contains an existing monetary column whose type is incompatible with
the exact `BIGINT` launch requirement. The approved conversion planner was not
invoked because it requires an explicit approval identifier. Historical files
and ledger rows were untouched; no DDL began.

Tags retained: `static-migration-inventory`, `static-sql-gate`,
`authorized-remote-development`, `real-postgres-schema`, `durable-pos`.
`real-postgres-schema` and `durable-pos` remain incomplete evidence classes,
not success claims.
