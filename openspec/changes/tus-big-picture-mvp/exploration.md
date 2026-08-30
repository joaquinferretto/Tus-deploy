# Exploration: TUS Big Picture MVP

## Executive summary

The prior `tus-platform-vision` change established a coherent product contract and added a small deterministic proof surface, but it did not implement a functional TUS marketplace. The current TUS runtime is limited to TypeScript domain helpers, an in-memory checkout/application seam, provider webhook adapters, a boolean activation controller, typed client stubs, and static web/mobile shells. The next change must first make one durable, authenticated, end-to-end Argentina slice real before expanding breadth.

## Audit basis and repository state

- Audited on-disk source, manifests, tests, Prisma schema/migrations, deployment files, prior OpenSpec artifacts, and executable commands.
- CodeGraph was checked first; its index reports 352 files, 4,376 nodes, and 43 added/33 modified pending changes. Source verification then used the current filesystem because the TUS files are not indexed yet.
- Git is on `post-cambios` with a large pre-existing dirty working tree. `git log --all` has no history for the TUS paths and `git ls-files` has no entries for `openspec/changes/tus-platform-vision`; the “completed” prior change is therefore present as working-tree/untracked evidence, not as a committed implementation baseline.
- The requested new change directory did not exist before this artifact.

## Prior change: promised versus actually implemented

| Prior promise | Current evidence | Audit result |
|---|---|---|
| Versioned TUS contracts and primitives | `packages/contracts/src/tus.ts`; `apps/api/src/tus/domain/*.ts` | Partial. Interfaces/validators cover commitments and settlement snapshots; there are no TUS JSON Schemas, full lifecycle commands, or persisted aggregates. Domain validation is permissive in places (for example, no cross-field ownership/evidence validation). |
| Bounded API contexts and mixed checkout | `TusApplicationService` and `InMemoryTus*Store` | Partial proof only. Checkout splits product/service lines, writes in-memory commitments/audit references/outbox, supports idempotency, and reads one commitment. It does not implement catalog, booking, service jobs, delivery, POS, settlement posting, disputes, support, reporting, or merchant/customer commands. |
| Provider and activation safety | Mercado Pago/WhatsApp in-memory adapters, signed webhook router, `TusActivationController` | Partial. Webhook receipt/idempotency/retry/DLQ behavior and a fail-closed release-job wrapper exist. These adapters are not connected to TUS commitments, payment intents, ledger entries, assistant actions, or durable jobs. Gate state and compensating entries are in memory. |
| Web/PWA and mobile POS | `apps/web/src/app/tus/page.tsx`, `apps/web/src/lib/tus-client.ts`, `apps/mobile/app/(app)/pos.tsx`, `apps/mobile/src/application/tus-client.ts` | Shell/client proof only. The page is static; the web client is unused and its advertised API routes are absent. Mobile POS only changes a local counter; the client queue is an in-memory `Map`, not durable offline storage, and is not used by the screen. |
| Verification | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | 22/22 focused tests pass, but they are deterministic unit/contract tests and fake transports. They do not prove a durable API, real payment, fleet, database, browser, device, or E2E flow. |

The prior artifacts themselves correctly state that legal/provider, payment, evidence, hardware, offline, AWS, and Mercado Pago questions remained open. The prior review also identified reporting/SEO traceability as a downstream risk. Those are real gaps, not completed tasks.

## Current state and affected areas

### API, domain, application, and persistence

- `apps/api/src/tus/domain/` contains only cohorts, commitment splitting, evidence classification, release eligibility, dispute/support constructors, snapshots, readiness booleans, and WhatsApp action filtering.
- `apps/api/src/tus/application/tus-application-service.ts` owns only checkout, one commitment read, release eligibility evaluation, and context-name exposure.
- `apps/api/src/tus/ports/index.ts` exposes only in-memory-oriented commitment, audit-reference, outbox, and idempotency seams. There are no TUS HTTP routes, command handlers, transaction boundaries, or persistent adapters.
- `apps/api/prisma/schema.prisma` has identity, tenancy, audit, search, snapshots, idempotency, outbox, and AI records, but no TUS organization capability configuration, catalog, listing, price, inventory, appointment, service job, order/commitment, delivery, payment intent, ledger, payout, refund, dispute, support, review, or WhatsApp-action tables.
- The existing neutral PostgreSQL/outbox/idempotency services are reusable dependencies, not proof that TUS uses them. `createTusApplication()` explicitly constructs only in-memory stores.

### Auth, tenant, and security

- Neutral auth, tenancy, membership, role, product-superadmin, audit, privacy, rate-limit, and persistence modules exist under `apps/api/src/auth-security/`, `apps/api/src/tenancy/`, `apps/api/src/admin/`, and `apps/api/src/platform/`.
- `apps/api/src/server.ts` mounts health, security middleware, and TUS provider webhooks only. It does not mount `createAuthRouter`, `createTenancyRouter`, or a bearer/session verification middleware. A direct runtime probe returned HTTP 404 for `/auth/sign-in` and all advertised `/tus/v1/*` commerce/POS routes.
- TUS requests currently trust `X-Tenant-Id`/`X-Actor-Id` headers in client code. `TusCommandContext` has no authenticated subject, role, permission, session, customer identity, or support-session scope. This is a production blocker for every tenant-owned command/read.

### Web/PWA, marketplace, customer, and merchant operations

- `apps/web/src/app/tus/page.tsx` is a single static marketing-like page with anchors. It has no catalog data, search, listing detail, availability, cart, checkout, bookings, customer account, merchant workspace, operations console, support, or payment interaction.
- `apps/web/src/lib/tus-client.ts` declares discovery, merchant operations, customer commitments, and WhatsApp handoff requests, but no server routes implement them; the fetch transport also omits `Content-Type` for JSON bodies and has no auth/session handling.
- `apps/web/src/app/manifest.ts` supplies a basic manifest with no icons. There is no service worker, IndexedDB command queue, cache strategy, offline reconciliation, sitemap, robots policy, canonical listing route, structured-data renderer, or dynamic SEO read model.

### Mobile POS and offline

- Expo, NetInfo, TanStack Query persistence, MMKV, SecureStore, and encrypted local-state foundations exist.
- The TUS mobile client queues only in a process-local `Map`; it lacks durable command envelopes, device/aggregate versions, bounded offline exposure, receipt state, retry/backoff, dead-letter/review state, or server reconciliation.
- `apps/mobile/app/(app)/pos.tsx` simulates online/offline mode and increments a display counter. It never constructs or submits `ManualPosOperation`, uses no NetInfo subscription, and has no shift, catalog, inventory, receipt, payment, conflict-review, or refund flow. Mobile unit/integration/E2E directories contain only `.gitkeep` files.

### Delivery and fleet

The generic Python durable delivery worker under `apps/workflow-runtime-python/src/worker/delivery/` supports queue claim/ack/retry/reconcile semantics, but no TUS delivery context exists. Missing are zones, shifts, courier/operator scope, readiness, assignment/acceptance, pickup, in-transit, handoff proof, failed/returned/incident states, customer visibility, and operations/support review. The prior research explicitly excludes an open driver marketplace, bidding, ride-hailing, autonomous dispatch, and continuous surveillance.

### Settlement, disputes, refunds, reconciliation, and evidence

- `isReleaseEligible()` correctly distinguishes check-in from completion/delivery evidence, supports confirmation-first release, 12-hour service and 24-hour online/long-shipment windows, configurable local policy, and absolute freeze flags.
- `createSettlementSnapshot()` calculates a frozen 10% default snapshot. It does not persist it or enforce that the snapshot is created at an authoritative financial event.
- There is no payment-intent creation/capture binding, gross/net ledger, commission rule store, payout instruction, reserve/negative-balance model, refund or chargeback workflow, reconciliation exception queue, release command, or durable release scheduler.
- `createDispute()` and `createSupportCase()` only construct open records. There is no bilateral evidence submission, discussion/mediation, SLA/escalation, decision authority, partial/full refund outcome, compensating entry, or support-session authorization. Check-in and provider payment approval cannot currently change a TUS commitment because no such application transition exists.

### WhatsApp

The neutral adapter verifies signatures, tenant policy, allowed senders, idempotency, retries, and outbound deterministic delivery. TUS adds only a `Set` of six allowed action names and HTTPS Mercado Pago URL validation. There is no tenant-resolved conversational handler, catalog search, quote/hold expiry, cart ownership, explicit confirmation/replay contract, authenticated status access, human handoff endpoint, outbound template/consent policy, or action audit. The adapter currently echoes inbound text through its provider port; it is not a TUS commerce assistant.

### Support, audit, reporting, SEO, observability

- Neutral `AuditEvent`, platform audit/traceability, privacy, retention, telemetry, metrics, and redaction foundations exist, but TUS checkout stores only small in-memory audit references of type `commitment.created` and does not call the durable platform audit or telemetry boundaries.
- Reporting/SEO are named as a bounded context only. No TUS report queries, event dimensions, financial/operational aggregates, export, listing index, sitemap, robots, structured data, or canonical URL implementation exists.
- The observability package provides provider-free OTel-compatible shapes and redaction, but TUS has no spans, metrics, alerts, or dashboards for conversion, fulfillment, settlement aging, freezes, disputes, WhatsApp safety, or tenant-boundary incidents.

### AWS, Groq, legal/provider gates, and deployment

- `apps/api/src/tus/domain/readiness.ts` is a boolean check over legal, KYC, KYB, tax, Mercado Pago, POS pilot, AWS, and Groq-migration flags. It has no evidence records, owner, expiry, scope, approval, or persisted evaluation.
- Generic activation documentation and `scripts/activation/index.mjs` correctly preserve fake/unavailable/live distinctions. AWS Terraform and Render Terraform profiles are contract-only, default all capabilities to false, and do not provision or run TUS resources.
- `render.yaml` deploys `factory-api`, `factory-web`, and a generic Python worker. The production API starts the default `createApp()` with no TUS application composition, no auth/tenancy routes, and no configured Mercado Pago/WhatsApp adapters. AWS is a shape/readiness target, not a live TUS deployment. Groq remains the existing transitional provider; no TUS-specific parity, cost, data, fallback, or retirement evidence exists.
- Legal/provider research correctly leaves Argentina’s marketplace role, KYC/KYB, tax/invoicing, custody/segregation, payout, reserve, refund, chargeback, fleet labor/insurance, and Mercado Pago product/account constraints unresolved. No production settlement or fleet activation is justified.

## MVP boundary

### Production blockers

1. No authenticated, routed, durable TUS command/read path.
2. No durable commercial aggregates or transactional linkage among commitments, payments, evidence, ledger, and outbox.
3. No approved Argentina payment/settlement/legal operating model; no safe release/payout/refund/reconciliation execution.
4. No real delivery operations or durable offline POS reconciliation despite Stage 1 promises.
5. Deployment defaults do not compose TUS, and integration/E2E evidence is unavailable.

### Functional Argentina-first MVP gaps

The next MVP must make one cohort-gated path work for the two acquisition cohorts (beauty/personal care excluding regulated healthcare and repairs/trades): organization/staff onboarding; publishable product and core appointment/service offerings; customer discovery; separate product/service commitments; one approved checkout/payment path; completion evidence and confirmation/no-feedback policy; merchant settlement accounting; bilateral dispute/support path; TUS-managed delivery operations for eligible product commitments; complete web/PWA merchant/customer operations; mobile staff POS/manual capture with durable, bounded offline replay; reporting/SEO foundations; and governed WhatsApp answer/discover/quote/cart/status/handoff actions.

### Later roadmap and explicit non-goals

Later slices may add richer variants/modifiers, advanced inventory/resources/CRM, hardware shell selection, multi-provider payments, marketplace liquidity, sophisticated dispatch, imports/integrations, deeper analytics, country packs, and mature fleet scale. Rentals, open driver marketplaces/bidding, ride-hailing, warehouse automation, financing/credit, stored value/custody/escrow without approval, regulated healthcare and other regulated verticals, and global launch are not MVP work.

## Executable evidence and limitations

| Command | Result |
|---|---|
| `pnpm exec node --experimental-strip-types --test tests/foundation/p7-tus-marketplace-operations.test.mjs` | Pass: 22/22. Node emitted module-type warnings for API/web/mobile source packages. |
| `pnpm contracts:validate` | Pass: 81 schemas; AJV emitted existing ignored-format warnings for `date-time`, `uri`, and `email`. |
| `pnpm --filter @factory/api build` | Pass: Prisma client generation and TypeScript compilation. |
| `pnpm --filter @factory/mobile typecheck` and lint | Pass when run separately; no TUS mobile tests exist. |
| `pnpm --filter @factory/web build` | Compile/type/page generation passed, then failed on Windows `EPERM` while Next standalone tracing created symlinks. |
| `pnpm --filter @factory/web lint` | Failed/interrupted because `next lint` prompts for ESLint configuration; no configuration was invented. |
| `pnpm test` | Fail: 313 total, 308 passed, 5 failed. Known unrelated failures: P5.5 core-source contamination; P5.6 contamination and parity; P6.9 traceability because deleted `product-factory-core` spec files are still referenced; P6.6 portability. TUS p7 tests pass within this run. |
| Direct `createApp()` probe for `/tus/v1/discovery/offers`, `/merchant/operations`, `/customer/commitments`, `/pos/manual-operations`, `/auth/sign-in` | All returned 404 `Not Found`, confirming the client/application route gap. |

No external Mercado Pago, WhatsApp, AWS/Groq, database, production deployment, hardware, device, or browser E2E smoke was run. The prior research also records unavailable vendor pages and explicitly says no hardware pilot, provider contract review, or Argentina legal opinion was performed.

## Recommended dependency-ordered SDD slices

1. **MVP contract and activation gate slice** — update the new proposal/spec for exact Stage 1 acceptance, country/provider/legal evidence, actor roles, completion/evidence vocabulary, product/service separation, and fail-closed claims. A slice is accepted only when each production gate has owner, scope, evidence type, expiry/revocation, and explicit non-claim behavior; no code may enable settlement yet.
2. **Durable identity/tenant/API composition slice** — affected paths: `apps/api/src/server.ts`, `apps/api/src/auth-security/`, `apps/api/src/tenancy/`, `apps/api/src/tus/http/`, `apps/api/src/tus/composition/`, `apps/api/src/tus/ports/`, `apps/api/prisma/schema.prisma`, migrations, and `packages/contracts/src/tus.ts`. Acceptance: authenticated session-derived tenant/actor/role context, mounted auth/tenancy/TUS routes, deny-by-default authorization, durable TUS repository transactions, idempotent command replay/conflict, and cross-tenant tests.
3. **Catalog, onboarding, discovery, customer commitments, and merchant operations slice** — affected paths: new bounded-context modules under `apps/api/src/tus/`, web App Router pages/client, and TUS contracts/schemas. Acceptance: approved-cohort merchant can publish a product or service; customer can discover and create separate product/service commitments; merchant can view/update only its scope; price, availability, tenant, and audit invariants are server-enforced.
4. **Payment, ledger, evidence, settlement, dispute, refund, and reconciliation slice** — affected paths: TUS settlement/evidence/dispute/support modules, Prisma migrations, Mercado Pago mapping, platform outbox/jobs/audit integrations, and financial contract fixtures. Acceptance: one approved Argentina checkout path creates a provider-linked payment intent and immutable gross/commission/net snapshot; completion evidence plus confirmation or approved aging policy drives eligibility; any risk/dispute/chargeback/missing evidence freezes; refunds/chargebacks/support decisions create compensating entries; reconciliation is replay-safe. Production provider execution remains gate-disabled until evidence passes.
5. **Delivery operations and durable POS/offline slice** — affected paths: TUS delivery/POS modules, `apps/mobile/src/application/`, durable MMKV/NetInfo integration, web PWA offline infrastructure, and Python worker contracts only where long-running work is required. Acceptance: staff can open/close a scoped shift, record bounded manual operations offline, replay durable commands exactly once, review conflicts, and never claim payment/settlement locally; TUS operations can assign and complete an internal delivery task with approved proof without mutating the product lifecycle; customer confirmation remains separate.
6. **WhatsApp, support, reporting/SEO, and operational observability slice** — affected paths: TUS WhatsApp action application, support/audit integration, notification jobs, web dynamic discovery pages, sitemap/robots/structured data, report queries, and `packages/observability` consumers. Acceptance: typed allowlisted actions are tenant/auth/consent/idempotency/confirmation checked, sensitive actions hand off securely, support/dispute timelines are auditable, Stage 1 metrics/report exports and SEO foundations are real, and every critical path emits redacted correlated telemetry.
7. **Readiness/deployment and production pilot slice** — affected paths: `render.yaml`, AWS Terraform profile references, activation evidence/configuration, runbooks, CI, and environment-specific composition. Acceptance: Render/AWS shape is explicit, API/web/worker actually compose TUS, failed gates keep commitments/release/fleet disabled, provider-free CI remains green except documented pre-existing failures, and separately authorized Argentina/POS/provider smoke evidence exists before production enablement.

Each slice should be independently specified, tested, and rollbackable; keep authored changes under the 400-line review budget or use chained work units.

## Recommendation

Proceed to proposal for `tus-big-picture-mvp`, but do not treat the prior change as an implemented platform. Start with the durable authenticated API/commercial foundation and carry legal/provider gates as hard acceptance boundaries. Then prove one product and one service path end-to-end, with payment/settlement disabled until approved evidence exists, before adding the broader delivery, POS, WhatsApp, reporting, and SEO surfaces.

## Risks

- The dirty, mostly untracked working tree makes provenance and rollback ambiguous; isolate intended TUS changes before implementation.
- Implementing clients before routed durable server contracts would create misleading UI and unsafe offline/payment claims.
- TUS collection/settlement and fleet operation may be legally or provider-infeasible in Argentina; keep a provider-administered alternative and fail-closed fallback in the proposal.
- The prior 22-test suite can overstate completeness because it tests in-memory helpers rather than deployed behavior.
- Next.js Windows standalone symlink restrictions and missing web ESLint configuration will continue to limit local verification until addressed separately.
- Missing integration/E2E tooling and no mobile tests leave the highest-risk customer, staff, and payment journeys unproven.

## Ready for Proposal

Yes, with the explicit instruction that the proposal is an implementation recovery/vertical-slice plan, not a continuation of a completed marketplace. The proposal should preserve the prior north-star boundaries, make reporting/SEO foundations explicit, and sequence the seven slices above behind Argentina legal/provider, identity, persistence, and evidence gates.
