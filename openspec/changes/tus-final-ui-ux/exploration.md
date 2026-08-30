## Exploration: TUS final UI/UX audit

### Current State
The current TUS web and mobile surfaces have a coherent editorial visual direction, explicit loading/error/pending/conflict vocabulary, tenant-scoped session messaging, responsive CSS, PWA metadata, and deterministic tests. The focused mobile Jest run passed 7 suites and 49 tests. Local HTTP checks returned 200 for the main web surfaces and PWA assets, and Expo web export succeeds when an explicit `APP_PROFILE=dev` is supplied. No source files were modified during this audit.

The audit found several final-pass issues:

- The web landing page renders card headings as `h2`, while the primary editorial card-heading style targets only `h3`; the intended typographic treatment is therefore not applied (`apps/web/src/app/page.tsx:18-19`, `apps/web/src/app/globals.css:266-272`).
- The landing page has no visible hover treatment for card-footer links, and the primary action button has no hover/pressed treatment (`apps/web/src/app/globals.css:281-291`, `465-486`).
- Generic authenticated operations errors render `TusStateMessage` without a retry action; only unauthenticated and stale-report paths are actionable (`apps/web/src/app/tus/tus-operations.tsx:39-58`). The same pattern exists for generic dashboard loading failures.
- The recovery route lacks the skip-link and `id="tus-main-content"` landmark pattern used by the other web surfaces (`apps/web/src/app/(auth)/recovery/page.tsx:14-23`).
- `lang="es-AR"` conflicts with predominantly English visible copy and metadata (`apps/web/src/app/layout.tsx:9-12,35-39`). This is a language-contract issue, not merely a translation preference.
- Operations and dashboard surfaces fetch multiple permission-specific resources with `Promise.all`; the journey resolver permits narrower scopes than those combined fetches require, so a valid operations/reporting or read-only user can receive a whole-surface error instead of a scoped partial view (`apps/web/src/app/tus/tus-operations.tsx:32-50`, `apps/web/src/app/tus/tus-dashboard.tsx`, `apps/web/src/lib/tus-journeys.ts`).
- Mobile POS records a hard-coded amount of `1 ARS` and exposes no amount or item input, so the visible “record manual operation” action cannot represent an actual sale/service amount (`apps/mobile/app/(app)/pos.tsx:101-118`).
- Mobile POS retry and conflict-resolution handlers do not catch client rejection, so a failed retry can leave the user without updated error feedback (`apps/mobile/app/(app)/pos.tsx:134-156`).
- The mobile pending-sync `Pressable` has no explicit minimum touch target, unlike the shared accessible button (`apps/mobile/app/(app)/pos.tsx:197`, `apps/mobile/app/(app)/pos.tsx:268-271`, `apps/mobile/src/presentation/components/TusAccessibleButton.tsx:28-38`).
- The web transport concatenates `NEXT_PUBLIC_API_URL` and paths without normalizing a trailing slash (`apps/web/src/lib/tus-client.ts:398-415`).
- A manifest exists, but no web service-worker registration or service-worker asset was found; this is installable metadata, not proven offline PWA behavior.
- API support/WhatsApp and SEO endpoints exist, but the web UI does not provide a complete support/handoff action and the SEO endpoints are not surfaced as standard web `robots.txt`/sitemap metadata (`apps/api/src/tus/http/router.ts:710-839`, `apps/web/src/lib/tus-client.ts:382-395`).

Evidence remains bounded: browser/device/screen-reader, authenticated PostgreSQL durability, provider, cloud, POS-pilot, legal/tax/KYC/KYB, and production-operations evidence were not available. Root command output was partially truncated in the prior run, so its final aggregate status should not be claimed from this exploration alone.

### Affected Areas
- `apps/web/src/app/page.tsx` — landing-page card semantics and link interaction.
- `apps/web/src/app/globals.css` — typography, hover/pressed states, responsive card composition, metrics, and contrast tokens.
- `apps/web/src/app/(auth)/recovery/page.tsx` — recovery accessibility landmark and skip navigation.
- `apps/web/src/app/layout.tsx` — locale and metadata language contract.
- `apps/web/src/app/tus/tus-dashboard.tsx` — combined data loading and generic error recovery.
- `apps/web/src/app/tus/tus-operations.tsx` — permission-aware loading and retry behavior.
- `apps/web/src/app/tus/tus-pos.tsx` — initial validation/error UX and operation feedback.
- `apps/web/src/lib/tus-client.ts` — API base URL normalization and support handoff client boundary.
- `apps/mobile/app/(app)/pos.tsx` — amount capture, retry/error handling, and touch-target behavior.
- `apps/mobile/src/presentation/components/TusAccessibleButton.tsx` — shared mobile pressed/disabled feedback foundation.
- `apps/api/src/tus/http/router.ts` — existing reporting/support/SEO route contracts to reconcile with UI affordances.
- `openspec/changes/tus-final-ui-ux/exploration.md` — this audit artifact; no application source changes were made.

### Approaches
1. **Targeted final-pass remediation** — correct the concrete UI contract defects, add focused web/mobile tests, and preserve the existing architecture and truthful pending/error model.
   - Pros: smallest blast radius; directly addresses observed user-visible failures; keeps provider-free evidence boundaries intact.
   - Cons: requires careful permission-specific loading design and mobile POS contract decisions before implementation.
   - Effort: Medium

2. **Surface-layer rewrite** — replace dashboard/operations/POS presentation and data-loading composition with a new unified view-state layer.
   - Pros: could standardize partial loading and error recovery comprehensively.
   - Cons: high regression risk; duplicates existing contract helpers; unnecessary for the verified, mostly working foundation.
   - Effort: High

### Recommendation
Proceed with targeted remediation in this order: (1) fix the permission-aware/partial loading contract and actionable generic errors, (2) make mobile POS capture a real amount or explicitly rename/constrain the action to a fixed test operation, (3) harden retry/conflict failure feedback, (4) fix recovery accessibility and web typography/interaction states, (5) normalize the web API base URL, and (6) align locale/SEO/support affordances with the actual product scope. Add focused tests for each corrected path. Keep browser/device and external integration evidence explicitly deferred rather than inferring it from static export or HTTP 200 responses.

### Risks
- A partial-loading fix can accidentally expose data outside a user’s permission scope if fetches are made optional without server-derived authorization checks.
- Changing mobile POS amount semantics affects idempotency fixtures and the manual-operation contract; it needs an explicit product decision and test update.
- Declaring the site a full offline PWA without a service worker would overstate capability.
- Changing `lang` or translating copy without a localization plan can create a different contract mismatch; choose one canonical language for this change.
- The working tree contains extensive pre-existing user changes; implementation must not revert or overwrite them.
- Deterministic test/export success does not prove browser accessibility, physical-device layout, production database durability, provider behavior, or production readiness.

### Ready for Proposal
Yes — ready for a focused corrective proposal covering permission-aware view loading, actionable state recovery, mobile POS capture/retry UX, accessibility, and final visual polish. The proposal should explicitly exclude production-readiness claims and external evidence not available in this environment.
