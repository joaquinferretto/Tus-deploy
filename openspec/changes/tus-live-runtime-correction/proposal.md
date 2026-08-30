# Proposal: TUS Live Runtime Correction

## Intent

Correct runtime blockers in the REAL audit. Both variables were absent; no connection, migration, write, or POS pilot was attempted. Correction phase 1 of exactly two, before UI/UX.

## Scope

### In Scope
- Define canonical runtime configuration and redacted diagnostics.
- Resolve `TUS_POSTGRES_URL` then `DATABASE_URL`; require disposable/test identity and destructive-operation checks before any database action.
- Fix Prisma POS versioning, transaction, audit/outbox, and readiness defects blocking evidence.
- Run authenticated PostgreSQL HTTP/POS smoke only with a validated safe URL; otherwise report deterministic deferral, never a pilot.

### Out of Scope
- Production, provider, cloud, settlement, financial rollback, or non-disposable mutation.
- Physical POS, browser/device/accessibility, or UI/UX validation.
- Operations/product gaps assigned to correction phase 2.
- Any weakening of TUS tenancy, auth, financial, provider, audit, or fail-closed boundaries.

## Capabilities

### New Capabilities
- `tus-runtime-configuration-diagnostics`: canonical profiles and redacted prerequisites.
- `tus-safe-postgresql-evidence`: URL validation, disposable gates, and live/deferred evidence.
- `tus-durable-pos-runtime`: transactional Prisma POS and authenticated smoke.

### Modified Capabilities
- None; no authoritative `openspec/specs/` capabilities currently exist.

## Approach

Use strict TDD around one resolver/diagnostic contract and deny-by-default gates. Preserve absence as deferred; never infer reachability or fabricate a pilot. With safe infrastructure, cover authenticated tenant/device/session, product/service POS, replay/conflict, receipt, delivery, audit/outbox, restart, cleanup, and provider non-interaction. Keep activation fail-closed and evidence classes separate.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `scripts/test-runner-lib.mjs`, `tests/integration/tus/postgres-http-smoke.test.mjs` | Modified | Resolver, redaction, gate, smoke/deferred orchestration. |
| `apps/api/src/tus/pos/`, `apps/api/src/tus/adapters/delivery-pos.ts` | Modified | Durable POS correctness. |
| `apps/api/src/tus/composition/`, `apps/api/src/tus/http/`, `apps/api/prisma/` | Modified | Readiness and persistence boundary. |
| `docs/evidence/`, `scripts/activation/` | Modified | Truthful claims and fail-closed activation. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| No safe URL | High | Deterministic deferred report; no connection/write. |
| Unsafe URL classification | High | Redaction, identity proof, deny-by-default. |
| Transaction regression | Medium | In-memory parity and failure/restart tests. |

## Rollback Plan

Disable corrected smoke/POS gates, preserve append-only audit/outbox evidence, and revert only this change's edits. Never destructively roll back financial or shared database state.

## Dependencies

- Node 22, pnpm/Turbo, Prisma, and TUS auth/readiness contracts.
- Authorized disposable PostgreSQL boundary; absence remains valid deferral.

## Success Criteria

- [ ] Diagnostics classify absent, invalid, unsafe, and usable prerequisites with zero leakage.
- [ ] No database mutation occurs without disposable proof; audited absence remains deferred.
- [ ] POS/version/transaction/audit/outbox/readiness blockers have regression tests; `pnpm test` stays green.
- [ ] A safe URL yields authenticated PostgreSQL restart/replay/conflict evidence; otherwise no connection is attempted.
- [ ] Activation stays fail-closed; no production, provider, settlement, or POS-pilot claim is emitted.
