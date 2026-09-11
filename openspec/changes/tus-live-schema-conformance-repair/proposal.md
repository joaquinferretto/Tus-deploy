# Proposal: TUS Live Schema Conformance Repair

## Intent

Repair the confirmed non-conformant development schema with one forward-only, additive correction. The change restores the Prisma catalog contract without replaying historical migrations, inventing financial values, or claiming production readiness.

## Scope

### In Scope
- Add `amountMinor BIGINT NOT NULL` with no default to `TusSubscriptionPlan`, `TusBillingRefund`, and `TusBillingLedger`; require all three tables to be empty before DDL.
- Add ten `TEXT NOT NULL` `id` primary keys after aggregate null/duplicate checks and existing-PK compatibility checks.
- Reconcile the fourteen incorrect same-name indexes without drops: safely rename each to deterministic aliases `tus_lscr_legacy_01`–`14`, then create canonical ordered indexes; stop if an alias is occupied.
- Record exactly one marker/migration, `20260911130000_tus_live_schema_conformance_repair`, after the existing launch and POS markers.

### Out of Scope / Non-goals
- No `20260831180000_tus_additive_migration_repair` marker, historical replay, `migrate deploy`, reset, `db push`, drop, table rebuild, row backfill, money default, or restore-over-current.
- No seed, provider, POS, browser/device, deployment, cloud, or production activity before metadata acceptance.

## Capabilities

### New Capabilities
- `tus-live-schema-conformance-repair`: bounded additive catalog correction and metadata acceptance.

### Modified Capabilities
- `tus-backend-database-hardening`: exact schema, lineage, backup, rollback, and evidence gates.

## Approach and Decisions

Use one catalog-guarded transaction exposed only as an explicit repair unit. Apply only to the root `.env` `DATABASE_URL`, `NODE_ENV=development`, with the existing confirmation flag, a verified restorable custom-format backup/isolated restore path, 60-second timeout, one retry, and redacted evidence. Require launch/POS markers exactly once and the new marker absent. Verify exact types, nullability, defaults, PK columns, and all 22 ordered/unique index definitions. Keep the historical marker intentionally absent. A failed gate performs zero writes; a post-commit mismatch is restore-required. `liveConformance=true` and launch may leave NO-GO only after a fresh metadata-only `REPEATABLE READ` receipt proves 62/62 tables, 26/26 money declarations, 68/68 PK contracts, 22/22 indexes, 3/3 constraints, marker lineage, `rowValuesRead=0`, and no runtime activity.

## Proposal Question Round: Assumptions and Unresolved Questions

- Can the operator provide a verified backup/restore handle and exact root `.env` development confirmation? Assumed required before apply.
- Will a fresh preflight prove the three money tables empty, ten `id` aggregates clean, compatible PK state, and free aliases? Otherwise apply stops.
- Can acceptance be limited to metadata evidence, with `liveConformance=false` and NO-GO retained for every failed condition? Yes; production readiness is not implied.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api/prisma/migrations/` | New | Explicit additive correction only. |
| `scripts/`, `tests/integration/tus/`, `docs/runbooks/` | Modified | Gates, redacted evidence, rollback/acceptance contracts. |

## Risks and Rollback

| Risk | Mitigation |
|---|---|
| Non-empty billing data or unsafe PK/index state | Hard preflight stop before writes. |
| DDL locks or post-commit mismatch | Backup gate; owner-approved restore only into an isolated target; no down migration or restore-over-current. |

## Dependencies and Delivery Boundary

Depends on the Prisma contract, existing launch/POS markers, runbooks, and verified isolated restore. Single PR; no chain; apply is later and limited to the root `.env` test target. No source, tests, migrations, database, deployment, or runtime execution occurs in proposal.

## Acceptance Criteria

- [ ] Focused static/regression evidence proves additive SQL, no defaults/backfill/destructive tokens, exact gates, idempotency, retry/timeout, redaction, and no provider calls.
- [ ] Authorized metadata receipt satisfies every stated count/marker condition; historical marker is reported intentionally absent.
- [ ] Any failure preserves `liveConformance=false` and NO-GO.
