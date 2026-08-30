# Tasks: TUS UI/UX Improvement

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,500–2,500 across 5 UI slices |
| Configured review budget | 99999; conservative 400-line guard is High |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 |
| Delivery strategy | automatic, force-chained |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal / base | Focused command | Runtime/evidence boundary | Rollback boundary |
|---|---|---|---|---|
| 1 | Session / feature branch | `pnpm test -- tests/foundation/tus-ui-ux-improvement.test.mjs apps/mobile/tests/unit/tus-auth.test.ts` | Mock auth only; browser/device deferred | Auth/session paths |
| 2 | States/a11y / PR 1 | `pnpm test -- tests/foundation/p9-ui-contract.test.mjs apps/mobile/tests/unit/tus-accessibility.test.ts` | Component only; SR/keyboard deferred | State primitives/tests |
| 3 | Responsive/PWA / PR 2 | `pnpm test -- tests/foundation/tus-responsive-pwa.test.mjs apps/mobile/tests/unit/tus-responsive.test.ts` | Static only; viewport/device deferred | Metadata/CSS/layout |
| 4 | Idempotency / PR 3 | `pnpm test -- tests/foundation/tus-idempotency-ui.test.mjs apps/mobile/tests/unit/tus-pos.test.ts` | Local transport; backend unchanged | Client retry/UI paths |
| 5 | Journey polish / PR 4 | `pnpm test -- tests/foundation/tus-journeys-ui.test.mjs apps/mobile/tests/unit/tus-journeys.test.ts` | Render only; cohort deferred | Journey presentation |

Every task inherits its unit’s command, evidence boundary, and rollback boundary; each unit runs `pnpm test` after its focused RED → GREEN → REFACTOR cycle.

## Phase 1: Session Entry and Recovery

- [x] 1.1 RED: add tests at `tests/foundation/tus-ui-ux-improvement.test.mjs` and `apps/mobile/tests/unit/tus-auth.test.ts` for server scope, missing/expired/malformed/401/storage failure, external `returnTo` rejection, expiry → sign-in.
- [x] 1.2 GREEN: implement `packages/contracts/src/tus-ui.ts`, `apps/web/src/lib/tus-auth-client.ts`, web `(auth)/sign-in`/`recovery`, mobile `_layout.tsx`, `(auth)/login.tsx`, `(app)/index.tsx`.
- [x] 1.3 REFACTOR: simplify auth adapters/copy in those paths; preserve secrets/tenant authority and label deterministic evidence.

## Phase 2: Shared States and Accessibility

- [x] 2.1 RED: extend `tests/foundation/p9-ui-contract.test.mjs` and `apps/mobile/tests/unit/tus-accessibility.test.ts` for taxonomy, live regions, labels, focus, keyboard, motion, no-success inference.
- [x] 2.2 GREEN: implement `apps/web/src/lib/tus-ui-contract.ts`, `apps/web/src/app/tus/tus-ui.tsx`, dashboard/operations/POS wiring, and `apps/mobile/src/presentation/components/*` per Web Interface Guidelines.
- [x] 2.3 REFACTOR: consolidate semantics/copy in those paths; rerun focused `pnpm test` and classify as component/contract evidence.

## Phase 3: Responsive and PWA

- [x] 3.1 RED: add tests at `tests/foundation/tus-responsive-pwa.test.mjs` and `apps/mobile/tests/unit/tus-responsive.test.ts` for narrow/wide, 44px targets, safe areas, locale, metadata/icons.
- [x] 3.2 GREEN: update `apps/web/src/app/{layout.tsx,globals.css,manifest.ts}` and mobile `_layout.tsx` styles with `es-AR`, `Intl`, focus, motion, touch, and editorial field-notes—not generic SaaS.
- [x] 3.3 REFACTOR: tune CSS tokens/transitions; rerun focused `pnpm test`, deferring real viewport/install/device evidence.

## Phase 4: Idempotency and Conflict UX

- [x] 4.1 RED: add tests at `tests/foundation/tus-idempotency-ui.test.mjs` and `apps/mobile/tests/unit/tus-pos.test.ts` for stable keys, replay/conflict/in-progress, timeout, offline, rejected transport/storage.
- [x] 4.2 GREEN: update `apps/web/src/lib/tus-client.ts`, `tus-dashboard.tsx`, `tus-pos.tsx`, mobile `src/application/tus-client.ts`, `src/store/app-store.ts`, `(app)/pos.tsx`; only explicit client idempotency contract.
- [x] 4.3 REFACTOR: fix retry/review focus and finance copy; rerun focused `pnpm test`, retaining local deterministic evidence only.

## Phase 5: Customer, Merchant, Operations, and POS Journey Polish

- [x] 5.1 RED: add tests at `tests/foundation/tus-journeys-ui.test.mjs` and `apps/mobile/tests/unit/tus-journeys.test.ts` for deep links, denied scope, stale refresh, product/service, role labels.
- [x] 5.2 GREEN: update web `page.tsx`, `tus/tus-dashboard.tsx`, `tus/tus-operations.tsx`, `tus/tus-pos.tsx`, mobile `(app)/index.tsx`/`pos.tsx`; preserve all evidence boundaries.
- [x] 5.3 REFACTOR: polish those journeys with hierarchy, asymmetry, texture, one deliberate reveal; rerun focused `pnpm test` and defer browser/device proof.
