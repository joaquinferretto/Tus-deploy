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
| 2 | Schema/fixtures | PR 1 | PostgreSQL smoke / 180s | approved disposable DB | schema, migration, seed |
| 3 | Durable POS | PR 1 | POS integration / 180s | authenticated API | POS modules/adapters |
| 4 | Children/smoke | PR 1 | lifecycle smoke / 180s | owned child + finally | runner/smoke harness |
| 5 | Browser/mobile | PR 1 | audit tests / 180s | Playwright/CDP/screenshots | audit/receipts |
| 6 | Deployment/readiness | PR 1 | `pnpm build` / 180s | local/Render/Vercel contracts | manifests/docs |

## Phase 1: Safety and Environment (strict TDD)

- [ ] 1.1 **RED:** In `tests/foundation/p9-tus-runtime-readiness.test.mjs`, assert root `.env` `DATABASE_URL` stays secret, proof precedes DB side effects, and unsafe targets fail closed.
- [ ] 1.2 **GREEN:** Add `SafeTarget` resolution/gating to `scripts/test-runner-lib.mjs` and `scripts/dev/native-profile.mjs`; permit only the named runner override/alias, never ambient override or output.
- [ ] 1.3 **RED:** Test consumer/canonicalization coverage across examples, app/mobile/web manifests, `render.yaml`, Terraform, tests, docs, and `apps/api/backendFiles/`.
- [ ] 1.4 **GREEN/REFACTOR:** Create `docs/runbooks/tus-environment-consumer-inventory.md`; normalize only proven consumers and retain aliases until repository-wide proof.

## Phase 2: PostgreSQL and POS Durability (strict TDD)

- [ ] 2.1 **RED:** Add safe/deferred target, duplicate seed, tagged-cleanup refusal, tenant isolation, constraint/index, and invalid-transition cases to `postgres-http-smoke.test.mjs`.
- [ ] 2.2 **GREEN:** Harden `schema.prisma`, additive `<timestamp>_tus_product_hardening/migration.sql`, and `seed.ts` with namespaced fixtures, orphan checks, tenant/idempotency keys, and recovery.
- [ ] 2.3 **RED:** Test product/service retry, version conflict, atomic rollback, audit/outbox, restart/replay, and cross-tenant isolation.
- [ ] 2.4 **GREEN:** Complete `apps/api/src/tus/pos/index.ts`, `ports/index.ts`, `adapters/delivery-pos.ts`, readiness/composition adapters with one transaction and at-most-once replay.
- [ ] 2.5 **REFACTOR:** Preserve injected ports/transitions; document recovery without reset, truncate, cascade, or untagged deletion.

## Phase 3: Process Ownership and Real Smoke (strict TDD)

- [ ] 3.1 **RED:** Test every applicable process threat: startup/request/shutdown timeout, interruption, and PID/cwd/argv mismatch; require ≤120s, no orphan, no secret.
- [ ] 3.2 **GREEN/REFACTOR:** Implement `OwnedChild` ownership, bounded start/request/stop, `try/finally`, termination wait, and redacted receipts in both runner files.
- [ ] 3.3 **RED:** Add approved-target assertions for authenticated product/service flows, replay/conflict, audit/outbox, restart/recovery, cleanup, and provider non-interaction.
- [ ] 3.4 **GREEN:** Complete smoke gating/cleanup; emit `real-postgres` only on live proof, otherwise deferred/failed with zero side effects.

## Phase 4: Runtime, Deployment, and Readiness (strict TDD)

- [ ] 4.1 **RED:** Create `tus-runtime-audit.test.mjs` for authenticated API/web/mobile/POS journeys, screenshots, ≤180s flows, and external-blocked evidence.
- [ ] 4.2 **GREEN/REFACTOR:** Create `scripts/audit/tus-runtime-audit.mjs`; run finite Playwright/CDP/mobile-export checks without hardware/native success claims.
- [ ] 4.3 **RED/GREEN:** Test `render.yaml`, Next/Vercel, local wrappers, and package build/start contracts; use `pnpm build` with a 180s hard timeout.
- [ ] 4.4 **REFACTOR:** Reconcile evidence/runbooks/manifests/history; apply all five tags and fail closed for missing external proof.
