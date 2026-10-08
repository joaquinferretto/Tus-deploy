-- PAGOS-RETENCION-01. An approved payment is not money the provider can withdraw.
--
-- Additive and forward-only. Nothing existing is rewritten:
--   * "retencion_activa" marks the settlements whose net is held until the work reaches its
--     release milestone. Every existing row keeps false: what was withdrawable stays withdrawable.
--   * "liberada_en" is the moment the settlement was released (it became 'eligible'). A settlement
--     under retention that was never released never makes its earning withdrawable, whatever
--     happens to it afterwards (refund, chargeback, cancellation).
ALTER TABLE public."liquidaciones_servicio" ADD COLUMN "retencion_activa" boolean NOT NULL DEFAULT false;
ALTER TABLE public."liquidaciones_servicio" ADD COLUMN "liberada_en" timestamp(3);

-- A release is always the release of something that was held.
ALTER TABLE public."liquidaciones_servicio"
  ADD CONSTRAINT "ck_liquidaciones_servicio_liberacion" CHECK ("liberada_en" IS NULL OR "retencion_activa");

-- CIERRE-TRABAJO-01. The closing of a work (or of the order of a turno): one row per work with
-- when the provider finished it, its evidence, the moment the client's window runs out, how it
-- was confirmed and the observation of the client. The window is this stored instant: the
-- automatic confirmation reads it, nothing is kept in memory.
CREATE TABLE public."cierres_trabajo" (
  "tenant_id" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "finalizado_en" timestamp(3) NOT NULL,
  "finalizado_por" text NOT NULL,
  "evidencia" text NOT NULL,
  "confirmacion_vence_en" timestamp(3) NOT NULL,
  "confirmado_en" timestamp(3),
  "confirmacion_origen" text,
  "observado_en" timestamp(3),
  "observacion_motivo" text,
  "observacion_resuelta_en" timestamp(3),
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "cierres_trabajo_pkey" PRIMARY KEY ("tenant_id", "trabajo_id"),
  CONSTRAINT "fk_cierres_trabajo_trabajo" FOREIGN KEY ("tenant_id", "trabajo_id") REFERENCES public."trabajos"("tenant_id", "trabajo_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_cierres_trabajo_evidencia" CHECK (char_length(btrim("evidencia")) >= 10),
  CONSTRAINT "ck_cierres_trabajo_ventana" CHECK ("confirmacion_vence_en" > "finalizado_en"),
  CONSTRAINT "ck_cierres_trabajo_confirmacion" CHECK (
    ("confirmado_en" IS NULL AND "confirmacion_origen" IS NULL)
    OR ("confirmado_en" IS NOT NULL AND "confirmacion_origen" IS NOT NULL AND "confirmacion_origen" IN ('cliente', 'automatica', 'pago_final'))
  ),
  CONSTRAINT "ck_cierres_trabajo_observacion" CHECK (
    ("observado_en" IS NULL AND "observacion_motivo" IS NULL AND "observacion_resuelta_en" IS NULL)
    OR ("observado_en" IS NOT NULL AND "observacion_motivo" IS NOT NULL)
  )
);

-- What the automatic confirmation looks for: not confirmed, by the moment the window runs out.
CREATE INDEX "ix_cierres_trabajo_vencimiento" ON public."cierres_trabajo" ("confirmacion_vence_en") WHERE "confirmado_en" IS NULL;

-- Same exposure rule as every table of TUS: only the API reaches it.
ALTER TABLE public."cierres_trabajo" ENABLE ROW LEVEL SECURITY;

-- PAGOS-MODALIDAD-01. A turno and a request-born work can be paid with a deposit and its balance
-- or with one payment for the total. The two constraints below are replaced by wider ones: every
-- existing row already satisfies them, no row is touched.
--   * state: 'voided' is an obligation replaced by the other way of paying before it was paid.
--   * parts: 'sena', 'saldo' and 'total' for a work without a marketplace commitment, whose amount
--     comes from its accepted budget or from the price booked on the reservation of its turno.
ALTER TABLE public."obligaciones_pago_servicio" DROP CONSTRAINT "ck_obligaciones_pago_estado";
ALTER TABLE public."obligaciones_pago_servicio"
  ADD CONSTRAINT "ck_obligaciones_pago_estado" CHECK ("estado" IN ('pending_payment', 'paid', 'refunded', 'charged_back', 'voided'));

ALTER TABLE public."obligaciones_pago_servicio" DROP CONSTRAINT "ck_obligaciones_pago_tramo_cadena";
ALTER TABLE public."obligaciones_pago_servicio"
  ADD CONSTRAINT "ck_obligaciones_pago_tramo_cadena" CHECK (
    ("tramo" = 'total' AND "publicacion_id" IS NOT NULL AND "compromiso_id" IS NOT NULL AND "origen_importe" <> 'booked_price')
    OR ("tramo" IN ('sena', 'saldo', 'total') AND "publicacion_id" IS NULL AND "compromiso_id" IS NULL AND "origen_importe" IN ('accepted_budget', 'booked_price'))
  );
