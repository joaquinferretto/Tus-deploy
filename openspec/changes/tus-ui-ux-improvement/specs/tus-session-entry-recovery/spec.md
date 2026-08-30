# TUS Session Entry and Recovery Specification

## Purpose

Provide truthful web and mobile entry into TUS without allowing a client to invent identity, tenant, authorization, or session outcomes.

## Requirements

### Requirement: Server-authoritative session entry

Web and mobile surfaces MUST obtain identity and tenant scope from the approved authentication/session boundary. They MUST NOT accept tenant, actor, permissions, or financial authority entered or altered in the UI.

#### Scenario: Approved authenticated handoff

- GIVEN the approved identity flow returns a valid tenant-scoped session
- WHEN the user completes the handoff
- THEN the surface enters the protected experience with the returned scope and no client-supplied authority

#### Scenario: Missing authentication

- GIVEN no approved session is available
- WHEN a protected route is opened
- THEN it shows an actionable sign-in or handoff state and does not render tenant data or a fake success

### Requirement: Secure restoration and expiry recovery

The surfaces MUST distinguish restoration, restored, expired, malformed, revoked, and unavailable session states. Expiry or malformed credentials MUST lead to reauthentication or an explicit handoff, while preserving no secret in UI copy or logs.

#### Scenario: Valid restoration

- GIVEN a persisted credential is valid and its server scope can be used
- WHEN the application starts or returns to foreground
- THEN it shows a bounded restoration state before protected data and then loads the authorized surface

#### Scenario: Expired or malformed session

- GIVEN restoration fails because credentials are expired, revoked, malformed, or unavailable
- WHEN recovery completes
- THEN protected data is withheld, local session authority is cleared, and a retry or approved reauthentication action is shown

### Requirement: Tenant-safe recovery boundaries

Recovery, retry, and sign-out actions MUST preserve tenant isolation and MUST NOT disclose whether a foreign tenant, actor, commitment, payment, or settlement exists.

#### Scenario: Foreign scope attempt

- GIVEN a session requests a resource outside its authorized tenant
- WHEN the surface receives denial or an empty authorized scope
- THEN it renders a non-disclosing error/empty state and records no client-side success

#### Scenario: Recovery evidence boundary

- GIVEN only deterministic session/component checks are available
- WHEN readiness or completion is described
- THEN the result is labeled deterministic evidence and browser/device authentication proof remains deferred
