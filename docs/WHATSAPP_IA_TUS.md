# WhatsApp AI de TUS

## Alcance

El asistente de WhatsApp usa la Cloud API oficial de Meta, persiste conversaciones en PostgreSQL y ejecuta acciones exclusivamente a traves de los servicios de dominio existentes de TUS. El webhook solo valida, persiste y encola; Groq, RAG, tools y respuestas salen del worker.

El asistente no recibe credenciales, no inventa estados de trabajos o pagos y no permite que el modelo elija tenant, cuenta, permisos o montos.

## Variables

Usar `TUS_WHATSAPP_ENABLED=true` solo despues de validar staging. `TUS_ROUTES_ENABLED=true` tambien debe estar activo para montar las rutas TUS.

Variables obligatorias cuando WhatsApp esta activo:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` con al menos 16 caracteres
- `TUS_WEB_BASE_URL` para los links de vinculacion

Variables opcionales:

- `WHATSAPP_GRAPH_API_VERSION` (default `v25.0`)
- `TUS_PLATFORM_ADMIN_TENANT_ID` para el panel de soporte
- `GROQ_API_KEY` (compatibilidad; se usa si no existe ninguna key numerada)
- `GROQ_API_KEY_1` a `GROQ_API_KEY_6` (pool opcional, round-robin; no hace falta configurar dos)
- `GROQ_WHATSAPP_MODEL` (default `openai/gpt-oss-120b`)
- `GROQ_STT_MODEL` (default `whisper-large-v3-turbo`)
- `WHATSAPP_AUDIO_TRANSCRIPTION=true` para audio
- `WHATSAPP_INBOUND_MAX_PER_MINUTE` (default `12`)
- `WHATSAPP_INBOUND_BLOCK_PER_MINUTE` (default `60`)
- `WHATSAPP_DEBOUNCE_MS` (default `1500`)
- `WHATSAPP_AI_MAX_TOOL_CALLS` (default `5`)
- `WHATSAPP_AI_MAX_COMPLETION_TOKENS` (default `600`)
- `WHATSAPP_AI_HISTORY_MESSAGES` (default `12`)
- `WHATSAPP_AI_SUMMARY_THRESHOLD` (default `24`)
- `WHATSAPP_AI_TOOL_TIMEOUT_MS` (default `8000`)

Las keys Groq se seleccionan exclusivamente dentro del adaptador backend. El pool conserva solo
metadata de salud en memoria, respeta `Retry-After`, aplica cooldown temporal y permite como
maximo un fallback por inferencia idempotente. Un `429` sin alcance explicito por credencial
bloquea el pool completo para no intentar evadir una cuota global; solo se hace fallback si el
proveedor declara alcance `key` o `credential`. Ninguna key llega a WhatsApp, RAG, tools, Web,
identity, base de datos o logs.

`WHATSAPP_ENABLED` se conserva como alias local de prueba; despliegues nuevos deben usar `TUS_WHATSAPP_ENABLED`. Si ambos existen deben coincidir.

## Rutas

- `GET /tus/v1/integrations/whatsapp/webhook`: handshake Meta con `hub.verify_token`.
- `POST /tus/v1/integrations/whatsapp/webhook`: firma `X-Hub-Signature-256` sobre los bytes originales.
- `POST /tus/v1/whatsapp/link/preview`: previsualiza un token de vinculacion.
- `POST /tus/v1/whatsapp/link/confirm`: confirma token y ultimos cuatro digitos.
- `GET /tus/v1/admin/whatsapp/conversations`: lista el panel humano, solo tenant plataforma y permiso `tus:whatsapp:support`.
- `GET /tus/v1/admin/whatsapp/conversations/:conversationId`: detalle con identificadores enmascarados.
- `POST /tus/v1/admin/whatsapp/conversations/:conversationId/takeover`: toma la conversacion.
- `POST /tus/v1/admin/whatsapp/conversations/:conversationId/release`: devuelve la conversacion al bot.
- `POST /tus/v1/admin/whatsapp/conversations/:conversationId/reply`: responde dentro de la ventana de 24 horas.
- `POST /tus/v1/admin/whatsapp/conversations/:conversationId/block`: bloquea o desbloquea el contacto.
- `POST /tus/v1/admin/whatsapp/conversations/:conversationId/unlink`: desvincula la cuenta TUS.

La Web administrativa esta en `/tus/admin/whatsapp`.

## Buscar prestadores y solicitar desde WhatsApp

- `search_providers` (público): usa el mismo directorio que "Buscar trabajador" (oficio del catálogo canónico, barrio de
  Corrientes, verificación y trabajos reales). Devuelve hasta 5 prestadores con datos públicos; sin resultados lo dice.
- `request_provider` (contacto vinculado, confirmación explícita): crea la misma solicitud TUS que la Web, dirigida al
  prestador elegido, con `origen = whatsapp`. Queda pendiente hasta que el prestador la acepta en `/prestador/solicitudes`.
- No hay reglas propias de WhatsApp: ambas herramientas delegan en `ServicioDirectorio` y `ServicioSolicitudes`.

### Postulaciones a solicitudes públicas (TUS recomienda, el cliente elige)

- `search_open_requests` (prestador vinculado): solicitudes públicas abiertas del mapa, opcionalmente por oficio y barrio. El
  prestador puede ofrecerse aunque no sea su rubro. Solo datos públicos (título, barrio aproximado, presupuesto, urgencia,
  nombre reducido): nunca contacto, dirección, cuenta ni coordenadas.
- `apply_to_request` (prestador vinculado, confirmación explícita): crea la misma postulación que `/prestador/solicitudes`.
  Postularse no confirma nada; el cliente decide.
- `list_my_open_requests` y `list_request_applicants` (cliente vinculado): sus solicitudes TUS y los postulantes de una
  solicitud propia (perfil público y mensaje). Otra cuenta recibe `NOT_FOUND`.
- `choose_applicant` (cliente vinculado, confirmación explícita): igual que "Aceptar" en Mis solicitudes; confirma con ese
  prestador, saca la solicitud del mapa y rechaza al resto.
- Intención `postulaciones` ("trabajos de electricidad disponibles cerca mío", "¿quién se postuló?"): requiere cuenta
  vinculada; las tools de prestador solo aparecen si la cuenta es prestador.

Las acciones HTTP de WhatsApp (`/tus/v1/whatsapp/actions`) fallan cerradas: el sender debe estar vinculado a una cuenta TUS
activa dentro del tenant y debe existir un `ConsentimientoWhatsApp` persistido en estado `active`. El booleano `consent` de la
request es una confirmación adicional, no reemplaza el consentimiento durable. Un sender sin política, sin vínculo, bloqueado,
o con consentimiento ausente/revocado solo puede terminar en handoff; nunca ejecuta una mutación.

### Procedencia del consentimiento

- `web_linking` se registra dentro de la confirmación Web que vincula el contacto con una cuenta TUS. Es la procedencia explícita
  para habilitar acciones y comunicaciones de la cuenta.
- `whatsapp_inbound` se registra cuando una persona inicia una conversación desde WhatsApp. Es evidencia de consentimiento para
  conversar, no autorización general de marketing ni de mensajes plantilla outbound.
- Un inbound de un contacto todavía no vinculado conserva la evidencia auditable con el `wa_id` enmascarado, pero no inventa un
  `tenantId`. El tenant aparece recién después de la vinculación Web.
- El endpoint administrativo de consentimiento deriva `operator_console`; ignora cualquier `source` enviado por el cliente.
- Los orígenes y el propósito de conversación quedan en la auditoría del asistente y, cuando existe tenant, en
  `ConsentimientoWhatsApp`. Las plantillas outbound requieren consentimiento explícito distinto de `whatsapp_inbound`.

## Worker y ciclo de vida

Con `TUS_WHATSAPP_ENABLED=true` y configuracion valida, `startServer()` crea el worker embebido, procesa leases de `cola_conversacion_whatsapp` y lo detiene mediante `AbortController` durante shutdown. Si la configuracion activa tiene problemas, el arranque falla cerrado.

La cola usa un job por conversacion, debounce, leases de 120 segundos y hasta tres intentos. Un fallo agotado deriva la conversacion a humano.

## Conversación, no formulario (ASISTENTE-CONV-01)

El asistente no pide los datos de a uno con botones. De cada mensaje se toma **todo** lo que trae y
se busca apenas alcanza:

```
MENSAJE -> extracción de datos -> estado de la conversación -> qué falta -> BÚSQUEDA REAL -> respuesta
```

- **Extracción** (`asistente/necesidad.ts`, función pura): oficio (catálogo administrado, con
  tolerancia a errores de tipeo), día, horario, zona, "cualquier zona", si la persona se traslada,
  urgencia y presupuesto. Las fechas relativas (hoy, mañana, pasado mañana, este viernes, el próximo
  lunes, este fin de semana, dd/mm) y los horarios (a las 18, después de las 17, antes de las 12,
  entre las 10 y las 14, a la mañana/mediodía/tarde/noche) se resuelven con el reloj del servidor en
  hora de Argentina. Una hora exacta nunca se convierte en un rango.
- **Estado** (`estado_conversacional.need`): los datos se acumulan entre mensajes y no se vuelven a
  preguntar. Un oficio distinto es una necesidad nueva. Lo dicho hace más de 30 minutos, o para un
  día que ya pasó, no se arrastra.
- **Qué hace falta para buscar**: oficio y día. **La zona nunca es obligatoria**: sin zona se busca
  en todos los prestadores del oficio; "no me importa la zona", "me da igual dónde", "cualquier
  barrio", "voy yo", "me traslado" la dejan indiferente y no se pregunta.
- **Búsqueda real** (`PuertoDominioAsistente.buscarDisponibilidad`): prestadores del directorio
  para el oficio (y la zona, si la hay) con sus turnos libres del día pedido, calculados por el
  mismo generador de agenda con el que se reserva. La duración sale del servicio o de su tarifa; el
  modelo nunca la inventa.
- **Resultado**, sin confundir casos: hay turnos a la hora pedida; no hay a esa hora pero sí cerca
  (se muestran los más cercanos); hay prestadores sin turnos libres ese día; hay prestadores que no
  toman turnos online (se coordina por solicitud); no hay prestadores del oficio. Si la búsqueda
  falla se dice que no se pudo consultar: nunca se reemplaza por una suposición.
- **Elegir**: "el segundo", un nombre o una hora en texto libre eligen entre lo mostrado. Con un
  solo horario posible se prepara la reserva (`book_appointment`, confirmación explícita ligada a la
  cuenta); con varios se pregunta solo la hora. Sin cuenta se ofrece iniciar sesión (Web) o vincular
  (WhatsApp).

El modelo y las reglas se reparten así:

| | Con modelo | Sin modelo (caído o sin clave) |
|---|---|---|
| Mensaje con oficio y día | El backend busca directamente (sin llamada de enrutado). En la Web el modelo redacta la respuesta a partir del resultado; en WhatsApp el backend la arma con los datos reales | El backend busca y arma la respuesta con los datos reales |
| Falta algo | El modelo pregunta SOLO eso, con lo conocido en su contexto. Puede entender lo que las reglas no cubren y pasarlo con `find_appointments` (`when` en texto: el servidor resuelve la fecha) | Pregunta fija, solo sobre lo que falta |

Una respuesta libre del modelo en una búsqueda sin datos de herramienta solo se acepta si es una
pregunta corta sin nombres, números, precios ni disponibilidad; cualquier otra cosa vuelve a las
herramientas. Los botones y tarjetas son atajos: el texto libre siempre hace lo mismo.

WhatsApp recibe exactamente el mismo tipo de mensaje libre y produce la misma consulta que la Web.
La verificación telefónica (`VERIFICAR TUS <código>`) sigue separada: se resuelve antes del
asistente y nunca pasa por el modelo.

## Un turno se solicita, no se confirma (TURNOS-SOLICITUD-01)

Desde la Web, el asistente Web o WhatsApp, el cliente **solicita** un turno; solo el prestador lo
confirma.

- `book_appointment` prepara la solicitud y pide la aceptación del usuario ("¿Querés solicitar ese
  turno?", botón **Solicitar turno**). Al aceptar se crea la reserva en estado `pending` a nombre de la
  cuenta de la sesión (Web) o de la cuenta vinculada (WhatsApp). El asistente no puede reservar a
  nombre de otra persona: `clientName` y `clientPhone` se aceptan por compatibilidad y se ignoran.
- La respuesta es fija, la arma el backend y es igual en los dos canales: "Listo, envié tu solicitud
  de turno para el … Queda pendiente hasta que el prestador la confirme". Nunca "reserva confirmada"
  ni "turno reservado" (regla 13 del prompt; el texto del resultado no pasa por el modelo).
- `list_my_reservations` devuelve los turnos del cliente con su estado real (`appointments`):
  pendiente de confirmación, confirmada, rechazada, cancelada o vencida.
- El prestador responde desde **Solicitudes de reserva** en `/prestador/turnos` (Aceptar / Rechazar).
  Avisos: la solicitud aparece en ese panel y, si el envío de emails de TUS está configurado
  (`EMAIL_PROVIDER=resend`), el prestador recibe un email al llegar una solicitud y el cliente otro
  cuando se responde. **No hay todavía aviso proactivo por WhatsApp al prestador**: fuera de la
  ventana de 24 h Meta exige una plantilla aprobada y TUS no tiene un envío proactivo implementado.

## Canal Web: el mismo asistente (ASISTENTE-WEB-01)

El asistente de la Web (`/asistente` y la ventana flotante) no es otro asistente: es un **canal** del mismo `OrquestadorConversacion`. Modelo, herramientas (`herramientas.ts`), base de conocimiento (`RecuperadorConocimiento`), confirmaciones, memoria (`conversaciones_whatsapp` / `mensajes_conversacion_whatsapp`, con `canal = 'web'`) y permisos son el mismo codigo. Lo unico propio del canal vive en `asistente/web.ts` (quien habla, guardar el mensaje, devolver la respuesta en vez de enviarla por Meta) y en `CanalTurno`.

```text
Web -> POST /tus/v1/asistente/mensajes -> ServicioAsistenteWeb -> OrquestadorConversacion.responder()
    -> modelo (enruta y conversa) -> RAG / herramientas -> servicios de dominio / PostgreSQL -> modelo -> respuesta
```

| | WhatsApp | Web |
| --- | --- | --- |
| Identidad | numero vinculado a una cuenta (link de un solo uso) | sesion de la peticion (cookie HttpOnly); sin sesion: visitante con herramientas publicas |
| Enrutado de la intencion | patrones (por defecto; `WHATSAPP_AI_ROUTING=model` lo pasa al modelo) | siempre el modelo (`PROMPT_ENRUTADOR`); los patrones solo son respaldo si esa llamada falla |
| Resultados de busqueda y turnos | texto armado por el backend (`conversacional: false`) | el modelo redacta a partir del resultado de la herramienta; los datos reales viajan como adjunto (`providers`, `slots`, `sources`) armado por el backend |
| Area privada sin cuenta | link de vinculacion | el modelo explica que hay que iniciar sesion (sin herramientas privadas) + adjunto `sign_in` |
| Confirmaciones | botones de WhatsApp | botones `reply` con el mismo `confirm:<id>`; ligadas a conversacion + cuenta |
| Entrega | cola + worker + Meta | respuesta HTTP (JSON o NDJSON con el progreso real: enrutado, conocimiento, cada herramienta) |
| Modelo caido | texto fijo | pregunta sobre TUS: ayuda extractiva (`ServicioAyudaPublica`) marcada `fallback`; el resto: texto fijo, sin datos |
| Operador humano | no hay | no hay; las conversaciones Web no aparecen en la bandeja de soporte |

Rutas del canal Web (sesion opcional; `visitorId` es un id aleatorio del navegador, nunca una identidad):

| Metodo | Ruta | Uso |
| --- | --- | --- |
| POST | `/tus/v1/asistente/mensajes` | `{ text }` o `{ replyId }` (+ `visitorId`). `Accept: application/x-ndjson` transmite `accepted`, `activity`, `message`, `done`. Campos desconocidos: 422. |
| GET | `/tus/v1/asistente/historial` | mensajes de la conversacion activa |
| POST | `/tus/v1/asistente/reiniciar` | cierra la conversacion (memoria nueva) |

Limites: 12 mensajes por minuto por conversacion (`WHATSAPP_INBOUND_MAX_PER_MINUTE`) y 30 por minuto por IP. No hay streaming token a token: el orquestador valida el texto del modelo antes de liberarlo. Al iniciar sesion, la conversacion que la persona tenia como visitante pasa a su cuenta.

Tests: `tests/foundation/tus-asistente-web.test.mjs`.

## Migracion

`20261020100000_tus_asistente_canal_web` agrega `canal` a `contactos_whatsapp` y `conversaciones_whatsapp` (las filas existentes son `whatsapp`).

La migracion aditiva es `apps/api/prisma/migrations/20260928100000_tus_whatsapp_assistant`. Reutiliza `RagEmbedding.vector vector(1024)` y no crea otra base vectorial. Aplicar con `pnpm --filter @factory/api prisma:migrate:deploy` solo en un entorno controlado.

## Validacion local

```text
pnpm test -- tests/foundation/whatsapp-webhook.test.mjs
pnpm test -- tests/foundation/whatsapp-asistente.test.mjs
pnpm test -- tests/foundation/whatsapp-rag.test.mjs
pnpm --filter @factory/api typecheck
pnpm --filter @factory/web typecheck
```

Estos tests usan proveedores fake y no prueban una cuenta Meta o Groq real.
