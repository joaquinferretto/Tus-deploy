# TUS Identity and Tenant Bootstrap Specification

## Purpose

Provide durable authenticated identity, organization tenancy, role authorization, onboarding, and customer access for TUS HTTP journeys.

## Requirements

### Requirement: Durable authenticated context

Every protected TUS command and read MUST derive subject, session, tenant, role, permission, and correlation context from authenticated server-side state. Client tenant or actor headers MUST NOT grant authority.

#### Scenario: Authorized merchant request

- GIVEN an active session with membership and required permission
- WHEN the merchant calls a tenant-owned route
- THEN the request uses the session-derived context and is audited

#### Scenario: Spoofed tenant header

- GIVEN a session for tenant A and a request naming tenant B in a header or body
- WHEN the request is processed
- THEN it is denied without exposing tenant B data or mutating it

### Requirement: Safe bootstrap and role scope

Signup, session creation, organization onboarding, invitations, and customer access MUST persist durable identity and membership records with explicit role scopes. Platform superadmin and merchant administration MUST remain separate.

#### Scenario: Onboard approved merchant

- GIVEN a valid authenticated signup and an allowed launch cohort
- WHEN the owner completes required organization setup
- THEN the organization, membership, capabilities, and audit record persist durably

#### Scenario: Cross-tenant access

- GIVEN a user belongs to tenant A but requests tenant B data or mutation
- WHEN authorization runs
- THEN access is denied and the denial is recorded without a partial write

### Requirement: Restart-safe sessions and fixtures

Safe explicit fixtures MAY support local proof, but they MUST be clearly test-only and MUST NOT create production identities or bypass authentication. Session and membership state MUST survive API restart.

#### Scenario: Restart recovery

- GIVEN a valid persisted session and membership
- WHEN the API restarts and the user repeats an authorized request
- THEN the request succeeds with the same tenant scope
