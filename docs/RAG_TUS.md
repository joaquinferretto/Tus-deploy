# RAG de conocimiento de TUS

## Corpus

Solo se indexan archivos Markdown bajo `docs/conocimiento/` con front matter completo, idioma `es`, checksum SHA-256 y visibilidad permitida. No se indexan conversaciones, datos de trabajos, pagos, secretos, `.env`, auditorias ni `docs/SEGURIDAD_TUS.md`.

Las visibilidades disponibles son `public`, `authenticated-client`, `authenticated-provider` e `internal-admin`. La ultima nunca se recupera desde WhatsApp. Los documentos de proveedor requieren cuenta vinculada y autoridad de prestador.

## Indexacion

El chunker es determinista (`markdown-headings-v2`), limita fragmentos a 1100 caracteres y reindexa solo cuando cambia contenido, version, embedding o la version del chunker (incluida en el checksum del documento, asi un cambio de fragmentacion reindexa una sola vez). El heading path es `titulo > seccion > subseccion`: un H1 que repite el titulo ya no se duplica. La sustitucion de un documento elimina sus chunks y vectores anteriores en la misma transaccion. Los documentos ausentes se desactivan.

Comandos:

```text
pnpm tus:rag:ingest -- --dry-run
pnpm tus:rag:ingest
pnpm tus:rag:stats
pnpm tus:rag:search -- --query "como funcionan los presupuestos"
pnpm tus:rag:search -- --query "comision de cobros" --linked --provider
pnpm tus:rag:smoke
```

`tus:rag:smoke` es de solo lectura: verifica que el indice tenga documentos activos, que responda preguntas publicas conocidas y que se abstenga ante un dato vivo ("cuanto debo cobrarle a Juan"). Sale con codigo 1 si algo falla.

El despliegue de Hostinger corre `tus:rag:ingest` despues de las migraciones. Es idempotente y opcional: si falla, el deploy sigue y la ayuda queda degradada.

La salida es JSON estructurado y redacta PII. El CLI requiere el `DATABASE_URL` canonico y nunca crea otra base.

## Embeddings

El vector debe tener exactamente 1024 dimensiones para coincidir con PostgreSQL/pgvector.

- `RAG_EMBEDDING_PROVIDER=none`: retrieval lexical solamente.
- `RAG_EMBEDDING_PROVIDER=openai-compatible`: requiere `RAG_EMBEDDING_BASE_URL` HTTPS, `RAG_EMBEDDING_API_KEY` y `RAG_EMBEDDING_MODEL`; opcionalmente `RAG_EMBEDDING_SEND_DIMENSIONS=true`.
- `RAG_EMBEDDING_PROVIDER=local-hash`: solo desarrollo y tests; se rechaza en produccion.

El retrieval productivo combina FTS en espanol y vector por reciprocal-rank fusion. Si no hay evidencia suficiente, el asistente no improvisa y ofrece derivacion humana.

Ranking lexico (igual en memoria y en PostgreSQL): cobertura de terminos + 0,5 x cobertura en titulo/seccion + 1 si la pregunta completa es una frase del titulo o la seccion. Los boosts solo reordenan resultados que ya superan el umbral lexico (0,34): una coincidencia debil no se vuelve confiable. Cada termino cuenta con el diccionario `spanish` o con `simple`, porque "tus" es stopword de `spanish` y sin eso la marca TUS nunca coincidia.

## Ayuda publica de la Web

`POST /tus/v1/asistente/ayuda` (sin sesion) responde preguntas como "como funciona TUS" o "puedo cancelar" con fragmentos `public` del indice: es extractiva, sin LLM, asi que no inventa y funciona aunque Groq este caido. Redacta PII antes de buscar, deduplica por documento (maximo 2) y, si la confianza es baja, el chat dice que no tiene informacion confiable. Nunca responde datos vivos (trabajos, pagos, disponibilidad): eso lo resuelven las tools. Evaluacion: `docs/rag/EVALUACION_CONOCIMIENTO_TUS.md`.

## Seguridad del prompt

Los fragmentos recuperados se entregan como datos delimitados, con `<` y `>` neutralizados. El texto del usuario, historial y resumen pasan por redaccion de CUIL, documento, token, email, tarjeta y telefono antes de llegar al modelo. Las acciones de negocio no se resuelven desde RAG: siempre pasan por tools y los servicios de dominio.
