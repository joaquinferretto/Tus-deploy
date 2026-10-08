-- TURNOS-RECORDATORIOS-01 / TURNOS-CANCELACION-01. Additive: three new tables, no existing row or
-- column is touched.

-- A reminder of a confirmed turno, for one recipient and one kind. It is computed for ONE start
-- instant of the turno ("turno_inicio"): if the turno is moved, the rows that were still pending
-- are invalidated and new ones are computed. The UNIQUE index is the idempotency of the sweep:
-- one reminder per turno + recipient + kind (+ the instant it was computed for).
CREATE TABLE public."recordatorios_turno" (
  "id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "reserva_id" text NOT NULL,
  "destinatario" text NOT NULL,
  "tipo" text NOT NULL,
  "turno_inicio" timestamp(3) NOT NULL,
  "programado_para" timestamp(3) NOT NULL,
  "estado" text NOT NULL,
  "motivo" text,
  "reclamado_en" timestamp(3),
  "via" text,
  "plantilla" text,
  "wamid" text,
  "enviado_en" timestamp(3),
  "respuesta" text,
  "respuesta_en" timestamp(3),
  "respuesta_actor" text,
  "respuesta_canal" text,
  "cancelacion" boolean NOT NULL DEFAULT false,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "recordatorios_turno_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_recordatorios_turno_reserva" FOREIGN KEY ("reserva_id") REFERENCES public."reservas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_recordatorios_turno_destinatario" CHECK ("destinatario" IN ('cliente', 'prestador')),
  CONSTRAINT "ck_recordatorios_turno_tipo" CHECK ("tipo" IN ('24h', '2h')),
  CONSTRAINT "ck_recordatorios_turno_estado" CHECK ("estado" IN ('pending', 'sending', 'sent', 'skipped', 'invalidated', 'failed')),
  CONSTRAINT "ck_recordatorios_turno_via" CHECK ("via" IS NULL OR "via" IN ('plantilla', 'ventana')),
  CONSTRAINT "ck_recordatorios_turno_enviado" CHECK ("estado" <> 'sent' OR ("enviado_en" IS NOT NULL AND "via" IS NOT NULL)),
  CONSTRAINT "ck_recordatorios_turno_respuesta" CHECK ("respuesta" IS NULL OR ("respuesta" IN ('asiste', 'no_puede') AND "respuesta_en" IS NOT NULL))
);
CREATE UNIQUE INDEX "uq_recordatorios_turno" ON public."recordatorios_turno" ("reserva_id", "destinatario", "tipo", "turno_inicio");
-- What the sweep looks for: what is still to be sent, by the moment it is due.
CREATE INDEX "ix_recordatorios_turno_pendientes" ON public."recordatorios_turno" ("programado_para") WHERE "estado" = 'pending';
ALTER TABLE public."recordatorios_turno" ENABLE ROW LEVEL SECURITY;

-- The client accepted the cancellation policy before paying in advance: who, which turno, when,
-- through which channel and which version of the text.
CREATE TABLE public."aceptaciones_politica_cancelacion" (
  "id" text NOT NULL,
  "reserva_id" text NOT NULL,
  "cuenta_id" text NOT NULL,
  "canal" text NOT NULL,
  "version" text NOT NULL,
  "tramo" text NOT NULL,
  "aceptada_en" timestamp(3) NOT NULL,
  CONSTRAINT "aceptaciones_politica_cancelacion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_aceptaciones_politica_reserva" FOREIGN KEY ("reserva_id") REFERENCES public."reservas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_aceptaciones_politica_canal" CHECK ("canal" IN ('web', 'whatsapp')),
  CONSTRAINT "ck_aceptaciones_politica_tramo" CHECK ("tramo" IN ('sena', 'total'))
);
CREATE UNIQUE INDEX "uq_aceptaciones_politica" ON public."aceptaciones_politica_cancelacion" ("reserva_id", "cuenta_id", "version");
ALTER TABLE public."aceptaciones_politica_cancelacion" ENABLE ROW LEVEL SECURITY;

-- Who cancelled a turno, when, whether it was a late cancellation of its client (24 hours or less
-- before the turno) and what that means for what was paid. It moves no money by itself: a refund
-- is still an audited command of the administration.
CREATE TABLE public."cancelaciones_turno" (
  "reserva_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "cancelada_por" text NOT NULL,
  "actor_id" text,
  "canal" text,
  "cancelada_en" timestamp(3) NOT NULL,
  "turno_inicio" timestamp(3) NOT NULL,
  "tardia" boolean NOT NULL,
  "devolucion" text NOT NULL,
  "politica_version" text NOT NULL,
  -- Which rule of the policy applied, and the accounting of what was paid (minor units), kept
  -- apart: the value of the service, the charge of TUS, what is refundable and the penalty.
  "regla" text NOT NULL,
  "moneda" text NOT NULL,
  "reserva_creada_en" timestamp(3) NOT NULL,
  "precio_minor" bigint NOT NULL,
  "pagado_minor" bigint NOT NULL,
  "cargo_tus_minor" bigint NOT NULL,
  "servicio_pagado_minor" bigint NOT NULL,
  "reembolsable_minor" bigint NOT NULL,
  "penalizacion_minor" bigint NOT NULL,
  CONSTRAINT "cancelaciones_turno_pkey" PRIMARY KEY ("reserva_id"),
  CONSTRAINT "fk_cancelaciones_turno_reserva" FOREIGN KEY ("reserva_id") REFERENCES public."reservas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_cancelaciones_turno_por" CHECK ("cancelada_por" IN ('cliente', 'prestador', 'administracion')),
  CONSTRAINT "ck_cancelaciones_turno_devolucion" CHECK ("devolucion" IN ('corresponde', 'no_reembolsable', 'sin_pago')),
  CONSTRAINT "ck_cancelaciones_turno_regla" CHECK ("regla" IN ('ultimo_momento', 'gracia', 'intermedia', 'prestador', 'administracion')),
  -- The penalty is only ever the client's: nobody else's cancellation is "late" or penalized.
  CONSTRAINT "ck_cancelaciones_turno_tardia" CHECK (NOT "tardia" OR ("cancelada_por" = 'cliente' AND "regla" = 'ultimo_momento')),
  CONSTRAINT "ck_cancelaciones_turno_sin_penalizar" CHECK ("cancelada_por" = 'cliente' OR "penalizacion_minor" = 0),
  -- The parts always add up, and the penalty is never more than the service that was paid.
  CONSTRAINT "ck_cancelaciones_turno_importes" CHECK (
    "precio_minor" >= 0 AND "pagado_minor" >= 0 AND "cargo_tus_minor" >= 0 AND "reembolsable_minor" >= 0 AND "penalizacion_minor" >= 0
    AND "servicio_pagado_minor" + "cargo_tus_minor" = "pagado_minor"
    AND "reembolsable_minor" + "penalizacion_minor" = "servicio_pagado_minor"
  )
);
ALTER TABLE public."cancelaciones_turno" ENABLE ROW LEVEL SECURITY;
