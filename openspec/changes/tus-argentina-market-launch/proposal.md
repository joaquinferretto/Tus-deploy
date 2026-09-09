# Proposal: TUS Argentina Market Launch

## Intent

Define TUS's broad, nationwide Argentina launch as a marketplace and merchant operating system, not a pilot. Connect commerce, durable POS, Mercado Pago, WhatsApp, own delivery, billing, and client surfaces without production claims before evidence.

## Scope

### In Scope
- Marketplace product/service sales; calendars, schedules, availability, booking rules; complete POS (cash, shifts, receipts, refunds, offline/replay/conflicts).
- Real Mercado Pago using the user’s intermediary model and five-day split: lifecycle, signed webhooks, refunds, chargebacks, reconciliation, settlement boundaries, and immutable ledger evidence.
- Mandatory WhatsApp; **Delivery propio**; billing, subscriptions, invoices, tax contracts; desktop/PWA, Android, iPhone; Render, Vercel, DNS, support, incident, database, and legal/accounting operations.

### Out of Scope / Non-goals
- Global rollout, pilot-only scope, open driver marketplace, financing, regulated healthcare, `Goldenrepo-js_py` (underscore sibling), and unverified legal/provider/compliance claims.
- Historical destructive migrations, reset, `db push`, truncate, cascade, untagged deletes, secret exposure, or treating code/tests/static manifests as production proof.

## Capabilities

### New Capabilities
- `tus-argentina-commerce`: marketplace, products, services, calendars, bookings, commitments.
- `tus-durable-pos`: cash, shifts, receipts, refunds, offline replay, conflicts, hardware.
- `tus-mercado-pago-settlement`: intermediary split, five-day policy, webhooks, refunds, chargebacks, reconciliation, ledger.
- `tus-whatsapp-delivery-billing`: WhatsApp, own delivery, invoices, subscriptions, tax contracts.
- `tus-launch-surfaces-operations`: web/PWA, native mobile, Render/Vercel/worker/DNS, support, incidents, launch evidence.

### Modified Capabilities
- `tus-backend-database-hardening`: additive lineage, exact money types, tenant/auth/security, observability, and launch gates.

## Approach

Run automatic sequential SDD slices in fresh sessions/worktrees: (1) database lineage/additive schema/exact money; (2) backend runtime/security/tenant/auth/observability; (3) catalog/commerce/services/calendar/booking; (4) durable POS; (5) Mercado Pago; (6) WhatsApp; (7) delivery; (8) billing/subscriptions/invoices/tax; (9) web/PWA; (10) native mobile; (11) Render/Vercel/worker/operations; (12) staging/pilot/go-live evidence. Preserve root `.env` `DATABASE_URL`; use 60s DB timeout + one retry, explicit development seed confirmation, and no historical destructive migrations. Chain worktrees; keep review units ≤400 authored lines. Review workload is high: every slice needs focused tests and evidence review.

## Current Blockers and Gates

Live PostgreSQL contains only `TusHardeningFixture`: no ledger/POS schema. Historical migrations contain destructive SQL. Additive repair waits for a restorable backup. Backend/runtime/POS/payment/provider/WhatsApp/delivery/billing/mobile/deployment evidence is incomplete. Legal/tax/privacy are user-stated defined but require verification. Any technical P0 blocks go-live. Gates require owner decisions/evidence for schema/restore, tenant/auth, money, provider/KYC, five-day settlement, webhooks/refunds/chargebacks, WhatsApp, delivery, tax/invoices, devices, security, operations, and support.

## Evidence Taxonomy, Rollback, and Success

Tag results `deterministic`, `real-PostgreSQL`, `browser/mobile`, `deployment`, `provider`, `legal/tax/privacy`, or `external-blocked`; never promote classes. Roll back by disabling capabilities, intake, provider calls, settlement/release, delivery, and billing jobs; preserve ledger/audit/outbox/DLQ/evidence and restore only a verified backup. Success means nationwide web/Android/iPhone flows, duplicate-free reconciliation, current gates, no P0, and reproducible staging-to-go-live evidence.

## Dependencies

- User-owned Mercado Pago intermediary agreement/five-day policy; provider configuration; restorable DB backup; tax/accounting rules; WhatsApp/delivery ownership; Render/Vercel/DNS access; support, incident, database, and legal owners.
