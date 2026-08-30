# tus-activation-readiness Specification

## Purpose

Define the evidence-owned gates that bound the Argentina-first Stage 1 pilot. Readiness controls production claims and provider actions; it does not replace legal, provider, or operational approval.

## Requirements

### Requirement: Bounded Stage 1 Cohort

The system MUST limit production publication to approved Argentina cohorts: beauty/personal care excluding regulated healthcare, and repairs/trades. It MUST NOT claim support for rentals, financing, regulated verticals, open driver bidding, ride-hailing, warehouse automation, or global launch.

#### Scenario: Approved cohort

- GIVEN an organization has an approved Argentina cohort and complete listing data
- WHEN publication is requested
- THEN the listing is eligible for production discovery

#### Scenario: Excluded offer

- GIVEN an organization offers regulated healthcare
- WHEN production publication is requested
- THEN publication is rejected with an auditable non-claim reason

### Requirement: Evidence-Owned Gate Evaluation

Each required gate MUST record owner, scope, evidence type, policy/version, expiry, and revocation status. Legal, KYC, KYB, tax, Mercado Pago, POS pilot, and runtime/provider gates MUST be evaluated fail-closed for the affected capability.

#### Scenario: Complete evidence

- GIVEN all required evidence is valid, in scope, unexpired, and not revoked
- WHEN a pilot capability is evaluated
- THEN the evaluation records approval and the exact evidence references

#### Scenario: Missing or expired evidence

- GIVEN any required evidence is missing, expired, out of scope, or revoked
- WHEN settlement or fleet enablement is requested
- THEN the capability remains disabled and the reason is recorded

### Requirement: Production and Deterministic-Proof Separation

Deterministic stubs MAY prove contracts, authorization, replay, and fail-closed branches, but MUST be labeled fake, unavailable, or test-only. Stub results MUST NOT be represented as live payment, payout, delivery, WhatsApp, legal, or pilot evidence.

#### Scenario: Stub execution

- GIVEN a test uses a deterministic provider-free adapter
- WHEN it returns a successful simulated result
- THEN the result is marked deterministic and cannot enable production actions

#### Scenario: Rollback

- GIVEN an active gate is revoked or pilot rollback is requested
- WHEN activation is re-evaluated
- THEN publication/provider actions, release jobs, and fleet jobs are disabled while audit and evidence remain readable
