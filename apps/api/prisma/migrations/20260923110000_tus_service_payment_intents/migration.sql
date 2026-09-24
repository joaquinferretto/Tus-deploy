-- WEB-09B: service payment intents, durable provider-event inbox and finance audit.
-- Forward-only and additive. No provider is enabled and no row is rewritten.

-- Service intents reuse `intenciones_pago`; attempts are numbered per obligation and the
-- dispatch state is kept apart from the provider state.
ALTER TABLE public."intenciones_pago" ADD COLUMN "prestador_tenant_id" text;
ALTER TABLE public."intenciones_pago" ADD COLUMN "intento" integer;
ALTER TABLE public."intenciones_pago" ADD COLUMN "estado_despacho" text;
ALTER TABLE public."intenciones_pago"
  ADD CONSTRAINT "ck_intenciones_pago_servicio_completa" CHECK (
    "obligacion_id" IS NULL
    OR ("prestador_tenant_id" IS NOT NULL AND "intento" > 0 AND "estado_despacho" IN ('pending_dispatch', 'dispatched', 'dispatch_failed'))
  ) NOT VALID;
CREATE UNIQUE INDEX "uq_intenciones_pago_tenant_obligacion_intento" ON public."intenciones_pago"("tenant_id", "obligacion_id", "intento");
CREATE INDEX "idx_intenciones_pago_proveedor_referencia" ON public."intenciones_pago"("proveedor", "referencia_proveedor");

-- `eventos_webhook_pago` becomes the durable inbox: unique (tenant, provider, event id)
-- already exists; the raw body stays in `datos_evento` and the processing result in `estado`.
ALTER TABLE public."eventos_webhook_pago" ADD COLUMN "pago_id" text;
ALTER TABLE public."eventos_webhook_pago" ADD COLUMN "obligacion_id" text;
ALTER TABLE public."eventos_webhook_pago" ADD COLUMN "referencia_proveedor" text;
ALTER TABLE public."eventos_webhook_pago" ADD COLUMN "estado_proveedor" text;
ALTER TABLE public."eventos_webhook_pago" ADD COLUMN "monto" bigint;
ALTER TABLE public."eventos_webhook_pago" ADD COLUMN "moneda" text;
ALTER TABLE public."eventos_webhook_pago" ADD COLUMN "motivo" text;
ALTER TABLE public."eventos_webhook_pago" ADD COLUMN "fecha_recepcion" timestamp(3);
ALTER TABLE public."eventos_webhook_pago"
  ADD CONSTRAINT "ck_eventos_webhook_pago_monto_no_negativo" CHECK ("monto" IS NULL OR "monto" >= 0) NOT VALID;
CREATE INDEX "idx_eventos_webhook_pago_tenant_obligacion" ON public."eventos_webhook_pago"("tenant_id", "obligacion_id");
ALTER TABLE public."eventos_webhook_pago"
  ADD CONSTRAINT "fk_eventos_webhook_pago_obligaciones" FOREIGN KEY ("tenant_id", "obligacion_id")
  REFERENCES public."obligaciones_pago_servicio"("tenant_id", "obligacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE public."auditoria_finanzas_servicio" (
  "id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "obligacion_id" text NOT NULL,
  "tipo_recurso" text NOT NULL,
  "recurso_id" text NOT NULL,
  "accion" text NOT NULL,
  "origen" text NOT NULL,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "clave_idempotencia" text,
  "estado_anterior" text,
  "estado_nuevo" text,
  "metadatos" jsonb NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "auditoria_finanzas_servicio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_auditoria_fin_servicio_origen" CHECK ("origen" IN ('customer', 'provider_event', 'system'))
);
CREATE INDEX "idx_auditoria_fin_servicio_obligacion_fecha" ON public."auditoria_finanzas_servicio"("tenant_id", "obligacion_id", "fecha_creacion");
CREATE INDEX "idx_auditoria_fin_servicio_prestador_fecha" ON public."auditoria_finanzas_servicio"("prestador_tenant_id", "fecha_creacion");
ALTER TABLE public."auditoria_finanzas_servicio"
  ADD CONSTRAINT "fk_auditoria_finanzas_servicio_obligaciones" FOREIGN KEY ("tenant_id", "obligacion_id")
  REFERENCES public."obligaciones_pago_servicio"("tenant_id", "obligacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
