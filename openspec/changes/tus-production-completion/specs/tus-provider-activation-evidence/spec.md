# TUS Provider Activation and Evidence Specification

## Purpose

Control production activation for Argentina legal/provider, cloud, POS, pilot, and deployment boundaries through explicit authorized evidence.

## Requirements

### Requirement: Evidence-backed provider gates

Mercado Pago, WhatsApp, AWS/Groq, cloud deployment, POS hardware, and pilot activation MUST each have independent profile-scoped evidence with owner, validity, revocation, and approval status. Configuration alone MUST NOT enable them.

#### Scenario: Authorized provider activation

- GIVEN current authorized evidence satisfies every required gate for one profile
- WHEN that profile is evaluated
- THEN only the approved provider capability is enabled and the decision is auditable

#### Scenario: Missing or revoked approval

- GIVEN any required legal, KYC/KYB, tax, provider, cloud, POS, or pilot evidence is missing or revoked
- WHEN activation is attempted
- THEN provider actions, settlement/release, payout, and fleet jobs remain disabled

### Requirement: Deployment composition is explicit

Render/AWS profiles MUST declare whether API, web, worker, TUS routes, providers, release jobs, and fleet jobs are composed. Provider-free CI and plan validation MUST distinguish planned shape from provisioned or live conformance.

#### Scenario: Provider-free profile

- GIVEN a valid local or plan-only deployment profile
- WHEN composition is evaluated
- THEN base services may be validated while TUS external actions remain `disabled` and live conformance is false

### Requirement: Separate external evidence from local proof

Live provider callbacks, authorized PostgreSQL production-like smoke, browser/device/POS pilot, legal approval, and cloud conformance MUST be recorded only from authorized external evidence. Deterministic tests MAY support development but MUST NOT satisfy those gates.

#### Scenario: External evidence absent

- GIVEN local focused tests and builds pass but no authorized external records exist
- WHEN production readiness is reported
- THEN the result remains not production ready with explicit deferred gates

### Requirement: Fail-closed rollback

Disabling or revoking a gate MUST stop new affected actions, drain or quarantine consumers, preserve audit/evidence/ledger history, and use compensating entries where needed. Destructive financial rollback MUST NOT be used.

#### Scenario: Gate revoked during operation

- GIVEN a provider or settlement gate becomes revoked
- WHEN the next action or job is evaluated
- THEN it is blocked, pending work is safely drained or quarantined, and prior records remain intact

## Explicit Non-Goals

This capability MUST NOT claim global launch, rentals, regulated healthcare, financing/credit, custody/escrow, open driver bidding, mature dispatch, warehouse automation, or unbounded AI automation.
