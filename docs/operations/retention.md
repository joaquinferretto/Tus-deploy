# Retention and Deletion Operations

Retention schedules are tenant-scoped and consent-aware. A due record is either deleted or anonymized according to its schedule; active legal holds defer the operation. Propagation runs before the local tombstone/anonymization is committed, and failures remain retryable through the existing idempotent privacy request boundary.

## Recovery evidence

The recovery adapter records purged, anonymized, held, failed, and propagated counts. Deletion evidence records completion, idempotent replay, propagation count, tenant scope, and a redacted audit correlation. Evidence from deterministic fakes is `verified` with `liveConformance: false`; it does not imply that object storage, vector indexes, MongoDB, or cloud services were contacted.

## Deletion drill

1. Confirm the tenant, purpose, retention schedule, and legal-hold state.
2. Run deletion or retention through the privacy service and provider-neutral propagation port.
3. Verify all owned records are tombstoned/anonymized and propagation is tracked.
4. Repeat with the same idempotency key and confirm no duplicate deletion.
5. On a propagation failure, preserve the failed request and retry it after the boundary is available.

Do not purge a record under an active legal hold. Do not place raw credentials, personal payloads, `.env` values, or provider secrets in retention or recovery evidence.
