# Authentication Provenance and Successor Guardrails

## Scope

P1.1 records security evidence for the future factory authentication successor. The
two existing authentication implementations are evidence sources only. They are
not dependencies of this repository and are not part of the factory runtime.

Both sources remain unchanged. The successor must be independently implemented,
tenant-scoped, and regression-tested before any production-readiness claim.

## Read-only evidence sources

| Source | Read-only reusable evidence | Explicitly rejected from blind reuse |
|---|---|---|
| `C:\Users\mmmau\auth-kit-standalone` | Structural/package boundaries, explicit ESM package surfaces, side-effect-free public imports, injected secret/Redis boundaries, CSP and input-safety controls, and offline neutrality checks. | Incomplete security behavior, stale assumptions, generated or bundled artifacts, and any source or secret copy. |
| `C:\Users\mmmau\vialovers-worktrees\alqui-full-product\apps\server\auth-kit` | Atomic refresh rotation evidence, token hash/family checks, registration-session persistence, revocation guarantees, security integration tests, and timing-safe CSRF evidence. | Alqui/DNI/host/guest coupling, role escalation, access-token revocation blindness, CSRF/cookie inconsistency, unauthenticated MFA, incomplete reset/verification, migration/adapter mismatch, and stale dist. |

The factory MUST NOT copy, modify, or import either source. No source code,
generated bundle, migration, package, `.env`, credential, or provider configuration
is copied into this repository. The provenance record contains observations and
paths only; it does not reproduce source listings.

## Evidence interpretation

The standalone source is the structural reference: its runtime-boundary tests
demonstrate environment-free imports, injected JWT secrets, lazy Redis use, and
neutral public surfaces. Its security specification also requires safe defaults,
validated adapter configuration, cycle-safe sanitization, timing-safe CSRF
comparison, and explicit failure for unsupported integrations.

The integrated source is the behavior reference: its PostgreSQL rotation tests
demonstrate one transaction with predecessor consumption, successor insertion,
commit, and rollback for a replay loser. Its security tests cover weak-password
rejection, login telemetry, and explicit TOTP states. Its CSRF implementation
provides timing-safe comparison and a stable invalid-token response.

These observations are evidence to re-implement and verify, not claims that the
future successor is complete. The source folders are inspected read-only and the
P1.1 tests verify their selected evidence files remain byte-for-byte unchanged.

## Successor regression matrix

The following cases are mandatory regression inputs for later identity slices:

| Regression case | Required successor guardrail |
|---|---|
| Privilege escalation | Canonical roles, deny-by-default authorization, and audited role changes. |
| Access-token revocation blindness | Session/family revocation must cover every credential path that claims revocation. |
| CSRF/cookie inconsistency | One explicit cookie/header policy with timing-safe comparison and consistent client contracts. |
| Unauthenticated MFA | MFA enrollment and challenge require an authenticated, tenant-scoped subject. |
| Incomplete reset/verification | Expiry, replay protection, delivery failure, non-enumerating responses, and audit evidence. |
| Migration/adapter mismatch | Schema, adapter defaults, migrations, and rollback tests share one versioned contract. |
| Stale dist | Runtime and published surfaces are generated from the verified implementation, never stale copied output. |
| DNI/host/guest/Alqui coupling | No vertical identity fields, roles, routes, hosts, or assumptions in reusable factory modules. |

P1.1 does not implement the successor. P1.2+ owns the new authentication
contracts and behavior; it must consume this matrix as its RED-test checklist.

## Verification boundary

The deterministic P1.1 tests verify that both evidence roots exist outside the
factory, selected evidence files are readable without mutation, provenance is
documented without source listings, and each regression guardrail is recorded.
They do not import either source, run its dependencies, read `.env`, call a cloud
provider, or claim that authentication has been implemented.
