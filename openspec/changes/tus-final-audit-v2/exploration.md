# TUS Final Audit v2

## status

`complete_with_external_evidence_blockers`

## executive_summary

The interrupted prior audit response was a reporting/transport interruption, not a reproduced product failure. The existing artifact was already complete on disk, and this rerun independently reproduced a green deterministic baseline. No source files were modified by this audit.

Current deterministic evidence is green:

- `pnpm test`: **464 passed, 0 failed, 0 skipped** across 87 isolated suites; rerun with a 900-second timeout.
- `pnpm typecheck`: exit `0`; API, web, mobile, contracts/config tasks pass.
- `pnpm build`: exit `0`; API, contracts, config, and web build pass.
- `pnpm lint`: exit `0`; mobile, web, API, and package lint tasks pass.
- `pnpm contracts:validate`: exit `0`; **98 schemas** validated. AJV reports non-blocking ignored `date-time`, `uri`, and `email` formats.
- `pnpm security:scan`: exit `0`; no tracked-secret findings.
- `node scripts/security/validate-policy.mjs`: exit `0`.
- Cloud plan and portability validators: exit `0`; both profiles are plan-only with no cloud calls or live conformance.
- Prisma validation with a synthetic local URL: exit `0`.
- Python compatibility suite: **209 passed**.
- Mobile Jest: **5 suites, 25 tests passed**.
- Expo web export: exit `0`, exported to an approved temporary directory outside the repository.
- Web production HTTP harness: `/`, `/tus`, `/tus/operations`, `/tus/pos`, `/manifest.webmanifest`, and `/icon-192.svg` all returned HTTP `200`.

The repository remains **not production-ready**. PostgreSQL authenticated durability, providers, cloud runtime, browser/device/POS, legal/tax/KYC/KYB, and production-operations evidence remain unavailable or deferred. Activation correctly remains fail-closed for both deployment profiles.

## Current State

The current checked-out implementation has working provider-free API/domain contracts, authenticated local HTTP harnesses, web/PWA surfaces, mobile POS/session flows, encrypted-storage abstractions, and plan-only Render/AWS deployment contracts. The local tests exercise server-derived tenant scope, separate product/service commitments, idempotency/replay/conflict handling, readiness denial, web semantic states, and mobile offline behavior.

The current frontends are buildable and renderable, but two pre-existing mobile configuration inconsistencies remain:

1. `apps/mobile/app.config.ts:30` defaults dev `apiUrl` to `http://localhost:3000`, while `apps/mobile/src/application/tus-auth.ts:97` and `apps/mobile/src/application/tus-client.ts:257` default transports to `http://localhost:3001`. The transports read `EXPO_PUBLIC_API_URL` directly and do not consume `Constants.expoConfig.extra.runtime.apiUrl`.
2. `apps/mobile/app/_layout.tsx:52-53` uses the resolved runtime profile for bootstrap, but `apps/mobile/app/(auth)/login.tsx:23`, `apps/mobile/app/(app)/index.tsx:20`, and `apps/mobile/app/(app)/pos.tsx:52,76` hardcode `profile: 'dev'` for credentials and POS storage. Staging/production builds can therefore use the development namespace.

`pnpm --filter @factory/mobile config:dev` and `config:staging` pass. `config:prod` fails closed because the required production API URL, OAuth issuer/client ID, and Sentry DSN are absent; this is an expected configuration gate, not a regression.

## Affected Areas

- `apps/mobile/app.config.ts` — resolved profile/API defaults and production validation.
- `apps/mobile/src/application/tus-auth.ts` — mobile auth transport default.
- `apps/mobile/src/application/tus-client.ts` — mobile POS transport default.
- `apps/mobile/app/_layout.tsx` — runtime profile bootstrap.
- `apps/mobile/app/(auth)/login.tsx` — hardcoded credential profile.
- `apps/mobile/app/(app)/index.tsx` — hardcoded sign-out credential profile.
- `apps/mobile/app/(app)/pos.tsx` — hardcoded credential and MMKV POS profiles.
- `apps/mobile/src/store/app-store.ts` — runtime persistence profile is corrected after bootstrap, but the initial fallback key remains `alqui:dev`.
- `apps/web/src/app/tus/` and `apps/web/src/lib/` — current dashboard, operations, POS, contract states, and transport; production HTTP harness passed.
- `openspec/changes/*/{tasks.md,apply-progress.md}` — cumulative task/progress artifacts were checked; active TUS task checkboxes are complete, with external evidence explicitly deferred.
- `docs/evidence/readiness/tus-matrix.md` — source-of-truth readiness statement, but its recorded full-suite count (`440`) is stale relative to this rerun (`464`).
- `docs/evidence/native-smoke.md` — historical native-smoke snapshot; its `29/29` and blocked-secret-scan claims are not current and must not override this audit.

## Checks and Classification

| Check | Result | Classification |
|---|---|---|
| Root deterministic tests | 464 passed, 0 failed, 0 skipped | Pass; no current regression reproduced |
| Root typecheck/build/lint | All exit 0 | Pass; existing warnings are non-blocking |
| Contracts/security/policy | Exit 0 | Pass; AJV ignored-format diagnostics are tooling warnings |
| API/web/mobile direct typechecks | Exit 0 | Pass |
| Package-local API/web/mobile `test` scripts | Exit 0 without tests | Pre-existing tooling limitation; scripts are no-ops |
| Mobile Jest and Expo export | 25 tests pass; export pass | Pass for deterministic/mobile-web harness; physical device unavailable |
| Web production HTTP/render harness | Six tested routes/assets HTTP 200 | Pass for local HTTP/render evidence; browser conformance unavailable |
| Python compatibility | 209 passed | Pass; provider-free compatibility evidence |
| Render/AWS cloud-plan and portability checks | Valid, plan-only, no cloud calls | Pass for structural validation; external runtime unavailable |
| PostgreSQL smoke | Five deferred-boundary tests pass; `TUS_POSTGRES_URL` unavailable | Deferred/unavailable external evidence, not product failure |
| `config:prod` | Fails on missing required production values | Expected fail-closed environment/configuration gate |
| Terraform `fmt` | Terraform CLI not installed | Unavailable external/tool evidence; no source failure |
| Static warnings | Next workspace-root/deprecation, React hook dependency, anonymous default exports, Node module-type/punycode warnings | Pre-existing non-blocking tooling warnings |

## SDD Task/Progress Validation

The active TUS artifacts were checked: `tus-platform-vision`, `tus-big-picture-mvp`, `tus-production-completion`, `tus-ui-ux-improvement`, and `tus-final-hardening`. Their task lists report completed implementation slices, and their progress artifacts consistently preserve provider-free evidence boundaries. The artifacts do not prove unavailable external evidence; several contain historical test counts and are evidence history rather than current snapshots. No `sdd-verify`, `sdd-archive`, review lifecycle, or `gentle-ai review` was invoked.

## Why the Prior Report Was Incomplete

The prior response was interrupted while returning its structured result, while the artifact already persisted the report body. The on-disk artifact was readable and internally structured, and the rerun produced exit-zero deterministic checks with no unexplained failures. Therefore the incomplete user-visible result is classified as a reporting/transport interruption. It is not evidence of a test, build, runtime, or product failure.

## External Evidence Boundary

`node scripts/activation/tus-readiness.mjs render-native` and `aws-terraform` both return `not-production-ready`, `unavailable-deferred`, `evidenceClass: deferred`, `liveConformance: false`, and disabled TUS routes/providers/release/fleet actions. Missing blockers include PostgreSQL, cloud, browser, device, legal, tax, KYC, KYB, POS pilot, and production operations. No provider, cloud, credential, or production call was made.

## Risks

1. **Release blocker — external evidence:** Do not activate production until authorized database, provider, cloud, browser/device, POS, compliance, and operations evidence is attached.
2. **High — mobile profile isolation:** Hardcoded `dev` namespaces can cross-contaminate staging/production credentials and offline queues.
3. **Medium — mobile endpoint selection:** The `3000` versus `3001` defaults can route a default dev build to the wrong API endpoint.
4. **Medium — stale evidence documentation:** The readiness matrix and native-smoke document contain historical counts/statuses and should be refreshed before being used as current audit receipts.
5. **Low — test discoverability and warnings:** No-op package test scripts, hook/lint warnings, and missing Terraform CLI reduce confidence but do not block the verified local baseline.

## artifacts

- `openspec/changes/tus-final-audit-v2/exploration.md` — updated audit artifact.
- `openspec/changes/tus-platform-vision/tasks.md` and `apply-progress.md` — checked.
- `openspec/changes/tus-big-picture-mvp/tasks.md` and `apply-progress.md` — checked.
- `openspec/changes/tus-production-completion/tasks.md` and `apply-progress.md` — checked.
- `openspec/changes/tus-ui-ux-improvement/tasks.md` and `apply-progress.md` — checked.
- `openspec/changes/tus-final-hardening/tasks.md` and `apply-progress.md` — checked.
- `docs/evidence/readiness/tus-matrix.md`, `docs/activation-gates.md`, and `docs/evidence/native-smoke.md` — reviewed for evidence truthfulness and stale historical claims.

## next_recommended

1. Create a corrective SDD proposal for one canonical mobile runtime-profile/API endpoint resolver, then add focused profile-isolation and endpoint-resolution tests before editing source.
2. Refresh the readiness matrix/native-smoke evidence receipt with the current `464` result and clearly mark historical counts as superseded; keep all external gates deferred.
3. Decide whether package-local test scripts should invoke the root runner or be removed in favor of an explicit workspace test command.
4. Supply authorized PostgreSQL/provider/cloud/browser/device/POS/compliance/operations evidence and rerun only the applicable gates before any activation claim.

## skill_resolution

- `sdd-explore` — used as the dedicated read-only audit executor and for this OpenSpec artifact.
- `typescript` — relevant to API/web/mobile typecheck and source/config review.
- `react-native` — relevant to mobile runtime, storage, and Expo surface review.
- `frontend-design` / `web-design-guidelines` — relevant to web/mobile UI and render/accessibility evidence; no UI source changes were made.

## Ready for Proposal

**Yes, for a corrective proposal limited to mobile profile/API resolution and evidence-receipt freshness.** The repository is not approved for production activation; external evidence blockers remain explicit.
