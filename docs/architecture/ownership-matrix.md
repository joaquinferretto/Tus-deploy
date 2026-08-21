# Data and Capability Ownership Matrix

| Boundary | Single owner | Contract | Allowed projection | Rebuild / failure rule | Security owner | Cost owner | Evidence gate |
|---|---|---|---|---|---|---|---|
| Identity, tenancy, authorization | PostgreSQL/Neon | identity/tenancy schemas | outbox projections | source commits first; reconcile projections | Identity | Platform | owner test |
| Audit/security events | PostgreSQL/Neon | audit event schema | redacted analytics only | append-only event recovery | Security | Platform | redaction test |
| Quotas, idempotency, outbox, run ledger | PostgreSQL/Neon | ledger schemas | transport delivery state | replay from ledger; never queue-owned | Platform | Runtime | duplicate/crash test |
| Assigned documents/read models | MongoDB | document ownership contract | explicitly named read models | session transaction and rebuild job | Data | Data | session/reconcile test |
| Durable assets/source documents | B2 | asset/lineage schemas | transient encrypted S3 staging only | lineage-based reprocess; no permanent S3 source | Storage | Storage | lineage/delete test |
| Vector/retrieval metadata | PostgreSQL/PGVector | retrieval contract | cache projections | rebuild from B2 lineage | Runtime | AI | filter/reindex test |
| Local job transport | Redis | claim/ack contract | none as source of truth | claim/ack/retry reconciles to ledger | Runtime | DX | local delivery test |
| Production job transport | SQS + DLQ | claim/ack contract | none as source of truth | poison messages remain replayable | Runtime | Operations | DLQ test |
| Configuration | profile secret store | runtime config contract | redacted evidence schema | fail fast on missing production refs | Security | Operations | startup test |
| Telemetry | OTel-compatible ports | telemetry ports | CloudWatch-compatible export | metadata only; no payload secrets | Operations | Operations | correlation/redaction test |

No distributed two-phase commit is permitted. Cross-boundary work uses an
outbox, idempotency key, saga/compensation, durable run state, and reconciliation.
