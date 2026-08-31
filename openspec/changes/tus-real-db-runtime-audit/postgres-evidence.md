# PostgreSQL Evidence: TUS Real Database and Runtime Audit

schema: `gentle-ai.postgres-seed-evidence/v3`
change: `tus-real-db-runtime-audit`
phase: Phase 2 additive PostgreSQL and safe seed
evidence_tag: `real-postgres|external-blocked`
status: `deferred`
liveConformance: `false`
executed_at: `2026-08-31`

## Executive Result

The Phase 2 implementation and strict-TDD contracts are complete. The revised
seed gate correctly rejected the current root `.env` target as
`non-production-target-unproven` before any PostgreSQL connection or write.
The authorized command was attempted with `NODE_ENV=development`, the explicit
`seed` intent, and `--confirm-development-target`; no target safety proof was
invented or bypassed.

## Safety Gate and Invocation

| Check | Redacted result |
|---|---|
| Database source | Repository-root `.env` `DATABASE_URL` only |
| Alternate URL variables | Ignored; no alternate source accepted |
| Seed command | `node scripts/postgres-seed.mjs seed` |
| Confirmation | `--confirm-development-target` supplied |
| Explicit environment | `NODE_ENV=development` supplied |
| Production refusal | Preserved before transport |
| Target gate | `deferred`, `non-production-target-unproven` |
| Target metadata | Redacted only; no URL, host, database, credential, or identity persisted |
| Live conformance | `false` |

The profile gate recognized non-production intent but the URL target was not
proven to be local/owned/non-production. The CLI therefore stopped before the
60-second connection/retry path. The explicit confirmation records operator
intent only and cannot override this target-safety refusal.

## Bounded Connection Attempts

| Attempt | Result |
|---|---|
| 1 | Not started; target gate rejected first |
| 2 (single retry) | Not started; no first attempt existed |
| Third attempt | Not permitted by implementation |

Connection attempts: `[]`.

The implementation retains a 60,000 ms maximum per connection/start attempt and
exactly one retry when the target gate passes. Failed pools are closed before a
retry and diagnostics remain generic/redacted.

## Seed and Verification Result

| Operation | Result |
|---|---|
| Additive migration | Not run; target gate rejected before connection |
| Seed invocation 1 | Not run; target gate rejected before connection |
| Seed invocation 2 | Not run; target gate rejected before connection |
| Stable fixture identity | Not measured live; deterministic contract passes |
| Aggregate counts | Not measured live; deterministic mock verifies one stable row |
| Duplicate count | Not measured live; deterministic mock verifies `0` |
| Tenant isolation | Deferred to Phase 3/live PostgreSQL proof |
| Targeted cleanup | Not run; no fixture was created |
| Untagged/destructive cleanup | Not implemented or permitted |
| Provider calls | `0` |

The seed runner still performs two upsert-based runs and verifies stable
identity/counts when the revised safety gate passes. The existing
`seedTusHardeningFixture()` contract remains namespaced and idempotent; no
privileged identity or password-bearing default fixture is introduced.

## Schema and Migration

The Prisma schema retains the existing `TusHardeningFixture` primary key and
unique `(tag, version, runId)` identity, with the new tenant/tag/version index.
Migration `20260831170000_tus_real_db_runtime_audit` adds only idempotent
`CREATE ... IF NOT EXISTS` indexes. It contains no reset, truncate, drop,
cascade-delete, broad delete, or untagged cleanup operation.

The seed migration check now considers both fixture-table presence and the
completed Prisma migration marker, so an existing hardening table cannot cause
the new additive migration to be silently skipped.

## Strict-TDD Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 2.1 | `tests/integration/tus/postgres-seed.test.mjs`, `tests/integration/tus/postgres-http-smoke.test.mjs` | Integration/contract | `23/23` baseline | Missing confirmation export caused module failure before implementation | `17 + 12` passed after implementation | Root-only source, CLI flag, missing confirmation, non-development, production refusal, retry, and zero-effect cases | Shared confirmation constant/parser and redacted gate evidence |
| 2.2 | Same focused files | Integration/static schema | Existing seed/smoke contracts | New migration/schema index assertion failed before migration/schema edits | Focused suites remained `29/29` passed | Mock two-run stable identity plus additive migration and schema checks | Migration marker check prevents silent skip; existing seed upsert preserved |
| 2.3 | `openspec/changes/tus-real-db-runtime-audit/postgres-evidence.md` | Evidence artifact | N/A (new artifact) | N/A — artifact has no executable behavior | N/A — generated from executed gate result | Includes attempts, seed runs, verification, cleanup, provider-zero, and side-effect counts | Redacted evidence separates deterministic from external-blocked proof |

Focused command:

```text
pnpm test -- tests/integration/tus/postgres-seed.test.mjs tests/integration/tus/postgres-http-smoke.test.mjs
```

Result: exit 0; `29` passed, `0` failed, `0` skipped across both files.

Additional schema command was attempted without supplying an alternate URL;
Prisma validation could not resolve `DATABASE_URL` from its package working
directory and exited before database access. This does not alter the root-only
seed contract and is not live PostgreSQL evidence.

## Side-Effect Counts

All counts are for this Phase 2 operation only.

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

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | Exit 0; `29` passed, `0` failed, `0` skipped. |
| Runtime harness command/scenario | `NODE_ENV=development node scripts/postgres-seed.mjs seed --confirm-development-target` — safety refusal before transport; redacted JSON reported `connectionAttempts=[]`, `seedRuns=0`, and all database side-effect counts `0`. |
| Verification | Gate result `non-production-target-unproven`; no live aggregate query ran. Deterministic mock verification passed with one stable identity and `duplicateFixtures=0`. |
| Rollback boundary | Revert only `scripts/postgres-seed.mjs`, `scripts/test-runner-lib.mjs`, `apps/api/prisma/schema.prisma`, the Phase 2 migration, the two focused tests, `tasks.md`, `apply-progress.md`, and this evidence file. Preserve prior hardening and unrelated dirty-tree changes. |
| Cleanup state | `not-started`; no pool, child, service, watcher, browser, Docker process, or listener was created by the guarded seed attempt. |

## Risks and Limitations

- The current target lacks concrete local/owned/non-production proof; live
  migration, seed, count, identity, tenant, and cleanup behavior remains
  `external-blocked`.
- Prisma package-local validation does not automatically load the repository
  root `.env`; no alternate URL was supplied or added to compensate.
- No API, web, mobile, browser, Docker, watcher, provider, production, or
  Phase 3/4/5 behavior was executed or claimed.

## Next Recommended

`none` for this authorized batch. Do not bypass the target gate. A future
PostgreSQL evidence run requires an explicitly proven safe non-production target
while retaining the root `.env` `DATABASE_URL`, exact development environment,
and explicit confirmation flag.
