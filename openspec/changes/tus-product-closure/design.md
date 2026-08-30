# Design: TUS Product Closure

## Technical Approach

Reconcile the three closure capabilities around the existing authenticated `/tus/v1/*` router, Prisma-owned aggregates, and phase-1 PostgreSQL safety gate. Do not add a second store or readiness authority. Each bounded context receives a transaction-aware adapter; the pilot uses only approved `TUS_POSTGRES_URL`/`DATABASE_URL`, generated tenant fixtures, and existing migrations. Missing, unsafe, unavailable, expired, conflicting, or failed prerequisites stop before side effects and emit redacted evidence.

## Requirement-to-Implementation Map

| Specification requirement | Concrete implementation and RED proof |
|---|---|
| Authenticated durable POS/marketplace | `apps/api/src/tus/http/router.ts`, `composition/index.ts`, `adapters/delivery-pos.ts`; `tests/integration/tus/postgres-http-smoke.test.mjs` proves bearer, tenant/device/session, fleet readiness, onboarding, listing, checkout, product/service POS, receipts, versions, audit, and outbox. |
| Replay, conflict, restart, transaction failure | `apps/api/src/tus/pos/index.ts` and `adapters/delivery-pos.ts` make operation, receipt, version, idempotency, conflict, audit, and outbox atomic; RED tests in `tests/foundation/p9-delivery-pos.test.mjs` and restart/hash/version scenarios in the PostgreSQL smoke assert zero partial effects. |
| Bounded cleanup and recovery | `scripts/test-runner-lib.mjs` records the run in `RunLedger`, stops/awaits the API child, closes the pool, resolves transactions, and deletes only generated mutable IDs; audit/outbox/ledger/DLQ/evidence remain until verification. Cleanup-failure tests preserve the original classification, owner, and rerun guidance. |
| Durable delivery handoff | `apps/api/src/tus/delivery/index.ts` and `adapters/delivery-pos.ts` transactionally persist proof, task version, handoff, audit, and outbox; `p9-delivery-pos.test.mjs` and the smoke cover missing proof, stale version, foreign tenant, closed shift, and provider-free handoff. |
| Append-only finance | `apps/api/src/tus/finance/index.ts`, `finance/prisma.ts`, and `application/tus-application-service.ts` persist payment/commission/evidence/confirmation/freeze/ledger state atomically per context; `tests/foundation/p9-finance.test.mjs` proves held/not-claimed state, confirmation-only release, no timeout release, immutable snapshots, replayed refunds, freezes, and zero provider calls. |
| Governed support/disputes | `apps/api/src/tus/support/index.ts` and router persist tenant/correlation-linked cases, bilateral evidence, durable timeline, and compensating entries; inject commitment lookup so unknown commitments fail before mutation. `tests/foundation/p9-support-operations.test.mjs` proves invalid/foreign cases and resolution never authorize finance/provider activity. |
| Provider non-interaction | `composition/index.ts`, `tus/integration/index.ts`, finance/provider adapters, and smoke spies keep Mercado Pago, WhatsApp, cloud, payout, custody, and settlement calls at zero; provider credentials never override readiness. |
| Truthful activation/evidence | `scripts/test-runner-lib.mjs`, `scripts/activation/tus-readiness.mjs`, and `docs/evidence/readiness/tus-matrix.md` preserve `local-deterministic`, `local-postgresql-http`, `authorized-external`, and `deferred`; classify infrastructure as `unavailable` and invariant breaks as `assertion-failure`. `p9-tus-runtime-readiness.test.mjs` and `p9-activation.test.mjs` require disabled gates and `liveConformance:false` for local/deferred results. |
| Runbook and rollback | `docs/runbooks/tus-deployment.md`, `migration-rollback.md`, `job-replay.md`, `profile-rollback.md`, and `docs/deployment/tus-readiness.md` define preflight, stop/drain/quarantine, health/evidence capture, owner escalation, retry-from-zero, last-passing profile/schema, and append-only compensation. |

## Architecture Decisions

| Choice | Rejected | Rationale |
|---|---|---|
| Context-local Prisma `$transaction` with shared tenant, actor, correlation, and idempotency contracts. | Cross-domain mega-transaction or independent writes. | Preserves Clean/Hexagonal boundaries while preventing partial effects. |
| Reuse `RunLedger`, existing TUS audit/outbox, and immutable finance ledger. | New closure store or destructive reset. | Existing ownership and replay contracts already provide durable lineage. |
| Keep the current readiness guard; require a current scoped fleet decision for POS/delivery. | Permit deterministic/local evidence to authorize mutations. | Meets the closure spec without weakening production fail-closed behavior. |

## Data Flow

```text
approved env → target/redaction gate → schema/migrations → authenticated API child
  → marketplace checkout → POS operation/receipt → delivery proof/handoff
  → finance held/not-claimed + support case → restart/replay/conflict
  → durable counts/evidence → stop/close → targeted mutable cleanup
```

## File Changes and Migration

Modify the paths named above plus `apps/api/prisma/schema.prisma`. Validate and, only after the target gate passes, apply the existing additive migrations `20260826130000_tus_delivery_pos`, `20260827090600_tus_delivery_pos`, `20260826120000_tus_finance`, `20260827090700_tus_support_reporting`, and `20260829120000_tus_pos_runtime_correction`. No new domain table or destructive migration is required; schema drift is a deferred failure requiring a separate additive change.

## Testing and Evidence Boundaries

`pnpm test`, build, typecheck, contract, and focused unit tests are `local-deterministic`. The configured smoke is the sole `local-postgresql-http` path and must report migration mode, scenario statuses, counts, cleanup, and provider-call totals. No target or unsafe target means zero connection/migration/query/fixture/provider actions and `deferred`. An actually authorized external run is not executed by this design and remains a separate `authorized-external` gate; no local result becomes production evidence.

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior | Planned RED test |
|---|---|---|---|
| HTTP route/version and process integration | Applicable | Canonical `/tus/v1/*`, bearer and tenant authority; deny 401/403/409 before effects. | Unsupported version, auth, foreign tenant, closed session, readiness denial. |
| Shell/subprocess lifecycle | Applicable | Fixed argv/env, bounded timeout, awaited shutdown, pool close, no secret interpolation. | Sanitized child env and startup/timeout cleanup. |
| Documentation-like paths | N/A — no executable classification changes. | No execution. | None. |
| Git selection, commit, push, PR commands | N/A — no VCS/PR automation. | No commands. | None. |

## Rollout / Rollback

Run RED tests, then adapters/services, then the gated disposable smoke. On any deployment, migration, startup, assertion, or pilot failure, stop intake, drain/quarantine work, preserve append-only records, return to the last passing profile/schema, and retry only after fresh preflight with unique fixtures. Delete only unique mutable fixtures; financial correction is append-only. Production, provider, settlement, cloud, browser/device, and POS activation remain disabled unless independently authorized.

## Open Questions

None. The disposable target and scoped fleet evidence are execution prerequisites represented as deferred gates, not unresolved design dependencies.
