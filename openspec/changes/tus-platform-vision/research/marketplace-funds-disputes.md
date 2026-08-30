# Marketplace funds release, disputes, evidence, reserves, refunds, chargebacks, and payouts

**Research date:** 2026-08-25  
**Scope:** Mature marketplace patterns relevant to TUS products, services, explicit completion confirmation, pending funds, bilateral disputes, provider-administered settlement, and a legally gated TUS-administered alternative.

## Executive conclusion

The most reusable pattern is not “hold money for five days, then release it.” Mature platforms combine:

1. a transaction-specific completion or eligibility event;
2. an explicit review/dispute window or support path;
3. evidence tied to the commercial commitment;
4. risk, KYC/KYB, reserve, and payout controls outside the happy path; and
5. compensating financial entries for refunds, disputes, chargebacks, and corrections.

This supports the current TUS policy: explicit customer confirmation releases an eligible pending settlement immediately; approved no-feedback baseline policies may release services after 12 hours following completion evidence, online orders/long shipments after 24 hours following accepted delivery evidence, and simple/local internal delivery under a more lenient configurable context/risk policy. Any dispute, chargeback, fraud/risk signal, missing evidence, or unresolved incident freezes the relevant settlement regardless of elapsed time. Reminders, clear disclosure, evidence, dispute opening, and auditable support review remain required protection controls. This does **not** establish that TUS may hold customer funds, operate escrow, or administer payouts in Argentina without provider and legal approval.

The comparison below describes external platform patterns only; its review windows, payout behavior, and recovery mechanisms are not TUS defaults and must not be copied as universal rules. TUS's active rule is confirmation-first and context-sensitive: approved 12-hour, 24-hour, or configurable-local no-feedback release is permitted only with valid evidence, no dispute, and no risk or unresolved incident.

The MVP commission baseline is 10%, configurable by product, service, context, and risk. Each operation immutably snapshots the applied rate, rule version, commissionable base, and calculated amounts. More than 20 successfully completed services or sales may qualify a merchant for trust benefits; that eligibility is distinct from the baseline release windows and is not an automatic early-payout rule.

## Comparison of observed marketplace patterns

| Platform | Release/completion signal | Dispute/evidence pattern | Risk, reserve, or recovery signal | TUS lesson |
|---|---|---|---|---|
| Airbnb | Payout timing varies by reservation type. Current payout guidance distinguishes services/experiences from stays and says transactions may be reviewed, delayed, paused, or removed; reviews can delay a payout up to 45 days after check-in. | Resolution Center / support processes allow a complaining party to submit a request, notify the other party, collect a response, and escalate for platform review. Damage guidance calls for photos/videos, estimates, and receipts. | Airbnb may delay a payout while a refund decision is pending and may recover refunds or other amounts from future payouts. | Release policy and risk review are separate. Evidence must be time-bounded, attributable, and recoverable; a payout can be released and still be subject to later recovery.
| Upwork fixed-price milestones | Client reviews a submitted milestone and may approve/release or request changes. The current help article says the deposited funds auto-release after 14 days without client action. | Workroom submission, review, change request, refund request, and dispute are linked to a specific milestone and deliverable. | Only one milestone is funded at a time; partial release and refund/dispute paths are explicit. | A service commitment needs a bounded deliverable, submission, review, change-request, and dispute model. TUS uses its own context-sensitive release policy rather than copying this provider rule.
| Etsy | Buyer can open a case after delivery-window and seller-contact prerequisites. Etsy reviews the order and may refund when Purchase Protection criteria are met. | Case log is the system of record; shipping status, tracking, listing description, photos, comments, and requested information can determine the outcome. | Purchase Protection can cover part of a refund while Etsy may charge the seller/payment account; protection is not insurance or a guarantee. | Use structured evidence and a case log, separate platform protection from seller liability, and model recovery/recoupment explicitly.
| Stripe Connect | Connect provides payment routing and payout primitives, not a universal marketplace completion policy. Manual payouts delay payouts but are explicitly not escrow; holding periods and availability depend on country/account configuration. | Disputes are provider/network events. The relevant balance can be debited, and platform/connected-account responsibility depends on charge type and Connect configuration. | Pending/available balances, `connect_reserved`, negative balances, verification, capabilities, and payout controls matter. | TUS must model provider state separately from business completion and retain a reserve/negative-balance/recovery design. A provider payout delay is not a substitute for TUS dispute policy.
| Mercado Libre / Mercado Pago | Public developer material exposes sales, shipments, claims, claim resolution/evidence, returns, reputation, payments, and checkout integration areas. Exact marketplace release/hold rules are not established by the public pages reviewed. | The developer navigation indicates claim, resolution, evidence, shipment, and return workflows, but public pages do not justify copying an undocumented internal rule into TUS. | Account/product eligibility, payout timing, reserves, chargeback handling, and marketplace-specific contractual rules require direct account/product validation. | Treat Mercado Libre as a source of workflow vocabulary, not as proof of Mercado Pago capabilities or TUS legal treatment.

## Detailed findings

### 1. Completion and release must be separate state machines

Provider payment state (`authorized`, `captured`, `refunded`, `disputed`, `chargeback`) is not the same as commercial state (`accepted`, `scheduled`, `started`, `fulfilled`, `completed`, `cancelled`). Stripe Connect makes this separation unavoidable because charge type controls fund routing and negative-balance responsibility, while provider disputes can happen after a commercial event appears complete.

For TUS, each bounded context should emit completion evidence and a settlement eligibility decision. The ledger should preserve at least:

- gross amount, discounts, tax, delivery/pass-through amounts, and currency;
- immutable commission rule/version and calculated platform/provider net;
- commercial context and commitment identifiers;
- completion evidence references and attester identity;
- settlement status, payout instruction/status, reserve/hold reason, and reconciliation references;
- refund, dispute, chargeback, adjustment, and recovery entries as compensating records.

The original financial record must not be rewritten when an outcome changes.

### 2. Explicit confirmation and bounded no-feedback release

Airbnb and Upwork demonstrate platform-managed review/release paths, while Upwork also demonstrates time-based automatic release after a review window. TUS adopts bounded, context-sensitive no-feedback release only for the approved baseline policies and keeps risk/dispute blocks absolute. Therefore:

- customer/service-user confirmation is the preferred positive release event and releases immediately when eligible;
- services may release after 12 hours following completion evidence, and online orders/long shipments after 24 hours following accepted delivery evidence, only when there is no feedback or dispute;
- simple/local internal delivery uses a more lenient configurable context/risk policy, with no fixed duration selected in this artifact;
- reminders, disclosure, evidence collection, dispute opening, and support review surround release; any dispute, chargeback, fraud/risk signal, missing evidence, or unresolved incident freezes the affected settlement;
- any support resolution records who decided, under which policy version, using which evidence, and what compensating entries were posted.

This preserves protection while reducing avoidable pending-balance friction through bounded policies. Operational cost, reminder effectiveness, disclosure comprehension, and false-release risk must be measured rather than hidden in a scheduler. These release windows are baseline policy, not trust-based early payout.

### 3. Evidence should be context-specific and bilateral

The mature patterns reviewed do not rely on a single generic “proof” object:

- product delivery needs tracking, delivery address, handoff/receipt, item condition, and return evidence;
- appointments need booking identity, check-in/start evidence, provider attendance, completion confirmation, cancellation/no-show facts, and any customer response;
- duration/day/hour services need scope, quote/version, assignment, start/stop or worklog evidence, deliverable submission, change requests, acceptance, and communication history;
- TUS-managed delivery needs assignment, pickup, handoff, timestamps, location/recipient controls, incident records, and return/failure evidence;
- POS/manual/offline transactions need operator, shift/device, local capture, sync/reconciliation, receipt, and void/refund evidence.

Evidence must be append-only or versioned, tenant-scoped, access-controlled, retention-aware, timestamped, actor-attributed, and linked to the exact commitment/line/fulfillment task. WhatsApp content can be evidence only when provenance, consent, identity, tenant routing, and retention are reliable; a transcript alone should not silently prove completion.

### 4. Dispute flow and no-response flow are different

Recommended TUS lifecycle:

```text
pending_completion
  -> released                     (explicit eligible confirmation)
  -> pending_no_response          (policy evaluation/reminders; release only where approved)
  -> disputed                     (either side opens a supported dispute)
  -> evidence_collection
  -> mediation_or_support_review
  -> resolved_release | partial_refund | full_refund | provider_adjustment | escalated
```

`chargeback` is a separate provider/network event that can attach to any financially relevant state and must not be treated as an ordinary customer dispute. Refund and chargeback recovery can create a merchant receivable, consume an approved reserve, or require future-payout offsetting, subject to the legal/provider model.

AI may classify, summarize, detect missing evidence, and propose next actions. It must not be the sole decision-maker for a high-impact refund, account restriction, payout seizure, or dispute outcome.

### 5. Reserves are a risk control, not a release rule

Stripe’s pending/available balances and `connect_reserved` concept, Airbnb’s delayed/recovered payouts, and Etsy’s seller-account recoupment illustrate why a marketplace needs a post-completion recovery model. They do not justify an arbitrary TUS reserve percentage.

Any TUS reserve policy requires explicit approval of:

- trigger criteria and segmentation (new provider, high-risk category, dispute/chargeback history, failed reconciliation, identity/KYB status);
- amount, currency, maximum duration, release conditions, and review rights;
- whether the provider or TUS bears negative balance risk;
- accounting treatment, merchant statements, tax/invoice effects, and reconciliation;
- customer-funds, custody, insolvency, and regulatory implications in Argentina.

Until approved, reserve is a specification question and not an implementation assumption.

### 6. Provider-administered versus TUS-administered settlement

**Provider-administered path (preferred):** use an approved marketplace/payment product where merchant onboarding, KYC/KYB, fund routing, payout, refunds, chargebacks, and provider responsibility are contractually supported. TUS still owns its commercial completion, commission snapshot, dispute case, evidence, and reconciliation records.

**TUS-administered path (legally gated):** TUS collects customer funds, maintains internal settlement accounting, and later pays merchants. This requires a country/provider operating design covering merchant-of-record or marketplace role, customer-funds handling, segregation/custody questions, KYC/KYB, sanctions/fraud, taxes/invoicing, reserves, refunds, chargebacks, payout failure, reconciliation, privacy, audit, support, and insolvency exposure.

The current public Mercado Pago material reviewed does not establish that a generic Checkout API account provides a compliant five-day hold/release, marketplace split, escrow, or TUS-controlled payout mechanism. Validate the exact Argentina account, product, contract, and permissions directly with Mercado Pago before specifying an implementation.

## Stress test against TUS’s context-sensitive release policy

| Scenario | Required behavior | Financial implication |
|---|---|---|
| Buyer confirms completed service | Mark context complete, release eligible settlement, earn the snapshotted commission, emit reconciliation event. | Positive settlement entry; retain evidence and immutable snapshot.
| Buyer does not respond | Remind, disclose the applicable policy, offer dispute/support opening, and release only under the approved context policy: 12h after service evidence, 24h after accepted online/long-shipment delivery evidence, or configurable local-delivery policy. | Baseline release can reduce aging; risk/dispute/evidence incidents remain frozen and operations need auditable controls.
| Provider claims completion, buyer disputes | Freeze affected settlement; collect bilateral evidence; mediate/support-review; record decision. | No payout movement until policy outcome; any partial result uses compensating entries.
| Customer requests refund after release | Open refund policy path; provider/accounting recovery may be required. | Refund, commission reversal/adjustment, merchant receivable or offset, and audit trail.
| Card/network chargeback after release | Attach provider dispute; preserve evidence; follow provider deadline and responsibility model. | Provider debit/reserve/negative balance may differ from TUS commercial outcome.
| Provider fails KYC/KYB or payout | Block/hold payout according to provider/legal rules; notify and support remediation. | Do not silently mark the commercial commitment incomplete; separate payout readiness from completion.
| TUS/provider reconciliation mismatch | Quarantine affected records and reconcile from provider plus internal ledger evidence. | No destructive correction; create adjustment and exception records.

## Recommended TUS specification boundaries

The next proposal/spec/design should define:

1. context-specific completion evidence contracts for products, appointments, services, delivery, and POS;
2. explicit confirmation authentication, expiry, replay protection, and actor authority;
3. pending/no-response aging, reminder, manual-review, and support queues;
4. bilateral dispute opening, evidence submission, mediation, escalation, SLA, and final-decision records;
5. refund, chargeback, reserve, recovery, negative-balance, and payout-failure compensating entries;
6. provider-versus-TUS responsibility boundaries and reconciliation invariants;
7. a country/provider readiness gate that blocks production claims about custody, escrow, split payments, payout timing, or a five-day maximum until validated;
8. separate product/service commitments and separate commission snapshots, with the 10% configurable MVP base and immutable rate/version/base/amount fields, consistent with the exploration;
9. context-sensitive 12h/24h/configurable-local release policies, reminders, disclosure, dispute opening, support review, and absolute risk/dispute freezes.

## Source register and verification notes

All links below are official first-party sources or official developer documentation entry points. Retrieved/checked 2026-08-25.

- Airbnb Terms and linked Resolution Center/payment policies: <https://www.airbnb.com/help/article/2908>
- Airbnb host damage evidence and response flow: <https://www.airbnb.com/help/article/279>
- Airbnb payout timing, review delays, and payment-method processing: <https://www.airbnb.com/help/article/425>
- Upwork fixed-price milestone submission, review, change request, dispute/refund, and 14-day no-action release: <https://support.upwork.com/hc/en-us/articles/211068218-How-to-use-milestones-in-fixed-price-jobs>
- Etsy buyer case resolution, evidence, Purchase Protection, and seller-account recoupment: <https://help.etsy.com/hc/en-us/articles/360016126873-How-to-Resolve-a-Case-from-a-Buyer>
- Stripe Connect charge types and responsibility boundaries: <https://docs.stripe.com/connect/charges>
- Stripe manual payouts and the explicit non-escrow limitation: <https://docs.stripe.com/connect/manual-payouts>
- Stripe account balances, pending/available funds, and `connect_reserved`: <https://docs.stripe.com/connect/account-balances>
- Stripe disputes and balance debits: <https://docs.stripe.com/disputes>
- Stripe identity verification and connected-account requirements: <https://docs.stripe.com/connect/identity-verification>
- Stripe account capabilities: <https://docs.stripe.com/connect/account-capabilities>
- Mercado Pago Argentina developer documentation entry point: <https://www.mercadopago.com.ar/developers/es/docs>
- Mercado Pago Argentina API/reference entry point: <https://www.mercadopago.com.ar/developers/es/reference>
- Mercado Pago Checkout API entry point: <https://www.mercadopago.com.ar/developers/es/docs/checkout-api/landing>
- Mercado Libre Argentina developer API documentation: <https://developers.mercadolibre.com.ar/es_ar/api-docs>
- Mercado Libre sales-management entry point: <https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas>

### Verification limitations

- The reviewed public material does not prove a universal Mercado Pago five-day release/hold maximum. Engram observation `#9063` records the same conclusion from the prior research pass.
- Mercado Libre’s public developer navigation exposes claims, resolution, evidence, returns, reputation, shipment, and payments areas, but several deep links were unavailable, dynamic, or returned 404 during retrieval. Do not infer exact marketplace policy, reserves, buyer nonresponse behavior, or chargeback allocation from navigation labels.
- Provider documentation describes provider capabilities and responsibilities, not TUS’s Argentine legal classification. Legal/provider validation remains a launch gate.
