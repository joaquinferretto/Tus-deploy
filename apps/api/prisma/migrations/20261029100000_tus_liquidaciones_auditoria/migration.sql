-- TUS-GANANCIAS-02: payout request states and their audit trail.
--
-- Additive and forward-only:
-- * The first state of a payout request is called 'requested' (it was 'pending'): the provider
--   asked and its funds are reserved; the administration has not started paying it. Rows are
--   moved to the new name and the CHECK and the "one open request per provider" index follow.
-- * auditoria_liquidaciones is the append-only trail of every action on a request: its creation,
--   each state change, every sending attempt to Mercado Pago and its answer, with actor and
--   correlation. One entry per request version, written in the transaction of the change.
-- * A payment's earning is reversed at most once: a refund and a chargeback of the same payment
--   never debit the provider twice (any further dispute is an explicit adjustment).

DROP INDEX public."uq_solicitudes_liquidacion_una_abierta";

ALTER TABLE public."solicitudes_liquidacion" DROP CONSTRAINT "ck_solicitudes_liquidacion_estado";

UPDATE public."solicitudes_liquidacion" SET "estado" = 'requested' WHERE "estado" = 'pending';

ALTER TABLE public."solicitudes_liquidacion"
  ADD CONSTRAINT "ck_solicitudes_liquidacion_estado" CHECK ("estado" IN ('requested', 'processing', 'paid', 'failed', 'cancelled'));

CREATE UNIQUE INDEX "uq_solicitudes_liquidacion_una_abierta" ON public."solicitudes_liquidacion"("prestador_tenant_id") WHERE "estado" IN ('requested', 'processing');

CREATE UNIQUE INDEX "uq_movimientos_ganancia_reverso_unico" ON public."movimientos_ganancia_prestador"("obligacion_tenant_id", "obligacion_id") WHERE "tipo" IN ('refund_debit', 'chargeback_debit');

CREATE TABLE public."auditoria_liquidaciones" (
  "id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "solicitud_id" text NOT NULL,
  -- The request version the action produced.
  "version" integer NOT NULL,
  "accion" text NOT NULL,
  "estado_anterior" text,
  "estado_nuevo" text NOT NULL,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  -- Short facts only (mechanism, provider status, reason, reference): never tokens or payloads.
  "detalle" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "auditoria_liquidaciones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_auditoria_liquidaciones_solicitud" FOREIGN KEY ("prestador_tenant_id", "solicitud_id") REFERENCES public."solicitudes_liquidacion"("prestador_tenant_id", "solicitud_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_auditoria_liquidaciones_version" CHECK ("version" > 0),
  CONSTRAINT "ck_auditoria_liquidaciones_accion" CHECK ("accion" IN ('requested', 'processing', 'send_confirmed', 'send_unconfirmed', 'send_rejected', 'provider_status', 'paid', 'failed', 'cancelled')),
  CONSTRAINT "ck_auditoria_liquidaciones_estado_nuevo" CHECK ("estado_nuevo" IN ('requested', 'processing', 'paid', 'failed', 'cancelled')),
  CONSTRAINT "ck_auditoria_liquidaciones_estado_anterior" CHECK ("estado_anterior" IS NULL OR "estado_anterior" IN ('requested', 'processing', 'paid', 'failed', 'cancelled')),
  -- Only the creation has no previous state.
  CONSTRAINT "ck_auditoria_liquidaciones_creacion" CHECK (("accion" = 'requested') = ("estado_anterior" IS NULL)),
  CONSTRAINT "ck_auditoria_liquidaciones_detalle" CHECK (jsonb_typeof("detalle") = 'object')
);

CREATE UNIQUE INDEX "uq_auditoria_liquidaciones_solicitud_version" ON public."auditoria_liquidaciones"("prestador_tenant_id", "solicitud_id", "version");
CREATE INDEX "ix_auditoria_liquidaciones_fecha" ON public."auditoria_liquidaciones"("fecha_creacion");

CREATE OR REPLACE FUNCTION public.tus_auditoria_liquidacion_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auditoria_liquidaciones is append-only';
END;
$$;

CREATE TRIGGER tus_auditoria_liquidacion_append_only_trigger
  BEFORE UPDATE OR DELETE ON public."auditoria_liquidaciones"
  FOR EACH ROW EXECUTE FUNCTION public.tus_auditoria_liquidacion_append_only();
