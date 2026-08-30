# Provider disablement runbook

Use this runbook when a provider adapter, managed boundary, credential gate,
quota, security finding, or readiness gate fails. Disablement is reversible and
does not remove neutral contracts or durable work.

## Procedure

1. Record the profile, provider boundary, adapter/configuration version,
   operator, reason, correlation identifier, and current health evidence.
2. Stop new intake for the affected capability before partial serving. Keep
   unrelated tenant and provider paths isolated.
3. Set the adapter to `disabled` and verify the deterministic fake or explicit
   `unavailable-deferred` disposition. Never silently substitute another
   provider or Compose.
4. Preserve PostgreSQL-owned business state, the transactional outbox, run
   ledger, retry metadata, and DLQ. Queue delivery is not the source of truth.
5. Allow in-flight work to finish only if its safety policy permits it; cancel
   or quarantine unsafe work with a redacted reason.
6. Reconcile pending, failed, and claimed work. Use
   `docs/runbooks/job-replay.md` for eligible replay after the boundary is
   healthy.
7. Re-run the relevant deterministic contract, security, and readiness checks.
    The result remains `not-production-ready` while a required live gate is
    missing, expired, or unauthorized.
8. For TUS, disable provider actions and release/fleet jobs independently;
   preserve route availability only when the publication gate remains valid.

## Re-enable gate

Re-enable only after the owner records a current profile-specific plan or
authorized smoke, security/quota checks, rollback reference, and health
evidence. The activation decision must name the exact adapter and version.
Do not broaden credentials to recover a disabled provider.

## Evidence record

Record `disabledAt`, `profile`, `boundary`, `reason`, `operator`, `version`,
`preservedLedger`, `preservedOutbox`, `preservedDlq`, `reconciliationResult`,
`replayReference`, `liveConformance`, the evidence class, and the next gate.
Use `local-deterministic` for provider-free checks, `local-postgresql-http` only
for an actually executed local PostgreSQL HTTP boundary,
`authorized-external` only for current owner-authorized evidence, and `deferred`
for missing or invalid evidence. Never record secret values, `.env` contents,
raw provider payloads, or personal data; a disabled provider remains
`not-production-ready`.

## Rollback boundary

Revert only the provider flag, adapter configuration, and this operational
record. Preserve contracts, migrations, ledger/outbox/DLQ state, unrelated
providers, and prior readiness evidence.
