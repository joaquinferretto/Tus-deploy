# TUS Durable HTTP Evidence Specification

## Purpose

Define truthful, repeatable PostgreSQL-backed HTTP smoke evidence for durable TUS behavior without claiming unavailable infrastructure or external conformance.

## Requirements

### Requirement: Authorized durable HTTP journey

When an authorized PostgreSQL instance is available, the smoke suite MUST exercise real authenticated HTTP boundaries backed by PostgreSQL and MUST prove tenant-scoped identity, marketplace publication or discovery, separate product/service intent, and durable outcome persistence.

#### Scenario: PostgreSQL journey passes

- GIVEN an authorized PostgreSQL URL and safe disposable fixtures
- WHEN the authenticated HTTP journey runs through identity, tenant scope, discovery, and separate intents
- THEN outcomes are read from PostgreSQL and labeled `local-postgresql-http`

#### Scenario: Fake or in-memory transport is used

- GIVEN the smoke path uses a fake transport or in-memory store
- WHEN evidence is summarized
- THEN it is labeled deterministic test evidence and MUST NOT be labeled PostgreSQL, durable, or production evidence

### Requirement: Restart and replay proof

The smoke suite MUST verify that committed state, idempotency identity, audit attribution, and recoverable outbox or job state survive an application restart and that replay does not duplicate a commitment or financial effect.

#### Scenario: Replay after lost response

- GIVEN an HTTP command may have committed before the process restarts
- WHEN the same intent is replayed with the same idempotency identity and fingerprint
- THEN the original durable result is returned and no duplicate effect is created

#### Scenario: Restart recovery

- GIVEN durable records exist before an authorized restart
- WHEN the application resumes and the journey is queried or recovered
- THEN records, tenant scope, audit attribution, and pending recoverable work remain consistent

### Requirement: Negative-path and isolation evidence

The smoke suite MUST cover rollback or rejection, cross-tenant denial, and stale or unavailable facts, and MUST prove denied requests leave no unauthorized durable mutation.

#### Scenario: Cross-tenant denial

- GIVEN an authenticated actor requests another tenant's listing, intent, or status
- WHEN the HTTP API evaluates the request
- THEN it denies or returns an authorized empty result without leaking data or mutating PostgreSQL

#### Scenario: Infrastructure unavailable

- GIVEN PostgreSQL or the authorized restart environment cannot be used
- WHEN the smoke command is run
- THEN it records `deferred` with the unavailable boundary and rerun command, without fabricating success

### Requirement: Evidence boundary

This smoke evidence MUST remain separate from provider, cloud, browser, screen-reader, physical-device, POS, legal, tax, KYC/KYB, and production evidence. Local PostgreSQL proof MUST NOT promote any of those gates.

#### Scenario: Local-only report

- GIVEN durable local HTTP evidence passes and no authorized external records exist
- WHEN readiness is reported
- THEN external gates remain disabled or deferred and the report names the missing evidence
