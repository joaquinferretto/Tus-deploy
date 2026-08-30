# Migration rollback runbook

Use this procedure for a schema or migration release that fails validation,
readiness, reconciliation, or application health. PostgreSQL is the source of
truth; Mongo projections and queue delivery are rebuilt or replayed from
durable records rather than treated as rollback authority.

## Before changing state

1. Stop intake and record the migration version, application version, profile,
   operator, reason, and redacted health evidence.
2. Confirm the last passing application/schema pair and a verified backup
   reference. If either is absent, remain stopped and report
   `not-production-ready`.
3. Classify the migration as backward-compatible, reversible, or requiring a
   restore. Never guess at destructive down-migrations.
4. Preserve the PostgreSQL ledger, outbox, idempotency records, and DLQ. Keep
   the failed version available for diagnosis without serving it.

## Rollback

1. Select the last passing versioned profile/configuration.
2. Drain bounded in-flight work and quarantine failed or ambiguous jobs before
   changing the schema. Preserve their redacted reasons and correlation IDs.
3. Apply only the approved reverse migration or restore the verified snapshot
   into an isolated target. Do not run an unreviewed destructive command.
4. Verify schema compatibility, tenant ownership, constraints, indexes,
   migration history, and application health with deterministic checks.
5. Reconcile Mongo read models and object metadata from their owners. Replay
   eligible jobs only after `docs/runbooks/job-replay.md` confirms the request
   is idempotent.
6. Resume traffic gradually only when readiness evidence is current. Otherwise
   keep the profile disabled and retain `unavailable-deferred` evidence.

If rollback cannot establish a verified schema/backup pair, stop intake and
keep all affected work quarantined. Do not hide the failed migration by deleting
ledger, outbox, DLQ, or evidence records.

## Retry after rollback

Retry only after the owner confirms the cause is resolved and a new disposable
target/evidence window is approved. Re-run preflight and migration checks from
zero, create unique fixtures, and keep the failed migration evidence immutable
and separate from the new attempt. A retry failure remains
`not-production-ready` and follows this rollback procedure again.

## Evidence

Record the prior and selected versions, migration identifier, backup/restore
reference, affected tables or projections by name only, validation results,
operator, timestamp, rollback reason, and health result. No row contents,
credentials, `.env` values, or raw personal data belong in the record.

## Rollback boundary

The rollback boundary is the failed migration, its compatible application
version, migration evidence, and profile flag. Do not revert neutral contracts,
unrelated migrations, the run ledger, outbox, or DLQ.
