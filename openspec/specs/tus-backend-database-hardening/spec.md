# TUS Backend and Database Hardening Specification

## Purpose

Define a safe, durable, tenant-isolated PostgreSQL backend whose claims are backed by reproducible evidence.

## Requirements

### Requirement: Canonical configuration and seed safety

The running application and development seed MUST use only the repository-root `.env` `DATABASE_URL`; Prisma release commands MAY use a separate `DIRECT_URL` for the same database and DDL only. Development seed MUST require explicit confirmation, preserve the user-owned remote-development target, be idempotent, and fail closed for ambiguous or production targets.

#### Scenario: Confirmed versus unsafe seed
- GIVEN a confirmed user-owned development target, or an ambiguous/production target
- WHEN seed is requested
- THEN the first case is idempotent; the second stops before connection or writes

### Requirement: Bounded database-aware lifecycle

Database start/connect MUST be bounded to 60 seconds per attempt, with exactly one retry after closing the failed pool. Startup, `/ready`, and shutdown MUST be bounded; readiness MUST be non-mutating and schema/dependency aware.

#### Scenario: Failed or incompatible database
- GIVEN connection fails twice or required schema is incompatible
- WHEN startup/readiness runs
- THEN the process stops after the second bounded attempt or reports not-ready without advertising a usable listener

### Requirement: Additive schema, lineage, and backup gates

Schema repair MUST be target-scoped and additive-only. Live DDL requires verified backup/restore, target/schema/data preflight, reviewed SQL, and a forward-only ledger strategy; a custom marker MUST NOT reconcile historical lineage.

#### Scenario: Authorized repair versus unsafe backlog
- GIVEN all gates pass, or historical SQL is destructive/lineage is absent
- WHEN repair or backlog replay is requested
- THEN only the selected additive shape may apply in the first case; the second stops before writes

### Requirement: Tenant and identity invariants

Every tenant-owned read, write, relation, uniqueness rule, and commitment lookup MUST enforce tenant scope, with additive database composite invariants where safe. Cross-tenant access MUST deny without revealing existence.

#### Scenario: Cross-tenant request
- GIVEN an authenticated principal addresses another tenant’s object
- WHEN the repository evaluates it
- THEN it returns not-found/forbidden and performs no mutation

### Requirement: Atomic POS product/service operations

Product/service writes, receipts, idempotency, audit, and outbox records MUST commit atomically. Repeated keys MUST replay the original result; stale versions MUST produce deterministic conflicts with no partial effects.

#### Scenario: Concurrent retry and version conflict
- GIVEN concurrent same-key requests and an obsolete version
- WHEN PostgreSQL executes them
- THEN one effect commits, retries replay it, and stale work creates no duplicate

### Requirement: Fenced audit and outbox processing

Claims, acknowledgements, failures, and replays MUST be atomic, tenant-scoped, idempotent, and claim-fenced. An expired claimant MUST NOT complete work owned by a replacement claimant.

#### Scenario: Stale claimant
- GIVEN worker A’s fence expired and worker B owns the replacement claim
- WHEN A acknowledges or fails the record
- THEN the update is rejected and B remains authoritative

### Requirement: Unified API security boundary

The API MUST emit one correlation-aware redacted error envelope; enforce authorization, bounded body/request/rate limits, and explicit allowed-origin CORS; and MUST NOT expose secrets, tokens, raw database errors, or internal paths.

#### Scenario: Rejected request
- GIVEN an unauthenticated oversized request or disallowed origin
- WHEN middleware processes it
- THEN it returns the bounded envelope with correlation and no sensitive detail

### Requirement: Durable auth, session, and recovery state

Identity, sessions, revocation, recovery attempts, audit, email intent, and recovery rate limits MUST be durable, correctly scoped, and survive API restarts.

#### Scenario: Revocation survives restart
- GIVEN a session was revoked before restart
- WHEN its token is presented afterward
- THEN authentication remains denied and the attempt is auditable

### Requirement: Observability and evidence truth

Lifecycle, readiness, retries, transactions, claims, conflicts, shutdown, and provider calls MUST produce correlated redacted structured evidence. Results MUST be classified `deterministic`, `real-PostgreSQL`, `browser/mobile`, `deployment`, or `external-blocked`; unsupported production claims are forbidden.

#### Scenario: Missing external access
- GIVEN real integration access is unavailable
- WHEN verification records the result
- THEN it records `external-blocked` and MUST NOT promote deterministic evidence to production proof

### Requirement: Worker and provider isolation

Worker PostgreSQL/Redis ownership and contracts MUST be explicit. Mercado Pago, WhatsApp, external AI, cloud, hardware, settlement, payout, and production activation MUST remain disabled or `external-blocked` until separately evidenced.

#### Scenario: Unverified provider boundary
- GIVEN a workflow reaches an unverified provider
- WHEN it is processed
- THEN no provider call occurs and the boundary is recorded safely

### Requirement: Environment and deployment consistency

Root, package, and deployment consumers MUST agree on canonical environment names, lifecycle/readiness, migration gates, cleanup, rollback, and evidence. Rollback MUST restore only a verified point and preserve ledgers, audit, outbox, DLQ, and recovery records.

#### Scenario: Deployment without restore proof
- GIVEN deployment evidence or a verified restore point is missing
- WHEN activation is requested
- THEN activation and migrations are denied

### Requirement: Strict TDD and real evidence

Each phase MUST use RED/GREEN/REFACTOR, root `pnpm test`, `pnpm build`, and `pnpm lint` as applicable, plus real PostgreSQL tests for database claims. Services and databases MUST NOT start during planning.

#### Scenario: Acceptance gate
- GIVEN a durability or lifecycle claim
- WHEN verification runs
- THEN focused tests, root validation, bounded cleanup, and separated evidence are recorded before acceptance

### Requirement: Prohibited destructive or unsupported actions

The system and runbooks MUST NOT perform historical destructive replay, `migrate reset`, `db push`, untagged deletes, broad cleanup, unconfirmed seed reruns, or production claims without evidence.

#### Scenario: Forbidden request
- GIVEN an operator requests a prohibited action
- WHEN the control boundary evaluates it
- THEN it fails closed, records the reason, and preserves target data
