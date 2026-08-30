# Evidence-backed readiness

The current TUS claim is maintained in
[`tus-matrix.md`](tus-matrix.md). It is `not-production-ready` until every
applicable external gate is represented by current, authorized, scoped,
unrevoked evidence. This page describes the contract; the matrix records the
actual command, revision/date, owner, scope, status, and evidence class.

P6.7 defines a conservative readiness decision for the explicitly selected
profile. It does not perform provider calls, read `.env`, or turn a plan into a
live claim. A readiness record is valid only when its scope, owner, profile,
timestamp, expiry, rollback reference, and evidence class are explicit.

## TUS evidence classes and statuses

| Evidence class | Meaning | `liveConformance` |
| --- | --- | --- |
| `local-deterministic` | Provider-free tests, builds, contracts, policy, or plan shape in the local boundary | `false` |
| `local-postgresql-http` | Actually executed local PostgreSQL HTTP restart/replay proof | `false` |
| `authorized-external` | Current owner-authorized evidence for one exact profile and scope | `true` only for that scoped gate |
| `deferred` | Missing, unavailable, expired, revoked, malformed, unauthorized, or out-of-scope evidence | `false` |

`missing`, `expired`, and `unauthorized` are hard blockers for a
`production-ready` result. Deterministic local and fake verification may still
continue and must be reported separately as `not-production-ready`.

## Readiness decision

1. Select exactly one declared active profile: `render-native` or
   `aws-terraform`. Local evidence is supporting evidence, not a substitute for
   the selected cloud profile.
2. Enumerate every applicable gate: contract, security scan, profile plan,
   PostgreSQL, MongoDB, Redis, object storage, queue/DLQ, backup/restore,
   migration, job replay, telemetry, cost/quota, retention/deletion, and the
   owner-authorized live smoke gates that apply to the profile.
3. Check that every record is current, tenant/profile scoped, redacted, owned,
   and linked to a reversible rollback boundary.
4. Reject the claim when any required record is missing, expired, failed,
   unavailable, or live-unauthorized. Do not silently substitute Compose,
   another provider, or a deterministic fake for a required live gate.
5. Return `production-ready` only for the exact profile and scope whose
   applicable records pass. Otherwise return `not-production-ready` with
   machine-readable blockers and keep `liveConformance: false`.

## Evidence record template

Use synthetic identifiers in committed examples. Real credentials, endpoints,
provider payloads, personal data, and `.env` values never belong in evidence.

```json
{
  "profile": "render-native",
  "scope": "environment/service/gate",
  "gate": "backup-restore",
  "kind": "native-smoke",
  "status": "verified",
  "observedAt": "2026-08-25T00:00:00.000Z",
  "expiresAt": "2026-08-26T00:00:00.000Z",
  "owner": "team-name",
  "rollbackRef": "docs/rollback/README.md#backup-restore",
  "liveConformance": false,
  "deferredServices": ["managed-provider-smoke"]
}
```

The record must state the command or scenario, result counts, redaction check,
and whether the boundary was deterministic, plan-only, or authorized live.
`authorized-cloud-smoke` additionally records the approval reference without
recording the credential or secret itself.

## Review outcomes

### Passing scoped claim

```json
{
  "status": "production-ready",
  "profile": "aws-terraform",
  "liveConformance": true,
  "blockers": [],
  "deferredServices": []
}
```

This result is permitted only when all applicable evidence is current and
authorized for `aws-terraform`; it is not a claim about another profile.

### Missing, expired, or live-unauthorized evidence

```json
{
  "status": "not-production-ready",
  "profile": "render-native",
  "liveConformance": false,
  "blockers": ["missing:profile-smoke", "expired:security-scan"],
  "deterministicVerificationMayContinue": true
}
```

The reviewer records the remediation and rollback reference, then reruns only
the affected gate. A failed readiness review never deletes durable state,
neutral contracts, the PostgreSQL ledger, outbox, or DLQ.

## Boundary and retention

Readiness evidence is append-only by review date and is replaced only by a new
scoped record; it is not edited to conceal an expired or unauthorized result.
When a gate fails, use the relevant runbook in `docs/runbooks/` and the
rollback matrix in `docs/rollback/README.md`. No evidence-backed readiness
claim may be made from missing, expired, or unauthorized live evidence; do not claim
production readiness from a plan, fake, or unavailable gate.
