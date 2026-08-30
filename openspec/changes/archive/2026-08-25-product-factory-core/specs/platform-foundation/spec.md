# Platform Foundation Specification

## Purpose

Define a neutral, contract-first foundation with deterministic startup, portable operational boundaries, and no vertical behavior.

## Requirements

### Requirement: Explicit neutral configuration and lifecycle

The system MUST validate profile, provider, database, security, quota, and telemetry configuration before serving traffic; fail fast on missing production values; and expose health, readiness, graceful shutdown, and redacted errors.

#### Scenario: Valid cloud-native profile validation
- GIVEN an explicitly selected Render-native or AWS Terraform profile
- WHEN plan/validation checks run with redacted configuration
- THEN the profile is accepted only for its declared services, boundaries, and activation gates

#### Scenario: Invalid production configuration
- GIVEN a production profile missing a required secret-store reference
- WHEN startup validation runs
- THEN it remains non-ready, reports the field and remediation without its value, and emits no credential

#### Scenario: Safe rollback
- GIVEN a deployed slice fails readiness
- WHEN operators select the last passing profile/configuration
- THEN traffic stops before partial serving, durable work remains recoverable, and the rollback records version, reason, and health evidence

### Requirement: Native local development profile

The system MUST provide source-free wrappers where `cd backend && pnpm run dev` delegates to `apps/api` and `cd frontend && pnpm run dev` delegates to `apps/web`. The profile MUST resolve the repository-root `.env` by explicit path and consume only `DATABASE_URL`; it MUST NOT copy, log, commit, or expose secret values. PostgreSQL is required through `DATABASE_URL`. MongoDB, Redis, the Python worker, mobile, and external providers MUST be optional, disabled, or deterministic fakes, with limitations documented. Native local MUST NOT be advertised as production or full integration.

#### Scenario: Exact native wrappers
- GIVEN a clean checkout with the native profile documented
- WHEN each exact command runs
- THEN its source-free wrapper delegates to the corresponding app without copying source or environment files

#### Scenario: Native dependency boundary
- GIVEN `DATABASE_URL` resolves from the repository-root `.env`
- WHEN native API startup runs
- THEN PostgreSQL connectivity is required and every other listed dependency reports its declared fake, disabled, or optional limitation

#### Scenario: Missing database configuration
- GIVEN the root `.env` is absent or lacks `DATABASE_URL`
- WHEN native API validation runs
- THEN the API remains non-ready and reports only the missing key and remediation, never any value

### Requirement: Separate native and cloud acceptance evidence

The system MUST record native smoke, cloud plan/validation, and authorized cloud smoke as separate evidence classes. The active integration/deployment gate MUST use the explicitly selected Render-native or AWS Terraform profile, with PostgreSQL, MongoDB, Redis, object storage, and queues represented by configured managed boundaries or deterministic fakes. Credentials or resources that are absent MUST produce an unavailable/deferred result, never a passing live claim. Docker Compose MUST remain retained as an optional deferred requirement and MUST NOT be a completion dependency.

#### Scenario: Native smoke evidence
- GIVEN PostgreSQL is reachable through `DATABASE_URL`
- WHEN both wrappers run
- THEN separate evidence records commands, health, dependency states, and no secret values or copied `.env`

#### Scenario: Cloud plan and authorized smoke are distinct
- GIVEN cloud-native plan/validation passes but no authorized credentials or resources exist
- WHEN acceptance is evaluated
- THEN plan/validation is recorded, authorized smoke is unavailable, and live conformance is not claimed

#### Scenario: Optional Compose remains deferred
- GIVEN native smoke and cloud-native evidence are being evaluated
- WHEN Docker Compose is unavailable or not run
- THEN the active completion gate remains unaffected, existing Compose files are retained, and Compose is recorded as deferred

### Requirement: Contract, boundary, and telemetry governance

The system MUST maintain one compatibility contract for TypeScript, JSON Schema, and Python; validate ingress and egress; keep domain/application code behind ports; and propagate redacted correlation, trace, metric, and structured-log context.

#### Scenario: Cross-runtime contract success
- GIVEN a valid versioned workflow or asset message
- WHEN Node and Python exchange it
- THEN both preserve fields, correlation identifiers, and tenant context

#### Scenario: Contract failure and retry
- GIVEN an invalid or unsupported message version
- WHEN a consumer receives it
- THEN it rejects safely, records a redacted diagnostic, and retries or quarantines without executing it

#### Scenario: Architectural boundary evidence
- GIVEN a dependency check and tenant-scoped request
- WHEN verification runs
- THEN forbidden vendor/SQL imports fail the check and telemetry excludes sensitive payloads

### Requirement: Profile parity and clean-environment portability

The system MUST document and verify native developer smoke plus the selected cloud-native Render or AWS Terraform profile. Shared contracts, ownership, behavior, evidence gates, and rollback semantics MUST remain consistent; production Docker MUST NOT be used for Render; native limitations MUST NOT weaken cloud integration requirements; and no profile MAY silently substitute another profile or managed service.

#### Scenario: Fresh-team bootstrap
- GIVEN a neutral team with no maintainer-only knowledge
- WHEN it follows the fresh-checkout documentation
- THEN it can run native API/web smoke, select one cloud-native profile, identify managed-service boundaries, and identify every fake or activation gate

#### Scenario: Profile parity failure
- GIVEN the same contract case runs against Render and AWS
- WHEN one profile lacks a required ownership or rollback gate
- THEN that profile is unsupported rather than advertised as production-ready
