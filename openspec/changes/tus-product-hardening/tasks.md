# Tasks: TUS Product Hardening

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,800–3,500 authored lines |
| 400-line budget risk | Low against requested 99,999-line budget |
| Chained PRs recommended | No |
| Suggested split | One PR; ordered work units |
| Delivery strategy | single-pr |
| Size exception needed | No |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test / hard timeout | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Safety/env | PR 1 | readiness test / 120s | N/A: static gate | resolver, profile, inventory |
| 2 | Schema/fixtures | PR 1 | PostgreSQL smoke / 180s | approved root `.env` local/test loopback target | schema, migration, seed |
| 3 | Durable POS | PR 1 | POS integration / 180s | authenticated API | POS modules/adapters |
| 4 | Children/smoke | PR 1 | lifecycle smoke / 180s | owned child + finally | runner/smoke harness |
| 5 | Browser/mobile | PR 1 | audit tests / 180s | Playwright/CDP/screenshots | audit/receipts |
| 6 | Deployment/readiness | PR 1 | `pnpm build` / 180s | local/Render/Vercel contracts | manifests/docs |

## Phase 1: Safety and Environment (strict TDD)

- [x] 1.1 **RED:** In the focused PostgreSQL tests, assert root `.env` `DATABASE_URL` stays secret, existing production/local profile gates precede DB side effects, and unsafe targets fail closed.
- [x] 1.2 **GREEN:** Add `SafeTarget` resolution/gating to `scripts/test-runner-lib.mjs` and `scripts/dev/native-profile.mjs`; permit only root `.env` `DATABASE_URL`, never ambient or runner URL overrides.
- [x] 1.3 **RED:** Test consumer/canonicalization coverage across examples, app/mobile/web manifests, `render.yaml`, Terraform, tests, docs, and `apps/api/backendFiles/`.
- [x] 1.4 **GREEN/REFACTOR:** Create `docs/runbooks/tus-environment-consumer-inventory.md`; normalize only proven consumers, remove the unused runner URL/six-field metadata requirements, and document legacy aliases as noncanonical without reading or forwarding them.

## Phase 2: PostgreSQL and POS Durability (strict TDD)

- [x] 2.1 **RED:** Add safe/deferred target, duplicate seed, tagged-cleanup refusal, tenant isolation, constraint/index, and invalid-transition cases to `postgres-http-smoke.test.mjs`.
- [x] 2.2 **GREEN:** Harden `schema.prisma`, additive `<timestamp>_tus_product_hardening/migration.sql`, and `seed.ts` with namespaced fixtures, orphan checks, tenant/idempotency keys, and recovery.
- [x] 2.3 **RED:** Test product/service retry, version conflict, atomic rollback, audit/outbox, restart/replay, and cross-tenant isolation.
- [x] 2.4 **GREEN:** Complete `apps/api/src/tus/pos/index.ts`, `ports/index.ts`, `adapters/delivery-pos.ts`, readiness/composition adapters with one transaction and at-most-once replay.
- [x] 2.5 **REFACTOR:** Preserve injected ports/transitions; document recovery without reset, truncate, cascade, or untagged deletion.

## Phase 3: Process Ownership and Real Smoke (strict TDD)

- [x] 3.1 **RED:** Test every applicable process threat: startup/request/shutdown timeout, interruption, and PID/cwd/argv mismatch; require ≤120s, no orphan, no secret.
- [x] 3.2 **GREEN/REFACTOR:** Implement `OwnedChild` ownership, bounded start/request/stop, `try/finally`, termination wait, and redacted receipts in both runner files.
- [x] 3.3 **RED:** Add approved-target assertions for authenticated product/service flows, replay/conflict, audit/outbox, restart/recovery, cleanup, and provider non-interaction.
- [x] 3.4 **GREEN:** Complete smoke gating/cleanup; emit `real-postgres` only on live proof, otherwise deferred/failed with zero side effects.

## Phase 4: Runtime, Deployment, and Readiness (strict TDD)

- [x] 4.1 **RED:** Create `tus-runtime-audit.test.mjs` for authenticated API/web/mobile/POS journeys, screenshots, ≤180s flows, and external-blocked evidence.
- [x] 4.2 **GREEN/REFACTOR:** Create `scripts/audit/tus-runtime-audit.mjs`; run finite Playwright/CDP/mobile-export checks without hardware/native success claims.
- [x] 4.3 **RED/GREEN:** Test `render.yaml`, Next/Vercel, local wrappers, and package build/start contracts; use `pnpm build` with a 180s hard timeout.
- [x] 4.4 **REFACTOR:** Reconcile evidence/runbooks/manifests/history; apply all five tags and fail closed for missing external proof.

## Corrective Runtime Batch 3 (strict TDD)

- [x] 4.5 **RED/GREEN/REFACTOR:** Make web API consumers resolve `NEXT_PUBLIC_API_URL` as the canonical production source, retain `API_BASE_URL` only as an agreeing deployment alias, and have the local wrapper inject its bounded `localhost:3101` URL.
- [x] 4.6 **RED/GREEN/REFACTOR:** Route Expo web's Zustand middleware dependency through a web-compatible resolver shim so exported bundles contain no unsupported `import.meta`; retain native secure storage/runtime/POS source boundaries.
- [x] 4.7 **REFACTOR:** Exclude only generated `apps/mobile/dist/**` from mobile lint and keep JavaScript compatibility/config sources explicitly lintable.

## Corrective Deployment/Configuration Batch (strict TDD)

- [x] 4.8 **RED/GREEN/REFACTOR:** Make `3101` the canonical local API port across the API default, native wrappers, mobile default, Docker/Compose, examples, Makefile, README, architecture notes, and runbooks while preserving explicit `API_PORT` overrides.
- [x] 4.9 **RED/GREEN/REFACTOR:** Make the Vercel/Next production API URL contract explicit and truthful without embedding URLs, secrets, or credentials in `vercel.json`; document required Vercel Project Settings and mobile/support public URL consumers.
- [x] 4.10 **RED/GREEN/REFACTOR:** Align the web Docker contract with Next standalone output and validate the checked-in output/start contract.
- [x] 4.11 **RED/GREEN/REFACTOR:** Add a Render pre-deploy Prisma migration contract using the existing API package script and safe build → migrate → start ordering; do not execute it against a real database in this pass.
- [x] 4.12 **RED/GREEN/REFACTOR:** Canonicalize MongoDB configuration on `MONGODB_URL`, retain `MONGODB_URI` only as an explicit API compatibility fallback for legacy consumers, and remove it from active Render declarations.
- [x] 4.13 **RED/GREEN/REFACTOR:** Classify the one-shot Python example worker as `external-blocked`/placeholder rather than production-ready until a long-lived worker contract exists.

## Corrective Deployment Batch 2 (strict TDD)

- [x] 4.14 **RED/GREEN/REFACTOR:** Start the Render web service with the generated Next standalone `server.js` from the `apps/web` workspace package, pass through Render's `PORT`, document the repository/package-relative output path, and preserve the external-blocked worker placeholder.
