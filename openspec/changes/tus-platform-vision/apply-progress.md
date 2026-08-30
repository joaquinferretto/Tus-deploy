# Apply Progress: TUS Platform Vision

## Status

- **Mode:** Strict TDD
- **Artifact store:** OpenSpec
- **Delivery strategy:** force-chained
- **Chain strategy:** feature-branch-chain
- **Work unit:** Work Unit 4 — Client surfaces and verification
- **Boundary:** Started after completed Work Unit 3 and ended after tasks 4.1–4.3. No provider, API policy, or review lifecycle work was added.

## Completed Tasks

- [x] 1.1 RED — Added the focused foundation tests before production implementation.
- [x] 1.2 GREEN — Added versioned contracts and TUS domain primitives, including support-case linkage.
- [x] 1.3 REFACTOR — Added deterministic timestamps, package exports/build configuration, and validated contracts.
- [x] 2.1 RED — Extended the foundation test with application orchestration, configurable release policy, tenant isolation, audit references, and idempotency/outbox retry cases.
- [x] 2.2 GREEN — Added TUS application, port, in-memory adapter, and composition layers for the bounded-context surface and mixed checkout.
- [x] 2.3 REFACTOR — Centralized tenant checks, tenant-scoped in-memory keys, deterministic event construction, and explicit bounded-context exposure outside the neutral platform.
- [x] 3.1 RED — Added provider mapping, signed webhook route, expanded readiness-gate, release-job disablement, and compensating-entry assertions before implementation.
- [x] 3.2 GREEN — Added provider/route integration, AWS/Groq fail-closed activation gates, and guarded TUS release-job enqueueing.
- [x] 3.3 REFACTOR — Normalized disabled-gate state, preserved signed tenant-aware provider handling, and verified rollback evidence/audit/neutral-contract preservation.
- [x] 4.1 RED — Added web/PWA and mobile POS contract-smoke scenarios before client implementation.
- [x] 4.2 GREEN — Added typed web discovery/merchant/customer/WhatsApp client operations, Expo POS/manual mode shells, and mobile offline queue/conflict handling.
- [x] 4.3 REFACTOR — Completed focused/full verification, contract validation, package checks, and documented deferred E2E plus fail-closed rollback boundaries.

## TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Unit | N/A (new test) | ✅ Written; initial run failed with `ERR_MODULE_NOT_FOUND` for the not-yet-created domain module | ✅ 9/9 passing after implementation | ✅ 9 behavioral scenarios covering approved/rejected cohorts, mixed/foreign commitments, evidence paths, freezes, support linkage, immutable snapshots, WhatsApp allowlist, and readiness gates | ✅ Focused test remained 9/9 after cleanup |
| 1.2 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Unit | ✅ `p0-contracts.test.mjs`: 3/3 passing (regression check) | ✅ Covered by 1.1 RED | ✅ 9/9 passing; `pnpm --filter @factory/contracts build` and `pnpm --filter @factory/api build` passed | ✅ Multiple inputs and alternate branches exercised in the same focused suite | ✅ API/package TypeScript builds passed after import and type-boundary cleanup |
| 1.3 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Unit/contract | ✅ Focused suite and p0 contract regression passed | ✅ Covered by 1.1 RED | ✅ 9/9 passing | ✅ Version validation, immutable snapshot, fixed clock inputs, support linkage, and failed-gate branches covered | ✅ `pnpm contracts:validate` passed with `Validated 81 JSON Schema contract(s).` |
| 2.1 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Unit/application contract | ✅ 9/9 focused tests from Work Unit 1 | ✅ Written first; initial run failed with `ERR_MODULE_NOT_FOUND` for `apps/api/src/tus/composition/index.ts` | ✅ 12/12 passing after the first application implementation | ✅ Added replay, conflict, authorized-read, configurable local policy, absolute freeze, audit, and outbox scenarios | ✅ Focused suite remained green after API boundary cleanup |
| 2.2 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Unit/application contract | ✅ 12/12 | ✅ Covered by 2.1 RED | ✅ 14/14 passing after bounded-context composition was added | ✅ Product-only and mixed product/service checkout inputs exercise distinct orchestration paths | ✅ Extracted audit/event builders and added tenant-scoped adapter keys |
| 2.3 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Unit/application contract | ✅ 14/14 | ✅ Covered by 2.1 RED | ✅ 14/14 passing | ✅ Same-tenant read, foreign-tenant denial, request-hash conflict, replay, and unsupported-context branches covered | ✅ No TUS policy added to `apps/api/src/platform/`; final API build passed |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `node --experimental-strip-types --test tests/foundation/p7-tus-marketplace-operations.test.mjs` — exit 0; 9 tests passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario and exact result | Same Node test command exercises the in-memory contract/domain runtime path for cohort publication, mixed-cart splitting, tenant authorization, evidence/release eligibility, disputes/freezes, support linkage, snapshots, WhatsApp handoff, and readiness gates — exit 0; 9/9 passed. |
| Rollback boundary | Revert only `tests/foundation/p7-tus-marketplace-operations.test.mjs`, `packages/contracts/src/base.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/tus.ts`, `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `apps/api/tsconfig.json`, and `apps/api/src/tus/domain/{cohorts,commitments,disputes,evidence,index,readiness,settlement,support,whatsapp}.ts`; generated `dist`/build-info outputs are ignored artifacts. |

### Work Unit 2 Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm exec node --experimental-strip-types --test tests/foundation/p7-tus-marketplace-operations.test.mjs` — exit 0; 14 tests passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario and exact result | Same command exercises the in-memory TUS application path for mixed checkout composition, bounded-context exposure, tenant-scoped reads, configurable release policy, absolute risk freezes, audit references, idempotency replay/conflict, and outbox deduplication — exit 0; 14/14 passed. |
| Rollback boundary | Revert only the Work Unit 2 additions to `tests/foundation/p7-tus-marketplace-operations.test.mjs`, `apps/api/src/tus/ports/index.ts`, `apps/api/src/tus/application/index.ts`, `apps/api/src/tus/application/tus-application-service.ts`, `apps/api/src/tus/adapters/index.ts`, `apps/api/src/tus/adapters/in-memory.ts`, and `apps/api/src/tus/composition/index.ts`; preserve Work Unit 1 domain primitives, contracts, and unrelated platform changes. |

### TDD Cycle Evidence — Work Unit 3

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.1 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Unit/HTTP contract | ✅ 14/14 focused tests | ✅ Written first; initial run failed with `ERR_MODULE_NOT_FOUND` for the not-yet-created integration module | ✅ 18/18 passing after integration wiring | ✅ Provider happy path plus denied WhatsApp sender, failed readiness gate, disabled/enabled/rollback job paths, and invalid-signature HTTP route | ✅ Focused suite remained 18/18 after route and gate cleanup |
| 3.2 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Unit/HTTP contract | ✅ 14/14 | ✅ Covered by 3.1 RED | ✅ 18/18; `pnpm --filter @factory/api build` passed | ✅ Mercado Pago approved mapping, tenant-scoped outbox/saga records, WhatsApp policy enforcement, and real server route execution | ✅ Provider constructors and server imports were made compatible with the strip-only test runner; tests remained green |
| 3.3 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Unit/HTTP contract | ✅ 18/18 | ✅ Covered by 3.1 RED | ✅ 18/18 | ✅ Secure signed webhook rejection and rollback behavior preserve evidence/audit/neutral contracts | ✅ Extracted the disabled-gate constant and rejection-reason helper; tests remained 18/18 |

### Work Unit 3 Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm exec node --experimental-strip-types --test tests/foundation/p7-tus-marketplace-operations.test.mjs` — exit 0; 18 tests passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario and exact result | Same command starts the Express app on an ephemeral port and uses `fetch` against `/tus/providers/mercado-pago/webhook`; invalid signatures return HTTP 422 without provider state mutation. It also executes signed Mercado Pago/WhatsApp in-memory adapters and guarded release-job activation/rollback — exit 0; 18/18 passed. |
| Rollback boundary | Revert only `apps/api/src/tus/integration/index.ts`, `apps/api/src/tus/domain/readiness.ts`, `apps/api/src/server.ts`, the Work Unit 3 compatibility/wiring changes in `apps/api/src/providers/mercado-pago/index.ts`, `apps/api/src/providers/whatsapp/index.ts`, `apps/api/src/platform/jobs/adapters/activation-gated.ts`, and the Work Unit 3 additions to `tests/foundation/p7-tus-marketplace-operations.test.mjs`; preserve Work Units 1–2 contracts, domain primitives, API contexts, and unrelated platform changes. |

## Verification Notes

- `pnpm contracts:validate` — exit 0; validated 81 JSON Schema contracts.
- `pnpm --filter @factory/contracts build` — exit 0.
- `pnpm --filter @factory/api build` — exit 0.
- `pnpm test` — exit 1; 300 total tests, 295 passed and 5 failed. Work Unit 1 tests passed (9/9); the failures are unrelated pre-existing foundation tests: P5.5 core-source contamination, P5.6 contamination/parity (2), P6.9 traceability, and P6.6 portability.
- `pnpm build` — API and contracts builds passed; the workspace build was blocked by a Windows `EPERM` symlink error during the existing Next.js standalone web trace step.
- `pnpm contracts:validate` — exit 0; validated 81 JSON Schema contracts.
- `pnpm --filter @factory/contracts build` — exit 0.
- `pnpm --filter @factory/api build` — exit 0 after Work Unit 2 changes.
- `pnpm test` — exit 1; 305 total tests, 300 passed and 5 failed. All 14 Work Unit 2 tests passed; the same unrelated pre-existing foundation failures remain: P5.5 core-source contamination, P5.6 contamination/parity (2), P6.9 traceability, and P6.6 portability.
- `pnpm contracts:validate` — exit 0; validated 81 JSON Schema contracts. AJV emitted existing unsupported-format warnings for date-time, uri, and email.
- `pnpm --filter @factory/contracts build` — exit 0.
- `pnpm --filter @factory/api build` — exit 0 after Work Unit 3 changes.
- `pnpm test` — exit 1; 309 total tests, 304 passed and 5 failed. All 18 Work Unit 3 tests passed; failures remain outside this work unit: P5.5 core-source contamination, P5.6 contamination validation, P5.6 parity validation, P6.9 traceability (deleted prior-change spec path), and P6.6 portability validation.
- `pnpm build` — exit 1 after API/contracts builds passed; the existing Next.js standalone trace step failed on Windows `EPERM` symlink creation in `apps/web`.

## Deviations and Issues

- The existing repository was already heavily modified and untracked before this work unit; no unrelated files were changed intentionally.
- The threat-matrix rows in the design are all N/A, so no additional threat tests were added.
- No review lifecycle or `gentle-ai review` command was invoked.
- Work Unit 2 uses in-memory TUS adapters rather than provider or route wiring; provider activation and production job gates remain explicitly deferred to Work Unit 3.
- Work Unit 3 provider files and the activation-gated job transport were already present as untracked implementation surfaces; this unit completed their server/integration wiring and made the constructor forms executable under Node’s strip-only focused test runner.
- No external Mercado Pago, WhatsApp, settlement, or fleet execution was attempted; the runtime harness is deterministic and fail-closed by design.

## Remaining Tasks

- [x] 2.1–2.3 API bounded contexts
- [x] 3.1–3.3 integrations and activation safety
- [x] 4.1–4.3 client surfaces and verification

### TDD Cycle Evidence — Work Unit 4

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.1 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Unit/contract smoke | ✅ 18/18 focused tests | ✅ Written first; initial run failed with `ERR_MODULE_NOT_FOUND` for the new web client | ✅ 20/20 after the first typed client implementations | ✅ 22/22 with fetch-header/payment-credential and online-acceptance branches | ✅ Focused suite remained 22/22 after contract-version import cleanup |
| 4.2 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Unit/contract smoke | ✅ 18/18 focused tests | ✅ Covered by 4.1 RED | ✅ 22/22 after web/PWA shells, mobile POS route, and offline/conflict client code | ✅ Discovery, merchant operations, customer commitments, WhatsApp handoff, offline queue, conflict preservation, discard, and online acceptance covered | ✅ Contracts build, web type validation, mobile typecheck, and mobile lint passed; focused suite remained 22/22 |
| 4.3 | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Verification/refactor | ✅ 22/22 focused tests | ➖ N/A (verification-only task) | ✅ Focused 22/22; contracts validation passed; mobile checks passed | ➖ N/A (verification-only task) | ✅ Full verification results and deferred E2E/rollback boundaries recorded without changing TUS policy |

### Work Unit 4 Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm exec node --experimental-strip-types --test tests/foundation/p7-tus-marketplace-operations.test.mjs` — exit 0; 22 tests passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario and exact result | Same command exercises deterministic web transport requests for discovery, merchant operations, customer commitments, and governed WhatsApp payment handoff, plus mobile POS online acceptance, offline queueing, conflict preservation, and explicit discard — exit 0; 22/22 passed. E2E is `N/A`: no integration/E2E runner exists in `openspec/config.yaml`. |
| Rollback boundary | Revert the Work Unit 4 additions/hunks only in `tests/foundation/p7-tus-marketplace-operations.test.mjs`, `apps/web/src/lib/tus-client.ts`, `apps/web/src/app/globals.css`, `apps/web/src/app/tus/page.tsx`, `apps/web/src/app/manifest.ts`, the Work Unit 4 metadata/import changes in `apps/web/src/app/layout.tsx`, `apps/mobile/src/application/tus-client.ts`, `apps/mobile/app/(app)/pos.tsx`, the POS link hunk in `apps/mobile/app/(app)/index.tsx`, the `@factory/contracts` dependency additions in both client package manifests, and their corresponding workspace lockfile entries. This leaves Work Units 1–3, neutral contracts, and unrelated pre-existing edits intact. |

### Work Unit 4 Verification Notes

- `pnpm contracts:validate` — exit 0; validated 81 JSON Schema contracts (existing AJV unsupported-format warnings for date-time, uri, and email remain).
- `pnpm --filter @factory/contracts build` — exit 0.
- `pnpm --filter @factory/mobile typecheck` — exit 0.
- `pnpm --filter @factory/mobile lint` — exit 0.
- `pnpm --filter @factory/web build` — compiled, type-checked, collected, and generated all 6 pages, then exited 1 during existing Windows Next.js standalone trace symlink creation (`EPERM`).
- `pnpm test` — exit 1; 313 total tests, 308 passed and 5 failed. All 22 Work Unit 4 tests passed; the five failures are unrelated pre-existing P5.5/P5.6 contamination/parity, P6.9 deleted prior-change spec traceability, and P6.6 portability failures.
- `pnpm build` — exit 1 at `@factory/web#build` after API/contracts builds passed; Next.js compiled and generated all 6 pages, then failed on existing Windows standalone trace symlink creation (`EPERM`).
- `pnpm lint` — exit 1 before completing because pre-existing `@factory/zod-schemas` has no ESLint configuration.
- `pnpm --filter @factory/web lint` — exit 1; `next lint` is interactive because the package has no ESLint configuration, so no lifecycle configuration was invented.

### Work Unit 4 Deviations and Issues

- Typed client smoke coverage uses deterministic fake transports; E2E remains deferred because no integration/E2E runner is available.
- Web and mobile consume `@factory/contracts/tus` through workspace dependencies so client typechecking uses the built, versioned contract surface instead of importing source files directly.
- The web build failures are environmental Windows symlink restrictions in Next.js standalone tracing, not TypeScript or page-generation failures; full lint is blocked by pre-existing missing ESLint configuration.
