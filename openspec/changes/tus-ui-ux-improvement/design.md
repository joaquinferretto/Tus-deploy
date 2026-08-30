# Design: TUS UI/UX Improvement

## Technical Approach

Use incremental surface hardening, not a backend rewrite. Add presentation-only TUS state types and platform adapters around `/auth/*` and `/tus/*` contracts. Sign-in creates no UI session until `/auth/session` returns server-derived tenant/actor scope. Expiry, malformed credentials, 401, storage failure, and unavailable handoff get actionable states.

The visual direction is **Editorial field-notes / Argentine wayfinding**: paper, moss, clay, ink; characterful serif plus accessible sans; asymmetric composition, grain, strong hierarchy, and one deliberate reveal. No generic SaaS cards, blue gradients, system-font design, or distracting motion.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Session authority | Exchange sign-in token through `/auth/session`; never accept tenant/actor/role input as authority. | Client tenant form | Matches `DurableIdentitySessionResolver` and prevents spoofed scope. |
| Shared state | Pure types in `packages/contracts/src/tus-ui.ts`; native web/mobile renderers. | Per-screen strings | One vocabulary without coupling Next/Expo or changing API authority. |
| Retry semantics | Stable idempotency key per intent; distinct replay/in-progress/conflict and POS pending states. | New key per retry | Preserves replay safety and uncertainty truth. |
| Navigation | Use real links and deep-linkable `surface`/filter/return query state. | Local-only tabs | Preserves reload, share, and back behavior. |

## Data Flow

```text
Auth form / approved handoff
  → /auth/sign-in or approved callback
  → token adapter → /auth/session (server scope)
  → web sessionStorage / mobile SecureCredentialStore + encrypted MMKV
  → TusSessionState → guarded route shell

TUS command → stable idempotency key + server-derived context
  → typed transport → server response
  → state mapper (accepted | pending | conflict | error)
  → live region + focus target + retry/review action
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/contracts/src/tus-ui.ts`, `packages/contracts/src/index.ts` | Create/modify | Shared status/session/feedback types; no API authority change. |
| `apps/web/src/lib/{tus-auth-client,tus-ui-contract}.ts` | Create/modify | Session exchange, expiry mapping, intent keys, copy. |
| `apps/web/src/app/{(auth)/sign-in,(auth)/recovery}/page.tsx`, `app/page.tsx` | Create/modify | Entry, recovery, internal return, landing. |
| `apps/web/src/app/tus/{tus-dashboard,tus-operations,tus-pos,tus-ui}.tsx` | Modify | URL navigation, recovery, conflict review, forms, shared states. |
| `apps/web/src/app/{layout.tsx,globals.css,manifest.ts}` | Modify | `es-AR`, icons/theme, focus/motion/touch/safe-area/responsive system. |
| `apps/mobile/app/{_layout.tsx,(auth)/login.tsx,(app)/index.tsx,(app)/pos.tsx}` | Modify | Secure restoration, reauth, home, queue recovery, accessible controls. |
| `apps/mobile/src/{application/tus-client.ts,store/app-store.ts,presentation/components/*}` | Modify | Expiry/queue state and native primitives. |
| `tests/foundation/{p9-ui-contract,tus-ui-ux-improvement}.test.mjs`, `apps/mobile/tests/unit/*` | Create/modify | RED-first state, render, retry, accessibility coverage. |

## Interfaces / Contracts

```ts
const TUS_UI_STATUS = { LOADING: 'loading', READY: 'ready', EMPTY: 'empty', PENDING: 'pending', CONFLICT: 'conflict', DISABLED: 'disabled', ERROR: 'error', REAUTH: 'reauth' } as const
interface TusSessionState { status: 'restoring' | 'authenticated' | 'unauthenticated' | 'expired' | 'unavailable'; returnTo?: string; session?: TusWebSession }
interface TusIntentFeedback { status: 'accepted' | 'replayed' | 'pending' | 'conflict' | 'error'; intentId: string; message: string; evidence: string; retryable: boolean }
```

Use `Intl` for dates/currency (`es-AR`). Require named/autocompleted inputs, correct type/inputmode, inline errors, first-error focus, semantic headings, skip link, `:focus-visible`, live regions, keyboard alternatives, 44px targets, touch/safe-area rules, reduced motion, safe truncation, and no `transition: all`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit/contract | Session/401/expiry/storage, idempotency reuse, replay/conflict/pending/error, spoof rejection | Node harness and mobile Jest; RED first. |
| Component/render | Semantics, labels, focus, live regions, retry, URL state, no-success inference | Static React render and Testing Library where configured. |
| Browser/device | Auth recovery, responsive viewports, keyboard/screen reader, reduced motion, safe areas, offline POS | Later Playwright/Expo runs; label `browser-device`, never deterministic proof. |

## Threat Matrix

Routing/deep links are applicable; no shell, subprocess, VCS, or PR automation is introduced.

| Boundary | Applicability | Safe/failure behavior | Planned RED tests |
|---|---|---|---|
| Route/deep link | Applicable | Preserve only a validated internal return path; invalid path falls back to `/tus`; guarded routes render no tenant data. | External return URL rejected; expiry returns to sign-in. |
| Documentation-like paths | N/A — no executable path classification | No execution boundary changes. | None. |
| Git repository selection | N/A — no Git automation | No repository selection. | None. |
| Commit state | N/A — no commit automation | No index/worktree behavior. | None. |
| Push state | N/A — no push automation | No remote/ref behavior. | None. |
| PR commands | N/A — no PR automation | No command composition. | None. |

## Migration / Rollout

No data migration. Ship behind route/surface flags: dev, staging, then one customer/merchant/POS cohort. Roll back the active presentation slice without clearing commitments, audit/ledger, credentials, encrypted queues, or idempotency records. Browser/device evidence stays deferred until runners/devices and recorded environments exist.

## Open Questions

- [ ] Confirm the approved production identity handoff/redirect configuration before enabling provider-specific login; credential auth uses existing API endpoints meanwhile.
- [ ] Provide browser and physical-device runners for the deferred evidence class.
