# Design: TUS Platform Vision

## Technical Approach

Implement TUS above the neutral factory as a cohort-gated, capability-composed application. Stage 1 enables beauty/personal care excluding regulated healthcare and repairs/trades, reporting/SEO foundations, web/PWA parity, and Expo POS/manual operations. Shared contracts cover tenant identity, money, snapshots, evidence, and references; bounded contexts own product sales, appointments, service jobs, delivery, POS, settlement, disputes, support, discovery, and WhatsApp policy. Reconciled inputs: `proposal.md` and `specs/tus-marketplace-operations/spec.md`.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Domain ownership | `apps/api/src/tus/` uses `domain/`, `application/`, `ports/`, `adapters/`, and `composition/` per context | Add TUS nouns to `apps/api/src/platform/` or one aggregate | Follows existing Clean/Hexagonal boundaries and prevents contamination. |
| Commercial lifecycle | Mixed checkout orchestrates lines but emits independent product/service commitments | One order/booking state machine | Preserves incompatible stock, capacity, labor, evidence, and settlement invariants. |
| Financial truth | TUS owns completion, snapshots, freezes, and compensating entries; Mercado Pago remains an adapter | Treat provider status as completion or hard-code five days | Evidence and provider payment state differ; legal/provider constraints stay gated. |
| Client surfaces | Thin web/PWA, mobile POS, and operations views call versioned API contracts | Put policy in Next/Expo | Authorization, idempotency, and audit remain server-side. |
| Activation safety | Cohort, legal/provider, POS, and AWS/Groq gates control commitments, settlement, and fleet jobs | Enable by deployment alone | Failed gates fail closed and preserve neutral contracts during rollback. |

## Data Flow

```text
Web/PWA · Mobile POS · WhatsApp · Operations
                    ↓ typed command + tenant context
API presentation → TUS application service → bounded-context stores
                                      ↓ outbox/jobs/audit
                           payment, delivery, notification adapters
                                      ↓
                             settlement ledger + reports/SEO read models
```

Commands re-check tenant authorization, price/availability, idempotency, cohort policy, and readiness. Mixed checkout splits into independent commitments. Completion emits evidence; confirmation releases immediately, while approved service (12h), online/long-shipment (24h), or configurable local-delivery policies make release eligible. Check-in proves arrival/start only. Dispute, chargeback, fraud/risk, missing evidence, or unresolved support incident freezes release.

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/tus/` | Create | Bounded contexts, primitives, ports, composition, and services. |
| `packages/contracts/src/tus.ts` | Create | Versioned commitment, evidence, settlement, dispute, and WhatsApp DTOs. |
| `packages/contracts/src/index.ts` | Modify | Export TUS contracts without changing neutral semantics. |
| `apps/api/src/server.ts` | Modify | Mount TUS route composition beside health/security middleware; transport remains policy-free. |
| `apps/api/src/providers/mercado-pago/index.ts` | Modify | Map provider payment/webhook state to TUS contracts without treating it as completion or settlement authority. |
| `apps/api/src/providers/whatsapp/index.ts` | Modify | Preserve signed, tenant-policy-aware transport; TUS adds the typed action allowlist and audited handoff above it. |
| `apps/web/src/app/` and `apps/web/src/lib/tus-client.ts` | Create | Marketplace, merchant, customer, operations shells, and typed client. |
| `apps/mobile/app/` and `apps/mobile/src/application/tus-client.ts` | Create | Staff/POS flows with explicit online/offline policy. |
| `tests/foundation/p7-tus-marketplace-operations.test.mjs` | Create | RED tests for cohorts, split commitments, isolation, freezes, snapshots, WhatsApp, support, and gates. |

## Interfaces / Contracts

```ts
type SettlementSnapshot = {
  contractVersion: '1.0.0'; commitmentId: string; context: 'product' | 'service'
  ruleVersion: string; commissionableBase: number; rateBps: number
  commissionAmount: number; currency: string; evidenceId: string
}
type WhatsAppAction =
  | { type: 'search' | 'quote' | 'cart' | 'status' | 'handoff'; tenantId: string }
  | { type: 'confirm'; tenantId: string; commitmentId: string; confirmationId: string }
```

All commands carry tenant, actor, correlation, and idempotency context. Tenant-owned reads and commands authorize before returning data. `SettlementSnapshot` immutably persists the 10% MVP base (1000 basis points), rule version, commissionable base, and amount. Sensitive actions redirect to authenticated checkout or human handoff; credentials never enter WhatsApp and unsupported actions are audited.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Cohort publication, transitions, confirmation release, freezes, snapshots, fail-closed gates | RED tests first; deterministic clocks/stores mirror existing adapters. |
| Contract | Tenant isolation, versioning, typed WhatsApp allowlist, provider mapping | Extend `packages/contracts` validation and `tests/foundation` fixtures. |
| Integration | Split checkout, outbox/idempotency/retry, support linkage, reconciliation, release-job disablement | In-memory composition plus existing adapters; runner unavailable. |
| E2E | Marketplace-to-commitment and POS/WhatsApp journeys | Deferred until an E2E runner exists; use contract smoke coverage meanwhile. |

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior and RED test |
|---|---|---|
| Documentation-like paths | N/A — no executable documentation classification | No task/test. |
| Git repository selection | N/A — no Git automation | No task/test. |
| Commit state | N/A — no commit automation | No task/test. |
| Push state | N/A — no push automation | No task/test. |
| PR commands | N/A — design contains no PR automation; review lifecycle was explicitly excluded | No task/test. |

## Migration / Rollout

No migration required for this documentation design. Implement behind gates: contracts/in-memory paths, cohort publication, Argentina legal/provider/KYC/KYB/tax approval, Mercado Pago validation, POS pilot, AWS/Groq evidence, then production commitments, settlement, and fleet jobs. Failed gates disable operations. Rollback disables commitments/providers and release jobs, preserves evidence/audit, and uses compensating entries without altering neutral contracts.

## Open Questions

- [ ] Argentina legal/provider operating model, Mercado Pago product constraints, KYC/KYB, tax, and payout authority.
- [ ] Exact evidence, dispute, refund, chargeback, reserve, and local-delivery release policies.
- [ ] WhatsApp authentication, confirmation expiry/replay, consent, and sensitive-action handoff contracts.
- [ ] AWS service/region/evidence matrix and Groq migration readiness.
- [ ] POS hardware and offline conflict/reconciliation policy.
- [ ] Exact reporting dimensions and SEO read-model ownership for Stage 1 foundations.
