# RAG de conocimiento de TUS

## Corpus

Solo se indexan archivos Markdown bajo `docs/conocimiento/` con front matter completo, idioma `es`, checksum SHA-256 y visibilidad permitida. No se indexan conversaciones, datos de trabajos, pagos, secretos, `.env`, auditorias ni `docs/SEGURIDAD_TUS.md`.

Las visibilidades disponibles son `public`, `authenticated-client`, `authenticated-provider` e `internal-admin`. La ultima nunca se recupera desde WhatsApp. Los documentos de proveedor requieren cuenta vinculada y autoridad de prestador.

## Indexacion

El chunker es determinista (`markdown-headings-v1`), limita fragmentos a 1100 caracteres y reindexa solo cuando cambia contenido, version o embedding. La sustitucion de un documento elimina sus chunks y vectores anteriores en la misma transaccion. Los documentos ausentes se desactivan.

Comandos:

```text
pnpm tus:rag:ingest -- --dry-run
pnpm tus:rag:ingest
pnpm tus:rag:stats
pnpm tus:rag:search -- --query "como funcionan los presupuestos"
pnpm tus:rag:search -- --query "comision de cobros" --linked --provider
```

La salida es JSON estructurado y redacta PII. El CLI requiere el `DATABASE_URL` canonico y nunca crea otra base.

## Embeddings

El vector debe tener exactamente 1024 dimensiones para coincidir con PostgreSQL/pgvector.

- `RAG_EMBEDDING_PROVIDER=none`: retrieval lexical solamente.
- `RAG_EMBEDDING_PROVIDER=openai-compatible`: requiere `RAG_EMBEDDING_BASE_URL` HTTPS, `RAG_EMBEDDING_API_KEY` y `RAG_EMBEDDING_MODEL`; opcionalmente `RAG_EMBEDDING_SEND_DIMENSIONS=true`.
- `RAG_EMBEDDING_PROVIDER=local-hash`: solo desarrollo y tests; se rechaza en produccion.

El retrieval productivo combina FTS en espanol y vector por reciprocal-rank fusion. Si no hay evidencia suficiente, el asistente no improvisa y ofrece derivacion humana.

## Seguridad del prompt

Los fragmentos recuperados se entregan como datos delimitados, con `<` y `>` neutralizados. El texto del usuario, historial y resumen pasan por redaccion de CUIL, documento, token, email, tarjeta y telefono antes de llegar al modelo. Las acciones de negocio no se resuelven desde RAG: siempre pasan por tools y los servicios de dominio.
