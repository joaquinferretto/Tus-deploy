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

## Active managed-service boundary matrix

Render-native and AWS Terraform are the active cloud-native profiles. The same
five boundaries are represented in each profile, but configuration references,
managed adapters, and evidence remain profile-specific. References below are
synthetic names only; real values stay in Render or AWS secret stores.

| Profile | Boundary | Configuration reference | Mode | Single owner | Rollback / failure rule | Activation gate | Evidence class |
|---|---|---|---|---|---|---|---|
| Render-native | PostgreSQL | `render.secret-store.database-url` | managed | Data Platform | last passing schema and verified backup | endpoint, secret ref, backup, quota, authorized smoke | `cloud-plan-validation` or `authorized-cloud-smoke` |
| Render-native | MongoDB | `render.secret-store.mongodb-uri` | managed/fake | Document Data | restore or rebuild projections with reconciliation | owner, network, retention, backup, authorized smoke | `cloud-plan-validation` or `unavailable-deferred` |
| Render-native | Redis | `render.secret-store.redis-url` | managed/fake | Runtime | disable consumers; replay PostgreSQL ledger | retry, quota, secret ref, authorized smoke | `cloud-plan-validation` or `unavailable-deferred` |
| Render-native | Object storage | `render.secret-store.object-storage-ref` | managed/fake | Assets | revert adapter; reconcile versioned objects | policy, encryption, lifecycle, authorized smoke | `cloud-plan-validation` or `unavailable-deferred` |
| Render-native | Queues | `render.managed-queue-ref` | managed/fake | Runtime | stop intake; replay ledger/outbox/DLQ idempotently | queue policy, retry, quota, authorized smoke | `cloud-plan-validation` or `unavailable-deferred` |
| AWS Terraform | PostgreSQL | `aws.secrets-manager.database-url` | managed | Data Platform | last passing schema and verified backup | endpoint, secret ref, backup, quota, authorized smoke | `cloud-plan-validation` or `authorized-cloud-smoke` |
| AWS Terraform | MongoDB | `aws.secrets-manager.mongodb-uri` | managed/fake | Document Data | restore or rebuild projections with reconciliation | owner, network, retention, backup, authorized smoke | `cloud-plan-validation` or `unavailable-deferred` |
| AWS Terraform | Redis | `aws.secrets-manager.redis-url` | managed/fake | Runtime | disable consumers; replay PostgreSQL ledger | retry, quota, secret ref, authorized smoke | `cloud-plan-validation` or `unavailable-deferred` |
| AWS Terraform | Object storage | `aws.terraform.s3-output-ref` | managed/fake | Assets | revert adapter; reconcile versioned objects | policy, encryption, lifecycle, authorized smoke | `cloud-plan-validation` or `unavailable-deferred` |
| AWS Terraform | Queues | `aws.terraform.sqs-dlq-output-ref` | managed/fake | Runtime | stop intake; replay ledger/outbox/DLQ idempotently | queue policy, retry, IAM, quota, authorized smoke | `cloud-plan-validation` or `unavailable-deferred` |

Native local uses `native-smoke` evidence and never substitutes Compose. A
missing cloud credential, resource, quota, or owner approval is
`unavailable-deferred`; it is not live conformance.
