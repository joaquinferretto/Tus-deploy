# Design: TUS Production Completion

## Technical Approach

Implement the ten specifications in order: validation → readiness → identity/tenancy → marketplace → commitments → finance/delivery/POS → support/reporting/UI → activation. Prisma is authoritative; in-memory is test-only. Evidence: `local-deterministic`, `local-postgresql-http`, `authorized-external`, `deferred`.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Readiness | `apps/api/src/tus/readiness/index.ts` and `packages/contracts/src/tus.ts` own one decision; `domain/readiness.ts` is adapter-only. | Parallel gates. | Evidence is preserved; disabled wins. |
| Authority | Prisma aggregates, transactions, audit, idempotency, and outbox are durable truth. | Mongo, Redis, provider, or fake state. | Enables restart/replay. |
| Contexts | Keep `apps/api/src/tus/{catalog,commitments,finance,delivery,pos,support,reporting,whatsapp}/` separate. | Universal state machine. | Different invariants. |
| Activation | Evidence gates independently control publication, providers, settlement, release, payout, fleet, and deployment. | Env flags or fixtures. | Invalid evidence fails closed. |

## Requirement Coverage and Dependency Order

| Phase/spec | Implementation contract and proof |
|---|---|
| 1 `tus-validation-baseline` | `scripts/test-runner.mjs` and tests classify 19 failures with disposition/owner/rerun; serial checks report command/status/counts as `local-deterministic`; PostgreSQL HTTP smoke proves persistence, restart, replay, rollback. Unknown failures block. |
| 2 `tus-canonical-readiness` | Versioned decision gates publication, commitments, providers, release, payout, fleet, and activation; conflicts audit and choose disabled. Records carry capability/profile, owner/scope/type, issue/expiry, revocation/policy/source. Deterministic proof cannot satisfy live gates. |
| 3 `tus-identity-tenant-bootstrap` | `apps/api/src/auth-security/`, `tenancy/`, Prisma adapters, and `prisma/seed.ts` provide server-derived context, test-only fixtures, signup/onboarding/invitations/customer access, restart recovery, and superadmin scope; headers never authorize. |
| 4 `tus-merchant-marketplace` | `apps/api/src/tus/catalog/` and `http/router.ts` enforce cohorts, exclusions, location roles, current locale/price/policy, separate stock/capacity/slots, truthful discovery, product/service intents, and audit. |
| 5 `tus-commerce-commitments` | `apps/api/src/tus/application/`, `commitments/`, Prisma adapters, and workers atomically write commitment, fingerprint, audit, and outbox; failed transactions leave no partial state; replay survives restart. |
| 6 `tus-financial-operations` | `finance/` and Mercado Pago adapters separate states; provider approval never releases; retain immutable 1000-bps snapshots, evidence release, freezes, compensation, and reconciliation quarantine. |
| 7 `tus-delivery-pos` | `delivery/`, `pos/`, Prisma adapters, and mobile client support proof delivery, offline replay, conflict review, and local-only labels; no bidding, surveillance, capture, settlement, or payout claims. |
| 8 `tus-governed-support-messaging` | `support/`, `whatsapp/`, and clients enforce typed consent, quotes, non-replayed confirmation, secure handoff, tenant-scoped transcript/actor evidence, compensation, and AI non-authority. |
| 9 `tus-reporting-discovery-operations` | `reporting/`, observability, SEO routes, and `docs/operations/` provide tenant-safe dimensions/freshness, canonical SEO, redacted telemetry; stale/revoked listings disappear. |
| 10 `tus-provider-activation-evidence` | Activation script, Render/AWS profiles, and `docs/activation-gates.md` independently gate Mercado Pago, WhatsApp, AWS/Groq, cloud, POS, pilot, routes, workers, release, and fleet. Excluded scope stays disabled. |

## Data Flow

```text
Web/PWA · Expo POS · WhatsApp/support
 → session → identity/membership → TUS router/use case
 → Prisma transaction: aggregate + idempotency + audit + outbox
 → workers/providers → finance, delivery, reports; readiness gates effects
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/tus/`, `apps/api/src/auth-security/`, `apps/api/src/tenancy/`, `apps/api/src/tus/{http,composition}/` | Modify | Contexts. |
| `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/*_tus_completion/`, `apps/api/prisma/seed.ts` | Modify/Create | Additive schema. |
| `packages/contracts/src/tus.ts`, `packages/contracts/schemas/tus/`, `apps/workflow-runtime-python/src/worker/` | Modify | Contracts. |
| `apps/web/src/app/tus/`, `apps/web/src/lib/tus-client.ts`, `apps/mobile/src/application/tus-client.ts`, `apps/mobile/app/(app)/` | Modify | Surfaces. |
| `tests/foundation/`, `tests/integration/tus/`, `scripts/activation/`, `docs/{activation-gates.md,operations/}` | Modify/Create | Evidence. |

## Interfaces / Contracts

Commands carry server-derived tenant/actor/session context, correlation ID, version, idempotency key, and fingerprint. Preserve `TusTenantContext`, separate commitments, immutable `SettlementSnapshot`, append-only ledger, readiness evidence/decision, typed WhatsApp actions, and POS `providerCapture: 'not-claimed'`. Providers report state; finance owns release. Outbox/jobs carry tenant.

## Testing Strategy

| Layer | Coverage and evidence |
|---|---|
| Unit/contract | Strict TDD RED-first: gates, auth, exclusions, lifecycles, idempotency, compensation, actions, DTOs, failures; fakes are local-only. |
| Integration | Serial PostgreSQL/Prisma HTTP journey proves signup → publish → product/service checkout → restart/replay, denial, callbacks, outbox recovery, and offline conflicts; label `local-postgresql-http`. |
| UI/device | Local contract smoke verifies flows and disabled/pending/conflict states; browser/device/hardware is `deferred`. |
| Live | Authorized provider, legal, cloud, production-like DB, POS, and pilot artifacts are separate; local results never promote them. |

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior and RED test |
|---|---|---|
| Documentation-like paths | N/A — no executable-file classification. | No task/test. |
| Git repository selection | N/A — no Git automation. | No task/test. |
| Commit state | N/A — no commit automation. | No task/test. |
| Push state | N/A — no push automation. | No task/test. |
| PR commands | N/A — review lifecycle explicitly forbidden. | No task/test. |

## Migration / Rollout

Use expand → tenant backfill/verify → shadow-read → activate one capability/profile at a time. Revoke/rollback stops affected actions, publication, providers, payout/settlement/release/fleet jobs, and consumers; drains/quarantines work, preserves evidence/audit/ledger, and uses compensating entries—never destructive financial down-migrations. Local proof continues while live gates are disabled.

## Open Questions

- [ ] Legal/provider ownership; POS conflicts.
