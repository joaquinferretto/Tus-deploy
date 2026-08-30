# TUS Runtime Readiness Enforcement Specification

## Purpose

Ensure every TUS mutation and activation boundary consumes the canonical, versioned readiness decision and fails closed when evidence is insufficient.

## Requirements

### Requirement: Canonical guard at mutation boundaries

Publication, commitment, provider, release, payout, fleet, deployment, and activation routes or jobs MUST evaluate the canonical readiness contract before performing an effect. No legacy evaluator or configuration flag MAY independently enable an effect.

#### Scenario: Approved capability mutation

- GIVEN current evidence enables one capability for one profile
- WHEN its route or job is invoked with authorized tenant and actor context
- THEN the canonical decision is evaluated before the mutation and only that scoped effect proceeds

#### Scenario: Unguarded entry point

- GIVEN a mutation entry point bypasses the canonical evaluator
- WHEN enforcement coverage is assessed
- THEN the readiness gate fails and the entry point is not considered production-safe

### Requirement: Fail-closed denial with no side effects

Missing, expired, revoked, malformed, conflicting, or out-of-scope evidence MUST produce a stable denied disposition before side effects, including persistence, provider calls, outbox publication, release, payout, or job dispatch.

#### Scenario: Invalid evidence denial

- GIVEN any required gate is missing, expired, revoked, malformed, conflicting, or out of scope
- WHEN a protected route or job is requested
- THEN it returns a stable denial reason and creates no protected side effect

#### Scenario: Conflicting decisions

- GIVEN canonical and legacy evaluations disagree
- WHEN authorization is resolved
- THEN the stricter disabled result wins, the conflict is auditable, and no action is started

### Requirement: Scoped auditable decisions

Each evaluated decision MUST retain capability, profile, tenant or scope, evidence classification, policy version, reason, actor or job identity, and correlation attribution sufficient to explain the outcome without exposing secrets.

#### Scenario: Valid scoped evidence

- GIVEN evidence is current, non-revoked, and scoped to capability C and profile P
- WHEN capability C is evaluated
- THEN only C/P receives an enabled disposition and the decision is auditable

#### Scenario: Scope mismatch

- GIVEN evidence is valid for a different tenant, profile, or capability
- WHEN the requested action is evaluated
- THEN it is denied as out of scope and the foreign evidence is not disclosed

### Requirement: Safe revocation behavior

When an enabled gate becomes revoked or disabled, the system MUST stop new affected effects, drain or quarantine pending consumers, preserve audit/evidence/ledger history, and use compensating entries instead of destructive financial rollback.

#### Scenario: Revocation during queued work

- GIVEN a previously accepted capability has pending work
- WHEN its gate is revoked before execution
- THEN new work is denied, pending work is drained or quarantined, and prior records remain intact
