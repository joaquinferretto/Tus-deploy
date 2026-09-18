# Arquitectura de TUS

> **Fuente canonica.** Este documento describe la arquitectura implementada de TUS y sus limites conocidos.
> Ultima actualizacion: 2026-09-17. Builds `WEB-08A` y `WEB-08B` implementadas; las superficies Web permanecen fuera de alcance.

## Proposito y limites

TUS es la superficie de comercio, agenda y operaciones de `product-factory-core`. Coordina publicaciones,
discovery, reservas, compromisos, pagos, entrega, soporte, WhatsApp y POS sin asumir el rol de un proveedor
externo. La interfaz solo puede mostrar un estado confirmado cuando existe una respuesta verificable del servidor.

Los limites de esta arquitectura son:

- `apps/web` y `apps/mobile` son consumidores de la API y no fuentes de verdad de negocio.
- `apps/api` contiene los casos de uso y los bounded contexts de TUS.
- `packages/contracts` es la frontera de contratos entre TypeScript, HTTP y el runtime Python.
- PostgreSQL/Prisma conserva los hechos relacionales durables.
- MongoDB, Redis, colas y proveedores externos solo se usan mediante adapters o puertos explícitos.
- La activacion de rutas, jobs y proveedores esta gobernada por flags y gates de readiness.

## Vista del sistema

```text
 Web Next.js / Mobile Expo
             |
       HTTP JSON + contratos
             |
 Express API: auth, tenant, seguridad, limites, errores
             |
 TusApplicationService + bounded contexts
             |
       Puertos y transacciones
             |
 In-memory adapters       Prisma adapters
 (tests/local)                   |
                   PostgreSQL / Prisma
             |
   outbox, colas y providers bajo gates
             |
     Runtime Python + JSON Schemas
```

El flujo de dependencias apunta hacia el dominio:

```text
HTTP/UI -> application -> domain -> ports <- adapters -> infrastructure
                                      ^
                         contracts compartidos y schemas
```

La logica de negocio no importa Express, Prisma, Redis ni SDKs de proveedores. Los adapters traducen formatos
externos y persisten snapshots sin trasladar autoridad desde el cliente.

## Monorepo

| Superficie                     | Responsabilidad real                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `apps/api`                     | API Express, composición TUS, bounded contexts, Prisma y lifecycle de infraestructura.               |
| `apps/web`                     | Aplicacion Next.js App Router para marketplace, calendario, compromisos y operaciones.               |
| `apps/mobile`                  | Cliente Expo/React Native.                                                                           |
| `apps/workflow-runtime-python` | Runtime Python para workflows, bloqueado hasta contar con gates y dependencias externas.             |
| `packages/contracts`           | Tipos, constantes, validadores y JSON Schemas versionados.                                           |
| `packages/*`                   | Configuracion, eventos, errores, storage, queues, providers, observabilidad y workflows compartidos. |

Los paquetes activos se resuelven desde `apps/*` y `packages/*`. `backend/` y `frontend/` son wrappers de perfil,
no bounded contexts adicionales.

## API y composicion

`apps/api/src/server.ts` compone la entrada HTTP en este orden:

1. correlation middleware;
2. Helmet, CORS, rate limit y body limits;
3. health/readiness;
4. autenticacion y tenancy;
5. router TUS cuando `TUS_ROUTES_ENABLED=true`;
6. acciones de proveedores cuando `TUS_PROVIDER_ACTIONS_ENABLED=true`;
7. handlers de 404 y errores.

`apps/api/src/tus/composition/index.ts` arma los servicios con stores in-memory o Prisma. La misma logica de
aplicacion se puede ejecutar en tests deterministas y en persistencia PostgreSQL sin cambiar el contrato de uso.

Las familias canónicas relevantes son:

- marketplace: `/tus/v1/marketplace/*` y alias `/tus/v1/mercado-servicios/*`;
- calendario: `/tus/v1/calendar/*`;
- disponibilidad canónica: `/tus/v1/marketplace/listings/:listingId/slots` y alias `/tus/v1/mercado-servicios/listings/:listingId/slots`;
- reserva canónica: `/tus/v1/calendar/bookings` con `listingId`;
- compromisos: `/tus/commitments/*` y sus rutas versionadas;
- finanzas, entrega, POS, soporte, WhatsApp y reporting bajo sus límites propios.

Los aliases legacy se mantienen de forma aditiva. No constituyen una segunda fuente de verdad.

## Bounded contexts

La carpeta `apps/api/src/tus` separa las siguientes responsabilidades:

| Contexto      | Responsabilidad                                                                              |
| ------------- | -------------------------------------------------------------------------------------------- |
| `catalog`     | Prestadores, publicaciones, discovery, precio, stock y checkout de marketplace.              |
| `calendar`    | Calendarios, reglas, excepciones, slots, capacidad y reservas.                               |
| `commitments` | Transiciones y compensaciones de compromisos.                                                |
| `work`        | Ciclo de Trabajo, Diagnostico, Presupuesto, evidencia, transiciones y sus rutas WEB-08B.     |
| `domain`      | Reglas transversales de compromisos y settlement.                                            |
| `finance`     | Payment intents, evidencias, confirmaciones, release, refunds, chargebacks y reconciliacion. |
| `delivery`    | Zonas, turnos, tareas, fulfillment y evidencia de entrega.                                   |
| `pos`         | Operaciones manuales, dispositivos, sesiones, recibos y conflictos.                          |
| `support`     | Casos, evidencias y resoluciones.                                                            |
| `whatsapp`    | Consentimiento, plantillas, handoff y acciones del canal.                                    |
| `reporting`   | Reportes operativos y freshness.                                                             |
| `readiness`   | Evidencias, gates y decisiones de habilitacion.                                              |
| `integration` | Webhooks y acciones de integracion.                                                          |
| `billing`     | Facturacion y estados fiscales; no es una familia de rutas TUS montada por `server.ts`.      |

Cada contexto conserva sus tipos, errores, validaciones, eventos y reglas de ownership. Los puertos se encuentran
en los contextos o en `apps/api/src/tus/ports` y los adapters en `apps/api/src/tus/adapters`.

## WEB-04D2: Publicacion, agenda y reserva

### Identidad canonica

Para servicios, `Publicacion` es la identidad comercial canónica. El identificador de contrato vigente es
`listingId`; `serviceId` solo se acepta en las rutas y cuerpos legacy del calendario.

Una agenda nueva se resuelve por `(tenantId, prestadorId)`. El servidor no usa un `calendarId` enviado por el
cliente para cambiar de prestador. Si el cliente envia un `calendarId`, debe coincidir con la agenda principal
resuelta o se devuelve `CALENDAR_MISMATCH`.

### Modalidades

La frontera acepta los aliases legacy y los valores físicos históricos de D1:

- `bookingMode: turno_fijo` o `fixed_shift` requiere `durationMinutes` entero positivo.
- `bookingMode: visita_diagnostico` requiere `durationMinutes` entero positivo.
- `bookingMode: duracion_estimada` o `variable_duration` requiere `estimatedDurationMinutes` entero positivo.
- `bookingMode: requiere_presupuesto` bloquea slots y reserva automática con `BUDGET_REQUIRED`.
- `priceMode: precio_fijo` o `fixed` permite disponibilidad y reserva automática.
- `priceMode: precio_desde` y `por_hora` conservan la disponibilidad con el precio publicado.
- `priceMode: presupuesto` o `requires_budget` bloquea slots y reserva automática con `BUDGET_REQUIRED`.

En PostgreSQL los valores físicos históricos se mantienen en español y el adapter Prisma los conserva al leer y
escribir. No se cambió el modelo físico en D2; la migración D1 existe en el repositorio, pero aún no se verificó su
aplicación al target.

### Discovery y disponibilidad

Para una publicación de servicio, discovery consulta la agenda principal del prestador:

- agenda activa encontrada: `availabilityStatus: configured` y `calendarId` presente;
- agenda ausente o inactiva: `availabilityStatus: not_configured` y sin `calendarId`;
- el sistema nunca fabrica un `calendarId`.

La publicación debe conservar capacidad, horario de trabajo y duración válida. La fuente canónica de disponibilidad
nueva es el calendario; `horario_trabajo` de la publicación es legacy.

### Slots y booking

La identidad de un slot es `calendarId:listingId:start`. La generación considera zona horaria IANA, horario,
excepciones, duración efectiva, granularidad, buffer, capacidad, `now` y reservas confirmadas.

El booking canónico:

1. autentica al cliente y deriva tenant y actor desde la sesión;
2. resuelve la agenda principal por publicación y prestador;
3. valida modalidad, presupuesto, slot, cutoff y capacidad;
4. reclama `Idempotency-Key` y verifica `requestHash`;
5. persiste `publicacion_id` en la reserva existente;
6. registra auditoría y outbox dentro de la frontera transaccional.

La reserva retorna `listingId` en el contrato. La ruta legacy sigue usando `calendarId + serviceId` y no cambia la
semántica canónica.

## Puertos y adapters

Los puertos principales son:

- `MarketplaceStorePort` para prestadores, publicaciones, compromisos, idempotencia, auditoría y outbox;
- `ServiceCalendarStorePort` para calendarios, reservas, idempotencia, auditoría y outbox;
- puertos equivalentes para compromisos, finanzas, entrega, POS, soporte, WhatsApp y reporting;
- puertos de sesión, tenancy, transacción, readiness y proveedores.

Los adapters relevantes son:

- `apps/api/src/tus/adapters/in-memory.ts` para sesiones y primitivas locales;
- `apps/api/src/tus/adapters/prisma.ts` para delegates y transacciones base;
- `apps/api/src/tus/adapters/prisma-marketplace.ts` para mapeo de publicación, modalidades y compromisos;
- `apps/api/src/tus/adapters/prisma-calendar.ts` para agenda, reglas, excepciones y reservas.

El adapter Prisma debe preservar `bigint` y snapshots monetarios. La capa HTTP elimina valores no serializables
antes de responder JSON; no se convierte dinero exacto a `number` dentro de persistencia para resolver ese límite.

## Contratos y compatibilidad

`packages/contracts` es neutral entre procesos y lenguajes. La versión TUS vigente es `1.0.0`.

- Los tipos y validadores TypeScript definen la forma pública de TUS.
- `packages/contracts/schemas` contiene los JSON Schemas consumidos por API, tests y Python.
- `listingId`, `bookingMode`, `priceMode` y `availabilityStatus` forman parte del contrato D2.
- Payloads de terceros conservan nombres, estados y valores externos.
- Los aliases legacy no autorizan una semántica distinta ni un segundo origen de identidad.

Las requests protegidas usan sesión Bearer, contexto de tenant, `X-Correlation-Id`, versión de API/contrato e
idempotencia cuando corresponde. Los campos de autoridad enviados por el cliente no tienen precedencia sobre la
sesión autenticada.

## Datos y persistencia

PostgreSQL es la fuente relacional de hechos durables. El modelo existente para WEB-04D contiene:

- `Publicacion` con modalidades de reserva/precio y duración estimada;
- `Calendario` con `prestadorId` nullable para conservar legacy y unique tenant-scoped para la agenda principal;
- `ReglaCalendario` y `ExcepcionCalendario` como hijos del calendario;
- `Reserva` con `publicacionId` nullable para la transición y `servicioId` legacy;
- índices, auditoría, outbox e idempotencia tenant-scoped.

WEB-04D2 no añade tablas, columnas, índices, constraints ni migraciones. Solo activa en adapters, dominio y
contratos el uso canónico de campos que ya existen desde D1. El DER y el diccionario deben seguir distinguiendo
estado físico actual, objetivo futuro y referencias legacy.

## WEB-04D3: journey Web canónico

La Web consume la misma identidad y autoridad que el backend:

1. `apps/web` carga discovery de publicaciones desde la ruta marketplace canónica.
2. Un servicio con `availabilityStatus: configured` consulta slots reales por `listingId`.
3. La reserva envía `listingId`, `slotId` y `calendarId` solo como comprobación opcional.
4. El checkout del servicio se construye únicamente después de la confirmación del booking y conserva el intervalo real.
5. Los productos mantienen el checkout directo y no pasan por calendario.

`not_configured`, `BUDGET_REQUIRED`, slots vacíos, errores de disponibilidad, cutoff, capacidad, `STALE_SLOT` y conflictos
HTTP 409 se muestran como estados verificables. La Web no genera `calendarId`, slots ni fechas de servicio sintéticas.

El método `calendarSlots(calendarId, date, ...)`, el booking `calendarId + serviceId` y la ruta
`/tus/calendario/{calendarId}` permanecen como compatibilidad legacy explícita. No son dependencias del journey canónico y no
constituyen una segunda fuente de verdad.

WEB-04D3 no cambia persistencia, migraciones, adapters ni providers; adapta consumidores Web a los contratos y rutas entregados
en D2.

## WEB-08: modelo y API implementados

WEB-08A agrega el agregado `Trabajo` para servicios y conserva la relación verificable:

```text
Publicacion -> CompromisoMercadoServicios -> Trabajo
             -> Reserva (opcional) -------> Trabajo
```

`TusJob` es una fila técnica de cola (`jobType`, `status`, `attempts`, leases y `payload`) y no debe usarse como ejecución
comercial. `TareaEntrega` es el agregado de fulfillment de delivery y sus evidencias; tampoco es un trabajo de servicio.

`Trabajo.tenantId` identifica el tenant cliente del compromiso. `Trabajo.prestadorTenantId` identifica el tenant del prestador,
publicación y reserva. `CompromisoMercadoServicios` conserva el mismo split mediante `tenantId` y `prestadorTenantId`.
Las relaciones SQL nuevas usan claves compuestas para que compromiso, prestador y publicación no formen cadenas inconsistentes.
Una reserva opcional debe coincidir con el cliente, prestador, publicación y estado confirmado del compromiso.
`reservas.cliente_tenant_id` conserva ese ownership cliente en reservas nuevas; no se realiza un backfill ambiguo de filas
históricas que solo contienen `cliente_id`.

La modalidad `visita_diagnostico` sigue modificando la duración de la reserva. Las modalidades `requiere_presupuesto` y
`presupuesto` siguen produciendo el guard `BUDGET_REQUIRED` para slots/booking. El checkout de marketplace puede crear un
compromiso de servicio sin franja para iniciar el flujo de Trabajo; no crea una reserva provisional ni ocupa capacidad.

`ServicioTrabajo` opera el ciclo `requested -> in_diagnosis -> budget_pending -> accepted -> in_progress -> completed`
y la cancelación. El prestador acepta el compromiso, registra diagnóstico, emite presupuestos versionados y ejecuta el trabajo;
el cliente decide la última versión vigente con reloj de servidor. Las mutaciones verifican ownership, hash/idempotencia, locking optimista y registran transición,
auditoría y outbox dentro de la misma transacción.

Las rutas canónicas son `/tus/v1/work/*`, con aliases españoles `/tus/v1/trabajos/*`, para aceptación del compromiso,
lectura, diagnóstico, presupuesto, decisión, evidencia e inicio/cierre/cancelación. WEB-08C usa las rutas canónicas desde
`/tus/prestador` para trabajos ya aceptados; no existe una lectura HTTP provider-scoped de compromisos pendientes, por lo que
la aceptación requiere una referencia obtenida desde un flujo autorizado.

WhatsApp sí tiene una acción `quote`/`confirm` respaldada por `ConfirmacionWhatsApp`, con snapshot de elementos, expiración y
consumo. Es una capacidad parcial del canal, no un contrato comercial reutilizable para Web: no define un presupuesto
versionado enlazado a publicación, compromiso y trabajo.

Finanzas persiste `EvidenciaFinanciera` y `ConfirmacionFinanciera` por compromiso, y delivery persiste sus comprobantes por
tarea. Esas evidencias no representan automáticamente evidencia de un trabajo de servicio. Los estados `fulfilled`,
`released` y `compensated` cierran o compensan compromisos, no trabajos.

### Plan de evolución WEB-08

1. **WEB-08A:** completada: identidad, contracts, estados, relaciones, transiciones y migración física aditiva.
2. **WEB-08B:** completada: puertos in-memory/Prisma, transacciones serializables, ownership cliente/prestador,
   idempotencia, versionado optimista, auditoría/outbox y rutas HTTP.
3. **WEB-08C:** completada: `/tus/prestador` lista trabajos del prestador, muestra detalle, diagnóstico, presupuestos,
   evidencia y cierre contra rutas verificables; no inventa una bandeja de compromisos pendientes.
4. **WEB-08D:** completada: cliente consulta trabajo y detalle, decide presupuesto de forma idempotente y enlaza el
   compromiso para la agenda existente. No crea agenda, evidencia ni cierre cliente sin una ruta del agregado.

WEB-08C/D son las únicas unidades que pueden consumir estas rutas desde Web. Pagos, settlement y providers siguen fuera de
esta frontera.

## WEB-05: POS Web refinado

La superficie `/tus/pos` consume únicamente capacidades POS ya expuestas por la API:

1. Registra o actualiza el dispositivo Web con `POST /tus/v1/pos/devices`.
2. Abre y cierra la sesión con `POST /tus/v1/pos/sessions` y `POST /tus/v1/pos/sessions/:sessionId/close`.
3. Construye cada operación con el `deviceId` y `shiftId` de la sesión confirmada.
4. Consulta el estado individual con `GET /tus/v1/pos/operations/:operationId/status`.

La lista de operaciones del Web se limita al ciclo actual porque el router no ofrece un `GET` tenant-scoped para listar
operaciones, recibos o sesiones. La UI no fabrica un historial del día ni intenta leer Prisma desde el cliente.
Los retries conservan la identidad idempotente original; `conflict`, `pending`, `not_found` y error de red se mantienen
visibles sin afirmar éxito. No se agregan rutas API, contratos, migraciones, providers ni hardware.

La política de migración TUS es forward-only y no permite editar migraciones históricas ni replayar indiscriminadamente
con `prisma migrate deploy` sobre una base con historial divergente. `render.yaml` todavía declara ese comando como
pre-deploy y permanece como deuda operativa documentada.

## Seguridad y activacion

- Tenant, actor, roles y permisos se derivan de la sesión autenticada.
- Se rechazan campos de autoridad spoofed y recursos cross-tenant.
- Commands y webhooks usan idempotencia y hashes de solicitud.
- Auditoría y outbox conservan tenant, actor y correlación.
- Helmet, CORS restrictivo, rate limit y límites de body protegen la entrada HTTP.
- Rutas TUS, acciones de proveedores y jobs permanecen deshabilitados por defecto en despliegue.
- Readiness y activation gates bloquean operaciones cuando falta evidencia o la evidencia es solo determinista/local.
- El runtime Python permanece bloqueado hasta contar con ownership, leases, deployment y dependencias verificables.

## Web y limites conocidos

La Web ya conecta el journey nuevo con discovery, slots, booking y checkout por `listingId`. La ruta de calendario legacy
`calendarId + serviceId` sigue disponible para consumidores existentes y queda aislada del flujo canónico. La activación HTTP
de TUS y el guard de readiness siguen dependiendo de sus flags y evidencias; D3 y WEB-05 no cambian esa política.

## Validacion y evidencia

La Build D2 fue validada con:

- tests focales marketplace/calendario: 25/25 pass;
- typechecks de contracts, API y Web: pass;
- validacion de JSON Schemas: 98 schemas pass, con warnings de formato AJV;
- build directo de API: pass;
- test D2 con cobertura de `NOT_CONFIGURED`, `BUDGET_REQUIRED`, agenda principal, mismatch, duración, buffer,
  capacidad, idempotencia y persistencia Prisma.

WEB-04D3 fue validada con tests Web D3/UX 34/34, D2/marketplace 20/20 e integración catálogo/calendario/UI 22/22;
typechecks Contracts/API/Web; builds Contracts/API; 98 JSON Schemas; ESLint focal; build Web de 16 rutas con standalone
deshabilitado por la limitación de symlinks `EPERM` de Windows; y smoke HTTP 200 en tres rutas Web. La cobertura incluye
checkout directo de productos, slot real de servicios, invalidación de intenciones al cambiar de franja, intervalo confirmado
por booking, estados `not_configured`/`BUDGET_REQUIRED`, payload canónico sin `serviceId` y ausencia de fechas sintéticas.

WEB-05 fue validada con 6/6 tests Web POS, typecheck Web, ESLint focal, build Web de 17 rutas con standalone deshabilitado
por la limitación de symlinks `EPERM` de Windows y smoke HTTP 200 en `/tus/pos`. Las pruebas POS/delivery/durabilidad
mantienen tres 404 HTTP históricos documentados como baseline; el dominio POS y sus pruebas restantes pasan.

WEB-06 agrega la superficie `/tus/soporte` sobre rutas TUS existentes:

1. Lista casos con `GET /tus/v1/support/cases` y mantiene el alcance del tenant autenticado.
2. Abre casos y registra evidencia con las rutas `POST /tus/v1/support/cases` y
   `POST /tus/v1/support/cases/:caseId/evidence`.
3. Muestra estados de sesión, permiso, carga, vacío, error y confirmación sin inferir timeline: el router no expone su lectura.
4. Registra el handoff con `POST /tus/v1/whatsapp/support-handoff`, sin afirmar que un provider WhatsApp envió un mensaje.

WEB-06 fue validada con 3/3 tests Web de soporte/handoff, typecheck Web, ESLint focal y build Web de 17 rutas con standalone
deshabilitado. El smoke HTTP queda pendiente de un launcher controlado; no se dejó ningún servidor persistente ejecutándose.
No hay delta de API, contratos, persistencia, migraciones, providers ni flags.

WEB-07 agrega la superficie `/tus/prestador` sobre la frontera marketplace existente:

1. Lee el perfil y los listings del tenant con la ruta merchant operations ya existente.
2. Ejecuta onboarding, creación y publicación con `POST /tus/v1/marketplace/onboarding`,
   `POST /tus/v1/marketplace/listings` y `POST /tus/v1/marketplace/listings/:listingId/publish`.
3. Deriva `merchantId`, cohort y ubicación de los hechos del perfil para crear listings; no crea identidades de servidor en
   el cliente.
4. Expone productos y servicios con estados draft/published y bloquea mutaciones si falta `tus:marketplace:write`.
5. No crea calendarios: el API tiene creación pero no lectura owner-scoped suficiente para evitar duplicados o confirmar una
   agenda primaria. `not_configured` permanece visible cuando discovery no confirma un calendario activo.

WEB-07 fue validada con 2/2 tests Web de prestador, typecheck Web, ESLint focal y build Web de 18 rutas con standalone
deshabilitado. El smoke HTTP queda pendiente de un launcher controlado; no hay delta de API, contratos, persistencia,
migraciones, providers ni flags.

La suite global no se considera verde: su runner excede el timeout configurado y contiene gates separados por
seguridad, imports TS sin extensión, disponibilidad de `pnpm` y smoke PostgreSQL. Esos resultados no se mezclan
con la evidencia focal de D2.

## Documentos canónicos relacionados

- `docs/DECISIONES_PRODUCTO_TUS.md`: decisiones de producto y dominio.
- `docs/ROADMAP_TUS.md`: fase, estado, pendientes y bloqueos.
- `docs/GLOSARIO_TUS.md`: terminología normativa.
- `docs/database/DER_TUS.dbml`: modelo relacional objetivo y físico etiquetado.
- `docs/database/DICCIONARIO_DATOS_TUS.md`: semántica, FKs y deuda legacy.
- `README.md`: operación local, despliegue y comandos.
