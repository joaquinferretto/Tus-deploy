# Tasks: TUS Backend and Database Hardening

**Scope guard:** Delta-only; reuse prior `tus-product-hardening`, `tus-additive-migration-repair`, and `tus-real-db-runtime-audit` work. Exclude `Goldenrepo-js_py`, providers/cloud/compliance/production activation, physical hardware, and destructive historical migration work. Planning starts nothing and connects nowhere.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,600–2,600 authored |
| 400-line budget risk | High; approved single-PR size exception |
| Chained PRs recommended | No |
| Suggested split | One PR; seven ordered units |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

**Every checkbox:** strict `RED→GREEN→REFACTOR`; task ≤15m, test ≤120s, HTTP ≤30s, cleanup ≤120s; DB 60s/attempt + one retry; `RB` rollback, `EV` evidence, `NS` no URLs/tokens/raw errors/internal paths.

### Suggested Work Units

| Unit | Focused test | Runtime harness | Rollback boundary |
|---|---|---|---|
| 1–2 | foundation/migration tests ≤120s | N/A until gated backup | boot, schema, gate files |
| 3–4 | backend integration ≤120s | disposable PostgreSQL after gates | tenancy, POS/platform |
| 5–6 | foundation tests ≤120s | N/A; providers disabled | auth, worker, manifests |
| 7 | `pnpm test/build/lint` | N/A; static evidence only | docs, deployment, evidence |

## Phase 1: Boot / Config / DB Lifecycle
- [x] 1.1 **RED** — `tests/foundation/backend-hardening.test.mjs`: root `.env` URL, development confirmation, 60s/one retry, no listener. `[T;RB=test;EV=deterministic;NS]`
- [x] 1.2 **GREEN** — `apps/api/src/{index.ts,server.ts}`, `src/platform/configuration/{composition.ts,domain.ts,ports.ts,application/configuration-service.ts}`, database clients/pool, `scripts/postgres-seed.mjs`. `[T;RB=boot;EV=deterministic;NS]`
- [x] 1.3 **REFACTOR** — Same paths: bounded workers, failed-pool closure, graceful shutdown; reuse existing safety guards. `[T;RB=boot;EV=deterministic;NS]`

## Phase 2: Schema / Lineage / Backup Gate
- [ ] 2.1 **RED** — `tests/integration/tus/migration-repair.test.mjs`: absent ledger, destructive backlog, missing restorable backup, mismatch, zero writes. `[T;RB=test;EV=deterministic;NS]`
- [ ] 2.2 **GREEN** — `apps/api/prisma/{schema.prisma,migrations/20260831_tus_backend_hardening_additive_baseline/migration.sql}` and `scripts/{assert-additive-sql.mjs,postgres-schema-preflight.mjs,postgres-backup-gate.mjs}`; additive full activation only—never replay/reset/`db push`. `[T;RB=schema;EV=real-PostgreSQL;NS]`
- [ ] 2.3 **REFACTOR** — `docs/runbooks/{backup-restore.md,migration-rollback.md}`: live DDL waits for restorable backup proof; marker is not lineage. `[T;RB=runbooks;EV=deployment;NS]`

## Phase 3: Tenant Invariants / Repository Audit
- [ ] 3.1 **RED** — `tests/integration/tus/backend-hardening.test.mjs`: cross-tenant reads, writes, relations, uniqueness, commitment lookup. `[T;RB=test;EV=real-PostgreSQL;NS]`
- [ ] 3.2 **GREEN** — `apps/api/prisma/schema.prisma`, `apps/api/src/tus/adapters/{prisma.ts,delivery-pos.ts}`, `src/tenancy/{adapters/prisma.ts,http/tenant-context.ts}`: composite scope. `[T;RB=tenancy;EV=real-PostgreSQL;NS]`
- [ ] 3.3 **REFACTOR** — Audit repositories in `apps/api/src/{tus,catalog,finance,delivery,support,whatsapp,reporting}`; deny without existence leaks. `[T;RB=repository-audit;EV=deterministic;NS]`

## Phase 4: Durable Commerce / Idempotency / Fencing
- [ ] 4.1 **RED** — `tests/integration/tus/backend-hardening.test.mjs`: concurrent retry, stale version, rollback injection, stale claimant, replay/restart. `[T;RB=test;EV=real-PostgreSQL;NS]`
- [ ] 4.2 **GREEN** — `apps/api/src/tus/{pos/index.ts,adapters/{prisma.ts,delivery-pos.ts}}` and `src/platform/{idempotency/{sql.ts,adapters/postgres.ts},outbox/{sql.ts,adapters/postgres.ts},run-ledger/postgres.ts}`: one transaction/CAS/fence. `[T;RB=commerce;EV=real-PostgreSQL;NS]`
- [ ] 4.3 **REFACTOR** — Preserve `PosStorePort`, `PlatformTransactionPort`, audit/outbox contracts; recovery forbids untagged deletion. `[T;RB=commerce;EV=deterministic;NS]`

## Phase 5: Auth / Sessions / Errors / Limits
- [ ] 5.1 **RED** — `tests/foundation/backend-hardening.test.mjs`: revocation restart, correlation, unknown route, body/CORS/rate rejection, redaction. `[T;RB=test;EV=deterministic;NS]`
- [ ] 5.2 **GREEN** — `apps/api/src/auth-security/{composition.ts,adapters/postgres/prisma-identity-store.ts,ports/security.ts}`, `presentation/middleware/{correlation.ts,cors.ts,rate-limit.ts,error.ts}`, `tus/http/router.ts`. `[T;RB=controls;EV=deterministic;NS]`
- [ ] 5.3 **REFACTOR** — `apps/api/src/presentation/routes/health.ts`: correlated structured evidence, redacted errors, non-mutating readiness. `[T;RB=controls;EV=deterministic;NS]`

## Phase 6: Worker Ownership / Provider Isolation
- [ ] 6.1 **RED** — `tests/foundation/backend-hardening.test.mjs`: worker failure/no respawn, Redis isolation, provider-call zero. `[T;RB=test;EV=external-blocked;NS]`
- [ ] 6.2 **GREEN** — `apps/workflow-runtime-python/src/worker/{core/config.py,lifecycle/worker.py}`, `apps/api/src/platform/jobs`, `render.yaml`, `docker-compose.yml`: ownership/shutdown. `[T;RB=worker;EV=deterministic;NS]`
- [ ] 6.3 **REFACTOR** — Same worker paths: disabled/external-blocked providers; preserve Python lifecycle contracts. `[T;RB=worker;EV=external-blocked;NS]`

## Phase 7: Readiness / Evidence / Deployment / Rollback
- [ ] 7.1 **RED** — `tests/foundation/backend-hardening.test.mjs`: schema-aware `/ready`, second-attempt failure, bounded shutdown, missing-restore denial. `[T;RB=test;EV=deterministic;NS]`
- [ ] 7.2 **GREEN** — `docs/runbooks/{job-replay.md,tus-deployment.md}`, `README.md`, `ARCHITECTURE.md`, `render.yaml`, `docker-compose.yml`: canonical env, restore-only rollback preserving ledger/audit/outbox/DLQ/recovery. `[T;RB=operations;EV=deployment;NS]`
- [ ] 7.3 **REFACTOR** — Run root `pnpm test`, `pnpm build`, `pnpm lint`; publish separated redacted evidence, unavailable live proof=`external-blocked`. `[T;RB=operations;EV=deployment;NS]`
