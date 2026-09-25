# Design: TUS Live Schema Conformance Repair

## Technical Approach

Create an explicit forward-only repair unit from the Prisma catalog. Never replay history. Static, target, and backup gates precede metadata-only preflight; transaction-local guards protect one PostgreSQL transaction containing additive DDL, index repair, and the marker. A read-only receipt proves acceptance.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Replay billing/backlog | Unsafe lineage/destructive SQL | Reject; inventory only |
| Drop/recreate wrong indexes | Destructive; lock/data risk | Reject; rename, then create |
| Money default/backfill | Invents financial facts | Reject; empty-table gate |

**Money:** `TusSubscriptionPlan`, `TusBillingRefund`, and `TusBillingLedger` may receive `amountMinor` only when absent and `COUNT(*) = 0`. Existing declarations require `BIGINT NOT NULL` and `column_default IS NULL`; otherwise block. SQL is `ALTER TABLE "T" ADD COLUMN "amountMinor" BIGINT NOT NULL`; no default, update, backfill, or invented value.

**Primary keys:** For `TusBillingAccount`, `TusSubscriptionPlan`, `TusBillingRefund`, `TusBillingLedger`, `TusBillingIdempotency`, `TusBillingAudit`, `TusBillingOutbox`, `TusBillingDunning`, `TusBillingNumberSequence`, and `TusAccountingExport`, require `id TEXT NOT NULL` and `COUNT(id) = COUNT(*) = COUNT(DISTINCT id)`. Existing PK is absent or exactly `("id")`; then add `CONSTRAINT "<Table>_pkey" PRIMARY KEY ("id")`. Any incompatible PK blocks.

**Indexes:** Compare all 22 `REQUIRED_POS_REPAIR_INDEXES` by table, name, uniqueness, predicate, and ordered columns. The 14 wrong names map in contract order to `tus_lscr_legacy_01`…`14`. Exact is a no-op; absent is created; wrong same-name is checked for table/free alias, renamed with `ALTER INDEX`, then recreated canonically. Alias/cross-table collisions block. Never drop.

## Data Flow

`root .env DATABASE_URL` → target gate → custom archive list → isolated schema-only restore → hash/size-bound proof → proof/scratch revalidation → repair connection → catalog preflight → guarded transaction → DDL/PK/index work + marker → commit → normalized receipt → redacted evidence.

## Interfaces / SQL Shapes

```ts
const REPAIR_UNIT = { LIVE_SCHEMA_CONFORMANCE: 'live-schema-conformance' } as const
interface ColumnShape { type: string; nullable: boolean; defaultValue: string | null }
interface IndexShape { table: string; name: string; columns: string[]; unique: boolean; predicate: string | null }
interface CatalogSnapshot { columns: Record<string, ColumnShape>; primaryKeys: Record<string, string[]>; indexes: IndexShape[]; markers: Record<string, number>; rowCounts: Record<string, number> }
interface RepairReceipt { status: string; rowValuesRead: number; marker: string; rollback: string; liveConformance: boolean; noGo: boolean }
```

Use `information_schema.columns`, `pg_constraint`/`pg_attribute`, `pg_indexes`/`pg_index`, and aggregates only. Normalize whitespace and redundant outer `CHECK` parentheses; keep names, predicate semantics, order, and uniqueness exact. Launch/POS markers are exactly-once prerequisites; the new marker is absent before and once after. The historical marker stays absent.

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/prisma/migrations/20260911130000_tus_live_schema_conformance_repair/migration.sql` | Create | Additive DDL, ten PKs, aliases, indexes, marker. |
| `scripts/tus-migration-repair-lib.mjs` | Modify | Unit, catalog gates, receipt, retry/restore. |
| `scripts/tus-migration-repair.mjs` | Modify | Expose unit; retain root-env/redaction. |
| `tests/integration/tus/migration-repair.test.mjs` | Modify | TDD gates, idempotency, rollback, zero-side-effects. |
| `docs/runbooks/{backup-restore,migration-rollback,tus-deployment-operations}.md` | Modify | Restore, lineage, timeout, NO-GO rules. |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit/static | No destructive/default/backfill SQL; money/PK/marker/alias/redaction gates | `node:test` doubles; denied paths assert zero DB calls |
| Integration | Data gates, PK conflicts, all index shapes, alias collision, atomic rollback, replay idempotency | Catalog fixtures/doubles; no historical replay |
| Acceptance | 62 tables, 26 money, 68 PK, 22 indexes, 3 constraints, markers, `rowValuesRead=0` | Metadata-only `REPEATABLE READ`; seed/POS/provider/runtime deferred |

## Failure Modes, Rollback, and Observability

Target/backup/marker failures, non-empty money, bad aggregates, incompatible objects, alias collisions, timeouts, or retry exhaustion stop before writes. Statement failure rolls back. Uncertain commit/post-commit mismatch emits `repair-operation-failed-restore-required`; no down migration or restore-over-current. Isolated restore preserves backup, ledger, outbox, and DLQ. Connection/statements: 60 seconds, one retry; uncertain DDL is not retried. Receipts record stages, counts, lineage, aliases, attempts, sanitized SQLSTATE, cleanup, and effects—never secrets, row values, or provider responses. `liveConformance=false`/NO-GO remain unless conditions pass.

## Threat Matrix

| Boundary | Applicability | Design response / planned RED test |
|---|---|---|
| Documentation-like paths | N/A — only fixed `migration.sql` is inspected; documentation is not executable | None |
| Git repository selection | N/A — no Git command | None |
| Commit state | N/A — no commit automation | None |
| Push state | N/A — no push automation | None |
| PR commands | N/A — no PR automation | None |

`pg_restore` is argv-only (`--format=custom --dbname=<scratch> --schema-only --no-owner --no-acl --exit-on-error --single-transaction <backup>`), timeout-bounded, stdio-suppressed, and redaction-tested. The proof stores only a redacted invocation shape and opaque scratch identifier; no URL or shell command is emitted.

## Migration / Rollout

No historical replay, seed, provider, POS, runtime, deployment, or production activation precedes acceptance. Rollback boundary: this transaction and isolated restore target. Historical files, markers, unrelated schema, and source backup remain preserved.

## Explicit Non-goals

No historical-marker reconstruction, data conversion/backfill, rebuild, drop/truncate/delete, verifier relaxation, production-readiness claim, or restore-over-current.

## Open Questions

- [ ] Verified custom-format backup and isolated restore capability must be supplied through `create-restore-proof`; archive listing alone is insufficient.
- [ ] Fresh preflight must confirm the three billing tables are empty; otherwise a separate approved exact-money change is required.
