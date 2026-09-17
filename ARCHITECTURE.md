# Arquitectura de TUS

> **Fuente canonica.** Este documento describe la arquitectura implementada de TUS y sus limites conocidos.
> Ultima actualizacion: 2026-09-16. Build: `WEB-04D2`. Commit de referencia: `65df852`.

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
- disponibilidad canónica: `/tus/v1/marketplace/listings/:listingId/slots`;
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

Las modalidades externas son deliberadamente pequeñas:

- `bookingMode: fixed_shift` requiere `durationMinutes` entero positivo.
- `bookingMode: variable_duration` requiere `estimatedDurationMinutes` entero positivo.
- `priceMode: fixed` permite disponibilidad y reserva automática.
- `priceMode: requires_budget` bloquea slots y reserva con `BUDGET_REQUIRED`.

En PostgreSQL los valores físicos históricos se mantienen en español (`turno_fijo`, `duracion_estimada`,
`precio_fijo`, `presupuesto`) y el adapter Prisma los traduce en la frontera. No se cambió el modelo físico en D2.

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

## Web y limite conocido

La web mantiene intacto el flujo de calendario legacy `calendarId + serviceId`. El backend ya expone disponibilidad
y reserva canónicas por `listingId`, pero la pantalla web todavía debe conectarse a discovery y a esas rutas para
cerrar la transición. La UI debe mostrar la dependencia explícitamente y no inventar una agenda ni una reserva.

## Validacion y evidencia

La Build D2 fue validada con:

- tests focales marketplace/calendario: 25/25 pass;
- typechecks de contracts, API y Web: pass;
- validacion de JSON Schemas: 98 schemas pass, con warnings de formato AJV;
- build directo de API: pass;
- test D2 con cobertura de `NOT_CONFIGURED`, `BUDGET_REQUIRED`, agenda principal, mismatch, duración, buffer,
  capacidad, idempotencia y persistencia Prisma.

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
