# TUS Governed Support and Messaging Specification

## Purpose

Provide tenant-safe support and governed WhatsApp actions for discovery, quoting, cart, status, confirmation, reminders, and human handoff.

## Requirements

### Requirement: Typed tenant-safe action boundary

WhatsApp actions MUST use an explicit typed allowlist with tenant routing, authorization, consent, current price/availability checks, idempotency, and audit. Unsupported or ambiguous actions MUST stop safely.

#### Scenario: Allowed discovery action

- GIVEN an opted-in sender and a valid tenant-scoped search request
- WHEN the action is executed
- THEN only current tenant-published facts are returned with a correlated audit record

#### Scenario: Cross-tenant or unsupported action

- GIVEN an unauthorized sender or a refund, payout, identity, or dispute request
- WHEN the action is received
- THEN it is denied or handed off without disclosure or side effect

### Requirement: Explicit confirmation and secure checkout

Actions that create or change commitments MUST disclose material terms and require non-replayed explicit confirmation. Payment MUST redirect to authenticated TUS checkout; WhatsApp MUST NOT collect credentials.

#### Scenario: Confirmed cart action

- GIVEN an unexpired quote and matching customer confirmation
- WHEN the typed action is replayed
- THEN one commitment is created and duplicate confirmation returns the original result

#### Scenario: Expired confirmation

- GIVEN an expired or already-consumed confirmation
- WHEN it is submitted
- THEN no commitment or payment action occurs and the user receives a safe re-quote or handoff

### Requirement: Auditable support and handoff

Human handoff, bilateral evidence, mediation, and high-impact outcomes MUST preserve tenant scope, consent, transcript references, actor attribution, and compensating financial outcomes. AI MAY assist but MUST NOT be the sole high-impact decision-maker.

#### Scenario: Resolved supported case

- GIVEN customer and merchant evidence and an authorized support session
- WHEN the case is resolved
- THEN the outcome and any compensating entry are durably audited
