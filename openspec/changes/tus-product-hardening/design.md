# Design: TUS Product Hardening

## Technical Approach

Deliver the approved hardening scope in the existing pnpm/Turborepo Clean/Hexagonal boundaries: safety preflight, additive PostgreSQL durability, bounded runtime evidence, then deployment-contract checks. The application/database source is the repository-root `.env` `DATABASE_URL`; it is loaded internally, never logged, and is not overridden by ambient process variables. `Goldenrepo-js_py`, physical hardware/native certification, broad redesign, unrelated OpenSpec changes, and unproven variable removal remain excluded.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Database gate | Before any connection, migration, seed, or write, validate URL syntax and proof fields: `TUS_TEST_TARGET_IDENTITY`, `TUS_TEST_TARGET_ID`, `TUS_TEST_TARGET_OWNER`, `TUS_TEST_TARGET_DISPOSABLE=true`, `TUS_TEST_TARGET_ENV=local|test`, and `TUS_TEST_TARGET_NON_PRODUCTION=true`. | Implicit dotenv search; process-env precedence; reset-based setup. | Proves the exact target, disposable ownership, and non-production status before side effects. |
| Test override | `TUS_TEST_RUNNER_POSTGRES_URL` is the only separately named runner override. Existing `TUS_POSTGRES_URL`, if retained, is a runner-only alias; it can never configure the application. Its normalized identity must match the proof identity and the root `.env` safety contract, or the run fails closed. | Letting a runner URL bypass `DATABASE_URL` validation. | Preserves the approved application source while allowing explicitly isolated tests. |
| Persistence | Prisma/PostgreSQL remains the source of truth; transaction ports atomically persist product/service POS operation, receipt, version, audit, and outbox records with tenant-scoped idempotency and conflicts. | Application-only locks or provider-owned state. | Matches existing `PosStorePort`, readiness guard, and durable replay requirements. No new settlement, TLS/profile-gating, or receipt-hashing claim is introduced. |
| Process ownership | `OwnedChild` records and verifies exact PID, cwd, and argv. Startup, request, and shutdown each have an explicit deadline of ≤120 seconds. A `finally` path cleans up on success, failure, timeout, and interruption, waits for termination, and proves no owned PID remains. | Name-based killing or unbounded child lifetimes. | Prevents collateral termination and orphaned processes. |
| Environment contract | Create an inventory with source path, variable, consumer, canonical name/source, alias status, and removal evidence. Aliases remain supported with clear failure behavior until repository-wide proof shows they are unused. | Delete variables based on local search only. | Makes normalization auditable across code, tests, docs, and manifests. |

## Data Flow

```text
root .env DATABASE_URL -> proof gate -> Prisma/app or isolated runner child
authenticated web/mobile/POS -> API ports -> tenant transaction -> audit/outbox
owned child -> bounded request -> finally cleanup -> redacted evidence index
```

## File Changes

| File | Action | Description |
|---|---|---|
| `scripts/test-runner-lib.mjs`, `scripts/dev/native-profile.mjs` | Modify | Root-`.env` resolver, proof gate, allowlisted child environment, deadlines, PID/cwd/argv verification, and `finally` cleanup. |
| `docs/runbooks/tus-environment-consumer-inventory.md` | Create | Actionable consumer inventory and evidence log before any alias removal. |
| `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<timestamp>_tus_product_hardening/migration.sql`, `apps/api/prisma/seed.ts` | Modify/Create | Additive tenant constraints/indexes and explicit namespaced idempotent fixtures with tagged cleanup. |
| `apps/api/src/tus/pos/index.ts`, `apps/api/src/tus/ports/index.ts`, readiness/composition adapters | Modify | Preserve injected ports; complete atomic POS, conflict, audit/outbox, replay, and recovery behavior. |
| `tests/integration/tus/postgres-http-smoke.test.mjs`, `tests/foundation/p9-tus-runtime-readiness.test.mjs` | Modify | RED tests for proof ordering, zero unsafe side effects, idempotency, isolation, deadlines, interruption, cleanup, and evidence classification. |
| `scripts/audit/tus-runtime-audit.mjs`, `tests/integration/tus/tus-runtime-audit.test.mjs`, manifests/docs | Create/Modify | Finite authenticated web, mobile, and POS checks with screenshots and deployment-contract evidence. |

## Interfaces / Contracts

```ts
interface SafeTarget { status: 'ready' | 'deferred' | 'invalid'; source: 'root-dotenv-DATABASE_URL' | 'test-runner-override' | null; identity: string | null; proof: { targetId: string; owner: string; disposable: true; environment: 'local' | 'test'; nonProduction: true } }
interface OwnedChild { pid: number; cwd: string; argv: readonly string[]; startupMs: number; requestMs: number; shutdownMs: number; stop(): Promise<void>; verify(): Promise<boolean> }
interface EvidenceReceipt { tag: 'deterministic' | 'real-postgres' | 'browser/mobile' | 'deployment' | 'external-blocked'; status: 'passed' | 'deferred' | 'failed'; liveConformance: false | true; redacted: true }
```

## Testing Strategy

Unit and integration tests run first under strict TDD, with no secret values. PostgreSQL tests use only a proven disposable target and otherwise perform zero actions. Runtime tests require authenticated API, web, mobile, and POS journeys, finite Playwright/Chrome DevTools checks, screenshots, and ≤180-second flow bounds. Unavailable hardware, device, or provider paths are `external-blocked` and never success.

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior | Planned RED tests |
|---|---|---|---|
| Shell/process integration | Applicable | Exact PID/cwd/argv ownership; ≤120s per deadline; `finally` cleanup; timeout/interruption fails closed with no orphan. | Startup, request, shutdown timeout; interruption; mismatched PID/cwd/argv. |
| Documentation-like paths | N/A — no documentation execution/classification feature. | N/A | None |
| Git repository selection | N/A — no Git command automation. | N/A | None |
| Commit state | N/A — no commit automation. | N/A | None |
| Push state | N/A — no push automation. | N/A | None |
| PR commands | N/A — single-PR coordination is not runner behavior. | N/A | None |

## Migration / Rollout

Preflight duplicate/orphan checks precede additive migration; seed and cleanup are tagged and non-destructive. Roll out in the approved single PR: safety, schema/fixtures, real PostgreSQL evidence, authenticated runtime evidence, then local/Render/Vercel contract checks. Rollback reverts by phase or uses approved recovery; never reset, truncate, or delete untagged data. Provider/cloud/compliance claims stay fail-closed.

## Open Questions

None blocking. Runtime owner proof and device/provider availability determine `real-postgres`, `browser/mobile`, or `external-blocked` evidence only.
