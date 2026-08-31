# Apply Progress: TUS Additive Migration Repair

## Work Unit

- Change: `tus-additive-migration-repair`
- Artifact store: Hybrid (OpenSpec + Engram)
- Mode: Strict TDD
- Delivery: single PR with approved `size:exception`
- Scope: inventory, fail-closed gates, additive baseline, bounded runner, and schema/POS evidence contract
- Historical migrations: unchanged
- Current status: implementation complete through schema-proof contracts; live remote apply blocked before connection by the required operator backup handle

## Cumulative Task Status

### Phase 1: RED Contracts

- [x] 1.1 Inventory tests cover 25 pending migration entries, 19 executable destructive statements, comment-safe tokens, and zero DB calls on rejected selection.
- [x] 1.2 Target, confirmation, production/shared refusal, redaction, backup, 60-second bound, one retry, and no-third-attempt tests are present.
- [x] 1.3 Preflight, ledger, schema/index/constraint, rollback metadata, cleanup, and provider-zero contracts are present.

### Phase 2: GREEN Repair

- [x] 2.1 Added pure inventory/classification and a selected-SQL static gate. Historical files are inventory-only; destructive or ambiguous selected SQL is rejected.
- [x] 2.2 Added root `.env` target resolution, exact development confirmation, backup gate, redacted diagnostics, bounded connection retry, and fail-closed preflight.
- [x] 2.3 Added `20260831180000_tus_additive_migration_repair`, an idempotent additive baseline for the 15 required POS/delivery tables, fixture table, indexes, tenant constraints, and one repair marker.
- [x] 2.4 Added transactional apply, marker handling, schema receipt, rollback metadata, and `finally` pool cleanup. No Prisma migration command is called.
- [x] 2.5 Added the explicit `apply --confirm-development-target --backup-id <handle>` CLI with root-target-only resolution and redacted JSON.

### Phase 3: GREEN Verification / REFACTOR

- [x] 3.1 Focused RED tests pass for required table columns, primary keys, tenant uniqueness, indexes, marker identity, and POS deferral/provider-zero behavior.
- [ ] 3.2 Remote-development apply and live schema verification — blocked by missing operator-supplied restorable backup handle; no connection or write was attempted.
- [ ] 3.3 Durable POS rerun and live evidence — intentionally deferred until schema proof; API/web/mobile/browser/Docker/watchers were not started.

## Migration Inventory

```yaml
total_migration_entries: 26
pending_historical_entries: 25
executable_destructive_statements: 19
destructive_tokens: [CASCADE, DROP]
comment_only_forbidden_tokens: 6
selected_repair_sql_gate: passed
historical_files_changed: 0
```

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/integration/tus/migration-repair.test.mjs` | Unit | N/A (new) | Import/classification contract failed before library | `10/10` passed | Backlog, comments, and unsafe selected SQL | Lexer and inventory helpers are pure |
| 1.2 | `tests/integration/tus/migration-repair.test.mjs` | Unit | N/A (new) | Target/CLI/retry contracts failed before library | `10/10` passed | Root-only URL, remote confirmation, refusal, redaction, retry | Shared bounded retry and target resolver |
| 1.3 | `tests/integration/tus/migration-repair.test.mjs` | Integration contract/unit mocks | N/A (new) | Preflight/ledger/apply contracts failed before library | `10/10` passed | Shape, orphan, marker, schema, cleanup, provider-zero paths | Redacted result builders and immutable constants |
| 2.1 | `tests/integration/tus/migration-repair.test.mjs` | Unit | N/A (new) | Static gate import failed before implementation | `10/10` passed | DROP/CASCADE, comments, missing migration, safe repair SQL | Separate inventory from selected-path gate |
| 2.2 | `tests/integration/tus/migration-repair.test.mjs` | Unit | N/A (new) | Target and bounded retry contracts failed before implementation | `10/10` passed | Production/shared/missing confirmation and two failures | Root URL remains internal only |
| 2.3 | `tests/integration/tus/migration-repair.test.mjs` | Integration contract | N/A (new) | Baseline file and marker assertions failed before migration | `10/10` passed | All 15 required table declarations and replay-safe SQL | Dependency order and IF NOT EXISTS DDL |
| 2.4 | `tests/integration/tus/migration-repair.test.mjs` | Integration contract/unit mocks | N/A (new) | Apply orchestration failed before runner | `10/10` passed | Preflight block and successful additive deferral | `finally` cleanup and redacted rollback metadata |
| 2.5 | `tests/integration/tus/migration-repair.test.mjs` | Unit | N/A (new) | CLI parser contract failed before CLI | `10/10` passed | Invalid intent, unsupported URL argument, and exact confirmation | Finite standard JSON output |
| 3.1 | `tests/integration/tus/migration-repair.test.mjs` | Integration contract/unit mocks | N/A (new) | Schema snapshot contract failed before verifier | `10/10` passed | Full required-table snapshot plus fixture and marker | Aggregate schema receipt |

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/integration/tus/migration-repair.test.mjs` — exit 0; `10` passed, `0` failed, `0` skipped. |
| Runtime harness command/scenario | `NODE_ENV=development pnpm exec node scripts/tus-migration-repair.mjs apply --confirm-development-target` — exit 1; static repair SQL gate and development target gate passed, then backup gate stopped with `restorable-backup-required`; `0` connections and `0` writes. |
| Rollback boundary | Revert only `scripts/tus-migration-repair-lib.mjs`, `scripts/tus-migration-repair.mjs`, `tests/integration/tus/migration-repair.test.mjs`, and `apps/api/prisma/migrations/20260831180000_tus_additive_migration_repair/migration.sql`; historical migration files and unrelated dirty-tree work remain untouched. |
| Cleanup state | `not-started`; no pool, child process, listener, service, browser, Docker process, or watcher was created. |

## Deviations and Issues

- Live apply could not be performed because no operator-supplied restorable backup handle was provided. The runner intentionally does not invent or infer one.
- Durable POS remains deferred until schema proof and a separate bounded runtime phase. No provider calls are claimed.
- The repository contains an empty historical migration directory without `migration.sql`; it is retained as an ambiguous inventory entry and is not rewritten.

## Status

8/11 implementation tasks complete in this change. Tasks `3.2` and `3.3` remain blocked/deferred by the backup gate and the explicit no-runtime-process constraint.
