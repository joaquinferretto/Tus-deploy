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
