# Design: TUS Additive Migration Repair

## Technical Approach

Create one target-specific forward-only baseline from `apps/api/prisma/schema.prisma`; never invoke `prisma migrate deploy`, `migrate dev`, or `reset`. The repository currently has 25 pending historical migrations, no target `_prisma_migrations` ledger, 19 destructive tokens, and only 1/15 required POS/hardening tables. Historical files remain untouched and are inventory input only. The repair SQL is generated/maintained from the current schema, statically classified, then applied only after target, backup, and data preflight gates.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Replay historical Prisma backlog | Preserves chronological history but executes destructive SQL and can alter existing data | Reject; inventory only |
| `prisma db push`/reset | Fast but bypasses an auditable ledger and may destroy data | Reject |
| One additive baseline plus explicit ledger marker | Requires a custom guarded runner; preserves rows and makes the skipped backlog explicit | Choose |
| Reuse the fixture migration | Covers only `TusHardeningFixture`, not POS schema | Reject; add a dedicated repair migration |

## Data Flow

`root .env DATABASE_URL` → profile/confirmation gate → historical + repair SQL inventory → backup/target/data preflight → bounded PostgreSQL connection → additive baseline transaction → ledger marker → schema verification → existing HTTP durable-POS smoke → redacted evidence → `finally` cleanup.

Migration order inside the baseline is: (1) create `_prisma_migrations` only when absent, (2) independent/source-of-truth tables, (3) parent tables, (4) delivery and POS tables in dependency order (`TusDeliveryZone` → `TusDeliveryShift` → `TusDeliveryTask` → proofs/incidents; `TusPosOperation` → receipt/device/session/conflict/version → POS outbox/audit), (5) additive columns, indexes, checks, and `NOT VALID` tenant constraints, (6) `TusHardeningFixture`, and (7) insert exactly one completed repair row. Existing ledger rows, tables, columns, and data are never rewritten. Existing shape mismatches abort; only missing objects or explicitly safe additive columns are eligible.

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/prisma/migrations/20260831180000_tus_additive_migration_repair/migration.sql` | Create | Idempotent schema baseline; no `DROP`, `TRUNCATE`, `CASCADE`, untagged `DELETE`, destructive `UPDATE`, or historical migration markers. |
| `scripts/tus-migration-repair-lib.mjs` | Create | Pure inventory/classification, root-target resolution, preflight, bounded retry, ledger/evidence contracts, and cleanup orchestration. |
| `scripts/tus-migration-repair.mjs` | Create | Explicit CLI: `apply --confirm-development-target --backup-id <handle>`; emits redacted JSON only. |
| `tests/integration/tus/migration-repair.test.mjs` | Create | RED/GREEN unit and PostgreSQL-contract tests for every gate and POS result. |
| `openspec/changes/tus-additive-migration-repair/migration-repair-evidence.md` | Create | Redacted inventory, backup, ledger, schema, POS, retry, side-effect, rollback, and cleanup receipt. |

## Interfaces / Contracts

```ts
interface RepairOperations {
  connect(url: string, timeoutMs: 60000): Promise<Pool>
  backup: { assertRestorable(id: string, target: RedactedTarget): Promise<void> }
  inspect(pool: Pool): Promise<PreflightSnapshot>
  applyBaseline(pool: Pool, sql: string): Promise<void>
  recordLedger(pool: Pool, marker: LedgerMarker): Promise<void>
  verifySchema(pool: Pool): Promise<SchemaReceipt>
  verifyDurablePos(): Promise<PosReceipt>
  close(pool: Pool): Promise<void>
}
```

The CLI must read only repository-root `.env` `DATABASE_URL`, require process `NODE_ENV=development` and the exact confirmation flag, reject production/shared targets, cap connection/start attempts at 60 seconds with exactly one retry, and redact URLs/errors. No alternate URL, new environment variable, provider call, or service start is permitted during repair.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Comment-safe SQL gate, historical backlog rejection, exact CLI/profile/backup contract, preflight mismatch, 60s/one-retry and redaction | `node:test` mocks; denied paths assert zero DB calls |
| Integration | Additive DDL, ledger preservation/one marker, schema tables/columns/indexes/constraints, row counts, rollback-required partial failure | PostgreSQL pool contract against an authorized development target; never Prisma historical deploy |
| E2E | Product/service POS, idempotent replay, version conflict, tenant isolation, receipt/audit/outbox durability, restart replay, provider calls `0` | Existing `runTusPostgresHttpSmoke` with `applyMigrations: false`; its owned child is stopped and pool closed in `finally` |

## Threat Matrix

| Boundary | Applicability | Response / RED test |
|---|---|---|
| Documentation-like paths | Applicable | Inventory only `*/migration.sql`; comments cannot bypass executable-token gate; test `DROP` in comment vs SQL. |
| Git repository selection | N/A — no Git command is executed by the repair runner. | None. |
| Commit state | N/A — no commit automation. | None. |
| Push state | N/A — no push automation. | None. |
| PR commands | N/A — no PR automation. | None. |

## Migration / Rollout

Preflight captures redacted target identity, existing ledger names, table/column/row-count snapshot, and backup handle. Abort before writes on missing backup, target/profile mismatch, static ambiguity, unexpected shape/data/orphans, failed transaction, retry exhaustion, schema mismatch, POS failure, provider interaction, or uncertain cleanup. A partial DDL outcome is rolled back by restoring the backup; there is no down migration or destructive SQL rollback. Historical ledger rows are preserved; the new marker identifies only this baseline, so future migration tooling must remain blocked until a deliberate lineage reconciliation.

## Open Questions

None. Operator-supplied backup/restore capability is a required execution precondition, not an inferred target property.
