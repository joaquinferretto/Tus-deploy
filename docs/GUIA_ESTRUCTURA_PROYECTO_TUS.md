# Guía de estructura del proyecto TUS

Guía práctica de la estructura vigente. Para una tarea normal, comenzar por `AGENTS.md`, `docs/CONTEXTO_AGENTES_TUS.md`, `docs/ESTADO_NORMALIZACION_TUS.md` y el código del dominio afectado. Esta guía agrega orientación para personas; no reemplaza los contratos ni el código.

## 1. Qué es TUS

TUS es un marketplace y sistema operativo de intermediación entre clientes y prestadores/comercios. El backend organiza operaciones comerciales, operativas y de protección; los providers externos y el worker no deben asumirse activos solo porque exista su código.

Flujo conceptual:

```text
solicitud
  → descubrimiento
  → cliente selecciona prestador
  → aceptación
  → compromiso/reserva
  → ejecución
  → evidencia
  → pago/comisión
  → cierre
  → soporte/reclamo cuando corresponda
```

## 2. Vista general del monorepo

```text
apps/
  api/                         Backend Express/TypeScript
  web/                         Frontend Next.js/React
  mobile/                      Aplicación Expo/React Native
  workflow-runtime-python/    Worker separado de workflows e IA
packages/
  contracts/                   Schemas y tipos compartidos
  config/ errors/ observability/ providers/ queues/ storage/ workflows/ ...
tests/
  foundation/                  Smoke y pruebas de capacidades/fundación
  integration/                 Flujos integrados, principalmente TUS
  compatibility/               Compatibilidad TS/Python, LangGraph, RAG y runtime
docs/                          Decisiones, operación, contratos y referencias
scripts/                       Build, validación, migraciones de reparación y tests
```

Las aplicaciones principales viven bajo `apps/`. Las carpetas raíz `backend/` y `frontend/` existen como superficies auxiliares con configuración mínima; no sustituyen a `apps/api`, `apps/web` ni `apps/mobile`.

### Comunicación principal

```text
Web / Mobile
      ↓ HTTP y contracts
apps/api
      ↓ Prisma / SQL
PostgreSQL
```

`Redis` es infraestructura auxiliar para rate limiting, readiness y la frontera del worker. `pgvector` se utiliza en la preparación de embeddings/RAG. El worker Python es un runtime separado y no es una etapa obligatoria del flujo comercial principal.

## 3. Backend — `apps/api`

`apps/api` es el backend principal Express/TypeScript. El arranque está en `apps/api/src/server.ts`; allí se construyen Auth, Tenancy y la composición de TUS. Las rutas TUS se montan solo si `TUS_ROUTES_ENABLED=true`; las acciones de providers dependen de `TUS_PROVIDER_ACTIONS_ENABLED=true`.

La lógica propia de TUS está concentrada en `apps/api/src/tus/`. La composición efectiva está en `apps/api/src/tus/composition/index.ts`, y los adapters compartidos en `apps/api/src/tus/adapters/`.

| CARPETA | DOMINIO | RESPONSABILIDAD |
| --- | --- | --- |
| `catalog` | Prestadores, publicaciones y mercado | Perfil del prestador, publicaciones, discovery, stock/capacidad y checkout del mercado. Históricamente mezcla catálogo + marketplace. |
| `commitments` | Compromisos | Obligaciones comerciales, transiciones de estado, idempotencia y compensaciones. |
| `calendar` | Reservas y calendario | Calendarios, reglas, slots, disponibilidad, capacidad y reservas. |
| `pos` | Punto de venta | Operaciones manuales, sesiones, dispositivos, comprobantes, versiones, conflictos y compensaciones. |
| `delivery` | Entrega | Zonas, turnos, tareas, asignaciones, evidencia, incidentes y SLA. |
| `support` | Soporte | Casos, evidencias, timeline y compensaciones de soporte. |
| `whatsapp` | Canal WhatsApp | Consentimiento, acciones, confirmaciones, plantillas, handoff y outbox gobernado. |
| `finance` | Finanzas | Pagos/intenciones, comisiones, ledger, evidencia financiera, congelamientos y conciliación. |
| `billing` | Facturación | Facturas, líneas, suscripciones, notas de crédito, reintegros, cuentas/perfiles fiscales, ledger, secuencias y exportación. Servicio y persistencia existen; actualmente no hay rutas HTTP Billing ni registro en la composición Prisma de TUS. |
| `readiness` | Habilitación | Gates, evidencia y decisiones que autorizan o bloquean capacidades sensibles. |
| `reporting` | Reporting operativo | Reportes operativos y auxiliares de discovery/SEO, robots y sitemap; no es un ledger. |

Otros puntos importantes:

- `apps/api/src/tus/http/router.ts`: endpoints y aliases de TUS.
- `apps/api/src/tus/ports/`: puertos de dominio y contexto autenticado tenant-scoped.
- `apps/api/src/tus/domain/`: tipos de dominio transversal, evidencias, soporte, compromisos y settlement.
- `apps/api/src/auth-security/`: autenticación, sesiones, refresh, MFA, passkeys y OAuth/OIDC.
- `apps/api/src/tenancy/`: tenant, organizaciones, workspaces, Membership, roles y autorización.
- `apps/api/src/platform/`: jobs técnicos, outbox, idempotencia, eventos, assets, cuotas y reconciliación.
- `apps/api/src/providers/`: adapters externos de Mercado Pago y WhatsApp; no asumir que están cableados al runtime.

## 4. Prestadores, publicaciones y mercado

El dominio está en `apps/api/src/tus/catalog/index.ts`.

- El perfil operativo/comercial del prestador se representa internamente como `PerfilPrestador`.
- Una `Publicacion` es una oferta visible de producto o servicio, con precio, disponibilidad, stock o capacidad según su tipo.
- `discover()` devuelve publicaciones publicadas y elegibles para discovery.
- El checkout del mercado valida precio, disponibilidad, stock/capacidad e idempotencia y crea compromisos.
- `catalog` contiene tanto responsabilidades de catálogo como parte del mercado de servicios por razones históricas.

**Prestador de negocio ≠ provider técnico.** `Prestador` ofrece y ejecuta servicios dentro de TUS. Un provider técnico es un adapter externo, por ejemplo Mercado Pago o WhatsApp.

## 5. Compromisos y reservas

`apps/api/src/tus/commitments/` administra la obligación comercial: estados, transiciones, compensaciones, auditoría y outbox.

`apps/api/src/tus/calendar/` administra el bloqueo de una franja, recurso o capacidad. Sus archivos principales son `bookings.ts`, `slots.ts` y `rules.ts`.

**Compromiso ≠ Reserva.** Un compromiso expresa una obligación comercial; una reserva ocupa una franja o capacidad. Un checkout puede crear compromisos y reservar capacidad, pero ambos conceptos no deben fusionarse.

## 6. POS y Entrega

`apps/api/src/tus/pos/` registra operaciones del punto de venta y mantiene control de versiones, sesiones, comprobantes y conflictos. `manual-service` significa una operación manual de servicio en POS; no es una entidad completa de ejecución comercial.

`apps/api/src/tus/delivery/` administra la operación logística: zonas, turnos, tareas, asignaciones, transiciones, comprobantes/evidencias, incidentes y SLA.

**POS ≠ Delivery.** POS registra una operación comercial/manual. Delivery ejecuta y evidencia una tarea de entrega. No mover estados o persistencia de uno al otro sin un contrato explícito.

## 7. Soporte y WhatsApp

`apps/api/src/tus/support/` es el dominio de casos de asistencia, evidencias, timeline y compensaciones.

`apps/api/src/tus/whatsapp/` es un canal gobernado: consentimiento, acciones limitadas, confirmaciones, plantillas, idempotencia, auditoría y derivación controlada a soporte.

**WhatsApp ≠ Soporte.** Una acción WhatsApp puede terminar en `handoff` a soporte, pero el caso y su timeline pertenecen a `support`. Mantener nombres, payloads, estados y contratos exigidos por Meta/WhatsApp.

## 8. Finanzas y Facturación

### Finanzas — `apps/api/src/tus/finance/`

Incluye:

- pagos e intenciones de pago;
- comisiones e instantáneas de comisión;
- ledger/movimientos contables append-only;
- evidencia financiera y confirmación de cumplimiento;
- congelamientos por disputa, reintegro, riesgo o evidencia faltante;
- conciliación y estado del provider externo.

El provider puede estar ausente o bloqueado por habilitación; el código soporta una fuente determinista `held-no-provider`. No afirmar captura real de dinero sin evidencia del provider autorizado.

### Facturación — `apps/api/src/tus/billing/`

Incluye:

- facturas y líneas;
- suscripciones y planes;
- notas de crédito y reintegros;
- cuentas y perfiles fiscales;
- ledger de facturación;
- secuencias/numeración y exportación contable;
- auditoría, outbox e idempotencia de facturación.

**Pago ≠ Facturación.** Finanzas registra el movimiento, la comisión, la custodia o la conciliación. Facturación emite documentos, mantiene datos fiscales y exporta información contable.

## 9. Auth, Identity y Tenancy

Ubicaciones principales:

- `apps/api/src/auth-security/`: identidad de acceso, credenciales, sesión, Device, MFA, passkeys, OAuth/OIDC y refresh.
- `apps/api/src/tenancy/`: `TenantContext`, autorización, Organization, Workspace y Membership.
- `apps/api/prisma/schema.prisma`: modelos `User`, `Account`, `Organization`, `Workspace`, `Membership`, `TenantRole`, `Session`, `Device` y `TusTenant`.

| Concepto | Uso resumido |
| --- | --- |
| `User` / Usuario | Persona que utiliza o participa en TUS. |
| `Account` / Cuenta | Registro de acceso asociado a una identidad y tenant. |
| `Organization` | Unidad funcional que agrupa espacios y membresías. |
| `Workspace` | Espacio funcional dentro de una organización. |
| `Tenant` | Unidad técnica de aislamiento de datos y autorización. |
| `Membership` | Relación autorizada de un usuario con organización/workspace según el modelo actual. |
| `Role` | Conjunto de permisos. Puede aparecer como rol de identidad o tenant. |
| `Session` | Sesión autenticada, con tenant, dispositivo y permisos. |
| `Device` | Dispositivo reconocido o asociado a una cuenta. |

**Tenant ≠ Workspace. Organization ≠ Tenant.** `Tenant` y `tenantId` permanecen deliberadamente en inglés como excepción técnica. `RefreshTokenFamily` existe en SQL raw y su rotación está preparada, pero no debe tocarse sin revisar su frontera completa.

**SENSIBLE / PENDIENTE.** Auth/Tenancy requiere especial cuidado por identidad, aislamiento, sesiones, Membership y SQL raw. No normalizarlo como parte de una tarea ordinaria.

## 10. Contracts

`packages/contracts/` es la frontera contractual compartida entre API, Web, Mobile y el worker Python.

- `packages/contracts/schemas/`: JSON Schemas versionados para TUS, identidad, pagos, mensajería, jobs, workflows, RAG y gobernanza IA.
- `packages/contracts/src/`: tipos y exports TypeScript, incluidos `tus.ts`, `money.ts`, `streams.ts` y `workflows.ts`.
- `packages/contracts/generated/`: representaciones generadas para TypeScript y Python.
- `packages/contracts/scripts/validate-schemas.mjs`: validador de schemas.
- `contractVersion` vigente de TUS: `1.0.0`.

Los contracts definen payloads, propiedades, estados, errores y compatibilidad entre runtimes. **Cambiar un tipo interno ≠ cambiar un contrato.** Un rename dentro de `apps/api/src/tus` no autoriza modificar schemas JSON, DTOs compartidos, strings serializados ni rutas.

## 11. Prisma y PostgreSQL

Ubicaciones:

- Schema: `apps/api/prisma/schema.prisma`.
- Migraciones: `apps/api/prisma/migrations/`.
- Seed: `apps/api/prisma/seed.ts`.
- Cliente Prisma e infraestructura: `apps/api/src/infrastructure/database/prisma/`.
- Adapters TUS: `apps/api/src/tus/adapters/`, `apps/api/src/tus/finance/prisma.ts` y `apps/api/src/tus/billing/prisma.ts`.
- SQL raw general: `apps/api/src/data/postgres/sql/`.
- SQL raw de refresh: `apps/api/src/auth-security/adapters/postgres/sql/refresh-rotation.sql.ts` y `refresh-rotation-store.ts`.

PostgreSQL es la persistencia principal de identidad, tenancy y agregados TUS. Prisma cubre el schema y adapters; SQL raw se usa en caminos específicos. Las tablas/columnas actuales aún conservan nombres históricos.

Regla para la futura fase física:

- objetivo: `snake_case` español, sin acentos;
- migraciones forward-only, preferentemente `ALTER ... RENAME`;
- preservar datos, PK, FK, índices, uniques, checks y triggers;
- no ejecutar `migrate reset`;
- no editar migraciones ya aplicadas;
- no cambiar modelo Prisma y base física sin una migración coordinada y verificable.

## 12. Web

`apps/web` usa Next.js 15, React 19, Zustand 5 y TanStack React Query 5. Sus rutas están en `apps/web/src/app/`; las superficies TUS están bajo `app/tus/`, incluyendo dashboard, operaciones y POS.

Clientes y contratos principales:

- `apps/web/src/lib/tus-client.ts`: cliente HTTP TUS y rutas canónicas.
- `apps/web/src/lib/tus-auth-client.ts`: autenticación.
- `apps/web/src/lib/tus-resource-loader.ts`: carga tenant-scoped de recursos.
- `apps/web/src/lib/tus-ui-contract.ts`: estados y presentación UI.
- `apps/web/src/lib/api-client.ts`: cliente API general.

La Web consume `@factory/contracts` y actualmente usa rutas como `/tus/v1/marketplace/discovery`, `/tus/v1/marketplace/merchant/operations` y `/tus/v1/marketplace/customer/commitments`. **La normalización semántica de Web sigue pendiente**; no renombrar allí por reflejo de una Build interna.

## 13. Mobile

`apps/mobile` usa Expo 54, React Native 0.81, Expo Router, TanStack Query, Zustand, MMKV y Secure Store. `app/` contiene las rutas Expo; `src/application/` contiene clientes de Auth/TUS; `src/core/services/` contiene HTTP, query, almacenamiento y credenciales; `src/presentation/` contiene journeys y componentes.

El flujo POS Mobile conserva operaciones offline/pending, conflictos y cuarentena antes de sincronizar con TUS. Las claves locales y metadatos todavía incluyen legacy `alqui`; también existen nombres `product-factory` en configuración. No renombrar namespaces ni claves de almacenamiento sin una migración compatible.

## 14. Worker Python

`apps/workflow-runtime-python` es un runtime separado para ejecución de workflows e IA. La API y el worker se comunican mediante JSON Schemas compartidos en `packages/contracts/schemas`.

- Entrada mínima y validación de contracts: `src/worker/main.py`.
- Consumidor Redis/BullMQ-compatible: `src/worker/queue/consumer.py`.
- Base de graph: `src/worker/graph/base.py`.
- Módulos de IA: `src/worker/ai/`.
- Delivery, lifecycle, memoria y cola: subcarpetas correspondientes bajo `src/worker/`.

El worker está **preparado y parcial**. Tiene una ruta determinista de validación y una ruta de consumidor/grafo separada, pero no debe presentarse como parte activa del flujo principal comercial de TUS ni como worker productivo completo.

## 15. LangGraph

LangGraph prepara la orquestación de workflows complejos de IA: graphs, subgraphs, supervisors, estado, sesiones, herramientas y checkpointers.

La implementación vive en `apps/workflow-runtime-python/src/worker/langgraph/`:

- `registry/`: autoridad y registry de runtime LangGraph;
- `graphs/`: graphs;
- `subgraphs/`: subgraphs;
- `supervisors/`: supervisores.

El registry local es provider-free y registra el graph determinista `deterministic.echo.v1`; la preparación no prueba una integración productiva activa.

**Registry IA ≠ LangGraph registry.** El primero gobierna catálogo/versionado de capacidades IA. El segundo gobierna la orquestación de ejecución de graphs.

## 16. RAG

RAG significa *Retrieval-Augmented Generation*. En vez de entrenar el modelo, recupera información relevante y la entrega como contexto para generar una respuesta.

En TUS está preparado principalmente en:

- `apps/workflow-runtime-python/src/worker/rag/`: ingestión, parsing, chunking, embeddings, recuperación, reranking, citas, deduplicación, borrado, reindexación y reconciliación;
- `apps/workflow-runtime-python/src/worker/ingestion/vector_store.py`: loaders, `OpenAIEmbeddings` y `PGVector`;
- `apps/api/prisma/schema.prisma`: modelo `RagEmbedding`, metadata tenant/workspace, checksum, versiones y vector;
- `packages/contracts/schemas/rag/`: contracts de source, document, chunk e ingest result.

`embeddings` son representaciones vectoriales; `pgvector` almacena/consulta vectores en PostgreSQL; `RagEmbedding` es el registro persistente de metadata y vector; LangGraph puede orquestar un workflow que use RAG. **RAG ≠ entrenar el modelo. RAG ≠ LangGraph.** El código incluye adapters deterministas/no disponibles y no implica proveedor RAG activo.

## 17. Registry IA

El catálogo IA TypeScript vive en `apps/api/src/ai/registry/` (`domain.ts`, `composition.ts`, adapters y `index.ts`). Su persistencia y auditoría están modeladas en Prisma.

El Registry IA gobierna:

- prompts y sus versiones;
- modelos y provider/model name;
- disponibilidad;
- aprobaciones;
- rollouts porcentuales y estado;
- evaluaciones y auditoría.

Los schemas de gobierno están en `packages/contracts/schemas/ai-governance/`. **Registry IA ≠ LangGraph registry**: no registrar graphs en el catálogo de prompts/modelos ni usar el registry de LangGraph como fuente de aprobación comercial.

## 18. Tests

La estructura relevante es:

- `tests/foundation/`: contratos, seguridad, capacidades P0–P9, TUS y validaciones de base.
- `tests/integration/`: flujos que combinan módulos, HTTP, persistencia o durabilidad; TUS está en `tests/integration/tus/`.
- `tests/compatibility/`: compatibilidad Python/TypeScript, worker, LangGraph, RAG, embeddings y workflows.

| DOMINIO | TESTS PRINCIPALES |
| --- | --- |
| Marketplace/catalog | `tests/foundation/p7-tus-marketplace-operations.test.mjs`, `p8-tus-marketplace.test.mjs`, `p9-marketplace.test.mjs`, `tests/integration/tus/catalog-booking.test.mjs` |
| Commitments | `tests/foundation/p9-commitments.test.mjs`, `tests/compatibility/test_p9_commitment_ledger.py` |
| Calendar/reservas | `tests/integration/tus/catalog-booking.test.mjs` |
| POS/delivery | `tests/foundation/p8-tus-delivery-pos.test.mjs`, `p9-delivery-pos.test.mjs`, `tests/integration/tus/pos-durability.test.mjs` |
| Support/WhatsApp | `tests/foundation/p9-support-operations.test.mjs`, `p5-whatsapp.test.mjs`, `tests/integration/tus/whatsapp-delivery-billing.test.mjs` |
| Finance | `tests/foundation/p8-tus-finance.test.mjs`, `p9-finance.test.mjs`, `tests/integration/tus/finance-webhook.test.mjs` |
| Billing | `tests/foundation/p9-billing.test.mjs`, `tests/integration/tus/whatsapp-delivery-billing.test.mjs` |
| Auth/Identity | `tests/foundation/p1-auth-lifecycle.test.mjs`, `p1-identity-persistence.test.mjs`, `p1-refresh-rotation.test.mjs`, `p9-identity-http.test.mjs` |
| AI Registry | `tests/foundation/p4-ai-registry.test.mjs`, `p4-ai-governance.test.mjs`, `tests/compatibility/test_langgraph_registry.py` |
| RAG/LangGraph | `tests/foundation/p3-rag-ingestion.test.mjs`, `p3-rag-lifecycle.test.mjs`, `p3-langgraph-authority.test.mjs`, `tests/compatibility/test_p3_rag_ingestion.py`, `test_p3_rag_retrieval.py` |

No asumir que el script `test` raíz cubre Mobile, Python, integración o todos los packages; revisar el runner y ejecutar la suite focal apropiada.

## 19. Qué tocar según la feature

| QUIERO CAMBIAR | EMPEZAR EN | TAMBIÉN REVISAR |
| --- | --- | --- |
| Prestadores/publicaciones | `apps/api/src/tus/catalog` | Router, `packages/contracts/schemas/tus`, adapters Prisma, tests Marketplace |
| Compromisos | `apps/api/src/tus/commitments` | `catalog`, ports, Prisma, outbox/idempotencia y tests commitments |
| Reservas | `apps/api/src/tus/calendar` | `bookings.ts`, `slots.ts`, `rules.ts`, catalog, contratos y tests de integración |
| POS | `apps/api/src/tus/pos` | `delivery-pos.ts`, Mobile POS, contracts, Prisma y durabilidad |
| Entrega | `apps/api/src/tus/delivery` | POS adapter, router, contratos, Prisma e incidentes/SLA |
| Soporte | `apps/api/src/tus/support` | contracts, router, evidencia, timeline y tests soporte |
| WhatsApp | `apps/api/src/tus/whatsapp` | `apps/api/src/providers/whatsapp`, consentimiento, contracts, router y handoff |
| Pagos | `apps/api/src/tus/finance` | provider Mercado Pago, gates, ledger, Prisma, webhooks y contratos |
| Facturación | `apps/api/src/tus/billing` | `billing/prisma.ts`, schema/migrations, contracts y composición; recordar que no está expuesta por HTTP |
| Auth/login/sesiones | `apps/api/src/auth-security` | `tenancy`, `auth-router.ts`, SQL refresh, contracts y tests de identidad |
| Tenant/roles/Membership | `apps/api/src/tenancy` | Auth, `schema.prisma`, `data/postgres/sql/contracts.ts`, aislamiento y tests |
| Contracts | `packages/contracts` | Consumidores API/Web/Mobile/Python, `contractVersion`, validators y tests |
| Base de datos | `apps/api/prisma`, adapters y `apps/api/src/data/postgres/sql` | Migraciones, PK/FK/índices/checks/triggers, backup y tests de durabilidad |
| IA/RAG | `apps/workflow-runtime-python/src/worker` | `ai/registry`, `langgraph`, `rag`, `packages/contracts/schemas`, pgvector y tests compatibility |

## 20. Conceptos que no deben confundirse

| A | NO ES | DIFERENCIA |
| --- | --- | --- |
| Prestador | Provider técnico | El prestador ejecuta negocio; el provider integra una capacidad externa. |
| Reserva | Compromiso | Reserva ocupa slot/capacidad; compromiso registra obligación comercial. |
| Pago | Facturación | Pago/movimiento financiero no es documento fiscal ni exportación contable. |
| POS | Entrega | POS registra operación; Delivery ejecuta tarea logística. |
| WhatsApp | Soporte | WhatsApp es canal; Support es dominio de casos. |
| Evidencia | Auditoría | Evidencia respalda un hecho; auditoría registra quién hizo qué y con qué resultado. |
| Job técnico | Trabajo comercial | `Job` es ejecución de infraestructura; `Trabajo` es trabajo realizado para un cliente. |
| Registry IA | LangGraph registry | Catálogo gobernado de IA frente a autoridad de graphs/workflows. |
| RAG | LangGraph | Recuperación con contexto frente a orquestación de workflows. |
| Tenant | Workspace | Tenant aísla datos; Workspace agrupa actividad funcional. |
| Organization | Tenant | Organization agrupa usuarios/espacios; Tenant delimita aislamiento técnico. |

## 21. Estado actual

Según `docs/ESTADO_NORMALIZACION_TUS.md`:

```text
Semántica interna ✅
        ↓
Contracts/API ← SIGUIENTE
        ↓
Prisma
        ↓
PostgreSQL físico
        ↓
Legacy
        ↓
Web
        ↓
Mobile
        ↓
Auditoría residual / docs / tests
        ↓
Nuevas features
```

La semántica interna, habilitación, auditorías y Builds A–I están registradas como completadas. Esto no significa que Billing, providers, Web, Mobile o el worker estén completamente integrados. Auth/Tenancy queda **sensible y diferido**.

## 22. Reglas rápidas para desarrollar

1. Identificar el dominio y el agregado afectado.
2. Leer `AGENTS.md`, el contexto compacto y el estado de normalización.
3. Inspeccionar solo el código relevante y sus consumidores directos.
4. Revisar contracts antes de cambiar una frontera; revisar persistencia si aplica.
5. Hacer un cambio acotado, sin corregir deuda ajena.
6. Ejecutar typecheck y tests focales.
7. Ejecutar `contracts:validate` cuando se toca una frontera contractual.
8. Revisar `git diff`, ejecutar `git diff --check` y confirmar el alcance.
9. Crear un commit aislado por Build o fase.
10. Detenerse ante una frontera inesperada, un contrato ambiguo o la necesidad de una migración física no planificada.
