# Tasks: TUS Platform Vision

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,200–2,000 (within configured 99,999-line budget) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 contracts; PR 2 API contexts; PR 3 integrations/gates; PR 4 clients |
| Delivery strategy | force-chained |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Versioned TUS DTOs and domain primitives | PR 1, base `feature/tus-platform-vision` | `node --experimental-strip-types --test tests/foundation/p7-tus-marketplace-operations.test.mjs` | In-memory contract/primitive smoke in that test | `packages/contracts/src/tus.ts`, `packages/contracts/src/index.ts`, TUS primitive files |
| 2 | Bounded API contexts and mixed checkout/settlement | PR 2, base PR 1 branch | same focused command | In-memory composition: split commitments, freezes, snapshots, isolation | `apps/api/src/tus/` |
| 3 | Provider mapping, routes, readiness gates, jobs | PR 3, base PR 2 branch | focused command plus `pnpm build` | Gate-disabled API smoke; no production settlement/fleet execution | `apps/api/src/server.ts`, provider adapters, gate wiring |
| 4 | Web/PWA, mobile POS, operations, and WhatsApp clients | PR 4, base PR 3 branch | focused command plus `pnpm build` | N/A for E2E: no runner exists; use contract smoke only | `apps/web/src/app/`, `apps/web/src/lib/tus-client.ts`, `apps/mobile/app/`, `apps/mobile/src/application/tus-client.ts` |

## Phase 1: Contracts and Foundation

- [x] 1.1 RED: add failing `tests/foundation/p7-tus-marketplace-operations.test.mjs` cases for cohort rejection, independent mixed-cart commitments, tenant isolation, evidence freezes, immutable snapshots, governed WhatsApp, support linkage, and failed gates; threat-matrix rows are all N/A and add no tests.
- [x] 1.2 GREEN: create `packages/contracts/src/tus.ts`, export it from `packages/contracts/src/index.ts`, and create `apps/api/src/tus/domain/` primitives for cohorts, commitments, evidence, settlement snapshots, disputes, and WhatsApp actions.
- [x] 1.3 REFACTOR: validate contract versioning and deterministic clock/store seams with `pnpm contracts:validate`; preserve neutral package ownership.

## Phase 2: API Bounded Contexts

- [x] 2.1 RED: extend the foundation test for product/service orchestration, configurable release eligibility, absolute risk freezes, commission snapshot immutability, audit references, and outbox/idempotency retry behavior.
- [x] 2.2 GREEN: implement `apps/api/src/tus/application/`, `ports/`, `adapters/`, and `composition/` for discovery, merchant/catalog, appointments/services, delivery, POS, settlement, disputes, support, reporting/SEO, and mixed checkout.
- [x] 2.3 REFACTOR: enforce tenant authorization at every TUS read/command and keep TUS policy outside `apps/api/src/platform/`.

## Phase 3: Integration and Activation Safety

- [x] 3.1 RED: add provider, route, readiness-gate, release-job-disablement, and compensating-entry assertions to `tests/foundation/p7-tus-marketplace-operations.test.mjs`.
- [x] 3.2 GREEN: wire `apps/api/src/server.ts`, `apps/api/src/providers/mercado-pago/index.ts`, and `apps/api/src/providers/whatsapp/index.ts`; add fail-closed legal/KYC/KYB/tax/POS/AWS-Groq gates and guarded outbox jobs.
- [x] 3.3 REFACTOR: verify secure Mercado Pago redirects, signed tenant-aware WhatsApp allowlists, audit events, and rollback preservation of evidence/neutral contracts.

## Phase 4: Client Surfaces and Verification

- [x] 4.1 RED: add contract-smoke coverage for web/PWA discovery, merchant operations, customer commitments, mobile POS/manual mode, and governed WhatsApp handoff.
- [x] 4.2 GREEN: create `apps/web/src/app/` TUS shells, `apps/web/src/lib/tus-client.ts`, `apps/mobile/app/` POS flows, and `apps/mobile/src/application/tus-client.ts` with explicit offline/conflict policy.
- [x] 4.3 REFACTOR: run `pnpm test`, `pnpm build`, and `pnpm lint`; record E2E as deferred because no runner exists and confirm rollback disables commitments/providers/release jobs.
