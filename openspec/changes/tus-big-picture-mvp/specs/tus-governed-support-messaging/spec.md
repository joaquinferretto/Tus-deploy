# tus-governed-support-messaging Specification

## Purpose

Make WhatsApp and support safe, tenant-scoped action surfaces for Stage 1 discovery, quotes, carts, status, confirmations, handoff, and dispute/support operations.

## Requirements

### Requirement: Typed Tenant-Safe WhatsApp Actions

The system MAY expose only an explicit typed allowlist for answering, discovery, quote, cart, supported product/service request, status, reminders, confirmation, and handoff. Each action MUST verify tenant routing, sender identity appropriate to the action, authorization, current policy, consent, and idempotency.

#### Scenario: Discover and quote

- GIVEN an opted-in sender addresses tenant A
- WHEN the sender requests an offer or quote
- THEN only tenant A's published data and an expiring, currency/timezone-labeled quote are returned

#### Scenario: Cross-tenant or unsupported action

- GIVEN the sender is not entitled to tenant B or requests refund/payout/identity change
- WHEN WhatsApp receives the action
- THEN no sensitive data or mutation occurs and the request is audited and handed off when appropriate

### Requirement: Explicit Confirmation and Secure Payment Handoff

Actions that create or change a commitment MUST recheck price, availability, ownership, policy, and confirmation expiry. Payment MUST redirect to authenticated TUS/Mercado Pago checkout; WhatsApp MUST NOT collect credentials. Sensitive refunds, disputes, payout, payment-instrument, or identity actions MUST require an authenticated surface or human handoff.

#### Scenario: Confirmed checkout

- GIVEN a valid quote/cart belongs to the requesting customer and has not expired
- WHEN the customer explicitly confirms
- THEN the allowlisted action is idempotently applied and the result is auditable

#### Scenario: Expired confirmation

- GIVEN a quote or confirmation token has expired or was already consumed
- WHEN the sender retries it
- THEN the action is rejected and a fresh quote or secure handoff is offered

### Requirement: Consent, Disclosure, and Handoff

Outbound messages MUST honor tenant/customer consent, provider policy, templates, rate limits, and retention rules. The system MUST disclose handoff, preserve a tenant-scoped transcript/reference, prevent duplicate actions during handoff, and allow support staff to act only through audited support sessions.

#### Scenario: Human handoff

- GIVEN an ambiguous, regulated, high-risk, or failed request
- WHEN the assistant cannot safely complete it
- THEN it stops without mutation, records the reason, and creates a scoped support handoff

#### Scenario: Opt-out

- GIVEN a customer has withdrawn messaging consent
- WHEN a non-essential outbound message is scheduled
- THEN delivery is suppressed and the consent change is auditable

### Requirement: Deterministic Messaging Boundary

Deterministic adapters MAY test signatures, allowlists, idempotency, and failure paths, but MUST identify fake delivery and MUST NOT be treated as provider delivery, customer consent, authentication, or production support evidence.

#### Scenario: Fake provider

- GIVEN a test transport echoes an allowlisted WhatsApp action
- WHEN the contract test passes
- THEN the result is labeled deterministic and cannot authorize a live commitment
