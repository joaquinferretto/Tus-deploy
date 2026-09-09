# TUS WhatsApp, Delivery, and Billing Specification

## Purpose

Define governed messaging, TUS-owned delivery, and Argentina-bounded billing capabilities.

## Requirements

### Requirement: Consent, templates, webhooks, and human handoff

WhatsApp MUST require recorded, revocable tenant-scoped consent, approved templates where required, provider-signed/idempotent webhooks, recipient authorization, audit, rate limits, and explicit confirmation for commitment-changing actions. Credentials MUST never be collected in WhatsApp; sensitive actions MUST hand off to authenticated TUS surfaces or a human. Evidence: deterministic, provider, browser/mobile, legal/external-blocked.

#### Scenario: Consented booking reminder
- GIVEN an eligible recipient, current consent, authorized template, and tenant-routed booking
- WHEN the notification webhook confirms delivery
- THEN the message, template/version, consent reference, provider event, and correlation are auditable

#### Scenario: Opt-out, forged webhook, or payment request
- GIVEN revoked consent, invalid signature, duplicate event, ambiguous identity, or a request for payment credentials/refund/payout
- WHEN WhatsApp processes it
- THEN it stops or hands off safely, does not disclose data or duplicate an action, and records a redacted reason

### Requirement: TUS-owned delivery operations

Delivery MUST support zones, shifts, assignment, acceptance, pickup, transit, handoff, delivered, failed, returned, cancelled, incident, SLA timers, exceptions, and proof of delivery. It MUST remain a TUS-owned bounded operation, not an open driver marketplace or mature dispatch claim. Evidence: deterministic, real-PostgreSQL, browser/mobile, provider, legal/external-blocked.

#### Scenario: Assigned delivery with proof
- GIVEN an eligible order, service area, active operator, and delivery policy
- WHEN the operator accepts, picks up, and hands off to the recipient
- THEN each status/timestamp/actor and proof reference is recorded and the customer sees current status

#### Scenario: SLA breach or failed handoff
- GIVEN an unassigned task, missed SLA, unsafe address, absent recipient, or damaged parcel
- WHEN the exception is detected
- THEN the task enters an auditable exception/return path, alerts the responsible role, and never fabricates delivery or settlement eligibility

### Requirement: Billing, subscriptions, invoices, and tax boundaries

Billing MUST distinguish merchant/customer charges, platform fees, subscriptions, invoice states, credits/refunds, numbering, and accounting references. Argentine tax, IVA, invoice authority, withholding, merchant-of-record, and accounting treatment MUST be country-packaged and legally/accountingly approved; code MUST NOT claim AFIP/ARCA or tax compliance without evidence. Evidence: deterministic, real-PostgreSQL, provider, legal/external-blocked.

#### Scenario: Approved invoice
- GIVEN an approved tax/accounting contract and a completed charge
- WHEN an invoice is issued
- THEN it preserves exact amounts, currency, tax references, numbering, party/tenant identity, and immutable accounting linkage

#### Scenario: Unapproved tax or subscription change
- GIVEN missing legal approval, invalid tax identity, failed recurring charge, or a subscription cancellation
- WHEN billing evaluates the operation
- THEN it remains pending/blocked or cancels according to policy, never inventing fiscal validity or charging after cancellation

### Requirement: Cross-capability rollback

Withdrawal of consent, delivery/provider authorization, billing approval, or release evidence MUST stop only affected intake/jobs, drain safe work, quarantine ambiguous work, preserve audit/ledger/outbox/DLQ, and permit replay only after reapproval. Evidence: deterministic, deployment, provider, legal/external-blocked.

#### Scenario: Capability disabled mid-flow
- GIVEN a queued WhatsApp, delivery, or billing job is disabled
- WHEN the worker claims it
- THEN the job is fenced or quarantined with a redacted correlation record and no destructive cleanup occurs
