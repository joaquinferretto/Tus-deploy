# Phase 13 pilot/go-live evidence

## Decision

**Go/no-go: NO-GO.** This is the final static/runtime-gate slice only. No
database, provider, browser/mobile device, service, Docker, cloud, deployment,
migration, seed, backup, restore, or production traffic was started or
contacted. The evaluator default is `status: not-production-ready` with
`liveConformance: false`.

## Capability/readiness matrix

| Capability | Current status | Evidence class | Direct evidence | Exact blocker | User-owned input |
| --- | --- | --- | --- | --- | --- |
| database | blocked | external-blocked | no | `database:direct-evidence-required` | verified restorable PostgreSQL backup and scoped target |
| schema | blocked | external-blocked | no | `schema:direct-evidence-required` | additive lineage/schema approval |
| tenancy | blocked | external-blocked | no | `tenancy:direct-evidence-required` | tenant isolation and owner sign-off |
| POS | blocked | external-blocked | no | `pos:direct-evidence-required` | named device/operator pilot evidence |
| payments | blocked | external-blocked | no | `payments:direct-evidence-required` | Mercado Pago agreement, policy, and sandbox/provider smoke |
| WhatsApp | blocked | external-blocked | no | `whatsapp:direct-evidence-required` | sender, consent, template, and provider ownership |
| delivery | blocked | external-blocked | no | `delivery:direct-evidence-required` | own-delivery operator, zone, proof, and incident evidence |
| billing | blocked | external-blocked | no | `billing:direct-evidence-required` | ARS invoice/tax/accounting approval |
| web | blocked | external-blocked | no | `web:direct-evidence-required` | browser/accessibility and hosted-surface smoke |
| mobile | blocked | external-blocked | no | `mobile:direct-evidence-required` | Android/iPhone/POS device evidence |
| deployment | blocked | external-blocked | no | `deployment:direct-evidence-required` | Render/Vercel/DNS/TLS/worker and operations evidence |

## Evidence separation

The evaluator keeps these classes separate and never promotes one into another:

- `deterministic`: focused tests, static contracts, source review, and local
  fakes. It proves repository behavior only.
- `real-postgresql`: an actually executed authorized PostgreSQL HTTP/recovery
  boundary. It does not prove managed production durability.
- `provider`: owner-authorized Mercado Pago, WhatsApp, delivery, or billing
  provider smoke with redacted receipts.
- `browser/mobile`: browser accessibility, web rendering, native device, POS,
  offline/recovery, and receipt evidence.
- `deployment`: named Render/Vercel/worker/DNS/TLS/monitoring/rollback smoke.
- `legal/tax`: owner-approved Argentine legal, privacy, tax, invoicing,
  accounting, KYC, or KYB record.
- `external-blocked`: missing or unavailable user-owned evidence; this is the
  current class for every capability above.

## Gate and flag result

The Phase 13 evaluator has a fail-closed P0 gate. Expired, revoked, replayed,
conflicting, deterministic-only, malformed, or out-of-scope records remain
blockers. Same-key decisions replay the first decision; a different request hash
is a conflict and cannot overwrite it. A P0 rollback stops intake, drains and
quarantines work, preserves audit/evidence/ledger/outbox/DLQ/idempotency, and
uses append-only compensation (`destructiveRollback: false`).

Default and current flags:

```text
providers=false
payments=false
worker=false	delivery=false
broadLaunch=false
liveConformance: false
```

Activation is staged by explicit tenant and customer allowlists (`canary` or
`pilot`). Broad launch requires direct evidence and an explicit authorized stage;
it is not inferred from deterministic tests or a canary result.

## Focused TDD evidence

| Stage | Exact result |
| --- | --- |
| RED | `node scripts/test-runner.mjs tests/foundation/p13-pilot-go-live.test.mjs` failed before implementation because `scripts/launch/pilot-readiness.mjs` and the Phase 13 evidence/runbook files were absent. |
| GREEN | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p13-pilot-go-live.test.mjs` — exit 0; 9 passed, 0 failed. |
| REFACTOR | The same 9-test suite covers all capability keys, safe flags, P0 expiry/revocation/conflict/idempotency/replay/rollback paths, staged activation, and evidence separation. |

## Work unit evidence

| Evidence | Exact result |
| --- | --- |
| Focused test command | Pinned Node runner above — exit 0; 9 passed, 0 failed; under 180 seconds. |
| Runtime harness | N/A by explicit boundary: Phase 13 is a provider-free deterministic gate; no API, worker, PostgreSQL, provider, browser/mobile, Docker, cloud, deployment, migration, seed, backup, or restore runtime was started. |
| Rollback boundary | Revert `scripts/launch/pilot-readiness.mjs`, `tests/foundation/p13-pilot-go-live.test.mjs`, `docs/runbooks/tus-pilot-go-live.md`, this evidence, the Phase 13 evidence-index row, and the Phase 13 task/progress additions only. Preserve all prior phase implementation/evidence and the `Goldenrepo-js_py` exclusion. |

## Exact blockers and next owner actions

The no-go blockers are all eleven matrix rows, plus the absence of a verified
backup/restore rehearsal, provider and legal/tax approvals, browser/mobile/POS
evidence, and production-operations sign-off. These are user-owned inputs, not
invented repository facts. The next valid step is a separately authorized,
profile-scoped verification pass that records direct evidence and rollback
receipts; do not claim production readiness from this artifact.

## P1 remediation reconciliation

The current launch evidence is reconciled to the latest bounded remediation
pass without changing the decision or promoting fixture-only proof:

- Implementation tasks: `14/14` complete in `tasks.md`.
- Direct launch evidence: `0/11` capability rows; all remain `blocked` and
  `external-blocked`.
- `liveConformance: false`, `broadLaunch: false`, `providers: false`,
  `payments: false`, `worker: false`, and `delivery: false` remain authoritative.
- The scoped `TusHardeningFixture` PostgreSQL seed/inventory evidence is not
  launch-schema, ledger, backup/restore, durability, or production evidence and
  is not promoted by this reconciliation.
- Deterministic P1 remediation is green for marketplace JSON boundaries, web
  production page generation/build, and the tracked security scan; those results
  remain deterministic evidence only.

## Target-Specific Database Repair Reconciliation

The current database evidence now includes a successful structural backup gate
and a bounded authorized-development connection, but it remains **not-ready**:

- The selected additive launch SQL passed static scanning (124 statements; no
  destructive, ambiguous, or non-additive statements).
- Aggregate target preflight stopped with the exact redacted reason
  `exact-money-type-mismatch`, before any DDL or ledger mutation.
- Database effects are one catalog preflight read, zero writes/deletes, zero
  historical migration invocations, zero provider calls, and zero row data
  emitted.
- Schema, tenant-boundary, ledger/index/constraint, and durable-POS evidence
  remain unverified. An explicit exact-money conversion approval is required
  before any additive backfill is considered.

This does not change the **NO-GO**, `liveConformance: false`, or any capability
flag. The backup remains preserved outside the repository for a future bounded
pass; no production or launch claim is emitted.

## Latest Full Launch Migration Retry

The exact-money-reconciled retry preserves the existing fail-closed decision:

- Backup gate: passed; the preserved custom-format archive was nonzero and
  `pg_restore --format=custom --list` exited `0`.
- Selected SQL gate: passed for one launch migration file and `125` statements;
  no destructive, ambiguous, unsafe-alter, or floating monetary declaration
  was accepted, and the Prisma/contracts exact-money static checks passed.
- Target gate: passed only for the bounded development context using process
  `NODE_ENV=development`, the exact confirmation flag, and the repository-root
  `.env` `DATABASE_URL` source.
- Preflight gate: blocked with `exact-money-type-mismatch` after one successful
  bounded connection. The target's existing monetary shape is still
  incompatible with the exact-money launch requirement; no approved lossless
  conversion/backfill identifier was supplied.
- Effects: `0` DDL, `0` DML, `0` deletes, `0` ledger mutations, `0` historical
  migration invocations, `0` provider calls, and `0` row data emitted. The
  pool closed successfully.
- Schema and durable POS proof did not run. Direct launch evidence remains
  `0/11`, all capability flags remain disabled, and the decision remains
  **NO-GO**.

The next valid action is a separately approved lossless exact-money target
conversion/backfill plan and a new bounded development retry. No production,
provider, API, web, mobile, browser, Docker, seed, or deployment claim is made.
