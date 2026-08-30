# TUS Permission-Aware Surface Loading Specification

## Purpose

Expose authorized web data progressively without turning a denied or failed resource into a misleading whole-surface failure.

## Requirements

### Requirement: Scoped independent resource loading

Dashboard and operations resources MUST be evaluated independently against the authenticated session's server-derived permissions and tenant. An authorized result MAY render beside an empty, disabled, or failed resource; unauthorized data MUST NOT be inferred or exposed.

#### Scenario: Authorized partial dashboard

- GIVEN discovery and commitments are authorized but reporting is denied
- WHEN the dashboard loads its resources
- THEN authorized sections render, reporting is marked unavailable or disabled, and no reporting records are shown

#### Scenario: Mixed resource failure

- GIVEN one authorized resource times out while other authorized resources return valid data
- WHEN the surface settles
- THEN successful sections remain visible, the failed resource has an error state, and no whole-surface success or fabricated data is shown

### Requirement: Per-resource retry and session recovery

Each failed or stale resource MUST expose a retry or refresh action that re-requests only that resource and preserves other settled sections. A 401 or expired session MUST withhold protected data, clear local session authority, and offer approved reauthentication.

#### Scenario: Retry one resource

- GIVEN the operations report failed while merchant operations rendered
- WHEN the user activates retry with keyboard, pointer, or touch
- THEN only the report is requested again, merchant content remains stable, and the report state reflects the new authoritative response

#### Scenario: Session expires during retry

- GIVEN a resource retry returns 401
- WHEN the response is handled
- THEN protected content is withheld, the user receives a recoverable sign-in state, and tenant or actor details are not disclosed

### Requirement: Accessible partial-state communication

Every loading, ready, empty, denied, and error resource state MUST have a stable name, an associated action when recoverable, and a screen-reader announcement that does not erase unrelated content. Long messages and identifiers MUST wrap without horizontal scrolling.

#### Scenario: Assistive technology discovers partial states

- GIVEN a screen reader user moves through a dashboard with mixed resource states
- WHEN each section changes state
- THEN its heading, status, message, and available action are discoverable in logical order without requiring visual color interpretation

#### Scenario: Long error content

- GIVEN an error message or reference exceeds the narrow viewport width
- WHEN the resource state renders
- THEN text wraps, the retry control remains reachable, and no horizontal scroll is required
