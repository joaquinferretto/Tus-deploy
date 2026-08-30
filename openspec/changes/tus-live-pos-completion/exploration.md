# TUS Live POS Completion — REAL Audit

## status

`partial` — deterministic evidence is green, but the requested authorized PostgreSQL/POS evidence could not run and the current durable POS boundary has implementation gaps.

## executive_summary

The audit covered current TUS source, tests, configurations, web/mobile fronts, activation tooling, and prior OpenSpec artifacts without modifying source files. Local deterministic evidence passes (`pnpm test`: 464/464 across 87 suites; Python compatibility: 211 passed; mobile Jest: 49 passed), while real PostgreSQL evidence is safely deferred because neither `TUS_POSTGRES_URL` nor `DATABASE_URL` is present.

The current PostgreSQL smoke is not yet a complete POS pilot even when configured: it exercises authenticated marketplace discovery/checkout/replay/cross-tenant behavior, but not durable device/session provisioning, POS product/service operations, offline replay/conflict, receipt integrity, delivery handoff, POS audit/outbox, or POS restart recovery. Static inspection also found Prisma POS versioning and transaction-boundary defects that must be corrected before live claims.

## skill_resolution

- `sdd-explore`: loaded from `C:\Users\mmmau\.config\opencode\skills\sdd-explore\SKILL.md`.
- `web-design-guidelines`: loaded from `C:\Users\mmmau\.agents\skills\web-design-guidelines\SKILL.md`; latest rules fetched from the upstream repository before review.
- `frontend-design`: loaded from `C:\Users\mmmau\.agents\skills\frontend-design\SKILL.md`; intent reference reviewed.
- `_shared`: loaded from `C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md` and its OpenSpec/phase references.
- Resolution: `paths-injected` for the requested paths; CodeGraph was checked before filesystem exploration.

## postgres_boundary

| Question | Determination | Exact evidence / consequence |
|---|---|---|
| Were PostgreSQL variables absent? | **Yes.** | `TUS_POSTGRES_URL` and `DATABASE_URL` were both unset in the audit environment. The PostgreSQL smoke therefore reported its configured-run path as deferred; no connection string was available to the runner. |
| Were they unsafe? | **Not assessable as connection targets; no target was used.** | No URL existed to classify as safe or unsafe. Independently, the repository does not prove that a future URL is disposable, and `TUS_POSTGRES_APPLY_MIGRATIONS=1` can apply migrations without an in-harness disposable-boundary proof. That made any write attempt unsafe under the audit constraints. |
| Was PostgreSQL unreachable? | **Not determined and must not be claimed.** | No connection, TCP probe, authentication attempt, migration, or query against an external PostgreSQL server was made. The only Prisma check used a synthetic loopback URL for schema parsing and made no connection. |
| Was PostgreSQL intentionally not used? | **Yes.** | It was intentionally not used because both variables were absent and no authorized disposable/test boundary was established. This was a safety deferral, not evidence of a network outage or a passing live run. |
| Could the POS pilot run? | **No.** | The runner had no authorized database target; even if a URL had been present, the current harness omits POS/delivery scenarios and the Prisma composition requires `fleet` readiness evidence that its fixture does not create. |

## live_evidence

No authorized external/live PostgreSQL, production, provider, settlement, cloud, browser-device, or physical POS evidence was collected. The only live-like result was a locally built Next server returning HTTP 200 for six routes; it is recorded as deterministic/local render evidence below, not production evidence. No production/provider/settlement call was made.

## deterministic_evidence

- `pnpm test`: 87 suites; 464 passed; 0 failed; 0 skipped; exit 0.
- Explicit TUS p9 focused set: 71 passed; 0 failed; 0 skipped; exit 0.
- `python -m pytest -q`: 211 passed in 8.17 seconds.
- `pnpm contracts:validate`: 98 schemas validated; exit 0; AJV ignored `date-time`, `uri`, and `email` formats.
- `pnpm build`: 4 Turbo tasks successful; exit 0.
- `pnpm typecheck`: 8 Turbo tasks successful; exit 0.
- `pnpm lint`: 6 tasks successful; exit 0, with warnings.
- `pnpm run security:scan`: exit 0; no tracked-secret findings.
- `node scripts/security/validate-policy.mjs`: exit 0.
- Cloud plan validation: Render and AWS plans valid with `provisioned:false`, `cloudCalls:false`, and `liveConformance:false`.
- Portability validation passed. Reference parity passed through `node apps/api/node_modules/tsx/dist/cli.mjs scripts/validation/reference-parity.ts` for both plan-only profiles.
- Activation for `render-native` and `aws-terraform`: `not-production-ready`, `unavailable-deferred`, all gated actions disabled, `liveConformance:false`.
- Prisma schema validation passed with a synthetic loopback `DATABASE_URL`; it made no connection or write.
- Mobile Jest: 7 suites; 49 passed.
- Mobile Expo web export passed with `APP_PROFILE=dev` to an approved external temporary directory.
- Local Next HTTP render returned 200 for `/`, `/tus`, `/tus/operations`, `/tus/pos`, `/manifest.webmanifest`, and `/icon-192.svg`.
- In-memory TUS/POS/delivery scenarios passed for device/session, product/service operations, idempotency, conflicts, offline replay, receipt integrity, handoff, tenant denial, audit/outbox assertions, and no-claim provider/settlement states.

## deferred_evidence

- **PostgreSQL HTTP/POS smoke:** the test command passed its 5 orchestration/deferred tests, but no configured smoke ran because both variables were absent. No migration or fixture write was attempted.
- **Durable POS pilot:** deferred because there was no authorized disposable database, the harness does not cover POS/delivery endpoints, and the fixture lacks required `fleet` readiness evidence.
- **Migration/restart/rollback proof:** deferred because it requires a proven disposable PostgreSQL boundary and current Prisma transaction/version defects must be corrected first.
- **Browser/device/accessibility proof:** deferred; local web render and mobile export are not interactive browser, screen-reader, physical-device, or POS-hardware evidence.
- **Cloud/production conformance:** deferred; cloud plans were validated without provisioning and Terraform CLI was unavailable.
- **Security-lint closure:** deferred; API security lint lacks `eslint-plugin-security`, and web security lint fails on generated `next-env.d.ts:3` plus warnings.

## remaining_gaps

1. Add a safe URL resolver supporting the approved `TUS_POSTGRES_URL`/`DATABASE_URL` contract, with explicit disposable/test identity and destructive-operation guards.
2. Expand the real PostgreSQL harness to cover auth/tenant/profile, device/session, product/service POS, offline replay/conflict, receipt integrity, delivery handoff, durable audit/outbox, restart recovery, cleanup, and provider-call non-interaction.
3. Repair Prisma POS version persistence: `getVersion()` currently derives from operation count and `incrementVersion()` returns `0`.
4. Add a transaction boundary covering operation, receipt, version, idempotency, audit, and outbox effects, with failure/restart assertions.
5. Make durable POS/delivery audit and outbox inspection available to the live pilot or provide an equivalent verified read path.
6. Reconcile the `fleet` readiness gate with the live smoke fixture so authorized POS mutations can be tested without weakening fail-closed activation.
7. Apply, restart, roll back, and clean up only inside the proven disposable PostgreSQL boundary; retain append-only audit/outbox evidence.
8. Close API/web security-lint and TypeScript invocation/tooling gaps; install or otherwise validate Terraform formatting in an approved environment.
9. Replace package-local no-op `test` scripts with meaningful package-level test commands or explicitly exclude them from evidence claims.
10. Complete browser, screen-reader, keyboard/focus, responsive/mobile safe-area, physical-device/POS, and profile namespace checks; resolve the legacy `alqui` mobile storage prefixes if the final contract requires `tus` naming.

## Exploration: TUS live POS completion

### Current State

The repository is a large, already-dirty working tree on `feature/tus-mobile-runtime-hardening-pr2`. TUS has a provider-free API/domain implementation, authenticated in-memory HTTP harnesses, Prisma models/migrations, web/PWA surfaces, mobile POS/offline abstractions, and fail-closed activation reports. The audit did not reset, clean, commit, push, or edit source.

The real database boundary is unavailable in this environment:

- `TUS_POSTGRES_URL`: absent.
- `DATABASE_URL`: absent.
- No credential, host credential, or secret value was printed.
- Prisma validation with the real environment therefore failed closed with `P1012 Environment variable not found: DATABASE_URL`.
- A synthetic loopback URL was used only for schema parsing; `prisma validate` passed and made no connection or write.
- No PostgreSQL migration, fixture, cleanup, rollback, provider call, settlement call, cloud call, or production write occurred.

The deterministic local POS path is strong but in-memory. `p8-tus-delivery-pos` and `p9-delivery-pos` cover device/session setup, separate product/service manual operations, idempotency, version conflicts, offline queue/replay, conflict resolution, delivery proof/handoff, receipt integrity, tenant denial, audit/outbox assertions, restart-like client reconstruction, and `not-claimed` settlement/provider states. This evidence is local-deterministic, not PostgreSQL, hardware, browser, or production evidence.

The PostgreSQL harness in `scripts/test-runner-lib.mjs` is narrower than the requested audit. It validates a subset of tables, registers two identities, seeds two listings, exercises discovery, product checkout, restart replay, service checkout, cross-tenant read denial, idempotency conflict, and durable marketplace counts. It does not exercise the POS or delivery endpoints. It also reads only `TUS_POSTGRES_URL`, not `DATABASE_URL`, and `TUS_POSTGRES_APPLY_MIGRATIONS=1` can invoke `prisma migrate deploy` without an explicit disposable-database proof gate.

Static code review found additional durable-boundary blockers:

- `apps/api/src/tus/adapters/delivery-pos.ts`: `PrismaPosStore.getVersion()` derives the version from operation count and `incrementVersion()` always returns `0`; expected-version conflict semantics therefore do not match the in-memory implementation.
- `apps/api/src/tus/pos/index.ts`: POS writes are not coordinated through a transaction port, so operation, receipt, version, idempotency, audit, and outbox effects can be partially committed on failure/restart.
- `apps/api/src/tus/adapters/delivery-pos.ts`: Prisma POS/delivery audit and outbox list methods deliberately throw because inspection is delegated elsewhere; the live POS pilot cannot directly verify those records through the store used by the service.
- `apps/api/src/tus/composition/index.ts`: the Prisma composition uses `native-local`/`argentina-stage-1` readiness and an unavailable Mercado Pago provider. POS mutations require the `fleet` readiness capability, but the current PostgreSQL smoke fixture does not provision authorized fleet evidence, so a real POS pilot would be denied before mutation unless its fixture/evidence contract is expanded.

### Affected Areas

- `apps/api/src/tus/pos/index.ts` — POS lifecycle, receipt hash, version/conflict, audit/outbox policy.
- `apps/api/src/tus/adapters/delivery-pos.ts` — Prisma POS/delivery persistence and durable version/list semantics.
- `apps/api/src/tus/composition/index.ts` — in-memory versus Prisma composition and readiness/provider boundaries.
- `apps/api/src/tus/http/router.ts` — authenticated device/session/POS/delivery routes.
- `apps/api/src/tus/integration/index.ts` and `apps/api/src/providers/` — provider webhooks and fail-closed/no-call behavior.
- `scripts/test-runner-lib.mjs` — PostgreSQL URL resolution, migration safety, fixture lifecycle, HTTP smoke coverage, cleanup.
- `tests/integration/tus/postgres-http-smoke.test.mjs` — currently tests deferred/configured smoke orchestration, not a complete POS pilot.
- `tests/foundation/p8-tus-delivery-pos.test.mjs` and `tests/foundation/p9-delivery-pos.test.mjs` — current deterministic delivery/POS safety net.
- `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/20260826130000_tus_delivery_pos/` — durable schema and additive migration that still need real applied/restart evidence.
- `apps/web/src/app/tus/` and `apps/web/src/lib/` — authenticated marketplace, operations, and web POS surfaces.
- `apps/mobile/app/(app)/pos.tsx`, `apps/mobile/src/application/tus-client.ts`, and `apps/mobile/src/core/config/` — mobile POS, encrypted queue, replay/conflict UX, and profile identity.
- `scripts/activation/tus-readiness.mjs`, `docs/activation-gates.md`, and `docs/evidence/readiness/` — fail-closed activation and evidence claims.
- `openspec/changes/tus-platform-vision/`, `tus-big-picture-mvp/`, `tus-production-completion/`, `tus-ui-ux-improvement/`, `tus-final-hardening/`, `tus-final-audit/`, and `tus-final-audit-v2/` — prior scope, completion, and evidence history; current command results supersede historical counts.

### Live Evidence

| Boundary | Exact result | Classification |
|---|---|---|
| Full JavaScript deterministic tests | `pnpm test` — 87 suites, 464 tests, 464 passed, 0 failed, 0 skipped, exit 0 | Pass; local/provider-free only |
| TUS/activation focused suites | Explicit p9 set — 71 tests passed, 0 failed, 0 skipped, exit 0 | Pass; in-memory/local HTTP and contract evidence |
| Python compatibility | `python -m pytest -q` — 211 passed in 8.17s | Pass; compatibility only |
| Contracts | `pnpm contracts:validate` — 98 schemas validated, exit 0 | Pass; AJV ignored `date-time`, `uri`, and `email` format warnings remain |
| Build | `pnpm build` — 4 Turbo tasks successful, exit 0 | Pass; Next workspace-root warning and ESLint warnings remain |
| Typecheck | `pnpm typecheck` — 8 Turbo tasks successful, exit 0 | Pass |
| Root lint | `pnpm lint` — 6 tasks successful, exit 0 | Pass with mobile/web warnings |
| Root security | `pnpm run security:scan` — exit 0, no tracked-secret findings | Pass |
| Policy | `node scripts/security/validate-policy.mjs` — exit 0 | Pass |
| Cloud plan | `node scripts/validation/cloud-native/validate-plan.mjs` — Render/AWS valid, `provisioned:false`, `cloudCalls:false`, `liveConformance:false` | Pass; plan-only |
| Portability/reference parity | Portability validator passed; `node apps/api/node_modules/tsx/dist/cli.mjs scripts/validation/reference-parity.ts` passed with both cloud profiles plan-only | Pass; direct `.ts` invocation fails due ESM extensionless import resolution and is a tooling invocation gap |
| Activation | `node scripts/activation/tus-readiness.mjs render-native` and `aws-terraform` — `not-production-ready`, `unavailable-deferred`, all gated actions disabled, `liveConformance:false` | Correct fail-closed result |
| Prisma | Synthetic loopback `DATABASE_URL` + `prisma validate` passed; real environment validation failed closed because `DATABASE_URL` is absent | Schema pass; live migration/apply deferred |
| Terraform | `terraform fmt -check -recursive infra/terraform` — CLI not installed | Unavailable tool evidence; no cloud action |
| Mobile Jest | `pnpm --filter @factory/mobile exec jest --runInBand` — 7 suites, 49 tests passed | Pass; no physical device |
| Mobile web export | `APP_PROFILE=dev ... expo export --platform web` — bundle exported successfully to approved temp path outside repo | Pass; dev profile only |
| Web HTTP/render | Built Next server returned HTTP 200 for `/`, `/tus`, `/tus/operations`, `/tus/pos`, `/manifest.webmanifest`, `/icon-192.svg` | Pass for local HTTP/render; wrapper timed out during child cleanup, and browser/assistive conformance remains untested |
| Local HTTP TUS/POS | `p9-delivery-pos` and `p8-tus-delivery-pos` scenarios passed, including no settlement/provider claims | Pass; in-memory/local deterministic, not PostgreSQL |
| PostgreSQL HTTP smoke | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` — 5/5 orchestration/deferred tests passed; no configured smoke ran | Deferred; no authorized URL |
| Provider/settlement calls | No Mercado Pago, WhatsApp, AWS, Render, settlement, payout, or production calls made | Safe no-call boundary |

Package-local `api`, `web`, and `mobile` `test` scripts all exit 0 but are no-ops (`node -e "process.exit(0)"`); they are not test evidence. API security lint fails because `eslint-plugin-security` is missing. Web security lint fails on generated `next-env.d.ts:3` plus nine warnings. These are validation/tooling gaps, not silently promoted passes.

### Web Interface Guidelines / UI Review

The latest upstream guideline review found no new fatal accessibility pattern in the inspected TUS web surfaces: semantic links/buttons, labels, `aria-live`/alert states, skip links, visible `:focus-visible`, reduced-motion handling, `touch-action`, safe-area padding, `Intl` currency usage, long-content wrapping, and URL-backed surface links are present. The visual system also satisfies the loaded frontend intent better than a generic SaaS shell: named earthy palette, serif/display pairing, asymmetry, texture/noise, and explicit motion policy.

Remaining UI/UX evidence gaps are still material: no real browser interaction/session flow was completed, no screen-reader audit was run, no physical mobile/POS device pilot was run, and mobile retains legacy `alqui` storage/key prefixes in `apps/mobile/src/store/app-store.ts`, `src/core/services/mmkv-storage.ts`, `src/core/services/query-client.ts`, and `src/application/tus-client.ts`. These belong in the final UI/UX phase, not in the durable backend correction.

### Approaches

1. **Correction 1 — durable live POS boundary** — Repair the Prisma POS/delivery semantics, add a safe URL resolver (`TUS_POSTGRES_URL` then `DATABASE_URL`), prove a disposable/test boundary before any migration or fixture write, and expand the real HTTP smoke to cover authenticated tenant/profile, device/session, product/service POS, offline queue/replay/conflict, receipt integrity, delivery handoff, audit/outbox, restart/recovery, cleanup, and provider-call spies.
   - Pros: closes the highest-risk correctness and safety boundary before any activation claim.
   - Cons: requires transactional adapter redesign and a disposable PostgreSQL resource.
   - Effort: High

2. **Correction 2 — validation and activation evidence** — Reconcile readiness/fleet fixture semantics with the live harness, repair security-lint/tool invocation gaps, validate/apply/rollback migrations only inside the proven disposable boundary, refresh stale evidence documents and SDD claims, and preserve provider/settlement disablement.
   - Pros: makes the evidence chain auditable and prevents deterministic/local output from being misread as production proof.
   - Cons: external evidence owners and Terraform tooling remain environmental dependencies.
   - Effort: Medium/High

3. **Final UI/UX phase — browser/device completion** — After the two corrections, run browser and physical-device POS journeys, screen-reader/focus/keyboard checks, responsive/mobile safe-area checks, profile namespace isolation checks, and the latest Web Interface Guidelines review; keep every pending/deferred/provider state truthful.
   - Pros: validates the actual staff/customer experience rather than only component contracts.
   - Cons: needs browser/device/hardware access and a stable authenticated test environment.
   - Effort: Medium

### Recommendation

Do not activate TUS or claim live POS completion. Proceed with exactly the two correction SDD phases above, in order, followed by the final UI/UX phase. The first correction must treat the current Prisma adapter and smoke harness as untrusted for durable POS claims; the second must refresh evidence and keep activation fail-closed; only then should browser/device UX evidence be collected.

## risks

- **BLOCKER — no authorized database boundary:** both PostgreSQL environment variables are absent, so no live database write, migration, cleanup, rollback, or restart evidence was safe to attempt.
- **BLOCKER — smoke scope mismatch:** the configured PostgreSQL harness does not implement the requested POS/delivery pilot scenarios.
- **BLOCKER — durable POS correctness:** Prisma version increments and transaction semantics do not match the tested in-memory behavior.
- **HIGH — migration safety:** optional migration deployment is controlled by an environment flag but lacks a disposable-boundary proof in the harness itself.
- **HIGH — readiness mismatch:** live Prisma POS requires fleet readiness evidence that the current fixture does not create.
- **MEDIUM — validation/tooling:** Terraform is unavailable; API security lint lacks its plugin; web security lint includes a generated-file error; package test scripts are no-ops; direct TypeScript parity invocation is invalid.
- **MEDIUM — UI evidence:** local HTTP/export and deterministic tests are not browser, screen-reader, physical-device, or POS-hardware proof.
- **MEDIUM — repository hygiene:** the checkout contains extensive pre-existing modifications, deletions, and untracked files; no unrelated cleanup was attempted.
- **LOW — warnings:** AJV ignored formats, Next workspace-root/deprecation, React hook dependency, anonymous default-export, and Node module-type warnings remain non-blocking but should be tracked.

### Cleanup / Rollback

No PostgreSQL or production cleanup was required because no live connection or write was attempted. The mobile export was written only to the approved external temporary directory. The local web process served the six requested routes and no longer held the test port after the wrapper timeout. Any future live run must use unique tenant/fixture IDs, explicit transaction rollback plus targeted cleanup, preserve audit/outbox evidence until verification, and never perform destructive financial rollback; activation rollback must stop intake, drain/quarantine work, preserve ledger/audit/outbox/DLQ, and use append-only compensation.

### Ready for Proposal

Yes — for the exactly three-phase sequence above: two corrective SDD phases followed by the final UI/UX phase. The repository is not approved for production or live POS completion until the first correction produces real disposable PostgreSQL evidence and the second reconciles its activation/evidence record.

## artifacts

- `openspec/changes/tus-live-pos-completion/exploration.md` — this current REAL audit and correction plan.
- `tests/integration/tus/postgres-http-smoke.test.mjs` and `scripts/test-runner-lib.mjs` — reviewed live-boundary orchestration and limitations.
- `tests/foundation/p8-tus-delivery-pos.test.mjs` and `tests/foundation/p9-delivery-pos.test.mjs` — reviewed deterministic POS/delivery coverage.
- `apps/api/src/tus/pos/index.ts`, `apps/api/src/tus/adapters/delivery-pos.ts`, `apps/api/src/tus/composition/index.ts` — reviewed durable implementation boundaries.
- Prior OpenSpec TUS artifacts and current activation/readiness evidence — reviewed; no prior artifact was overwritten.

## next_recommended

1. `sdd-correction-1-durable-live-pos-boundary` — durable Prisma POS/delivery semantics, safe PostgreSQL resolver/disposable guard, and complete real smoke/pilot.
2. `sdd-correction-2-validation-activation-evidence` — readiness/fixture reconciliation, migration/tooling validation, and truthful evidence refresh.
3. `sdd-final-ui-ux` — browser/device/accessibility/responsive POS completion after the two corrections.
