# TUS deployment activation and rollback runbook

Use this runbook for the final TUS deployment/evidence slice. It applies to
`render-native`, `aws-terraform`, and the Next.js/Vercel web contract; Compose is
not a fallback.

## Readiness procedure

1. Select exactly one profile and record its version, operator, scope, and
   rollback reference.
2. Run the deterministic readiness report and cloud plan validation. These are
   provider-free and never prove live conformance.
3. Attach separate, authorized evidence for legal, KYC/KYB, tax, provider,
   POS, database/API, browser/device, and operational smoke gates. Do not copy
   credentials, `.env` values, endpoints, payloads, or personal data.
4. Enable only the requested capability flags after every applicable gate is
   current, in scope, unexpired, and not revoked. Missing evidence returns
   `not-production-ready` and `unavailable-deferred`.
5. Record the report, exact test/build commands and counts, evidence class,
   deferred services, and the next gate owner.

## Safe rollback

1. Stop traffic and new TUS intake before partial serving.
2. Set TUS routes, provider actions, release jobs, and fleet jobs to `false`.
3. Drain unambiguous in-flight work within a bounded timeout; quarantine
   ambiguous, failed, or provider-dependent work with a redacted reason and
   correlation identifier.
4. Preserve PostgreSQL commitments, append-only ledger, audit records,
   transactional outbox, run ledger, retry metadata, evidence, and DLQ.
5. Select the last passing Render service configuration or Terraform state;
   never silently substitute another profile or data store.
6. Reconcile and replay only through the existing job/backup runbooks, then
   rerun readiness before any scoped reactivation.

## Evidence boundary

Local deterministic tests, plan fixtures, and in-process HTTP harnesses are
`deterministic-test-only` or `cloud-plan-validation`. They do not establish
live provider, legal, database, browser, device, POS, or production evidence.
Unavailable evidence is recorded explicitly and remains fail-closed.

## Local, Render, and Vercel contracts

| Target | Build/start contract | Required external proof |
|---|---|---|
| Local native | `cd backend && pnpm run dev` or `cd frontend && pnpm run dev`; root `.env` is authoritative | Disposable database proof before any database operation |
| Render API | `pnpm install --frozen-lockfile && pnpm --filter @factory/api build`; `pnpm --filter @factory/api start` | Render-managed secret ownership and direct health evidence |
| Render web | `pnpm install --frozen-lockfile && pnpm --filter @factory/web build`; `pnpm --filter @factory/web start` | Authenticated web evidence and API URL contract |
| Vercel web | `pnpm install --frozen-lockfile`; `pnpm --filter @factory/web build`; Next.js framework | Vercel project ownership, environment proof, and authenticated browser evidence |

No provider, cloud, compliance, production, hardware, or native-device claim is
inferred from a successful build. Missing external proof is tagged
`external-blocked` and leaves the corresponding capability disabled.

## Authorized retry

Retry is a new evidence window, not a continuation of a failed activation:

1. Confirm the failure cause is resolved and assign an owner-approved,
   disposable target and scope.
2. Start from preflight: profile, schema, authorization, health, evidence
   expiry/revocation, and provider non-interaction checks.
3. Use unique fixture and recovery identifiers; do not reuse a failed mutable
   fixture or replay an unscoped queue listing.
4. Keep the prior failure receipt immutable and record the new result separately.
   A failed retry returns to `not-production-ready` and repeats stop/drain/
   quarantine rather than enabling a broader capability.

## Rollback boundary

Revert only the deployment flags, profile configuration, readiness report, and
this runbook. Preserve neutral contracts, TUS migrations, commitments, ledger,
outbox, DLQ, audit history, and unrelated profile state.
