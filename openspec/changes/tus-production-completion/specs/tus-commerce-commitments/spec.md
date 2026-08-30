# TUS Commerce Commitments Specification

## Purpose

Make product and service commitments durable, idempotent, auditable, replayable, and safe across restart and failure.

## Requirements

### Requirement: Atomic durable commitment creation

Creating a commitment MUST atomically persist its aggregate, request idempotency record, audit event, and outbox event in PostgreSQL/Prisma. A failed transaction MUST leave no partial commercial state.

#### Scenario: Successful command

- GIVEN an authorized current product or service intent
- WHEN the command commits
- THEN the commitment, audit, and outbox records are durable and correlated

#### Scenario: Transaction failure

- GIVEN persistence fails after the command begins
- WHEN the transaction is rolled back
- THEN no commitment, audit reference, or outbox side effect is visible

### Requirement: Idempotent replay and conflict

Commands MUST require an idempotency key and request fingerprint. Repeating an identical command MUST return the original result; reusing the key with different intent MUST be rejected without mutation.

#### Scenario: Safe replay after timeout

- GIVEN a committed command whose response was lost
- WHEN the same key and fingerprint are retried
- THEN the original result is returned and no duplicate commitment is created

#### Scenario: Fingerprint conflict

- GIVEN an existing key bound to a different payload or tenant
- WHEN it is reused
- THEN the request is rejected and the original record remains unchanged

### Requirement: Restart and outbox recovery

Pending outbox work MUST be recoverable after restart with bounded retry and dead-letter state. Replays MUST preserve commitment lifecycle ownership and audit history.

#### Scenario: Restart replay

- GIVEN a committed event pending delivery
- WHEN the worker restarts and reclaims it
- THEN it processes at most once per idempotency identity or records a safe duplicate outcome
