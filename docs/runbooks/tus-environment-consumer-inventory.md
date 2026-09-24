# TUS environment consumer inventory

This inventory is the change-control record for environment normalization. The
repository-root `.env` `DATABASE_URL` is the application source in local runs.
Values are never copied into this document or emitted by a runner.

## Canonical contract

| Canonical name/source | Consumer | Alias status | Removal evidence |
|---|---|---|---|
| Root `.env` `DATABASE_URL` | Prisma/API and local native profile | Canonical application source | Required for local application configuration |
| `DIRECT_URL` | Prisma CLI release step only | Canonical direct migration endpoint | Never consumed by the running API or seed scripts |
| `NODE_ENV` | API/runtime and safety gate | Existing profile metadata | `development`/`test` prove local intent; `production` refuses seed |
| `FACTORY_PROFILE` | API/runtime and safety gate | Existing profile metadata | `local`/`test` prove local intent; deployment profiles refuse seed |
| `NEXT_PUBLIC_API_URL` | `apps/web/src/lib/*` | Canonical web public API URL | `API_BASE_URL` remains a deployment alias until all manifests are migrated |
| `EXPO_PUBLIC_API_URL` | `apps/mobile/app.config.ts` and mobile client | Canonical mobile public API URL | No removal: app config and tests consume it |
| `API_BASE_URL` | `render.yaml` web service | Deployment alias; retain | Render manifest still supplies it |
| `MONGODB_URL` | Active API adapter, examples, and Render | Canonical MongoDB application name | Repository-wide consumers use this name |
| `MONGODB_URI` | Compatibility input for the active API adapter | Compatibility alias; retain until legacy consumers are migrated | Never emit both names from a manifest; no removal without repository-wide proof |
| `REDIS_URL` / `REDIS_PROVIDER` | API queue adapters and Render | Infrastructure contract; retain | Runtime and deployment consumers are present |

## Consumer map

The map covers examples, application manifests, mobile/web configuration,
`render.yaml`, Terraform, tests, docs. Before
changing a name, search all of those roots and record the exact consumer here.
Similar names are not proof that a variable is unused.

## Safe normalization rules

1. Do not read or print secret values while inventorying consumers.
2. Keep `DATABASE_URL` as the only application/seed database URL. `DIRECT_URL`
   is a release-only Prisma connection for DDL and must target the same database;
   it never overrides runtime or seed authority.
3. Do not require or read the former six-field `TUS_TEST_*` metadata contract.
   Existing `NODE_ENV`/`FACTORY_PROFILE` values are the only profile inputs.
4. Any removal requires a dated evidence entry, passing contract tests, and a
   rollback path that restores the alias without touching data.
5. `NEXT_PUBLIC_API_URL` is the canonical web API value; `API_BASE_URL` remains
   an agreeing deployment alias. Mobile uses `EXPO_PUBLIC_API_URL`, while web
   origin and support consumers use `NEXT_PUBLIC_SITE_URL` and
   `NEXT_PUBLIC_SUPPORT_WHATSAPP_URL`.

## Evidence log

| Date | Change | Result | Tag |
|---|---|---|---|
| 2026-08-30 | Initial inventory for TUS product hardening | Aliases retained; no unproven variable removed | deterministic |
| 2026-08-30 | Render/Vercel contract review | Render remains fail-closed; Vercel uses the Next app contract and has no provider activation | deployment / external-blocked |
| 2026-08-31 | PostgreSQL safety simplification | Root `DATABASE_URL` only; explicit local/test profile and seed intent; former runner URL/metadata inputs removed from active consumers | deterministic |
| 2026-09-24 | Managed PostgreSQL release split | `DATABASE_URL` remains runtime/seed authority; `DIRECT_URL` is restricted to Prisma migration jobs for the same database | staging / release |
