# TUS Argentina Stage 1 readiness matrix

**Snapshot date:** 2026-08-30  
**Repository revision:** `764d204480b4bb332e915717fd75ec386a44f0e6` plus the uncommitted PR5 evidence/runbook slice  
**Overall status:** `not-production-ready`  
**Overall evidence boundary:** Local checks prove deterministic behavior only. No row below authorizes a provider, cloud resource, browser/device release, POS pilot, legal operation, or production traffic.

The matrix is the source of truth for the current readiness statement. Every row
identifies the command or artifact, execution environment, revision/date, owner,
scope, status, and exact evidence class. `authorized-external` records are the
only class that can satisfy a live gate, and they must be current, owner-approved,
profile-scoped, and unrevoked. A local result cannot be promoted to that class.

## Evidence taxonomy

| Evidence class | Boundary | What it can prove | What it cannot prove |
| --- | --- | --- | --- |
| `local-deterministic` | Node 22, provider-free local runner and static checks | Repository behavior, contracts, policy, and plan shape | PostgreSQL durability, provider/cloud connectivity, legal approval, browser/device/POS, or production conformance |
| `local-postgresql-http` | Authorized local PostgreSQL HTTP smoke | Durable local HTTP behavior, restart/replay, and tenant isolation when actually run | Managed cloud PostgreSQL, provider, browser/device, POS, legal, or production evidence |
| `authorized-external` | Owner-authorized external smoke for one profile/scope | Only the exact current capability and profile named by the record | Unrelated capabilities, broader launch, or missing gates |
| `deferred` | Missing, unavailable, expired, revoked, malformed, unauthorized, or out-of-scope evidence | The fact that a gate remains blocked and how to rerun it | Any readiness or live-conformance claim |

## Traceable readiness claims

| Readiness claim | Command or artifact | Execution environment | Revision/date | Owner | Scope | Status | Evidence class |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Deterministic full-suite attempt | `pnpm test` — **exit 0; 498 passed, 0 failed, 0 skipped across 88 isolated suites** | Node 22 serial local runner | `764d204` working tree / 2026-08-30 | Validation | Repository provider-free suites | verified locally | `local-deterministic` |
| Contracts and static safety gates | `pnpm contracts:validate` — exit 0; **98 JSON Schema contracts validated**. `pnpm security:scan` — exit 0; no tracked-secret findings. `node scripts/security/validate-policy.mjs` — exit 0 | Local Node 22 toolchain | `764d204` working tree / 2026-08-28 | Contracts and Security | Repository contracts and policy | verified | `local-deterministic` |
| Build and typecheck gates | `pnpm build` — exit 0; 4 Turbo build tasks. `pnpm typecheck` — exit 0; 8 Turbo typecheck tasks | Local serial Turbo workspace | `764d204` working tree / 2026-08-30 | Platform | Workspace packages | verified | `local-deterministic` |
| Lint gate | `pnpm lint` — **exit 1; 3 tasks successful, 1 task blocked** because `@factory/mobile` lints the generated `dist/_expo` bundle outside its TypeScript project; 6 warnings also remain | Local serial Turbo workspace | `764d204` working tree / 2026-08-30 | Platform | Workspace packages | blocked by generated output | `local-deterministic` |
| TUS readiness and activation behavior | `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-tus-runtime-readiness.test.mjs` — **2 suites, 17 passed, 0 failed**; scoped denial, four-class taxonomy, local PostgreSQL non-authorization, conflict, revocation, audit, and job-boundary assertions | Node 22 provider-free in-process harness | `764d204` working tree / 2026-08-29 | TUS Runtime | Argentina Stage 1 deterministic boundary | verified | `local-deterministic` |
| Cloud profile shape | `pnpm exec node scripts/validation/cloud-native/validate-plan.mjs` — exit 0; both profiles valid, plan-only, `provisioned: false`, `cloudCalls: false`, `liveConformance: false` | Local synthetic Render/AWS plan fixtures | `764d204` working tree / 2026-08-28 | Cloud Operations | `render-native`, `aws-terraform` shape | verified | `local-deterministic` |
| PostgreSQL authenticated durability | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` — safety contract passes; live target was not run | Root `.env` `DATABASE_URL` target proof and explicit runtime execution remain unavailable in this snapshot | `764d204` working tree / 2026-08-29 | Data and Runtime | Local PostgreSQL, restart/replay, tenant isolation | deferred | `local-postgresql-http` + `deferred` |
| Mercado Pago and WhatsApp provider evidence | Owner-authorized provider smoke and current scoped records | External provider environments | `764d204` / 2026-08-28 | Provider Operations | Requested TUS provider capabilities only | deferred / disabled | `deferred` |
| AWS/Groq provider and cloud conformance | Current scoped credentials, quota, owner approval, cloud smoke, and rollback evidence | Authorized cloud/provider environment | `764d204` / 2026-08-28 | AI Platform and Cloud Operations | Selected deployment profile only | deferred / disabled | `deferred` |
| PostgreSQL managed service and production data boundary | Authorized managed-service backup, migration, HTTP restart/replay, and recovery evidence | Managed PostgreSQL production-like environment | `764d204` / 2026-08-28 | Data Operations | Exact profile and tenant scope | deferred / disabled | `deferred` |
| Legal, tax, KYC, and KYB approval | Current owner-controlled Argentina operating, invoicing, identity, and merchant records | Legal/Compliance and approved operating environment | `764d204` / 2026-08-28 | Legal, Tax, Trust, and Marketplace Operations | Argentina Stage 1 pilot scope | deferred / disabled | `deferred` |
| Browser and screen-reader conformance | Authorized browser matrix, keyboard/screen-reader, and production-like UI smoke | Supported browser test environment | `764d204` / 2026-08-28 | Web Platform | Declared web profile and viewport matrix | deferred / disabled | `deferred` |
| Physical device and POS pilot | Authorized device matrix, offline/recovery, hardware, operator, receipt, and pilot evidence | Authorized physical-device/POS environment | `764d204` / 2026-08-28 | Mobile and POS Operations | Argentina Stage 1 pilot hardware | deferred / disabled | `deferred` |
| Production operations | On-call, monitoring, incident, rollback, backup/restore, and runbook sign-off | Authorized production-like environment | `764d204` / 2026-08-28 | Operations | Exact deployment profile and pilot scope | deferred / disabled | `deferred` |

## Activation decision

The provider-free commands below are intentionally safe:

```text
node scripts/activation/tus-readiness.mjs render-native
node scripts/activation/tus-readiness.mjs aws-terraform
```

With missing external records, both profiles return `status: not-production-ready`,
`disposition: unavailable-deferred`, `evidenceClass: deferred`, and
`liveConformance: false`. Their composition keeps `tusRoutes: false`,
`providers: false`, `releaseJobs: false`, and `fleetJobs: false`. The commands do
not read credentials, contact providers, provision cloud resources, or turn a
plan, fake, local deterministic check, or local PostgreSQL result into a live
claim. `production-ready` is not a valid output for this snapshot because the
PostgreSQL, provider, cloud, browser, device, legal, tax, KYC/KYB, POS pilot,
and production-operations records are not all current and authorized.

Current blockers are `postgresql:missing`, `cloud:missing`, `browser:missing`,
`device:missing`, `legal:missing`, `tax:missing`, `kyc:missing`, `kyb:missing`,
`posPilot:missing`, and `productionOperations:missing`.

These activation switches remain disabled: `tusRoutes: false`, `providers: false`,
`releaseJobs: false`, and `fleetJobs: false`.

The full repository suite remains a local-deterministic validation attempt, not a
release gate. PR5 focused readiness/activation evidence is independently green,
while all external readiness boundaries remain deferred.

## Argentina-first boundaries and non-goals

This matrix covers only the Argentina-first Stage 1 pilot boundary. Financial
authority remains server-side and append-only; tenant authority remains
tenant-scoped; provider actions, settlement, release jobs, and fleet jobs stay
independently gated. The following scopes remain disabled and out of scope:

`global-launch`, `rentals`, `regulated-healthcare`, `financing-credit`,
`custody-escrow`, `open-driver-bidding`, `mature-dispatch`,
`warehouse-automation`, and `unbounded-ai-authority`.

## Rerun and rollback

Rerun only the affected row with its named command after the owner supplies the
missing scoped evidence. On failure, stop intake, drain or quarantine affected
work, preserve audit/evidence/ledger/outbox/DLQ state, and use append-only
financial compensation. Reverting this matrix changes documentation only; it
does not remove readiness guards, durable records, migrations, contracts, or
provider-disabled defaults.
