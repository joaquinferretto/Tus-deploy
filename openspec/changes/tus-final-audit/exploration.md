## Exploration: TUS final implementation audit

### Current State
The four active TUS changes (`tus-platform-vision`, `tus-big-picture-mvp`, `tus-production-completion`, and `tus-ui-ux-improvement`) have implementation artifacts and substantial deterministic coverage. The API production composition uses Prisma-backed TUS stores, while the test composition uses deterministic in-memory stores. The web and mobile surfaces implement server-derived session state, tenant-scoped journeys, explicit pending/conflict/error states, stable idempotency, responsive/PWA foundations, and separate product/service flows.

The current audit is **not a clean pass**. The focused TUS/UI suites pass, API and web production builds pass, contracts validate 98 schemas, and security scanning passes. The complete `pnpm test` run recorded 428 tests with 422 passed and 6 failed. The root `pnpm typecheck` command fails because Turbo cannot find a `typecheck` task; package-level web and mobile TypeScript checks pass, while the API build passes.

Current failed evidence:
- `tests/foundation/p1-auth-lifecycle.test.mjs` — two assertions still expect `Validated 90 JSON Schema contract(s)` while the validator reports 98.
- `tests/foundation/p1-mfa-passkeys-oauth-linking.test.mjs` — same stale 90-schema expectation.
- `tests/foundation/p4-ai-capability.test.mjs` — same stale 90-schema expectation.
- `tests/foundation/p4-ai-governance.test.mjs` — same stale 90-schema expectation.
- `tests/foundation/p7-tus-marketplace-operations.test.mjs` — Node 22 strip-only TypeScript execution rejects a parameter property in `apps/api/src/tus/whatsapp/index.ts:190`.
- `tests/foundation/p8-tus-marketplace.test.mjs` — the web client sends `/tus/v1/marketplace/discovery`, while the test expects `/tus/marketplace/discovery`; the API intentionally accepts both paths.

The canonical readiness evaluator is implemented and unit-tested at `apps/api/src/tus/readiness/index.ts`, but structural search found no runtime route/service call site for `evaluateTusReadiness` or `reconcileReadinessDecision`. Activation tooling is likewise a deterministic gate/reporting boundary rather than evidence of live provider activation. This integration point needs an explicit architectural decision before production claims.

### Affected Areas
- `openspec/changes/tus-platform-vision/` — platform intent, boundaries, and target architecture.
- `openspec/changes/tus-big-picture-mvp/` — marketplace, commerce, finance, delivery/POS, and operations capability specifications.
- `openspec/changes/tus-production-completion/` — production completion artifacts, activation gates, readiness, recovery, and evidence boundaries.
- `openspec/changes/tus-ui-ux-improvement/` — truthful session entry, state/accessibility, responsive/PWA, idempotency, and journey polish.
- `apps/api/src/tus/http/router.ts` — authenticated TUS routes; versioned and compatibility marketplace paths are both mounted.
- `apps/api/src/tus/composition/index.ts` — Prisma production composition and in-memory deterministic composition.
- `apps/api/src/tus/readiness/index.ts` — canonical readiness contract and legacy compatibility adapter.
- `apps/api/src/tus/whatsapp/index.ts` — source of the Node strip-only parameter-property failure.
- `apps/api/src/server.ts` — production API wiring through `createPrismaTusApplication`.
- `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/` — durable TUS source-of-truth models and additive migrations.
- `apps/web/src/lib/tus-client.ts` — versioned marketplace transport, checkout, POS, idempotency, and response parsing.
- `apps/web/src/app/tus/` and `apps/web/src/app/globals.css` — web/PWA product, merchant, operations, POS, accessibility, and responsive surfaces.
- `apps/mobile/app/` and `apps/mobile/src/` — protected mobile session, POS/offline/conflict UX, tenant truthfulness, and safe-area foundations.
- `scripts/activation/tus-readiness.mjs` — fail-closed, provider-free activation evaluation and report generation.
- `packages/contracts/scripts/validate-schemas.mjs` — canonical contract validator, currently reporting 98 schemas.
- `tests/foundation/` — deterministic governance, infrastructure, TUS, UI, activation, and validation suites.
- `openspec/changes/tus-final-audit/exploration.md` — this audit artifact; no source files were changed.

### Approaches
1. **Record the verified audit and preserve the current implementation** — Treat the six failures as explicit validation debt and keep provider/browser/device/PostgreSQL/production evidence deferred.
   - Pros: truthful, minimal, preserves working TUS behavior, and avoids changing source during a read-only audit.
   - Cons: the repository cannot claim a clean full-suite gate until the stale tests and runtime compatibility issue are resolved.
   - Effort: Low

2. **Immediately repair every failing test and wire canonical readiness into runtime routes** — Update schema-count/path expectations, remove the Node strip-only incompatibility, and decide where readiness is enforced at runtime.
   - Pros: improves executable consistency and closes the most important integration question.
   - Cons: exceeds the requested read-only audit, risks conflating test drift with implementation changes, and requires a new scoped SDD apply cycle.
   - Effort: Medium/High

### Recommendation
Select Approach 1 for this audit. The deterministic TUS/UI behavior is evidenced, but the overall repository should remain **not ready for a clean completion claim** because `pnpm test` fails, root typecheck is misconfigured, and canonical readiness runtime enforcement is not demonstrated. Create a follow-up implementation slice for: (1) replacing hard-coded 90-schema assertions with the current validator contract, (2) fixing or avoiding Node 22 strip-only parameter properties in the affected test path, (3) reconciling the versioned marketplace route contract, (4) adding a root Turbo typecheck task, and (5) making the canonical readiness enforcement boundary explicit and tested.

### Risks
- Full-suite failure is broader than TUS: four stale schema-count assertions affect auth/AI tests, so a green focused TUS run must not be generalized to repository-wide health.
- The p7 failure is a runtime/tooling incompatibility, not evidence that WhatsApp business behavior is incorrect; it still blocks that suite.
- The p8 failure is a contract/test drift because the API accepts both paths, but client/test canonicalization is unresolved.
- Root `pnpm typecheck` cannot serve as a trustworthy gate until Turbo task definitions are added or the command is replaced with an explicit package matrix.
- No browser, screen-reader, physical-device, external provider, cloud, PostgreSQL HTTP, or production deployment evidence was executed.
- The repository working tree was already heavily dirty, including unrelated modifications and deletions; no reset, cleanup, or source modification was performed.
- Readiness and activation helpers can pass deterministic tests without proving that every runtime mutation path is actually guarded by the canonical evaluator.

### Ready for Proposal
Yes, for a scoped follow-up proposal. The audit itself is complete enough to proceed, but implementation should wait for a proposal that limits work to the six deterministic failures, the root typecheck gate, and the canonical readiness runtime integration decision. Production/live readiness remains deferred until the documented external evidence is supplied.
