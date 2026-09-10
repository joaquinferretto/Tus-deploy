schema: gentle-ai.verify-result/v1
evidence_revision: sha256:c5166af98e35ec50addc8834793dc15a39fedba978a2c225616321264ffb66d7
verdict: fail
blockers: 3
critical_findings: 0
requirements: 30/30
scenarios: 46/58
test_command: C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs [bounded segmented suites in command_outcomes]
test_exit_code: 0
test_output_hash: sha256:640c3201ca152c461db8d48a571ae5f68ad81c50bd69b74f169df9c3c830b506
build_command: C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd build
build_exit_code: 0
build_output_hash: sha256:312a67b0942e01c0fab680a2cee3cdd642fde6c5cf8d6d8b95103a567df1c832

## status

FAIL — NO-GO. All 14 implementation tasks plus scoped remediation R1 are checked. Every permitted deterministic command passed; the launch remains blocked because required external evidence is absent and `liveConformance: false` is authoritative.

## executive_summary

The stale native-boundary and platform-aware standalone assertions are reconciled. Bounded core, native, product-hardening, legacy HTTP, TUS integration, marketplace, POS, payment, WhatsApp, delivery, billing, Phase 12, Phase 13, web, mobile, package, root, contract, Prisma, Python, YAML, SQL, policy, security, and diff checks all completed with exit 0.

This verification intentionally does not promote deterministic evidence. No DDL, migration, seed/write, historical destructive SQL, provider call, browser/device session, Docker, cloud deployment, or long-lived service was run. The preserved root `.env` `DATABASE_URL` fixture/seed/read-only inventory is not full schema, ledger, durability, backup/restore, or production evidence.

## artifacts

- `openspec/changes/tus-argentina-market-launch/proposal.md`
- `openspec/changes/tus-argentina-market-launch/design.md`
- `openspec/changes/tus-argentina-market-launch/specs/*/spec.md` — 30 requirements, 58 scenarios
- `openspec/changes/tus-argentina-market-launch/tasks.md` — 14/14 implementation tasks plus R1 complete
- `openspec/changes/tus-argentina-market-launch/apply-progress.md`
- `openspec/changes/tus-argentina-market-launch/*-evidence.md` and `evidence-index.md`
- `openspec/changes/tus-argentina-market-launch/verify-report.md`
- Engram topic `sdd/tus-argentina-market-launch/verify-report`

## command_outcomes

All commands were bounded to 180 seconds or less. Hashes are SHA-256 digests of captured UTF-8 command output. No secret value or database URL was printed.

| Check | Exit | Result / output hash |
|---|---:|---|
| Core/native/security/identity foundation segment | 0 | 115 passed, 0 failed; `sha256:640c3201ca152c461db8d48a571ae5f68ad81c50bd69b74f169df9c3c830b506` |
| Legacy HTTP and TUS integration segment | 0 | 83 passed, 0 failed; `sha256:8ba734c8f2d08d4bac1e849a3d79f5c68d5798f5e4c619f4b1511c0ec9653f75` |
| Web/PWA deterministic segment | 0 | 57 passed, 0 failed; `sha256:2616ce939d12a09c0704b674597f01da40719cbb84d3f7331e749caa2949ba06` |
| Web package test | 0 | 9 passed, 0 failed; `sha256:ae372bf430f184cd80d19efa8c132593b48eaea1db168a02c2ef685c4d0b7f80` |
| Web production build | 0 | Compiled, linted, typechecked, and generated 14 routes; warnings only; `sha256:36cda1a409959ce2c8b635f74f49c1856f9a28b2fd16dde9b8c02b189844b5e2` |
| Web typecheck | 0 | Passed; `sha256:133ddd4e719db73fe7e86c5217e41a7c1cb4025b48c0a9a013cf0eeb6acf9b51` |
| Mobile Jest | 0 | 11 suites, 69 tests passed, 0 failed; `sha256:26031345b9974c482bc3dda8dcbb16746f715cd19c39b71fedfbc3a12a7479b7` |
| Mobile typecheck | 0 | Passed; `sha256:718167c6a01aec6227d9d31d05fa4a8befb8d4de9a57878dfea0373025f71212` |
| Mobile lint | 0 | 0 errors, 11 existing/style warnings; `sha256:589c9dc12886548e770052d4f95acece50edf6c9a0c9ba571aeeb7b7f1efaf56` |
| Mobile staging config | 0 | Staging profile resolved for web/iOS/Android; `sha256:67b5052b19022cd71df7f2df71faa480f563b1f5dacddfe71ce47ffa7e049685` |
| Mobile staging web export | 0 | 788 modules bundled; temporary `.expo-export-check` removed; `sha256:e52303c731671c3baf4dbdeb0cee594796ff29ab8dc74870ad35505a8b034c` |
| Product hardening, billing, Phase 12, Phase 13 | 0 | 49 passed, 0 failed; `sha256:7b19833baf0103bd386449f025e12731d27713e581a4379495f8d65b0679de81` |
| Mercado Pago package build/test | 0 | 7 passed, 0 failed; `sha256:665a55188a26f6ebb38126d237786d6523f0c343a274874e3cd2ace089590dd0` |
| Root build | 0 | 5 successful tasks; `sha256:312a67b0942e01c0fab680a2cee3cdd642fde6c5cf8d6d8b95103a567df1c832` |
| Root typecheck | 0 | 8 successful tasks; `sha256:6c0b083e19c5d6ce72929da1798d04f1360969a90a88e757501c811a6a7f48a7` |
| Root lint | 0 | 6 successful tasks, 0 errors, warnings only; `sha256:fc03e5e4a17164154643a0dc84e481dd0ac606fe929d9a07c3938145065d13da` |
| Contracts validation | 0 | 98 JSON Schema contracts validated; `sha256:8ac533f5917ba8a613eee417e8eb0ae9b9ee52383151fabe9cac28a0635e792e` |
| Prisma validation | 0 | Root-env-only schema validation passed without connection; `sha256:2b7ed802f80fae72ca3321712a7372d74faa3bf724859bb0e8ccc7c6568ae78a` |
| Python compileall | 0 | Worker syntax passed; empty-output hash `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| YAML parse | 0 | `render.yaml` and `docker-compose.yml` parsed; empty-output hash `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| SQL/migration/seed safety segment | 0 | 16 migration-repair plus 18 seed-boundary tests passed; `sha256:5855d36ca35351f30fdde6e2c655b41d49d3d2c905e197ea8ad0fd9edb1535b9` |
| Policy validator | 0 | No findings; empty-output hash `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Tracked security scan | 0 | No findings; `sha256:5456c9e54dc827bbf1e9660b32604b27d5f6349c0f4e67e2273b15257da48a61` |
| `git diff --check` | 0 | Clean apart from existing LF/CRLF normalization warnings; `sha256:cfa3502c89cfa3101271ed471456f3524681f4fddb8dd3a5d679481effb3e535` |

**Build/tests/coverage**: build and typecheck passed. Coverage analysis is skipped because no coverage tool or threshold is configured. Test output is intentionally segmented; overlapping segments must not be summed as unique tests.

**TDD compliance**: the apply artifact contains RED/GREEN/REFACTOR evidence for all 14 tasks and R1; all listed test files exist and the current focused executions pass. Assertion audit found no tautologies, ghost loops, production-call omissions, or smoke-only blockers. Existing warning-only lint/schema diagnostics are non-blocking.

**Test layer distribution**: Unit — 69 tests across 11 Jest suites; deterministic integration/contract — Node runner foundation and TUS suites listed above, with overlapping command segments intentionally not deduplicated; E2E — 0, not run because browser/device sessions were prohibited.

**Changed file coverage**: skipped — no coverage tool or threshold is configured.

**Assertion quality**: ✅ no tautologies, ghost loops, assertion-without-production-call blockers, or smoke-only blockers identified in the audited focused tests.

**Quality metrics**: linter ✅ 0 errors with warning-only existing/style diagnostics; type checker ✅ root 8/8 and web/mobile/API checks green; build ✅ root 5/5 and web 14 routes generated.

## evidence_by_class

| Evidence class | Result | Truth boundary |
|---|---|---|
| deterministic | PASS; requirements 30/30 statically implemented; 46/58 scenarios have passing deterministic coverage | Repository behavior only; does not prove external readiness |
| real-PostgreSQL | EXTERNAL-BLOCKED | Only the prior `TusHardeningFixture` root-target seed/read-only inventory is preserved; no current connection, launch schema, ledger/POS durability, DDL, or restore proof |
| provider | EXTERNAL-BLOCKED | No Mercado Pago, WhatsApp, delivery, billing provider, credential, webhook, or external call |
| browser/mobile | PARTIAL | Mobile Jest/config/export and static web contracts passed; no interactive browser, accessibility session, Android/iPhone, emulator, POS device, printer, or offline-device proof |
| deployment | EXTERNAL-BLOCKED | Static Render/Vercel/DNS/worker contracts and Phase 12 tests passed; no hosted health, DNS/TLS, worker heartbeat, logs, rollback rehearsal, or cloud smoke |
| legal/tax/privacy | EXTERNAL-BLOCKED | Deterministic fail-closed/non-claiming controls passed; no Argentine legal, privacy, tax, accounting, KYC/KYB, or provider approval |
| external-blocked | FAIL-CLOSED | All 11 go-live capability rows remain blocked; deterministic evidence was not promoted |

## P0

- **P0-01 — Launch gate closed:** all 11 capability rows remain blocked; `providers=false`, `payments=false`, `worker=false`, `delivery=false`, `broadLaunch=false`, and `liveConformance=false`.
- **P0-02 — Database gate unresolved:** no launch ledger/POS schema, verified backup/restore, additive DDL, or durable PostgreSQL proof exists. Fixture-only evidence is not promoted.
- **P0-03 — Required direct launch proof absent:** provider, browser/device, hosted deployment/DNS/TLS/worker, support/incident, and legal/tax evidence remains unavailable.

## P1

- No deterministic P1 failures remain. The stale native wrapper assertion now follows `node scripts/dev/native-profile.mjs api|web`; the standalone assertion now follows the Windows-safe conditional while preserving non-Windows/Linux/Render standalone behavior.

## P2

- No coverage tool or threshold is configured.
- Root/mobile lint passes with warning-only existing/style diagnostics; web build/lint emits warning-only diagnostics.
- Contract validation reports AJV unknown-format warnings for `date-time`, `uri`, and `email`, but exits 0 and validates all 98 schemas.
- Ambient `PATH` lacks the required Node/pnpm tools; all JavaScript checks used the pinned NVM toolchain.

## P3

- Reconcile stale historical counters in `apply-progress.md` if desired; they do not override the authoritative 14/14 task state.
- Keep generated build/typecheck caches out of intentional verification changes.

## next_recommended

Retain `NO-GO` and `liveConformance: false`. The next valid step is a separately owner-authorized, profile-scoped external evidence pass: verified backup/restore and additive PostgreSQL gate first, then provider, browser/device, deployment/operations, support/incident, and legal/tax evidence. Do not claim production readiness from this deterministic verification.

## risks

- No DDL, migration, seed/write, historical destructive replay, provider request, secret read, cloud deployment, Docker, browser/device session, or long-lived service was performed.
- No full schema/ledger/restore proof exists; root `DATABASE_URL` was used only in redacted fixture/validation contracts and no value was emitted.
- Deterministic tests, local builds, Expo export, manifests, and static runbooks do not prove live tenant isolation, payment/WhatsApp behavior, delivery execution, tax validity, device behavior, hosted health, or production conformance.
- Test output contains normal experimental/deprecation and schema-format warnings only; no command failed in the bounded rerun.

## skill_resolution

`fallback-path`: loaded `sdd-verify`, `_shared/sdd-phase-common.md`, `references/report-format.md`, and `strict-tdd-verify.md`. Strict TDD was active from the apply contract and its checks were applied. `.codegraph/` existed, but the upstream CodeGraph CLI was unavailable; availability was checked before bounded fallback inspection. No delegation or authorization pause occurred.

## cleanup_state

Complete. No long-lived process, external resource, database, provider, browser/device, Docker, cloud, or deployment runtime remains. The temporary Expo export directory was removed with Windows long-path cleanup. Build/typecheck output is local tooling state; no file other than this verify report was intentionally updated by verification.
