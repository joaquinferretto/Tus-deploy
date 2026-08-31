# Tasks: TUS Additive Migration Repair

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 700–950 lines |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR under approved `size:exception` |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Inventory and fail-closed gates | PR 1 | `pnpm exec node --test tests/integration/tus/migration-repair.test.mjs` | N/A—static/unit only | New test/lib files |
| 2 | Additive baseline, ledger, runner | PR 1 | Same focused command | `NODE_ENV=development pnpm exec node scripts/tus-migration-repair.mjs apply --confirm-development-target --backup-id <handle>` | New migration, runner, CLI |
| 3 | Schema/POS proof and evidence | PR 1 | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs tests/integration/tus/migration-repair.test.mjs` | Same apply, then `runTusPostgresHttpSmoke({ applyMigrations: false, confirmed: true })` | Evidence/test files |

## Phase 1: RED Contracts

- [x] 1.1 In `tests/integration/tus/migration-repair.test.mjs`, add RED tests for `*/migration.sql`: exactly 25 pending migrations, 19 executable destructive statements, comment-only `drop` excluded, zero DB calls on rejection.
- [x] 1.2 Add RED tests for root `.env` `DATABASE_URL` only, `NODE_ENV=development` plus `--confirm-development-target`, production/shared refusal, redaction, missing backup, 60s bounds, one retry, no third attempt.
- [x] 1.3 Add RED tests for shape/data/orphan preflight, rollback/restore-required state, preserved `_prisma_migrations`, one repair marker, schema/index/constraint checks, tagged cleanup, provider calls `0`.

## Phase 2: GREEN Repair

- [x] 2.1 Create `scripts/tus-migration-repair-lib.mjs` to inventory `apps/api/prisma/migrations/*/migration.sql`, classify four categories, preserve historical files, and reject `DROP`, `TRUNCATE`, `CASCADE`, destructive `UPDATE`, and untagged `DELETE` before connection.
- [x] 2.2 In the same library, implement root-target/profile/backup/data preflight and bounded `connect`/owned-start: 60,000 ms per attempt, one retry, redacted diagnostics, fail-closed aborts.
- [x] 2.3 Create `apps/api/prisma/migrations/20260831180000_tus_additive_migration_repair/migration.sql` as an idempotent additive baseline from `apps/api/prisma/schema.prisma`, ordered by dependencies; create `_prisma_migrations` only if absent and add no historical markers or destructive SQL.
- [x] 2.4 Add transactional apply, ledger preservation/one completed marker, schema receipt, `finally` pool/PID/argv/port cleanup, and redacted rollback metadata; never call Prisma deploy/dev/reset.
- [x] 2.5 Create `scripts/tus-migration-repair.mjs` with only `apply --confirm-development-target --backup-id <handle>`, root `.env`, development refusal, no alternate URLs/secrets/provider/service/browser, redacted JSON.

## Phase 3: GREEN Verification / REFACTOR

- [x] 3.1 Make RED tests pass for `TusDeliveryZone`, `TusDeliveryShift`, `TusDeliveryTask`, `TusDeliveryProof`, `TusDeliveryIncident`, `TusDeliveryAudit`, `TusPosOperation`, `TusPosReceipt`, `TusPosDevice`, `TusPosSession`, `TusPosConflict`, `TusPosVersion`, `TusDeliveryOutbox`, `TusPosOutbox`, `TusPosAudit`, including Prisma columns, `id` PKs, tenant uniques, and model indexes; assert replay preserves counts/ledger identity.
- [ ] 3.2 On only the authorized remote-development target, run bounded apply, verify backup/rollback and abort paths, then run `pnpm test -- tests/integration/tus/migration-repair.test.mjs`; stop on schema, data, ledger, transaction, retry, or cleanup failure.
- [ ] 3.3 After schema proof, rerun durable POS via `tests/integration/tus/postgres-http-smoke.test.mjs` with `applyMigrations: false`: product/service, replay, version conflict, tenant isolation, receipt/audit/outbox, restart, tagged cleanup, provider `0`; write redacted `migration-repair-evidence.md` with five tags and `external-blocked` when incomplete.
