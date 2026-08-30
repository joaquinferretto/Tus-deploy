# tus-tenant-commerce-api Specification

## Purpose

Provide the durable, authenticated API foundation for TUS commerce while consuming neutral identity, tenancy, authorization, contracts, audit, outbox, and job boundaries without adding TUS policy to them.

## Requirements

### Requirement: Authenticated Tenant Context

Every TUS command and tenant-owned read MUST derive subject, tenant, actor, role, correlation, and permission context from authenticated session or token data. Client-supplied tenant or actor headers MUST NOT grant authority; authorization MUST deny by default.

#### Scenario: Authorized request

- GIVEN an authenticated staff member has permission in tenant A
- WHEN the member requests an allowed TUS operation for tenant A
- THEN the operation executes with the verified tenant and actor context

#### Scenario: Cross-tenant request

- GIVEN an authenticated actor belongs only to tenant A
- WHEN the actor requests tenant B data or commands
- THEN the API returns denial and no tenant B data or mutation is exposed

### Requirement: Durable Transactional Commerce

TUS commands MUST persist their authoritative records transactionally, including independent product and service commitments, audit references, idempotency results, and required outbox records. A failed transaction MUST expose no partial commercial mutation.

#### Scenario: Separate commitments

- GIVEN a request contains one product line and one service line
- WHEN the authenticated checkout command commits
- THEN two independently addressable commitments are persisted with their own context and status

#### Scenario: Atomic failure

- GIVEN persistence fails before the command transaction commits
- WHEN the command is processed
- THEN no commitment, audit reference, or outbox record is presented as committed

### Requirement: Idempotent Commands

Each mutating request MUST require an idempotency key and request fingerprint. Replaying the same key and fingerprint MUST return the original durable result; reusing a key with a different fingerprint MUST fail without mutation.

#### Scenario: Safe replay

- GIVEN a command has already committed with key K
- WHEN the identical command is retried
- THEN the API returns the original result and creates no duplicate commitment

#### Scenario: Idempotency conflict

- GIVEN key K was committed for payload P
- WHEN K is submitted with payload Q
- THEN the API rejects the conflict and preserves the result for P

### Requirement: Deterministic Harness Boundary

Provider-free in-memory stores MAY support unit and contract tests for the same authorization, transaction, and replay rules. They MUST be explicitly test-only and MUST NOT be used by production composition or described as durable API evidence.

#### Scenario: Test-only composition

- GIVEN a deterministic harness is selected
- WHEN a command succeeds in memory
- THEN its evidence identifies the harness and production persistence remains unclaimed
