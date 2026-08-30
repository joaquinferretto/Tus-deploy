# Database Ownership and Recovery Contract

## PostgreSQL/Neon is the source of truth

PostgreSQL owns identity, tenancy, authorization, audit/security events,
search records, relational aggregates, quotas, idempotency records, the
transactional outbox, and the durable run ledger. The Prisma schema and
versioned SQL migrations are the authoritative definition of these records.
Every owned record carries a tenant boundary where the data class is
tenant-scoped, and tenant-scoped uniqueness is enforced in PostgreSQL.

MongoDB may own only the explicitly assigned `owned_documents` document
collection or `tenant_read_model` read-model collection. Both collections are
tenant-scoped and reject unscoped or mismatched tenant filters. The document
collection's source of truth is MongoDB backup state; the read model's source
of truth remains PostgreSQL and its rebuild strategy is PostgreSQL outbox
replay. Multi-document Mongo writes use a session transaction where the
adapter supports it. Redis and SQS are delivery transports, never owners of
business state. B2 owns durable source documents; S3 is transient encrypted
staging only. Vector metadata is PostgreSQL/PGVector state and is rebuildable
from B2 lineage.

## Local ACID boundary

Writes to PostgreSQL-owned records use one Prisma `$transaction` callback (or
one equivalent PostgreSQL transaction at the adapter boundary). Related
aggregate state, idempotency state, quota reservation, audit event, run-ledger
state, and outbox event commit or roll back together inside PostgreSQL.

The factory MUST NOT use distributed two-phase commit (2PC). There is no
`PREPARE TRANSACTION`, `COMMIT PREPARED`, or fake coordinator that claims to
make PostgreSQL, MongoDB, a queue, object storage, or a provider atomic. A
cross-system workflow commits its PostgreSQL source and outbox first, then
uses idempotency keys, delivery retries, saga compensation, and reconciliation.

## Rebuild and restore rules

| Target | Source of truth | Recovery action |
|---|---|---|
| PostgreSQL-owned auth/tenancy/audit/aggregates/quotas/ledger/outbox | PostgreSQL backup and migration version | Restore the last verified backup, replay only durable ledger/outbox work, then run consistency checks. |
| MongoDB projection | PostgreSQL-owned records and outbox | Replay the outbox into a fresh projection; record unavailable/retry status while MongoDB is down. MongoDB failure never rolls back the PostgreSQL commit. |
| MongoDB owned documents | MongoDB backup and explicit collection ownership | Restore the assigned collection through a tenant-scoped session boundary; unknown collections and cross-tenant filters are rejected. |
| PGVector/retrieval metadata | B2 source-document lineage plus PostgreSQL metadata | Rebuild the index from retained lineage and source versions; deletion follows the source retention policy. |
| Redis or SQS delivery state | PostgreSQL run ledger and outbox | Reclaim/retry delivery; never reconstruct business truth from queue contents alone. |

Restore and rebuild are observable, retryable operations. Operators must record
the migration/schema version, source owner, recovery strategy, result, and
remaining projection lag without copying secrets or personal payloads.

## Seed contract

`apps/api/prisma/seed.ts` is safe by default: it creates no privileged user,
password hash, tenant, or ownership row. Explicit synthetic ownership fixtures
may be supplied by a local operator to `seedDatabaseOwnership`; they are
idempotent upserts and are not production data.
