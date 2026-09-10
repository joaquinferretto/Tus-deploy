# Phase 11 Mobile Evidence

## Scope

This evidence covers the native mobile/POS implementation only. `Goldenrepo-js_py` remains excluded. No database, payment provider, API service, browser session, Docker runtime, deployment, native device, or emulator was used.

## Implementation

- `apps/mobile/src/application/tus-surface-client.ts` provides typed mobile surfaces for device/session/POS status/refund, marketplace, booking, payment, delivery, and support flows.
- `apps/mobile/src/application/tus-client.ts` keeps offline POS operations durable and strips `accessToken` before queue persistence or request-body serialization. Secure credentials are resolved at request time.
- `apps/mobile/src/application/mobile-lifecycle.ts` coalesces reconnect/foreground synchronization.
- `apps/mobile/src/application/tus-auth.ts`, `apps/mobile/app/(auth)/login.tsx`, and `apps/mobile/app/(auth)/recovery.tsx` provide secure registration/recovery flows.
- `apps/mobile/app/(app)/pos.tsx` subscribes to native connectivity/foreground events and exposes status-only refresh without resubmitting sales.
- Replay transport now ignores any legacy/in-memory `operation.accessToken` and resolves the current bearer from secure credential storage for every POS request and status lookup.

## TDD Evidence

| Stage | Evidence |
|---|---|
| RED | Runtime-contract coverage initially failed for missing POS status refresh; the queue-security test initially observed an access token in persisted JSON. |
| GREEN | `pnpm.cmd --filter @factory/mobile exec jest tests/unit --runInBand`: 11 suites passed, 69 tests passed. The recovery assertion also fails if a stale operation token wins over secure storage. |
| REFACTOR | Lifecycle synchronization uses a stable ref callback; replay transport reads the current bearer from secure storage and queue envelopes/in-memory replay operations contain no access token. |

## Verification

- TypeScript: passed with `pnpm.cmd --filter @factory/mobile typecheck`.
- ESLint: exit 0, no errors; 11 warnings remain in existing/style-only patterns.
- Expo staging config: passed; profile `staging`, scheme `factory-staging`, web/iOS/Android platforms.
- Expo web export: passed from `apps/mobile` with `APP_PROFILE=staging`; 787 modules bundled and export files generated.

## Runtime Boundary

Native device/emulator evidence is unavailable in this environment and is not claimed. The runtime harness value for this work unit is `N/A` because execution was limited to deterministic unit/source-contract tests and local Expo web bundling.

## Rollback Boundary

Revert the Phase 11 mobile files, Phase 11 tests, `mobile-evidence.md`, and the Phase 11 section of `apply-progress.md`. Do not revert unrelated web or prior-phase changes.
