# Tasks: TUS Final Regression Cleanup

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 100–220 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | One focused feature-branch slice |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: feature-branch-chain
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Reconcile finance/UI contracts and refresh only local evidence | PR #1, base = `feature/tus-final-regression-cleanup` | `pnpm test -- tests/foundation/p8-tus-finance.test.mjs tests/foundation/p9-finance.test.mjs tests/foundation/tus-ui-ux-improvement.test.mjs tests/foundation/p0-native-boundaries.test.mjs tests/foundation/p9-activation.test.mjs` | N/A: provider-free Node/tsx and static render contracts; no external evidence | Revert this slice’s finance/UI/test/evidence files; keep gates and defaults unchanged |

## Phase 1: Finance Contract (Strict TDD)

- [x] 1.1 **RED** — In `tests/foundation/p8-tus-finance.test.mjs`, assert check-in-only and no-evidence release is held with `completion_evidence_required`, including confirmation-present coverage; in `tests/foundation/p9-finance.test.mjs`, retain the evidence-present/no-confirmation `completion_confirmation_required` case and freeze invariants.
- [x] 1.2 **GREEN** — In `apps/api/src/tus/finance/index.ts`, evaluate completion/delivery evidence before confirmation so the two reasons are distinct; preserve `apps/api/src/tus/domain/settlement.ts` freeze, tenant, and release-window behavior.
- [x] 1.3 **REFACTOR** — Consolidate finance fixtures/assertions in the two finance suites without changing the existing `ReleaseResult`, readiness, append-only ledger, or authorization contracts.

## Phase 2: Operations and `/tus` UI (Strict TDD)

- [x] 2.1 **RED** — Extend `tests/foundation/tus-ui-ux-improvement.test.mjs` to fail for a stale-report refresh lacking explicit native-button type/name/busy-disabled behavior and for `TusDashboard`’s unresolved-session render lacking `TusSkipLink` plus exactly one `#tus-main-content` main landmark.
- [x] 2.2 **GREEN** — Update `apps/web/src/app/tus/tus-operations.tsx` and `apps/web/src/app/tus/tus-ui.tsx` only as needed for the shared typed button, report-only retry, truthful loading/disabled state; wrap the `session === undefined` branch in `apps/web/src/app/tus/tus-dashboard.tsx` with the loading landmark shell and no protected data.
- [x] 2.3 **REFACTOR** — Remove duplicated markup or assertions while preserving keyboard activation, accessible naming, visible focus, and independent resource states.

## Phase 3: Evidence Refresh and Verification (Strict TDD)

- [x] 3.1 **RED** — Update the affected document assertions in `tests/foundation/p0-native-boundaries.test.mjs` and `tests/foundation/p9-activation.test.mjs` to expect the post-fix deterministic result rather than the stale finance mismatch.
- [x] 3.2 **GREEN** — Run focused suites, then `pnpm test`; update only measured counts/findings and revision/date in `docs/evidence/readiness/tus-matrix.md` and `docs/evidence/native-smoke.md`, keeping `liveConformance: false`, activation disabled, and every external boundary deferred.
- [x] 3.3 **REFACTOR** — Re-read evidence text and assertions for consistency; remove no historical/deferred boundary and make no provider, cloud, database, browser, device, legal, or production claim.
