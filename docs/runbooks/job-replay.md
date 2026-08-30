# Job and DLQ replay runbook

The PostgreSQL run ledger and transactional outbox remain authoritative. Redis
or SQS/DLQ is at-least-once transport. Replay is explicit, tenant-scoped, and
idempotent; it never creates a new business request implicitly.

## Select and quarantine

1. Stop the affected consumer or provider boundary and record profile, worker
   version, operator, reason, and health evidence.
2. Select jobs by tenant, run identifier, and approved replay reason. Do not
   replay an unscoped queue listing or cross-tenant payload.
3. Confirm the run ledger status, idempotency key, request hash, attempt count,
   compensation state, and DLQ reason. Redact payloads in evidence.
4. Exclude cancelled, legally held, already completed, or non-idempotent work.
   Keep poison messages quarantined until the failure is corrected.

## Replay

1. Claim the replay operation with a recovery idempotency key.
2. Requeue the existing job/run once, preserving tenant, actor, correlation,
   lineage, and contract version. A repeated request returns `already_queued`.
3. Process with the bounded retry policy. A second deterministic failure returns
   the job to DLQ and marks the run recoverable; it is not silently dropped.
4. Reconcile acknowledgement, ledger status, outbox publication, result, and
   telemetry before resuming intake.

## Retry and recovery boundary

If a replay fails, stop the consumer, drain only unambiguous work, and keep
poison or provider-dependent messages quarantined. Retry from zero only after
the cause is resolved, an owner approves a new evidence window, and the same
tenant-scoped idempotency and correlation records are rechecked. A new attempt
must preserve the prior failure evidence and return to `not-production-ready`
when any readiness gate is unavailable.

## Evidence and rollback

Record selected job/run identifiers, tenant scope, replay request identifier,
before/after statuses, counts for replayed/already-queued/quarantined items,
and `liveConformance`. Classify deterministic replay as
`local-deterministic`, local PostgreSQL-backed replay as
`local-postgresql-http`, owner-authorized external replay as
`authorized-external`, and unavailable/invalid replay as `deferred`.
Local replay always has `liveConformance: false` and is not a production-ready
claim.

If replay causes new failures, stop the consumer, disable the failing provider
or version, preserve the ledger/outbox/DLQ, and return to the last passing
worker/profile. Use the same idempotency key for the recovery attempt; never
delete queue records to hide a failure.

## Rollback boundary

Revert the consumer/provider version and replay flag only. Preserve the job
contract, run ledger, outbox, DLQ, recovery evidence, and unrelated tenants.
