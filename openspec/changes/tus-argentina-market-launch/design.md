# Design: TUS Argentina Market Launch

## Technical Approach

Extend the Clean/Hexagonal API (`apps/api/src/tus`, `auth-security`, `tenancy`), shared contracts, PostgreSQL source-of-truth, outbox workers, Next web/PWA, and Expo mobile. The target has no ledger: create a statically gated additive baseline, convert `Float` money to exact minor units, never replay history. Writes/providers are tenant-scoped, idempotent, audited, correlated, readiness-gated; P0/evidence ambiguity disables go-live.

## Architecture Decisions

| Decision | Choice and rationale |
|---|---|
| Ownership | PostgreSQL owns identity, tenancy, commerce, bookings, POS, finance, billing, audit, ledger, idempotency, outbox. Mongo/Redis/B2 are projections/queues; no 2PC, matching `ownership.ts`. |
| Money | `Money { currency, minor: bigint }`; PostgreSQL `BIGINT`, provider conversion in adapters, integer-bps rates. Reject JS/Prisma `Float`. |
| Effects | Aggregate + audit + outbox atomically; workers lease/retry idempotently. Never call providers inside a DB transaction. |
| Evidence | Keep deterministic, real-PostgreSQL, browser/mobile, deployment, provider, legal/tax/privacy, and external-blocked separate; readiness accepts authorized evidence only. |

## Data Flow

`Web/PWA | Android/iPhone | POS` → authenticated tenant API → domain transaction (aggregate + idempotency + audit + outbox) → worker/provider → signed webhook/reconciliation → immutable ledger/readiness → projections/notifications.

Mercado Pago owns payment state; TUS owns commitments, five-day hold/release, commission, reconciliation, and ledger evidence. Tax/accounting owns Argentine interpretation; TUS never claims custody/compliance without evidence.

## Dependency-Ordered Workstreams

1. **Database gate** — `schema.prisma`, additive SQL, repair scripts, seed/tests. Root `.env` `DATABASE_URL` only; development + explicit seed confirmation; 60s + exactly one retry; backup. Reject replay/reset/`db push`, `DROP`, `TRUNCATE`, `CASCADE`, untagged delete. Add tenant FKs, exact money, calendar/booking/inventory, billing, webhook/event, ledger; verify/restore partial DDL.
2. **Boot/security/tenant/auth/readiness/observability** (1) — API config, `auth-security`, `tenancy`, readiness, observability. Fail closed; membership-derived tenant; reject spoofing; redact; telemetry/audit; close pools/owned children.
3. **Marketplace/catalog/inventory** (1–2) — `tus/catalog`, router, contracts, repositories. Tenant listings, publication, exact prices, row-lock/version stock, idempotent checkout/outbox.
4. **Calendars/availability/bookings** (3) — calendar/rule/exception/slot/booking services. Timezone, capacity/exclusion locks, overlap/cutoff/cancellation, stale-version rejection, replay.
5. **Durable POS** (1–2; parallel with 3–4 after contracts) — `tus/pos`, device/session/shift, web/mobile queue. Transactional operation/receipt/audit/outbox/idempotency; fingerprinted replay, versions, conflicts, leased recovery; no settlement claim.
6. **Mercado Pago intermediary split** (finance + commitments) — package and `tus/finance`. Provider idempotency; raw HMAC verification; event dedupe/re-fetch. Hold, commission snapshot, release after five days plus completion/confirmation/no freeze; compensating refunds/chargebacks; quarantine mismatches.
7. **WhatsApp** (3–6/provider gates) — `tus/whatsapp`, webhook/router/contracts. Sender/tenant/consent; quote TTL/recheck; atomic confirmation; idempotent handoff; no secrets.
8. **Own delivery** (product commitments/POS) — `tus/delivery`. Internal operators, zones/shifts/tasks/proof/incidents, versioned transitions, proof-before-handoff; never mutate ledger.
9. **Billing/subscriptions/invoices/tax** (6) — billing contracts/repositories/routes. Immutable/versioned drafts, invoices, credit notes, subscriptions, tax metadata; AFIP/VAT/monotributo are accountant/provider gates.
10. **Web/PWA** (stable contracts) — web app, `tus-client`, auth client, URL resolver. Auth scope, intent/idempotency UX, offline POS, accessible fail-closed states, explicit secret-free URL.
11. **Android/iPhone** (web parity) — mobile store/persistence/presentation/network. Secure storage, device binding, offline replay/conflicts, platform errors; device evidence separate.
12. **Render/Vercel/DNS/worker/operations** — manifests, Docker/docs, Python worker. Replace one-shot worker with leased DLQ consumer; gated Render migration, Vercel web, DNS/TLS/secrets/health/runbooks. Track PID/argv/port; clean only owned processes.
13. **Pilot/go-live** (gates) — evidence index, support/incident/backup runbooks, flags. Tenant/capability canary; backup/restore, migration, provider/webhook, booking/POS/device/cloud receipts and rollback rehearsal precede nationwide enablement.

## Interfaces / Contracts

```ts
type Money = { currency: string; minor: bigint }
type CommandContext = { tenantId: string; actorId: string; correlationId: string; idempotencyKey: string; requestHash: string }
interface ProviderAdapter { create(input: CommandContext & { commitmentId: string; amount: Money }): Promise<{ reference: string; status: string }> }
interface WebhookHandler { verify(raw: Uint8Array, headers: Record<string, string>): void; handle(eventId: string, payload: unknown): Promise<'applied'|'replay'|'quarantined'> }
```

## Testing Strategy

Strict TDD: unit-test money, transitions, slots, signatures, tenant denial, idempotency; PostgreSQL HTTP-test schema, isolation, concurrency, audit/outbox atomicity, replay, restore, cleanup; sandbox-test webhooks/refunds/chargebacks/reconciliation. Receipts remain separately tagged; each slice records redacted attempts, effects, cleanup, evidence, rollback.

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior | RED test |
|---|---|---|---|
| Documentation-like paths | N/A — no executable classification change. | N/A | N/A |
| Git repository selection | Applicable — chained worktrees. | Only `Goldenrepo-js-py`; reject underscore sibling/ambiguous cwd. | Relative, absolute, `git -C`. |
| Commit state | Applicable — slice checkpoints. | Require intended index; refuse empty/unrelated state. | staged, `commit -a`, empty index. |
| Push state | Applicable — optional chain. | Explicit branch/refspec; never infer destination. | tracking, first push, explicit refspec. |
| PR commands | N/A — no PR automation in this design. | N/A | N/A |

## Migration / Rollout

No destructive migration. Apply in fresh sessions/worktrees; parallelize only independent POS/catalog after contracts; database, finance, deployment stay serial. Rollback disables routes, intake, providers, release, delivery, billing while preserving ledger/audit/outbox/DLQ/evidence; restore only verified backup. External evidence stays separate. Any P0 blocks go-live.

## Open Questions

- [ ] Confirm backup, Mercado Pago five-day, tax, messaging/delivery, cloud/DNS, device/support ownership.
- [ ] Determine whether existing Float data needs an approved additive backfill; never destructively replay it.
