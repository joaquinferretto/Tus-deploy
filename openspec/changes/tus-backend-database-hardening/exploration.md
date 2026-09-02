# Exploration: TUS Backend and Database Hardening

## Current State

The checkout is a hybrid pnpm/Turborepo monorepo with an Express/Prisma API, PostgreSQL `pg` infrastructure, MongoDB and Redis adapters, TUS commerce/POS/support/finance/delivery modules, a Python workflow worker, shared contracts, and extensive deterministic foundation tests. OpenSpec is configured for hybrid storage and strict TDD (`pnpm test`, `pnpm build`, `pnpm lint`), but API package `test` is an intentional no-op and the repository has no general E2E harness.

The current API boot path is not a bounded database-aware startup: `apps/api/src/index.ts` forks one worker in development and `os.cpus().length` workers in production, restarts workers automatically, and `server.ts` immediately constructs lazy Prisma-backed services and calls `listen` without an explicit PostgreSQL connect/readiness gate, startup timeout, retry, or graceful Prisma/pg/Mongo/Redis shutdown. `/health` is liveness-only; `/ready` calls `SELECT 1` through a pool whose `connectionTimeoutMillis` is 2 seconds and also probes Mongo/Redis, so it does not prove schema/migration compatibility and does not implement the requested 60-second DB connection/start plus one retry policy.

PostgreSQL is the declared Prisma source of truth (`schema.prisma` has identity/tenancy, audit, idempotency/outbox, readiness, commerce, finance, delivery, POS, support, WhatsApp, reporting, and workflow-related models). TUS adapters use Prisma transactions for some bounded aggregates, but many repositories expose tenant filters only by convention. The live, already-verified target was PostgreSQL 16 with exactly one `TusHardeningFixture` table, one row, no migration ledger, no POS tables, and no POS runtime writes; the root `.env` `DATABASE_URL` was used read-only and for an idempotent seed. Historical migrations include destructive SQL/backlog semantics (including `DROP`/`CASCADE` paths), so replaying the backlog is unsafe and prohibited. Existing additive repair artifacts cover only a focused POS/delivery slice, not the complete Prisma schema needed by API boot.

Authentication stores durable identity/session data in PostgreSQL but constructs in-memory audit, email, and recovery-rate-limit collaborators per API process. Tenant authorization is deny-by-default in the application layer and generally sends tenant-scoped Prisma predicates, yet the database schema has limited composite tenant foreign-key enforcement and the Prisma commitment lookup is not tenant-filtered. The TUS HTTP router has many explicit auth/permission and authority-spoof checks plus route-local error mapping, while the server does not mount `correlationMiddleware`, has no global error middleware, uses inconsistent error envelopes, and body parsing has no explicit size limit. CORS allows no-origin requests with credentials and allowlists only `Content-Type`/`Authorization`, while TUS clients use correlation, tenant, session, readiness, and idempotency headers.

POS has deterministic in-memory atomic snapshots and a Prisma store for operations, receipts, versions, devices, sessions, conflicts, audit, and outbox. The Prisma POS outbox claim path leaves claimed rows in `pending` and does not make the claim acquisition a single database-atomic compare-and-set; the shared TUS outbox `fail` update also lacks a tenant/claim fence in its final update. Idempotency, audit, and outbox are intended to be transactionally coupled, but real PostgreSQL concurrency, failure-injection atomicity, restart/replay, and cleanup remain unproven. The Python worker validates shared JSON contracts and writes results to Redis, but its settings use separate `WORKER_POSTGRES_DSN` defaults and Redis queue conventions rather than an explicitly coordinated backend ownership/transaction contract.

Observability has redaction and evidence models, but API correlation middleware is not wired into `createApp`, health logs/errors can emit raw error details, and no unified backend metrics/trace/error policy is visible at the boot boundary. Existing runbooks define backup/restore, migration rollback, and tenant-scoped job replay; they correctly require verified backups, preserve ledgers/outboxes/DLQs, and prohibit destructive rollback. Deployment docs/manifests still mix canonical and compatibility variables and declare `prisma migrate deploy` on Render despite the live no-ledger/destructive-backlog condition. `README.md` and `ARCHITECTURE.md` retain older generic boilerplate claims and should not be treated as current runtime proof.

## Affected Areas

- `apps/api/src/index.ts`, `apps/api/src/server.ts` — unbounded production cluster fan-out, automatic respawn, no startup DB gate, no graceful shutdown, and no bounded process ownership.
- `apps/api/src/infrastructure/database/prisma/client.ts`, `apps/api/src/infrastructure/database/postgres/pool.ts` — lazy clients, 2-second pg connection timeout, no one-retry lifecycle, no root `.env` loading contract at the application boundary, and no schema-compatible readiness probe.
- `apps/api/src/presentation/routes/health.ts`, `apps/api/src/presentation/middleware/*.ts` — liveness/readiness distinction, dependency behavior, correlation wiring, CORS headers, rate-limit failure mode, and security diagnostics.
- `apps/api/src/auth-security/**`, `apps/api/src/tenancy/**` — durable auth/session ownership, per-process auxiliary state, tenant and role consistency, revocation, and cross-tenant enforcement.
- `apps/api/prisma/schema.prisma` — PostgreSQL ownership model, missing/weak composite tenant relations and database checks, broad model surface, and `Float` monetary fields.
- `apps/api/prisma/migrations/**` — 25 pending historical entries on the verified target, destructive SQL in the backlog, no live ledger, and incomplete focused additive repair coverage.
- `apps/api/src/tus/adapters/prisma.ts`, `apps/api/src/tus/adapters/delivery-pos.ts`, `apps/api/src/tus/pos/**` — tenant-scoped lookup, transaction boundaries, compare-and-set versioning, idempotency races, receipt/audit/outbox atomicity, claim fencing, and recovery.
- `apps/api/src/tus/http/router.ts`, `apps/api/src/tus/application/**`, `apps/api/src/tus/catalog/**`, `finance/**`, `delivery/**`, `support/**`, `whatsapp/**`, `reporting/**` — large route surface with duplicated legacy/v1 paths, route-local validation/error handling, readiness gates, and provider-disabled behavior.
- `apps/api/src/platform/jobs/**`, `apps/api/src/platform/outbox/**`, `apps/api/src/platform/run-ledger/**`, `apps/workflow-runtime-python/src/worker/**` — durable jobs/events/run ledger, at-least-once transport, Redis result writes, provider isolation, and cross-runtime ownership.
- `scripts/test-runner-lib.mjs`, `scripts/postgres-seed.mjs`, `tests/integration/tus/postgres-http-smoke.test.mjs` — canonical root `.env` authority, explicit development seed confirmation, 60-second/one-retry bounds, redaction, owned-child cleanup, and real-POS evidence gates.
- `tests/foundation/**`, `tests/integration/tus/**`, `package.json`, `apps/api/package.json`, `backend/package.json`, `frontend/package.json` — meaningful root tests versus package no-op tests, strict TDD orchestration, build/lint/typecheck coverage, and bounded command contracts.
- `docs/runbooks/{backup-restore,migration-rollback,job-replay}.md`, `docs/runbooks/tus-environment-consumer-inventory.md`, `docs/runbooks/tus-deployment.md`, `render.yaml`, `docker-compose.yml`, `README.md`, `ARCHITECTURE.md` — rollback/recovery authority, environment aliases, deployment migration commands, stale claims, and operational evidence.
- `openspec/changes/tus-real-db-runtime-audit/**`, `tus-additive-migration-repair/**`, `tus-product-hardening/**` — prior decisions and evidence to preserve; some earlier artifacts are now superseded by the verified live inventory and must be clearly classified rather than silently reused.

## Approaches

1. **One-shot full backend rewrite and schema replay** — replace boot, adapters, migrations, and operational paths together, then replay or regenerate the complete schema.
   - Pros: one apparent end state; fewer interim compatibility layers.
   - Cons: highest blast radius; conflicts with the live no-ledger state and destructive historical backlog; difficult rollback and evidence attribution; risks changing provider/tenant behavior together.
   - Effort: High

2. **Durability-first phased hardening** — first make boot/config/readiness/process ownership safe; then establish the target-specific additive schema/ledger and backup boundary; then harden tenant-scoped transactions, idempotency, POS/audit/outbox/recovery; finally normalize observability, provider isolation, deployment, and evidence.
   - Pros: aligns with existing OpenSpec decisions and runbooks; each phase has strict RED/GREEN/REFACTOR tests, a rollback boundary, and truthful evidence; prevents API success claims before schema readiness.
   - Cons: longer sequencing; full schema readiness requires an externally verified backup/restore capability and deliberate lineage decision; live POS proof remains blocked until those gates pass.
   - Effort: High

3. **Evidence/tooling-only hardening** — improve scripts, documentation, and static tests without changing backend boot or durable adapters.
   - Pros: low database risk and fast deterministic progress.
   - Cons: leaves the API capable of listening while its schema is absent, does not fix transaction races or global error/shutdown behavior, and can overstate backend robustness.
   - Effort: Medium

## Recommendation

Choose **durability-first phased hardening**, with a mandatory boot/config foundation before any database-changing work. Keep the repository-root `.env` `DATABASE_URL` as the only database URL source; never connect, seed, migrate, or start services during planning. Make PostgreSQL startup/connect and schema compatibility a bounded 60-second operation with exactly one retry, close failed pools between attempts, and stop after the second failure. Add explicit development-only seed intent/confirmation and retain the already-proven idempotent seed behavior; production and ambiguous/shared targets must fail closed.

Use strict TDD and additive-only migrations. Do not replay or rewrite the destructive historical backlog, use `migrate reset`, `migrate dev`, `db push`, broad cleanup, or untagged deletes. Before any live DDL, require an operator-supplied verified backup/restore point, a target/schema/data preflight, and a deliberate forward-only ledger strategy. The additive baseline must cover the tables actually required by the selected backend activation scope (not just the 15-table POS focus), detect shape mismatches instead of silently accepting them, and document that a custom marker is not historical lineage reconciliation.

Then harden the Prisma adapters around tenant-scoped composite reads/writes, database-enforced identity/tenant invariants where safely additive, atomic version/idempotency/outbox claims with claim fencing, transaction failure injection, recovery/replay, and provider-call zero assertions. Make API startup bounded and graceful, cap worker/process ownership, mount correlation and unified error handling, enforce request limits, correct CORS headers, and make `/ready` report schema/migration and dependency status without mutating state. Preserve provider isolation: Mercado Pago/WhatsApp/external AI capture, settlement, payout, cloud activation, hardware, and production claims remain disabled or `external-blocked` until separately evidenced.

Finally reconcile root/package/deployment configuration and stale docs using a consumer inventory, make the Python worker's Redis/PostgreSQL ownership explicit, and separate deterministic, local PostgreSQL, browser/mobile, deployment, and external evidence. Each phase must record redacted evidence, bounded cleanup, recovery/rollback instructions, and the exact unverified boundary.

## Risks

- **BLOCKER — live schema/lineage:** the verified target has only `TusHardeningFixture`, no migration ledger, and no POS tables; applying the historical backlog is unsafe, while a focused repair does not cover the full API schema. Any DDL requires backup/restore proof, explicit scope, additive SQL, and external evidence.
- **BLOCKER — false readiness:** `/ready` currently proves only a simple PostgreSQL query and can report a usable dependency while required tables are absent; API startup does not wait for or verify schema compatibility.
- **HIGH — transaction correctness:** POS/outbox/idempotency concurrency and failure paths are represented by deterministic or partially fenced adapters but have not been proven against PostgreSQL; stale claims could permit duplicate work or inconsistent acknowledgement.
- **HIGH — tenant isolation:** application predicates are strong in many paths but are not a substitute for complete composite database invariants; commitment lookup and some repository writes need an explicit tenant-scope audit.
- **HIGH — process/resource safety:** production cluster fan-out and automatic worker respawn are not bounded by an explicit process budget or graceful shutdown; pool/listener leaks can make recovery and deploy rollback unreliable.
- **HIGH — auth/observability gaps:** in-memory audit/email/rate-limit collaborators are per-process, correlation middleware is not mounted, and route-local errors lack one consistent redacted envelope.
- **MEDIUM — configuration drift:** root-only PostgreSQL authority is implemented in guarded scripts, but API/worker/deployment consumers still expose alternate database defaults and web aliases; removal requires consumer and deployment proof.
- **MEDIUM — legacy duplication:** `apps/api/backendFiles/` contains a separate older report/upload/provider stack and variable vocabulary; do not merge or delete it without an ownership decision.
- **MEDIUM — stale evidence/docs:** earlier OpenSpec artifacts include pre-current live states and should remain immutable, explicitly superseded/classified, and never silently promoted to current proof.
- **MEDIUM — monetary/data semantics:** finance/POS use floating-point amounts and broad `String` status/context fields; changing these requires additive compatibility and domain migration planning, not an opportunistic type rewrite.
- **LOW — test signal:** root tests are meaningful, but API package `test` exits successfully without testing; strict TDD must target the root runner and add focused integration/contract tests before implementation.

## Ready for Proposal

Yes. The proposal should be a phased, backend-wide hardening program with the boot/config/readiness phase first, a separately gated target-specific additive schema/lineage phase second, and transaction/POS/recovery/observability/deployment phases after that. It must state that the current live facts are verified but no database-changing operation is authorized by this exploration, that backup/restore and external proof are prerequisites for live DDL, and that no provider, production, browser/device, Docker, migration replay, seed rerun, or service startup occurs in planning.
