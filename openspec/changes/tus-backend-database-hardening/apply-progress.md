# Apply Progress: TUS Backend and Database Hardening

## Work Unit

- Change: `tus-backend-database-hardening`
- Artifact store: Hybrid (OpenSpec + Engram)
- Phase: 1 — Boot / Config / DB Lifecycle
- Mode: Strict TDD
- Delivery: single PR with approved `size-exception`; chain strategy is `size-exception`
- Scope: Phase 1 only; no migrations, seed execution, DDL, database writes, browser, Docker, deployment, review lifecycle, verify, or archive

## Completed Tasks

- [x] 1.1 RED — Added focused lifecycle/configuration acceptance tests.
- [x] 1.2 GREEN — Added canonical root `.env` configuration, bounded database lifecycle, schema-aware readiness, and Prisma/pg ownership.
- [x] 1.3 REFACTOR — Removed cluster fan-out/respawn, added bounded HTTP shutdown and Mongo/Redis/Prisma/pg cleanup, and hardened redaction.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/foundation/backend-hardening.test.mjs` | Unit/integration contract | N/A (new) | ✅ Written, initially failed on missing exports | ✅ 6/6 passed | ✅ root URL, unsafe seed, retry, listener, schema, shutdown/redaction cases | ✅ focused suite remained green |
| 1.2 | `tests/foundation/backend-hardening.test.mjs` | Unit/integration contract | N/A (new) | ✅ Written before implementation | ✅ 6/6 passed | ✅ local URL, retry failure, incompatible schema, no listener | ✅ typecheck passed |
| 1.3 | `tests/foundation/p0-config-lifecycle.test.mjs` | Unit | ✅ 2/2 baseline | ✅ Added close-failure coverage before lifecycle refactor | ✅ 6/6 focused hardening tests passed | ✅ reverse-order and close-failure paths | ✅ timer cleanup and continue-closing behavior |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/backend-hardening.test.mjs tests/foundation/p0-config-lifecycle.test.mjs tests/foundation/p0-native-api.test.mjs tests/foundation/p0-native-readiness.test.mjs` — exit 0; 6 + 2 + 2 + 3 = 13 tests passed, 0 failed |
| Additional regression command and exact result | `pnpm test -- tests/integration/tus/migration-repair.test.mjs tests/integration/tus/postgres-seed.test.mjs` — exit 0; 10 + 18 = 28 tests passed, 0 failed; no migration/seed operation was invoked |
| Typecheck command and exact result | `pnpm --filter @factory/api typecheck` — exit 0 |
| Runtime harness command/scenario and exact result | N/A — runtime integration is intentionally deferred; starting API would require a live schema/database and the user prohibited long-lived services and database actions |
| Rollback boundary | Revert Phase 1 files: `apps/api/src/index.ts`, `apps/api/src/server.ts`, `apps/api/src/platform/{lifecycle.ts,configuration/*}`, `apps/api/src/infrastructure/database/{lifecycle.ts,postgres/pool.ts,prisma/client.ts}`, `apps/api/src/presentation/routes/health.ts`, `packages/{errors,lifecycle}/src/index.ts`, and `tests/foundation/backend-hardening.test.mjs`; unrelated prior changes remain outside this boundary |

## Safety / Cleanup

- No migration, DDL, seed execution, database write, provider call, browser, Docker, deployment, or long-lived process was run.
- The typecheck-generated `apps/api/tsconfig.tsbuildinfo` change was removed; no generated artifact remains in the worktree from validation.
- Diagnostics fail closed and redact credentials, database URLs, and internal paths.
- A broader p7 regression probe remains pre-existing/environmental: it failed before execution because `apps/web/src/lib/tus-client.ts` imports `apps/web/src/lib/api-url` without an extension; it is outside Phase 1.
- The focused p8 API regression probe passed after the lifecycle import path was corrected: 5/5 tests, exit 0.

## Remaining Tasks

- [ ] Phase 2.1–2.3 — Schema / Lineage / Backup Gate
- [ ] Phase 3.1–3.3 — Tenant Invariants / Repository Audit
- [ ] Phase 4.1–4.3 — Durable Commerce / Idempotency / Fencing
- [ ] Phase 5.1–5.3 — Auth / Sessions / Errors / Limits
- [ ] Phase 6.1–6.3 — Worker Ownership / Provider Isolation
- [ ] Phase 7.1–7.3 — Readiness / Evidence / Deployment / Rollback
