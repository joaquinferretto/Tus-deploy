# Tasks: TUS Final UI/UX Completion

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 650–950 authored lines |
| Configured review budget | 99999 changed lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes (forced) |
| Suggested split | PR1 permissions → PR2 mobile POS/recovery → PR3 accessibility → PR4 locale/support/SEO → PR5 offline/PWA/journey polish |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Base boundary | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| PR1 | Scoped loading/retry | feature/tracker | `pnpm test -- tests/foundation/tus-partial-loading.test.mjs` | Next build/start; render `/tus*`; browser evidence deferred | loader + dashboard/operations + PR1 tests |
| PR2 | Mobile amount/recovery | PR1 branch | `pnpm --dir apps/mobile exec jest tests/unit/tus-pos.test.ts tests/unit/tus-accessibility.test.tsx --runInBand` | `APP_PROFILE=dev` Expo web export; device evidence deferred | mobile POS/client/state + PR2 tests |
| PR3 | Web semantics/interactions | PR2 branch | `pnpm test -- tests/foundation/tus-ui-ux-improvement.test.mjs tests/foundation/tus-responsive-pwa.test.mjs` | Next build/start; render recovery/POS; browser evidence deferred | web UI/CSS/recovery + PR3 tests |
| PR4 | Locale/support/SEO/transport | PR3 branch | `pnpm test -- tests/foundation/tus-journeys-ui.test.mjs tests/foundation/tus-idempotency-ui.test.mjs` | render `/`, `/robots.txt`, `/sitemap.xml`; crawler/browser evidence deferred | client/journeys/metadata/SEO + PR4 tests |
| PR5 | Truthful offline and final polish | PR4 branch | `pnpm test -- tests/foundation/tus-responsive-pwa.test.mjs`; mobile POS Jest above | render all web routes and Expo export; PWA/device evidence deferred | manifest/offline copy/final journey hunks + PR5 tests |

Every task below is strict TDD: RED test first → GREEN implementation → REFACTOR without behavior drift. Use local render/runtime evidence only; defer browser, keyboard/screen-reader, PWA-install, and physical-device evidence. Never infer success from HTTP 2xx, pending/offline/timeout/storage/conflict; unchanged retries reuse the same payload/key, edits create a new intent, and only server `accepted`/`replayed` acknowledge.

## Phase 1: Permission-aware surface loading

- [x] 1.1 RED→GREEN→REFACTOR: add mixed-permission, timeout, isolated-retry, and 401-withholding cases in `tests/foundation/tus-partial-loading.test.mjs`; implement `apps/web/src/lib/tus-resource-loader.ts`; refactor shared state in `apps/web/src/lib/tus-ui-contract.ts`.
- [x] 1.2 RED→GREEN→REFACTOR: cover settled siblings, disabled/empty/error states in the same test; wire `apps/web/src/app/tus/tus-dashboard.tsx` and `tus-operations.tsx`; preserve tenant/permission gates.

## Phase 2: Mobile POS amount and recovery

- [x] 2.1 RED→GREEN→REFACTOR: test blank/zero/negative/non-finite amounts and context identity in `apps/mobile/tests/unit/tus-pos.test.ts`; implement labeled capture in `apps/mobile/app/(app)/pos.tsx`.
- [x] 2.2 RED→GREEN→REFACTOR: test rejected retry, offline conflict, storage failure, quarantine, and no-success feedback in `tus-pos.test.ts`/`tus-accessibility.test.tsx`; update `apps/mobile/src/application/tus-client.ts`, `TusStateView.tsx`, `TusAccessibleButton.tsx`, and `app-store.ts`.

## Phase 3: Accessibility and web interaction

- [x] 3.1 RED→GREEN→REFACTOR: assert landmarks, skip link, heading hierarchy, focus states, wrapping, and reduced motion in `tests/foundation/tus-ui-ux-improvement.test.mjs` and `tus-responsive-pwa.test.mjs`; update `apps/web/src/app/tus/tus-ui.tsx`, `page.tsx`, and `(auth)/recovery/page.tsx`.
- [x] 3.2 RED→GREEN→REFACTOR: cover pointer/pressed/disabled/loading and narrow POS/recovery rendering; polish `apps/web/src/app/globals.css`, `tus-dashboard.tsx`, `tus-operations.tsx`, and `tus-pos.tsx` using Web Interface Guidelines and editorial anti-slop constraints.

## Phase 4: Locale, SEO, support, and transport

- [x] 4.1 RED→GREEN→REFACTOR: test `en-AR`, ARS/foreign-currency preservation, slash joining, headers/body/idempotency, handoff, robots, and sitemap in `tests/foundation/tus-journeys-ui.test.mjs`, `tus-idempotency-ui.test.mjs`, and `tus-responsive-pwa.test.mjs`.
- [x] 4.2 RED→GREEN→REFACTOR: implement `apps/web/src/lib/tus-client.ts`, `tus-journeys.ts`, `tus-ui-contract.ts`, `layout.tsx`, `manifest.ts`, `app/robots.ts`, and `app/sitemap.ts`; wire governed support without payment inference.

## Phase 5: Truthful offline/PWA and final journey polish

- [x] 5.1 RED→GREEN→REFACTOR: test manifest-without-service-worker claims and mobile reconnect identity in `tus-responsive-pwa.test.mjs` and `apps/mobile/tests/unit/tus-pos.test.ts`; update `apps/web/src/app/manifest.ts` and `apps/mobile/src/application/tus-client.ts`.
- [x] 5.2 RED→GREEN→REFACTOR: test final landing/deep-link/support states in `tus-journeys-ui.test.mjs`; polish `apps/web/src/app/page.tsx`, `apps/web/src/app/tus/{tus-ui.tsx,tus-dashboard.tsx,tus-operations.tsx,tus-pos.tsx}`, and `apps/mobile/app/(app)/pos.tsx`; preserve rollback boundaries.

Threat matrix: all design rows are explicitly `N/A`; no additional threat RED tests are required.
