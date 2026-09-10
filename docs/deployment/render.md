# Render-native deployment profile

Render is an active cloud-native profile using native API/web services and
background workers. It does not use production Docker and never silently falls
back to Compose.

## Blueprint

`render.yaml` is the Render-native service shape. It declares a Node API, a
Next.js web service, and a Python workflow worker. The services use Neon for
PostgreSQL, managed MongoDB, Render-managed Redis, and B2 object storage
through secret-store references. The queue boundary is Redis-backed and keeps
the PostgreSQL ledger/outbox/DLQ authoritative. No `dockerCommand`, Dockerfile,
or production container is part of this profile.

The canonical MongoDB secret key for both Render services that declare MongoDB
is `MONGODB_URL`. `MONGODB_URI` is accepted only by the API connection resolver
as a compatibility input when the canonical key is absent; it is not declared
by Render and must never be printed or copied into a manifest.

### Web standalone entrypoint

The Render web build is executed by the `@factory/web` workspace package, so the
generated standalone server is `apps/web/.next/standalone/server.js` from the
repository root, or `.next/standalone/server.js` from that package's working
directory. Render starts it with:

```text
PORT=$PORT pnpm --filter @factory/web start
```

The package `start` script runs `node .next/standalone/server.js`. The generated
server reads the platform-provided `PORT`; `next start` must not be used with
`output: 'standalone'`. This is a checked-in contract only and does not claim a
live Render deployment.

The checked-in Next configuration is platform-conditioned: Windows local builds
use no standalone output because pnpm symlink copying requires elevated link
privileges, while Render Linux production retains `output: 'standalone'`. This
local portability branch does not weaken the Linux/Render standalone entrypoint
or suppress TypeScript and ESLint build failures.

The API follows the same external-port contract with
`PORT=$PORT pnpm --filter @factory/api start`. Its release order is build,
backup-gated additive pre-deploy (`node scripts/deployment/render-predeploy.mjs`),
then start. The wrapper invokes only `prisma migrate deploy` after the approved
backup, additive plan, reconciled migration history, and exact selected migration
metadata are present.

## Profile contract

| Boundary       | Configuration source           | Owner         | Rollback                                              | Fake/disabled state                  | Activation gate                                                |
| -------------- | ------------------------------ | ------------- | ----------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| PostgreSQL     | Render secret-store reference  | Data Platform | Last passing schema and verified backup               | Disabled until endpoint is available | Endpoint, secret reference, backup, quota, authorized smoke    |
| MongoDB        | Render secret-store reference  | Document Data | Restore or rebuild projections with reconciliation    | Deterministic document fake          | Owner, network, retention, backup, authorized smoke            |
| Redis          | Render secret-store reference  | Runtime Jobs  | Disable consumers and replay the PostgreSQL ledger    | Deterministic cache/queue fake       | Retry, quota, secret reference, authorized smoke               |
| Object storage | Render/B2 profile reference    | Assets        | Revert adapter and reconcile versioned objects        | Deterministic object fake            | Policy, encryption, lifecycle, authorized smoke                |
| Queues         | Render-managed queue reference | Runtime Jobs  | Stop intake and replay ledger/outbox/DLQ idempotently | Deterministic transport fake         | Queue policy, retry, secret reference, quota, authorized smoke |

## Evidence and rollback

Run the check-only dry-run fixture validation from the repository root:

```text
node scripts/validation/cloud-native/validate-plan.mjs
```

This command reads only committed synthetic fixtures. It does not provision,
contact Render, or read `.env`. A successful plan/validation record is
`cloud-plan-validation`; it never claims live conformance. Missing credentials,
resources, quotas, or owner approval are recorded as
`unavailable-deferred`, while deterministic fakes remain available. Terraform
validation is also check-only when the Terraform CLI is available; an absent
CLI is reported as unavailable rather than replaced by a live claim.

The evidence classes are `cloud-plan-validation`, `authorized-cloud-smoke`, and
`unavailable-deferred`; live conformance is not claimed without the last class's
required credentials, resources, and authorization.

Authorized smoke is a separate, explicitly approved operation. A failed
deployment stops traffic before partial serving, selects the last passing
service configuration, preserves the PostgreSQL ledger/outbox/DLQ, and records
the version, reason, operator, and health evidence.

The Render Python worker starts `python -m worker.main`. When explicitly owned
and enabled with canonical Redis/queue settings, the entrypoint runs a long-lived
Redis queue consumer with bounded polling and signal-aware resource closure. The checked-in profile remains
`external-blocked-placeholder` with `WORKER_ENABLE_CONSUMER=false`, so it exits
without claiming work until queue ownership, leases, and live evidence exist.

## AWS parity shape

The AWS counterpart is `aws-terraform`. Both profiles expose PostgreSQL,
MongoDB, Redis, object storage, and queues with the same ownership, rollback,
fake/disabled, and activation-gate semantics. AWS changes the infrastructure
authority to Terraform and the object-storage/queue references to S3/SQS; it
does not weaken the shared contract. A parity failure makes the affected
profile unsupported rather than production-ready.
