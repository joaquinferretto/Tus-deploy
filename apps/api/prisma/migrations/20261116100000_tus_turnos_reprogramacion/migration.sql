-- TURNOS-REPROGRAMACION-01. Additive: two columns with a default and one new table. No existing
-- row changes its meaning: no agenda allows rescheduling and no existing turno admits it.

-- The provider decides whether the turnos of its agenda can be rescheduled by their clients.
ALTER TABLE public."calendarios" ADD COLUMN "permite_reprogramacion" boolean NOT NULL DEFAULT false;

-- What a turno was booked with: copied from the agenda when the turno is created and never
-- changed afterwards (the provider cannot change the conditions of a turno that already exists).
ALTER TABLE public."reservas" ADD COLUMN "admite_reprogramacion" boolean NOT NULL DEFAULT false;

-- Every rescheduling of a turno: who, through which channel, from when to when, and when. The
-- turno itself keeps its row, its order, its payments and its commission; this is its history.
CREATE TABLE public."reprogramaciones_turno" (
  "id" text NOT NULL,
  "reserva_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "actor_id" text NOT NULL,
  "canal" text NOT NULL,
  "inicio_anterior" timestamp(3) NOT NULL,
  "fin_anterior" timestamp(3) NOT NULL,
  "inicio_nuevo" timestamp(3) NOT NULL,
  "fin_nuevo" timestamp(3) NOT NULL,
  "reprogramado_en" timestamp(3) NOT NULL,
  "politica_version" text NOT NULL,
  CONSTRAINT "reprogramaciones_turno_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_reprogramaciones_turno_reserva" FOREIGN KEY ("reserva_id") REFERENCES public."reservas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_reprogramaciones_turno_canal" CHECK ("canal" IN ('web', 'whatsapp')),
  CONSTRAINT "ck_reprogramaciones_turno_cambio" CHECK ("inicio_nuevo" <> "inicio_anterior" AND "fin_anterior" > "inicio_anterior" AND "fin_nuevo" > "inicio_nuevo"),
  -- Both the turno that is left and the one that is taken were more than 24 hours away.
  CONSTRAINT "ck_reprogramaciones_turno_ventana" CHECK ("inicio_anterior" - "reprogramado_en" > interval '24 hours' AND "inicio_nuevo" - "reprogramado_en" > interval '24 hours')
);
CREATE INDEX "ix_reprogramaciones_turno_reserva" ON public."reprogramaciones_turno" ("reserva_id", "reprogramado_en");
ALTER TABLE public."reprogramaciones_turno" ENABLE ROW LEVEL SECURITY;
