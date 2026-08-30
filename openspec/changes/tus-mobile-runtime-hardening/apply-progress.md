# Apply Progress: TUS Mobile Runtime Hardening

## Structured Status

- Change: `tus-mobile-runtime-hardening`
- Artifact store: Hybrid (OpenSpec + Engram)
- Delivery: automatic feature-branch-chain, PR4 targets PR3 (`feature/tus-mobile-runtime-hardening-pr3` when published)
- Apply state at start: `ready`
- Progress: 4/4 tasks complete
- Current work unit: PR4 / Phase 4 — evidence and documentation refresh
- Deferred work: None within this change; external evidence remains deferred

## Completed Tasks

- [x] 1.1 Canonical runtime identity, Expo config integration, auth/POS transport resolution, Axios authority binding, `/tus/v1/pos/manual-operations`, and TUS contract `1.0.0`
- [x] 2.1 Profile-isolated credentials, app state, POS queues, and quarantine
- [x] 3.1 Startup diagnostics, fail-fast bootstrap, and version consistency
- [x] 4.1 Evidence receipt refresh and external-gate documentation

## Implementation

- Added `apps/mobile/src/core/config/runtime-profile.ts` as the single typed resolver. It validates profile authority, endpoint authority, TLS/profile compatibility, URL safety, storage version `1`, and TUS contract version `1.0.0`; missing profiles fail closed.
- Added `apps/mobile/src/core/config/index.ts` and wired `app.config.ts` to serialize the resolver output. The development API default is now `http://localhost:3001`, matching `apps/api/src/server.ts`; endpoint and profile environment authorities cannot silently disagree.
- Wired auth and POS fetch transport factories to consume the injected runtime or the serialized Expo runtime. POS rejects unsupported contract versions and retains the versioned route.
- Wired `AxiosApiClient` to validate the injected runtime, reject a conflicting legacy `baseUrl`, bind `baseURL` to the runtime, and disable absolute-URL authority overrides.
- Enabled TypeScript `.ts` imports required by Expo's config evaluator and Node's strip-only harness.

## PR2 / Phase 2 Implementation

- Replaced mobile storage constructors with validated `MobileRuntimeConfig` input. SecureStore keys, MMKV ids/prefixes, encryption-key lookup, Zustand app state, and React Query cache keys now remain inside the resolved profile namespace; conflicting MMKV prefixes fail closed.
- Removed the login, sign-out, and POS `dev` namespace literals. Auth, POS, and app bootstrap now read the serialized runtime identity and inject that same object into credential and persistence boundaries.
- Added versioned `MobileQueueEnvelope` restoration. Legacy arrays, missing/invalid metadata, conflicting namespace/profile data, invalid operations, and mismatched tenants are retained as redacted quarantine records and are never replayed.
- Added explicit queue quarantine inspection/clear behavior and POS unavailable UX. Pending, conflict, error, and quarantine states remain actionable without claiming provider capture or settlement.
- Added persisted app-state runtime metadata so state from a missing or different profile is discarded rather than hydrated into the active profile.

## PR3 / Phase 3 Implementation

- Added `apps/mobile/src/core/config/runtime-diagnostics.ts` with safe diagnostics for validated, configuration-rejected, and bootstrap-failed states. Diagnostics expose only the profile, redacted endpoint, TLS requirement, storage version, TUS contract version, and canonical POS route; raw errors, credentials, query strings, and fragments are never emitted.
- Added `bootstrapMobileRuntime` as the fail-fast composition boundary. Runtime parsing and mobile/API contract-version checks happen before persistence or session restoration; invalid configuration returns an unavailable result and performs zero storage, authentication, or queue bootstrap work.
- Wired `apps/mobile/app/_layout.tsx` to record diagnostics before dependent bootstrap, render an actionable unavailable state on invalid or failed startup, and keep authenticated/POS routes unmounted until validated persistence and session restoration complete.
- The mobile diagnostics compare the runtime `1.0.0` contract against the shared `@factory/contracts` API contract and retain storage version `1` plus `/tus/v1/pos/manual-operations` as explicit runtime evidence.

## PR4 / Phase 4 Implementation

- Added current deterministic receipts to `docs/evidence/readiness/tus-matrix.md` and `docs/evidence/native-smoke.md`: `pnpm test` is recorded as 464 passed, 0 failed, 0 skipped across 87 isolated suites; contract validation records 98 JSON Schema contracts; build, typecheck, lint, security, policy, cloud-plan, PostgreSQL-boundary, and activation results record their observed current outcomes.
- Replaced stale native wrapper, PostgreSQL-ready, 29/29 full-test, and blocked secret-scan claims with bounded local/deferred evidence. Historical 29/29 and blocked-scan statements remain only in an explicitly superseded-history section.
- Made the schema receipt explicit as `98 JSON Schema contracts validated` and added a native-smoke row for the `local-postgresql-http` boundary, which remains deferred when `TUS_POSTGRES_URL` is unavailable.
- Kept activation fail-closed for both `render-native` and `aws-terraform`: `not-production-ready`, `unavailable-deferred`, `evidenceClass: deferred`, `liveConformance: false`, and disabled `tusRoutes`, `providers`, `releaseJobs`, and `fleetJobs`.
- Extended existing readiness/activation boundary assertions in `tests/foundation/p9-activation.test.mjs` and refreshed `tests/foundation/p0-native-boundaries.test.mjs` so stale counts, stale schema claims, and stronger evidence claims fail deterministically without changing the full-suite test count.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `apps/mobile/tests/unit/runtime-profile.test.ts` | Unit + request-capture harness | ✅ Existing auth/POS tests: 17/17 | ✅ Initial run failed because the resolver module did not exist | ✅ Final resolver suite: 10/10 | ✅ staging normalization, dev port, missing/unknown profile, malformed endpoint, TLS contradiction, ambiguous authorities, serialized metadata, transport route/version, authority spoofing | ✅ Extracted typed resolver, strict serialized parsing, lazy Expo lookup, and portable `.ts` imports; focused suite remained 10/10 |
| 2.1 | `apps/mobile/tests/unit/tus-auth.test.ts`, `apps/mobile/tests/unit/tus-pos.test.ts` | Unit + in-memory replay/quarantine harness | ✅ PR2 safety net: 17/17 | ✅ Queue envelope, profile mismatch, legacy array, tenant mismatch, and clear-boundary tests were written before the PR2 implementation; key identity coverage was added during triangulation | ✅ Focused auth/POS suite: 23/23; runtime/profile regression suite: 33/33 | ✅ staging envelope persistence, accepted replay cleanup, legacy/cross-profile quarantine, tenant isolation, redacted quarantine data, storage rejection, and profile-qualified key identities | ✅ Centralized runtime parsing, envelope restoration, redacted quarantine, and explicit queue storage adapter; focused suite remained 23/23 |
| 3.1 | `apps/mobile/tests/unit/runtime-bootstrap.test.ts` | Unit + mocked bootstrap sink | ✅ Existing PR2 mobile regression: 33/33 | ✅ Initial run failed because `runtime-diagnostics.ts` did not exist | ✅ Focused diagnostics/bootstrap suite: 8/8; mobile regression suite: 41/41 | ✅ dev and staging identities, invalid profile/API/TLS metadata, storage/TUS version mismatch, redacted errors, zero invalid-config bootstrap calls, diagnostic ordering, and dependency-failure redaction | ✅ Shared bootstrap boundary, safe field allowlist, shared API contract comparison, and actionable unavailable UI; focused suite remained 8/8 |
| 4.1 | `tests/foundation/p9-activation.test.mjs`, `tests/foundation/p0-native-boundaries.test.mjs` | Unit-style provider-free receipt assertions | ✅ Existing focused baseline: 14/14 | ✅ Assertions written before receipt edits; initial run failed because native-smoke lacked an explicit `local-postgresql-http` deferred row | ✅ Final focused run: 2 suites, 14 passed, 0 failed; full suite: 464 passed, 0 failed, 0 skipped across 87 suites | ✅ Matrix/native current counts and checks, stale 440/435/361/29/29 current-row rejection, superseded history, local/deferred taxonomy, and disabled activation switches | ✅ Consolidated assertions into existing boundary suites and preserved the 464-test baseline; no production behavior changed |

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `pnpm --filter @factory/mobile exec jest tests/unit/runtime-profile.test.ts tests/unit/tus-auth.test.ts tests/unit/tus-pos.test.ts --runInBand` — exit 0; 3 suites passed, 27 tests passed, 0 failed |
| Runtime harness command/scenario and exact result | `pnpm --filter @factory/mobile config:dev` and `config:staging` — exit 0; serialized `http://localhost:3001` dev and HTTPS staging runtime identities. `node --test tests/foundation/p7-tus-marketplace-operations.test.mjs` — exit 0; 22/22 provider-free API/mobile scenarios passed. Expo web export with `APP_PROFILE=dev` — exit 0; bundle exported to approved temporary output |
| Rollback boundary | Revert only `apps/mobile/src/core/config/{runtime-profile,index}.ts`, `apps/mobile/app.config.ts`, `apps/mobile/tsconfig.json`, `apps/mobile/src/application/{tus-auth,tus-client}.ts`, `apps/mobile/src/core/services/axios-api-client.ts`, `apps/mobile/tests/unit/runtime-profile.test.ts`, and this task/progress artifact. Do not revert PR2–PR4 files or unrelated pre-existing work |

### PR2 / Phase 2 Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `pnpm --filter @factory/mobile exec jest tests/unit/tus-auth.test.ts tests/unit/tus-pos.test.ts --runInBand` — exit 0; 2 suites passed, 23 tests passed, 0 failed. Regression extension `pnpm --filter @factory/mobile exec jest tests/unit/runtime-profile.test.ts tests/unit/tus-auth.test.ts tests/unit/tus-pos.test.ts --runInBand` — exit 0; 3 suites passed, 33 tests passed, 0 failed. |
| Runtime harness command/scenario and exact result | `node --test tests/foundation/p8-tus-delivery-pos.test.mjs` — exit 0; 7/7 provider-free API/mobile POS scenarios passed, including cross-instance envelope replay. `node --test tests/foundation/p9-delivery-pos.test.mjs` — exit 0; 7/7 provider-free reconstruction, conflict, tenant-boundary, and contract scenarios passed. `pnpm --filter @factory/mobile config:staging` — exit 0; serialized staging runtime reports profile `staging`, HTTPS endpoint, storage `1`, and TUS `1.0.0`. |
| Rollback boundary | Revert only PR2 isolation changes in `apps/mobile/src/core/services/{secure-credential-store,mmkv-storage,query-client}.ts`, `apps/mobile/src/store/app-store.ts`, `apps/mobile/src/application/tus-client.ts`, `apps/mobile/app/(auth)/login.tsx`, `apps/mobile/app/(app)/index.tsx`, `apps/mobile/app/(app)/pos.tsx`, `apps/mobile/app/_layout.tsx`, the PR2 portions of `apps/mobile/tests/unit/tus-pos.test.ts`, `tests/foundation/p8-tus-delivery-pos.test.mjs`, and the PR2 task/progress entries. Do not revert PR1 resolver/transport files or unrelated pre-existing changes. |

### PR3 / Phase 3 Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `pnpm --filter @factory/mobile exec jest tests/unit/runtime-bootstrap.test.ts --runInBand` — exit 0; 1 suite passed, 8 tests passed, 0 failed. Regression command `pnpm --filter @factory/mobile exec jest tests/unit/runtime-bootstrap.test.ts tests/unit/runtime-profile.test.ts tests/unit/tus-auth.test.ts tests/unit/tus-pos.test.ts --runInBand` — exit 0; 4 suites passed, 41 tests passed, 0 failed. |
| Runtime harness command/scenario and exact result | `runtime-bootstrap.test.ts` mocked runtime reader, persistence, auth restore, and diagnostic sink — exit 0; invalid configuration produced an unavailable result with 0 persistence/auth calls, while dev/staging recorded diagnostics before storage/auth. `pnpm --filter @factory/mobile config:dev` and `config:staging` — exit 0; serialized identities report `http://localhost:3001`/TLS false and HTTPS staging/TLS true, storage `1`, TUS `1.0.0`. `node --test tests/foundation/p8-tus-delivery-pos.test.mjs tests/foundation/p9-delivery-pos.test.mjs` — exit 0; 14/14 provider-free API/mobile scenarios passed. `pnpm --filter @factory/mobile config:prod` — expected exit 1 on missing production API URL; fail-closed gate confirmed. |
| Rollback boundary | Revert only `apps/mobile/src/core/config/runtime-diagnostics.ts`, the PR3 changes in `apps/mobile/app/_layout.tsx`, `apps/mobile/tests/unit/runtime-bootstrap.test.ts`, and the PR3 task/progress entries. This removes diagnostics and unavailable-state rendering without reverting PR1 resolver/transport or PR2 isolation/quarantine behavior. |

### PR4 / Phase 4 Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-tus-runtime-readiness.test.mjs` — exit 0; 2 suites, 14 passed, 0 failed. The updated `p0-native-boundaries.test.mjs` also passes as part of the full suite. |
| Runtime harness command/scenario and exact result | Provider-free receipt harness: `node scripts/activation/tus-readiness.mjs render-native` and `aws-terraform` — both return `not-production-ready`, `unavailable-deferred`, `deferred`, `liveConformance: false`, ten missing external blockers, and disabled gated switches; no credentials or external calls. `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` — exit 0; 5 deferred-boundary tests pass with `TUS_POSTGRES_URL` unavailable. `node scripts/validation/portability/index.mjs` — exit 0; portability valid, plan-only, no cloud calls, no live conformance. |
| Rollback boundary | Revert only `docs/evidence/readiness/tus-matrix.md`, `docs/evidence/native-smoke.md`, the PR4 assertions in `tests/foundation/p9-activation.test.mjs` and `tests/foundation/p0-native-boundaries.test.mjs`, and the PR4 task/progress entries. Do not revert PR1–PR3 runtime code, activation gates, provider-disabled defaults, or durable state. |

## Additional Validation

- `pnpm --filter @factory/mobile typecheck` — exit 0.
- `pnpm --filter @factory/api typecheck` — exit 0.
- `pnpm --filter @factory/api build` — exit 0; Prisma generation and TypeScript compilation passed.
- `pnpm contracts:validate` — exit 0; 98 JSON Schema contracts validated. AJV ignored `date-time`, `uri`, and `email` format warnings remain non-blocking.
- `pnpm security:scan` — exit 0; no tracked-secret findings.
- `pnpm test` — exit 0 after the import portability correction; 464 passed, 0 failed, 0 skipped across 87 isolated suites. The initial run before that correction failed only because the new resolver's extensionless imports were not resolvable by the strip-only harness; the focused/API reruns above are green.
- `pnpm test` — exit 0 after updating the provider-free p8/p9 queue fixtures to the versioned runtime envelope; all discovered suites passed. The deterministic baseline remains 464 passed, 0 failed, 0 skipped across 87 isolated suites; Phase 4 still owns refreshing the evidence receipt.
- `pnpm build` — exit 0; contracts, config, API, and web build tasks completed (mobile has no build script in its package).
- `pnpm typecheck` — exit 0; 8 Turbo typecheck tasks successful, including mobile and API.
- `pnpm build` — exit 0; 4 Turbo build tasks successful (contracts, config, API, and web; mobile has no build script).
- `pnpm lint` — exit 0; 6 lint tasks successful. Five warnings remain in pre-existing PR1/PR2 mobile/API/web files; PR3 diagnostics introduced no lint errors or warnings.

### PR4 validation snapshot

- `pnpm test` — exit 0; **464 passed, 0 failed, 0 skipped across 87 isolated suites**.
- `pnpm contracts:validate` — exit 0; **98 JSON Schema contracts validated**. AJV ignored `date-time`, `uri`, and `email` format warnings remain non-blocking.
- `pnpm typecheck` — exit 0; **8 Turbo tasks successful**.
- `pnpm build` — exit 0; **4 Turbo tasks successful**; mobile has no build script.
- `pnpm lint` — exit 0; **6 tasks successful**; existing warnings remain non-blocking.
- `pnpm security:scan` — exit 0; no tracked-secret findings.
- `node scripts/security/validate-policy.mjs` — exit 0.
- `pnpm exec node scripts/validation/cloud-native/validate-plan.mjs` — exit 0; Render and AWS profiles valid, plan-only, `provisioned: false`, `cloudCalls: false`, `liveConformance: false`.
- `node scripts/validation/portability/index.mjs` — exit 0; valid, no cloud calls, no provisioning, `liveConformance: false`.
- `node scripts/activation/tus-readiness.mjs render-native` and `aws-terraform` — exit 0; both `not-production-ready`, `unavailable-deferred`, `evidenceClass: deferred`, `liveConformance: false`; blockers and gated switches remain disabled.
- `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` — exit 0; 5 deferred-boundary tests pass; authorized PostgreSQL URL unavailable.

The first full-suite attempt exceeded the 120-second tool wrapper timeout without a test failure; the rerun with a 600-second timeout completed successfully with the baseline above.

## Deferred External Evidence

Live providers, cloud runtime, PostgreSQL durability, physical device/browser conformance, POS pilot, compliance/legal/tax/KYC/KYB, production operations, and activation evidence remain deferred. No external credentials, provider calls, cloud calls, or production activation were attempted.

## Status

4/4 tasks complete. PR4 is ready for the parent orchestrator's next chained slice. Do not run `sdd-verify`, `sdd-archive`, or review lifecycle from this executor.
