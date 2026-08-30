# Proposal: TUS Production Completion

## Intent

Convert the audit into an Argentina-first MVP completion program. Prove durable authenticated journey.

## Scope

### In Scope
- Classify 19 failures, stabilize OOM/concurrency, close tooling gaps, and add PostgreSQL HTTP smoke.
- Replace both readiness implementations with one versioned, evidence-owned, fail-closed model.
- Bootstrap durable signup/session, tenant roles, onboarding, customer access, and cross-tenant denial over HTTP.
- Prove catalog, separate product/service checkout, idempotency, audit/outbox replay, compensation, and restart durability.
- Deliver finance, delivery/POS, web/mobile, support, reporting/SEO, operations, deployment, and provider gates.
- Separate external approvals; missing or revoked evidence cannot enable actions.

### Out of Scope
- Global launch, rentals, regulated verticals, open driver marketplace, financing, mature dispatch, warehouse automation, custody/escrow, unbounded AI automation, or live external claims without authorized evidence.

## Capabilities

### New Capabilities
- `tus-validation-baseline`: validation and DB/HTTP smoke.
- `tus-canonical-readiness`: evidence gates and fail-closed decisions.
- `tus-identity-tenant-bootstrap`: durable identity and authorization.
- `tus-merchant-marketplace`: onboarding, catalog, discovery, checkout.
- `tus-commerce-commitments`: durable lifecycle, idempotency, audit, outbox, replay.
- `tus-financial-operations`, `tus-delivery-pos`, `tus-governed-support-messaging`, `tus-reporting-discovery-operations`: gated operations.
- `tus-provider-activation-evidence`: provider, cloud, POS, pilot gates.

### Modified Capabilities
- None; no authoritative `openspec/specs/` capabilities exist. Prior specs are inputs.

## Approach

Chain: baseline → readiness → identity/tenant → marketplace/commitments → finance/delivery/POS → UI/operations → provider activation. PostgreSQL/Prisma is authoritative; in-memory paths are test-only.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api/src/tus/`, `apps/api/src/auth-security/`, `apps/api/src/tenancy/` | Modified | Auth, gates, contexts. |
| `apps/api/prisma/`, `packages/contracts/`, `tests/foundation/`, `tests/integration/tus/` | New/Modified | Persistence, contracts, tests. |
| `apps/web/`, `apps/mobile/`, `apps/api/src/providers/`, `scripts/activation/`, `docs/` | Modified | UI, adapters, runbooks. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Noisy baseline hides regressions | High | Serial classification. |
| Readiness/identity drift breaks safety | High | One model; fail-closed defaults. |
| Approvals remain unavailable | High | Keep payment/release/fleet disabled. |
| Scope exceeds review capacity | High | Chained units; rollback boundaries. |

## Rollback Plan

Disable affected routes, providers, publication, and release/fleet jobs; drain consumers; preserve audit/evidence/ledger history; use compensating entries, never destructive rollback. Revert only the TUS slice.

## Dependencies

- Reproducible Node/Python/Terraform tooling and PostgreSQL smoke.
- Argentina legal/tax/KYC/KYB, provider, POS, cloud, and pilot evidence.
- Downstream specs, design, tasks, implementation.

## Success Criteria

- [ ] `pnpm test`, `pnpm build`, contract validation, and required checks pass with zero unexplained failures.
- [ ] Durable HTTP smoke proves signup/session → tenant → publish → product/service checkout, restart/replay, and cross-tenant denial.
- [ ] One readiness decision controls activation and fails closed for missing, expired, revoked, or out-of-scope evidence.
- [ ] Finance, delivery/POS, UI, support, reporting, and operations have truthful evidence; no excluded capability is claimed.
