# Proposal: TUS Mobile Runtime Hardening

## Intent

Close the concrete mobile runtime risks identified by the v2 audit without adding product capability. Mobile builds must resolve one canonical API endpoint and runtime profile, isolate credentials and offline queues by profile, expose safe startup diagnostics, and keep readiness evidence truthful while external activation remains fail-closed.

## Scope

### In Scope

- Introduce one canonical mobile endpoint/profile resolver consumed by Expo config, auth, POS transport, bootstrap, and persistence; remove the `3000`/`3001` default split.
- Replace hardcoded `profile: 'dev'` in login, sign-out, credential storage, and POS/offline queue storage with the resolved runtime profile.
- Enforce profile-qualified storage/queue namespaces and prevent credentials or queued work from being read, written, or replayed across profiles; do not silently fall back to `dev`.
- Add non-secret startup diagnostics for resolved profile/endpoint and fail closed on invalid or contradictory runtime configuration.
- Refresh stale readiness/native-smoke evidence documents and counts to the current deterministic baseline of 464 tests, marking historical receipts as superseded.
- Preserve the existing fail-closed external activation decision and deferred evidence boundary.

### Out of Scope

- New mobile, POS, commerce, authentication, provider, or deployment features.
- PostgreSQL durability, provider calls, cloud runtime, browser conformance, physical-device testing, POS pilot, compliance/legal/tax/KYC/KYB, or production validation; these remain deferred external evidence.
- Replacing package-local no-op test scripts, broad cleanup, or unrelated web/API/runtime hardening.

## Capabilities

### New Capabilities

- `tus-mobile-runtime-isolation`: Canonical endpoint/profile resolution, isolated storage/queues, and startup diagnostics.
- `tus-mobile-evidence-freshness`: Current deterministic evidence receipts and explicit external-gate status.

### Modified Capabilities

- None; `openspec/specs/` has no authoritative existing capabilities.

## Approach

Define a typed resolver with explicit profile inputs and validated endpoint precedence. Thread its result through mobile composition and storage factories, derive profile-qualified keys, add focused regression tests for endpoint resolution and contamination, and update evidence receipts from the audit without promoting any deferred gate. External activation continues to require authorized evidence and denies by default.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/mobile/app.config.ts`, `apps/mobile/app/_layout.tsx` | Modified | Runtime resolver, validation, bootstrap, diagnostics. |
| `apps/mobile/src/application/`, `apps/mobile/src/store/`, `apps/mobile/app/(auth)/`, `apps/mobile/app/(app)/` | Modified | Transport, auth, credential, POS, and queue profile isolation. |
| `apps/mobile/tests/` | New/Modified | Resolver, endpoint, namespace, and fail-closed regressions. |
| `docs/evidence/readiness/tus-matrix.md`, `docs/evidence/native-smoke.md` | Modified | 464-test baseline and superseded-history labeling. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Existing persisted dev data becomes inaccessible under a corrected namespace | Medium | Keep namespaces deterministic and profile-local; never copy secrets or queues between profiles. |
| Invalid endpoint/profile configuration blocks a build or startup | Low | Validate explicitly, diagnose without secrets, and test expected fail-closed behavior. |

## Rollback Plan

Revert this change's resolver, namespace, diagnostics, tests, and evidence-document edits. Do not enable external activation during rollback; preserve existing fail-closed gates and quarantine any profile-ambiguous queued work rather than replaying it.

## Dependencies

- Existing Expo runtime configuration, mobile auth/POS storage abstractions, and the v2 audit's 464-test evidence.
- No external credentials or live services.

## Success Criteria

- [ ] All mobile transports and storage use the same validated endpoint/profile resolution; no production/staging path uses a hardcoded `dev` namespace.
- [ ] Regression tests prove cross-profile credential/queue isolation, invalid-config diagnostics, and fail-closed external activation.
- [ ] Evidence receipts report 464 deterministic tests and clearly defer PostgreSQL, providers, cloud, browser/device, POS, compliance, and production evidence.
