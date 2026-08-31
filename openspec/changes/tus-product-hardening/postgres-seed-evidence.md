# PostgreSQL Seed Evidence: TUS Product Hardening

schema: `gentle-ai.postgres-seed-evidence/v2`
change: `tus-product-hardening`
phase: focused bounded PostgreSQL seed contract
evidence_tag: `real-postgres`
status: `deferred`
liveConformance: `false`

## Contract Result

The seed path now reads only the repository-root `.env` `DATABASE_URL`. It is
reachable only with the explicit `seed` intent and a currently existing local or
test profile (`FACTORY_PROFILE=local|test` or `NODE_ENV=development|test`). An
explicit production value in `NODE_ENV` or `FACTORY_PROFILE` is refused. No
free-tier label, alternate URL, or invented target metadata is treated as proof.

This pass did not execute the seed, connect to PostgreSQL, migrate, write, or
start a service. The runtime proof remains deferred until an operator explicitly
runs the guarded command against a target proven by the existing profile.

## Safety and Redaction

| Check | Result |
|---|---|
| Database source | Root `.env` `DATABASE_URL` only |
| Alternate URL variables | Ignored; not passed to the database path |
| Production profile | Refused before transport |
| Missing non-production profile | Deferred with one-line remediation |
| Seed intent | Explicit `node scripts/postgres-seed.mjs seed` required |
| URL metadata | Host, database, credentials, and raw URL are redacted |
| Secret leakage | Not observed in focused test output or evidence |

## Bounded Startup Contract

- Each connection-start attempt is bounded to at most 60 seconds.
- Exactly one retry is permitted after a failed attempt.
- Backoff is finite and capped.
- Failed startup diagnostics are generic and redacted.
- A failed attempt closes its pool before retrying.

## Seed Contract

- Fixtures use the existing stable `tus-product-hardening` tag/version/run ID.
- Repeating the explicit seed uses an upsert and verifies one stable identity with
  zero duplicates.
- No reset, truncate, cascade deletion, or untagged deletion is available.
- No provider calls are made by the focused operation.

## Focused TDD Evidence

| Behavior | Test | RED | GREEN / triangulation | Result |
|---|---|---|---|---|
| Root-only URL resolution and redaction | `tests/integration/tus/postgres-seed.test.mjs` | New root-only contract failed against runner-variable implementation | Root source wins; URL values stay out of metadata | Passed |
| Production refusal and missing-profile remediation | Same focused test | New profile cases failed against six-field gate | Existing `NODE_ENV`/`FACTORY_PROFILE` are sufficient only for explicit non-production intent | Passed |
| Explicit seed intent | Same focused test | Missing intent gate failed | Default invocation performs zero database actions | Passed |
| 60-second bound and one retry | Same focused test | Existing retry contract retained | Timeout clamps to 60,000 ms; second attempt is the only retry | Passed |
| Two-run namespaced idempotency | Same focused test | Existing target shape was incompatible | Two upserts verify one stable fixture and zero duplicates | Passed |

Focused command:

```text
pnpm test -- tests/integration/tus/postgres-seed.test.mjs
```

Result: exit 0; 7 passed, 0 failed, 0 skipped.

Supporting command:

```text
pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs tests/foundation/tus-product-hardening.test.mjs
```

Result: exit 0; 15 PostgreSQL safety tests and 19 hardening tests passed, 0
failed, 0 skipped.

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | Exit 0; 7 passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario | `N/A` — user explicitly prohibited running the seed, PostgreSQL, migrations, writes, services, browsers, watchers, Docker, and deployment in this pass. |
| Rollback boundary | Revert only `scripts/test-runner-lib.mjs`, `scripts/postgres-seed.mjs`, `scripts/dev/native-profile.mjs`, `apps/api/prisma/seed.ts`, focused tests, runbooks, inventory, and this evidence/progress section. |

Cleanup state: `not-started`; no process or pool was created by this pass.

## Next Recommended

Keep runtime PostgreSQL evidence deferred. If an operator later runs the
explicit seed command, use the root `.env` `DATABASE_URL` with an existing local
or test profile; otherwise retain the one-line fail-closed remediation.
