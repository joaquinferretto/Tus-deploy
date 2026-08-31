schema: gentle-ai.verify-result/v1
evidence_revision: sha256:3f80b4b5d3e7a18816719860a1d10dc4e89e2ec34dd0c259460c21a2e4f9a884
verdict: fail
blockers: 4
critical_findings: 5
requirements: 2/8
scenarios: 2/8
test_command: pnpm test (focused hardening file set)
test_exit_code: 1
test_output_hash: sha256:760edb786ba388dd04c688399424465f8a9b00e0eb082ef91dba8e3ef48d4052
build_command: pnpm build
build_exit_code: 1
build_output_hash: sha256:760edb786ba388dd04c688399424465f8a9b00e0eb082ef91dba8e3ef48d4052
final_verification_complete: false
batch: 1

## Verification Report

**Change**: `tus-product-hardening`
**Mode**: Strict TDD
**Scope**: Bounded verification batch 1 only; this is not final verification.

### Completeness

| Metric | Value |
|---|---:|
| Implementation tasks total | 16 |
| Implementation tasks complete | 16 |
| Implementation tasks incomplete | 0 |
| Requirements evaluated | 8 |
| Scenarios evaluated | 8 |

All task checkboxes in `tasks.md` and `apply-progress.md` are checked. Full verification nevertheless fails closed because this bounded batch has failing checks and deliberately omits live/runtime surfaces.

### Build & Tests Execution

Every command was launched independently with a hard limit of 180 seconds or less. No server, watcher, browser, mobile process, Docker process, or interactive process was started. The lifecycle test launched only its own bounded non-server child fixture.

| Check | Outcome | Exact result | Evidence |
|---|---|---|---|
| `pnpm test` focused set | Failed before test runner | Exit 1; local pnpm shim could not load the repository's missing `node_modules/corepack/dist/pnpm.js` | `sha256:760edb786ba388dd04c688399424465f8a9b00e0eb082ef91dba8e3ef48d4052` |
| Direct test-runner equivalent | Failed | Exit 1; 44 passed, 1 failed, 0 skipped. `p0-native-profile.test.mjs` failed because the owned child did not terminate within the shutdown deadline; the other 40 tests passed | `sha256:f8e784083d967a938bc14469ed2b943e22b6b9ca9d08109e062534f8a47a4fd7` |
| `pnpm typecheck` | Failed before typecheck | Exit 1; same pnpm/corepack loader failure | `sha256:760edb786ba388dd04c688399424465f8a9b00e0eb082ef91dba8e3ef48d4052` |
| Direct typecheck equivalent | Failed | Exit 1; `apps/api/src/tus/pos/index.ts:448` reports TS2790, delete operand must be optional | `sha256:0df052287f55155316c19bc837543b7a9539f6fe5e751f0094faac0ffd9e641a` |
| `pnpm build` | Failed before build | Exit 1; same pnpm/corepack loader failure | `sha256:760edb786ba388dd04c688399424465f8a9b00e0eb082ef91dba8e3ef48d4052` |
| Direct build equivalent | Failed | Exit 1 after 93.675s; API Prisma generation hit Windows EPERM while renaming the query-engine file | `sha256:ce854d50b235c474b57bb4e8bcc0449d9921d731b2a6f3c72a23f4d1f25b25d3` |
| Root `pnpm lint` | Failed before lint | Exit 1; same pnpm/corepack loader failure | `sha256:760edb786ba388dd04c688399424465f8a9b00e0eb082ef91dba8e3ef48d4052` |
| Direct root lint equivalent | Timed out | Hard timeout 180s; partial output reached mobile lint and produced no exit result | `sha256:30d6f9f470316f1d25f0fc955dd17f1415682ee3187344775b7044cab492e63a` |
| Affected API `pnpm` lint | Failed before lint | Exit 1; same pnpm/corepack loader failure | `sha256:760edb786ba388dd04c688399424465f8a9b00e0eb082ef91dba8e3ef48d4052` |
| Direct affected API ESLint equivalent | Passed | Exit 0; affected package lint targets reported no output/errors | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

**Coverage**: Analysis skipped — no coverage tool or coverage report was detected.

### Database Safety Outcome

| Gate | Result |
|---|---|
| Root `.env` resolver | Resolved the root `DATABASE_URL` internally through `resolveDatabaseUrl`; only redacted metadata was inspected: PostgreSQL protocol, username/password presence, path presence, `sslmode=require`, and URL length 146 |
| Safety proof | **Not proven**. Resolver status `invalid`, source `root-dotenv-DATABASE_URL`, reason `target-identity-required`; identity, target ID, owner, disposable, local/test environment, and non-production proofs were absent |
| DB operations | **Deferred / external-blocked**. No connection, migration, seed, cleanup, query, or write was attempted |
| Seed twice | Not run because the explicit safety gate was not ready |
| PostgreSQL smoke | Not run because the explicit safety gate was not ready |
| Side effects | **Zero database side effects**. No reset, truncate, cascade, or untagged deletion was performed |

No credential, token, cookie, or complete database URL was printed or persisted by this batch.

### Static Process Lifecycle Contract

The source-level contract is present: `OwnedChild` records exact PID/cwd/argv, clamps deadlines to 120,000 ms, verifies ownership, escalates SIGTERM to SIGKILL, and refuses mismatched children. PostgreSQL smoke cleanup is in `finally` and attempts API shutdown, tagged fixture cleanup, and pool closure. Runtime audit bounds each flow at 180,000 ms, aborts timed flows, and invokes owned cleanup.

The runtime evidence is not compliant: the focused Windows lifecycle test failed with `Owned child ... did not terminate within the shutdown deadline`. Also, native `runChild` has one request timer rather than an independently exercised startup deadline, so the complete three-deadline contract is not proven in this batch.

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | ✅ | `apply-progress.md` contains a four-row TDD Cycle Evidence table |
| All task test files exist | ✅ | 4/4 focused test files exist |
| RED confirmed | ✅ | 4/4 focused test files were present and executed |
| GREEN confirmed | ❌ | 3/4 focused files passed; native lifecycle file failed |
| Triangulation adequate | ⚠️ | Behavioral cases are varied, but the apply table does not provide the strict triangulation counts |
| Safety net for modified files | ⚠️ | No explicit safety-net column/evidence was recorded in the apply artifact |

**TDD Compliance**: 3/6 checks passed.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|---|---:|---:|---|
| Unit/contract | 40 | 3 | Node test runner; deterministic mocks and source contracts |
| Process integration | 5 | 1 | Node child-process fixture |
| E2E/browser | 0 | 0 | Not run by batch policy |
| **Total** | **45** | **4** | |

### Changed File Coverage

Coverage analysis skipped — no coverage tool detected.

### Assertion Quality

✅ No tautologies, ghost loops, orphan empty assertions, or smoke-only assertions were found in the four focused test files. Assertions exercise resolver behavior, lifecycle behavior, redaction, cleanup, deferred database gating, schema contracts, and runtime evidence classification.

### Spec Compliance Matrix

| Requirement | Scenario | Test evidence | Result |
|---|---|---|---|
| Safe database configuration | Unsafe target | `tus-product-hardening.test.mjs` and `postgres-http-smoke.test.mjs` | ✅ COMPLIANT for deterministic denial; live approved checks not run |
| Idempotent fixtures and non-destructive cleanup | Replay and refusal | `tus-product-hardening.test.mjs` and `postgres-http-smoke.test.mjs` | ⚠️ PARTIAL; deterministic seed/cleanup guards passed, real PostgreSQL deferred |
| Additive PostgreSQL schema and tenant rules | Isolation and transition rejection | `postgres-http-smoke.test.mjs` | ⚠️ PARTIAL; static/deferred contract passed, real PostgreSQL not run |
| Atomic POS, audit/outbox, and recovery | Retry, conflict, and replay | `postgres-http-smoke.test.mjs` | ⚠️ PARTIAL; in-memory outbox checks passed, real PostgreSQL journey deferred |
| Bounded child lifecycle | Timeout cleanup | `p0-native-profile.test.mjs` | ❌ FAILING; child did not terminate within shutdown deadline |
| Canonical environment contract | Safe normalization | `tus-product-hardening.test.mjs` | ✅ COMPLIANT for deterministic inventory/alias behavior |
| Bounded real workflow evidence | Evidence or external block | `tus-runtime-audit.test.mjs` | ⚠️ PARTIAL; external-blocked classification passed, browser/device/provider journey not run |
| Reproducible startup and fail-closed rollback | Deployment and failed phase | `tus-product-hardening.test.mjs` | ⚠️ PARTIAL; contract assertions passed, build failed and startup was intentionally not launched |

**Compliance summary**: 2/8 scenarios fully compliant in this bounded batch; 5 partial/deferred and 1 failing.

### Correctness (Static Evidence)

| Area | Status | Notes |
|---|---|---|
| Root dotenv authority and redaction | ✅ Implemented | Resolver ignores ambient `DATABASE_URL`; diagnostics are metadata-only |
| Safety gate ordering | ✅ Implemented | Unsafe targets return before connection/migration/fixture operations |
| Tagged/idempotent fixtures | ✅ Implemented | Stable namespace and upsert contract are covered deterministically |
| Additive schema and tenant indexes/checks | ✅ Implemented | Migration and schema assertions passed; live DB remains unverified |
| POS/audit/outbox/recovery | ⚠️ Partially evidenced | In-memory behavior passed; PostgreSQL durability was deferred |
| Owned child lifecycle | ❌ Failing | Real bounded cleanup test currently fails on Windows |
| Environment inventory | ✅ Implemented | Canonical source and retained alias are asserted |
| Runtime/deployment evidence | ⚠️ Partially evidenced | External-blocked and static contracts pass; build/root lint do not complete |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Root `.env` is authoritative | Yes | Runtime resolver inspection confirmed root source and no ambient substitution |
| Proof before DB side effects | Yes | Gate denied before any DB operation; zero DB actions |
| No destructive cleanup | Yes | No destructive DB action was run; source/tests retain targeted-only policy |
| Exact process ownership and bounded cleanup | Partially | Static contract exists, but Windows timeout cleanup test fails |
| No provider/cloud/runtime success claims without evidence | Yes | Browser/device/provider paths remain external-blocked/deferred |

### Quality Metrics

**Linter**: affected API equivalent passed; root lint timed out at the hard bound; pnpm wrapper was unavailable.
**Type Checker**: failed on TS2790 in `apps/api/src/tus/pos/index.ts:448`.
**Build**: failed on Prisma query-engine rename EPERM in the API build.

### Issues Found

**CRITICAL**:
1. Focused hardening batch fails the native child timeout-cleanup test on Windows.
2. Typecheck fails at `apps/api/src/tus/pos/index.ts:448` (TS2790).
3. Build fails during API Prisma generation with Windows EPERM.
4. Root lint does not finish within the 180-second hard timeout.
5. Required `pnpm` commands cannot start because the local pnpm/corepack shim references a missing module.

**WARNING**:
1. Live PostgreSQL evidence, duplicate seed against PostgreSQL, and bounded PostgreSQL smoke are deferred because the root target lacks required proof; this is a safe external block, not a DB failure.
2. Browser/mobile/POS hardware/provider evidence is intentionally external-blocked by batch policy.
3. Apply TDD evidence does not include explicit strict triangulation and safety-net columns.
4. Native `runChild` does not independently exercise startup readiness timing.

**SUGGESTION**:
1. Correct the environment/toolchain and type/build failures, then rerun this bounded batch.
2. Rerun PostgreSQL-only verification only after all six safety proof fields are demonstrably present for a disposable non-production target.

### Verdict

**FAIL — bounded batch 1 is not a final verification.** The repository has deterministic hardening coverage and zero DB side effects, but current runtime test, typecheck, build, and root lint evidence is insufficient to mark the change complete.

---

## Bounded Rerun — 2026-08-31 — Prisma lock released

This rerun preserves the historical failure evidence above. It was executed after the verified Prisma process lock was released and is still bounded batch 1 only; it does **not** mark final verification complete.

### Rerun envelope

```yaml
schema: gentle-ai.verify-result/v1
batch: 1
rerun: true
mode: strict-tdd
final_verification_complete: false
status: partial
verdict: pass-with-warnings
requirements: 8/8 evaluated
scenarios: 8/8 evaluated
test_command: pnpm test -- tests/foundation/p0-native-profile.test.mjs tests/foundation/tus-product-hardening.test.mjs tests/integration/tus/postgres-http-smoke.test.mjs tests/integration/tus/tus-runtime-audit.test.mjs
test_exit_code: 0
test_output_hash: sha256:c7694aef2e7451e4e6c1c84fe66076a6fc7385f4d8cd7173db4323d4fe5b680c
build_command: pnpm build
build_exit_code: 0
build_output_hash: sha256:4249f09e6e4a0b41a65092edee7a2b42cceaa1f8152810b8401eecc4805c84a9
```

### Scope and process safety

- Only finite deterministic checks were run, each in an independent owned process wrapper with a hard limit below 180 seconds.
- No API, web, mobile, browser, Docker, database, provider, watcher, or long-lived service was started.
- No migration, seed, cleanup, query, connection, or database write was run. Prisma validation used only a synthetic non-network URL to satisfy CLI schema parsing; the root secret was not printed or persisted.
- The root `.env` resolver was checked only through the focused secret-safe tests. Those tests confirmed root-file authority over ambient values, proof-before-side-effects, and redacted diagnostics.
- Owned wrapper PIDs checked after the run: `16020,19152,23696,25012,1316,23924,13144,10196`; remaining owned PIDs: none. Unknown processes were not inspected or killed.

### Command evidence

| Check | Exact result | Evidence hash |
|---|---|---|
| Focused hardening tests | **PASS**, exit 0; 48 passed, 0 failed, 0 skipped across 4 files (6 + 14 + 23 + 5) | `sha256:c7694aef2e7451e4e6c1c84fe66076a6fc7385f4d8cd7173db4323d4fe5b680c` |
| `pnpm typecheck` | **PASS**, exit 0; 8 Turbo tasks successful (7 cached, 1 executed) | `sha256:d0c80e30ac1024e846d999c997af18a9a307760a4c8f469461b33f4a2b4952bd` |
| API lint | **PASS**, `pnpm --filter @factory/api exec eslint src/tus/pos/index.ts`, exit 0; no output/errors | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Prisma schema validation | Initial CLI invocation safely failed because `DATABASE_URL` was not present in the Prisma CLI environment, exit 1; a bounded retry with a synthetic non-network URL **passed**, exit 0 | Initial `sha256:af1e0755b8f099de03fbb660eb41a85e2775194d2387affe704960cff65133bd`; retry `sha256:57a95d6fed0c8565ccec14844a8dfddf60c99bc53587cd2cb974240ddedfb340` |
| Prisma/API build | **PASS**, `pnpm --filter @factory/api build`, exit 0; Prisma Client v5.22.0 generated | `sha256:e8119041b8bf3dad95245d246271fda97dff4231ef8d92f5feffc7e27b483f5c` |
| Root `pnpm build` | **PASS**, exit 0; 4 Turbo tasks successful. Existing Next.js workspace-root and anonymous-default-export warnings only | `sha256:4249f09e6e4a0b41a65092edee7a2b42cceaa1f8152810b8401eecc4805c84a9` |
| Root `pnpm lint` | **WARNING**, exit 1 after 68.895 seconds; mobile lint found one generated `dist/_expo` parser error plus six warnings. No retry was made | `sha256:e9cb102d9301f153a4dfead9b241fa2abbc60d1f46c0f6b33c87aed77c1d60` |

### Strict TDD verification

The corrective TDD table in `apply-progress.md` remains present with safety-net, RED, GREEN, triangulation, and refactor columns. All four listed focused test files exist and passed in this rerun. The assertion audit found no tautologies, ghost loops, orphan empty checks, assertion-only tests, or smoke-only assertions; assertions exercised resolver, lifecycle, schema/fixture, outbox, cleanup, and evidence behavior. No coverage tool/report was available, so changed-file coverage remains skipped.

### Spec compliance matrix

| Requirement | Scenario outcome in this bounded rerun |
|---|---|
| Safe database configuration | **PASS for deterministic denial/redaction**; approved live target evidence remains deferred |
| Idempotent fixtures and non-destructive cleanup | **PARTIAL**; deterministic idempotency/refusal guards pass, real PostgreSQL remains deferred |
| Additive PostgreSQL schema and tenant rules | **PARTIAL**; Prisma schema validates and deterministic contract checks pass, real PostgreSQL isolation remains deferred |
| Atomic POS, audit/outbox, and recovery | **PARTIAL**; deterministic in-memory/replay contracts pass, real PostgreSQL durability remains deferred |
| Bounded child lifecycle | **PASS for deterministic runtime coverage**; focused Windows close/escalation and timeout cleanup tests pass |
| Canonical environment contract | **PASS for deterministic inventory/alias behavior** |
| Bounded real workflow evidence | **PASS for truthful external-blocked classification**; browser/device/provider journeys remain intentionally unrun |
| Reproducible startup and fail-closed rollback | **PARTIAL**; build/start contract checks pass, root lint has a generated mobile artifact error and external deployment evidence is deferred |

**Scenario summary**: 4/8 scenarios pass on the permitted deterministic or external-blocked path; 4/8 remain partial because this batch deliberately omits live PostgreSQL, browser/device/provider, and deployment-runtime evidence. No focused scenario is failing in the rerun.

### Correctness and design coherence

| Area | Result |
|---|---|
| Root dotenv authority and secret-safe diagnostics | **PASS**; verified by runtime tests without exposing the root value |
| Safety gate ordering and zero DB side effects | **PASS**; unsafe/deferred paths returned before transport or fixture operations |
| Additive schema, fixtures, tenant indexes/constraints, POS/outbox contracts | **PASS deterministically**; live PostgreSQL behavior remains unverified |
| Exact owned-child lifecycle | **PASS deterministically**; prior Windows failure is cleared by the rerun |
| Build recovery after Prisma lock release | **PASS**; Prisma/API and root builds completed successfully |
| Design alignment | **PASS**; no functional deviation observed from proposal/design; external claims remain fail-closed |

### Issues

**CRITICAL**: None in the rerun's executed deterministic checks.

**WARNING**:

1. Root `pnpm lint` exits 1 because mobile lint scans a generated `apps/mobile/dist/_expo` artifact that is absent from the provided TypeScript project, plus six non-blocking warnings; this was not fixed or retried.
2. The first Prisma schema command lacked a CLI-visible `DATABASE_URL`; the safe synthetic-URL retry passed. This does not constitute database evidence or a database side effect.
3. Live PostgreSQL, browser/device/provider, POS hardware, cloud, and production evidence remains deferred to the separately bounded next phase.

**SUGGESTION**: Run the separately authorized PostgreSQL/runtime/browser/deployment evidence phase only after disposable-target proof is available; preserve all external outcomes as fail-closed evidence.

### Rerun verdict

**PASS WITH WARNINGS — bounded verification batch 1 rerun only.** Deterministic hardening tests, typecheck, API lint, Prisma schema validation (safe retry), Prisma/API build, and root build pass after lock release. Root lint is a bounded warning, and final verification remains incomplete.
