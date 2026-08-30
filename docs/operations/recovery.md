# Recovery and Restore Runbook

## Crash recovery

Stop intake for the affected profile, preserve PostgreSQL ledger/outbox/DLQ state, and run the deterministic reconciliation boundary. Expired worker claims become retryable and their run-ledger rows become `recoverable`; no queue record is treated as business truth.

## DLQ and ledger replay

Replay only tenant-scoped dead-letter jobs selected by an operator or an approved recovery policy. The replay operation is idempotent: a dead-letter job becomes pending once, the run becomes `replaying`, and repeated replay requests return `already_queued`. Reconciliation records pending events and recovered jobs before traffic resumes.

## Restore drill evidence

Every drill records the verified backup identifier, tenant, restore status, recovered jobs, recoverable runs, replay counts, pending events, profile, rollback boundary, and `liveConformance`. A deterministic local drill is not a production-readiness claim. Cloud restore smoke is activation-gated and must remain `unavailable-deferred` when paid resources or authorization are missing.

## Rollback

If restore or reconciliation fails, stop consumers, keep the ledger and DLQ intact, revert to the last verified restore point and last passing application/schema version, then retry only after the failure is recorded. Do not broaden credentials or silently fall back to another data store.
