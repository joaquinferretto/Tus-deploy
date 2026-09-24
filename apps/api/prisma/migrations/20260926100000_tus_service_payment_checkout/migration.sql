-- WEB-09E: Mercado Pago Checkout Pro (Split 1:1) for service payments, sandbox first.
-- Forward-only and additive. The commission sent to Mercado Pago as `marketplace_fee` is frozen
-- on the payment intent when the checkout is created; the approval snapshot must match it.
-- A dispatch claim column prevents two concurrent requests from creating two checkouts.
-- Refunds are recorded per attempt; TUS never covers the seller's part automatically.

ALTER TABLE public."intenciones_pago"
  ADD COLUMN "preferencia_id" text,
  ADD COLUMN "url_checkout" text,
  ADD COLUMN "checkout_expira_en" timestamp(3),
  ADD COLUMN "tasa_comision_bps" integer,
  ADD COLUMN "version_regla_comision" text,
  ADD COLUMN "politica_comision_id" text,
  ADD COLUMN "comision_marketplace" bigint,
  ADD COLUMN "despacho_reclamado_hasta" timestamp(3),
  ADD COLUMN "entorno_proveedor" text;
ALTER TABLE public."intenciones_pago"
  ADD CONSTRAINT "ck_intenciones_pago_checkout" CHECK (
    ("comision_marketplace" IS NULL OR ("comision_marketplace" >= 0 AND "comision_marketplace" <= "monto"))
    AND ("tasa_comision_bps" IS NULL OR ("tasa_comision_bps" >= 0 AND "tasa_comision_bps" <= 3000))
    AND (("tasa_comision_bps" IS NULL) = ("comision_marketplace" IS NULL))
    AND ("entorno_proveedor" IS NULL OR "entorno_proveedor" IN ('sandbox', 'production', 'deterministic'))
    AND ("url_checkout" IS NULL OR "url_checkout" ~ '^https://')
  ) NOT VALID;
ALTER TABLE public."intenciones_pago" VALIDATE CONSTRAINT "ck_intenciones_pago_checkout";
CREATE UNIQUE INDEX "uq_intenciones_pago_preferencia" ON public."intenciones_pago"("proveedor", "preferencia_id");

CREATE TABLE public."reembolsos_servicio" (
  "id" text NOT NULL,
  "version_contrato" text NOT NULL,
  "reembolso_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "obligacion_id" text NOT NULL,
  "pago_id" text NOT NULL,
  "intento" integer NOT NULL,
  "monto" bigint NOT NULL,
  "moneda" text NOT NULL,
  "estado" text NOT NULL,
  "referencia_reembolso_proveedor" text,
  "error_proveedor" text,
  "motivo" text NOT NULL,
  "clave_idempotencia" text NOT NULL,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "reembolsos_servicio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_reembolsos_servicio_estado" CHECK ("estado" IN ('requested', 'submitted', 'requires_review', 'failed')),
  CONSTRAINT "ck_reembolsos_servicio_monto" CHECK ("monto" > 0),
  CONSTRAINT "ck_reembolsos_servicio_moneda" CHECK ("moneda" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ck_reembolsos_servicio_intento" CHECK ("intento" > 0 AND "version" > 0),
  CONSTRAINT "ck_reembolsos_servicio_enviado" CHECK ("estado" <> 'submitted' OR "referencia_reembolso_proveedor" IS NOT NULL)
);
CREATE UNIQUE INDEX "uq_reembolsos_servicio_tenant_reembolso" ON public."reembolsos_servicio"("tenant_id", "reembolso_id");
CREATE UNIQUE INDEX "uq_reembolsos_servicio_tenant_clave" ON public."reembolsos_servicio"("tenant_id", "clave_idempotencia");
CREATE UNIQUE INDEX "uq_reembolsos_servicio_pago_intento" ON public."reembolsos_servicio"("tenant_id", "pago_id", "intento");
ALTER TABLE public."reembolsos_servicio"
  ADD CONSTRAINT "fk_reembolsos_servicio_intenciones" FOREIGN KEY ("tenant_id", "pago_id", "obligacion_id")
  REFERENCES public."intenciones_pago"("tenant_id", "pago_id", "obligacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
