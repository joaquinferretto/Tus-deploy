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
- `WHATSAPP_AUDIO_TRANSCRIPTION=true` para audio (ver "Audios, comprobantes y verificación de pagos")
- `WHATSAPP_STT_MAX_BYTES` (default `16777216`, 1 KiB a 25 MiB), `WHATSAPP_STT_TIMEOUT_MS` (default `30000`),
  `WHATSAPP_STT_MAX_SECONDS` (default `180`) y `WHATSAPP_STT_MIME_TYPES` (default `audio/ogg,audio/mpeg,audio/mp4`;
  solo se aceptan formatos que Whisper admite sin conversión). El proveedor es siempre Groq y el modelo `GROQ_STT_MODEL`.
- `WHATSAPP_MEDIA_MAX_PER_HOUR` (default `20`): audios, imágenes y documentos por contacto y hora
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
- **La hora, dicha como sea** (ASISTENTE-HORA-01): los minutos se leen en cualquiera de sus formas
  (`9:30`, `09:30`, `9.30`, `9 y 30`, `9 y media`, `nueve y media`, `9 y cuarto`); "a las 9 y 30"
  nunca termina en 09:00. Mientras la conversación espera la hora de UN profesional
  (`offers.esperaHora`, tras "¿A qué hora con …?"), un número o frase suelta es una hora (`10` →
  10:00, `930` → 09:30) que el backend normaliza y valida contra los horarios reales de ese
  profesional; fuera de ese paso, `1`, `2`, `3` siguen eligiendo profesional. "y cuarto" es un
  cuarto de hora, nunca el cuarto profesional. Si la hora no existe en su agenda o no se entiende,
  se responden sus horarios reales ("No entendí la hora. … tiene: …"), no el error genérico, y la
  intención sigue siendo `reserva`. Nada de esto pasa por el modelo.
- **De la elección a la solicitud** (TURNOS-SENA-01): elegido el profesional y el horario, el backend
  lleva los pasos que faltan, sin modelo y en ambos canales:
  1. **Servicio**: si el profesional tiene varias variantes (`tarifas_servicio_prestador`) pregunta cuál,
     con el precio real de cada una; se elige por número, ordinal o nombre. Con una sola (o ninguna) no
     pregunta. Una variante inventada por el modelo no se acepta.
  2. **Cliente**: en la Web es la sesión (sin sesión, "iniciar sesión / crear cuenta" con retorno al mismo
     profesional, servicio y horario). En WhatsApp pide nombre completo y DNI; `ServicioIdentificacionCliente`
     normaliza el DNI, busca la cuenta por documento y exige que el nombre sea el de esa persona. No
     encontrada, DNI de otra persona o nombre distinto reciben la misma respuesta y el link real de
     registro (`/registro?returnTo=…`); cinco fallos por hora bloquean la verificación en esa conversación.
     La cuenta queda en `conversaciones_whatsapp.cuenta_identificada_id` (24 h); el DNI no se guarda en el
     mensaje, no va al modelo ni a la auditoría. Identificarse no vincula el WhatsApp: solo habilita
     solicitar el turno y pagar su seña; el resto de las herramientas privadas sigue pidiendo vincular.
  3. **Resumen**: prestador, servicio, fecha, horario, precio y seña (calculados por el backend) con los
     botones "Sí, solicitar turno" / "No". El "sí" crea la solicitud `pending`.
  4. **Después**: cuando el prestador acepta, el cliente recibe por WhatsApp (si su ventana de 24 h de
     Meta sigue abierta; si no, email y "Mis turnos") el aviso con el link real de Checkout Pro de la
     seña. "Quiero pagar la seña" devuelve ese link en cualquier momento. Cuando Mercado Pago aprueba el
     pago llega "¡Tu turno quedó confirmado!". Ningún texto dice "confirmado" antes de eso.
  Ningún identificador interno (cuenta, prestador, tarifa, reserva, trabajo) se escribe en una respuesta:
  las tarjetas se arman con nombres y los textos del modelo se filtran (`sinIdentificadores`).

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

### Contexto entre mensajes cortos (ASISTENTE-CONTEXTO-01)

Los mensajes seguidos ("El lunes" · "Lo antes posible" · "Con cualquiera") son UNA necesidad: cada
uno cambia solo lo que dice y el backend actúa sobre el estado estructurado, sin volver a preguntar
lo ya dicho. Todo sale de la búsqueda real; nada se solicita sin el "sí" explícito.

- **Lo antes posible** (`need.asap`): "lo antes posible", "cuanto antes", "apenas haya", "el día más
  próximo", "la primera que tenga", "ahora", "ya mismo", "urgente". No fija día: la búsqueda empieza en
  el día conocido (hoy, desde la hora actual, si no hay uno) y avanza día por día, con la misma consulta
  al backend, hasta encontrar un turno libre que respete el horario pedido (máximo 14 días). Si hoy no
  hay, se dice: "Hoy no hay turnos libres. La primera disponibilidad … es mañana: …". Ya no existe el
  bucle "sin turnos libres hoy. ¿Querés que busque otro día?" ante "lo antes posible".
- **Cualquiera disponible** (`need.anyProvider`): "cualquiera", "la que sea", "me da igual quién", "no
  importa quién", "el que esté disponible", "asignáme una", "mandame cualquiera". Mantiene servicio,
  día y horario y el backend propone UNA opción concreta, el primer inicio real que cumple: "La primera
  opción que encontré es mañana a las 09:00 con Melina. ¿Querés esa?". "Sí" prepara la tarjeta de
  solicitud (servicio, cliente y confirmación como siempre); "no" la descarta y conserva la necesidad.
  "Me da igual dónde" sigue siendo la zona, no el profesional.
- **Profesional por nombre o posición**: "Melina", "con Melina", "melna" (un error de tipeo sobre un
  nombre listado, solo si coincide con UNA), "la segunda", "la otra" / "no esa, la otra" se resuelven
  contra la lista que el backend mostró (`state.shown`). "Melina ya mismo" toma su primer horario real
  sin volver a listar; "Quiero a Melina mañana" busca la agenda de ella ese día.
- **Precio**: "¿y cuánto sale?", "¿cuánto es el precio?" consultan el precio real
  (`servicioDeTurno`) del servicio en curso para los profesionales listados o el elegido, y dicen cuál no
  tiene precio publicado. No inicia otro flujo ni pide vincular la cuenta.
- **Mensaje ininteligible** ("Ysk", "jsjs"): no se repite la última pregunta; se pregunta algo corto con
  lo conocido ("¿Querés que busque el primer turno libre de Masaje con cualquier profesional?") y un
  "sí" lo ejecuta.
- **Cambios de opinión**: "no mejor el martes", "mañana a la tarde", "después de las 18" cambian solo
  ese dato; la preferencia de profesional se conserva.
- **Disponibilidad que cambió**: antes de preparar la tarjeta se relee el horario elegido en la agenda;
  si ya no está libre se dice y se propone el siguiente real del mismo profesional. Si el "sí" de la
  tarjeta recibe `409 SLOT_OCCUPIED`, no se solicita nada: "Ese horario acaba de ocuparse. Busco el
  siguiente disponible." y se propone el siguiente.

Las propuestas pendientes viven en `estado_conversacional.suggestion` (30 minutos) y nunca son
autoridad: aceptar vuelve a leer la disponibilidad y la solicitud la valida el backend.

Segunda pasada (ASISTENTE-CONTEXTO-02):

- **El horario pedido es un requisito.** Si alguien cumple (hora exacta, "desde", "hasta", rango o parte
  del día), se listan **solo** quienes cumplen; los horarios de otras horas no aparecen bajo "con turno a
  las 09:15". Si nadie cumple, se dice ("No encontré turnos … a las 11:00") y se ofrecen los más cercanos
  reales. La lista recordada (`offers`, `shown`) es la misma que se mostró, así que "la primera" es la
  primera que la persona vio.
- **Tipos de horario separados en el estado**: exacta (`exact`), desde (`from`), hasta (`until`), rango
  (`between`), parte del día (`between` + `part: manana|mediodia|tarde|noche`) y "lo antes posible"
  (`asap`, que no es un horario). Al backend llegan solo los límites.
- **Nombres ambiguos se preguntan**: "melna" o "Melina" con "Melina" y "Melina Martínez" en la lista →
  "¿Con cuál? 2. Melina (Barrio Sur) · 4. Melina Martínez (Centro)". El nombre completo elige. "La de
  Barrio Sur" elige por la zona mostrada. Un profesional nombrado en el mismo mensaje del servicio
  ("una masajista con Melina mañana") se resuelve contra el resultado real.
- **Precio que sigue el tema**: "¿y con Melina?", "¿cuánto me sale con ella?", "¿cuánto sería?", "¿cuánto
  pago?" usan el profesional nombrado, el elegido o el propuesto. "Pagar la seña" sigue siendo otro flujo.
- **Propuestas**: "sí", "dale", "esa", "esa misma" aceptan; "no" descarta y conserva la necesidad; "no,
  mejor la segunda" descarta y elige de la lista mostrada.
- **Mensajes ininteligibles**: solo después de que fallan todas las lecturas (servicio, profesional,
  zona, día, hora, sí/no, número u ordinal, precio, otra área) y únicamente si las palabras tienen forma de
  error de tipeo (sin vocales, corridas de teclado como "asd"/"qwe", una tecla repetida). "Barrio Ponce",
  "Santa Ana" o "Rosa" siguen el flujo normal. La aclaración ofrece lo conocido ("Si querés, sigo buscando
  turnos de Masaje mañana.") y un "sí" vuelve a buscar exactamente eso.
- **Modelo real**: no se probó con Groq en esta pasada (no hay clave configurada en el entorno local). Las
  reglas críticas (disponibilidad, horario, profesional, precio, identidad, reserva, pago) no dependen del
  modelo.

Tercera pasada (ASISTENTE-CONTEXTO-03, 2026-10-03):

- **"Lo antes posible con Sabrina"** en un solo mensaje: la búsqueda se cortaba el primer día en que CUALQUIER
  profesional tenía turno y recién después filtraba por la nombrada, respondiendo que no tenía turnos en 14 días. Ahora,
  si la nombrada no tiene turno ese día, se busca día por día solo en su agenda y se propone su primer inicio real.
- **Franja después de elegir profesional** ("Melina" → "mejor a la tarde"): antes se perdía y un "cualquiera" posterior
  proponía un turno de la mañana. Ahora la franja (parte del día, desde, hasta, rango) se guarda en la necesidad, se
  muestran los horarios reales de ella y se ofrece buscar quién tiene esa franja ("sí" la busca; "cualquiera" la
  respeta). Una hora exacta que ella no tiene conserva la respuesta anterior ("no tiene turno a esa hora…").
- **"¿Y con otra?"** se entiende como otra profesional de la lista mostrada (si queda más de una, se pregunta cuál,
  numeradas como se mostraron).
- Sin modelo configurado, un "sí" sin propuesta pendiente (por ejemplo, después del aviso de vinculación) cae en la
  respuesta genérica del modelo no disponible; con Groq lo redacta el modelo. No crea ni confirma nada.

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

## Audios, comprobantes y verificación de pagos (TUS-WHATSAPP-MULTIMODAL-01)

Regla de la fase: **la IA interpreta, el backend decide y Mercado Pago certifica el dinero.**

> **Un comprobante enviado por WhatsApp nunca confirma un pago. TUS confirma dinero únicamente mediante el dominio
> financiero y la verificación contra Mercado Pago.** Una imagen, un PDF, un audio, un texto o una afirmación del cliente
> ("ya pagué") nunca marcan un pago como aprobado, nunca confirman un turno, nunca crean una ganancia.

### Qué existía y qué se agregó

Ya existían: el parser de media de Meta (id, mime y sha256), la descarga por Graph API restringida a hosts de Meta, el
transcriptor Groq/Whisper cableado detrás de `WHATSAPP_AUDIO_TRANSCRIPTION` y el orquestador que convertía un audio en texto.
Se agregó: límites configurables, validación del contenido real, duración, confianza del proveedor, fallback correcto,
no repetir una transcripción, límite de media por hora, tipo `document`, y todo el circuito de comprobantes y de
verificación de pagos (el proveedor de pagos no tenía una consulta de pago).

### Audio (notas de voz)

`webhook Meta → mensaje de audio (media id) → worker → descarga (Graph API, tope de bytes mientras se lee) → validación
→ STT (Groq) → texto → el MISMO orquestador que un mensaje escrito`. No hay un asistente paralelo: el texto transcripto
pasa por la misma búsqueda real de disponibilidad, el mismo estado de la conversación ("quiero masaje" y luego un audio
"con Melina mañana a la tarde" conserva el servicio) y las mismas reglas. Los tests prueban paridad exacta audio/texto.

- **Validación (`asistente/audio.ts`)**: nada de lo que declara el remitente o Meta se toma como cierto. Los bytes
  deciden el formato (firma `OggS`, `ftyp`, `ID3`/trama MPEG); aac y amr crudos, aunque sean formatos de WhatsApp, no los
  acepta Whisper y TUS **no convierte** (decisión: sin ffmpeg, sin procesos hijos ni archivos temporales). Tamaño máximo,
  duración máxima (medible en Ogg/Opus, el formato de la nota de voz: granule de la última página sobre 48 kHz menos el
  pre-skip; en otros contenedores solo rige el tamaño) y lista blanca de tipos reales.
- **Efímero**: el audio vive en memoria durante la transcripción y se descarta. Se guarda solo el texto transcripto y
  metadatos mínimos (`media.id`, `mimeType`, `sha256`, `stt: { status, confidence, bytes, seconds }`). Nunca el audio, ni
  base64, ni tokens, en base o logs.
- **Confianza**: solo la que informa el proveedor (`verbose_json` de Whisper: `avg_logprob` y `no_speech_prob`, con los
  umbrales del propio Whisper: silencio si `no_speech_prob > 0.6` y `avg_logprob < -1`; baja si el promedio de
  `avg_logprob < -1`). Si el proveedor no informa nada, no se inventa. Con silencio o confianza baja se pide repetir.
- **Fallos** (formato, tamaño, duración, corrupto, STT caído, timeout, transcripción vacía): *"No pude entender bien ese
  audio. ¿Podés mandármelo otra vez o escribirme el mensaje?"* El motivo queda en una métrica
  (`assistant.audio_failed`) y en `metadata.stt`. Con el STT apagado se mantiene *"Por ahora no puedo escuchar audios..."*.
- **Duplicados**: el `wamid` es único (Meta reentrega: se procesa una vez) y una transcripción ya hecha se reutiliza.
- **Abuso**: además del límite por minuto, `WHATSAPP_MEDIA_MAX_PER_HOUR` corta audios/imágenes/documentos antes de que
  cuesten una descarga, una llamada al STT o una consulta de pago.

### Comprobantes (imagen o documento) y "ya pagué"

Un comprobante es **solo una pista de que la persona dice haber pagado**. TUS **no descarga, no lee, no hace OCR ni envía a
ningún proveedor de IA** la imagen o el PDF (decisión de privacidad: pueden traer nombre, DNI/CUIL, CBU/CVU). De la imagen
se guarda únicamente el identificador de Meta, el tipo y su hash. Lo que sí se usa es el texto que la acompaña, igual que
cualquier mensaje. Nada de lo que diga o contenga el comprobante se usa como dato financiero: no hay `payment_id`,
monto, fecha ni referencia extraídos (la extracción local queda como evolución posible; si se hiciera, serían siempre
`user_supplied_untrusted_evidence`).

La correlación sale de **referencias internas**, no del comprobante: la cuenta vinculada (o identificada por nombre + DNI,
como en el pago de la seña) → sus propios turnos próximos con seña pendiente (`senasVerificables`) → la intención de pago
de ese turno. Con una sola seña pendiente se verifica esa; con varias se pregunta cuál ("la de Melina"); si no hay ninguna,
*"Recibí el comprobante, pero todavía no pude relacionarlo con un pago confirmado de Mercado Pago."* Una foto sin palabras,
sin seña pendiente y sin un link de pago reciente conserva su respuesta de siempre (se guarda para el equipo).

### Verificación real del pago

`herramienta/orquestador → turnos (verificarPagoSena) → finanzas (verificarPagoDelTrabajo)`:

1. Solo el **cliente del trabajo** pregunta por **su** pago (otro cliente o el prestador reciben 404).
2. Se toma la intención (la última con checkout) y su **modo congelado** (`split` / `plataforma`).
3. Se consulta a Mercado Pago **por la referencia interna** (`external_reference` = id de pago de TUS, nunca un valor
   escrito por la persona) con la cuenta que debió cobrar (la de TUS para `plataforma`, la del prestador para `split`):
   `GET /v1/payments/search?external_reference=…`. Cada resultado se normaliza con la MISMA función que el webhook
   (que además rechaza un cobrador distinto).
4. Cada pago se aplica por **`aplicarEventoVerificado`**, la misma máquina de estados del webhook (collector, modo,
   referencia, moneda, importe, comisión de marketplace, transiciones, inbox, confirmación del turno, ganancia). Es el
   único lugar donde el dinero cambia de estado.
5. Se audita (`payment.queried_by_customer`; en el asistente `assistant.payment_checked`).

Resultados: `approved` (Mercado Pago lo informó aprobado **y** todas las validaciones del webhook lo aceptaron, o ya estaba
aplicado), `pending`, `not_approved` (rechazado/cancelado/expirado), `quarantined` (importe, moneda, modo… no coinciden: no
se aplica), `not_found` y `unavailable`. Respuestas: *"Sí, Mercado Pago confirmó tu seña de $15.000. Tu turno con Melina
quedó confirmado."* / *"Encontré el pago, pero Mercado Pago todavía lo muestra pendiente…"* / *"Todavía no encuentro un pago
acreditado para esa seña…"* / *"Recibí el comprobante, pero no pude confirmar ese pago en Mercado Pago…"*. Nunca se
acusa de fraude ni se dice "el comprobante parece válido".

**El webhook sigue siendo el camino principal**; la consulta es una reconciliación adicional. Si Mercado Pago ya aprobó y el
webhook no llegó, la consulta aplica; el webhook que llega después es un no-op (`stale`/`no_op`): una aprobación, una
confirmación, una ganancia (índices únicos del ledger y estado de la intención). Probado en PostgreSQL con webhook antes,
después, duplicado y concurrente con tres consultas simultáneas. Con Split 1:1 no se crea ganancia.

### Herramientas del asistente (modelo)

`get_pending_payments` (señas pendientes o ya acreditadas del cliente vinculado) y `verify_payment_status` (exactamente uno de
`ref` —seña de un turno— o `workId` —seña o saldo de un trabajo del cliente—): solo **piden** al backend, que usa el mismo
dominio financiero (`verificarPagoDelTrabajo`); el modelo no recibe tokens ni credenciales y no puede decidir el resultado. El camino determinístico
(la conversación) no pasa por el modelo.

### Límites de la consulta de pagos

Por conversación: 15 s entre consultas a Mercado Pago y 6 por hora (el estado de ritmo vive en el estado de la conversación,
no es autoridad). Una conversación nunca puede consultar pagos arbitrarios: no existe consulta por un id escrito por la
persona.

### Persistencia

Sin tablas ni migraciones nuevas. Claves JSON nuevas: `mensajes.metadata.media.sha256`, `mensajes.metadata.stt`,
`conversaciones.estado.paymentCheck` (ritmo y elección entre señas; sin montos ni estados) y acciones de auditoría
`assistant.payment_checked` y `payment.queried_by_customer`.

### Qué no está verificado contra el proveedor real

Todo se probó contra dobles offline en el borde de `fetch` y de los puertos: **NO VERIFICADO CONTRA PROVEEDOR REAL** — Groq
Whisper (`verbose_json`, campos de segmentos), la búsqueda de pagos de Mercado Pago (`/v1/payments/search` por
`external_reference`) y la descarga de media de Meta. Antes de habilitar en producción hay que probar en sandbox/un número
de prueba y confirmar con Mercado Pago que la búsqueda por `external_reference` está disponible para la aplicación.

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
