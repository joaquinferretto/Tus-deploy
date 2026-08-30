# tus-marketplace-operations Specification

## Purpose

Define Argentina-first marketplace and merchant operations for the Stage 1 cohorts: beauty/personal care excluding regulated healthcare, and repairs/trades. The capability preserves a global-capable north star while enforcing explicit commercial, safety, tenancy, and rollout boundaries.

## Requirements

### Requirement: Stage 1 Cohort-Gated Marketplace

The system MUST support discovery, merchant administration, products, services/appointments, TUS-managed delivery, reporting foundations, SEO/discovery foundations, complete web/PWA desktop parity, and Expo mobile POS/manual operations for the approved cohorts. It MUST NOT activate rentals, open driver bidding, ride-hailing, warehouse automation, financing, or regulated verticals in Stage 1.

#### Scenario: Approved cohort operation
- GIVEN a merchant belongs to an approved Stage 1 cohort
- WHEN its catalog and operating surfaces are enabled
- THEN customers can discover and transact through web/PWA, and authorized staff can operate through web or mobile POS

#### Scenario: Excluded vertical
- GIVEN a merchant offers regulated healthcare
- WHEN it attempts to publish a Stage 1 offer
- THEN publication is rejected and the reason is auditable

### Requirement: Independent Product and Service Commitments

The system SHALL model product purchases and service/appointment bookings as separate commitments with independent status, evidence, cancellation, fulfillment, and settlement state. A change to one commitment MUST NOT implicitly alter the other.

#### Scenario: Mixed cart
- GIVEN a cart contains a product and an appointment
- WHEN checkout succeeds
- THEN two traceable commitments are created with separate fulfillment obligations

### Requirement: Evidence-Based Settlement and Absolute Freezes

The system MUST release a commitment immediately after explicit customer completion confirmation. Check-in MUST prove arrival/start only. Without feedback or dispute, services MUST release 12 hours after completion evidence; online/long shipments MUST release 24 hours after accepted delivery evidence; simple/local internal delivery MUST use configurable risk policy with no fixed duration. Dispute, chargeback, fraud/risk, missing evidence, or unresolved incidents MUST freeze release regardless of elapsed time.

#### Scenario: Confirmation and freeze
- GIVEN valid completion evidence exists and no risk hold is active
- WHEN the customer confirms completion
- THEN release occurs immediately
- AND a dispute raised before release keeps funds frozen

#### Scenario: Timeout release
- GIVEN a service has completion evidence, no feedback, and no dispute
- WHEN 12 hours elapse
- THEN release is eligible; a check-in alone is insufficient

### Requirement: Immutable Commission Snapshots

The system MUST calculate the MVP commission from a configurable 10% base and persist immutable snapshots of the rate, rule version, commissionable base, and commission amount for each commitment. Trust benefits after more than 20 completed sales or services MAY be granted, but MUST NOT change baseline release timing.

#### Scenario: Snapshot integrity
- GIVEN a commitment is commissionable
- WHEN its commission is recorded
- THEN all four snapshot values are stored and later rule changes do not alter them

### Requirement: Bounded Contexts and Tenant Isolation

Product, appointment, service, delivery, POS, settlement, dispute, and support contexts MUST preserve their boundaries. Every tenant-owned command and read MUST enforce tenant authorization and MUST NOT expose another tenant’s data; TUS policy MUST remain outside neutral factory packages.

#### Scenario: Cross-tenant access
- GIVEN an authenticated user belongs to tenant A
- WHEN the user requests tenant B’s commitment
- THEN authorization fails and no commitment data is returned

### Requirement: Governed WhatsApp Actions

WhatsApp MAY discover offers, quote, build a cart, and initiate allowlisted supported actions. Payment MUST redirect securely from TUS to Mercado Pago; payment credentials MUST NOT be collected or transmitted through WhatsApp. Unsupported actions MUST be rejected and audited.

#### Scenario: Secure payment handoff
- GIVEN a customer starts checkout in WhatsApp
- WHEN payment is requested
- THEN TUS provides a Mercado Pago redirect without requesting credentials in WhatsApp

### Requirement: Support, Disputes, Trust, and Reporting

The system MUST provide auditable support cases, evidence references, dispute intake, risk holds, incident resolution state, trust signals, and operational reporting for customers, merchants, and staff. A dispute or unresolved support incident MUST link to the affected commitment and prevent release until resolved.

#### Scenario: Dispute resolution
- GIVEN a customer disputes a delivery
- WHEN support records evidence and resolves the case
- THEN the commitment retains the audit trail and release follows the resulting decision

### Requirement: Legal, Provider, and Rollout Gates

Production commitments, settlement, and fleet operations MUST remain disabled until Argentina legal, KYC/KYB, tax, Mercado Pago product/account, POS pilot, and provider-readiness gates pass. AWS is the target provider; Groq MAY remain transitional only with a migration backlog. Rollback MUST disable TUS commitments/providers, stop release jobs, preserve evidence/audit, and reconcile through compensating ledger entries without changing neutral factory contracts.

#### Scenario: Failed gate
- GIVEN a required legal or provider gate is incomplete
- WHEN production enablement is requested
- THEN the operation remains disabled and no release job can settle a commitment
