# Backup restore runbook

Use only a verified, tenant-scoped backup snapshot. The deterministic adapter
proves capture, verification, restore, and reconciliation without contacting a
cloud provider or reading credentials. Cloud backup/restore smoke remains
activation-gated.

## Restore drill

1. Stop intake for the affected profile and record the operator, profile,
   reason, backup identifier, and last passing application/schema version.
2. Confirm the snapshot is `verified`, decodable, tenant-scoped, within its
   retention window, and free of secret or raw personal-data evidence.
3. Restore into an isolated target or deterministic fake first. An empty
   tenant collection must restore absence for that tenant without deleting
   another tenant's state.
4. Verify counts and ownership for PostgreSQL identity/tenancy/audit,
   idempotency/outbox, run ledger, jobs, events, projections, and object
   metadata.
5. Reconcile claims and pending events. Mark crashed work recoverable and
   replay eligible DLQ entries through `docs/runbooks/job-replay.md`.
6. Compare pre/post status counts and run deterministic health/readiness checks.
   Resume only the restored scope after the evidence is accepted.

## Evidence classes

- `local-deterministic`: deterministic restore drill passed; `liveConformance: false`.
- `local-postgresql-http`: an actually executed local PostgreSQL HTTP restore/recovery boundary; it is not managed-service evidence.
- `authorized-external`: explicitly authorized live restore with current owner approval and resource evidence for the exact profile and scope.
- `deferred`: credential, resource, quota, tooling, or approval is missing; no live or production-readiness claim.

Record snapshot id, tenant scope, restore target class, state counts,
reconciliation and replay counts, operator, timestamp, expiry, rollback
reference, and deferred boundaries. Never copy backup contents, endpoints,
credentials, `.env` values, or provider payloads into evidence.

## Failure and rollback

If restore or reconciliation fails, stop consumers, retain the original ledger,
outbox, and DLQ, and return to the last verified restore point and passing
application/schema version. Do not overwrite the source backup or silently
restore another tenant.

## Live schema conformance repair

Before `tus-live-schema-conformance-repair`, verify a non-empty custom-format
archive with `pg_restore --format=custom --list`. The archive is a gate only;
do not print its path, contents, URL, or credentials. If a post-commit metadata
receipt is incomplete, restore only into an isolated target under owner approval.
Never restore over the current development target as an undo mechanism.

## Rollback boundary

The boundary is the selected restore target, restore operation, recovery flag,
and its evidence. Preserve the source backup, neutral contracts, migrations,
unrelated tenant state, and prior verified evidence.
