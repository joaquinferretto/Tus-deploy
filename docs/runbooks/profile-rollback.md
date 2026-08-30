# Profile rollback runbook

Use this runbook when a Render-native or AWS Terraform deployment fails plan,
readiness, smoke, security, cost, migration, or reconciliation checks. Profiles
are explicit; rollback never silently falls back to Compose or another
undeclared managed service.

## Procedure

1. Identify the exact profile (`render-native` or `aws-terraform`), release,
   Terraform/service configuration version, operator, reason, and redacted
   health evidence.
2. Stop traffic and new intake before partial serving. Preserve PostgreSQL
   state, transactional outbox, run ledger, and DLQ.
3. Select the last passing profile/configuration and verified backup. Confirm
   the five managed boundaries (PostgreSQL, MongoDB, Redis, object storage, and
   queues) still have an owner, configuration reference, fake/disabled state,
   and rollback path.
4. Revert the Render service configuration or select the versioned Terraform
   profile/state. Do not apply undeclared resources or create duplicate data
   stores.
5. Reconcile projections and durable work. Replay eligible jobs only through
   `docs/runbooks/job-replay.md`; restore data only through
   `docs/runbooks/backup-restore.md`.
6. Re-run plan/validation, security, recovery, and readiness checks. Resume
    only the profile and scope whose evidence returns to green.
7. For TUS, keep `TUS_ROUTES_ENABLED`, `TUS_PROVIDER_ACTIONS_ENABLED`,
   `TUS_RELEASE_JOBS_ENABLED`, and `TUS_FLEET_JOBS_ENABLED` disabled until the
   scoped readiness report is authorized.

## Profile-specific boundary

Render rollback selects the last passing native service configuration. AWS
rollback selects the last passing versioned Terraform module/environment state.
Both preserve the shared contracts and data ownership. Native local smoke and
deferred Compose are not substitutes for a failed cloud profile.

## Evidence

Record profile, previous/selected versions, changed boundaries, drift or
failure, operator, timestamp, health result, migration/backup references,
reconciliation/replay counts, and `liveConformance`. A plan-only or deterministic
rollback is `local-deterministic` with `liveConformance: false`; an actual local
PostgreSQL HTTP boundary is `local-postgresql-http`; an owner-authorized cloud
smoke is `authorized-external`; missing, expired, or unauthorized live evidence
is `deferred` and remains `not-production-ready`.

## Rollback boundary

Revert only the selected profile release, profile flags, and associated
runbook/evidence record. Preserve neutral contracts, migrations, ledger,
outbox, DLQ, unrelated profile state, and prior passing evidence.
