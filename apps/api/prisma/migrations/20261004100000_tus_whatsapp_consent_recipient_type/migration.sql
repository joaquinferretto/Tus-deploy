-- Consent is scoped by tenant, recipient type, and external recipient identity.
-- The previous unique index prevented one external identifier from holding distinct
-- customer, merchant, or tenant consent records.

DROP INDEX public."uq_consentimientos_whatsapp_tenant_destinatario";
CREATE UNIQUE INDEX "uq_consentimientos_whatsapp_tenant_tipo_destinatario"
  ON public."consentimientos_whatsapp" ("tenant_id", "tipo_destinatario", "destinatario_id");
