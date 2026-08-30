# Tasks: TUS Product Closure

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,200–2,000 |
| Configured review budget | 99,999 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 POS/marketplace → PR2 pilot → PR3 recovery → PR4 operations → PR5 evidence |
| Delivery / chain | auto-chain / feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Local evidence is `liveConformance:false`; provider, settlement, cloud, production, and live-POS claims require independent authorization.

### Suggested Work Units

| Unit / base | Focused test command | Runtime harness | Migration / rollback boundary |
|---|---|---|---|
| PR1 / `feature/tus-product-closure` | `pnpm test -- tests/foundation/p9-delivery-pos.test.mjs tests/foundation/p9-marketplace.test.mjs` | Authenticated `/tus/v1/*`; provider-free | POS/catalog/router/tests |
| PR2 / PR1 | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` | Authorized disposable PostgreSQL; no-target deferred | Additive migrations; unique fixtures |
| PR3 / PR2 | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs tests/foundation/p9-delivery-pos.test.mjs` | Child restart/replay/conflict/cleanup injection | Preserve audit/outbox/ledger/DLQ/evidence |
| PR4 / PR3 | `pnpm test -- tests/foundation/p9-finance.test.mjs tests/foundation/p9-support-operations.test.mjs` | Authenticated provider-free journey | Bounded services/adapters/router |
| PR5 / PR4 | `pnpm test -- tests/foundation/p9-tus-runtime-readiness.test.mjs tests/foundation/p9-activation.test.mjs` | `node scripts/activation/tus-readiness.mjs render-native`; deferred | Activation/docs/tests; no data rollback |

## Phase 1: Authenticated POS and Marketplace

- [x] 1.1 **RED → GREEN → REFACTOR:** RED `tests/foundation/p9-delivery-pos.test.mjs`, `tests/foundation/p9-marketplace.test.mjs`, `tests/integration/tus/postgres-http-smoke.test.mjs` for unsupported API version, missing/expired bearer, spoofed/foreign tenant, closed session, readiness denial, product/service POS, and marketplace durability; GREEN/REFACTOR `apps/api/src/tus/http/router.ts`, `apps/api/src/tus/composition/index.ts`, `apps/api/src/tus/pos/index.ts`, `apps/api/src/tus/adapters/delivery-pos.ts`, `apps/api/src/tus/adapters/prisma-marketplace.ts`. Use PR1 evidence; rollback these files/tests; no provider claim.

## Phase 2: Safe PostgreSQL Pilot

- [x] 2.1 **RED → GREEN → REFACTOR:** RED `tests/integration/tus/postgres-http-smoke.test.mjs` for no-target, malformed/shared-production, TLS/identity, sanitized child environment, and zero connection/migration/query/fixture/provider actions; GREEN/REFACTOR `scripts/test-runner-lib.mjs` resolver/redaction/deferred report. Use PR2 evidence; rollback runner/tests; never inspect `.env`.
- [x] 2.2 **RED → GREEN → REFACTOR:** RED schema/migration/tenant-fixture gates in `tests/integration/tus/postgres-http-smoke.test.mjs`; GREEN/REFACTOR `apps/api/prisma/schema.prisma` plus existing additive migrations `20260826130000_tus_delivery_pos`, `20260827090600_tus_delivery_pos`, `20260826120000_tus_finance`, `20260827090700_tus_support_reporting`, `20260829120000_tus_pos_runtime_correction`. Use PR2 evidence; additive/unique-fixture rollback only.

## Phase 3: Restart, Replay, Conflict, Cleanup

- [x] 3.1 **RED → GREEN → REFACTOR:** RED transaction/receipt failure, startup/timeout, identical replay, changed-hash, stale-version, and cleanup failure in `tests/integration/tus/postgres-http-smoke.test.mjs` and `tests/foundation/p9-delivery-pos.test.mjs`; GREEN/REFACTOR `apps/api/src/tus/pos/index.ts`, `apps/api/src/tus/adapters/delivery-pos.ts`, `scripts/test-runner-lib.mjs` stop/await/close/targeted-delete. Use PR3 evidence; preserve audit/outbox/ledger/DLQ/evidence.

## Phase 4: Operations, Finance, Delivery, Support

- [x] 4.1 **RED → GREEN → REFACTOR:** RED confirmation-only/no-timeout release, append-only compensation, invalid/stale/cross-tenant handoff, bilateral support evidence, unknown commitment, and zero provider calls in `tests/foundation/p9-finance.test.mjs`, `tests/foundation/p9-delivery-pos.test.mjs`, `tests/foundation/p9-support-operations.test.mjs`; GREEN/REFACTOR `apps/api/src/tus/application/tus-application-service.ts`, `apps/api/src/tus/finance/index.ts`, `apps/api/src/tus/finance/prisma.ts`, `apps/api/src/tus/delivery/index.ts`, `apps/api/src/tus/support/index.ts`, `apps/api/src/tus/composition/index.ts`, `apps/api/src/tus/http/router.ts`. Use PR4 evidence; bounded rollback; no settlement claim.

## Phase 5: Activation, Runbooks, Evidence

- [x] 5.1 **RED → GREEN → REFACTOR:** RED evidence-class separation, missing/expired/revoked/conflicting gates, disabled capabilities, `liveConformance:false`, and append-only rollback in `tests/foundation/p9-tus-runtime-readiness.test.mjs`, `tests/foundation/p9-activation.test.mjs`; GREEN/REFACTOR `scripts/activation/tus-readiness.mjs`, `docs/evidence/readiness/tus-matrix.md`, `docs/deployment/tus-readiness.md`, `docs/runbooks/tus-deployment.md`, `docs/runbooks/migration-rollback.md`, `docs/runbooks/job-replay.md`. Use PR5 evidence; rollback activation/docs/tests; never production evidence.
