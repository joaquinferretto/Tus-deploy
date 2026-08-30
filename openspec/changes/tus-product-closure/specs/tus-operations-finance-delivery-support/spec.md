# TUS Operations, Finance, Delivery, and Support Specification

## Purpose

Define durable operational wiring for Argentina-first TUS POS/marketplace commitments while keeping delivery, finance, disputes, and support tenant-scoped and provider-safe.

## Requirements

### Requirement: Durable delivery and operational handoff

The system MUST preserve tenant-scoped commitment, shift, operator, zone, proof, handoff, audit, and outbox state. Delivery proof, check-in, and accepted-delivery evidence MUST be attributable to an authorized actor and valid version; invalid, duplicate, or cross-tenant handoffs MUST fail closed.

#### Scenario: Product delivery handoff

- GIVEN a committed product, authorized zone, open shift, assigned operator, valid proof, and current version
- WHEN delivery proof and handoff are recorded
- THEN the task, proof, handoff, audit, and outbox state becomes durable and tenant-scoped
- AND no settlement or provider call is made

#### Scenario: Missing or stale handoff authority

- GIVEN missing proof, an unauthorized zone/operator, a closed shift, or a stale version
- WHEN handoff is requested
- THEN the request is denied without changing commitment or delivery state
- AND the denial remains diagnosable without exposing secrets

### Requirement: Append-only finance boundary

The system MUST expose finance state as tenant-scoped commitment and settlement snapshots with explicit rule/version, evidence reference, commissionable base, rate, amount, currency, and `not-claimed` provider state. Confirmation MAY release an eligible amount; check-in or delivery proof alone MUST NOT release funds, and no timeout MUST auto-release funds.

#### Scenario: Authorized completion confirmation

- GIVEN a valid commitment, completion evidence, and an authorized customer or service-user confirmation
- WHEN finance state is evaluated
- THEN the eligible release decision and immutable snapshot are recorded
- AND no provider payout or settlement call is inferred or executed

#### Scenario: Dispute or chargeback boundary

- GIVEN a bilateral dispute, refund, correction, or provider/network chargeback
- WHEN the event is recorded
- THEN the original financial history remains intact and a compensating state is appended
- AND the commitment remains frozen or pending according to policy until resolved

### Requirement: Governed support and dispute cases

Support cases and disputes MUST be authenticated, tenant-scoped, correlated to a commitment, and durable with explicit open/resolved status. Support or messaging failure MUST NOT mutate financial truth, authorize providers, or bypass delivery and readiness gates.

#### Scenario: Support case creation

- GIVEN an authenticated actor with access to the commitment and a valid category
- WHEN a support case is opened
- THEN a durable correlated case is created with status `open`
- AND the case is visible only within its tenant boundary

#### Scenario: Cross-tenant or invalid case

- GIVEN a case references another tenant, an unknown commitment, or an unauthorized actor
- WHEN the case request is submitted
- THEN it is rejected before durable case or financial mutation
- AND any retained denial is separately auditable

### Requirement: Provider and regulated-operation non-interaction

The closure path MUST NOT invoke Mercado Pago, WhatsApp, cloud, payout, escrow, custody, financing, or other external provider operations. Local or deferred operational state MUST NOT be represented as provider authorization, settlement completion, or regulated readiness.

#### Scenario: Provider credentials without authorization

- GIVEN provider credentials or network reachability exist but independent activation authorization is absent
- WHEN an operational flow reaches a provider-dependent step
- THEN the step is blocked and the result remains pending, deferred, or not-claimed
- AND the provider spy records zero calls
