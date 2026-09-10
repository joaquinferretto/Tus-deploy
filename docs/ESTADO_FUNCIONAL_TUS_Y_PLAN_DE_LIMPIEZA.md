# Estado funcional de TUS y plan de limpieza

**Fecha:** 2026-09-10
**Rama auditada:** `pre-cambios` (`HEAD = f8d9a8e`), árbol limpio salvo este informe.
**Regla de la fase:** no se borró, movió, renombró ni refactorizó nada. Solo se leyó código y se ejecutaron dos verificaciones no destructivas.
**Pregunta que responde:** qué funciona hoy, qué no, qué está conectado, qué falta para un TUS ejecutable de punta a punta y qué puede borrarse con seguridad.

---

## 1. Estado actual resumido

TUS es hoy un producto a medio construir con una base real y coherente, pero apagado por defecto y rodeado de capas históricas.

- **Existe un backend TUS real** en `apps/api/src/tus/**` con checkout, commitments, marketplace, calendario, finanzas, delivery, POS, WhatsApp, soporte, reporting, readiness y billing, más auth y tenancy con Prisma. El servidor arranca contra PostgreSQL.
- **Todo el negocio TUS está apagado por defecto.** `server.ts` solo monta el router TUS si `TUS_ROUTES_ENABLED=true` y las acciones de providers si `TUS_PROVIDER_ACTIONS_ENABLED=true`. En `render.yaml` y `vercel.json` ambas están en `false`. Se puede arrancar la API y tener prácticamente todo TUS apagado: solo quedan salud, auth y tenancy.
- **El dinero real está bloqueado por diseño.** En la composición Prisma, finanzas usa `UnavailableMercadoPagoFinanceProvider`: crea intenciones en estado `held-no-provider`, sin llamada a Mercado Pago. Los gates financieros (legal, KYC/KYB, tax, Mercado Pago, conciliación) están en `false`.
- **Billing existe pero no tiene rutas.** Dominio, servicio y adapter Prisma completos, sin registro en `server.ts` ni endpoints. Es código huérfano funcional.
- **Web y mobile son frontends TUS reales pero parciales.** Tienen login, sesión, dashboard, marketplace, operaciones, POS y recovery, con manejo de errores y estados de carga. Pero arrastran tres problemas: importan `apps/reference` en código productivo, el cliente web apunta a tres rutas que no existen en el API y mobile declara assets inexistentes.
- **Los contratos pueden unificarse.** `packages/contracts` valida 98 schemas y es importado por API, web, mobile y worker. Hay diferencias puntuales web/API que deben corregirse, pero es la base correcta para la fuente canónica.
- **PostgreSQL es la única fuente real.** El arranque exige `DATABASE_URL` y las tablas `TusReadinessEvidence`/`TusReadinessDecision`. Mongo solo hace conexión/salud/apagado y Redis solo `PING` y rate-limit. El worker Python está separado e incompleto.
- **Hay riesgos de base de datos antes de ejecutar.** La migración de lanzamiento no crea las tablas de readiness que el arranque exige, hay un lookup de marketplace potencialmente inválido, lecturas por ID global sin tenant y registro de auth que puede dejar tenants huérfanos.
- **El entorno local no puede verificarse completo hoy.** No hay `node_modules` instalados, `pnpm` solo está vía `corepack` (9.15.9) y el Node disponible (v24) queda fuera del rango declarado (`>=20.11 <23`). Solo se pudo validar contratos (98 schemas OK) y un test de contratos (3/3). Typecheck, builds y suites completas quedan pendientes de un entorno con dependencias instaladas, sin instalar nada masivamente en esta fase.

---

## 2. Qué funciona hoy

Verificado por lectura de imports, composición, rutas y dos ejecuciones reales (ver sección 11):

1. **Contratos versionados.** `node packages/contracts/scripts/validate-schemas.mjs` → 98 schemas validados. Test `p0-contracts` → 3/3 en este entorno sin dependencias instaladas.
2. **Arranque API con lifecycle.** `index.ts` → `server.ts`: correlación, helmet, CORS, rate-limit, body-limit, salud, auth, tenancy, TUS condicional, 404 y errores. Cierre ordenado de Postgres/Prisma, Mongo, Redis y HTTP.
3. **Auth con persistencia.** Registro, sign-in, sesión, sign-out, verificación de email, recovery, cambio de password y update de cuenta, con `PrismaIdentityStore`, sesiones durables por digest SHA-256 y rotación de refresh en SQL.
4. **Tenancy con persistencia.** Organizaciones, invitaciones y revocación, con `PrismaTenancyStore`.
5. **Checkout idempotente con transacción.** `TusApplicationService.checkout` con transacción Prisma (commitments, compensaciones, auditoría, idempotencia, outbox), claim/replay/conflicto y guard de readiness.
6. **Marketplace y calendario con Prisma.** Onboarding, listings, publicación, discovery, checkout, compromisos de cliente, calendarios, slots, reservas, cancelaciones y no-shows.
7. **POS y delivery con Prisma.** Operaciones manuales, reembolsos, cancelaciones, impresoras, dispositivos, sesiones, conflictos, tareas de delivery con evidencias e incidentes.
8. **Soporte, WhatsApp y reporting con Prisma.** Casos, evidencias, timelines, compensaciones, acciones/consentimientos/plantillas de WhatsApp y reportes de operaciones.
9. **Readiness con evidencia.** `TusReadinessGuard` conectado al router y a los servicios, con stores Prisma e in-memory.
10. **Web TUS real.** Dashboard con discovery/commitments/operations, checkout con idempotencia, POS, operaciones, recovery, sign-in, manifiesto PWA en español (`es-AR`), robots y sitemap.
11. **Mobile TUS real.** Login, sesión segura, POS con cola offline y cuarentena, sincronización, estados de conectividad y accesibilidad, con MMKV, SecureStore y Zustand.

---

## 3. Qué no funciona

1. **TUS apagado por defecto.** Sin flags, el API expone salud/auth/tenancy pero ninguna ruta `/tus/*`.
2. **Pagos reales.** Provider no disponible en composición Prisma; intenciones en `held-no-provider`. Webhooks de Mercado Pago/WhatsApp detrás de flag.
3. **Billing expuesto.** Sin rutas ni registro; imposible facturar por HTTP.
4. **Tres llamadas web rotas.** El cliente web usa `/tus/v1/discovery/offers`, `/tus/v1/merchant/operations` y `/tus/v1/customer/commitments`, que no existen en el router. Solo funcionan sus variantes `/tus/v1/marketplace/*`.
5. **Contrato neutral productivo desde `reference`.** Web y mobile importan `apps/reference/api/src/index`. Debe moverse a `packages/`.
6. **Assets mobile ausentes.** `app.config.ts` declara `adaptive-icon.png` y `splash-icon.png` inexistentes.
7. **Jobs/outbox/run-ledger genéricos sin cablear.** Adapters listos, boot principal sin ellos.
8. **AI registry solo en memoria.** Sin persistencia.
9. **Worker Python separado e incompleto.** Consumidor desactivado por defecto, sin ack/retry/DLQ/run-ledger, Dockerfile sin dependencias, comandos documentados inexistentes.
10. **Mongo y Redis sin rol de negocio.** Solo salud/lifecycle/rate-limit. Levantarlos como fuentes es innecesario hoy.
11. **Migración de lanzamiento incompleta.** No crea las tablas de readiness que el arranque exige.
12. **12 scripts de test no-op** con `process.exit(0)` que simulan cobertura.
13. **Suites fuera del runner y de CI.** Integración TUS, Python, mobile y mercado-pago no se ejecutan automáticamente.

---

## 4. Estado Backend

Entrypoint: `apps/api/src/index.ts` → `startServer()` en `apps/api/src/server.ts`. Verificado hoy por lectura.

| MÓDULO | EXISTE | MONTADO EN SERVER | USA POSTGRESQL | RUTAS ACTIVAS | FUNCIONAL | BLOQUEADOR |
|---|---|---|---|---|---|---|
| Auth (registro, login, sesión, recovery) | Sí | Sí, siempre | Sí, Prisma + SQL | `/auth/*` siempre | Sí | Ninguno para local |
| Usuarios/cuentas/credenciales | Sí | Sí vía auth | Sí | vía `/auth/*` | Sí | Ninguno |
| Tenancy (orgs, invitaciones) | Sí | Sí, siempre | Sí | `/tenancy/*` siempre | Parcial | `register` genera `tenantId` sin crear siempre `TusTenant`/`Organization`/`Workspace` |
| Clientes | Parcial: como tenant/account/commitment, sin modelo `Customer` | Vía TUS condicional | Sí | `/tus/v1/marketplace/customer/*` con flag | Parcial | Sin concepto propio; depende de flag |
| Prestadores/merchants | Sí | Vía TUS condicional | Sí | `/tus/v1/marketplace/*` con flag | Parcial | Flag + readiness |
| Marketplace/catálogo/productos/servicios | Sí | Vía TUS condicional | Sí | `/tus/v1/marketplace/*` con flag | Parcial | Flag + readiness |
| Reservas/calendario | Sí | Vía TUS condicional | Sí | `/tus/v1/calendar/*`, bookings con flag | Parcial | Flag + readiness |
| Commitments/operaciones | Sí | Vía TUS condicional | Sí | `/tus/checkout`, commitments, compensaciones con flag | Parcial | Flag + readiness |
| POS | Sí | Vía TUS condicional | Sí, `PrismaPosStore` | `/tus/*/pos/*` con flag | Parcial | Flag + readiness; `findUnique` por `commitmentId` en marketplace con unique compuesto |
| Pagos | Sí, intención y split | Vía TUS condicional | Sí | `/tus/*/finance/*` con flag | No real | Provider `Unavailable`; gates en false |
| Mercado Pago | Sí, adapter + provider | Solo con provider flag | Vía finanzas | `/tus/providers/mercado-pago/webhook` con flag | No real | Flag + `Unavailable` + gates |
| Finanzas (hold/release/disputas/reembolsos) | Sí | Vía TUS condicional | Sí | `/tus/*/finance/*` con flag | Parcial sin provider | Provider + gates |
| Billing | Sí, dominio+servicio+Prisma | No | Sí, adapters | Ninguna | No expuesto | Sin rutas ni registro |
| Delivery | Sí | Vía TUS condicional | Sí, `PrismaDeliveryStore` | `/tus/*/delivery/*` con flag | Parcial | Flag + readiness |
| Soporte | Sí | Vía TUS condicional | Sí | `/tus/*/support/*` con flag | Parcial | Flag + readiness |
| Reporting | Sí | Vía TUS condicional | Sí | `/tus/*/reports/operations`, SEO con flag | Parcial | Flag |
| WhatsApp | Sí, servicio + provider | Servicio con flag; webhook con provider flag | Sí | `/tus/*/whatsapp/*`, webhook con flag | Parcial sin provider | Flags + gates |
| Archivos/storage | Parcial: assets memoria + B2 declarado | Parcial | No, memoria | Vía assets si se cablea | No durable | Sin B2 cableado; `backendFiles` no cuenta |
| Notificaciones | Parcial, memoria | Parcial | No | Vía TUS si se usa | No durable | Sin provider cableado |
| Readiness | Sí, guard + evidencia Prisma | Sí, como guard | Sí | Transversal | Sí | Requiere tablas que la migración de lanzamiento no crea |

Middlewares reales en `server.ts`: correlación, helmet, CORS, rate-limit con Redis, body-limit, 404 y errores. No hay cluster en el código actual, aunque los documentos viejos lo afirman.

---

## 5. Estado Web

`apps/web` es un frontend TUS real, no una demo vacía: sesión, dashboard, checkout idempotente, POS, operaciones, recovery y PWA en español. Pero tiene rutas rotas y una dependencia indebida a `reference`.

| PANTALLA | RUTA | API QUE CONSUME | ENDPOINT | FUNCIONA | BLOQUEADOR |
|---|---|---|---|---|---|
| Inicio | `/` | Ninguna directa | — | Sí como landing | Ninguno |
| TUS dashboard | `/tus` | Marketplace, commitments, operations | `/tus/v1/marketplace/discovery`, `/tus/v1/marketplace/customer/commitments`, `/tus/v1/reports/operations` | Parcial | Flags API apagados; tres aliases rotos (ver abajo) |
| POS | `/tus/pos` | POS | `/tus/pos/manual-operations`, status, refunds, devices, sessions | Parcial | Flag API; contrato versionado estricto |
| Operaciones | `/tus/operations` | Reporting/soporte | `/tus/v1/reports/operations`, `/tus/v1/support/cases` | Parcial | Flag API |
| Sign-in | `/sign-in`, `/auth/sign-in` | Auth | `/auth/sign-in`, `/auth/session` | Sí con API | API sin TUS no impide login |
| Recovery | `/recovery`, `/auth/recovery` | Auth | `/auth/recovery/*` | Sí con API | Ninguno |
| Marketplace discovery | vía `/tus` | Marketplace | alias `/tus/v1/discovery/offers` | No | Ruta inexistente; usar `/tus/v1/marketplace/discovery` |
| Operaciones merchant | vía `/tus` | Marketplace | alias `/tus/v1/merchant/operations` | No | Ruta inexistente; usar `/tus/v1/marketplace/merchant/operations` |
| Commitments cliente | vía `/tus` | Marketplace | alias `/tus/v1/customer/commitments` | No | Ruta inexistente; usar `/tus/v1/marketplace/customer/commitments` |

Variables: `NEXT_PUBLIC_API_URL` canónica y `API_BASE_URL` legacy, con `NODE_ENV`. Contratos desde `@factory/contracts`. Sin mocks de datos en el flujo principal; errores, loading y estados vacíos implementados. Dependencia productiva indebida: `src/lib/neutral-contract-client.ts` importa `apps/reference/api/src/index`.

---

## 6. Estado Mobile

Expo con rutas `/(app)` y `/(auth)`, sesión segura y POS offline real. Nomenclatura legacy pendiente.

| PANTALLA | FUNCIÓN | API QUE CONSUME | PERSISTENCIA LOCAL | FUNCIONA | BLOQUEADOR |
|---|---|---|---|---|---|
| Login | Autenticación | `/auth/sign-in`, `/auth/session` | SecureStore | Sí con API | Ninguno para auth |
| Inicio app | Superficie TUS | Sesión + readiness | Zustand + MMKV | Parcial | Flags API |
| POS | Venta/servicio manual, cola offline, cuarentena, sync | `POST /tus/v1/pos/manual-operations`, status | MMKV cifrado + cuarentena | Parcial | Flag API; assets; contrato estricto |
| Operaciones | Consulta de operaciones | Reporting/soporte | Zustand/query | Parcial | Flag API |

Detalle:

- Expo Router, `app.config.ts` con perfiles dev/staging/prod, TLS estricto por perfil y `mockAuth` en dev.
- SecureStore para credenciales, MMKV cifrado para cola POS, Zustand para sesión/red/intents.
- Offline: `queue-manual-operations`, preserva conflicto y reporta, con cuarentena por formato legacy, metadata inválida, profile/tenant mismatch, operación inválida y dispositivo revocado.
- `EXPO_PUBLIC_API_URL` por perfil; prod falla cerrado sin valores, lo cual es correcto.
- Assets `adaptive-icon.png` y `splash-icon.png` declarados e inexistentes.
- Nomenclatura ajena: `alqui:*` en store y namespace de cola, `product-factory-core`, `factory-dev/staging`, `com.productfactory.core*`.
- Dependencia indebida: `src/application/neutral-contract-client.ts` importa `apps/reference/api/src/index`.

---

## 7. PostgreSQL/Prisma

Schema: ~95 modelos en `apps/api/prisma/schema.prisma`, desde identidad (`User`, `Account`, `Session`, `Device`) y tenancy (`Organization`, `Workspace`, `Membership`, `TenantRole`, `TusTenant`) hasta todo el dominio TUS (marketplace, calendario, commitments, finanzas, delivery, POS, soporte, WhatsApp, billing, readiness, outbox, run-ledger, RAG). Migraciones: 30 archivos SQL.

El arranque exige `DATABASE_URL` canónica de la raíz y las tablas `TusReadinessEvidence`/`TusReadinessDecision` (`lifecycle.ts`). Persistencia real por módulo: auth, tenancy, checkout/commitments, marketplace, calendario, finanzas, delivery, POS, soporte, WhatsApp y reporting usan Prisma. Billing tiene adapters Prisma completos pero sin rutas. Jobs/outbox/run-ledger genéricos, AI registry, assets y notificaciones siguen en memoria o sin cablear.

### Bloqueadores de base de datos para ejecutar TUS

**CRÍTICO**

1. La migración `20260909090000_tus_argentina_market_launch` no crea `TusReadinessEvidence` ni `TusReadinessDecision`, pero el arranque las exige. Sin ellas, el lifecycle declara esquema incompatible.
2. `PrismaMarketplaceStore` usa `findUnique({ where: { commitmentId } })` mientras `TusMarketplaceCommitment` solo tiene unique compuesto `[tenantId, commitmentId]`. Potencial query inválida en lectura de compromisos de marketplace.
3. `AuthService.register()` genera `tenantId` sin crear siempre `TusTenant`/`Organization`/`Workspace`, con riesgo de FK huérfana `Account.tenantId → TusTenant.id` y tenant sin estructura.

**ALTO**

4. Lecturas por ID global sin `tenantId`: lookup de commitments y varias lecturas de calendario usan solo ID. Riesgo de aislamiento entre tenants.
5. `PrismaTusAuditStore.list` y `PrismaTusOutboxStore.list` lanzan error por diseño (“expuestos por reporting/worker”), lo que corta cualquier lectura directa por esas vías.
6. Evidencia contradictoria: un documento declara PostgreSQL diferido sin conexiones y otro declara seed/migración exitosos. No se puede afirmar readiness sin reconciliar.

**MEDIO**

7. `billing/prisma.ts` usa `createMany` opcional y `orderBy` que deben probarse contra Postgres real; a nivel estático los modelos existen (`TusAccountingExport` incluido), pero no hay rutas que los ejerciten.
8. `TusMarketplaceCommitment` e índices de discovery/compromisos deben revisarse contra las queries de slots, solapes y operaciones merchant.
9. `vector` pgvector en `RagEmbedding` exige extensión y tipos que el smoke local no verifica.

**BAJO**

10. Índices y constraints legacy de fases `p2/p3/p4` conviven con los canónicos `tus_*`; no rompen, pero dificultan saber cuál es la tabla vigente por dominio.

---

## 8. Contratos frontend/backend

`packages/contracts` es apto como fuente canónica: 98 schemas validados hoy, importado por API, web, mobile y worker, con bindings TS/Python. Pero hay que corregir estas diferencias antes de declararlo canónico:

| ENDPOINT | BACKEND DEVUELVE | FRONTEND ESPERA | DIFERENCIA | IMPACTO |
|---|---|---|---|---|
| `GET /tus/v1/discovery/offers` | No existe; el API sirve `GET /tus/v1/marketplace/discovery` | Web `discover()` lo llama | Ruta inexistente | Discovery web roto; usar path marketplace |
| `GET /tus/v1/merchant/operations` | No existe; el API sirve `GET /tus/v1/marketplace/merchant/operations` | Web `merchantOperations()` lo llama | Ruta inexistente | Operaciones merchant web rotas |
| `GET /tus/v1/customer/commitments` | No existe; el API sirve `GET /tus/v1/marketplace/customer/commitments` | Web `customerCommitments()` lo llama | Ruta inexistente | Commitments web rotos por ese alias |
| `POST /tus/v1/marketplace/checkout` | `{ status: 'executed' \| 'replay', commitments }` | Web acepta `executed`/`replay` y mapea a `accepted`/`replayed` | Compatible | Ninguno; es el ejemplo a seguir |
| `POST /tus/v1/pos/manual-operations` | `{ status: 'accepted', operation, receipt }` o conflicto | Web y mobile parsean `accepted`/`replayed`/`conflict`/`pending`/`error` | Compatible | Ninguno en forma; mobile añade `queued-offline` local |
| Finanzas | `source: 'held-no-provider'`, `credentialsCollected: false` | Clientes no afirman captura ni settlement | Compatible por diseño | Ninguno; no prometer dinero real |
| Neutral contract | `apps/reference/api` in-memory | Web/mobile productivo lo importan | Fuente indebida | Mover a `packages/` sin cambiar forma |

---

## 9. Feature flags

Solo dos flags son leídas por el código del API. El resto son metadatos de despliegue o gates de evidencia, no interruptores de código.

| FLAG | DEFINIDA EN | DEFECTO | LEÍDA EN | HABILITA | DESHABILITA | DESARROLLO | TESTS | DOCKER | RENDER | VERCEL | PRODUCCIÓN |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `TUS_ROUTES_ENABLED` | Entorno; `false` en render/vercel | Apagado salvo `=== 'true'` | `server.ts:90` | Todo el router TUS | Negocio TUS por HTTP | Apagado salvo export | Tests usan in-memory o Prisma directo | Compose no la enciende | `false` | `false` | Apagado |
| `TUS_PROVIDER_ACTIONS_ENABLED` | Entorno; `false` en render/vercel | Apagado salvo `=== 'true'` | `server.ts:91` | Webhooks Mercado Pago/WhatsApp | Dinero y mensajería real | Apagado | Fixtures deterministas | No encendida | `false` | `false` | Apagado |
| `TUS_RELEASE_JOBS_ENABLED`, `TUS_FLEET_JOBS_ENABLED` | render/vercel/docs | `false` | No leídas en `src` | Nada en código | Nada | No efecto | Referencia en tests deploy | No efecto | `false` | `false` | Metadato |
| `TUS_MERCADOPAGO/WHATSAPP/AWS/CLOUD/LEGAL/TAX/KYC/KYB/POSTGRESQL/BROWSER/DEVICE/POS_PILOT/PRODUCTION_OPERATIONS_ENABLED` | render/docs | `false` | No leídas en `src` | Nada directo; readiness por evidencia Prisma | Nada directo | No efecto | Gates de evidencia | No efecto | `false` | — | Metadato |
| `WORKER_ENABLE_CONSUMER` | compose `false`, worker config | `false` | Worker Python | Consumidor Redis | Worker real | Apagado | No integrado | Apagado | `false` | — | Apagado |
| `QUEUE_PROVIDER`, `POSTGRES_PROVIDER`, `MONGO_PROVIDER`, `REDIS_PROVIDER` | compose/render | local/gestionado | Config/ownership | Perfil de infraestructura | Nada funcional | Local | Fakes | Local | Gestionado | — | Declarativo |

Respuesta directa: sí, hoy se puede arrancar la API con todo TUS apagado. Es el comportamiento actual y coherente con `not-production-ready`, pero debe quedar documentado y con un comando explícito para encender TUS en desarrollo.

---

## 10. Recorridos end-to-end

Convención: cada paso indica archivo → función → endpoint. Veredicto al final de cada recorrido.

### Recorrido A — Registro/login

1. Web `apps/web/src/lib/tus-auth-client.ts` → `restore/signIn` → `POST /auth/sign-in`.
2. API `apps/api/src/auth-security/http/auth-router.ts` → `createAuthRouter` → `service.signIn`.
3. API `apps/api/src/auth-security/application/auth-service.ts` → `signIn` → Prisma `Account`/`Session`.
4. Respuesta `{ session }` → web guarda en `sessionStorage`, mobile en SecureStore.
5. `GET /auth/session` → `DurableIdentitySessionResolver` → contexto tenant.

**FUNCIONA PARCIALMENTE.** Auth funciona, pero el tenant creado en registro puede quedar huérfano (bloqueador crítico 3).

### Recorrido B — Cliente entra a TUS

1. Web `/tus` → `tus-dashboard.tsx` restaura sesión.
2. `GET /auth/session` confirma `tenantId`/roles.
3. Dashboard pide discovery/commitments/operations.
4. Sin `TUS_ROUTES_ENABLED`, el router TUS no existe → 404.
5. Con flag, el guard de readiness exige evidencia → 403 bloqueado sin evidencia.

**NO FUNCIONA por defecto.** Se corta en el paso 4; con flag, en el paso 5.

### Recorrido C — Cliente busca producto o servicio

1. Web `tus-client.ts` → `discover`/`discoverMarketplace`.
2. `discover` llama `/tus/v1/discovery/offers` → **ruta inexistente**.
3. `discoverMarketplace` llama `/tus/v1/marketplace/discovery` → `router.ts:291` → `TusMarketplaceService.discovery` → `PrismaMarketplaceStore`.
4. Respuesta con items versionados.

**FUNCIONA PARCIALMENTE.** Solo por la variante marketplace y con flag + readiness.

### Recorrido D — Cliente abre una publicación

1. Discovery devuelve `listingId` y `availabilityVersion`.
2. No hay endpoint dedicado de detalle; se usa el item de discovery y operaciones merchant.
3. `GET /tus/v1/marketplace/merchant/operations` existe; el alias web `/tus/v1/merchant/operations` no.

**FUNCIONA PARCIALMENTE.** Falta detalle dedicado o corregir alias.

### Recorrido E — Cliente crea reserva/commitment

1. Web arma `cartId`, `requestHash`, `lines` e `idempotencyKey`.
2. `POST /tus/v1/marketplace/checkout` → `router.ts:320` → `application.checkout` → transacción Prisma.
3. Respuesta `executed`/`replay` → web mapea a `accepted`/`replayed`.
4. Calendario: `POST /tus/v1/calendar/bookings` → `ServiceCalendarService` → Prisma.

**FUNCIONA PARCIALMENTE.** Con flag + readiness + evidencia. Sin flag, 404.

### Recorrido F — Prestador consulta operaciones

1. Web `merchantMarketplaceOperations` → `/tus/v1/marketplace/merchant/operations` → `router.ts:302` → Prisma.
2. Variante `merchantOperations` → `/tus/v1/merchant/operations` → **inexistente**.
3. Reporte: `/tus/v1/reports/operations` → `TusReportingService` → Prisma.

**FUNCIONA PARCIALMENTE.** Por paths marketplace, con flag.

### Recorrido G — POS registra operación

1. Mobile `pos.tsx` → `createTusMobileClient` → cola MMKV + transporte fetch.
2. `POST /tus/v1/pos/manual-operations` → `router.ts:744` → `TusPosService` → `PrismaPosStore`.
3. Conflicto por idempotencia/versión → cuarentena local y revisión.
4. Offline → `queued-offline` local, sync posterior.

**FUNCIONA PARCIALMENTE.** Es el recorrido mejor construido, pero exige flag, readiness, contrato exacto y assets mobile.

### Recorrido H — Pago

1. `POST /tus/v1/finance/payment-intents` → `TusFinanceService` → `PrismaTusFinanceStore`.
2. Provider en Prisma = `UnavailableMercadoPagoFinanceProvider` → intención `held-no-provider`.
3. Webhook Mercado Pago detrás de provider flag.
4. Billing sin rutas: no hay factura por HTTP.

**NO FUNCIONA como dinero real.** Solo hold determinista. Por diseño hasta evidencia autorizada.

### Recorrido I — Entrega/delivery

1. `POST /tus/v1/delivery/tasks` → `TusDeliveryService` → `PrismaDeliveryStore`.
2. Aceptar/asignar/pick-up/transit/handoff/proof/fail/incidentes por rutas dedicadas.
3. Compromiso enlazado por lookup.

**FUNCIONA PARCIALMENTE.** Con flag + readiness. Sin flota ni providers externos.

---

## 11. Builds/typecheck/tests

Ejecutado hoy en este entorno, sin instalar dependencias ni tocar la BD:

| COMANDO | RESULTADO | ERROR | ARCHIVO RELACIONADO | IMPACTO |
|---|---|---|---|---|
| `node packages/contracts/scripts/validate-schemas.mjs` | OK, 98 schemas validados | Ninguno | `packages/contracts/schemas/**` | Contratos canónicos sanos |
| `node --experimental-strip-types --experimental-loader ./scripts/node-strip-types-loader.mjs --test tests/foundation/p0-contracts.test.mjs` | 3/3 pass | Ninguno | `tests/foundation/p0-contracts.test.mjs` | Contratos protegidos a nivel básico |
| `corepack pnpm --version` | 9.15.9 disponible vía corepack | `pnpm` no está en PATH directo | `package.json` engines | Instalación posible sin cambiar versiones |
| Typecheck API/web/mobile | No ejecutado | Sin `node_modules`; instalar violaría la regla de no instalar masivamente | `apps/*/tsconfig.json` | Pendiente con dependencias |
| Build API/web | No ejecutado | Sin `node_modules` | `scripts/build-api.mjs`, Next | Pendiente con dependencias |
| Suite completa `pnpm test` | No ejecutada | Sin dependencias; Node v24 fuera de rango `>=20.11 <23` | `scripts/test-runner.mjs` | Usar evidencia histórica + re-ejecutar en entorno correcto |

Evidencia histórica creíble pero a revalidar en `HEAD`: 498 tests, 98 contratos, typecheck/build/security/policy correctos, estado `not-production-ready`. No se toma como estado actual sin re-ejecución.

Tests que sí protegen TUS: suites `p8/p9` TUS, integración `tests/integration/tus/*`, foundation de auth/tenancy/persistencia, contracts, mobile `tus-pos` y compatibilidad Python. Falsos positivos: 12 scripts `test` con `process.exit(0)` en API, web, mobile y paquetes; deben reemplazarse por suites reales o eliminarse.

---

## 12. Bloqueadores críticos

Ordenados por impacto en un TUS ejecutable:

1. **TUS apagado por defecto** (flags en false en todos los despliegues). Sin esto no hay negocio por HTTP.
2. **Migración de lanzamiento sin tablas de readiness** exigidas por el arranque.
3. **Lookup marketplace por `commitmentId` global** contra unique compuesto.
4. **Tenant huérfano en registro** (FK y estructura incompleta).
5. **Lecturas por ID global sin tenant** (commitments, calendario).
6. **Tres aliases web inexistentes** (discovery, merchant, customer).
7. **Contrato neutral desde `reference`** en web y mobile productivos.
8. **Finanzas sin provider** (diseño correcto, pero bloquea dinero real).
9. **Billing sin rutas.**
10. **Assets mobile ausentes + Node fuera de rango + sin dependencias instaladas** (bloquea verificación, no diseño).

---

## 13. Código muerto

Sin consumidores reales: todo `backendFiles` (45), READMEs solitarios en carpetas vacías del API, CRUD Mongo empresarial, `packages/asset-pipelines`, `packages/workflows`, `packages/lifecycle`, ejemplo zod, `ai-contracts` como runtime, `email/events/queues/storage/providers/mercado-pago` como runtime productivo, wrappers `backend/`/`frontend/`, `example-store` web, `travelers_clean.sql`, `errorlogs.txt` y artefactos generados. Ver detalle y conteos en `docs/AUDITORIA_COMPLETA_REPOSITORIO_TUS.md`.

---

## 14. Código externo

DocPhone/docphone-v2, médico/medbot, travelers MySQL, `alqui`, `product-factory/factory`, `golden-boilerplate`, `@repo/*` legacy y fakes neutros anteriores. Todo fuera del runtime TUS; solo se rescatan primitivas genéricas neutralizadas.

---

## 15. Código duplicado

Audio frontend (dos variantes), workflows (contracts vs package), Mercado Pago (API vs package), storage, colas, eventos, email, retry/HTTP, redacción, cliente neutral, migraciones por dominio con solape, telemetría Python duplicada y documentación de arquitectura triple. Regla: una sola implementación productiva por responsabilidad; la canónica es la que está cableada al servidor o a `packages/contracts`.

---

## 16. Eliminación segura

Archivos sin consumidor, fuera del build/runtime y sin nada que TUS necesite:

| ARCHIVO/CARPETA | MOTIVO | CONSUMIDO POR | ACCIÓN | RIESGO |
|---|---|---|---|---|
| `travelers_clean.sql` | MySQL ajeno destructivo | Nadie | Eliminar/archivar fuera | Bajo |
| `errorlogs.txt` | Log medbot puerto 3001 | Nadie | Eliminar/archivar fuera | Bajo |
| `apps/workflow-runtime-python/build/lib/**` | Artefacto generado | Nadie | Eliminar + ignorar | Bajo |
| `*.egg-info/**` | Artefacto generado | Nadie | Eliminar + ignorar | Bajo |
| `packages/contracts/src/streams.js`, `streams.d.ts`, `*.map` | Generados en src | Nadie como fuente | Eliminar + generar en build | Bajo |
| `*.tsbuildinfo` | Caché TS | Nadie | Eliminar + ignorar | Bajo |
| `backendFiles/src/frontend-groq/**` (variante vieja + barrel roto) | Duplicada y rota | Nadie | Eliminar tras rescate audio-only | Bajo |
| `backendFiles/src/utils/text.ts` | Barrel sin importadores | Nadie | Eliminar | Bajo |
| `backendFiles/src/companion/adapters/backend-reuse.ts` | Falso reuse, handlers `undefined` | Solo Companion aislado | Eliminar | Bajo |
| `apps/web/src/store/example-store.ts` | Ejemplo | Nadie productivo | Eliminar | Bajo |
| READMEs solitarios en carpetas vacías del API | Sin código | Nadie | Eliminar | Bajo |
| `tests/test_telemetry*.py` duplicado | Doble cobertura igual | Ningún runner | Conservar uno | Bajo |

---

## 17. Eliminación después de migrar

| ARCHIVO/CARPETA | MOTIVO | CONSUMIDO POR | ACCIÓN | RIESGO |
|---|---|---|---|---|
| `apps/reference/api/src/index.ts` | Contrato útil en lugar indebido | Web, mobile, parity, tests | Mover a `packages/` y actualizar importadores | Alto si se rompe parity |
| Primitivas `backendFiles` sanas (retry, http, groq, audio-only, storage, redis, privacy, errors, textCleaner) | Útiles tras neutralizar | Solo `backendFiles` | Fusionar con providers/storage/errors/privacy | Medio, no duplicar |
| `packages/storage/queues/events/email/providers` | Fronteras posiblemente válidas | Solo tests | Adoptar una por vez desde API o retirar | Alto si se migra todo junto |
| `packages/mercado-pago` | Cliente portable | Nadie; API usa el suyo | Renombrar y unificar con provider API, o eliminar | Medio |
| `packages/workflows`, `asset-pipelines`, `lifecycle`, `zod-schemas` | Envolturas o ejemplos | Tests/decls | Fusionar con contracts o eliminar | Medio |
| `packages/ai-contracts` | Schemas sin dueño | Docs/tests | Mover útiles a contracts o dar manifiesto | Medio |
| `backend/`, `frontend/` | Wrappers nativos | Docs/scripts | Confirmar uso y eliminar o renombrar TUS | Bajo |
| Billing | Sin rutas | Nadie por HTTP | Registrar rutas o archivar como futuro | Medio |

---

## 18. Código que todavía no debe tocarse

- Schema Prisma y migraciones: hasta backup, reparación aditiva y seed reconciliado.
- `TusReadinessGuard` y readiness: ya cableado; no simplificar sin evidencia.
- Jobs/outbox/run-ledger: no cablear ni borrar hasta definir worker durable.
- Worker Python: no activar ni eliminar hasta decidir ownership, lease, DLQ y despliegue.
- Mongo/Redis en arranque: no quitar de salud hasta evidencia de opcionalidad.
- Terraform: no aplicar ni borrar hasta decidir despliegue real.
- OpenSpec completos sin archive: no archivar sin `sdd-verify`.
- Docs de evidencia: no reescribir snapshots; marcar `superseded` y añadir resumen en español.

---

## 19. backendFiles: eliminar vs rescatar

Destino final asumido: la carpeta desaparece. No se mueve completa.

**ELIMINAR (no pertenece a TUS):** Companion/Tilo completo, `medicalReport.ts`, `validation/medicalJson.ts`, controlador/rutas/cliente DocPhone Backblaze, `ai-api-client.ts` médico, variante vieja `frontend-groq`, barrel roto, `backend-reuse.ts`, `utils/text.ts`, `config/env.ts` como config (reemplazado por platform configuration), `routes/voice.ts` como ruta (sin auth/tenant/cuota).

**RESCATAR (genérico útil, fusionado sin duplicar):**

| ORIGEN | RESPONSABILIDAD | DESTINO TUS | FUSIONARSE CON |
|---|---|---|---|
| `src/ai/retry.ts` | Backoff/jitter/abort | `packages/providers/src/core` | Retry/gating existente; una sola semántica |
| `src/ai/http.ts` | Fetch retryable/timeouts | `packages/providers/src/core` | Timeouts y errores neutrales |
| `src/ai/groq.provider.ts`, `companion/adapters/groq-tts.ts` | STT/chat/TTS Groq | `packages/providers/src/groq` | `GroqSpeechAdapter`; detrás de gate con cuota y lineage |
| `src/frontend-groq-audio/*` sano | Contratos, recorder, cliente, workflow audio | Paquete audio/cliente neutral | Cliente web TUS; parametrizar endpoint fuera de `/reports/*` |
| `src/integrations/storage.ts` | Contrato + local FS | `packages/storage` | Ports B2/S3; con tenant, retención y cifrado |
| `src/integrations/redis.ts` | Operaciones Redis | `packages/queues` o events | Semántica durable con ack/retry; no segundo cliente |
| `src/privacy/anonymization.ts` | Anonimización PII | `apps/api/src/privacy` | `PrivacyService` con consentimiento y auditoría |
| `src/utils/errors.ts` | Errores seguros | `packages/errors` + middleware | Envelopes con correlation ID |
| `src/utils/textCleaner.ts` | Limpieza de texto | Utilidad neutral | Con tests e idiomas; no destructiva en payloads |

---

## 20. apps/reference

Cadena completa de imports productivos:

- `apps/web/src/lib/neutral-contract-client.ts:7` → `../../../reference/api/src/index` → usado para clientes neutrales web.
- `apps/mobile/src/application/neutral-contract-client.ts:7` → `../../../reference/api/src/index` → usado para clientes neutrales mobile.
- `scripts/validation/reference-parity.ts` y `contamination.ts` → reference web/mobile/api (uso legítimo de validación).
- Tests `p5-*` → fallbacks (uso legítimo de fixtures).

Propuesta: mover el contrato neutral a `packages/contracts` (encaja como contratos versionados existentes) o a un `packages/neutral-contracts` solo si el equipo quiere una frontera separada. No crear micro-package si cabe en contracts. Actualizar los dos importadores, parity y tests en una sola unidad. Dejar `apps/reference/*` como ejemplos o eliminarlo del runtime.

---

## 21. packages

| PAQUETE | VEREDICTO | MOTIVO |
|---|---|---|
| `contracts` | CONSERVAR | Fuente canónica real, 98 schemas OK hoy |
| `config` | CONSERVAR | Usado por API |
| `errors` | CONSERVAR | Usado por middleware |
| `observability` | CONSERVAR | Usado por API |
| `typescript-config` | CONSERVAR | Base TS real |
| `eslint-config` | CONSERVAR | Lint real; corregir README |
| `providers` | DUDOSO | Útil pero solo tests; resolver solape con storage/queues/email/events |
| `storage` | DUDOSO | Adoptar desde API o retirar |
| `queues` | DUDOSO | Adoptar como frontera única o retirar |
| `events` | DUDOSO | Consolidar con platform o retirar |
| `email` | DUDOSO | Adoptar o retirar |
| `mercado-pago` | FUSIONAR o ELIMINAR | Unificar con provider API; corregir namespace |
| `workflows` | FUSIONAR o ELIMINAR | Duplica contracts |
| `asset-pipelines` | ELIMINAR o FUSIONAR | Sin consumidores |
| `lifecycle` | FUSIONAR o ELIMINAR | API tiene lifecycle propio |
| `zod-schemas` | ELIMINAR o REEMPLAZAR | Solo ejemplos |
| `ai-contracts` | DUDOSO | Dar manifiesto/dueño o mover a contracts |

---

## 22. Nomenclatura legacy

- `product-factory-core`, `product-factory-api`, `factory-api/web/worker`, `factory_user/password/local` → `tus-*`.
- `native-api-wrapper`, `native-web-wrapper` → nombres TUS o eliminación.
- `com.productfactory.core*`, `factory-dev/staging`, `Factory Dev/Staging` → identidad TUS.
- `alqui:*` en store, MMKV y namespaces → `tus:*`.
- `@repo/*` → namespace vigente (`@factory` hoy, `@tus` si se decide migración).
- `golden-boilerplate.dev`, `Goldenrepo-js-py` → identidad TUS o archivo.
- `TRAVELERS`, medbot, DocPhone, medical, Companion/Tilo → fuera del runtime.
- Técnicos que se conservan: API, frontend, backend, middleware, controller, service, provider, adapter, repository, DTO, Prisma, PostgreSQL, Redis, Docker, worker, tests, packages, src.

---

## 23. Propuesta de estructura final

Surge del código que sí existe, sin carpetas vacías ideales:

```text
apps/
  api/
    src/
      tus/
      auth-security/
      tenancy/
      platform/
      providers/
      infrastructure/
      presentation/
    prisma/
  web/
  mobile/
  worker/            # solo si se justifica con ownership durable
packages/
  contracts/         # incluye contrato neutral hoy en reference
  config/
  errors/
  observability/
  providers/         # consolidado; absorbe storage/queues/events/email si se adoptan
  typescript-config/
  eslint-config/
docs/
scripts/
tests/
infra/               # solo lo que se despliegue de verdad
```

Fuera del árbol final: `backendFiles`, `reference` productivo, `backend/`, `frontend/`, micro-packages sin consumidores, SQL/logs externos, artefactos generados y nombres factory/alqui/DocPhone.

---

## 24. Orden exacto de limpieza

1. Tag `pre-cambios` y backup de trabajo. Reconciliar evidencia histórica contra `HEAD`.
2. Reescribir raíz en español alineada al código (`README`, `ARCHITECTURE`, `.ai-manifest`).
3. Fijar entorno verificable: dependencias con `corepack pnpm`, Node 20/22 según engines, sin cambios de versiones.
4. Corregir tooling: `@factory/errors`, namespace mercado-pago, `$ref` contracts, exports workflows, lint mobile, `dist/_expo`, security lint.
5. Mover contrato neutral desde `reference` a `packages/` con sus dos importadores, parity y tests.
6. Corregir los tres aliases web rotos o registrar las rutas canónicas que faltan.
7. Rescatar primitivas `backendFiles` una por vez, fusionando sin duplicar.
8. Archivar DocPhone/Companion/médico fuera del runtime.
9. Consolidar packages y renombrar legacy factory/alqui/repo.
10. Limpiar basura y artefactos con `.gitignore`.
11. Traducir `docs/` vigente y archivar snapshots/OpenSpec históricos.
12. Separar suites y CI (Node, integración PG, Python, mobile, paquetes); eliminar no-ops.
13. Recién entonces, con backup: reparar migraciones (readiness), bug marketplace, tenant huérfano y lecturas sin tenant, todo aditivo.
14. Eliminar `backendFiles/`, `reference` productivo, wrappers y carpetas vacías.
15. Re-ejecutar verificación completa y actualizar ambos informes.

---

## 25. Orden exacto para llegar a un TUS ejecutable

1. `docker compose up postgres` (o Postgres local) con `DATABASE_URL` de la raíz.
2. Aplicar migraciones Prisma pendientes tras la reparación aditiva; verificar `TusReadinessEvidence` y `TusReadinessDecision`.
3. Seed de desarrollo con confirmación explícita; crear tenant/organización de prueba coherente.
4. `TUS_ROUTES_ENABLED=true` para encender negocio; verificar `/tus/*` deja de dar 404.
5. Cargar evidencia de readiness del perfil `native-local`; verificar que el guard deja de dar 403.
6. Registro/login → `GET /auth/session` → discovery marketplace → checkout → POS → delivery/soporte.
7. `TUS_PROVIDER_ACTIONS_ENABLED=true` solo en entorno de prueba con fakes; dinero real queda bloqueado hasta gates.
8. Web con `NEXT_PUBLIC_API_URL` al API; mobile con `EXPO_PUBLIC_API_URL` por perfil.
9. Verificación: contratos, typecheck, build API/web, tests TUS/integración, lint y seguridad.

---

## Tabla final por área

| ÁREA | ESTADO | % APROXIMADO | PRINCIPAL BLOQUEADOR |
|---|---|---|---|
| Backend | Parcial, apagado por defecto | 65% | `TUS_ROUTES_ENABLED=false` + readiness sin evidencia |
| Web | Parcial real | 60% | Tres aliases inexistentes + import a `reference` |
| Mobile | Parcial real | 60% | Flag API + assets ausentes + import a `reference` |
| Base de datos | Modelo completo, migración con huecos | 70% | Tablas readiness faltantes en migración de lanzamiento |
| Auth | Funcional con Prisma | 85% | Tenant huérfano en registro |
| Marketplace | Implementado con Prisma | 60% | Flag + readiness + lookup por ID global |
| Reservas | Implementado con Prisma | 60% | Flag + readiness + lecturas sin tenant |
| POS | Implementado con offline mobile | 65% | Flag + readiness + contrato estricto |
| Pagos | Hold sin provider | 35% | Provider `Unavailable` + gates en false |
| Delivery | Implementado con Prisma | 60% | Flag + readiness |
| WhatsApp | Implementado, provider gated | 40% | Flags + gates + sin provider real |
| Tests | Amplios pero parciales en CI | 55% | 12 no-ops + suites fuera del runner/CI |
| Deploy | Declarado, no verificado vivo | 30% | Todo TUS y providers en false; Compose sin smoke |
