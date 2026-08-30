# TUS Mobile POS Amount Capture Specification

## Purpose

Let staff record a meaningful product or service operation through the existing manual-operation contract without changing backend authority or financial semantics.

## Requirements

### Requirement: Validated amount and context capture

Mobile POS MUST capture a finite amount greater than zero and a selected product or service context before submitting. The request MUST use the existing operation kind/context, ARS currency contract, tenant-scoped session, and no invented backend fields.

#### Scenario: Valid product capture

- GIVEN an authenticated staff session selects Product and enters a valid decimal amount
- WHEN the staff submits the form
- THEN one manual-sale operation carries that amount, context, ARS, tenant scope, and server-requested authority

#### Scenario: Invalid or missing amount

- GIVEN the amount is blank, zero, negative, non-finite, or malformed
- WHEN the staff submits or leaves the field
- THEN submission is blocked, the field has an associated corrective error, and no operation or idempotency intent is created

### Requirement: Stable intent identity

The client MUST create one operation identity and stable idempotency key per user intent. Editing the amount or context MUST create a new intent; retrying the unchanged intent MUST reuse its identity and payload and MUST NOT imply success locally.

#### Scenario: Retry unchanged operation

- GIVEN a submitted service operation receives no authoritative acknowledgement
- WHEN staff retries without changing amount or context
- THEN the same operation and idempotency key are sent, and feedback remains pending/error until the server responds

#### Scenario: Change intent after failure

- GIVEN a product operation failed and the staff changes its amount or context
- WHEN the staff submits again
- THEN a distinct intent is created and the previous operation remains separately identifiable for review

### Requirement: Usable touch and keyboard entry

Amount, context selection, submit, and feedback actions MUST be labeled, keyboard/focus reachable, compatible with numeric touch input, and presented with touch-safe hit regions. Validation and pending state MUST remain visible at increased text size and on narrow screens.

#### Scenario: Touch and assistive entry

- GIVEN a staff member uses a small touch device or keyboard with a screen reader
- WHEN they select context, enter amount, and submit
- THEN each control has a meaningful name, the action target is operable without hover or gesture, and status changes are announced

#### Scenario: Long content and reduced motion

- GIVEN validation, policy, or server evidence text is long and reduced motion is requested
- WHEN the form updates
- THEN content wraps without clipping or horizontal scrolling and non-essential animation is reduced without hiding focus or status
