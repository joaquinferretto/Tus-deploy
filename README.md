# TUS

TUS es la superficie de comercio, agenda y operaciones de `product-factory-core`. El repositorio contiene una aplicacion web, una API HTTP, un cliente movil, contratos compartidos y un runtime Python para workflows.

El sistema esta disenado para que la interfaz nunca invente estados: una oferta, una reserva, un pago, una entrega o un caso de soporte solo se muestra como confirmado cuando existe una respuesta verificable del servidor.

## Para que esta destinado

TUS esta destinado a operar un marketplace local de productos y servicios, con foco inicial en:

- prestadores de `beauty-personal-care` y `repairs-trades`;
- publicaciones de productos y servicios;
- descubrimiento de oferta por tenant, cohorte y ubicacion;
- reservas de servicios sobre la agenda principal del prestador;
- compromisos comerciales separados por producto y servicio;
- seguimiento de entrega, pagos, liquidacion, soporte, WhatsApp y POS;
- trazabilidad mediante contratos versionados, auditoria y outbox.

TUS no es por si solo un procesador de pagos, una red de delivery ni un proveedor de WhatsApp. Es la capa que coordina esos limites, conserva hechos comerciales y bloquea acciones cuando falta evidencia o habilitacion.

## Estado actual

El repositorio es un monorepo privado gestionado con Turborepo y pnpm. La version de contrato TUS vigente es `1.0.0`.

La implementacion actual incluye:

- API TUS en TypeScript sobre Express.
- Web TUS en Next.js App Router y React.
- Aplicacion movil Expo/React Native.
- Persistencia PostgreSQL mediante Prisma para las superficies relacionales.
- Adapters y configuracion para MongoDB, Redis, almacenamiento, colas y proveedores externos.
- Contratos JSON Schema para interoperabilidad entre TypeScript y Python.
- Runtime Python preparado para LangGraph, con activacion fail-closed.
- Tests deterministas y tests de integracion HTTP.

Los flags de despliegue mantienen deshabilitados por defecto las rutas TUS, las acciones de proveedores, los release jobs, los fleet jobs y los consumidores externos. La habilitacion de produccion requiere evidencia y gates de readiness; una respuesta `disabled`, `pending`, `conflict` o `unavailable` no se interpreta como exito.

## Capacidades

| Area                | Responsabilidad                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Identidad y tenancy | Registro, inicio de sesion, recuperacion, sesiones, MFA, passkeys, OAuth/OIDC y aislamiento por tenant. |
| Marketplace         | Onboarding de prestadores, publicaciones, precio, stock, discovery, checkout e idempotencia.            |
| Agenda              | Calendarios, horarios, excepciones, zonas horarias, buffers, capacidad, cutoff y reservas.              |
| Compromisos         | Ciclo de vida, transiciones, compensaciones y consulta aislada por tenant.                              |
| Finanzas            | Payment intents, evidencias, confirmaciones, liberaciones, refunds, chargebacks y reconciliacion.       |
| Entrega             | Zonas, turnos, tareas, asignacion, retiro, transito, handoff, prueba, incidentes y devoluciones.        |
| POS                 | Dispositivos, sesiones, operaciones manuales, recibos, reembolsos, conflictos y fallas de impresora.    |
| Soporte             | Casos, evidencia, resolucion y enlace con el compromiso afectado.                                       |
| WhatsApp            | Consentimiento, plantillas, handoff y acciones permitidas.                                              |
| Reporting           | Reporte operativo con freshness, dimensiones y estados no afirmativos.                                  |
| Workflows           | Puente API-queue-Python con validacion de contratos compartidos.                                        |

## Flujo principal

El flujo de una operacion TUS sigue estas etapas:

1. La identidad autenticada produce el `tenantId`, el actor, la sesion, los roles y los permisos.
2. El prestador completa onboarding dentro de una cohorte habilitada.
3. El prestador crea y publica una `Publicacion` con facts comerciales y de disponibilidad.
4. El cliente consulta discovery y recibe la oferta actual junto con su `contractVersion`, `availabilityVersion`, evidencia y estado de disponibilidad.
5. El cliente envia checkout o reserva con una clave de idempotencia y un hash de la solicitud.
6. La API vuelve a validar precio, version, tenant, capacidad, franja, modalidad y permisos dentro de una transaccion.
7. La operacion confirmada se persiste junto con auditoria y evento outbox.
8. Las superficies posteriores consultan el estado del servidor y no reconstruyen exito a partir del transporte.

## Marketplace y agenda canonicos

El modelo canonico de servicios es `Publicacion`, no `serviceId`. `serviceId` sigue aceptandose solo por compatibilidad con las rutas de agenda existentes.

### Modalidades de servicio

Las publicaciones de servicio soportan los valores físicos de D1 y sus aliases legacy:

- `bookingMode: turno_fijo` o `fixed_shift`: requiere `durationMinutes` positivo.
- `bookingMode: visita_diagnostico`: requiere `durationMinutes` positivo.
- `bookingMode: duracion_estimada` o `variable_duration`: requiere `estimatedDurationMinutes` positivo.
- `bookingMode: requiere_presupuesto`: no genera slots ni booking automático.
- `priceMode: precio_fijo` o `fixed`: permite reserva automática con el precio publicado.
- `priceMode: precio_desde` y `por_hora`: conservan disponibilidad con el precio publicado.
- `priceMode: presupuesto` o `requires_budget`: bloquea slots y booking automático hasta que exista un presupuesto.

Discovery devuelve, cuando corresponde, `calendarId`, `bookingMode`, `estimatedDurationMinutes`, `priceMode` y `availabilityStatus`.

### Agenda principal

Una agenda de prestador se resuelve por `(tenantId, prestadorId)`. La API no elige una agenda arbitraria ni usa el `calendarId` enviado por el cliente para cambiar de prestador.

La generacion de slots considera:

- zona horaria IANA;
- horario de trabajo y dias bloqueados;
- duracion efectiva de la publicacion;
- granularidad de inicio;
- buffer;
- capacidad;
- slots pasados cuando se envia `now`;
- reservas confirmadas que ocupan la misma capacidad.

La identidad de un slot canonico es:

```text
calendarId:listingId:start
```

El booking canonico persiste `publicacionId` en PostgreSQL y retorna `listingId`. Las rutas y cuerpos legacy que usan `serviceId` siguen disponibles para no romper la superficie existente. La migración D1 correspondiente existe en el repositorio, pero no se aplica durante tests deterministas ni se ejecuta sobre un target no autorizado.

### Ejemplo de booking canonico

```http
GET /tus/v1/marketplace/listings/{listingId}/slots?date=2026-09-14&now=2026-09-14T11:00:00.000Z
Authorization: Bearer <session-token>
X-TUS-Contract-Version: 1.0.0
```

```http
POST /tus/v1/calendar/bookings
Authorization: Bearer <session-token>
Idempotency-Key: booking-123
Content-Type: application/json
```

```json
{
  "listingId": "listing-123",
  "customerId": "customer-123",
  "slotId": "calendar-1:listing-123:2026-09-14T12:00:00.000Z",
  "requestHash": "hash-of-the-request",
  "now": "2026-09-14T11:00:00.000Z"
}
```

El servidor deriva la autoridad desde la sesion. Los `tenantId`, `actorId` y permisos que lleguen desde el cliente no pueden reemplazar la autoridad autenticada.

## Arquitectura general

```text
                       +-----------------------------+
                       | Web Next.js / Mobile Expo  |
                       +--------------+--------------+
                                      |
                         HTTP JSON + contractVersion
                                      |
                       +--------------v--------------+
                       | Express API edge           |
                       | auth, tenant, CORS,        |
                       | rate limit, body, errors   |
                       +--------------+--------------+
                                      |
                       +--------------v--------------+
                       | TusApplicationService      |
                       | composition + use cases    |
                       +--------------+--------------+
                                      |
           +--------------------------+--------------------------+
           |                          |                          |
  +--------v---------+      +---------v--------+       +---------v--------+
  | TUS bounded      |      | Ports / stores   |       | Readiness /      |
  | contexts         |      | transaction      |       | activation gates |
  +--------+---------+      +---------+--------+       +------------------+
           |                          |
  +--------v--------------------------v--------+
  | In-memory adapters or Prisma adapters     |
  +-------------------+-----------------------+
                      |
       +--------------+--------------+----------------+
       |                             |                |
  PostgreSQL / Prisma          MongoDB / Redis   Providers / queues
       |
  +----v---------------------------------------+
  | Python workflow runtime                    |
  | LangGraph + shared JSON Schemas            |
  +--------------------------------------------+
```

El flujo de dependencias es hacia adentro:

```text
HTTP / UI -> application -> domain -> ports <- adapters -> infrastructure
                                      ^
                               contracts compartidos
```

La logica de negocio no debe importar Express, Prisma, Redis ni SDKs de proveedores. Los adapters implementan puertos y traducen formatos externos a modelos internos.

## Distribucion en capas

### 1. Presentacion

Responsable de recibir solicitudes y representar estados.

- `apps/web/src/app`: rutas, layouts, metadata, robots, sitemap y pantallas Next.js.
- `apps/web/src/components`: componentes de marketplace, calendario, compromisos y layout.
- `apps/web/src/lib`: cliente HTTP, sesion, resource loader, estados UI, formateo e intenciones.
- `apps/api/src/presentation`: middleware de seguridad, health checks, logging, errores y limites.
- `apps/api/src/tus/http/router.ts`: rutas HTTP TUS y aliases legacy/canonicos.

La UI separa estados `loading`, `empty`, `ready`, `pending`, `conflict`, `disabled` y `error`. Cada estado tiene semantica ARIA, accion de retry cuando corresponde y evidencia visible.

### 2. Aplicacion

Coordina casos de uso y transacciones sin conocer el transporte.

- `apps/api/src/tus/application/tus-application-service.ts` expone checkout general, lookup de compromisos, ciclo de vida, entrega y release evaluation.
- `apps/api/src/tus/composition/index.ts` arma las dependencias in-memory o Prisma.
- Los servicios de cada bounded context reciben puertos y politicas explicitas.

### 3. Dominio y bounded contexts

La carpeta `apps/api/src/tus` mantiene separadas las responsabilidades:

- `domain`: compromisos, settlement y reglas de dominio.
- `catalog`: prestadores, publicaciones, discovery y checkout de marketplace.
- `calendar`: reglas de agenda, slots y reservas.
- `commitments`: transiciones y compensaciones.
- `finance`: pagos, evidencias, liberacion, disputas y reconciliacion.
- `delivery`: fulfillment y prueba de entrega.
- `pos`: operaciones de punto de venta y conflictos.
- `support`: casos y resoluciones.
- `whatsapp`: consentimiento, plantillas y acciones.
- `reporting`: reporte operativo y freshness.
- `readiness`: evidencias, gates y decisiones de habilitacion.
- `integration`: webhooks y activation controller.
- `billing`: facturacion y estados fiscales; actualmente es un modulo de dominio y no una familia de rutas TUS montada por `server.ts`.

Cada contexto mantiene sus entidades, errores, validaciones, eventos y politicas de ownership.

### 4. Puertos

Los contratos de persistencia e integracion se definen como interfaces:

- `MarketplaceStorePort` para merchant, listings, commitments, idempotencia, auditoria y outbox.
- `ServiceCalendarStorePort` para agendas, reservas, idempotencia, auditoria y outbox.
- Puertos de compromisos, finanzas, entrega, POS, soporte, WhatsApp y reporting.
- Puertos de sesion, tenancy, readiness, transaccion y proveedores.

Esto permite ejecutar el mismo dominio con stores in-memory para tests o adapters Prisma para persistencia.

### 5. Adapters e infraestructura

- `apps/api/src/tus/adapters/in-memory.ts`: sesiones y primitives in-memory.
- `apps/api/src/tus/adapters/prisma.ts`: delegates Prisma compartidos y transacciones base.
- `apps/api/src/tus/adapters/prisma-marketplace.ts`: mapeo marketplace y modalidades almacenadas.
- `apps/api/src/tus/adapters/prisma-calendar.ts`: agendas, reglas, excepciones y reservas.
- `apps/api/src/infrastructure/database`: clientes y lifecycle de PostgreSQL, MongoDB y Redis.
- `apps/api/src/providers`: Mercado Pago, WhatsApp y otros limites externos.
- `apps/api/src/platform`: configuracion, jobs, lifecycle, outbox, quotas, reconciliation y observabilidad.

### 6. Contratos compartidos

`packages/contracts` es la frontera neutral entre procesos y lenguajes.

- TypeScript exporta tipos, constantes y validadores.
- `packages/contracts/schemas` contiene JSON Schemas versionados.
- La API y los tests validan payloads antes de cruzar la frontera.
- El worker Python carga los mismos schemas con `jsonschema`.
- La version TUS se mantiene en `1.0.0` salvo una decision explicita de evolucion.

## Aplicacion web

### Stack

- Next.js 15 con App Router.
- React 19.
- TypeScript.
- Zustand para estado local cuando corresponde.
- TanStack React Query como dependencia para estado de servidor.
- `typedRoutes: true` y `reactStrictMode: true`.
- Build standalone por defecto, salvo `NEXT_DISABLE_STANDALONE=true`.

### Rutas de usuario

| Ruta                              | Funcion                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `/`                               | Entrada publica y enlaces a los journeys TUS.                                         |
| `/sign-in`                        | Inicio de sesion autenticado.                                                         |
| `/recovery`                       | Recuperacion y retorno a la superficie solicitada.                                    |
| `/tus`                            | Workspace autenticado con discovery, compromisos, operaciones y recursos autorizados. |
| `/tus/mercado`                    | Listado de publicaciones, filtros y checkout.                                         |
| `/tus/mercado/{listingId}`        | Detalle de una publicacion.                                                           |
| `/tus/calendario/{calendarId}`    | Ruta legacy explícita; el journey nuevo parte de una publicación y usa `listingId`.    |
| `/tus/compromisos`                | Lista de compromisos del cliente.                                                     |
| `/tus/compromisos/{commitmentId}` | Detalle de un compromiso.                                                             |
| `/tus/operations`                 | Reporte operativo.                                                                    |
| `/tus/pos`                        | Superficie POS.                                                                       |

### Como trabaja el cliente

1. `tus-auth-client.ts` restaura la sesion y detecta expiracion o indisponibilidad.
2. `sessionRequestContext` produce el contexto que acompana cada request.
3. `tus-resource-loader.ts` carga discovery, compromisos, merchant operations y reporting en paralelo.
4. Las generaciones de carga cancelan respuestas viejas y evitan escribir sobre un componente desmontado.
5. `tus-client.ts` construye headers, rutas, idempotency keys y parsea respuestas.
6. Las intenciones de checkout y reserva conservan la misma clave para retry y replay.
7. Los servicios consultan slots reales por `listingId`, reservan antes de generar checkout y conservan su intervalo.
8. `tus-ui.tsx` representa estados, errores, live regions, skip link y acciones accesibles.

### Limites conocidos de la web

El journey nuevo de marketplace ya usa discovery, slots, booking y checkout por `listingId`. La ruta de calendario
`/tus/calendario/{calendarId}` conserva el flujo legacy `calendarId + serviceId` para consumidores explícitos, sin ser una
dependencia del journey nuevo. Servicios sin agenda (`not_configured`) o que requieren presupuesto (`BUDGET_REQUIRED`) no
ofrecen una acción automática; la Web tampoco fabrica `calendarId`, slots ni fechas.

## API HTTP

### Entrada del servidor

`apps/api/src/server.ts` compone:

1. correlation middleware;
2. Helmet;
3. CORS basado en configuracion;
4. rate limiting;
5. limites de body;
6. health/readiness;
7. auth y tenancy;
8. router TUS si `TUS_ROUTES_ENABLED=true`;
9. provider actions si `TUS_PROVIDER_ACTIONS_ENABLED=true`;
10. handlers de 404 y errores.

El proceso API carga configuracion PostgreSQL canonica desde `DATABASE_URL` o desde el `.env` de la raiz, reintenta la conexion con timeouts acotados y tiene shutdown coordinado.

### Familias de rutas

| Familia     | Rutas principales                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Health      | `GET /health`, `GET /ready`                                                                                                              |
| Auth        | `/auth/register`, `/auth/sign-in`, `/auth/session`, `/auth/sign-out`, `/auth/verify-email`, recovery, cuentas y credenciales.            |
| Tenancy     | `/tenancy/organizations`, invitations y membresias.                                                                                      |
| Core TUS    | `/tus/checkout`, `/tus/commitments/:commitmentId`, transiciones y compensaciones.                                                        |
| Marketplace | `/tus/v1/marketplace/*` y alias `/tus/v1/mercado-servicios/*`. Incluye onboarding, listings, publish, discovery, checkout y commitments. |
| Calendar    | `/tus/v1/calendar`, slots, bookings, cancel y no-show.                                                                                   |
| Finance     | payment intents, evidence, confirmations, release, disputes, refunds, chargebacks y reconciliation.                                      |
| Delivery    | zones, shifts, tasks, public bidding y transiciones de fulfillment.                                                                      |
| POS         | manual operations, devices, sessions, refunds, conflicts y printer failures.                                                             |
| WhatsApp    | consent, templates, support handoff y actions.                                                                                           |
| Support     | cases, evidence, resolution y consulta.                                                                                                  |
| Reporting   | `GET /tus/v1/reports/operations`.                                                                                                        |
| SEO         | `/tus/seo/robots.txt`, `/tus/seo/sitemap` y discovery model.                                                                             |
| Providers   | webhooks de Mercado Pago y WhatsApp bajo el router de integracion.                                                                       |

Los aliases legacy se mantienen de forma aditiva. No deben utilizarse para introducir una segunda fuente de verdad.

### Convenciones de request

Las requests protegidas usan:

- `Authorization: Bearer <token>`;
- `X-Tenant-Id`, `X-Actor-Id` y `X-Correlation-Id` cuando aplica al transporte;
- `X-TUS-API-Version: v1`;
- `X-TUS-Contract-Version: 1.0.0`;
- `Idempotency-Key` en comandos repetibles;
- `requestHash` para detectar reutilizacion de una clave con otro payload.

El servidor verifica el contexto de sesion, tenant, rol y permiso. Los campos de autoridad enviados por el cliente no tienen precedencia sobre la sesion.

## Persistencia y consistencia

### PostgreSQL

PostgreSQL es la fuente relacional para entidades y facts durables. Prisma modela, entre otros:

- `Prestador`;
- `Publicacion`;
- `CompromisoMercadoServicios`;
- `Calendario`;
- `ReglaCalendario`;
- `ExcepcionCalendario`;
- `Reserva`;
- auditoria, outbox e idempotencia.

Los datos de D1 para modalidades y agendas se persisten en PostgreSQL, pero la migracion correspondiente no se aplica durante tests deterministas. La politica de reparacion aditiva exige un baseline forward-only especifico para el target y prohibe replayar historicas con `prisma migrate deploy`; revisar `openspec/changes/tus-additive-migration-repair/design.md` antes de operar sobre una base existente.

### Dinero

El dominio conserva `priceMinor` y snapshots monetarios como `bigint` para evitar perdida de precision. La superficie HTTP elimina campos internos no serializables antes de responder JSON. No se debe cambiar dinero exacto a `number` dentro de adapters o stores para resolver un problema de serializacion.

### Idempotencia, transacciones y eventos

- Los commands repetibles reclaman una clave por `(tenantId, key)`.
- Un replay devuelve el resultado original.
- Un hash diferente para la misma clave produce conflicto.
- Stores in-memory serializan transacciones para reproducir carreras de stock y capacidad.
- La operacion y sus auditorias/outbox se escriben dentro de la frontera transaccional correspondiente.
- Los adapters Prisma codifican snapshots con una representacion JSON segura para idempotencia.

## Paquetes compartidos

| Paquete                      | Uso                                                                |
| ---------------------------- | ------------------------------------------------------------------ |
| `@factory/contracts`         | Tipos, versiones, validadores y JSON Schemas de interoperabilidad. |
| `@factory/config`            | Capas de configuracion y perfiles de runtime.                      |
| `@factory/zod-schemas`       | Validaciones Zod compartidas.                                      |
| `@factory/events`            | Eventos y nombres compartidos.                                     |
| `@factory/workflows`         | Definiciones de workflows.                                         |
| `@factory/lifecycle`         | Primitives de lifecycle.                                           |
| `@factory/errors`            | Errores compartidos.                                               |
| `@factory/observability`     | Telemetria y contratos de operaciones.                             |
| `@factory/storage`           | Contratos de storage.                                              |
| `@factory/queues`            | Contratos de transporte de jobs.                                   |
| `@factory/providers`         | Catalogo de adapters de proveedores.                               |
| `@factory/mercado-pago`      | Tipos, normalizadores y webhooks de Mercado Pago.                  |
| `@factory/email`             | Plantillas, ports y fakes de email.                                |
| `@factory/asset-pipelines`   | Contratos de pipelines de assets.                                  |
| `@factory/typescript-config` | Configuracion TypeScript compartida.                               |
| `@factory/eslint-config`     | Reglas ESLint compartidas.                                         |

## Estructura del repositorio

```text
.
├── apps/
│   ├── api/                       # Express API + Prisma + bounded contexts TUS
│   ├── web/                       # Next.js web application
│   ├── mobile/                    # Expo / React Native
│   └── workflow-runtime-python/   # Worker Python y LangGraph
├── packages/
│   ├── contracts/                 # TypeScript contracts + JSON Schema
│   ├── config/                    # Runtime config
│   ├── providers/                 # Provider catalog
│   ├── queues/                    # Queue ports
│   ├── observability/             # Telemetry
│   ├── storage/                   # Storage ports
│   ├── workflows/                 # Workflow contracts
│   └── ...                        # Shared packages
├── tests/
│   ├── foundation/                # Gates deterministas p0-p10
│   └── integration/tus/           # HTTP, PostgreSQL y provider smoke tests
├── apps/api/prisma/               # Schema y migraciones Prisma
├── infra/terraform/               # Perfiles AWS y Render
├── docs/                          # Evidencia, readiness y rollback
├── scripts/                       # Test runner, build, seguridad y dev profiles
├── docker-compose.yml              # Perfil local PostgreSQL/MongoDB/Redis/API/Web
├── render.yaml                     # Servicios Render
├── vercel.json                     # Build y flags Vercel
├── turbo.json                      # Pipeline Turborepo
└── pnpm-workspace.yaml             # Workspace apps/* y packages/*
```

`backend/` y `frontend/` son wrappers de perfil nativo para scripts de desarrollo. Los paquetes activos del workspace son `apps/*` y `packages/*`.

## Instalacion local

### Requisitos

- Node.js `>=20.11.0 <23`.
- pnpm `9.15.9`.
- Docker 24+ y Docker Compose 2+ si se usa el perfil completo.
- Python `>=3.12` para el worker.

### Preparar configuracion

```bash
cp .env.example .env
pnpm install
```

El `.env.example` usa valores ficticios locales. Los secretos reales pertenecen al secret store del entorno y nunca deben entrar al repositorio. `DATABASE_URL` en el `.env` de la raiz es la fuente canonica para comandos de seed y startup local.

### Levantar el perfil local

```bash
docker compose up --build -d
```

Servicios del compose:

- PostgreSQL en `localhost:5432`;
- MongoDB en `localhost:27017`;
- Redis en `localhost:6379`;
- API en `http://localhost:3101`;
- Web en `http://localhost:3000`;
- workflow runtime y local fakes como servicios auxiliares.

Comprobar disponibilidad:

```bash
curl http://localhost:3101/health
curl http://localhost:3101/ready
```

Detener el perfil:

```bash
docker compose down --remove-orphans
```

Para ejecutar la web fuera de Docker:

```bash
pnpm --filter @factory/web dev
```

Para ejecutar la API fuera de Docker, el entorno debe tener un PostgreSQL accesible y una `DATABASE_URL` valida:

```bash
pnpm --filter @factory/api dev
```

## Configuracion y flags

Las variables principales estan documentadas en `.env.example`:

| Variable              | Funcion                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `FACTORY_PROFILE`     | Perfil de runtime, por ejemplo `local` o `render`.                   |
| `RUNTIME_ROLE`        | Rol del proceso, como `api-edge` o `workflow-runtime`.               |
| `DATABASE_URL`        | PostgreSQL canonico.                                                 |
| `MONGODB_URL`         | MongoDB del adapter. `MONGODB_URI` solo es alias compatible del API. |
| `REDIS_URL`           | Redis para cache, rate limit y colas.                                |
| `NEXT_PUBLIC_API_URL` | URL canonica consumida por la web.                                   |
| `EXPO_PUBLIC_API_URL` | URL consumida por la app movil.                                      |
| `CORS_ORIGINS`        | Origenes permitidos separados por coma.                              |
| `API_PORT`            | Puerto HTTP de la API.                                               |
| `NODE_ENV`            | Ambiente de ejecucion.                                               |

Flags TUS relevantes:

- `TUS_ROUTES_ENABLED`: habilita el router TUS.
- `TUS_PROVIDER_ACTIONS_ENABLED`: habilita webhooks y acciones de proveedores.
- `TUS_RELEASE_JOBS_ENABLED`: flag de activacion para jobs de release.
- `TUS_FLEET_JOBS_ENABLED`: flag de activacion para jobs de fleet.
- `TUS_MERCADOPAGO_ENABLED`: flag de perfil para Mercado Pago.
- `TUS_WHATSAPP_ENABLED`: flag de perfil para WhatsApp.
- `TUS_AWS_ENABLED`: flag de perfil para integraciones AWS.
- `TUS_*_ENABLED`: flags de perfil para gates de legal, tax, KYC, KYB, PostgreSQL, browser, device, POS pilot y operaciones. El API HTTP consume directamente `TUS_ROUTES_ENABLED` y `TUS_PROVIDER_ACTIONS_ENABLED`; los demas flags se resuelven en los perfiles, jobs o gates que los soportan.

En local, los tests HTTP que ejercitan TUS pasan `tusRoutesEnabled: true` o usan `TUS_ROUTES_ENABLED=true`. En los manifests de Render y Vercel, estas capacidades permanecen en `false` hasta su activacion controlada.

## Runtime Python

`apps/workflow-runtime-python` es el runtime oficial para workers LangGraph.

- Lee schemas desde `packages/contracts/schemas`.
- Valida jobs, estados y metadata antes de ejecutar.
- Puede ejecutar un grafo minimo `validate-input` cuando LangGraph esta instalado.
- Mantiene un fallback de import para que el scaffold sea inspeccionable antes de instalar todas las dependencias.
- Reporta `external-blocked-placeholder`, `disabled`, `missing-database-url` o `active` segun configuracion.

El consumidor real permanece bloqueado hasta contar con evidencia de ownership, leases, deployment y dependencias externas. No se debe interpretar el scaffold como un worker de produccion activo.

Comandos del worker:

```bash
cd apps/workflow-runtime-python
python -m pip install -e .
python -m worker.main
```

## Validacion y tests

Comandos principales desde la raiz:

```bash
pnpm test
pnpm typecheck
pnpm contracts:validate
pnpm lint
pnpm lint:security
```

El runner de tests ejecuta suites deterministicamente y mantiene los smoke tests PostgreSQL como boundary separado. Los tests focales del marketplace y calendario se pueden ejecutar con:

```bash
pnpm exec node --experimental-strip-types --experimental-transform-types --experimental-loader ./scripts/node-strip-types-loader.mjs --test --test-concurrency=1 tests/foundation/p8-tus-marketplace.test.mjs tests/foundation/p9-marketplace.test.mjs tests/foundation/p10-tus-d2.test.mjs tests/integration/tus/catalog-booking.test.mjs
```

El test de contratos valida todos los schemas encontrados:

```bash
node packages/contracts/scripts/validate-schemas.mjs
```

Los tests que requieren PostgreSQL no deben apuntarse a una base remota accidental. Usar solo un target local o de desarrollo descartable, con confirmacion explicita del runner correspondiente.

## Despliegue

### Render

`render.yaml` declara tres servicios:

1. `factory-api`: Node, build de `@factory/api`, comando pre-deploy declarado para Prisma y health check `/health`.
2. `factory-web`: Node, build de `@factory/web`, URL API configurada como secret y health check `/`.
3. `factory-workflow-worker`: Python, instalado desde `apps/workflow-runtime-python`, bloqueado por defecto.

Las URLs, bases de datos, Redis, storage y referencias al secret store se configuran como variables protegidas del proveedor. El manifiesto no contiene credenciales reales. El comando de migracion declarado por Render no sustituye la politica de reparacion aditiva: para una base con historicas pendientes, primero debe ejecutarse el baseline forward-only aprobado y no `prisma migrate deploy`.

### Vercel

`vercel.json` configura:

- instalacion con `pnpm install --frozen-lockfile`;
- build con `pnpm --filter @factory/web build`;
- salida `apps/web/.next`;
- flags TUS y provider actions deshabilitados por defecto.

`NEXT_PUBLIC_API_URL` debe apuntar a la API desplegada. `vercel.json` no define secretos ni una URL de produccion fija.

### Docker local

`docker-compose.yml` sirve para desarrollo e integracion local. El servicio `api` no habilita `TUS_ROUTES_ENABLED` por defecto, por lo que el compose base expone health, auth y tenancy, pero no las rutas TUS hasta que se agregue el flag en un override o se use el harness de tests. No reemplaza la configuracion de secrets, observabilidad, backup y gates que requiere un entorno productivo.

### Activacion

El despliegue y la activacion son decisiones separadas. Antes de habilitar rutas o jobs deben existir:

- evidencia de legal, KYC/KYB y tax cuando corresponda;
- evidencia de ownership de proveedores y recursos;
- readiness del runtime y la base de datos;
- observabilidad, rollback y reconciliacion;
- confirmacion de que la migracion y el target de datos son los correctos.

Si los gates no pasan, el sistema debe permanecer bloqueado y conservar evidencia de la decision.

## Seguridad y confiabilidad

- Sesiones autenticadas y contexto de tenant derivado del servidor.
- Roles y permisos por capability.
- Rechazo de campos de autoridad spoofed.
- Helmet, CORS restrictivo, rate limit y body limits.
- Errores del middleware usan envelope y correlation id; algunos errores de negocio TUS responden el formato historico `{ code, error }`.
- Idempotencia para commands y webhooks.
- Transacciones y rollback de stores in-memory para tests de carrera.
- Auditoria y outbox con tenant y actor.
- Snapshots monetarios exactos.
- Secret scanning y lint de seguridad.
- Activation controller que bloquea release jobs hasta que pasan los gates.
- Rollback que preserva evidencia, auditoria y contratos neutrales.

## Limites actuales y trabajo posterior

Estos limites son intencionales y deben permanecer visibles:

- Las rutas TUS estan apagadas en los manifests de despliegue.
- Provider actions, Mercado Pago y WhatsApp no reclaman ejecucion real mientras sus gates esten apagados.
- El worker Python es un scaffold bloqueado para deployment externo.
- `apps/workflow-runtime-python/README.md` conserva comandos legacy (`make worker-install` y `make worker-run`) que no existen en el Makefile raiz; usar los comandos directos documentados arriba.
- `render.yaml` aun declara `prisma migrate deploy`, pero la reparacion aditiva exige un baseline forward-only target-specific y no replay historico.
- El método Web legacy de calendario aún acepta `serviceId`; el journey canónico de marketplace ya usa `listingId` y discovery.
- La validacion fisica contra PostgreSQL necesita un target local o descartable disponible.
- Los datos publicos HTTP no exponen `bigint`; los datos internos si pueden usarlo.
- Los aliases legacy existen para compatibilidad, no para crear una segunda semantica.
- `make clean` elimina volumenes y dependencias; usarlo solo de forma deliberada.

## Comandos utiles

```bash
make help
make install
make test
make lint
make secure
make up
make down
make clean
```

Equivalentes pnpm:

```bash
pnpm install
pnpm run test
pnpm run typecheck
pnpm run contracts:validate
pnpm run lint
pnpm run security:scan
```

## Documentacion relacionada

- `ARCHITECTURE.md`: arquitectura implementada, decisiones D2 y límites conocidos.
- `docs/DECISIONES_PRODUCTO_TUS.md`: decisiones canónicas de producto y dominio por Build.
- `docs/ROADMAP_TUS.md`: estado de fases, pendientes y bloqueos.
- `docs/GLOSARIO_TUS.md`: terminología normativa de TUS.
- `docs/database/DER_TUS.dbml`: modelo relacional objetivo y estado físico etiquetado.
- `docs/database/DICCIONARIO_DATOS_TUS.md`: semántica de datos, FKs y deuda legacy.
- `AGENTS.md`: reglas de ejecucion para agentes y procesos persistentes.
- `.env.example`: variables locales y limites de configuracion.
- `packages/contracts/`: contratos TypeScript y JSON Schema.
- `apps/api/prisma/schema.prisma`: modelo relacional.
- `render.yaml`: despliegue Render y flags de activacion.
- `vercel.json`: despliegue web.
- `apps/workflow-runtime-python/README.md`: boundary del worker Python.
- `tests/foundation/`: gates deterministas.
- `tests/integration/tus/`: smoke e integracion de TUS.

## Licencia

MIT
