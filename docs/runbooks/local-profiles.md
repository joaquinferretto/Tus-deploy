# Local Profiles

## Native developer smoke

The native profile is a PostgreSQL-backed developer loop, not production readiness
and not the complete integration profile. From the repository root, run the exact
source-free wrappers:

```text
node scripts/dev/native-profile.mjs api
node scripts/dev/native-profile.mjs web
```

The canonical local API port is `3101`. The API wrapper sets `API_PORT=3101`
when it is not already provided; an explicit `API_PORT` remains authoritative.
The wrappers target `apps/api` and `apps/web`. The web wrapper points to
`http://localhost:3101` and the web app remains on Next's default port `3000`
unless `PORT` is explicitly supplied.

The wrapper resolves the repository-root `.env` by explicit path and consumes only
the `DATABASE_URL` key. The root file is authoritative; ambient process values do
not override it. The value is never logged or copied into either wrapper. Any
database operation is profile-gated: local runs require the existing
`FACTORY_PROFILE=local` and/or `NODE_ENV=development|test` values, while Render/AWS
production runs use `NODE_ENV=production` and a deployment profile and are refused
by the seed safety gate. PostgreSQL is required for API readiness; a missing,
unsafe, or unreachable database leaves `/ready` unavailable without a connection
or write.

The seed is never implicit. Run `node scripts/postgres-seed.mjs seed` only after
confirming the root profile is local or test. If the profile does not prove a
non-production target, the command fails closed with one remediation line; no
additional `TUS_TEST_*` metadata or alternate database URL is required or read.

Native dependency states are reported independently:

| Dependency | Native default | Readiness meaning |
|---|---|---|
| PostgreSQL | required | Must be reachable for API readiness |
| MongoDB | disabled | No connection attempt; does not block native readiness |
| Redis | disabled | No connection attempt; does not block native readiness |
| Python worker | disabled | Not started by native wrappers |
| Mobile support | fake | Deterministic local support only |
| External providers | disabled | No cloud/provider calls |

Optional modes may be selected explicitly with `NATIVE_*_MODE`; unavailable
optional dependencies are reported without blocking API readiness. Compose remains
the full integration graph.

## Rollback boundary

If a native release is not ready, stop the API/web processes before partial serving,
restore the last passing wrapper/profile version, and record version, reason,
timestamp, operator, and health evidence. PostgreSQL ledger, transactional outbox,
and Redis/SQS DLQ work remain authoritative and replayable; this slice does not
delete or rewrite those records.

## Deterministic native rollback scenario

P0.6a uses a provider-free, in-memory scenario to prove the rollback ordering and
evidence contract without Docker, cloud calls, or access to secret values:

```text
node --experimental-strip-types --test tests/foundation/p0-native-rollback.test.mjs
```

The scenario injects `native-p0.6a-failing` with PostgreSQL readiness unavailable,
stops traffic before any partial serving, checkpoints the existing ledger/outbox/DLQ
records without mutation, restores `native-p0.6a-last-pass`, verifies health, and
only then resumes traffic. It records the deployed version, restored version,
reason, operator, timestamp, and failing/restored health reports. The test is a
deterministic local contract scenario; it does not claim to exercise a production
traffic router or a live queue.
