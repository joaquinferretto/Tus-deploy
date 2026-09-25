# TUS Argentina launch evidence index

This index preserves evidence boundaries for the umbrella change. It does not
promote deterministic or static results to live, provider, database, device, or
production evidence.

| Phase | Artifact | Class | Status |
| --- | --- | --- | --- |
| 2 | `backend-evidence.md` | deterministic / external-blocked | static runtime/security contracts; live API and database deferred |
| 3–4 | `commerce-booking-evidence.md` | deterministic / external-blocked | in-memory catalog/calendar coverage; persistence deferred |
| 5 | `pos-evidence.md` | deterministic / external-blocked | durable POS domain/queue coverage; device and database deferred |
| 6 | `payment-evidence.md` | deterministic / provider external-blocked | payment/webhook policy coverage; provider smoke deferred |
| 7–8 | `payment-evidence.md` and `billing-evidence.md` | deterministic / external-blocked | communications, delivery, and billing boundaries; live owners deferred |
| 9 | `billing-evidence.md` | deterministic / legal external-blocked | ARS/accounting boundary; tax/accounting approval deferred |
| 10 | `web-evidence.md` | deterministic / browser external-blocked | web/PWA contracts; browser/deployment proof deferred |
| 11 | `mobile-evidence.md` | deterministic / mobile external-blocked | native contracts; device/emulator proof deferred |
| 12 | `deployment-operations-evidence.md` | deterministic / deployment external-blocked | checked-in cloud/operations contracts; recovery gates pass; no provider execution |
| 13 | `go-live-evidence.md` | deterministic / external-blocked | fail-closed P0 evaluator, capability matrix, staged flags, and rollback/runbook controls; no production readiness claim |

## Required live evidence not present

- Render API/web/worker smoke, Vercel ownership/build/runtime smoke, DNS/TLS
  resolution, CORS browser evidence, and production logs.
- Verified backup/restore, additive migration execution, PostgreSQL HTTP
  durability, provider/WhatsApp/tax/device evidence, and incident rehearsal.
- Direct pilot/go-live evidence for database/schema/tenancy/POS/payments/WhatsApp,
  delivery/billing/web/mobile/deployment, plus named tenant/customer activation
  authorization and broad-launch approval.

The next valid evidence must be owner-authorized, scoped to one profile and
capability, current, unrevoked, redacted, and accompanied by a rollback record.
