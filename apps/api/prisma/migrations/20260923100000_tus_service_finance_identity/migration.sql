-- WEB-09A: canonical financial identity for WEB-08 services.
-- Forward-only and additive. No data is rewritten, dropped or backfilled.
--
-- `compromisos` (legacy direct commitments) and `compromisos_mercado_servicios`
-- (marketplace commitments consumed by Trabajo) are different aggregates with
-- different tenancy. Service money now anchors on `obligaciones_pago_servicio`,
-- which is 1:1 with `trabajos` and pinned to the full commercial chain.
--
-- The shared finance tables keep a single ledger/intent/snapshot source: they gain
-- a nullable `obligacion_id` and relax `compromiso_id` so a row references exactly
-- one subject. Subject/amount checks are added NOT VALID so historical rows are not
-- rescanned; every new row is enforced.

CREATE TABLE public."obligaciones_pago_servicio" (
  "id" text NOT NULL,
  "version_contrato" text NOT NULL,
  "obligacion_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "cliente_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "prestador_id" text NOT NULL,
  "publicacion_id" text NOT NULL,
  "compromiso_id" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "origen_importe" text NOT NULL,
  "presupuesto_id" text,
  "presupuesto_version" integer,
  "monto" bigint NOT NULL,
  "moneda" text NOT NULL,
  "estado" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "obligaciones_pago_servicio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_obligaciones_pago_monto_no_negativo" CHECK ("monto" >= 0),
  CONSTRAINT "ck_obligaciones_pago_moneda_iso" CHECK ("moneda" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ck_obligaciones_pago_estado" CHECK ("estado" IN ('pending_payment', 'paid', 'refunded', 'charged_back')),
  CONSTRAINT "ck_obligaciones_pago_version_positiva" CHECK ("version" > 0),
  CONSTRAINT "ck_obligaciones_pago_origen_importe" CHECK (
    ("origen_importe" = 'accepted_budget' AND "presupuesto_id" IS NOT NULL AND "presupuesto_version" IS NOT NULL)
    OR ("origen_importe" = 'fixed_price_commitment' AND "presupuesto_id" IS NULL AND "presupuesto_version" IS NULL)
  )
);

CREATE UNIQUE INDEX "uq_obligaciones_pago_tenant_obligacion" ON public."obligaciones_pago_servicio"("tenant_id", "obligacion_id");
CREATE UNIQUE INDEX "uq_obligaciones_pago_tenant_trabajo" ON public."obligaciones_pago_servicio"("tenant_id", "trabajo_id");
CREATE INDEX "idx_obligaciones_pago_prestador_estado" ON public."obligaciones_pago_servicio"("prestador_tenant_id", "prestador_id", "estado");
CREATE INDEX "idx_obligaciones_pago_tenant_estado" ON public."obligaciones_pago_servicio"("tenant_id", "estado");

-- Composite target for the obligation FK; trabajo_id is already unique per tenant,
-- so this index cannot reject existing rows.
CREATE UNIQUE INDEX "uq_trabajos_identidad_financiera" ON public."trabajos"("tenant_id", "trabajo_id", "compromiso_id", "prestador_tenant_id", "prestador_id", "publicacion_id");

ALTER TABLE public."obligaciones_pago_servicio"
  ADD CONSTRAINT "fk_obligaciones_pago_trabajos" FOREIGN KEY ("tenant_id", "trabajo_id", "compromiso_id", "prestador_tenant_id", "prestador_id", "publicacion_id")
  REFERENCES public."trabajos"("tenant_id", "trabajo_id", "compromiso_id", "prestador_tenant_id", "prestador_id", "publicacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE public."obligaciones_pago_servicio"
  ADD CONSTRAINT "fk_obligaciones_pago_presupuestos" FOREIGN KEY ("tenant_id", "presupuesto_id", "presupuesto_version")
  REFERENCES public."presupuestos"("tenant_id", "presupuesto_id", "version") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Shared payment intents.
ALTER TABLE public."intenciones_pago" ADD COLUMN "obligacion_id" text;
ALTER TABLE public."intenciones_pago" ALTER COLUMN "compromiso_id" DROP NOT NULL;
ALTER TABLE public."intenciones_pago"
  ADD CONSTRAINT "ck_intenciones_pago_sujeto_unico" CHECK (("compromiso_id" IS NULL) <> ("obligacion_id" IS NULL)) NOT VALID;
ALTER TABLE public."intenciones_pago"
  ADD CONSTRAINT "ck_intenciones_pago_monto_no_negativo" CHECK ("monto" >= 0) NOT VALID;
CREATE INDEX "idx_intenciones_pago_tenant_obligacion" ON public."intenciones_pago"("tenant_id", "obligacion_id");
ALTER TABLE public."intenciones_pago"
  ADD CONSTRAINT "fk_intenciones_pago_obligaciones" FOREIGN KEY ("tenant_id", "obligacion_id")
  REFERENCES public."obligaciones_pago_servicio"("tenant_id", "obligacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Shared commission snapshots: at most one per obligation.
ALTER TABLE public."instantaneas_comision" ADD COLUMN "obligacion_id" text;
ALTER TABLE public."instantaneas_comision" ALTER COLUMN "compromiso_id" DROP NOT NULL;
ALTER TABLE public."instantaneas_comision"
  ADD CONSTRAINT "ck_instantaneas_comision_sujeto_unico" CHECK (("compromiso_id" IS NULL) <> ("obligacion_id" IS NULL)) NOT VALID;
ALTER TABLE public."instantaneas_comision"
  ADD CONSTRAINT "ck_instantaneas_comision_montos" CHECK ("monto_bruto" >= 0 AND "monto_comision" >= 0 AND "monto_neto" >= 0 AND "tasa_puntos_base" BETWEEN 0 AND 10000) NOT VALID;
CREATE UNIQUE INDEX "uq_instantaneas_comision_tenant_obligacion" ON public."instantaneas_comision"("tenant_id", "obligacion_id");
ALTER TABLE public."instantaneas_comision"
  ADD CONSTRAINT "fk_instantaneas_comision_obligaciones" FOREIGN KEY ("tenant_id", "obligacion_id")
  REFERENCES public."obligaciones_pago_servicio"("tenant_id", "obligacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Single append-only ledger.
ALTER TABLE public."movimientos_contables" ADD COLUMN "obligacion_id" text;
ALTER TABLE public."movimientos_contables" ALTER COLUMN "compromiso_id" DROP NOT NULL;
ALTER TABLE public."movimientos_contables"
  ADD CONSTRAINT "ck_movimientos_contables_sujeto_unico" CHECK (("compromiso_id" IS NULL) <> ("obligacion_id" IS NULL)) NOT VALID;
ALTER TABLE public."movimientos_contables"
  ADD CONSTRAINT "ck_movimientos_contables_monto_no_negativo" CHECK ("monto" >= 0) NOT VALID;
CREATE INDEX "idx_movimientos_tenant_obligacion_fecha_creacion" ON public."movimientos_contables"("tenant_id", "obligacion_id", "fecha_creacion");
ALTER TABLE public."movimientos_contables"
  ADD CONSTRAINT "fk_movimientos_contables_obligaciones" FOREIGN KEY ("tenant_id", "obligacion_id")
  REFERENCES public."obligaciones_pago_servicio"("tenant_id", "obligacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
