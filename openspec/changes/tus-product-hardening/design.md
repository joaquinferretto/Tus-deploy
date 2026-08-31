# Design: TUS Product Hardening

## Technical Approach

Deliver the approved hardening scope in the existing pnpm/Turborepo Clean/Hexagonal boundaries: safety preflight, additive PostgreSQL durability, bounded runtime evidence, then deployment-contract checks. The application/database source is the repository-root `.env` `DATABASE_URL`; it is loaded internally, never logged, and is not overridden by ambient process variables. `Goldenrepo-js_py`, physical hardware/native certification, broad redesign, unrelated OpenSpec changes, and unproven variable removal remain excluded.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Database gate | Before any connection, migration, seed, or write, read only root `.env` `DATABASE_URL`; refuse explicit production (`NODE_ENV` or `FACTORY_PROFILE`) and require an existing local/test profile plus a local loopback target. | Implicit dotenv search; process-env precedence; six metadata variables; free-tier labels; reset-based setup. | Keeps the contract small while refusing targets whose non-production status cannot be proven from existing profile inputs. |
| Seed intent | The seed entrypoint requires the literal `seed` command argument. Without it, the operation returns redacted deferred evidence and performs no database action. | Import-time or default seeding. | Makes writes an explicit operator action without adding environment variables. |
| Persistence | Prisma/PostgreSQL remains the source of truth; transaction ports atomically persist product/service POS operation, receipt, version, audit, and outbox records with tenant-scoped idempotency and conflicts. | Application-only locks or provider-owned state. | Matches existing `PosStorePort`, readiness guard, and durable replay requirements. No new settlement, TLS/profile-gating, or receipt-hashing claim is introduced. |
| Process ownership | `OwnedChild` records and verifies exact PID, cwd, and argv. Startup, request, and shutdown each have an explicit deadline of ≤120 seconds. A `finally` path cleans up on success, failure, timeout, and interruption, waits for termination, and proves no owned PID remains. | Name-based killing or unbounded child lifetimes. | Prevents collateral termination and orphaned processes. |
| Environment contract | Create an inventory with source path, variable, consumer, canonical name/source, alias status, and removal evidence. `DATABASE_URL` is the sole database URL; existing `NODE_ENV`/`FACTORY_PROFILE` are the only safety profile inputs. | Delete variables based on local search only; runner URL aliases; six-field metadata. | Makes normalization auditable without adding proof variables or silently selecting another target. |

## Data Flow

```text
root .env DATABASE_URL + existing profile -> proof gate -> Prisma/app child
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
interface SafeTarget { status: 'ready' | 'deferred' | 'invalid'; source: 'root-dotenv-DATABASE_URL' | null; profile: string | null; environment: 'local' | 'test' | null; proof: { environment: 'local' | 'test' | null; nonProduction: boolean } }
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
