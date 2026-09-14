# TUS — Contexto operativo para agentes

Este documento resume el contexto mínimo estable necesario para trabajar en TUS. Para tareas normales, leer este archivo + `AGENTS.md` + `ESTADO_NORMALIZACION_TUS.md` + código de la tarea. Consultar documentación extensa solamente cuando una frontera sensible lo requiera.

## 1. Producto

TUS es un marketplace y sistema operativo de intermediación entre clientes y prestadores/comercios. El backend registra el ciclo comercial y operativo; no debe asumirse que cada provider externo, worker o integración está activo.

Flujo conceptual respaldado por el dominio actual:

`solicitud` → `descubrimiento` → `cliente selecciona prestador` → `prestador acepta` → `compromiso/reserva` → `ejecución` → `evidencia` → `pago/comisión` → `cierre` → `soporte/reclamo cuando corresponda`.

Las operaciones de dinero están preparadas y gobernadas por habilitación, pero el provider de pagos puede dejar la operación en hold determinista. No confundir capacidad modelada con integración productiva.

## 2. Arquitectura mínima

```text
apps/web                    Frontend Next.js 15 / React 19
apps/api                    Backend principal Express / TypeScript
apps/mobile                 Aplicación Expo / React Native
apps/workflow-runtime-python Worker separado para workflows e IA
packages/contracts          JSON Schemas y tipos compartidos TS/Python
apps/api/prisma             Prisma schema y migraciones PostgreSQL
Redis                       Cache, rate limit y límites auxiliares; también frontera del worker
pgvector                    Vectores para la preparación RAG
```

El flujo esperado es `Web/Mobile → API TUS → PostgreSQL`, con Prisma y SQL en adapters. `packages/contracts` es la frontera compartida entre API, Web, Mobile y worker. MongoDB existe en infraestructura de conexión/proyección, pero no es la fuente de verdad de los agregados TUS actuales.

La arquitectura declarada es Clean/Hexagonal, aunque las carpetas antiguas de `domain/`, `application/`, `infrastructure/` y `presentation/` no sustituyen al wiring efectivo de `apps/api/src/tus/`. Verificar siempre el montaje real.

Flags importantes:

- `TUS_ROUTES_ENABLED` controla el montaje de las rutas TUS y está apagado por defecto.
- `TUS_PROVIDER_ACTIONS_ENABLED` controla las acciones de providers externos y está apagado por defecto.
- `contractVersion` de TUS vigente: `1.0.0`.

## 3. Mapa dominio → carpeta

| DOMINIO | UBICACIÓN | RESPONSABILIDAD |
| --- | --- | --- |
| Prestadores y publicaciones | `apps/api/src/tus/catalog` | Perfil del prestador, publicaciones, catálogo y mercado de servicios; históricamente mezcla catálogo + marketplace. |
| Compromisos | `apps/api/src/tus/commitments` | Ciclo de vida de compromisos comerciales, transiciones, idempotencia y compensaciones. |
| Reservas/calendario | `apps/api/src/tus/calendar` | Calendarios, reglas, franjas, disponibilidad, capacidad y reservas. |
| POS | `apps/api/src/tus/pos` | Operaciones manuales, sesiones, comprobantes, versiones, conflictos y compensaciones. `manual-service` es operación manual de servicio en POS. |
| Entrega | `apps/api/src/tus/delivery` | Zonas, turnos, tareas, asignación, evidencia/comprobantes, incidentes y SLA. |
| Soporte | `apps/api/src/tus/support` | Casos, evidencias, timeline y compensaciones de soporte. |
| WhatsApp | `apps/api/src/tus/whatsapp` | Acciones gobernadas, consentimiento, confirmaciones, plantillas, handoff y outbox del canal. No es soporte. |
| Finanzas | `apps/api/src/tus/finance` | Intenciones/pagos, comisiones, ledger/movimientos, evidencia financiera, congelamientos, conciliación y adapters de providers. |
| Facturación | `apps/api/src/tus/billing` | Facturas, líneas, suscripciones, notas de crédito, reintegros, perfiles/cuentas fiscales, ledger de facturación, exportación y secuencias. Tiene servicio y persistencia, pero no está expuesta por rutas HTTP ni registrada en `createPrismaTusApplication` actualmente. |
| Habilitación | `apps/api/src/tus/readiness` | Evidencia, gates, decisiones y bloqueo de capacidades antes de ejecutar operaciones sensibles. |
| Reporting | `apps/api/src/tus/reporting` | Reportes operativos, SEO/discovery auxiliar, robots y sitemap; es un módulo conectado al router, no un ledger. |
| Composición | `apps/api/src/tus/composition` | Construcción de servicios y adapters Prisma de los dominios conectados. |
| Puertos/adapters | `apps/api/src/tus/ports`, `apps/api/src/tus/adapters` | Interfaces de persistencia/infraestructura y sus implementaciones in-memory/Prisma. |
| Integraciones TUS | `apps/api/src/tus/integration` | Router de acciones de providers externos, sujeto a habilitación y provider disponible. |

Otros módulos API relevantes:

- `apps/api/src/auth-security`: autenticación, sesiones, MFA, passkeys, OAuth/OIDC, vinculación de cuentas y refresh.
- `apps/api/src/tenancy`: contexto tenant, organizaciones, workspaces, membresías, roles y autorización.
- `apps/api/src/ai/registry`: catálogo TypeScript de prompts/modelos/rollouts/aprobaciones y auditoría IA.
- `apps/api/src/platform`: jobs, outbox, idempotencia, eventos, assets, configuración, cuotas, recuperación y reconciliación.
- `apps/api/src/providers`: adapters API de Mercado Pago y WhatsApp; no asumir que están cableados al runtime.

## 4. Terminología canónica

Usar estos nombres en el dominio propio, con identificadores TypeScript sin tildes:

| Término anterior | Término TUS |
| --- | --- |
| Provider de negocio | Prestador |
| Customer | Cliente |
| User | Usuario |
| Merchant | Comerciante, salvo decisión semántica específica |
| Listing | Publicacion |
| Commitment | Compromiso |
| Booking | Reserva |
| Quote | Presupuesto |
| Evidence | Evidencia |
| Payment | Pago |
| Commission | Comision |
| Claim | Reclamo |
| Dispute | Disputa |
| Service Area | ZonaServicio |
| Availability | Disponibilidad |
| Settlement | Liquidacion |
| Refund | Reintegro |
| Reconciliation | Conciliacion |
| Invoice | Factura |
| Subscription | Suscripcion |
| Delivery Task | TareaEntrega |
| Support Case | CasoSoporte |
| Marketplace | MercadoServicios |
| Readiness | Habilitacion |
| Workspace | EspacioTrabajo como objetivo interno |

Mantener deliberadamente `Tenant`, `tenantId`, `POS` y `WhatsApp`. También se conservan primitivas técnicas, nombres de frameworks y nombres exigidos por integraciones externas.

## 5. Decisiones semánticas importantes

- `MarketplaceMerchantProfile` se normalizó conceptualmente como `PerfilPrestador`.
- `Business Job` es `Trabajo`; `Technical Job` sigue siendo `Job`.
- `Reserva` y `Compromiso` son agregados distintos.
- `Pago` y `Facturación` son responsabilidades distintas. `Ledger` tampoco es un pago.
- `WhatsApp` y `Soporte` son fronteras distintas; WhatsApp puede derivar un caso a soporte.
- `POS` y `Entrega` son operaciones distintas.
- `Registry IA` y `LangGraph registry` tienen autoridades distintas.
- `RAG` y `LangGraph` son conceptos distintos.
- `Tenant` no es `Workspace`; `Organization` tampoco es `Tenant`.
- `manual-service` significa operación manual de servicio en POS; no es un trabajo comercial completo.
- `Checkout` actual crea compromisos y reserva capacidad/stock. No traducirlo mecánicamente ni reducirlo a un simple pago.

## 6. Fronteras sensibles

- **Contracts/API:** renombrar un tipo interno no autoriza cambiar un payload, estado, error, permiso, envelope ni `contractVersion`.
- **Prisma:** un refactor interno no renombra modelos, delegates ni nombres físicos.
- **PostgreSQL:** la normalización física es una fase separada.
- **Eventos:** no cambiar strings serializados ni nombres de eventos durante un rename interno.
- **Proveedores:** conservar payloads y nombres exigidos por Mercado Pago, Meta/WhatsApp, OAuth/OIDC y otros terceros.
- **Auth/Tenancy:** bloque de alta sensibilidad por identidad, aislamiento, sesiones, Membership y SQL raw.
- **Dinero:** preservar `BigInt`, unidades menores, ARS, redondeos, snapshots, ledger append-only y cálculos.
- **Aislamiento:** consultas, claves únicas y acceso por ID deben permanecer limitados por `tenantId` y por `workspaceId` cuando corresponda.

## 7. Reglas de persistencia

Objetivo físico futuro: PostgreSQL en `snake_case` español, sin acentos. Los nombres actuales todavía no se deben cambiar por un refactor semántico interno.

Para la futura fase física usar migraciones seguras y forward-only, preferentemente `ALTER ... RENAME`, preservando:

- datos;
- PK y FK;
- índices y uniques;
- checks;
- triggers;
- auditoría, idempotencia y outbox.

Nunca ejecutar `migrate reset`, editar migraciones aplicadas ni destruir/recrear datos para una normalización. No renombrar base de datos, Prisma y semántica interna simultáneamente sin un plan coordinado.

## 8. Builds y validación

- Una responsabilidad coherente por Build; idealmente 2–5 archivos.
- No arreglar bugs o deuda fuera del alcance declarado.
- Revisar primero el contrato, la persistencia y los consumidores de la frontera afectada.
- Hacer el cambio pequeño y preservar runtime, serialización, estados, eventos y permisos.
- Ejecutar typecheck, tests focales, `contracts:validate`, `git diff --check` y revisión manual del diff.
- Mantener un commit aislado por Build o fase.
- Detenerse y pedir decisión ante una frontera inesperada, un contrato ambiguo o un cambio físico no planificado.

## 9. Baselines y deuda no automática

Encontrar esta deuda durante otra Build no autoriza corregirla:

- ciertos HTTP `404` de Marketplace;
- `404` baseline de Delivery/POS;
- Finance P8 `404` vs `202` si continúa reproduciéndose como baseline;
- SQL raw de `Membership` desalineado con el schema actual;
- `RefreshTokenFamily` y outbox pendientes de integración/exposición coordinada;
- aliases HTTP antiguos junto a `/tus/v1/*`;
- worker Python incompleto/parcial y adapters externos no disponibles;
- nombres legacy `@factory`, `@repo`, `product-factory`, `factory`, `alqui` y similares.

## 10. Legacy controlado

La rama actual todavía contiene nombres de workspace y configuración como `@factory`, `product-factory` y `factory`. También permanecen referencias legacy `@repo` en paquetes/documentación y namespaces `alqui` en Mobile (claves de almacenamiento, metadata y retry). `golden-boilerplate`, `DocPhone` y `backendFiles` aparecen en material histórico o superficies auxiliares; `apps/api/backendFiles` y `apps/reference` no son superficies productivas actuales.

La limpieza de estos nombres es una fase posterior. En especial, las claves Mobile `alqui:*`, `alqui-*` y `alqui.` requieren migración compatible antes de tocarse.

## 11. Documentación adicional

| TIPO DE TAREA | DOCUMENTACIÓN ADICIONAL |
| --- | --- |
| Tarea interna normal | No leer nada adicional salvo el código de la tarea. |
| Arquitectura | `ARCHITECTURE.md`; contrastarlo con el wiring actual. |
| Persistencia o migraciones | `docs/DESARROLLO_LOCAL_TUS.md` y `apps/api/prisma/schema.prisma`/`migrations`. |
| Terminología dudosa | `docs/GLOSARIO_TUS.md`. |
| Historia o auditoría | Auditorías y evidencias solamente ante una duda concreta. |
| Desarrollo local | `docs/DESARROLLO_LOCAL_TUS.md`. |
| Flujos de IA/workflows | `apps/workflow-runtime-python/README.md`, contracts y archivos del worker involucrados. |
| Orientación arquitectónica humana | `docs/GUIA_ESTRUCTURA_PROYECTO_TUS.md` si está disponible. |

**No releer todos los documentos por defecto.** La documentación histórica puede describir estados anteriores y no reemplaza la verificación del código actual.

## 12. Receta de contexto para futuros prompts

Para una Build normal:

Leer:

1. `AGENTS.md`
2. `docs/CONTEXTO_AGENTES_TUS.md`
3. `docs/ESTADO_NORMALIZACION_TUS.md`
4. únicamente los archivos del dominio de la tarea

Consultar `GUIA_ESTRUCTURA_PROYECTO_TUS.md` si se necesita orientación adicional. Consultar documentos históricos solo ante una duda concreta.
