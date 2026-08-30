# TUS Mobile Operation Recovery Specification

## Purpose

Make mobile POS outcomes recoverable and truthful across offline, uncertain, conflict, transport, and storage states.

## Requirements

### Requirement: Authoritative outcome taxonomy

Mobile feedback MUST distinguish accepted, replayed, pending, conflict, and error outcomes. Only accepted or replayed responses with a valid server result MAY be presented as acknowledged; pending, offline, timeout, in-progress, and transport uncertainty MUST NOT become success.

#### Scenario: Offline queue

- GIVEN the device is offline and storage is available
- WHEN staff records an operation
- THEN it is shown as queued-offline with its operation identity and remains pending until server acknowledgement

#### Scenario: Valid acknowledgement

- GIVEN the server returns accepted or replayed for an operation
- WHEN feedback renders
- THEN it identifies the operation and acknowledgement while stating that provider capture and settlement remain unclaimed

### Requirement: Safe retry and conflict resolution

Retry MUST reuse the preserved operation and idempotency key. Conflict MUST offer explicit review, retry, or discard semantics; discard MUST be visibly local and MUST NOT claim server cancellation, payment, settlement, or fulfillment.

#### Scenario: Retry rejection

- GIVEN a preserved operation's retry is rejected by transport or storage
- WHEN the retry handler completes
- THEN the rejection is caught, updated error/pending feedback is shown, the operation remains preserved, and submitting is no longer stuck

#### Scenario: Conflict while offline

- GIVEN a preserved conflict is selected for retry while offline
- WHEN staff chooses retry
- THEN the conflict remains preserved with an offline explanation and no request or success claim is made

### Requirement: Tenant-safe queue and storage failure handling

Queue restoration and persistence MUST enforce the validated runtime profile and authenticated tenant. Invalid, legacy, cross-profile, cross-tenant, or unsafely unpersistable records MUST be quarantined or rejected without replay, and the user MUST receive an actionable non-success state.

#### Scenario: Cross-tenant queue record

- GIVEN local queue data contains an operation for another tenant
- WHEN the queue is restored
- THEN it is quarantined, excluded from pending work, and disclosed only as a generic review-needed record

#### Scenario: Storage unavailable during capture

- GIVEN encrypted local storage cannot persist a new operation
- WHEN staff submits while offline or uncertain
- THEN capture reports storage failure, does not claim queued or server success, and leaves the safe next action explicit

### Requirement: Recovery feedback is accessible

Pending, conflict, and error feedback MUST use semantic status/alert behavior, expose operation identity and evidence, keep controls reachable by touch and keyboard, and avoid reliance on motion or color alone.

#### Scenario: Screen-reader conflict review

- GIVEN a screen reader user receives a conflict
- WHEN feedback appears
- THEN the conflict is announced assertively, the review action has a meaningful label, and the preserved operation remains identifiable
