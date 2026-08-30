# Design: TUS Big Picture MVP

## Technical Approach

Reconciled with seven `tus-big-picture-mvp/specs/*/spec.md` files, `proposal.md`, and `exploration.md`. Build dependency-ordered rollbackable slices above neutral factory. PostgreSQL/Prisma is the source of truth; outbox/jobs, Mongo, Redis, providers are adapters.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Tenant authority | Session → membership → role/permission context; headers are not authority | Header identity; client policy | Enforces server-side tenant isolation. |
| Context ownership | `apps/api/src/tus/{catalog,commitments,finance,delivery,pos,support,reporting,whatsapp}` owns domain/application/ports/adapters | Universal state machine; policy in `platform/` | Preserves incompatible lifecycles. |
| Durability | Prisma transaction writes aggregate, idempotency, audit, and outbox | In-memory; provider-first writes | Provides restart and replay safety. |
| Money authority | TUS owns snapshots, ledger, freezes, refunds, reconciliation; Mercado Pago maps provider state | Provider completion; fixed payout timing | Separates evidence from provider approval. |
| Activation | Scoped evidence gates commitment, provider, release, and fleet independently | Deployment booleans | Missing legal/KYC/KYB/tax/provider/POS/AWS evidence fails closed. |

## Dependency-Ordered Data Flow

```text
Clients (web/PWA · POS · WhatsApp · staff)
        → session auth → TUS router/use case → PostgreSQL
        → outbox/jobs/providers → evidence, ledger, reports, SEO
```

1. **Readiness** (`tus-activation-readiness`) persists owner/scope/evidence/policy/expiry/revocation and fail-closed decisions; it limits Argentina Stage 1 cohorts and records non-claims.
2. **API** (`tus-tenant-commerce-api`) resolves session → membership → permissions; required idempotency/fingerprint commands atomically write aggregates, audit, and outbox. Headers never grant authority.
3. **Marketplace** (`tus-merchant-marketplace`) validates profile/location/staff/policy, scopes operations, publishes distinct product or duration/resource services, rechecks versioned price/stock/slots, audits mutations, and creates independent commitments.
4. **Finance** (`tus-financial-operations`) links authenticated commitments to approved Mercado Pago, separates provider/commercial states, freezes risk/disputes/missing evidence, and records immutable 10% snapshots, ledger corrections, refunds, chargebacks, and quarantined exceptions. Check-in never releases funds.
5. **Delivery/POS** (`tus-delivery-pos`) runs internal zone/shift assignment → acceptance → pickup → transit → handoff/return/incident; durable offline conflicts require review and POS never claims settlement.
6. **Messaging/support** (`tus-governed-support-messaging`) applies typed search/quote/cart/status/confirm/handoff actions, consent, expiry, disclosure, rate limits, transcript references, and audited support sessions; sensitive actions hand off.
7. **Reporting/deployment** (`tus-reporting-discovery-operations`) projects tenant-safe supply/demand/conversion/fulfillment/payment/aging/dispute/POS/WhatsApp/readiness data, canonical/robots/sitemap/structured SEO models, correlated redacted telemetry, and explicit Render/AWS pilot evidence.

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/*_tus_mvp/` | Modify/Create | Tenant aggregates, readiness, ledger, receipts, offline commands, projections. |
| `apps/api/src/tus/{readiness,catalog,commitments,finance,delivery,pos,support,reporting,whatsapp}/` | Create/Modify | Bounded domain/application/port/adapter sets |
| `apps/api/src/tus/composition/index.ts`, `apps/api/src/tus/http/router.ts`, `apps/api/src/server.ts` | Modify/Create | Durable composition and routes. |
| `apps/api/src/auth-security/`, `apps/api/src/tenancy/`, `packages/contracts/src/tus.ts`, `packages/contracts/schemas/tus/` | Modify/Create | Verified context, permissions, versioned DTOs; no neutral policy. |
| `apps/api/src/providers/{mercado-pago,whatsapp}/`, `apps/workflow-runtime-python/src/worker/contracts/` | Modify/Create | Provider mapping and job contracts. |
| `apps/web/src/app/tus/`, `apps/web/src/lib/tus-client.ts`, `apps/mobile/src/application/tus-client.ts`, `apps/mobile/app/(app)/pos.tsx` | Modify | Commerce, SEO, and durable POS queue. |
| `render.yaml`, `infra/terraform/environments/{render,aws}/main.tf`, `packages/observability/src/index.ts` | Modify | Deployment composition, telemetry, and pilot evidence. |
| `tests/foundation/p7-tus-marketplace-operations.test.mjs`, `apps/mobile/tests/`, `tests/integration/tus/` | Modify/Create | RED-first contract, persistence, HTTP, device, evidence labels. |

## Interfaces / Contracts

```ts
type AuthenticatedTenantContext = {
  subjectId: string; sessionId: string; tenantId: string
  roles: string[]; permissions: string[]; correlationId: string
}
interface TusTransaction { run<T>(work: (tx: TusRepositories) => Promise<T>): Promise<T> }
interface OfflineCommand { id: string; tenantId: string; actorId: string; deviceId: string; shiftId: string; idempotencyKey: string; schemaVersion: string; createdAt: string; expectedVersion?: number; kind: string; payload: unknown }
```

Commands carry correlation/idempotency context; reads require it. DTOs separate commitments, provider payment, evidence, ledger, disputes/support, and `credentialsCollected: false`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit/contract | Cohorts, auth, commitments, freezes, snapshots, allowlist, offline, reports | Strict TDD RED-first; deterministic fakes labeled test-only. |
| Persistence/HTTP | Atomicity, restart, replay/conflict, tenant denial, signed webhooks | Test database plus Express smoke; provider-free. |
| E2E/device | Publish → commitments → gated payment; POS replay; handoff | Add runner later; otherwise record deferred evidence. |

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior and planned RED test |
|---|---|---|
| Documentation-like paths | N/A — no executable documentation classification | No task/test. |
| Git repository selection | N/A — no Git automation | No task/test. |
| Commit state | N/A — no commit automation | No task/test. |
| Push state | N/A — no push automation | No task/test. |
| PR commands | N/A — review lifecycle explicitly excluded by user | No task/test. |

## Migration / Rollout

Use expand/backfill/activate: add nullable tables/indexes, deploy adapters and shadow reads, backfill verified tenant data, then switch flagged routes only after legal, KYC/KYB, tax, Mercado Pago, POS, AWS, runtime, and provider approvals. Settlement/fleet/payout/custody remain disabled otherwise. Rollback disables intake/providers/release/fleet, drains consumers, preserves audit/evidence, and posts compensating ledger entries; never destructive-down financial migrations. Revert only the affected TUS slice; neutral contracts remain intact.

## Open Questions

- [ ] Argentina legal/tax/custody model; Mercado Pago; refunds, chargebacks, reserves, payouts.
- [ ] Evidence/delivery/POS/WhatsApp/support policy; AWS/Groq, reports/SEO, E2E runner.
