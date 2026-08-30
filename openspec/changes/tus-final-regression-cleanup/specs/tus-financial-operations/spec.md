# tus-financial-operations Specification

## Purpose

Define canonical release reasons without weakening confirmation-first settlement, absolute freezes, append-only finance, or tenant authority.

## Requirements

### Requirement: Distinguish missing completion facts

The system MUST return `completion_evidence_required` when no valid completion or accepted-delivery evidence exists. When valid evidence exists but explicit confirmation is absent, it MUST return `completion_confirmation_required` and keep the commitment held.

#### Scenario: Evidence is missing

- GIVEN an approved payment has no valid completion or accepted-delivery evidence
- WHEN release eligibility is evaluated, with or without confirmation
- THEN the result is held with reason `completion_evidence_required`

#### Scenario: Confirmation is missing

- GIVEN an approved payment has valid completion evidence but no customer confirmation
- WHEN release is evaluated
- THEN the result is held with reason `completion_confirmation_required`

### Requirement: Preserve confirmation and freeze rules

Explicit customer or service-user confirmation MAY release only a commitment with valid evidence and no active freeze. Dispute, chargeback, fraud/risk, refund, missing evidence, provider mismatch, and unresolved incidents MUST freeze release regardless of elapsed time or confirmation.

#### Scenario: Confirmed eligible release

- GIVEN valid evidence, explicit confirmation, approved financial gates, and no freeze
- WHEN the authorized tenant evaluates release
- THEN settlement is released and the immutable ledger records the release reason

#### Scenario: Freeze overrides confirmation

- GIVEN valid evidence and confirmation but an active dispute or risk freeze
- WHEN release is requested or a release window elapses
- THEN the result is frozen with reason `absolute_freeze` and no release entry is appended

### Requirement: Enforce tenant-scoped finance authority

Finance evidence, confirmations, freezes, payments, snapshots, and ledger entries MUST remain scoped to the authenticated tenant; a foreign-tenant commitment MUST be rejected without mutation.

#### Scenario: Cross-tenant release attempt

- GIVEN an actor supplies tenant A context for a commitment owned by tenant B
- WHEN any finance evaluation is requested
- THEN the request is denied and tenant B financial state is unchanged
