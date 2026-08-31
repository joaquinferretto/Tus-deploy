# Apply Progress: TUS Product Hardening

## Work Unit

- Change: `tus-product-hardening`
- Artifact store: Hybrid (OpenSpec + Engram)
- Delivery: single PR; ordered work units; chain strategy remains pending because the task forecast explicitly selected single-PR delivery
- Base/checkpoint: `chore: checkpoint partial tus hardening`
- Scope: complete the six ordered hardening work units without provider calls, production activation, destructive database actions, or sibling-repository edits
- Mode: Strict TDD
- Current status: implementation and corrective deployment/configuration batch complete; focused contract tests, typecheck, mobile config, and static Render/Next checks are green; full web/root builds were bounded and external runtime/database/deployment evidence remains deferred

## Completed Tasks

### Phase 1: Safety and Environment

- [x] 1.1 Root `.env` `DATABASE_URL` remains authoritative and secret-free; incomplete target proof fails closed before side effects.
- [x] 1.2 `SafeTarget` resolution and native profile gating allow only the root dotenv source; ambient and runner overrides are not used.
- [x] 1.3 Consumer/canonicalization coverage records app, mobile, web, Render, Terraform, test, documentation, and backend-file consumers.
- [x] 1.4 Environment inventory records legacy URL aliases as noncanonical; the runner does not read or forward them.

### Phase 2: PostgreSQL and POS Durability

- [x] 2.1 Deferred/unsafe targets, fixture safety, tenant isolation, migration constraints/indexes, and invalid transitions are covered by the PostgreSQL smoke contract.
- [x] 2.2 Prisma schema, additive migration, tagged fixture seed, migration preflight, and recovery fields are implemented.
- [x] 2.3 Product/service POS retry, version conflict, rollback, audit/outbox, replay/recovery, and cross-tenant behavior are covered by deterministic tests.
- [x] 2.4 In-memory and Prisma POS outboxes support tenant-scoped claims, leases, acknowledgement, recovery, and at-most-once acknowledgement semantics.
- [x] 2.5 Injected ports and transitions are preserved; recovery remains targeted and does not reset, truncate, cascade-delete, or perform untagged cleanup.

### Phase 3: Process Ownership and Real Smoke

- [x] 3.1 Startup/request/shutdown bounds, interruption, and PID/cwd/argv ownership mismatch cases are tested; child deadlines clamp to `120_000ms`.
- [x] 3.2 `OwnedChild`, native child execution, termination escalation, `try/finally` cleanup, and redacted process boundaries are implemented.
- [x] 3.3 Approved-target, authenticated-flow, replay/conflict, audit/outbox, restart/recovery, cleanup, and provider non-interaction assertions are covered.
- [x] 3.4 PostgreSQL smoke remains deferred unless explicit non-production loopback/profile proof is present; unsafe targets report zero side effects.

### Phase 4: Runtime, Deployment, and Readiness

- [x] 4.1 Runtime audit tests cover authenticated API/web/mobile/POS flow classification, bounded execution, screenshots, and external-blocked evidence.
- [x] 4.2 Runtime audit supports cancellation, cleanup callbacks, finite screenshot capture, and redacted evidence references without hardware/native success claims.
- [x] 4.3 Local, Render, Vercel, wrapper, and build/start contracts are covered; the corrective build wrapper now fails closed with a bounded Windows Prisma-lock diagnostic when the engine is held by an existing API process.
- [x] 4.4 Evidence, runbooks, manifests, and missing-external-proof behavior remain fail-closed and explicitly deferred.

## TDD Cycle Evidence

| Task group | RED evidence | GREEN result | REFACTOR / triangulation |
|---|---|---|---|
| 1.1–1.2 | Safety tests exercised missing proof, ambient-only URLs, invalid proof, and side-effect ordering before resolver changes | `tus-product-hardening.test.mjs`: safety cases passed | Root dotenv authority, rejected ambient/runner overrides, proof redaction, and stable denial reasons centralized |
| 1.3–1.4 | Inventory assertions required canonical-source and legacy-alias coverage before inventory completion | Inventory assertions passed in the focused hardening suite | Legacy aliases are documented as noncanonical; only proven consumers were normalized |
| 2.1–2.2 | Smoke tests asserted deferred targets, additive SQL, fixture tagging, indexes/checks/FKs, and idempotent seed behavior before schema completion | Focused PostgreSQL/hardening tests passed; no live target was used | Added `TusHardeningFixture`, additive table/indexes, preflight checks, and tenant-scoped outbox columns |
| 2.3–2.5 | POS replay, lease, acknowledgement, recovery, rollback, conflict, and tenant-isolation cases were asserted before the durable outbox implementation | POS smoke cases passed | In-memory and Prisma adapters preserve injected ports and target only generated mutable state |
| 3.1–3.2 | Child timeout, SIGKILL escalation, argv mismatch, cwd mismatch, and cleanup tests exercised failure paths first | P0/native and hardening child tests passed | Exact launch identity and deadline clamping are shared by the runner and native profile |
| 3.3–3.4 | Deferred smoke and zero-side-effect cases preceded smoke-gate changes | PostgreSQL smoke suite passed with deferred evidence | Live claims remain impossible without approved non-production loopback/profile proof |
| 4.1–4.2 | Runtime timeout/cancellation/cleanup and screenshot-redaction tests preceded audit changes | Runtime audit suite passed | AbortController, bounded screenshot capture, and cleanup are isolated in the audit boundary |
| 4.3–4.4 | Startup/build contract and external-blocked assertions were run before final evidence reconciliation | `pnpm build` and contract assertions passed | Documentation and evidence preserve deferred status rather than claiming live conformance |

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | Corrective bounded command: `pnpm test -- tests/foundation/p0-native-profile.test.mjs tests/foundation/tus-product-hardening.test.mjs tests/integration/tus/postgres-http-smoke.test.mjs tests/integration/tus/tus-runtime-audit.test.mjs` — exit 0; 48 passed, 0 failed, 0 skipped across 4 files. |
| Runtime harness command/scenario and exact result | Deterministic PostgreSQL smoke path was not run because the user prohibited runtime/database execution; guarded tests preserve deferred, `liveConformance:false`, zero-side-effect behavior. Runtime audit unavailable paths remain `external-blocked`; no browser, mobile device, POS hardware, or provider claim was made. |
| Additional validation | `pnpm typecheck` — exit 0; 8 Turbo tasks (7 cached, 1 executed). `pnpm --filter @factory/api exec eslint src/tus/pos/index.ts` — exit 0 with no output/errors. `pnpm --filter @factory/api build` — exit 0; Prisma Client v5.22.0 generated in 861ms. `pnpm build` — exit 0; 4 Turbo build tasks successful, with existing Next.js workspace-root and anonymous-default-export warnings only. `pnpm lint` — bounded at 180s; timed out, wrapper exit 1 after terminating its own process tree; root process exited and no direct children remained. |
| Rollback boundary | Revert only the hardening files changed in this slice, `openspec/changes/tus-product-hardening/tasks.md`, and this progress artifact. Preserve unrelated worktree changes, the checkpoint branch, and all durable data outside uniquely tagged fixtures. |

## Corrective Verification Batch 1

### Completed corrective fixes

- [x] Native child cleanup now verifies ownership inside `OwnedChild.stop()`, waits for either `exit` or Windows `close`, escalates only the exact owned child from `SIGTERM` to `SIGKILL`, and always cleans timed-out/error paths through `runChild`'s `finally` boundary.
- [x] Added a deterministic close-only/escalation test proving the child lifecycle does not broad-kill and remains bounded on Windows-style termination events.
- [x] Replaced the strict-invalid `delete unsigned.integrityHash` with type-safe destructuring while preserving the receipt hash and tamper-detection behavior.
- [x] API build now uses `scripts/build-api.mjs`, which redacts forwarded Prisma output and fails clearly when Windows cannot replace a locked query engine; it never deletes generated artifacts.
- [x] Deployment runbook documents the locked-engine prerequisite, truthful pnpm/Corepack prerequisites, and the safe direct-equivalent evidence boundary.

### TDD Cycle Evidence — corrective batch

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Windows owned-child termination | `tests/foundation/p0-native-profile.test.mjs` | Process integration | ✅ Existing native profile tests passed before production edits | ✅ Close-only child failed on old exit-only wait | ✅ Focused file passed; real busy child timeout also passed | ✅ SIGTERM then SIGKILL with close-only completion | ✅ Ownership check and listener cleanup centralized in `OwnedChild` |
| POS receipt strict typing | `tests/foundation/tus-product-hardening.test.mjs` | Unit/contract | ✅ Existing hardening tests passed before production edit | ✅ Source contract rejected `delete unsigned.integrityHash` | ✅ Receipt verification and tamper case passed | ✅ Valid and tampered receipts | ✅ Destructuring preserves serialized hash input |
| API build contract | `tests/foundation/tus-product-hardening.test.mjs` | Tooling contract | ✅ Existing hardening tests passed before production edit | ✅ Missing build wrapper contract failed | ✅ Wrapper contract passed and bounded build emitted the lock diagnostic | ✅ Successful typecheck plus locked-engine failure path | ✅ Redaction and no-delete policy kept in wrapper |

### Corrective issues and bounded evidence

- Prisma generation failure from the prior batch was cleared by the explicitly authorized orphan cleanup: PID 21408 matched the exact command line `C:\nvm4w\nodejs\node.exe C:\Users\mmmau\tuscompras-b2b\Goldenrepo-js-py\apps\api\dist\index.js`, did not exit during the 5-second graceful wait, was then stopped by exact PID with force, and was verified exited. The Prisma/API build and root build subsequently passed. PID 4464 was not touched; it was absent during the final process check, so no parent lock blocker remains.
- `pnpm` and Corepack are available in the current shell at 9.15.9, so no package-manager workaround or global installation was added. The earlier missing Corepack module failure is not reproducible in this bounded rerun.
- Root `pnpm lint` remains environment/tooling-bound: the 180-second command timed out while mobile lint was running. The known corrected POS path passes scoped ESLint; no indefinite retry or unrelated mobile edit was made.
- No API, web, mobile, browser, Docker, watcher, provider, PostgreSQL, migration, seed, cleanup, or database process was started by this correction. Focused child tests and the bounded lint process tree exited cleanly; ports 3100, 3101, and 3200 had zero listeners. PID 4464 was never stopped by this run and was absent during the final check.

## Deviations and Issues

- No functional deviation from the design. The required `TusHardeningFixture` model/table was added after the first RED run identified its absence; the corrective focused suite now passes 48/48.
- Full `pnpm test` was attempted with a 180-second hard timeout but did not complete before the wrapper timeout; the targeted hardening suite and build-contract regression pass. Do not claim the entire repository suite is green from this run.
- Full root lint also exceeded the bounded wrapper timeout; the corrected POS file lints with zero errors, while the previously scoped delivery adapter still has one existing `no-explicit-any` warning when included.
- API Prisma generation is no longer blocked after the exact verified orphan was stopped; `pnpm --filter @factory/api build` and `pnpm build` both passed. Root lint remains bounded/environmental and timed out at 180 seconds.
- Real PostgreSQL, provider, browser/device, POS hardware, cloud, and production evidence remains deferred because approved non-production loopback/profile proof is unavailable.
- No `sdd-verify`, `sdd-archive`, review lifecycle, production activation, provider call, or destructive database operation was invoked.

## Status

16/16 original implementation tasks complete. Operational correction complete; Prisma/API and root builds are green, and external PostgreSQL/provider/browser/device/POS evidence remains deferred.

## Corrective Runtime Batch 3

### Completed corrective fixes

- [x] 4.5 Web API URL consumers now use `NEXT_PUBLIC_API_URL` as the canonical production/build-time source. `API_BASE_URL` remains a retained alias only when it agrees; production fails closed when no canonical URL is supplied. The native web wrapper explicitly injects `http://localhost:3101` for local development, so that development port is not a production fallback.
- [x] 4.6 Expo web resolution now redirects only `zustand/middleware` to a small web-compatible persistence implementation, avoiding Zustand's unsupported `import.meta` expression in the classic Expo web bundle. Native resolution remains unchanged; encrypted MMKV persistence, secure credentials, runtime validation, tenant-scoped POS state, and POS routes remain in the existing application source.
- [x] 4.7 Mobile ESLint ignores only generated `dist/**`; the new Metro resolver/config and web persistence JavaScript remain explicitly lintable through a non-type-aware JS override. No source lint error was hidden.

### TDD Cycle Evidence — corrective runtime batch 3

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.5 | `tests/foundation/tus-product-hardening.test.mjs` | Unit/contract | ✅ Prior hardening baseline 48/48 | ✅ Missing `apps/web/src/lib/api-url.ts` failed before implementation | ✅ Focused suite 17/17 | ✅ Production canonical URL, local wrapper injection, agreeing alias, disagreement, and invalid URL cases | ✅ Shared pure resolver used by API, TUS, and auth consumers; no web source contains a localhost fallback |
| 4.6 | `tests/foundation/tus-product-hardening.test.mjs` | Unit + runtime build | ✅ Prior hardening baseline 48/48 | ✅ Missing mobile resolver failed before implementation | ✅ Focused suite 17/17; Expo web export bundled 777 modules | ✅ Web resolver maps Zustand middleware, native resolver delegates, and exported bundle scan found no `import.meta` | ✅ Compatibility is isolated to web resolution; native app-store/security/POS boundaries are untouched |
| 4.7 | `tests/foundation/tus-product-hardening.test.mjs` | Static/lint contract | ✅ Prior root lint issue recorded as generated-output/tooling boundary | ✅ Missing generated-output boundary failed the new contract | ✅ Root lint completed with generated output excluded; mobile scoped lint passed | ✅ Source JS config/shim linted separately and produced zero errors | ✅ Only `apps/mobile/dist/**` is ignored; source warnings/errors remain visible |

### Bounded verification evidence — corrective runtime batch 3

| Check | Exact result |
|---|---|
| Focused test command | `$env:TEST_FILE_TIMEOUT_MS='30000'; pnpm test -- tests/foundation/tus-product-hardening.test.mjs` — exit 0; 17 passed, 0 failed, 0 skipped. |
| Runtime harness | `$env:APP_PROFILE='dev'; apps/mobile/node_modules/.bin/expo.cmd export --clear --platform web --output-dir C:\Users\mmmau\AppData\Local\Temp\opencode\tus-product-hardening-mobile-export-3` — exit 0; Metro bundled 777 modules and wrote a 1,215,351-byte bundle. Bounded scan found `import.meta` absent. No server/browser/device was started. |
| Web production bundle check | `pnpm build` — exit 0; 4 Turbo build tasks successful in 135.304s. Built web output contains neither `localhost:3001` nor `localhost:3101`; production config is required at runtime/build input. |
| Typecheck | `pnpm typecheck` — exit 0; 8 Turbo tasks successful in 50.666s. |
| Affected lint | `pnpm --filter @factory/mobile exec eslint metro.config.js metro-resolver.cjs src/store/web-zustand-middleware.js src/store/app-store.ts --max-warnings 0` — exit 0; no output/errors. `pnpm --filter @factory/web exec eslint src/lib/api-url.ts src/lib/api-client.ts src/lib/tus-client.ts src/lib/tus-auth-client.ts` — exit 0; 0 errors and 2 pre-existing anonymous-default-export warnings. |
| Root lint / generated-output proof | `pnpm lint` — exit 0; 6 Turbo lint tasks successful in 126.176s, with 6 existing source warnings and no generated `apps/mobile/dist/_expo` parser failure. |
| Database/provider safety | No PostgreSQL connection, migration, seed, query, write, cleanup, provider call, Docker, watcher, browser, or long-lived service was started. |
| Cleanup state | Export output was written only under the approved external temp directory; no runtime listeners remained on ports 3001, 3100, 3101, or 3200; no owned API/web/mobile processes remained. |
| Rollback boundary | Revert only `apps/web/src/lib/{api-url.ts,api-client.ts,tus-auth-client.ts,tus-client.ts}`, `apps/mobile/{metro.config.js,metro-resolver.cjs,.eslintrc.cjs}`, `apps/mobile/src/store/web-zustand-middleware.js`, `scripts/dev/native-profile.mjs`, `render.yaml`, the focused hardening tests, and the appended OpenSpec progress/task sections. Preserve all prior hardening changes and unrelated dirty-tree files. |

### Status after corrective runtime batch 3

19/19 implementation tasks complete including corrective runtime tasks. Both observed runtime defects are corrected and bounded evidence is green; external PostgreSQL, provider, authenticated browser, native-device, physical POS, cloud, compliance, and production evidence remains deferred.

## Recovery Pass — bounded confirmation

### Scope

This recovery pass resumed the existing apply state without restarting or
rewriting the change. No implementation change was needed: the two previously
observed runtime defects and their focused regressions are present and pass.

### Confirmed fixes

- [x] Production web authentication and API consumers resolve the canonical
  `NEXT_PUBLIC_API_URL`; `API_BASE_URL` is accepted only as an agreeing alias,
  and production fails closed without the canonical URL. The local native web
  wrapper supplies `http://localhost:3101` explicitly; no web source embeds the
  prior `localhost:3001` fallback.
- [x] Expo web maps only `zustand/middleware` to the web-compatible persistence
  shim, while native resolution remains unchanged. The existing secure-storage,
  runtime-validation, tenant-scoped POS, and mobile application boundaries are
  preserved.

### Recovery verification evidence

| Check | Exact result |
|---|---|
| Focused regression tests | `pnpm test -- tests/foundation/tus-product-hardening.test.mjs` — exit 0; 17 passed, 0 failed, 0 skipped in 1.269s. Canonical web URL/auth coverage and Expo resolver/import-meta coverage both passed. |
| Typecheck | `pnpm typecheck` — exit 0; 8 successful tasks, 8 cached, 7.983s. |
| Affected web build | `$env:NEXT_PUBLIC_API_URL='https://api.example.invalid'; pnpm --filter @factory/web build` — exit 0 on the bounded retry; production build completed and emitted only the existing Next workspace-root and anonymous-default-export warnings. |
| Affected web lint | Direct scoped ESLint over `src/lib/api-url.ts`, `src/lib/api-client.ts`, `src/lib/tus-client.ts`, and `src/lib/tus-auth-client.ts` — exit 0; 0 errors and 2 pre-existing warnings. The equivalent pnpm wrapper exceeded the 180s bound, so the direct package-local command is the successful bounded evidence. |
| Affected mobile lint | Direct ESLint over the new Metro config/resolver and web persistence shim — exit 0; no output/errors. The broader package-local command including unchanged `src/store/app-store.ts` exceeded the 180s bound. |
| Expo web export | Two finite export attempts were bounded at 180s and did not complete: the root-CWD attempt rebuilt Metro without output, and the package-CWD no-dotenv attempt reached the Expo Router entry but timed out before bundle completion. No process remained. The existing prior corrective evidence remains the successful export proof: 777 modules bundled and no `import.meta` in the output. |
| Static bundle/source confirmation | `apps/web/src` contains no `localhost:3001` or `import.meta`; focused tests also confirm the mobile shim contains no `import.meta`. |
| Safety boundary | No PostgreSQL, migration, seed, query, write, provider, Docker, browser, watcher, deployment, or long-lived service was started. No secret values were printed. |
| Cleanup state | Owned-process check after each bounded Expo attempt returned no matching Expo/Metro/mobile process. No runtime listener was started by this recovery pass. |
| Rollback boundary | No code rollback or new code delta. If required, revert only the existing corrective runtime files and their focused test/progress sections; preserve all prior hardening and unrelated dirty-tree changes. |

### Recovery status

19/19 implementation tasks remain complete. The current implementation is
complete and the focused regressions, typecheck, affected web build, and
affected lint are green. Expo export was re-attempted only within the bound but
was inconclusive in this environment; prior successful export evidence remains
recorded above. External PostgreSQL/provider/authenticated browser/device/POS,
cloud, compliance, and production evidence remains deferred.

## Operational Correction Batch 2

### Process ownership correction

- [x] Verified PID 21408 still matched the exact `node.exe` command line for `apps/api/dist/index.js` before acting.
- [x] Applied a bounded 5-second graceful wait followed by exact-PID forced termination and verified PID 21408 exited.
- [x] Did not stop PID 4464 or any process by name; final check found PID 4464 absent and no remaining query-engine lock holder.

### Bounded verification evidence

| Check | Exact result |
|---|---|
| Focused hardening tests | `pnpm test -- tests/foundation/p0-native-profile.test.mjs tests/foundation/tus-product-hardening.test.mjs tests/integration/tus/postgres-http-smoke.test.mjs tests/integration/tus/tus-runtime-audit.test.mjs` — exit 0; 48 passed, 0 failed, 0 skipped across 4 files. |
| Typecheck | `pnpm typecheck` — exit 0; 8 Turbo tasks successful (7 cached, 1 executed). |
| API lint | `pnpm --filter @factory/api exec eslint src/tus/pos/index.ts` — exit 0; no output/errors. |
| Prisma/API build | `pnpm --filter @factory/api build` — exit 0; Prisma Client v5.22.0 generated in 861ms. |
| Root build | `pnpm build` — exit 0; 4 Turbo build tasks successful; existing Next.js warnings only. |
| Root lint | `pnpm lint` — bounded at 180 seconds; timed out and was terminated by the run-owned process-tree wrapper (wrapper exit 1, root exited, zero direct children remained). |
| Runtime/process cleanup | No service/browser/watcher/Docker/database was started. Final check: PID 21408 absent, PID 4464 absent without being touched, and ports 3100/3101/3200 had zero listeners. |

### TDD Cycle Evidence — operational correction

| Correction | RED / safety net | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|
| Verified orphan cleanup and build recovery | Existing lifecycle/build-contract tests were present; no production source change was made in this correction | Focused tests 48/48, typecheck, API lint, Prisma/API build, and root build passed after exact-PID cleanup | API build and root build both exercised Prisma generation; final process/port checks confirmed cleanup | No source refactor; prior corrective implementation preserved |

## Corrective Deployment/Configuration Batch

### Completed corrective fixes

- [x] 4.8 The canonical local API port is `3101` across the API default, native
  wrapper default, mobile development profile, Docker/Compose, examples,
  Makefile, README, architecture notes, portability/runbook docs, and active
  mobile test expectations. `buildNativeChildEnvironment` preserves an explicit
  `API_PORT` override.
- [x] 4.9 The production web API URL remains intentionally absent from
  `vercel.json` because no truthful non-secret URL is known. The deployment
  runbook now requires `NEXT_PUBLIC_API_URL` in Vercel Project Settings for
  Production and Preview, documents the agreeing `API_BASE_URL` alias, and
  documents `EXPO_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, and
  `NEXT_PUBLIC_SUPPORT_WHATSAPP_URL` consumers.
- [x] 4.10 Next now emits `output: 'standalone'`, matching the existing Docker
  copy/start contract. The checked-in config and Docker paths were validated
  statically; no Docker build or container was started.
- [x] 4.11 The API package exposes `prisma:migrate:deploy`, and Render runs it
  in `preDeployCommand` after build and before API start. No migration command
  was executed against any database.
- [x] 4.12 `MONGODB_URL` is canonical in the API adapter, examples, and Render;
  `MONGODB_URI` remains only as an explicit adapter fallback for legacy
  consumers, and is no longer declared by active Render services.
- [x] 4.13 The Render Python worker retains its actual one-shot command but is
  labeled `external-blocked-placeholder` and explicitly not production-ready
  until a long-lived queue loop exists.

### TDD Cycle Evidence — corrective deployment/configuration batch

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.8 | `tests/foundation/tus-product-hardening.test.mjs` | Unit/contract | ✅ Prior focused hardening suite 17/17 | ✅ Port contract failed on API `3001`, missing wrapper default, and stale examples | ✅ Focused suite 19/19; mobile config command reported `http://localhost:3101` | ✅ Explicit wrapper `API_PORT=3999` plus canonical defaults across app/docs/Compose | ✅ Shared `NATIVE_API_PORT` and documented wrapper precedence |
| 4.9 | `tests/foundation/tus-product-hardening.test.mjs` | Static deployment contract | ✅ Prior web URL resolver tests passed | ✅ Missing dashboard/project requirement assertion failed | ✅ Focused suite 19/19 | ✅ Canonical URL, absent manifest value, public mobile/site/support consumers | ✅ No placeholder URL or secret added to Vercel |
| 4.10 | `tests/foundation/tus-product-hardening.test.mjs` | Static build contract | ✅ Existing Next config contract loaded before edit | ✅ Docker standalone assertion failed before `output` was added | ✅ Focused suite 19/19 and direct Next config load passed | ✅ Standalone output and Docker server/static copy paths agree | ✅ Existing Docker runtime preserved |
| 4.11 | `tests/foundation/tus-product-hardening.test.mjs` | Static release contract | ✅ Existing Render shape test passed | ✅ Missing package release script/pre-deploy assertion failed | ✅ Focused suite 19/19; YAML parser contract passed | ✅ Build → pre-deploy migrate → start ordering | ✅ Reused package script; no new migration implementation |
| 4.12 | `tests/foundation/tus-product-hardening.test.mjs` | Static env contract | ✅ Existing inventory test passed | ✅ Render/API canonical-alias assertions failed before alignment | ✅ Focused suite 19/19 | ✅ Canonical URL and legacy URI fallback are both verified | ✅ Alias retained; no repository-wide removal claim |
| 4.13 | `tests/foundation/tus-product-hardening.test.mjs` | Static deployment contract | ✅ Existing Render shape test passed | ✅ Placeholder classification assertion failed before labeling | ✅ Focused suite 19/19 | ✅ Actual one-shot command plus explicit external-blocked status | ✅ No false long-lived worker implementation added |

### Work Unit Evidence — corrective deployment/configuration batch

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/tus-product-hardening.test.mjs` — exit 0; 19 passed, 0 failed, 0 skipped. Supporting focused POS/mobile-contract command — exit 0; 30 passed across three files (`p8`, `p9`, `tus-idempotency-ui`). The mobile Jest command was bounded at 180s without output; the direct runtime-profile assertion and Expo config harness passed. |
| Runtime harness command/scenario and exact result | `pnpm --filter @factory/mobile config:dev` — exit 0; Expo serialized `apiUrl: http://localhost:3101`. Render/Prisma runtime execution is explicitly N/A for this pass because the requested safety boundary forbids database connections, migrations, writes, deployments, Docker, services, and watchers. |
| Static deployment validation | `node -e "require('./apps/web/next.config.js')"` — exit 0; standalone contract passed. PyYAML manifest check — exit 0; Render release/env/worker contract passed. |
| Typecheck | `pnpm typecheck` — completed successfully; 8 Turbo tasks passed in 127.087s. |
| Build validation | `pnpm build` — bounded at 180s and terminated during Next web build after compilation began; no process remained. `pnpm --filter @factory/web exec next build --no-lint` — bounded at 180s and terminated during final build tracing; no process remained. No successful post-change production build is claimed. |
| Database/provider safety | No PostgreSQL connection, migration, seed, query, write, cleanup, provider call, deployment, Docker, watcher, browser, or long-lived service was started. No secret-bearing value was read or printed. |
| Cleanup state | Process check after bounded builds found no repository-owned `node`, `pnpm`, `next`, or `prisma` process. No listener was created by this pass. |
| Rollback boundary | Revert only the corrective deployment/configuration files: API port/default and Mongo adapter, native/mobile config, API package script, Next/Docker/Compose/manifests, examples, Makefile, README/architecture/runbooks/inventory/portability docs, the four affected test files, and the appended task/progress sections. Preserve all prior hardening, generated evidence, unrelated dirty-tree changes, and sibling repository paths. |

### Deviations and risks

- `deployment-evidence.md` remains the immutable baseline audit recording the
  mismatches that triggered this batch; it was not rewritten as live evidence.
- The full production web/root build did not finish within the required 180s
  bound after enabling standalone output. Static config and focused contract
  checks pass, but external Render/Vercel/Docker/PostgreSQL conformance remains
  `external-blocked`.
- Existing `p7-tus-marketplace-operations.test.mjs` still has a separate
  extensionless web import failure under the repository's Node strip-types
  runner; it predates this batch and was not changed or used as deployment
  evidence.

## Status after corrective deployment/configuration batch

26/26 implementation tasks complete. The verified deployment/configuration
mismatches are corrected in source and documentation; focused deterministic
contracts, typecheck, mobile config, and static Render/Next checks pass.
Database, provider, Docker, browser/device, cloud, deployment, and post-change
full-build evidence remains deferred or external-blocked.

## Corrective Deployment Batch 2

### Completed task

- [x] 4.14 Render web now launches `node .next/standalone/server.js` through the
  `@factory/web` package start script, with `PORT=$PORT` passed by the Render
  service. From the repository root the generated entrypoint is
  `apps/web/.next/standalone/server.js`; the package-relative script path is
  `.next/standalone/server.js`. The Python worker remains an
  `external-blocked-placeholder` one-shot command.

### TDD Cycle Evidence — corrective deployment batch 2

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.14 | `tests/foundation/p8-tus-deployment.test.mjs` | Static deployment contract | ⚠️ Existing p8 baseline 6/7 because the known stale standalone assertion failed; hardening baseline 19/19 | ✅ Updated test failed on `next start` before production changes | ✅ Focused p8 passed 7/7 after entrypoint/PORT/docs changes | ✅ Second contract passed with worker unchanged; p8 passed 8/8 | ✅ Added `serviceSection` helper; p8 remained 8/8 |

### Work Unit Evidence — corrective deployment batch 2

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/p8-tus-deployment.test.mjs tests/foundation/tus-product-hardening.test.mjs` — exit 0; p8 8 passed, hardening 19 passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario and exact result | N/A — this is a static Render/Next contract correction; the requested boundary forbids starting services, watchers, browsers, Docker, databases, migrations, seeds, providers, or deployment. |
| Static checks | JSON parse — exit 0, 5 files; YAML parse — exit 0, `render.yaml` 3 services; `node --check apps/web/next.config.js` plus standalone config load — exit 0. |
| Rollback boundary | Revert only `apps/web/package.json`, `render.yaml`, `docs/runbooks/tus-deployment.md`, `docs/deployment/render.md`, `tests/foundation/p8-tus-deployment.test.mjs`, this task entry, this progress section, and the deployment-evidence reconciliation. Preserve all unrelated dirty-tree files and the sibling repository. |

### Deviations and risks

- No deviation from the requested standalone deployment design. The Render
  command uses the workspace package cwd so the physical repository-relative
  output is `apps/web/.next/standalone/server.js` while the script uses the
  package-relative `.next/standalone/server.js`.
- No live Render deployment, health, secret ownership, database migration, or
  production conformance is claimed. The worker remains external-blocked.

## Status after corrective deployment batch 2

27/27 implementation tasks complete. Render standalone start, platform `PORT`
handoff, documentation, and focused static regression contracts are green;
 external runtime and live deployment evidence remains deferred.

## Focused PostgreSQL Seed Operation

### Scope and result

- [x] Added a root-only PostgreSQL seed entrypoint that resolves only the
  repository-root `.env` `DATABASE_URL`, excludes ambient and runner database
  overrides, and returns redacted metadata only.
- [x] Added bounded PostgreSQL startup with a maximum 60-second attempt, one
  finite retry, safe capped backoff, generic redacted diagnostics, and pool
  cleanup on failed attempts.
- [x] Added explicit idempotent fixture execution through `seed.ts`; when the
  target is approved, the operation runs the same seed twice and verifies
  aggregate counts and stable identities without duplicates.
- [x] Executed the focused operation. The existing gate returned
  `target-identity-required` and `disposable-proof-required`; no connection,
  migration, query, seed, write, provider call, or process was started.

### TDD Cycle Evidence — focused seed operation

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Root-only resolution/redaction | `tests/integration/tus/postgres-seed.test.mjs` | Integration contract | N/A (new) | ✅ Missing export failed | ✅ 5-file focused run passed | ✅ Ambient and runner values rejected; root source selected | ✅ Redacted target helper centralized |
| Bounded startup retry | `tests/integration/tus/postgres-seed.test.mjs` | Unit contract | N/A (new) | ✅ Missing retry export failed | ✅ 60,000 ms bound and second attempt passed | ✅ Success-after-retry and two-failure paths | ✅ Generic diagnostics and capped backoff |
| Seed idempotency/safety refusal | `tests/integration/tus/postgres-seed.test.mjs` | Integration contract | N/A (new) | ✅ Missing seed orchestration failed | ✅ Unsafe zero-side-effect and approved two-run cases passed | ✅ Stable identity and duplicate count checks | ✅ Cleanup state and side-effect evidence centralized |

### Work Unit Evidence — focused seed operation

| Evidence | Exact result |
|---|---|
| Focused tests | `pnpm test -- tests/integration/tus/postgres-seed.test.mjs` — exit 0; 5 passed, 0 failed, 0 skipped. |
| Runtime harness | `node --experimental-strip-types --experimental-loader ./scripts/node-strip-types-loader.mjs scripts/postgres-seed.mjs` — exit 2 by design; fail-closed safety refusal, 0 connections/writes. |
| Supporting regressions | PostgreSQL smoke + hardening command — exit 0; 23 + 19 tests passed, 0 failed, 0 skipped. |
| Rollback boundary | Revert only the focused seed implementation/test and this appended evidence/progress section; preserve all prior implementation, evidence, dirty changes, and sibling repository paths. |

### Focused seed status

27/27 prior implementation tasks remain complete. The focused seed operation
is correctly `deferred` until explicit disposable target proof is available.
Full PostgreSQL seed/count/identity verification was not claimed.

## Corrective PostgreSQL Safety Simplification

### Completed

- [x] Root `.env` `DATABASE_URL` is the sole database URL source for native,
  smoke, and seed paths; ambient and runner URL variables are ignored.
- [x] The six-field `TUS_TEST_*` metadata contract is no longer required or
  forwarded. Existing `NODE_ENV` and `FACTORY_PROFILE` are used only to refuse
  explicit production and require local/test intent.
- [x] Non-local targets fail closed because a profile label or free-tier status
  does not prove non-production ownership; local proof requires a loopback host.
- [x] The seed entrypoint requires the explicit `seed` intent, retains the
  namespaced idempotent upsert, and preserves non-destructive cleanup.

### TDD Cycle Evidence — corrective safety simplification

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Root-only resolution and profile gate | `tests/integration/tus/postgres-seed.test.mjs`, `tests/integration/tus/postgres-http-smoke.test.mjs` | Integration contract | ✅ Prior seed 5/5 and smoke 23/23 | ✅ Six-field/runner contract cases failed after expected behavior changed | ✅ Focused seed 8/8 and smoke 15/15 | ✅ Root precedence, production refusal, missing profile, non-local URL, malformed URL, and zero-side-effect paths | ✅ Shared root resolver and redacted target metadata |
| Explicit seed intent and idempotency | `tests/integration/tus/postgres-seed.test.mjs` | Integration contract | ✅ Prior seed baseline | ✅ Missing intent and target-shape cases failed | ✅ 8/8 passed | ✅ Omitted intent and explicit local/test intent | ✅ Intent gate precedes target/connection work |
| Seed target contract | `tests/foundation/tus-product-hardening.test.mjs` | Unit/contract | ✅ Prior hardening baseline | ✅ Old disposable-only target assertion failed | ✅ Focused hardening suite passed after target contract update | ✅ Local/test accepted; non-production false refused | ✅ `seed.ts` now matches the simplified resolver |

### Work Unit Evidence — corrective safety simplification

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/integration/tus/postgres-seed.test.mjs tests/integration/tus/postgres-http-smoke.test.mjs tests/foundation/tus-product-hardening.test.mjs tests/foundation/p0-native-profile.test.mjs` — exit 0; 48 passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario | `N/A` — the user prohibited seed execution, PostgreSQL connections/migrations/writes, services, browsers, watchers, Docker, and deployment. |
| Rollback boundary | Revert only `scripts/test-runner-lib.mjs`, `scripts/postgres-seed.mjs`, `scripts/dev/native-profile.mjs`, `apps/api/prisma/seed.ts`, focused tests, local-profile/inventory docs, and this corrective section. |

### Status

27/27 prior implementation tasks remain complete. The safety simplification is
implemented and locally proven by focused deterministic tests; live PostgreSQL
evidence remains deferred and no seed or database operation was executed.
