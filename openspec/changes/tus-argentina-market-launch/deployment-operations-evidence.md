# Phase 12 deployment and operations evidence

## Scope and truth boundary

Phase 12 implements static deployment/operations contracts only. No Render,
Vercel, DNS, TLS, worker, Docker, provider, PostgreSQL, migration, backup,
browser, or long-lived service was started or contacted. No live success claim
is made; deployment evidence remains `external-blocked`.

## TDD cycle evidence

| Task | RED | GREEN | REFACTOR |
| --- | --- | --- | --- |
| 12.1 | Initial `tests/foundation/p12-deployment-operations.test.mjs` failed 6/7 before implementation: missing backup wrapper/runbook/domain/index, one-shot worker entrypoint, and no-op package tests; recovery added root-only environment, migration history/selection, worker dependency, and package-runner assertions | Pinned Node runner: 9/9 passed after implementation and recovery | Consolidated release ordering, root env rules, explicit worker gates, DNS/TLS/CORS, runbooks, and evidence taxonomy without reading secret values |

## Work unit evidence

| Evidence | Exact result |
| --- | --- |
| Focused test command | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p12-deployment-operations.test.mjs` — exit 0; 9 passed, 0 failed |
| Package test smoke | `pnpm.cmd --filter @factory/web test` and `pnpm.cmd --filter @factory/api test` with pinned Node on PATH — exit 0; each ran all 9 focused tests, 0 failed |
| Python static command | `python -m compileall -q apps/workflow-runtime-python/src/worker` — exit 0; no database/provider effect |
| YAML parse check | `python -c "import yaml; yaml.safe_load(open('render.yaml')); yaml.safe_load(open('docker-compose.yml'))"` — exit 0; both files parsed successfully |
| Runtime harness | N/A by explicit user boundary: no deployment, Docker, worker process, API listener, browser, DNS/TLS, provider, backup, or database runtime was started |
| Terraform/toolchain | Not run; no Terraform CLI or cloud provider operation was required for these static contracts |
| Rollback boundary | Revert only Phase 12 deployment/operations files: `render.yaml`, `vercel.json` if changed, Docker env defaults, `scripts/deployment/render-predeploy.mjs`, Python worker entrypoint/config/consumer, package test scripts, CI workflow, deployment/domain/runbook files, Phase 12 test, and this evidence/index; preserve Phases 0–11 and unrelated working-tree changes |

## Implemented contracts

- Render API explicitly receives `PORT=$PORT`, builds before the backup-gated
  additive migration wrapper, and starts only afterward. `/health` remains
  liveness and `/ready` remains schema/dependency-aware readiness.
- Next standalone uses the generated server directly for Render; Vercel uses
  the Next framework build contract; no `next start` path is declared.
- The Python entrypoint runs the long-lived queue consumer only after activation
  gates pass. The checked-in Render worker remains disabled and
  `external-blocked-placeholder`, so it cannot claim the example job.
- Root `DATABASE_URL` and public API URL consumers are documented without
  emitting values. Package test scripts now invoke real test runners where safe;
  CI runs typecheck, lint, test, build, contracts, security, and policy checks.
- DNS/TLS/CORS, secret rotation, observability, alert/SLO, incident,
  rollback, backup/restore, bounded PID cleanup, and evidence taxonomy are
  recorded in `docs/runbooks/tus-deployment-operations.md`.

## Deferred or unavailable evidence

The repository has no proof of live Render/Vercel settings, DNS/TLS responses,
worker heartbeat, provider calls, managed backup/restore, or production SLOs.
The migration wrapper deliberately denies release unless an operator supplies a
verified backup and additive-only plan in the deployment environment. Those
inputs were not supplied or inspected in this session.

## Recovery pass

The recovery pass found two deployment-safety gaps and one portability gap without
restarting Phase 12. Local API configuration could prefer an ambient
`DATABASE_URL`; the Render migration wrapper could reach `prisma migrate deploy`
without explicit history-reconciliation and selected-migration attestation; and
package test scripts depended on a nested `pnpm` executable being on `PATH`.

The bounded correction now keeps local development on the repository-root `.env`
while allowing production platform injection, requires the exact selected launch
migration plus reconciled history before Prisma, requires explicit Redis,
queue-reference, and queue-ownership gates before worker activation, and invokes
the root test runner directly from package scripts. Package-local database URL
examples were removed; the root example remains the only local source.

### Recovery work unit evidence

| Evidence | Exact result |
| --- | --- |
| Focused test command | `node scripts/test-runner.mjs tests/foundation/p12-deployment-operations.test.mjs` with pinned Node — exit 0; 9 passed, 0 failed |
| Package test smoke | With pinned Node on `PATH`, `pnpm.cmd --filter @factory/web test` and `@factory/api test` — exit 0; 9 passed each, 0 failed |
| Python/YAML static checks | `python -m compileall -q apps/workflow-runtime-python/src/worker` and PyYAML parsing of `render.yaml`/`docker-compose.yml` — exit 0 |
| Runtime harness | N/A by explicit boundary: no worker, API listener, database, backup, provider, browser, Docker, cloud, DNS, or TLS runtime was started |
| Rollback boundary | Revert only the Phase 12 recovery changes in the migration wrapper, API environment resolver, worker activation config, Render env metadata, package scripts/root test runner, package examples, focused test, and deployment evidence; preserve Phases 0–11 and `Goldenrepo-js_py` exclusion |
