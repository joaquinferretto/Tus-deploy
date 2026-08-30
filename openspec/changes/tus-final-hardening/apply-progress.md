# Apply Progress: TUS Final Hardening

## Work Unit

- Change: `tus-final-hardening`
- Assigned slice: `Phase 5 / PR5 — Documentation and readiness truthfulness`
- Delivery: `auto-chain`, `feature-branch-chain`; PR5 follows PR4.
- Scope boundary: cumulative Phase 1–4 completion plus the canonical readiness matrix, evidence taxonomy, fail-closed activation report, reconciled readiness/deployment/runbook documentation, and explicit external-evidence deferrals. No provider, cloud, browser/device, POS, legal, pilot, or production evidence.
- Rollback boundary: revert only the Phase 5 activation-report logic/tests, readiness matrix, targeted readiness/deployment/runbook documentation, and Phase 5 SDD artifact edits; preserve Phase 1–4 code, migrations, contracts, durable evidence, and unrelated dirty-tree work.
- Mode: Strict TDD

## Completed Tasks

- [x] 1.1 **RED:** Add 98-schema, Node 22, unknown-failure, and repeated-gate tests in Unit 1 paths.
- [x] 1.2 **GREEN:** Fix runner, workspace, Turbo, package, CI, and WhatsApp paths without weakening assertions.
- [x] 1.3 **REFACTOR:** Make `scripts/test-runner-lib.mjs` deterministic; prove root commands twice and record local evidence. Root validation gates are green on the repeated local runs recorded below.
- [x] 2.1 **RED:** Test missing, expired, revoked, malformed, conflicting, and foreign-scope evidence with zero effects across Unit 2 boundaries.
- [x] 2.2 **GREEN:** Add `TusReadinessGuard`, scoped attribution, additive migration/backfill, and fail-closed route/job wiring.
- [x] 2.3 **REFACTOR:** Centralize audit/revocation handling; prove approved scope, conflict audit, and no persistence/provider/outbox/job effect on denial.
- [x] 3.1 **RED:** Test canonical `/tus/v1`, equivalent alias, and unknown-version denial before edits (the applicable HTTP/version threat case).
- [x] 3.2 **GREEN:** Canonicalize client/contracts/tests; retain only a tested server alias with identical authorization/evidence semantics.
- [x] 3.3 **REFACTOR:** Remove duplicate path logic, preserve Node 22 loading, and rerun dependent TUS suites.
- [x] 4.1 **RED:** Add restart/replay, cross-tenant, rejection/rollback, audit/outbox, and unavailable-infrastructure tests.
- [x] 4.2 **GREEN:** Implement disposable authenticated PostgreSQL HTTP orchestration with `local-postgresql-http` or honest `deferred`; never enable unavailable providers.
- [x] 4.3 **REFACTOR:** Isolate fixtures/restart; prove no duplicate commitment/financial effect; keep cloud/provider/browser/POS/legal/production evidence deferred.
- [x] 5.1 **RED:** Test stale stronger claims, taxonomy, unauthorized evidence, scope, Argentina-first boundaries, and non-goals.
- [x] 5.2 **GREEN:** Publish the matrix with command, revision/date, owner, scope, status, and evidence class.
- [x] 5.3 **REFACTOR:** Make readiness output fail closed; rerun focused tests and retain missing external gates as deferred/disabled.

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 1.1 | Added validation-baseline assertions before runner changes; initial execution failed against the missing runner behavior. | `pnpm test -- tests/foundation/p9-validation-baseline.test.mjs` — exit 0; 11 passed, 0 failed, 0 skipped. | Explicit selections are sorted deterministically and failure records retain rerun/blocking metadata. |
| 1.2 | Node 22 loading and root-gate assertions preceded the implementation/configuration changes. | Unit 1 focused command — exit 0; 17 passed, 0 failed, 0 skipped. | Root execution is serial; targeted web/mobile lint blockers were corrected without changing assertions. |
| 1.3 | Added the `test:foundation` loader contract assertion before updating the root script; focused p9 run failed 1 of 14 tests as expected. | `pnpm test -- tests/foundation/p9-validation-baseline.test.mjs` — exit 0; 14 passed, 0 failed, 0 skipped. | `pnpm test` — exit 0; 435 passed, 0 failed, 0 skipped across 73 files. Root build, typecheck, lint, contracts, security, and policy gates were each rerun successfully. |
| 2.1 | Added `tests/foundation/p9-tus-runtime-readiness.test.mjs`; initial focused execution failed before the guard/audit exports existed. | `pnpm test -- tests/foundation/p9-tus-runtime-readiness.test.mjs` — exit 0; 3 passed, 0 failed, 0 skipped. | Invalid, expired, revoked, malformed, conflicting, and out-of-scope evidence remain fail-closed. |
| 2.2 | Route, service, and job denial assertions were present before runtime guard and adapter wiring. | `pnpm --filter @factory/api typecheck` — exit 0; Prisma schema validation — exit 0 with a supplied local `DATABASE_URL`. | Prisma evidence is tenant/capability/profile scoped; readiness decisions retain attribution metadata. |
| 2.3 | Audit/no-queue assertions preceded final transport and route integration. | Focused runtime command — exit 0; 3 passed, 0 failed, 0 skipped. | Stable `409 TUS_READINESS_BLOCKED`; actor/job/correlation/profile/scope and decision metadata are retained. |
| 3.1 | Added canonical/legacy/unknown-version HTTP cases and checkout contract-version cases before implementation; the first focused run failed because the checkout validator export and compatibility behavior were absent. | `pnpm test -- tests/foundation/p8-tus-marketplace.test.mjs` — exit 0; 8 passed, 0 failed, 0 skipped. | Canonical route behavior is exercised through one handler path; unknown versions return a stable envelope without authentication or data disclosure. |
| 3.2 | Added client body-contract and server idempotency-key parity assertions before changing the client/router. | `pnpm test -- tests/foundation/p8-tus-marketplace.test.mjs` — exit 0; 8 passed, 0 failed, 0 skipped. | The web client emits the version and idempotency key in the documented body/header contract; legacy marketplace paths rewrite to canonical routes without a second semantic handler. |
| 3.3 | Added client response-version rejection and replay/conflict/no-duplicate assertions before the parser and response contract changes. | `pnpm test -- tests/foundation/p7-tus-marketplace-operations.test.mjs tests/foundation/p8-tus-marketplace.test.mjs` — exit 0; 30 passed, 0 failed, 0 skipped. | Node 22 strip-only loading remains green; dependent marketplace, identity, contract, build, typecheck, lint, security, and policy gates pass. |
| 4.1 | Added explicit opt-in, unavailable-URL, invalid-URL, configured-boundary, and truthful-evidence assertions in the PostgreSQL smoke test. The live scenario assertions are conditional on authorized infrastructure. | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` — exit 0; 5 passed, 0 failed, 0 skipped. | Deferred and configured evidence classes are asserted separately; no fake local pass is possible without a PostgreSQL URL. |
| 4.2 | The integration tests define the deferred contract before the configured orchestration is considered valid. | `runTusPostgresHttpSmoke({ postgresUrl: '' })` returned deferred with `local-postgresql-http`, `local-verification`, and `liveConformance: false`; focused test passed. | Prisma/schema/connection/API startup/fixture boundaries are bounded and infrastructure failures return deferred without claiming durable evidence. |
| 4.3 | Restart/replay, cross-tenant, conflict/rollback, and durable count checks are implemented in the configured smoke path. | No authorized `TUS_POSTGRES_URL` was available; the real harness was not executed and those scenarios are explicitly unclaimed. Dependent explicit TUS selection exited 0 with all requested files passing. | Fixture creation/cleanup, restart, replay, and count verification are isolated; external/provider/browser/device/POS/legal/production evidence remains deferred. |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/p1-auth-lifecycle.test.mjs tests/foundation/p1-mfa-passkeys-oauth-linking.test.mjs tests/foundation/p4-ai-capability.test.mjs tests/foundation/p4-ai-governance.test.mjs` — exit 0; 17 passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario and exact result | `pnpm test -- tests/foundation/p7-tus-marketplace-operations.test.mjs tests/foundation/p8-tus-marketplace.test.mjs` — exit 0; 27 passed, 0 failed, 0 skipped; local deterministic TUS marketplace operations and canonical versioned paths passed under Node 22. |
| Full deterministic suite | `pnpm test` — exit 0; 435 total, 435 passed, 0 failed, 0 skipped across 73 files. |
| Build repetition | `pnpm build` — run 1 exit 0 and run 2 exit 0; 4 Turbo build tasks successful per run. |
| Typecheck repetition | `pnpm typecheck` — run 1 exit 0 and run 2 exit 0; 8 Turbo typecheck tasks successful per run. |
| Lint repetition | `pnpm lint` — run 1 exit 0 and run 2 exit 0; 6 Turbo lint tasks successful per run. Existing web deprecation/workspace and warning-only diagnostics remain non-blocking. |
| Contract repetition | `pnpm contracts:validate` — run 1 exit 0 and run 2 exit 0; 98 JSON Schema contracts validated per run; Ajv unknown-format warnings are non-fatal. |
| Security/policy repetition | `pnpm run security:scan` and `pnpm exec node scripts/security/validate-policy.mjs` — both commands exit 0 on both runs; no tracked secrets or policy violations. |
| Rollback boundary | Revert only the Phase 1 paths and targeted lint-cleanup hunks listed above; do not reset unrelated dirty-tree changes. |
| Phase 2 focused test | `pnpm test -- tests/foundation/p9-tus-runtime-readiness.test.mjs` — exit 0; 3 passed, 0 failed, 0 skipped. |
| Phase 2 runtime harness | Focused test served an authenticated HTTP checkout and exercised a direct marketplace service plus activated job transport; exit 0; no protected write/queue effect on denial. |
| Phase 2 schema/contracts | `pnpm contracts:validate` — exit 0; 98 schemas validated. `DATABASE_URL=postgresql://user:pass@localhost:5432/tus pnpm --filter @factory/api exec prisma validate` — exit 0. |
| Phase 2 rollback boundary | Revert only Phase 2 readiness files, TUS service/composition/router/integration wiring, job guard wiring, metadata schema/migration, and focused runtime tests; preserve PR1 and unrelated dirty-tree work. |
| Phase 3 focused test | `pnpm test -- tests/foundation/p8-tus-marketplace.test.mjs tests/foundation/p7-tus-marketplace-operations.test.mjs` — exit 0; 22 passed, 0 failed, 0 skipped. |
| Phase 3 runtime harness | The focused suites served local Express HTTP scenarios for canonical `/tus/v1/marketplace/*`, legacy aliases, unknown `/tus/v2/marketplace/*`, authenticated tenant checks, replay/conflict, and no duplicate commitment effect — exit 0; 22 passed, 0 failed, 0 skipped. |
| Phase 3 full/root gates | Final `pnpm test` exit 0 with 438 passed across 73 files; `pnpm build` and `pnpm typecheck` each passed twice (4 and 8 successful Turbo tasks per run); `pnpm lint` passed twice (6 successful tasks per run); contracts passed twice with 98 schemas; security scan and policy validation each passed twice. |
| Phase 3 rollback boundary | Revert only Phase 3 compatibility hunks in the web client, API router/catalog, contracts, and p8 marketplace tests; preserve Phase 1–2 code in shared files, migrations, and unrelated dirty-tree work. |
| Phase 4 focused test | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` — exit 0; 5 passed, 0 failed, 0 skipped. |
| Phase 4 runtime harness | `TUS_POSTGRES_URL` unavailable; real PostgreSQL HTTP smoke was not run. The no-URL boundary returned deterministic `deferred` with rerun guidance and `liveConformance: false`. |
| Phase 4 dependent TUS selection | Explicit integration/P7–P9 selection — exit 0; all 20 requested test files passed with 0 failures. |
| Phase 4 build/contracts | `pnpm --filter @factory/api build` — exit 0. `pnpm contracts:validate` — exit 0; AJV unknown-format warnings are non-fatal. |
| Phase 4 rollback boundary | Revert only the PostgreSQL smoke additions in `scripts/test-runner-lib.mjs` and `tests/integration/tus/postgres-http-smoke.test.mjs`; preserve prior phases and unrelated dirty-tree changes. |

## Phase 5 Apply Evidence

### TDD Cycle Evidence

| Task | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|
| 5.1 | Added claim/taxonomy/scope/matrix assertions before implementation; focused execution failed on the absent export/matrix. | `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-readiness.test.mjs` — exit 0; 17 passed, 0 failed, 0 skipped. | Partial authorized, local deterministic, deferred, invalid, and excluded-scope paths are covered. | Assertions verify outputs and committed evidence, not implementation trivia. |
| 5.2 | Matrix contract test preceded creation of `docs/evidence/readiness/tus-matrix.md`. | Matrix records command/artifact, environment, revision/date, owner, scope, status, and evidence class for every current gate family. | Four canonical classes are listed independently; PostgreSQL and all external gates remain separate. | Targeted docs/runbooks and SDD claims point to the matrix and preserve Argentina-first non-goals. |
| 5.3 | Test first rejected a partial authorized record and old cloud-plan-only report claim as production readiness. | Activation output is `not-production-ready`/`unavailable-deferred` with `liveConformance: false` and gated composition disabled when external evidence is incomplete. | Deterministic-only and no-evidence reports receive distinct classes while both remain non-live. | Added blockers/classification fields without provider discovery, credentials, network, or cloud calls. |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-readiness.test.mjs` — exit 0; 17 passed, 0 failed, 0 skipped. |
| Full relevant readiness suite | `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-readiness.test.mjs tests/foundation/p6-readiness.test.mjs tests/foundation/p6-activation-gates.test.mjs tests/foundation/p6-render-parity.test.mjs` — exit 0; 34 passed, 0 failed, 0 skipped. |
| Full deterministic suite | `pnpm test` — exit 0; 440 passed, 0 failed, 0 skipped across the repository test files. |
| Runtime harness command/scenario and exact result | `node scripts/activation/tus-readiness.mjs render-native` — exit 0; provider-free report returned `not-production-ready`, `unavailable-deferred`, `evidenceClass: deferred`, `liveConformance: false`, and disabled TUS routes/providers/release/fleet actions. |
| Cloud/profile check | `pnpm exec node scripts/validation/cloud-native/validate-plan.mjs` — exit 0; Render/AWS fixtures validated plan-only with no provisioning/live conformance. |
| Contract/build checks | `pnpm contracts:validate` — exit 0; 98 JSON Schema contracts validated. `pnpm build` — exit 0; 4 Turbo build tasks successful. |
| Policy/security checks | `pnpm exec node scripts/security/validate-policy.mjs` — exit 0; `pnpm run security:scan` — exit 0; no policy violations or tracked secrets. |
| Rollback boundary | Revert only the Phase 5 activation script/tests, readiness matrix, targeted docs/runbooks, and Phase 5 SDD artifact edits; preserve PR1–PR4 and unrelated dirty-tree work. |

## Remaining Work

- [x] Phase 2 / PR2 readiness runtime enforcement is complete.
- [x] Phase 3 / PR3 API version compatibility is complete; current focused and Node 22 compatibility checks pass.
- [x] Phase 4 / PR4 durable PostgreSQL HTTP evidence implementation is complete; live PostgreSQL execution remains deferred because `TUS_POSTGRES_URL` was unavailable.
- [x] Phase 5 / PR5 documentation and readiness truthfulness is complete.

## External Evidence Still Required

No additional implementation tasks are invented. Authorized PostgreSQL HTTP
restart/replay, provider and cloud conformance, browser/screen-reader,
physical-device/POS pilot, Argentina legal/tax/KYC/KYB, and
production-operations/on-call evidence remain `deferred` or `disabled` until
their accountable owners provide current scoped records.
