# Secret rotation runbook

Use this procedure for suspected exposure, expiry, invalidation, or scheduled
rotation. Real values belong only in the approved Render/AWS secret store. Do
not read, print, paste, or copy a secret, `.env`, token, certificate, or
provider payload into a command, log, prompt, artifact, or evidence record.

## Contain and rotate

1. Stop the affected profile or provider boundary and record only a redacted
   incident identifier, owner, scope, and time window.
2. Revoke the old value in its owning secret store. Invalidate derived sessions,
   role sessions, webhook signing windows, and queued work when applicable.
3. Issue a replacement in the smallest environment/service scope. Render to
   AWS bootstrap remains a secret-store reference with only `sts:AssumeRole`;
   workloads use temporary scoped role credentials.
4. Update the secret-store reference, not an inline value. Do not broaden IAM,
   provider permissions, region, quota, or session duration to bypass a gate.
5. Run staged/tracked scanning and deterministic policy checks. Output may
   identify a file or rule, but must never print a matching value.
6. Re-run the affected provider, profile, readiness, and recovery checks. Keep
   live smoke `unauthorized` or `unavailable-deferred` until explicitly
   approved evidence exists.

## Incident evidence

Record incident id, secret class (not its value), owning store, affected
profile/service, revoke and replacement timestamps, session invalidation result,
scan result, operator, approval reference, and rollback boundary. Review audit
logs without reproducing the secret. If removal from history is needed, use the
normal repository incident process and verify scans afterward.

## Failure and rollback

If the replacement fails, keep the old value revoked, disable the affected
provider, preserve ledger/outbox/DLQ state, and select the last passing
configuration that references a valid secret-store entry. Never roll back by
re-enabling an exposed value.

## Rollback boundary

Revert only the secret-store reference or provider flag after the replacement
is verified. Preserve scans, incident evidence, neutral contracts, durable
state, and unrelated profile configuration.
