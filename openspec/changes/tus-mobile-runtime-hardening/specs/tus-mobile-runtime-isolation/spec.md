# TUS Mobile Runtime Isolation Specification

## Purpose

Define one validated mobile runtime identity and prevent endpoint, credential,
offline-queue, and startup behavior from diverging by build profile.

## Requirements

### Requirement: Canonical runtime resolution

The mobile application MUST resolve one typed `{ profile, apiUrl }` runtime
identity and MUST pass that identity to Expo configuration, every mobile HTTP
transport (auth, POS, and Axios), bootstrap, and persistence. Consumers MUST
NOT independently read endpoint/profile environment variables or default to
`dev`.

#### Scenario: Profile and endpoint are shared (RED → GREEN)

- GIVEN a staging profile and its configured HTTPS endpoint
- WHEN config, auth, POS, bootstrap, and storage are initialized
- THEN every consumer reports the same staging profile and endpoint (GREEN; RED is the current split/default behavior)

#### Scenario: Invalid runtime identity fails closed (RED → GREEN)

- GIVEN an unknown profile, malformed endpoint, or contradictory TLS settings
- WHEN runtime resolution is requested
- THEN resolution rejects with a diagnosable configuration error and performs no fallback to `dev` (GREEN)

### Requirement: Profile-isolated credentials

Credential and sensitive-item storage MUST be qualified by the resolved profile.
A read, write, clear, or encryption-key lookup for one profile MUST NOT access
another profile's values.

#### Scenario: Credentials cannot cross profiles (RED → GREEN)

- GIVEN distinct credentials stored under `dev` and `staging`
- WHEN the staging credential store reads, writes, or clears tokens
- THEN only staging values change and dev values remain inaccessible (GREEN)

#### Scenario: Missing metadata does not expose dev secrets (RED → GREEN)

- GIVEN runtime profile metadata is absent or invalid
- WHEN credential storage is requested
- THEN storage fails closed rather than silently using the `dev` namespace (GREEN)

### Requirement: Profile-isolated offline queues

Offline POS queues and persisted app state MUST use deterministic namespaces
qualified by the resolved profile. Synchronization MUST replay only operations
belonging to that profile and MUST preserve pending/conflict states without
claiming provider capture or settlement.

#### Scenario: Queue data is isolated (RED → GREEN)

- GIVEN a pending operation in the `dev` queue and a separate `staging` queue
- WHEN staging storage is loaded and synchronized
- THEN the dev operation is neither returned nor submitted, while staging data is handled normally (GREEN)

#### Scenario: Ambiguous queue data is quarantined (RED → GREEN)

- GIVEN a queued operation lacks a valid profile association or has a conflicting namespace
- WHEN queue restoration or replay runs
- THEN the operation is not replayed, is surfaced as unavailable/quarantined, and no success is claimed (GREEN)

### Requirement: Safe startup diagnostics and fail-fast behavior

Startup MUST expose non-secret diagnostics containing the resolved profile,
redacted endpoint, and validation status. Invalid or contradictory runtime
configuration MUST block dependent bootstrap and MUST NOT be replaced by a
development fallback.

#### Scenario: Valid startup is observable (RED → GREEN)

- GIVEN a valid runtime identity
- WHEN the mobile root bootstraps
- THEN diagnostics identify the profile and endpoint without tokens, URLs with secrets, or personal data, and storage/auth bootstrap may proceed (GREEN)

#### Scenario: Invalid startup remains blocked (RED → GREEN)

- GIVEN required production values are missing or TLS is violated
- WHEN startup runs
- THEN the app shows an unavailable/fail-closed state, records the redacted reason, and makes no authenticated or POS request (GREEN)

### Requirement: Canonical endpoint and contract version

Mobile POS transport MUST use the canonical resolved endpoint and the versioned
`/tus/v1/pos/manual-operations` route. Mobile operation metadata and server
responses MUST use the shared TUS contract version `1.0.0`; no `3000`/`3001`
default split or unversioned mobile POS route is permitted.

#### Scenario: Request URL and version agree (RED → GREEN)

- GIVEN a resolved endpoint and a manual POS operation
- WHEN auth or POS transport sends a request
- THEN the captured request uses that endpoint, the versioned route, and `1.0.0` metadata (GREEN)

#### Scenario: External activation boundary remains unchanged

- GIVEN a valid mobile runtime and deterministic local evidence only
- WHEN a caller attempts external provider, cloud, release, or fleet activation
- THEN activation remains denied/deferred and no external call is made
