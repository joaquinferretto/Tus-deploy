# TUS UI State and Accessibility Specification

## Purpose

Define reusable, truthful status communication and accessible interaction foundations for web and mobile TUS surfaces.

## Requirements

### Requirement: Shared authoritative state taxonomy

Shared UI state presentation MUST represent loading, ready, empty, pending, conflict, disabled, and error distinctly. Each state MUST include user-actionable copy where recovery is possible and MUST remain tied to server evidence.

#### Scenario: Empty, loading, and error data

- GIVEN a request is loading, returns no records, or fails
- WHEN a surface renders the result
- THEN the corresponding state is exposed with a stable semantic label and no fabricated record or success

#### Scenario: Pending or conflict command

- GIVEN a command is queued, uncertain, rejected for conflict, or gate-disabled
- WHEN feedback is shown
- THEN the state remains pending/conflict/disabled, identifies the next safe action, and preserves the operation for review where applicable

### Requirement: No-success inference and finance truthfulness

The UI MUST show success only after an authoritative server acknowledgement. Pending, deferred, unavailable, HTTP success without a valid response body, payment-provider state, settlement aging, payout, fulfillment, and support handoff MUST NOT be upgraded to success locally.

#### Scenario: Acknowledged operation

- GIVEN the server returns a valid accepted result
- WHEN POS or checkout feedback renders
- THEN it identifies the operation and acknowledgement while stating that provider capture and settlement remain unclaimed

#### Scenario: Timeout or ambiguous response

- GIVEN transport fails or the response cannot prove the command outcome
- WHEN feedback renders
- THEN it shows pending/error with no success claim and offers safe refresh or retry semantics

### Requirement: Accessible interaction and motion contract

Web and mobile controls MUST use semantic roles, labels, keyboard/focus or equivalent assistive-technology behavior, visible focus indication, inline validation, live-region announcements, and reduced-motion behavior. Forms MUST expose meaningful names, types, input modes, and error associations.

#### Scenario: Keyboard and form validation

- GIVEN a user navigates a form without a pointer and submits invalid data
- WHEN validation runs
- THEN every control is reachable and labeled, the first invalid field is discoverable, and its corrective error is announced

#### Scenario: Reduced motion

- GIVEN a user or device requests reduced motion
- WHEN a state transition or visual polish effect runs
- THEN non-essential motion is disabled or reduced without hiding status, focus, or action feedback

#### Scenario: Component evidence boundary

- GIVEN semantic/component tests pass
- WHEN evidence is summarized
- THEN it is labeled component/contract evidence and does not claim browser, screen-reader, keyboard, or device verification
