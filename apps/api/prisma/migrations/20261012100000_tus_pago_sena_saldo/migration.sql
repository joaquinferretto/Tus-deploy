-- A request-born work is paid in two parts of its accepted budget: a deposit ("seña", 50%) before
-- it starts and the balance ("saldo") when the provider finishes; the work is completed only when
-- the balance is approved. Marketplace works keep a single obligation ("total") and the same chain.
-- Forward-only and additive: existing rows keep every value (tramo defaults to 'total').

ALTER TABLE public."obligaciones_pago_servicio" ADD COLUMN "tramo" text NOT NULL DEFAULT 'total';
ALTER TABLE public."obligaciones_pago_servicio" ALTER COLUMN "publicacion_id" DROP NOT NULL;
ALTER TABLE public."obligaciones_pago_servicio" ALTER COLUMN "compromiso_id" DROP NOT NULL;

ALTER TABLE public."obligaciones_pago_servicio" ADD CONSTRAINT "ck_obligaciones_pago_tramo" CHECK ("tramo" IN ('total', 'sena', 'saldo'));
-- 'total' keeps the whole marketplace chain; 'sena'/'saldo' have none and always come from an
-- accepted budget.
ALTER TABLE public."obligaciones_pago_servicio" ADD CONSTRAINT "ck_obligaciones_pago_tramo_cadena" CHECK (
  ("tramo" = 'total' AND "publicacion_id" IS NOT NULL AND "compromiso_id" IS NOT NULL)
  OR ("tramo" IN ('sena', 'saldo') AND "publicacion_id" IS NULL AND "compromiso_id" IS NULL AND "origen_importe" = 'accepted_budget')
);

-- One obligation per work and part (was one per work).
DROP INDEX public."uq_obligaciones_pago_tenant_trabajo";
CREATE UNIQUE INDEX "uq_obligaciones_pago_tenant_trabajo_tramo" ON public."obligaciones_pago_servicio"("tenant_id", "trabajo_id", "tramo");

-- The chain FK is not enforced when its columns are NULL, so every obligation is also pinned to
-- its work and provider. trabajo_id is unique per tenant: this index cannot reject existing rows.
CREATE UNIQUE INDEX "uq_trabajos_tenant_trabajo_prestador_id" ON public."trabajos"("tenant_id", "trabajo_id", "prestador_tenant_id", "prestador_id");
ALTER TABLE public."obligaciones_pago_servicio" ADD CONSTRAINT "fk_obligaciones_pago_trabajo_prestador"
  FOREIGN KEY ("tenant_id", "trabajo_id", "prestador_tenant_id", "prestador_id")
  REFERENCES public."trabajos"("tenant_id", "trabajo_id", "prestador_tenant_id", "prestador_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- The provider marked the job as finished; with online payments it stays in progress until the
-- balance is approved. Only meaningful while the work is in progress or completed.
ALTER TABLE public."trabajos" ADD COLUMN "terminado_en" timestamp(3);
ALTER TABLE public."trabajos" ADD CONSTRAINT "ck_trabajos_terminado_en" CHECK (
  "terminado_en" IS NULL OR "estado" IN ('in_progress', 'completed', 'cancelled')
);
