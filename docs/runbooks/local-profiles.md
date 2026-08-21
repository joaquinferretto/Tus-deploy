# Local Profiles

## Native developer smoke

The native profile is a PostgreSQL-backed developer loop, not production readiness
and not the complete integration profile. From the repository root, run the exact
source-free wrappers:

```text
cd backend && pnpm run dev
cd frontend && pnpm run dev
```

The wrapper resolves the repository-root `.env` by explicit path and consumes only
the `DATABASE_URL` key. A non-empty process `DATABASE_URL` takes precedence. The
value is never logged or copied into either wrapper. PostgreSQL is required for API
readiness; a missing or unreachable database leaves `/ready` unavailable.

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
