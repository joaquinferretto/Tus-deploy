# TUS Delivery and POS Specification

## Purpose

Support scoped internal delivery operations and durable merchant POS/manual capture while keeping delivery and product/service/settlement lifecycles distinct.

## Requirements

### Requirement: Scoped internal delivery

TUS MUST support authorized zones, shifts, assignment, acceptance, pickup, transit, handoff, return, failure, and incident proof for internal or approved operators. Open driver bidding, ride-hailing, and continuous surveillance MUST NOT be enabled.

#### Scenario: Complete delivery task

- GIVEN an eligible product commitment and an authorized operator in the zone
- WHEN the task progresses through handoff with proof
- THEN delivery status and evidence are durable and visible only to entitled actors

#### Scenario: Invalid delivery attachment

- GIVEN a service commitment or unauthorized operator
- WHEN a delivery task is requested
- THEN it is rejected without changing the service lifecycle

### Requirement: Durable bounded POS operations

POS MUST support scoped shifts, device identity, manual product/service operations, receipts, retry state, and conflict review. Local POS capture MUST NOT claim provider capture, settlement, or payout.

#### Scenario: Offline replay

- GIVEN a valid offline command with tenant, actor, device, shift, version, and idempotency data
- WHEN connectivity returns
- THEN it is replayed exactly once or placed in review with a pending receipt

#### Scenario: Version conflict

- GIVEN an offline command targets a changed aggregate version
- WHEN replay occurs
- THEN the conflict is preserved for explicit review and is never resolved by silent last-write-wins

### Requirement: Honest operational evidence

Deterministic queues and fake transports MUST be labeled local test evidence. Device, browser, hardware, courier, and live payment proof MUST remain separately deferred until actually collected.

#### Scenario: No device pilot

- GIVEN only deterministic POS tests pass
- WHEN readiness is reported
- THEN POS behavior may be claimed locally but hardware/pilot readiness remains disabled

### Requirement: Contract-backed operational surfaces

Web/PWA merchant and customer views and mobile staff/POS views MUST consume versioned server contracts and display authoritative, pending, conflict, disabled, and error states. A client MUST NOT infer successful payment, settlement, or delivery completion from local state alone.

#### Scenario: Authoritative operational rendering

- GIVEN an authenticated API returns a task, listing, commitment, or receipt state
- WHEN a web or mobile surface renders it
- THEN the displayed state and evidence label match the server response

#### Scenario: Offline or gate-disabled surface

- GIVEN the API is unavailable, a command is pending/conflicted, or a gate is disabled
- WHEN the surface updates
- THEN it shows the bounded non-success state and makes no settlement or completion claim
