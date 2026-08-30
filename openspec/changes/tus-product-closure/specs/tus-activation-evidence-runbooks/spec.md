# TUS Activation, Evidence, and Runbooks Specification

## Purpose

Make readiness claims, pilot evidence, deployment recovery, and rollback operationally truthful and fail-closed.

## Requirements

### Requirement: Truthful activation and evidence reporting

Reports MUST separate `local-deterministic`, `local-postgresql-http`, `authorized-external`, and `deferred` evidence. Missing, unsafe, unavailable, failed, expired, revoked, deterministic-only, or conflicting prerequisites MUST produce `not-production-ready` and `unavailable-deferred` (or the precise failure classification), with gated capabilities disabled. Presence of configuration or local success MUST NOT imply reachability, production, provider, or live-completion authorization.

#### Scenario: No authorized target

- GIVEN PostgreSQL variables are absent or no authorized disposable identity is proven
- WHEN readiness and pilot reports are generated
- THEN they state deferred/no target, expose no URL or secret, and record zero database/provider actions
- AND no production or live POS claim is emitted

#### Scenario: Safe PostgreSQL evidence

- GIVEN the canonical target passes syntax, identity, non-production, migration, auth, readiness, and scenario gates
- WHEN the bounded pilot completes successfully
- THEN the report records the tested scenarios, counts, cleanup result, and evidence references
- AND it remains local PostgreSQL verification with `liveConformance:false`

#### Scenario: Assertion or infrastructure failure

- GIVEN the runtime starts but an invariant fails, or startup/database infrastructure is unavailable
- WHEN the report is finalized
- THEN it distinguishes `assertion-failure` from `unavailable`, preserves the failing boundary, and disables affected gates

### Requirement: Fail-closed production boundary

Activation MUST require independent authorized evidence for every gated capability and MUST NOT be enabled by deterministic tests, local PostgreSQL evidence, credentials, plan output, or a successful report from this change. Provider, cloud, settlement, and production actions MUST remain disabled unless separately authorized outside this closure scope.

#### Scenario: Conflicting or stale evidence

- GIVEN evidence is expired, revoked, deterministic-only, conflicting, or missing an owner or scope
- WHEN an activation decision is requested
- THEN the decision is `not-production-ready` and all dependent capabilities remain disabled
- AND the report identifies the missing gate without fabricating a completion claim

### Requirement: Production runbook and append-only rollback

The runbook MUST define preflight authorization, intake stop, drain/quarantine, health checks, evidence capture, resource closure, owner escalation, and recovery criteria. Rollback MUST revert only this change's deployment behavior, preserve ledger/audit/outbox/dead-letter/evidence history, delete only unique disposable fixtures, and use append-only compensation rather than destructive shared-state rollback.

#### Scenario: Failed deployment or pilot recovery

- GIVEN deployment, migration, startup, or pilot validation fails after intake begins
- WHEN rollback is invoked
- THEN intake stops, in-flight work is drained or quarantined, resources close, and durable evidence is preserved
- AND the system returns to a disabled/not-production-ready state

#### Scenario: Authorized retry after recovery

- GIVEN the failure cause is resolved and a new owner-approved disposable target and evidence window exist
- WHEN the runbook retry is started
- THEN preflight gates are evaluated again from zero and only unique fixtures are created
- AND prior failure evidence remains immutable and separate from the new run
