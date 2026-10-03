# Baseline Local TUS (API + Web)

## Objetivo
Dejar TUS ejecutable localmente con API + Web funcionando con PostgreSQL + Prisma antes de comenzar la limpieza estructural.

## Por qué
Establecer una baseline reproducible y operativa sin alterar la arquitectura ni activar proveedores externos o pagos reales.

## Alcance
- Verificación de entorno (Node >=20.11 y <23, pnpm via Corepack)
- Instalación de dependencias y validación de contratos
- Revisión de bloqueadores críticos de base de datos (Readiness, Marketplace store compound unique key, AuthService registration)
- Aplicación de migraciones pendientes forward-only con Prisma
- Validación de API local (`GET /health`, `GET /ready`)
- Validación de Web local (`/sign-in?returnTo=%2Ftus`)

## Restricciones
- No ejecutar `prisma migrate reset`, no borrar datos ni tablas
- No tocar `opencode.json`
- No deploy, no push, no activar providers externos ni pagos reales
- No dejar servidores persistentes bloqueando el shell; seguir AGENTS.md (launcher/smoke)
- Monorepo TUS: clean architecture hexagonal, Prisma + PostgreSQL local

## Delivery Strategy
- Strategy: single-pr
- Route: Direct inline

## Tareas

- [x] **TASK-01**: Verificar entorno, dependencias y contratos
  - Node >=20.11 y <23 (`v22.23.2` verificado)
  - Corepack pnpm install completado
  - `node packages/contracts/scripts/validate-schemas.mjs` completado (107 schemas válidos)
  - Evidencia: Comprobaciones ejecutadas con éxito en sesión previa

- [x] **TASK-02**: Revisar y corregir bloqueadores críticos de DB
  - 4A: Verificar tablas de readiness (`EvidenciaHabilitacion`, `DecisionHabilitacion` ya mapeadas a `evidencias_habilitacion`, `decisiones_habilitacion`)
  - 4B: Corregir `PrismaMarketplaceStore` para soportar clave compuesta `tenantId + commitmentId` (`tenantId_compromisoId`)
  - 4C: Verificar `AuthService.register` (`bootstrapTenant` ya garantiza `TusTenant`, `Organization`, `Workspace`, `Membership`)
  - Evidencia: Subagente delegado modificó `catalog/index.ts`, `prisma.ts` y `prisma-marketplace.ts`. Typecheck y `tests/foundation/p9-marketplace.test.mjs` (8/8) pasando.

- [x] **TASK-03**: Ejecutar migraciones pendientes forward-only
  - Ejecutar `prisma migrate deploy` sobre PostgreSQL local
  - Ejecutar `prisma validate`
  - Evidencia: 32 migraciones pendientes aplicadas forward-only con éxito (`20260916140000` hasta `20261019100000`). `prisma migrate status` confirma 66/66 al día y `prisma:validate` confirma schema válido.

- [x] **TASK-04**: Levantar y validar API con perfil local
  - Variables: `FACTORY_PROFILE=local`, `NODE_ENV=development`, `API_PORT=3101`, `CORS_ORIGINS=http://localhost:3000`, `TUS_ROUTES_ENABLED=true`, `TUS_PROVIDER_ACTIONS_ENABLED=false`
  - Validar `GET http://localhost:3101/health` (OK, 200)
  - Validar `GET http://localhost:3101/ready` (ready: true, profile: native, postgres check: ok, schema compatible: true)
  - Evidencia: Verificado con `scripts/dev/smoke-local.mjs api` (PASS /health:200 /ready:200) y ejecución directa con native profile respondiendo 200 en ambos endpoints.

- [x] **TASK-05**: Levantar y validar Web local
  - Variables: `NEXT_PUBLIC_API_URL=http://localhost:3101`
  - Validar `http://localhost:3000/sign-in?returnTo=%2Ftus`
  - Evidencia: `smoke-local.mjs web` pasando en todas las rutas base (`/`, `/tus/mercado`, `/tus/pos`, `/tus/soporte`, `/tus/prestador` en 200) y comprobación directa de `http://localhost:3000/sign-in?returnTo=%2Ftus` retornando HTTP 200 HTML válido.

- [x] **TASK-06**: Entregar reporte final
  - Archivos modificados documentados
  - Problemas encontrados y resueltos
  - Comandos ejecutados detallados
  - Estado actual (API, Web, DB, bloqueadores)
  - Comandos ejecutados
  - Estado actual (API, Web, DB, bloqueadores)
