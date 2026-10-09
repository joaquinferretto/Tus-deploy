# Turnos de servicios: de la solicitud a la confirmación, por WhatsApp y Web

Qué pasa después de "Solicitud enviada". Documento canónico del flujo de turnos de prestadores.
Las reservas de alojamientos son otro dominio, con reglas propias (`docs/ALOJAMIENTOS_TUS.md`), y
no se tocan acá.

## Recorrido

```
cliente solicita (WhatsApp o Web)
  → reserva `pending` en PostgreSQL, retiene su horario
  → aviso al prestador por WhatsApp, con Aceptar / Rechazar
  → respuesta del prestador (WhatsApp o panel): el MISMO caso de uso
      rechaza → `rejected`, aviso al cliente, horario libre, sin cobro
      acepta  → `awaiting_payment`, aviso al cliente con el link de la seña
  → el cliente paga en Mercado Pago
  → notificación firmada de Mercado Pago (o verificación server-side)
  → `confirmed`, una sola vez
  → aviso de confirmación a cliente y prestador
```

PostgreSQL es la fuente de verdad: WhatsApp y la Web leen y cambian ese estado, no tienen otro.

## Estados (los que ya existían)

| Estado | Significado |
| --- | --- |
| `pending` | Solicitud esperando al prestador; retiene el horario; vence a las 24 h o al inicio |
| `awaiting_payment` | Aceptada; falta la seña; retiene el horario mientras dura la ventana de pago |
| `confirmed` | Seña verificada (o turno sin nada que pagar) |
| `rejected` | El prestador la rechazó, o al aceptarla el horario ya no estaba libre |
| `expired` | Venció sin respuesta o sin pago |
| `cancelled` / `cancelled-late` / `no-show` / `completed` | Vida posterior del turno |

## Qué existía y qué se agregó (auditoría del 2026-10-06)

| Paso | Antes | Ahora |
| --- | --- | --- |
| Crear la solicitud | Real: `ServicioTurnos.solicitarTurno`, `pending`, cliente = cuenta de la sesión | Igual |
| Avisar al prestador | Real, pero un texto sin datos de precio que mandaba a "Solicitudes de reserva" | Mensaje con cliente, servicio, fecha, hora, precio, seña, observación y fotos, y botones Aceptar / Rechazar |
| Responder desde WhatsApp | No existía | Botón o palabra → `aceptarSolicitud` / `rechazarSolicitud`, los mismos del panel |
| Fuera de la ventana de 24 h | No se enviaba nada | Plantilla `turno_solicitud_recibida`, solo si está aprobada |
| Fotos de la solicitud | No existían para turnos | Hasta 2, por API, Web y WhatsApp |
| Auditoría de la respuesta | No había | `turnos.solicitud_respondida` con actor, canal y transición |
| Seña al aceptar | Real: obligación, intención y preferencia de Mercado Pago | Igual |
| Confirmación por pago | Real: notificación firmada, idempotente | Igual |
| Aviso de confirmación | Solo si confirmaba la notificación | También si confirma la verificación a pedido ("ya pagué", Web) |

## Aviso al prestador

Destinatario: la cuenta vinculada al prestador (`prestadores.cuenta_id`), y los WhatsApp
vinculados a esa cuenta. Un prestador sin cuenta vinculada no recibe el aviso. Nunca por nombre ni por un dato de la solicitud.

- **Dentro de las 24 horas** desde su último mensaje: mensaje interactivo de WhatsApp con dos
  botones de respuesta, y las fotos de la solicitud a continuación.
- **Fuera de esa ventana**: Meta solo permite una plantilla aprobada. TUS envía
  `turno_solicitud_recibida` si figura en `WHATSAPP_APPROVED_TEMPLATES`; si no, no envía nada por
  WhatsApp (quedan el email y el panel). Una plantilla no aprobada no se envía nunca.

Cada botón lleva `turno:aceptar:<id>` o `turno:rechazar:<id>`: qué solicitud y qué respuesta. No
dice quién responde.

## Responder desde WhatsApp

1. Quién responde es la cuenta vinculada a ese número, y tiene que ser LA cuenta de ese
   prestador (`prestadores.cuenta_id`) y un prestador aprobado. Un
   número sin vínculo, un cliente o un prestador suspendido no pueden responder.
2. Se llama al mismo caso de uso que usa el panel, con el tenant de esa cuenta. Una solicitud de
   otra agenda responde "no encontré esa solicitud".
3. Con la agenda tomada se vuelve a leer: que siga `pending`, que no esté vencida, que el horario
   siga libre (ni otro turno ni una ausencia). Si ya no está libre queda `rejected`.
4. La transición, el aviso al cliente (outbox) y la auditoría se escriben en la misma transacción.

También sirve escribir "aceptar" o "rechazar" si hay una sola solicitud esperando; con más de una,
TUS pide usar los botones y no adivina.

**Idempotencia:** tocar dos veces, un mensaje que Meta entrega dos veces, o responder a la vez por
WhatsApp y por el panel dan una sola transición, una línea de auditoría y un aviso. Rechazar algo
ya aceptado, o aceptar algo ya rechazado, no cambia nada.

## Seña y pago

- La seña es la mitad del precio y la calcula el backend. No existe obligación de pago mientras la
  solicitud está `pending`: pagar antes de la aceptación responde `DEPOSIT_NOT_PAYABLE`.
- Al aceptar se crea la cadena `reserva → trabajo → obligación → intención de pago → preferencia`,
  con la referencia externa de TUS. El cliente recibe un botón "Pagar seña" con ese checkout.
- Solo confirma un pago aprobado que Mercado Pago informa para esa referencia, con el importe y
  la moneda que TUS espera. Abrir el link, decir "ya pagué" o mandar un comprobante no confirma.
- Notificaciones: firma verificada; repetidas, simultáneas o fuera de orden dan una confirmación y
  un solo movimiento en el libro de ganancias. Un pago en proceso no confirma. Un pago que llega
  con el turno vencido o cancelado no lo confirma.

### Quién cobra la seña y por qué puede no cobrarse

El prestador **no necesita** conectar su Mercado Pago. Si no tiene cuenta conectada, TUS cobra la
seña con la cuenta de la plataforma y la parte del prestador queda en su saldo (Pagos y
ganancias). Con cuenta conectada se cobra con la suya.

Admin → Prestadores muestra el estado de cada uno en "Cobro de señas", sin intentar nada:

| Estado | Qué falta |
| --- | --- |
| Por plataforma / Con su cuenta | Nada: aceptar pasa el turno a esperando seña |
| Pagos apagados | El interruptor de pagos de la plataforma (los turnos se confirman sin seña) |
| Mercado Pago sin configurar | Las credenciales de Mercado Pago de TUS en el servidor |
| Falta habilitación | La habilitación productiva de pagos de servicios (`MERCADO_PAGO_ENVIRONMENT=production`) |
| Falta identidad | Que el prestador tenga la identidad verificada |
| Falta cuenta de TUS | `MERCADO_PAGO_PLATFORM_ACCESS_TOKEN` y `MERCADO_PAGO_PLATFORM_USER_ID` |

Al aceptar, el prestador recibe el motivo que le corresponde: `SERVICE_PAYMENTS_NOT_AUTHORIZED`
o `PROVIDER_PAYMENT_ACCOUNT_REQUIRED` (falta la cuenta de cobro de TUS; no depende del prestador).
Nunca se le pide verificar su identidad ni vincular su Mercado Pago para aceptar.

## Fotos de la solicitud

Hasta dos por solicitud, mientras está `pending`. JPG, PNG o WEBP de hasta 2 MB; el tipo se decide
por el contenido y se quita la metadata. Se guardan en PostgreSQL (`imagenes_reserva`), igual que
las fotos de las solicitudes públicas: el repositorio no tiene un almacenamiento externo de
archivos. Solo las leen el cliente y el prestador de ese turno.

- Web: "Sumar una foto" en Mis turnos; el prestador las ve en Solicitudes de reserva.
- WhatsApp: una foto que manda un cliente con una única solicitud esperando y sin señas por pagar
  se suma a esa solicitud. Con una seña pendiente, una foto se sigue tratando como comprobante.
- API: `POST /tus/v1/cliente/turnos/:id/imagenes`, `GET /tus/v1/turnos/:id/imagenes/:orden`.

## Qué es real, qué está configurado y qué depende de vos

**A. Código terminado en esta rama:** todo el recorrido de arriba.

**B. Configuración (variables del entorno donde corre la API):**

| Variable | Para qué |
| --- | --- |
| `WHATSAPP_ENABLED`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Enviar y recibir por la Cloud API |
| `WHATSAPP_APPROVED_TEMPLATES` | Lista de plantillas aprobadas; agregar `turno_solicitud_recibida` cuando Meta la apruebe |
| `TUS_MERCADOPAGO_ENABLED` y las de Mercado Pago | Cobro de la seña |

**C. Acciones externas:**

1. Crear y hacer aprobar en WhatsApp Manager la plantilla **`turno_solicitud_recibida`**:
   categoría Utilidad, idioma Español (Argentina) `es_AR`, cuerpo
   `{{1}} te solicitó un turno de {{2}} para el {{3}} a las {{4}}. Precio: {{5}}. Seña: {{6}}. ¿Lo aceptás?`
   y dos botones de respuesta rápida, en este orden: `Aceptar`, `Rechazar`. Después, agregar su
   nombre a `WHATSAPP_APPROVED_TEMPLATES`. Sin esto, un prestador que no le escribió a TUS en las
   últimas 24 horas no recibe la solicitud por WhatsApp.
2. Que cada prestador tenga su WhatsApp vinculado a su cuenta (él mismo, o Admin desde la ficha de
   la cuenta). La tabla de Prestadores muestra quién está listo.
3. Habilitación de pagos de servicios en producción y conexión de Mercado Pago del prestador
   cuando corresponda: sin eso aceptar un turno con precio responde que los pagos no están
   habilitados.

## Límites conocidos

- El envío de imágenes sube el archivo a Meta y lo manda como imagen: probado contra el formato de
  la API, no contra Meta real.
- No hay recordatorio al prestador si no responde; la solicitud vence sola.
- Solo el prestador titular responde; no hay respuesta por un colaborador.

## Validación

- `tests/foundation/tus-turnos-whatsapp-postgres.test.mjs`: el recorrido completo y la
  concurrencia sobre PostgreSQL real, con el módulo de pagos real. Meta y Mercado Pago están
  reemplazados solo en el borde de red: no prueba la entrega real ni un cobro real.
- `tests/foundation/tus-turnos-solicitud-postgres.test.mjs`, `tus-turnos-sena-postgres.test.mjs`,
  `tus-whatsapp-comprobantes-postgres.test.mjs`, `tus-asistente-solicitud-sena.test.mjs`.
