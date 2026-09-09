# Delta for tus-backend-database-hardening

## ADDED Requirements

### Requirement: Exact money and additive financial lineage

All money, tax, commission, refund, cash, settlement, invoice, and reconciliation values MUST use exact decimal/integer minor-unit semantics with an explicit currency and immutable snapshots. Evidence: deterministic, real-PostgreSQL, provider, legal/external-blocked.

#### Scenario: Exact amount calculation
- GIVEN a currency, price, tax, commission rule, and refund
- WHEN the transaction is calculated and persisted
- THEN amounts round by the approved currency policy without binary floating-point drift

#### Scenario: Historical correction
- GIVEN a later refund, chargeback, or tax correction
- WHEN it is recorded
- THEN an append-only compensating entry is created and the original amount remains unchanged

### Requirement: Independent launch capability gates

Publication, payment, WhatsApp, delivery, billing, release jobs, fleet jobs, browser/device readiness, and production operations MUST have independent, owner-scoped, expiring, revocable evidence gates. A flag, credential reference, fake, plan, or local test MUST NOT activate a capability. Evidence: deterministic, provider, browser/mobile, deployment, legal/external-blocked.

#### Scenario: One gate is missing
- GIVEN payment evidence is valid but tax, device, or operations evidence is missing
- WHEN activation is evaluated
- THEN only independently eligible non-dependent capabilities remain available and the blocked capability reports unavailable

#### Scenario: Evidence revocation
- GIVEN an active evidence record expires or is revoked
- WHEN readiness is reevaluated
- THEN affected intake/jobs are stopped or quarantined and audit/evidence/ledger/outbox/DLQ records remain readable

## MODIFIED Requirements

### Requirement: Canonical configuration and seed safety

The system MUST use only the repository-root `.env` `DATABASE_URL`; it MUST NOT add or honor new URL variables. Development seed MUST require explicit confirmation, preserve the user-owned remote-development target, be idempotent, and fail closed for ambiguous or production targets. The root `.env` remains the sole source and `Goldenrepo-js_py` is excluded. Evidence: deterministic, real-PostgreSQL.

#### Scenario: Confirmed versus unsafe seed
- GIVEN a confirmed user-owned development target, or an ambiguous/production target
- WHEN seed is requested
- THEN the first case is idempotent; the second stops before connection or writes

#### Scenario: Alternate URL injection
- GIVEN a package, worker, or command supplies another database URL
- WHEN configuration resolves
- THEN it is rejected and the root value is not disclosed

### Requirement: Bounded database-aware lifecycle

Database start/connect MUST be bounded to 60 seconds per attempt, with exactly one retry after closing the failed pool. Startup, `/ready`, and shutdown MUST be bounded; readiness MUST be non-mutating and schema/dependency aware. A third attempt or listener before readiness MUST NOT occur. Evidence: deterministic, real-PostgreSQL, deployment.

#### Scenario: Failed or incompatible database
- GIVEN connection fails twice or required schema is incompatible
- WHEN startup/readiness runs
- THEN the process stops after the second bounded attempt or reports not-ready without advertising a usable listener

#### Scenario: Healthy retry cleanup
- GIVEN the first attempt fails and the second succeeds
- WHEN lifecycle proceeds
- THEN the failed pool is closed, exactly one retry is recorded, and readiness performs no write

### Requirement: Additive schema, lineage, and backup gates

Schema repair MUST be target-scoped and additive-only. Live DDL requires verified backup/restore, target/schema/data preflight, reviewed SQL, and a forward-only ledger strategy; a custom marker MUST NOT reconcile historical lineage. Historical destructive replay, reset, `db push`, truncate, cascade, and untagged deletes are forbidden. Evidence: deterministic, real-PostgreSQL, deployment.

#### Scenario: Authorized repair versus unsafe backlog
- GIVEN all gates pass, or historical SQL is destructive/lineage is absent
- WHEN repair or backlog replay is requested
- THEN only the selected additive shape may apply in the first case; the second stops before writes

#### Scenario: Restore failure
- GIVEN the backup cannot be restored or target identity is ambiguous
- WHEN live DDL is requested
- THEN no connection/DDL proceeds and the blocker is recorded without claiming schema readiness

### Requirement: Tenant and identity invariants

Every tenant-owned read, write, relation, uniqueness rule, and commitment lookup MUST enforce tenant scope, with additive database composite invariants where safe. Cross-tenant access MUST deny without revealing existence. Roles MUST be least-privilege and platform support access MUST be separately audited. Evidence: deterministic, real-PostgreSQL, browser/mobile.

#### Scenario: Cross-tenant request
- GIVEN an authenticated principal addresses another tenant’s object
- WHEN the repository evaluates it
- THEN it returns not-found/forbidden and performs no mutation

#### Scenario: Concurrent tenant collision
- GIVEN equal business identifiers exist in different tenants and two writes race
- WHEN uniqueness and authorization execute
- THEN both valid tenant-scoped records may coexist while an out-of-scope write is denied

### Requirement: Unified API security boundary

The API MUST emit one correlation-aware redacted error envelope; enforce authorization, bounded body/request/rate limits, and explicit allowed-origin CORS; and MUST NOT expose secrets, tokens, raw database errors, or internal paths. Evidence: deterministic, browser/mobile, deployment.

#### Scenario: Rejected request
- GIVEN an unauthenticated oversized request or disallowed origin
- WHEN middleware processes it
- THEN it returns the bounded envelope with correlation and no sensitive detail

#### Scenario: Secret-bearing failure
- GIVEN a provider/database error contains credentials, URLs, SQL, or a stack path
- WHEN it is logged or returned
- THEN only redacted structured metadata is emitted

### Requirement: Observability and evidence truth

Lifecycle, readiness, retries, transactions, claims, conflicts, shutdown, and provider calls MUST produce correlated redacted structured evidence. Results MUST be classified `deterministic`, `real-PostgreSQL`, `browser/mobile`, `provider`, `deployment`, or `legal/external-blocked`; unsupported production claims are forbidden. Evidence: all listed classes.

#### Scenario: Missing external access
- GIVEN real integration access is unavailable
- WHEN verification records the result
- THEN it records `legal/external-blocked` or the applicable blocked boundary and MUST NOT promote deterministic evidence to production proof

#### Scenario: Retry and replay trace
- GIVEN an idempotent retry, conflict, or fenced replay
- WHEN it completes or fails
- THEN correlation, tenant-safe outcome, attempt count, and redacted reason are retained

### Requirement: Environment and deployment consistency

Root, package, and deployment consumers MUST agree on canonical environment names, lifecycle/readiness, migration gates, cleanup, rollback, and evidence. Rollback MUST restore only a verified point and preserve ledgers, audit, outbox, DLQ, and recovery records. Render/Vercel/DNS claims require live deployment evidence, not manifests alone. Evidence: deterministic, deployment, real-PostgreSQL.

#### Scenario: Deployment without restore proof
- GIVEN deployment evidence or a verified restore point is missing
- WHEN activation is requested
- THEN activation and migrations are denied

#### Scenario: Safe rollback
- GIVEN a deployed capability fails a P0 gate
- WHEN rollback is invoked
- THEN intake/jobs are disabled or drained, a verified restore or compensating entries are used, and destructive rollback is not attempted

### Requirement: Prohibited destructive or unsupported actions

The system and runbooks MUST NOT perform historical destructive replay, `migrate reset`, `db push`, truncate, cascade, untagged deletes, broad cleanup, unconfirmed seed reruns, secret leakage, or production claims without evidence. Evidence: deterministic, real-PostgreSQL, deployment, legal/external-blocked.

#### Scenario: Forbidden request
- GIVEN an operator requests a prohibited action
- WHEN the control boundary evaluates it
- THEN it fails closed, records the reason, and preserves target data

#### Scenario: Untagged cleanup
- GIVEN recovery finds ambiguous or stale work
- WHEN cleanup is requested
- THEN it is fenced/quarantined or explicitly tagged and authorized; no broad delete or cascade occurs
