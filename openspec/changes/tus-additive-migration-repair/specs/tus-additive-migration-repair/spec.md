# TUS Additive Migration Repair Specification

## Purpose

Make the authorized development PostgreSQL target schema-ready without replaying unsafe history or overstating live evidence.

## Requirements

### Requirement: Inventory and refuse unsafe backlog
The repair MUST inventory every pending migration and executable statement, classify it as additive, destructive, comment-only, or ambiguous, and refuse destructive or ambiguous selections before writes. Historical migrations MUST NOT be rewritten/deleted; `DROP`, `TRUNCATE`, `CASCADE`, destructive `UPDATE`, and untagged `DELETE` are forbidden.

#### Scenario: Static refusal
- GIVEN the 25-migration backlog contains rejected destructive tokens
- WHEN inventory and gating run
- THEN redacted `static-migration-inventory` and `static-sql-gate` evidence is emitted, with zero migration, write, or delete calls

### Requirement: Fail-closed target and secrecy
The runner MUST use only root `.env` `DATABASE_URL`, require process `NODE_ENV=development` plus `--confirm-development-target`, and reject production or unproven/shared targets. Alternate URLs, new variables, URLs, credentials, tokens, and secrets MUST NOT be used or emitted.

#### Scenario: Production refusal
- GIVEN `NODE_ENV=production`, with or without confirmation
- WHEN repair is requested
- THEN it refuses before connection side effects and records only redacted denial evidence

### Requirement: Additive repair and ledger integrity
The approved path MUST be a forward-only, idempotent baseline derived from `schema.prisma`; it MAY create missing objects/safe additive columns, MUST preserve rows and shape, and MUST abort on mismatch, unexpected data, orphan, or gate failure. It MUST create `_prisma_migrations` only when absent, preserve existing rows, and record exactly one completed repair marker without historical markers or ledger rewrites/deletions.

#### Scenario: Safe replay
- GIVEN existing objects, rows, or a completed repair marker
- WHEN the baseline runs once or twice
- THEN counts and existing definitions remain unchanged, missing objects are created once, and skipped history is not claimed as applied

### Requirement: Backup and rollback
No write may begin without an operator-supplied restorable backup handle. Partial failure MUST stop and require restore; down migrations, reset, truncate, cascade delete, and hidden cleanup are prohibited. Rollback evidence MUST be metadata-only and redacted.

#### Scenario: Backup gate
- GIVEN no verified restorable backup exists
- WHEN preflight runs
- THEN it stops with zero writes, deletes, or migration invocations

### Requirement: Bounded connection and startup
Each connection or owned service start MUST finish within 60 seconds; exactly one retry is allowed and a third attempt is forbidden. Exhaustion MUST fail closed and verify tracked-resource cleanup.

#### Scenario: Finite retry
- GIVEN both attempts fail or time out
- WHEN retry handling completes
- THEN exactly two attempts are recorded, no third attempt occurs, and cleanup passes

### Requirement: Required schema proof
Verification MUST prove these 15 tables: `TusDeliveryZone`, `TusDeliveryShift`, `TusDeliveryTask`, `TusDeliveryProof`, `TusDeliveryIncident`, `TusDeliveryAudit`, `TusPosOperation`, `TusPosReceipt`, `TusPosDevice`, `TusPosSession`, `TusPosConflict`, `TusPosVersion`, `TusDeliveryOutbox`, `TusPosOutbox`, `TusPosAudit`. Each MUST match `schema.prisma` columns, `id` primary key, tenant-scoped unique constraints, and model indexes (including operation/idempotency, shift/version, receipt, conflict, outbox, and audit indexes).

#### Scenario: Schema mismatch blocks runtime
- GIVEN repair completes
- WHEN catalog introspection compares the target with Prisma
- THEN all objects pass with redacted aggregate evidence, or POS execution is blocked

### Requirement: Durable POS and truthful evidence
After schema proof, verification MUST rerun product/service POS, idempotent replay, version conflict, tenant isolation, receipt/audit/outbox persistence, restart replay, and exact tagged cleanup, with provider calls `0`. Evidence MUST be redacted and preserve tags `static-migration-inventory`, `static-sql-gate`, `authorized-remote-development`, `real-postgres-schema`, `durable-pos`; incomplete live proof remains `external-blocked`, never success. Production remains fail-closed.

#### Scenario: Incomplete proof remains blocked
- GIVEN schema, POS, or cleanup verification cannot complete
- WHEN evidence is finalized
- THEN no live-success tag is claimed and the blocker plus zero unperformed side effects is recorded
