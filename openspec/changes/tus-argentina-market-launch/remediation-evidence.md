# P1 Remediation Evidence: TUS Argentina Market Launch

## Scope

This artifact records the bounded remediation of the verified P1 findings in `verify-report.md`. It covers deterministic code, package, security, Prisma-schema, and in-process HTTP evidence only. It does not promote the launch to production readiness.

## Findings Cleared

| Finding | Root cause | Correction | Result |
|---|---|---|---|
| API typecheck failures | Delivery handlers passed the broad `DeliveryTaskStatus` union to narrower predicates; correlation middleware relied on inferred portability | Added status guards and an explicit `RequestHandler` annotation | API and root typechecks pass |
| Mercado Pago package build | Missing DOM/Node type libraries and an invalid workspace TypeScript-config package reference; package was absent from the lockfile closure | Updated `tsconfig.json`, corrected the workspace dependency, regenerated lockfile, and installed offline links without scripts | Package build/test pass; 7 package tests pass |
| Legacy commerce/marketplace/delivery/finance HTTP regressions | Injected TUS routers were not mounted by the isolated app harness; marketplace listing payloads contained JSON-unsafe `bigint` values | Mounted injected router; serialized marketplace JSON boundary values as decimal strings | Commerce 5/5, marketplace 8/8, delivery/POS 7/7, finance 8/8 |
| Security gate | Test fixtures contained placeholder strings matching the scanner's credential-like length patterns | Replaced with short synthetic fixture values | Explicit working-tree scan passes; tracked-index scan passes when corrected files are indexed |
| Prisma validation context | Package-local invocation could not resolve root `DATABASE_URL` and local CLI/runtime | Added root-env-only validation wrapper and package script | Schema validation passes without a connection |

## TDD Evidence

| Work unit | RED | GREEN | REFACTOR |
|---|---|---|---|
| P1 remediation | `tests/foundation/p1-remediation.test.mjs` initially failed on missing route mounting, scanner placeholders, and contract expectations | Final focused remediation suite: 7/7 passed | Contract assertions now include the canonical discovery envelope; scanner test validates current working-tree paths |
| Legacy HTTP regressions | P8 marketplace/commerce/delivery/finance scenarios exposed 404/500/400 cascades | Final combined P8 run: 28/28 passed | Route injection and marketplace serialization are isolated to their respective boundaries |

## Commands and Results

- `node scripts/test-runner.mjs tests/foundation/p1-remediation.test.mjs` — exit 0; 7 passed, 0 failed.
- `node scripts/test-runner.mjs tests/foundation/p1-remediation.test.mjs tests/foundation/p8-tus-commerce-api.test.mjs tests/foundation/p8-tus-marketplace.test.mjs tests/foundation/p8-tus-delivery-pos.test.mjs tests/foundation/p8-tus-finance.test.mjs` — exit 0; 35 passed, 0 failed.
- `pnpm typecheck` — exit 0; 8/8 workspace typecheck tasks passed.
- `pnpm --filter @factory/api typecheck` — exit 0.
- `pnpm --filter @repo/mercado-pago test` — exit 0; 7 passed, 0 failed.
- `pnpm security:scan` — exit 0 after temporarily staging the two corrected fixture files for the index-based tracked scan; files were then returned to unstaged state.
- Explicit scanner invocation against both corrected fixtures — exit 0.
- `pnpm --filter @factory/api run prisma:validate` — exit 0; Prisma schema valid, no database connection.

## Runtime and Safety Boundary

- Runtime harnesses were deterministic, in-process HTTP listeners only; all listeners closed within each scenario.
- No API/worker process, PostgreSQL connection, migration, seed, backup, restore, Mercado Pago/WhatsApp request, browser/device runtime, Docker, cloud, DNS, TLS, or deployment operation was performed.
- No credentials, tokens, webhook secrets, or database URLs were printed, invented, or committed.
- `liveConformance: false` remains authoritative. Production go-live remains `NO-GO` pending the external evidence classes in `go-live-evidence.md`.

## Rollback Boundary

The remediation can be reverted by reverting only the listed P1 files and artifacts in the corresponding `apply-progress.md` rollback boundary. Unrelated pre-existing working-tree changes and `Goldenrepo-js_py` remain outside this remediation.
