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

The repair requires a generated proof, not archive listing alone. With
`NODE_ENV=development` and the exact confirmation flag, run the explicit proof
command and then pass the same archive and proof to the repair command:

```text
node scripts/tus-migration-repair.mjs create-restore-proof --confirm-development-target --backup-id <backup-file> --restore-proof <proof-file>
node scripts/tus-migration-repair.mjs apply --confirm-development-target --backup-id <backup-file> --restore-proof <proof-file>
```

The proof command reads only the repository-root `.env` `DATABASE_URL`, creates
a unique isolated scratch database, validates the custom archive, and runs the
official PostgreSQL 16.2 `pg_restore` in `schema-only` mode with explicit
`--dbname=<scratch>`, `--no-owner`, `--no-acl`, and `--exit-on-error`. It records
the archive SHA-256/size, restore mode, scratch identifier, exit status, and a
read-only metadata check with `rowValuesRead=0`. The apply gate rechecks the
fingerprint and scratch metadata; missing, stale, mismatched, data-only, or
hand-written/list-only proof is rejected before the current target connection.

Do not print the archive/proof path when it contains sensitive context, archive
contents, URLs, credentials, or scratch connection details. Do not use
`--clean`, `--if-exists`, `DROP`, `TRUNCATE`, or `CASCADE`. A full-data restore is
not implied by this schema-only proof; any full-data timeout or schema conflict
remains an explicit limitation. If a post-commit metadata receipt is incomplete,
restore only into an isolated target under owner approval. Never restore over the
current development target as an undo mechanism.

## Rollback boundary

The boundary is the selected restore target, restore operation, recovery flag,
and its evidence. Preserve the source backup, neutral contracts, migrations,
unrelated tenant state, and prior verified evidence.
