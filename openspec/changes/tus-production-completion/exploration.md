# TUS Production Completion Exploration

## Exploration: TUS production completion

### Current State

The repository contains a substantial Argentina-first TUS foundation, but it is not yet a production-proven marketplace/service platform. The implementation currently provides deterministic domain behavior, typed contracts, fail-closed provider boundaries, Prisma persistence models/adapters, authenticated route declarations, and focused foundation tests.

The strongest evidence is local and deterministic:

- The focused TUS suites pass for readiness, commerce commitments, marketplace, finance, delivery/POS, operations, deployment, marketplace operations, and mobile POS behavior.
- The mobile POS unit suite passes 2/2 tests.
- Contract validation exits successfully and validates 90 JSON Schemas.
- Cloud-native plan validation, policy validation, and contracts package build exit successfully.
- Provider activation remains correctly unavailable unless explicit evidence is supplied; no live payment, WhatsApp, cloud, or production-conformance claim is supported.

The full repository test command is not green: 361 tests ran, 342 passed, and 19 failed. The failures are mixed rather than one single TUS defect: resource/API build failures (`3221226505`), stale schema-count assertions expecting 81 instead of the current 90, Prisma-related out-of-memory failures, neutral-surface contamination/parity failures, a missing `product-factory-core` spec file, and portability-validation failure. These must be classified and rerun in isolation before implementation work treats the baseline as reliable.

The main product gap is runtime proof. There is no verified authenticated signup/session-to-merchant-to-customer flow, the API seed intentionally creates no identity records, no local PostgreSQL-backed HTTP smoke harness was found, and the web/mobile surfaces remain largely typed/static shells with local state rather than a proven end-to-end customer journey.

The repository also has a readiness-model inconsistency: `apps/api/src/tus/domain/readiness.ts` contains a legacy boolean gate model while `apps/api/src/tus/readiness/index.ts` contains richer evidence/capability gates. The production-completion proposal should select one canonical readiness model and define compatibility/migration behavior.

### Affected Areas

- `apps/api/src/tus/` — current TUS domain services, application orchestration, HTTP routes, readiness, finance, marketplace, delivery, POS, support, WhatsApp, and reporting boundaries.
- `apps/api/src/tus/http/router.ts` — authenticated TUS route surface requiring runtime identity, authorization, tenant, and error-path proof.
- `apps/api/src/tus/composition/index.ts` — in-memory and Prisma composition roots; the seam for deterministic tests versus durable runtime wiring.
- `apps/api/src/tus/application/tus-application-service.ts` — commitment, idempotency, audit, and outbox orchestration requiring durable lifecycle and retry evidence.
- `apps/api/src/tus/finance/index.ts` — fail-closed payment/commission/ledger/release/refund/freeze/reconciliation logic; needs provider-backed activation evidence before live claims.
- `apps/api/src/tus/adapters/prisma.ts`, `prisma-marketplace.ts`, and `delivery-pos.ts` — durable adapters and transaction/tenant-boundary behavior.
- `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/` — durable TUS persistence model; needs a repeatable database migration/seed/smoke path.
- `apps/api/prisma/seed.ts` — intentionally empty identity/database seed; blocks a repeatable authenticated local journey unless a safe explicit fixture strategy is added.
- `packages/contracts/src/tus.ts` — versioned TUS contracts that need runtime validation parity across API, web, and mobile.
- `apps/web/src/lib/tus-client.ts` and `apps/web/src/app/tus/` — client transport and product/operations/POS surfaces; currently more shell than verified product flow.
- `apps/mobile/src/application/tus-client.ts` and `apps/mobile/app/(app)/` — offline queue/replay and POS screens; deterministic behavior exists, but runtime identity and server synchronization remain unproven.
- `apps/api/src/providers/mercado-pago/index.ts` and `apps/api/src/providers/whatsapp/index.ts` — signed provider boundaries; activation and real callback smoke evidence are still absent.
- `scripts/activation/tus-readiness.mjs` and `docs/activation-gates.md` — fail-closed activation policy and evidence requirements.
- `tests/foundation/p8-tus-*.test.mjs` and `apps/mobile/tests/unit/tus-pos.test.ts` — current positive deterministic evidence.
- `tests/foundation/p5-reference-validation.test.mjs`, `p1-auth-lifecycle.test.mjs`, `p6-final-traceability.test.mjs`, and `p6-portability.test.mjs` — baseline failures requiring triage before they can serve as completion gates.
- `turbo.json`, package ESLint configuration, and workspace scripts — current validation friction: missing root typecheck task, missing API/web lint configuration, and long-running security/typecheck commands.

### Evidence and Gaps

| Capability | Current evidence | Production-completion gap |
|---|---|---|
| Marketplace/catalog | Domain services, Prisma models, contracts, focused tests | No verified merchant onboarding, listing lifecycle, or customer checkout journey over authenticated HTTP |
| Commitments/commerce | Idempotency, audit, outbox, in-memory and Prisma adapters, focused tests | No database-backed runtime smoke proving transaction boundaries, retries, replay, and lifecycle transitions |
| Finance | Deterministic ledger/commission/release/refund/freeze logic and fail-closed provider boundary | No Mercado Pago activation evidence, callback smoke, reconciliation run, or legal/operational proof |
| Delivery/POS | Delivery/POS adapters, offline queue/replay, 7/7 delivery-POS foundation tests, 2/2 mobile tests | No authenticated merchant/device provisioning, durable replay smoke, or settlement boundary verification |
| Messaging/support | Signed WhatsApp adapter and deterministic messaging tests | No configured provider callback/runtime proof or support workflow UI |
| Identity/tenant isolation | Existing neutral identity/domain tests and route auth guards | No seeded safe identity path or complete signup/session/merchant/customer runtime flow |
| Readiness/activation | Fail-closed gates and plan-only cloud validation | Two readiness models need reconciliation; live evidence is intentionally absent |
| Web/mobile product UX | Typed clients and static/mobile shells | No end-to-end rendering and behavior proof across the primary Argentine customer journey |
| Operations/observability | Deterministic audit/telemetry/budget evidence | No production-like HTTP/database smoke or operational runbook execution evidence |

### Approaches

1. **Vertical production slices** — Complete one dependency-ordered customer journey at a time: identity/tenant bootstrap, merchant/catalog, customer checkout/commitment, finance reconciliation, delivery/POS, then provider activation and UI hardening.
   - Pros: Produces real user-visible value and runtime evidence early; exposes integration seams; preserves the existing deterministic/fail-closed foundation.
   - Cons: Requires careful contract ownership and temporary fixture infrastructure; some cross-cutting work repeats across slices.
   - Effort: High

2. **Platform hardening first** — Resolve repository-wide test/build/lint/typecheck failures, reconcile readiness models, and establish database/integration harnesses before adding more TUS product behavior.
   - Pros: Improves signal quality and reduces later rework; establishes trustworthy gates.
   - Cons: Delays customer-visible progress; several failures are unrelated or stale and may not represent product risk.
   - Effort: Medium/High

3. **Provider-first activation** — Wire Mercado Pago/WhatsApp/cloud runtime evidence before completing the local product journey.
   - Pros: Tests the highest-risk external boundaries early.
   - Cons: Violates the current fail-closed and provider-free development posture; cannot be proven safely without credentials, legal decisions, and tenant-scoped runtime fixtures.
   - Effort: High

### Recommendation

Use a hybrid of approaches 1 and 2, while explicitly rejecting provider-first activation for the next phase. The next proposal should define a production-completion program with these dependency gates:

1. Establish trustworthy validation: isolate the 19 full-test failures, fix stale assertions or document baseline exceptions, remove OOM/concurrency instability, capture final build/typecheck/lint results, and create a repeatable Prisma/database smoke harness.
2. Reconcile readiness models and define one canonical fail-closed decision/evidence contract.
3. Build a safe explicit identity/tenant fixture and prove authenticated signup/session, merchant onboarding, customer access, and cross-tenant denial over HTTP with durable storage.
4. Complete the marketplace-to-commitment lifecycle, including durable idempotency, audit/outbox replay, failure compensation, and rollback evidence.
5. Prove finance, delivery, and POS operational slices locally without claiming live settlement; add provider activation only as a separately gated, evidence-backed phase.
6. Replace the highest-value web/mobile shells with contract-backed flows and verify rendered behavior through the available local harness.

This sequence preserves the existing north star: product and service commitments remain separate, ownership and tenant boundaries remain explicit, settlement remains fail-closed, and no external provider or cloud conformance is claimed without evidence.

### Risks

- The full test baseline is currently noisy; treating all 19 failures as TUS regressions would misdirect implementation, while ignoring them would weaken completion claims.
- The repository has a large pre-existing dirty working tree and deleted unrelated OpenSpec paths; all changes must remain scoped to `tus-production-completion`.
- Empty identity seeding and absent PostgreSQL HTTP smoke make current route-level evidence insufficient for a real customer journey.
- Finance, WhatsApp, and cloud activation require credentials, legal/operational decisions, and explicit evidence; they must not be enabled by configuration alone.
- The two readiness models can produce contradictory activation decisions unless one is made canonical.
- Static web/mobile shells can create a false perception of completion unless UI claims are tied to contract-backed runtime evidence.
- Long-running or OOM-prone validation commands may hide real failures unless run serially with captured logs and resource limits.

### Ready for Proposal

Yes. The next phase should be `sdd-propose` for `tus-production-completion`, scoped as a dependency-ordered completion program rather than a claim that TUS is already production-ready. The proposal should include the validation-baseline work, canonical readiness decision, authenticated durable journey, local database/HTTP smoke evidence, and explicit deferred/provider activation gates.
