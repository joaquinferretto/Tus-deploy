# Proposal: TUS Additive Migration Repair

## Intent

Make the authorized remote-development PostgreSQL target schema-ready without replaying its 25-migration backlog: no ledger is applied and 19 statements are destructive. Only 1 of 15 required POS/hardening tables is present; the blocked attempt performed no migration, write, or delete.

## Proposal question round

Assumptions to confirm before implementation: an authorized backup/restore point exists, and the repair may create one auditable forward-only ledger entry for the schema baseline. Target disposability remains an operator attestation, never an inference.

## Scope

### In Scope
- Inventory/classify all pending migrations and SQL statements.
- Produce a target-specific additive-only path from the current Prisma schema; forbid `DROP`, `TRUNCATE`, `CASCADE`, and untagged `DELETE`.
- Preserve rows and `_prisma_migrations` semantics; statically validate before apply.
- Apply only the approved path via root `.env` `DATABASE_URL`, `NODE_ENV=development`, `--confirm-development-target`, 60-second bounds, and one retry.
- Verify tables, constraints, indexes, cleanup, and tagged evidence; rerun durable POS tests.

### Out of Scope
- Historical migration rewriting/deletion, production, cloud/provider/compliance, hardware, alternate URLs, new environment variables, and unrelated changes.

## Capabilities

### New Capabilities
- `tus-additive-migration-repair`: Inventory, static gating, additive repair, schema verification, and durable POS evidence.

### Modified Capabilities
- None (no main `openspec/specs/` capability files are present).

## Approach

Classify SQL as additive, destructive, comment-only, or ambiguous; reject destructive/ambiguous statements before connecting. Generate idempotent DDL from `schema.prisma` with explicit ledger handling, never pretending historical migrations ran. Require a backup/restore point. Abort on target/profile mismatch, missing backup, gate failure, unexpected schema/data, retry exhaustion, or cleanup uncertainty. Tag evidence `static-migration-inventory`, `static-sql-gate`, `authorized-remote-development`, `real-postgres-schema`, and `durable-pos`.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api/prisma/migrations/` | New | Versioned additive repair; historical files unchanged. |
| `scripts/`, `tests/integration/tus/` | Modified/New | Inventory, gate, bounded apply/verification, POS evidence. |
| `openspec/changes/tus-additive-migration-repair/` | New | SDD artifacts and evidence only. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Schema/ledger mismatch or hidden destructive SQL | High | Inventory, static gate, abort before apply. |
| Partial remote DDL | Med | Backup/restore point and idempotent/forward recovery. |
| Orphaned helper process | Low | Exact PID/argv/port tracking and bounded `finally` cleanup. |

## Rollback Plan

Stop on any failed gate. Restore from the pre-apply backup if needed; otherwise preserve the forward-only state for diagnosis. Revert only proposal/harness artifacts; never reset, truncate, cascade-delete, or rewrite historical migrations.

## Dependencies

- Authorized remote-development target, root `.env` `DATABASE_URL`, Prisma schema, and backup/restore capability.

## Success Criteria

- [ ] Classification/static report has zero unapproved statements.
- [ ] Repair meets bounds, preserves data, and records auditable ledger state.
- [ ] Required schema verifies and durable POS tests pass with truthful tagged evidence and zero provider claims.
