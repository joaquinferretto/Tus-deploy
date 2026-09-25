# Web Evidence: TUS Argentina Market Launch

## Scope

Phase 10 web/PWA contract and deterministic UI evidence only. No live API, database,
payment provider, browser, device, Docker, or deployment runtime was used.

## Deterministic Evidence

| Check | Result |
|---|---|
| `tests/foundation/tus-web-pwa.test.mjs` | Passed: 6/6 |
| Combined Phase 10 focused UI set | Passed: 42/42 |
| `pnpm --filter @factory/web typecheck` | Passed |
| `git diff --check` | Passed |
| Web production compilation | Compiled, typechecked, linted, and generated 14 pages; final standalone trace failed on Windows `EPERM` dependency symlink creation |

## Covered Contracts

- Customer registration and recovery routes are explicit and do not accept client-authored tenant authority.
- Service slots include an encoded requested date; booking and payment-intent mutations carry stable idempotency keys.
- POS status is read-only and offline records are marked `queued-offline` without persisting the bearer token.
- POS refresh checks operation status and does not resubmit a previously recorded sale; offline status checks remain pending without a provider call.
- Delivery-task and support-case routes are available through the web client.
- Payment presentations distinguish pending, approved, rejected, and refunded without claiming settlement.
- UI errors are redacted to a bounded retry/support message and do not expose SQL URLs, tokens, or secrets.
- Fetch transports use explicit bearer authorization and omit ambient cookies.
- Auth bearer credentials remain module-volatile; browser storage is not read or written for token recovery, and a full reload requires fresh sign-in.
- Install/update/offline copy distinguishes PWA installability from online server operation.

## Evidence Boundary

The deterministic suite proves source contracts and request shaping only. It does not prove
live authentication, tenant authorization, calendar persistence, payment-provider outcomes,
delivery execution, support handoff, browser rendering, offline replay, or deployment health.
Those require the verify-stage runtime and external evidence gates.

## Recovery Result Fields

- `status`: `success`
- `executive_summary`: Revalidated Phase 10 and corrected only POS status refresh and browser token persistence boundaries.
- `artifacts`: web/PWA source, focused tests, `apply-progress.md`, and this evidence file.
- `tasks_completed`: `10.1` remains checked; cumulative progress is 8/14.
- `tests`: focused Phase 10/UI set 42/42; web typecheck passed after build-generated Next types; build compiled/typechecked/linted/generated 14 pages and then hit Windows EPERM during standalone tracing.
- `browser_effects`: none.
- `database_effects`: none.
- `risks`: volatile auth requires fresh sign-in after a full reload; live/browser/provider/database/deployment proof remains unavailable.
- `next_recommended`: `sdd-verify` after remaining implementation tasks.
- `skill_resolution`: fallback-path; requested paths loaded, with CodeGraph fallback due unavailable upstream CLI.
- `cleanup_state`: no runtime or external resources started; no cleanup required.
