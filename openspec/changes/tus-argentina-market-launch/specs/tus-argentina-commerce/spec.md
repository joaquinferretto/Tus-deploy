# TUS Argentina Commerce Specification

## Purpose

Define the nationwide Argentina marketplace for separately governed product and service commitments.

## Requirements

### Requirement: Argentina marketplace and tenant catalog

TUS MUST support Argentina-wide discovery and merchant operation for products and services. Tenants, merchants, customers, locations, roles, catalog visibility, inventory, pricing, and customer records MUST be isolated and auditable. Evidence: deterministic, real-PostgreSQL, browser/mobile, legal/external-blocked.

#### Scenario: Published offering is discoverable
- GIVEN an authorized merchant has a valid Argentina location, price, availability, and published offering
- WHEN a customer searches by category or location
- THEN only published, tenant-authorized data with current price and availability is returned

#### Scenario: Cross-tenant or stale publication
- GIVEN a user requests another tenant’s object, or an offering loses inventory/authorization
- WHEN discovery or mutation is evaluated
- THEN it returns not-found/forbidden or removes the stale offer without leaking existence

### Requirement: Product commitments and exact commercial snapshots

Product sales MUST use a product-specific lifecycle with customer, merchant, tenant, inventory, fulfillment, payment, receipt, refund, and immutable price/fee/tax snapshots. Product and service carts/commitments MUST remain separate in MVP. Evidence: deterministic, real-PostgreSQL, browser/mobile, provider, legal/external-blocked.

#### Scenario: Product purchase
- GIVEN a customer confirms a currently valid product quote
- WHEN checkout succeeds
- THEN one product commitment reserves the authorized stock and preserves currency, amounts, pricing version, and fulfillment intent

#### Scenario: Concurrent stock and retry
- GIVEN two customers attempt the final unit or one request is retried with the same idempotency key
- WHEN the commitment transaction runs concurrently
- THEN one reservation wins, the retry replays its original result, and no duplicate stock or commitment is created

### Requirement: Service calendars, booking, and attendance policy

Service offerings MUST support duration/day/hour configuration, calendars, time zones, schedules, staff/resources, capacity, blackout periods, buffers, booking windows, rescheduling, cancellation, and explicit no-show rules. Check-in MUST prove arrival/start only; completion requires the configured evidence and confirmation policy. Evidence: deterministic, real-PostgreSQL, browser/mobile, legal/external-blocked.

#### Scenario: Book an available service
- GIVEN a customer requests an open slot within the published booking window
- WHEN availability is rechecked and booking is confirmed
- THEN the slot/resource hold and service commitment are recorded with cancellation and no-show terms

#### Scenario: Slot race or cancellation/no-show
- GIVEN two requests target one capacity unit, or a customer cancels after the policy window
- WHEN the booking command is evaluated
- THEN only one booking commits; the other gets a deterministic conflict, and the late cancellation/no-show outcome is recorded without inventing completion

### Requirement: Commerce evidence and safe rollback

Every commercial transition MUST preserve actor, tenant, policy/version, correlation, evidence, and compensation records. Rollback MUST disable intake and affected capability, preserve commitments and audit, and never rewrite historical money or claim production readiness without applicable evidence. Evidence: deterministic, real-PostgreSQL, browser/mobile, deployment, legal/external-blocked.

#### Scenario: Evidence-backed completion
- GIVEN a product delivery or service completion has valid attributable evidence and no dispute/risk freeze
- WHEN the completion policy evaluates it
- THEN the commitment becomes eligible for its approved next state and the evidence is queryable

#### Scenario: Dispute or capability rollback
- GIVEN missing evidence, a dispute, or revoked launch authorization
- WHEN settlement/intake is evaluated
- THEN intake or release is stopped, work is quarantined where necessary, and ledger/audit/outbox evidence remains replayable
