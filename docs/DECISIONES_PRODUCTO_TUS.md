# Decisiones de producto TUS

> **Fuente canonica de decisiones.** Una Build no puede introducir una decision de arquitectura, producto o
> dominio sin registrarla aqui. Ultima actualizacion: 2026-09-17. Build: `WEB-08` (auditoria/plan, sin implementacion).
> Commit de referencia: `de0f5cb`; commit objetivo: `docs(tus): planificar ciclo de trabajo y presupuesto`.

## WEB-04D2: disponibilidad y reservas por Publicacion

**Estado:** implementada en API, contracts, adapters y superficie Web canónica.

### D2-01: Publicacion es la identidad de servicio

- `Publicacion` es la identidad comercial canónica de un servicio dentro del marketplace.
- El contrato HTTP usa `listingId` para identificarla.
- `serviceId` solo se conserva en rutas y cuerpos legacy del calendario.
- No se crea una entidad puente ni se inventa un ID alternativo.

**Razón:** discovery, disponibilidad, precio, modalidad y reserva deben referirse a la misma oferta visible.

### D2-02: Una agenda principal por Prestador y Tenant

- La agenda canónica se resuelve por `(tenantId, prestadorId)`.
- La selección exige una única agenda; ausencia, duplicidad efectiva o estado inactivo no se convierten en una
  agenda arbitraria.
- `calendarId` enviado por el cliente es una comprobación opcional: si no coincide con la agenda resuelta, la
  operación falla con `CALENDAR_MISMATCH`.

**Razón:** evita reservas cruzadas entre publicaciones, prestadores o tenants y elimina dependencia de un
`serviceId` artificial.

### D2-03: Modalidades de reserva y precio son explícitas

La frontera pública acepta los aliases legacy y los valores físicos históricos de D1, sin inventar una modalidad nueva:

| Campo         | Valor               | Regla                                                           |
| ------------- | ------------------- | --------------------------------------------------------------- |
| `bookingMode` | `turno_fijo` / `fixed_shift` | Requiere `durationMinutes` entero positivo.              |
| `bookingMode` | `visita_diagnostico`        | Requiere `durationMinutes` entero positivo.              |
| `bookingMode` | `duracion_estimada` / `variable_duration` | Requiere `estimatedDurationMinutes` entero positivo. |
| `bookingMode` | `requiere_presupuesto`      | Impide slots y booking automático.                       |
| `priceMode`   | `precio_fijo` / `fixed`     | Permite disponibilidad y booking automático.             |
| `priceMode`   | `precio_desde`              | Conserva el precio publicado y permite disponibilidad.   |
| `priceMode`   | `por_hora`                  | Conserva el precio publicado y permite disponibilidad.   |
| `priceMode`   | `presupuesto` / `requires_budget` | Impide slots y booking automático.                  |

Los aliases se mantienen para no romper consumidores existentes; los adapters Prisma preservan los valores físicos en
español al leer y escribir. La duración efectiva solo se obtiene para las modalidades automáticas.

### D2-04: Disponibilidad no configurada es un estado verificable

- `configured` solo se devuelve cuando existe una agenda activa del prestador.
- `not_configured` se devuelve cuando la publicación no tiene una agenda activa.
- Un item `not_configured` no expone `calendarId`.
- Consultar slots o reservar una publicación sin agenda activa falla con `NOT_CONFIGURED`.

**Razón:** la UI debe distinguir una oferta publicada de una oferta que todavía no puede reservarse.

### D2-05: Presupuesto requerido bloquea antes de generar o reservar

Cuando `bookingMode` es `requiere_presupuesto` o `priceMode` es `presupuesto`/`requires_budget`, tanto slots como
booking responden `BUDGET_REQUIRED`. No se genera una reserva provisional ni se ocupa capacidad antes de
crear/aceptar un presupuesto.

### D2-06: Slot y capacidad pertenecen al calendario, duración a la Publicacion

- El slot canónico se identifica como `calendarId:listingId:start`.
- La duración efectiva se toma de la modalidad de la publicación: `turno_fijo`/`visita_diagnostico` usan
  `durationMinutes`; `duracion_estimada` usa `estimatedDurationMinutes`; `requiere_presupuesto` no tiene duración
  automática.
- La generación considera zona horaria, horarios, excepciones, granularidad, buffer, cutoff y capacidad.
- Las reservas confirmadas ocupan capacidad solo cuando sus intervalos se superponen.

### D2-07: Persistencia sin cambio físico en D2

WEB-04D2 no agrega ni modifica tablas, columnas, índices, constraints o migraciones. Usa los campos ya existentes
del modelo WEB-04D1:

- `Publicacion.modalidadReserva`, `Publicacion.duracionEstimadaMinutos` y `Publicacion.modalidadPrecio`;
- `Calendario.prestadorId` y su unique tenant-scoped;
- `Calendario.granularidadMinutos` y `Calendario.bufferMinutos`;
- `Reserva.publicacionId`, nullable para conservar reservas legacy.

La migración `20260916140000_tus_provider_agenda_publication_modes` existe en el repositorio, pero su aplicación física
al target no está verificada y permanece fuera del alcance de D2.

El DER y el diccionario deben registrar esta distinción: D2 cambia el uso canónico en la aplicación, no el modelo
físico.

### D2-08: Autoridad, idempotencia y evidencia

- Tenant y actor se derivan de la sesión, nunca de campos confiados del cliente.
- Booking reclama `Idempotency-Key` por tenant y verifica `requestHash`.
- Replay devuelve el resultado original; una clave reutilizada con otro hash produce `CONFLICT`.
- Reserva, auditoría y outbox se escriben dentro de la frontera transaccional del store.

## WEB-04D3: journey Web canónico de servicios

**Estado:** implementada y validada en consumidores Web.

### D3-01: La publicación conduce disponibilidad, reserva y checkout

- Web importa los tipos de discovery y checkout desde `packages/contracts`; no mantiene una copia reducida de la publicación.
- El detalle de una publicación de servicio consulta slots reales en `/tus/v1/marketplace/listings/:listingId/slots`; el alias `/tus/v1/mercado-servicios/*` permanece compatible.
- El booking canónico envía `listingId`, `slotId`, `calendarId` opcional, idempotencia y hash; nunca fabrica `serviceId`.
- El checkout de un servicio solo se construye después de un booking confirmado y conserva `slotStart`/`slotEnd` del slot devuelto por el servidor.
- Los productos mantienen checkout directo y no requieren calendario.

**Razón:** la UI debe ejecutar la misma secuencia verificable que el dominio: discovery, slot real, booking real y compromiso.

### D3-02: No hay horarios sintéticos en Web

- La intención de checkout rechaza un servicio sin una franja real con `a real service slot is required before checkout`.
- `configured` habilita la agenda únicamente cuando discovery entregó `calendarId`.
- `not_configured` y `BUDGET_REQUIRED` bloquean acciones automáticas sin crear una reserva provisional.
- El método Web legacy que acepta `calendarId + serviceId` permanece aislado para consumidores explícitos; el journey nuevo no lo usa.
- Cambiar o refrescar la franja invalida la intención previa, y el checkout usa el intervalo confirmado por la reserva.

### D3-03: Estados visibles y recuperables

- La consulta de slots muestra `loading`, `empty` y `error`.
- La publicación muestra `not_configured` y `BUDGET_REQUIRED` antes de mostrar acciones no disponibles.
- `STALE_SLOT`, cutoff, capacidad, `NOT_FOUND` y conflictos HTTP 409 conservan el feedback y permiten actualizar o reintentar sin afirmar éxito.
- Discovery expone en la tarjeta `bookingMode`, `estimatedDurationMinutes`, `priceMode` y `availabilityStatus` cuando el servidor los devuelve.

### D3-04: Sin delta físico

WEB-04D3 no agrega migraciones, tablas, columnas, índices, constraints, adapters de persistencia ni providers. Reutiliza las rutas,
contratos y adapters entregados en D2; solo adapta el consumo Web y las pruebas del journey.

## WEB-05: POS refinado

**Estado:** implementada y validada en la superficie Web, sin cambios API, contracts o persistencia.

### POS-01: La sesión Web es explícita

- La Web inicia el dispositivo `web-pos` mediante `POST /tus/v1/pos/devices` y abre una sesión mediante
  `POST /tus/v1/pos/sessions`.
- El cierre usa `POST /tus/v1/pos/sessions/:sessionId/close` y muestra estado, dispositivo y fecha devueltos por TUS.
- La Web no considera abierta una sesión localmente antes de recibir la respuesta del servidor.

### POS-02: Las operaciones usan la sesión confirmada

- `deviceId` y `shiftId` se toman de la sesión abierta; no se fabrica un turno para enviar una operación.
- El importe se valida como entero positivo porque el servicio POS actual exige unidades menores seguras.
- El comprobante conserva `providerCapture: not-claimed` y `settlement: not-claimed`; no se habilitan pagos ni hardware.

### POS-03: Estado, historial y retry honesto

- La Web refresca el estado con `GET /tus/v1/pos/operations/:operationId/status`.
- El retry de una respuesta incierta reenvía la misma operación y la misma clave idempotente; un conflicto no se convierte en éxito.
- El backend actual no expone un listado HTTP de operaciones ni una lectura de sesión abierta. Por eso la lista Web se
  limita a operaciones confirmadas durante la visita actual y no simula operaciones del día.

### POS-04: Fuera de alcance

- No se agregó endpoint de listado, refund, cancelación, impresora, resolución de conflictos ni hardware porque la
  superficie solicitada no puede inventar una lectura o workflow Web que el contrato actual no entrega.
- No se modificaron contratos, schemas, migraciones, Prisma, flags de providers ni datos existentes.

## WEB-06: soporte y handoff gobernado

**Estado:** implementada y validada en la superficie Web, sin cambios API, contracts o persistencia.

### SUP-01: La Web consume casos y evidencia existentes

- La lista usa `GET /tus/v1/support/cases`, que ya devuelve casos tenant-scoped.
- Abrir un caso usa `POST /tus/v1/support/cases`; la descripción se envía como resumen de evidencia mediante
  `POST /tus/v1/support/cases/:caseId/evidence`.
- La UI exige una sesión autenticada y conserva los permisos derivados de esa sesión; no confía en tenant, actor o roles
  enviados por el formulario.

### SUP-02: El vacío de timeline es explícito

- El servicio mantiene timeline y outbox, pero el router actual no expone una lectura HTTP de timeline.
- La Web muestra la confirmación de caso/evidencia que recibió y explica que no puede mostrar eventos adicionales.
- No se reconstruyen eventos desde respuestas parciales ni se agrega un endpoint Web no respaldado.

### WHA-01: Handoff sin prometer entrega externa

- El handoff usa `POST /tus/v1/whatsapp/support-handoff` con el permiso `tus:whatsapp:write`.
- La pantalla exige motivo y confirmación explícita de que se registra un handoff TUS, no una entrega WhatsApp.
- Un resultado solo se muestra como confirmado cuando TUS devuelve `status: handoff`; no se expone número, se solicitan
  credenciales ni se afirma actividad del provider.

### SUP-03: No retry automático sin contrato idempotente

- Mientras una solicitud está en curso, la UI bloquea el botón para evitar duplicados accidentales.
- Los endpoints actuales de casos, evidencia y handoff no exponen una clave idempotente en su contrato; la Web no inventa
  retry automático ni reclama exactly-once.

### WEB-06-04: Sin delta físico

WEB-06 no agrega rutas backend, contratos públicos, schemas, migraciones, modelos Prisma, adapters, flags ni providers.
Solo agrega el consumidor Web y sus pruebas focales sobre capacidades ya entregadas.

## WEB-07: flujo Web del prestador

**Estado:** implementada y validada en la superficie Web sobre capacidades marketplace existentes.

### PRE-01: El prestador usa la frontera marketplace existente

- La superficie `/tus/prestador` lee el perfil y los listings del tenant con la ruta de operaciones merchant existente.
- El onboarding usa `POST /tus/v1/marketplace/onboarding`; crear un listing usa `POST /tus/v1/marketplace/listings`;
  publicar usa `POST /tus/v1/marketplace/listings/:listingId/publish`.
- La UI solo habilita lectura con `tus:marketplace:read` y mutaciones con `tus:marketplace:write`; el backend sigue
  derivando tenant, actor, roles y autorización desde la sesión.

### PRE-02: Draft y publicación conservan los hechos del servidor

- La pantalla permite ingresar los campos que el API ya valida para productos y servicios: cohort, ubicación, precio,
  stock, capacidad, modalidad, duración y horario laboral.
- Los listings nuevos se muestran como `draft` hasta que el usuario ejecuta publicar y TUS devuelve `published: true`.
- El cliente no genera `listingId`, policy version, availability version ni status de publicación.

### PRE-03: Calendario no se inventa ni se duplica

- Aunque existe `POST /tus/v1/calendar`, el router no ofrece lectura tenant-scoped de calendarios para esta superficie.
- WEB-07 no crea una agenda que no pueda confirmar ni intenta deducir una agenda primaria desde el navegador.
- Un servicio puede estar publicado y continuar en `not_configured`; slots y booking siguen bloqueados por el estado real de
  la agenda del prestador.

### PRE-04: Sin delta físico ni provider

WEB-07 agrega tipos de cliente, superficie Web, estilos y pruebas sobre rutas ya existentes. No modifica API, contracts
públicos, schemas, migraciones, Prisma, adapters, providers ni flags de activación.

## WEB-08: gate de capacidad y plan de trabajo/presupuesto

**Estado:** auditada; no implementada porque las capacidades backend requeridas no son suficientes para exponer una Web
honesta de Trabajo + Presupuesto + Aceptación.

### W08-01: Trabajo no equivale a job técnico ni tarea de delivery

- No existe un bounded context, contrato o modelo persistente canónico `Trabajo` para servicios.
- `TusJob` es una cola técnica con intentos, leases y payload; no es una ejecución comercial.
- `TareaEntrega` tiene relación con `Compromiso` y evidencia de delivery, pero no representa ejecución de un servicio.
- No se crearán aliases ni pantallas que presenten cualquiera de esos modelos como `Trabajo`.

### W08-02: Presupuesto requerido es un bloqueo, no un presupuesto

- `requiere_presupuesto`, `presupuesto` y `requires_budget` bloquean slots y booking automático con `BUDGET_REQUIRED`.
- WhatsApp ofrece `quote` y `confirm` con snapshot de listings, expiración y consumo en `ConfirmacionWhatsApp`; esa
  capacidad está limitada al canal y no define el agregado comercial de presupuesto.
- El presupuesto canónico futuro debe enlazar tenant, publicación, solicitud/compromiso, líneas, importe, moneda,
  vigencia, versión, estado y actor de aceptación.

### W08-03: Aceptación existente no cubre el presupuesto de servicio

- Checkout confirma compromisos y WhatsApp confirma una instantánea del canal.
- No existe una operación canónica para aceptar una versión de presupuesto de servicio, crear o enlazar el `Trabajo` y
  rechazar versiones obsoletas con control de concurrencia.
- La aceptación futura deberá ser explícita, tenant-scoped, idempotente y auditable.

### W08-04: Evidencia y cierre permanecen ligados al compromiso

- `POST /tus/finance/evidence` persiste evidencia financiera por `commitmentId` y admite `check-in`, `completion` y
  `delivery-accepted`.
- `POST /tus/finance/confirmations` confirma completion para reglas financieras; no cierra un trabajo de servicio.
- `fulfilled`, `released` y `compensated` son estados de `Compromiso`, no estados de `Trabajo`.
- WEB-08 no reutilizará evidencia financiera o delivery sin una relación de dominio explícita.

### W08-05: Implementación diferida y unidades aprobadas para planificación

- **WEB-08A:** modelo de dominio y contracts de Trabajo, Diagnóstico, Presupuesto, aceptación, evidencia y cierre.
- **WEB-08B:** API, persistencia, ownership, idempotencia, versionado optimista y migraciones forward-only.
- **WEB-08C:** Web prestador para solicitud, diagnóstico, presupuesto y ejecución.
- **WEB-08D:** Web cliente para lectura/aceptación, agenda, evidencia y cierre.
- No se implementan rutas, modelos, migraciones ni pantallas en esta auditoría.
- Pagos, settlement, Mercado Pago y providers continúan fuera de alcance.

## Alcance de la Build

Incluido:

- API marketplace y calendario;
- contratos TypeScript y JSON Schema;
- adapters in-memory y Prisma;
- tests focales D2 y D3;
- consumidores Web de discovery, slots, booking y checkout;
- documentación canónica y README.

No incluido:

- migración física nueva;
- migración de rutas y cuerpos legacy del backend; D3 agrega el journey canónico sin retirarlos;
- D1 o reset de base de datos;
- activación de producción, proveedores o jobs;
- traducción breaking de `listingId`, `calendarId` o `serviceId` en payloads existentes.
- implementación funcional de WEB-08A–D; esta Build solo registra el plan y el bloqueo backend.

## Evidencia de implementación

- Commit base D2: `5f56c84`; D3 prepara el commit `feat(web): usar agenda del prestador en servicios`.
- Tests Web D3/UX: 34/34 pass; tests D2/marketplace: 20/20 pass; integración catálogo/calendario/UI: 22/22 pass.
- Typechecks contracts/API/Web: pass.
- JSON Schemas: 98 pass, con warnings AJV no bloqueantes.
- Builds Contracts y API: pass. Build Web: compilación, tipos y 16 rutas pass con standalone deshabilitado para evitar symlinks `EPERM` de Windows.
- ESLint focal sobre los archivos TS/TSX modificados: pass.
- Smoke Web: `/`, `/tus/mercado` y `/tus/mercado/listing-smoke` responden HTTP 200 en `localhost:3100`.
- Suite global: no verde por timeout y gates independientes preexistentes; ver `docs/ROADMAP_TUS.md`.
