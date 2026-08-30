## Exploration: TUS platform vision

### Current State

#### What is TUS?

**One sentence:** TUS (`tusservicios.com`) is a commission-led global marketplace and merchant operating system that lets ordinary businesses and independent providers publish what they offer, run their operations, and let customers discover, buy, book, communicate, and pay through web, staff surfaces, and WhatsApp.

**One paragraph:** TUS connects local supply and customer demand while giving each participating organization the operational tools normally scattered across a storefront builder, catalog, booking calendar, POS, CRM, delivery workflow, payment processor, and messaging channel. A merchant can create locations, staff, offerings, prices, availability, inventory, resources, and policies once; customers can discover the resulting marketplace listings, purchase products, request or book services, track fulfillment, receive reminders, and obtain support. The marketplace creates demand and trust; the merchant operating system makes supply accurate, transactable, and repeatable. TUS earns primarily from commissions on completed commercial activity, not from treating businesses as passive directory entries.

**Detailed product definition:** TUS is a multi-tenant, multi-surface commercial network with two inseparable sides:

- **Marketplace:** discovery, SEO, search, reputation, comparison, customer accounts, carts/quotes, checkout, bookings, service requests, delivery choices, messaging, and payment journeys across many business types.
- **Merchant operating system:** organization and location administration, staff and role management, catalog/listing management, variants and modifiers, price lists, promotions, taxes, inventory/resources/capacity, calendars, customer CRM, orders/bookings/service jobs, POS/manual transactions, fulfillment, payments, invoicing, reports, support, and automation.

TUS will launch in Argentina first while remaining global-capable. It should compose common commercial capabilities without forcing product sales, appointments, services, delivery, and POS into one universal state machine. Business-specific policies and orchestration remain in bounded contexts outside neutral factory packages.

The completed `product-factory-core` is infrastructure only and is not part of this exploration's redesign scope. Its authoritative verification reports establish 73/73 non-deferred tasks complete, 291 JavaScript tests, 209 Python tests, and 81 contracts. It already exposes reusable tenancy, identity/roles, audit, durable jobs/outbox, provider boundaries, storage, contracts, observability, and operational foundations. TUS business logic must consume those public boundaries from product/application packages rather than contaminate neutral packages.

The repository is currently a foundation monorepo (`package.json` names it `product-factory-core`) with a Next.js web shell, Express API, Expo/mobile workspace, Python workflow runtime, shared contracts, and provider packages. The API server currently mounts security middleware and health routes; tenancy and product-superadmin capabilities exist as clean application/domain/port/adapter modules. The Mercado Pago and WhatsApp adapters already demonstrate tenant-aware contexts, signed webhook verification, idempotency, outbox/saga/retry/dead-letter behavior, and configurable provider transports. They are adapters, not TUS commerce logic. No broad TUS marketplace, catalog, booking, service, POS, or merchant workflow is currently implemented.

#### Already-decided facts versus exploration recommendations

**Authoritative or already decided:**

- The factory is complete for its approved non-deferred scope and must not be re-audited or redesigned here.
- TUS is the product direction; `product-factory-core` is the reusable base.
- Each product has its own platform superadmin, separate from organization administration; privileged actions require traceability.
- Mercado Pago and WhatsApp are available through neutral, configurable adapter boundaries; TUS logic must remain outside those adapters.
- The product should support organizations, tenants, roles, SEO/discovery, self-service onboarding, and assisted onboarding as capabilities.
- Multiple price lists are a useful prior B2B pattern, not proof that the final TUS pricing model is limited to wholesalers.

#### Confirmed Product Decisions — Round 1

1. **Argentina first, global-capable architecture:** Argentina is the initial launch geography; locale, currency, tax, payment, payout, legal, privacy, and operational behavior must be country-packable rather than hard-coded into the reusable domain.
2. **Products + services MVP:** The first commercial combination is physical/digital product sales plus core services/appointments, including configured duration/day/hour services where applicable.
3. **TUS collects and settles:** TUS collects customer funds and later settles/pays merchants. This is a confirmed product posture, not a claim that escrow, custody, licensing, or regulatory treatment is solved.
4. **Completion-based commission:** Commission is earned only when the commercial operation is completed, using context-specific completion semantics. Explicit customer confirmation releases immediately. If there is no feedback and no dispute, approved baseline policies release services after 12 hours following service/completion evidence and online orders or long shipments after 24 hours following accepted delivery evidence; simple/local internal delivery uses a more lenient configurable context/risk policy with no fixed duration decided yet. Any dispute, chargeback, fraud/risk signal, missing evidence, or unresolved incident freezes settlement regardless of elapsed time.
5. **WhatsApp search-and-operate MVP:** WhatsApp may answer, discover, quote, create a cart, initiate or request/book supported services, obtain explicit confirmation, provide status, and hand off to a human. It may not perform unconfirmed or unsafe financial actions.

#### Confirmed Product Decisions — Round 2

1. **Horizontal product and launch cohorts:** TUS serves ordinary stores and service providers horizontally. Argentina acquisition begins with beauty/personal care excluding regulated healthcare and repairs/trades; these cohorts must not be hard-coded into shared business models.
2. **Functional Stage 1 MVP:** Stage 1 includes marketplace discovery, merchant administration, products, core services/appointments, configured duration/day/hour services where applicable, TUS-managed delivery operations, full desktop/PWA and mobile POS/manual operations, separated product/service carts or commitments, settlement, commission, and governed WhatsApp search-and-operate. Later stages add variants and scale, not missing core capabilities.
3. **Separate commitments:** MVP uses context-separated product/service carts or commitments; any combined-cart feature is outside this MVP.
4. **Context-sensitive settlement release:** Check-in proves arrival/service start only. Explicit buyer/service-user confirmation releases the eligible settlement immediately. With no feedback and no dispute, services release after the first 12 hours following service/completion evidence; online orders/long shipments release after 24 hours following accepted delivery evidence; simple/local internal delivery follows a more lenient configurable context/risk policy, with no fixed duration selected yet. Any dispute, chargeback, fraud/risk signal, missing evidence, or unresolved incident freezes settlement regardless of elapsed time. Reminders, clear disclosure, evidence collection, dispute opening, and auditable support review are required before/around release; this is a protection policy, not abandonment of protection. Disputes require evidence from both sides, discussion/mediation, and an auditable outcome; AI may assist with summary/classification but cannot decide high-impact disputes alone. Provider-administered marketplace funds/release is preferred; an alternative/TUS-administered path requires Argentina legal/provider, KYC/KYB, tax, reconciliation, segregation, and readiness approval. The prior universal no-timeout and 24h/48h drafts are superseded: TUS now uses confirmation-first, context-sensitive bounded release policies rather than a universal no-elapsed-time rule. Mercado Pago's universal five-day constraint remains unverified and must not be hardcoded.
5. **Trust benefits:** More than 20 successfully completed services OR more than 20 successfully completed sales creates trust-benefit eligibility, subject to KYC/KYB and risk checks; benefits are not automatic entitlement. Microcredit/financing is future work requiring a separate regulated partner/legal model and SDD change.
6. **AI transition:** AWS is the target ecosystem; existing Groq capabilities remain during MVP. A future migration backlog must cover inventory, parity, evidence, rollout, fallback, and Groq retirement; new AI should prefer AWS without claiming live activation.
7. **Metric terminology:** The first completed end-to-end operation is `first value` evidence. The >20 threshold is `trust-benefit eligibility`/repeated activation, not first value or entitlement.

#### Scope supersession: rentals explicitly excluded

The original exploration prompt mentioned rentals, but the user explicitly withdrew that scope. Rentals are a TUS product non-goal, not a deferred capability or future roadmap item. This supersedes all earlier rental recommendations, lifecycle sketches, metrics, and historical assumptions in this artifact; any reversal would require a new explicit user decision.

**Direct implications and constraints:**

- TUS collecting and settling in Argentina requires a dedicated legal/payment operating design covering provider eligibility, merchant-of-record or marketplace role, KYC/KYB, sanctions/fraud controls, customer funds handling, reconciliation, reserves, refunds, chargebacks, payout timing/failure, tax reporting, invoicing, consumer protection, privacy, audit, and support operations.
- The payment/provider architecture must support ledgered gross funds, commission snapshots, merchant net balances, pending/completed/disputed/refunded states, payout instructions, reconciliation evidence, and compensating entries. It must not assume that provider webhooks alone prove commercial completion.
- Research-backed settlement boundary: mature marketplaces separate commercial completion from provider payment/payout state, use context-specific and bilateral evidence, and retain refund/chargeback recovery paths after release. Upwork demonstrates an explicit review window with automatic release on no action; Airbnb demonstrates payout review/delay and recovery; Etsy demonstrates case-log evidence and seller-account recoupment; Stripe documents provider-specific balance/dispute responsibility and that manual payouts are not escrow. These are external patterns, not TUS policy or proof of equivalent Argentine provider behavior. TUS uses explicit confirmation as the preferred release event and bounded context-sensitive no-feedback policies only where approved; it freezes dispute, chargeback, fraud/risk, missing-evidence, and unresolved-incident cases regardless of elapsed time. TUS must validate Mercado Pago’s exact Argentina product/account/contract constraints before claiming split payments, escrow, a five-day hold/release, or TUS-controlled payout. Full research: `research/marketplace-funds-disputes.md`.
- This posture creates operational and regulatory dependencies before production launch. It does **not** silently adopt escrow, custody licensing, stored-value functionality, or any specific legal classification.
- Product/service commission becomes earned only after the relevant customer confirmation or approved context-sensitive release policy and completion evidence. Commission starts from a 10% MVP base, configurable by product, service, context, and risk, and may evolve later. Every operation immutably snapshots the applied rate, rule version, commissionable base, and calculated amounts; historical transactions are never rewritten. Risk/dispute, evidence, refund, no-show, chargeback, reserve, payout, and recovery scenarios remain specification work.
- Mercado Libre developer evidence patterns may inform evidence collection, mediation, and support workflow design only; TUS must not copy undocumented rules or claim identical consumer policy.
- WhatsApp exposes only an explicit allowlist of typed tools/actions with tenant routing, policy checks, authorization, idempotency, confirmation, and human handoff. Payment redirects to secure TUS checkout and then Mercado Pago; credentials are never collected in WhatsApp. Payment instrument changes, refunds, payouts, identity changes, disputes, and other sensitive operations require stronger confirmation through an authenticated surface or human handoff.

**Remaining recommendations from this exploration:**

- Use commissions on completed commercial events as the primary monetization model.
- Use shared commercial primitives plus bounded contexts, not a single polymorphic commerce aggregate.
- Treat escrow, subscriptions, advertising, setup fees, premium placement, financing, and other secondary monetization as separately approved options.

**Unresolved:** Argentina legal/provider operating model; exact completion evidence, dispute, refund, chargeback, reserve, and payout scenarios; WhatsApp authentication, privacy, confirmation-expiry, replay, and typed-tool contracts; the AWS service/region/evidence matrix; and direct validation of Mercado Pago account/product/contract constraints.

### Problem, users, value, and differentiation

#### Problem

Customers encounter fragmented supply: a product lives in one marketplace, a service in a social profile, appointments in a separate calendar, and payment or delivery elsewhere. Businesses face the inverse fragmentation: they must reconcile storefronts, POS, spreadsheets, inventory, calendars, staff, customer messages, payment records, delivery coordination, and follow-up manually. Existing products generally optimize one category:

- a **directory** exposes contact information but does not make supply operationally bookable or purchasable;
- an **ecommerce builder** handles products but not time, capacity, staff, or service execution;
- a **booking app** handles slots but not catalog commerce, inventory, fulfillment, or a merchant-wide ledger;
- a **POS** records a sale but does not create demand, public discovery, or multi-channel customer journeys.

TUS addresses the supply-and-demand coordination problem: represent an organization's real commercial capabilities accurately, expose them to customers, and record the resulting commitments and money flows with operational controls.

#### Target users

1. **Ordinary businesses and independent providers:** shops, wholesalers, studios, salons, clinics where legally appropriate, repair providers, educators, tradespeople, restaurants with bounded service scope, equipment owners, and other non-extreme local or online operators.
2. **Merchant operators:** owners and administrators who configure the business; staff who manage sales, schedules, stock, service work, customer care, and fulfillment.
3. **Customers/buyers:** people and organizations discovering, comparing, purchasing, booking, communicating, paying, and requesting support.
4. **Optional fulfillment actors:** couriers, pickup staff, partners, or providers who need only the tasks and data relevant to delivery or handoff.
5. **TUS platform operations:** product superadmins, support, trust and safety, finance/reconciliation, marketplace operations, and policy teams.

#### Value proposition and differentiation

For merchants, TUS is one operational source of truth for what can be sold, when it can be delivered, who can fulfill it, what it costs, and what happened afterward. For customers, TUS is one discovery and transaction layer for heterogeneous everyday needs. For TUS, the operating system makes marketplace supply reliable and creates more commissionable activity than a lead directory.

The differentiator is **capability composition with operational truth**: a business can combine product sales, appointments, services, delivery, and POS without pretending those transactions have identical lifecycles. The platform also treats WhatsApp as a governed action surface, not an unbounded AI chatbot, and combines marketplace demand with merchant-side adoption.

### Actors and surfaces

| Actor | Primary responsibility | Surface(s) |
|---|---|---|
| TUS platform superadmin | Product policy, platform configuration, risk/support escalation, marketplace governance, access control | Platform operations console |
| Organization owner/admin | Business setup, locations, staff, catalog, prices, policies, payments, reports | Merchant dashboard/POS, web, optional mobile |
| Staff/operator | Execute assigned sales, schedules, service jobs, stock, customer care, fulfillment | Staff/mobile surface, POS, dashboard |
| Seller/provider | Publish and fulfill own offerings; may be owner, staff, or external partner | Provider/merchant dashboard, mobile |
| Customer/buyer | Discover, compare, buy, book, communicate, pay, review, request support | Marketplace storefront, customer account, WhatsApp |
| Courier/fulfillment actor (optional) | Accept, update, and complete delivery/pickup tasks | Narrow fulfillment/mobile surface |
| TUS support/finance/trust operations | Resolve disputes, reconcile payments/payouts, moderate listings, investigate abuse | Platform operations console with audited support sessions |

**Marketplace storefront:** SEO-friendly organization and offering pages, search/discovery, availability/price previews, reviews, cart/quote, checkout or booking, order/booking/service status, and customer messaging.

**Merchant dashboard/POS:** setup, listings/catalog, price lists, inventory/resources, calendars, orders/bookings/service jobs, payment capture/refund, manual/offline transaction recording, staff permissions, customer history, reports, and operational alerts.

**Staff/mobile surface:** task-focused views for shifts, appointments, service jobs, inventory adjustments, pickup/delivery handoffs, customer contact, and offline-tolerant POS/manual capture where legally and technically safe.

**Customer account:** identity, saved details, carts, quotes, orders, bookings, payments, receipts, messages, reminders, cancellations, reviews, disputes, and consent controls.

**WhatsApp assistant:** tenant-scoped conversational entry point for questions and supported commercial actions, with explicit confirmations and human handoff.

**Platform operations console:** product superadmin controls, organization moderation, support sessions, policy/versioning, financial reconciliation, disputes, audit, marketplace health, and integration readiness. It must remain separate from merchant administration.

### Reusable business model: primitives and bounded contexts

#### Shared commercial primitives built once

These are cross-context contracts or capabilities, not one universal transaction model:

- organization, locations, tenant context, identity, staff, roles, permissions, and audit;
- listing/catalog identity, media/assets, taxonomy, variants, modifiers, attributes, and publication state;
- money, currency, units, price lists, tax references, promotions, discounts, quotes, and immutable price/fee snapshots;
- inventory, resources, capacity, availability windows, calendars, time zones, address/contact, and policy references;
- customer/party profile, consent, communication preferences, conversation/thread, notification, and support case;
- commercial intent/correlation, cart/line/charge representation, checkout/payment intent, refund, ledger entry, commission rule, payout instruction, and reconciliation reference;
- fulfillment request, address/pickup point, handoff, delivery status, tracking reference, and exception;
- idempotency, outbox/event publication, workflow/job execution, retries, observability, and audit evidence;
- discovery, SEO metadata, reviews/reputation, moderation, analytics dimensions, and integration/import jobs.

Shared primitives MUST preserve stable identifiers, tenant isolation, currency/unit correctness, idempotency, actor attribution, and snapshot semantics. They MUST NOT decide whether a line is a physical item, a time slot, or a service job.

#### Bounded contexts with distinct lifecycles

| Context | Core lifecycle and policy that must remain distinct |
|---|---|
| Physical/digital product sale | Draft/published listing -> cart/quote -> order -> payment/confirmation -> allocation/fulfillment or digital delivery -> completion, cancellation, return/refund. Stock and digital entitlement rules differ. |
| Appointment | Offering/resource/staff -> availability hold -> booking requested/confirmed -> reminder -> checked-in/fulfilled -> completed, rescheduled, cancelled, or no-show. Slot conflict and cancellation windows are central. |
| Service by duration/day/hour | Service job/request -> quote or acceptance -> scheduled/assigned -> started -> completed/approved -> invoiced/paid, disputed, cancelled, or failed. Duration, labor/resource capacity, and scope changes matter. |
| Delivery/fulfillment | TUS-managed fleet/operations request -> ready -> assigned/accepted -> picked up -> in transit -> delivered/handed off, failed, returned, incident, or cancelled. It may be attached to another context but must not become its state machine. Stage 1 covers couriers/operators, zones, shifts, assignment, proof, and operations visibility; it is not an open driver marketplace. |
| POS/manual/offline transaction | Operator-created sale or service record on desktop/web/PWA or mobile -> local capture/queued sync -> receipt/settlement -> reconciliation/void/refund. It needs shift, cash, device, offline, hardware, and conflict policy distinct from marketplace checkout. Native shell choice remains a later evaluation; Electron/Tauri is not selected. |

The shared layer should expose commands and events such as `price-quoted`, `capacity-held`, `commercial-commitment-created`, `payment-authorized`, `refund-requested`, and `fulfillment-updated`, while each bounded context owns valid transitions, invariants, and compensation. A product order must not acquire appointment states merely because both can be paid through the same provider.

### Canonical capability map

1. **Organization and locations:** tenant, business profile, branches, service areas, opening hours, legal/settlement identity.
2. **Identity, staff, and roles:** owner/admin, staff/provider, customer, courier, platform superadmin, scoped permissions, invitations, support sessions.
3. **Listings and catalog:** categories, listings, product/service metadata, media, variants, modifiers, bundles, digital delivery references.
4. **Pricing:** price lists, customer segments, volume tiers, promotions, coupons, taxes, fees, surcharges, currency conversion references, quote expiry.
5. **Inventory, resources, and capacity:** stock, serial/assets, consumables, rooms/equipment/staff capacity, reservations/holds, allocation and adjustments.
6. **Availability and calendars:** time zones, calendars, working hours, blackout periods, slot generation, buffers, booking windows, rescheduling rules.
7. **Carts and quotes:** context-separated product/service commitments in MVP, quote negotiation/expiry, reservation holds, and customer- or merchant-initiated carts; any combined-cart feature requires a future explicit decision.
8. **Orders, bookings, and service jobs:** separate aggregates and policies with common references to customer, organization, pricing, payment, and fulfillment.
9. **Checkout and payments:** payment intents, provider adapters, authorization/capture, payment status, receipts, refunds, payment method policy, webhook reconciliation.
10. **Commissions, fees, and payouts:** 10% MVP base configurable by product/service/context/risk, per-context rule versioning, immutable per-operation snapshots of rate, version, commissionable base, and amounts, merchant net, platform take, payout status, adjustments, reconciliation.
11. **Delivery and fulfillment:** TUS fleet/operations, zones, shifts, assignment, shipping/pickup/delivery options, task status, proof, incidents, exceptions, returns/handoffs, and visibility.
12. **Invoicing and tax evidence:** invoice/receipt references, country-specific tax adapters, numbering, corrections, legal retention.
13. **Customer and CRM:** profiles, contacts, segments, history, consent, notes, loyalty hooks, support history.
14. **Messaging and notifications:** conversations, templates, email/SMS/push/WhatsApp delivery, preferences, rate limits, human handoff.
15. **WhatsApp automation:** explicit typed-tool allowlist, tenant routing, policy/action authorization, idempotency, confirmations, reminders, secure checkout redirection, provider delivery, and escalation.
16. **Reviews and reputation:** eligibility, moderation, responses, aggregate ratings, fraud controls, dispute linkage.
17. **Disputes and support:** bilateral evidence, customer/provider discussion and mediation, refunds/adjustments, auditable outcomes, escalation, SLA, and audited support sessions; AI is assistive, not the sole high-impact decision-maker.
18. **Analytics and reports:** supply, demand, conversion, operational, financial, cohort, retention, marketplace liquidity, and exportable reports.
19. **SEO and discovery:** canonical URLs, structured data, indexing policy, search, location/category facets, availability-aware presentation.
20. **Audit and compliance:** immutable actor/action records, consent, privacy requests, retention/deletion, access review, policy versions.
21. **Integrations and imports:** payment, messaging, tax, accounting, inventory, calendars, delivery, CSV/API imports, provider health, reconciliation.

### What is reusable versus vertical-specific

**Build once and reuse:** identity/tenancy boundaries; organization and role model; listing and taxonomy references; money/units/time primitives; pricing and snapshot contracts; customer/consent; payment/commission ledger references; availability/resource abstractions; notifications; audit/idempotency/outbox/jobs; discovery/SEO metadata; integration ports; analytics event conventions; and UI capability permissions.

**Compose per offering:** a merchant may activate product commerce, appointment booking, service jobs, delivery, POS, or any supported combination. Composition should be explicit in organization configuration and capability discovery, not inferred from arbitrary fields.

**Keep policy/orchestration vertical-specific:** appointment conflict rules, service scope change and labor completion, product return/digital entitlement, delivery assignment and proof, POS shifts/offline reconciliation, regulated tax/invoicing, no-show policy, and industry compliance. New in-scope verticals should add a bounded context or policy module behind shared ports rather than branches in a universal model.

### WhatsApp maturity model and safety boundary

| Maturity | Supported behavior | Required boundary |
|---|---|---|
| 1. Answer | Hours, location, policies, offering facts, FAQs, status explanations | Ground answers in tenant-published data; identify tenant; do not invent availability or price. |
| 2. Discover | Search offerings, compare basic options, show location/price/availability | Respect catalog visibility, locale, consent, rate limits, and tenant isolation. |
| 3. Quote | Calculate price, taxes/fees, delivery estimate, or service availability | Return an expiring quote/hold; show assumptions, currency, time zone, and exclusions. |
| 4. Cart | Add/remove lines, save cart, request a quote | No commercial commitment until the customer confirms; enforce ownership and idempotency. |
| 5. Transaction | Book/reschedule/cancel, place order, or confirm supported service request | Explicit intent confirmation, policy disclosure, authorization, availability recheck, allowlisted typed action, and auditable result. Payment redirects to secure TUS checkout; high-risk payment/refund/identity changes require stronger confirmation or a handoff. |
| 6. Operations | Order tracking, reminders, staff alerts, status updates, post-sale support | Only disclose data to the entitled recipient; staff actions require role scope; outbound messages honor consent and provider rules. |
| 7. Human handoff | Transfer to merchant/support with context and transcript | Preserve tenant and privacy boundaries, disclose handoff, prevent duplicate actions, and allow the human to close or resume safely. |

The assistant is a capability client, not an autonomous business owner. For the MVP it may invoke only an explicit allowlist of typed tools/actions for answering, searching, quoting, cart creation, supported product/service requests, status, reminders, and handoff. Every action MUST verify tenant routing, sender/customer identity appropriate to the action, consent, policy authorization, current price/availability, idempotency, and explicit confirmation where it changes a commitment. It MUST never expose another tenant's data, collect payment credentials, or bypass TUS checkout; payments redirect to secure TUS checkout and Mercado Pago. Payment instrument changes, refunds, payouts, identity changes, disputes, and other sensitive actions require stronger confirmation through an authenticated surface or human handoff. Unsupported intents, ambiguous requests, regulated decisions, high-value transactions, and failed confirmations should stop safely and hand off.

### Commission-led business model

#### Confirmed Round 1 posture and recommended baseline

TUS will collect customer funds and later settle/pay merchants. It should calculate commissions on a clearly defined **commissionable base** per transaction context, but commission becomes earned only when that context's commercial operation is completed. The exact rule and amounts must be snapshotted when the financial record becomes authoritative. A transaction record should preserve gross amount, discounts, taxes, delivery/third-party pass-through, platform fee, provider net, currency, commission rule version, fixed/percentage components, completion evidence reference, and reason for adjustments.

Commission basis must be explicit by type:

- product sale: item subtotal, with configurable treatment of discounts, tax, shipping, and returns;
- appointment/service: completed service value after context-specific completion evidence and explicit customer confirmation;
- delivery: commission and pass-through treatment must not accidentally charge platform commission on a courier's full amount;
- POS/manual/offline: define whether the platform records commission at capture, sync, settlement, or only for transactions using TUS-enabled payment/discovery.

For the initial products + services scope, commission starts from a configurable 10% MVP base and becomes earned after accepted completion evidence plus either explicit buyer/service-user confirmation or the approved context-sensitive no-feedback release policy. Services use 12 hours after service/completion evidence; online orders/long shipments use 24 hours after accepted delivery evidence; simple/local internal delivery uses a more lenient configurable context/risk policy without a fixed duration yet. Any dispute, chargeback, fraud/risk signal, missing evidence, or unresolved incident freezes settlement regardless of elapsed time. Reminders, disclosure, evidence, dispute opening, and auditable support review protect the customer and merchant around release. Exact attesters, exception, reserve, refund, no-show, dispute, and chargeback scenarios remain specification work. Every operation snapshots the applied rate, version, commissionable base, and amounts immutably; later changes use compensating ledger entries. More than 20 successfully completed services or sales may qualify a merchant for trust benefits, but these baseline release windows are not early-payout trust benefits. The legal/payment design must determine TUS's Argentine role, provider permissions, customer-funds handling, KYC/KYB, tax treatment, and operational controls; this section does not claim escrow or custody licensing is solved. Mercado Pago's universal five-day constraint remains unverified and must not be hardcoded.

**Options needing explicit approval, not adopted here:** escrow or delayed payout; subscriptions/SaaS plans; advertising; premium placement; setup or assisted-onboarding fees; payment processing markup; financing/float; enterprise contracts; and data/analytics monetization. They may complement commissions but can distort marketplace neutrality or add legal obligations.

### Global readiness

The architecture should be global-capable from the start while rollout remains country-by-country. Required primitives include locale and translation strategy, currency and precision, tax-inclusive/exclusive display, time zones and DST, units and measurement conversion, international addresses and service areas, phone formats, payment provider abstraction, payout rails, country/legal-entity configuration, invoice/receipt rules, privacy/consent/retention, accessibility, data residency and export, fraud/risk controls, support languages, and platform terms/policies.

Global-capable does **not** mean launching all countries on day one. Each rollout needs a country pack for payment, tax, invoicing, payout, legal terms, privacy, consumer/merchant protections, supported currencies, operational support, and dispute handling. Avoid hard-coding Argentina-specific AFIP/Tango assumptions into shared commerce models; those can be adapters or country modules. Historical Argentina/B2B work is context only, not a replacement for the confirmed launch cohorts.

### Scope exclusions and separate-product boundaries

Out of the core TUS vision or requiring a separate product/specialized compliance track:

- Uber-like real-time dispatch, dynamic driver marketplace, route optimization, safety operations, and continuous location tracking;
- Spotify-like licensed content catalogs, rights management, streaming delivery, royalty accounting, and recommendation infrastructure;
- Rentals of goods or assets, including rental availability, deposits, return inspections, damage claims, and rental-specific settlement; explicitly excluded from TUS with no future implementation implied;
- financial services, lending, stored value, custody, or regulated escrow beyond approved payment-provider/legal capabilities;
- medical, legal, childcare, transport, alcohol, gambling, adult, weapons, or other regulated verticals until dedicated compliance and policy designs exist;
- industrial-scale scheduling, field-service telemetry, warehouse automation, or complex manufacturing execution;
- unbounded social network, creator-content, or general-purpose intent operating system concepts from the unrelated `SuperApp_Vision` history.

TUS may support a bounded integration or lead/referral for excluded domains, but must not imply that ordinary marketplace primitives satisfy their operational or legal requirements.

### Staged product roadmap

The roadmap preserves the large vision while tracing the confirmed horizontal model, two acquisition cohorts, and functional Stage 1.

**Stage 0 — Product contract and Argentina readiness:** confirm the Argentina legal/provider operating model, completion evidence, payout/legal posture, activation definition, and readiness gates for the horizontal product and the two acquisition cohorts. Define shared contracts and bounded-context ownership before implementation; complete legal/payment discovery for TUS collecting and settling funds.

**Stage 1 — Argentina functional MVP:** onboard organizations and staff; publish SEO-capable listings; support products and core services/appointments, including configured duration/day/hour services where applicable, separate product/service carts or commitments, TUS-managed delivery operations, desktop/web/PWA and mobile POS/manual operations, merchant administration, one approved payment path, TUS collection and context-sensitive settlement release, 10% configurable-base per-context completion commissions, bilateral dispute handling, customer notifications, and governed WhatsApp search-and-operate assistance.

**Stage 2 — Advanced operating adoption:** richer dashboard/POS, offline and hardware maturity, advanced inventory/resources and staff schedules, CRM, receipts/invoicing for the first country, refunds, reports, trust benefits, and stronger WhatsApp booking/order tracking. These expand Stage 1 rather than supply missing core capabilities.

**Stage 3 — Marketplace liquidity:** richer search/discovery, reviews, multi-provider comparison, availability-aware SEO, promotions, multiple payment/payout providers, fulfillment options, scaled dispute/support operations, and supply/demand matching metrics.

**Stage 4 — Adjacent commercial depth:** advanced services by hour/day with jobs and capacity, appointment variants, deeper delivery orchestration, offline reconciliation, imports, and integrations. Each is a separate bounded context using shared primitives; core configured duration/day/hour services remain Stage 1.

**Stage 5 — Country and ecosystem expansion:** country packs, localized taxes/payments/payouts, languages/currencies, partner/courier integrations, enterprise controls, and carefully approved secondary monetization.

**Launch decision:** TUS remains horizontal. Argentina acquisition begins with beauty/personal care excluding regulated healthcare and repairs/trades. These are acquisition cohorts, not shared-domain vertical models; the products + services combination and separate product/service commitments are confirmed.

### Success and marketplace health metrics

**Supply:** organizations created, onboarding completion, time to first published offering, active organizations, active providers, listing completeness, availability accuracy, coverage by location/category, and percentage of merchants with at least one supported capability activated.

**Demand and conversion:** qualified visitors, search-to-detail rate, detail-to-cart/quote/booking rate, checkout completion, booking completion, quote acceptance, customer acquisition cost where measurable, and supply-demand match rate.

**Merchant activation and adoption:** time to first value, first transaction, weekly active merchant/staff, catalog/stock/calendar usage, POS adoption, repeat operational sessions, staff task completion, and percentage of orders managed inside TUS rather than only external chat.

**Commercial:** GMV or gross booking/service value by context, commissionable volume, take rate, net revenue, payment success, refund/cancellation/no-show rate, payout timeliness, reconciliation exceptions, and contribution margin per transaction.

**Retention and customer value:** customer repeat purchase/booking, merchant retention, cohort retention, order frequency, lifetime value, reactivation, referral, and cross-capability adoption.

**Fulfillment and trust:** assignment/acceptance, on-time delivery/handoff, failed delivery/return/incident rates, service completion, customer confirmation latency, pending-without-response volume, dispute first response and resolution, chargebacks, fraud/abuse, review rate/quality, and complaint rate.

**WhatsApp:** opted-in active conversations, response latency, answer accuracy, search/quote/cart/action completion, containment rate, confirmation abandonment, failed action rate, human handoff rate, post-handoff resolution, opt-out/block rate, and tenant/data-boundary incidents (target zero).

Metrics MUST be segmented by transaction context, geography, tenant, channel, and lifecycle outcome. A high WhatsApp containment rate is not success if it increases cancellations, incorrect commitments, or unsafe automation.

**Metric terminology:** `first value` means the first completed end-to-end operation. More than 20 successfully completed services OR more than 20 successfully completed sales, subject to trust and risk checks, is `trust-benefit eligibility`/repeated activation; it is not first value and does not create automatic entitlement.

### Assumptions, conflicts, and high-value questions

#### Assumptions

- The factory's public ports and contracts are stable enough for TUS application packages to consume without modifying the core.
- TUS can begin with a limited country/payment configuration while preserving global-capable data semantics.
- Businesses will adopt operational workflows when marketplace demand or automation creates measurable value; a directory-only product is insufficient.
- A single organization may offer multiple capabilities, but each capability can have its own policy and lifecycle.
- Customers may interact without a full account initially, but commitment, payment, and sensitive support actions need progressively stronger identity.

#### Prior-context conflicts to resolve

- Historical MVP context targets B2B wholesalers in Argentina, offline/WhatsApp order completion, SaaS, SEO, advertising, and setup fees; the new intent prioritizes a global commission-led marketplace and operating system. Historical choices are inputs, not final decisions.
- Historical escrow and dynamic commission designs are valuable financial patterns, but escrow is not approved for TUS. Use fee snapshotting as a likely invariant and reconfirm custody/payout semantics legally.
- Historical `SuperApp_Vision` describes an intent-driven OS/browser unrelated to the TUS marketplace; it must not widen this change.
- The current repository product metadata still says `product-factory-core`/`tusservicios.com`; this is foundation metadata, not evidence that TUS application scope already exists.

#### Remaining launch/specification questions

1. Which Argentina legal/provider operating model, KYC/KYB, tax, reconciliation, segregation, payout, and country obligations permit launch?
2. What exact evidence, dispute, refund, chargeback, reserve, payout, reminder/disclosure, and configurable-local-release scenarios apply to each context?
3. What WhatsApp authentication, privacy, confirmation-expiry, replay, consent, role, and idempotency contracts are required?
4. Which AWS service, model, region/data boundary, activation, quota/cost, safety/evaluation, availability, and fallback matrix is acceptable?
5. Which Mercado Pago account/product/contract release, payout, and checkout constraints apply to the selected Argentina path? Validate directly; do not infer universal rules.

### Affected Areas

- `apps/api/src/tenancy/` — existing organization, workspace, role, membership, authorization, and tenant-context boundaries for TUS organizations and staff.
- `apps/api/src/admin/product-superadmin/` — existing product-level platform superadmin, policy, support-session, break-glass, and disablement boundaries; TUS operations must use rather than merge this with merchant roles.
- `apps/api/src/providers/mercado-pago/` — existing payment webhook/provider boundary with tenant isolation, idempotency, reconciliation, retries, and dead letters; TUS payment and commission contexts should consume its public contract.
- `apps/api/src/providers/whatsapp/` — existing signed, tenant-policy-aware WhatsApp transport/webhook boundary; TUS assistant policy and commercial actions belong above it.
- `apps/api/src/platform/` — existing jobs, outbox, events, audit, recovery, privacy, and operational contracts that support commerce workflows without owning TUS business rules.
- `packages/contracts/` — shared cross-runtime schemas and versioning for future TUS application contracts and events.
- `packages/providers/`, `packages/storage/`, `packages/queues/`, `packages/observability/`, `packages/config/` — neutral adapters and infrastructure consumed through public boundaries; do not add TUS concepts here.
- `apps/api/src/server.ts` and `apps/api/src/presentation/` — current API composition and route boundary; TUS application routes will eventually be composed here without placing domain rules in transport code.
- `apps/web/` — current web shell and API client; future marketplace, merchant, customer, and operations surfaces should remain thin clients of application contracts.
- `apps/mobile/` (when its actual app boundary is selected) — candidate staff/mobile and optional customer/fulfillment surfaces.
- `apps/workflow-runtime-python/` — candidate durable orchestration for long-running imports, notifications, reconciliation, and AI-assisted workflows, not the owner of commerce state transitions.
- `openspec/config.yaml` — current hybrid artifact configuration still reflects the neutral factory and must be revisited in a later proposal only if product metadata or testing rules need an approved change.

### Approaches

1. **Capability-composed marketplace operating system (recommended)** — Define shared primitives and explicit bounded contexts for product sales, appointments, services, TUS-managed delivery operations, desktop/PWA and mobile POS; compose capabilities per organization and expose them through marketplace, merchant, staff, customer, WhatsApp, and operations surfaces.
   - Pros: Preserves distinct lifecycles; supports broad vision without a universal state machine; reuses completed factory boundaries; enables incremental wedges and cross-capability merchant adoption; keeps legal and vertical policy explicit.
   - Cons: Requires more up-front domain vocabulary and context contracts; cross-context reporting needs deliberate design while MVP commitments remain separate.
   - Effort: High.

2. **Single generalized commerce entity/state machine** — Model every offering as a generic sellable resource with optional fields and one order/booking lifecycle.
   - Pros: Fast-looking initial schema; one generic API and UI vocabulary; easy demo across categories.
   - Cons: Collapses incompatible invariants around stock, time slots, labor, returns, and offline POS; creates branching policy code and unsafe state transitions; makes compliance, reporting, and future changes harder.
   - Effort: Medium initially, High and risky over time.

3. **Vertical-first products sharing only infrastructure** — Build separate product, booking, and service applications with little shared commercial domain.
   - Pros: Clear local workflows; vertical teams can optimize quickly; fewer cross-context abstractions.
   - Cons: Duplicates catalog, pricing, customer, payments, commissions, notifications, and merchant administration; weakens the marketplace and operating-system promise; increases migration and consistency costs.
   - Effort: High across the portfolio.

4. **Directory/lead-generation first** — Publish merchant pages and route leads to WhatsApp, postponing transactions and merchant operations.
   - Pros: Lowest initial integration and compliance burden; aligns with the earliest historical B2B wedge.
   - Cons: Does not solve operational fragmentation; weak commission economics; poor supply truth; difficult migration to bookings, POS, and reliable marketplace health later.
   - Effort: Low initially, but strategically insufficient.

### Recommendation

Advance to proposal with **Approach 1**. Define TUS as a capability-composed marketplace plus merchant operating system, with shared commercial primitives and separate bounded contexts/lifecycles. Use the existing factory only through its public tenancy, identity, policy, contracts, provider, job, outbox, audit, storage, and observability boundaries. Keep TUS logic in dedicated application/domain packages.

The proposal carries forward Argentina, the horizontal two-cohort launch, products + services, separate commitments, Stage 1 delivery/POS operations, TUS collection/settlement, the 10% configurable commission baseline with immutable snapshots, context-sensitive release, bilateral disputes, trust benefits, and the allowlisted WhatsApp boundary. It must resolve the Argentine legal/provider implementation, exact evidence/dispute/chargeback scenarios, payout/reserve policy, reminder/disclosure/support controls, WhatsApp auth/privacy/replay/typed-tool contracts, the AWS service/region/evidence matrix, Mercado Pago account/product constraints, and TUS fleet/POS readiness. The MVP should prove a complete loop from merchant onboarding and published supply through customer discovery, a real product or service commitment, TUS collection and merchant settlement accounting, explicit confirmation or an approved no-feedback baseline policy, risk/dispute freezes, delivery/POS operational handling, bilateral support, and governed WhatsApp assistance. It should not attempt all verticals or a global launch at once.

### Risks

- **Vision-to-MVP sprawl:** "almost any ordinary business" can produce an unbounded first release. Mitigate by constraining Stage 1 to the two acquisition cohorts and bounded contexts while preserving extension points.
- **Universal-model failure:** A generic entity/state machine could hide invalid transitions and create long-term migration debt. Mitigate with explicit bounded contexts and shared primitives only.
- **Marketplace cold start:** A merchant OS without demand or a marketplace without operational adoption may fail on either side. Measure supply activation, demand conversion, and daily merchant use together.
- **Payments and legal exposure:** Commission, refunds, payouts, escrow, tax, and merchant-of-record roles vary by country. Resolve legal/payment posture before implementing financial commitments; escrow remains unapproved.
- **Tenant and privilege leakage:** Multiple organizations, customer identities, staff roles, WhatsApp senders, and platform support sessions create high-impact isolation risk. Reuse and extend existing tenant/audit boundaries with contract tests.
- **WhatsApp automation harm:** Incorrect prices, availability, bookings, cancellations, or personal-data disclosure can damage trust. Enforce confirmation, consent, authorization, fresh rechecks, idempotency, safe failure, and handoff.
- **Operational complexity:** TUS-managed delivery, desktop/mobile POS, offline behavior, and service work each add distinct failure modes. Add them as bounded contexts with explicit readiness gates, not as optional fields in the first model.
- **Globalization overreach:** Global-capable architecture can become premature country abstraction. Use country packs and launch one jurisdiction at a time.
- **Factory contamination:** Adding TUS nouns or business policy to neutral packages would compromise reuse. Enforce import and ownership boundaries in proposal/design/tasks.
- **Metadata and repository ambiguity:** Existing project names and historical artifacts describe the factory or earlier B2B scope. Keep TUS application artifacts distinct and label historical decisions clearly.

### Ready for Proposal

**Yes, conditionally.** The vision is coherent enough for `sdd-propose`, provided downstream artifacts preserve the confirmed horizontal cohorts, Stage 1 capabilities, separate commitments, settlement/trust rules, and AWS/Groq transition while resolving only the remaining legal/provider, evidence/dispute/chargeback, WhatsApp contract, AWS matrix, and Mercado Pago validation questions. The next phase should not redesign or re-audit `product-factory-core`, and it should not claim escrow or custody licensing is solved or adopt subscriptions, ads, setup fees, or premium placement without separate approval.

### Linked research: POS surfaces and TUS-managed delivery

The focused research in [`research/pos-desktop-mobile-delivery-fleet.md`](research/pos-desktop-mobile-delivery-fleet.md) validates the Stage 1 surface and operations boundary without changing the confirmed vision. It recommends a complete web/PWA POS as the desktop parity baseline, Expo/React Native for staff, handheld POS/manual, and fulfillment workflows, and an explicit Electron/Tauri decision gate only after a hardware pilot demonstrates browser gaps. The research distinguishes cached reads from a real offline command/reconciliation ledger, and identifies the repository's existing mobile offline-query, runtime-config, API query, and outbox foundations without claiming POS is already implemented.

For delivery, the research keeps TUS responsible for zones, shifts, assignments, courier/operator access, proof, incidents, and support while excluding an open-driver marketplace, bidding, ride-hailing, rentals, and Uber-like autonomous dispatch. Delivery proof supports operational completion and disputes but does not release funds by itself; explicit customer confirmation is preferred, while approved context-sensitive no-feedback policies may apply after the relevant evidence. Any dispute, chargeback, fraud/risk signal, missing evidence, or unresolved incident freezes settlement regardless of elapsed time. Argentina data protection, consumer, labor/fleet safety, tax, provider, KYC/KYB, reconciliation, and payout obligations remain launch gates rather than silently resolved assumptions.
