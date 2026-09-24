# Roadmap de TUS

> **Fuente canonica de estado.** Ultima actualizacion: 2026-09-23. Builds `WEB-08A`, `WEB-08B`, `WEB-08C`, `WEB-08D` y
> `WEB-08E` implementadas dentro de sus limites de API; no se activan pagos ni providers. La auditoria WEB-09 queda documentada
> en `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`.

## Estado de fases

| Fase     | Estado                      | Evidencia                                                                                                                      |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| WEB-01   | Completada                  | Workspace Web preparado en `e263a39`.                                                                                          |
| WEB-02   | Completada                  | Mercado de servicios en `e9e72b2`.                                                                                             |
| WEB-03   | Completada                  | Compromisos de cliente en `a75497f`.                                                                                           |
| WEB-04   | Completada                  | Calendario y reservas Web en `d659e85`; mantiene flujo legacy.                                                                 |
| WEB-04D1 | Schema/migración preparada  | Modelo Prisma/DB y migración en `29e8977`; aplicación física al target pendiente.                                              |
| WEB-04D2 | Ajuste backend entregado    | Disponibilidad y reserva canónicas por `listingId`; base `5f56c84`, modalidades físicas y concurrencia alineadas.              |
| WEB-04D3 | Completada                  | Discovery, slots, booking y checkout de servicios consumen el contrato canónico; sin delta físico.                             |
| WEB-05   | Completada                  | POS Web usa dispositivo, sesión, operación idempotente y consulta de estado existentes; sin delta backend ni provider.         |
| WEB-06   | Completada                  | Soporte Web usa casos, evidencia y handoff WhatsApp existentes; sin timeline HTTP, retry automático ni provider.               |
| WEB-07   | Completada                  | Prestador Web usa onboarding, listings, publicación y operaciones existentes; no inventa lectura ni creación segura de agenda. |
| WEB-08   | WEB-08A/B/C/D/E completadas | Modelo/API de Trabajo, superficies prestador y cliente para presupuesto y cancelacion temprana sin inventar agenda ni cierre.  |
| WEB-09A  | Completada                  | Obligacion financiera canonica por Trabajo, dinero bigint/string y migracion aditiva no aplicada a una base real.              |
| WEB-09B  | Completada                  | Intencion de pago, inbox de eventos verificados, outbox y auditoria con provider fake; runtime sin provider habilitado.        |
| WEB-09C  | Completada                  | Comision exacta, ledger unico append-only, liquidacion interna sin payout y conciliacion determinista.                         |
| WEB-09D  | Auditada, grado B           | Lectura financiera disponible; UI pendiente de decisiones de producto sobre cobro previo a provider. Ver auditoria WEB-09.     |
| WEB-09E  | Fuera de alcance            | Provider real, OAuth, captura, split, payout y refund real no implementados.                                                   |

## WEB-04D2 entregado

- `Publicacion` es la identidad canónica de un servicio.
- Discovery expone `calendarId`, modalidad y `availabilityStatus` solo según la agenda principal real.
- Agenda principal se resuelve por `(tenantId, prestadorId)`.
- `turno_fijo`, `visita_diagnostico`, `duracion_estimada`, `requiere_presupuesto` y modalidades de precio físicas tienen reglas explícitas, con aliases legacy.
- `NOT_CONFIGURED`, `BUDGET_REQUIRED` y `CALENDAR_MISMATCH` bloquean acciones no verificables.
- Booking persiste `publicacion_id` usando el campo existente y conserva aliases legacy.
- Contratos, schemas, adapters, auditoría, outbox e idempotencia quedaron alineados; el adapter Prisma usa transacciones serializables con reintento.

## WEB-04D3 completada

- El detalle de una publicación usa discovery para decidir si la agenda está `configured`, `not_configured` o bloqueada
  por `BUDGET_REQUIRED`.
- La agenda consulta slots por `listingId` y el booking canónico conserva `calendarId` solo como comprobación opcional.
- El journey de servicio ejecuta slot real → booking → checkout con `slotStart`/`slotEnd` del servidor.
- Los productos mantienen checkout directo; el journey nuevo no usa `serviceId` ni fechas sintéticas.
- El calendario legacy continúa disponible solo para consumidores explícitos.
- Cambiar o refrescar una franja invalida la intención anterior; checkout conserva el intervalo confirmado por booking.

Evidencia de cierre:

- tests Web D3/UX 34/34, D2/marketplace 20/20 e integración catálogo/calendario/UI 22/22;
- typechecks Contracts, API y Web, builds Contracts/API y 98 JSON Schemas correctos;
- build Web completo con standalone deshabilitado por la limitación de symlinks `EPERM` de Windows;
- smoke Web HTTP 200 en `/`, `/tus/mercado` y `/tus/mercado/listing-smoke`;
- commit objetivo `feat(web): usar agenda del prestador en servicios`, sin push.

## WEB-05: POS refinado

- `/tus/pos` abre y cierra una sesión real mediante las rutas existentes de dispositivo y sesión;
- las operaciones nuevas usan el `deviceId` y `shiftId` devueltos por la sesión, no identificadores de turno sintéticos;
- la lista visible se limita a operaciones de la visita actual porque el backend no expone un listado HTTP de operaciones del día;
- el estado de una operación se refresca con `GET /tus/v1/pos/operations/:operationId/status` sin reenviar el `POST`;
- un retry conserva `operationId` e `idempotencyKey`, y los conflictos permanecen como revisión requerida;
- no se agregan endpoints, contratos, migraciones, datos persistentes locales ni providers.

Evidencia de cierre WEB-05:

- tests focales Web POS: 6/6 pass;
- tests POS/delivery/durabilidad: 28/31 pass; tres 404 HTTP históricos de Delivery/POS permanecen como baseline documentada;
- typecheck Web, ESLint focal y build Web de 17 rutas pass;
- smoke HTTP `/tus/pos` devuelve 200 con Next ya iniciado en `localhost:3100`;
- el servidor Web no representa evidencia de producción ni de provider habilitado.

## WEB-06: soporte y handoff gobernado

- `/tus/soporte` lista los casos del tenant mediante `GET /tus/v1/support/cases`;
- la apertura usa `POST /tus/v1/support/cases` y la descripción se registra como evidencia mediante
  `POST /tus/v1/support/cases/:caseId/evidence`;
- el cliente muestra estados de restauración de sesión, vacío, error, permiso insuficiente y confirmación del servidor;
- la superficie respeta `tus:support:write` para casos y `tus:whatsapp:write` para handoff;
- el handoff usa `POST /tus/v1/whatsapp/support-handoff` y solo muestra `status: handoff` confirmado por TUS;
- la timeline existe en el servicio de soporte, pero no tiene lectura HTTP: la Web no reconstruye eventos ni los simula;
- no se agrega retry automático ni una clave idempotente para operaciones cuyos endpoints actuales no la exponen;
- no se agregan rutas, contratos, migraciones, persistencia local ni providers.

Evidencia de cierre WEB-06:

- tests focales Web de soporte y handoff: 3/3 pass;
- typecheck Web y ESLint focal: pass;
- build Web: 17 rutas pass con standalone deshabilitado por la limitación de symlinks `EPERM` de Windows;
- smoke HTTP de `/tus/soporte`: pendiente de un launcher controlado autorizado; no se reinició ningún servidor persistente;
- la suite API existente de soporte/WhatsApp se mantiene como evidencia de dominio; el fallo Prisma de retención de la prueba
  de integración permanece separado de esta Build.

## WEB-07: flujo Web del prestador

- `/tus/prestador` consume el perfil y los listings tenant-scoped mediante la ruta de operaciones de merchant existente;
- el onboarding usa `POST /tus/v1/marketplace/onboarding` con `tus:marketplace:write` y rol de merchant/operator;
- la creación y publicación usan `POST /tus/v1/marketplace/listings` y
  `POST /tus/v1/marketplace/listings/:listingId/publish`;
- la UI permite productos y servicios con las modalidades de precio, duración, capacidad y una franja laboral ingresadas por
  el usuario, sin fabricar hechos comerciales;
- drafts y publicaciones se muestran con estado del servidor; publicar requiere confirmación del botón y permiso de escritura;
- la creación de calendario no se expone: aunque existe un `POST /tus/v1/calendar`, no hay lectura tenant-scoped de la agenda
  para evitar crear duplicados o reclamar disponibilidad sin poder confirmarla;
- servicios sin calendario activo permanecen visibles como `not configured`; no se presenta disponibilidad sintética;
- no se agregan rutas backend, contratos públicos, migraciones, persistencia local, providers ni flags.

Evidencia de cierre WEB-07:

- tests focales Web de prestador: 2/2 pass;
- typecheck Web y ESLint focal: pass;
- build Web: 18 rutas pass con standalone deshabilitado por la limitación de symlinks `EPERM` de Windows;
- smoke HTTP de `/tus/prestador`: pendiente de un launcher controlado autorizado; no se dejó ningún servidor persistente ejecutándose.

## WEB-08: auditoría y plan del ciclo de trabajo/presupuesto

**Estado:** WEB-08A/B/C/D implementadas. No se habilitan pagos/providers.

### Gate de capacidad A/B/C

- **Trabajo: A/B implementadas.** `trabajos` tiene identidad, versión, estado, compromiso de marketplace, publicación,
  reserva opcional validada contra cliente/prestador/publicación y ownership separado. `TusJob` y `TareaEntrega` conservan
  sus responsabilidades técnicas.
- **Diagnóstico: A/B implementadas.** `diagnosticos` conserva descripción original, datos estructurados, estado y versiones;
  el prestador crea y confirma versiones con control optimista.
- **Presupuesto: A/B implementadas.** `presupuestos` y `lineas_presupuesto` conservan alcance, importe minor-unit, moneda,
  vigencia y versiones inmutables; el prestador emite y el cliente decide solo la última versión vigente con reloj de servidor.
- **Aceptación: A/B implementadas.** `aceptaciones_presupuesto` permite una decisión tenant-scoped por versión, registra
  auditoría/outbox y actualiza atómicamente la referencia aceptada del trabajo.
- **Evidencia inicial/final: A/B implementadas.** `evidencias_trabajo` referencia metadata durable por fase y trabajo; no
  almacena binarios.
- **Cierre: A/B implementadas.** `transiciones_trabajo` y estados congelan el historial; inicio, cierre y cancelación son
  operaciones idempotentes y verificadas.

### Relación canónica existente

```text
Publicacion -> CompromisoMercadoServicios -> Trabajo
             -> Reserva (publicacionId opcional) -> Trabajo
```

`BUDGET_REQUIRED` continúa bloqueando slots y reservas automáticas. Un checkout sin franja puede crear el compromiso de
servicio para que el prestador inicie el flujo de Trabajo, sin fabricar una reserva ni ocupar capacidad. WEB-08C consume estas
rutas desde la superficie de prestador; WEB-08D las consulta y decide presupuesto desde compromisos del cliente.

### Plan por unidades

- **WEB-08A — modelo y contracts:** completada con `Trabajo`, `Diagnostico`, `Presupuesto`, líneas, estados, versión,
  aceptación, evidencia, transiciones y relaciones tenant-scoped.
- **WEB-08B — API y persistencia:** completada con puertos, stores in-memory/Prisma, transacciones serializables,
  idempotencia, optimistic locking, autorización cliente/prestador y rutas para solicitud, diagnóstico, presupuesto,
  aceptación, evidencia y cierre.
- **WEB-08C — Web prestador:** completada con lista y detalle de trabajos aceptados, diagnóstico, presupuesto versionado,
  evidencia y cierre contra API. No existe lectura HTTP provider-scoped de compromisos pendientes, por lo que no inventa una
  bandeja de solicitudes y la aceptación requiere referencia autorizada.
- **WEB-08D — Web cliente/integración:** completada contra `GET /tus/v1/work`, detalle y decisión idempotente de presupuesto.
  La pantalla cliente muestra trabajo, diagnóstico, presupuestos/evidencia/historial y enlaza al compromiso existente para la
  franja ya expuesta por API. No crea agenda, evidencia ni cierre cliente: esas mutaciones no existen en el agregado cliente.
- **WEB-08E — Cierre temprano prestador:** completada contra la transición `cancel` existente. La auditoría agregó la
  verificación de tenant prestador que faltaba en el dominio; la Web solicita confirmación antes de cancelar y no inventa
  razón, endpoint ni contexto adicional.

## WEB-09 — auditoria de capacidades de producto

La auditoria de producto no habilita capacidades nuevas. El estado verificable es:

- Marketplace: los cohorts de Stage 1 son `beauty-personal-care` y `repairs-trades`; el catalogo y el checkout canónicos
  estan disponibles dentro de sus gates.
- Recomendaciones: P4.12 es un contrato neutral con ranking local determinista y puerto Bedrock; no esta conectado al
  marketplace ni reclama ejecucion AWS.
- Tenancy y billing: memberships tienen rutas HTTP; billing contiene modelos, servicio y persistencia Prisma, pero no esta
  expuesto por `TusApplicationService` ni por rutas HTTP de producto.
- Pagos: existen contratos, payment intents, webhooks y settlement. La composicion Prisma inyecta
  `UnavailableMercadoPagoFinanceProvider`; las rutas provider requieren `TUS_PROVIDER_ACTIONS_ENABLED=true` y un adapter.
- Settlement: release permanece bloqueado por gates financieros/custodia y por la ausencia de un transporte de jobs activo.

Evidencia, activacion requerida y limites estan registrados en `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`.

Pagos, settlement, Mercado Pago y providers permanecen fuera de alcance operativo.

### Validación operativa posterior

Pendiente cuando exista un target autorizado:

- smoke HTTP con PostgreSQL real y descartable;
- comprobar la paridad de `publicacion_id`, `prestador_id`, unique e índices contra DER;
- validar el historial de migraciones antes de cualquier despliegue.

## Deuda y bloqueos conocidos

- `render.yaml` aún declara `prisma migrate deploy`; la política TUS exige baseline forward-only target-specific
  cuando el historial diverge.
- La suite global excede el timeout y mezcla gates no focales: seguridad del workflow, secret store Render,
  imports TypeScript sin extensión, disponibilidad de `pnpm` y smoke PostgreSQL.
- El target PostgreSQL físico no se valida sin `DATABASE_URL` y autorización de un entorno descartable.
- Las rutas TUS, provider actions, jobs y consumidores externos permanecen deshabilitados por defecto.
- WEB-08 corrigio la autorizacion de evidencia para exigir tenant prestador y unifico la lectura de detalle en una transaccion.
  WEB-08F/G/H cerraron la proyeccion cliente/prestador del expediente, la huella de idempotencia en servidor con
  deduplicacion de trabajo, reserva y carrito, y la validacion atomica de reserva + Trabajo (`uq_trabajos_reserva`); detalle en
  `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`. Sigue pendiente la politica de cancelar una reserva con trabajo vinculado.
- WEB-09A resolvio el sujeto financiero de servicios (`ObligacionPagoServicio`) y la frontera monetaria. Ningun flujo
  financiero es grado A mientras no exista provider real, migracion aplicada y prueba PostgreSQL descartable. Ver
  `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`.
- El worker Python sigue siendo un scaffold bloqueado, no un consumidor productivo.

## Regla de actualización

Cada Build que cambie arquitectura, producto o dominio debe actualizar este archivo y
`docs/DECISIONES_PRODUCTO_TUS.md`, además de `ARCHITECTURE.md`, `docs/GLOSARIO_TUS.md` y la documentación DB si
corresponde. La fecha, la fase, el commit y los documentos modificados deben quedar indicados antes del commit
final.

## Documentos modificados en WEB-05

- `README.md` — capacidades y límites de la superficie POS Web.
- `ARCHITECTURE.md` — sesión, operaciones y estado POS Web.
- `docs/DECISIONES_PRODUCTO_TUS.md` — decisiones y límites de WEB-05.
- `docs/ROADMAP_TUS.md` — estado y evidencia de WEB-05.

## Documentos modificados en WEB-06

- `README.md` — ruta y límites de soporte Web.
- `ARCHITECTURE.md` — superficie de casos, evidencia y handoff gobernado.
- `docs/DECISIONES_PRODUCTO_TUS.md` — decisiones y límites de WEB-06.
- `docs/ROADMAP_TUS.md` — estado y evidencia de WEB-06.
- `tests/foundation/tus-web-support.test.mjs` — rutas, parser y estados honestos.

## Documentos modificados en WEB-07

- `README.md` — ruta, capacidades y límites del prestador Web.
- `ARCHITECTURE.md` — onboarding, listings, publicación y frontera de agenda.
- `docs/DECISIONES_PRODUCTO_TUS.md` — decisiones y límites de WEB-07.
- `docs/ROADMAP_TUS.md` — estado y evidencia de WEB-07.
- `tests/foundation/tus-web-prestador.test.mjs` — rutas y límites honestos del prestador.

## Documentos modificados en WEB-04D3

- `README.md` — journey Web canónico y límites legacy.
- `ARCHITECTURE.md` — arquitectura Web implementada y límites D3.
- `docs/DECISIONES_PRODUCTO_TUS.md` — decisiones D2 y D3.
- `docs/ROADMAP_TUS.md` — estado y evidencia de D3.
- `docs/GLOSARIO_TUS.md` — términos de agenda y disponibilidad.
- `docs/database/DICCIONARIO_DATOS_TUS.md` — ausencia de delta físico D3.

## Documentos modificados en WEB-08A/B

- `README.md` — límites de Web y disponibilidad API de WEB-08B.
- `ARCHITECTURE.md` — bounded context `work`, ownership y rutas implementadas.
- `docs/DECISIONES_PRODUCTO_TUS.md` — decisiones de modelo, compromiso sin franja y aceptación API.
- `docs/ROADMAP_TUS.md` — estado WEB-08A/B y plan C/D.
- `docs/GLOSARIO_TUS.md` — entidades WEB-08 respaldadas por contracts, persistencia y API.
- `docs/database/DER_TUS.dbml` — tablas, índices y relaciones físicas WEB-08A.
- `docs/database/DICCIONARIO_DATOS_TUS.md` — modelo físico y límites operativos WEB-08A/B.
- `packages/contracts/src/tus.ts` — estados, entidades y validadores WEB-08A.
- `packages/contracts/schemas/tus/` — schemas JSON de Trabajo, Diagnóstico, Presupuesto, aceptación y evidencia.
