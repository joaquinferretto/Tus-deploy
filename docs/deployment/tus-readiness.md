# TUS deployment and readiness

The deployment profile exposes API, web, worker, TUS route, provider, release
job, and fleet job flags explicitly. Render-native and AWS Terraform enable only
the base API/web/worker shape by default; TUS routes and all money-moving or
fleet actions remain disabled until scoped evidence is authorized.

## Safe report

Generate the provider-free report without reading credentials or contacting a
provider:

```text
node scripts/activation/tus-readiness.mjs render-native
```

The default result is `not-production-ready` with disposition
`unavailable-deferred`, `liveConformance: false`, the missing capability gates,
and `deterministicVerificationMayContinue: true`. A plan, fake, feature flag,
or injected transport cannot turn that result into a live claim.

Only an owner-authorized `authorized-cloud-smoke` evidence record may enable a
requested gated capability. The report is scoped to exactly one profile and
never includes secret values, endpoints, provider payloads, or personal data.

## Evidence classes

| Evidence class | Meaning | Live claim |
| --- | --- | --- |
| `local-deterministic` | Provider-free local tests, contracts, policy, builds, and plan shape | No |
| `local-postgresql-http` | Actually executed local PostgreSQL HTTP durability smoke | No; local boundary only |
| `authorized-external` | Current owner-authorized smoke for one exact profile and scope | Yes, only for that gate |
| `deferred` | Missing, expired, revoked, unauthorized, or unavailable evidence | No |

The committed CI workflow is deterministic: frozen install, build, full test
runner, contract validation, security scan, and policy validation. The local
full runner may report pre-existing failures outside this work unit; those are
recorded rather than relabeled as deployment evidence.

## Activation boundary

Enable only the requested capability after its legal, KYC/KYB, tax, provider,
POS, AWS/Groq, PostgreSQL, browser/device, and runtime evidence is current,
scoped, unexpired, and not revoked. Settlement, payout, custody, and fleet
claims remain disabled when any required gate is absent. The overall output must
remain `not-production-ready` while any required external record is missing.
Keep deterministic tests and plan validation separate from provider, database,
browser, device, and production smoke evidence. See the complete traceable
matrix in `docs/evidence/readiness/tus-matrix.md`.

## Operational stop, drain, quarantine, and retry

If any gate expires, is revoked, conflicts, or fails during a pilot or
deployment, use this sequence before investigating or replaying work:

1. **Stop intake:** set the affected capability flag to `false` and stop new
   TUS routes, provider actions, release jobs, and fleet jobs. Do not substitute
   Compose, another provider, or a local fake for the stopped boundary.
2. **Drain safely:** finish only work that is already safe and unambiguous;
   bound the drain by the runbook timeout and record the count and correlation
   identifiers.
3. **Quarantine unsafe work:** move ambiguous, failed, legally held, or
   provider-dependent work to a tenant-scoped quarantine/DLQ with a redacted
   reason. Never delete a queue record to hide a failure.
4. **Preserve evidence:** close resources and preserve commitments, audit,
   evidence history, ledger, outbox, run ledger, retry metadata, and DLQ. Any
   financial correction is an append-only compensating entry.
5. **Rollback and verify:** select the last passing profile/schema pair, use the
   applicable migration or replay runbook, and return to
   `not-production-ready` until health and evidence are re-established.
6. **Retry from zero:** after the cause is resolved, obtain a new owner-approved
   evidence window and disposable target, rerun every applicable gate, and use
   unique fixtures plus fresh recovery identifiers. Prior failure evidence stays
   immutable and separate from the new attempt.

The activation report's rollback plan is the machine-readable record of this
boundary: `stopIntake: true`, `drain: true`, `quarantine: true`, preserved
`audit/evidence/ledger/outbox/dlq`, and `destructiveRollback: false`.
