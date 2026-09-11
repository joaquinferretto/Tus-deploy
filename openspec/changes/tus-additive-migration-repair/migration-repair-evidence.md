# Migration Repair Evidence

status: external-blocked
executive_summary: "The historical backlog was inventoried and the selected additive baseline passed static gating. The bounded apply stopped before database connection because an operator-supplied restorable backup handle was not available."

artifacts:
  - path: "apps/api/prisma/migrations/20260831180000_tus_additive_migration_repair/migration.sql"
    status: created
  - path: "apps/api/prisma/migrations/20260911120000_tus_pos_index_constraint_repair/migration.sql"
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

## Narrow Currency-Check Repair Attempt

```yaml
status: blocked
root_cause: selected launch SQL statement 60 included TusReconciliationRecord in a dynamic currency-check list although the table has providerAmount BIGINT and no currency column
changed_files:
  - apps/api/prisma/migrations/20260909090000_tus_argentina_market_launch/migration.sql
  - tests/integration/tus/migration-repair.test.mjs
source_change: removed only TusReconciliationRecord from the dynamic currency-check table list; providerAmount and all other money declarations unchanged
regression: RED 20/21; GREEN 21/21; exact-money and additive-only gates preserved
static_sql_gate:
  status: passed
  statements: 125
  destructive: 0
  ambiguous: 0
  exact_money: passed
backup_gate:
  status: passed
  custom_format: true
  pg_restore_list_exit: 0
  contents_read: false
target:
  node_env: development
  confirmation_flag: --confirm-development-target
  source: repository-root .env DATABASE_URL only
preflight:
  status: passed
  connection_attempts: 1
  retries_used: 0
migration:
  status: committed-before-schema-verification-failure
  invocations: 1
  marker: 20260909090000_tus_argentina_market_launch
  historical_invocations: 0
  deletes: 0
schema_verification:
  status: blocked
  required_tables_present: true
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
seed: deferred
provider_calls: 0
liveConformance: false
```

The failed operation is categorized as `schema-verification-failed` without a
SQLSTATE because the verifier rejected missing metadata after the additive
transaction committed. No second migration attempt, seed, provider, runtime,
or restore-over-current-target operation was performed.

## POS Index / Constraint Repair Attempt

```yaml
status: blocked-before-connection
repair_migration: apps/api/prisma/migrations/20260911120000_tus_pos_index_constraint_repair/migration.sql
prerequisite_marker: 20260909090000_tus_argentina_market_launch
scope: exact-missing-delivery-pos-indexes-and-constraints-only
static_sql_gate:
  statements_scanned: 26
  destructive_statements: 0
  ambiguous_statements: 0
  exact_money_sql: passed
  result: passed
backup_gate:
  status: blocked
  reason: backup-file-unavailable
  contents_read: false
target:
  node_env: development
  confirmation_flag: --confirm-development-target
  source: repository-root .env DATABASE_URL only
connection_attempts:
  count: 0
  timeout_ms_per_attempt: 60000
  retry_count_allowed: 1
  third_attempt: prohibited
repair_result:
  status: not-started
  ddl: 0
  dml: 0
  ledger_mutations: 0
  historical_migrations_invoked: 0
schema_verification:
  status: deferred
  reason: backup-gate-before-connection
latest_accepted_metadata:
  required_tables_present: true
  missing_columns: 0
  money_type_mismatches: 0
  missing_indexes: 22
  missing_constraints: 3
  launch_marker_present: true
  row_values_read: 0
seed:
  status: deferred
  reason: schema-verification-not-reached
durable_pos:
  status: deferred
  provider_calls: 0
cleanup_state:
  status: verified-no-owned-resources
```

The new repair unit is additive-only and idempotent: it creates the exact
Prisma-derived index names/column order and adds only the three absent
catalog-guarded constraints, then records its own marker without touching the
existing launch marker. The bounded live invocation stopped at the backup gate
because the redacted handle supplied for this session was not a locally
verifiable artifact. No connection, schema write, seed, provider, or runtime
process was started. Tasks `3.2` and `3.3` remain incomplete.

## Latest Bounded POS Repair Attempt

```yaml
status: blocked
repair_migration: apps/api/prisma/migrations/20260911120000_tus_pos_index_constraint_repair/migration.sql
scope: exact-missing-delivery-pos-indexes-and-constraints-only
backup_gate:
  status: passed
  format: custom
  pg_restore_list_exit: 0
  contents_read: false
  existing_backup_overwritten: false
target:
  node_env: development
  confirmation_flag: --confirm-development-target
  source: repository-root .env DATABASE_URL only
  alternate_urls: none
connection_attempts:
  count: 1
  timeout_ms_per_attempt: 60000
  retry_count: 0
  third_attempt: prohibited
preflight:
  status: passed
  baseline_marker_count: 1
  repair_marker_before_apply: 0
  row_values_read: 0
static_sql_gate:
  statements_scanned: 26
  destructive_statements: 0
  ambiguous_statements: 0
  exact_money_sql: passed
repair_result:
  status: committed-before-schema-verification-failure
  transaction: controlled additive transaction
  repair_marker_count: 1
  historical_migrations_invoked: 0
  baseline_replayed: false
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
  category: schema-verification-failed
rollback:
  status: not-performed
  reason: post-commit metadata failure; destructive down SQL and restore-over-current-target prohibited
seed:
  status: deferred
  provider_calls: 0
durable_pos:
  status: external-blocked
  provider_calls: 0
cleanup_state:
  status: verified
  pool_closed: true
  owned_processes_remaining: 0
liveConformance: false
```

The runner stopped at schema verification. No second repair, restore-over-current
operation, destructive rollback, seed, POS runtime, provider, browser, Docker,
deployment, or review command was run. The missing catalog objects and the
post-commit repair marker require a separately authorized correction plan; this
session does not claim live schema success or production readiness.

## Latest Read-Only POS Metadata Comparison

```yaml
status: blocked
operation: one-bounded-read-only-postgresql-metadata-comparison
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
node_env: development
explicit_confirmation_context: --confirm-development-target
source: repository-root .env DATABASE_URL only
connection_attempts: 1
retry_count: 0
third_attempt: prohibited
session: one pg Client connection; repeatable-read read-only transaction; rolled back
query_scope: information_schema.tables and pg_catalog.pg_index/pg_constraint only
row_values_read: 0
catalog_table_scope: 58/58 current REQUIRED_LAUNCH_TABLES plus repair tables present; this scope is not directly comparable to the prior runner receipt's 62/62 aggregate
expected_indexes:
  - {identifier: TusDeliveryZone_tenantId_active_idx, table: TusDeliveryZone, columns: [tenantId, active], unique: false, predicate: null}
  - {identifier: TusDeliveryShift_tenantId_zoneId_status_idx, table: TusDeliveryShift, columns: [tenantId, zoneId, status], unique: false, predicate: null}
  - {identifier: TusDeliveryTask_tenantId_commitmentId_idx, table: TusDeliveryTask, columns: [tenantId, commitmentId], unique: false, predicate: null}
  - {identifier: TusDeliveryTask_tenantId_shiftId_status_idx, table: TusDeliveryTask, columns: [tenantId, shiftId, status], unique: false, predicate: null}
  - {identifier: TusDeliveryTask_tenantId_commitmentId_status_idx, table: TusDeliveryTask, columns: [tenantId, commitmentId, status], unique: false, predicate: null}
  - {identifier: TusDeliveryProof_tenantId_taskId_idx, table: TusDeliveryProof, columns: [tenantId, taskId], unique: false, predicate: null}
  - {identifier: TusDeliveryIncident_tenantId_taskId_status_idx, table: TusDeliveryIncident, columns: [tenantId, taskId, status], unique: false, predicate: null}
  - {identifier: TusDeliveryAudit_tenantId_auditId_key, table: TusDeliveryAudit, columns: [tenantId, auditId], unique: true, predicate: null}
  - {identifier: TusDeliveryAudit_tenantId_createdAt_idx, table: TusDeliveryAudit, columns: [tenantId, createdAt], unique: false, predicate: null}
  - {identifier: TusPosOperation_tenantId_shiftId_createdAt_idx, table: TusPosOperation, columns: [tenantId, shiftId, createdAt], unique: false, predicate: null}
  - {identifier: TusPosOperation_tenantId_context_kind_idx, table: TusPosOperation, columns: [tenantId, context, kind], unique: false, predicate: null}
  - {identifier: TusPosReceipt_tenantId_operationId_idx, table: TusPosReceipt, columns: [tenantId, operationId], unique: false, predicate: null}
  - {identifier: TusPosReceipt_tenantId_operationId_createdAt_idx, table: TusPosReceipt, columns: [tenantId, operationId, createdAt], unique: false, predicate: null}
  - {identifier: TusPosDevice_tenantId_status_idx, table: TusPosDevice, columns: [tenantId, status], unique: false, predicate: null}
  - {identifier: TusPosSession_tenantId_deviceId_shiftId_status_idx, table: TusPosSession, columns: [tenantId, deviceId, shiftId, status], unique: false, predicate: null}
  - {identifier: TusPosConflict_tenantId_operationId_status_idx, table: TusPosConflict, columns: [tenantId, operationId, status], unique: false, predicate: null}
  - {identifier: TusPosConflict_tenantId_status_createdAt_idx, table: TusPosConflict, columns: [tenantId, status, createdAt], unique: false, predicate: null}
  - {identifier: TusPosVersion_tenantId_shiftId_version_idx, table: TusPosVersion, columns: [tenantId, shiftId, version], unique: false, predicate: null}
  - {identifier: TusDeliveryOutbox_tenantId_status_createdAt_idx, table: TusDeliveryOutbox, columns: [tenantId, status, createdAt], unique: false, predicate: null}
  - {identifier: TusPosOutbox_tenantId_status_createdAt_idx, table: TusPosOutbox, columns: [tenantId, status, createdAt], unique: false, predicate: null}
  - {identifier: TusPosOutbox_tenantId_aggregateId_status_idx, table: TusPosOutbox, columns: [tenantId, aggregateId, status], unique: false, predicate: null}
  - {identifier: TusPosAudit_tenantId_operationId_createdAt_idx, table: TusPosAudit, columns: [tenantId, operationId, createdAt], unique: false, predicate: null}
present_indexes: 22/22 exact identifier, column order, uniqueness, and null predicate
missing_indexes: []
expected_constraints:
  - {identifier: TusPosConflict_tenant_operation_fk, table: TusPosConflict, type: f, definition: 'FOREIGN KEY ("tenantId", "operationId") REFERENCES "TusPosOperation" ("tenantId", "operationId") NOT VALID'}
  - {identifier: TusPosOperation_amount_non_negative_check, table: TusPosOperation, type: c, definition: 'CHECK ((amount >= 0))'}
  - {identifier: TusPosVersion_version_non_negative_check, table: TusPosVersion, type: c, definition: 'CHECK ((version >= 0))'}
present_constraints:
  - {identifier: TusPosConflict_tenant_operation_fk, status: present, observed_definition: 'FOREIGN KEY ("tenantId", "operationId") REFERENCES "TusPosOperation"("tenantId", "operationId") NOT VALID'}
missing_constraints:
  - {identifier: TusPosOperation_amount_non_negative_check, status: incorrect_shape, observed_definition: 'CHECK (amount >= 0)'}
  - {identifier: TusPosVersion_version_non_negative_check, status: incorrect_shape, observed_definition: 'CHECK (version >= 0)'}
catalog_present_nonmatching_constraints: 2
repair_sql_coverage:
  migration: 20260911120000_tus_pos_index_constraint_repair
  status: source-complete
  index_statements: 22/22 present
  constraint_statements: 3/3 present
  marker_insert_statement: present
  skipped_statements: none proven by the catalog comparison
  incorrect_statements: the two check statements exist in source and named catalog constraints exist, but their catalog shape does not match the verifier's double-parenthesized expected definition
ledger_marker:
  status: not-read-by-design
  expected_source_marker: 20260911120000_tus_pos_index_constraint_repair
  source_insert_statement: present
  current_database_marker_value: not queried; _prisma_migrations row values are outside this metadata-only scope
root_cause_hypotheses:
  - The prior 62/62 result measured required table presence; it did not prove the independent 22-index/3-constraint catalog contract.
  - The prior 14/22 and 2/3 receipt is a different earlier snapshot; source/evidence does not identify an intervening actor or prove when the now-present indexes appeared.
  - The current verifier compares normalized constraint text without removing redundant parentheses, so the two semantically equivalent check definitions are classified as shape-incompatible.
safe_next_action: Do not rerun repair or run seed/POS; create a separately authorized correction plan for the two constraint-shape contracts and reconcile the marker without reading ledger rows.
persistent_side_effects: {database_writes: 0, ddl: 0, dml: 0, migration_invocations: 0, provider_calls: 0}
cleanup_state: verified; read-only transaction rolled back and client closed
risks:
  - This comparison did not query _prisma_migrations, so current marker presence is not freshly asserted from a row value.
  - Metadata-only evidence does not prove row-value losslessness or application/runtime behavior.
  - liveConformance remains false and NO-GO remains authoritative.
```

The current catalog receipt supersedes neither the earlier receipt nor its audit
history: it records a new read-only point-in-time comparison. The supported
inconsistency is dimensional and temporal: table presence can be 62/62 while
index/constraint completeness fails, and the current code's 58-table comparison
scope is not the same aggregate used by the earlier 62/62 runner receipt.

## Verifier-Only Correction Session

```yaml
status: external-blocked
operation: normalize-redundant-postgresql-check-parentheses-only
root_cause: verifier compared compact CHECK text literally while PostgreSQL rendered equivalent outer-parenthesis forms
changed_files:
  - scripts/tus-migration-repair-lib.mjs
  - tests/integration/tus/migration-repair.test.mjs
normalization: whitespace and redundant outer parentheses within CHECK bodies only; names and predicate semantics remain exact
tdd: {red: "25/26", green: "26/26", refactor: "26/26"}
focused_tests: {migration_repair: "26 passed", finance_regression: "48 passed"}
api_typecheck: passed
api_lint: passed
static_checks: {git_diff_check: passed, prisma_schema_validate: passed}
metadata_verification:
  status: blocked
  attempts: 1
  retry_count: 0
  third_attempt: prohibited
  source: repository-root .env DATABASE_URL only
  node_env: development
  explicit_confirmation: true
  operation: read-only metadata transaction; rollback/client cleanup verified
  failure: metadata-schema-verification-failed-redacted
  row_values_read: 0
  database_writes: 0
  ddl: 0
  dml: 0
seed: deferred
provider_calls: 0
liveConformance: false
```

The one allowed metadata-only verification attempt did not produce an accepted
receipt. No retry, migration replay, DDL/DML, seed, restore, provider, runtime,
or production-readiness claim followed the failure.

## Fresh Integrated Schema-Verifier Diagnosis

```yaml
status: blocked
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
connection_attempts: 1
failed_stage: diagnostic_contract_resolution
sqlstate: null
sanitized_error_category: diagnostic-contract-resolution-failed
sanitized_error: "Local snapshot-contract resolution failed after the read-only metadata transaction; no PostgreSQL error details, identifiers, or connection details were retained."
table_check: {status: attempted-no-stage-receipt}
money_check: {status: attempted-no-stage-receipt}
index_check: {status: attempted-no-stage-receipt}
constraint_check: {status: attempted-no-stage-receipt}
ledger_check: {status: attempted-no-stage-receipt, row_values_returned: 0}
pos_check: {status: attempted-no-stage-receipt}
integrated_verifier_cause:
  category: diagnostic-contract-resolution-failed
  status: not-invoked
  reason: "The in-memory diagnostic wrapper searched for a non-exported declaration marker while the current repair library declares the contract as export const."
row_values_read: 0
persistent_side_effects: {database_writes: 0, ddl: 0, dml: 0, migration_invocations: 0, seed_invocations: 0, provider_calls: 0, row_values_read: 0}
cleanup_state: {transaction_rolled_back: true, client_released: true, pool_closed: true, owned_processes_remaining: 0}
safe_next_action: "Do not infer a live schema result or retry this diagnosis; separately authorize a corrected bounded metadata-only pass before any DDL or migration."
risks:
  - "No accepted fresh table, money, index, constraint, ledger-count, or POS-completeness receipt was emitted."
  - "The prior verifier-normalization evidence remains preserved and liveConformance remains false."
```

The single session used only the root `.env` `DATABASE_URL`, development mode,
explicit confirmation, the persistent Node runtime, and the installed `pg`
dependency. It entered one repeatable-read read-only transaction, attempted the
isolated catalog stages, rolled back, and closed the client/pool. The local
contract-resolution failure occurred after database cleanup; no source or test
file was changed and no mutation path was invoked.

## Single Bounded Metadata Verification: Blocked Local Contract

```yaml
status: blocked
operation: one-bounded-read-only-live-schema-verification
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
receipt_version: tus-live-schema-verification/v1
connection_attempts: 1
retry_count: 0
third_attempt: prohibited
source: repository-root .env DATABASE_URL only
node_env: development
explicit_confirmation: --confirm-development-target
table_check:
  status: passed
  expected_entries: 62
  unique_expected_names: 58
  present_entries: 62
  missing_table_names: []
  missing_expected_columns: []
  primary_key_failures: []
money_check:
  status: blocked
  expected_money_columns: 26
  queried_money_columns: 23
  exact_bigint_queried: 23
  unqueried_source_money_tables: [TusSubscriptionPlan, TusBillingRefund, TusBillingLedger]
  reason: local_metadata_query_scope_omitted_three_source_money_tables
index_check: {status: not-issued-after-local-contract-failure}
constraint_check: {status: not-issued-after-local-contract-failure}
ledger_check: {status: not-issued-after-local-contract-failure, row_values_returned: 0}
row_values_read: 0
overall_schema_conformance: {status: not-established, metadata_only: true}
integrated_verifier_exercised: {status: not-invoked, verifier: verifySchemaSnapshot}
persistent_side_effects: {database_writes: 0, ddl: 0, dml: 0, migration_invocations: 0, provider_calls: 0, row_values_read: 0}
cleanup_state: {transaction_rolled_back: true, client_released: true, session_closed: true, owned_processes_remaining: 0}
risks:
  - "The table receipt is valid for the queried 62-entry launch/POS contract, but no claim is made for the three omitted source money tables."
  - "No accepted index, constraint, marker-count, integrated-verifier, row-data, runtime, or production-readiness claim was produced."
safe_next_action: "Do not retry this run or invoke repair/apply; authorize a separately corrected metadata-only pass only if a fresh receipt is required."
skill_resolution: {shared: loaded, typescript: loaded, codegraph: fallback-after-upstream-cli-unavailable}
```

The single direct `pg.Client` session used one repeatable-read read-only
transaction and rolled back before closing. The local verifier stopped after
the table and partial money stages because its metadata query had been scoped
to the 62 table entries but not the three additional money-table declarations
present in the current repair source. This is a verifier-scope failure, not
evidence of a live money-type mismatch. No retry was made under the requested
one-session/no-retry boundary, and no repair/apply CLI or mutation-capable
wrapper was invoked.

## Complete Bounded Metadata Receipt

```yaml
status: complete-nonconformant
operation: one-bounded-read-only-live-schema-verification
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
connection_attempts: 1
retry_count: 0
third_attempt: prohibited
receipt_version: tus-live-schema-verification/v1
source: repository-root .env DATABASE_URL only
node_env: development
explicit_confirmation: --confirm-development-target
contract_source:
  status: resolved
  module: scripts/tus-migration-repair-lib.mjs
  source_artifacts: [current exported contract constants, current migration SQL, current Prisma schema]
  missing_exports: []
  required_constraints_exported: false
  required_constraints_parsed_from_current_source: 9
  table_entries: 62
  unique_table_names: 58
  money_columns: 26
  money_tables: 17
  repair_indexes: 22
  repair_constraints: 3
  primary_key_tables: 68
table_check:
  status: passed
  expected: [TusTenant, User, Account, Session, Membership, TenantRole, TusMerchant, TusProduct, TusService, TusListing, TusInventory, TusCalendar, TusCalendarRule, TusCalendarException, TusBooking, TusCommitment, TusCommitmentTransition, TusCommitmentCompensation, TusMarketplaceCommitment, TusPaymentIntent, TusPaymentWebhookEvent, TusCommissionSnapshot, TusLedgerEntry, TusFinancialEvidence, TusFinancialConfirmation, TusFinancialFreeze, TusReconciliationRecord, TusWhatsAppConsent, TusWhatsAppMessage, TusWhatsAppWebhookEvent, TusInvoice, TusInvoiceLine, TusCreditNote, TusSubscription, TusTaxProfile, AuditEvent, TusMarketplaceAudit, TusDeliveryAudit, TusPosAudit, TusWhatsAppAudit, OutboxEvent, TusDeliveryOutbox, TusPosOutbox, TusSupportOutbox, TusJob, TusDeadLetter, TusHardeningFixture, TusDeliveryZone, TusDeliveryShift, TusDeliveryTask, TusDeliveryProof, TusDeliveryIncident, TusDeliveryAudit, TusPosOperation, TusPosReceipt, TusPosDevice, TusPosSession, TusPosConflict, TusPosVersion, TusDeliveryOutbox, TusPosOutbox, TusPosAudit]
  present: [TusTenant, User, Account, Session, Membership, TenantRole, TusMerchant, TusProduct, TusService, TusListing, TusInventory, TusCalendar, TusCalendarRule, TusCalendarException, TusBooking, TusCommitment, TusCommitmentTransition, TusCommitmentCompensation, TusMarketplaceCommitment, TusPaymentIntent, TusPaymentWebhookEvent, TusCommissionSnapshot, TusLedgerEntry, TusFinancialEvidence, TusFinancialConfirmation, TusFinancialFreeze, TusReconciliationRecord, TusWhatsAppConsent, TusWhatsAppMessage, TusWhatsAppWebhookEvent, TusInvoice, TusInvoiceLine, TusCreditNote, TusSubscription, TusTaxProfile, AuditEvent, TusMarketplaceAudit, TusDeliveryAudit, TusPosAudit, TusWhatsAppAudit, OutboxEvent, TusDeliveryOutbox, TusPosOutbox, TusSupportOutbox, TusJob, TusDeadLetter, TusHardeningFixture, TusDeliveryZone, TusDeliveryShift, TusDeliveryTask, TusDeliveryProof, TusDeliveryIncident, TusDeliveryAudit, TusPosOperation, TusPosReceipt, TusPosDevice, TusPosSession, TusPosConflict, TusPosVersion, TusDeliveryOutbox, TusPosOutbox, TusPosAudit]
  missing: []
  incorrect: []
  expected_entries: 62
  unique_expected_names: 58
  present_entries: 62
  missing_expected_columns: []
  primary_key_failures: []
money_check:
  status: failed
  expected: [TusListing.price, TusCommitment.amount, TusCommitmentCompensation.amount, TusMarketplaceCommitment.amount, TusPaymentIntent.amount, TusCommissionSnapshot.grossAmount, TusCommissionSnapshot.deductions, TusCommissionSnapshot.commissionableBase, TusCommissionSnapshot.commissionAmount, TusCommissionSnapshot.netAmount, TusLedgerEntry.amount, TusReconciliationRecord.providerAmount, TusPosOperation.amount, TusPosReceipt.amount, TusInvoice.subtotal, TusInvoice.taxAmount, TusInvoice.feeAmount, TusInvoice.total, TusInvoiceLine.unitMinor, TusInvoiceLine.taxMinor, TusInvoiceLine.totalMinor, TusCreditNote.amountMinor, TusSubscription.amountMinor, TusSubscriptionPlan.amountMinor, TusBillingRefund.amountMinor, TusBillingLedger.amountMinor]
  present: [TusListing.price, TusCommitment.amount, TusCommitmentCompensation.amount, TusMarketplaceCommitment.amount, TusPaymentIntent.amount, TusCommissionSnapshot.grossAmount, TusCommissionSnapshot.deductions, TusCommissionSnapshot.commissionableBase, TusCommissionSnapshot.commissionAmount, TusCommissionSnapshot.netAmount, TusLedgerEntry.amount, TusReconciliationRecord.providerAmount, TusPosOperation.amount, TusPosReceipt.amount, TusInvoice.subtotal, TusInvoice.taxAmount, TusInvoice.feeAmount, TusInvoice.total, TusInvoiceLine.unitMinor, TusInvoiceLine.taxMinor, TusInvoiceLine.totalMinor, TusCreditNote.amountMinor, TusSubscription.amountMinor]
  missing: [TusSubscriptionPlan.amountMinor, TusBillingRefund.amountMinor, TusBillingLedger.amountMinor]
  incorrect: []
  expected_money_columns: 26
  queried_money_columns: 26
  exact_bigint_present: 23
primary_key_check:
  status: failed
  expected: [TusTenant, User, Account, Session, Membership, TenantRole, TusMerchant, TusProduct, TusService, TusListing, TusInventory, TusCalendar, TusCalendarRule, TusCalendarException, TusBooking, TusCommitment, TusCommitmentTransition, TusCommitmentCompensation, TusMarketplaceCommitment, TusPaymentIntent, TusPaymentWebhookEvent, TusCommissionSnapshot, TusLedgerEntry, TusFinancialEvidence, TusFinancialConfirmation, TusFinancialFreeze, TusReconciliationRecord, TusWhatsAppConsent, TusWhatsAppMessage, TusWhatsAppWebhookEvent, TusInvoice, TusInvoiceLine, TusCreditNote, TusSubscription, TusTaxProfile, AuditEvent, TusMarketplaceAudit, TusDeliveryAudit, TusPosAudit, TusWhatsAppAudit, OutboxEvent, TusDeliveryOutbox, TusPosOutbox, TusSupportOutbox, TusJob, TusDeadLetter, TusHardeningFixture, TusDeliveryZone, TusDeliveryShift, TusDeliveryTask, TusDeliveryProof, TusDeliveryIncident, TusDeliveryAudit, TusPosOperation, TusPosReceipt, TusPosDevice, TusPosSession, TusPosConflict, TusPosVersion, TusBillingAccount, TusSubscriptionPlan, TusBillingRefund, TusBillingLedger, TusBillingIdempotency, TusBillingAudit, TusBillingOutbox, TusBillingDunning, TusBillingNumberSequence, TusAccountingExport]
  present: [TusTenant, User, Account, Session, Membership, TenantRole, TusMerchant, TusProduct, TusService, TusListing, TusInventory, TusCalendar, TusCalendarRule, TusCalendarException, TusBooking, TusCommitment, TusCommitmentTransition, TusCommitmentCompensation, TusMarketplaceCommitment, TusPaymentIntent, TusPaymentWebhookEvent, TusCommissionSnapshot, TusLedgerEntry, TusFinancialEvidence, TusFinancialConfirmation, TusFinancialFreeze, TusReconciliationRecord, TusWhatsAppConsent, TusWhatsAppMessage, TusWhatsAppWebhookEvent, TusInvoice, TusInvoiceLine, TusCreditNote, TusSubscription, TusTaxProfile, AuditEvent, TusMarketplaceAudit, TusDeliveryAudit, TusPosAudit, TusWhatsAppAudit, OutboxEvent, TusDeliveryOutbox, TusPosOutbox, TusSupportOutbox, TusJob, TusDeadLetter, TusHardeningFixture, TusDeliveryZone, TusDeliveryShift, TusDeliveryTask, TusDeliveryProof, TusDeliveryIncident, TusPosOperation, TusPosReceipt, TusPosDevice, TusPosSession, TusPosConflict, TusPosVersion]
  missing: [TusBillingAccount, TusSubscriptionPlan, TusBillingRefund, TusBillingLedger, TusBillingIdempotency, TusBillingAudit, TusBillingOutbox, TusBillingDunning, TusBillingNumberSequence, TusAccountingExport]
  incorrect: []
  expected_primary_key_tables: 68
  present_primary_key_tables: 58
index_check:
  status: failed
  expected: [TusDeliveryZone_tenantId_active_idx, TusDeliveryShift_tenantId_zoneId_status_idx, TusDeliveryTask_tenantId_commitmentId_idx, TusDeliveryTask_tenantId_shiftId_status_idx, TusDeliveryTask_tenantId_commitmentId_status_idx, TusDeliveryProof_tenantId_taskId_idx, TusDeliveryIncident_tenantId_taskId_status_idx, TusDeliveryAudit_tenantId_auditId_key, TusDeliveryAudit_tenantId_createdAt_idx, TusPosOperation_tenantId_shiftId_createdAt_idx, TusPosOperation_tenantId_context_kind_idx, TusPosReceipt_tenantId_operationId_idx, TusPosReceipt_tenantId_operationId_createdAt_idx, TusPosDevice_tenantId_status_idx, TusPosSession_tenantId_deviceId_shiftId_status_idx, TusPosConflict_tenantId_operationId_status_idx, TusPosConflict_tenantId_status_createdAt_idx, TusPosVersion_tenantId_shiftId_version_idx, TusDeliveryOutbox_tenantId_status_createdAt_idx, TusPosOutbox_tenantId_status_createdAt_idx, TusPosOutbox_tenantId_aggregateId_status_idx, TusPosAudit_tenantId_operationId_createdAt_idx]
  present: [TusDeliveryTask_tenantId_commitmentId_idx, TusDeliveryProof_tenantId_taskId_idx, TusDeliveryAudit_tenantId_auditId_key, TusDeliveryAudit_tenantId_createdAt_idx, TusPosOperation_tenantId_shiftId_createdAt_idx, TusPosReceipt_tenantId_operationId_idx, TusPosReceipt_tenantId_operationId_createdAt_idx, TusPosAudit_tenantId_operationId_createdAt_idx]
  missing: []
  incorrect:
    - {name: TusDeliveryZone_tenantId_active_idx, expected_columns: [tenantId, active], observed_columns: [tenantId], expected_unique: false, observed_unique: false}
    - {name: TusDeliveryShift_tenantId_zoneId_status_idx, expected_columns: [tenantId, zoneId, status], observed_columns: [tenantId, zoneId], expected_unique: false, observed_unique: false}
    - {name: TusDeliveryTask_tenantId_shiftId_status_idx, expected_columns: [tenantId, shiftId, status], observed_columns: [tenantId, shiftId], expected_unique: false, observed_unique: false}
    - {name: TusDeliveryTask_tenantId_commitmentId_status_idx, expected_columns: [tenantId, commitmentId, status], observed_columns: [tenantId, commitmentId], expected_unique: false, observed_unique: false}
    - {name: TusDeliveryIncident_tenantId_taskId_status_idx, expected_columns: [tenantId, taskId, status], observed_columns: [tenantId, taskId], expected_unique: false, observed_unique: false}
    - {name: TusPosOperation_tenantId_context_kind_idx, expected_columns: [tenantId, context, kind], observed_columns: [tenantId], expected_unique: false, observed_unique: false}
    - {name: TusPosDevice_tenantId_status_idx, expected_columns: [tenantId, status], observed_columns: [tenantId], expected_unique: false, observed_unique: false}
    - {name: TusPosSession_tenantId_deviceId_shiftId_status_idx, expected_columns: [tenantId, deviceId, shiftId, status], observed_columns: [tenantId, deviceId, shiftId], expected_unique: false, observed_unique: false}
    - {name: TusPosConflict_tenantId_operationId_status_idx, expected_columns: [tenantId, operationId, status], observed_columns: [tenantId, operationId], expected_unique: false, observed_unique: false}
    - {name: TusPosConflict_tenantId_status_createdAt_idx, expected_columns: [tenantId, status, createdAt], observed_columns: [tenantId, createdAt], expected_unique: false, observed_unique: false}
    - {name: TusPosVersion_tenantId_shiftId_version_idx, expected_columns: [tenantId, shiftId, version], observed_columns: [tenantId, shiftId], expected_unique: false, observed_unique: false}
    - {name: TusDeliveryOutbox_tenantId_status_createdAt_idx, expected_columns: [tenantId, status, createdAt], observed_columns: [tenantId, createdAt], expected_unique: false, observed_unique: false}
    - {name: TusPosOutbox_tenantId_status_createdAt_idx, expected_columns: [tenantId, status, createdAt], observed_columns: [tenantId, createdAt], expected_unique: false, observed_unique: false}
    - {name: TusPosOutbox_tenantId_aggregateId_status_idx, expected_columns: [tenantId, aggregateId, status], observed_columns: [tenantId, aggregateId], expected_unique: false, observed_unique: false}
  expected_indexes: 22
  present_indexes: 8
constraint_check:
  status: passed
  expected: [TusPosConflict_tenant_operation_fk, TusPosOperation_amount_non_negative_check, TusPosVersion_version_non_negative_check]
  present: [TusPosConflict_tenant_operation_fk, TusPosOperation_amount_non_negative_check, TusPosVersion_version_non_negative_check]
  missing: []
  incorrect: []
  expected_constraints: 3
  present_constraints: 3
  normalization: redundant outer CHECK parentheses and whitespace normalized; predicate semantics exact
ledger_check:
  status: failed
  expected: [{name: 20260831180000_tus_additive_migration_repair, expected_count: 1}, {name: 20260909090000_tus_argentina_market_launch, expected_count: 1}, {name: 20260911120000_tus_pos_index_constraint_repair, expected_count: 1}]
  present: [20260909090000_tus_argentina_market_launch, 20260911120000_tus_pos_index_constraint_repair]
  missing: [20260831180000_tus_additive_migration_repair]
  incorrect: []
  table_present: true
  counts_only: true
  row_values_returned: 0
row_values_read: 0
overall_schema_conformance: {status: failed, verdict: non-conformant, metadata_only: true}
integrated_verifier_exercised:
  status: failed
  verifier: verifySchemaSnapshot
  required_table_count: 62
  present_table_count: 62
  missing_tables: []
  mismatched_tables: [TusDeliveryOutbox, TusPosOutbox, TusDeliveryZone, TusDeliveryShift, TusDeliveryTask, TusDeliveryIncident, TusPosOperation, TusPosDevice, TusPosSession, TusPosConflict, TusPosVersion, TusDeliveryOutbox, TusPosOutbox]
  missing_indexes: [TusDeliveryZone_tenantId_active_idx, TusDeliveryShift_tenantId_zoneId_status_idx, TusDeliveryTask_tenantId_shiftId_status_idx, TusDeliveryTask_tenantId_commitmentId_status_idx, TusDeliveryIncident_tenantId_taskId_status_idx, TusPosOperation_tenantId_context_kind_idx, TusPosDevice_tenantId_status_idx, TusPosSession_tenantId_deviceId_shiftId_status_idx, TusPosConflict_tenantId_operationId_status_idx, TusPosConflict_tenantId_status_createdAt_idx, TusPosVersion_tenantId_shiftId_version_idx, TusDeliveryOutbox_tenantId_status_createdAt_idx, TusPosOutbox_tenantId_status_createdAt_idx, TusPosOutbox_tenantId_aggregateId_status_idx]
  missing_constraints: []
  repair_marker_count: 1
persistent_side_effects: {database_writes: 0, ddl: 0, dml: 0, migration_invocations: 0, seed_invocations: 0, provider_calls: 0, row_values_read: 0}
cleanup_state: {transaction_rolled_back: true, client_closed: true, session_closed: true, owned_processes_remaining: 0}
risks:
  - Three current source money columns are absent from the target metadata.
  - Ten source-derived billing primary-key tables are absent from the target metadata.
  - Fourteen named indexes exist with incorrect ordered columns; no index names are missing.
  - The additive baseline marker count is zero; launch and POS-repair marker counts are one each.
  - Metadata-only evidence does not prove application behavior or row-value losslessness.
safe_next_action: Do not run repair/apply or any DDL/DML; remediate the reported metadata gaps in a separately authorized change, then request a new bounded receipt.
skill_resolution: {shared: loaded, typescript: loaded, codegraph: fallback-after-upstream-cli-unavailable}
```

This receipt is complete and accepted as a point-in-time metadata diagnostic,
but its schema verdict is explicitly non-conformant. The database was not
changed, and no conformant live-schema claim is made.

## Cross-Reference: Live Schema Conformance Repair

The follow-up conformance unit is implemented separately at
`openspec/changes/tus-live-schema-conformance-repair/`. It adds the three
missing exact-money columns only behind empty-table gates, the ten source-derived
`id` primary keys only behind aggregate and compatibility gates, and reconciles
the fourteen incorrect same-name indexes through deterministic aliases without
dropping objects or replaying historical migrations.

The focused conformance suite passed `32/32`. The default backup adapter now
requires both custom-archive list validation and an explicit isolated-restore
verifier; a list-only archive is no longer treated as restorable. No target
connection, DDL, DML, seed, provider, POS, or deployment activity was performed
for this unit. Its live state remains `liveConformance: false` and NO-GO until a
fresh accepted metadata receipt exists.
