-- MEMORIA-01 (phase 3): incremental, versioned summaries of a conversation.
-- Each row says exactly which messages it represents ("up to sequence X"); a new version is added,
-- the previous ones stay, and the original messages are never touched. Forward-only and additive:
-- one new table. The columns "resumen" / "mensajes_resumidos" of the conversation are kept.

CREATE TABLE IF NOT EXISTS public."resumenes_conversacion" (
  "id" TEXT NOT NULL,
  "conversacion_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "desde_secuencia" BIGINT NOT NULL,
  "hasta_secuencia" BIGINT NOT NULL,
  "mensajes" INTEGER NOT NULL,
  "texto" TEXT NOT NULL,
  "modelo" TEXT,
  "fecha_creacion" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "resumenes_conversacion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_resumenes_conversacion_conversacion" FOREIGN KEY ("conversacion_id") REFERENCES public."conversaciones_whatsapp"("id") ON DELETE RESTRICT,
  CONSTRAINT "ck_resumenes_conversacion_version" CHECK ("version" >= 1),
  CONSTRAINT "ck_resumenes_conversacion_rango" CHECK ("desde_secuencia" >= 1 AND "hasta_secuencia" >= "desde_secuencia"),
  CONSTRAINT "ck_resumenes_conversacion_mensajes" CHECK ("mensajes" >= 1),
  CONSTRAINT "ck_resumenes_conversacion_texto" CHECK (char_length("texto") BETWEEN 1 AND 4000)
);

-- One row per version: of two workers summarizing the same step, exactly one is stored.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_resumenes_conversacion_version" ON public."resumenes_conversacion" ("conversacion_id", "version");
