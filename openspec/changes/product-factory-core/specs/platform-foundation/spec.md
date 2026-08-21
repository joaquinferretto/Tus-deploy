# Platform Foundation Specification

## Purpose

Define a neutral, contract-first foundation that starts deterministically, exposes no vertical behavior, and gives every later capability a portable operational boundary.

## Requirements

### Requirement: Explicit neutral configuration and lifecycle

The system MUST validate profile, provider, database, security, quota, and telemetry configuration before serving traffic; MUST fail fast on missing production-required values; and MUST expose health, readiness, graceful shutdown, and redacted error contracts. Rationale: silent defaults create unsafe or non-reproducible products.

#### Scenario: Valid local startup
- GIVEN a clean checkout with documented fictitious local values
- WHEN the complete Compose profile starts
- THEN API, web, mobile support, Python runtime, PostgreSQL, MongoDB, Redis, and local fakes become ready with correlated health evidence

#### Scenario: Invalid production configuration
- GIVEN a production profile missing a required secret-store reference
- WHEN startup validation runs
- THEN the process exits non-ready, reports the field and remediation without its value, and emits no provider credential

#### Scenario: Safe rollback
- GIVEN a deployed slice fails its readiness contract
- WHEN operators select the last passing profile/configuration version
- THEN traffic stops before partial serving, durable work remains recoverable, and the rollback record contains version, operator, reason, and health evidence

### Requirement: Contract, boundary, and telemetry governance

The system MUST maintain one explicit compatibility contract for TypeScript, JSON Schema, and Python boundaries; MUST validate ingress and egress; MUST keep domain/application code behind ports; and MUST propagate redacted correlation, trace, metric, and structured-log context through middleware. Rationale: cross-runtime drift and vendor imports are the primary reuse risks.

#### Scenario: Cross-runtime contract success
- GIVEN a valid versioned workflow or asset message
- WHEN Node and Python exchange it
- THEN both accept the same fields and correlation identifiers and preserve tenant context

#### Scenario: Contract failure and retry
- GIVEN an invalid or unsupported message version
- WHEN a consumer receives it
- THEN it rejects safely, records a redacted diagnostic, applies bounded retry or quarantine policy, and never executes an unvalidated action

#### Scenario: Architectural boundary evidence
- GIVEN a dependency-boundary check and a tenant-scoped request
- WHEN verification runs
- THEN forbidden vendor/SQL imports are detected and telemetry proves tenant, actor, request, and outcome without sensitive payloads

### Requirement: Profile parity and clean-environment portability

The system MUST document and verify complete Docker Compose local integration, Render-native production, and AWS Terraform production profiles; MUST preserve shared contracts, ownership, behavior, evidence gates, and rollback semantics; and MUST NOT use production Docker for Render. Rationale: a profile file without conformance is a false portability claim.

#### Scenario: Fresh-team bootstrap
- GIVEN a neutral team with no maintainer-only knowledge
- WHEN it follows the documentation in a fresh checkout
- THEN it can configure Compose, run the reference flow, identify every gated live dependency, and verify no vertical vocabulary in the core

#### Scenario: Profile parity failure
- GIVEN the same contract case is run against Render and AWS profile configurations
- WHEN one profile diverges or lacks a required ownership/rollback gate
- THEN that profile is marked unsupported rather than advertised as production-ready
