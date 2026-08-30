# tus-delivery-pos Specification

## Purpose

Provide bounded TUS-managed delivery operations and staff POS/manual capture across web/PWA and mobile, including durable offline replay, while keeping delivery and POS lifecycles separate from product, service, payment, and settlement state.

## Requirements

### Requirement: Bounded Delivery Operations

Stage 1 delivery MUST be an internal, scoped workflow with zones, shifts, assignment, acceptance, pickup, in-transit, handoff, failure, return, and incident review. It MUST NOT provide open driver registration, bidding, ride-hailing, autonomous dispatch, or unrestricted location surveillance.

#### Scenario: Assigned delivery

- GIVEN an eligible product commitment is ready and a staffed zone/shift is active
- WHEN TUS operations assigns an authorized operator
- THEN the operator can accept, capture approved proof, and complete or escalate the delivery task

#### Scenario: Out-of-scope dispatch

- GIVEN no approved internal operator is available
- WHEN a user attempts to open public courier bidding
- THEN the request is rejected and no external assignment is created

### Requirement: Durable Scoped POS and Offline Commands

POS writes MUST include tenant, actor, device, shift, operation ID, idempotency key, schema version, creation time, and expected version where relevant. Offline capture MUST be durable, bounded by configured exposure, visibly pending until server acceptance, and replayable without duplicate sale, stock movement, receipt, or settlement.

#### Scenario: Offline replay

- GIVEN an authorized staff device is offline during an open shift
- WHEN staff records an allowed manual operation and connectivity returns
- THEN the durable command replays once, returns an authoritative result, and marks the local record reconciled

#### Scenario: Conflict review

- GIVEN the server version or stock differs from the offline expectation
- WHEN replay occurs
- THEN the command enters a review/conflict state without last-write-wins mutation or hidden financial claim

### Requirement: No Local Settlement Claim

Local POS receipts, delivery proof, check-in, and offline timestamps MUST NOT claim provider capture, merchant payout, or settlement release. Sensitive payment actions MUST use an approved online/provider flow; failed delivery MUST remain separate from product completion and release.

#### Scenario: Delivery proof

- GIVEN an operator records recipient proof for a product delivery
- WHEN the delivery task completes
- THEN the proof is linked to the task and commitment, while settlement awaits its own evidence and confirmation policy

#### Scenario: Failed handoff

- GIVEN a delivery attempt fails and is returned or placed in incident review
- WHEN the POS or operations surface refreshes
- THEN no settlement is released and support can inspect the delivery timeline

### Requirement: Deterministic Offline Proof Boundary

Provider-free tests MAY use deterministic clocks, queues, and transports to prove replay, conflict, and receipt-state contracts. Such results MUST be labeled test-only and MUST NOT establish device, payment, delivery, or production offline evidence.

#### Scenario: Fake transport

- GIVEN a deterministic transport accepts a queued command
- WHEN the test asserts reconciliation
- THEN the assertion proves only the contract harness behavior, not a real device or server deployment
