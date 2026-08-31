# PostgreSQL Evidence: TUS Product Hardening

schema: `gentle-ai.postgres-evidence/v1`
change: `tus-product-hardening`
phase: single bounded PostgreSQL evidence phase
evidence_tag: `real-postgres`
status: `deferred`
liveConformance: `false`
executed_at: `2026-08-31`

## Executive Result

The PostgreSQL evidence phase stopped at the safety gate. The repository-root
`.env` was resolved internally through the implemented root resolver, but the
target was not proven to have an explicit disposable owner, identity, and
non-production boundary. No connection, migration, seed, query, write, or
cleanup operation was attempted.

Exact deferred reasons, in first-failure order:

1. Canonical `resolveSafeTarget()` result: `target-identity-required`.
2. Effective PostgreSQL smoke gate result: `disposable-proof-required`.

The root source was `root-dotenv-DATABASE_URL` / `DATABASE_URL`. Only redacted
metadata was inspected. The URL value, credentials, host, database name, and
any other secret were not printed, logged, persisted, returned, or captured.

## Safety Gate

| Check | Redacted result |
|---|---|
| Root `.env` | Present; `DATABASE_URL` was found internally |
| Canonical source | `root-dotenv-DATABASE_URL` |
| Target identity | Missing (`identityPresent=false`) |
| Target ID | Missing (`targetIdPresent=false`) |
| Explicit owner | Missing (`ownerPresent=false`) |
| Disposable proof | Missing/false |
| Environment | Missing in canonical proof |
| Non-production proof | Missing/false |
| Canonical resolver | `invalid`, `target-identity-required` |
| PostgreSQL smoke resolver | `unsafe-target`, `disposable-proof-required` |
| Target metadata | PostgreSQL redacted metadata only; no URL value retained |

Because the gate was not proven, the phase stopped before all database-side
effects. No target ID, owner, profile, or safety flag was invented or bypassed.

## Static Schema Inventory

Static inspection only; these are not claims that the structures exist on the
unconnected target.

| Item | Inventory |
|---|---|
| Prisma provider | PostgreSQL |
| Prisma datasource | `env("DATABASE_URL")` |
| Prisma models | 73 |
| Prisma `@@unique` / `@@index` declarations | 167 |
| New table in hardening migration | `TusHardeningFixture` via `CREATE TABLE IF NOT EXISTS` |
| Hardening migration indexes | 10 `CREATE ... INDEX IF NOT EXISTS` statements |
| Hardening check constraints | 6 |
| Hardening tenant-scoped foreign keys | 7, all declared `NOT VALID` |
| Destructive migration tokens | No `TRUNCATE`, reset, cascade-delete, or untagged-delete operation found in the migration |

Relevant tenant/POS structures declared in the schema include:

- `TusPosOperation`: tenant + operation and tenant + idempotency uniqueness,
  plus shift/context indexes.
- `TusPosVersion`: tenant + shift uniqueness and version index.
- `TusPosReceipt`: tenant + receipt uniqueness and operation indexes.
- `TusPosDevice`, `TusPosSession`, and `TusPosConflict`: tenant-scoped
  identities and operational indexes.
- `TusPosOutbox` and `TusPosAudit`: tenant-scoped event/audit identities and
  replay/inspection indexes.
- `TusDeliveryZone`, `TusDeliveryShift`, `TusDeliveryTask`,
  `TusDeliveryProof`, `TusDeliveryIncident`, `TusDeliveryOutbox`, and
  `TusDeliveryAudit`: tenant-scoped delivery records.
- `TusHardeningFixture`: stable `(tag, version, runId)` uniqueness and a
  tenant index.

The live table, index, constraint, migration-history, orphan, and existing-row
state remain unverified because schema queries were correctly blocked.

## Migration Result

`prisma migrate deploy` was **not run**. The migration was inspected only as
text and is additive by source shape. Migration preflight, migration history,
database schema introspection, and post-migration checks are all deferred.

## Seed Result

| Operation | Result |
|---|---|
| `seed.ts` fixture construction | Static contract present: namespaced `tus-product-hardening` tag/version and stable run ID |
| Idempotent seed invocation 1 | Not run; blocked before seed |
| Idempotent seed invocation 2 | Not run; blocked before seed |
| Duplicate count | Not measured; no fixture was created |
| Tagged cleanup | Not run; no fixture was created |
| Untagged/destructive cleanup | Not run and not permitted |

The static `seedTusHardeningFixture()` implementation uses a unique
`(tag, version, runId)` upsert and refuses targets without disposable,
local/test, non-production proof. The live smoke helper separately creates
run-scoped marketplace rows with raw `INSERT` statements, so its repeated-run
idempotency is not proven by the `seed.ts` upsert contract. This is a
limitation, not a live failure, because the helper did not execute.

## POS Result

No real product/service POS operation was sent and no PostgreSQL-backed POS
state was inspected. The following live scenarios are therefore deferred:

- device registration and POS session persistence
- product POS persistence
- service POS persistence
- same-key retry and idempotency result preservation
- version conflict with no partial write
- receipt integrity and unclaimed provider/settlement state
- audit and outbox commit with the business operation
- restart/replay and recovery
- cross-tenant isolation
- targeted cleanup preserving audit/outbox evidence

The existing deterministic evidence in `verify-batch-1.md` reports the focused
hardening suite passing after the corrective rerun, including in-memory outbox
lease/acknowledgement checks. That evidence is not substituted for this
phase's missing real PostgreSQL evidence.

## Side-Effect Counts

All counts are for this phase only.

```json
{
  "connections": 0,
  "migrations": 0,
  "queries": 0,
  "fixtures": 0,
  "seedInvocations": 0,
  "writes": 0,
  "deletes": 0,
  "providerCalls": 0,
  "ownedChildrenStarted": 0,
  "ownedChildrenRemaining": 0
}
```

No API, web, mobile, browser, Docker, watcher, deployment, or long-lived
process was started. No cleanup process was required.

## Limitations

- The requested disposable target proof is absent from the current runtime
  environment; a URL's presence alone is not sufficient authorization.
- The canonical six-field proof contract and the PostgreSQL smoke's legacy
  `TUS_POSTGRES_*` gate are separate code paths. Both denied this run, and no
  values were synthesized to make them agree.
- Live PostgreSQL schema, migration, fixture, POS, tenant, audit/outbox,
  replay, recovery, and cleanup behavior remains unproven.
- No production, cloud, provider, hardware, browser, or mobile claim is made
  by this report.
- This file is a separate evidence report and does not overwrite
  `verify-batch-1.md` or claim final verification.

## Next Recommended

Provide the already-existing, explicitly approved non-production loopback/profile target proof
through the implemented resolver. Then rerun only this bounded PostgreSQL
phase; otherwise retain this report as `deferred` with zero side effects.
