# Design: TUS Live Runtime Correction

## Technical Approach

Extend the existing provider-free Node runner and Prisma composition. Resolve an explicit environment object as `TUS_POSTGRES_URL` then `DATABASE_URL`; never read `.env` or emit secrets. A proven disposable target gates schema, migration, fixtures, authenticated HTTP/POS, and cleanup. Missing or unsafe prerequisites produce deferred evidence, never a pass or activation signal.

## Architecture Decisions

| Choice | Alternatives rejected | Rationale |
|---|---|---|
| One resolver/gate contract in `scripts/test-runner-lib.mjs`. | Independent environment reads. | Prevents precedence/redaction drift. |
| Tenant/shift `TusPosVersion` plus Prisma `$transaction`. | Operation-count versions or separate writes. | Makes versions durable and POS effects atomic. |
| Smoke is `local-postgresql-http`/`local-verification`. | Production or external evidence. | Proves local durability without authorizing providers, settlement, or production. |

## Data Flow

```text
env object → resolve/redact target → disposable + operation gates
  → Prisma schema/migration check → bounded API child (Express + Prisma)
  → register/sign-in → fleet readiness + device/session → product/service POS
  → delivery proof/handoff, replay/conflict, restart → counts/evidence
  → stop child + close pool + targeted fixture cleanup
```

The resolver requires PostgreSQL syntax, `TUS_POSTGRES_DISPOSABLE=1`, a target identifier, and non-production classification. Migration requires explicit opt-in; writes and cleanup are limited to generated fixture IDs. Drop/reset/database-wide destructive commands are denied. Diagnostics expose source, profile, role, service, target identity, reason, owner, and placeholder rerun command—never URL, password, token, query, or provider payload.

## File Changes

| File | Action | Description |
|---|---|---|
| `scripts/test-runner-lib.mjs` | Modify | Resolver, redaction, gates, scenario evidence, fixed-argv child lifecycle, restart, cleanup. |
| `tests/integration/tus/postgres-http-smoke.test.mjs` | Modify | RED cases for target states, no side effects, authenticated POS/delivery, replay/conflict, cleanup, and provider non-interaction. |
| `apps/api/src/tus/pos/index.ts`, `apps/api/src/tus/adapters/delivery-pos.ts` | Modify | Transactional POS port, durable versions, audit/outbox reads, failure atomicity; retain in-memory parity. |
| `apps/api/src/tus/composition/index.ts`, `apps/api/src/tus/http/router.ts`, `apps/api/prisma/schema.prisma` | Modify | Wire Prisma POS and preserve `/tus/v1/pos/*` auth/device/session/delivery contracts. |
| `apps/api/prisma/migrations/*_tus_pos_runtime_correction/migration.sql` | Create | Additive `TusPosVersion` table/indexes; no destructive migration. |
| `apps/mobile/src/application/tus-client.ts`, `apps/mobile/tests/unit/tus-pos.test.ts` | Modify | Assert canonical authenticated POS route and response mapping for offline replay. |
| `scripts/activation/tus-readiness.mjs`, `docs/evidence/readiness/tus-matrix.md` | Modify | Separate local/deferred evidence; local PostgreSQL never enables production or `liveConformance`. |

## Interfaces / Contracts

```ts
type TargetStatus = 'no-target'|'invalid-target'|'unsafe-target'|'ready'
interface PostgresTarget { status: TargetStatus; source: 'TUS_POSTGRES_URL'|'DATABASE_URL'|null; redactedTarget: string|null; targetId: string|null; reason: string; rerunCommand: string }
interface PosStorePort { transaction<T>(run: (store: PosStorePort) => Promise<T>): Promise<T>; getVersion(tenantId: string, shiftId: string): Promise<number>; incrementVersion(tenantId: string, shiftId: string, expected: number): Promise<number> }
```

Stable scenario keys: `authenticatedHttp`, `deviceSession`, `productPos`, `servicePos`, `offlineReplay`, `versionConflict`, `receiptIntegrity`, `deliveryHandoff`, `auditOutbox`, `restartReplay`, `cleanup`, `rollback`, `providerNonInteraction`.

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Unit/contract | Resolver, redaction, gates, version/transaction failures, route mapping | Injected env, fake Prisma delegates, provider spies; RED first. |
| Integration | Authenticated disposable PostgreSQL HTTP/POS and restart | Fixed `execFile` argv/env, two tenants, readiness, stop/start, replay, hash/version conflict, durable counts. |
| Deferred/operational | All unavailable/error/timeout/cleanup states | Assert no side effects, resource closure, original classification, `liveConformance:false`; separate local/live evidence. |

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior | Planned RED test |
|---|---|---|---|
| HTTP route/version and auth/POS process integration | Applicable | Canonical `/tus/v1/pos/*` requires bearer session, tenant/device/session authority and fleet readiness; failures are 401/403/409 with no business effects. | Auth, cross-tenant, closed-session, readiness, route/version parity. |
| Shell commands/subprocess lifecycle | Applicable | Use fixed executable/argv, explicit `DATABASE_URL`, no shell interpolation; bounded timeout kills and awaits API child, closes Prisma/pool. | Secret-free argv/env assertion; timeout/error leaves no live child/pool. |
| Documentation-like paths | N/A — no executable-file classification changes. | No execution. | None. |
| Git repository selection | N/A — no VCS automation. | No repository selection. | None. |
| Commit state | N/A — executor must not commit. | No index/worktree command. | None. |
| Push state | N/A — executor must not push. | No remote/ref resolution. | None. |
| PR commands | N/A — no PR automation. | No command composition. | None. |

## Migration / Rollout

Apply the additive version migration only after the target gate passes. Run RED tests, then implementation and deterministic suites; run the PostgreSQL pilot only when prerequisites are proven. On failure, stop intake, drain/quarantine work, preserve audit/outbox/ledger/DLQ/evidence, close resources, and delete only unique disposable fixtures; financial rollback remains append-only and destructive rollback is false. Activation remains `not-production-ready`/`unavailable-deferred` for missing external evidence. No production or provider rollout is authorized.

## Open Questions

- [ ] External owner must supply the authorized disposable PostgreSQL target and readiness fixture evidence before the live branch can produce passed local PostgreSQL evidence.
