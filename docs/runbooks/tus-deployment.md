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

The canonical local API port is `3101`. Run `node scripts/dev/native-profile.mjs
api` and `node scripts/dev/native-profile.mjs web` from the repository root. The
wrapper supplies `API_PORT=3101` only when `API_PORT` is not already set, so an
explicit override remains supported. The web app uses port `3000` by default.

| Target | Build/start contract | Required external proof |
|---|---|---|
| Local native | `node scripts/dev/native-profile.mjs api` or `node scripts/dev/native-profile.mjs web`; API `3101`, web `3000`; root `.env` `DATABASE_URL` is authoritative; existing `FACTORY_PROFILE=local|test` or `NODE_ENV=development|test` is required | Local loopback target and direct health evidence; seed additionally requires `node scripts/postgres-seed.mjs seed` |
| Render API | `pnpm install --frozen-lockfile && pnpm --filter @factory/api build`; pre-deploy `pnpm --filter @factory/api prisma:migrate:deploy`; `pnpm --filter @factory/api start` | Render-managed secret ownership and direct health evidence |
| Render web | `pnpm install --frozen-lockfile && pnpm --filter @factory/web build`; `PORT=$PORT pnpm --filter @factory/web start` → `node .next/standalone/server.js` from the `apps/web` package cwd (repository path `apps/web/.next/standalone/server.js`) | Authenticated web evidence and API URL contract |
| Vercel web | `pnpm install --frozen-lockfile`; set `NEXT_PUBLIC_API_URL` in Vercel Project Settings for Production and Preview; `pnpm --filter @factory/web build`; Next.js framework | Vercel project ownership, environment proof, and authenticated browser evidence |

`vercel.json` intentionally contains no API URL, credentials, or secret reference.
The production resolver fails closed unless the dashboard supplies the canonical
`NEXT_PUBLIC_API_URL`; `API_BASE_URL` is optional and must match it exactly.
Mobile consumers use `EXPO_PUBLIC_API_URL`. Web support links use
`NEXT_PUBLIC_SUPPORT_WHATSAPP_URL`, and the web origin uses
`NEXT_PUBLIC_SITE_URL`; configure those public values in the relevant app/project
environment settings without copying secrets into manifests.

Render migration ordering is build → `prisma migrate deploy` in
`preDeployCommand` → API start. This pass validates the checked-in contract only;
it does not connect to, migrate, seed, or write any database.

The Render web build runs in the `apps/web` workspace package. With
`output: 'standalone'`, Next emits `apps/web/.next/standalone/server.js` relative
to the repository root. Render passes its platform-assigned `PORT` through the
web start command; the package script launches the generated server directly.
`next start` is not a valid entrypoint for this standalone output.

The Render Python worker currently runs `python -m worker.main` once, prints an
example result, and exits. It is explicitly `external-blocked` and not a
production-ready worker contract until a long-lived queue loop is implemented.

No provider, cloud, compliance, production, hardware, or native-device claim is
inferred from a successful build. Missing external proof is tagged
`external-blocked` and leaves the corresponding capability disabled.

## Bounded Windows build prerequisite

The API build runs Prisma client generation before TypeScript compilation. On
Windows, Prisma cannot replace `query_engine-windows.dll.node` while an owned API
process still has that native engine loaded. The build contract fails closed with
an explicit lock diagnostic; it does not delete or replace generated artifacts by
force. Stop the owned API process, then rerun the same bounded build command.

`pnpm` and Corepack are repository prerequisites (`pnpm@9.15.9`, Node `>=20.11.0
<23`). If the local shims are unavailable, do not install a global package or
substitute an untracked package manager; use the direct Node test/typecheck
equivalents only for deterministic local evidence and record the prerequisite
failure.

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
