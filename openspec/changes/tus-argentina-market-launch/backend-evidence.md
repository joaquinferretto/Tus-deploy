# Backend Evidence: TUS Argentina Market Launch

## Scope

Phase 2 backend/runtime/security implementation was reconciled as a deterministic, fail-closed slice. No database writes, migrations, provider calls, Docker execution, or long-lived services were performed.

## Implemented Contracts

- API startup resolves Render-safe host/port values and applies bounded database/listener startup and shutdown timeouts.
- HTTP requests receive generated/validated correlation IDs and expose `X-Correlation-Id`.
- CORS explicitly allows correlation, tenant, session, idempotency, request, authorization, and content headers.
- JSON/form/upload request limits are explicit; errors use redacted, correlation-aware envelopes.
- Async auth and tenancy routes forward rejected promises to the global error handler.
- Readiness distinguishes unavailable dependencies from `incomplete-schema` and returns HTTP 503 when blocked.
- Auth mutations use optional transaction boundaries; the in-memory implementation serializes and rolls back failed operations.
- Prisma auth and tenancy adapters provide durable persistence/audit integration points without enabling external providers.
- Worker activation is fail-closed unless deployment status is active, consumer enablement is true, and `DATABASE_URL` is present.
- Render and Compose use canonical `DATABASE_URL`; provider/TUS/worker activation flags remain disabled.
- The API now declares its existing `@factory/errors` workspace dependency so redaction imports resolve from the intended package boundary; no alternate error implementation or provider activation was introduced.

## TDD Evidence

| Test | RED | GREEN | REFACTOR |
|---|---|---|---|
| `tests/foundation/backend-runtime-security.test.mjs` | Written before Phase 2 implementation | Pinned NVM Node: 8/8 passed | Root env, correlation, CORS, body limits, readiness, transaction rollback, and safe logging remain green |
| `tests/foundation/backend-hardening.test.mjs` | Existing foundation contract | Pinned NVM Node: 6/6 passed | 60s/two-attempt retry, failed-pool cleanup, no-listener startup, readiness 503, shutdown, and redaction covered |

## Verification

| Check | Result |
|---|---|
| `git diff --check` | Passed |
| Python syntax compilation | Passed for worker config and entrypoint |
| YAML parsing | Passed for `render.yaml` and `docker-compose.yml` |
| Focused backend test | Passed with pinned NVM Node and transform-types runner: 8/8 plus 6/6, 0 failed |
| TypeScript typecheck/build | API typecheck reaches source checking; `@factory/errors` resolution is clear. Exit 2 remains only for pre-existing unrelated Phase 8 delivery status-union errors in `apps/api/src/tus/delivery/index.ts:337,365` |
| Runtime API smoke | Not run by explicit boundary; deterministic tests used pinned Node, while DB/provider runtime remains intentionally blocked |
| Database/provider execution | Not run by policy and unavailable tooling |

## Remaining Gate

Keep PostgreSQL/provider execution behind the existing backup, credential, and external-evidence gates. Resolve the unrelated Phase 8 delivery type errors in their own scoped work unit before claiming a fully green API typecheck.

## Foundation Recovery Evidence

| Evidence | Exact result |
|---|---|
| Focused command | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/backend-runtime-security.test.mjs tests/foundation/backend-hardening.test.mjs` — exit 0; 8 + 6 = 14 passed, 0 failed |
| Toolchain resolution | `node`/`pnpm` are absent from the ambient `PATH`; pinned `node.exe`/`pnpm.cmd` under `C:\Users\mmmau\AppData\Local\nvm\v22.22.2` were used, with the NVM directory prepended to child-process `PATH` where required |
| API typecheck | `pnpm.cmd --filter @factory/api typecheck` — `@factory/errors` blocker resolved; only unrelated Phase 8 delivery errors remain |
| Runtime harness | Deterministic tests used ephemeral in-process HTTP listeners only; no long-lived API listener/service, database, worker, provider, browser, Docker, or deployment runtime was started |
| Production flags | Fail-closed: `providersEnabled: false`, provider actions and worker activation remain disabled until direct evidence gates pass |
| Rollback boundary | Revert only the API workspace dependency/link, test-runner transform selection, parameter-property compatibility correction, and Phase 2 evidence updates; preserve Phase 3–13 implementation and unrelated work |
