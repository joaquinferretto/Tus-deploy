# Tasks: TUS Production Completion

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 2,500–5,000 authored lines across 10 slices |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PRs 1–10, one autonomous capability slice each |
| Delivery strategy | auto-chain (automatic; force-chained) |
| Chain strategy | feature-branch-chain; PR #1 bases feature tracker, each next PR bases its immediate parent |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High
Configured review budget: 99999

Non-goals: global launch, rentals, regulated healthcare, financing, custody/escrow, open driver bidding, mature dispatch, warehouse automation, and unbounded AI authority. Local proof never substitutes for legal/provider/cloud/POS/pilot evidence.

### Suggested Work Units

| Unit / PR | RED → GREEN → REFACTOR; exact paths | Focused test / runtime harness; evidence | Migration / rollback boundary |
|---|---|---|---|
| 1.1 / PR1 | `tests/foundation/p9-validation-baseline.test.mjs`, `tests/integration/tus/postgres-http-smoke.test.mjs` → `scripts/test-runner.mjs`, `docs/evidence/readiness/validation-baseline.md` → isolate serial reruns | `pnpm test -- tests/foundation/p9-validation-baseline.test.mjs`; classify 19 failures as `local-deterministic`; PostgreSQL smoke is separate/deferred | Runner/report/test/docs only; no data migration; remove baseline gate/report |
| 1.2 / PR2 | `tests/foundation/p9-readiness.test.mjs` → `packages/contracts/src/tus.ts`, `apps/api/src/tus/readiness/index.ts`, `apps/api/src/tus/domain/readiness.ts` → contract helpers | `pnpm test -- tests/foundation/p9-readiness.test.mjs`; deterministic missing/expired/revoked/conflict gates; live evidence `deferred` | `apps/api/prisma/migrations/20260827090100_tus_canonical_readiness/migration.sql`; disable gates, preserve evidence/audit |
| 1.3 / PR3 | `tests/foundation/p9-identity-http.test.mjs` → `apps/api/src/auth-security/`, `apps/api/src/tenancy/`, `apps/api/src/tus/http/router.ts`, `apps/api/prisma/seed.ts` → server-derived context | `pnpm test -- tests/foundation/p9-identity-http.test.mjs`; local HTTP signup/restart/spoof denial; external identity evidence `deferred` | `apps/api/prisma/migrations/20260827090200_tus_identity_tenant/migration.sql`; expand/backfill/verify, disable routes, preserve sessions |
| 1.4 / PR4 | `tests/foundation/p9-marketplace.test.mjs` → `apps/api/src/tus/catalog/`, `apps/api/src/tus/http/router.ts`, `packages/contracts/schemas/tus/` → separate stock/slots | `pnpm test -- tests/foundation/p9-marketplace.test.mjs`; local HTTP onboarding/publish/product+service checkout; legal/KYB `deferred` | `apps/api/prisma/migrations/20260827090300_tus_marketplace/migration.sql`; unpublish listings only, preserve commitments/audit |
| 2.1 / PR5 | `tests/foundation/p9-commitments.test.mjs` → `apps/api/src/tus/application/`, `apps/api/src/tus/commitments/`, `apps/api/src/tus/adapters/prisma.ts`, `apps/workflow-runtime-python/src/worker/run_ledger/` → atomic lifecycle | `pnpm test -- tests/foundation/p9-commitments.test.mjs`; local PostgreSQL restart/replay/rollback; no external claim | `apps/api/prisma/migrations/20260827090400_tus_commitments/migration.sql`; drain/quarantine consumers, append compensation |
| 2.2 / PR6 | `tests/foundation/p9-finance.test.mjs` → `apps/api/src/tus/finance/`, `apps/api/src/providers/mercado-pago/` → immutable snapshots/ledger | `pnpm test -- tests/foundation/p9-finance.test.mjs`; local freeze/refund/reconciliation; Mercado Pago/legal/tax/payout evidence `authorized-external` or deferred | `apps/api/prisma/migrations/20260827090500_tus_finance/migration.sql`; disable release/payout, never rewrite ledger or down-migrate destructively |
| 2.3 / PR7 | `tests/foundation/p9-delivery-pos.test.mjs`, `apps/mobile/tests/unit/tus-pos.test.ts` → `apps/api/src/tus/{delivery,pos}/`, `apps/mobile/src/application/tus-client.ts` → conflicts | `pnpm test -- tests/foundation/p9-delivery-pos.test.mjs`; mobile replay/incident harness `local-deterministic`; device/courier/POS pilot `deferred` | `apps/api/prisma/migrations/20260827090600_tus_delivery_pos/migration.sql`; drain tasks, retain receipts with `providerCapture:not-claimed` |
| 3.1 / PR8 | `tests/foundation/p9-support-operations.test.mjs` → `apps/api/src/tus/{support,whatsapp,reporting}/`, `docs/operations/tus-support.md` → consent/handoff/reports | `pnpm test -- tests/foundation/p9-support-operations.test.mjs`; local authenticated actions, redacted traces, SEO freshness; WhatsApp live evidence `deferred` | `apps/api/prisma/migrations/20260827090700_tus_support_reporting/migration.sql`; disable actions, preserve transcripts/audit |
| 3.2 / PR9 | `tests/foundation/p9-ui-contract.test.mjs` → `apps/web/src/app/tus/`, `apps/web/src/lib/tus-client.ts`, `apps/mobile/app/(app)/`, `apps/mobile/src/application/tus-client.ts` → truthful states | `pnpm test -- tests/foundation/p9-ui-contract.test.mjs`; local contract render/disabled/conflict harness; browser/device evidence `deferred` | Client-only rollback; preserve server records and no local success inference |
| 3.3 / PR10 | `tests/foundation/p9-activation.test.mjs` → `scripts/activation/tus-readiness.mjs`, `docs/activation-gates.md`, `render.yaml`, `infra/terraform/environments/{render,aws}/main.tf` → independent gates | `pnpm test -- tests/foundation/p9-activation.test.mjs`; plan-only provider-free composition; authorized provider/cloud/legal/POS/pilot evidence only | Revoke gates, stop new work, quarantine/drain jobs; excluded scope remains disabled |

## Phase 1: Foundation
- [x] 1.1 Complete PR1 validation baseline with RED → GREEN → REFACTOR evidence and serial rerun proof.
- [ ] 1.2 Complete PR2 readiness in order after PR1.
- [ ] 1.3 Complete PR3 identity and HTTP in order after PR2.
- [ ] 1.4 Complete PR4 marketplace in order after PR3.

## Phase 2: Durable Commerce and Operations
- [ ] 2.1–2.3 Complete PRs 5–7; keep catalog, commitments, finance, delivery, and POS bounded contexts separate.

## Phase 3: Surfaces and Activation
- [ ] 3.1–3.3 Complete PRs 8–10; run `pnpm build` only after all local slices pass, without claiming external evidence.
