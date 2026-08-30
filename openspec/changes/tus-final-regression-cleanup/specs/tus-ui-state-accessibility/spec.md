# tus-ui-state-accessibility Specification

## Purpose

Make the `/tus` loading landmark and operations interaction safe for keyboard and assistive-technology users without changing authorization or product truth.

## Requirements

### Requirement: Name the `/tus` main landmark during loading

Every `/tus` render, including the pre-authentication loading state, MUST expose exactly one main landmark with id `tus-main-content`; the skip link MUST target it. Loading markup MUST NOT imply authenticated success.

#### Scenario: Session restoration is pending

- GIVEN the session state is unresolved
- WHEN `/tus` renders its loading response
- THEN the skip link target exists on the main landmark and only the loading status is exposed

#### Scenario: Authentication settles

- GIVEN loading transitions to unauthenticated or authenticated state
- WHEN the page rerenders
- THEN the same named landmark remains available and protected content follows server-derived authority

### Requirement: Make operations controls assistive-technology safe

Operations controls MUST expose a stable accessible name, native button semantics, `type="button"`, keyboard activation, and a truthful busy or disabled state. Disabled controls MUST NOT execute an operation.

#### Scenario: Keyboard refresh

- GIVEN a stale authorized report has a recoverable refresh action
- WHEN a keyboard user focuses and activates the control
- THEN the report retry runs, its busy state is announced, and unrelated content remains

#### Scenario: Protected action is denied

- GIVEN the session is expired or the operation is not authorized
- WHEN the operations surface is rendered or activated
- THEN no protected mutation occurs and the control is disabled or unavailable with an understandable state
