# Tasks: TUS Argentina Market Launch

## Review Workload Forecast
Estimated changed lines: 3,000–5,000 authored; 400-line budget risk: High.
Chained PRs recommended: Yes; suggested split: 10 fresh-session slices; delivery: auto-chain; chain: feature-branch-chain.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units
All tests are `pnpm test -- <file>` ≤120s; builds ≤180s; runtime is `N/A (planning; verify-only)`. Every unit uses a fresh apply session.

| Unit | Focused test; evidence; eligibility; rollback |
|---|---|
| 1 DB | `migration-repair.test.mjs`; deterministic/PG; serial; P1 paths |
| 2 API | `backend-hardening.test.mjs`; deterministic/deployment; after 1; P2 paths |
| 3 Commerce | `tests/integration/tus/catalog-booking.test.mjs`; deterministic/PG; serial after 2; P3–4 |
| 4 POS | `tests/integration/tus/pos-durability.test.mjs`; deterministic/PG/browser; parallel after contracts; P5 |
| 5 Payments | `tests/integration/tus/finance-webhook.test.mjs`; deterministic/provider; after 3; P6 |
| 6 Comms/ops | `tests/integration/tus/whatsapp-delivery-billing.test.mjs`; provider/legal; parallel where independent; P7–9 |
| 7 Clients | `tests/foundation/tus-client-mobile.test.mjs` + build; browser/mobile; parallel after 2–6; P10–11 |
| 8 Cloud | `tests/foundation/p8-tus-deployment.test.mjs`; deployment; serial; P12 |
| 9 Evidence | bounded DB/provider/browser/device harnesses; all classes; serial; evidence only |
| 10 Launch | gate tests; all classes; serial; flags/runbooks |

## Phase 0: Safety Controls
- [ ] 0.1 RED `tests/foundation/sdd-git-boundary.test.mjs` covers relative/absolute/`git -C`, index, tracking and explicit refspec; GREEN `scripts/sdd/git-boundary.mjs`; REFACTOR rejects `Goldenrepo-js_py`.

## Phase 1: Database / Lineage / Money
- [ ] 1.1 RED migration/backup/restore tests; GREEN `apps/api/prisma/schema.prisma`, additive SQL, `scripts/tus-migration-repair-lib.mjs`/`postgres-seed.mjs`; REFACTOR `Money{currency,minor:bigint}`, BIGINT/bps, ledger/audit/outbox/FKs; backup-gated, never destructive.

## Phase 2: Backend / Security
- [ ] 2.1 RED hardening tests for root `.env`, 60s+one retry, tenant/auth, CORS/limits/redaction; GREEN `apps/api/src/platform/{configuration,lifecycle}`, `auth-security`, `tenancy`, `tus/readiness`, `packages/{errors,lifecycle}`; REFACTOR `evaluateReadinessGates`/worker observability.

## Phase 3: Marketplace / Catalog
- [x] 3.1 RED stale/cross-tenant/stock-race/retry tests; GREEN `apps/api/src/tus/catalog/{index.ts,domain,application,adapters}` and `tus/http/router.ts`; REFACTOR separate product/service snapshots.

## Phase 4: Calendar / Booking
- [x] 4.1 RED timezone/blackout/overlap/cutoff/cancellation/no-show/race tests; GREEN `apps/api/src/tus/calendar/{rules,slots,bookings}.ts`; REFACTOR locks and completion evidence.

## Phase 5: Durable POS
- [x] 5.1 RED closed-shift, same-key, offline/revoked replay, printer-failure, atomicity tests; GREEN `apps/api/src/tus/pos/{index.ts,application,adapters}` and client queues; REFACTOR leases, conflicts, refunds.

## Phase 6: Mercado Pago
- [x] 6.1 RED five-day gate, HMAC/freshness, event replay, refund/chargeback/mismatch tests; GREEN `packages/mercado-pago/src/index.ts` and `apps/api/src/tus/finance/index.ts`; REFACTOR freeze/release/ledger.

## Phase 7: WhatsApp
- [x] 7.1 RED consent/opt-out/template/signature/credential/handoff tests; GREEN `apps/api/src/tus/whatsapp/{index.ts,router.ts}`; REFACTOR tenant routing, TTL, rate limit, idempotent audit/outbox.

## Phase 8: Own Delivery
- [x] 8.1 RED transitions/SLA/unsafe-handoff/proof tests; GREEN `apps/api/src/tus/delivery/index.ts` (`DeliveryTask`, `DeliveryStorePort`); REFACTOR internal-only fencing and immutable ledger boundary.

## Phase 9: Billing / Tax
- [x] 9.1 RED invoice/credit/refund/subscription/tax-gate tests; GREEN `apps/api/src/tus/billing/{index.ts,application,adapters}`; REFACTOR exact immutable accounting and AFIP/ARCA/IVA external gates.

## Phase 10: Web / PWA
- [ ] 10.1 RED role/idempotency/offline/accessibility/URL tests; GREEN `apps/web/src/lib/{tus-client.ts,tus-auth-client.ts,api-url.ts}` journeys; REFACTOR thin fail-closed UI.

## Phase 11: Native Mobile / POS
- [ ] 11.1 RED secure-storage/device/interruption/replay/role tests; GREEN `apps/mobile/src/{store,app}` adapters; REFACTOR platform errors and separate device evidence.

## Phase 12: Deployment / Evidence
- [ ] 12.1 RED standalone/Render/Vercel/DNS/PID/backup/live-proof tests; GREEN `render.yaml`, `vercel.json`, Docker/scripts/runbooks and leased worker; REFACTOR `openspec/changes/tus-argentina-market-launch/evidence-index.md`.

## Phase 13: Pilot / Go-Live
- [ ] 13.1 RED expired/revoked/conflicting/P0 rollback tests; GREEN readiness capability matrix, evidence index, support/incident/backup runbooks and canary flags; REFACTOR staged tenants. P0 blocks go-live.

Planning only: no app/DB/service/browser/provider/deployment execution. Preserve root `.env` `DATABASE_URL`, explicit seed confirmation, tagged evidence, and sibling exclusion.
