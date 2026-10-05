-- MEMORIA-01 (phase 4): semantic memory of conversations, per account.
-- A fragment is a coherent stretch of a conversation (several messages, already cleaned of
-- personal identifiers and secrets) that belongs to ONE account and knows where it came from.
-- Its vector lives in the existing "RagEmbedding" table (pgvector), under tenant 'tus-memoria'
-- and workspace = the account. Forward-only and additive: one new table and one index.

CREATE TABLE IF NOT EXISTS public."fragmentos_memoria" (
  "id" TEXT NOT NULL,
  "cuenta_id" TEXT NOT NULL,
  "conversacion_id" TEXT NOT NULL,
  "canal" TEXT NOT NULL,
  "desde_secuencia" BIGINT NOT NULL,
  "hasta_secuencia" BIGINT NOT NULL,
  "texto" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "version_embeddings" TEXT,
  "fecha_creacion" TIMESTAMPTZ NOT NULL,
  "expira_en" TIMESTAMPTZ,
  CONSTRAINT "fragmentos_memoria_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_fragmentos_memoria_conversacion" FOREIGN KEY ("conversacion_id") REFERENCES public."conversaciones_whatsapp"("id") ON DELETE RESTRICT,
  CONSTRAINT "ck_fragmentos_memoria_canal" CHECK ("canal" IN ('whatsapp', 'web')),
  CONSTRAINT "ck_fragmentos_memoria_rango" CHECK ("desde_secuencia" >= 1 AND "hasta_secuencia" >= "desde_secuencia"),
  CONSTRAINT "ck_fragmentos_memoria_texto" CHECK (char_length("texto") BETWEEN 1 AND 4000),
  CONSTRAINT "ck_fragmentos_memoria_cuenta" CHECK (char_length("cuenta_id") >= 1)
);

-- The same stretch of a conversation is one fragment (a retried step stores nothing twice).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fragmentos_memoria_rango" ON public."fragmentos_memoria" ("conversacion_id", "desde_secuencia", "hasta_secuencia");
-- Every read of the memory starts from the account.
CREATE INDEX IF NOT EXISTS "ix_fragmentos_memoria_cuenta" ON public."fragmentos_memoria" ("cuenta_id", "fecha_creacion");
-- Vectors are filtered by tenant + workspace (the account) BEFORE the similarity ordering.
CREATE INDEX IF NOT EXISTS "ix_rag_embedding_tenant_workspace" ON public."RagEmbedding" ("tenantId", "workspaceId");
