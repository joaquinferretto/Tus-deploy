# Tasks: TUS Final Hardening

## Review Workload Forecast

Estimated authored change: 1,500–2,500 lines; configured review budget: 99,999. Delivery: force-chained, feature-branch-chain. PR #1 targets the feature/tracker branch; each later PR targets its immediate predecessor.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Exact paths / goal | Focused test command | Runtime; migration/rollback; evidence |
|---|---|---|---|
| 1 / PR1 | `tests/foundation/p1-auth-lifecycle.test.mjs`, `p1-mfa-passkeys-oauth-linking.test.mjs`, `p4-ai-capability.test.mjs`, `p4-ai-governance.test.mjs`, `scripts/test-runner-lib.mjs`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.github/workflows/ci.yml`, `apps/api/src/providers/whatsapp/index.ts`: stabilize gates. | `pnpm test -- tests/foundation/p1-auth-lifecycle.test.mjs tests/foundation/p1-mfa-passkeys-oauth-linking.test.mjs tests/foundation/p4-ai-capability.test.mjs tests/foundation/p4-ai-governance.test.mjs` | Run test/build/typecheck/lint twice; no migration; revert Unit 1 files. Local deterministic only; no external evidence. |
| 2 / PR2 | `apps/api/src/tus/{readiness,composition,application,http,integration}/`, `/tus/{checkout,marketplace/*,finance/*,delivery/*,pos/*,whatsapp/*,support/*}`, `apps/api/src/platform/jobs/adapters/activation-gated.ts`, `scripts/activation/tus-readiness.mjs`, `apps/api/prisma/schema.prisma`: guard mutations. | `pnpm test -- tests/foundation/p6-readiness.test.mjs tests/foundation/p6-activation-gates.test.mjs tests/foundation/p8-tus-readiness.test.mjs tests/foundation/p9-readiness.test.mjs` | Authenticated route/job denial/revocation harness; additive `apps/api/prisma/migrations/20260828120000_tus_final_hardening_readiness_metadata/migration.sql`; rollback additions, quarantine jobs, preserve history. Local only; external deferred. |
| 3 / PR3 | `apps/web/src/lib/tus-client.ts`, `apps/api/src/tus/http/router.ts`, `packages/contracts/src/tus.ts`, `packages/contracts/schemas/tus/*`, marketplace tests: canonical API. | `pnpm test -- tests/foundation/p8-tus-marketplace.test.mjs tests/foundation/p7-tus-marketplace-operations.test.mjs` | Express/fetch parity for `/tus/v1/marketplace/*`, alias, unknown version; no migration; revert client/alias/contracts/tests. Local deterministic; provider/browser evidence deferred. |
| 4 / PR4 | `scripts/integration/tus-postgres-http-smoke.mjs`, `tests/integration/tus/postgres-http-smoke.test.mjs`: durable HTTP journey. | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` | Authorized `TUS_POSTGRES_URL`: HTTP, restart, replay, isolation; unavailable setup emits `deferred`. No destructive migration; revert smoke files. `local-postgresql-http` or `deferred`, never external/production. |
| 5 / PR5 | `docs/evidence/readiness/tus-matrix.md`, `docs/activation-gates.md`, `docs/deployment/tus-readiness.md`, `docs/runbooks/{backup-restore,job-replay,profile-rollback,provider-disablement}.md`, `openspec/changes/tus-final-hardening/{proposal.md,design.md,tasks.md}`: truthful status. | `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-readiness.test.mjs` | `node scripts/activation/tus-readiness.mjs render-native`; no migration; revert docs/report only. Local classes stay distinct; external gates deferred/disabled. |

## Phase 1: Validation and Build Stabilization
- [x] 1.1 **RED:** Add 98-schema, Node 22, unknown-failure, and repeated-gate tests in Unit 1 paths.
- [x] 1.2 **GREEN:** Fix runner, workspace, Turbo, package, CI, and WhatsApp paths without weakening assertions.
- [x] 1.3 **REFACTOR:** Make `scripts/test-runner-lib.mjs` deterministic; prove root commands twice and record local evidence.

## Phase 1 Apply Evidence

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 1.1 | Added validation-baseline assertions before the runner changes; the new contract tests initially failed against the missing runner behavior. | `pnpm test -- tests/foundation/p9-validation-baseline.test.mjs` — exit 0; 11 passed, 0 failed, 0 skipped. | Explicit selections are sorted deterministically and failure records retain rerun/blocking metadata. |
| 1.2 | Node 22 loading and root-gate assertions were written before the corresponding implementation/configuration changes. | Unit 1 focused command — exit 0; 17 passed, 0 failed, 0 skipped. `pnpm build` — two runs exit 0. `pnpm typecheck` — two runs exit 0. | Root execution is serial; Next.js and mobile lint blockers found during validation were corrected without changing test assertions. |
| 1.3 | Added the `test:foundation` loader contract assertion before updating the root script; focused p9 run failed 1 of 14 tests as expected. | `pnpm test -- tests/foundation/p9-validation-baseline.test.mjs` — exit 0; 14 passed, 0 failed, 0 skipped. | Full deterministic suite and root build/typecheck/lint/contract/security/policy gates pass on the required repeated local runs; evidence and rollback references are current. |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/p1-auth-lifecycle.test.mjs tests/foundation/p1-mfa-passkeys-oauth-linking.test.mjs tests/foundation/p4-ai-capability.test.mjs tests/foundation/p4-ai-governance.test.mjs` — exit 0; 17 passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario and exact result | `pnpm test -- tests/foundation/p7-tus-marketplace-operations.test.mjs tests/foundation/p8-tus-marketplace.test.mjs` — exit 0; 27 passed, 0 failed, 0 skipped; local deterministic TUS marketplace operations and canonical versioned web-client paths exercised under Node 22. |
| Full deterministic suite | `pnpm test` — exit 0; 435 total, 435 passed, 0 failed, 0 skipped across 73 files. |
| Build repetition | `pnpm build` — run 1 exit 0 and run 2 exit 0; 4 Turbo build tasks successful per run. |
| Typecheck repetition | `pnpm typecheck` — run 1 exit 0 and run 2 exit 0; 8 Turbo typecheck tasks successful per run. |
| Lint repetition | `pnpm lint` — run 1 exit 0 and run 2 exit 0; 6 Turbo lint tasks successful per run. Existing web deprecation/workspace and warning-only diagnostics remain non-blocking. |
| Contract repetition | `pnpm contracts:validate` — run 1 exit 0 and run 2 exit 0; 98 JSON Schema contracts validated per run; Ajv unknown-format warnings are non-fatal. |
| Security/policy repetition | `pnpm run security:scan` and `pnpm exec node scripts/security/validate-policy.mjs` — both commands exit 0 on both runs; no tracked secrets or policy violations. |
| Rollback boundary | Revert only Unit 1 changes in the runner/config/CI/schema-count/WhatsApp validation paths plus the two lint-cleanup hunks; preserve unrelated dirty-tree work. |

## Phase 2: Canonical Readiness Runtime Enforcement
- [x] 2.1 **RED:** Test missing, expired, revoked, malformed, conflicting, and foreign-scope evidence with zero effects across Unit 2 boundaries.
- [x] 2.2 **GREEN:** Add `TusReadinessGuard`, scoped attribution, additive migration/backfill, and fail-closed route/job wiring.
- [x] 2.3 **REFACTOR:** Centralize audit/revocation handling; prove approved scope, conflict audit, and no persistence/provider/outbox/job effect on denial.

## Phase 2 Apply Evidence

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 2.1 | Added `tests/foundation/p9-tus-runtime-readiness.test.mjs`; the first focused run failed before the guard exports existed. | `pnpm test -- tests/foundation/p9-tus-runtime-readiness.test.mjs` — exit 0; 3 passed, 0 failed, 0 skipped. | Invalid, expired, revoked, malformed, conflicting, and out-of-scope records remain denied without protected effects. |
| 2.2 | Route, service, and job denial assertions were present before the runtime guard and adapter wiring. | `pnpm --filter @factory/api typecheck` — exit 0; `pnpm --filter @factory/api exec prisma validate` with `DATABASE_URL` — exit 0. | Prisma evidence is scoped by tenant/capability/profile; decisions persist attribution and additive migration fields. |
| 2.3 | Audit/no-queue assertions preceded the final transport and route integration. | Focused runtime command — exit 0; 3 passed, 0 failed, 0 skipped. | HTTP denial uses stable `409 TUS_READINESS_BLOCKED`; audit records preserve actor, job, correlation, profile, scope, and decision metadata. |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/p9-tus-runtime-readiness.test.mjs` — exit 0; 3 passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario and exact result | Same focused command — exit 0; authenticated HTTP checkout returned `409 TUS_READINESS_BLOCKED`, direct marketplace mutation was denied, and activated job transport queued nothing on denial. |
| Schema/contract validation | `pnpm contracts:validate` — exit 0; 98 JSON Schema contracts validated. `DATABASE_URL=postgresql://user:pass@localhost:5432/tus pnpm --filter @factory/api exec prisma validate` — exit 0. |
| Rollback boundary | Revert only `apps/api/src/tus/readiness`, readiness injection changes in TUS services/composition/router/integration, `apps/api/src/platform/jobs/{adapters/activation-gated.ts,application/durable-job-service.ts}`, Prisma readiness metadata, the activation integration, and `tests/foundation/p9-tus-runtime-readiness.test.mjs`; preserve PR1 and unrelated dirty-tree work. |

## Phase 3: API Version Compatibility
- [x] 3.1 **RED:** Test canonical `/tus/v1`, equivalent alias, and unknown-version denial before edits (the applicable HTTP/version threat case).
- [x] 3.2 **GREEN:** Canonicalize client/contracts/tests; retain only a tested server alias with identical authorization/evidence semantics.
- [x] 3.3 **REFACTOR:** Remove duplicate path logic, preserve Node 22 loading, and rerun dependent TUS suites.

## Phase 3 Apply Evidence

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 3.1 | Added canonical/legacy/unknown-version HTTP cases and checkout contract-version cases before implementation; the first focused run failed because the checkout validator export and compatibility behavior were absent. | `pnpm test -- tests/foundation/p8-tus-marketplace.test.mjs` — exit 0; 8 passed, 0 failed, 0 skipped. | Canonical route behavior is exercised through one handler path; unknown versions return a stable envelope without authentication or data disclosure. |
| 3.2 | Added client body-contract and server idempotency-key parity assertions before changing the client/router. | `pnpm test -- tests/foundation/p8-tus-marketplace.test.mjs` — exit 0; 8 passed, 0 failed, 0 skipped. | The web client emits the version and idempotency key in the documented body/header contract; legacy marketplace paths rewrite to canonical routes without a second semantic handler. |
| 3.3 | Added client response-version rejection and replay/conflict/no-duplicate assertions before the parser and response contract changes. | `pnpm test -- tests/foundation/p8-tus-marketplace.test.mjs tests/foundation/p7-tus-marketplace-operations.test.mjs` — exit 0; 22 passed, 0 failed, 0 skipped. | Node 22 strip-only loading remains green; dependent marketplace, identity, contract, build, typecheck, lint, security, and policy gates pass. |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/p8-tus-marketplace.test.mjs tests/foundation/p7-tus-marketplace-operations.test.mjs` — exit 0; 22 passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario and exact result | The same command served local Express HTTP scenarios for canonical `/tus/v1/marketplace/*`, legacy marketplace aliases, unknown `/tus/v2/marketplace/*`, authenticated tenant checks, replay/conflict, and commitment-count protection — exit 0; 22 passed, 0 failed, 0 skipped. |
| Full deterministic suite | `pnpm test` — exit 0 on the final 300-second run; 438 passed, 0 failed, 0 skipped across 73 files. |
| Build repetition | `pnpm build` — run 1 exit 0 and run 2 exit 0; 4 Turbo build tasks successful per run. |
| Typecheck repetition | `pnpm typecheck` — run 1 exit 0 and run 2 exit 0; 8 Turbo typecheck tasks successful per run. |
| Lint repetition | `pnpm lint` — run 1 exit 0 and run 2 exit 0; 6 Turbo lint tasks successful per run. Existing Next.js deprecation/workspace and warning-only diagnostics remain non-blocking. |
| Contract repetition | `pnpm contracts:validate` — run 1 exit 0 and run 2 exit 0; 98 JSON Schema contracts validated per run. Existing Ajv unknown-format warnings are non-fatal. |
| Security/policy repetition | `pnpm run security:scan` — two exit-0 runs; `pnpm exec node scripts/security/validate-policy.mjs` — two exit-0 runs; no tracked secrets or policy violations. |
| Rollback boundary | Revert only the Phase 3 compatibility hunks in `apps/web/src/lib/tus-client.ts`, `apps/api/src/tus/http/router.ts`, `apps/api/src/tus/catalog/index.ts`, `packages/contracts/src/tus.ts`, and `tests/foundation/p8-tus-marketplace.test.mjs`: canonical path constants/body fields/parser guard, marketplace alias rewrite/version rejection, response contract version, checkout contract validator/error envelope, and Phase 3 tests/path updates. Preserve all Phase 1–2 code in these shared files, unrelated dirty-tree work, and all migrations. |

## Phase 4: Durable PostgreSQL HTTP Evidence
- [x] 4.1 **RED:** Add restart/replay, cross-tenant, rejection/rollback, audit/outbox, and unavailable-infrastructure tests.
- [x] 4.2 **GREEN:** Implement disposable authenticated PostgreSQL HTTP orchestration with `local-postgresql-http` or honest `deferred`; never enable unavailable providers.
- [x] 4.3 **REFACTOR:** Isolate fixtures/restart; prove no duplicate commitment/financial effect; keep cloud/provider/browser/POS/legal/production evidence deferred.

## Phase 4 Apply Evidence

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 4.1 | Added explicit opt-in, unavailable-URL, invalid-URL, configured-boundary, and truthful-evidence assertions in `tests/integration/tus/postgres-http-smoke.test.mjs`; live PostgreSQL scenarios remain conditional on authorized infrastructure. | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` — exit 0; 5 passed, 0 failed, 0 skipped. | Scenario assertions are isolated behind the bounded runner and cannot promote deferred evidence to a live claim. |
| 4.2 | The integration tests define the deferred contract before the configured runner is considered valid. | `runTusPostgresHttpSmoke({ postgresUrl: '' })` returns `deferred`, `local-postgresql-http`, `execution: local-verification`, and `liveConformance: false`; configured PostgreSQL execution remains opt-in. | URL validation, Prisma validation/migration, connection, API startup, fixture setup, and cleanup are bounded and return truthful deferred results on infrastructure failure. |
| 4.3 | Restart/replay, isolation, conflict/rollback, and durable audit/outbox/idempotency assertions are represented in the configured smoke path. | The configured path contains authenticated discovery, product/service checkout, restart replay, cross-tenant denial, idempotency conflict, and durable-count assertions; no authorized PostgreSQL URL was available in this run, so these scenarios were not claimed as executed. | Fixtures, API restart, cleanup, and durable count queries are isolated; cloud/provider/browser/device/POS/legal/production evidence remains deferred. |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` — exit 0; 5 passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario and exact result | `TUS_POSTGRES_URL` was unavailable; the real PostgreSQL HTTP harness was not run. The explicit no-URL scenario ran and returned `deferred` with rerun guidance; no live durability claim was made. |
| Dependent TUS regression command and exact result | Explicit selection of the integration smoke plus dependent P7–P9 TUS suites — exit 0; all 20 requested test files passed with 0 failures. |
| Build/contract checks | `pnpm --filter @factory/api build` — exit 0. `pnpm contracts:validate` — exit 0; existing AJV unknown-format warnings are non-fatal. |
| Rollback boundary | Revert only `scripts/test-runner-lib.mjs` PostgreSQL smoke additions and `tests/integration/tus/postgres-http-smoke.test.mjs`; preserve unrelated dirty-tree work and all prior PR1–PR3 changes. |


## Phase 5: Documentation and Readiness Truthfulness
- [x] 5.1 **RED:** Test stale stronger claims, taxonomy, unauthorized evidence, scope, Argentina-first boundaries, and non-goals.
- [x] 5.2 **GREEN:** Publish the matrix with command, revision/date, owner, scope, status, and evidence class.
- [x] 5.3 **REFACTOR:** Make readiness output fail closed; rerun focused tests and retain missing external gates as deferred/disabled.

## Phase 5 Apply Evidence

### TDD Cycle Evidence

| Task | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|
| 5.1 | Added fail-closed claim, four-class taxonomy, scope, non-goal, and matrix-content assertions before the matrix and activation-output changes; the focused run failed because `TUS_EVIDENCE_CLASSES` and the matrix were absent. | `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-readiness.test.mjs` — exit 0; 17 passed, 0 failed, 0 skipped. | Covered partial authorized evidence, local-deterministic evidence, deferred evidence, malformed/expired/revoked/out-of-scope evidence, and excluded scopes. | Assertions remain behavior-focused; no provider credentials, calls, or weakened prior coverage. |
| 5.2 | Matrix schema/content assertions were written before `docs/evidence/readiness/tus-matrix.md` existed. | Matrix published with traceable command/artifact, environment, revision/date, owner, scope, status, and evidence class for local, PostgreSQL, provider, cloud, browser/device, legal, POS, and production gates. | Matrix separates `local-deterministic`, `local-postgresql-http`, `authorized-external`, and `deferred`; all missing external rows remain deferred/disabled. | Stale readiness/deployment/readiness README and operational runbook terminology now points to the canonical matrix and preserves Argentina-first boundaries. |
| 5.3 | The stronger scoped-authorized claim and old activation-report taxonomy were asserted as failing behavior before the fail-closed output was finalized. | Activation evaluation/report now returns `not-production-ready`, `unavailable-deferred`, `liveConformance: false`, and disabled gated composition whenever applicable external evidence is incomplete. | Tested deterministic-only evidence separately from no-evidence deferred output and retained redaction/credential-free behavior. | Added explicit production-readiness blockers and canonical evidence-class fields without enabling providers or cloud calls. |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-readiness.test.mjs` — exit 0; 17 passed, 0 failed, 0 skipped. |
| Full relevant readiness suite | `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-readiness.test.mjs tests/foundation/p6-readiness.test.mjs tests/foundation/p6-activation-gates.test.mjs tests/foundation/p6-render-parity.test.mjs` — exit 0; 34 passed, 0 failed, 0 skipped. |
| Full deterministic suite | `pnpm test` — exit 0; 440 passed, 0 failed, 0 skipped across the repository test files. |
| Runtime harness command/scenario and exact result | `node scripts/activation/tus-readiness.mjs render-native` — exit 0; provider-free JSON returned `status: not-production-ready`, `disposition: unavailable-deferred`, `evidenceClass: deferred`, `liveConformance: false`, and disabled TUS routes/providers/release/fleet actions. No credentials, network, provider, or cloud calls were used. |
| Cloud/profile check | `pnpm exec node scripts/validation/cloud-native/validate-plan.mjs` — exit 0; Render/AWS fixtures validated as plan-only with no provisioning or live conformance. |
| Contract/build checks | `pnpm contracts:validate` — exit 0; 98 JSON Schema contracts validated. `pnpm build` — exit 0; 4 Turbo build tasks successful. |
| Policy/security checks | `pnpm exec node scripts/security/validate-policy.mjs` — exit 0; `pnpm run security:scan` — exit 0; no policy violations or tracked secrets. |
| Rollback boundary | Revert only `scripts/activation/tus-readiness.mjs`, `tests/foundation/p9-activation.test.mjs`, `docs/evidence/readiness/tus-matrix.md`, the four targeted readiness/deployment/runbook docs, and Phase 5 edits in this change's proposal/design/tasks/apply-progress; preserve PR1–PR4 implementation, migrations, contracts, evidence history, and unrelated dirty-tree work. |

## External Evidence Still Required

Implementation is complete for this change. The following are intentionally not
invented as tasks or claims: authorized PostgreSQL HTTP restart/replay,
Mercado Pago/WhatsApp/provider smoke, AWS/Groq and managed-cloud conformance,
browser/screen-reader, physical-device/POS pilot, Argentina legal/tax/KYC/KYB,
and production-operations/on-call evidence. Each remains `deferred` or
`disabled` in the readiness matrix until supplied by its accountable owner.
