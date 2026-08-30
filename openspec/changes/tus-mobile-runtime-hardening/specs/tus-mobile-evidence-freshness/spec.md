# TUS Mobile Evidence Freshness Specification

## Purpose

Keep readiness and native-smoke receipts aligned with the current deterministic
baseline while preserving explicit external-gate blockers and non-goals.

## Requirements

### Requirement: Current deterministic baseline is recorded

The readiness matrix and native-smoke receipt MUST identify the current
deterministic baseline as `pnpm test`: **464 passed, 0 failed, 0 skipped** across
87 isolated suites, dated and tied to the reviewed repository revision. Related
local checks MAY be listed only with their observed result and boundary.

#### Scenario: Evidence documents match the rerun (RED → GREEN)

- GIVEN the v2 audit reports 464 passing tests and the readiness matrix records 440
- WHEN the evidence receipts are refreshed
- THEN current full-suite claims show exactly 464/0/0 and no stale 440 claim remains current (GREEN)

#### Scenario: Local evidence is bounded (RED → GREEN)

- GIVEN deterministic typecheck, build, lint, contract, security, mobile-Jest, and Expo-export results
- WHEN they are written as receipts
- THEN each is labeled local/deterministic (including mobile-web harness limits) and is not presented as production or device evidence (GREEN)

### Requirement: Historical receipts are explicitly superseded

Evidence documents MUST preserve useful history only when it is labeled
historical or superseded. Historical `29/29`, `440`, and blocked-scan statements
MUST NOT override the current 464-test snapshot or be described as current proof.

#### Scenario: Stale native-smoke history cannot become authoritative (RED → GREEN)

- GIVEN native-smoke contains an older 29/29 full-test claim and an older scan status
- WHEN a reader evaluates current readiness
- THEN the receipt marks those statements superseded and points to the current baseline and applicable current status (GREEN)

### Requirement: External activation remains fail-closed

Receipts MUST state `not-production-ready` when required PostgreSQL, provider,
cloud, browser/device, POS-pilot, compliance, or production-operations evidence
is unavailable. The activation result MUST remain `unavailable-deferred`, use
`deferred`, set `liveConformance: false`, and keep TUS routes, providers,
release jobs, and fleet jobs disabled.

#### Scenario: Local evidence cannot authorize activation (RED → GREEN)

- GIVEN 464 deterministic tests pass but external evidence is missing
- WHEN readiness is evaluated for `render-native` or `aws-terraform`
- THEN the result remains deferred with exact missing blockers, no credentials/provider payloads are read or emitted, and no external call occurs (GREEN)

### Requirement: Scope and non-goals remain visible

The refreshed receipts MUST state that this change adds no product capability and
does not prove PostgreSQL durability, providers, cloud runtime, browser/device
conformance, POS pilot, legal/tax/KYC/KYB approval, or production operations.
Excluded MVP scopes MUST remain disabled.

#### Scenario: Documentation does not promote deferred evidence (RED → GREEN)

- GIVEN a reader has only local mobile and repository evidence
- WHEN the reader follows the refreshed readiness documents
- THEN the documents direct the reader to authorized, profile-scoped external evidence before activation and make no broader readiness claim (GREEN)
