# Design: TUS Final Hardening

## Technical Approach

Implement the four now-available specs in dependency order: **P0 validation**, **P1 contracts/versioning**, **P2 canonical runtime guard**, **P3 durable smoke**, and **P4 truthfulness**. Preserve TUS bounded contexts and durable aggregates. Local verification may exercise only a `native-local` execution profile; it never enables provider, cloud, legal, POS-pilot, browser/device, or production gates.

## Requirement Map and Decisions

| Spec requirement | Concrete design/proof |
|---|---|
| Validation: canonical baseline | Update `tests/foundation/{p1-auth-lifecycle,p1-mfa-passkeys-oauth-linking,p4-ai-capability,p4-ai-governance}.test.mjs` to assert validator-reported 98 without removing behavior; `scripts/test-runner-lib.mjs` records unknown failures and reruns. |
| Validation: Node 22 | Remove the parameter property in `apps/api/src/providers/whatsapp/index.ts`; CI and runner use Node 22 and fail on unsupported syntax. |
| Validation: versioned marketplace | `/tus/v1/marketplace/*` is canonical in `apps/web/src/lib/tus-client.ts`; `apps/api/src/tus/http/router.ts` keeps aliases only with parity tests in `p8-tus-marketplace.test.mjs`. |
| Validation: root gates | Add missing workspace/task definitions in `pnpm-workspace.yaml`, `package.json`, `turbo.json`, package scripts, and `.github/workflows/ci.yml`; run test/build/typecheck/lint twice serially. |
| Runtime: all mutation boundaries | `TusReadinessGuard` is injected through `apps/api/src/tus/composition/index.ts` and called by `application/tus-application-service.ts`, `http/router.ts` families `/tus/{checkout,marketplace/*,finance/*,delivery/*,pos/*,whatsapp/*,support/*}`, provider webhooks, `integration/index.ts`, activation, and job transports. |
| Runtime: denial/no effects | Guard returns `409 TUS_READINESS_BLOCKED` before persistence/provider/outbox/job calls; RED tests cover missing, expired, revoked, malformed, conflicting, and foreign-scope evidence plus zero writes. |
| Runtime: scoped audit | Decisions persist capability, profile, tenant/scope, evidence class, policy, actor/job, correlation, reason, and evidence IDs through `apps/api/src/tus/adapters/prisma.ts`. Legacy booleans only reconcile to the stricter decision. |
| Runtime: revocation | `apps/api/src/platform/jobs/adapters/activation-gated.ts`, finance release transport, and `scripts/activation/tus-readiness.mjs` stop intake, drain/quarantine pending work, preserve records, and use compensation. |
| Durable: journey/restart/replay | `scripts/integration/tus-postgres-http-smoke.mjs` and `tests/integration/tus/postgres-http-smoke.test.mjs` use `TUS_POSTGRES_URL`, safe fixtures, authenticated HTTP, restart, same-key replay, audit/outbox counts, and cross-tenant denial. |
| Durable: unavailable boundary | No URL or failed connection emits `deferred` with command/rerun guidance; fake/in-memory runs remain `local-deterministic`. |
| Truthfulness: matrix/taxonomy | Create `docs/evidence/readiness/tus-matrix.md`; update readiness, deployment, recovery, replay, and active TUS SDD artifacts with command, revision/date, owner, scope, status, and one of `local-deterministic`, `local-postgresql-http`, `authorized-external`, or `deferred`. |
| Truthfulness: external gates/non-goals | `scripts/activation/tus-readiness.mjs` rejects unauthorized, expired, revoked, malformed, or out-of-scope records; incomplete PostgreSQL/provider/cloud/browser/device/legal/tax/POS/production evidence forces `not-production-ready`, `deferred`, or disabled output, and Argentina-first exclusions remain listed. |

## Data Flow

```text
HTTP/job → authenticated context → TusReadinessGuard
  → scoped Prisma evidence → evaluate + reconcile → decision/audit
  → allowed bounded-context transaction OR stable denial/no side effect
  → aggregate + idempotency + ledger/audit + outbox
```

## Interfaces / Contracts

```ts
type TusReadinessProfile = 'native-local' | 'render-native' | 'aws-terraform'
interface TusReadinessPort {
  evaluate(input: { tenantId: string; actorId: string; correlationId: string; capability: ReadinessCapability; profile: TusReadinessProfile; scope: string; now: string }): Promise<TusReadinessDecision>
}
interface TusReadinessGuard { require(input: TusCommandContext & { capability: ReadinessCapability; profile: TusReadinessProfile; scope: string }): Promise<TusReadinessDecision> }
```

Extend the readiness contract/schema under `packages/contracts/src/tus.ts` and `packages/contracts/schemas/tus/{readiness-evidence,readiness-decision}.v1.schema.json` with profile and decision attribution. All production-gated effects require `authorized-external`; `native-local` is only a separately labelled non-production smoke policy (`execution: local-verification`, `liveConformance: false`) and cannot activate external capabilities.

## File Changes and Migration

Modify the paths above plus `tests/foundation/{p6-readiness,p6-activation-gates,p8-tus-readiness,p9-readiness}.test.mjs`. Add `apps/api/prisma/migrations/20260828120000_tus_final_hardening_readiness_metadata/migration.sql` and matching `schema.prisma` fields for profile, execution/evidence class, policy, actor/job, correlation, and scope. Backfill old decisions as `legacy-unscoped`/denied; preserve all rows. The prior additive prerequisite remains `20260827090100_tus_canonical_readiness/migration.sql`.

## Testing and Evidence

Unit/contract tests are RED-first and local-deterministic; root checks run twice. PostgreSQL evidence is `local-postgresql-http` only and is separate from `authorized-external`; unavailable external evidence is `deferred`. Live provider/cloud/browser/device/legal/POS/production checks are not run and cannot be inferred from builds, screenshots, fixtures, or PostgreSQL. No activation output may claim production readiness while an applicable external gate is missing.

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior | RED test |
|---|---|---|---|
| HTTP route/version | Applicable | `/tus/v1` canonical; aliases equivalent; unknown version denied. | Client/alias parity. |
| Documentation-like paths | N/A — no executable classification. | No execution. | None. |
| Git selection, commit, push, PR commands | N/A — no VCS/review automation. | No command composition. | None. |

## Rollout / Rollback

Apply the two additive migrations, validate/backfill, shadow-read decisions, then enforce capability-by-capability. On regression disable intake/consumers, quarantine jobs, restore compatibility aliases, preserve evidence/audit/ledger/outbox/idempotency, and append financial compensation; never down-migrate financial history. No blocking design questions remain; the PostgreSQL endpoint is an execution prerequisite only.
