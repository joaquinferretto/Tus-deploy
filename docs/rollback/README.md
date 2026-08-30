# Rollback boundaries

This matrix is the common rollback contract for P6.7. Every operational action
stops unsafe intake first, preserves durable state, records redacted evidence,
and returns to the last passing version or verified restore point. Rollback
does not delete neutral contracts or hide failed work.

| Boundary             | Stop/preserve                                                | Roll back to                                                 | Follow-up                                                  |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------- |
| Provider disablement | Stop adapter intake; preserve ledger/outbox/DLQ.             | Disabled flag and last passing adapter/configuration.        | Reconcile, then explicit owner gate before re-enable.      |
| Migration rollback   | Stop traffic; preserve PostgreSQL ledger/outbox/idempotency. | Last compatible schema/application pair or verified restore. | Reconcile projections and readiness.                       |
| Job replay           | Stop consumer; preserve run ledger and DLQ.                  | Last passing worker/provider version.                        | Replay existing run once with idempotency and audit.       |
| Backup restore       | Isolate target; preserve source snapshot and other tenants.  | Last verified tenant-scoped snapshot.                        | Restore, reconcile, then scoped resume.                    |
| Secret rotation      | Revoke old value; preserve incident and scan evidence.       | Last passing config with a valid secret-store reference.     | Never re-enable an exposed value.                          |
| Profile rollback     | Stop traffic/intake; preserve all durable state.             | Last passing Render service or Terraform profile/state.      | Validate all five managed boundaries; no Compose fallback. |

## Invariants

- PostgreSQL-owned state, transactional outbox, run ledger, idempotency records,
  and DLQ remain recoverable throughout the operation.
- Cross-system consistency uses reconciliation, saga compensation, and
  idempotent replay; rollback never assumes distributed two-phase commit.
- Tenant and actor scope is retained. An empty restored collection means
  absence for that tenant only, not permission to delete another tenant.
- Evidence states whether it is deterministic, plan-only, authorized live, or
  unavailable/deferred. Missing, expired, failed, or live-unauthorized evidence
  yields `not-production-ready`; it never becomes a live claim.
- Secrets, `.env` values, raw provider payloads, and personal data are excluded
  from logs and evidence.

## Operator record

At minimum record `profile`, `boundary`, `operator`, `reason`, `versionBefore`,
`versionAfter`, `startedAt`, `completedAt`, `healthEvidence`,
`preservedLedger`, `preservedOutbox`, `preservedDlq`, `rollbackRef`, and
`liveConformance`. Use synthetic or opaque identifiers; never record secret
values.
