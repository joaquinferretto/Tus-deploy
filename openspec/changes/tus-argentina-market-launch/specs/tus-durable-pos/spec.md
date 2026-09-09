# TUS Durable POS Specification

## Purpose

Define durable product/service POS operations across web/PWA and supported mobile/operator devices.

## Requirements

### Requirement: Shifts, cash, receipts, and operator controls

The POS MUST manage tenant/device/operator shifts, opening float, cash movements, product/service sale capture, receipt numbering, closeout, and authorized void/refund workflows. Exact money and tenant context MUST be preserved. Evidence: deterministic, real-PostgreSQL, browser/mobile, legal/external-blocked.

#### Scenario: Online shift sale
- GIVEN an authorized operator has an open shift and a valid product or service line
- WHEN the operator records and confirms a sale
- THEN the receipt, shift totals, commitment, audit entry, and outbox event commit atomically

#### Scenario: Unauthorized or closed shift
- GIVEN an operator lacks the role or the shift is closed
- WHEN a sale, cash adjustment, or refund is requested
- THEN the command is denied with a redacted error and no financial or cash mutation occurs

### Requirement: Offline capture, replay, and conflicts

POS MUST support explicitly bounded offline capture where enabled, durable local operation identity, replay ordering, idempotency, version checks, and deterministic conflict records. Offline capture MUST NOT silently claim provider approval or settlement. Evidence: deterministic, real-PostgreSQL, browser/mobile, provider, legal/external-blocked.

#### Scenario: Replay after reconnect
- GIVEN a device captured a valid offline operation and later reconnects
- WHEN replay sends the operation with its stable idempotency key
- THEN the server commits it once, replays the same result on retry, and records sync/reconciliation evidence

#### Scenario: Duplicate, stale, or unsafe replay
- GIVEN a duplicate operation, obsolete version, tenant mismatch, or provider-dependent action captured offline
- WHEN replay is attempted concurrently or after restart
- THEN it is replayed, rejected as a deterministic conflict, or quarantined; no duplicate effect or provider call occurs

### Requirement: Refunds, hardware, and recovery

POS refunds and receipt corrections MUST be compensating, policy-authorized, traceable to the original operation, and safe across printer/payment/hardware failure. Recovery MUST preserve audit, outbox, dead-letter, and replay state. Evidence: deterministic, real-PostgreSQL, browser/mobile, provider, legal/external-blocked.

#### Scenario: Authorized refund
- GIVEN a completed receipt and an authorized operator requests a permitted refund
- WHEN the refund is processed
- THEN a linked compensating record is created without rewriting the original receipt and the customer-facing status is consistent

#### Scenario: Printer or payment failure
- GIVEN receipt delivery or provider confirmation fails after local capture
- WHEN recovery runs
- THEN the operation remains visibly pending/retryable or quarantined, never silently duplicated, and its audit/outbox evidence is retained

### Requirement: POS concurrency and rollback boundary

POS writes MUST enforce tenant scope, optimistic versioning, atomic audit/outbox persistence, and claim fencing. Rollback MUST stop new POS intake or affected devices, drain safe work, quarantine ambiguous work, and preserve financial history; truncate, cascade, untagged delete, and destructive rollback are forbidden. Evidence: deterministic, real-PostgreSQL, browser/mobile, deployment.

#### Scenario: Concurrent same-key sale
- GIVEN two operators submit the same key or conflicting versions
- WHEN the database transaction executes
- THEN one effect commits, retries replay it, and stale work has no partial side effect

#### Scenario: Revoked device
- GIVEN a device is revoked during offline operation
- WHEN queued work is replayed
- THEN replay is denied or quarantined with a correlation ID and no tenant or ledger data is deleted
