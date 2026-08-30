# Proposal: TUS Final Regression Cleanup

## Intent

Resolve only the deterministic regressions reported by the final product audit so the local TUS baseline reflects its canonical contracts without weakening finance freezes, authorization, or fail-closed activation.

## Scope

### In Scope
- Reconcile the finance reason contract: distinguish missing completion evidence from missing confirmation, align the canonical implementation/test semantics, and preserve held/frozen release behavior.
- Fix the operations surface’s actual accessible button interaction contract and ensure the unauthenticated `/tus` loading render exposes the `tus-main-content` main landmark.
- Add/update deterministic contract and render tests; refresh affected local evidence/counts only when required to describe these fixes.

### Out of Scope
- PostgreSQL, provider, cloud, browser, screen-reader, device, POS-pilot, legal/compliance, or production evidence.
- Activation, deployment, migrations, broad lint/tooling cleanup, or unrelated UI/UX and historical audit findings.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `tus-financial-operations`: make completion-evidence and completion-confirmation reasons canonical and testable while retaining confirmation-first release and absolute freezes.
- `tus-permission-aware-surface-loading`: preserve truthful resource states while making the operations action’s semantic interaction and initial `/tus` landmark behavior explicit.
- `tus-ui-state-accessibility`: require a named main landmark during `/tus` loading and a real keyboard/assistive-technology-safe operations button contract.

## Approach

Use the current source as authority: reconcile `apps/api/src/tus/finance/index.ts` and `apps/api/src/tus/domain/settlement.ts` with `tests/foundation/p8-tus-finance.test.mjs` and newer p9 expectations; adjust `apps/web/src/app/tus/tus-dashboard.tsx`, `tus-operations.tsx`, and shared `tus-ui.tsx` only as needed; extend `tests/foundation/tus-ui-ux-improvement.test.mjs` for source and initial-render landmark behavior. Update only directly affected local evidence references after focused/full deterministic tests pass. Keep readiness disabled and `liveConformance:false`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/tus/{finance,index.ts,domain/settlement.ts}` | Modified | Canonical reason semantics; no release-policy relaxation. |
| `apps/web/src/app/tus/{tus-dashboard.tsx,tus-operations.tsx,tus-ui.tsx}` | Modified | Accessible action and loading landmark. |
| `tests/foundation/{p8-tus-finance.test.mjs,tus-ui-ux-improvement.test.mjs}` | Modified | Regression and render-contract coverage. |
| `docs/evidence/{readiness/tus-matrix.md,native-smoke.md}` | Conditional | Refresh only affected deterministic counts/findings. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Reason rename masks a real release-policy change | Med | Assert held/frozen outcomes and preserve settlement rules. |
| Loading fix creates a false success or leaks protected data | Low | Test landmark-only loading output and retain fail-closed auth/resource states. |

## Rollback Plan

Revert the focused source, test, and directly affected evidence commits; activation remains disabled throughout.

## Dependencies

- Existing OpenSpec audit and local Node/pnpm test runner; no external service dependency.

## Success Criteria

- [ ] Focused finance and UI suites pass with canonical reason and accessible interaction/landmark assertions.
- [ ] `pnpm test` is green for the deterministic baseline, with no weakened freeze or authorization behavior.
- [ ] Any refreshed evidence remains local-deterministic and makes no external or production claim.
