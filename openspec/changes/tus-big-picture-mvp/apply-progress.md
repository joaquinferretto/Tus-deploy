# Apply Progress: TUS Big Picture MVP

## Status

- **Mode:** Strict TDD
- **Artifact store:** OpenSpec
- **Delivery strategy:** auto-chain
- **Chain strategy:** feature-branch-chain
- **Work unit:** Work Unit 7 — deployment/evidence
- **Boundary:** Implemented and verified tasks 7.1–7.3 only. Work Units 1–6 are preserved unchanged.
- **Initial status:** `applyState=ready`, 18/21 tasks complete before this batch. Prior Work Units 1–6 evidence was preserved and merged.

## Completed Tasks

- [x] 1.1 RED `[GATE]` — Added focused Stage 1 cohort, evidence-gate, deterministic-label, rollback, timestamp, and disposition-consistency tests.
- [x] 1.2 GREEN `[GATE]` — Implemented versioned readiness DTOs and validators, fail-closed capability evaluation, readiness persistence models/migration, and readiness JSON schemas.
- [x] 1.3 REFACTOR `[GATE]` — Preserved explicit evidence ownership/scope/policy/expiry/revocation documentation and extracted reusable contract-state validation without changing behavior.
- [x] 2.1 RED `[PROD]` — Added Express/API contract tests for bearer-session authority, spoof/tenant denial, mixed commitments, replay/conflict, atomic rollback, and PostgreSQL schema ownership.
- [x] 2.2 GREEN `[PROD]` — Implemented session-derived tenant context, permission-checked TUS routes, transaction ports, rollback-safe in-memory harness, Prisma TUS repositories/transaction composition, durable commitment/audit models and migration, and production server wiring.
- [x] 2.3 REFACTOR `[PROD]` — Isolated focused HTTP/persistence tests, retained audit/outbox/idempotency writes in one transaction boundary, added PostgreSQL source-of-truth adapters, and verified compatibility with the existing TUS suite.
- [x] 3.1 RED `[PROD]` — Added focused HTTP/persistence tests for complete merchant onboarding, Stage 1 scope, publication, stale commercial facts, product stock, service overlap, separate commitments, replay, cross-tenant denial/audit, schema durability, and web-client paths.
- [x] 3.2 GREEN `[PROD]` — Implemented merchant/catalog/service availability models, marketplace checkout and commitment boundaries, tenant-authorized Express routes, Prisma source-of-truth models/adapters/migration, versioned contract DTO/schema, and web client operations.
- [x] 3.3 REFACTOR `[PROD]` — Preserved denial audits, deterministic runtime labels, idempotent replay, and rollback behavior that removes/unpublishes listing mutations without deleting commitments.
- [x] 4.1 RED `[PROD gated]` — Added RED-first provider, payment, confirmation-first release, immutable snapshot, freeze, compensation, reconciliation quarantine, tenant-isolation, route, and schema tests.
- [x] 4.2 GREEN `[PROD gated]` — Implemented finance application/store boundaries, Mercado Pago payment-intent adapter boundary, Prisma financial aggregates/migration, guarded release scheduling, immutable commission/ledger records, evidence/release policy, freezes, compensation, and reconciliation.
- [x] 4.3 REFACTOR `[GATE]` — Kept default production composition fail-closed with unavailable provider and disabled Argentina gates; Prisma ledger appends never update historical entries and all deterministic evidence is labeled test-only.

## TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/foundation/p8-tus-readiness.test.mjs` | Unit/contract | ✅ Existing 7/7 focused tests passed before the new edge-case assertions | ✅ Added malformed-expiry and contradictory-disposition assertions first; 7 passed, 1 failed with `Missing expected exception` | ✅ 8/8 after readiness factory and contract validation changes | ✅ 9/9 with RFC3339 offset and deterministic deferred-state cases | ✅ Focused suite remained 9/9 after cleanup | 
| 1.2 | `tests/foundation/p8-tus-readiness.test.mjs` | Unit/contract | ✅ 7/7 | ✅ Covered by 1.1 RED | ✅ `pnpm --filter @factory/contracts build` and focused suite passed; 9/9 | ✅ Approved, excluded, missing, expired, revoked, scoped, deterministic, and rollback paths covered | ✅ Runtime contract-state checks are centralized in the contracts package |
| 1.3 | `tests/foundation/p8-tus-readiness.test.mjs` | Unit/contract | ✅ 9/9 | ✅ Covered by 1.1 RED | ✅ Focused suite passed; API build also passed with a provider-free `DATABASE_URL` placeholder | ✅ Valid and invalid timestamp variants plus authorized/deferred/disabled dispositions covered | ✅ Extracted `isReadinessDecisionConsistent`; focused suite remained 9/9 |
| 2.1 | `tests/foundation/p8-tus-commerce-api.test.mjs` | Unit/HTTP contract | ✅ Existing TUS compatibility suite passed 22/22 after the slice | ✅ New RED suite failed on missing HTTP router and migration; 0/4 passed | ✅ Focused suite passed after minimal route/context/schema implementation; 4/4 | ✅ Added replay/conflict and transaction rollback cases; 5/5 passed | ✅ Transaction repositories and HTTP authority parsing were isolated without behavior change |
| 2.2 | `tests/foundation/p8-tus-commerce-api.test.mjs` | HTTP/persistence contract | N/A (new adapter/route files) | ✅ Covered by 2.1 RED | ✅ Focused suite 5/5; API build passed | ✅ Session-derived tenant, two commitment contexts, audit/outbox, Prisma schema/migration, and cross-tenant denial covered | ✅ Prisma transaction composition and server wiring compile cleanly |
| 2.3 | `tests/foundation/p8-tus-commerce-api.test.mjs` | HTTP/persistence contract | ✅ Existing TUS compatibility suite 22/22 | ✅ Covered by 2.1 RED | ✅ Focused suite 5/5 | ✅ Conflict replay and failure rollback exercised with non-trivial records | ✅ Full compatibility suite remained 22/22; no behavior change outside WU2 |

The initial WU1 implementation files and checkboxes were already present in the dirty working tree when this executor started. This batch validated that implementation and added the missing RED-first contract-hardening cases before updating the corresponding production behavior.

## WU3 TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.1 | `tests/foundation/p8-tus-marketplace.test.mjs` | HTTP/persistence contract | N/A (new WU3 test file) | ✅ Written first; initial focused run failed before marketplace production modules/routes existed | ✅ Focused suite passed 5/5 after minimal marketplace composition and routes | ✅ Complete/incomplete onboarding, approved/excluded cohort, publish, stale facts, stock exhaustion, overlapping service slot, separate product/service commitments, replay, and authorization denial covered | ✅ Validation and authorization helpers were centralized without changing accepted behavior |
| 3.2 | `tests/foundation/p8-tus-marketplace.test.mjs` | HTTP/persistence contract | N/A (new marketplace adapters/models) | ✅ Covered by 3.1 RED | ✅ Focused suite 5/5; contracts build, 84-schema validation, and API build passed | ✅ In-memory Express harness exercised discovery and checkout; Prisma schema/migration and adapter paths compile | ✅ Product stock and service-slot state remain separate; no universal lifecycle introduced |
| 3.3 | `tests/foundation/p8-tus-marketplace.test.mjs` | HTTP/persistence contract | ✅ WU3 focused suite 5/5 after GREEN | ✅ Covered by 3.1 RED | ✅ Focused suite remained 5/5 | ✅ Replay and denied cross-tenant mutation were re-executed after cleanup | ✅ Audit labels, rollback boundary, and client transport compatibility were cleaned without behavior change |

## WU4 TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.1 | `tests/foundation/p8-tus-finance.test.mjs` | Unit/HTTP contract | N/A (new WU4 test file) | ✅ Written first; initial run failed on missing finance module/migration and then exposed invalid test fixture syntax before production implementation | ✅ Focused suite passed 5/5 after finance module, provider boundary, schema, and migration implementation | ✅ Expanded to 8/8 with pending-provider separation, foreign-commitment denial, provider adapter validation, HTTP gate hold, compensation replay, and quarantine cases | ✅ Focused suite remained 8/8 after async-capable Prisma store, immutable ledger append handling, and strip-only compatibility cleanup |
| 4.2 | `tests/foundation/p8-tus-finance.test.mjs` | Unit/HTTP/persistence contract | N/A (new finance adapters/models) | ✅ Covered by 4.1 RED | ✅ Focused suite 8/8; contracts build and API/Prisma build passed | ✅ Deterministic provider, commitment lookup, Prisma model/migration, and authenticated Express route paths covered | ✅ Provider state remains separate from commercial state; no credentials or live provider execution added |
| 4.3 | `tests/foundation/p8-tus-finance.test.mjs` | Unit/HTTP contract | ✅ WU4 focused suite 8/8 after GREEN | ✅ Covered by 4.1 RED | ✅ Focused suite remained 8/8 | ✅ Gate-disabled payment/release, chargeback/dispute/provider-mismatch freezes, and deterministic labels re-executed | ✅ Production composition uses Prisma financial storage but unavailable provider/disabled gates; ledger is append-only and snapshots are create-once |

## WU5 TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 5.1 | `tests/foundation/p8-tus-delivery-pos.test.mjs` and `apps/mobile/tests/unit/tus-pos.test.ts` | Unit/HTTP contract | ⚠️ Resumed partial WU5 edits had no clean pre-edit baseline; existing TUS compatibility rerun passed 22/22 | ✅ New delivery/POS tests initially failed on missing composition, migration, and behavior | ✅ Focused suite passed 7/7; mobile Jest passed 2/2 | ✅ Added HTTP route auth/spoof denial, durable storage restart, version conflict, incident review, product/service separation, and no-settlement assertions | ✅ Delivery/POS stores, state transitions, audit records, and client queue persistence were cleaned while focused tests remained green |
| 5.2 | `tests/foundation/p8-tus-delivery-pos.test.mjs` | HTTP/persistence contract | ✅ Existing TUS compatibility rerun 22/22 | ✅ Covered by 5.1 RED | ✅ API build and focused suite passed; Prisma-backed delivery/POS adapters are wired in production composition | ✅ Zone/shift/task/proof/incident routes, POS replay/conflict, Prisma schema/migration, web transport, and mobile transport covered | ✅ Product/service POS lifecycles remain distinct; provider capture and settlement claims are explicitly `not-claimed` |
| 5.3 | `tests/foundation/p8-tus-delivery-pos.test.mjs` | Evidence/contract | ✅ WU5 focused suite 7/7 after GREEN | ✅ Covered by 5.1 RED | ✅ `pnpm contracts:validate` passed with 90 schemas | ✅ Deterministic proof/transport labels, audit outcomes, pending replay, and rollback boundaries re-executed | ✅ PWA/mobile copy and rollback evidence explicitly defer real device/browser/POS evidence |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Work Unit 1 focused test command and exact result | `pnpm exec node --experimental-strip-types --test tests/foundation/p8-tus-readiness.test.mjs` — exit 0; 9 tests passed, 0 failed, 0 skipped. |
| Work Unit 1 required `pnpm test` command and exact result | `pnpm test -- tests/foundation/p8-tus-readiness.test.mjs` — exit 1 because the repository runner executes the full suite; 322 total, 313 passed, 9 failed. All 9 WU1 readiness tests passed. The 9 failures are pre-existing unrelated P5.5/P5.6/P6.6/P6.9 failures, including missing prior-change traceability files. |
| Work Unit 1 contract/schema validation | `pnpm contracts:validate` — exit 0; 83 JSON Schema contracts validated. Existing AJV unsupported-format warnings for `date-time`, `uri`, and `email` remain. |
| Work Unit 1 build validation | `pnpm --filter @factory/contracts build` — exit 0. `DATABASE_URL=postgresql://user:password@localhost:5432/tuscompras pnpm --filter @factory/api build` — exit 0; Prisma client generation and TypeScript compilation passed. |
| Work Unit 1 runtime harness command/scenario and exact result | Deterministic in-process readiness harness via the focused Node test command — exit 0; 9/9. It exercises approved/excluded cohorts, all capability gate branches, tenant/scope filtering, expiry/revocation, deterministic-only labeling, rollback preservation, and contract validation. No external provider, database, HTTP, browser, or device runtime boundary exists for Work Unit 1; those claims remain deferred. |
| Work Unit 1 rollback boundary | Revert only the TUS readiness additions/hunks: `apps/api/src/tus/readiness/index.ts`, `packages/contracts/src/tus.ts`, `packages/contracts/schemas/tus/readiness-evidence.v1.schema.json`, `packages/contracts/schemas/tus/readiness-decision.v1.schema.json`, `tests/foundation/p8-tus-readiness.test.mjs`, the `TusReadinessEvidence`/`TusReadinessDecision` blocks in `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260826090000_tus_readiness/migration.sql`, and `docs/activation-gates.md` readiness-gate additions. Preserve unrelated dirty working-tree changes and all later work units. |
| Work Unit 2 focused test command and exact result | `pnpm exec node --experimental-strip-types --test tests/foundation/p8-tus-commerce-api.test.mjs` — exit 0; 5 tests passed, 0 failed, 0 skipped. |
| Work Unit 2 required `pnpm test` command and exact result | `pnpm test` — exit 1 after the full runner completed; 327 total, 318 passed, 9 failed. All 5 WU2 tests passed. The 9 failures are pre-existing unrelated P5.5/P5.6/P6.6/P6.9 failures, including missing archived product-factory-core traceability files and portability/reference validation drift. |
| Work Unit 2 contract/schema validation | `pnpm contracts:validate` — exit 0; 83 JSON Schema contracts validated. Existing AJV unsupported-format warnings for `date-time`, `uri`, and `email` remain. |
| Work Unit 2 build validation | `DATABASE_URL=postgresql://user:password@localhost:5432/tuscompras pnpm --filter @factory/api build` — exit 0; Prisma client generation and TypeScript compilation passed. |
| Work Unit 2 runtime harness command/scenario and exact result | The focused test starts the Express app and performs real `fetch` calls for bearer-session spoof denial, mixed checkout, replay/conflict, and cross-tenant reads; exit 0, 4 HTTP scenarios plus rollback/schema assertions passed. No live PostgreSQL/provider runtime was available; production DB/provider smoke remains deferred. |
| Work Unit 2 rollback boundary | Revert only WU2 files/hunks: `apps/api/src/tus/ports/index.ts`, `apps/api/src/tus/adapters/in-memory.ts`, `apps/api/src/tus/adapters/prisma.ts`, `apps/api/src/tus/adapters/index.ts`, `apps/api/src/tus/application/tus-application-service.ts`, `apps/api/src/tus/composition/index.ts`, `apps/api/src/tus/http/router.ts`, the WU2 TUS mount in `apps/api/src/server.ts`, the `TusCommitment`/`TusAuditReference` blocks in `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260826100000_tus_commerce_api/migration.sql`, and `tests/foundation/p8-tus-commerce-api.test.mjs`. Preserve WU1 readiness additions/hunks, unrelated dirty working-tree changes, and later work units. |

| Work Unit 3 focused test command and exact result | `pnpm exec node --experimental-strip-types --test tests/foundation/p8-tus-marketplace.test.mjs` — exit 0; 5 tests passed, 0 failed, 0 skipped. |
| Work Unit 3 required `pnpm test` command and exact result | `pnpm test` — exit 1 after the full runner completed; 332 total, 323 passed, 9 failed. All 5 WU3 tests passed. The 9 failures are pre-existing unrelated P5.5/P5.6/P6.6/P6.9 validation failures, including missing archived product-factory-core traceability files and portability/reference-validation drift. |
| Work Unit 3 contract/schema validation | `pnpm contracts:validate` — exit 0; 84 JSON Schema contracts validated. Existing AJV unsupported-format warnings for `date-time`, `uri`, and `email` remain. |
| Work Unit 3 build validation | `DATABASE_URL=postgresql://user:password@localhost:5432/tuscompras pnpm --filter @factory/api build` — exit 0; Prisma generation and TypeScript compilation passed. `pnpm --filter @factory/contracts build` — exit 0. |
| Work Unit 3 runtime harness command/scenario and exact result | `pnpm exec node --experimental-strip-types --test tests/foundation/p8-tus-marketplace.test.mjs` — exit 0; in-process Express HTTP scenarios passed for onboarding/public discovery, publication, stale facts, stock depletion, service-slot overlap, replay, separate commitments, and cross-tenant denial/audit. The harness uses the provider-free deterministic in-memory composition; no live PostgreSQL/provider/browser/device runtime was available, so production evidence remains deferred. |
| Work Unit 3 rollback boundary | Revert only WU3 additions/hunks: `apps/api/src/tus/catalog/index.ts`, `apps/api/src/tus/commitments/index.ts`, `apps/api/src/tus/adapters/prisma-marketplace.ts`, marketplace additions to `apps/api/src/tus/adapters/prisma.ts`, `apps/api/src/tus/adapters/index.ts`, `apps/api/src/tus/application/tus-application-service.ts`, `apps/api/src/tus/composition/index.ts`, `apps/api/src/tus/http/router.ts`, WU3 models in `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260826110000_tus_marketplace/migration.sql`, marketplace additions to `packages/contracts/src/tus.ts`, `packages/contracts/schemas/tus/marketplace-listing.v1.schema.json`, marketplace additions to `apps/web/src/lib/tus-client.ts`, and `tests/foundation/p8-tus-marketplace.test.mjs`. Rollback unpublishes/removes catalog listing mutations and routes but preserves already-created commitments and WU1/WU2 records. |

| Work Unit 4 focused test command and exact result | `pnpm exec node --experimental-strip-types --test tests/foundation/p8-tus-finance.test.mjs` — exit 0; 8 tests passed, 0 failed, 0 skipped. |
| Work Unit 4 required `pnpm test` command and exact result | `pnpm test` — exit 1 after the full runner completed; 340 total, 331 passed, 9 failed. All 8 WU4 tests passed. The 9 failures are pre-existing unrelated P5.5/P5.6/P6.6/P6.9 validation failures, including archived product-factory-core traceability/reference drift and portability/contamination fixture failures. |
| Work Unit 4 contract/schema validation | `pnpm contracts:validate` — exit 0; 88 JSON Schema contracts validated. `pnpm --filter @factory/contracts build` — exit 0. Existing AJV unsupported-format warnings for `date-time`, `uri`, and `email` remain. |
| Work Unit 4 build validation | `DATABASE_URL=postgresql://user:password@localhost:5432/tuscompras pnpm --filter @factory/api build` — exit 0; Prisma client generation and TypeScript compilation passed with the financial migration models and Prisma finance adapter. |
| Work Unit 4 runtime harness command/scenario and exact result | `pnpm exec node --experimental-strip-types --test tests/foundation/p8-tus-finance.test.mjs` — exit 0; 8/8 deterministic provider/domain scenarios and one authenticated in-process Express finance route passed. Coverage includes commitment/provider linkage, pending versus approved provider state, immutable 10% snapshot, confirmation-first and aging policy boundaries, check-in rejection, dispute/chargeback/provider-mismatch freezes, compensating refund entries, replay-safe reconciliation, cross-tenant denial, and credentials false. No live Mercado Pago, Argentina legal/KYC/KYB/tax approval, payout/custody, or PostgreSQL runtime smoke was available; those claims remain disabled/deferred. |
| Work Unit 4 rollback boundary | Revert only WU4 additions/hunks: `apps/api/src/tus/finance/index.ts`, `apps/api/src/tus/finance/prisma.ts`, `apps/api/src/providers/mercado-pago/index.ts` payment-intent boundary additions, finance wiring in `apps/api/src/tus/application/tus-application-service.ts`, `apps/api/src/tus/composition/index.ts`, finance routes/helpers in `apps/api/src/tus/http/router.ts`, WU4 finance models in `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260826120000_tus_finance/migration.sql`, `packages/contracts/schemas/tus/financial-payment-intent.v1.schema.json`, `packages/contracts/schemas/tus/commission-snapshot.v1.schema.json`, `packages/contracts/schemas/tus/ledger-entry.v1.schema.json`, `packages/contracts/schemas/tus/reconciliation-result.v1.schema.json`, and `tests/foundation/p8-tus-finance.test.mjs`. Rollback disables/removes finance routes, provider intent calls, release scheduling, snapshots, and new ledger projections without deleting prior marketplace commitments or rewriting preserved audit/ledger history; do not run a destructive financial down migration. |

| Work Unit 5 focused test command and exact result | `pnpm exec node --test tests/foundation/p8-tus-delivery-pos.test.mjs` — exit 0; 7 tests passed, 0 failed, 0 skipped. |
| Work Unit 5 mobile focused test command and exact result | `pnpm --filter @factory/mobile exec jest tests/unit/tus-pos.test.ts --runInBand` — exit 0; 1 suite passed, 2 tests passed, 0 failed. |
| Work Unit 5 required `pnpm test` command and exact result | `pnpm test` — exit 1 after the full runner completed; 347 total, 338 passed, 9 failed. All 7 WU5 tests passed. The 9 failures are pre-existing unrelated P5.5/P5.6/P6.6/P6.9 validation/traceability failures, including removed product-factory-core change files and portability/reference drift. |
| Work Unit 5 contract/schema validation | `pnpm contracts:validate` — exit 0; 90 JSON Schema contracts validated. `pnpm --filter @factory/contracts build` — exit 0. Existing AJV unsupported-format warnings for `date-time`, `uri`, and `email` remain. |
| Work Unit 5 build validation | `DATABASE_URL=postgresql://user:password@localhost:5432/tuscompras pnpm --filter @factory/api build` — exit 0; Prisma generation and TypeScript compilation passed. `pnpm --filter @factory/mobile typecheck` — exit 0. Web has no typecheck script; PWA source is covered by the TypeScript client scenario and existing Next conventions. |
| Work Unit 5 runtime harness command/scenario and exact result | Provider-free in-process Express and client harness via the focused command — exit 0; 7/7. It exercises scoped zones/shifts/tasks/proof/incidents, route authentication/spoof denial, POS replay/version conflict, durable offline queue restart, deterministic evidence labels, and no-settlement receipts. No live PostgreSQL, device/browser PWA, courier, payment, or settlement runtime was available; those claims remain deferred. |
| Work Unit 5 rollback boundary | Revert only WU5 additions/hunks: `apps/api/src/tus/delivery/index.ts`, `apps/api/src/tus/pos/index.ts`, `apps/api/src/tus/adapters/delivery-pos.ts`, delivery/POS wiring in `apps/api/src/tus/application/tus-application-service.ts` and `apps/api/src/tus/composition/index.ts`, delivery/POS routes/helpers in `apps/api/src/tus/http/router.ts`, WU5 models in `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260826130000_tus_delivery_pos/migration.sql`, WU5 contract additions/schemas, `tests/foundation/p8-tus-delivery-pos.test.mjs`, `apps/mobile/tests/unit/tus-pos.test.ts`, mobile POS client/screen additions, and web POS client/page additions. Rollback disables/removes delivery/POS intake and drains/reconciles no consumers; preserve WU1–WU4 commitments, finance ledger, evidence, and audit history. |

## WU6 TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 6.1 | `tests/foundation/p8-tus-operations.test.mjs` | Unit/HTTP contract | ⚠️ Resumed WU6 artifacts had no clean pre-edit baseline; WU5 compatibility suite remained available | ✅ Existing RED test initially failed 6/7 because WhatsApp/reporting modules and operations route markers were absent | ✅ Focused suite passed 7/7 after typed actions, support, reporting, SEO, and route implementations | ✅ Covered allowlist/consent/confirmation replay, sensitive handoff, bilateral evidence/refund, tenant-safe reports, revoked/stale SEO, and security redaction | ✅ Idempotent action response reuse and tenant-scoped support audit listing were cleaned without behavior change |
| 6.2 | `tests/foundation/p8-tus-operations.test.mjs` | Unit/HTTP contract | ✅ Focused WU6 suite 7/7 after GREEN | ✅ Covered by 6.1 RED | ✅ Focused suite 7/7; API and contracts builds passed | ✅ In-process HTTP harness exercised authenticated WhatsApp action and report routes; secure handoff remains credentials-free | ✅ Composition exposes support, WhatsApp, and reporting services while existing observability hooks remain redacted |
| 6.3 | `tests/foundation/p8-tus-operations.test.mjs` | Unit/HTTP/evidence | ✅ WU6 focused suite 7/7 after GREEN | ✅ Covered by 6.1 RED | ✅ Focused suite remained 7/7 after UI and contract cleanup | ✅ Freshness/revocation and telemetry alert paths re-executed; web compilation/type validation completed before a Windows symlink packaging failure | ✅ UI operations page and rollback boundaries were kept separate from Work Unit 7 deployment changes |

## Work Unit 6 Evidence

| Evidence | Result |
|---|---|
| Work Unit 6 focused test command and exact result | `pnpm exec node --test tests/foundation/p8-tus-operations.test.mjs` — exit 0; 7 tests passed, 0 failed, 0 skipped. |
| Work Unit 6 required `pnpm test` command and exact result | `pnpm test` — exit 1 after the full runner completed; 354 total, 345 passed, 9 failed. All 7 WU6 tests passed. The 9 failures are pre-existing unrelated P5.5/P5.6/P6.6/P6.9 validation/traceability failures, including removed product-factory-core traceability files and portability/reference drift. |
| Work Unit 6 contract/schema validation | `pnpm contracts:validate` — exit 0; 90 JSON Schema contracts validated. Existing AJV unsupported-format warnings for `date-time`, `uri`, and `email` remain. `pnpm --filter @factory/contracts build` — exit 0. |
| Work Unit 6 build validation | `$env:DATABASE_URL='postgresql://user:password@localhost:5432/tuscompras'; pnpm --filter @factory/api build` — exit 0; Prisma generation and TypeScript compilation passed. `pnpm --filter @factory/web build` compiled, linted, type-checked, and generated 8/8 pages, then exited 1 during Next standalone trace packaging because Windows denied a dependency symlink (`EPERM`). |
| Work Unit 6 runtime harness command/scenario and exact result | Provider-free in-process Express harness — exit 0; authenticated `POST /tus/whatsapp/actions` returned HTTP 200 with `credentialsCollected:false`, and authenticated `GET /tus/reports/operations` returned HTTP 200 with `sourceVersion:tus-operations-v1`. No live WhatsApp, PostgreSQL, browser, or production provider runtime was available; those claims remain deferred. |
| Work Unit 6 rollback boundary | Revert only WU6 additions/hunks: `apps/api/src/tus/whatsapp/index.ts`, `apps/api/src/tus/reporting/index.ts`, support audit fixes in `apps/api/src/tus/support/index.ts`, WU6 service fields/wiring in `apps/api/src/tus/application/tus-application-service.ts` and `apps/api/src/tus/composition/index.ts`, WU6 routes/helpers in `apps/api/src/tus/http/router.ts`, `packages/contracts/src/tus.ts` WhatsApp action constants, and `apps/web/src/app/tus/page.tsx` plus `apps/web/src/app/tus/operations/page.tsx`. Preserve Work Units 1–5, existing provider transport, finance ledger, audit history, and all deployment/evidence work. |

## WU7 TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 7.1 | `tests/foundation/p8-tus-deployment.test.mjs` | Unit/contract | N/A (new WU7 test file) | ✅ Written first; initial run 1/6 passed and 5/6 failed on missing deployment flags/readiness module | ✅ 6/6 after deployment evaluator, profile flags, CI, and docs implementation | ✅ Missing gates, deterministic-only evidence, authorized profile-scoped evidence, and plan-only validation covered | ✅ Extracted fail-closed readiness evaluation and preserved exact blockers |
| 7.2 | `tests/foundation/p8-tus-deployment.test.mjs` | Configuration/contract | ⚠️ No clean pre-edit baseline was captured for the resumed dirty slice; post-change profile regression suite passed 4/4 | ✅ New flag assertions failed before manifest/Terraform/CI changes | ✅ Focused WU7 suite passed 7/7; root build later passed 4/4 | ✅ Render-native and AWS Terraform declarations plus native Next start path covered | ✅ Removed incompatible standalone tracing and moved `typedRoutes` to the supported Next config location; focused suite remained 7/7 |
| 7.3 | `tests/foundation/p8-tus-deployment.test.mjs` plus `tests/foundation/p8-tus-operations.test.mjs` | Evidence/HTTP harness | ✅ WU7 focused suite 7/7 after GREEN | ✅ Covered by 7.1 | ✅ Full deterministic checks and HTTP harness executed; unavailable live gates remain disabled | ✅ Separate build, contract, plan, readiness, security, policy, and authenticated HTTP evidence recorded | ✅ Added explicit evidence/runbook boundaries without reclassifying unavailable or deterministic results |

## Work Unit 7 Evidence

| Evidence | Result |
|---|---|
| Work Unit 7 focused test command and exact result | `pnpm exec node --experimental-strip-types --test tests/foundation/p8-tus-deployment.test.mjs` — exit 0; 7 tests passed, 0 failed, 0 skipped. |
| Work Unit 7 required `pnpm test` command and exact result | `pnpm test` — exit 1 after the full runner completed; 361 total, 352 passed, 9 failed. All 7 WU7 tests passed. The 9 failures are pre-existing unrelated P5.5/P5.6/P6.6/P6.9 contamination, portability, and traceability failures. |
| Work Unit 7 build command and exact result | `pnpm build` — exit 0; Turbo completed 4 build tasks successfully, including API and web. |
| Work Unit 7 contract validation command and exact result | `pnpm contracts:validate` — exit 0; 90 JSON Schema contracts validated. Existing AJV unsupported-format warnings for `date-time`, `uri`, and `email` remain. |
| Work Unit 7 API build command and exact result | `DATABASE_URL=postgresql://user:password@localhost:5432/tuscompras pnpm --filter @factory/api build` — exit 0; Prisma generation and TypeScript compilation passed. |
| Work Unit 7 profile-plan command and exact result | `pnpm exec node scripts/validation/cloud-native/validate-plan.mjs` — exit 0; `render-native` and `aws-terraform` fixtures valid with `provisioned=false`, `cloudCalls=false`, and `liveConformance=false`. |
| Work Unit 7 HTTP/runtime harness command and exact result | `pnpm exec node --experimental-strip-types --test tests/foundation/p8-tus-operations.test.mjs` — exit 0; 7 tests passed, 0 failed, 0 skipped through the provider-free in-process authenticated Express harness. No live PostgreSQL, provider, browser, device, or production boundary was available. |
| Work Unit 7 readiness report command and exact result | `pnpm exec node scripts/activation/tus-readiness.mjs render-native` — deterministic report returned `not-production-ready`, `unavailable-deferred`, `liveConformance=false`; API/web/workers true and TUS routes/providers/release/fleet false. |
| Work Unit 7 security/policy commands and exact result | `pnpm run security:scan` — exit 0. `node scripts/security/validate-policy.mjs` — exit 0. |
| Work Unit 7 rollback boundary | Revert only WU7 changes: `render.yaml`, `infra/terraform/environments/render/main.tf`, `infra/terraform/environments/aws/main.tf`, `.github/workflows/ci.yml`, `apps/web/next.config.js`, `scripts/activation/tus-readiness.mjs`, `tests/foundation/p8-tus-deployment.test.mjs`, `docs/deployment/tus-readiness.md`, `docs/evidence/tus-deployment.md`, `docs/runbooks/tus-deployment.md`, and WU7 additions to `docs/runbooks/profile-rollback.md`/`provider-disablement.md`. Preserve Work Units 1–6, TUS contracts/migrations, commitments, ledger, audit, outbox, DLQ, and unrelated profile state. |

## Deviations and Issues

- Implementation follows the design: PostgreSQL/Prisma readiness records, versioned contracts, capability-specific required gates, deterministic-test-only disposition, and evidence/audit-preserving rollback.
- The contract layer now rejects malformed ISO timestamps and inconsistent readiness disposition fields so fail-closed behavior is enforced before persistence or activation.
- WU2 derives actor and tenant authority from bearer-session resolution; tenant/actor headers and body fields are treated as spoof attempts, never as authority.
- WU2 uses one transaction boundary for idempotency claim, commitments, audit references, outbox event, and completion; failed transactions restore the in-memory state and Prisma uses `$transaction`.
- `pnpm test` remains non-zero because the existing full-suite runner includes unrelated failures outside Work Units 1–2. The focused WU2 suite, existing 22-test TUS compatibility suite, contracts validation, and API build pass.
- No review lifecycle, reviewer, validator, verify/archive phase, provider call, or production activation was invoked.
- WU3 follows the design by keeping product stock and service slots as separate listing/commitment paths, rechecking availability versions on checkout, and deriving merchant mutation authority from the authenticated session rather than tenant headers.
- The marketplace web fetch transport continues forwarding tenant context for compatibility, but the API never treats those headers as authority; bearer-session context remains authoritative.
- WU4 follows the design by separating Mercado Pago provider status from commercial release, persisting financial source-of-truth records through Prisma in production composition, using create-once snapshots and append-only ledger entries, and requiring completion evidence plus confirmation/approved aging policy.
- WU4 intentionally keeps default production provider execution unavailable and all Argentina financial gates false. Deterministic providers are test-only evidence and never constitute legal, payment, payout, custody, or production readiness approval.
- WU5 keeps delivery internal and zone/shift scoped; public courier bidding is rejected, service commitments cannot become delivery tasks, and every delivery/POS receipt carries no settlement claim.
- WU5 uses Prisma-backed delivery/POS adapters in production composition and deterministic in-memory stores only in the test composition; offline mobile/browser queue records persist through an injected storage boundary and conflicts never use last-write-wins.
- WU5 deterministic proof, fake transport, and local POS receipts are explicitly test-only/deferred evidence; no device/browser/provider/settlement claim was made.
- WU6 adds a typed, idempotent WhatsApp action boundary with consent, confirmation expiry, tenant checks, and authenticated handoff; sensitive actions never collect credentials.
- WU6 support resolution requires customer and merchant evidence before recording a compensating, not-released outcome; support audit timelines remain tenant-scoped.
- WU6 reporting filters by authenticated session tenant, and SEO models exclude unpublished, revoked, policy-invalid, or stale listings. Existing observability hooks emit correlated redacted logs, metrics, and error spans.
- WU6 production composition currently uses the existing deterministic in-memory support/action/reporting stores; live provider/database/browser evidence remains deferred and Work Unit 7 deployment work was not entered.
- The web build's code compilation and page generation passed, but Next standalone trace packaging is blocked by the Windows `EPERM` symlink restriction; this is an environment issue, not a TypeScript or route failure.
- WU7 makes the Render web profile use the declared `next start` native deployment contract without `output: 'standalone'`; this removes the Windows standalone symlink failure and keeps TypeScript/lint/type checks enforced.
- WU7 deployment flags are explicit and fail closed: base API/web/workers are declared, while TUS routes, provider actions, release jobs, and fleet jobs default to disabled until scoped authorized evidence exists.
- WU7 readiness reports require profile-scoped, current, non-revoked `authorized-cloud-smoke` records; deterministic or missing evidence remains `unavailable-deferred` and cannot claim live conformance.
- No authorized Argentina legal, tax, KYC/KYB, Mercado Pago/provider, AWS/Groq, PostgreSQL, browser, device/POS, or production operational evidence was available; all remain explicit deferred gates.

## Remaining Tasks

- [x] 3.1–3.3 — Marketplace
- [x] 4.1–4.3 — Finance
- [x] 5.1–5.3 — Delivery/POS
- [x] 6.1–6.3 — Operations
- [x] 7.1–7.3 — Deployment/Evidence

## Workload / PR Boundary

- **Mode:** chained PR slice
- **Current work unit:** Work Unit 7 — deployment/evidence
- **Boundary:** Starts after completed Work Units 1–6; ends with explicit Render/AWS TUS composition flags, fail-closed readiness reporting, deterministic CI/build/contract evidence, operational runbooks, and provider-free HTTP evidence. It does not change prior TUS domain slices.
- **Chain target:** Feature branch chain; Work Unit 7 is the sixth child slice and targets the immediate feature-chain parent. No review lifecycle or PR was invoked.
- **Estimated review budget impact:** WU7 is a focused chained slice containing deployment configuration, one readiness module, tests, evidence, and runbooks; pre-existing dirty working-tree changes and Work Units 1–6 baselines are excluded from this slice’s review boundary.

## Status

21/21 tasks complete. Ready for `sdd-verify`; verification and archive were not run per request.
