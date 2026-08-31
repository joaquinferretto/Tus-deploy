# POS Durability Runtime Specification

## Purpose

Prove durable tenant-scoped product and service POS behavior without provider activation. This scope preserves API/POS runtime evidence while excluding capture, settlement, payout, hardware, and compliance claims.

## Requirements

### Requirement: Atomic product and service POS persistence

Product and service operations MUST persist atomically with tenant-scoped idempotency, version/conflict protection, receipt state, audit, and outbox records. Provider capture, settlement, and payout MUST remain unclaimed and unverified.

#### Scenario: Retry and conflict
- GIVEN product and service requests, one repeated key, and a conflicting version
- WHEN both operation types are submitted
- THEN the repeated key returns the original result, the conflict creates no partial write, each committed operation has receipt/audit/outbox state, and provider calls remain zero

#### Scenario: Tenant boundary
- GIVEN two tenants and a product or service belonging to only one tenant
- WHEN the other tenant reads or mutates that operation
- THEN access is denied, no cross-tenant record changes, and the denial is recorded without secret data

### Requirement: Replay and recovery

Outbox replay and restart recovery MUST be bounded, tenant-scoped, and recover committed events without duplicate business effects or lost audit evidence. Evidence MUST be classified as real PostgreSQL only when the underlying run actually succeeds.

#### Scenario: Restarted dispatcher
- GIVEN a committed undispatched event and a stopped dispatcher
- WHEN the dispatcher restarts and replays it
- THEN the event is recovered at most once, acknowledgement is durable, and audit/business counts remain unchanged after repeat replay

#### Scenario: Unavailable database proof
- GIVEN PostgreSQL authorization or connectivity is unavailable
- WHEN POS durability cannot be exercised
- THEN the result is `external-blocked` or deferred, with no invented success and no provider activation claim
