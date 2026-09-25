# TUS Live Schema Conformance Repair Money Evidence

## Static Gate: 2026-09-14

```yaml
status: passed
selected_migration: 20260911130000_tus_live_schema_conformance_repair
amount_minor_contracts: 3
amount_minor_shape: BIGINT_NOT_NULL_NO_DEFAULT
affected_tables: [TusSubscriptionPlan, TusBillingRefund, TusBillingLedger]
backfill: not-present
destructive_sql: not-present
untagged_update: not-present
historical_marker_replay: not-present
```

The static repair contract passed the focused migration-repair suite (`32/32`).
The current target was not accepted for the 26-column live money receipt because
the required isolated restore proof failed before preflight. No money column was
added, no money value was read or emitted, and no money backfill/default was run.

```yaml
live_money_acceptance: not-run
expected_money_columns: 26
rowValuesRead: 0
liveConformance: false
noGo: true
```

## Fresh Corrected Restore Gate: 2026-09-14

```yaml
status: blocked_before_live_money_acceptance
selected_migration: 20260911130000_tus_live_schema_conformance_repair
backup_list_gate: passed
isolated_restore_gate: blocked_timeout_after_60_seconds
restore_attempts: 1
restore_retry: false
live_money_acceptance: not-run
expected_money_columns: 26
rowValuesRead: 0
liveConformance: false
noGo: true
current_target_money_writes: 0
```

No current-target money metadata was queried or changed because the corrected
isolated restore did not complete successfully.

## Authoritative Fresh Session: 2026-09-15

```yaml
status: blocked_before_live_money_acceptance
selected_migration: 20260911130000_tus_live_schema_conformance_repair
backup_list_gate: passed
isolated_restore_gate: passed
restore_proof: {version: 1, mode: schema-only, tool_version: PostgreSQL 16.2, restore_exit_code: 0, metadata_table_count: 59, rowValuesRead: 0}
target_preflight: {status: blocked, reason: missing-money-table}
live_money_acceptance: not-run
expected_money_columns: 26
rowValuesRead: 0
current_target_money_writes: 0
liveConformance: false
noGo: true
```

The repair stopped before querying or changing the target money catalog. No money
column, money value, default, backfill, seed, or POS action was executed.

## Fresh Direct Metadata Diagnosis: 2026-09-15

```yaml
status: blocked
source: repository-root .env DATABASE_URL only
runtime: {node: v22.23.2, pg: existing, connection_attempts: 1, retry: false}
session: {isolation: REPEATABLE READ, read_only: true, timeout_seconds: 60}
money_check: {expected: 26, present: 23, missing: 3, incorrect: 0}
missing_money_tables: [TusSubscriptionPlan, TusBillingRefund, TusBillingLedger]
affected_table_row_counts: not-readable-table-absent
rowValuesRead: 0
current_target_writes: 0
cleanup_state: client-closed-transaction-rolled-back
liveConformance: false
noGo: true
```

This fresh catalog-only session confirms that the three failed money contracts
are absent table objects, not merely existing tables with missing columns. The
source preflight therefore fails first on
`observed?.present !== true` for `TusSubscriptionPlan.amountMinor` with
`missing-money-table`; a present table with an absent column would instead emit
`exact-money-column-gate`. No money values, defaults, backfill, DDL, or DML were
read or executed.
