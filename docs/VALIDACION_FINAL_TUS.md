# Validacion final de TUS

Fecha: 2026-09-28

## Alcance

Validacion local del estado actual del monorepo, con foco en:

- alta administrativa de prestadores y directorio publico;
- readiness comercial y persistencia Prisma del prestador;
- mapa, solicitudes, catalogo y roles Web;
- asistente Web, asistente de WhatsApp y postulaciones;
- compilacion, contratos, seguridad y regresion completa.

Esta validacion no autoriza un despliegue ni afirma readiness productiva.

## Correcciones verificadas

- El alta administrativa registra la fila operativa de `prestadores` que necesita el perfil publico sin invocar el onboarding comercial.
- El onboarding comercial conserva su gate de readiness `publication`; sin evidencia devuelve `TUS_READINESS_BLOCKED` y no emite eventos comerciales.
- El `merchantId` queda inmutable despues del alta inicial, evitando filas duplicadas por tenant en PostgreSQL.
- El adapter Prisma guarda por `id` y busca por tenant con `findFirst`, sin usar `tenantId` como clave unica inexistente.
- El audit del perfil administrativo referencia el identificador interno del prestador, no el DTO publico.

## Resultados

| Gate | Resultado |
| --- | --- |
| Tests focales de directorio, admin, catalogo, solicitudes y Prisma | 24 pasaron, 0 fallaron |
| Tests de home, auth, mapa, filtros y roles | 15 pasaron, 0 fallaron |
| Tests de asistentes, RAG, postulaciones y WhatsApp | 22 pasaron, 0 fallaron |
| Regresiones de alta administrativa y marketplace | 8 pasaron, 0 fallaron |
| Readiness runtime con runner TypeScript canonico | 3 pasaron, 0 fallaron |
| Suite completa `pnpm test` | 865 tests: 864 pasaron, 0 fallaron, 1 omitido |
| PostgreSQL HTTP boundary | 19 pasaron, 0 fallaron; ejecucion real diferida sin target autorizado |
| Typecheck recursivo | 10 tareas pasaron |
| Contratos JSON Schema | 107 contratos validados |
| Prisma schema | Valido con `DIRECT_URL` placeholder solo para parseo |
| Lint recursivo | 7 tareas pasaron; 13 warnings historicos, 0 errores |
| Build recursivo | 6 tareas pasaron; Web genero 42 paginas y API compilo |
| Security scan y policy | Pasaron sin hallazgos bloqueantes |
| `git diff --check` | Paso; solo avisos de conversion LF/CRLF de Git |
| Smoke Web autocontenido | `/`, `/tus/mercado`, `/tus/pos`, `/tus/soporte` y `/tus/prestador`: HTTP 200 |

## Limites

- No se ejecuto una jornada HTTP contra PostgreSQL real porque no habia una base local/test descartable autorizada. El harness fallo cerrado y no hizo conexiones, migraciones, queries ni fixtures.
- No se ejecuto el smoke de API porque `/ready` requiere PostgreSQL real. El build y los tests HTTP en memoria si pasaron.
- No se activaron proveedores externos, pagos, Meta WhatsApp, Groq ni Nosis.
- El lint conserva 11 warnings preexistentes en Mobile y 2 en Web; no bloquean el gate actual.
- El worktree contiene cambios amplios previos y sigue sin staging. Esta validacion no implica que todos deban entrar en un mismo commit.

## Procesos

No quedaron servidores, workers ni procesos TUS persistentes. El smoke Web uso un proceso autocontenido y lo detuvo al finalizar.
