# Proposal: TUS Big Picture MVP Completion

## Intent

Turn the audit into a bounded Argentina-first MVP proving durable authenticated commerce. Connect supply, transactions, operations, money, and support behind fail-closed legal/provider gates.

## Scope

### In Scope
- Seven ordered slices: readiness; durable tenant API/persistence; onboarding/catalog/marketplace; finance; delivery/offline POS; WhatsApp/support; reporting/SEO/observability/deployment.
- Beauty/personal care excluding regulated healthcare and repairs/trades; separate product/service commitments; one approved Argentina checkout path.
- Reuse prior proofs as regression fixtures, never as production evidence.

### Out of Scope
- Global launch, rentals, regulated verticals, open driver marketplace/bidding, financing/credit, mature dispatch, warehouse automation, and a universal monolithic state machine.
- Settlement, payout, or fleet enablement before Argentina legal/provider/KYC/KYB/tax approval.

## Capabilities

### New Capabilities
- `tus-activation-readiness`: cohort/legal/provider evidence gates and fail-closed enablement.
- `tus-tenant-commerce-api`: authenticated sessions, tenant/role authorization, durable transactions, idempotency, and routes.
- `tus-merchant-marketplace`: onboarding, catalog, availability, discovery, product commitments, services, and merchant operations.
- `tus-financial-operations`: payment intents, immutable commissions, evidence release, ledger, refunds, disputes, and reconciliation.
- `tus-delivery-pos`: scoped delivery proof, shifts, durable offline capture, replay/conflicts, and receipts without local settlement.
- `tus-governed-support-messaging`: tenant-safe WhatsApp actions, consent, confirmation, handoff, support, and audit.
- `tus-reporting-discovery-operations`: reports, SEO read models, telemetry, deployment composition, and pilot evidence.

### Modified Capabilities
- None; no authoritative main specs exist. Prior artifacts are design inputs, not production capabilities.

## Approach

Implement rollbackable work units above the neutral factory: lock gates; compose durable API; prove one product and service journey; add finance/operations; finish surfaces. Keep lifecycles bounded and use contracts, outbox/jobs, audit, and provider ports.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api/src/tus/`, `apps/api/prisma/`, `apps/api/src/server.ts` | New/Modified | Contexts, persistence, routes, gates. |
| `packages/contracts/`, `apps/web/`, `apps/mobile/` | Modified | Contracts and user/PWA/POS surfaces. |
| `apps/workflow-runtime-python/`, deployment files | Modified | Jobs and pilot readiness. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Argentina model invalidates collection/payout | High | Evidence-owned gates and provider-administered fallback. |
| Scope exceeds review capacity | High | Ordered chained work units. |
| Proofs mask integration gaps | High | Database/API/cross-tenant smoke evidence. |

## Rollback Plan

Disable TUS publication, provider actions, release/fleet jobs, and capabilities via gates; preserve audit/evidence and compensate ledger entries. Revert only TUS changes.

## Dependencies

- Argentina legal/provider/KYC/KYB/tax decision; Mercado Pago validation; POS pilot; AWS/Groq matrix; integration/E2E harness.

## Success Criteria

- [ ] An approved cohort onboards, publishes one product and service, and completes separate authenticated commitments through durable API/persistence.
- [ ] Financial, evidence, delivery/POS, WhatsApp/support, reporting/SEO, telemetry, and deployment paths have fail-closed, tenant-isolated evidence.
- [ ] No excluded capability is claimed as supported.
