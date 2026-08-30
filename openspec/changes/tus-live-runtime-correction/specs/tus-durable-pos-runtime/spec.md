# TUS Durable POS Runtime Specification

## Purpose

Make Prisma-backed TUS POS and delivery behavior match the deterministic contract and prove it through authenticated, tenant-scoped, restartable HTTP journeys without activating providers or settlement.

## Requirements

### Requirement: Atomic durable POS command

The system MUST commit a POS operation, receipt, expected-version update, idempotency record, audit record, and outbox event in one PostgreSQL transaction. A failed command MUST leave none of those effects committed. Version reads and increments MUST be durable and monotonic per tenant and shift, matching in-memory conflict semantics.

#### Scenario: Product and service commands succeed

- GIVEN an authenticated POS actor has an active device/session and required readiness
- WHEN product and service manual operations are submitted with distinct idempotency keys
- THEN each commits the correct context, receipt, version, audit, and outbox facts
- AND no provider or settlement call is made

#### Scenario: Transaction failure

- GIVEN one durable effect fails during a POS command
- WHEN the transaction is aborted
- THEN operation, receipt, version, idempotency, audit, and outbox changes are absent
- AND the HTTP response is a safe non-success error with correlation data only

### Requirement: Authenticated tenancy and readiness boundary

Every POS and delivery mutation MUST require a resolvable bearer session, correlation ID, required permission, matching tenant/device/session authority, and the `fleet` readiness decision. The service MUST deny missing, spoofed, cross-tenant, expired, deterministic-only, or conflicting evidence before mutation.

#### Scenario: Unauthorized or cross-tenant request

- GIVEN a request lacks valid authentication or references another tenant's device, session, or commitment
- WHEN it reaches a POS or delivery route
- THEN it returns a forbidden or readiness error
- AND a denied audit record MAY be retained without any durable business mutation

#### Scenario: Device and session provisioning

- GIVEN authorized disposable tenants and fleet evidence exist
- WHEN the smoke registers a device and opens a session
- THEN both records are durable and recoverable after API restart
- AND closing the session prevents subsequent writes that require an open session

### Requirement: Replay, conflict, restart, and delivery proof

The durable runtime MUST preserve idempotent replay, reject changed request hashes and stale expected versions, recover records after restart, and support the bounded product delivery flow through proof and handoff. Receipts MUST expose a verifiable integrity hash and settlement state `not-claimed`.

#### Scenario: Offline replay and version conflict

- GIVEN a command is replayed after restart with the same key/hash and another command uses a stale expected version
- WHEN both are submitted
- THEN replay returns the original result without duplication
- AND the stale command returns a version conflict with a persisted conflict record

#### Scenario: Delivery handoff

- GIVEN a product commitment, authorized zone, open shift, assigned operator, and in-transit task exist
- WHEN proof is recorded and handoff is requested
- THEN handoff succeeds only with valid proof and version
- AND task, proof, audit, and outbox facts remain tenant-scoped and durable

### Requirement: Fail-closed activation and rollback

The system MUST keep TUS routes, fleet jobs, providers, settlement, and production operations disabled unless their independent authorized evidence gates pass. Rollback MUST stop intake, drain/quarantine in-flight work, preserve audit/outbox/ledger/DLQ evidence, and use append-only compensation; it MUST NOT claim live conformance from local evidence.

#### Scenario: No authorized live evidence

- GIVEN activation evidence is absent, deferred, expired, revoked, deterministic-only, or conflicting
- WHEN an activation report is generated
- THEN status is `not-production-ready`, disposition is `unavailable-deferred`, and gated capabilities are disabled
- AND local deterministic or PostgreSQL evidence remains separately classified
