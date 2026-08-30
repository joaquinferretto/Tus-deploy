# Tasks: TUS Mobile Runtime Hardening

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 420–600 |
| 400-line budget risk | Low (configured budget: 99999) |
| Chained PRs recommended | Yes (forced) |
| Suggested split | PR1 resolver → PR2 isolation → PR3 diagnostics → PR4 evidence |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | PR | Focused command | Harness | Rollback |
|---|---|---|---|---|---|
| 1 | Canonical identity | 1 | runtime-profile Jest | fake env/Expo | resolver/config/transports |
| 2 | Isolation/quarantine | 2 | auth/POS Jest | in-memory replay | storage/queue/screens |
| 3 | Startup/versioning | 3 | bootstrap Jest | mocked Constants/fetch | diagnostics/layout |
| 4 | Evidence refresh | 4 | activation/readiness | provider-free fixture | evidence docs/tests |

Chain bases: PR1=`feature/tus-mobile-runtime-hardening`; PR2=PR1; PR3=PR2; PR4=PR3.

## Phase 1: Canonical Resolver and Transports

- [x] **1.1 RED → GREEN → REFACTOR:** Test then implement `apps/mobile/src/core/config/runtime-profile.ts`, `apps/mobile/app.config.ts`, `apps/mobile/src/application/{tus-auth,tus-client}.ts`, and `apps/mobile/src/core/services/axios-api-client.ts` for one normalized staging identity, invalid/contradictory TLS rejection, no `dev` fallback, canonical route, and `1.0.0`; command `pnpm --filter @factory/mobile exec jest tests/unit/runtime-profile.test.ts --runInBand`; harness: fake env/Expo payload/request capture; rollback: listed files plus `apps/mobile/tests/unit/runtime-profile.test.ts`; deferred: live providers/cloud/device.

## Phase 2: Profile-Isolated Storage and Queue Quarantine

- [x] **2.1 RED → GREEN → REFACTOR:** Test then implement `apps/mobile/src/core/services/{secure-credential-store,mmkv-storage}.ts`, `apps/mobile/src/store/app-store.ts`, `apps/mobile/src/application/tus-client.ts`, `apps/mobile/app/(auth)/login.tsx`, `apps/mobile/app/(app)/index.tsx`, and `apps/mobile/app/(app)/pos.tsx` for profile-only credentials/keys/state, invalid metadata failure, envelope mismatch quarantine, and preserved pending/conflict states; command `pnpm --filter @factory/mobile exec jest tests/unit/tus-auth.test.ts tests/unit/tus-pos.test.ts --runInBand`; harness: in-memory stores/replay; rollback: listed files plus those tests; deferred: PostgreSQL, POS pilot, providers, production.

## Phase 3: Startup Diagnostics and Version Consistency

- [x] **3.1 RED → GREEN → REFACTOR:** Test then implement `apps/mobile/src/core/config/runtime-diagnostics.ts` and `apps/mobile/app/_layout.tsx` for redacted profile/endpoint/TLS/version diagnostics, invalid-config unavailable state, zero auth/POS requests, storage `1`, TUS `1.0.0`, and `/tus/v1/pos/manual-operations`; command `pnpm --filter @factory/mobile exec jest tests/unit/runtime-bootstrap.test.ts --runInBand`; harness: mocked Constants/fetch/sink; rollback: listed files plus `apps/mobile/tests/unit/runtime-bootstrap.test.ts`; deferred: activation and external evidence.

## Phase 4: Evidence and Documentation Refresh

- [x] **4.1 RED → GREEN → REFACTOR:** Test then update `docs/evidence/readiness/tus-matrix.md` and `docs/evidence/native-smoke.md` to current `pnpm test` **464/0/0 across 87 suites**, superseding `440`/`29/29`/old scan claims while retaining `not-production-ready`, `unavailable-deferred`, `liveConformance: false`, disabled routes/providers/jobs, and blockers; command `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-tus-runtime-readiness.test.mjs`; harness: provider-free readiness fixture; rollback: listed docs/tests; deferred: PostgreSQL, providers, cloud, browser/device, POS pilot, compliance, production operations.

Threat matrix: N/A in reconciled design; no additional threat-case RED tests apply.
