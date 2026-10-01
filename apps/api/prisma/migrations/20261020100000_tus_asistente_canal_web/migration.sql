-- ASISTENTE-WEB-01: the Web assistant uses the SAME orchestrator, tools, knowledge, confirmations
-- and conversation memory as WhatsApp. A Web conversation is stored in the same tables with
-- canal = 'web'; its contact key is web:acct:<cuenta> (authenticated session) or web:anon:<id>
-- (random browser id, public tools only). Additive: existing rows are WhatsApp.

ALTER TABLE public."contactos_whatsapp" ADD COLUMN "canal" text NOT NULL DEFAULT 'whatsapp';
ALTER TABLE public."contactos_whatsapp"
  ADD CONSTRAINT "ck_contactos_whatsapp_canal" CHECK ("canal" IN ('whatsapp', 'web'));

-- The identity check becomes per channel (same rule as before for WhatsApp numbers).
ALTER TABLE public."contactos_whatsapp" DROP CONSTRAINT "ck_contactos_whatsapp_wa_id";
ALTER TABLE public."contactos_whatsapp"
  ADD CONSTRAINT "ck_contactos_whatsapp_wa_id" CHECK (
    ("canal" = 'whatsapp' AND "wa_id" ~ '^[0-9]{6,20}$')
    OR ("canal" = 'web' AND "wa_id" ~ '^web:(acct|anon):[A-Za-z0-9._:-]{3,120}$')
  );

-- A Web contact is never a linked WhatsApp number: its authority is the session of each request.
ALTER TABLE public."contactos_whatsapp"
  ADD CONSTRAINT "ck_contactos_whatsapp_web_sin_vinculo" CHECK ("canal" = 'whatsapp' OR "cuenta_vinculada_id" IS NULL);

ALTER TABLE public."conversaciones_whatsapp" ADD COLUMN "canal" text NOT NULL DEFAULT 'whatsapp';
ALTER TABLE public."conversaciones_whatsapp"
  ADD CONSTRAINT "ck_conversaciones_whatsapp_canal" CHECK ("canal" IN ('whatsapp', 'web'));

-- Support inbox: WhatsApp conversations only, by mode and recency.
CREATE INDEX "ix_conversaciones_whatsapp_canal_panel"
  ON public."conversaciones_whatsapp"("canal", "modo", "ultimo_mensaje_en");
