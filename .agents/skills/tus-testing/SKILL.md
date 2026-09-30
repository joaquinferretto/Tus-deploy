---
name: tus-testing
description: Orden de validación y criterio para interpretar fallos de tests en TUS. Usar antes de declarar una tarea terminada, antes de commits o merges, y cuando un test falla.
---

# TUS: testing y validación

## Orden estándar (de lo más rápido a lo más amplio)
1. Tests focalizados del área (`node --test tests/foundation/<archivo>.test.mjs`).
2. Contratos y Prisma: `corepack pnpm run contracts:validate`, `prisma validate` / `generate`.
3. Typecheck del paquete afectado (`npx tsc --noEmit -p apps/api` o `apps/web`) y luego `pnpm run typecheck`.
4. `pnpm run lint`.
5. `pnpm run build`.
6. Seguridad: `security:scan` y `validate-policy` (ver `tus-security`).
7. `git diff --check` (y `--cached` si hay staged).
8. Regresión completa: `pnpm test`.

Usar timeouts acotados; suites largas en background con log. Servidores solo con `scripts/dev/smoke-local.mjs` (ver `AGENTS.md`).

## Interpretar fallos
- **Error real**: el código contradice el comportamiento esperado. Se corrige el código.
- **Fallo histórico**: ya fallaba antes del cambio. Confirmarlo corriendo el mismo archivo contra el commit base (por ejemplo en un worktree temporal) y reportarlo, sin mezclarlo con el trabajo actual.
- **Problema ambiental**: Windows/Corepack (`pnpm` fuera del PATH), `EPERM` de symlinks en Next standalone, locks del query engine de Prisma, puertos ocupados. Resolverlo sin modificar el sistema (por ejemplo shims de Corepack en un directorio temporal) y validar la ruta Linux cuando corresponda.

## Reglas
- No cambiar expectativas solo para ponerlos en verde. Una aserción se ajusta únicamente cuando el contrato cambió a propósito o reconciliando dos contratos legítimos, y se explica.
- Tests deterministas: relojes controlados, datos ficticios, sin red real ni personas reales; los que requieren PostgreSQL usan una base descartable y se omiten sin ella.
- Reportar números exactos: pasan / fallan / omitidos.
