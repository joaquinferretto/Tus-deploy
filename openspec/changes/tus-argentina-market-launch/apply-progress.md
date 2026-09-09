# Apply Progress: TUS Argentina Market Launch

## Status

- Phase 0, Phase 1, and Phase 2 implementation is present but not complete.
- Tasks remain unchecked until the focused test runner is available and passes.
- Runtime database execution remains intentionally blocked; no database writes were performed.

## Completed Implementation Work

- Added `scripts/sdd/git-boundary.mjs` and its strict boundary tests.
- Added exact minor-unit `Money` helpers and exported them from `packages/contracts/src/index.ts`.
- Added the forward-only launch migration with tenant, commerce, finance, communications, operations, delivery, POS, audit, outbox, and job tables.
- Added migration inventory, exact-money, backup-restore, schema, and launch-marker gates to `scripts/tus-migration-repair-lib.mjs`.
- Updated migration-repair tests for the launch migration and exact-money behavior.
- Fixed launch-marker classification, launch ledger inspection, and legacy POS-only snapshot detection so the repair gate does not reject its own additive marker or require the full launch shape during the legacy POS test path.
- Added Phase 2 runtime/security scaffolding: Render-safe host/port resolution, bounded startup/shutdown, body limits, correlation IDs, CORS headers, async error forwarding, redacted envelopes, safe logging, and explicit schema readiness states.
- Added optional durable identity-store transactions with serialized in-memory rollback support; wrapped auth registration, sign-in, sign-out, verification, recovery, credential, session, and account mutations.
- Added Prisma security/tenancy audit sinks, tenancy persistence adapters, normalized auth/tenancy errors, provider-disabled fail-closed routing, and worker activation gates.
- Updated `render.yaml`, `docker-compose.yml`, worker configuration, and root `.env` to use canonical `DATABASE_URL` while keeping activation disabled until external evidence exists.
- Added Phase 2 RED coverage in `tests/foundation/backend-runtime-security.test.mjs`.

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 0.1 | Tests written first in `tests/foundation/sdd-git-boundary.test.mjs` | Blocked: Node/pnpm unavailable in the environment | Static source review completed; runtime refactor pending |
| 1.1 | Tests written first in `tests/integration/tus/migration-repair.test.mjs` | Blocked: Node/pnpm unavailable; PostgreSQL client tools unavailable | Static SQL/schema review completed; runtime refactor pending |
| 2.1 | Tests written first in `tests/foundation/backend-runtime-security.test.mjs` | Blocked: Node/pnpm unavailable in the environment | Static TypeScript/Python/YAML review completed; runtime refactor pending |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/backend-runtime-security.test.mjs`; not run — `pnpm`, `node`, and `npm` are unavailable in PATH. Python syntax and YAML parsing checks passed for changed worker/configuration files. |
| Runtime harness command/scenario and exact result | N/A for this planning/apply slice; the task artifact defines runtime as verify-only, and API/DB/provider execution is blocked because Node, PostgreSQL tools, Docker, and provider credentials are unavailable. |
| Rollback boundary | Revert only Phase 2 files: backend runtime/middleware, lifecycle/health/server, auth, tenancy, provider, worker, deployment, environment, and Phase 2 test changes; preserve Phase 0/1 and unrelated working-tree changes. |

## Static Evidence

- `git diff --check`: passed.
- `git diff --check` after Phase 2 changes: passed; Git line-ending normalization warnings remain on existing modified files.
- Python syntax check: passed for `apps/workflow-runtime-python/src/worker/core/config.py` and `main.py`.
- YAML parse check: passed for `render.yaml` and `docker-compose.yml`.
- Tool availability check: `node`, `npm`, `pnpm`, `pytest`, `docker`, `psql`, `pg_dump`, and `pg_restore` unavailable in PATH.
- PowerShell static database/schema check: passed; 56 required launch tables found, no forbidden destructive SQL tokens, and no Prisma `Float` fields remain.
- Model/migration comparison: launch tables have corresponding Prisma models except the expected `_prisma_migrations` table; pre-existing Prisma models remain represented by historical migrations.
- Post-fix `git diff --check`: passed.

## Blockers

- Install/provide Node.js and pnpm before running focused tests.
- Provide PostgreSQL client/backup tooling and an operator-approved restorable backup handle before any DDL execution.
- Resolve whether pre-existing historical `Float` columns require an approved additive backfill before treating the Prisma exact-money conversion as runtime-ready.
- Install/provide Node.js and pnpm before claiming Phase 2 focused tests or TypeScript compilation pass.
- Review generated `apps/api/tsconfig.tsbuildinfo` separately; it was not intentionally changed by this Phase 2 slice.
