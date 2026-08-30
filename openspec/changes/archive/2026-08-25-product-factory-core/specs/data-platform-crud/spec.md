# Data Platform and CRUD Specification

## Purpose

Make PostgreSQL/Neon and MongoDB operational with explicit ownership, portable repository ports, universal CRUD/search, and recoverable platform primitives.

## Requirements

### Requirement: Explicit database ownership and local ACID

PostgreSQL/Neon MUST be the relational source of truth for identity, tenancy, authorization, audit, search records, aggregates, idempotency, outbox, quotas, and run ledger; MongoDB MUST remain operational for explicitly owned document/read-model workloads; each table/collection MUST have one owner and reconciliation policy. Each database MUST provide ACID only within its boundary; distributed 2PC MUST NOT be used. Rationale: dual writes without ownership silently diverge.

| Data class | Owner | Projection/temporary rule |
|---|---|---|
| identity, tenancy, auth, audit, quotas, ledger, outbox | PostgreSQL/Neon | No competing source; projections reconcile from outbox |
| explicitly assigned documents/read models | MongoDB | Session transaction where multi-document; owner and rebuild rule required |
| durable assets and source documents | B2 | Encrypted, lifecycle-managed S3 is transient staging only when AWS async work requires it |
| vectors and retrieval metadata | PostgreSQL/PGVector | Rebuildable from B2 lineage; deletion follows source policy |
| queue delivery | Redis local or SQS+DLQ production | Transport is never the run-ledger owner |

#### Scenario: Owned transaction
- GIVEN a relational aggregate and its PostgreSQL owner
- WHEN a valid change commits
- THEN all owned relational records commit atomically and the ownership metadata identifies the source of truth

#### Scenario: Mongo failure and reconciliation
- GIVEN a PostgreSQL commit requiring an owned Mongo projection
- WHEN Mongo is unavailable
- THEN the source remains committed, outbox work is retryable, projection status is visible, and reconciliation can repair it without 2PC

#### Scenario: Tenant boundary
- GIVEN a Mongo document or PostgreSQL row for tenant A
- WHEN tenant B queries by guessed identifier or unscoped filter
- THEN the repository rejects or returns no data and evidence proves the tenant predicate was applied

### Requirement: ORM and query-path acceptance

Prisma MUST serve ordinary CRUD, relation loading, migrations, and simple transactions; parameterized raw SQL MUST serve locks, refresh rotation, concurrency, idempotency/outbox claims, CTE/window/aggregate/full-text/geospatial/bulk/hot paths; Mongo driver/Mongoose MUST use sessions for multi-document transactions; domain/application layers MUST depend only on repository/port contracts. Rationale: convenience ORM paths cannot safely express every invariant.

#### Scenario: Ordinary CRUD
- GIVEN a tenant-scoped create, list, or update with standard relations
- WHEN the repository executes it
- THEN Prisma validation and the repository contract enforce the tenant scope without vendor leakage

#### Scenario: Concurrent hot path
- GIVEN two requests competing for the same availability or idempotency key
- WHEN the operation executes
- THEN parameterized SQL or a Mongo session preserves the invariant, returns one deterministic outcome, and never interpolates user input

#### Scenario: Boundary evidence
- GIVEN static dependency analysis
- WHEN it scans domain and application packages
- THEN direct Prisma, Mongo, SQL, and vendor SDK imports fail the check; adapters remain the only implementation details

### Requirement: Universal platform primitives

The system MUST provide tenant-scoped generic CRUD/search, B2 asset metadata and lineage, notifications/email status, feature flags/configuration, quotas/rate limits, idempotency, transactional outbox, and job/event records with deterministic local fakes. Rationale: these capabilities are reusable product infrastructure, not vertical features.

#### Scenario: Idempotent platform action
- GIVEN a repeated request with the same tenant-scoped idempotency key
- WHEN it is retried after a transport failure
- THEN one result is retained, duplicates return the recorded result, and outbox publication remains recoverable

#### Scenario: Quota or provider failure
- GIVEN an exhausted tenant quota or unavailable notification provider
- WHEN a request is submitted
- THEN the action is rejected or durably queued with a reason, retry policy, and no cross-tenant accounting
