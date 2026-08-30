# tus-permission-aware-surface-loading Specification

## Purpose

Keep TUS loading and operations actions truthful, independently recoverable, and scoped to server-authorized tenant resources.

## Requirements

### Requirement: Expose a real operations action contract

Recoverable operations actions MUST be native keyboard-activatable buttons with an explicit `type="button"`, an accessible name, and a truthful disabled state while unavailable or in progress. A stale report action MUST retry only the report resource.

#### Scenario: Refresh a stale report

- GIVEN the authorized operations report is stale and merchant data is settled
- WHEN the user activates the named refresh button
- THEN only the report is requested again and the merchant view remains unchanged

#### Scenario: Action is unavailable

- GIVEN report recovery is unavailable, unauthorized, or already in progress
- WHEN the operations surface renders
- THEN the button is disabled or omitted, cannot mutate protected state, and exposes no false success

### Requirement: Preserve scoped loading and landmark behavior

The `/tus` surface MUST keep loading, denied, empty, and failed resources explicit without exposing protected data. Its initial authentication-loading render MUST include the named `tus-main-content` main landmark targeted by the skip link.

#### Scenario: Unauthenticated initial render

- GIVEN `/tus` is rendered before session restoration completes
- WHEN the loading state is returned
- THEN a main landmark with id `tus-main-content` and the loading status are present, with no tenant data

#### Scenario: Mixed authorized resources

- GIVEN one authorized resource fails while another returns data
- WHEN the surface settles
- THEN the successful resource remains visible, the failed resource is recoverable, and no unauthorized data is inferred

### Requirement: Refresh only directly affected evidence

Affected local evidence MUST record the exact current deterministic result, evidence class, revision/date, and remaining deferred boundaries. Refreshes MUST NOT convert local proof into production or authorized-external evidence.

#### Scenario: Regression evidence is refreshed

- GIVEN focused or full deterministic tests produce a new result
- WHEN readiness or native-smoke evidence is updated
- THEN only affected counts/findings change and the current result supersedes stale text

#### Scenario: External gates remain unavailable

- GIVEN local finance/UI tests pass but external evidence is absent
- WHEN the evidence summary is published
- THEN `liveConformance` remains false, activation remains fail-closed, and deferred gates remain named
