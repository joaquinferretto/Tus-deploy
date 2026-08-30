# Design: TUS Final Regression Cleanup

## Technical Approach

Apply four bounded, provider-free corrections using the current source as authority. `settlement.ts` remains the canonical definition of missing completion evidence; `finance/index.ts` must check that evidence before the confirmation gate so the two held reasons are observable and distinct. Preserve confirmation-first release, absolute freezes, tenant authorization, disabled activation, and `liveConformance: false`. Keep the web button on the shared `TusActionButton` boundary, make its disabled/loading contract explicit, and wrap the `/tus` initial client-loading branch in the same skip-link/main landmark shell used by settled branches. Refresh only directly affected local evidence after tests pass.

## Architecture Decisions

| Decision | Options considered | Rationale |
|---|---|---|
| Canonical finance reason order | Rename `settlement.ts`; return confirmation first; evidence check then confirmation | `settlement.ts` already owns `completion_evidence_required`; checking evidence first distinguishes absent proof from absent customer confirmation without changing release policy. |
| Operations action boundary | Native one-off button; shared `TusActionButton` | Keep the existing shared semantic button, but pass explicit `type="button"` and a loading-derived `disabled` contract. This prevents duplicate styling/accessibility logic and blocks duplicate refresh requests. |
| Initial `/tus` markup | Change root layout; alter route entry; shell the dashboard loading branch | The defect is `TusDashboard` returning only `TusStateMessage` while `session === undefined`; changing the branch is the smallest route-local fix and does not affect global metadata or auth. |
| Evidence scope | Re-run or claim external readiness | Update only measured local-deterministic counts/findings. No provider, database, browser, device, cloud, legal, or production claim is introduced. |

## Data Flow

```text
release request
  └─ finance/index.ts: evidence → confirmation → settlement eligibility → held/released/frozen

/tus request → TusDashboard session restore
  ├─ undefined → skip link + tus-main-content loading shell
  ├─ null      → existing auth-required shell
  └─ session   → resource loader → shared action/state components
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/tus/finance/index.ts` | Modify | Return `completion_evidence_required` before checking confirmation; retain `completion_confirmation_required` when completion evidence exists and confirmation does not. Preserve all freeze/readiness paths and the existing `ReleaseResult` union. |
| `apps/web/src/app/tus/tus-operations.tsx` | Modify | Make the stale-report refresh action explicitly typed, disabled while its report request is loading, and still keyboard-activatable when stale data is available. |
| `apps/web/src/app/tus/tus-dashboard.tsx` | Modify | Render the initial `/tus` loading state inside `TusSkipLink` and `<main id="tus-main-content">`; render no protected data or success state. |
| `apps/web/src/app/tus/tus-ui.tsx` | Verify/modify only if needed | Keep the shared action as a native button with `type`, `disabled`, `aria-busy`, visible focus, and loading-label behavior; avoid unrelated component changes. |
| `tests/foundation/p8-tus-finance.test.mjs` | Modify | Align the check-in-only regression with missing-evidence semantics and cover the held outcome. |
| `tests/foundation/p9-finance.test.mjs` | Modify | Retain/add the complementary completion-evidence-without-confirmation assertion for `completion_confirmation_required` and freeze invariants. |
| `tests/foundation/tus-ui-ux-improvement.test.mjs` | Modify | Assert the operations action contract and server-rendered initial `/tus` landmark/skip link. |
| `docs/evidence/readiness/tus-matrix.md` | Conditional modify | Replace stale local suite counts/failure text with the measured post-fix result only. |
| `docs/evidence/native-smoke.md` | Conditional modify | Refresh the corresponding local-deterministic snapshot and preserve all deferred/external boundaries. |

## Interfaces / Contracts

No new public interface. The existing release contract remains:

```ts
type HeldReason =
  | 'completion_evidence_required'
  | 'completion_confirmation_required'
  | 'provider_confirmation_pending'
  | /* existing settlement-window reasons */ string
```

The UI action remains a native `button`, `type="button"`, with `disabled` derived from request loading; stale data never enables settlement or completion claims.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit/contract | Evidence versus confirmation reason ordering; approved aging still held; absolute freeze remains frozen | Extend p8/p9 TypeScript scenarios through the existing Node/tsx runner. |
| Render/contract | `/tus` initial SSR markup has skip link and `tus-main-content`; operations refresh is a real typed shared-button action and duplicate-safe | Extend `tus-ui-ux-improvement.test.mjs`; use React server rendering for the initial dashboard branch and source/contract assertions for the shared abstraction. |
| Deterministic baseline | Focused suites, then `pnpm test` | Record exact exit/count output as local-deterministic only. Do not run or cite external evidence. |

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A — no executable-file classification | None | None |
| Git repository selection | N/A — no VCS automation | None | None |
| Commit state | N/A — no commit automation | None | None |
| Push state | N/A — no push automation | None | None |
| PR commands | N/A — no PR automation | None | None |

Routing is affected only through rendered `/tus` markup; no shell, subprocess, VCS, or process boundary is introduced.

## Migration / Rollout

No migration required. Roll back the focused source, test, and evidence changes as one reviewable unit; readiness gates, provider-disabled defaults, durable records, and activation behavior remain unchanged.

## Open Questions

None.
