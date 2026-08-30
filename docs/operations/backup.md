# Backup Operations

## Scope

Backups preserve PostgreSQL-owned identity, tenancy, audit, outbox, run-ledger, and job state together with explicitly owned projections and object metadata. The run-ledger remains authoritative; queue delivery is replayable transport and never the backup owner.

## Verification and restore drill

1. Capture a tenant-scoped `factory.recovery.v1` snapshot through the recovery port.
2. Verify that the snapshot can be decoded, is tenant-safe, and contains the expected state counts.
3. Restore only a verified snapshot into an isolated target or deterministic local fake.
4. Run reconciliation, replay eligible DLQ work idempotently, and compare run/event status counts.
5. Record operator, timestamp, backup identifier, state counts, drill result, rollback reference, and remaining deferred boundaries.

The deterministic backup adapter proves the workflow without reading credentials or contacting a provider. AWS Backup is represented by Terraform metadata only. Paid/live backup smoke remains disabled until credentials, resources, quota, owner approval, and authorized smoke evidence are all present.

All local and plan evidence states its live conformance explicitly; deterministic recovery is not live conformance.

## Evidence taxonomy

- `verified`: deterministic capture and restore drill passed; `liveConformance: false`.
- `cloud-plan-validation`: Terraform shape was validated without provisioning.
- `authorized-cloud-smoke`: permitted live backup/restore evidence after the activation gate passes.
- `unavailable-deferred`: a required credential, resource, quota, or approval is absent.

Never copy backup contents, secret values, `.env` values, provider payloads, or raw personal data into evidence. Rollback is the last verified restore point plus the prior application/schema version.
