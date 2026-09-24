-- WEB-09C: internal settlement and reconciliation for service obligations.
-- Forward-only and additive. Commission snapshots and ledger entries reuse the existing
-- `instantaneas_comision` and append-only `movimientos_contables` tables via `obligacion_id`.
-- No payout, split or provider transfer is represented as executed.

CREATE TABLE public."liquidaciones_servicio" (
  "id" text NOT NULL,
  "version_contrato" text NOT NULL,
  "liquidacion_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "obligacion_id" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "monto_bruto" bigint NOT NULL,
  "monto_comision" bigint NOT NULL,
  "monto_neto" bigint NOT NULL,
  "moneda" text NOT NULL,
  "estado" text NOT NULL,
  "motivo" text NOT NULL,
  "estado_desembolso" text NOT NULL DEFAULT 'not_executed',
  "version" integer NOT NULL DEFAULT 1,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "liquidaciones_servicio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_liquidaciones_servicio_montos" CHECK ("monto_bruto" >= 0 AND "monto_comision" >= 0 AND "monto_neto" >= 0 AND "monto_comision" + "monto_neto" = "monto_bruto"),
  CONSTRAINT "ck_liquidaciones_servicio_moneda_iso" CHECK ("moneda" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ck_liquidaciones_servicio_estado" CHECK ("estado" IN ('held', 'eligible', 'frozen', 'reversed')),
  CONSTRAINT "ck_liquidaciones_servicio_sin_desembolso" CHECK ("estado_desembolso" = 'not_executed'),
  CONSTRAINT "ck_liquidaciones_servicio_version_positiva" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "uq_liquidaciones_servicio_tenant_liquidacion" ON public."liquidaciones_servicio"("tenant_id", "liquidacion_id");
CREATE UNIQUE INDEX "uq_liquidaciones_servicio_tenant_obligacion" ON public."liquidaciones_servicio"("tenant_id", "obligacion_id");
CREATE INDEX "idx_liquidaciones_servicio_prestador_estado" ON public."liquidaciones_servicio"("prestador_tenant_id", "estado");
ALTER TABLE public."liquidaciones_servicio"
  ADD CONSTRAINT "fk_liquidaciones_servicio_obligaciones" FOREIGN KEY ("tenant_id", "obligacion_id")
  REFERENCES public."obligaciones_pago_servicio"("tenant_id", "obligacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE public."conciliaciones_servicio" (
  "id" text NOT NULL,
  "version_contrato" text NOT NULL,
  "conciliacion_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "obligacion_id" text NOT NULL,
  "estado" text NOT NULL,
  "hallazgos" jsonb NOT NULL,
  "monto_esperado" bigint NOT NULL,
  "moneda" text NOT NULL,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "conciliaciones_servicio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_conciliaciones_servicio_estado" CHECK ("estado" IN ('matched', 'discrepancy', 'pending')),
  CONSTRAINT "ck_conciliaciones_servicio_monto" CHECK ("monto_esperado" >= 0)
);
CREATE UNIQUE INDEX "uq_conciliaciones_servicio_tenant_conciliacion" ON public."conciliaciones_servicio"("tenant_id", "conciliacion_id");
CREATE INDEX "idx_conciliaciones_servicio_obligacion_fecha" ON public."conciliaciones_servicio"("tenant_id", "obligacion_id", "fecha_creacion");
CREATE INDEX "idx_conciliaciones_servicio_estado_fecha" ON public."conciliaciones_servicio"("tenant_id", "estado", "fecha_creacion");
ALTER TABLE public."conciliaciones_servicio"
  ADD CONSTRAINT "fk_conciliaciones_servicio_obligaciones" FOREIGN KEY ("tenant_id", "obligacion_id")
  REFERENCES public."obligaciones_pago_servicio"("tenant_id", "obligacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE OR REPLACE FUNCTION public.tus_conciliacion_servicio_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'conciliaciones_servicio is append-only; record a new reconciliation run';
END;
$$;
CREATE TRIGGER tus_conciliacion_servicio_append_only_trigger
  BEFORE UPDATE OR DELETE ON public."conciliaciones_servicio"
  FOR EACH ROW EXECUTE FUNCTION public.tus_conciliacion_servicio_append_only();
