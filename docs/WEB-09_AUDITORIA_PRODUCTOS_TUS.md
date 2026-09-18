# Auditoria WEB-09 de capacidades de producto

> **Estado:** cerrada el 2026-09-18. Este documento describe capacidades existentes y limites de activacion; no habilita
> providers, cobros, payouts ni integraciones externas.

## Resultado ejecutivo

WEB-09 confirma que el repositorio contiene contratos y componentes parciales para marketplace, tenancy, billing,
recomendaciones, pagos y settlement. Solo el marketplace Stage 1 y las rutas de tenancy tienen superficies de producto
claramente expuestas. Las capacidades monetarias y de providers permanecen gated, y recomendaciones no esta conectada al
marketplace.

## Matriz de evidencia

| Capacidad | Evidencia | Estado real | Limite de activacion |
| --- | --- | --- | --- |
| Cohorts de marketplace | `apps/api/src/tus/catalog/index.ts`, `apps/api/src/tus/domain/cohorts.ts` | `beauty-personal-care` y `repairs-trades` son los cohorts aprobados para Stage 1 | No ampliar cohorts sin decision de readiness y evidencia de dominio |
| Catalogo y checkout | `apps/api/src/tus/http/router.ts`, `apps/web/src/lib/tus-marketplace.ts` | Discovery, listings, publish, checkout y commitments tienen rutas y consumidores Web | `TUS_ROUTES_ENABLED` permanece apagado por defecto en despliegues |
| Memberships | `apps/api/src/tenancy/http/tenancy-router.ts` | Organizaciones, invitaciones y memberships tienen API | No equivale a suscripcion comercial ni a entitlement de billing |
| Billing/subscriptions | `apps/api/src/tus/billing/index.ts`, `apps/api/src/tus/billing/prisma.ts` | Contratos, servicio y persistencia existen; no se inyectan en `TusApplicationService` ni tienen rutas de producto | Falta superficie HTTP/Web, ownership de cobro, provider y evidencia de renovacion |
| Recomendaciones | `docs/ai/recommendations.md`, `tests/compatibility/test_p4_12_recommendations.py` | Contrato neutral, ranking local deterministicamente testeable y puerto Bedrock inyectable | No hay integracion con catalogo/discovery Web; Bedrock requiere credenciales, region, cuota y conformance |
| Mercado Pago | `apps/api/src/providers/mercado-pago/index.ts`, `apps/api/src/tus/integration/index.ts` | Adapter y webhook existen, pero la composicion Prisma usa `UnavailableMercadoPagoFinanceProvider` | Requiere adapter real inyectado, secretos, gates legales/KYC/KYB/tax y `TUS_PROVIDER_ACTIONS_ENABLED=true` |
| Payment intents | `apps/api/src/tus/finance/index.ts`, `tests/foundation/p5-mercado-pago.test.mjs` | Contrato, persistencia, idempotencia y provider determinista de test existen | El provider de produccion no esta disponible; las gates incompletas dejan el pago en `held` |
| Settlement/release | `apps/api/src/tus/domain/settlement.ts`, `apps/api/src/tus/finance/index.ts` | Elegibilidad, hold, release y compensacion estan modelados | Release exige gates financieros/custodia y transporte de jobs; no se reclama payout real |

## Gates observables

- `TUS_ROUTES_ENABLED` controla la exposicion del router TUS.
- `TUS_PROVIDER_ACTIONS_ENABLED` controla webhooks y acciones de providers.
- `TUS_RELEASE_JOBS_ENABLED` es el flag de activacion de jobs de release.
- El integration router parte de gates deshabilitados para legal, KYC, KYB, tax, Mercado Pago, POS y AWS.
- La composicion Prisma no debe cambiar a un provider real hasta que exista evidencia de ownership, secrets, conformance,
  observabilidad, reconciliacion y rollback.

## Decision

WEB-09 queda cerrada como auditoria de alcance, no como build de activacion. No se agrega una UI de pago, suscripcion,
recommendation integrada o payout porque las rutas y contratos existentes no prueban una capacidad operativa segura. La
proxima activacion debe ser una decision separada, con target autorizado y evidencia verificable.
