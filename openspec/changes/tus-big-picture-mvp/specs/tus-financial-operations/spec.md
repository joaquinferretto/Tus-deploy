# tus-financial-operations Specification

## Purpose

Define payment, completion evidence, commission accounting, settlement eligibility, disputes, refunds, chargebacks, and reconciliation without conflating provider status with commercial completion or assuming unapproved custody/escrow.

## Requirements

### Requirement: Gated Provider Payment

Production payment intents MUST bind an authenticated commitment to the approved Argentina provider path and preserve provider status separately from commercial status. Settlement, payout, or custody claims MUST remain disabled until legal, KYC/KYB, tax, provider, and reconciliation gates pass.

#### Scenario: Approved checkout

- GIVEN the Argentina payment path is approved and the commitment is authorized
- WHEN checkout creates a payment intent
- THEN the intent is linked to the commitment and provider reference without marking completion or release

#### Scenario: Gate-disabled payment

- GIVEN a required financial gate is incomplete
- WHEN a production settlement action is requested
- THEN the action is rejected or held and no payout/release job executes

### Requirement: Immutable Ledger and Commission Snapshot

Each financially authoritative commitment MUST preserve gross, deductions, currency, commissionable base, 10% MVP-configurable rate, rule version, commission amount, provider references, and ledger status. Corrections MUST use compensating entries; historical records MUST NOT be rewritten.

#### Scenario: Snapshot creation

- GIVEN a commitment becomes financially authoritative
- WHEN its commission is recorded
- THEN rate, rule version, base, amount, and evidence references are immutable

#### Scenario: Rule change

- GIVEN a later policy changes the commission rate
- WHEN an old commitment is reported
- THEN its original snapshot remains unchanged and any correction is a separate entry

### Requirement: Evidence-Based Release and Absolute Freeze

Eligible settlement MUST release on explicit customer confirmation. With no feedback or dispute, approved policies MAY release services 12 hours after completion evidence and online/long shipments 24 hours after accepted delivery evidence; local delivery uses a configurable risk policy. Check-in or delivery proof alone MUST NOT release funds. Dispute, chargeback, fraud/risk, missing evidence, or unresolved incidents MUST freeze release.

#### Scenario: Confirmation versus check-in

- GIVEN completion evidence exists and no freeze applies
- WHEN the customer confirms completion
- THEN settlement becomes eligible immediately; check-in alone does not

#### Scenario: Risk freeze

- GIVEN accepted delivery evidence exists but a dispute or risk hold is active
- WHEN the release window elapses
- THEN funds remain frozen and the hold reason is auditable

### Requirement: Compensating Outcomes and Reconciliation

Refunds, chargebacks, dispute decisions, payout failures, and provider mismatches MUST create linked compensating or exception records. Reconciliation MUST be replay-safe and MUST quarantine unresolved mismatches rather than silently correcting the ledger.

#### Scenario: Resolved dispute

- GIVEN bilateral evidence leads to a partial refund
- WHEN support records the authorized decision
- THEN the ledger receives linked compensating entries and the commitment retains its case timeline

#### Scenario: Deterministic provider stub

- GIVEN a fake provider simulates capture or webhook states
- WHEN tests pass through financial adapters
- THEN results are labeled deterministic and cannot be used as live payment, payout, or legal evidence
