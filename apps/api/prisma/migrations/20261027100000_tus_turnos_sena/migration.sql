-- TURNOS-SENA-01: deposit ("seña") of an accepted turno and identification of the client in the
-- assistant. Forward-only. No table is created, no row is deleted or rewritten, and nothing is
-- stored twice:
--   * services, variants and prices already live in "perfil_servicios" and
--     "tarifas_servicio_prestador";
--   * the person and its document already live in "User" ("documentNumber", normalized, with the
--     partial unique index "uq_user_documento");
--   * the amount of a deposit derives from "reservas"."precio_final" and its status from the
--     payment obligation: the reservation gains no column.
--
-- Money in TUS always hangs from a row of "trabajos" (obligation -> payment intent -> provider
-- event -> ledger). An accepted turno that has a price gets its payment order there:
-- origen = 'turno', bound to its reservation by the foreign key and the unique index that already
-- exist ("fk_trabajos_reservas", "uq_trabajos_reserva": at most one order per reservation).

-- 1. "trabajos"."origen" gains 'turno'. Every existing row is 'marketplace' or 'solicitud', which
--    both definitions accept: the constraint cannot fail to be re-created.
ALTER TABLE public."trabajos" DROP CONSTRAINT "ck_trabajos_origen";

-- Provider acceptance is a payment gate, not a confirmed reservation. The verified deposit
-- notification is the only automatic path from awaiting_payment to confirmed.
ALTER TABLE public."reservas" DROP CONSTRAINT "ck_reservas_estado";
ALTER TABLE public."reservas" ADD CONSTRAINT "ck_reservas_estado" CHECK (
  "estado" IN ('pending', 'awaiting_payment', 'confirmed', 'rejected', 'expired', 'cancelled', 'cancelled-late', 'no-show', 'completed')
) NOT VALID;

-- Reuse the existing validity timestamp. An accepted request receives a fresh 24-hour window,
-- bounded by the start of the appointment; reads and agenda writes release it when overdue.
ALTER TABLE public."reservas" DROP CONSTRAINT "ck_reservas_solicitud_vigencia";
ALTER TABLE public."reservas" ADD CONSTRAINT "ck_reservas_solicitud_vigencia" CHECK (
  "estado" NOT IN ('pending', 'awaiting_payment') OR "solicitud_expira_en" IS NOT NULL
) NOT VALID;
CREATE INDEX "ix_reservas_esperando_pago" ON public."reservas"("calendario_id", "solicitud_expira_en")
  WHERE "estado" = 'awaiting_payment';

ALTER TABLE public."trabajos"
  ADD CONSTRAINT "ck_trabajos_origen" CHECK ("origen" IN ('marketplace', 'solicitud', 'turno'));

-- 2. Shape of each origin. The two existing branches are unchanged; the new one says that the
--    order of a turno is bound to a reservation of ITS provider and to nothing else (no
--    commitment, listing, request or budget).
ALTER TABLE public."trabajos" DROP CONSTRAINT "ck_trabajos_origen_coherente";

ALTER TABLE public."trabajos"
  ADD CONSTRAINT "ck_trabajos_origen_coherente" CHECK (
    ("origen" = 'marketplace' AND "compromiso_id" IS NOT NULL AND "publicacion_id" IS NOT NULL AND "solicitud_id" IS NULL)
    OR ("origen" = 'solicitud' AND "solicitud_id" IS NOT NULL AND "compromiso_id" IS NULL AND "publicacion_id" IS NULL)
    OR (
      "origen" = 'turno'
      AND "reserva_id" IS NOT NULL
      AND "reserva_tenant_id" = "prestador_tenant_id"
      AND "compromiso_id" IS NULL AND "publicacion_id" IS NULL AND "solicitud_id" IS NULL
      AND "requiere_presupuesto" = false AND "presupuesto_aceptado_id" IS NULL
    )
  );

-- 3. Where the amount of an obligation comes from: the accepted budget, the fixed price of a
--    commitment or, new, the price booked on the reservation of a turno ('booked_price').
ALTER TABLE public."obligaciones_pago_servicio" DROP CONSTRAINT "ck_obligaciones_pago_origen_importe";

ALTER TABLE public."obligaciones_pago_servicio"
  ADD CONSTRAINT "ck_obligaciones_pago_origen_importe" CHECK (
    ("origen_importe" = 'accepted_budget' AND "presupuesto_id" IS NOT NULL AND "presupuesto_version" IS NOT NULL)
    OR ("origen_importe" = 'fixed_price_commitment' AND "presupuesto_id" IS NULL AND "presupuesto_version" IS NULL)
    OR ("origen_importe" = 'booked_price' AND "presupuesto_id" IS NULL AND "presupuesto_version" IS NULL)
  );

-- 4. Parts and commercial chain. 'total' keeps the marketplace chain; 'sena'/'saldo' of a
--    request-born work come from its accepted budget; the deposit of a turno ('sena') comes from
--    the booked price. A turno has no 'saldo' and no 'total'.
ALTER TABLE public."obligaciones_pago_servicio" DROP CONSTRAINT "ck_obligaciones_pago_tramo_cadena";

ALTER TABLE public."obligaciones_pago_servicio"
  ADD CONSTRAINT "ck_obligaciones_pago_tramo_cadena" CHECK (
    ("tramo" = 'total' AND "publicacion_id" IS NOT NULL AND "compromiso_id" IS NOT NULL AND "origen_importe" <> 'booked_price')
    OR ("tramo" IN ('sena', 'saldo') AND "publicacion_id" IS NULL AND "compromiso_id" IS NULL AND "origen_importe" = 'accepted_budget')
    OR ("tramo" = 'sena' AND "publicacion_id" IS NULL AND "compromiso_id" IS NULL AND "origen_importe" = 'booked_price')
  );

-- 5. Account a conversation of the assistant identified by full name + document (WhatsApp has no
--    TUS session). It is a reference to the account, never a copy of the person's data; the
--    conversation forgets it when the account is deleted. "identificada_en" bounds how long the
--    identification is honoured.
ALTER TABLE public."conversaciones_whatsapp" ADD COLUMN "cuenta_identificada_id" text;
ALTER TABLE public."conversaciones_whatsapp" ADD COLUMN "identificada_en" timestamp(3);

ALTER TABLE public."conversaciones_whatsapp"
  ADD CONSTRAINT "fk_conversaciones_whatsapp_cuenta_identificada"
  FOREIGN KEY ("cuenta_identificada_id") REFERENCES public."Account"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE public."conversaciones_whatsapp"
  ADD CONSTRAINT "ck_conversaciones_whatsapp_identificacion" CHECK (
    "cuenta_identificada_id" IS NULL OR "identificada_en" IS NOT NULL
  );

-- Conversations of an account (the notice of an accepted turno goes to them) and the lookup the
-- foreign key needs when an account is deleted.
CREATE INDEX "ix_conversaciones_whatsapp_cuenta_identificada"
  ON public."conversaciones_whatsapp"("cuenta_identificada_id")
  WHERE "cuenta_identificada_id" IS NOT NULL;
