# Proposal: TUS Product Closure

## Intent

Close the remaining runtime/product gaps from the REAL `tus-live-pos-completion` audit after `tus-live-runtime-correction`. This is correction phase 2 of 2, followed by a final UI/UX improvement SDD phase. It must improve proof without fabricating external readiness.

## Scope

### In Scope
- Complete authenticated durable POS/marketplace integration and safe PostgreSQL pilot orchestration.
- Prove migration, restart/replay/conflict, receipt, delivery handoff, audit/outbox, cleanup, and provider non-interaction when a disposable target is authorized.
- Wire finance, delivery, support, activation/evidence reporting, and production runbook/rollback controls.

### Out of Scope
- Production activation, provider/cloud/settlement calls, financial reversal, or non-disposable mutation.
- Browser, accessibility, responsive/device, physical POS, and visual UI work; reserved for final UI/UX.
- Expansion beyond the Argentina-first MVP, existing cohorts, tenancy, auth, and fail-closed non-goals.

## Capabilities

### New Capabilities
- `tus-product-closure-runtime`: authenticated durable POS/marketplace pilot and replay/restart evidence.
- `tus-operations-finance-delivery-support`: durable operational states, handoff, disputes/cases, and finance boundaries.
- `tus-activation-evidence-runbooks`: truthful readiness reports and append-only deployment rollback.

### Modified Capabilities
- None; no authoritative `openspec/specs/` capabilities exist.

## Approach

Extend phase 1 resolver, transaction, readiness, and lifecycle gates. Use the provider-free authenticated harness and Prisma paths; execute PostgreSQL only after explicit disposable identity/safe-target proof. Absent, invalid, or unsafe prerequisites produce secret-free deterministic deferred reports, zero database/provider actions, and disabled gates. Preserve evidence-class separation and Argentina-first boundaries.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api/src/tus/`, `apps/api/prisma/` | Modified | Durable POS/marketplace, finance, delivery, support, and evidence state. |
| `scripts/test-runner-lib.mjs`, `tests/integration/tus/` | Modified | Safe pilot, restart/replay, cleanup, and deferred reporting. |
| `scripts/activation/`, `docs/evidence/`, `docs/runbooks/` | Modified | Activation matrix, evidence claims, deployment and rollback. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| No safe target/credentials | High | Defer deterministically; do not connect, migrate, or write. |
| Operational state implies provider readiness | High | No-call switches, evidence classes, fail-closed activation. |
| Cleanup damages proof | Medium | Unique fixtures; preserve append-only audit/outbox/evidence. |

## Rollback Plan

Stop intake, drain/quarantine replay work, preserve ledger/audit/outbox/DLQ/evidence, and revert only this change. Delete only unique disposable fixtures; use append-only financial compensation, never destructive shared-state rollback.

## Dependencies

- Completed `tus-live-runtime-correction`, TUS auth/readiness/contracts, Node/pnpm/Prisma.
- Authorized disposable PostgreSQL target is optional for execution; absence remains deferred.

## Success Criteria

- [ ] Durable authenticated POS/marketplace scenarios prove restart, replay, conflict, receipt, handoff, audit/outbox, and cleanup when safely runnable.
- [ ] Finance, delivery, and support flows are durable, tenant-scoped, and provider/settlement-safe.
- [ ] Missing/unsafe prerequisites yield secret-free deferred reports, no execution, and disabled gates.
- [ ] Activation evidence and production runbook/rollback are truthful; no live-completion claim is emitted.
- [ ] Argentina-first scope remains intact and the next UI/UX phase is unblocked.
