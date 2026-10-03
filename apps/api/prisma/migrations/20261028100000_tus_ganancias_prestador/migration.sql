-- TUS-GANANCIAS-01: earnings TUS owes a provider and their payout requests.
--
-- Additive and forward-only. Nothing existing is rewritten:
-- * intenciones_pago.modo_cobro says who collected each payment: 'split' (Mercado Pago Split
--   1:1 with the provider's account, the existing behaviour and the value of every existing
--   row) or 'plataforma' (TUS collected with its own account because the provider had none
--   linked; the provider's share becomes an earning TUS owes).
-- * movimientos_ganancia_prestador is the append-only ledger of what TUS owes each provider: an
--   earning per approved payment collected by TUS, its Mercado Pago fee, a debit per refund or
--   chargeback, explicit manual adjustments, and the reserve / release / completion of each
--   payout request. The balance is derived from it; no mutable balance column exists.
-- * solicitudes_liquidacion are the provider's payout requests (and how each one was executed:
--   Mercado Pago Payouts or another means recorded by the administration);
--   items_solicitud_liquidacion ties each request to the exact earnings it pays. A movement
--   belongs to at most one active request and a provider has at most one open request.

ALTER TABLE public."intenciones_pago" ADD COLUMN "modo_cobro" text NOT NULL DEFAULT 'split';

ALTER TABLE public."intenciones_pago"
  ADD CONSTRAINT "ck_intenciones_pago_modo_cobro" CHECK ("modo_cobro" IN ('split', 'plataforma'));

-- The minimum of a payout request is administrative configuration (versioned, append-only like
-- the rest of the payment configuration). Existing configurations get the initial $10.000,00.
ALTER TABLE public."configuraciones_pagos_servicio" ADD COLUMN "monto_minimo_liquidacion" bigint NOT NULL DEFAULT 1000000;

ALTER TABLE public."configuraciones_pagos_servicio"
  ADD CONSTRAINT "ck_configuraciones_pagos_monto_minimo_liquidacion" CHECK ("monto_minimo_liquidacion" > 0);

-- The account of a payout must be of the same provider: (id, prestador_tenant_id) is the target.
CREATE UNIQUE INDEX "uq_cuentas_cobro_prestador_id_tenant" ON public."cuentas_cobro_prestador"("id", "prestador_tenant_id");

CREATE TABLE public."solicitudes_liquidacion" (
  "id" text NOT NULL,
  "solicitud_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "prestador_id" text NOT NULL,
  "monto" bigint NOT NULL,
  "moneda" text NOT NULL,
  "estado" text NOT NULL,
  "cuenta_cobro_id" text NOT NULL,
  -- Destination: the email of the provider's Mercado Pago account (Payouts identifies the
  -- receiving account by email) and the linked account id at request time.
  "email_destino" text NOT NULL,
  "cuenta_externa_destino" text,
  -- How it was executed: 'mercado_pago_payouts' (POST /v1/payouts) or 'manual' (another means,
  -- recorded with its reference by the administration). Set when processing starts.
  "mecanismo" text,
  "payout_proveedor_id" text,
  "transaccion_proveedor_id" text,
  "estado_proveedor" text,
  "referencia_externa" text,
  "motivo_fallo" text,
  "observacion" text,
  "solicitada_por" text NOT NULL,
  "procesada_por" text,
  "resuelta_por" text,
  "clave_idempotencia" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  "procesando_en" timestamp(3),
  "pagada_en" timestamp(3),
  "fallida_en" timestamp(3),
  "cancelada_en" timestamp(3),
  CONSTRAINT "solicitudes_liquidacion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_solicitudes_liquidacion_prestador" FOREIGN KEY ("prestador_tenant_id", "prestador_id") REFERENCES public."prestadores"("tenant_id", "prestador_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fk_solicitudes_liquidacion_cuenta_cobro" FOREIGN KEY ("cuenta_cobro_id", "prestador_tenant_id") REFERENCES public."cuentas_cobro_prestador"("id", "prestador_tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_solicitudes_liquidacion_monto" CHECK ("monto" > 0),
  CONSTRAINT "ck_solicitudes_liquidacion_moneda" CHECK ("moneda" = 'ARS'),
  CONSTRAINT "ck_solicitudes_liquidacion_estado" CHECK ("estado" IN ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  CONSTRAINT "ck_solicitudes_liquidacion_email" CHECK (char_length("email_destino") BETWEEN 6 AND 254 AND "email_destino" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT "ck_solicitudes_liquidacion_mecanismo" CHECK ("mecanismo" IS NULL OR "mecanismo" IN ('mercado_pago_payouts', 'manual')),
  -- Processing or paid always says how; a Mercado Pago payout is paid only with its ids.
  CONSTRAINT "ck_solicitudes_liquidacion_mecanismo_estado" CHECK ("estado" NOT IN ('processing', 'paid') OR "mecanismo" IS NOT NULL),
  CONSTRAINT "ck_solicitudes_liquidacion_payout_ids" CHECK (("payout_proveedor_id" IS NULL) = ("transaccion_proveedor_id" IS NULL) AND ("payout_proveedor_id" IS NULL OR "mecanismo" = 'mercado_pago_payouts')),
  CONSTRAINT "ck_solicitudes_liquidacion_pagada" CHECK ("estado" <> 'paid' OR ("pagada_en" IS NOT NULL AND "referencia_externa" IS NOT NULL AND ("mecanismo" = 'manual' OR "payout_proveedor_id" IS NOT NULL))),
  CONSTRAINT "ck_solicitudes_liquidacion_fallida" CHECK ("estado" <> 'failed' OR ("fallida_en" IS NOT NULL AND "motivo_fallo" IS NOT NULL)),
  CONSTRAINT "ck_solicitudes_liquidacion_cancelada" CHECK ("estado" <> 'cancelled' OR "cancelada_en" IS NOT NULL),
  CONSTRAINT "ck_solicitudes_liquidacion_procesando" CHECK ("estado" <> 'processing' OR "procesando_en" IS NOT NULL)
);

CREATE UNIQUE INDEX "uq_solicitudes_liquidacion_prestador_solicitud" ON public."solicitudes_liquidacion"("prestador_tenant_id", "solicitud_id");
CREATE UNIQUE INDEX "uq_solicitudes_liquidacion_prestador_clave" ON public."solicitudes_liquidacion"("prestador_tenant_id", "clave_idempotencia");
-- One open request per provider: a second one (even concurrent) is refused by the database.
CREATE UNIQUE INDEX "uq_solicitudes_liquidacion_una_abierta" ON public."solicitudes_liquidacion"("prestador_tenant_id") WHERE "estado" IN ('pending', 'processing');
-- A Mercado Pago payout belongs to one request (the notification is resolved by it).
CREATE UNIQUE INDEX "uq_solicitudes_liquidacion_payout_proveedor" ON public."solicitudes_liquidacion"("payout_proveedor_id") WHERE "payout_proveedor_id" IS NOT NULL;
CREATE INDEX "ix_solicitudes_liquidacion_estado_fecha" ON public."solicitudes_liquidacion"("estado", "fecha_creacion");

CREATE TABLE public."movimientos_ganancia_prestador" (
  "id" text NOT NULL,
  "movimiento_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "prestador_id" text NOT NULL,
  "tipo" text NOT NULL,
  "monto" bigint NOT NULL,
  "moneda" text NOT NULL,
  "obligacion_tenant_id" text,
  "obligacion_id" text,
  "trabajo_id" text,
  "solicitud_id" text,
  "movimiento_relacionado_id" text,
  "motivo" text NOT NULL,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "movimientos_ganancia_prestador_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_movimientos_ganancia_prestador" FOREIGN KEY ("prestador_tenant_id", "prestador_id") REFERENCES public."prestadores"("tenant_id", "prestador_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  -- The obligation must be of this very provider and work.
  CONSTRAINT "fk_movimientos_ganancia_obligacion" FOREIGN KEY ("obligacion_tenant_id", "obligacion_id", "prestador_tenant_id", "trabajo_id") REFERENCES public."obligaciones_pago_servicio"("tenant_id", "obligacion_id", "prestador_tenant_id", "trabajo_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fk_movimientos_ganancia_solicitud" FOREIGN KEY ("prestador_tenant_id", "solicitud_id") REFERENCES public."solicitudes_liquidacion"("prestador_tenant_id", "solicitud_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_movimientos_ganancia_monto" CHECK ("monto" > 0),
  CONSTRAINT "ck_movimientos_ganancia_moneda" CHECK ("moneda" = 'ARS'),
  CONSTRAINT "ck_movimientos_ganancia_tipo" CHECK ("tipo" IN ('earning_credit', 'psp_fee_debit', 'refund_debit', 'chargeback_debit', 'adjustment_credit', 'adjustment_debit', 'payout_reserve', 'payout_release', 'payout_completed')),
  -- Earnings, their Mercado Pago fee and their reversals hang from a payment obligation; the
  -- reserve, release and completion of a payout from its request; a manual adjustment from
  -- neither (its reason says why).
  CONSTRAINT "ck_movimientos_ganancia_origen" CHECK (
    ("tipo" IN ('earning_credit', 'psp_fee_debit', 'refund_debit', 'chargeback_debit') AND "obligacion_tenant_id" IS NOT NULL AND "obligacion_id" IS NOT NULL AND "trabajo_id" IS NOT NULL AND "solicitud_id" IS NULL)
    OR ("tipo" IN ('payout_reserve', 'payout_release', 'payout_completed') AND "solicitud_id" IS NOT NULL AND "obligacion_id" IS NULL AND "obligacion_tenant_id" IS NULL AND "trabajo_id" IS NULL)
    OR ("tipo" IN ('adjustment_credit', 'adjustment_debit') AND "solicitud_id" IS NULL AND "obligacion_id" IS NULL AND "obligacion_tenant_id" IS NULL AND "trabajo_id" IS NULL)
  )
);

CREATE UNIQUE INDEX "uq_movimientos_ganancia_prestador_movimiento" ON public."movimientos_ganancia_prestador"("prestador_tenant_id", "movimiento_id");
-- One earning, one fee, one refund debit and one chargeback debit per obligation.
CREATE UNIQUE INDEX "uq_movimientos_ganancia_obligacion_tipo" ON public."movimientos_ganancia_prestador"("obligacion_tenant_id", "obligacion_id", "tipo") WHERE "obligacion_id" IS NOT NULL;
-- One reserve, at most one release and at most one completion per payout request: no double payout.
CREATE UNIQUE INDEX "uq_movimientos_ganancia_solicitud_tipo" ON public."movimientos_ganancia_prestador"("prestador_tenant_id", "solicitud_id", "tipo") WHERE "solicitud_id" IS NOT NULL;
CREATE INDEX "ix_movimientos_ganancia_prestador_fecha" ON public."movimientos_ganancia_prestador"("prestador_tenant_id", "fecha_creacion");

CREATE OR REPLACE FUNCTION public.tus_movimiento_ganancia_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'movimientos_ganancia_prestador is append-only';
END;
$$;

CREATE TRIGGER tus_movimiento_ganancia_append_only_trigger
  BEFORE UPDATE OR DELETE ON public."movimientos_ganancia_prestador"
  FOR EACH ROW EXECUTE FUNCTION public.tus_movimiento_ganancia_append_only();

CREATE TABLE public."items_solicitud_liquidacion" (
  "id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "solicitud_id" text NOT NULL,
  "movimiento_id" text NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_liberacion" timestamp(3),
  CONSTRAINT "items_solicitud_liquidacion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_items_solicitud_liquidacion_solicitud" FOREIGN KEY ("prestador_tenant_id", "solicitud_id") REFERENCES public."solicitudes_liquidacion"("prestador_tenant_id", "solicitud_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fk_items_solicitud_liquidacion_movimiento" FOREIGN KEY ("prestador_tenant_id", "movimiento_id") REFERENCES public."movimientos_ganancia_prestador"("prestador_tenant_id", "movimiento_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  -- A released item says when it was released; an active one was never released.
  CONSTRAINT "ck_items_solicitud_liquidacion_liberacion" CHECK (("activo" AND "fecha_liberacion" IS NULL) OR (NOT "activo" AND "fecha_liberacion" IS NOT NULL))
);

CREATE UNIQUE INDEX "uq_items_solicitud_liquidacion_solicitud_movimiento" ON public."items_solicitud_liquidacion"("prestador_tenant_id", "solicitud_id", "movimiento_id");
-- A movement is part of at most ONE active request: two concurrent requests cannot take it twice.
CREATE UNIQUE INDEX "uq_items_solicitud_liquidacion_movimiento_activo" ON public."items_solicitud_liquidacion"("prestador_tenant_id", "movimiento_id") WHERE "activo";
