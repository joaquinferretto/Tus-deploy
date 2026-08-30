# Proposal: TUS UI/UX Improvement

## Intent

Turn TUS web/mobile shells into an Argentina-first experience. Start with truthful session recovery, then improve status communication, accessibility, responsiveness, and journey polish without changing backend authority or inventing outcomes.

## Scope

### In Scope
- **Slice 1:** web/mobile session entry, secure restoration, expiry recovery, and an approved-auth handoff; no dead-end placeholder or client-supplied tenant authority.
- Shared loading, error, empty, pending, conflict, disabled, and live-region states; no-success-inference copy and idempotency-aware checkout/POS retry UX.
- Accessibility foundations: semantic controls, skip link, `:focus-visible`, labels/form metadata, keyboard/screen-reader semantics, and reduced motion.
- Responsive layouts, Argentina-first document metadata, PWA icons/theme metadata, and touch-safe interactions.
- Later chained slices: customer, merchant, operations, and POS polish; visual-system consistency; browser/device evidence.

### Out of Scope
- Backend/domain/contract redesign, authority changes, provider activation, payment, settlement, payout, fulfillment, or support-success claims.
- Browser/device evidence before execution and recording; deterministic tests remain clearly labeled.

## Capabilities

### New Capabilities
- `tus-session-entry-recovery`: web/mobile authentication boundary, restoration, expiry, and recovery handoff.
- `tus-ui-state-accessibility`: shared state, announcements, focus, forms, and reduced-motion foundations.
- `tus-responsive-pwa-experience`: responsive behavior, metadata, installability, and touch foundations.
- `tus-journey-surface-polish`: chained journey and visual-system improvements with evidence boundaries.

### Modified Capabilities
- None. `openspec/specs/` contains no authoritative existing capability specifications; prior TUS artifacts are design inputs.

## Approach

Incrementally harden existing surfaces using `tus-ui-contract`, typed clients, secure mobile credentials, and server-derived sessions. Add marketplace idempotency keys; local UI never converts pending, deferred, conflict, or unavailable evidence into success. Deliver later slices as rollbackable chained work units.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/web/src/app/`, `apps/web/src/lib/` | Modified | Entry, TUS surfaces, state primitives, client idempotency, metadata, and responsive/a11y styling. |
| `apps/mobile/app/`, `apps/mobile/src/` | Modified | Auth handoff, protected home, POS recovery, queue/conflict feedback, and accessibility. |
| `tests/foundation/`, `apps/mobile/tests/` | Modified | Component/contract, failure, retry, and accessibility coverage; no unavailable runtime claims. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| UX implies unsupported success | High | Render server acknowledgement, explicit pending/conflict/error copy, and idempotent retries. |
| Accessibility/layout regression | Medium | Semantic tests, responsive checks, and later browser/device evidence. |

## Rollback Plan

Revert only the active UI/client/test slice and disable its presentation paths; preserve commitments, audit, ledger, evidence, queues, and contracts.

## Dependencies

- Existing contracts and session/credential boundaries; approved auth handoff; browser/device environments for later evidence.

## Success Criteria

- [ ] Web/mobile recovery handles unauthenticated, expired, malformed, pending, conflicted, and failed sessions without client authority.
- [ ] Checkout/POS retries expose idempotency and never claim success without server acknowledgement.
- [ ] Shared states, accessibility, responsive/PWA metadata, and focused tests are implemented; unavailable browser/device evidence stays deferred.
