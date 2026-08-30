# TUS MVP Readiness Truthfulness Specification

## Purpose

Keep documentation, SDD artifacts, readiness reports, and evidence labels synchronized with what has actually been verified for the Argentina-first MVP.

## Requirements

### Requirement: Synchronized readiness matrix

The repository MUST publish one traceable matrix mapping each readiness claim to its command or artifact, execution environment, date or revision, scope, owner, and status. Documentation MUST NOT report a stronger status than its evidence.

#### Scenario: Evidence-backed update

- GIVEN a validation or smoke result is recorded
- WHEN readiness documentation is regenerated or updated
- THEN the matrix includes the exact evidence class and only the verified scope

#### Scenario: Stale claim is found

- GIVEN an SDD, runbook, or README contradicts current test or readiness output
- WHEN the truthfulness check runs
- THEN the contradiction is reported as a documentation failure and the stronger claim is not published

### Requirement: Fail-closed external evidence boundaries

Only authorized external evidence MAY satisfy provider, cloud, production, browser, screen-reader, physical-device, POS pilot, legal, tax, KYC/KYB, or deployment-conformance gates. Local fixtures, unit tests, builds, screenshots, configuration, and PostgreSQL smoke MUST NOT substitute for those records.

#### Scenario: Deterministic proof only

- GIVEN local tests, builds, contract checks, or component checks pass
- WHEN the MVP readiness decision is produced
- THEN external gates remain `deferred` or `disabled` and no live capability is claimed

#### Scenario: Unauthorized external artifact

- GIVEN an external-looking artifact lacks authorization, owner, scope, validity, or revocation status
- WHEN it is considered for a readiness gate
- THEN it is rejected, the gate remains disabled, and the missing evidence is named

### Requirement: Explicit evidence taxonomy

Reports MUST distinguish `local-deterministic`, `local-postgresql-http`, `authorized-external`, and `deferred`; each result MUST identify unavailable boundaries and MUST NOT generalize one environment's observation to another.

#### Scenario: Mixed evidence report

- GIVEN deterministic checks pass, PostgreSQL smoke is deferred, and no provider evidence exists
- WHEN a report is generated
- THEN each status is listed separately and the overall readiness remains not ready for the missing gates

#### Scenario: Scoped authorized evidence

- GIVEN authorized evidence covers one capability and profile only
- WHEN the matrix is evaluated
- THEN only that capability/profile is marked enabled and unrelated capabilities remain unchanged

### Requirement: Preserve MVP boundaries and non-goals

Documentation and readiness output MUST preserve Argentina-first scope, financial and tenant authority boundaries, and explicit non-goals. They MUST NOT imply global launch, regulated verticals, financing, custody or escrow, open driver bidding, mature dispatch, warehouse automation, or unbounded AI authority.

#### Scenario: Readiness summary is published

- GIVEN local hardening succeeds
- WHEN the MVP summary is rendered
- THEN verified local improvements are stated while deferred external gates and non-goals remain visible

#### Scenario: Unsupported capability appears

- GIVEN a report requests an excluded capability or unsupported evidence class
- WHEN the summary is evaluated
- THEN the capability remains disabled and the report identifies it as out of scope
