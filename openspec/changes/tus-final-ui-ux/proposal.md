# Proposal: TUS Final UI/UX Completion

## Intent

Close the audited web/mobile gaps without reopening backend design. Make scoped data, POS capture, recovery, support, transport, and offline states usable and truthful while preserving server authority, tenant isolation, finance semantics, stable idempotency, and no-success-inference.

## Scope

### In Scope
- Independently load permission-scoped dashboard/operations resources; render authorized partial views with per-resource retry and generic error recovery.
- Capture a real mobile POS amount/item through the existing manual-operation contract; handle pending, retry, conflict, transport/storage failure, and touch targets.
- Polish recovery accessibility and web interactions: landmarks, skip navigation, focus/pressed/hover states, headings, and responsive controls.
- Align one canonical `en-AR` locale/ARS formatting, API URL trailing-slash normalization, support/WhatsApp handoff, and robots/sitemap exposure with existing routes.
- State PWA installability separately from offline capability; advertise offline behavior only when implemented and verified.
- Add focused deterministic contract/component/unit coverage.

### Out of Scope
- Backend, database, API authorization/routes, idempotency, payment, settlement, payout, fulfillment, or finance-contract changes.
- New auth providers, localization expansion, service-worker/offline-sync implementation, provider activation, deployment, or compliance/legal work.
- Browser, device, screen-reader, POS-pilot, PostgreSQL, provider, cloud, or production evidence when unavailable; deterministic checks are not that evidence.

## Capabilities

### New Capabilities
- `tus-permission-aware-surface-loading`: scoped partial loading, retry, and failure recovery.
- `tus-mobile-pos-amount-capture`: validated amount/item entry on the existing contract.
- `tus-mobile-operation-recovery`: truthful pending, retry, conflict, transport, and storage UX.
- `tus-web-recovery-interaction-polish`: accessible recovery and web interaction refinement.
- `tus-locale-support-seo-transport`: locale, support, SEO metadata, and normalized transport.
- `tus-truthful-offline-pwa`: explicit installability/offline capability boundaries.

### Modified Capabilities
- None. `openspec/specs/` has no authoritative existing capability specifications.

## Approach

Apply targeted fixes in audit order. Reuse `tus-ui-contract`, server-derived permissions, existing support/SEO routes, and stable intent keys. Optional fetches remain scope-checked; partial, pending, replay, conflict, timeout, and offline states never become success.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/web/src/app/{page.tsx,layout.tsx,globals.css,(auth)/recovery/,tus/}` | Modified | Recovery, loading/retry, POS feedback, metadata, semantics, and polish. |
| `apps/web/src/lib/{tus-client.ts,tus-journeys.ts}` | Modified | URL, support, and permission-aware client composition. |
| `apps/mobile/app/(app)/pos.tsx`, `apps/mobile/src/{application,core,presentation,store}/` | Modified | Amount, recovery, profile, and touch behavior. |
| `tests/foundation/`, `apps/mobile/tests/unit/` | Modified | Deterministic regression coverage. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Partial loading exposes unauthorized data | High | Preserve server-derived scope checks and denied/partial tests. |
| POS retry implies success or duplicates an intent | High | Reuse contract/idempotency keys; show only server acknowledgement. |
| PWA, locale, or support claims mislead | Medium | Separate installability from offline proof and align route contracts. |

## Rollback Plan

Revert or disable only this frontend/client/test slice. Preserve contracts, commitments, finance/audit data, credentials, queues, and idempotency records.

## Dependencies

- Existing TUS API contracts/routes, `tus-ui-contract`, server-derived session/permissions, and current test harnesses. Browser/device and production environments remain deferred evidence prerequisites.

## Success Criteria

- [ ] Authorized users get scoped partial views; failed resources have independent retry without false whole-surface failure.
- [ ] Mobile POS captures/validates a real amount/item and all retry/conflict/offline paths remain truthful and idempotent.
- [ ] Accessibility, interaction, locale, SEO, support, and API URL checks pass deterministically.
- [ ] Offline/PWA copy makes no unverified claim; unavailable browser/device/production evidence is recorded as deferred.
