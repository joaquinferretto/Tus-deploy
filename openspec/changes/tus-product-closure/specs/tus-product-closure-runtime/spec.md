# TUS Product Closure Runtime Specification

## Purpose

Define an authenticated, tenant-scoped POS and marketplace closure path whose PostgreSQL evidence is durable when explicitly safe, and deterministically deferred otherwise.

## Requirements

### Requirement: Authenticated durable POS and marketplace closure

The system MUST require valid bearer authentication, tenant/device/session authority, correlation data, required permission, and fleet readiness before any POS or marketplace mutation. A successful product/service POS operation or marketplace checkout MUST durably preserve its business result, receipt, idempotency, version, audit, and outbox facts without provider or settlement calls.

#### Scenario: Authorized disposable live journey

- GIVEN an authorized disposable PostgreSQL target, approved migration, authenticated tenant, open device/session, and fleet readiness
- WHEN product/service POS commands and marketplace onboarding, listing, and checkout are executed
- THEN each accepted result and its receipt, version, audit, and outbox facts are durable and tenant-scoped
- AND evidence is labeled `local-postgresql-http`/`local-verification` with `liveConformance:false`

#### Scenario: Absent or unsafe target

- GIVEN no target, a malformed target, or a shared/production target without disposable proof
- WHEN the pilot is requested
- THEN it returns secret-free `deferred` evidence and performs no connection, migration, query, fixture mutation, or provider call

#### Scenario: Authentication or tenant failure

- GIVEN a missing, expired, spoofed, cross-tenant, or closed session
- WHEN a mutation is submitted
- THEN it is denied before business effects and cannot create a POS or marketplace commitment

### Requirement: Durable replay, conflict, and restart recovery

The system MUST make idempotency keys and request hashes durable, return the original result for an identical replay, reject changed hashes, and reject stale expected versions. Restart MUST recover committed records and MUST NOT duplicate business, receipt, audit, or outbox counts.

#### Scenario: Replay after restart

- GIVEN a committed command and API restart
- WHEN the same idempotency key and request hash are submitted again
- THEN the original durable result is returned as replay and counts remain unchanged

#### Scenario: Hash or version conflict

- GIVEN an existing idempotency key with a different hash or a stale expected version
- WHEN the conflicting command is submitted
- THEN a deterministic conflict is returned and no new business effect is committed
- AND the conflict is auditable within the tenant boundary

#### Scenario: Transaction failure

- GIVEN one required durable effect fails
- WHEN the command transaction aborts
- THEN operation, receipt, version, idempotency, audit, and outbox effects are all absent

### Requirement: Bounded lifecycle and evidence-preserving cleanup

Every attempted pilot MUST stop and await child services, close database resources, resolve open transactions, and delete only generated disposable fixtures. Cleanup MUST NOT erase audit, outbox, ledger, dead-letter, or evidence records before verification; financial rollback MUST be append-only.

#### Scenario: Recovery after runtime failure

- GIVEN startup, assertion, timeout, or shutdown failure after unique fixtures exist
- WHEN finalization runs
- THEN intake is stopped, work is drained or quarantined, resources are closed, and targeted cleanup is attempted
- AND the original failure classification and `liveConformance:false` remain visible

#### Scenario: Cleanup failure

- GIVEN targeted cleanup cannot complete
- WHEN the run is reported
- THEN cleanup failure is reported separately with the owner and rerun guidance
- AND the original pilot/deferred/failure result is not replaced or falsely promoted
