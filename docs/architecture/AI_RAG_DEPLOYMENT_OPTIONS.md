# Opciones de despliegue de IA y RAG en TUS

Estado al 2026-09-27. Documento de decisión: describe cómo está hoy, qué fronteras existen para separar servicios más
adelante y cuándo conviene hacerlo. No propone separar por moda: la separación se justifica por volumen, aislamiento de
fallas o costo, no por preferencia de arquitectura.

## 1. Estado actual (monolito modular)

```text
Web (Vercel) ──HTTP──► API TUS (Hostinger, Node/Express) ──Prisma/pg──► PostgreSQL 16 (Supabase) + pgvector
                         │
                         ├─ Asistente (apps/api/src/tus/asistente): orquestador, tools, RAG, ayuda Web
                         ├─ Worker WhatsApp embebido (solo con TUS_WHATSAPP_ENABLED=true)
                         └─ Groq (chat/STT) y proveedor de embeddings opcional: HTTP saliente con timeout
```

Reglas que ya se cumplen y deben mantenerse en cualquier opción futura:

- **La IA no accede a la base.** El modelo solo pide tools; `validarYEjecutar` valida schema estricto, audiencia
  (`public` / `linked` / `provider`), confirmación y timeout, y ejecuta a través de `PuertoDominioAsistente`, que delega
  en los mismos servicios de dominio que la Web (`ServicioDirectorio`, `ServicioSolicitudes`, marketplace, trabajos,
  finanzas, identidad). Tenant, actor y permisos salen de la sesión o de la cuenta vinculada, nunca del modelo.
- **RAG es conocimiento, no datos vivos.** El índice solo contiene `docs/conocimiento/**` (allowlist con front matter,
  visibilidad y checksum). Estados de trabajos, pagos, disponibilidad o prestadores salen siempre de tools.
- **Dependencias opcionales no bloquean la API.** `/ready` exige PostgreSQL y el esquema; Groq, embeddings y el índice de
  conocimiento no forman parte de la readiness. Sin Groq, WhatsApp deriva a humano; sin índice, la ayuda Web responde
  `unavailable` / "no tengo suficiente información" y el directorio, el mapa, el login, las solicitudes y los trabajos
  siguen funcionando.
- **La ayuda Web es extractiva** (`POST /tus/v1/asistente/ayuda`): devuelve fragmentos públicos autorizados, sin LLM, así
  que no puede inventar ni depende de un proveedor externo.

Fronteras internas que permiten extraer servicios sin reescribir el dominio:

| Frontera                     | Interfaz                                                       | Implementaciones hoy                                   |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| Recuperación de conocimiento | `PuertoIndiceConocimiento`, `RecuperadorConocimiento`          | `IndiceConocimientoPrisma` (FTS + pgvector), memoria   |
| Embeddings                   | `EmbeddingProvider`                                            | `openai-compatible` (HTTPS), `local-hash` (solo dev)   |
| Modelo conversacional        | `ProveedorChat` (Groq con pool de credenciales)                | Groq, fake en tests                                    |
| Acciones de negocio          | `PuertoDominioAsistente`                                       | `DominioAsistenteTus` sobre la aplicación TUS          |
| Conversaciones y cola        | `PuertoTransaccionAsistente`, `RepositoriosAsistente`          | PostgreSQL (Serializable + retry), memoria             |
| Ayuda pública                | `ServicioAyudaPublica` (+ `RecuperadorAyuda`)                  | Mismo recuperador, visibilidad `public`                |

Ninguna de estas interfaces depende de Express ni de la Web; la Web no importa código del backend.

## 2. Opciones

### Opción A — API + IA/RAG juntos, worker separado cuando haga falta

La API sigue conteniendo el asistente y el índice; el worker de WhatsApp pasa a un proceso propio (misma imagen, otro
entrypoint) cuando el volumen de conversaciones lo pida.

- Resiliencia: una falla de Groq ya está aislada por timeouts, circuit breaking del pool y handoff; el índice vive en la
  misma base. Un proceso de worker separado evita que un pico de WhatsApp afecte la latencia de la Web.
- Costo: el más bajo (un runtime + la base existente).
- Complejidad y despliegue: mínimos; un solo artefacto, migraciones automáticas en el deploy de Hostinger.
- Latencia: sin saltos de red internos.
- Seguridad: sin credenciales entre servicios.
- Escalabilidad: suficiente para el volumen actual (un corpus de decenas de documentos, directorio y solicitudes de una
  ciudad).

### Opción B — API core, servicio IA/RAG y worker

```text
Web ─► API core ◄─tools autorizadas─ Servicio IA/RAG ─► Groq / embeddings
                                        │
Worker (cola WhatsApp) ─► Servicio IA/RAG
```

- Resiliencia: una caída del servicio IA/RAG no toca la API; la API caída no deja que la IA invente datos vivos (las
  tools fallan cerradas y el asistente dice que las operaciones no están disponibles).
- Costo: dos o tres runtimes; embeddings y reindexación pueden correr lejos del request path.
- Complejidad: contrato HTTP interno, credenciales de servicio, observabilidad distribuida.
- Latencia: un salto más por turno (tool → API).
- Seguridad: requiere autenticación entre servicios (token de servicio rotado o mTLS y ACL de red); el servicio IA
  nunca recibe `DATABASE_URL` de la base de negocio.

### Opción C — API, orquestación IA, RAG y worker separados

Máximo aislamiento (el RAG escala e indexa por su cuenta), a costa de más superficie operativa, más latencia y más
contratos que versionar. Solo se justifica con un corpus grande, múltiples canales de alto volumen o equipos separados.

## 3. Recomendación

**Opción A hoy.** El volumen real (una ciudad, corpus chico, WhatsApp todavía detrás de flag) no justifica saltos de red
ni credenciales entre servicios, y las fronteras de la sección 1 ya permiten extraer cualquier pieza sin tocar el
dominio. Pasos concretos, en orden, cuando aparezca la necesidad:

1. Worker de WhatsApp en proceso propio (mismo repo, otro entrypoint) cuando la cola afecte la latencia de la API.
2. Reindexación y embeddings masivos como job del worker, fuera del request (hoy corre en el deploy de Hostinger, de
   forma idempotente y opcional).
3. Recién con carga sostenida o requisitos de aislamiento: Opción B.

## 4. Contrato conceptual si se separa el RAG (no implementado)

- `POST /retrieve` `{ query, actor: { linked, isProvider } }` → `{ confidence, strategy, results[] }` (filtrado por
  visibilidad ANTES de recuperar, mismo criterio que `filtroParaActor`).
- `POST /embed` `{ texts[] }` → `{ vectors[] }` (solo para la reindexación).
- `GET /health` → `{ status: healthy | degraded | unavailable, index: { documents, chunks, lastIndexedAt } }`.

Autenticación entre servicios: token de servicio de corta vida o mTLS, red privada, sin exponer el servicio a Internet.
Sin dependencias circulares: Web → API; Web → gateway IA opcional; IA → API solo mediante tools autorizadas; IA → RAG;
Worker → API/DB según contrato.

## 5. Limitaciones conocidas

- Sin proveedor de embeddings configurado (`RAG_EMBEDDING_PROVIDER=none`), el retrieval productivo es léxico (FTS en
  español + configuración `simple` para términos que el diccionario descarta, como "TUS"). Es suficiente para el corpus
  actual y está cubierto por la evaluación (`docs/rag/EVALUACION_CONOCIMIENTO_TUS.md`); un proveedor de embeddings suma
  recuperación semántica sin cambiar contratos.
- Groq no ofrece embeddings en esta integración; el proveedor de embeddings es independiente del de chat.
- WhatsApp, Mercado Pago y Nosis siguen detrás de sus flags y gates; activarlos requiere credenciales reales.
