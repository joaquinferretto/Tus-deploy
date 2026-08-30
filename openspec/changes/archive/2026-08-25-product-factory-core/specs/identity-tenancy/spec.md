# Identity and Tenancy Specification

## Purpose

Provide a neutral successor identity and authorization platform with secure account lifecycle, tenant isolation, and per-product administration.

## Requirements

### Requirement: Successor authentication lifecycle

The system MUST support email/password accounts, verification, recovery, sessions, refresh-token families, device management, MFA, passkeys, OAuth, and OIDC; MUST deny replay and privilege escalation; and MUST preserve both audited auth sources as read-only provenance. Rationale: copying either source blindly would preserve known security regressions.

#### Scenario: Verified sign-in
- GIVEN a registered account with verified email and an enrolled device
- WHEN valid credentials and policy-required MFA are supplied
- THEN the system issues a scoped session, records device/security metadata, and emits an auditable event

#### Scenario: Refresh replay and retry
- GIVEN a refresh token family and two concurrent refresh requests
- WHEN both present the same token
- THEN one atomic PostgreSQL decision rotates the family, the replay is denied/revoked, retries are idempotent, and the event is published through the outbox

#### Scenario: Recovery failure
- GIVEN an expired, reused, or unknown recovery token
- WHEN recovery is attempted
- THEN no credential changes, the response is non-enumerating, rate limits apply, and the security event contains no token

### Requirement: Tenant-scoped authorization and product superadmin

The system MUST model organizations/workspaces, memberships, roles, permissions, tenant context, and deny-by-default RBAC/ABAC; MUST isolate every product tenant; and MUST provide a separate audited superadmin boundary per product. Rationale: organization administration must never become global control.

#### Scenario: Authorized tenant action
- GIVEN a member with permission in workspace A
- WHEN the member reads or changes an owned resource in workspace A
- THEN the action succeeds with tenant and actor context recorded

#### Scenario: Cross-tenant denial
- GIVEN the same member and an identifier belonging to workspace B
- WHEN the member requests it directly or through a search/filter
- THEN the system returns a non-disclosing denial/not-found result and performs no write

#### Scenario: Superadmin rollback evidence
- GIVEN an audited product-superadmin policy change causes an authorization regression
- WHEN operators roll back the policy version
- THEN only that product boundary is restored, affected decisions are traceable, and organization roles are not escalated

### Requirement: Audit, privacy, and retention lifecycle

The system MUST record security and administrative events with redaction, correlation, actor, tenant, outcome, and retention metadata; MUST support consent, opt-out, export/deletion propagation, and configurable retention; and MUST NOT expose raw credentials or indiscriminate personal data. Rationale: platform reuse requires accountable data handling.

#### Scenario: Audited privacy request
- GIVEN a tenant-authorized deletion request
- WHEN policy and retention checks complete
- THEN owned records/assets/projections are deleted or redacted through tracked work and completion evidence is auditable

#### Scenario: Unauthorized privacy access
- GIVEN an actor outside the tenant or without the privacy permission
- WHEN they request another tenant's export or audit data
- THEN access is denied without existence disclosure and the denied attempt is recorded
