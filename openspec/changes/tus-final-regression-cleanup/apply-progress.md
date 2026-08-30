# Apply Progress: TUS Final Regression Cleanup

## Work Unit

- **Change**: `tus-final-regression-cleanup`
- **Slice**: Work Unit 1 / PR1 — finance/UI contract reconciliation and local evidence refresh
- **Delivery**: `auto-chain`, `feature-branch-chain`; base/target boundary is the existing `feature/tus-final-regression-cleanup` feature line
- **Scope**: Tasks 1.1–3.3 only
- **Mode**: Strict TDD (`pnpm test`)
- **Evidence boundary**: provider-free deterministic tests, local static checks, and local plan/readiness output; PostgreSQL durability, provider, cloud, browser, screen-reader, device, POS pilot, legal, and production evidence remain deferred

## Cumulative Task Status

| Task | Status | Result |
|---|---|---|
| 1.1 | Complete | Added RED-first finance assertions for no-evidence release, including confirmation-present coverage, while retaining evidence-present/no-confirmation and freeze cases. |
| 1.2 | Complete | Finance reconciliation now evaluates completion/delivery evidence before confirmation, preserving freeze, tenant, release-window, ledger, and authorization behavior. |
| 1.3 | Complete | Consolidated finance fixtures and assertions with `assertHeld` helpers; no `ReleaseResult` or readiness contract changed. |
| 2.1 | Complete | Added RED-first UI source-contract assertions for explicit refresh button type/name/busy-disabled behavior and unresolved-session skip/main landmarks. |
| 2.2 | Complete | Added explicit refresh semantics, shared `type="button"` defaults, and a protected-data-free loading landmark shell for `/tus`. |
| 2.3 | Complete | Removed duplicated UI test markup/helpers while preserving keyboard activation, naming, focus, loading, disabled, and independent resource-state behavior. |
| 3.1 | Complete | Updated native/readiness evidence assertions to require the measured post-fix deterministic result. |
| 3.2 | Complete | Refreshed evidence using the measured `pnpm test` result and current static/readiness outcomes; activation remains disabled and external evidence deferred. |
| 3.3 | Complete | Re-read evidence and assertions for consistency; retained superseded history and every deferred boundary without adding live claims. |

## TDD Cycle Evidence

| Task | Test file | Layer | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 1.1 | `tests/foundation/p8-tus-finance.test.mjs`, `tests/foundation/p9-finance.test.mjs` | Unit/contract | ✅ Added the distinct evidence-before-confirmation expectations first; the old implementation returned the confirmation reason for the new confirmation-present/no-evidence case. | ✅ Finance suites: 15 tests passed, 0 failed. | ✅ Check-in-only, confirmation-present, evidence-present/no-confirmation, freeze, release-window, and append-only paths remain covered. | ✅ Shared `assertHeld` fixture helpers reduce duplication without changing result contracts. |
| 1.2 | Same finance suites | Unit/contract | ✅ RED assertions preceded the reconciliation change. | ✅ `pnpm test -- tests/foundation/p8-tus-finance.test.mjs tests/foundation/p9-finance.test.mjs`: 15 passed, 0 failed. | ✅ Existing tenant, freeze, release-window, ledger, and provider-disabled boundaries remain green. | ✅ Evidence/confirmation ordering is explicit and localized in `apps/api/src/tus/finance/index.ts`. |
| 1.3 | Same finance suites | Unit/contract | ✅ Refactor safety assertions retained. | ✅ 15 passed, 0 failed. | ✅ Both release-block reasons remain distinct. | ✅ Test helpers consolidated; no public finance types changed. |
| 2.1 | `tests/foundation/tus-ui-ux-improvement.test.mjs` | Source contract | ✅ Added assertions before the UI changes for button semantics and the unresolved-session landmark shell. | ✅ UI suite: 9 tests passed, 0 failed. | ✅ Refresh remains report-only and loading/disabled states remain truthful. | ✅ Removed temporary duplicated render/test helper logic. |
| 2.2 | Same UI suite | Source contract | ✅ Missing explicit button/landmark contracts were covered first. | ✅ 9 passed, 0 failed; web build passed. | ✅ Loading shell contains no protected session data and has one `#tus-main-content` landmark. | ✅ Shared button default is centralized in `tus-ui.tsx`. |
| 2.3 | Same UI suite | Source contract | ✅ Refactor expectations retained. | ✅ 9 passed, 0 failed. | ✅ Keyboard-safe action and accessible naming contracts remain present. | ✅ Assertions use observable source contracts rather than duplicated markup snapshots. |
| 3.1 | `tests/foundation/p0-native-boundaries.test.mjs`, `tests/foundation/p9-activation.test.mjs` | Evidence contract | ✅ Assertions were changed to the post-fix `498/0/0/88` result before refreshing the documents; they failed against stale `466/1/0/87` receipts. | ✅ Evidence suites passed after document refresh. | ✅ Historical `29/29` and old failure references remain only as superseded context; no stronger readiness claim was introduced. | ✅ Counts and exit codes are consistent between tests and both evidence documents. |
| 3.2 | Focused change suites and full repository runner | Integration/contract | ✅ Evidence assertions initially exposed stale receipts. | ✅ Focused change command: 5 suites, 40 passed, 0 failed. Full `pnpm test`: 88 suites, 498 passed, 0 failed, 0 skipped, exit 0. | ✅ `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-tus-runtime-readiness.test.mjs`: 2 suites, 17 passed, 0 failed. | ✅ Evidence refreshed only with measured local results and current date/revision. |
| 3.3 | Evidence/test assertions | Contract/documentation | ✅ Stale-count checks failed before refresh. | ✅ p0/p9 evidence assertions pass in the focused suite. | ✅ `liveConformance: false`, `not-production-ready`, disabled switches, and deferred external boundaries remain asserted. | ✅ No provider, cloud, database, browser, device, legal, or production claim was added. |

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/foundation/p8-tus-finance.test.mjs tests/foundation/p9-finance.test.mjs tests/foundation/tus-ui-ux-improvement.test.mjs tests/foundation/p0-native-boundaries.test.mjs tests/foundation/p9-activation.test.mjs` → **exit 0; 5 isolated suites, 40 passed, 0 failed, 0 skipped**. |
| Full deterministic suite | `pnpm test` → **exit 0; 88 isolated suites, 498 passed, 0 failed, 0 skipped**. |
| Runtime harness | **N/A** for this work unit: the assigned boundary is provider-free Node/source-contract verification; no external runtime, PostgreSQL, browser, device, provider, or production boundary is authorized or available. The local build and activation/readiness commands were run separately and remained provider-free. |
| Contracts/typecheck/build | `pnpm contracts:validate` → **exit 0; 98 JSON Schema contracts validated** with existing AJV ignored-format warnings. `pnpm typecheck` → **exit 0; 8 Turbo tasks successful**. `pnpm build` → **exit 0; 4 Turbo tasks successful** with existing lint warnings. |
| Security/policy/plans | `pnpm security:scan` → **exit 0**. `node scripts/security/validate-policy.mjs` → **exit 0**. Cloud plan validation → **exit 0; Render/AWS valid, provisioned=false, cloudCalls=false, liveConformance=false**. |
| Deferred boundary | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` → **exit 0; 20 tests passed**, but PostgreSQL URLs were unavailable, so the authenticated durability boundary remains deferred. Render and AWS readiness both returned `not-production-ready`, `unavailable-deferred`, `liveConformance=false`, with gated switches disabled. |
| Rollback boundary | Revert only `apps/api/src/tus/finance/index.ts`, the two finance test files, `apps/web/src/app/tus/tus-operations.tsx`, `apps/web/src/app/tus/tus-dashboard.tsx`, `apps/web/src/app/tus/tus-ui.tsx`, `tests/foundation/tus-ui-ux-improvement.test.mjs`, `tests/foundation/p0-native-boundaries.test.mjs`, `tests/foundation/p9-activation.test.mjs`, `docs/evidence/native-smoke.md`, `docs/evidence/readiness/tus-matrix.md`, and this change's task/progress artifacts. Preserve activation gates, provider-disabled defaults, durable records, migrations, contracts, and unrelated dirty-tree work. |

## Notes and Risks

- `pnpm lint` currently exits 1 because `@factory/mobile` lints a generated `dist/_expo` bundle that is outside its configured TypeScript project; the run also reports 6 warnings. This is outside the assigned finance/UI behavior and is documented as a local static-analysis blocker.
- The root worktree contains substantial unrelated uncommitted changes and no commit/push was performed.
- Browser, screen-reader, physical-device/POS, PostgreSQL durability, provider, cloud runtime, legal, tax, KYC/KYB, and production operations evidence remain deferred. Activation stays fail-closed.
