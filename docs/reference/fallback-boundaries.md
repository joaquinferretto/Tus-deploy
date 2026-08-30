# Reference fallback boundaries

The fallback scenarios are deterministic, isolated evidence fixtures. They exist
only when a universal capability needs a small, realistic proof shape that the
neutral reference flow does not provide by itself.

## Ownership and import direction

| Boundary                 | Location                               | Allowed dependencies                                                                                         | Purpose                                                                       |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Marketplace-like fixture | `apps/reference/fallback/marketplace/` | Node/TypeScript language primitives only                                                                     | Tenant-scoped records, search, retry, and rollback evidence                   |
| Messaging fixture        | `apps/reference/fallback/messaging/`   | Node crypto for the existing signed provider fixture; language primitives for the neutral capability fixture | Delivery, replay, retry, and tenant-isolation evidence                        |
| Settlement-like fixture  | `apps/reference/fallback/settlement/`  | Node/TypeScript language primitives only                                                                     | Ledger authority, reconciliation, compensation, and tenant-isolation evidence |

These directories are reference-only scenario code. Core packages, base
application modules, and the neutral reference API must not import them. The
fixtures must not import application routes, provider SDKs, database clients,
schemas, prompts, credentials, environment files, or product-specific modules.

The existing signed messaging fixture remains available for P5.3 provider
adapter evidence. `createMessagingCapabilityFixture` is the provider-neutral
P5.5 proof and deliberately has no provider vocabulary or transport behavior.

## Deterministic evidence

Every P5.5 fixture returns stable synthetic identifiers and tenant context. The
scenarios prove the universal boundary behaviors below without network, cloud,
database, queue, credential, secret, or `.env` access:

- tenant-owned records are not visible through a foreign tenant;
- duplicate effects are prevented through replay/idempotency evidence;
- failures remain retryable or compensatable and preserve replayable ledger work;
- rollback/reconciliation returns an explicit, inspectable outcome.

The active cloud-native profile may replace these fixtures only with separately
authorized plan/validation and live-smoke evidence. Missing credentials or
resources keep the deterministic fixture disposition; they never become a live
conformance claim.

## Contamination boundary

Marketplace-like and settlement-like vocabulary belongs only inside these
fallback directories and their tests/docs. Neutral core code stays generic:
contracts, state, intent, tenant context, records, jobs, assets, notifications,
and audit/telemetry remain reusable without importing or naming a vertical
scenario. The P5.5 contamination test scans the neutral reference surfaces and
packages for fallback imports and vertical vocabulary.
