# Proposal: TUS Platform Vision

## Intent

Define the Argentina-first, global-capable TUS marketplace and merchant operating system on the completed neutral factory. Preserve the full north star while staging delivery around horizontal acquisition cohorts: beauty/personal care excluding regulated healthcare, and repairs/trades.

## Scope

### In Scope
- Stage 1 products and services/appointments with separate commitments, marketplace discovery, merchant administration, TUS-managed delivery, complete web/PWA desktop parity, Expo mobile POS/manual operations, reporting foundations, SEO/discovery foundations, support/audit, and governed WhatsApp.
- WhatsApp may discover, quote, cart, and initiate supported actions; payment redirects securely from TUS to Mercado Pago, and credentials never enter WhatsApp.
- Confirmation-first settlement: explicit customer confirmation releases immediately; check-in proves arrival/start only. With no feedback and no dispute, services release after 12h following completion evidence, online/long shipments after 24h following accepted delivery evidence, and simple/local internal delivery under a more lenient configurable context/risk policy with no fixed duration. Dispute, chargeback, fraud/risk, missing-evidence, or unresolved-incident cases freeze regardless of elapsed time.
- A configurable 10% MVP commission base with immutable rate, rule-version, commissionable-base, and amount snapshots. More than 20 completed services or sales may qualify trust benefits, distinct from baseline release timing. AWS is the target; Groq remains transitional with a migration backlog.

### Out of Scope
- Rentals, global launch, open driver marketplace/bidding, ride-hailing, mature dispatch, warehouse automation, regulated verticals, custody/escrow, and financing.
- Narrowing the north star; these capabilities proceed through chained SDD phases from product contract through specs, design, tasks, apply, and verification.

## Capabilities

### New Capabilities
- `tus-marketplace-operations`: discovery, merchant operations, products/services, delivery/POS, settlement/disputes, trust, reporting/SEO, and governed WhatsApp.

### Modified Capabilities
- None. This is a documentation-only amendment; neutral factory requirements remain unchanged.

## Approach

Compose shared commercial primitives with bounded product, appointment, service, delivery, POS, settlement, dispute, and support contexts. Reuse factory tenancy, authorization, contracts, provider, outbox/jobs, audit, storage, and observability boundaries without adding TUS policy to neutral packages. Treat external marketplace research as pattern evidence only; Mercado Pago's universal five-day constraint is unverified and must not be hard-coded.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api/`, `apps/web/`, `apps/mobile/` | New | TUS application, marketplace, merchant, POS, fleet, support, and customer surfaces. |
| `packages/contracts/` and existing provider/platform boundaries | Modified/Consumed | Typed context contracts and adapters; no neutral-factory contamination. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Vision sprawl or invalid universal states | High | Cohort-gated Stage 1 and explicit bounded contexts. |
| Argentine payment, custody, tax, labor, or consumer exposure | High | Legal/provider readiness gates before production settlement or fleet operation. |
| Incorrect release, automation, or tenant isolation | High | Evidence, confirmation, absolute risk freezes, typed WhatsApp allowlist, audit, and support review. |

## Rollback Plan

Gate or disable TUS commitments/providers, stop release jobs, reconcile via compensating ledger entries, preserve evidence/audit, and revert only TUS application packages; leave neutral factory contracts intact.

## Dependencies

- Argentina legal/provider/KYC/KYB/tax readiness; Mercado Pago account/product validation; POS hardware pilot; AWS/Groq migration matrix; downstream SDD specifications.

## Success Criteria

- [ ] Stage 1 traces products/services, administration, web/PWA and mobile POS, TUS fleet, separate commitments, WhatsApp, support, reporting, and SEO/discovery.
- [ ] Release and freeze rules, evidence, disputes, commission snapshots, trust distinction, and provider boundary are explicit and testable.
- [ ] North-star scope, exclusions, rollout gates, and neutral-factory ownership boundaries remain traceable.
