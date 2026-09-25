# Apply Progress: TUS Live Schema Conformance Repair

## Work Unit

- Change: `tus-live-schema-conformance-repair`
- Artifact store: Hybrid (OpenSpec + Engram)
- Mode: Strict TDD
- Delivery: single PR / full correction
- Scope: exact additive catalog repair, bounded runner, metadata acceptance, and runbook boundaries
- Historical migrations: unchanged and never replayed
- Current status: implementation gates complete; isolated restore proof passed, but live conformance remains blocked by target preflight `missing-money-table`

## Cumulative Task Status

- [x] Phase 1: RED static, safety, catalog, receipt, and zero-side-effect contracts
- [x] Phase 2: Forward-only migration, exact source-derived contracts, and fourteen alias mappings
- [x] Phase 3: Root-target, marker, data, alias, backup, retry, transaction, and no-backfill gates
- [x] Phase 4: Metadata-only acceptance contract and operational runbook boundaries

## TDD Cycle Evidence

| Change | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| Live conformance contracts and migration | `tests/integration/tus/migration-repair.test.mjs` | New conformance imports/assertions failed before implementation | Focused suite passed `36/36` | Exact money/PK/index/marker counts, zero-write refusal, idempotency, and receipt checks | Contracts remain immutable and metadata-only |
| Default backup isolated-restore gate | `tests/integration/tus/migration-repair.test.mjs` | Updated regression failed because the default verifier was a no-op (`31/32`) | Focused suite passed `36/36` after fail-closed verifier | `pg_restore --list` remains required, while isolated restore proof is now separately required | No fake dump or implicit restore claim |

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm exec node --experimental-strip-types --experimental-loader ./scripts/node-strip-types-loader.mjs --test --test-concurrency=1 tests/integration/tus/migration-repair.test.mjs` — exit `0`; `36` passed, `0` failed, `0` skipped. |
| Typecheck/lint | `pnpm typecheck` and `pnpm lint` passed; lint emitted warnings only. `pnpm lint:security` passed. |
| Full regression command | `pnpm test` — exit `0`; the complete runner finished without validation failures. |
| Contracts | `pnpm contracts:validate` passed and validated `98` JSON Schema contracts; ajv emitted existing ignored-format warnings. |
| Backup and proof evidence | Fresh custom archive passed `pg_restore --format=custom --list`; one PostgreSQL 16.2 schema-only isolated restore exited `0`, and metadata-only verification observed `59` tables with `rowValuesRead=0`. |
| Runtime harness | Repair reached target preflight after the accepted proof, then stopped on `missing-money-table`; one target connection, zero schema/data writes, zero migration invocations, zero seed/provider/POS actions. |
| Rollback boundary | Revert only the new conformance migration, conformance repair code/tests, runbook additions, and this change's evidence; preserve historical migrations and unrelated dirty-tree work. |

## Static Safety Receipt

```yaml
selected_migration: 20260911130000_tus_live_schema_conformance_repair
static_sql_gate: passed
exact_money_gate: passed
destructive_tokens: absent
historical_marker_replay: absent
required_money_columns: 26
required_primary_key_contracts: 68
required_repair_indexes: 22
wrong_same_name_aliases: 14
required_constraints: 3
new_marker: 20260911130000_tus_live_schema_conformance_repair
historical_marker: absent_by_contract
liveConformance: false
noGo: true
rowValuesRead: 0
```

## Issues and Deferred Gates

- The repository-wide test run passed; the lockfile was not modified.
- The isolated restore proof passed, but target preflight remains blocked by `missing-money-table`.
- No live acceptance receipt exists. Until a fresh metadata-only `REPEATABLE READ` receipt proves all exact counts and marker lineage, `liveConformance=false` and NO-GO remain authoritative.
- Seed, provider, POS runtime, browser/device, cloud, deployment, and production-readiness evidence remain out of scope.

## Authoritative Completion Session: 2026-09-15

```yaml
status: blocked
executive_summary: "The fresh custom backup and schema-only isolated restore proof passed. The repair then stopped at target preflight because the required money table was missing."
source: repository-root .env DATABASE_URL only
node_env: development
explicit_confirmation: --confirm-development-target
backup: {status: passed, tool_version: PostgreSQL 16.2, format: custom, archive_list_exit: 0, nonzero_size: true}
restore_proof: {status: passed, version: 1, mode: schema-only, restore_exit: 0, metadata_table_count: 59, migration_table_present: true, rowValuesRead: 0, scratch_identifier: lscr-7e1bc950ec2c, retained_for_owner_cleanup: true}
target_preflight: {status: blocked, reason: missing-money-table}
migration: {status: not-started, selected: 20260911130000_tus_live_schema_conformance_repair, target_connections: 1, current_target_writes: 0, historical_migrations_invoked: 0}
schema_acceptance: {status: not-run, liveConformance: false, noGo: true, rowValuesRead: 0}
seed: {status: not-run, reason: target preflight blocked}
pos_evidence: {status: not-run, durable_database_actions: 0, provider_calls: 0}
cleanup_state: {official_client_processes_closed: true, scratch_cleanup: owner_required_no_destructive_cleanup_performed}
launch_verdict: NO-GO
```

The backup and proof artifacts are preserved outside the repository. The proof
used one retained scratch database and read metadata only. The repair stopped
before DDL, DML, marker insertion, acceptance, seed, provider, POS, deployment,
browser/device, Docker, or production activity. A preliminary wrapper command
echoed a `DATABASE_URL` assignment; the value is intentionally omitted and must
not be repeated.

## Bounded Live Completion Session: 2026-09-14

```yaml
status: blocked
executive_summary: "The static repair gate and current-target custom backup passed. The single isolated scratch restore did not produce a successful restore exit, so the operation stopped before current-target preflight, DDL, schema acceptance, seed, and POS runtime."
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
source: repository-root .env DATABASE_URL only
node_env: development
explicit_confirmation: --confirm-development-target
static_gate: {status: passed, destructive_statements: 0, ambiguous_statements: 0, exact_money: passed, amount_minor_bigint_not_null: 3, id_text_not_null_primary_key_contracts: 10, guarded_aliases: 14, historical_marker_replay: false, source_constraints_mutated: false}
backup: {status: passed, tool_version: PostgreSQL 16.2, format: custom, nonzero_size: true, archive_list_exit: 0, contents_read: false, location: unique user-temp archive outside repository}
scratch_restore: {status: blocked, identifier: lscr-ba813eed404b, first_restore: timed-out-or-no-exit-within-bound, second_restore: exit_1_on_partial_scratch, metadata_only_table_count_observed: 59, row_values_read: 0, retained_for_owner_cleanup: true}
target_preflight: not-run-after-isolated-restore-gate
migration: {status: not-started, selected: 20260911130000_tus_live_schema_conformance_repair, current_target_writes: 0, historical_migrations_invoked: 0}
schema_acceptance: {status: not-run, liveConformance: false, noGo: true, rowValuesRead: 0}
seed: {status: not-run, reason: metadata acceptance was not reached}
pos_evidence: {status: not-run, durable_database_actions: 0, provider_calls: 0}
side_effects: {backup_reads: 1, current_target_catalog_writes: 0, isolated_scratch_database_created: 1, repair_ddl: 0, repair_dml: 0, seed_writes: 0, provider_calls: 0, row_values_emitted: 0}
cleanup_state: {probe_clients_closed: true, pg_dump_processes_remaining: 0, pg_restore_processes_remaining: 0, scratch_cleanup: owner_required_no_destructive_cleanup_performed}
liveConformance: false
launch_verdict: NO-GO
remaining_blockers: [successful isolated restore proof, fresh current-target metadata acceptance]
```

The backup was created from the root target and preserved outside the repository.
The scratch database was created only for isolated restore proof and was not used
as the current target. The first restore did not complete within the bounded
process window; a diagnostic retry against that same partial scratch returned
exit `1`. No second scratch, restore-over-current operation, repair transaction,
seed, provider call, API process, browser/device, Docker, deployment, or review
lifecycle command was run. The scratch identifier is intentionally redacted and
the database remains for owner cleanup.

### Completion Session Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Static test | Persistent Node 22.23.2 focused migration-repair suite: exit `0`; `32` passed, `0` failed, `0` skipped. |
| Static SQL gate | Passed; exact three amount columns, ten PK definitions, fourteen aliases, zero destructive/ambiguous statements, no historical replay, no source constraint mutation. |
| Backup | Official PostgreSQL 16.2 `pg_dump` custom archive: nonzero size; `pg_restore --format=custom --list`: exit `0`; archive contents not read. |
| Isolated restore | One scratch database created; first restore did not return a successful exit within the bound; second attempt on the partial scratch exited `1`; metadata-only count observed `59`; scratch retained. |
| Current target | No repair connection, preflight, DDL, DML, migration marker, acceptance, or seed reached; current-target mutation count `0`. |
| POS/runtime | Not run. Deterministic POS contracts remain separate from real database evidence; durable POS actions would exceed the explicit write allowlist. |
| Rollback boundary | No current-target rollback required. Preserve the backup and scratch for owner-directed isolated cleanup; do not restore over current or run a down migration. |

### Fresh Isolated Restore Session: 2026-09-14 (Authoritative)

```yaml
status: blocked
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
source: repository-root .env DATABASE_URL only
backup: {status: passed, format: custom, pg_restore_list_exit: 0, nonzero_size: true, tool_version: PostgreSQL 16.2}
scratch_restore: {status: blocked, created: 1, retained: true, attempts: 1, error_category: missing-dbname-or-file-option, sqlstate: null, rowValuesRead: 0}
sanitized_stderr: "pg_restore: error: una de las opciones -d/--dbname y -f/--file debe especificarse"
current_target: {control_connection_for_scratch_creation: true, schema_writes: 0, data_writes: 0, migration_invocations: 0, seed_writes: 0, provider_calls: 0}
preflight: not-run
migration: {status: not-started, current_target_writes: 0, historical_migrations_invoked: 0}
schema_acceptance: {status: not-run, liveConformance: false, noGo: true, rowValuesRead: 0}
seed: not-run
pos_evidence: not-run
cleanup_state: {official_client_processes_closed: true, pool_opened: false, scratch_cleanup: owner_required_no_destructive_cleanup_performed}
launch_verdict: NO-GO
remaining_blockers: [successful isolated restore proof, fresh current-target metadata acceptance]
```

The single restore invocation failed during `pg_restore` argument validation and
was not retried. No current-target repair, acceptance, seed, POS, provider,
deployment, browser/device, Docker, or production activity followed.

## Fresh Corrected Completion Session: 2026-09-14 (Authoritative Correction)

```yaml
status: blocked
executive_summary: "The custom archive list gate passed, but the single corrected isolated restore attempt timed out at the 60-second bound. Current-target repair was not reached."
runtime_path: C:\Users\mmmau\Tools\node-v22.23.2-win-x64\node.exe
source: repository-root .env DATABASE_URL only
backup: {status: passed, tool_version: PostgreSQL 16.2, format: custom, nonzero_size: true, archive_list_exit: 0, contents_read: false}
static_gate: not-run_after_phase_A_failure
scratch_restore: {status: blocked, created: 1, retained: true, attempts: 1, outcome: timeout_after_60_seconds, stderr: empty, retry_performed: false}
current_target_repair_reached: false
target_preflight: not-run
migration: {status: not-started, selected: 20260911130000_tus_live_schema_conformance_repair, current_target_writes: 0, historical_migrations_invoked: 0}
schema_acceptance: {status: not-run, expected_tables: 62, expected_money_columns: 26, expected_primary_keys: 68, expected_indexes: 22, expected_constraints: 3, rowValuesRead: 0, liveConformance: false, noGo: true}
seed: not-run
pos_evidence: not-run
side_effects: {root_target_control_connection_for_create_database: 1, current_target_schema_writes: 0, current_target_data_writes: 0, scratch_databases_created: 1, repair_ddl: 0, repair_dml: 0, seed_writes: 0, provider_calls: 0, row_values_emitted: 0}
cleanup_state: {clients_closed: true, restore_processes_remaining: 0, temporary_stderr_files_remaining: 0, scratch_cleanup: owner_required_no_destructive_cleanup_performed}
liveConformance: false
launch_verdict: NO-GO
remaining_blockers: [successful isolated restore proof, fresh current-target metadata acceptance]
```

The restore invocation used the required shape with `--dbname` first and the
backup path as the final positional argument. The one attempt timed out, so no
retry and no Phase B operation was permitted.
