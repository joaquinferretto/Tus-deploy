# Apply Progress: TUS Product Closure

## Status

- Mode: Strict TDD
- Delivery: auto-chain / feature-branch-chain
- Current work unit: PR5 / Phase 5 — Activation, Runbooks, Evidence
- Completed: 6/6 tasks
- Live conformance: false

## Completed Tasks

- [x] 1.1 Authenticated durable POS and marketplace contracts, durable tenant-scoped audit/outbox readback, POS lifecycle atomicity, and provider-free HTTP flow.
- [x] 2.1 Safe PostgreSQL target resolution, redaction, sanitized child environment, deferred reporting, and zero-side-effect accounting.
- [x] 2.2 Durable pilot schema/column gate, unique tenant-scoped fixtures, and additive migration validation behind the authorized-target gate.
- [x] 3.1 Restart/replay/conflict recovery, deterministic version errors, transactional conflict resolution, bounded child shutdown, timeout/error classification, pool closure, and targeted fixture cleanup that preserves durable evidence tables.
- [x] 4.1 Operations wiring across finance, delivery, support, and application composition, including explicit completion confirmation, append-only ledger conflicts, delivery evidence correlation, known-commitment support cases, mediation compensation, authenticated routes, and provider-free behavior.
- [x] 5.1 Truthful activation output, explicit evidence taxonomy, independent fail-closed gates, and operational stop/drain/quarantine/rollback/retry runbooks.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/foundation/p9-delivery-pos.test.mjs`, `tests/foundation/p9-marketplace.test.mjs` | Unit/in-memory HTTP | N/A (previous work unit) | ✅ Written | ✅ 18/18 focused tests passed | ✅ Lifecycle, readback, auth, and provider-free cases | ✅ Transactional POS lifecycle and tenant-scoped adapter readback |
| 2.1 | `tests/integration/tus/postgres-http-smoke.test.mjs` | Unit/orchestration boundary | ✅ 14/14 prior focused tests | ✅ Added zero-side-effect action assertion before instrumentation | ✅ 17/17 passed | ✅ No-target, malformed, unsafe/shared, TLS, fallback, sanitized child env, and startup/cleanup paths | ✅ Deferred evidence now carries exact action counters; pool queries are instrumented without exposing URLs |
| 2.2 | `tests/integration/tus/postgres-http-smoke.test.mjs` | Unit/schema-fixture boundary | ✅ 17/17 after PR2 RED additions | ✅ Added schema-column and unique-fixture assertions before exports | ✅ 17/17 passed | ✅ Two unique fixtures plus POS/delivery/readiness aggregate gates | ✅ Exported immutable schema gate and fixture factory; additive migration set remains unchanged |
| 3.1 | `tests/foundation/p9-delivery-pos.test.mjs`, `tests/integration/tus/postgres-http-smoke.test.mjs` | Unit/orchestration boundary | ✅ 17/17 PostgreSQL smoke + 12/12 POS tests | ✅ Added version-race, transactional-conflict, evidence-preserving-cleanup, child-shutdown, and timeout assertions before implementation | ✅ 36/36 focused tests passed | ✅ Version race, rollback, identical replay, hash/version conflicts, cleanup failure, timeout, pool close, child exit, deferred zero-side-effect paths | ✅ POS conflict resolution now uses the transaction port; Prisma version races map to `PosError`; smoke lifecycle records separate failure/cleanup evidence |
| 4.1 | `tests/foundation/p9-finance.test.mjs`, `tests/foundation/p9-delivery-pos.test.mjs`, `tests/foundation/p9-support-operations.test.mjs` | Unit/in-memory authenticated HTTP boundary | ✅ 36/36 prior PR3 focused tests | ✅ Added confirmation-only release, immutable ledger, delivery-finance evidence, correlation/outbox, known-commitment, mediation, and zero-provider assertions before implementation | ✅ 31/31 focused tests passed (17 delivery, 7 finance, 7 support) | ✅ Compatibility tests, API build, contract validation, security scan, policy validation, and activation report also passed | ✅ Cross-context lookup is injected through composition; legacy direct delivery fixtures remain provider-free; finance evidence is skipped when no marketplace commitment is discoverable |
| 5.1 | `tests/foundation/p9-activation.test.mjs`, `tests/foundation/p9-tus-runtime-readiness.test.mjs` | Unit/provider-free activation and runtime boundary | ✅ 14/14 prior readiness/activation tests | ✅ Added local PostgreSQL non-authorization, complete gate/readiness output, and operational runbook assertions before implementation | ✅ 17/17 focused tests passed | ✅ Four evidence classes, unavailable gates, disabled composition, append-only rollback, and runbook procedures are covered | ✅ Added precise `local-postgresql-http` failure classification and machine-readable readiness summary without enabling external actions |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/p9-delivery-pos.test.mjs tests/integration/tus/postgres-http-smoke.test.mjs` — exit 0; 36 tests passed, 0 failed, 0 skipped (16 POS + 20 smoke). |
| Runtime harness command/scenario and exact result | The focused command exercised provider-free in-memory/API lifecycle paths, identical replay/hash/version conflict cases, injected startup timeout/cleanup failure paths, and the PostgreSQL smoke deferred path; exit 0, 36 passed. No PostgreSQL URL was present, so the real PostgreSQL HTTP pilot did not connect or mutate. |
| PostgreSQL target evidence | `TUS_POSTGRES_URL` and `DATABASE_URL` were both absent in the execution environment. Deferred path returned `status: deferred`, `evidenceClass: local-postgresql-http`, `liveConformance: false`, and `actions: { connections: 0, migrations: 0, queries: 0, fixtures: 0, providerCalls: 0 }`. |
| Schema/migration evidence | Synthetic loopback `DATABASE_URL` + `apps/api/node_modules/.bin/prisma.cmd validate` — exit 0; Prisma schema valid. No connection or write. Existing additive migrations were validated by the schema/column gate and were not applied without an authorized disposable target. |
| API/mobile/contracts/build evidence | `pnpm --filter @factory/api build` — exit 0; `pnpm --filter @factory/api typecheck` — exit 0; `pnpm --filter @factory/contracts build` — exit 0; `pnpm --filter @factory/mobile typecheck` — exit 0. |
| Contract/security/policy evidence | `pnpm contracts:validate` — exit 0; 98 schemas validated. `pnpm run security:scan` — exit 0. `node scripts/security/validate-policy.mjs` — exit 0. |
| Activation evidence | `node scripts/activation/tus-readiness.mjs render-native` — exit 0; `not-production-ready` / `unavailable-deferred`, all gated actions disabled, `liveConformance:false`, `cloudCalls:false`, and `provisioned:false`. |
| Provider boundary | Provider-free local path only; provider and settlement calls remain 0. No Mercado Pago, WhatsApp, cloud, payout, custody, settlement, or production call was made. |
| PR2 evidence retained | `TUS_POSTGRES_URL` and `DATABASE_URL` remain absent; prior deferred result remains `liveConformance:false` with zero connection/migration/query/fixture/provider actions. |
| Compatibility/runtime evidence | `pnpm test -- tests/compatibility/workflow-contracts.test.mjs tests/foundation/p0-native-api.test.mjs tests/foundation/api-build-regression.test.mjs` — exit 0; 6 tests passed. PostgreSQL runtime smoke remained deferred without an approved target. |
| Contract/security/policy evidence | `pnpm contracts:validate` — exit 0; 98 schemas validated with existing ignored format warnings. `pnpm run security:scan` — exit 0. `node scripts/security/validate-policy.mjs` — exit 0. |
| Rollback boundary | Revert only PR3 behavior/tests in `apps/api/src/tus/pos/index.ts`, `apps/api/src/tus/adapters/delivery-pos.ts`, `scripts/test-runner-lib.mjs`, `tests/foundation/p9-delivery-pos.test.mjs`, and `tests/integration/tus/postgres-http-smoke.test.mjs`; preserve PR1–PR2 POS/catalog/router/schema/resolver work and never delete shared audit/outbox/ledger/DLQ/evidence records. |

### PR4 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/p9-finance.test.mjs tests/foundation/p9-delivery-pos.test.mjs tests/foundation/p9-support-operations.test.mjs` — exit 0; 31 tests passed, 0 failed, 0 skipped (17 delivery, 7 finance, 7 support). |
| Runtime harness command/scenario and exact result | The focused tests exercised authenticated HTTP delivery/support routes plus provider-free finance, delivery, mediation, correlation, and cross-context lookup scenarios; exit 0, 31 passed. No provider or PostgreSQL target was used. |
| Rollback boundary | Revert only PR4 changes in `apps/api/src/tus/application/tus-application-service.ts`, `apps/api/src/tus/composition/index.ts`, `apps/api/src/tus/finance/index.ts`, `apps/api/src/tus/finance/prisma.ts`, `apps/api/src/tus/delivery/index.ts`, `apps/api/src/tus/support/index.ts`, `apps/api/src/tus/http/router.ts`, `apps/api/src/tus/adapters/delivery-pos.ts`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260829140000_tus_operations_wiring/migration.sql`, and the three PR4 foundation tests; preserve PR1–PR3 behavior and durable evidence. |

### PR5 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/p9-tus-runtime-readiness.test.mjs tests/foundation/p9-activation.test.mjs` — exit 0; 17 tests passed, 0 failed, 0 skipped (3 runtime readiness + 14 activation). |
| Runtime harness command/scenario and exact result | `node scripts/activation/tus-readiness.mjs render-native` and `node scripts/activation/tus-readiness.mjs aws-terraform` — exit 0; both returned `not-production-ready`, `unavailable-deferred`, `evidenceClass: deferred`, `liveConformance: false`, all gated capabilities disabled, `planOnly: true`, `provisioned: false`, and `cloudCalls: false`. No credentials, provider, cloud, PostgreSQL, POS, or production action was performed. |
| PostgreSQL deferred harness | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` — exit 0; 20 tests passed, 0 failed, 0 skipped. `TUS_POSTGRES_URL` and `DATABASE_URL` were absent; no connection, migration, query, fixture, cleanup, or provider action occurred. |
| Full suite | `pnpm test` — exit 1; 466 passed, 1 failed, 0 skipped across 87 isolated suites. Pre-existing PR4 failure: `tests/foundation/p8-tus-finance.test.mjs` expects `completion_evidence_required`, implementation returns `completion_confirmation_required`; PR5 focused tests remain green. |
| Contracts/build/typecheck/lint | `pnpm contracts:validate` — exit 0; 98 schemas validated. `pnpm build` — exit 0; 4 Turbo tasks. `pnpm typecheck` — exit 0; 8 Turbo tasks. `pnpm lint` — exit 0; 6 tasks, warnings only. |
| Security/policy/cloud | `pnpm run security:scan` — exit 0; no tracked-secret findings. `node scripts/security/validate-policy.mjs` — exit 0. `pnpm exec node scripts/validation/cloud-native/validate-plan.mjs` — exit 0; Render and AWS valid, plan-only, `provisioned:false`, `cloudCalls:false`, `liveConformance:false`. |
| Rollback boundary | Revert only PR5 changes in `scripts/activation/tus-readiness.mjs`, `tests/foundation/p9-activation.test.mjs`, `tests/foundation/p0-native-boundaries.test.mjs`, `docs/evidence/readiness/tus-matrix.md`, `docs/evidence/native-smoke.md`, `docs/deployment/tus-readiness.md`, `docs/runbooks/tus-deployment.md`, `docs/runbooks/migration-rollback.md`, `docs/runbooks/job-replay.md`, and this PR5 task/progress entry. Preserve PR1–PR4 runtime behavior, migrations, neutral contracts, and durable audit/outbox/ledger/DLQ/evidence records. |

## Deviations and Issues

- No deviation from the PR5 design. Existing additive migrations were retained; no new domain table or destructive migration was introduced.
- The configured PostgreSQL pilot was intentionally deferred because neither approved environment variable was present. No `.env` file was inspected and no target was inferred from filesystem discovery.
- The full repository suite remains blocked by the pre-existing PR4 finance expectation mismatch; the readiness receipt records that failure instead of claiming an all-green suite.
- Prisma validation through package-filtered `exec` was unavailable in one invocation because the package binary was not resolved from the repository root; the API build and the direct API-local Prisma validation both passed.
- AJV reports existing ignored `date-time`, `uri`, and `email` format warnings during contract validation; the command still passed.

## Remaining Tasks

- [x] 3.1 Restart, replay, conflict, and cleanup
- [x] 4.1 Operations, finance, delivery, and support
- [x] 5.1 Activation, runbooks, and evidence

## Workload / PR Boundary

- Mode: chained PR slice
- Chain strategy: feature-branch-chain
- Current work unit: PR5 / Activation, Runbooks, Evidence
- Boundary: starts from the completed PR4 operations/finance/delivery/support slice; ends at explicit four-class evidence reporting, independent provider/cloud/legal/tax/KYC/KYB/browser/device/POS/production gates, disabled-by-default activation output, and documented stop/drain/quarantine/rollback/retry procedures. No external activation or data rollback was performed.
- Estimated review budget impact: focused activation/script/documentation/test slice in the automatic feature-branch chain; PR1–PR4 behavior was preserved.
