# Apply Progress: TUS Final UI/UX Completion

**Change**: `tus-final-ui-ux`
**Project**: `goldenrepo-js-py`
**Mode**: Strict TDD
**Delivery**: `auto-chain` / `feature-branch-chain`
**Current work unit**: PR5 — truthful offline/PWA and final journey polish
**Base boundary**: PR4 branch / `feature/tus-mobile-runtime-hardening-pr4`

## Completed Tasks

- [x] 1.1 Permission-gated, independently settled resource loader with 401 withholding and cancellation.
- [x] 1.2 Partial dashboard and operations rendering with disabled, empty, error, live-region, and per-resource retry states.
- [x] 2.1 Validated ARS amount and product/service context capture with stable unchanged-intent retry identity.
- [x] 2.2 Truthful mobile recovery for submitting, accepted, replayed, pending, conflict, error, offline, storage, and quarantined states.
- [x] 3.1 Semantic web landmarks, skip navigation, heading hierarchy, focus/live status contracts, and recovery actions.
- [x] 3.2 Responsive web interaction polish with visible hover/pressed/disabled/loading states, destructive confirmation, and long-content safety.
- [x] 4.1 Locale, currency, date, transport, support, and SEO regression tests.
- [x] 4.2 Canonical locale/metadata, Intl formatting, normalized API transport, governed WhatsApp payload, safe support destination, robots, and sitemap.
- [x] 5.1 Truthful installability/offline claims and reconnect identity regression tests.
- [x] 5.2 Final landing/deep-link/support journey polish and automatic reconnect replay.

## Implementation

- Added `apps/web/src/lib/tus-resource-loader.ts` with server-permission gates for customer discovery, customer commitments, merchant operations, and operations reporting.
- Extended `apps/web/src/lib/tus-ui-contract.ts` with typed resource states and retry metadata.
- Updated `apps/web/src/app/tus/tus-ui.tsx` so resource states have stable headings, live announcements, wrapped references, and actionable retry controls.
- Updated `apps/web/src/app/tus/tus-dashboard.tsx` and `apps/web/src/app/tus/tus-operations.tsx` to preserve settled siblings instead of treating one failed request as a whole-surface failure.
- Added `tests/foundation/tus-partial-loading.test.mjs` covering mixed permissions, empty/timeout/error states, retry isolation, 401 withholding, role-only denial, and late-response cancellation.
- Added labeled ARS amount entry, product/service operation mapping, draft-version identity reuse, and validation feedback to `apps/mobile/app/(app)/pos.tsx`.
- Added mobile amount parsing, operation identity generation, safe quarantine clearing, snapshot-based queue replay, and accessible conflict retry/discard actions in `apps/mobile/src/application/tus-client.ts`, `apps/mobile/src/presentation/components/{TusStateView.tsx,TusAccessibleButton.tsx}`, `apps/mobile/src/store/app-store.ts`, and `apps/mobile/app/(app)/pos.tsx`.
- Added PR2 RED tests for amount validation, context identity, conflict/offline retry, encrypted-storage failure, quarantine recovery, and accessible conflict actions in `apps/mobile/tests/unit/{tus-pos.test.ts,tus-accessibility.test.tsx}`.
- Added PR3 RED tests for page/recovery landmarks, descriptive heading hierarchy, action state semantics, focus/live contracts, reduced motion, touch targets, narrow layouts, and long-content wrapping in `tests/foundation/{tus-ui-ux-improvement.test.mjs,tus-responsive-pwa.test.mjs}`.
- Updated the public landing and recovery surfaces with native navigation, skip links, stable main landmarks, descriptive journey links, and recovery sign-in links; protected links remain deep-linkable.
- Updated web state/action primitives and POS feedback with stable accessible names, assertive inline errors, explicit busy/disabled semantics, and server-authoritative recovery copy. Dashboard sign-out now confirms intent and prevents duplicate submission while signing out.
- Polished the editorial field-notes CSS with visible hover/pressed/focus states, 44px touch targets, explicit transitions, reduced-motion behavior, responsive reflow, and anywhere-wrapping for identifiers and evidence.
- Added canonical `en-AR`/Argentina timezone Intl helpers for currency, numbers, and dates; ARS and foreign currencies stay server-labelled, while missing/invalid facts remain explicitly unavailable.
- Normalized TUS API base/path joining and reused it for auth transport; preserved tenant, actor, correlation, authorization, JSON body, contract/API version, and idempotency headers.
- Serialized the existing nested WhatsApp handoff contract with explicit consent, sender, request hash, and stable idempotency identity; added allowlisted HTTPS WhatsApp destinations and truthful governed-support copy.
- Added canonical layout metadata, configurable HTTPS public origin, manifest locale, public-only `robots.txt`, and public-only `sitemap.xml` routes; protected tenant surfaces remain excluded.
- Made PWA messaging explicit: the manifest and landing boundary distinguish installability from the online-only operation requirement; no service worker or offline claim was added.
- Hardened mobile queued operations by snapshotting the operation at record time, preventing caller mutation from changing the payload or idempotency identity used during reconnect.
- Added automatic pending-queue sync when connectivity returns or restored encrypted storage becomes ready; accepted/replayed remain the only clearing acknowledgements.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/foundation/tus-partial-loading.test.mjs` | Unit/contract | N/A (new loader) | ✅ Missing-module failure recorded before implementation | ✅ 4 tests passed | ✅ Permission matrix, timeout, retry, and 401 cases | ✅ 6 tests passed after cancellation and role-only cases |
| 1.2 | `tests/foundation/tus-partial-loading.test.mjs` | Unit/contract | ✅ Existing web foundation tests 8/8 | ✅ Tests specified settled siblings and empty state before surface wiring | ✅ 6 tests passed; web typecheck passed | ✅ Empty merchant/customer paths and isolated retry | ✅ Prettier + focused tests/typecheck/build passed |
| 2.1 | `apps/mobile/tests/unit/tus-pos.test.ts` | Unit/component contract | ✅ PR1 mobile regression 20/20 | ✅ Missing parser and labeled context/reuse cases failed before implementation | ✅ 24 POS assertions passed | ✅ Decimal comma, non-finite, context, and identity variants | ✅ Extracted parser/identity helpers; 24 assertions still passed |
| 2.2 | `apps/mobile/tests/unit/{tus-pos.test.ts,tus-accessibility.test.tsx}` | Unit/component | ✅ 24 PR2 focused tests after 2.1 | ✅ Missing secondary conflict action, unsafe quarantine clear, and replay mutation hang exposed | ✅ 26 focused tests passed | ✅ Offline conflict, storage rejection, quarantine preservation, no-success feedback | ✅ Snapshot replay iteration and accessible button state refactor; 26 still passed |
| 3.1 | `tests/foundation/{tus-ui-ux-improvement.test.mjs,tus-responsive-pwa.test.mjs}` | Unit/contract | ✅ PR2 web focused baseline 8/8 | ✅ Landmark/heading/recovery assertions failed before implementation | ✅ 8 web tests passed | ✅ Public/recovery landmarks, native links, live regions, focus, reduced motion, and responsive contracts | ✅ Prettier + web typecheck/build passed |
| 3.2 | `tests/foundation/{tus-ui-ux-improvement.test.mjs,tus-responsive-pwa.test.mjs}` | Unit/contract | ✅ PR3 task 3.1 focused tests 8/8 | ✅ Interaction/CSS state assertions failed before implementation | ✅ 8 web tests passed | ✅ Hover/pressed/disabled/loading, confirmation, touch-safe targets, narrow POS/recovery, and wrapping | ✅ Prettier + focused tests, mobile regressions, typechecks, lint, and runtime harness passed |
| 4.1 | `tests/foundation/{tus-journeys-ui.test.mjs,tus-idempotency-ui.test.mjs,tus-responsive-pwa.test.mjs}` | Unit/contract | ✅ PR3 focused web tests 12/12 | ✅ New locale, transport, handoff, SEO, and metadata assertions failed before implementation | ✅ 16 focused assertions/tests passed across 3 files | ✅ ARS/foreign/missing currency, date, trailing-slash joining, headers, nested handoff, safe destination, and public routes | ✅ Refined public-origin fallback, shared Intl helpers, and transport headers; focused suite remained green |
| 4.2 | `apps/web/src/lib/{tus-client.ts,tus-journeys.ts}` + web metadata/UI | Unit/contract + render | ✅ Existing web typecheck and lint baseline | ✅ Implementation references were absent or returned legacy locale/transport behavior | ✅ Web typecheck/build and focused suites passed | ✅ Auth transport reuse, configured-origin fallback, unknown currency preservation, and operations support copy | ✅ No backend authority changes; web lint remains warning-only |
| 5.1 | `tests/foundation/tus-responsive-pwa.test.mjs`, `apps/mobile/tests/unit/tus-pos.test.ts` | Unit/contract | ✅ PR4 focused web/mobile baseline | ✅ Offline/PWA wording and mutable reconnect payload assertions failed before implementation | ✅ 6 web tests and 23 mobile POS tests passed | ✅ No service-worker claim, online requirement, exact reconnect payload, and stable idempotency key | ✅ Snapshot queue operations and automatic reconnect sync; full mobile suite remained green |
| 5.2 | `tests/foundation/tus-journeys-ui.test.mjs` + landing/mobile POS surfaces | Unit/render | ✅ PR4 journey and metadata baseline | ✅ Final online-boundary copy assertion failed before implementation | ✅ 5 journey tests passed; web build and HTTP render passed | ✅ Deep links, protected-scope filtering, product/service separation, support boundary, and online-only messaging | ✅ Kept existing editorial and accessible surfaces; changed only final copy/route behavior |

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/foundation/tus-ui-ux-improvement.test.mjs tests/foundation/tus-responsive-pwa.test.mjs` — exit 0; 2 files, 12 tests passed, 0 failed. |
| PR4 focused test command | `pnpm test -- tests/foundation/tus-journeys-ui.test.mjs tests/foundation/tus-idempotency-ui.test.mjs tests/foundation/tus-responsive-pwa.test.mjs` — exit 0; 3 files, 16 tests passed, 0 failed. |
| PR5 focused web command | `pnpm test -- tests/foundation/tus-responsive-pwa.test.mjs tests/foundation/tus-journeys-ui.test.mjs` — exit 0; 2 files, 11 tests passed, 0 failed. |
| PR5 focused mobile command | `pnpm --dir apps/mobile exec jest tests/unit/tus-pos.test.ts --runInBand --forceExit` — exit 0; 1 suite, 23 tests passed, 0 failed. |
| Mobile regression command | `pnpm --dir apps/mobile exec jest tests/unit/tus-pos.test.ts tests/unit/tus-accessibility.test.tsx --runInBand --forceExit` — exit 0; 2 suites, 26 tests passed, 0 failed. Full mobile unit set: 7 suites, 55 tests passed. |
| Typechecks | `pnpm --filter @factory/web typecheck` — exit 0; `pnpm --dir apps/mobile typecheck` — exit 0. |
| Builds | `pnpm --filter @factory/web build` — exit 0; Next compiled and generated the route table. `APP_PROFILE=dev pnpm --dir apps/mobile exec expo export --platform web` — Metro bundled 777 modules and emitted `dist` before the host command timed out during shutdown. Existing web workspace-lockfile and anonymous-default-export warnings remain. |
| PR4 web build | `pnpm --filter @factory/web build` — completed successfully; Next compiled, generated the 14-route output including `/robots.txt` and `/sitemap.xml`, and wrote `apps/web/.next/BUILD_ID`. |
| Contracts/security/policy | `pnpm contracts:validate` — exit 0; 98 JSON Schema contracts validated with existing format warnings. `pnpm security:scan` — exit 0. `node scripts/security/validate-policy.mjs` — exit 0. |
| Local HTTP harness | `next start -p 3100` from `apps/web`; `/`, `/robots.txt`, `/sitemap.xml`, `/recovery`, `/tus/operations`, and `/tus/pos` returned HTTP 200 with expected route/content checks. `/manifest.webmanifest` returned HTTP 200; PowerShell exposed its body as numeric bytes, so its content assertion remains covered by the deterministic manifest test. |
| Local render harness | `node apps/api/node_modules/tsx/dist/cli.mjs --eval …` — exit 0; landing markup rendered, public robots/sitemap metadata generated with protected `/tus` paths excluded, and manifest locale was `en-AR`. |
| PR5 local HTTP harness | `next start -p 3100` from `apps/web`; `/`, `/recovery`, `/tus/operations`, `/tus/pos`, `/robots.txt`, `/sitemap.xml`, and `/manifest.webmanifest` returned HTTP 200. Node fetch confirmed text/plain robots, application/xml sitemap, and application/manifest+json manifest with `en-AR`. |
| Lint | `pnpm --filter @factory/web lint` — exit 0; existing non-blocking workspace-root and anonymous-default-export warnings only. |
| Runtime harness | `node apps/web/node_modules/next/dist/bin/next start -p 3100` — exit 0; local HTTP checks returned 200 for `/`, `/recovery`, `/tus/pos`, and `/tus/operations`, each containing the main landmark and navigation. |
| Browser/device evidence | Deferred as required: no browser keyboard/screen-reader, responsive zoom, iOS/Android touch/offline, or physical-device run was performed. |
| Full mobile check | `pnpm --dir apps/mobile exec jest --runInBand --forceExit` — exit 0; 7 suites, 55 tests passed. `pnpm --dir apps/mobile typecheck` — exit 0. Expo web export emitted `dist` and bundled 777 modules before the host command timed out during shutdown. |
| Full-suite check | `pnpm test` — host command timed out at 120 seconds before aggregate completion; no PR4-specific failure was reported in the completed output. The previously recorded unrelated finance expectation mismatch remains outside PR4. |
| PR5 full mobile check | `pnpm --dir apps/mobile exec jest --runInBand --forceExit` — exit 0; 7 suites, 56 tests passed, 0 failed. `pnpm --dir apps/mobile typecheck` — exit 0. |
| Rollback boundary | Revert only PR4 changes in `apps/web/src/lib/{tus-client.ts,tus-auth-client.ts,tus-journeys.ts,tus-ui-contract.ts}`, `apps/web/src/app/{layout.tsx,manifest.ts,robots.ts,sitemap.ts}`, `apps/web/src/app/tus/{tus-dashboard.tsx,tus-operations.tsx}`, the three PR4 foundation test files, and PR4 task/progress lines. Preserve PR1 loader/partial-loading behavior, PR2 mobile implementation, PR3 semantics/CSS, backend/auth contracts, queues, finance, and idempotency records. |

## Remaining Work

- [x] 2.1 Mobile POS amount/context capture.
- [x] 2.2 Mobile operation recovery and storage/quarantine feedback.
- [x] 3.1 Web recovery landmarks and interaction semantics.
- [x] 3.2 Responsive web interaction polish.
- [x] 4.1 Locale, currency, transport, support, and SEO tests.
- [x] 4.2 Locale, support, SEO, and transport implementation.
- [x] 5.1 Truthful offline/PWA and reconnect identity.
- [x] 5.2 Final landing/deep-link/journey polish.

## Risks / Deviations

- No API, database, authorization, payment, or service-worker contract was changed; PR2 changes are limited to mobile POS capture/recovery behavior.
- PR3 remains frontend-only: native navigation/landmarks, accessible state primitives, defensive POS validation, interaction CSS, and sign-out confirmation changed no tenant, finance, authorization, idempotency, or service-worker authority.
- Role names are not treated as loading authority; only server-derived permission claims gate resource requests.
- A 401 withholds all protected resource data and delegates reauthentication to the existing auth flow.
- The existing Next workspace-root lockfile warning and anonymous-default-export lint warnings remain non-blocking and outside PR3 scope.
- Full `pnpm test` is not green because a pre-existing unrelated `tests/foundation/p8-tus-finance.test.mjs` assertion expects `completion_evidence_required` while the current implementation returns `completion_confirmation_required`; no PR3 files were involved.
- PR4 keeps public-origin and support destinations configurable; invalid/non-HTTPS origins fall back to `https://tusservicios.com`, and invalid/non-allowlisted WhatsApp destinations expose no external link.
- No backend authority, API route, database, payment, settlement, or idempotency behavior was changed; the web layer only adds transport metadata and serializes the existing handoff contract.
- PR5 does not add a web service worker or claim browser/device offline support; mobile reconnect automation only replays encrypted, tenant-scoped queued operations with their original identity.

## Status

10/10 tasks complete. PR5 is ready for verification; browser/device/PWA-install evidence remains deferred. Next recommended: `sdd-verify`.
