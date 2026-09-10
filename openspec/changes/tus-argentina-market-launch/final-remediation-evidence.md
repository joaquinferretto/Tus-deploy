# Final P1 Remediation Evidence: TUS Argentina Market Launch

## status

`success` for the bounded deterministic P1 remediation slice. Launch remains
`NO-GO` with `liveConformance: false`.

## executive_summary

The three verified P1 defects were cleared without database, provider,
browser/device, Docker, cloud, deployment, migration, seed, or long-lived
service effects. Marketplace harness scenarios now serialize exact `bigint`
minor units as decimal strings and deserialize them without a floating-point
conversion. The Next page-data `TypeError: a[d] is not a function` no longer
reproduces: the affected generated routes were `_not-found`, `/auth/recovery`,
and `/tus/pos`, sharing the root layout/client module graph. The web config now
pins tracing to this repository; Windows uses the non-standalone local output
because pnpm symlink copying requires elevated link privileges, while Linux
production retains `output: 'standalone'`. The two corrected test fixtures pass
both explicit working-tree and temporarily indexed tracked scans.

## artifacts

- `tests/foundation/p9-marketplace.test.mjs`
- `tests/foundation/p1-remediation.test.mjs`
- `apps/web/next.config.js`
- `apps/mobile/tests/unit/tus-pos.test.ts` (corrected fixture content)
- `packages/mercado-pago/tests/mercado-pago.test.cjs` (corrected fixture content)
- `openspec/changes/tus-argentina-market-launch/apply-progress.md`
- `openspec/changes/tus-argentina-market-launch/go-live-evidence.md`
- `openspec/changes/tus-argentina-market-launch/final-remediation-evidence.md`

## tasks_completed

- [x] Marketplace bigint JSON boundary and safe test serialization.
- [x] Next route/module build failure isolation and workspace tracing contract.
- [x] Security fixture redaction and tracked-scan validation.
- [x] Launch evidence counter reconciliation without PostgreSQL proof promotion.

## TDD evidence

| Correction | RED | GREEN | REFACTOR |
|---|---|---|---|
| Marketplace exact-money JSON boundary | `p9-marketplace.test.mjs` failed 2/6 on `JSON.stringify` of `bigint`. | Pinned Node runner: 6/6 passed; `priceMinor` and commitment snapshot minors round-trip as decimal strings. | Replacer is test-boundary-only; internal money remains `bigint`, and no `Number(bigint)` conversion was added. |
| Next production build contract | Existing build failed during page-data collection in generated modules for `_not-found`, `/auth/recovery`, and `/tus/pos` with `TypeError: a[d] is not a function`. | Web build generated all 14 routes and root build passed after repository-root tracing and Windows-safe standalone handling. | Production Linux keeps standalone output; Windows-only pnpm symlink behavior is explicit rather than hidden. |
| Security fixtures | Tracked index scan rejected the two pre-redaction fixture files. | Tracked scan passed with only the two corrected files temporarily indexed; explicit working-tree scan also passed. | No scanner pattern was weakened and no secret value was printed. |

## tests

| Command | Result |
|---|---|
| `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p9-marketplace.test.mjs tests/foundation/p8-tus-marketplace.test.mjs tests/foundation/p1-remediation.test.mjs` | exit 0; 6 + 8 + 8 = 22 passed, 0 failed |
| `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd --filter @factory/web build` | exit 0; 14 routes generated; lint warnings only |
| `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd --filter @factory/web typecheck` | exit 0 |
| `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd build` | exit 0; 5 build tasks passed |
| `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd typecheck` | exit 0; 8/8 tasks passed |
| `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd --filter @factory/web lint` | exit 0; warnings only |
| `pnpm security:scan` with the two corrected fixture files temporarily indexed, then unstaged | exit 0; no findings |
| Explicit scanner paths for both corrected fixtures | exit 0; no findings |
| `git diff --check` | exit 0; only existing line-ending normalization warnings |

All commands were bounded to 180 seconds or less. The temporary index update
was limited to the two fixture paths and was fully reverted; no unrelated
changes were staged.

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | Pinned Node marketplace/P1/legacy marketplace command above; exit 0, 22/22 passed. |
| Runtime harness command/scenario | Deterministic in-process HTTP marketplace harnesses only; exit 0. No external runtime boundary exists for this remediation because database/provider/browser/device/deployment execution was prohibited. |
| Rollback boundary | Revert only `tests/foundation/p9-marketplace.test.mjs`, `tests/foundation/p1-remediation.test.mjs`, `apps/web/next.config.js`, the two corrected fixture files, this evidence, and the launch-evidence reconciliation. Preserve all unrelated working-tree changes and `Goldenrepo-js_py`. |

## database_effects

None. No connection, read, write, migration, DDL, seed, backup, restore,
rollback, or schema operation occurred. Fixture-only PostgreSQL evidence remains
scoped and does not prove launch readiness.

## provider_effects

None. No Mercado Pago, WhatsApp, delivery, billing, credential, webhook, or
other provider request occurred.

## risks

- Production readiness remains blocked by all eleven external capability rows.
- Windows standalone output is intentionally not produced locally because pnpm
  symlink copying requires elevated link privileges; Linux production retains
  the standalone contract and the web build is otherwise green.
- Existing web lint/deprecation warnings remain non-blocking maintenance items.

## next_recommended

`sdd-verify` against this final evidence, preserving `NO-GO` and
`liveConformance: false`; do not run database/provider/deployment evidence until
the separately authorized external gates are available.

## skill_resolution

`Strict TDD`: `sdd-apply`, `_shared`, `typescript`, `nextjs-15`, and
`work-unit-commits` were loaded. `.codegraph/` existed, but the upstream
CodeGraph CLI was unavailable, so bounded artifact/source inspection was used
after the availability check. No delegation or authorization pause occurred.

## cleanup_state

Complete. No long-lived process or external resource was started. Temporary
security staging was reverted, and no files outside the declared rollback
boundary were staged by this slice. Generated `.next` and TypeScript cache
artifacts are local tooling state.

## Phase 12 Deterministic Blocker Correction

### status

`success` for the bounded deterministic Phase 12 correction. Launch remains
`NO-GO` with `liveConformance: false`.

### executive_summary

The stale Phase 12 assertion was corrected to validate the existing
platform-conditioned Next configuration: Windows local builds omit standalone
output, while non-Windows production builds retain `output: 'standalone'`.
The Render contract now states this boundary explicitly without weakening the
Linux standalone entrypoint or suppressing TypeScript/ESLint build failures.
The corrected security fixtures are represented in the normal tracked index;
the standard security scan passes, and the scanner still rejects real secret
patterns without printing their values.

### artifacts

- `tests/foundation/p12-deployment-operations.test.mjs`
- `docs/deployment/render.md`
- `apps/mobile/tests/unit/tus-pos.test.ts`
- `packages/mercado-pago/tests/mercado-pago.test.cjs`
- `openspec/changes/tus-argentina-market-launch/apply-progress.md`
- `openspec/changes/tus-argentina-market-launch/final-remediation-evidence.md`

### TDD evidence

| Correction | RED | GREEN | REFACTOR |
|---|---|---|---|
| Platform-conditioned standalone contract | Baseline Phase 12 suite was 8/9 because the literal standalone regex rejected the existing Windows-safe config; the replacement remained red until the Render contract text was added | Pinned Phase 12 runner: 9/9 passed; web/API package smoke: 9/9 each | Assertions validate conditional behavior, Linux/Render standalone, Vercel wiring, and strict build-failure flags without matching a stale literal |
| Tracked security fixture state | Normal `pnpm security:scan` rejected the stale index content for the two corrected fixture paths | Normal tracked scan exit 0; `p0-security.test.mjs` 3/3 passed | Scanner patterns unchanged; synthetic `AKIA...` detection still fails closed and redacts the value |

### tests

| Command | Result |
|---|---|
| `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p12-deployment-operations.test.mjs` | exit 0; 9 passed, 0 failed |
| `pnpm.cmd --filter @factory/web test` and `pnpm.cmd --filter @factory/api test` | exit 0; 9 passed, 0 failed each |
| `pnpm.cmd security:scan` | exit 0; normal tracked-index scan, no findings |
| `node scripts/test-runner.mjs tests/foundation/p0-security.test.mjs` | exit 0; 3 passed, 0 failed; real secret-pattern regression preserved |
| `pnpm.cmd typecheck` | exit 0; 8/8 workspace tasks passed |
| `pnpm.cmd build` | exit 0; 5/5 build tasks passed, web generated 14 routes |
| `pnpm.cmd lint` | exit 0; 6/6 tasks passed, 0 errors, existing warnings only |

All commands were bounded to 180 seconds or less. No database, provider,
browser/device, Docker, cloud, deployment, migration, seed, backup, restore,
or long-lived service operation occurred.

### Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | Phase 12 suite exit 0 with 9/9; web/API package smoke exit 0 with 9/9 each. |
| Runtime harness command/scenario | N/A by explicit user boundary: this correction has no permitted external runtime boundary; bounded static contracts, tests, and local builds only. |
| Rollback boundary | Revert only the Phase 12 test assertion, Render contract paragraph, two corrected fixture files, and the corresponding apply/final-remediation evidence additions; preserve unrelated changes and `Goldenrepo-js_py`. |

### database_effects

None. No connection, read, write, migration, DDL, seed, backup, restore, or
schema operation occurred.

### provider_effects

None. No Mercado Pago, WhatsApp, delivery, billing, credential, webhook, or
other provider request occurred.

### risks

- Live deployment, database durability, provider, browser/device, Docker,
  backup/restore, DNS/TLS, legal, and production operations evidence remain
  external-blocked.
- Windows standalone output remains intentionally disabled locally because pnpm
  symlink copying requires elevated link privileges; Linux/Render retains the
  standalone contract.
- Existing lint/deprecation/style warnings remain non-blocking.

### next_recommended

`sdd-verify` against the updated correction evidence, preserving `NO-GO` and
`liveConformance: false`.

### skill_resolution

`Strict TDD`: requested `sdd-apply`, `_shared`, `typescript`, and `nextjs-15`
skills were loaded. `.codegraph/` existed, but the upstream CodeGraph CLI was
unavailable; bounded artifact/source inspection was used after the availability
check. No delegation or authorization pause occurred.

### cleanup_state

Complete. No runtime process or external resource was started. The two corrected
fixture files remain intentionally staged so the normal tracked scan evaluates
their current content; no unrelated files were staged. Generated `.next` and
TypeScript cache artifacts are local tooling state.

## Final Security/Environment Blocker Correction

### status

`success` for the bounded deterministic security/environment correction. Launch
remains `NO-GO` with `liveConformance: false`.

### executive_summary

The remaining security-policy mismatch was caused by a stale validator contract:
active consumers and Render declare canonical `MONGODB_URL`, while the validator
required `MONGODB_URI`. The validator now checks `MONGODB_URL`; the API resolver
keeps `MONGODB_URI` only as a proven compatibility fallback, production/Render
fails closed when neither key exists, and Mongo connection diagnostics do not
emit raw driver errors or connection strings.

### artifacts

- `scripts/security/validate-policy.mjs`
- `apps/api/src/infrastructure/database/mongodb/connection.ts`
- `apps/api/src/infrastructure/config/README.md`
- `tests/foundation/mongodb-environment-contract.test.mjs`
- `docs/runbooks/tus-environment-consumer-inventory.md`
- `docs/deployment/render.md`
- `docs/runbooks/tus-deployment.md`
- `docs/runbooks/tus-deployment-operations.md`
- `openspec/changes/tus-argentina-market-launch/tasks.md`
- `openspec/changes/tus-argentina-market-launch/apply-progress.md`

### tasks_completed

- [x] R1 canonical MongoDB security/environment contract and compatibility boundary.
- [x] Production/development resolver behavior and secret-safe diagnostics.
- [x] Focused regression, umbrella security, policy, typecheck, build, lint, and diff validation.

### TDD evidence

| Correction | RED | GREEN | REFACTOR |
|---|---|---|---|
| Canonical MongoDB resolver | `mongodb-environment-contract.test.mjs` could not import the missing resolver export. | Pinned Node runner: 3/3 passed. | Canonical precedence, trimmed values, compatibility fallback, and fail-closed production behavior are pure and secret-safe. |
| Security policy key | `p6-security.test.mjs` failed 1/4 because the validator required absent `MONGODB_URI`. | Pinned security umbrella: 10/10; standalone policy exit 0. | Only the canonical manifest key is required; the alias is not emitted by Render. |

### tests

| Command | Result |
|---|---|
| `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/mongodb-environment-contract.test.mjs tests/foundation/p6-security.test.mjs tests/foundation/p0-security.test.mjs` | exit 0; 10 passed, 0 failed |
| Pinned Node `scripts/security/validate-policy.mjs` | exit 0; no findings |
| Pinned `pnpm.cmd security:scan` with NVM Node directory on `PATH` | exit 0; no findings |
| Pinned `pnpm.cmd typecheck` | exit 0; 8/8 tasks passed |
| Pinned `pnpm.cmd build` | exit 0; 5/5 tasks passed and 14 web routes generated |
| Pinned `pnpm.cmd lint` | exit 0; 6/6 tasks passed, 0 errors, existing warnings only |
| `git diff --check` | exit 0; existing line-ending normalization warnings only |

All commands were bounded to 180 seconds or less. No secret value or connection
string was printed.

### Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | Mongo resolver, p6 security, and p0 security suites exit 0 with 10/10 passed. |
| Runtime harness command/scenario | N/A by explicit user boundary: no database/provider/API/browser/device/Docker/cloud/deployment runtime was started or contacted. |
| Rollback boundary | Revert only the validator, Mongo resolver/logging, focused test, API config README, four deployment/environment docs, and this final evidence/apply-progress addition; preserve unrelated work and `Goldenrepo-js_py`. |

### database_effects

None. No MongoDB or PostgreSQL connection, read, write, migration, DDL, seed,
backup, restore, rollback, or schema operation occurred.

### provider_effects

None. No provider request, credential, webhook, cloud, deployment, browser, or
device operation occurred.

### risks

- Launch remains externally blocked and `liveConformance=false`; deterministic
  policy/build evidence does not prove production MongoDB availability.
- `MONGODB_URI` remains intentionally supported by the API resolver until the
  active compatibility consumer is migrated and repository-wide removal evidence
  is recorded.
- Existing non-blocking lint/deprecation/style warnings remain unchanged.

### next_recommended

`sdd-verify` against this merged remediation evidence, then retain `NO-GO` and
`liveConformance: false` until separately authorized external gates are proven.

### skill_resolution

`Strict TDD`: exact `sdd-apply`, `_shared`, and `typescript` skill paths were
loaded. `.codegraph/` existed, but the upstream CodeGraph CLI was unavailable;
bounded fallback inspection followed the availability check. No delegation or
authorization pause occurred.

### cleanup_state

Complete. No long-lived process or external resource was started; no secret value
was read or emitted; generated build/typecheck cache state is local tooling only.

## Scoped Deterministic Contract Assertion Correction

### status

`success` for the bounded deterministic correction. Launch remains `NO-GO` with
`liveConformance: false`.

### executive_summary

The two stale deterministic assertions reported by verification now follow the
current contracts. Native documentation tests assert the repository-root
`native-profile.mjs` wrappers rather than removed legacy directory commands, and
the product-hardening test asserts the platform-conditioned Next output. Existing
native fail-closed safety checks and the non-Windows Linux/Render standalone
production branch are preserved.

### artifacts

- `tests/foundation/p0-native-boundaries.test.mjs`
- `tests/foundation/tus-product-hardening.test.mjs`
- `tests/foundation/p12-deployment-operations.test.mjs` (triangulation)
- `docs/runbooks/local-profiles.md` (authoritative native contract)
- `docs/deployment/render.md` (authoritative Linux/Render contract)
- `apps/web/next.config.js` (platform-conditioned configuration)
- `openspec/changes/tus-argentina-market-launch/apply-progress.md`
- `openspec/changes/tus-argentina-market-launch/final-remediation-evidence.md`

### tasks_completed

- [x] Correct current native wrapper documentation assertions without restoring stale text.
- [x] Correct current platform-aware standalone assertion without weakening Linux/Render behavior.
- [x] Preserve cumulative 14/14 implementation tasks, R1, external NO-GO evidence, and `Goldenrepo-js_py` exclusion.

### TDD evidence

| Correction | RED | GREEN | REFACTOR |
|---|---|---|---|
| Native wrapper contract | Baseline failed on removed `cd backend/frontend && pnpm run dev` expectations | Pinned focused suite: 2/2 passed | Current root wrappers are asserted; readiness, disabled-dependency, rollback, and secret-boundary assertions remain intact |
| Platform-aware standalone contract | Baseline failed on literal `output: 'standalone'` | Pinned focused suite: 19/19 passed; Phase 12 triangulation: 9/9 | Only the existing `isWindows ? undefined : 'standalone'` contract is accepted; Linux/Render standalone and fatal build flags remain covered |

### tests

| Command | Result |
|---|---|
| Pinned focused correction plus Phase 12 suites | exit 0; 30/30 passed, 0 failed |
| Pinned root build | exit 0; 5/5 tasks passed and 14 web routes generated |
| Pinned root typecheck | exit 0; 8/8 tasks passed |
| Pinned root lint | exit 0; 6/6 tasks passed, 0 errors, existing warnings only |
| Pinned policy validator | exit 0; no findings |
| Pinned tracked security scan | exit 0; no findings |
| `git diff --check` | exit 0; existing line-ending normalization warnings only |

All commands were bounded to 180 seconds or less. No database, provider,
browser/device, Docker, cloud, deployment, migration, seed, backup, restore, or
long-lived service operation occurred.

### Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | Pinned Node runner over `p0-native-boundaries`, `tus-product-hardening`, and `p12-deployment-operations`; exit 0, 30/30 passed |
| Runtime harness command/scenario | N/A by explicit user boundary: deterministic source-contract tests and local validation only; no external runtime boundary was started |
| Rollback boundary | Revert only the two stale assertion changes and this correction evidence; preserve native safety gates, Linux/Render production behavior, unrelated work, external NO-GO evidence, and `Goldenrepo-js_py` exclusion |

### database_effects

None. No database connection, read, write, migration, DDL, seed, backup,
restore, rollback, or schema operation occurred.

### provider_effects

None. No provider request, credential, webhook, cloud, deployment, browser,
device, or Docker operation occurred.

### risks

- External database durability, provider, browser/device, deployment,
  backup/restore, legal/tax, and production evidence remain blocked.
- Deterministic contract success does not promote static evidence or change
  `liveConformance=false`; launch remains `NO-GO`.
- Existing lint/deprecation/style warnings remain non-blocking.

### next_recommended

`sdd-verify` against this correction evidence, preserving the external NO-GO
decision and `Goldenrepo-js_py` exclusion.

### skill_resolution

`Strict TDD`: requested `sdd-apply`, `_shared`, `typescript`, and `nextjs-15`
paths were loaded. `.codegraph/` existed, but the upstream CodeGraph CLI was
unavailable; bounded fallback inspection followed the availability check. No
delegation or authorization pause occurred.

### cleanup_state

Complete. No long-lived process or external resource was started, no secret was
exposed, and generated build/typecheck cache state is local tooling output.
