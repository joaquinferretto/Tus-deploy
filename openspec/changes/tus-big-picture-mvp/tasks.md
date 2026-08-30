# Tasks: TUS Big Picture MVP Completion

## Review Workload Forecast

Estimated changed lines: 2,500–5,000.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit/base | Goal/test/harness/rollback |
|---|---|
| 1 / feature branch | `[GATE]` readiness/contracts; `pnpm test -- tests/foundation/p8-tus-readiness.test.mjs`; deterministic; revert schema. |
| 2 / PR 1 branch | `[PROD]` durable API; `pnpm test -- tests/foundation/p8-tus-commerce-api.test.mjs`; Express/PostgreSQL; revert API/auth. |
| 3 / PR 2 branch | `[PROD]` marketplace; `pnpm test -- tests/foundation/p8-tus-marketplace.test.mjs`; publish→commit; revert catalog/UI. |
| 4 / PR 3 branch | `[PROD gated]` finance; `pnpm test -- tests/foundation/p8-tus-finance.test.mjs`; held-release stub; revert finance, preserve ledger. |
| 5 / PR 4 branch | `[PROD]` delivery/POS; `pnpm test -- tests/foundation/p8-tus-delivery-pos.test.mjs`; replay/conflict; revert delivery/mobile/PWA. |
| 6 / PR 5 branch | `[PROD]` support/WhatsApp/reporting/SEO; `pnpm test -- tests/foundation/p8-tus-operations.test.mjs`; signed fake/read-model; revert surfaces. |
| 7 / PR 6 branch | `[EVIDENCE/GATE]` deployment/pilot; `pnpm test`; provider-free validation; revert config/docs. |

Delivery: force-chained/automatic; feature branch merges to main.

## Phase 1: Readiness/Contracts

- [x] 1.1 RED `[GATE]` test cohort/evidence gates, labels, rollback: `tests/foundation/p8-tus-readiness.test.mjs`.
- [x] 1.2 GREEN `[GATE]` implement readiness, DTOs, schemas, migration: `apps/api/src/tus/readiness/`, `packages/contracts/src/tus.ts`, `packages/contracts/schemas/tus/`, `apps/api/prisma/`.
- [x] 1.3 REFACTOR `[GATE]` document legal/KYC/KYB/tax/provider/POS/runtime owners: `docs/activation-gates.md`.

## Phase 2: Durable API

- [x] 2.1 RED `[PROD]` test session context, spoof/tenant denial, atomicity, replay/conflict: `tests/foundation/p8-tus-commerce-api.test.mjs`.
- [x] 2.2 GREEN `[PROD]` implement transactions, repositories, routes, server wiring: `apps/api/src/tus/{ports,adapters,composition,http}/`, `apps/api/src/server.ts`.
- [x] 2.3 REFACTOR `[PROD]` prove restart/audit/outbox; isolate tests; rollback TUS routes.

## Phase 3: Marketplace

- [x] 3.1 RED `[PROD]` test onboarding/scope, stale facts, stock/overlap, separate commitments: `tests/foundation/p8-tus-marketplace.test.mjs`.
- [x] 3.2 GREEN `[PROD]` implement catalog, commitments, routes, client: `apps/api/src/tus/{catalog,commitments}/`, `apps/web/src/app/tus/`, `apps/web/src/lib/tus-client.ts`.
- [x] 3.3 REFACTOR `[PROD]` verify audit/labels; rollback unpublishes listings, not commitments.

## Phase 4: Finance

- [x] 4.1 RED `[PROD gated]` test checkout, held release, immutable snapshot, freezes, compensation, quarantine: `tests/foundation/p8-tus-finance.test.mjs`.
- [x] 4.2 GREEN `[PROD gated]` implement finance, Mercado Pago, migrations, guarded jobs: `apps/api/src/tus/finance/`, `apps/api/src/providers/mercado-pago/`.
- [x] 4.3 REFACTOR `[GATE]` disable provider/release/payout/custody absent approval; never rewrite ledger.

## Phase 5: Delivery/POS

- [x] 5.1 RED `[PROD]` test scoped delivery, bidding rejection, replay/conflict, pending receipts, no settlement: `tests/foundation/p8-tus-delivery-pos.test.mjs`, `apps/mobile/tests/`.
- [x] 5.2 GREEN `[PROD]` implement delivery/POS clients: `apps/api/src/tus/{delivery,pos}/`, `apps/mobile/src/application/tus-client.ts`, `apps/mobile/app/(app)/pos.tsx`.
- [x] 5.3 REFACTOR `[EVIDENCE]` label fake transport; document deferred device/browser/POS evidence; drain consumers on rollback.

## Phase 6: Operations

- [x] 6.1 RED `[PROD]` test allowlist, consent/confirmation, handoff, reports, revoked SEO, redaction, alerts: `tests/foundation/p8-tus-operations.test.mjs`.
- [x] 6.2 GREEN `[PROD]` implement contexts, provider, SEO, telemetry: `apps/api/src/tus/{whatsapp,support,reporting}/`, `apps/api/src/providers/whatsapp/`, `apps/web/src/app/tus/`, `packages/observability/src/index.ts`.
- [x] 6.3 REFACTOR `[PROD]` verify audit, retention, ledger reports, freshness, no credentials; suppress outbound actions on rollback.

## Phase 7: Deployment/Evidence

- [x] 7.1 RED `[EVIDENCE]` test missing gates, disabled composition, deterministic CI, separate evidence: `tests/foundation/p8-tus-deployment.test.mjs`.
- [x] 7.2 GREEN `[EVIDENCE/GATE]` update deployment, activation, CI, runbooks: `render.yaml`, `infra/terraform/environments/{render,aws}/main.tf`.
- [x] 7.3 REFACTOR `[EVIDENCE]` run `pnpm test`, build/contracts, HTTP smoke; attach authorized Argentina/legal/provider/POS/browser/device evidence.

## Explicit Out of Scope

Global/rentals/regulated healthcare/open bidding/ride-hailing/warehouse automation/credit/custody/escrow/mature fleet/advanced CRM/imports and `gentle-ai review`. Prior vision code remains test-only evidence.
