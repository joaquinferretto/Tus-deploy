# TUS Final Product Audit

## status

`complete_with_current_regressions_and_deferred_external_evidence`

## executive_summary

The current TUS product and the three requested SDD changes were audited read-only after `tus-live-runtime-correction`, `tus-product-closure`, and `tus-final-ui-ux`. No source, configuration, migration, or existing SDD artifact was modified by this audit. The only filesystem artifact created is this report.

The deterministic baseline is **not green**: `pnpm test` completed with **497 tests, 495 passed, 2 failed, 0 skipped across 87 isolated suites**. The failures are:

1. **Pre-existing finance mismatch:** `tests/foundation/p8-tus-finance.test.mjs:153` expects `completion_evidence_required`, while the current implementation returns `completion_confirmation_required`.
2. **Current UI/UX regression:** `tests/foundation/tus-ui-ux-improvement.test.mjs:147` expects a disabled typed button in the operations surface, but `apps/web/src/app/tus/tus-operations.tsx` only supplies `type="button"` through the shared `TusActionButton` call and does not expose the expected disabled action in that source contract.

The safe PostgreSQL boundary is **deferred**. Both approved environment variables were absent (`TUS_POSTGRES_URL=absent`, `DATABASE_URL=absent`); no connection, migration, query, fixture write, cleanup, or POS pilot was attempted. No provider, cloud, production, browser, device, legal, tax, KYC, KYB, or production-operations evidence was collected. Both activation profiles correctly remain fail-closed.

**Verdict: not production-ready.** The product has substantial provider-free deterministic coverage, but the two current test failures, an unauthenticated `/tus` server-render loading response without the main-landmark marker, and all deferred external gates prevent a production-readiness claim.

## Scope and safety boundary

- Repository: `C:\Users\mmmau\tuscompras-b2b\Goldenrepo-js-py`.
- Structural audit started with CodeGraph as required: index reported 629 files, 10,380 nodes, 30,281 edges; 26 modified and 4 added files were pending index sync. `codegraph explore` traced TUS dashboard/auth, checkout, POS, support, and runtime boundaries. No sync was run during this read-only audit.
- PostgreSQL resolution used only the approved names and did not inspect `.env` or print values.
- Existing PostgreSQL environment status: `TUS_POSTGRES_URL=absent`; `DATABASE_URL=absent`.
- A synthetic loopback URL was used only for Prisma schema parsing. It was not an existing target and no connection was made.
- No `gentle-ai review`, review lifecycle, `sdd-verify`, or `sdd-archive` command was invoked.

## Commands and exact results

### Deterministic and focused tests

| Command | Result | Evidence class | Classification |
|---|---|---|---|
| `pnpm test` | Exit 1; 87 suites; 497 tests; 495 passed; 2 failed; 0 skipped. Failures: `p8-tus-finance.test.mjs` and `tus-ui-ux-improvement.test.mjs`. | `local-deterministic` | Current regression set; finance failure is pre-existing, UI failure is current final-UI evidence regression. |
| Explicit focused TUS/POS/UI runner over the 23 `p8-*`, `p9-*`, and `tus-*.test.mjs` suites: `& node scripts/test-runner.mjs $files` | Exit 1; 173 tests; 171 passed; 2 failed; 0 skipped. Same two failures. | `local-deterministic` | Confirms failures are isolated to the focused product paths. |
| `pnpm --filter @factory/mobile exec jest --runInBand` | 7 suites; 56 tests passed; 0 failed. | `local-deterministic` | Pass; no physical-device evidence. |
| `pnpm --filter @factory/mobile exec jest tests/unit/tus-pos.test.ts tests/unit/tus-accessibility.test.tsx --runInBand --forceExit` | 2 suites; 27 tests passed; 0 failed. | `local-deterministic` | Pass for mobile POS/recovery/accessibility unit coverage. |
| `python -m pytest -q` | 211 passed in 11.05s. | `local-deterministic` | Pass for Python compatibility coverage. |
| `pnpm --filter @factory/api test`, `pnpm --filter @factory/web test`, `pnpm --filter @factory/mobile test` | All exit 0, but each package script is `node -e "process.exit(0)"`; these are no-op scripts, not product test evidence. | `local-deterministic` | Tooling limitation. |

The focused product suites cover server-derived auth/tenant authority, merchant/catalog discovery, product and service checkout, finance freezes/ledger/compensation, delivery proof/handoff, POS device/session/receipts, offline replay/conflict, support/WhatsApp, reporting/SEO, mobile recovery, accessibility, responsive/PWA claims, and activation denial. All those focused paths pass except the two failures listed above.

### Typecheck, build, contracts, schema, policy, security, and cloud

| Command | Result | Evidence class | Classification |
|---|---|---|---|
| `pnpm typecheck` | Exit 0; 8 Turbo tasks successful. API, web, mobile, contracts, and config typechecks passed. | `local-deterministic` | Pass. |
| `pnpm build` | Exit 0; 4 Turbo tasks successful. API Prisma generation/API build and Next production build passed; web emitted 14 routes. | `local-deterministic` | Pass with existing Next workspace-root and anonymous-default-export warnings. |
| `pnpm contracts:validate` | Exit 0; 98 JSON Schema contracts validated. AJV ignored `date-time`, `uri`, and `email` formats. | `local-deterministic` | Pass with non-blocking validator warnings. |
| `pnpm security:scan` | Exit 0; no tracked-secret findings. | `local-deterministic` | Pass. |
| `node scripts/security/validate-policy.mjs` | Exit 0. | `local-deterministic` | Pass. |
| `node scripts/validation/cloud-native/validate-plan.mjs` | Exit 0; Render and AWS profiles valid, `provisioned:false`, `cloudCalls:false`, `liveConformance:false`. | `local-deterministic` | Plan shape only; cloud evidence deferred. |
| `node scripts/validation/portability/index.mjs` | Exit 0; portability, contamination, and profile parity checks passed; no cloud calls. | `local-deterministic` | Pass for structural portability only. |
| `node apps/api/node_modules/tsx/dist/cli.mjs scripts/validation/reference-parity.ts` | Exit 0; API/web/mobile neutral-reference clients and Python runtime scenarios passed; `liveConformance:false`. | `local-deterministic` | Pass for local reference parity only. |
| `terraform fmt -check -recursive infra/terraform` | Not run successfully: `terraform` executable is not installed. | `deferred` | Environment/tooling limitation; no cloud action. |
| `pnpm --filter @factory/api exec prisma validate` with synthetic loopback `DATABASE_URL` | Exit 0; Prisma schema valid. | `local-deterministic` | Schema parse only; no database connection or write. |
| `pnpm --filter @factory/api lint:security` | Exit 2; `eslint-plugin-security` is missing. | `deferred` | Environment/tooling limitation. |
| `pnpm --filter @factory/web lint:security` | Exit 1; generated `next-env.d.ts:3` triple-slash rule error plus 9 warnings. | `local-deterministic` | Tooling/generated-file limitation. |
| `pnpm --filter @factory/mobile run secure` | Exit 1 at `npm audit`: `ENOLOCK`, because no npm lockfile exists; TruffleHog/Semgrep stages were not reached. | `deferred` | Environment/tooling limitation. |
| `pnpm lint` | Exit 1 because generated `apps/mobile/dist/_expo/...js` is included and ESLint cannot find it in the configured TypeScript project; six source warnings remain. | `local-deterministic` | Generated-artifact/tooling regression in the root lint boundary; package lint with `--ignore-pattern dist` has 0 errors and 6 warnings. |

### PostgreSQL, activation, profiles, and local harnesses

| Command | Result | Evidence class | Classification |
|---|---|---|---|
| `TUS_POSTGRES_URL`/`DATABASE_URL` presence probe | Both absent; values were not printed. | `deferred` | Environment evidence unavailable. |
| `node scripts/test-runner.mjs tests/integration/tus/postgres-http-smoke.test.mjs` | Exit 0; 20 deferred-boundary tests passed; no target, connection, migration, query, fixture, cleanup, or provider action. | `deferred` | Correct fail-closed no-target behavior, not a live pilot. |
| `node scripts/activation/tus-readiness.mjs render-native` | Exit 0; `not-production-ready`, `unavailable-deferred`, `evidenceClass: deferred`, `liveConformance:false`; PostgreSQL/cloud/browser/device/legal/tax/KYC/KYB/POS/operations blockers listed; TUS routes/providers/release/fleet jobs disabled. | `deferred` | Correct fail-closed activation. |
| `node scripts/activation/tus-readiness.mjs aws-terraform` | Same fail-closed result as Render; plan-only and no cloud calls. | `deferred` | Correct fail-closed activation. |
| `pnpm --filter @factory/mobile config:dev` | Exit 0; dev profile resolves to `http://localhost:3001`, mock auth enabled, TLS disabled. | `local-deterministic` | Pass. |
| `pnpm --filter @factory/mobile config:staging` | Exit 0; staging profile resolves to HTTPS URL, strict TLS enabled, mock auth disabled. | `local-deterministic` | Pass. |
| `pnpm --filter @factory/mobile config:prod` | Fails closed with `apiUrl must be a valid absolute URL` because required production API/OAuth/Sentry values are absent. | `deferred` | Expected production configuration gate, not a runtime regression. |
| `APP_PROFILE=dev pnpm --dir apps/mobile exec expo export --platform web --output-dir C:\Users\mmmau\AppData\Local\Temp\opencode\tus-final-audit-mobile` | Exit 0; Metro bundled 777 modules and exported `index.html`/metadata to the approved external temporary directory. | `local-deterministic` | Pass for export; no physical-device/PWA-install proof. |
| Local Next server (`next start -p 3100` from `apps/web`) and HTTP requests to `/`, `/tus`, `/tus/operations`, `/tus/pos`, `/recovery`, `/sign-in`, `/manifest.webmanifest`, `/robots.txt`, `/sitemap.xml`, `/icon-192.svg` | All returned HTTP 200. Content types were HTML, manifest JSON, text/plain, XML, and SVG as appropriate. Main-landmark marker was present for every tested HTML route except `/tus`. | `local-deterministic` | Current render finding: unauthenticated `/tus` server-loading output is HTTP-successful but lacks `tus-main-content`; browser/assistive conformance remains deferred. |

The web server’s `/tus` result is explained by `TusDashboard` returning only `TusStateMessage` while `session === undefined`; its authenticated and unauthenticated settled branches render the main landmark. This is a real initial-render accessibility/semantic gap, not evidence of PostgreSQL or network failure.

## Current product-path audit

- **Auth and tenant:** server-derived session, actor, tenant, permissions, spoofing denial, foreign-tenant denial, session expiry, and restore paths are covered by passing p9 identity and UI/mobile suites.
- **Merchant/catalog and customer checkout:** product/service separation, availability/stock, idempotency, replay, and authenticated discovery/checkout paths are covered by passing p8/p9 marketplace and UI suites.
- **Finance:** p9 finance freeze/ledger/compensation/provider-denial paths pass. The older p8 finance expectation mismatch remains a deterministic failure and must be reconciled before claiming a green repository baseline.
- **Delivery/POS/offline/replay:** p8/p9 POS and delivery suites plus 27 focused mobile POS/accessibility tests pass locally. This is provider-free/in-memory or deterministic client evidence, not durable PostgreSQL, hardware, or field-pilot evidence.
- **Support/WhatsApp/reporting/SEO:** p9 support/operations and UI journey/idempotency suites pass; support remains governed and provider-free; local robots/sitemap/manifest routes render correctly.
- **Mobile runtime profiles:** dev and staging resolve deterministically; production correctly fails closed without required values. Export and Jest pass. Physical Android/iOS, secure storage on device, safe-area interaction, screen readers, offline radio transitions, and POS hardware remain untested.
- **Accessibility/responsive/PWA:** deterministic semantic/focus/reduced-motion/long-content tests mostly pass, but the operations UI contract failure and `/tus` loading landmark gap remain. The manifest explicitly does not claim a service worker or offline web operation.
- **Activation:** both profiles remain disabled-by-default with `liveConformance:false`; no production, provider, settlement, or POS-pilot authorization is inferred.

## SDD artifact audit

The three requested change folders were inspected, including proposal, design, specs, tasks, apply-progress, and evidence references:

| Change | Specs | Task state | Artifact observations |
|---|---:|---|---|
| `tus-live-runtime-correction` | 3 | Tasks complete; apply-progress records PR1–PR3 complete | Its recorded `467/467` full-suite result is stale. The authorized PostgreSQL prerequisite remains intentionally unchecked/deferred. |
| `tus-product-closure` | 3 | 6/6 tasks complete; `liveConformance:false` | Its apply-progress correctly records the historical p8 finance mismatch, but its command counts are stale against the current 497-test run. |
| `tus-final-ui-ux` | 6 | 10/10 tasks complete | Its prior focused/full evidence claims green or timed-out historical runs; current focused UI evidence now fails. Its design retains an unchecked public-origin/support confirmation even though deterministic route tests pass. |

Across these folders, unchecked checklist items are acceptance/prerequisite items in proposal/design documents, not proof that the implementation task lists are incomplete. The authoritative current audit result is this report; historical `apply-progress.md`, `docs/evidence/readiness/tus-matrix.md`, and `docs/evidence/native-smoke.md` counts must not override the commands above.

## Remaining issues and classification

### Regression

1. `tests/foundation/tus-ui-ux-improvement.test.mjs:147` fails against the current operations surface. The final UI/UX artifact previously recorded the corresponding focused suite as green; current source/test behavior is therefore classified as a regression or unresolved final-UI contract mismatch.
2. The unauthenticated server-loading render of `/tus` lacks the `tus-main-content` landmark. This was observed in the current local render harness and is an accessibility/semantic regression candidate requiring a focused test.

### Pre-existing

1. `tests/foundation/p8-tus-finance.test.mjs:153` expects `completion_evidence_required`, while current finance implementation and newer p9 tests use `completion_confirmation_required`. Existing readiness/native-smoke and closure artifacts already recorded this mismatch before the final UI/UX phase.

### Environment or tooling

1. Root lint includes generated Expo `dist` output; API security lint lacks `eslint-plugin-security`; web security lint rejects generated `next-env.d.ts`; mobile `secure` cannot start without an npm lockfile; Terraform CLI is absent.
2. Production mobile configuration is intentionally unavailable without required production API/OAuth/Sentry values and therefore fails closed.
3. Package-local test scripts are no-ops and cannot be used as package test evidence.

### External evidence

1. PostgreSQL authenticated durability, migration application, restart/replay against a real database, and POS pilot are deferred because no approved disposable target exists.
2. Provider/settlement evidence (Mercado Pago, WhatsApp), cloud runtime conformance (Render/AWS/Groq), browser/screen-reader conformance, physical mobile/POS device evidence, legal/tax/KYC/KYB approval, and production operations evidence are unavailable.

## Verdict

TUS is **not production-ready**. The codebase demonstrates broad, useful provider-free local behavior and correctly prevents unsafe activation, but production readiness requires both deterministic failures to be resolved or explicitly reconciled, the initial `/tus` landmark gap to be addressed, and all external evidence gates to be supplied by authorized owners. No local HTTP 200, static export, Prisma schema parse, cloud plan, or deterministic test may be promoted to live or production evidence.

## artifacts

- `openspec/changes/tus-final-product-audit/exploration.md` — this current read-only audit.
- `openspec/changes/tus-live-runtime-correction/{proposal.md,design.md,tasks.md,apply-progress.md,specs/}` — audited runtime correction intent, implementation evidence, and deferred PostgreSQL boundary.
- `openspec/changes/tus-product-closure/{proposal.md,design.md,tasks.md,apply-progress.md,specs/}` — audited POS/operations closure and activation evidence.
- `openspec/changes/tus-final-ui-ux/{proposal.md,design.md,tasks.md,apply-progress.md,specs/}` — audited UI/UX completion claims and current regression.
- `tests/foundation/p8-tus-finance.test.mjs` — pre-existing finance mismatch.
- `tests/foundation/tus-ui-ux-improvement.test.mjs` — current UI/UX failure.
- `apps/web/src/app/tus/tus-dashboard.tsx` and `apps/web/src/app/tus/tus-operations.tsx` — current render/interaction boundaries.
- `docs/evidence/readiness/tus-matrix.md` and `docs/evidence/native-smoke.md` — reviewed historical evidence records; current command output supersedes their stale counts.

## next_recommended

1. Reconcile the finance reason contract and update its focused test/evidence without weakening the finance freeze semantics.
2. Correct or formally revise the operations UI contract and add a deterministic initial-loading landmark test for `/tus`.
3. Refresh readiness/native-smoke/apply-progress evidence with the current 497/495/2 result and current lint/render findings.
4. Install/validate the missing security and Terraform tooling in an approved environment, while keeping generated outputs excluded from source lint.
5. Supply authorized disposable PostgreSQL, provider/cloud, browser/device/POS, compliance, and production-operations evidence; rerun only the applicable gates before any activation decision.

## risks

- **BLOCKER — deterministic regressions:** the full and focused TUS/POS/UI suites are not green.
- **BLOCKER — external evidence:** PostgreSQL, provider, cloud, browser/device/POS, compliance, and production-operations gates remain unavailable.
- **HIGH — initial accessibility:** `/tus` can server-render a loading state without the main landmark before authentication resolves.
- **MEDIUM — evidence drift:** several SDD/evidence receipts contain historical counts and should not be treated as current proof.
- **MEDIUM — validation tooling:** root lint and package security checks have generated-file/missing-tool failures.
- **LOW — warnings:** AJV ignored formats, Next workspace-root/deprecation warnings, anonymous default exports, and React hook warnings remain non-blocking after the deterministic failures are addressed.

## skill_resolution

- `sdd-explore` — loaded for the read-only named-change exploration and artifact contract.
- `_shared` / OpenSpec conventions — applied to the hybrid project’s existing OpenSpec layout.
- CodeGraph — used before broad filesystem exploration for current TUS route/call-flow impact.
- No implementation, review lifecycle, `sdd-verify`, or `sdd-archive` skill phase was invoked.

## Ready for Proposal

**Yes, for a corrective proposal limited to the current UI/UX contract/loading-landmark failures, finance reason-contract reconciliation, evidence refresh, and separately authorized external validation. No production activation is approved.**
