-- MEMORIA-01 (phase 1): canonical order of the conversation history.
-- Every message gets a stable, ever-growing sequence number: the history is paged by it and a
-- summary or a memory fragment can say exactly "up to message X". Forward-only and additive:
-- no row is deleted, no text is changed, the existing date index stays.

CREATE SEQUENCE IF NOT EXISTS public."mensajes_conversacion_whatsapp_secuencia_seq" AS BIGINT;

ALTER TABLE public."mensajes_conversacion_whatsapp" ADD COLUMN IF NOT EXISTS "secuencia" BIGINT;

-- Existing messages are numbered in the order they were stored (creation date, then id).
UPDATE public."mensajes_conversacion_whatsapp" AS m
   SET "secuencia" = o."n"
  FROM (SELECT "id", row_number() OVER (ORDER BY "fecha_creacion", "id") AS "n" FROM public."mensajes_conversacion_whatsapp" WHERE "secuencia" IS NULL) AS o
 WHERE m."id" = o."id" AND m."secuencia" IS NULL;

SELECT setval('public."mensajes_conversacion_whatsapp_secuencia_seq"', GREATEST((SELECT COALESCE(MAX("secuencia"), 0) FROM public."mensajes_conversacion_whatsapp"), 1), (SELECT COUNT(*) > 0 FROM public."mensajes_conversacion_whatsapp"));

ALTER TABLE public."mensajes_conversacion_whatsapp" ALTER COLUMN "secuencia" SET DEFAULT nextval('public."mensajes_conversacion_whatsapp_secuencia_seq"');
ALTER TABLE public."mensajes_conversacion_whatsapp" ALTER COLUMN "secuencia" SET NOT NULL;
ALTER SEQUENCE public."mensajes_conversacion_whatsapp_secuencia_seq" OWNED BY public."mensajes_conversacion_whatsapp"."secuencia";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_mensajes_conversacion_whatsapp_secuencia" ON public."mensajes_conversacion_whatsapp" ("secuencia");
CREATE INDEX IF NOT EXISTS "ix_mensajes_conversacion_whatsapp_secuencia" ON public."mensajes_conversacion_whatsapp" ("conversacion_id", "secuencia");
