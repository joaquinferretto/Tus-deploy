# Design: TUS Mobile Runtime Hardening

## Technical Approach

This revision reconciles both authoritative specs: `tus-mobile-runtime-isolation`
and `tus-mobile-evidence-freshness`. A pure typed resolver produces one mobile
`{ profile, apiUrl }` identity plus TUS contract/storage versions. Expo config
serializes it; bootstrap, auth, POS, Axios, and persistence receive that same
object. No consumer reads environment variables independently or defaults to
`dev`. Invalid configuration blocks startup. Existing TUS readiness remains the
authority and external providers stay disabled.

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime identity | Create `apps/mobile/src/core/config/runtime-profile.ts`; require one valid profile, reject profile/TLS contradictions, normalize the endpoint, and use the versioned `/tus/v1/pos/manual-operations` route. | Eliminates the current `3000`/`3001` and per-client `dev` drift. |
| Composition | Pass `MobileRuntimeConfig` to Expo, `app/_layout.tsx`, auth, POS, Axios, and stores. | A single dependency-injected value makes profile and endpoint agreement testable. |
| Isolation | Use profile-qualified SecureStore/MMKV/Zustand/queue namespaces and a queue envelope containing profile, storage version, and `1.0.0` operation metadata. | Prevents credential reads, writes, clears, encryption-key lookup, and replay across profiles. |
| Failure/evidence | Redacted diagnostics precede dependent bootstrap; refresh only bounded local receipts. | Missing/invalid identity cannot become authenticated state or live authorization. |

## Data Flow

```text
APP_PROFILE + Expo extra → runtime resolver → MobileRuntimeConfig
                                      ├→ Expo metadata / diagnostics
                                      ├→ auth + Axios + POS transports
                                      └→ SecureStore, MMKV, Zustand, queue(profile, version)
server session → @factory/contracts parsers → tenant-scoped auth store
queue envelope → profile/version validation → same-profile replay only
```

`app.config.ts` resolves at build time. `app/_layout.tsx` parses the serialized
runtime once, records profile, redacted endpoint, validation status, TLS mode,
and versions, then initializes storage/auth. Failure renders unavailable state,
makes no authenticated/POS request, and prevents queue replay.

## Requirement-to-implementation Map

| Spec requirement | Concrete implementation and RED→GREEN coverage |
|---|---|
| Canonical resolution; invalid identity | `apps/mobile/src/core/config/runtime-profile.ts`, `app.config.ts`, `app/_layout.tsx`; new `apps/mobile/tests/unit/runtime-profile.test.ts` covers shared staging identity, malformed/unknown input, contradictory TLS, and no `dev` fallback. |
| Profile-isolated credentials; absent metadata | `apps/mobile/src/core/services/secure-credential-store.ts`; `runtime-profile.test.ts` and `tus-auth.test.ts` prove staging cannot read/write/clear dev values or encryption keys and invalid metadata fails closed. |
| Profile-isolated queues and app state | `mmkv-storage.ts`, `src/store/app-store.ts`, `src/application/tus-client.ts`, `(app)/pos.tsx`; `tus-pos.test.ts` covers dev/staging separation, envelope mismatch quarantine, pending/conflict preservation, and no success claim. |
| Safe diagnostics/fail-fast startup | New `apps/mobile/src/core/config/runtime-diagnostics.ts`, `_layout.tsx`; runtime tests assert redaction, and a bootstrap test asserts invalid prod/TLS config stops auth/POS traffic. |
| Endpoint, route, contract `1.0.0` | `src/application/tus-auth.ts`, `src/application/tus-client.ts`, `src/core/services/axios-api-client.ts`, login/sign-out/POS screens; mobile tests and `tests/foundation/p8-tus-delivery-pos.test.mjs` capture identical endpoint, `/tus/v1/pos/manual-operations`, and versioned payload. |
| External boundary unchanged | No activation source changes; `tests/foundation/p9-activation.test.mjs` retains deferred denial, no credentials/provider payloads, and no external calls. |
| Current evidence | `docs/evidence/readiness/tus-matrix.md` and `docs/evidence/native-smoke.md` record `pnpm test` = 464 passed, 0 failed, 0 skipped across 87 isolated suites, with revision/date and local-deterministic boundary. |
| Historical/scope evidence | The same receipts mark 29/29, 440, and old blocked-scan statements superseded; retain explicit non-goals for PostgreSQL, providers, cloud, browser/device, POS pilot, compliance, and production operations. |

## Interfaces / Contracts

```ts
type MobileProfile = 'dev' | 'staging' | 'prod'
interface MobileRuntimeConfig {
  profile: MobileProfile; apiUrl: string; requireTls: boolean
  storageVersion: 1; tusContractVersion: '1.0.0'
  featureFlags: { offlineCache: boolean; mockAuth: boolean }
}
interface MobileQueueEnvelope {
  profile: MobileProfile; storageVersion: 1
  operations: ManualPosOperation[]
}
```

Existing `TusAuthenticatedSession`, `TusSessionContext`, `TusPosOperation`, and
readiness evidence/decision contracts remain unchanged. Invalid or ambiguous
queue metadata is quarantined and surfaced as unavailable.

## Testing Strategy

Unit Jest/jest-expo tests inject env, Expo payloads, and fake stores. Integration-
style provider-free harnesses verify transport URL/profile agreement and queue
replay. Evidence tests verify the 464/0/0 receipts and `unavailable-deferred`
activation. No live provider, cloud, device, or production test is introduced.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary is changed.

## Migration / Rollout

Only same-profile, explicitly recognized state may be upgraded to the versioned
namespace. Credentials are not copied across profiles. Legacy or conflicting
queue records are retained in quarantine and never replayed. On migration or
startup failure, stop replay, preserve old records, restore the last passing app
version, and keep providers/routes/release/fleet activation fail-closed. Rollback
reverts only resolver, namespace, diagnostics, tests, and evidence changes.

## Open Questions

None. The specs confirm storage version `1` and shared TUS contract version `1.0.0`.
