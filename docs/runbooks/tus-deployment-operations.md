# TUS deployment and operations runbook

This runbook is the bounded operations contract for the Argentina launch slice.
It describes commands and ownership without claiming that Render, Vercel, DNS,
worker, backup, or production systems were contacted.

## Release order and profiles

Use one explicitly named profile per release. Compose is local development only
and is never a cloud fallback.

| Profile | Build | Pre-deploy | Start/health |
| --- | --- | --- | --- |
| Render API | `pnpm install --frozen-lockfile && pnpm --filter @factory/api build` | `node scripts/deployment/render-predeploy.mjs` | `PORT=$PORT pnpm --filter @factory/api start`; `/health`, `/ready` |
| Render web | `pnpm install --frozen-lockfile && pnpm --filter @factory/web build` | none | `PORT=$PORT pnpm --filter @factory/web start`; `/` |
| Vercel web | `pnpm install --frozen-lockfile` | platform-managed build | Next.js framework; authenticated browser smoke required |
| Render worker | Python package install | none | `python -m worker.main`; disabled until ownership evidence |

The API release order is build → additive migration pre-deploy → start. The
pre-deploy wrapper refuses to invoke Prisma unless all release gates are
`TUS_MIGRATION_BACKUP_VERIFIED=true`, `TUS_MIGRATION_PLAN=additive-only`,
reconciled migration history, and the exact selected launch migration must be
present in the approved service environment. It invokes only `prisma migrate
deploy`; `migrate reset`, `db push`, destructive SQL, and historical replay are
not rollback tools.

The live schema conformance correction is a separately authorized development
operation, not a production pre-deploy shortcut. Run it only with
`NODE_ENV=development`, `--confirm-development-target`, the root `.env`
`DATABASE_URL`, and a verified custom-format backup. Do not start seed, POS,
providers, browsers, devices, or hosted deployment until its metadata-only
receipt proves the exact catalog counts and marker lineage.

Next uses `output: 'standalone'` and the web package starts the generated
`.next/standalone/server.js` directly. `next start` is not compatible with this
standalone contract. Render supplies its externally assigned `PORT`; local
Docker defaults are explicit only for local execution.

## Environment and secrets

- Local application configuration reads only the repository-root `.env`
  `DATABASE_URL`. Do not add a runner URL, package URL, `TUS_TEST_*` override, or
  alternate database variable.
- Render secret values belong in the service secret store. Manifests contain
  `sync: false` references only; Vercel public values belong in project
  environment settings.
- `NEXT_PUBLIC_API_URL` is the canonical web API origin. `API_BASE_URL` may be
  retained only as an agreeing deployment alias. Mobile uses
  `EXPO_PUBLIC_API_URL`.
- `MONGODB_URL` is the canonical MongoDB secret-store key. `MONGODB_URI` is an
  API-only compatibility fallback and is not emitted by Render. Production
  configuration fails closed when neither key is available.
- Never paste or print `.env`, credentials, tokens, certificates, provider
  payloads, connection strings, or secret-bearing diagnostics.

### Secret rotation

1. Stop the affected profile or capability and record a redacted incident ID,
   owner, scope, and time window.
2. Revoke the old value in its owning Render/Vercel/provider secret store and
   invalidate derived sessions, webhook windows, or queued work as applicable.
3. Issue a replacement at the smallest service/environment scope and update the
   secret-store reference, never an inline manifest value.
4. Run tracked/staged secret scans and policy validation. Scan output may name a
   path or rule but never a matching value.
5. Re-run the affected readiness and recovery checks. Keep evidence deferred
   until the owner-approved smoke is current.

If replacement fails, leave the old value revoked, disable the affected
capability, preserve ledger/outbox/DLQ state, and select the last passing
configuration that references a valid secret. Never re-enable an exposed value.
Use `docs/runbooks/secret-rotation.md` and
`docs/security/incident-response.md` for the incident record fields.

## DNS, TLS, and CORS

The public customer origin is `https://tusservicios.com`; `www` redirects only
when owned and verified. The API origin is an owner-approved HTTPS hostname
configured through the public web/mobile URL contracts. DNS records must point
only to the approved Vercel web project and Render API service.

Before enabling traffic, record the authoritative DNS observation, TTL, owner,
certificate chain, expiry, and automatic-renewal status without recording
credentials. HTTPS-only redirects and a valid certificate are required outside
local development; an expired, mismatched, or unauthorized certificate blocks
the affected surface.

The API uses the explicit `CORS_ORIGINS` allowlist. Production must not use a
wildcard. The exact authorized HTTPS origin is allowed with the explicit
correlation, authorization, tenant, session, request, and idempotency headers;
other origins are denied. CORS and TLS checks remain deterministic until an
authorized browser/cloud smoke is attached.

## Health, readiness, and worker lifecycle

- `GET /health` is the liveness endpoint and `GET /ready` is the readiness
  endpoint; both carry correlation-aware, redacted responses.
- `/health` is liveness and must not be used as schema readiness proof.
- `/ready` is schema/dependency aware and returns `503` for unavailable,
  incomplete, or incompatible dependencies. It is non-mutating.
- API startup binds only after its bounded database lifecycle succeeds. Database
  startup has 60 seconds per attempt and exactly one retry; no third attempt or
  pre-readiness listener is allowed.
- API and worker shutdown closes owned resources in reverse registration order
  within the configured deadline. A failed close is recorded as a shutdown
  failure, not hidden.
- The Python worker is a long-lived queue consumer only when deployment status,
  consumer enablement, canonical database and Redis configuration, queue
  reference, and queue ownership are active. The checked-in Render profile remains
  `external-blocked-placeholder` with `WORKER_ENABLE_CONSUMER=false`; it exits
  without claiming a job or running the example workflow.

## Monitoring, logging, and SLOs

Use structured, redacted logs keyed by service version, profile, correlation ID,
tenant-safe actor context, and outcome. Do not log request bodies, authorization
headers, SQL, connection strings, provider responses, or user payloads.

The following are operational targets, not measured production results:

| Signal | Target/alert | Action |
| --- | --- | --- |
| API availability | 99.9% monthly `/health` success | page runtime owner; stop affected intake if readiness also fails |
| Readiness | any sustained `503` over 5 minutes | page data/runtime owner; do not route traffic |
| Error rate | 5xx ≥ 2% for 5 minutes | page on-call; inspect correlation-linked redacted logs |
| Latency | p95 ≥ 750 ms for 10 minutes | investigate dependency/queue pressure; preserve evidence |
| Queue age | oldest job ≥ 5 minutes or DLQ growth | stop affected jobs, quarantine unsafe work, replay only by runbook |
| Worker liveness | no heartbeat for 2 consecutive intervals | fence claims and restart only the owned worker |
| Backup | last verified snapshot outside policy window | block migration/activation and page data owner |
| TLS/DNS | expiry window or resolution mismatch | stop affected domain and restore last approved record |

Alerts are owner-scoped and reversible. Budget/quota exhaustion fails closed for
the affected capability and never switches providers silently.

## Incident, rollback, and bounded cleanup

1. Identify the exact profile, release, owner, reason, and redacted health
   evidence. Do not infer a deployment from a manifest or build.
2. Stop traffic and affected TUS intake/jobs. Drain only unambiguous work within
   a recorded timeout; quarantine ambiguous, failed, or provider-dependent work
   with a redacted reason and correlation ID.
3. Preserve PostgreSQL commitments, ledger, audit, idempotency, outbox, run
   ledger, retry metadata, evidence, and DLQ. Financial correction is append-only.
4. Select the last passing profile/application/schema pair and a verified backup.
   Restore only into an isolated target when restore is required. Never use
   reset, truncate, cascade, broad delete, or an unreviewed down-migration.
5. Reconcile projections and replay eligible jobs only through the idempotent
   job-replay boundary. Re-run plan, health, readiness, security, and recovery
   checks before scoped reactivation.

Cleanup is bounded and ownership-checked: stop only owned process records, with each
process recorded as an owned PID plus its
PID, executable argv, and working directory by the invoking harness. Never use
name-based `taskkill`, `pkill`, `killall`, broad process-tree termination, or
delete-based queue cleanup. The native harness's `OwnedChild` boundary is the
only local process cleanup authority.

## Backup and restore

1. Confirm a tenant-scoped snapshot is verified, decodable, within retention,
   and owned by the approved data operator.
2. Stop affected intake and record the snapshot ID, profile, last passing
   application/schema pair, and redacted reason.
3. Restore into an isolated target or deterministic fake first; never overwrite
   the source backup or another tenant's state.
4. Verify identity/tenancy, audit, idempotency, outbox, ledger, run-ledger,
   events, projections, object metadata, and pending/recoverable work counts.
5. Reconcile, replay only eligible DLQ work, run health/readiness, and resume
   only the restored scope after evidence acceptance.

Deterministic restore drills are `local-deterministic` with
`liveConformance: false`. Managed backup/restore is `deferred` until current
owner authorization, resources, quota, and an authorized smoke are recorded.
See `docs/runbooks/backup-restore.md` and
`docs/runbooks/migration-rollback.md` for detailed boundaries.

## Evidence rule

Every record declares its evidence class: deterministic, local PostgreSQL HTTP,
browser/mobile, deployment, provider, legal/tax/privacy, or external-blocked.
Static YAML, a build, a plan fixture, or a disabled worker is not live deployment
proof. Missing Render/Vercel/DNS/worker/backup access remains
`external-blocked`/`not-production-ready`; no production success is emitted.

The conformance receipt may set `liveConformance=true` only for the exact
metadata gate. Provider, browser/device, cloud, deployment, operations, and
legal/tax gates remain separate NO-GO conditions until independently proven.
