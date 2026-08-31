# TUS environment consumer inventory

This inventory is the change-control record for environment normalization. The
repository-root `.env` `DATABASE_URL` is the application source in local runs.
Values are never copied into this document or emitted by a runner.

## Canonical contract

| Canonical name/source | Consumer | Alias status | Removal evidence |
|---|---|---|---|
| Root `.env` `DATABASE_URL` | Prisma/API and local native profile | Canonical application source | Required for local application configuration |
| `TUS_TEST_RUNNER_POSTGRES_URL` | PostgreSQL validation runner | Explicit runner override | Must pass the same target proof gate |
| `TUS_POSTGRES_URL` | Existing PostgreSQL validation tests | Legacy runner-only alias; retain | Consumers remain in integration tests and rerun commands |
| `NEXT_PUBLIC_API_URL` | `apps/web/src/lib/*` | Canonical web public API URL | `API_BASE_URL` remains a deployment alias until all manifests are migrated |
| `EXPO_PUBLIC_API_URL` | `apps/mobile/app.config.ts` and mobile client | Canonical mobile public API URL | No removal: app config and tests consume it |
| `API_BASE_URL` | `render.yaml` web service | Deployment alias; retain | Render manifest still supplies it |
| `MONGODB_URI` / `MONGO_PROVIDER` | Render and legacy backend files | Legacy infrastructure contract; retain | `apps/api/backendFiles/` and deployment manifests consume it |
| `REDIS_URL` / `REDIS_PROVIDER` | API queue adapters and Render | Infrastructure contract; retain | Runtime and deployment consumers are present |

## Consumer map

The map covers examples, application manifests, mobile/web configuration,
`render.yaml`, Terraform, tests, docs, and `apps/api/backendFiles/`. Before
changing a name, search all of those roots and record the exact consumer here.
Similar names are not proof that a variable is unused.

## Safe normalization rules

1. Do not read or print secret values while inventorying consumers.
2. Keep `DATABASE_URL` as the only application database key; runner override
   keys never configure Prisma or the deployed application.
3. Retain `TUS_POSTGRES_URL` as a clearly documented runner alias until a
   repository-wide search and deployment review prove it unused.
4. Any removal requires a dated evidence entry, passing contract tests, and a
   rollback path that restores the alias without touching data.

## Evidence log

| Date | Change | Result | Tag |
|---|---|---|---|
| 2026-08-30 | Initial inventory for TUS product hardening | Aliases retained; no unproven variable removed | deterministic |
| 2026-08-30 | Render/Vercel contract review | Render remains fail-closed; Vercel uses the Next app contract and has no provider activation | deployment / external-blocked |
