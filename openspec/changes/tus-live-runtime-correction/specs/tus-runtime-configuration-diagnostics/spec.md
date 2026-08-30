# TUS Runtime Configuration Diagnostics Specification

## Purpose

Define one truthful, redacted diagnostic contract for selecting the runtime profile and PostgreSQL prerequisite without treating configuration presence as reachability or authorization.

## Requirements

### Requirement: Canonical environment resolution

The system MUST resolve the PostgreSQL input from `TUS_POSTGRES_URL` first and `DATABASE_URL` second, and MUST report which source was selected without reporting its secret-bearing value. Diagnostics MUST include the selected environment/profile, runtime role, service identity, provider/database modes, and required production secret-store status.

#### Scenario: Both PostgreSQL variables are present

- GIVEN both variables contain values
- WHEN diagnostics are evaluated
- THEN `TUS_POSTGRES_URL` is selected and `DATABASE_URL` is not used
- AND the report identifies the source as `TUS_POSTGRES_URL` without credentials

#### Scenario: No PostgreSQL target exists

- GIVEN neither variable is present or both are blank
- WHEN diagnostics are evaluated
- THEN the result is `no-target` and PostgreSQL execution is deferred
- AND no connection, migration, query, or fixture write is attempted

### Requirement: Redacted, deterministic diagnostics

Diagnostic output MUST redact passwords, tokens, query secrets, and complete connection strings. Equivalent inputs MUST produce the same status, reason code, prerequisite names, and rerun guidance; rerun guidance MUST use placeholders rather than secret values.

#### Scenario: Invalid PostgreSQL URL

- GIVEN the selected value is malformed or uses a non-PostgreSQL scheme
- WHEN diagnostics are evaluated
- THEN the result is `invalid-target` with a stable reason
- AND output contains no password, token, or raw URL

#### Scenario: Valid syntax but unsafe identity

- GIVEN the URL parses as PostgreSQL but lacks explicit disposable/test proof or identifies a shared/production boundary
- WHEN diagnostics are evaluated
- THEN the result is `unsafe-target` and the target is denied
- AND diagnostics do not imply that the host is reachable

### Requirement: Runtime failure classification

The system MUST classify outcomes as `no-target`, `invalid-target`, `unsafe-target`, `unavailable`, `assertion-failure`, or `ready`, with an owner/boundary and a safe rerun command. It MUST distinguish environmental unavailability from an application assertion failure and MUST NOT convert either into production conformance.

#### Scenario: Runtime startup failure

- GIVEN a safe target was selected but Prisma, schema, database, or bounded API startup is unavailable
- WHEN the smoke orchestrator reports the failure
- THEN the result is `unavailable` with the failing boundary
- AND live conformance remains false

#### Scenario: Application assertion failure

- GIVEN the runtime starts and an expected HTTP/POS invariant fails
- WHEN the smoke orchestrator reports the failure
- THEN the result is `assertion-failure`
- AND the report preserves the failed invariant separately from infrastructure deferral
