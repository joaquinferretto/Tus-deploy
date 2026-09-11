# Apply Progress: TUS Live Schema Conformance Repair

## Work Unit

- Change: `tus-live-schema-conformance-repair`
- Artifact store: Hybrid (OpenSpec + Engram)
- Mode: Strict TDD
- Delivery: single PR / full correction
- Scope: exact additive catalog repair, bounded runner, metadata acceptance, and runbook boundaries
- Historical migrations: unchanged and never replayed
- Current status: implementation gates complete; live conformance remains blocked until isolated restore verification and a fresh accepted metadata receipt are available

## Cumulative Task Status

- [x] Phase 1: RED static, safety, catalog, receipt, and zero-side-effect contracts
- [x] Phase 2: Forward-only migration, exact source-derived contracts, and fourteen alias mappings
- [x] Phase 3: Root-target, marker, data, alias, backup, retry, transaction, and no-backfill gates
- [x] Phase 4: Metadata-only acceptance contract and operational runbook boundaries

## TDD Cycle Evidence

| Change | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| Live conformance contracts and migration | `tests/integration/tus/migration-repair.test.mjs` | New conformance imports/assertions failed before implementation | Focused suite passed `32/32` | Exact money/PK/index/marker counts, zero-write refusal, idempotency, and receipt checks | Contracts remain immutable and metadata-only |
| Default backup isolated-restore gate | `tests/integration/tus/migration-repair.test.mjs` | Updated regression failed because the default verifier was a no-op (`31/32`) | Focused suite passed `32/32` after fail-closed verifier | `pg_restore --list` remains required, while isolated restore proof is now separately required | No fake dump or implicit restore claim |

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/integration/tus/migration-repair.test.mjs` — exit `0`; `32` passed, `0` failed, `0` skipped. |
| Typecheck/lint | Previously passed for the changed API/scripts surface; rerun after artifact updates before final verification. |
| Full regression command | `pnpm test` — exit `1`; one existing foundation assertion failed: `Mercado Pago package is represented in the workspace lockfile` because `pnpm-lock.yaml` contains CRLF while the test regex expects LF. The conformance suite itself passed. |
| Backup evidence | Two nonzero custom-format archives passed `pg_restore --format=custom --list` with PostgreSQL 16.2 tooling. This is archive-list proof only, not isolated-restore proof. |
| Runtime harness | Intentionally not run against the target. The default backup adapter now stops after archive-list validation unless an explicit isolated-restore verifier is supplied; no connection, DDL, DML, seed, provider, POS, or deployment activity occurred. |
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

- The repository-wide test run remains blocked by the unrelated `pnpm-lock.yaml` line-ending assertion; the lockfile was not modified.
- The backup files are validated as custom archives, but no isolated restore verification was executed in this continuation.
- No live acceptance receipt exists. Until a fresh metadata-only `REPEATABLE READ` receipt proves all exact counts and marker lineage, `liveConformance=false` and NO-GO remain authoritative.
- Seed, provider, POS runtime, browser/device, cloud, deployment, and production-readiness evidence remain out of scope.
