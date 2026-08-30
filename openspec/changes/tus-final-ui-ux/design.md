# Design: TUS Final UI/UX Completion

## Technical Approach

Targeted frontend remediation over the existing Next.js 15/React 19 web and Expo mobile layers. Preserve server-derived identity, TUS parsers, ARS/finance meaning, queue semantics, and stable intent keys. Add typed partial-resource loading and shared recovery presentation; do not change API, database, authorization, payment, or service-worker behavior.

## Spec Reconciliation

| Spec | Concrete implementation mapping |
|---|---|
| `tus-permission-aware-surface-loading` | `apps/web/src/lib/tus-resource-loader.ts` gates each discovery, commitments, merchant, and report request from server session permissions; `tus-dashboard.tsx`/`tus-operations.tsx` render settled siblings, disabled/empty/error states, and one-resource retry. Add `tests/foundation/tus-partial-loading.test.mjs`. |
| `tus-mobile-pos-amount-capture` | `apps/mobile/app/(app)/pos.tsx` adds labeled decimal input and selected product/service context; finite `> 0` validation blocks operation/key creation. A changed draft creates a new identity; unchanged retry reuses payload/key. Extend `apps/mobile/tests/unit/tus-pos.test.ts`. |
| `tus-mobile-operation-recovery` | Reuse `apps/mobile/src/application/tus-client.ts` queue/quarantine/parser and update `pos.tsx` retry, conflict retry/discard, offline, and storage catches. `TusStateView.tsx` uses `TusAccessibleButton.tsx` for assertive, labeled recovery. Extend `tus-pos.test.ts` and `tus-accessibility.test.tsx`. |
| `tus-web-recovery-interaction-polish` | Update `tus-ui.tsx`, `tus-dashboard.tsx`, `tus-operations.tsx`, `page.tsx`, `globals.css`, and `(auth)/recovery/page.tsx` for landmarks, skip link, heading hierarchy, retry focus order, keyboard/pointer/touch states, reduced motion, and wrapping. Extend `tus-ui-ux-improvement.test.mjs`/responsive tests. |
| `tus-locale-support-seo-transport` | `layout.tsx`, `manifest.ts`, `tus-journeys.ts`, and `tus-ui-contract.ts` use canonical `en-AR`; server currency remains authoritative and only ARS is ARS-formatted. `tus-client.ts` joins URLs safely and serializes the existing nested WhatsApp handoff/consent contract. Create `app/robots.ts` and `app/sitemap.ts` for public routes only. |
| `tus-truthful-offline-pwa` | Keep mobile encrypted queue behavior in `application/tus-client.ts`; accepted/replayed alone clear pending. Web `manifest.ts` advertises installability, never offline operation; no service worker is added. Extend `tus-responsive-pwa.test.mjs` and mobile queue tests; browser/device evidence stays deferred. |

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Loading | Typed `Promise.allSettled` descriptors with permission predicates and cancellation | A timeout cannot erase authorized data; predicates are UI gates, while API authorization remains authoritative. |
| POS/recovery | Existing operation kind/context, numeric amount, queue, parser, and `tus:pos:*` key; explicit retry/refresh/resolve/discard | Prevents invented backend fields, duplicate intents, and false payment/settlement claims. |
| Visual direction | Existing editorial field-notes system: moss/paper/sage/clay, serif display type, grain, asymmetric cards; add visible `hover`, `active`, `focus-visible`, disabled, and loading states | Resolves audit defects without a generic dashboard rewrite. |

## Data Flow

```text
server session → permission gate → independent resource state → panel + retry
POS draft → stable operation/key → encrypted queue or POST → parsed result → feedback/store
```

401 clears local authority and offers approved reauthentication; 403, timeout, transport, malformed response, and storage failure remain non-success. Support requires permission, consent, confirmation, tenant-scoped headers, and server-returned handoff state. Foreign/missing currency and unacknowledged finance facts are never relabeled.

## File Changes

| Action | Paths |
|---|---|
| Create | `apps/web/src/lib/tus-resource-loader.ts`; `apps/web/src/app/robots.ts`; `apps/web/src/app/sitemap.ts`; `tests/foundation/tus-partial-loading.test.mjs` |
| Modify | `apps/web/src/app/tus/{tus-dashboard.tsx,tus-operations.tsx,tus-pos.tsx,tus-ui.tsx}`, `apps/web/src/lib/{tus-client.ts,tus-journeys.ts,tus-ui-contract.ts}`, `apps/web/src/app/{page.tsx,layout.tsx,manifest.ts,globals.css,(auth)/recovery/page.tsx}`, `apps/mobile/app/(app)/pos.tsx`, `apps/mobile/src/{application/tus-client.ts,presentation/components/{TusStateView.tsx,TusAccessibleButton.tsx},store/app-store.ts}`, relevant foundation/mobile tests |
| Delete | None |

## Interfaces / State and Accessibility Contracts

```ts
interface TusResourceState<T> {
  status: 'loading' | 'ready' | 'empty' | 'disabled' | 'error'
  data?: T; message: string; code?: string; retry: () => void
}
```

Every resource has a heading, stable status/live announcement, evidence, and reachable retry when recoverable. Recovery uses semantic landmarks, logical focus, inline field errors, keyboard operation, `:focus-visible`, no color/motion-only meaning, and 44px+ web/mobile targets. Long identifiers/messages wrap without horizontal scrolling; mobile uses the existing safe-area root and narrow-screen `ScrollView`.

## Testing Strategy

Use strict RED→GREEN tests with injected transports: permission matrix, mixed success/failure, retry isolation, 401 withholding, URL joining/header preservation, handoff payload, locale/ARS/foreign currency, amount validation, identity reuse, queue quarantine, offline reconnect, storage failure, and no-success inference. Extend `tus-journeys-ui.test.mjs`, `tus-idempotency-ui.test.mjs`, `tus-responsive-pwa.test.mjs`, `tus-ui-ux-improvement.test.mjs`, `apps/mobile/tests/unit/tus-pos.test.ts`, `tus-accessibility.test.tsx`, and `tus-responsive.test.ts`. Run `pnpm test`, `pnpm build`, and `pnpm lint`; no E2E runner exists.

## Threat Matrix

Only Next metadata routing changes; no shell, subprocess, VCS, PR, or executable-file boundary exists. Therefore documentation-like paths, Git repository selection, commit state, push state, and PR commands are all `N/A` with no RED tests required.

## Migration / Rollout

No migration or feature flag. Validate deterministic suites/build, then separately smoke web and mobile when real environments exist. Roll back only this frontend/client/test slice; preserve contracts, credentials, queued intents, finance/audit records, and idempotency records. Browser keyboard/screen-reader, responsive zoom, install/service-worker, iOS/Android touch/offline, authenticated database, provider, and production evidence remains deferred and must identify its route/device/result when later collected.

## Open Questions

- [ ] Confirm public sitemap base URL and support handoff destination; protected `/tus` routes remain excluded.
