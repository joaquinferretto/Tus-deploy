# TUS Safe PostgreSQL Evidence Specification

## Purpose

Permit authenticated PostgreSQL evidence only inside an explicitly proven disposable boundary, while preserving deterministic deferral and preventing secret leakage or production claims.

## Requirements

### Requirement: Deny-by-default PostgreSQL boundary

The system MUST validate the PostgreSQL scheme, parseable target identity, disposable/test authorization, and destructive-operation policy before schema validation, migration, connection, or mutation. A parseable URL alone MUST NOT authorize execution. Production, shared, unknown, or unproven targets MUST be denied.

#### Scenario: No target

- GIVEN no canonical PostgreSQL URL is available
- WHEN the smoke is requested
- THEN it returns deterministic `deferred` evidence with `local-postgresql-http`
- AND no transport or migration is attempted

#### Scenario: Unsafe target

- GIVEN a URL is syntactically valid but disposable identity or destructive-operation proof is absent
- WHEN the smoke is requested
- THEN it returns `deferred` with `unsafe-target`
- AND no connection, migration, fixture write, or cleanup query is attempted

### Requirement: Truthful authenticated evidence

The system MUST run migrations only when explicitly requested inside the proven boundary, verify required schema metadata, and exercise authenticated tenant-scoped HTTP/POS behavior. A successful local database run MUST be labeled `local-verification` with `liveConformance: false`; it MUST NOT be labeled production, external authorization, or a POS pilot.

#### Scenario: Live-success inside disposable boundary

- GIVEN the target passes every safety gate and the API, schema, and readiness prerequisites pass
- WHEN the authenticated smoke completes
- THEN evidence is `passed`, `local-postgresql-http`, and `local-verification`
- AND it records tenant isolation, POS/delivery effects, audit/outbox durability, and provider non-interaction

#### Scenario: Readiness or schema prerequisite is missing

- GIVEN a safe target connects but required migrations or authorized readiness evidence is absent
- WHEN a mutation would be attempted
- THEN the mutation is denied before durable effects
- AND the result is deterministic `deferred`, not a partial success

### Requirement: Deterministic reporting and cleanup

Reports MUST contain stable scenario keys for authenticated HTTP, device/session, product/service POS, replay, conflict, restart, cleanup, and rollback. Every attempted run MUST stop child processes, close pools, rollback open transactions, and remove only uniquely identified disposable fixtures. Audit/outbox evidence MUST be retained until verification; financial rollback MUST be append-only and destructive rollback MUST be false.

#### Scenario: Smoke error after fixture creation

- GIVEN an assertion or infrastructure error occurs after disposable fixtures exist
- WHEN finalization runs
- THEN API and database resources are closed and fixture cleanup is attempted in a bounded transaction
- AND cleanup failure is reported without hiding the original classification

#### Scenario: Replay after restart

- GIVEN a committed request is submitted again after API restart with the same idempotency key and hash
- WHEN the smoke replays it
- THEN the original durable result is returned and counts do not increase
- AND a changed hash returns a deterministic conflict
