-- MEMORIA-01 (phase 5): durable facts of an account, with provenance.
-- A closed list of types (never "anything the person said"), one ACTIVE fact per type and
-- account, and where it came from (message, conversation, channel). A new value does not
-- overwrite: the previous fact is invalidated and kept. Forward-only and additive: one new table.

CREATE TABLE IF NOT EXISTS public."hechos_memoria" (
  "id" TEXT NOT NULL,
  "cuenta_id" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "valor" TEXT NOT NULL,
  "conversacion_id" TEXT,
  "mensaje_origen_id" TEXT,
  "canal" TEXT NOT NULL,
  "confianza" NUMERIC(3, 2),
  "fecha_creacion" TIMESTAMPTZ NOT NULL,
  "fecha_actualizacion" TIMESTAMPTZ NOT NULL,
  "expira_en" TIMESTAMPTZ,
  "invalidado_en" TIMESTAMPTZ,
  "motivo_invalidacion" TEXT,
  CONSTRAINT "hechos_memoria_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_hechos_memoria_conversacion" FOREIGN KEY ("conversacion_id") REFERENCES public."conversaciones_whatsapp"("id") ON DELETE SET NULL,
  CONSTRAINT "ck_hechos_memoria_tipo" CHECK ("tipo" IN ('horario_preferido', 'zona_habitual', 'contacto_preferido')),
  CONSTRAINT "ck_hechos_memoria_valor" CHECK (char_length("valor") BETWEEN 1 AND 120),
  CONSTRAINT "ck_hechos_memoria_cuenta" CHECK (char_length("cuenta_id") >= 1),
  CONSTRAINT "ck_hechos_memoria_canal" CHECK ("canal" IN ('whatsapp', 'web')),
  CONSTRAINT "ck_hechos_memoria_confianza" CHECK ("confianza" IS NULL OR ("confianza" >= 0 AND "confianza" <= 1)),
  CONSTRAINT "ck_hechos_memoria_invalidacion" CHECK (("invalidado_en" IS NULL) = ("motivo_invalidacion" IS NULL))
);

-- One active fact per type and account (of two writers at once, one wins).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_hechos_memoria_activo" ON public."hechos_memoria" ("cuenta_id", "tipo") WHERE "invalidado_en" IS NULL;
CREATE INDEX IF NOT EXISTS "ix_hechos_memoria_cuenta" ON public."hechos_memoria" ("cuenta_id", "fecha_creacion");
