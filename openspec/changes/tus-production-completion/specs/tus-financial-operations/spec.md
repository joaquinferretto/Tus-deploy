# TUS Financial Operations Specification

## Purpose

Represent provider-linked payment state, completion evidence, commissions, ledger entries, refunds, disputes, chargebacks, and reconciliation without claiming live settlement before approval.

## Requirements

### Requirement: Provider and commercial state separation

The system MUST keep payment-provider status separate from commercial completion and settlement eligibility. Provider approval alone MUST NOT release funds.

#### Scenario: Payment approved before completion

- GIVEN a provider-linked payment is approved but completion evidence is absent
- WHEN release is evaluated
- THEN settlement remains pending and the reason is auditable

#### Scenario: Provider mismatch or unavailable provider

- GIVEN a callback is invalid, mismatched, or the provider is unavailable
- WHEN the payment is reconciled
- THEN the commitment is frozen or quarantined without a release side effect

### Requirement: Immutable completion and commission snapshot

An authoritative financial event MUST create an immutable snapshot of context, rule version, commissionable base, rate, gross, commission, net, currency, and evidence reference. The MVP baseline is configurable from 10%, represented as 1000 basis points; later changes MUST use compensating entries.

#### Scenario: Eligible product or service completion

- GIVEN accepted completion evidence and confirmation or an approved context policy
- WHEN the financial record becomes authoritative
- THEN one immutable snapshot is stored and cannot be rewritten

### Requirement: Confirmation-first release and absolute freezes

Explicit customer confirmation MAY release eligible funds immediately; otherwise approved policy may release services after 12 hours or online/long shipments after 24 hours from valid evidence. Check-in proves arrival/start only. Dispute, chargeback, fraud/risk, missing evidence, or unresolved incident MUST freeze regardless of elapsed time.

#### Scenario: Risk freeze wins

- GIVEN a valid aging window and an open dispute
- WHEN a release job runs
- THEN no release occurs and the commitment remains frozen

### Requirement: Compensating financial recovery

Refunds, chargebacks, support outcomes, and reconciliation corrections MUST append compensating ledger entries and preserve prior records. Reconciliation MUST be replay-safe and quarantine unresolved exceptions.

#### Scenario: Replayed refund

- GIVEN a refund command was already recorded
- WHEN it is replayed
- THEN the original outcome is returned without a second ledger effect
