# Proposal: TUS Billing Schema Conformance Repair

## Intent

Restore the confirmed missing billing catalog as one bounded, forward-only additive correction. It must match the exact Prisma contracts without replaying history, fabricating lineage or financial data, or implying production readiness.

## Scope

### In Scope
- Create only these ten absent tables, empty and in source order: `TusBillingAccount`, `TusSubscriptionPlan`, `TusBillingRefund`, `TusBillingLedger`, `TusBillingIdempotency`, `TusBillingAudit`, `TusBillingOutbox`, `TusBillingDunning`, `TusBillingNumberSequence`, `TusAccountingExport`.
- Use exact Prisma-derived columns, PostgreSQL types, nullability, explicit defaults, ten `id TEXT NOT NULL` primary keys, unique constraints, and secondary indexes documented in `exploration.md`.
- Require root `.env` `DATABASE_URL`, explicit development confirmation, verified custom backup, actual isolated PostgreSQL 16.2 schema-only restore proof, fresh metadata preflight, marker lineage, and metadata acceptance.
- Require launch marker `20260909090000_tus_argentina_market_launch` and POS marker `20260911120000_tus_pos_index_constraint_repair` exactly once; require new marker `20260915160000_tus_billing_schema_conformance_repair` absent before DDL and exactly once after commit.

### Out of Scope
- Historical replay or marker fabrication; `20260911130000_tus_live_schema_conformance_repair` and `20260831180000_tus_additive_migration_repair` remain absent.
- No invented FKs, checks, triggers, defaults, backfill, row values, seed/POS/provider/runtime activity, deployment, database execution, review, or production-readiness claim.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `tus-live-schema-conformance-repair`: extend the bounded additive correction to create the ten absent billing tables while preserving its backup, target, lineage, evidence, and rollback boundaries.

## Approach

Guard one 60-second transaction with root-target, development, backup/restore, marker, and catalog checks. Existing exact tables are no-ops; partial/incompatible tables or object/marker collisions hard-stop before DDL. Retry at most once after cleanup; never retry an uncertain commit. Do not alter exact POS objects or infer relationships.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Read-only | Canonical contract. |
| `apps/api/prisma/migrations/`, `scripts/` | Planned | Explicit additive unit and guarded runner. |
| `tests/integration/tus/`, `docs/runbooks/` | Planned | Gates, idempotency, receipts, and restore proof. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Partial/incompatible objects or unsafe target | High | Metadata hard-stop before writes; require explicit target and restore proof. |
| Incomplete evidence mistaken for readiness | Med | Acceptance requires 62/62 tables, 26/26 money, 68/68 PKs, 22/22 indexes, 3/3 constraints, marker counts, and `rowValuesRead=0`; otherwise `NO-GO`, `liveConformance=false`. |

## Rollback Plan

Pre-commit failures roll back. Post-commit mismatch requires owner-approved restore to an isolated target only; never down-migrate or restore over the current target.

## Dependencies

- Reviewed SQL/runner, owner-approved root development target, fresh preflight, verified custom backup, actual isolated restore proof, and independent seed/POS gates after metadata acceptance.

## Success Criteria

- [ ] Ten tables conform exactly, with empty-safe creation and hard-stop handling for partial/incompatible state.
- [ ] Redacted evidence proves backup/restore, marker lineage, metadata acceptance, and truthful `NO-GO`/`liveConformance` status.
- [ ] No production-readiness claim is emitted.
