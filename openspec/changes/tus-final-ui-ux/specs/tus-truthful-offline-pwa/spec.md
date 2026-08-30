# TUS Truthful Offline and PWA Specification

## Purpose

Separate installability metadata from offline capability and communicate only behavior supported by implementation and recorded evidence.

## Requirements

### Requirement: Separate installability from offline operation

The web experience MAY expose coherent manifest and install metadata, but MUST NOT describe itself as offline-capable solely because it is installable. Offline claims require an implemented and verified offline path; otherwise web copy MUST identify connectivity as required.

#### Scenario: Manifest without service worker

- GIVEN manifest metadata exists but no verified web service worker/offline path is available
- WHEN a user reads PWA or connectivity messaging
- THEN installability is described separately, offline support is not promised, and online operation remains the stated requirement

#### Scenario: Verified offline path

- GIVEN an offline path has been implemented and separately verified in the target environment
- WHEN the PWA capability is presented
- THEN the claim names the supported offline behavior and its limits rather than generalizing installability to all offline features

### Requirement: Preserve pending truth offline

Any supported mobile offline capture MUST preserve the exact tenant-scoped operation and stable idempotency identity, show queued or pending status, and withhold success until TUS acknowledges it. Reconnection MUST not duplicate an intent.

#### Scenario: Reconnect and replay

- GIVEN a mobile operation was queued offline with encrypted storage
- WHEN connectivity returns and synchronization runs
- THEN the original operation is submitted with its original identity, accepted/replayed clears pending state, and pending/conflict/error remains non-success

#### Scenario: Offline retry or unavailable storage

- GIVEN the device is offline or safe storage is unavailable
- WHEN staff attempts capture or sync
- THEN the UI names the offline/storage limitation, preserves data only when safe, and never claims provider capture, settlement, payout, or fulfillment

### Requirement: Evidence boundaries are explicit

Deterministic manifest, component, and contract checks MUST be reported separately from browser install prompts, service-worker execution, device offline behavior, screen-reader behavior, and production evidence. Unavailable evidence MUST remain deferred.

#### Scenario: Deterministic checks only

- GIVEN tests validate metadata and state mapping but no browser or device run exists
- WHEN readiness is summarized
- THEN only deterministic evidence is claimed and browser/device/PWA evidence is marked deferred

#### Scenario: Environment-specific observation

- GIVEN a browser or device run records installation or offline behavior
- WHEN evidence is attached
- THEN it identifies the environment, route, capability, and observed result without claiming broader support
