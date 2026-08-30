# TUS Journey Surface Polish Specification

## Purpose

Polish chained customer, merchant, operations, and POS journeys while preserving tenant scope, lifecycle separation, idempotency, and truthful financial boundaries.

## Requirements

### Requirement: Chained tenant-safe journey navigation

Customer discovery/commitments, merchant inventory, operations reporting, and staff POS MUST connect through clear role-appropriate navigation. Each request and rendered record MUST remain scoped to the authenticated tenant and actor permissions.

#### Scenario: Authorized journey chain

- GIVEN an authenticated actor has access to multiple TUS surfaces
- WHEN the actor follows discovery, commitment, merchant, operations, or POS navigation
- THEN each destination preserves the approved scope and exposes its current evidence/state

#### Scenario: Unauthorized journey link

- GIVEN an actor lacks permission for a destination or record
- WHEN the destination is opened or requested
- THEN the surface shows disabled/denied or empty authorized scope without leaking foreign data

### Requirement: Separate customer commitments with idempotent checkout UX

Product and service intents MUST remain separately addressable. Checkout retries MUST carry one stable idempotency identity per user intent, display replay as the original result, and display key/payload conflict or in-progress responses as review states without creating a duplicate or claiming payment.

#### Scenario: Retry after lost response

- GIVEN a checkout request may have committed but its response was lost
- WHEN the same intent is retried with the same idempotency identity and fingerprint
- THEN the original commitment result is rendered and no duplicate commitment or payment success is claimed

#### Scenario: Idempotency conflict

- GIVEN an idempotency identity is reused for a different payload or tenant
- WHEN checkout responds with conflict or in-progress
- THEN the UI preserves the original intent, requests review/refresh, and does not mutate or claim settlement

### Requirement: Actionable merchant and operations truth

Merchant and operations surfaces MUST make stale, empty, loading, disabled, error, and unavailable facts actionable while keeping finance, delivery, support, and WhatsApp handoff claims distinct.

#### Scenario: Stale report

- GIVEN an operations report is stale or a refresh fails
- WHEN the operations surface renders
- THEN it identifies freshness, offers safe refresh/recovery, and does not claim settlement, delivery completion, or authorized support handoff

#### Scenario: Current merchant facts

- GIVEN current tenant-owned listings and report facts are returned
- WHEN the merchant/customer journey renders
- THEN product stock, service capacity, price, currency, and policy evidence remain visible and separate

### Requirement: Resilient POS recovery and visual consistency

Web and mobile POS MUST preserve product/service separation, pending queues, server conflicts, and rejected transport/storage operations. Shared visual and status primitives SHOULD make equivalent states recognizable across surfaces without hiding operational policy.

#### Scenario: Offline or rejected POS operation

- GIVEN POS is offline, storage is unavailable, or transport rejects an operation
- WHEN the staff surface updates
- THEN submission is not stuck, the operation is queued/preserved or clearly failed, and no provider capture, settlement, or payout success is shown

#### Scenario: Evidence classification

- GIVEN component/unit checks pass for journey and POS behavior
- WHEN delivery evidence is reported
- THEN it is labeled deterministic/component evidence; browser and device journey polish remains deferred until separately recorded
