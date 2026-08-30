# Apply Progress: TUS UI/UX Improvement

## Work Unit

- **Change**: `tus-ui-ux-improvement`
- **Slice**: Work Unit 5 / PR5 — final journey surface polish
- **Delivery**: automatic feature-branch-chain; current branch is the existing feature validation branch
- **Scope**: Tasks 5.1–5.3 only; PR1–PR4 are preserved
- **Mode**: Strict TDD (`pnpm test`)
- **Evidence boundary**: deterministic contract/component tests, typechecks, web build, and local render harness; browser, screen-reader, and physical-device evidence deferred

## Cumulative Task Status

| Task | Status | Result |
|---|---|---|
| 1.1 | Complete | Added RED-first web and mobile auth tests for server scope, missing/malformed/expired/revoked/storage failure, and safe return paths. |
| 1.2 | Complete | Added shared session contracts, web auth exchange/bootstrap/recovery, sign-in/recovery/entry surfaces, mobile secure bootstrap, and server-derived mobile tenant state. |
| 1.3 | Complete | Centralized credential parsing, safe cleanup, recovery copy, and protected-surface bootstrap; preserved existing TUS finance/tenant boundaries. |
| 2.1 | Complete | Added RED-first web contract/render and mobile component tests for state taxonomy, live regions, labels, focus/keyboard foundations, motion, and no-success inference. |
| 2.2 | Complete | Added web state presentation and skip/error/action/live primitives; wired dashboard, operations, POS, auth, and mobile POS/home/session surfaces with semantic states, form metadata, touch-safe controls, and truthful pending/error behavior. |
| 2.3 | Complete | Refactored state semantics/copy around shared contract helpers, added explicit focus-visible/reduced-motion/touch/long-content CSS rules, and preserved the editorial field-notes direction. |
| 3.1 | Complete | Added RED-first deterministic web and mobile tests for metadata/icons, mobile-first CSS, 44px touch targets, safe areas, locale, and offline/pending/reconnecting presentation. |
| 3.2 | Complete | Added viewport metadata and truthful manifest/icon assets; made web layouts mobile-first with safe-area padding, overflow-safe navigation, long-content wrapping, touch targets, reduced motion, and restored wide-screen asymmetry; added mobile safe-area provider and Argentina-first shell styling. |
| 3.3 | Complete | Refactored responsive tokens and mobile connectivity presentation; deterministic suites, typechecks, web build, and local HTTP route/manifest/icon harness pass. |
| 4.1 | Complete | Added RED-first web/mobile coverage for stable intent keys, replay/in-flight/conflict/pending/error mapping, timeout/offline/storage failure, receipt parsing, and safe actions. |
| 4.2 | Complete | Added web checkout/POS acknowledgement parsing and stable retry identity; added mobile durable queue reconciliation, storage-failure handling, persisted POS intent state, and retry/refresh/resolve controls. |
| 4.3 | Complete | Refactored action labels, server-truth copy, receipt preservation, and focusable recovery controls without changing backend contracts or financial claims. |
| 5.1 | Complete | Added RED-first web/mobile coverage for deep links, denied scope, stale refresh, product/service separation, and role labels. |
| 5.2 | Complete | Added contract-backed journey navigation, filtered discovery links, actionable operations refresh, merchant/product-service facts, and scope-aware mobile POS entry/copy. |
| 5.3 | Complete | Refined editorial hierarchy, asymmetry, one deliberate landing reveal, role wayfinding, and evidence-boundary copy without changing backend authority. |

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/foundation/tus-ui-ux-improvement.test.mjs`, `apps/mobile/tests/unit/tus-auth.test.ts` | Unit/contract | ✅ web 7/7; mobile POS 5/5 | ✅ 11 new behavioral cases written before production code | ✅ web 5/5; mobile 6/6 | ✅ internal/external paths, missing/expired/malformed/401/storage and server-scope cases | ✅ common server parsing and recovery paths consolidated |
| 1.2 | Same focused files | Unit/contract | ✅ prior focused suites preserved | ✅ tests referenced missing auth adapters/contracts | ✅ web 5/5; mobile 6/6 | ✅ sign-in and restoration use different server paths and outcomes | ✅ type-safe platform adapters with no client tenant authority |
| 1.3 | Same focused files | Unit/contract | ✅ web 7/7; mobile POS 5/5 | ✅ failure/recovery expectations preceded cleanup | ✅ web 5/5; mobile 6/6 | ✅ transient/unavailable, revoked, malformed, and safe deep-link branches | ✅ no secret-bearing messages/logging; protected routes clear on 401 |
| 2.1 | `tests/foundation/p9-ui-contract.test.mjs`, `apps/mobile/tests/unit/tus-accessibility.test.tsx` | Unit/contract + component | ✅ web 7/7; mobile POS 5/5 | ✅ 5 new behavioral cases written before PR2 production code | ✅ web 10/10; mobile accessibility 3/3 | ✅ pending vs conflict, assertive vs polite announcements, disabled/submitting action, CSS motion/touch/content paths | ✅ test selectors use observable semantics; no CSS-class assertions |
| 2.2 | Same focused files | Unit/contract + component | ✅ PR2 RED suites | ✅ primitive exports and wiring were absent from the new cases | ✅ web 10/10; mobile 3/3; web build/typecheck and mobile typecheck pass | ✅ web state primitives, mobile native equivalents, dashboard tabs, POS validation and rejected transport state | ✅ semantic controls and truthful server-acknowledgement copy consolidated |
| 2.3 | Same focused files | Unit/contract + component | ✅ web 10/10; mobile 3/3 | ✅ refactor expectations retained from PR2 cases | ✅ web 10/10; mobile 3/3 | ✅ loading/empty/error/pending/conflict/disabled branches remain distinct after refactor | ✅ explicit `:focus-visible`, reduced motion, touch action, safe wrapping, and 44px target rules |
| 3.1 | `tests/foundation/tus-responsive-pwa.test.mjs`, `apps/mobile/tests/unit/tus-responsive.test.ts` | Unit/contract + mobile unit | ✅ web 10/10; mobile 8/8 | ✅ 6 new behavioral/static cases written before PR3 production changes | ✅ web 3/3; mobile 3/3 | ✅ narrow/wide metadata, missing icon assets, offline/pending/connected/reconnecting branches | ✅ test assertions remain observable and implementation-independent where possible |
| 3.2 | Same focused files | Unit/contract + mobile unit | ✅ PR3 RED suites | ✅ viewport, safe-area, and connectivity expectations preceded implementation | ✅ web 3/3; mobile 3/3; web build/typechecks and mobile typecheck pass | ✅ metadata/assets and mobile shell use separate paths from CSS layout behavior | ✅ centralized mobile layout/connectivity constants and responsive CSS overrides |
| 3.3 | Same focused files | Unit/contract + mobile unit | ✅ web 3/3; mobile 3/3 | ✅ refactor expectations retained from PR3 cases | ✅ web 3/3; mobile 3/3 | ✅ narrow/wide, safe-area, long-content, touch, and connectivity cases remain green | ✅ no `transition: all`; preserved editorial paper/moss/clay system |
| 4.1 | `tests/foundation/tus-idempotency-ui.test.mjs`, `apps/mobile/tests/unit/tus-pos.test.ts` | Unit/contract + mobile unit | ✅ web p9 10/10; mobile 5/5 | ✅ 10 new behavioral cases written before the PR4 client implementation | ✅ web 4/4; mobile 11/11 | ✅ replay, duplicate, in-flight, timeout, invalid body, offline, conflict, and storage branches | ✅ response/feedback mapping keeps success server-derived |
| 4.2 | Same focused files | Unit/contract + mobile unit | ✅ PR4 RED suites | ✅ missing key/parser/action-label behavior was covered before its implementation | ✅ web client/build and mobile client/store tests pass | ✅ checkout and POS paths preserve distinct stable identities and receipts | ✅ queue persistence and action vocabulary consolidated |
| 4.3 | Same focused files | Unit/contract + mobile unit | ✅ web 14/14; mobile 13/13 | ✅ refactor expectations retained from PR4 cases | ✅ web 14/14; mobile 13/13 | ✅ accepted/replayed remain distinct from pending/conflict/error after cleanup | ✅ retry/refresh/resolve controls remain semantic and focusable |

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/foundation/p9-ui-contract.test.mjs` → **10 passed, 0 failed**; `pnpm --dir apps/mobile exec jest tests/unit/tus-accessibility.test.tsx tests/unit/tus-pos.test.ts --runInBand` → **8 passed, 0 failed**. |
| Typechecks/builds | `pnpm --filter @factory/web exec tsc --noEmit` → **passed**; `pnpm --filter @factory/mobile typecheck` → **passed**; `pnpm --filter @factory/web build` → **passed**, 12 routes generated; `pnpm --filter @factory/contracts build` → **passed**. The full root `pnpm test` sweep was not rerun in this refresh because the recorded repository-wide result remains pre-existing contract-count failures/timeout; focused PR2 suites remain green. |
| Runtime harness | `pnpm --filter @factory/web exec next start -p 3100` with `Invoke-WebRequest` → **ROOT=200, POS=200, ROOT_SKIP=True, POS_BOUNDARY=True**; the static render/client harness in `pnpm test -- tests/foundation/p9-ui-contract.test.mjs` → **10 passed**, including `TusStateMessage` markup, live-region/skip-link/error associations, state mapper, and CSS foundation checks. Browser, screen-reader, keyboard, PWA, and physical-device evidence remains deferred as instructed. |
| Rollback boundary | Revert only PR2 state/accessibility files: `apps/web/src/lib/tus-ui-contract.ts`, `apps/web/src/app/tus/tus-ui.tsx`, dashboard/operations/POS plus web entry/auth wiring, `apps/web/src/app/globals.css`, mobile POS/home/login/layout accessibility edits, `apps/mobile/src/presentation/components/TusAccessibleButton.tsx`, `TusLiveRegion.tsx`, `TusStateView.tsx`, component exports, and PR2 test additions/updates; preserve PR1 auth contracts, backend, tenant, finance, queue, and unrelated pre-existing work. |
| PR3 focused tests | `pnpm test -- tests/foundation/tus-responsive-pwa.test.mjs tests/foundation/p9-ui-contract.test.mjs` → **13 passed, 0 failed**; `pnpm --dir apps/mobile exec jest tests/unit/tus-responsive.test.ts tests/unit/tus-accessibility.test.tsx tests/unit/tus-pos.test.ts --runInBand` → **11 passed, 0 failed**. |
| PR3 typechecks/build | `pnpm --filter @factory/web exec tsc --noEmit` → **passed**; `pnpm --filter @factory/mobile typecheck` → **passed**; `pnpm --filter @factory/web build` → **passed**, 12 routes generated. |
| PR3 runtime harness | Local production server with `pnpm --filter @factory/web start -p 3103` and `curl.exe` → **TUS=200 POS=200 MANIFEST=200 ICON=200; MANIFEST_LANG=es-AR ICONS=2 START=/tus**. This is HTTP route/asset evidence only; browser viewport, install prompt, offline cache, keyboard/screen-reader, and physical-device behavior remain deferred. |
| PR3 rollback boundary | Revert only `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/manifest.ts`, `apps/web/public/icon-192.svg`, `apps/web/public/icon-512.svg`, `apps/mobile/src/presentation/layout/tus-responsive.ts`, `apps/mobile/app/_layout.tsx`, mobile POS/home styling/connectivity presentation, `apps/mobile/src/store/app-store.ts` locale default, and the PR3 test files plus PR3 task/progress rows; preserve PR1–PR2 auth/state contracts, backend, tenant, finance, queues, idempotency, and unrelated work. |

## PR4 Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/foundation/tus-idempotency-ui.test.mjs tests/foundation/p9-ui-contract.test.mjs` → **14 passed, 0 failed**; `pnpm exec jest tests/unit/tus-pos.test.ts tests/unit/tus-accessibility.test.tsx --runInBand` from `apps/mobile` → **13 passed, 0 failed**. |
| Compatibility tests | `python -m pytest tests/compatibility -q` → **209 passed**; `pnpm test -- tests/compatibility/workflow-contracts.test.mjs` → **3 passed, 0 failed**. |
| Typechecks/builds | `pnpm --filter @factory/web exec tsc --noEmit` → **passed**; `pnpm --filter @factory/mobile typecheck` → **passed**; `pnpm --filter @factory/contracts build` → **passed**; `pnpm --filter @factory/web build` → **passed**, 12 routes generated. |
| Runtime harness | Local production HTTP harness using `pnpm --filter @factory/web start -p 3104` plus `Invoke-WebRequest` → **/tus=200, /tus/pos=200, /manifest.webmanifest=200, /icon-192.svg=200**. Client transport/retry harness is included in the focused web/mobile tests. Browser, device, screen-reader, and live backend/database evidence remain deferred. |
| Rollback boundary | Revert only PR4 behavior and tests: `apps/web/src/lib/tus-client.ts`, `apps/web/src/app/tus/tus-dashboard.tsx`, `apps/web/src/app/tus/tus-pos.tsx`, `apps/web/src/app/tus/tus-ui.tsx`, `apps/mobile/src/application/tus-client.ts`, `apps/mobile/src/store/app-store.ts`, `apps/mobile/app/(app)/pos.tsx`, `apps/mobile/tests/unit/tus-pos.test.ts`, and `tests/foundation/tus-idempotency-ui.test.mjs`; preserve PR1–PR3 auth/state/responsive foundations, backend contracts, tenant scope, finance/audit/ledger, queues, and unrelated work. |

## Notes and Risks

- The root `pnpm test` sweep was attempted but timed out after 120 seconds and exposed pre-existing contract-count assertions expecting `90` while the current repository validates `98`; this slice does not alter those unrelated expectations. Focused PR1 tests pass.
- The current worktree contains substantial unrelated uncommitted feature-branch changes and has no configured Git remote; no commit/push was performed to avoid capturing or overwriting unrelated work. PR1 should be isolated before opening the child PR.
- Web/mobile production clients use the existing `/auth/sign-in`, `/auth/session`, and `/auth/sign-out` contracts. The server response—not form input or persisted tenant fields—creates the protected session.
- Next route groups expose canonical UI routes as `/sign-in` and `/recovery`; compatibility redirects at `/auth/sign-in` and `/auth/recovery` preserve existing deep links and query parameters without changing API contract paths.
- PR2 uses the editorial field-notes / Argentine wayfinding direction already established by PR1; no generic SaaS visual reset, responsive/PWA metadata, or idempotency behavior was added.
- Web state messages use assertive live regions for error/conflict and polite announcements for loading/pending/empty/ready; mobile mirrors this with native accessibility live-region behavior.
- PR3 manifest metadata is declared, but no installability success is claimed: real browser/PWA install evidence is unavailable and explicitly deferred.
- The full root `pnpm test` sweep was attempted and timed out at 120 seconds with pre-existing contract-count failures expecting `90` while the repository reports `98`; PR3 focused suites and build/typechecks are green.
- No Git remote is configured and the worktree contains unrelated uncommitted feature work, so no commit/push or branch rewrite was performed; the PR3 rollback boundary is file-scoped.
- PR4 web and mobile retries reuse the same user-intent idempotency key and payload; a changed payload creates a new intent rather than mutating the original.
- HTTP success without a valid server response body maps to error; accepted/replayed states require the server status field. Pending, conflict, and in-flight states never claim payment, settlement, fulfillment, or payout.
- Mobile encrypted-storage write failures return explicit error feedback and retain the in-memory operation for safe retry; no client-side storage failure is treated as acceptance.
- PR4 focused suites, compatibility tests, typechecks, builds, and local HTTP route harness pass. Prettier reports style warnings in eight touched files; this is advisory and does not block functional verification.

## PR5 TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 5.1 | `tests/foundation/tus-journeys-ui.test.mjs`, `apps/mobile/tests/unit/tus-journeys.test.ts` | Unit/contract + mobile unit | ✅ web 14/14; mobile 14/14 | ✅ 5 behavioral cases written before journey helpers | ✅ web 3/3; mobile 2/2 | ✅ internal/external return paths, authorized/denied scope, current/stale reports, product/service, customer role | ✅ assertions use observable links, labels, and policy copy |
| 5.2 | Same focused files | Unit/contract + mobile unit | ✅ PR5 RED suites | ✅ missing journey helpers and surface wiring were covered first | ✅ web 3/3; mobile 2/2; web/mobile typechecks pass | ✅ dashboard filters and deep links use a separate path from operations/POS role navigation | ✅ scope decisions centralized in pure helpers; prior server-truth paths preserved |
| 5.3 | Same focused files | Unit/contract + mobile unit | ✅ web 3/3; mobile 2/2 | ✅ refactor expectations retained from PR5 cases | ✅ web 3/3; mobile 2/2 | ✅ landing, dashboard, operations, and mobile POS retain distinct product/service and pending/stale states | ✅ one intentional reveal, responsive wayfinding, and role copy consolidated |

## PR5 Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/foundation/tus-journeys-ui.test.mjs` → **3 passed, 0 failed**; `pnpm exec jest tests/unit/tus-journeys.test.ts tests/unit/tus-pos.test.ts tests/unit/tus-accessibility.test.tsx --runInBand` from `apps/mobile` → **3 suites, 16 tests passed, 0 failed**. |
| Typechecks/builds | `pnpm --filter @factory/web exec tsc --noEmit` → **passed**; `pnpm --filter @factory/mobile typecheck` → **passed**; `pnpm --filter @factory/web build` → **passed**, 12 routes generated. |
| Runtime harness | `pnpm --filter @factory/web start -p 3115` plus `Invoke-WebRequest` → **/, /tus, /tus/operations, /tus/pos, /manifest.webmanifest all returned HTTP 200; journey copy present on four HTML routes**. Render harness in `tus-journeys-ui.test.mjs` → **3 passed**, including homepage links. Browser viewport, keyboard, screen-reader, PWA install, and physical-device evidence remain deferred. |
| Rollback boundary | Revert only PR5 hunks in `apps/web/src/app/page.tsx`, `apps/web/src/app/tus/tus-dashboard.tsx`, `apps/web/src/app/tus/tus-operations.tsx`, `apps/web/src/app/tus/tus-pos.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/lib/tus-journeys.ts`, `apps/mobile/app/(app)/index.tsx`, `apps/mobile/app/(app)/pos.tsx`, `apps/mobile/src/presentation/journeys/tus-journeys.ts`, and the two PR5 journey test files; preserve PR1–PR4 auth, shared states, responsive foundations, idempotency, queues, backend contracts, tenant scope, finance, audit, and ledger behavior. |

## PR5 Notes and Risks

- Operations and POS destinations are visibly scope-aware; unauthorized staff links are disabled/non-disclosing rather than rendered as tenant data.
- Discovery filter state is reflected in the URL; checkout and POS continue to reuse existing stable intent identities and server acknowledgement parsing.
- No backend, provider, payment, settlement, fulfillment, support, or WhatsApp success claim was added. Support remains a governed handoff boundary.
- The current worktree still contains substantial unrelated feature-branch changes and no configured Git remote; no commit, push, branch rewrite, review lifecycle, verify, or archive was performed.
