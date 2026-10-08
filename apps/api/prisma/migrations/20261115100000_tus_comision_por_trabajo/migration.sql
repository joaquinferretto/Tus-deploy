-- COMISION-TRABAJO-01. One new table and two constraints replaced by wider ones (every existing
-- row already satisfies them): no existing row or column is touched.
--
-- The commission of TUS that applies to a work, frozen once, when the work is contracted (its
-- first obligation is created, before any charge). Every part of that work (deposit, balance or
-- total) is charged with THIS rate, whatever the global policy says later. Works that already
-- had payments keep the rate frozen on their payment intents: the first payment that is prepared
-- after this migration copies it here (never the policy in force that day).
CREATE TABLE public."comisiones_trabajo" (
  "tenant_id" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "tasa_puntos_base" integer NOT NULL,
  "version_regla" text NOT NULL,
  "politica_id" text,
  "moneda" text NOT NULL,
  -- The total the rate was applied to when it was frozen, and the commission of that total.
  "base_minor" bigint NOT NULL,
  "comision_minor" bigint NOT NULL,
  "fijada_en" timestamp(3) NOT NULL,
  CONSTRAINT "comisiones_trabajo_pkey" PRIMARY KEY ("tenant_id", "trabajo_id"),
  CONSTRAINT "fk_comisiones_trabajo_trabajo" FOREIGN KEY ("tenant_id", "trabajo_id") REFERENCES public."trabajos"("tenant_id", "trabajo_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_comisiones_trabajo_tasa" CHECK ("tasa_puntos_base" >= 0 AND "tasa_puntos_base" <= 10000),
  CONSTRAINT "ck_comisiones_trabajo_importes" CHECK ("base_minor" >= 0 AND "comision_minor" >= 0 AND "comision_minor" <= "base_minor")
);
ALTER TABLE public."comisiones_trabajo" ENABLE ROW LEVEL SECURITY;

-- The administration may set the commission from 0% to 100% (it was capped at 30%). The two
-- constraints that carried the cap are replaced by the same ones with the new limit.
ALTER TABLE public."politicas_comision_servicio" DROP CONSTRAINT "ck_politicas_comision_tasa";
ALTER TABLE public."politicas_comision_servicio"
  ADD CONSTRAINT "ck_politicas_comision_tasa" CHECK ("tasa_puntos_base" >= 0 AND "tasa_puntos_base" <= 10000);
ALTER TABLE public."intenciones_pago" DROP CONSTRAINT "ck_intenciones_pago_checkout";
ALTER TABLE public."intenciones_pago"
  ADD CONSTRAINT "ck_intenciones_pago_checkout" CHECK (
    ("comision_marketplace" IS NULL OR ("comision_marketplace" >= 0 AND "comision_marketplace" <= "monto"))
    AND ("tasa_comision_bps" IS NULL OR ("tasa_comision_bps" >= 0 AND "tasa_comision_bps" <= 10000))
    AND (("tasa_comision_bps" IS NULL) = ("comision_marketplace" IS NULL))
    AND ("entorno_proveedor" IS NULL OR "entorno_proveedor" IN ('sandbox', 'production', 'deterministic'))
    AND ("url_checkout" IS NULL OR "url_checkout" ~ '^https://')
  );
