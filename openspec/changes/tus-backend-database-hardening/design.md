# Design: TUS Backend and Database Hardening

## Technical Approach

Deliver five sequential, gated slices: boot/configuration; target-specific additive schema; PostgreSQL durability; API controls; operations/evidence. The API does not listen until configuration, connectivity, and required schema checks pass. The verified remote-development seed remains explicit, idempotent, and development-only. Planning performs no service/database action and authorizes no provider call, replay, reset, `db push`, or untagged deletion.

## Architecture Decisions

| Decision | Choice | Rejected | Why |
|---|---|---|---|
| Process ownership | One bounded API process; separate Python worker; no respawn. | CPU-sized `cluster.fork()` | Deterministic startup, drain, cleanup, and evidence. |
| Database authority | Root `.env` `DATABASE_URL`; shared Prisma/`pg` lifecycle. | Package defaults, `WORKER_POSTGRES_DSN`, alternate URLs | Prevents target drift. |
| Lineage | New forward-only additive baseline plus explicit activation marker, not historical reconciliation. | Replay 25 migrations; reset, `db push`, destructive down-migration | Target has no ledger and backlog contains destructive SQL. |
| Durable boundary | One PostgreSQL transaction for tenant operation, idempotency, POS receipt/version, audit, and outbox. | Distributed 2PC; Redis/Mongo ownership | Matches `PostgresOwnership`; restore/replay remains possible. |
| Claims | Providers are `disabled`/`external-blocked` until separately evidenced. | Treating configuration as live proof | Production and provider claims fail closed. |

## Data Flow

`root .env → RuntimeConfig → DB connect (60s + one retry) → schema/readiness → route → tenant transaction → audit/outbox → bounded worker/projection`

## File Changes

| File | Action | Design |
|---|---|---|
| `apps/api/src/index.ts`; `apps/api/src/server.ts` | Modify | Replace cluster/respawn with injectable start, listener drain, signal handling, and owned shutdown. |
| `apps/api/src/platform/configuration/{composition.ts,domain.ts,ports.ts,application/configuration-service.ts}`; `apps/api/src/infrastructure/database/{prisma/client.ts,postgres/pool.ts}` | Modify/create | Validate root env, use 60,000 ms per lifecycle, exactly two attempts total, close failed pools, probe schema, redact diagnostics. |
| `apps/api/src/presentation/routes/health.ts`; `presentation/middleware/{correlation.ts,cors.ts,rate-limit.ts,error.ts}` | Modify/create | Non-mutating schema-aware `/ready`, correlation wiring, strict origin/header policy, body/request limits, unified redacted errors. |
| `apps/api/prisma/schema.prisma`; `apps/api/prisma/migrations/20260831_tus_backend_hardening_additive_baseline/migration.sql`; `scripts/{assert-additive-sql.mjs,postgres-schema-preflight.mjs,postgres-backup-gate.mjs}` | Modify/create | Selected tables/constraints/indexes and forward marker; static allowlist rejects `DROP`, `TRUNCATE`, `CASCADE`, reset, replay, and untagged delete. |
| `apps/api/src/tus/{adapters/prisma.ts,adapters/delivery-pos.ts,pos/index.ts,http/router.ts}`; `src/platform/{composition.ts,idempotency/{sql.ts,adapters/postgres.ts},outbox/{sql.ts,adapters/postgres.ts},run-ledger/postgres.ts}` | Modify | Tenant-composite predicates, CAS versions, fenced claim completion/failure, and atomic POS/idempotency/audit/outbox/recovery paths. |
| `apps/api/src/auth-security/{composition.ts,adapters/postgres/prisma-identity-store.ts,ports/security.ts}`; `src/tenancy/{adapters/prisma.ts,http/tenant-context.ts}` | Modify | Durable revocation/audit, deny-by-default authorization, and tenant propagation. |
| `apps/workflow-runtime-python/src/worker/{core/config.py,lifecycle/worker.py}`; `render.yaml`; `docker-compose.yml`; `docs/runbooks/{backup-restore.md,migration-rollback.md,job-replay.md,tus-deployment.md}` | Modify | Canonical env/ownership, bounded worker shutdown, deployment gates, restore/recovery, and evidence classes. |
| `tests/foundation/**`; `tests/integration/tus/{postgres-http-smoke.test.mjs,migration-repair.test.mjs,postgres-seed.test.mjs}`; new `backend-hardening.test.mjs` | Create/modify | RED/GREEN gates, preservation, concurrency/failure injection, bounded cleanup, and evidence classification. |

## Interfaces / Contracts

```ts
interface RuntimeConfig { databaseUrl: string; dbAttemptTimeoutMs: 60000; dbMaxAttempts: 2; shutdownTimeoutMs: number; providersEnabled: false }
interface DatabaseLifecycle { connect(): Promise<void>; checkSchema(): Promise<SchemaReadiness>; close(): Promise<void> }
interface SchemaReadiness { compatible: boolean; activation: string; missing: string[]; migration: 'forward-only' | 'unverified' }
interface TenantTransaction { tenantId: string; actorId: string; correlationId: string; idempotencyKey?: string }
```

Preserve `PosStorePort`, `PlatformTransactionPort`, `PostgresTransactionClient`, `AuditSink`, provider ports, and Python lifecycle contracts. Stale tenant/claim IDs produce no mutation. `/ready` is 200 only for compatible schema and non-blocking dependencies; otherwise 503 without writes. Seed allows only non-production `local|test` or operator-confirmed non-production `development`.

## Testing Strategy

| Layer | Required proof |
|---|---|
| Unit/static | Config precedence, two attempts, redaction, SQL gate, tenant predicates, CAS/fences, errors/CORS/limits, provider-zero. |
| Integration | Disposable PostgreSQL boot/readiness, additive row preservation/shape checks, concurrent idempotency/POS/outbox, injected rollback, recovery, and cleanup. Missing backup or ambiguous target stops before DDL. |
| E2E | N/A: no repository E2E harness; browser/mobile remains separately classified. |

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior; RED test |
|---|---|---|
| Documentation-like paths | N/A — no executable-file classification change. | No task/test. |
| Git repository selection | N/A — no VCS automation. | No task/test. |
| Commit state | N/A — no commit automation. | No task/test. |
| Push state | N/A — no push automation. | No task/test. |
| PR commands | N/A — no PR automation. | No task/test. |

Routing/process RED coverage additionally proves unknown routes use the redacted envelope, failed second DB attempt never listens, shutdown closes owned resources by deadline, and worker/provider boundaries cannot report ready without evidence.

## Migration / Rollout

Gate order: boot tests → verified backup/restore and target/schema/data preflight → static SQL approval → additive DDL/marker → PostgreSQL durability → controls → deployment/evidence. Roll back app/config to the last passing pair. Database rollback is only verified restore into an isolated/approved target; preserve ledger, outbox, audit, DLQ, and recovery records. Never reverse with destructive SQL or historical replay.

## Open Questions

- [ ] Operator must approve the exact additive activation surface and backup reference before live DDL; until then status is `external-blocked`/`not-production-ready`.
