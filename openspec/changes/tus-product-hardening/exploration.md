# TUS Product Hardening Exploration

## status

`completed_read_only_exploration`

## executive_summary

`Goldenrepo-js-py` is not an empty scaffold: it is a large, already-implemented and already-dirty Turborepo checkout with 1,026 tracked files, 23 Prisma migrations, API/web/mobile/POS code, Python compatibility tests, and extensive prior OpenSpec history. The deterministic product surface is substantially covered, but durable PostgreSQL/POS evidence, safe root `.env` activation, environment normalization, deployment truth, and bounded browser/device evidence remain hardening work rather than completed proof.

The repository-root `.env` exists, but its secret contents were intentionally not read or emitted. The current native wrapper resolves only `DATABASE_URL` from process environment first and then the repository-root `.env`; the PostgreSQL smoke resolver accepts `TUS_POSTGRES_URL` first and `DATABASE_URL` as fallback, but requires an explicit disposable/test boundary before any connection, migration, or fixture write. No service, browser, database, Docker, or long-lived process was started in this exploration.

## scope and safety boundary

- Repository scope: `C:\Users\mmmau\tuscompras-b2b\Goldenrepo-js-py` only.
- Artifact mode: hybrid (OpenSpec plus Engram).
- Existing unrelated OpenSpec changes were read but not modified.
- No `.env` secret values, `DATABASE_URL`, provider credentials, or database payloads were inspected.
- No API, web, mobile, Docker, database, browser, watcher, or foreground dev process was started.
- No `gentle-ai review` lifecycle, `sdd-verify`, or archive operation was invoked.

## bounded verification evidence

- Final Git verification was rerun as a bounded, read-only command from the repository root.
- Command: `git status --short --branch --untracked-files=normal`.
- Bound: 3,000 ms for the Git child process; the wrapper was configured to terminate the child if the bound was exceeded.
- Result: exited `0` within the bound and reported `feature/tus-mobile-runtime-hardening-pr2` plus the expected untracked exploration change directory.
- No server, watcher, browser, Docker, database, Node process, or interactive process was started.
- This replaces the prior incomplete status evidence; no broad exploration was repeated.

## Current State

### Repository and SDD state

The checkout is on `feature/tus-mobile-runtime-hardening-pr2` and has no reported working-tree changes in the initial status check, but it is not an empty scaffold. The root contains pnpm/Turborepo configuration, `apps/api`, `apps/web`, `apps/mobile`, `apps/workflow-runtime-python`, shared packages, infrastructure, scripts, tests, docs, and prior active/archive OpenSpec changes. `openspec/config.yaml` already selects hybrid storage, strict TDD, `pnpm test`, and explicitly records that unit/integration tools exist while a repository E2E harness is not currently detected.

The README and `ARCHITECTURE.md` still describe an older generic hybrid PostgreSQL/MongoDB/Redis boilerplate and generic deployment assumptions. They are useful historical context but are not authoritative for current TUS behavior; the newer TUS evidence and runbooks are more accurate.

### PostgreSQL, Prisma, and auditability

`apps/api/prisma/schema.prisma` is PostgreSQL-backed through `env("DATABASE_URL")` and contains identity/tenancy, audit, idempotency, outbox, readiness, marketplace, finance, delivery, POS, support, WhatsApp, and reporting models. Tenant-scoped unique keys and indexes are common, and append-only/authority comments define PostgreSQL ownership boundaries. There are 23 additive migration directories, including POS versioning, delivery/POS, finance, readiness, support/reporting, and operations wiring. No destructive reset was observed in the inspected latest migrations.

The durable POS adapter now has a `TusPosVersion` model and a transaction port, but its correctness still needs real PostgreSQL proof: version initialization/compare-and-increment, idempotency persistence, operation/receipt/version/audit/outbox atomicity, and recovery after restart/failure must be exercised against the actual schema. The in-memory POS store is a stronger deterministic reference than the current live evidence.

### Root `.env` and environment configuration

The root `.env` is present. `scripts/dev/native-profile.mjs` reads only the `DATABASE_URL` line from that explicit root path, gives a non-empty process value precedence, passes the resolved value to the child, and emits only a boolean configured diagnostic. This is the correct foundation for later local startup, but the broader repository still has multiple names and configuration layers: `DATABASE_URL`, `TUS_POSTGRES_URL`, `MONGODB_URL`/`MONGODB_URI`, `REDIS_URL`, `NEXT_PUBLIC_API_URL`/`API_BASE_URL`, mobile `EXPO_PUBLIC_*`, and legacy backend-file variables. The smoke harness already protects approved variable access and redacts target metadata; later normalization must be based on reference analysis, not deletion by naming similarity.

`render.yaml` has an explicit Render-native profile and disabled TUS/provider flags, but its indentation around several later `envVars` entries is suspicious and must be parser-validated before deployment work. There is no `vercel.json`; Vercel behavior is currently implied by the Next app and docs rather than a checked-in Vercel manifest.

### API, web, mobile, and POS

The API is Express-based with security middleware, health routes, Prisma composition, durable auth/session resolution, tenancy routing, TUS HTTP routes, and integration routing. The TUS router is authenticated and tenant-context driven. The web has Next App Router pages for sign-in/recovery, marketplace/dashboard, operations, and POS, plus resource loading that independently respects server-derived permissions and withholds protected resources after authorization failure.

The mobile app has validated runtime profiles, secure credential storage, encrypted MMKV queue handling, replay/quarantine/conflict behavior, and a POS screen that explicitly supports both `product` and `service` capture contexts. The POS is therefore modeled as the operational sales system for both business modes, not merely a payment-hardware surface. Current client behavior correctly avoids claiming success for pending/offline/uncertain operations and only treats accepted/replayed responses as success.

### Test and runtime evidence available now

Prior audits record green deterministic Node/Python/mobile/build/typecheck/contract evidence, but those receipts are historical and must not be silently reused as current proof. The repository has extensive foundation suites and one PostgreSQL HTTP smoke test. That smoke test is currently a safe, conditional harness: missing or unsafe target yields deferred evidence and zero side effects; a configured target path is intended to cover authenticated HTTP, device/session, product/service POS, offline replay/conflict, receipt, delivery, audit/outbox, restart/replay, cross-tenant isolation, cleanup, rollback, and provider non-interaction.

The prior TUS audits identify the important remaining gap: the harness and adapter need to be treated as untrusted for durable POS claims until a real disposable PostgreSQL run proves them. Existing local HTTP rendering, in-memory tests, Prisma parsing, and Expo web export cannot establish browser, physical-device, POS-hardware, cloud, provider, compliance, or production-operations evidence. Browser/Chrome DevTools/Playwright work is appropriately deferred to a later bounded runtime phase.

## Affected Areas

- `apps/api/prisma/schema.prisma` — PostgreSQL source-of-truth models, tenant-scoped keys/indexes, POS versioning, audit/outbox, recovery metadata, and state consistency.
- `apps/api/prisma/migrations/` — additive migration ordering, applied-schema compatibility, constraints/indexes, rollback documentation, and non-destructive recovery policy.
- `apps/api/prisma/seed.ts` — currently empty-by-default fixture builders with idempotent `upsert` contracts; later seed work must require explicit fixtures and never create privileged/shared-database data implicitly.
- `apps/api/src/infrastructure/database/prisma/client.ts` and `apps/api/src/infrastructure/database/postgres/pool.ts` — Prisma/pg lifecycle, logging safety, and `DATABASE_URL` ownership.
- `apps/api/src/tus/pos/index.ts` — POS transaction semantics, product/service sales state, idempotency, version conflicts, receipts, audit, and outbox effects.
- `apps/api/src/tus/adapters/delivery-pos.ts` — durable POS/delivery mapping, compare-and-increment behavior, and live audit/outbox inspection.
- `apps/api/src/tus/composition/index.ts`, `apps/api/src/tus/http/router.ts`, `apps/api/src/tus/readiness/` — durable composition, authenticated tenant isolation, readiness/fleet gates, and mutation side-effect boundaries.
- `scripts/test-runner-lib.mjs` and `tests/integration/tus/postgres-http-smoke.test.mjs` — approved environment resolution, root `.env` handoff policy, disposable-target proof, bounded child lifecycle, complete real PostgreSQL smoke, cleanup, and truthful evidence.
- `scripts/dev/native-profile.mjs`, `backend/package.json`, `frontend/package.json`, `apps/api/package.json`, `apps/web/package.json` — local startup wrapper boundaries and the current no-op package-local test scripts.
- `.env.example`, `apps/api/.env.example`, `apps/web/.env.example`, `render.yaml`, `infra/terraform/`, deployment docs — variable contract normalization and Render/Vercel/AWS deployment preparation.
- `apps/web/src/app/tus/`, `apps/web/src/lib/` — real authenticated marketplace/operations/POS journeys and later bounded browser/DevTools coverage.
- `apps/mobile/app/(app)/pos.tsx`, `apps/mobile/src/application/tus-client.ts`, `apps/mobile/src/core/config/` — product/service POS, secure queue, replay/conflict recovery, profile/tenant namespace isolation, and later bounded mobile/web-export evidence.
- `tests/foundation/`, `tests/compatibility/`, `docs/evidence/`, `docs/runbooks/`, and prior `openspec/changes/` — regression safety net, evidence taxonomy, recovery procedures, and historical claims that must be reconciled rather than overwritten.

## Approaches

1. **Durability-first hardening with a gated real smoke** — Treat PostgreSQL as the authority, normalize only proven environment consumers, repair schema/adapter/transaction semantics, make the seed explicitly idempotent, then run a bounded authenticated smoke only when the root `.env` `DATABASE_URL` is proven disposable/test-safe.
   - Pros: addresses the highest-risk product claim first; preserves fail-closed behavior; gives one durable evidence chain for migrations, replay, tenant isolation, POS product/service sales, auditability, and recovery.
   - Cons: high effort; requires a safe target and careful migration/fixture cleanup; cannot manufacture evidence when the root URL is not safe.
   - Effort: High

2. **Evidence/tooling-first hardening** — Reconcile env/deployment manifests, package scripts, test orchestration, and bounded Playwright/Chrome DevTools harnesses before changing durable POS behavior.
   - Pros: quickly improves reproducibility and reveals real route/startup gaps; lower database risk initially.
   - Cons: can create attractive local evidence while durable PostgreSQL correctness remains unproven; risks normalizing variables before their true consumers are mapped.
   - Effort: Medium

3. **Phased hybrid hardening** — Split implementation into (a) safe config/seed/schema and adapter correctness, (b) real PostgreSQL HTTP/restart/replay smoke, and (c) bounded web/mobile/POS interaction and deployment evidence; keep providers/cloud/compliance disabled and separately classified.
   - Pros: isolates risk, limits review scope, supports reliable cleanup, and matches the existing OpenSpec history and evidence classes.
   - Cons: requires explicit phase handoff and evidence synchronization; production readiness remains blocked until external owners provide their gates.
   - Effort: High

## Recommendation

Use **Phased hybrid hardening**, starting with a durability/config safety slice. First establish the exact env contract and prove that the repository-root `.env` `DATABASE_URL` is an approved disposable/test target without printing it; do not fall back to broad dotenv discovery or destructive reset. Then repair/verify Prisma migrations, tenant-scoped constraints/indexes, POS version/transaction semantics, audit/outbox inspection, and an idempotent explicit-fixture seed. Expand the existing smoke only behind a hard bounded timeout and child-PID ownership check, with `try/finally` cleanup and targeted fixture deletion that preserves audit/evidence records. After that, run bounded Playwright/Chrome DevTools/browser and mobile export checks as separate evidence, followed by Render/Vercel plan/startup validation. Keep provider calls, settlement claims, cloud provisioning, compliance approvals, and production activation fail-closed.

The implementation plan should treat `DATABASE_URL` as the application runtime key and support the smoke's approved `TUS_POSTGRES_URL`-then-`DATABASE_URL` selection only as a validation-runner boundary. Any variable removal must be justified by a repository-wide consumer map and deployment/runtime checks; legacy backend-file code must not be mistaken for active TUS API code without an explicit ownership decision.

## Risks

- **BLOCKER — target safety:** the root `.env` exists, but its target suitability is not established in this read-only phase. No later connection, migration, or write is safe until disposable/test identity and ownership are proven without exposing secrets.
- **BLOCKER — durable POS proof:** deterministic in-memory behavior and schema presence do not prove PostgreSQL atomicity, version conflicts, restart/replay, or audit/outbox durability.
- **HIGH — migration history:** 23 migrations and a very large schema require ordered, additive validation; applying them to an unproven shared or production database would violate the safety boundary.
- **HIGH — environment drift:** root, app, mobile, Render, Terraform, and legacy backend-file variable names differ. Removing variables without proven-unused evidence can break runtime or deployment.
- **HIGH — process cleanup:** existing smoke helpers spawn API children. Any future bounded run must record child PIDs, verify repository cwd/command ownership, enforce timeouts, and clean up in `finally`; never kill the user-provided PIDs by name.
- **MEDIUM — readiness mismatch:** prior audits found durable POS mutation gates and smoke fixtures can disagree (notably fleet/readiness evidence), so a real pilot may defer before exercising writes unless the contract is reconciled without weakening gates.
- **MEDIUM — deployment manifest truth:** `render.yaml` contains suspicious indentation and the Vercel contract is implicit; validate syntax and actual package build/start commands before deployment claims.
- **MEDIUM — test signal:** API/web/mobile package-local `test` scripts are no-ops while root foundation tests are meaningful; evidence must identify the real runner and avoid overstating package-level coverage.
- **MEDIUM — UI/device evidence:** local route rendering and Expo web export are not interactive browser, screen-reader, native device, offline radio, receipt printer, or physical POS evidence.
- **LOW — legacy scope contamination:** `apps/api/backendFiles/` contains a separate older report/upload stack and environment vocabulary; preserve it until ownership and proven-unused status are documented.

## Ready for Proposal

**Yes, with explicit sequencing and safety gates.** The proposal should define a bounded, non-destructive first slice for environment/seed/schema/POS durability and smoke orchestration, followed by separate browser/mobile/deployment evidence slices. It must state that the current repository is implemented rather than empty, that root `.env` values remain secret, that the real PostgreSQL run is conditional on a proven disposable target, and that no local/deterministic result promotes TUS to production readiness.

## artifacts

- `openspec/changes/tus-product-hardening/exploration.md` — this read-only exploration.
- Engram topic key: `sdd/tus-product-hardening/explore`.
- Bounded verification: Git status completed successfully within the explicit 3-second child-process bound; the expected artifact directory is the only reported worktree item.
- Prior artifacts consulted: `tus-final-product-audit-v3`, `tus-live-pos-completion`, `tus-product-closure`, `tus-final-hardening`, and current `openspec/config.yaml`.

## next_recommended

1. `sdd-propose` — define the phased scope, non-goals, rollback, safety gates, and evidence taxonomy.
2. `iron-po` / `iron-arch` at their normal dependency points — challenge scope and durable-boundary feasibility before specs/tasks.
3. Do not run a live smoke, browser, deployment, review lifecycle, `sdd-verify`, or archive during this exploration.

## skill_resolution

- `sdd-explore` — loaded from `C:\Users\mmmau\.config\opencode\skills\sdd-explore\SKILL.md`.
- `_shared` — loaded from `C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md`; phase, OpenSpec, persistence, and Engram conventions applied.
- CodeGraph — existing `.codegraph` confirmed; targeted exploration ran before broader filesystem inspection.
- Hybrid persistence — OpenSpec artifact written and the same report is saved to Engram under `sdd/tus-product-hardening/explore`.
- Bounded final verification — `git status --short --branch --untracked-files=normal` returned exit `0` within 3,000 ms; no timeout or process remained.
