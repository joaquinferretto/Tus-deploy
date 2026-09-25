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

## Worker y ciclo de vida

Con `TUS_WHATSAPP_ENABLED=true` y configuracion valida, `startServer()` crea el worker embebido, procesa leases de `cola_conversacion_whatsapp` y lo detiene mediante `AbortController` durante shutdown. Si la configuracion activa tiene problemas, el arranque falla cerrado.

La cola usa un job por conversacion, debounce, leases de 120 segundos y hasta tres intentos. Un fallo agotado deriva la conversacion a humano.

## Migracion

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
