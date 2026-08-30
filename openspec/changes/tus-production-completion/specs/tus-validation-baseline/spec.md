# TUS Validation Baseline Specification

## Purpose

Establish a trustworthy, repeatable validation baseline for TUS production-completion claims. Local deterministic proof and live external evidence MUST remain separately labeled.

## Requirements

### Requirement: Classified repository baseline

The validation program MUST classify every known full-suite failure, including the 19 audited failures, as resolved, accepted pre-existing, environmental, or deferred with an owner and rerun command. Unexplained failures MUST block a completion claim.

#### Scenario: Classification is complete

- GIVEN the repository full suite reports failures
- WHEN baseline triage is recorded
- THEN every failure has a disposition, evidence, owner, and rerun command

#### Scenario: New unexplained failure

- GIVEN a rerun produces a failure absent from the baseline register
- WHEN completion status is evaluated
- THEN the baseline is not trusted and activation evidence cannot be promoted

### Requirement: Stable local validation

Deterministic tests, contract validation, builds, lint, and serial resource-bounded reruns MUST produce reproducible results without external provider calls. OOM, concurrency, and tooling failures MUST be isolated rather than hidden by parallel execution.

#### Scenario: Local proof succeeds

- GIVEN provider-free fixtures and a bounded database configuration
- WHEN required checks run serially
- THEN results include command, exit status, test counts, and a `local-deterministic` label

#### Scenario: Resource instability occurs

- GIVEN a check exhausts memory or fails due to concurrent resource contention
- WHEN the baseline runner captures the result
- THEN it records the resource cause and rerun isolation instead of marking the check passed

### Requirement: PostgreSQL HTTP smoke boundary

The program MUST provide a repeatable authenticated HTTP smoke path against PostgreSQL that proves persistence, restart, replay, rollback, and cross-tenant denial. Fake transports MUST NOT be reported as database or production evidence.

#### Scenario: Durable smoke passes

- GIVEN a disposable or authorized PostgreSQL instance and seeded safe fixtures
- WHEN the HTTP journey runs through restart and replay
- THEN durable outcomes are labeled `local-postgresql-http`

#### Scenario: Database or external boundary is unavailable

- GIVEN PostgreSQL, browser, device, or provider access is unavailable
- WHEN evidence is summarized
- THEN deterministic results remain valid but the unavailable boundary is explicitly `deferred`
