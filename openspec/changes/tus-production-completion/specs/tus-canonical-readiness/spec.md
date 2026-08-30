# TUS Canonical Readiness Specification

## Purpose

Define one versioned, evidence-owned, fail-closed readiness decision for TUS capabilities and activation.

## Requirements

### Requirement: Single canonical decision

All TUS publication, commitment, provider, release, payout, fleet, and activation decisions MUST consume one versioned readiness contract. Legacy or contradictory readiness implementations MUST NOT independently enable behavior.

#### Scenario: Consistent evaluation

- GIVEN current evidence for a requested capability and profile
- WHEN readiness is evaluated
- THEN the canonical decision returns one disposition and capability-specific reasons

#### Scenario: Conflicting evaluator

- GIVEN a legacy evaluator disagrees with the canonical contract
- WHEN an action is authorized
- THEN the stricter disabled result wins and the conflict is audited

### Requirement: Evidence-owned gates

Each required gate MUST identify capability, profile, owner, scope, evidence type, issued and expiry times, revocation state, policy version, and source. Missing, expired, revoked, malformed, or out-of-scope evidence MUST fail closed.

#### Scenario: Current scoped approval

- GIVEN all required evidence is current, non-revoked, and scoped to the requested profile
- WHEN the capability is evaluated
- THEN only that capability may receive an enabled disposition

#### Scenario: Missing or expired evidence

- GIVEN one required gate lacks valid current evidence
- WHEN publication, release, or provider action is requested
- THEN the action is denied with a stable reason and no side effect

### Requirement: Truthful evidence labels

Readiness output MUST distinguish `local-deterministic`, `local-postgresql-http`, `authorized-external`, and `deferred` evidence. Deterministic fixtures MUST NOT satisfy live legal, provider, cloud, POS, or production gates.

#### Scenario: Provider-free evaluation

- GIVEN only deterministic test evidence exists
- WHEN a production readiness report is generated
- THEN live capabilities remain disabled and the report says `deferred` or unavailable
