# TUS Mercado Pago Settlement Specification

## Purpose

Define an evidence-bound Mercado Pago payment and intermediary settlement boundary for Argentina.

## Requirements

### Requirement: Intermediary collection and five-day settlement policy

TUS MUST model the user-approved intermediary posture and five-day split as a policy contract, not as an assumed provider or legal capability. Provider product/account approval, KYC/KYB, Argentine legal/tax treatment, custody/segregation, and payout authority MUST be evidenced before live activation. Evidence: provider, legal/external-blocked, deterministic, real-PostgreSQL.

#### Scenario: Approved settlement path
- GIVEN current owner-authorized Mercado Pago contract, merchant verification, legal/tax approval, and scoped provider smoke evidence
- WHEN an eligible completed commitment reaches settlement evaluation
- THEN the configured five-day rule is applied only within that approved scope and its policy/version is snapshotted

#### Scenario: Unverified five-day claim
- GIVEN only code, a fake, static configuration, or public documentation without exact Argentina account approval
- WHEN activation or settlement is requested
- THEN the capability remains disabled/external-blocked and no provider call or production claim occurs

### Requirement: Payment lifecycle and signed idempotent webhooks

Payment state MUST distinguish pending, approved, rejected, refunded, charged-back, and provider-error states from commercial completion. Webhooks MUST verify signature and freshness before processing, deduplicate by provider event identity, preserve receipt metadata, and use tenant-safe idempotent outbox processing. Evidence: deterministic, real-PostgreSQL, provider, legal/external-blocked.

#### Scenario: Approved webhook retry
- GIVEN a valid signed approval notification is delivered twice or out of order
- WHEN the webhook handler processes it
- THEN it records the event once, applies the valid transition, and repeats the original result without duplicate ledger/outbox effects

#### Scenario: Forged or replayed notification
- GIVEN an invalid signature, expired timestamp, unknown tenant, or already-consumed event
- WHEN the notification arrives
- THEN it is rejected or safely marked duplicate, with redacted audit evidence and no payment mutation

### Requirement: Refund, chargeback, reconciliation, and settlement ledger

The immutable ledger MUST record gross, discounts, tax/pass-through, currency, commission rule/version, merchant net, settlement status, provider references, refunds, chargebacks, reserves, adjustments, and recovery entries using exact money types. Reconciliation MUST quarantine mismatches and use append-only compensation. Evidence: deterministic, real-PostgreSQL, provider, legal/external-blocked.

#### Scenario: Reconciled approved payment
- GIVEN internal and provider records agree and completion evidence is eligible
- WHEN reconciliation runs
- THEN it records the match and creates the authorized settlement instruction without changing historical entries

#### Scenario: Chargeback or mismatch after release
- GIVEN a provider chargeback, partial refund, payout failure, or amount mismatch
- WHEN reconciliation receives it
- THEN the affected settlement freezes or creates compensating recovery entries, preserving the original record and an auditable exception

### Requirement: Settlement rollback and release safety

Dispute, chargeback, fraud/risk signal, missing evidence, unresolved incident, expired authorization, or failed reconciliation MUST freeze the affected release regardless of elapsed time. Rollback MUST stop release/provider jobs, preserve ledger/audit/outbox/DLQ, and replay only after new evidence. Evidence: deterministic, provider, deployment, legal/external-blocked.

#### Scenario: Revoked provider gate
- GIVEN a current settlement gate expires or is revoked while jobs are pending
- WHEN the worker evaluates release
- THEN it stops new releases, quarantines unsafe work, and reports unavailable without silently switching provider
