# Decisiones de producto TUS

> **Fuente canonica de decisiones.** Una Build no puede introducir una decision de arquitectura, producto o
> dominio sin registrarla aqui. Ultima actualizacion: 2026-09-18. Builds `WEB-08A`, `WEB-08B`, `WEB-08C`, `WEB-08D` y
> `WEB-08E` implementadas. La auditoria WEB-09 esta en `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`.
> Commit de referencia documental: `ba8db98`.

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

| Campo         | Valor                                     | Regla                                                  |
| ------------- | ----------------------------------------- | ------------------------------------------------------ |
| `bookingMode` | `turno_fijo` / `fixed_shift`              | Requiere `durationMinutes` entero positivo.            |
| `bookingMode` | `visita_diagnostico`                      | Requiere `durationMinutes` entero positivo.            |
| `bookingMode` | `duracion_estimada` / `variable_duration` | Requiere `estimatedDurationMinutes` entero positivo.   |
| `bookingMode` | `requiere_presupuesto`                    | Impide slots y booking automático.                     |
| `priceMode`   | `precio_fijo` / `fixed`                   | Permite disponibilidad y booking automático.           |
| `priceMode`   | `precio_desde`                            | Conserva el precio publicado y permite disponibilidad. |
| `priceMode`   | `por_hora`                                | Conserva el precio publicado y permite disponibilidad. |
| `priceMode`   | `presupuesto` / `requires_budget`         | Impide slots y booking automático.                     |

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
- La generación considera zona horaria, horarios, excepciones, duración, descanso, cutoff y capacidad. Los inicios
  avanzan desde la apertura real en pasos de `duración + descanso`; la duración del último turno debe entrar completa,
  pero no se exige descanso después del cierre.
- `Calendario.granularidadMinutos` y `ReglaCalendario.intervaloMinutos` quedan legacy por compatibilidad: se conservan
  sin migración destructiva, pero no deciden los slots nuevos.
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

## WEB-08: modelo y plan de trabajo/presupuesto

**Estado:** WEB-08A implementa el modelo y los contracts; WEB-08B implementa los casos de uso/API; WEB-08C integra la
superficie de prestador y WEB-08D expone lectura/decisión cliente sin reconstruir reglas de negocio en React.

### W08-01: Trabajo no equivale a job técnico ni tarea de delivery

- `Trabajo` tiene contrato, modelo persistente y el caso de uso de aceptación del prestador.
- `TusJob` es una cola técnica con intentos, leases y payload; no es una ejecución comercial.
- `TareaEntrega` tiene relación con `Compromiso` y evidencia de delivery, pero no representa ejecución de un servicio.
- No se presentarán `TusJob` ni `TareaEntrega` como `Trabajo` ni se agregan pantallas en WEB-08A/B.
- `reservas.tenant_id` continúa identificando al prestador propietario de la agenda; WEB-08 agrega `cliente_tenant_id`
  nullable para conservar el tenant cliente en reservas nuevas. No se infiere ni backfillea desde `cliente_id`, por lo
  que reservas históricas sin ese dato no pueden vincularse a `Trabajo`.

### W08-02: Presupuesto requerido es un bloqueo, no un presupuesto

- `requiere_presupuesto`, `presupuesto` y `requires_budget` bloquean slots y booking automático con `BUDGET_REQUIRED`.
- Un checkout sin franja puede crear el compromiso de servicio que después acepta el prestador; no crea reserva provisional ni
  ocupa capacidad antes de aceptar un presupuesto.
- WhatsApp ofrece `quote` y `confirm` con snapshot de listings, expiración y consumo en `ConfirmacionWhatsApp`; esa
  capacidad está limitada al canal y no define el agregado comercial de presupuesto.
- El presupuesto canónico enlaza tenant de cliente, tenant de prestador, trabajo, líneas, importe minor-unit, moneda,
  vigencia, versión y estado; la aceptación queda en una tabla append-only por versión. Solo la última versión emitida y
  vigente según el reloj del servidor puede decidirse.

### W08-03: Aceptación existente no cubre el presupuesto de servicio

- Checkout confirma compromisos y WhatsApp confirma una instantánea del canal.
- WEB-08B expone aceptación de compromiso, diagnóstico, presupuesto versionado, decisión del cliente, evidencia y
  transiciones de trabajo por `/tus/v1/work/*` y `/tus/v1/trabajos/*`.
- La decisión es explícita, tenant-scoped, idempotente y auditable; la persistencia impone una decisión por versión y el
  servicio aplica locking optimista antes de cambiar el trabajo. Una reserva opcional se enlaza solo cuando coincide con el
  cliente, prestador, publicación y estado confirmado del compromiso.

### W08-04: Evidencia y cierre permanecen ligados al compromiso

- `POST /tus/finance/evidence` persiste evidencia financiera por `commitmentId` y admite `check-in`, `completion` y
  `delivery-accepted`.
- `POST /tus/finance/confirmations` confirma completion para reglas financieras; no cierra un trabajo de servicio.
- `fulfilled`, `released` y `compensated` son estados de `Compromiso`, no estados de `Trabajo`.
- WEB-08 no reutiliza evidencia financiera o delivery sin una relación de dominio explícita; `evidencias_trabajo` conserva
  fase, referencia y metadata durable.

### W08-05: Superficie prestador y unidades pendientes

- **WEB-08A:** completada: modelo Prisma/DB, contracts, JSON Schemas, estados, transiciones y documentación DB.
- **WEB-08B:** completada: API, persistencia in-memory/Prisma, ownership, idempotencia, versionado optimista, auditoría,
  outbox y rutas HTTP.
- **WEB-08C:** completada: Web prestador lista trabajos aceptados, muestra detalle, registra diagnóstico, emite versiones de
  presupuesto, referencia evidencia y solicita inicio/cierre al backend. La API no ofrece inbox provider-scoped de compromisos
  pendientes; la Web no inventa esa lista y acepta solo una referencia obtenida por un flujo autorizado.
- **WEB-08D:** completada: Web cliente lee trabajo, diagnóstico, presupuestos/evidencia/historial y decide la última versión
  vigente. Enlaza al compromiso existente para agenda; no inventa una agenda ni mutaciones cliente de evidencia/cierre.
- **WEB-08E:** completada: el cierre temprano usa `POST /tus/v1/work/:workId/cancel`, idempotencia y versión existentes. La
  transición exige ownership de prestador y la Web confirma la intención; no se inventa motivo ni una API nueva.
- Pagos, settlement, Mercado Pago y providers continúan fuera de alcance.

## WEB-09: auditoria de capacidades sin activacion operativa

**Estado:** auditada; no habilita nuevos providers, cobros, payouts ni integraciones de producto.

- Marketplace solo aprueba los cohorts `beauty-personal-care` y `repairs-trades` para Stage 1.
- Recomendaciones permanece como capacidad neutral P4.12; su ranking local es deterministicamente testeable y Bedrock sigue
  gated por credenciales, region, cuota y evidencia de conformance.
- Tenancy expone memberships. Billing tiene contratos, servicio y persistencia, pero no forma parte de la composicion HTTP de
  `TusApplicationService` ni reclama un flujo Web de suscripcion.
- Mercado Pago tiene adapter y contratos de webhook/payment intent, pero la composicion Prisma usa el provider no disponible y
  las acciones de provider se habilitan solo con flag, adapter y gates.
- Settlement conserva payment intents en estado `held` y bloquea release hasta pasar gates financieros y de custodia; no hay
  transporte de jobs de payout productivo habilitado.

La matriz de evidencia y los criterios para una futura activacion estan en `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`.

### W09-01: Ledger unico con sujeto financiero dual

- Las tablas financieras compartidas referencian exactamente uno entre `compromiso_id` (legacy) y `obligacion_id`
  (servicios WEB-08), con FK real y CHECK XOR validado; no se separan tablas por tipo de sujeto.
- `ALTER COLUMN compromiso_id DROP NOT NULL` es una relajacion controlada reemplazada por el XOR; no elimina datos.
- Detalle, matriz de unicidad y checklist de aplicacion: `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md` (DB-09-SAFETY).

### W09-02: Cuando y cuanto se cobra un servicio (WEB-09D)

- Un servicio se paga cuando el Trabajo esta `completed`; aceptar el presupuesto fija el monto pero no cobra.
- La unica autoridad monetaria es el presupuesto aceptado y versionado. Nunca se cobra desde el precio de la publicacion
  (`precio_desde`, `por_hora` ni precio fijo); sin presupuesto aceptado el trabajo no es cobrable.
- El servidor calcula el importe. Abrir la pantalla de pago no escribe nada; sin proveedor habilitado no se registran
  intenciones ni obligaciones y la Web informa "Pago online no disponible todavia".

### W09-03: Comision TUS configurable y congelada

- La comision es una politica persistida, versionada y append-only en basis points (1000 bp = 10%), con limite 0..3000,
  alcance global, por categoria (cohorte) o por prestador, editable por el admin de plataforma sin redeploy.
- La tasa usada en un pago queda congelada en su snapshot junto al fee del PSP y el neto del prestador; los cambios
  posteriores no recalculan historia.
- WEB-09E (decision definitiva): el cliente paga exactamente el total del presupuesto aceptado; del total se descuentan
  el fee de Mercado Pago (el que informa Mercado Pago) y la comision TUS: `netoPrestador = total - feeMP - comisionTus`.
  `pspFeeBearer = provider`; `platform` no esta soportado.

### W09-04: Mercado Pago marketplace con cuenta propia del prestador

- Producto: split de pagos de Mercado Pago (Checkout Pro/API marketplace). El prestador conecta su cuenta por OAuth; el
  cobro se crea con su token y TUS retiene `marketplace_fee`. No hay transferencias manuales ni payouts de TUS.
- TUS no guarda secretos de plataforma en la base; los tokens del prestador se guardan cifrados con una clave externa.
- WEB-09E implementa Checkout Pro con Split 1:1. Un redirect nunca confirma un pago; solo el webhook verificado mas la
  consulta del pago a Mercado Pago. Reembolsos: solo total, por el admin de plataforma; si el vendedor no tiene saldo
  queda en revision manual y TUS no cubre su parte.
- Dinero real permanece apagado hasta la prueba sandbox con credenciales y la habilitacion `settlement` por evidencia.

### W09-05: Trabajos nacidos de una solicitud: seña 50% + saldo 50% (decisión del dueño, 2026-09-29)

Reemplaza W09-02 **solo** para trabajos con `origen = 'solicitud'`; el marketplace viejo sigue con W09-02.

- Monto: siempre el presupuesto aceptado guardado en backend. Seña = mitad redondeada hacia arriba al centavo; saldo = el
  resto exacto (`seña + saldo = total`). Cada parte es una obligación (`tramo` `sena` / `saldo`, única por trabajo y parte)
  con su propio checkout Split 1:1 y su comisión congelada (`marketplace_fee`) al crearse.
- Seña: se puede pagar apenas se acepta el presupuesto. Con los pagos de TUS **habilitados** (configuración global
  `paymentsEnabled` + proveedor operativo), iniciar exige la seña aprobada (`DEPOSIT_REQUIRED`). Si el Prestador no
  conectó Mercado Pago o no verificó su identidad, el trabajo queda **bloqueado** (`PROVIDER_PAYMENT_ACCOUNT_REQUIRED`),
  nunca gratis. Solo con los pagos de la plataforma apagados se conserva el comportamiento anterior (desarrollo y
  migración hasta la activación).
- Presupuesto mínimo de un trabajo de solicitud: 2 centavos (`BUDGET_TOO_SMALL`), para que seña y saldo sean positivos.
- Saldo: se puede pagar cuando la seña está pagada y el Prestador marcó el trabajo como terminado (`terminado_en`); con pago
  online el trabajo queda `in_progress` hasta que el webhook verificado aprueba el saldo, y esa aprobación lo pasa a
  `completed` en la misma transacción. Sin pago online, "Marcar como terminado" completa directamente.
- Un redirect de Mercado Pago nunca confirma; la Web vuelve a `/trabajos/<id>?pago=retorno` y relee el trabajo.

### W09-06: Cancelación segura de trabajos nacidos de una solicitud (FASE 8)

- Solicitud abierta sin Prestador elegido: la cancela su dueño (sale del mapa, rechaza postulaciones pendientes, no acepta
  nuevas, registra quién y cuándo, sin DELETE). Con trabajo: `WORK_ACTIVE`; se gestiona desde el trabajo.
- Trabajo antes de iniciar: Cliente o Prestador cancelan con **motivo obligatorio** (máx. 500). Se guardan rol y motivo en
  el trabajo; actor, fecha y estado anterior en `transiciones_trabajo` y `auditoria_trabajo`.
- Trabajo iniciado: el Cliente no cancela (`CLIENT_CANCEL_NOT_ALLOWED`); **solicita la cancelación** con motivo, que queda
  registrada y visible, y nunca cancela sola. El Prestador puede cancelar si no hay pagos.
- Con la seña pagada nadie cancela desde la app (`PAYMENT_REQUIRES_SUPPORT`): lo resuelve soporte con
  `POST /tus/v1/admin/trabajos/:id/cancelar` (admin con MFA, motivo obligatorio). Cancelar **no** reembolsa ni borra
  pagos; el reembolso es la operación administrativa aparte (`/tus/v1/admin/payments/refunds`).
- Un pago aprobado después de una cancelación se registra (el dinero se movió) pero no reactiva el trabajo: caso de
  soporte.
- El marketplace viejo conserva su regla (solo el Prestador cancela, sin motivo obligatorio).

### W09-08: Turnos del directorio: seña 50% que confirma el turno (TURNOS-SENA-01, 2026-10-02)

Aplica a los turnos que un cliente solicita a un prestador del directorio (Web, asistente Web y
WhatsApp). No cambia W09-02 (marketplace) ni W09-05 (trabajos de solicitud).

- Estados: `pending` (solicitada) → `awaiting_payment` (el prestador aceptó; falta la seña) → `confirmed`
  (seña aprobada). El prestador **acepta**, no confirma. El único camino automático a `confirmed` es el
  webhook verificado de Mercado Pago, dentro de la transacción financiera.
- Monto: seña = 50% del precio guardado en la reserva (`reservas.precio_final`, el de la variante elegida
  en `tarifas_servicio_prestador` o el precio base del servicio), redondeado hacia arriba al centavo. Lo
  calcula el backend con la misma regla de W09-05 (`montosSenaSaldo`); ni la Web, ni WhatsApp, ni el modelo
  lo envían o lo calculan. No se guarda ningún monto de seña en la reserva.
- Ventana de pago: 24 horas desde la aceptación y nunca más allá del inicio. Mientras dura, el turno
  retiene su horario. Vencida, el turno pasa a `expired` y el horario se libera.
- Donde TUS **puede cobrar** (pagos online activos y, en producción, `service-payments` habilitado): un
  prestador sin Mercado Pago conectado o sin identidad verificada no puede aceptar
  (`PROVIDER_PAYMENT_ACCOUNT_REQUIRED`), y un servicio sin precio no admite solicitudes
  (`SERVICE_PRICE_REQUIRED`). Con los pagos online **apagados** en toda la plataforma (o un turno sin
  precio) no hay seña: aceptar confirma, como antes.
- En producción cobrar exige además la habilitación por evidencia de la capacidad `service-payments` (legal,
  fiscal, KYC, KYB, Mercado Pago y runtime). `settlement` **no** es el gate de las señas. Decisión del dueño
  (2026-10-02): con los pagos online activos (`paymentsEnabled = true`) y **sin** esa habilitación, un turno con
  precio **no se puede aceptar** (`SERVICE_PAYMENTS_NOT_AUTHORIZED`): la solicitud queda pendiente y nunca se
  confirma sin su seña. Un turno sin precio no tiene seña y aceptar lo confirma, como siempre. En sandbox la
  habilitación no se exige y el circuito completo se puede probar.
- Si la habilitación se pierde con un turno ya en `awaiting_payment`, no se entrega checkout
  (`PAYMENT_NOT_AVAILABLE`) y el turno **no** se confirma: vence con su ventana. Si no se puede determinar
  qué significa aceptar (la verificación falla), aceptar responde error; nunca se confirma por descarte.
- Pago: se reutiliza la cadena de WEB-09 (obligación, intención idempotente, Checkout Pro con split,
  webhook firmado, ledger). La orden de pago es un `trabajos.origen = 'turno'` ligado 1:1 a la reserva; no
  es un trabajo visible para las partes. Pedir el link dos veces devuelve el mismo pago.
- Un redirect de Mercado Pago nunca confirma; la Web vuelve a `/mis-turnos?pago=retorno` y relee.
- Pago aprobado fuera de término (la ventana venció o el turno se canceló): se registra, no confirma nada
  y queda para reintegro por la plataforma. Cancelar un turno con la seña paga no reintegra solo.
- QR: TUS no genera un QR propio; el Checkout Pro de Mercado Pago ofrece pagar con QR en su pantalla.
- Identificación del cliente: en la Web es la sesión. En WhatsApp (sin sesión) el asistente pide nombre
  completo y DNI y **el backend** busca la cuenta por documento (`uq_user_documento`) y verifica el nombre;
  si no existe o no coincide responde lo mismo en ambos casos y ofrece el link real de registro
  (`/registro?returnTo=…` al mismo profesional, servicio y horario). Nunca crea cuentas ni reservas para
  un desconocido, y ningún identificador interno se muestra al usuario.

Pendiente de decisión del dueño: (a) si el marketplace de publicaciones debe pasar también a cobrar una
seña previa (hoy sigue W09-02); (b) política de reintegro al cancelar con la seña paga; (c) si el
prestador debe poder confirmar un turno cuya seña se cobró fuera de TUS; (d) qué documento acredita `kyb`
para un prestador individual y cómo se modela (ver `docs/activation-gates.md`); (e) si los trabajos de
solicitud (W09-05) deben bloquearse igual que los turnos cuando falta `service-payments` (hoy siguen sin
seña en ese caso).

### W09-09: Ganancias de prestadores sin Mercado Pago y solicitudes de pago (TUS-GANANCIAS-01, 2026-10-03)

- Si TUS tiene configurada su propia cuenta de Mercado Pago (`MERCADO_PAGO_PLATFORM_*`), un prestador **sin** cuenta
  conectada puede cobrar: TUS cobra con su cuenta (sin split) y la parte del prestador queda como **ganancia pendiente**.
  Solo en ese caso esto reemplaza el bloqueo `bloqueada` de W09-08 y W09-05. Identidad verificada y, en producción,
  `service-payments` siguen siendo obligatorios. Con cuenta conectada: Split 1:1 sin cambios, sin ganancias en TUS.
- Ganancia = bruto − comisión TUS; la **tarifa de Mercado Pago la soporta el prestador** (decisión del dueño), con el importe
  real que informa Mercado Pago, debitado cuando se conoce y visible para el prestador.
- Ledger append-only: `earning_credit`, `psp_fee_debit`, `refund_debit`, `chargeback_debit`, `adjustment_credit`,
  `adjustment_debit`, `payout_reserve`, `payout_release`, `payout_completed`. El saldo se deriva; no hay campo saldo.
- **Mínimo** $10.000 inicial, configurable por la administración (configuración de pagos versionada). **Frecuencia** libre.
  Una sola solicitud activa por prestador. Para pedir: Mercado Pago conectado con OAuth vigente y cuenta habilitada,
  identidad verificada, disponible ≥ mínimo; el prestador indica el email de su cuenta de Mercado Pago.
- **Saldo negativo**: obligación del prestador, visible para la administración, no retirable, compensado por ganancias
  futuras; nunca se cobra fuera de TUS. Resoluciones manuales solo con `adjustment_credit` / `adjustment_debit`.
- **Ejecución**: la vía por defecto y verificable es la **manual administrativa** (el administrador paga por el medio
  autorizado y registra el comprobante). Mercado Pago Payouts (`POST /v1/payouts`, desde la cuenta de TUS a la del prestador)
  queda preparado detrás de un puerto pero **DEPENDENCIA EXTERNA NO CONFIRMADA**: el contrato no se pudo verificar contra la
  documentación de Mercado Pago ni contra una cuenta habilitada, por eso está apagado; si se habilita, el resultado se confirma solo por la consulta de la transacción a Mercado Pago; o, si la administración pagó por otro medio, registro
  con comprobante obligatorio. Las dos vías nunca se mezclan en una solicitud. La administración procesa cada solicitud
  (control antifraude); no hay envíos automáticos sin intervención.
- WhatsApp no permite pedir el pago de ganancias (solo la Web).

### W09-10: Estados de liquidación, auditoría y controles de cobrador (TUS-GANANCIAS-02, 2026-10-03)

- Estados mínimos de una solicitud de pago: `requested`, `processing`, `paid`, `failed`, `cancelled` (antes `pending`
  en lugar de `requested`). `failed` y `cancelled` liberan la reserva; el reintento seguro es una solicitud nueva.
- Toda acción sobre una solicitud queda en una auditoría append-only, una entrada por versión, en la misma transacción.
- Un pago cuya cuenta cobradora no coincide con el modo congelado en la intención (plataforma vs. cuenta del prestador, o
  la cuenta de otro prestador) va a cuarentena; nunca genera ganancia ni confirma un turno.
- Una cuenta de Mercado Pago solo puede vincularse a un prestador.
- Una ganancia se revierte una sola vez; disputas adicionales se resuelven con ajustes explícitos.
- Mercado Pago Payouts queda apagado hasta que el titular verifique el contrato con Mercado Pago y lo pruebe en sandbox:
  desde el entorno de desarrollo no pudo verificarse contra documentación oficial ni SDKs oficiales. La vía "otro medio"
  con comprobante es la operativa disponible mientras tanto; nunca se simula un pago.
- **Transiciones permitidas** (las únicas; nada salta un estado y `paid`, `failed` y `cancelled` son finales):
  `requested → processing → paid`, `requested → cancelled` (nadie empezó a pagarla; la cancela el prestador o la
  administración) y `processing → failed` (se intentó pagar y no ocurrió; la marca la administración o la respuesta de
  Mercado Pago). Una solicitud `processing` no se cancela y una `requested` no se marca fallida. `paid` exige evidencia:
  la transacción de Mercado Pago consultada como acreditada o, en la vía manual, el comprobante de la operación.
- **Cálculo de cada saldo** (siempre derivado del ledger y de las solicitudes; no existe ninguna columna de saldo):
  - Total histórico cobrado (`earnedMinor`) = Σ `earning_credit`. Solo crece; no es dinero ya transferido.
  - Tarifas de Mercado Pago (`feesMinor`) = Σ `psp_fee_debit`. Ajustes netos (`adjustmentsMinor`) = Σ `refund_debit` +
    Σ `chargeback_debit` + Σ `adjustment_debit` − Σ `adjustment_credit` (positivo: debitado).
  - Disponible (`availableMinor`) = Σ `earning_credit` + Σ `adjustment_credit` − Σ `psp_fee_debit` − Σ `refund_debit` −
    Σ `chargeback_debit` − Σ `adjustment_debit` − Σ `payout_reserve` + Σ `payout_release`. Si es negativo, `negativeMinor`
    es su valor absoluto, no se puede retirar y la próxima ganancia lo compensa primero (−5.000 + 8.000 = 3.000).
  - Reservado (`reservedMinor`) = Σ (`payout_reserve` − `payout_release` − `payout_completed`) de las solicitudes
    `requested`. En proceso (`processingMinor`) = lo mismo para las solicitudes `processing`. Pagado (`paidMinor`) =
    Σ `payout_completed`.
  - Identidad de control: `earned − fees − adjustments = available + reserved + processing + paid`.
  - **No existe un saldo "pendiente" distinto del disponible**: TUS no impone un período de maduración; la ganancia
    acumulada por un cobro de plataforma ya es disponible y se retira al superar el mínimo con Mercado Pago vinculado. Si
    producto quiere una retención (p. ej. días tras el turno), es una decisión nueva que requiere agregarla al ledger.
- Mientras el prestador no vincule Mercado Pago, la ganancia queda acumulada en TUS (no se pierde) y la UI le dice:
  "Vinculá tu cuenta de Mercado Pago para retirar tus ganancias." La UI nunca llama "pagada" a una ganancia solo acumulada:
  "Pagadas" son solicitudes completadas.

### W09-11: WhatsApp multimodal — audios, comprobantes y verificación de pagos (TUS-WHATSAPP-MULTIMODAL-01, 2026-10-03)

- **Regla**: la IA interpreta, el backend decide, Mercado Pago certifica el dinero. Un comprobante (imagen o PDF), un audio, un
  texto o la frase "ya pagué" **nunca** confirman un pago, un turno, una ganancia ni una liquidación.
- **Audios**: se transcriben con el STT ya previsto (Groq Whisper, `GROQ_STT_MODEL`) y entran al MISMO flujo que un texto.
  Solo formatos que el proveedor acepta sin conversión (Ogg/Opus, MP3, MP4/M4A); aac y amr crudos se rechazan y TUS no
  convierte. Procesamiento efímero: no se guarda el audio, solo el texto y metadatos mínimos. Si no se entiende, se pide
  repetir o escribir.
- **Comprobantes**: son una pista, no una prueba (fase TUS-WHATSAPP-MULTIMODAL-01 no los leía; TUS-WHATSAPP-MULTIMODAL-02 los
  lee de forma segura, apagado por defecto). Ver W09-12.
- **"¿Ya te llegó?"**: el backend consulta a Mercado Pago por la referencia interna de la intención (con el modo congelado:
  cuenta de TUS o del prestador) y aplica lo que informa por la MISMA máquina de estados del webhook. El webhook sigue
  siendo el camino principal; la consulta es reconciliación y es idempotente en ambos sentidos.
- **Límites**: 15 s entre consultas y 6 por hora por conversación; 20 medios por hora por contacto (configurable).
- **No existe** en WhatsApp la posibilidad de consultar un pago por un identificador que escriba la persona.

### W09-12: Lectura segura de comprobantes (TUS-WHATSAPP-MULTIMODAL-02, 2026-10-03)

- **Regla**: imagen/PDF = pista; contexto TUS = correlación; Mercado Pago = autoridad financiera; backend TUS = decisión.
  Ninguna imagen, PDF, OCR, texto o respuesta de una IA marca un pago como confirmado.
- **Cuándo**: solo si hay varios pagos pendientes del cliente (con uno solo se verifica directo y el archivo no se descarga).
- **Cómo**: descarga acotada (Meta, bytes, tiempo, tipos reales), análisis efímero en memoria, evidencia estructurada
  `untrusted_receipt_evidence` que solo ordena los candidatos del MISMO cliente; todo candidato pasa por la verificación
  completa del dominio financiero contra Mercado Pago.
- **Proveedor**: OCR local por defecto (nada sale de TUS; PDF solo por su capa de texto con `pdftotext`); visión de Groq como
  opción (`WHATSAPP_RECEIPT_ANALYZER=vision`), solo para imágenes. Decisión: privacidad primero, el costo de un modelo de visión
  solo si el OCR local no alcanza en la práctica.
- **Persistencia mínima**: estado, analizador, monto, moneda y fecha; hash de Meta para no releer. No se guardan imagen, PDF,
  base64, texto OCR, CVU/CBU completos, DNI ni nombres del pagador.
- **Pendiente de decisión de producto**: aceptar o no formatos que hoy se rechazan (HEIC, PDF escaneado sin texto) y si se
  habilita `vision` en producción.

### W09-07: Calificación del Prestador (FASE 9)

- Solo el Cliente del trabajo (tenant de la sesión) califica, una vez, y solo con el trabajo `completed` (con pagos
  online eso ocurre recién con el saldo aprobado). Nunca el Prestador, un tercero, un trabajo cancelado o en curso.
- Puntuación entera 1–5 y comentario opcional (máx. 500). Prestador e ids salen del trabajo persistido.
- `calificaciones_trabajo` es append-only (trigger), única por trabajo y ligada por FK al trabajo y a su Prestador; un
  trigger rechaza calificar un trabajo que no está `completed`.
- El perfil público muestra promedio (1 decimal) y cantidad; sin calificaciones, `rating: null`. Se calculan en el
  servidor con una lectura agrupada (GROUP BY) para toda la página del directorio.

## WHATSAPP-01: consentimiento con procedencia verificable

- La vinculación desde Web registra `web_linking` dentro de la confirmación autenticada y con tenant derivado de la sesión.
- Un mensaje inbound voluntario registra `whatsapp_inbound` como consentimiento de conversación. No se asigna tenant a un número
  no vinculado y esa procedencia no habilita marketing general ni plantillas outbound.
- El origen administrativo se deriva como `operator_console`; el cliente no puede enviar una procedencia arbitraria para cambiar el
  significado del consentimiento.
- La evidencia se registra en la auditoría del asistente y, cuando el contacto tiene tenant, en `ConsentimientoWhatsApp`, sin
  exponer el número completo en logs o respuestas administrativas.

## WEB-DIR: directorio y mapa público de prestadores

**Estado:** implementado en contratos, API, Prisma, Web e identidad; los pagos y providers externos siguen sujetos a sus gates.

### DIR-01: el mapa representa oferta, no demanda

- La fuente del mapa principal es `GET /tus/v1/public/prestadores`; `GET /tus/v1/public/solicitudes` permanece como sección
  separada de solicitudes recientes y no se mezcla con los pins de prestadores.
- Los filtros de oficio, zona y texto se resuelven mediante `ServicioDirectorio`, compartido por Web y WhatsApp. El catálogo y
  las zonas provienen de `GET /tus/v1/public/oficios`.

### DIR-02: cobertura laboral y fallback de identidad

- La configuración manual (`zona`, `zonas_cobertura`, `modalidad_atencion`, `radio_cobertura_km`) tiene prioridad.
- Sin configuración manual, una identidad `verified` puede aportar únicamente un área normalizada de barrio/localidad/provincia.
  La fuente puede entregar ese área solo en columnas separadas; una dirección textual se descarta.
- Un área que no coincide con una zona canónica se muestra como localidad/provincia sin pin. Sin área, el perfil queda sin
  ubicación pública. Ningún dato de domicilio, documento o coordenada exacta sale en el DTO público.

### DIR-03: ubicación aproximada determinista

> Reemplazada en el punto de mapa por DIR-06 (2026-09-29): el pin ya no es el centro de cada zona de cobertura sino un único
> punto por prestador resuelto con la geografía administrada. Las reglas de privacidad del DTO de esta sección siguen vigentes.

- Cada pin usa el centro de una zona canónica de Corrientes, redondeado a 3 decimales y marcado `precision: zone`.
- El perfil público expone origen de ubicación, zonas, modalidad y radio, pero no calle, altura, DNI, CUIL, email, teléfono ni
  campos de autoridad. La migración `20261003100000_tus_directorio_ubicaciones` es aditiva y backfillea las zonas existentes.

### DIR-04: navegación segura

- Las rutas Web desconocidas vuelven a `/` mediante el `not-found.tsx` raíz; el segmento `/tus` conserva el mismo fallback.
- Una entidad pública inexistente mantiene su UX específica cuando la ruta existe; una API inexistente sigue respondiendo 404 JSON.

### DIR-05: Categoría → Servicio y prestador con varios servicios (2026-09-29)

- Jerarquía: `categorias_servicio` → `oficios_servicio` (se reutilizan; no se creó otra tabla de servicios).
- Prestador N:M Servicio: `perfil_servicios (perfil_id, oficio_id, orden)`, PK compuesta (sin duplicados), hasta 20 servicios,
  FK a `oficios_servicio` RESTRICT (un servicio usado no se borra; se desactiva). Es la única fuente de verdad de los servicios.
- `perfiles_publicos_prestador.oficio` es el servicio **principal** y siempre pertenece al conjunto: FK compuesta diferida
  `fk_perfiles_servicio_principal (id, oficio) → perfil_servicios`. La migración `20261015100000_tus_perfil_servicios` hizo el
  backfill del oficio vigente de cada perfil (orden 0) sin cambiar ids ni borrar datos.
- Filtros: por servicio, prestadores que lo ofrecen; por categoría, prestadores con **cualquier** servicio de ella. Cada prestador
  aparece una sola vez. La búsqueda de texto mira todos sus servicios.

### DIR-06: geografía administrada y punto de mapa determinista (2026-09-29)

- Los polígonos guardados en TUS son la autoridad geográfica. Zona: polígono opcional + punto de referencia opcional
  (`zonas_ubicacion.poligono`, `latitud`, `longitud`). Barrio: polígono **opcional** (se puede quitar) + punto obligatorio.
  Mismo formato GeoJSON `Polygon` que `barrios.poligono` (un anillo, `[lng, lat]` WGS84). Sin PostGIS.
- Validación (API): 3 a 200 vértices distintos, coordenadas en rango, anillo cerrado (se cierra si falta), sin autointersecciones,
  con superficie (vértices colineales se rechazan) y un vértice repetido consecutivo (doble clic) se descarta.
- Un prestador tiene **un** punto en el mapa (nunca uno por servicio o por zona de cobertura). Prioridad:
  1. pin exacto, solo si el prestador eligió "Mostrar ubicación exacta" (`mostrar_ubicacion_exacta`, por defecto no);
  2. polígono de su barrio (punto interior del polígono, no el centroide: siempre cae dentro, también en formas cóncavas);
  3. polígono de su zona;
  4. punto de referencia (del barrio o de la zona);
  5. ninguno: no aparece en el mapa y el panel muestra "Sin ubicación geográfica".
- El pin exacto se guarda para TUS aunque no se publique; sin permiso el mapa muestra solo el área.

### DIR-07: asociación de un punto a barrio/zona (2026-09-29)

- Al guardar un punto (prestador o admin): barrio cuyo polígono lo contiene (el más chico), si no zona cuyo polígono lo contiene;
  solo si ningún polígono lo contiene se consulta un geocodificador inverso externo, cuyo resultado se **compara por nombre** con
  barrios, zonas y localidades existentes (p. ej. "Alta Gracia"). La API nunca crea, reemplaza ni modifica áreas por esto.
- Sin coincidencia el punto se conserva como `sin_asociar` y el panel lo indica. `ubicacion_asociacion` registra el origen:
  `poligono_barrio | poligono_zona | geocodificador | manual | sin_asociar`.
- Geocodificador: solo al guardar (nunca al cargar el mapa), solo coordenadas con 6 decimales, límite de 4 s sobre pedido y
  cuerpo, cualquier falla = sin nombres. `TUS_REVERSE_GEOCODER=off` lo desactiva; `TUS_REVERSE_GEOCODER_URL` acepta solo HTTPS.

### DIR-08: comportamiento del mapa público (2026-09-29)

- Un marcador por prestador. Agrupamiento propio (sin dependencias) y determinista: prestadores en el **mismo punto** forman
  siempre un grupo con lista ("N prestadores en esta ubicación": nombre, servicios, calificación, Ver perfil); puntos cercanos
  (48 px) forman un cluster que al tocarlo acerca el mapa; desde zoom 17 solo se agrupan puntos idénticos.
- Texto de popups como texto (React), nunca HTML de perfiles; el HTML de los íconos lleva solo un número acotado o un ícono fijo.
- Filtros de la home: Categoría → Subcategoría (un servicio de esa categoría; ver DIR-10). La API ya filtra por `categoria` y `oficio`.
- Sin N+1: el directorio lee perfiles, prestadores, publicaciones, identidad, trabajos completados y calificaciones en lotes; la
  cantidad de consultas es la misma para 1 y para 40 prestadores (medido en PostgreSQL 16).

### DIR-10: el mapa como centro de la búsqueda (2026-10-03)

- **Navegación principal**: Buscar servicios, Buscar trabajador, Para profesionales, Ayuda y el botón "¿Cómo funciona?".
  "Alojamientos" y "Cómo funciona" dejan de ser destinos del encabezado: los alojamientos se eligen en el selector del mapa
  (y siguen en `/alojamientos` y en el pie), y "¿Cómo funciona?" abre un diálogo modal nativo (`<dialog>`: foco atrapado,
  Escape, foco de vuelta al botón). El mismo contenido tiene dirección propia en `/como-funciona`. `/buscar-trabajador`
  redirige a `/trabajadores` llevando solo `q` y `oficio`.
- **Selector de tipo** (Profesionales | Alojamientos) sobre el mapa: cambia a la vez resultados, marcadores, filtros y tarjetas.
  Los alojamientos se piden recién cuando la persona los elige.
- **Filtros**: Categoría → Subcategoría (los servicios de esa categoría) para profesionales; Tipo y Personas para alojamientos.
  Todas las listas salen del catálogo del backend; nada está escrito en la Web.
- **Dirección compartible**: el estado del mapa vive en la URL (`?categoria=&servicio=&zona=` o
  `?tipo=alojamientos&alojamiento=&personas=`) sin sumar entradas al historial. La URL es entrada no confiable: solo se leen
  claves conocidas, con forma fija, y contra el catálogo; lo demás se descarta.
- **Tarjetas y popup compactos**: foto o iniciales, nombre, servicios, zona aproximada, disponibilidad y la calificación real
  (o nada: nunca una valoración inventada). En pantallas chicas el elemento elegido se abre en una hoja inferior en lugar del
  popup.
- **Responsive** de 320 a 1920 px: el mapa sigue al viewport visible (`dvh`, con `vh` de respaldo), el logo escala, y Leaflet
  vuelve a medirse solo cuando su contenedor cambia de tamaño (un `ResizeObserver`; no hay polling).
- **Lifecycle de Leaflet**: Profesionales y Alojamientos son capas excluyentes del mismo `L.Map`; el selector no destruye el
  mapa. Las operaciones de vista se serializan con `movestart`/`moveend` y la última capa montada reemplaza una operación
  pendiente. En el unmount real se quitan listeners y callbacks propios, y `remove()` espera la ventana de `zoomanim` de
  Leaflet 1.9.4. Solo se usan eventos y métodos públicos; no se accede a estado privado ni se ocultan errores.
- **Rendimiento**: íconos de marcadores memorizados, búsquedas reemplazadas canceladas (`AbortSignal`), agrupamiento propio.
  No hay consulta por recuadro (`bounds`): el mapa trae como máximo 300 perfiles en una sola respuesta y agrupa en el
  navegador; si esa cota deja de alcanzar, el recuadro tiene que validarse en el servidor.
- **Foto de perfil**: ver `fotos_perfil_prestador` en el diccionario de datos. La Web solo dibuja rutas de la API de TUS.

### DIR-09: edición total desde la administración (2026-09-29)

- El admin puede ver y cambiar todo atributo de negocio de un usuario y de un prestador. Nunca edita ni ve secretos: hash de
  contraseña, tokens, secretos MFA/OAuth/Mercado Pago, ids internos, tenant ni auditoría histórica.
- Operaciones seguras en lugar de secretos: cerrar todas las sesiones y forzar cambio de contraseña (cierra sesiones y envía
  el email de recuperación al titular; el admin nunca recibe el token).
- Cambiar el email lo normaliza, exige que sea único (409), lo deja sin confirmar y cierra las sesiones.
- Sin escalada: la autoridad de administrador es la allowlist del servidor (`TUS_PLATFORM_ADMIN_EMAILS`). No se puede asignar un
  email de la allowlist a otra cuenta ni editar email/verificación de una cuenta admin ni de la propia cuenta del admin.
- Prestador: datos públicos, servicios (N:M), cobertura, visibilidad, aprobación (`approved | suspended`) y ubicación. Todo cambio
  sensible pide confirmación en el panel y queda auditado (sin email ni nombre en la metadata).

| Entidad | Editable por el admin | Solo lectura | Nunca expuesto |
|---|---|---|---|
| Usuario | nombre, email, estado, email confirmado (acción), sesiones (cerrar), contraseña (forzar recuperación) | roles derivados (admin por allowlist, prestador por perfil), alta, contraseña configurada sí/no | hash, tokens, MFA, tenant, id interno |
| Prestador | nombre público, descripción, años, servicios y principal, zona principal, zonas de cobertura, modalidad, radio, visible, aprobación, pin/privacidad | cuenta titular (se edita en Usuario), asociación geográfica calculada | tenant, prestador_id, id del perfil, tokens de Mercado Pago |
| Categoría | nombre, descripción, orden, activa | servicios y conteos | borrado físico (no existe) |
| Servicio | nombre, profesión, descripción, ícono, orden, categoría (mover), sinónimos, activo | prestadores que lo ofrecen / en el mapa | id (estable) |
| Zona / Barrio | nombre, polígono (dibujar, mover, borrar), punto de referencia, zona del barrio, orden, activo | conteos | borrado físico (no existe) |

## IDN: identidad por teléfono y WhatsApp (2026-09-30)

**Estado:** implementado y probado en local (API, Web, admin, PostgreSQL 16). Producción pendiente del despliegue.

### IDN-01: una cuenta, una persona, un teléfono

- La cuenta representa a la persona; puede ser cliente, prestador, propietario de alojamiento o lo que venga, con UN
  teléfono de identidad. El teléfono vive en la persona (`"User"."phoneNumber"`), no en un rol ni en un perfil.
- UNIQUE real en PostgreSQL: dos personas no comparten teléfono de identidad (muchos NULL permitidos: las cuentas
  históricas no tienen). Se guarda solo verificado; un número a verificar es `phonePending`.
- El teléfono COMERCIAL que publique un prestador o un alojamiento es otro dato, sin UNIQUE global, y no tiene por qué
  coincidir. No se aplica UNIQUE a teléfonos de contacto (reservas, alojamientos).

### IDN-02: verificación iniciada por el usuario (costo mínimo)

- TUS no manda OTP. Crea un desafío y la Web abre WhatsApp con `VERIFICAR TUS <código>` escrito; la persona toca Enviar.
- El webhook oficial (firma `X-Hub-Signature-256` validada primero) lo reconoce ANTES del asistente, lo verifica contra
  el `wa_id` que informa Meta (nunca un número enviado por la Web) y responde con texto fijo: "✅ Tu número quedó
  verificado correctamente en TUS. Ya podés volver a la aplicación." Sin IA, sin Groq, sin herramientas.
- La respuesta va dentro de la conversación que abrió el usuario; no se usan plantillas de autenticación ni mensajes
  proactivos como flujo principal. El costo final depende de las políticas y precios vigentes de Meta.
- La verificación no depende de la entrega de la respuesta: si Meta falla, el teléfono queda verificado igual y el error
  de transporte se registra en el desafío (`confirmacion_error`) y en la auditoría.

### IDN-03: desafío

- 8 símbolos de un alfabeto sin confusiones (sin 0/O/1/I/L), `crypto.randomInt`: ≈ 39,6 bits. Vence en 10 minutos, se
  guarda solo el hash (el mensaje entrante se almacena como `VERIFICAR TUS ********`), un solo uso (UPDATE condicional),
  uno vivo por cuenta y propósito (un desafío nuevo reemplaza al anterior), 5 envíos desde un número equivocado lo
  invalidan. Propósitos: `verificar_telefono`, `cambiar_telefono`, `recuperar_contrasena`.
- Idempotencia: el mismo mensaje de Meta (`wamid`) reentregado no verifica dos veces ni responde dos veces; un
  procesamiento que se cayó antes de registrar el resultado se completa en el reintento.
- Límites (tabla `auth_rate_limits`): crear 5/15 min por cuenta, 5/h por teléfono, 30/15 min por IP; recuperación
  3/15 min por teléfono. El límite de mensajes entrantes de WhatsApp sigue vigente.

### IDN-04: email y cuentas históricas

- El email no se elimina: login, recuperación por email, Google y los avisos de seguridad siguen igual. Email verificado
  y teléfono verificado son estados distintos que conviven.
- Una cuenta queda verificada por email O por teléfono: con cualquiera de los dos puede ingresar, crear solicitudes y
  darse de alta como prestador. La autoridad de administrador sigue exigiendo email verificado (allowlist + MFA).
- El registro pide el teléfono y muestra la verificación por WhatsApp; "Prefiero verificar por email" sigue disponible.
  El email todavía es obligatorio en el modelo (`"User".email` NOT NULL UNIQUE; login, recuperación y avisos lo usan):
  hacerlo opcional es una fase aparte.
- Cuentas históricas: siguen ingresando; "Mi perfil" les propone verificar el número. Hoy ninguna operación exige
  teléfono verificado. Candidatas para exigirlo cuando haya adopción: publicar el perfil de prestador, cobrar con
  Mercado Pago y operar alojamientos. Los prestadores de prueba creados por el admin quedan exentos.

### IDN-05: ingreso, cambio de número y recuperación

- Ingreso con email o celular + contraseña (mismo limitador y mismo error genérico).
- Cambiar el número: se verifica el nuevo desde SU WhatsApp; el anterior sigue siendo la identidad hasta entonces y
  después queda libre. Un número de otra persona se rechaza al verificar (la transacción se revierte y el desafío queda
  invalidado por `conflicto`) sin revelarlo al crear el desafío.
- Recuperación por WhatsApp: el teléfono se prueba enviando el mensaje y la página recibe UNA vez el token de
  recuperación normal (la misma tabla y el mismo cierre que la recuperación por email: sesiones revocadas, MFA intacto).
  Un teléfono desconocido recibe la misma respuesta.
- Cuenta creada y nunca verificada: `/verificar-telefono` la retoma probando la contraseña.

### IDN-06: administración

- El admin ve el teléfono enmascarado, su fecha y el pendiente, y filtra por verificado / pendiente / sin teléfono.
- Puede cargar un número como PENDIENTE (la persona lo verifica desde WhatsApp) o liberar un teléfono verificado (por
  ejemplo, si el número cambió de dueño). No existe forma de marcarlo como verificado desde el panel. Todo auditado.
- Nunca se muestran códigos, hashes ni números completos en listados.

### IDN-07: pendiente de producción

- `TUS_WHATSAPP_PUBLIC_NUMBER` (número oficial, público) en Hostinger.
- No hay adopción automática de números de contactos de WhatsApp ya vinculados (`contactos_whatsapp`): no existía un
  teléfono de identidad del que copiar y no se eligen ganadores ante duplicados. Si se quisiera, sería una campaña
  consciente con auditoría previa de duplicados.

## Alcance de la Build

Incluido:

- API marketplace y calendario;
- contratos TypeScript y JSON Schema;
- adapters in-memory y Prisma;
- tests focales D2 y D3;
- consumidores Web de discovery, slots, booking y checkout;
- documentación canónica y README.

No incluido:

- migraciones de WEB-08A son aditivas y forward-only; no se hacen resets ni backfills ambiguos;
- migración de rutas y cuerpos legacy del backend; D3 agrega el journey canónico sin retirarlos;
- D1 o reset de base de datos;
- activación de producción, proveedores o jobs;
- traducción breaking de `listingId`, `calendarId` o `serviceId` en payloads existentes.
- agenda, evidencia o cierre de cliente sin una ruta HTTP del agregado Trabajo.

## Evidencia de implementación

- Commit base documental WEB-08: `ba8db98`; WEB-08A agrega el modelo sin modificar providers ni UI.
- Tests Web D3/UX: 34/34 pass; tests D2/marketplace: 20/20 pass; integración catálogo/calendario/UI: 22/22 pass.
- Typechecks contracts/API/Web: pass.
- JSON Schemas: 98 pass, con warnings AJV no bloqueantes.
- Builds Contracts y API: pass. Build Web: compilación, tipos y 16 rutas pass con standalone deshabilitado para evitar symlinks `EPERM` de Windows.
- ESLint focal sobre los archivos TS/TSX modificados: pass.
- Smoke Web: `/`, `/tus/mercado` y `/tus/mercado/listing-smoke` responden HTTP 200 en `localhost:3100`.
- Suite global: no verde por timeout y gates independientes preexistentes; ver `docs/ROADMAP_TUS.md`.
