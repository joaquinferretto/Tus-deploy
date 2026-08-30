# TUS Validation Hardening Specification

## Purpose

Define a strict, repeatable validation baseline for the TUS repository without reducing coverage or treating tooling compatibility as product proof.

## Requirements

### Requirement: Canonical full-suite baseline

The validation baseline MUST use the canonical 98-schema contract, preserve existing assertions, and classify every known failure with disposition, owner, evidence, and rerun command. Any unexplained failure MUST block a clean baseline.

#### Scenario: Repaired baseline

- GIVEN the full suite and contract validator run
- WHEN all known stale assertions are evaluated against the canonical contract
- THEN the suite reports 98 schemas, zero unexplained failures, and unchanged behavioral coverage

#### Scenario: Regression or unknown failure

- GIVEN a rerun exposes a new failure or a weakened assertion
- WHEN baseline status is calculated
- THEN the baseline is failed and the failure is recorded rather than suppressed

### Requirement: Node 22-compatible TypeScript execution

All TypeScript exercised by the declared Node 22 test path MUST be executable by that runtime without strip-only syntax incompatibilities, while retaining the same public behavior and regression coverage.

#### Scenario: Runtime-compatible test path

- GIVEN the Node 22 test command loads WhatsApp and marketplace modules
- WHEN the suite executes those modules
- THEN they load successfully and their existing behavioral assertions run

#### Scenario: Unsupported syntax is encountered

- GIVEN a test path contains syntax Node 22 cannot strip or execute
- WHEN validation starts
- THEN the command fails clearly as a compatibility defect and does not report a pass

### Requirement: Canonical versioned marketplace contract

The web client and contract tests MUST use the canonical versioned TUS marketplace path. A server compatibility alias MAY remain only when it is explicitly tested, equivalent, and unable to create a second semantic contract.

#### Scenario: Versioned request

- GIVEN a marketplace discovery request is initiated
- WHEN the client sends it to the API
- THEN it uses the canonical `/tus/v1/marketplace` contract and parses the documented response

#### Scenario: Legacy alias request

- GIVEN a consumer still uses the compatibility path
- WHEN the server accepts it
- THEN it maps to the canonical behavior, is covered by regression tests, and does not alter authorization or evidence

### Requirement: Deterministic root validation gates

Root test, build, typecheck, and lint commands MUST be non-interactive, task-complete, serial/resource-bounded where required, and repeatable across two consecutive runs. Task-discovery errors MUST fail the gate.

#### Scenario: Repeated root checks

- GIVEN declared local dependencies and provider-free fixtures
- WHEN the root validation matrix runs twice
- THEN both runs complete without prompts or missing-task errors and report command, status, and counts

#### Scenario: Resource or tooling failure

- GIVEN a command is OOM, contended, or missing a declared task
- WHEN the matrix records its result
- THEN it remains failed or deferred with cause and rerun guidance, never silently green
