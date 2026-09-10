# TUS pilot and go-live gate runbook

This is a provider-free, deployment-free operating contract for Argentina Stage
1. It is not a production approval. The checked-in default is
`status: not-production-ready` and `liveConformance: false`.

## Go/no-go sequence

1. Select one profile and scope (`render-native` / `argentina-stage-1`).
2. Refresh the capability matrix without reading secrets or contacting a
   provider. Every capability needs one current, owner-approved, direct record.
3. Reject expired, revoked, replayed, malformed, out-of-scope, or conflicting
   records. A deterministic test, local PostgreSQL result, manifest, build, or
   feature flag cannot become direct live evidence.
4. Evaluate the P0 gate. Any blocker is **no-go**. Record the exact blocker and
   user-owned input required to clear it.
5. Enable only a named canary tenant and customer cohort. Keep provider,
   payments, worker, delivery, and broad-launch flags false until their own
   gates pass.
6. Re-evaluate before each stage transition. Broad launch requires explicit
   direct evidence and an approved stage transition; it is never implied by a
   successful canary.

## Support procedure

- Record a redacted case ID, tenant/customer scope, actor, correlation ID,
  capability, profile, observed time, and evidence IDs.
- Do not request or paste tokens, payment payloads, connection strings, tax
  credentials, or personal data into the case.
- Confirm whether the issue is deterministic, real PostgreSQL, provider,
  browser/mobile, deployment, legal/tax, or external-blocked before routing it.
- Route database/schema/tenancy issues to Data Operations; payments/WhatsApp to
  Provider Operations; delivery/POS to Merchant Operations; billing/tax to
  Finance and Legal; web/mobile to Platform; deployment to Cloud Operations.

## Incident and P0 rollback

When a gate expires, is revoked, conflicts, replays, or fails:

1. **Stop intake** by disabling the affected flag and all dependent actions.
2. **Drain** only unambiguous work within a recorded timeout.
3. **Quarantine** ambiguous/provider-dependent work in its tenant-scoped DLQ;
   never delete it to hide the incident.
4. Preserve audit, evidence, ledger, outbox, DLQ, idempotency, retry, and
   correlation records. Financial correction is append-only compensation.
5. Select the last passing profile/application/schema pair and verify health and
   readiness before any scoped reactivation.
6. Create a new evidence window and fresh idempotency/replay identifiers; do
   not reuse a revoked decision.

## Backup and restore

- User-owned Data Operations must provide a verified, decodable, tenant-scoped
  backup reference, retention window, and restore owner.
- Restore into an isolated target first. Do not overwrite the source, reset,
  truncate, cascade-delete, or replay historical destructive migrations.
- Verify identity, tenancy, schema version, audit, idempotency, outbox, ledger,
  run ledger, events, projections, and recoverable work counts.
- Record restore command/artifact, target, revision, operator, timestamps,
  result, and rollback boundary. A static migration or backup manifest is not
  restore evidence.

## User-owned go-live inputs

The following remain explicit blockers until supplied and independently recorded:

- Restorable PostgreSQL backup, schema/lineage decision, and additive migration
  approval.
- Tenant/tenancy and POS/device operator sign-off for the named canary cohort.
- Mercado Pago intermediary, five-day settlement, webhook/refund/chargeback,
  KYC/KYB, and provider smoke evidence.
- WhatsApp sender/consent/template ownership and delivery operating owner.
- ARS invoice, tax/accounting, legal/privacy approval and tax-provider evidence.
- Render/Vercel/DNS/TLS/worker ownership, monitoring, on-call, incident,
  rollback, and backup/restore rehearsal evidence.
- Browser accessibility and Android/iPhone device/POS evidence.

No user-owned input is inferred from repository code, static tests, local fakes,
or disabled configuration.
