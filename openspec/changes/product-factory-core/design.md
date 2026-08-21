# Design: Product Factory Core

## Technical Approach

Amend only the foundation profile boundary. Keep Clean/Hexagonal contracts, PostgreSQL ownership, LangGraph authority, provider ports/fakes, and Compose unchanged. Add source-free wrappers around the Express API and Next web app. Native local is PostgreSQL-backed smoke, never integration or production evidence.

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Wrapper ownership | Create `backend/package.json` and `frontend/package.json`; each `dev` script invokes `scripts/dev/native-profile.mjs` with `api` or `web`, delegating to the existing app scripts. | Exact commands work without copied source, manifests, or secrets. |
| Environment precedence | Resolve the repository root from the wrapper/script location, form an explicit `<root>/.env` path, and use only its `DATABASE_URL` key as fallback. A non-empty process `DATABASE_URL` **wins** over the root `.env` value; the root path is never selected by cwd and values are never logged. | Makes overrides deterministic while satisfying explicit root-file resolution and secret non-disclosure. |
| Native readiness | PostgreSQL is required for API startup. MongoDB, Redis, Python worker, mobile support, and external providers each receive an individual mode/status report; native defaults are `disabled` or deterministic `fake`, with no provider network calls. | Optional capabilities remain honest without weakening Compose requirements. |
| Compose boundary | Compose keeps API, web, mobile support, Python, PostgreSQL, MongoDB, Redis, and deterministic fakes as its complete integration graph and independent gate. | Native smoke cannot falsely close integration acceptance. |

## Data Flow

```text
backend/frontend dev → native-profile.mjs → process DATABASE_URL or explicit root .env key → apps/api/apps/web
apps/api → PostgreSQL (required) → health/readiness with six dependency reports
optional capabilities → disabled/fake status (no cloud calls)
docker compose → complete graph → separate integration evidence
```

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/package.json`, `frontend/package.json` | Create | Source-free exact-command wrappers. |
| `scripts/dev/native-profile.mjs` | Create | Root resolution, precedence-safe single-key loading, redacted diagnostics, child delegation, exit propagation. |
| `packages/config/src/index.ts` | Modify | Native mode and dependency-state validation. |
| `apps/api/src/index.ts`, `server.ts`, `presentation/routes/health.ts` | Modify | Native bootstrap, PostgreSQL requirement, suppressed optional connections, individual redacted states; remove implicit cwd `.env` loading. |
| `apps/web`, `scripts/dev` | Modify | Native API/readiness and deterministic support behavior. |
| `docs/runbooks/local-profiles.md`, `docs/evidence/{native,compose}-smoke.md` | Create/modify | Commands, limitations, evidence schemas, and independent Docker gate. |
| `tests/foundation/*` | Modify/create | Precedence, state, wrapper, rollback, redaction, and profile-separation tests. |

## Interfaces / Contracts

```ts
type DependencyMode = 'required' | 'optional' | 'disabled' | 'fake'
type DependencyStatus = 'ready' | 'unavailable'
interface DependencyReport { mode: DependencyMode; status: DependencyStatus; blocksApiReadiness: boolean }
interface NativeReadiness {
  profile: 'native'; postgres: DependencyReport; mongodb: DependencyReport; redis: DependencyReport
  pythonWorker: DependencyReport; mobileSupport: DependencyReport; externalProviders: DependencyReport
}
```

Normative meanings: `required` must be configured and ready; `optional` may be absent/unreachable and reports `unavailable` without blocking API readiness, while calls fail explicitly. `disabled` makes no connection attempt and is readiness-neutral. `fake` selects a deterministic local adapter; failed initialization is `unavailable`, failing capability evidence but not native API readiness unless separately required. `unavailable` is observed inability to serve and blocks `/ready` only when mode is `required`. PostgreSQL is always required natively. Compose requires PostgreSQL, MongoDB, Redis, Python, and mobile support; external providers use required deterministic fakes.

The loader tests all four precedence cases: process/file both present (process wins), process only, file only, and neither (non-ready). No `.env` is copied into wrappers, evidence, or child workspaces.

## Testing Strategy

Unit/process tests use synthetic env files and spawned commands for precedence, explicit path, delegation, missing key, every state, redaction, and no copy. Native smoke records both commands, health, PostgreSQL, six states, and scans. Rollback injects a failing version, asserts traffic stops before partial serving, durable ledger/outbox/DLQ work remains replayable, and version/reason/health evidence is recorded. Compose independently runs `docker compose config` and complete readiness; without Docker this gate remains open and unverified.

## Threat Matrix

| Boundary | Applicability and response | Planned RED test |
|---|---|---|
| Documentation-like paths | N/A: only the explicit `.mjs` wrapper is executable; Markdown/manifests are never invoked. | None. |
| Git repository selection | N/A: script-path root resolution; no Git command. | None. |
| Commit state | N/A: no staging/commit automation. | None. |
| Push state | N/A: no ref or push resolution. | None. |
| PR commands | N/A: no PR command composition. | None. |

## Migration / Rollout

Before partial serving, mark the target non-ready and stop/drain traffic. Pause durable intake, checkpoint committed work, preserve ledger/outbox/DLQ records, and replay eligible unacknowledged work after rollback. Restore the last passing configuration or verified backup; record deployed/restored versions, reason, timestamps, operator, and health evidence. Preserve contracts and Compose independence. No data migration required.

## Open Questions

None; provider activation, regions, quotas, retention, and paid/live smoke remain implementation-time approvals.
